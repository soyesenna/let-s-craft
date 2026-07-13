# Research Synthesis — model-preset-session-default

Feature: lets-craft의 model preset이 **세션 default 모델**을 설정할 수 있게 지원.
Mode: live (3 waves, 15 workers, converged — see `waves/wave-3.md`).
Sources: [1]–[15] indexed at the bottom; inline `file:line` refs are the underlying primary artifacts each worker verified.

---

## 1. The host contract (what an omp 16.4.0 extension can and cannot do)

The omp host tracks **three disjoint model-steering surfaces**, each with different timing and persistence [2][10][14]:

1. **`modelRoles.default`** (settings record) — the *persisted startup default*. Read once at startup (`sdk.ts:1287`); a runtime change never flips the live session (the only subscriber rebuilds the advisor runtime, `agent-session.ts:2308-2311`) [2][10]. Since PR #3570 (merged, pre-16.4.0), fresh startup retries this role against extension-registered models before falling back [12].
2. **`task.agentModelOverrides`** (settings record) — *per-subagent spawn-time override*, re-read fresh at every spawn (`task/index.ts:1139-1149`), which is why lets-craft's in-memory `settings.override()` write is live for the next spawn [1][2]. In the pinned resolver this override is **exclusive**: present ⇒ immediate return, no fallthrough to frontmatter or anything else (`model-resolver.ts:1006-1028`) [14].
3. **`pi.setModel(model: Model): Promise<boolean>`** (ExtensionAPI) — the **only extension-callable live session-model switch** (`types.d.ts:742`; impl `loader.ts:243` → `runExtensionSetModel`, `compact-handler.ts:25-40`) [1][10]. Returns `false` when no API key resolves (async, OAuth-refresh-capable `getApiKey` gate) [10]. It takes a `Model` object — the bridge from a preset's string is `ctx.models.resolve(spec)`, which is **auth-filtered** (returns `undefined` for unauthenticated or settings-disabled providers) and **parses but drops** a `:effort` suffix; effort must be split by the caller and applied via the separate `pi.setThinkingLevel(level)` [10].

**Persistence semantics of `pi.setModel` (the subtle one):** it never writes settings (the `options?.persist` gate is falsy on the extension path, `agent-session.ts:8948`), but it **appends a `model_change role="default"` entry to the session transcript** (`agent-session.ts:8947`), which resume **replays** (`session-context.ts:222-228`) [10]. Net: a preset-applied session model is *sticky within that session across resumes* and *invisible to global config* — very close to the semantics a "session default" wants for free, with one hazard: on a resumed session, blindly re-applying the preset at `session_start` would clobber the user's later in-session `/model` choice that the replay just restored [10][14].

**Timing:** `session_start` is emitted after the full extension action set is bound and is the last startup step at all four init sites; nothing re-stamps the model afterwards on a fresh boot (`runtime-init.ts:53→141`, mirrors in interactive/acp/task-executor) [10]. So a `session_start` handler can switch the model before turn 1 — source-confirmed, execution unobserved (the trace's recommended probe covers it).

**Blind spots:** there is **no model-change event** in the 16.4.0 `ExtensionEvent` union (`types.ts:842-877`) — extensions cannot observe `/model` switches; polling `ctx.model` (e.g. at `before_agent_start`) is the only substitute [10]. (pi-amplike's elegant `model_select` reverse-sync works only on upstream pi, which still ships that event [11][5].) There is also **no resume flag**: `SessionStartEvent` is an empty object; the only fresh-vs-resumed discriminator is `ctx.sessionManager.getEntries().length` [14]. `/model` itself is hard-handled by the input controller and cannot be intercepted [5]. `/new`, session switch, and branch do NOT re-fire `session_start` (dedicated `session_switch`/`session_branch` events exist) [14]. omp "profiles" are launch-time directory isolation (`--profile`/`OMP_PROFILE` → separate `~/.omp` root), not a session-scoped bundle — they cannot host preset persistence [14].

## 2. The host's revealed design law (from its own preset/persona review history)

The omp maintainer declined a native model-preset feature (issue #2392 NOT_PLANNED; role-API issue #1231 closed stale; provider-scoped modelRoles #5237 still an unimplemented FR) — the niche is explicitly extension-land [8][4][13]. The rejected/merged PR trail encodes a consistent design law [12]:

- **Never rewrite the user's persisted `modelRoles`** — a preset is a *session-scoped overlay*; persist at most the preset **id** (#2391 blocking review; #2515 corrected design).
- **Explicit user config beats preset values** (#2515 pinned keys; #4705 exclusive `task.agentModelOverrides`).
- **Resume/fork/restore paths stay silent** — no re-apply, no history recording (#4705 `restore` mode; #2515 resume skip).
- **Live switch, history recording, and persistence are three independent axes** (#4705 splits `setModel` / `record` / `persist`).
- **Thinking level travels with the model selector and must not be clobbered by weaker sources**; pair every model switch with explicit thinking-level resolution (#4705 guard; live bug #5290/#5297 confirms the hazard) [12][13].
- **Explicit actions fail loudly; ambient/auto actions fail soft** (#2515: explicit `--preset` exits 1, persisted default silently skips).
- **Defaults are opt-in** — "no default-behavior changes without maintainer sign-off" [12].
- **Prompt-cache economics is the maintainer's #1 stated concern for mid-session model switching** (#4520): never silently convert warm `cacheRead` traffic into cold full-price prefill; session-start application is cache-safe by construction; explicit user action = informed consent [13][15].

## 3. Ecosystem prior art (what everyone else built)

- **Upstream `preset.ts`** (vendored at `pi/packages/coding-agent/examples/extensions/preset.ts`): named presets `{provider, model, thinkingLevel, tools, instructions}` in global+project JSON (project wholesale-wins per name); apply = `modelRegistry.find` → `pi.setModel` → `pi.setThinkingLevel`; warn-and-continue on missing key/model; snapshot original state **only at the no-preset→active boundary** and restore on clear [10]. Its two known defects are instructive: snapshot-once means a manual `/model` mid-preset is silently reverted on clear (upstream bug #3273, fixed for axis-completeness by PR #3272 but still process-lifetime-only) [15], and `session_start` deliberately restores only the preset *name*, never the model [10].
- **pi-amplike `modes.ts`** — the most complete independent implementation: named modes + `session_start` that **re-labels from the live model instead of re-applying**; reverse-sync flips to a `custom` pseudo-mode when the user's selection matches no mode; explicit "use vs store" prompt on dirty state; apply failures keep the previous model and flip the label honestly; file locking + atomic tmp-rename for the shared config [11].
- **pi-subagents** — the canonical fallback-chain: per-run > overrides > frontmatter > `subagents.defaultModel` > **parent's in-memory model pinned explicitly** — the last step exists precisely because falling back to an ambient shared global default caused cross-session contamination (issue #266: "whichever session last changed model in TUI poisons all future child processes"; fixed in 0.29.0) [11][15].
- **Across 9 mainstream tools** (Codex profiles, Claude Code, opencode, aider, goose, Cline, Roo, continue, Cursor): the chain `role entry → preset/profile default → session model` with silent fall-through is the industry norm; the bundled default always lives as an **explicit sibling field**, never a reserved name inside the role map (Claude Code reserves the *value* `inherit`, not a key); Claude Code's org-default gives the exact target semantics — "a starting point, not a restriction": reapply at launch, user choice wins in-session [6][9].

## 4. What this means for the lets-craft schema (constraints already measured)

Tier-1 reproductions against `src/preset/models-file.ts` [TracerCodePath, trace.md lane 1]: `parseModelsFile` **drops** unknown top-level keys; a reserved `default:` key inside a preset parses fine today but is mis-routed into a phantom `lsc-default` agent by `validatePreset` (`validate.ts:52-62`); a structural per-preset value `{default, agents}` **throws** in every old reader of the shared global file; `mergeModelsFiles` silently drops any field that isn't `active`/`presets`. Schema-evolution precedent (GitLab's reserved-keys→`default:`-block migration, Compose/K8s warn-mode, K8s round-trip rule) says: sibling field is the industry end-state, reserved-key-in-closed-namespace is the only shape old lets-craft versions read *and* mostly round-trip; warn-and-ignore unknowns + warn-and-drop invalid values (already lets-craft's C13 posture) is the standard [7]. The agent-name namespace is closed (7 names), so a reserved key cannot collide with a real agent — but it requires explicit special-casing at every `Object.entries(preset)` walk [7][trace lane 1].

The version-drift risk of building on the pinned contract is low: releases 16.4.1–16.4.8 changed none of `pi.setModel` / `ctx.models` / `modelRoles` schema / `task.agentModelOverrides` / init ordering [13]. Preset model IDs themselves can vanish in host PATCH releases (16.4.1 removed provider-scoped aliases), so apply-time resolution failures must stay soft [13].

## 5. Feature-shaping conclusions (carried into trace.md → interview)

1. **Mechanically, "set the session default model" is feasible and well-supported**: `resolve → setModel → setThinkingLevel` at activation and at fresh-session `session_start`, exactly the shape the host's own #2515/#4705 chose [10][12].
2. **Setting the live session model subsumes the fallback improvement**: subagents without an explicit override inherit the parent's *live* model (above `modelRoles.default` in the chain), so switching the session model automatically retargets unspecified lsc agents [2][14]. A fallback-only variant (main session untouched, unspecified agents get the preset default via expanded `agentModelOverrides`) is implementable but is a *different user-visible behavior* — the interview must discriminate.
3. **The re-apply policy is the riskiest design point**: no resume flag + transcript replay means naive session_start re-application clobbers user choice on resumed sessions; the entries-count heuristic, or comparing the current model against the preset's default before applying, is required [10][14]. Host law: resume paths silent; explicit config beats preset [12].
4. **Do not repeat preset.ts's snapshot-once/no-observation defects**; there is no event to observe switches, so any dirty-state UX must poll [10][11].
5. **Persistence**: keep the preset id (`active:`) durable in models.yaml (already the design); keep the *effect* ephemeral (setModel + runtime overrides); never touch host `modelRoles` [12][14][15]. The global `active:` pointer is a known contamination shape — writes to it must remain explicit user actions [15].

---

## Source index

- [1] `agent://ResExploreApi` — pinned 16.4.0 `.d.ts` surface (node_modules).
- [2] `agent://ResExploreVendored` — vendored 16.3.15 runtime internals (superseded where noted by [10]).
- [3] `agent://ResExploreTests` — lets-craft test conventions (FakeStore seam, e2e gating, coverage gaps).
- [4] `agent://LibNpmPkg` — npm/GitHub public footprint, release history, #4705/#5237 leads.
- [5] `agent://LibOmpDocs` — omp:// docs sweep (121 pages), upstream docs mirror, issue #1231.
- [6] `agent://LibPriorArt` — 9-tool comparative matrix (docs-level).
- [7] `agent://LibYamlSchema` — schema-evolution precedent + local old-version mapping table.
- [8] `agent://LibBrowse` — ecosystem census; #2392 NOT_PLANNED; pi-amplike/pi-subagents discovery.
- [9] `agent://LibRepoDive` — Codex/opencode/goose/aider source dives.
- [10] `agent://W2PresetTsSkew` — pinned 16.4.0 src verification + preset.ts deep read (authoritative for runtime semantics).
- [11] `agent://W2Amplike` — pi-amplike modes.ts full read; pi-subagents resolution internals.
- [12] `agent://W2HostPrs` — host PR/review design law (#2391/#2515/#3570/#4705; roboomp checklists).
- [13] `agent://W2ReleaseScan` — 16.4.1–16.4.8 drift scan; #4520 cache economics; live host bugs (#5249/#5290/#5325/#5326).
- [14] `agent://W3SessionResume` — session_start payload/emit-sites; resolver exclusivity; override-masking; profiles.
- [15] `agent://W3Contamination` — pi-subagents #266; PR #4689 state + cache policy; upstream #3273/#3272 restore semantics.
