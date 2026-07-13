# Wave 1 — Saturation wave (live mode)

Spawned 2026-07-13. 9 research workers (+3 trace lanes running concurrently, tracked in trace.md, not here). All 9 reported.

## Roster

| Worker | Role | Axis | Report |
|---|---|---|---|
| ResExploreApi | codebase-facing (lsc-explore) | node_modules/@oh-my-pi/pi-coding-agent@16.4.0 model/settings API surface | agent://ResExploreApi |
| ResExploreVendored | codebase-facing (lsc-explore) | vendored oh-my-pi/, pi/ session-model read/write lifecycle | agent://ResExploreVendored |
| ResExploreTests | codebase-facing (lsc-explore) | repo test-harness conventions around presets | agent://ResExploreTests |
| LibNpmPkg | web librarian | public footprint of @oh-my-pi/pi-coding-agent (npm/GitHub/docs) | agent://LibNpmPkg |
| LibPriorArt | web librarian | preset/profile design prior art across coding-agent tools | agent://LibPriorArt |
| LibOmpDocs | general web worker | omp:// harness docs on extensions/settings/model config | agent://LibOmpDocs |
| LibYamlSchema | web librarian | YAML config schema additive-evolution practice | agent://LibYamlSchema |
| LibBrowse | browsing | pi/omp ecosystem artifacts referencing extension API | agent://LibBrowse |
| LibRepoDive | repo-dive | external repos' preset/profile implementations at source level | agent://LibRepoDive |

## EXPAND tail entries (deduplicated, ranked)

### Adopted into Wave 2
1. **preset.ts deep read** (LibOmpDocs, LibBrowse): vendored `pi/packages/coding-agent/examples/extensions/preset.ts` = upstream's own "saveable presets (model, tools, thinking)" extension — snapshot/restore, /preset command. → W2PresetTsSkew.
2. **16.3.15→16.4.0 skew closure** (ResExploreVendored, TracerHostApi): runtime internals (agent-session.ts setModel body, runtime-init ordering, compact-handler) cited from vendored 16.3.15; node_modules ships 16.4.0 src/ → verify directly. → W2PresetTsSkew.
3. **model_select event existence in omp 16.4.0** (LibOmpDocs): upstream documents it, omp docs omit it; decides whether reverse-sync (observe user /model) is possible. → W2PresetTsSkew.
4. **pi-amplike modes.ts full read** (LibBrowse): reverse-sync to `custom` pseudo-mode, dirty-state, file locking. → W2Amplike.
5. **pi-subagents defaultModel precedence implementation** (LibBrowse). → W2Amplike.
6. **omp PR #3570 / #4705 diffs** (LibNpmPkg, LibBrowse): host's own "apply configured model on activation" + fresh-launch precedence for extension models. → W2HostPrs.
7. **Rejected native /preset PRs #2498/#2500 + issue #2392 roboomp checklist** (LibBrowse). → W2HostPrs.
8. **Release bodies 16.4.1–16.4.8 + Discussions sweep** (LibNpmPkg). → W2ReleaseScan.

### Deferred to plan/spec stage (design decisions, not research)
- GitLab `inherit:default` analog: sentinel for "this agent must NOT use preset default" (LibYamlSchema).
- yaml Document API comment preservation on save (LibYamlSchema) — implementation detail.
- Roo-style anti-drift for in-flight craft loops (LibPriorArt) — spec question re: applyActivePreset scope.
- Codex profile-layer rationale deep-dive (LibPriorArt) — design context already sufficient.
- JSON Schema for models.yaml editor validation (LibYamlSchema) — optional follow-up.

### Dropped (marginal / satisfied elsewhere)
- examples/sdk/02-custom-model.ts (LibNpmPkg) — SDK session-construction path, not the extension path this feature uses.
- grep.app retry for task.agentModelOverrides negative finding (LibBrowse) — npm-registry + issue-search grounding suffices; the claim is not load-bearing.
- `/model` write-target hunt (LibOmpDocs) — answered by LibBrowse: selector-controller.ts:631-635 `session.setModel(model, 'default', {persist:true})`.
- opencode SessionTable.model migration archaeology (LibRepoDive) — pattern captured; commit archaeology adds nothing decision-relevant.
- Codex app-server profile RPC (LibRepoDive) — different embedding model, not applicable to in-process extensions.
- goose GOOSE_LEAD_MODEL removal commit (LibRepoDive) — cautionary tale captured.
- awesome-pi.site dataset (LibBrowse) — census breadth not needed for this feature.
- pi-orchestrate hunt (LibBrowse) — speculative artifact.
