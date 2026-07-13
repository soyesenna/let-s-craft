# Claim Graph — model-preset-session-default (orchestrator-owned)

Status vocabulary: UNVERIFIED / CONFIRMED / REFUTED / PARTIAL (code claims) · verified-set entry for non-code claims requires ≥2 independent source domains, ≥2 observation groups, ≥1 countersearch pass, primary-source backing, time-relevance.

## Code claims (settled by reading pinned/vendored source or by reproduction)

| # | Claim | Status | Evidence |
|---|---|---|---|
| C1 | `pi.setModel(model: Model): Promise<boolean>` exists on ExtensionAPI in pinned 16.4.0; false on missing API key; no role/persist/thinking params | CONFIRMED (pinned types) | node_modules types.d.ts:742 (ResExploreApi); types.ts:1151-1152 impl loader.ts:243-245 (TracerHostApi); upstream docs + omp docs listing (LibOmpDocs) |
| C2 | `ctx.models.resolve(spec)` bridges string→Model for setModel; ctx.models is read-only | CONFIRMED (pinned types + docs) | types.d.ts:218-229 (LibNpmPkg tarball read); model-api.ts:30-36 (TracerHostApi); omp://extensions.md (LibOmpDocs). Sub-question W2: undefined on unauth? effort suffix accepted? |
| C3 | `settings.override()` is in-memory only (never persisted); `set()` persists to global config.yml | CONFIRMED | pinned settings.d.ts docblocks (ResExploreApi); vendored settings.ts:403-409 (ResExploreVendored); spike.ts:34 empirical |
| C4 | Writing `modelRoles.default` (override or set) does NOT switch the live session model; startup-only + subagent last-resort fallback | CONFIRMED (16.3.15) → W2 re-verify in 16.4.0 | agent-session.ts:2282,2308-2311 advisor-only listener; sdk.ts:1318 startup resolve (ResExploreVendored, TracerHostApi) |
| C5 | Subagent model resolution prefers parent's LIVE model over modelRoles.default: settingsOverride → frontmatter → parent live → fallback → modelRoles.default | CONFIRMED (16.3.15) → W2 re-verify | model-resolver.ts:1004-1021 (ResExploreVendored) |
| C6 | `task.agentModelOverrides` re-read fresh at each spawn — mid-session override visible to next spawn | CONFIRMED | task/index.ts:1139-1149 (both explorers); spike.ts AC2d-live empirical |
| C7 | session_start emitted AFTER extension action binding, as last step of initializeExtensions → setModel callable at session_start | CONFIRMED (16.3.15 source) / UNVERIFIED (execution) → W2 + probe | runtime-init.ts:90,141 (TracerHostApi). Whether a later startup step re-stamps model: UNOBSERVED — lane-2 critical unknown |
| C8 | pi.setModel drops effort suffix (takes Model only); pi.setThinkingLevel is the separate channel | CONFIRMED (pinned types) | types.d.ts:742-746 (ResExploreApi); compact-handler.ts:35-38 no-options call (TracerHostApi) |
| C9 | parseModelsFile drops unknown top-level keys; reserved key inside preset accepted as phantom agent; structural preset value throws; merge drops non-{active,presets} fields; save round-trips in-memory extras | CONFIRMED (Tier-1 reproduction) | TracerCodePath reproductions 1-5 vs models-file.ts:52-112 |
| C10 | validatePreset would map a `default` key inside a preset to phantom taskAgent `lsc-default` (silent collision) unless special-cased | CONFIRMED (code-path) | validate.ts:52-62 + toTaskAgentName models-file.ts:40-41 (TracerCodePath probe, TracerPremise) |
| C11 | spike.ts findings are FRESH vs pinned host (16.4.0 stamped in file; pinned dep matches) | CONFIRMED | spike.ts:3, package.json:19, enforcement-rules.test.ts:188 (TracerPremise) |
| C12 | AgentSession.setModel(model, role='default', options) persists ONLY with options.persist; extension path passes none → ephemeral + session-log appendModelChange | CONFIRMED (16.3.15) → W2 re-verify in 16.4.0 src | agent-session.ts:8927-8961 (TracerHostApi); selector-controller.ts:631-635 persist:true for /model (LibBrowse) |

## Non-code claims (verified set)

| # | Claim | Status | Sourcing |
|---|---|---|---|
| N1 | The omp host has no native model-preset feature and declined to build one — extension-land owns the niche | VERIFIED | Domains: omp:// docs ("preset"=statusline/theme only; LibOmpDocs countersearch) + GitHub issue #2392 NOT_PLANNED (LibBrowse) + npm/docs sweep (LibNpmPkg #5237 still open FR). ≥2 observation groups (docs sweep, tracker sweep), countersearch done, primary sources, current (2026-06/07) |
| N2 | Fallback chain "role entry → preset/profile default → session model" with silent fall-through is the industry-standard shape | VERIFIED | Domains: official docs of Codex/Claude Code/opencode/goose (LibPriorArt) + source dives Codex/opencode/goose/aider (LibRepoDive) + community extensions pi-subagents/pi-amplike (LibBrowse). Multiple independent groups; primary sources; 2026-current |
| N3 | Ecosystem norm for pi/omp extensions: apply model at runtime via pi.setModel, persist preset state in the extension's OWN file; never persistently mutate host settings | VERIFIED | preset.ts (upstream example), pi-amplike, pi-model-switch, pi-subagents (LibBrowse source-verified); upstream #4002/#3254 history shows persist-by-default was reverted; countersearch: no third-party artifact mutates modelRoles persistently (npm+issue sweep; grep.app rate-limited — residual, non-load-bearing) |
| N4 | A "default" bundled beside per-role entries lives as an explicit sibling field in prior art, not a reserved name inside the role map; but for THIS codebase a structural change breaks old readers of the shared global file | VERIFIED (both halves) | Half 1: LibPriorArt matrix + LibRepoDive schemas (Codex ConfigProfile.model, opencode model/agent siblings). Half 2: TracerCodePath Tier-1 reproductions (C9) + LibYamlSchema local mapping table |
| N5 | Warn-and-ignore unknown keys + warn-and-drop invalid values (with fallback) is the recommended posture for locally-installed tools sharing config across versions | VERIFIED | Compose spec normative text + K8s field-validation GA + Cargo manifest policy (LibYamlSchema, primary docs, multiple domains); matches existing lets-craft C13 validate.ts behavior |

## Open items feeding Wave 2 — RESOLVED by Wave 2 (all runtime claims re-grounded in pinned 16.4.0 src)
- W2-1 ✅ C4, C7, C12 confirmed in 16.4.0 (C5 chain confirmed; exclusivity nuance → W3-2). C12 refined: `role="default"` model_change entry REPLAYS on resume (session-context.ts:222-228) — pi.setModel is session-durable via transcript, settings-untouched. AgentSession.setModel returns {switched:boolean} and THROWS on no-auth; boolean-false synthesized by runExtensionSetModel (async getApiKey gate).
- W2-2 ✅ NOT FOUND confirmed: no model-change/model_select event in 16.4.0 ExtensionEvent union (types.ts:842-877). Reverse-sync requires polling ctx.model (before_agent_start).
- W2-3 ✅ resolve() auth-filtered (undefined for unauth + disabled providers); `:effort` suffix parsed then DROPPED by facade (model-api.ts:35) — caller must split effort and call setThinkingLevel separately.
- W2-4 ✅ preset.ts: find→setModel→setThinkingLevel order; snapshot-once defect; session_start restores name only, never model.
- W2-5 ✅ #3570: startup retries modelRoles.default post-extension-registration; #4705: applyRoleModel = setModel(role)+setThinkingLevel, record/persist/live 3 axes, cycle/fresh/restore modes; #2515: overlay-never-persist contract, persist preset ID only, pinned keys beat preset.
- W2-6 ✅ 16.4.1–16.4.8: zero drift on core paths. Cache-invalidation = maintainer's stated #1 concern for mid-session switches (#4520).

## New claims from Wave 2

| # | Claim | Status | Evidence |
|---|---|---|---|
| C13 | No model-change event reaches extensions in 16.4.0; polling ctx.model is the only override-detection | CONFIRMED (absence, exhaustive union read) | types.ts:842-877; runner.ts emitters (W2PresetTsSkew P5) |
| C14 | pi.setModel at session_start survives into turn 1 on fresh start — nothing re-stamps after the emit (source-confirmed, 4 init sites; execution still unobserved) | CONFIRMED (source) / UNVERIFIED (execution) | runtime-init.ts:53→141; interactive-mode.ts:968+; sdk.ts:1287,2799 (W2PresetTsSkew P4) |
| C15 | A preset-applied model persists across RESUME of that session via transcript replay; a blind session_start re-apply on resume would clobber a user's later in-session /model choice | CONFIRMED (source) | agent-session.ts:8947; session-context.ts:222-228; sdk.ts:1300-1303 |
| C16 | ctx.modelRegistry.find(provider,id) is auth-UNfiltered; ctx.models.resolve(spec) is auth-filtered | CONFIRMED | model-registry.ts:1986 vs 1924-1944 (W2PresetTsSkew P6) |

| # | Non-code claim | Status | Sourcing |
|---|---|---|---|
| N6 | Host design law for presets (from #2391/#2515/#4705 reviews): session-scoped overlay, never rewrite persisted modelRoles, persist at most an id, explicit config beats preset, restore paths silent, explicit-fails-loud/auto-fails-soft, defaults opt-in | VERIFIED | Review threads + diffs across 3 PRs, 2 reviewers, maintainer procedural closes (W2HostPrs); consistent with ecosystem norm N3 |
| N7 | Mid-session model switching carries a prompt-cache cost (warm ~10x-discounted reads → cold prefill); maintainer-flagged | VERIFIED | #4520 maintainer comment + author economics + #4689 gating design (W2ReleaseScan); applies to mid-session preset switch, not session_start apply |

## Open items feeding Wave 3 — RESOLVED by Wave 3 (research CONVERGED)
- W3-1 ✅ No resume signal exists: SessionStartEvent is empty (shared-events.ts:27-30); session_start fires per process boot + per subagent executor, NOT on /new/switch/branch. Only discriminator = ctx.sessionManager.getEntries().length (fragile; per-emit-site semantics = implementation probe).
- W3-2 ✅ settingsOverride EXCLUSIVE, immediate return, no fallthrough (model-resolver.ts:1006-1028, pinned). Chain: settingsOverride → frontmatter → parent LIVE model → fallback → modelRoles.default (final).
- W3-3 ✅ override() masks later set() until clearOverride; never persists (settings.ts:383-408, 1366-1372). setModelRole is override-aware.
- W3-4 ✅ Profiles = process-global directory isolation (pi-utils dirs; --profile/OMP_PROFILE at launch). NOT session-scoped, NOT mid-session switchable → cannot host preset persistence. Build stays on runtime override + pi.setModel.
- W3-5 ✅ #266: last-writer-wins global-pointer contamination; fix = pin in-memory session state, never re-consult ambient global post-boot. #4689 NOT merged; cache policy: auto reroute must not trade warm cacheRead for cold prefill; explicit config bypasses; session_start apply cache-safe. #3273/#3272: snapshot only at no-preset→preset boundary; restore every mutated axis; in-memory snapshot dies on restart (upstream residual gap); clear-restores-pre-preset-state semantics is a surfaced design choice.

## New claims from Wave 3

| # | Claim | Status | Evidence |
|---|---|---|---|
| C17 | An extension cannot directly detect resume at session_start; entries-count inference is the only surface | CONFIRMED | shared-events.ts:27-30; session-manager.ts:318-343, 962-997 (W3SessionResume Q1) |
| C18 | session_start does not re-fire on /new, session switch, or branch (dedicated events exist; /new has none) | CONFIRMED | extension-ui-controller.ts:176-230 vs 254-257; sdk.ts:954-957 (W3SessionResume Q1) |
| C19 | task.agentModelOverrides beats agent frontmatter EXCLUSIVELY in the pinned host; modelRoles.default is the terminal fallback below the parent's live model | CONFIRMED | model-resolver.ts:1006-1028 (W3SessionResume Q2) |
| C20 | omp profiles are launch-time directory isolation, unusable as session-scoped preset persistence | CONFIRMED | pi-utils dirs.d.ts; cli.ts:257-269; profile-bootstrap.ts:113-129; settings.ts zero 'profile' matches (W3SessionResume Q4) |

| # | Non-code claim | Status | Sourcing |
|---|---|---|---|
| N8 | A globally-writable "active" pointer consumed at session boot is a proven cross-session contamination vector; the proven fix is deriving from session-local state after boot and writing the global only on explicit user action | VERIFIED | pi-subagents #266 + PR #283/#293 + CHANGELOG 0.29.0 + upstream #3254 refusal (W3Contamination; multiple domains, primary sources, current) |
| N9 | Restore-on-clear must snapshot at the inactive→active boundary and restore every mutated axis; in-memory snapshots do not survive restart | VERIFIED | upstream #3273 + merged PR #3272 diff (W3Contamination; primary source + repro) |

## CONVERGENCE: declared after wave 3 — see waves/wave-3.md. Zero unconfirmed load-bearing leads; residual tails reclassified as spec/plan design decisions, implementation probes, or watch items.
