# Cause Disappearance — model-preset-session-default

Design premises / alternative explanations ruled out, and what killed them.

## R1. "Set the session default by writing a settings key (analogous to task.agentModelOverrides)" — RULED OUT as the live mechanism
- Hypothesis (lane 2 H2): `settings.override('modelRoles', {default: ...})` would live-switch the session, mirroring the proven agent-override pattern.
- Killed by: the only runtime subscriber of modelRoles changes rebuilds the advisor runtime only (vendored agent-session.ts:2282, 2308-2311); the live model is an instance property mutated solely by explicit setModel* calls (sdk.ts:1318 startup resolve; ResExploreVendored (2)). Down-ranked to "startup-default/persistence mechanism, not live switch".

## R2. "A scalar settings key `model` holds the live model" — RULED OUT
- Killed by: schema shows `model` only as a UI section/tab category; live model tracked as AgentSession instance state (TracerHostApi H3, Tier-5 absence + Tier-2 positive evidence for the instance-property design).

## R3. "The spike's findings may be stale vs the pinned host" — RULED OUT
- Killed by: spike.ts:3 stamps "verified against omp 16.4.0"; package.json pins 16.4.0; enforcement-rules.test.ts:188 targets the same build (TracerPremise assumption-mismatch audit).

## R4. "Interpretation (a)-only: the feature is ONLY about the omp session main model, nothing about agent fallback" — WEAKENED (not fully ruled out; interview to settle)
- Weakened by: every existing repo artifact that says "session model" says it in the per-agent fallback context (6 locations, TracerPremise); zero artifact support for a main-model-only reading. Kept alive by: literal Korean phrase reading + the host API existing (pi.setModel). Resolution owner: Stage 2 interview, question 1.

## R5. "An extension can intercept /model to keep preset state in sync" — RULED OUT
- Killed by: /model is hard-handled by InputController before session.prompt (omp://slash-command-internals.md §7, LibOmpDocs); extensions can only observe lazily via ctx.models.current() (and possibly a model_select event — W2 checks 16.4.0 source).

## R6. "Model presets might collide with a native omp feature soon" — RULED OUT (near-term)
- Killed by: issue #2392 closed NOT_PLANNED (2026-06-17); #1231 (role API) closed stale; #5237 still an unimplemented FR (LibBrowse, LibNpmPkg). Residual watch item only.
