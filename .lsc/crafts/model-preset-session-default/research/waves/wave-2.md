# Wave 2 — Expansion wave 1

4 workers, all reported. Reports: `agent://W2PresetTsSkew`, `agent://W2Amplike`, `agent://W2HostPrs`, `agent://W2ReleaseScan`.

## Key results

### W2PresetTsSkew (pinned 16.4.0 skew closure + preset.ts prior art)
- ALL wave-1 runtime claims CONFIRMED in pinned 16.4.0 src (setModel role/persist gate, appendModelChange, runtime-init ordering across 4 init sites, nothing re-stamps model post-session_start on fresh start).
- REFINEMENT: pi.setModel is NOT fully ephemeral — it appends `model_change role="default"` to the transcript, which session-context.ts:222-228 REPLAYS ON RESUME (`hasExplicitDefaultModel=true`). Durable per-session, settings untouched.
- NOT FOUND (confirmed absent): no model_change/model_select event in omp 16.4.0 ExtensionEvent union (types.ts:842-877). Extensions cannot observe /model switches — polling ctx.model (e.g. at before_agent_start) is the only substitute. (pi-amplike's model_select reverse-sync is UPSTREAM-pi-only.)
- ctx.models.resolve: auth-filtered (undefined for unauth/disabled-provider); accepts `:effort` suffix but DROPS the level (facade returns .model only) → lets-craft must parse effort itself (validate.ts splitEffort exists) + call pi.setThinkingLevel separately.
- runExtensionSetModel gate = async getApiKey (OAuth-refresh-capable); AgentSession.setModel throws on no-auth; extension layer synthesizes boolean.
- preset.ts prior-art defects to avoid: snapshot-once (manual /model mid-preset silently reverted on restore); session_start restores only the preset NAME, deliberately not the model.

### W2HostPrs (host revealed design preferences)
- #2391 blocking review + #2515 corrected design: preset = session-scoped OVERLAY, never rewrite persisted modelRoles; persist at most the preset id; `default` role applied via the same setModel primitive; pinned keys (explicit user config) beat preset.
- #4705 persona: applyRoleModel = setModel(model, role) + separate setThinkingLevel; record/persist/live = 3 independent axes; PersonaApplyMode cycle/fresh/restore — restore paths silent (no model change, no recording).
- #3570 (merged pre-16.4.0): fresh startup retries modelRoles.default against post-extension model set → extension-registered models honored at startup.
- Maintainer rejection of native presets: procedural closes, no design critique; extension-land owns the niche (re-confirmed).
- roboomp's 6 design questions (#2392) captured verbatim → review checklist for spec/plan.
- Revealed preferences: explicit fails loud / ambient fails soft; opt-in defaults ("no default-behavior changes without sign-off").

### W2Amplike (independent implementations)
- pi-amplike reverse-sync: event-driven via model_select (UPSTREAM ONLY — unavailable in omp) + before_agent_start safety net + `applying` guard; flip to `custom` pseudo-mode snapshots overlay in-memory; write-back strictly explicit ("use"/"store" prompt).
- pi-amplike session_start NEVER re-applies — re-labels from current model; cross-session apply exists only as explicit handoff payload.
- applyMode failure paths: unknown model / no key → warn, keep previous model, label flips to custom, file untouched; thinkingLevel applied even when model failed (dubious — avoid).
- File-locking recipe (lock file O_EXCL, 30s stale takeover, 5s budget, jittered backoff; same-dir tmp+rename; in-lock fresh re-read; mtime cache invalidation) — transplantable if concurrent-session safety is in scope.
- pi-subagents chain: per-run > [builtin: overrides > defaultModel] / [custom: frontmatter > overrides > defaultModel] > parent IN-MEMORY model (passed explicitly to avoid global-settings contamination, issue #266).

### W2ReleaseScan (drift + community steering)
- 16.4.1–16.4.8: NO changes to setModel/ctx.models/modelRoles schema/task.agentModelOverrides/init ordering. Adjacent: 16.4.5 task-tool wire schema breaking change; 16.4.6 retry.fallbackChains model-keyed entries.
- Maintainer's #1 stated concern on mid-session model switching: PROMPT-CACHE invalidation (#4520). Session_start apply (before turn 1) sidesteps it; mid-session preset switch should surface cache-cost awareness.
- #5249: pi/<custom-role> alias resolution broken ≤16.4.8 → store concrete provider/model:effort strings (lets-craft already does).
- #5290/#5297: pair setModel with explicit thinking-level resolution (host's own bug in the temporary-switch path).
- 16.4.1 removed provider-scoped model aliases in a PATCH → preset model IDs can vanish; resolve-failure must be soft (warn, keep current).

## EXPAND triage → Wave 3
- ADOPTED: fresh-vs-resumed detection at session_start (new question from synthesis — gates re-apply design) → W3SessionResume.
- ADOPTED: resolveAgentModelPatterns settingsOverride-exclusivity in pinned 16.4.0 → W3SessionResume.
- ADOPTED: Settings override-masking of later set() → W3SessionResume.
- ADOPTED: omp config profiles (docs/config-usage.md) build-vs-reuse → W3SessionResume.
- ADOPTED: pi-subagents #266 contamination details; PR #4689 merge state; upstream #3273 restore-loss details → W3Contamination.
- DEFERRED to spec/plan (design decisions, not research): resume-durability vs true ephemerality choice; schema {provider,model,effort} vs selector string; partial-application policy; fallback-chain co-write; per-preset opt-in.
- DROPPED: ctx.models.resolve('pi/…') probing (lets-craft stores concrete strings); #5017/#5018 list-valued modelRoles watch (not merged); 16.4.5 task wire schema (out of feature scope); getApiKey vs hasAuth divergence bounding (rely on returned boolean — sufficient).
