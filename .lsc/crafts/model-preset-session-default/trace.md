# Trace — model-preset-session-default

Feature idea (verbatim): **"model preset에 세션 default 모델 설정 지원기능을 개발해줘."**
Classification: **BROWNFIELD** (30 commits, buildable src/, full vitest suite; the model-preset subsystem `src/preset/` is an existing, shipped feature this idea extends).
Lanes: 3 (code-path / host-orchestration / premise-audit) + external research (3 waves, 15 workers, converged — `research/`).

---

## 1. Observed Result

lets-craft's model preset system today manages **per-agent** model overrides only:

- Schema `ModelsFile { active: string|null; presets: Record<string, PresetModels> }`, `PresetModels = Record<agentName, "provider/model[:effort]">` (`src/preset/models-file.ts:15-19`). No field for a session-level default exists.
- Injection writes exactly one settings key, `task.agentModelOverrides`, via in-memory `settings.override()` (`src/preset/spike.ts:36,80`; `src/preset/inject.ts:36`), re-applied on every `session_start` (`src/main.ts:24-37`).
- Agents without a (valid) preset entry fall back to the **omp session's main model** — stated in 6 artifacts: `_docs/spec.md:49`, `README.md:130,137`, `src/preset/command.ts:21` (SKIP_LABEL "(skip — inherit session model)"), `src/preset/validate.ts:24,55,59`.
- The session's own main model is owned by omp and untouched by lets-craft (`src/preset/spike.ts:55-60`).

The request asks to add "세션 default 모델 설정" to this preset system. What that means precisely — and whether the host permits it — was the subject of this trace.

## 2. Ranked Hypotheses (post-rebuttal)

| Rank | Hypothesis (interpretation × mechanism) | Confidence |
|---|---|---|
| H1 | **(a′) Preset carries a session-default model field that live-sets the omp session's main model** at preset activation and at fresh-session `session_start`, via `ctx.models.resolve(spec)` → `pi.setModel(model)` → `pi.setThinkingLevel(effort)`. Because subagent resolution prefers the parent's LIVE model over `modelRoles.default`, unspecified lsc agents automatically inherit the preset default — H1 subsumes H2's observable effect on agents. | MEDIUM-HIGH (mechanics verified; user intent unconfirmed) |
| H2 | **(b) Fallback-only default**: the preset default applies ONLY to lsc agents lacking an explicit per-agent entry (materialized by expanding `task.agentModelOverrides` for the missing agents); the omp session's main model is never touched. | MEDIUM |
| H3 | **(c) Layered**: H1 + explicitly pinning unlisted agents to the preset default (so a user's manual mid-session `/model` switch does NOT drag unspecified agents with it). Superset; only needed if agent-pinning semantics are desired. | LOW-MEDIUM |

## 3. Evidence Summary by Hypothesis

### H1 — session main model, live
- **Host API exists and is pinned-verified**: `pi.setModel(model: Model): Promise<boolean>` on ExtensionAPI, false on missing API key (node_modules `types.d.ts:742`; impl `loader.ts:243` → `runExtensionSetModel` `compact-handler.ts:25-40`) [lane 2, Tier 2; re-verified in 16.4.0 src by W2].
- **Callable at session_start, effective for turn 1**: `session_start` is emitted after the extension action set is bound, as the last startup step at all 4 init sites; nothing re-stamps the model afterwards on fresh boot (`runtime-init.ts:53→141`; `interactive-mode.ts:968+`; `sdk.ts:1287,2799`) [Tier 2 source; execution unobserved — see §8].
- **String→Model bridge**: `ctx.models.resolve(spec)` accepts `provider/model[:effort]`, auth-filtered, effort parsed-then-dropped → caller splits effort (lets-craft already has `splitEffort`, `validate.ts:33-39`) and calls `pi.setThinkingLevel` [W2, Tier 2].
- **Subsumption**: pinned resolver chain `settingsOverride → frontmatter → parent LIVE model → fallback → modelRoles.default` (`model-resolver.ts:1006-1028`) means switching the session model retargets every unspecified agent automatically [W3, Tier 2].
- **Ecosystem norm**: upstream `preset.ts` (vendored), pi-amplike, Codex profiles, Claude Code org-default — a preset's "default model" sets the main loop; apply-at-runtime + own-file persistence; never mutate host settings persistently [research N2, N3, N6].
- **Host's own design** for the rejected native preset (#2515) applied the preset's `default` role via the same `setModel` primitive [W2HostPrs].
- **Literal phrase reading**: "세션 default 모델" names the session's model [Tier 5].

### H2 — fallback-only
- All 6 repo artifacts that mention "session model" frame it as the fallback for unspecified/invalid agents (`_docs/spec.md:49`; `README.md:130-139`; `command.ts:21`; `validate.ts:24,55,59`) — the only place "session model" appears as a configurable concept [lane 3, Tier 2 ×6, convergent].
- The flat `Record<string,string>` preset map is structurally hospitable to one more entry; no agent-name whitelist exists (`models-file.ts:52-55,73-79`) [lane 1/3, Tier 2].
- Repo e2e treats main-session model and lsc-subagent models as distinct concepts, main set via `--model` flag (`test/e2e-helpers.ts:11-18,212-213`) [lane 3, Tier 2].

### H3 — layered
- Fits the open-ended phrasing; subsumes H2's documentary evidence; adds agent-pinning semantics no artifact demands today [lane 3, MODERATE].

## 4. Evidence Against / Missing Evidence

**Against H1:**
- Zero lets-craft artifact contemplates switching the orchestrator's model; spike.ts:55-60 explicitly scopes the main model out as omp-owned [lane 3].
- `pi.setModel` drops the effort suffix (Model object only) — a `provider/model:high` default needs the separate `setThinkingLevel` call; forgetting it is the host's own live bug class (#5290/#5297) [W2, W2ReleaseScan].
- Re-apply hazard: `pi.setModel` appends `model_change role="default"` to the transcript, which resume REPLAYS (`session-context.ts:222-228`); there is NO resume flag (`SessionStartEvent` is empty) — blind session_start re-apply on a resumed session clobbers the user's restored `/model` choice. Only discriminator: `ctx.sessionManager.getEntries().length` [W2, W3 — the load-bearing design risk].
- No model-change event exists for extensions (`types.ts:842-877` exhaustive) — dirty-state/override detection must poll `ctx.model` [W2].

**Against H2:**
- Terminologically weak: calling a preset-internal fallback "세션 default 모델" is imprecise [lane 3].
- Mechanically redundant where H1 is active: parent-live inheritance already retargets unspecified agents; H2-pure duplicates that with 7 explicit override entries.
- A reserved `default` key in the flat map is today mis-routed into phantom agent `lsc-default` by `validatePreset` (`validate.ts:52-62` + `toTaskAgentName`) — silent collision unless special-cased [lane 1, Tier 1 reproduction].
- No TODO/FIXME/roadmap note foreshadows either reading (grep clean) [lane 3].

**Missing evidence (all hypotheses):**
- User intent — the phrase is genuinely ambiguous in Korean between H1/H2; repo artifacts lean H2's *vocabulary* while mechanics and ecosystem lean H1's *behavior*. → Interview question 1.
- Execution observation of setModel-at-session_start (source-confirmed only) [§8/§9].
- Schema-shape preference under old-version compatibility weight (see lane 1 report: structural change THROWS in old readers of the shared global `~/.omp/.lsc/models.yaml`; reserved key is read-compatible but needs guards) [lane 1, Tier 1].

## 5. Rebuttal Round

**Challenger (lane 2, backing H1) vs leader (lane 3's provisional H2):**
1. *Mechanical subsumption*: the pinned resolver prefers the parent's live model over `modelRoles.default` for every agent without an explicit override — so H1 delivers H2's observable improvement for free, while H2-pure cannot deliver the literal meaning of "세션 default 모델" at all. Evidence: `model-resolver.ts:1006-1028` [Tier 2].
2. *Host + ecosystem convergence*: the host's own #2515 design and every surveyed preset implementation (preset.ts, pi-amplike, Codex, Claude Code) treat a preset's default as the main-loop model. Evidence: W2HostPrs diffs; research N2/N3 [Tier 2/3].

**Leader's response:** the repo's six "session model" artifacts are unanimous — but they describe the *current* fallback target, written before this feature existed; they document what "session model" means today, not what the new field must do. The response cannot refute the subsumption argument; it establishes vocabulary, not intent.

**Outcome:** materially weakens H2-as-leading → re-ranked to #2. H1 promoted to leading with the explicit caveat that final semantics are user-intent-gated. H2 and H3 are retained as distinct hypotheses (not merged into H1) because they imply **different discriminating probes**: H2 probes `agentModelOverrides` expansion; H1 probes `pi.setModel` at session_start; H3 additionally probes pinning-vs-inheritance under mid-session manual switches.

## 6. Convergence / Separation Notes

- **Converged (same underlying mechanism):** interpretation (a) and the "(c) minus agent-pinning" variant reduce to the identical implementation (resolve → setModel → setThinkingLevel at activation + gated session_start re-apply) — merged into H1.
- **Genuinely separate:** H2 (no main-session switch) and H3 (explicit agent-pinning) remain separate — different code paths, different user-visible behavior under a mid-session `/model` switch.
- **Independent evidence streams agreeing:** lane 2's API findings (from pinned types + vendored source) and the external research (upstream docs, host PR reviews, ecosystem implementations) were gathered independently and point at the same mechanism and the same design law — this is real convergence, not shared phrasing.
- All three lanes independently converge on the **same integration seam**: `models-file.ts` schema + `command.ts` flows + `validate.ts` + `inject.ts applyActivePreset` + `main.ts session_start`, with tests via the existing `FakeStore`/resolve-closure seams (`test/preset-injection-spike.test.ts:32-58`).

## 7. Most Likely Explanation

The feature most plausibly means **H1**: each preset gains an optional **session-default model** which, while that preset is active, sets the omp session's main model — applied at explicit activation (`/lsc-preset` switch/create) and re-applied at `session_start` **gated to fresh sessions** (or gated by comparing the current model), never on resume paths. Unspecified lsc agents then inherit it automatically through the host's parent-live resolution chain, which modernizes the documented fallback ("preset 미지정 agent는 세션 모델로 fallback") into "…falls back to the preset's session default, else the session model." H2 survives as the fallback-only alternative if the user does not want the orchestrator's own model touched. This verdict is **provisional on interview confirmation** (Override 1 consumes this paragraph).

## 8. Critical Unknown

**Per-lane critical unknowns** (Stage 2 lifts these into its first questions):

1. **[Lane 3 / premise — user intent]** Which semantics does the user actually want: (a) preset sets the session's main model (H1), (b) fallback-only for unspecified lsc agents (H2), or (c) both with explicit agent-pinning (H3)? This single fact reorders the ranking above.
2. **[Lane 2 / host — precedence & re-apply policy]** When should the preset default yield to the user's own explicit `/model` choice? Concretely: on a *resumed* session the transcript replay restores the user's last choice and no resume flag exists (`SessionStartEvent` empty; entries-count is the only heuristic) — what is the desired behavior on resume, on `/new` (no session_start fires), and mid-session after a manual switch (no event; polling only)?
3. **[Lane 1 / code-path — schema representation]** Sibling/structural field (industry end-state; but a structural per-preset value **throws** in every old lets-craft reading the shared global models.yaml, and a new top-level field is **dropped** by old writers) vs reserved `default` key inside the flat preset map (read-compatible with old versions; requires guards in `validate.ts`/`command.ts`/`summarize` to avoid the phantom `lsc-default` collision, Tier-1-verified). How much old-version compatibility weight applies to `~/.omp/.lsc/models.yaml`?

## 9. Recommended Discriminating Probe

1. **Zero-cost, first:** the interview's opening question (semantics (a)/(b)/(c)) — collapses H1/H2/H3 ordering immediately. (Stage 2, Override 3.)
2. **One isolated omp run (defer to plan/craft verification — spends real credits):** 15-line probe extension that, at `session_start`, does `ctx.models.resolve(spec)` → `pi.setModel(model)` → notify; run `omp -p --mode=json` under an isolated `--profile` and inspect the FIRST assistant turn's model in the parent stdout (subagent calls land in `<session-dir>/<agentId>.jsonl` — spike finding 7). One run discriminates: (i) does the switch take effect for turn 1 (H1 mechanically green-lit); (ii) missing-API-key → silent `false` path; (iii) `:effort` suffix behavior end-to-end. Reuses `scripts/spike-e2e-verify.sh` inspection procedure.
3. **Cheap unit probe (plan stage):** `validatePreset({default: "zai/glm-5.2:high", explore: "..."}, () => true)` — asserts the phantom `lsc-default` mis-routing exists, pinning the guard requirement for any reserved-key schema.

## 10. Additional Trace Lanes

None required. Residual uncertainty is (1) user intent — owned by Stage 2, and (2) one execution probe — specified above, deliberately deferred past pre-craft's read-only boundary (verification-economics.md records the rationale). All other leads converged or were reclassified (see `research/waves/wave-3.md`).

---

# Lane Sub-Reports

## Lane 1 — Code-path / implementation integration (TracerCodePath)

- **Hypothesis:** a session-default setting integrates into the existing preset lifecycle; the risk is in the code path (parse/merge/save round-trip, command flows, validation, injection).
- **Lifecycle walk (verified end-to-end):** `models-file.ts` (parse :58-82 / merge :95-101 / save :109-112) → `inject.ts` (applyActivePreset :24-42) → `validate.ts` (validatePreset :49-65) → `command.ts` (summarize :31-43 / buildPreset :59-77 / runSwitch :94 / runCreate :116 / runEdit :135 / runDelete :157 / register :177) → `main.ts` (session_start :27-39).
- **Tier-1 reproductions:** (1) unknown top-level key **dropped** by parseModelsFile (:81); (2) reserved `default` key inside a preset accepted verbatim as a phantom agent (isPresetModels :52-55 checks string values only); (3) structural preset value `{default, agents}` **throws** (:75-77); (4) mergeModelsFiles returns only `{active, presets}` (:100) — new top-level fields lost on merge; (5) saveModelsFileAt stringifies transparently (:111) — in-memory extras round-trip.
- **Evidence against / additive parts:** save transparent; session_start hook delegates cleanly; reserved-key design needs zero parse/schema edit; no existing test asserts an exact top-level keyset.
- **Test-break analysis:** reserved-key design — nothing auto-breaks, but silent `lsc-default` regression needs a guard + new tests. Top-level additive field (`default: string|null` beside `active`) — breaks 4 `toEqual` literals in `test/preset-models.test.ts` (L27, L31, L87, L93). Structural per-preset `{default, agents}` — most destructive: parse tests :23-28, rejection semantics :42-44 invert, round-trip :79-94, ALL of preset-validate.test.ts :22-60, command.ts rebuilt.
- **Evidence strength:** Tier 1 (controlled reproduction) + Tier 2 (source). **Critical unknown:** representation choice, gated by lane 2's host setter (resolved: exists) and user compat weight. **Probe:** validatePreset phantom-agent unit probe (§9.3). **Confidence:** High on non-additivity map; medium on reserved-key regression severity; injection step provisional on lane 2 (now resolved).

## Lane 2 — Config / environment / host orchestration (TracerHostApi)

- **Hypothesis (verbatim):** an omp 16.4.0 extension CAN set the host session's own main model live mid-session, but ONLY through `pi.setModel(model: Model)` — not through a settings key.
- **Sub-hypotheses:** H1 pi.setModel (Medium-High, Tier 2) — API exists (`types.ts:1151-1152`), impl (`loader.ts:243-245`), bound before session_start emit (`runtime-init.ts:90,141`), live + session-logged + not settings-persisted (`agent-session.ts:8927-8961`). H2 settings `modelRoles.default` (Low — DISCONFIRMED as live mechanism: only subscriber rebuilds advisors, `agent-session.ts:2308-2311`; startup-only). H3 scalar `model` settings key (Very Low — absent).
- **Key asymmetries found:** setModel takes a Model object (string must be resolved first via `ctx.models.resolve`, `model-api.ts:32`); setModel drops the effort suffix (separate `pi.setThinkingLevel`, `types.ts:1158`); agent-override path carries `:effort` inside the string to spawn (`task/index.ts:1139-1144`).
- **Rebuttal within lane:** "why a second object-based API when settings override works for agents?" — because the two govern different things; no code path promotes a modelRoles change into a live switch. H2 down-ranked to the startup-default mechanism.
- **Evidence strength:** Tier 2 dominant (pinned declarations + impl); one Tier-4 ordering inference (setModel safe at session_start before turn 1) — later source-confirmed at all 4 init sites by W2, execution still unobserved.
- **Critical unknown:** setModel-at-session_start as a safe cutover for turn 1 (execution). **Probe:** §9.2. **Confidence:** Medium-High.
- **Wave-2/3 refinements folded in:** `role="default"` transcript entry replays on resume (C15); AgentSession.setModel throws on no-auth, extension layer synthesizes `false` via async `getApiKey`; no model-change event for extensions (C13); no resume flag (C17); settingsOverride exclusivity (C19).

## Lane 3 — Measurement / artifact / assumption-mismatch (TracerPremise)

- **Hypothesis:** the feature statement may rest on a mismatched premise; audit competing interpretations against the repo's own artifacts.
- **Interpretation (a)** — session main model: evidence for = literal phrase (Tier 5); against = zero artifact support, spike.ts:55-60 scopes main model out, e2e treats main vs subagent models as distinct (`e2e-helpers.ts:11-18`). Strength: WEAK from artifacts alone (cross-lane gated → lane 2 resolved the gate: mechanically possible).
- **Interpretation (b)** — fallback default: 6 convergent Tier-2 artifacts (spec.md:49; README:130,132-139; command.ts:21; validate.ts:24,55,59); schema hospitable (models-file.ts:52-55,73-79). Strength: STRONG documentary.
- **Interpretation (c)** — layered: fits phrase; superset; main-model half unsupported by artifacts. MODERATE.
- **Assumption-mismatch audit:** spike findings NOT stale (spike.ts:3 stamps 16.4.0 = pinned; `enforcement-rules.test.ts:188`). Feature would silently invalidate: spec.md:49, README:130/132-139, validate.ts:24/55/59 warning strings, and SKIP_LABEL `command.ts:21` — the single most fragile artifact (its parenthetical meaning changes under (b)/(c)).
- **Reserved-key collision:** `default:` inside a preset mis-routes to phantom `lsc-default` via `toTaskAgentName` on every key (`validate.ts:52-62`; `models-file.ts:40-41`).
- **Critical unknown:** does the host expose a settable main-model surface (lane 2's domain — RESOLVED: yes, pi.setModel). Post-resolution, the residual unknown is pure user intent. **Confidence:** (a) LOW-from-artifacts / (b) HIGH-from-artifacts / (c) MEDIUM — re-ranked at synthesis by the rebuttal round (§5).

---

# External Research Summary

Full journal: `research/` — synthesis with per-claim citations: **`research/SYNTHESIS.md`** (15 workers, 3 waves, converged; claim status in `research/claim-graph.md`).

Conclusions in brief:
1. **`pi.setModel` is the only live session-model switch for extensions** (pinned 16.4.0-verified); `ctx.models.resolve` bridges strings (auth-filtered, effort-dropped → pair with `setThinkingLevel`). It is settings-invisible but **transcript-durable**: resume replays the preset model — and would also replay a user's later `/model` choice, so re-apply must be gated (no resume flag exists; entries-count heuristic only).
2. **The host declined native model presets** (#2392 NOT_PLANNED) — extension-land owns the niche; its PR review history encodes a design law: session-scoped overlay, never rewrite persisted `modelRoles`, persist at most an id, explicit config beats preset, resume paths silent, explicit-fails-loud/auto-fails-soft, defaults opt-in, prompt-cache economics for mid-session switches.
3. **Ecosystem norm** (upstream preset.ts, pi-amplike, pi-subagents, Codex/Claude Code/opencode/goose/aider): fallback chain `role entry → preset default → session model`; default as explicit sibling field, never a reserved name inside the role map; apply-at-runtime, own-file persistence; snapshot-at-boundary/restore-all-axes for clear semantics; ambient global pointers are a proven contamination vector.
4. **Schema evolution precedent + Tier-1 local reproductions** bound the design space: structural per-preset change breaks old readers of the shared global models.yaml; a reserved key is read-compatible but needs phantom-agent guards; warn-and-ignore/warn-and-drop is the standard posture (already lets-craft's).
5. **No drift risk 16.4.1–16.4.8** on the depended-upon surfaces; model IDs themselves can vanish in host PATCH releases → apply-time resolution failures must stay soft.
