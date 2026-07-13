# Observation Manifest — model-preset-session-default

Raw findings as they arrive, worker-attributed. Full reports: `agent://<Worker>`.

## Wave 1

### ResExploreApi (pinned 16.4.0 node_modules types — primary artifact)
- `pi.setModel(model: Model): Promise<boolean>` on ExtensionAPI — "Set the current model. Returns false if no API key available." Takes NO role param. [types.d.ts:742]
- `pi.getThinkingLevel()/setThinkingLevel(level)` exist separately [types.d.ts:744-746].
- `Settings.override(path, value)` — "Apply runtime overrides (not persisted)"; `set()` — "PERSISTS. Updates global settings and queues a background save." [settings.d.ts]
- Role helpers on Settings: `setModelRole`, `getModelRole`, `getModelRoles`, `overrideModelRoles`.
- Settings key `task.agentModelOverrides` (record, default {}) [settings-schema.ts:4178-4181]; `modelRoles` (record) [settings-schema.ts:482].
- `registerProvider`, `registerFlag`, `registerCommand` etc. enumerated.

### ResExploreVendored (vendored oh-my-pi 16.3.15 — runtime internals; skew risk until W2)
- Session model = in-memory `AgentSession.this.model`; persisted form = settings `modelRoles` role `default`.
- THREE disjoint steering surfaces: (a) `modelRoles.default` = startup-only persisted default; (b) `task.agentModelOverrides` = spawn-time subagent override (re-read fresh each spawn — live via settings.override); (c) `ctx.setModel` = ephemeral live-session switch (role='default', no persist).
- Overriding `modelRoles` mid-session does NOT flip the live model — `onModelRolesChanged` only rebuilds advisor runtime [agent-session.ts:2282, 2308-2311].
- Subagent resolution priority [model-resolver.ts:1004-1021]: settingsOverride (agentModelOverrides) → agent frontmatter model (unless session-inherited sentinel) → parent's LIVE activeModelPattern → fallbackModelPattern → modelRoles.default → ''. **Parent's live model beats modelRoles.default.**
- `settings.override` lands in in-memory #overrides layer, never queues save [settings.ts:403-409].
- eval `agent(model=...)` beats agentModelOverrides; builtin task tool has no per-call model arg.
- TUI agent-dashboard writes task.agentModelOverrides via persisted `set` [agent-dashboard.ts:557] — potential write-semantics conflict with lets-craft's in-memory override (low risk).
- Version skew: vendored = 16.3.15, pinned = 16.4.0; 16.4.0 source NOT in vendored tree.

### ResExploreTests (repo test conventions)
- Unit seams: `FakeStore implements AgentModelStore` (get/set/override + `lastWrite` discriminator) [preset-injection-spike.test.ts:32-58]; models resolution faked as `(base)=>boolean` closure. No mock frameworks — hand-written doubles only.
- vitest cannot import omp SDK values (`@oh-my-pi/pi-natives` needs Bun) — real Settings never instantiated in unit tests; compile-time `Assert<Settings extends AgentModelStore>` proves the seam [spike.ts:51].
- e2e: `LSC_E2E=1`-gated, `describe.skipIf`, spawns real omp with `--mode=json`; `writeCheapModelPreset` seeds `.lsc/models.yaml`; subagent API calls land in `<session-dir>/<agentId>.jsonl`, NOT parent stdout (spike finding 7).
- Coverage gaps: `applyActivePreset` ZERO unit coverage; `command.ts` ZERO coverage (ctx.ui-coupled); `loadEffectiveModelsFile` on-disk merge untested.
- Temp-dir pattern: `mkdtempSync(join(tmpdir(), "lsc-<scope>-"))` + afterEach rmSync.

### LibNpmPkg (public footprint)
- Package fully public on npm; 16.4.0 published 2026-07-10T12:43Z; latest 16.4.8; docs = repo docs/*.md + shipped .d.ts; no hosted docs site; no wiki.
- 16.4.0 breaking change: bundled agent `explore` renamed `scout` (irrelevant to preset paths).
- PR #4705 (open): "User-configured per-agent overrides from /agents (task.agentModelOverrides) take precedence over frontmatter."
- Issue #5237 (open FR): provider-scoped modelRoles presets — unimplemented; watch for collision.
- Fork lineage: upstream = earendil-works/pi (ex badlogic/pi-mono); @oh-my-pi = can1357's fork.

### LibOmpDocs (omp:// 121 pages + upstream mirror + issue tracker)
- omp docs list `setModel` in ExtensionAPI methods but give NO semantics; upstream pi docs give full contract (Promise<boolean>, false on no API key).
- `ctx.models` read-only facade: list/current/resolve/family; `current()` "read lazily, reflects /model switches".
- No extension settings API documented anywhere; `settings.override()` technique undocumented (source-only contract).
- Issue #1231 (getModelRoles/setActiveRole for extensions) closed-stale unimplemented — no role API coming.
- `/model` hard-handled by InputController pre-prompt — extension cannot intercept; OMP docs omit `model_select` event (upstream documents it) — W2 checks source.
- Settings write semantics: all persistent writes land in GLOBAL config.yml; project config read-only to settings commands.
- modelRoles built-in roles: default/smol/slow/vision/plan/designer/commit/tiny/task/advisor; values may carry `:minimal..:max` thinking suffix.
- Session log: model switch appends `model_change {model, role?}`; missing role = default. setModelTemporary documented as NOT rewriting saved role mapping.
- "preset" in omp vocabulary = statusLine/theme only — no naming collision.
- Upstream ships `examples/extensions/preset.ts` — "Saveable presets (model, tools, thinking)".

### LibPriorArt (9-tool comparative matrix)
- Fallback chain `agent entry → preset default → session model` is industry norm (Codex agent→profile→base; Claude Code frontmatter→main with `inherit` sentinel; opencode agent.model→config model; goose planner→GOOSE_MODEL). Nobody errors on missing role entry.
- Default lives as EXPLICIT SIBLING FIELD in every tool that bundles both (Codex profile top-level `model`, opencode `model` beside `agent`) — never a reserved agent name inside the role map. Claude Code reserves a VALUE (`inherit`), not a key.
- Claude Code org-default pattern = "a starting point, not a restriction": reapplies at launch, user /model wins in-session — maps directly onto session_start re-apply.
- Activation persistence controversy: Codex 0.134.0 REMOVED persistent profile selector (security: project config may not select profiles); Claude Code v2.1.153 made /model persist by default. lets-craft's `active:` + session_start re-apply = Claude Code direction.
- Roo Code: per-task sticky profile; orchestrator subtasks inherit parent profile — anti-mid-task-drift guarantee.
- Aux-model slot (opencode small_model, goose GOOSE_FAST_MODEL) = recurring future extension; schema should leave room.

### LibYamlSchema (config-schema evolution precedent)
- Pattern A (structured sibling `default:` block beside named-entry map): GitHub Actions defaults:, GitLab default: — industry end-state; GitLab MIGRATED from reserved-keys-in-map to this.
- Pattern B (reserved key inside map): GitLab job names reserved list, Ansible `all`/`ungrouped`, Poetry `python` in dependencies map, ssh_config `Host *`. Safe when namespace is closed (LSC_AGENT_NAMES = closed 7-name set).
- Unknown-key policy: warn-and-ignore is the documented compromise (Compose default mode, K8s Warn mode GA); strict readers make every additive change breaking under version skew; silent-ignore hides typos (K8s pre-1.8 outage).
- Local mapping vs old plugin versions: (B) reserved key in preset → old reads fine, phantom lsc-default inert, preserved except interactive edit of that preset; (A) top-level sibling → old reads fine but DROPPED on any old-version write (save serializes only {active,presets}); (A'/C) structural {default,agents} → old parseModelsFile THROWS → breaks whole preset subsystem on shared global file.
- No version field; additive-optional evolution only (K8s api_changes round-trip rule).
- Validation UX: strict at authoring time (interactive editor), tolerant warn→fallback at load time (session_start must never brick).

### LibBrowse (ecosystem census)
- omp issue #2392 "Add model role presets" CLOSED NOT_PLANNED (2026-06-17) — host explicitly ceded model presets to extension-land. roboomp triage enumerates 6 design questions (provider-unavailable behavior, override surface, cycle order, dirty-state `Balanced*`, status-line visibility...). Companion unmerged PRs #2498/#2500/#2501.
- PR #3570 MERGED: "honor modelRoles.default for extension-provided models on fresh launch" — extension↔session-default seam.
- Upstream history: #4002/#3254 — pi.setModel USED to silently persist global default; changed to session-scoped. Confirms current ephemeral semantics are deliberate.
- pasky/pi-amplike modes.ts: near-identical prior art — ModesFile {version, currentMode, modes}, session_start re-apply, reverse-sync to `custom` pseudo-mode on manual switch, .lock files + atomic writes.
- nicobailon/pi-subagents (2,536★): precedence per-run > agentOverrides > frontmatter > subagents.defaultModel > parent session model; fallbackModels arrays; fuzzy matching, never-cross-provider.
- pi-prompt-template-model: `restore: true` default — auto-restores previous session model after command.
- Ecosystem norm: apply-at-runtime via pi.setModel + persist in extension's OWN config file; nobody persistently mutates host modelRoles/settings.
- lets-craft has zero public artifacts (no self-reference contamination in findings).

### LibRepoDive (4 source dives)
- Codex: ConfigProfile all-Option sparse overlay, deny_unknown_fields; profile = user-layer overlay; legacy in-file [profiles.*] HARD-ERROR migration; model selector = topmost runtime config layer; per-turn re-derive.
- opencode: `currentModel` = session's persisted model → last user msg model → provider.defaultModel(); `cfg.model` → recent-models state → first provider best model; invalid small_model silently dropped to fallback (test-asserted).
- goose: structured providers: map + active_provider pointer; live switch = Agent.update_provider mutex swap + session-record persistence; env → active provider entry model → legacy flat key.
- aider: role models resolved inside Model object; `self.weak_model = self` when unset (= inherit main); live switch = rebuild Coder via SwitchCoder exception, history carried.
- Cross-repo: precedence convergence per-invocation > per-role > profile default > session/global default; validate→drop→fallback posture matches opencode (only one with dedicated invalid-path tests).
