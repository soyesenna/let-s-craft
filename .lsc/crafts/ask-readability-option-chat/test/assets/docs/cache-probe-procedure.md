# O2 — Side-chat Prompt Cache Live Probe Procedure (AC6.2)

> **What this is.** The manual, run-once *procedure* for the AC6.2 live cache
> measurement. It is **not** a standing automated test — AC6.1's unit test (U3,
> `test/…` vitest) already fixes the *request shape* (stable `promptCacheKey`,
> unique side `sessionId`, prefix-invariant messages, `cacheRetention` marker,
> `getBranch` call count = 1). AC6.2 is a **single live evidence capture** run
> during the craft stage, on a real authenticated provider, that the request
> shape actually produces a cache hit. Source of truth: `spec.md` AC6.2,
> `plan.md` §PR3 (캐시 수명 정본) / §PR5, `plan/appendix-palette-and-prompts.md` §5,
> `plan/appendix-test-plan.md` O2 row.
>
> **Who runs it.** The craft (or post-craft) operator, once, after PR4's
> multi-turn side chat is wired. It spends real provider tokens — never wire it
> into `run_test.sh` or any unattended CI path.

---

## 0. Preconditions

- PR3 + PR4 landed in the worktree: the side-chat component drives a real
  `CompletionPort` backed by `src/ask-ui/completion.ts` (pi-ai `stream` /
  `completeSimple`), and a `SideChatSession` is created and frozen per the cache
  lifetime canon (see §2).
- A session model whose provider **exposes cache telemetry**. Anthropic is
  recommended (see §1). At least one authenticated account for that provider.
- An interactive omp session (`ctx.hasUI === true`) so the `custom<T>` mount and
  its `?`/`t` side-chat affordances are reachable — the probe cannot run in
  headless `-p`/RPC mode (fixture/headless never call the completion factory).

## 1. Provider choice

- **Anthropic (recommended).** `cacheRetention` maps to automatic
  `cache_control` markers (`applyPromptCaching`); provider `usage` exposes both
  `cache_creation_input_tokens` and `cache_read_input_tokens`. The
  `cache_read_input_tokens` signal is the clearest available.
- **OpenAI / Codex (fallback).** Observable through the `prompt_cache_key` path,
  but the read signal is less explicit. If the session model is not Anthropic,
  prefer switching to an Anthropic session model for this one measurement.

## 2. Cache construction under test (must already be wired — 캐시 수명 정본)

The probe only *observes*; the implementation must already guarantee all of the
following (plan §PR3 캐시 수명 정본, appendix §5, §3):

- The `SideChatSession` is created **exactly once**, at the first side
  interaction for the question, and **frozen**:
  `nonce` / `sessionId` / `promptCacheKey` / `model` / `systemPrompt` /
  canonicalized `getBranch()` snapshot.
- It is **reused across panel close/reopen, every turn, and every retry**, and
  disposed **only when the tool finishes**. `ctx.sessionManager.getBranch()`
  (session-manager.ts:1715-1717) is called **exactly once**.
- Cache configuration values (StreamOptions, ai/src/types.ts:372/413/419):
  - `promptCacheKey` = **main session id seed** (stable across turns).
  - `sessionId` = `` `{main}:side:{nonce}` `` (unique — prevents OpenAI/Codex
    main-session contamination).
  - `cacheRetention` marker passed on every side call.
  - The system-prompt prefix is **mode-invariant** (the one-button length hint
    lives only in the user prompt, never the system prefix), so the cacheable
    prefix stays byte-stable from turn 2 onward.

If any of these is not yet true, stop — the probe would measure a construction
bug, not a cache hit.

## 3. Observation point

Read provider `usage` from **either**:

- `StreamOptions.onResponse(ProviderResponseMetadata)` callback, or
- the completed `AssistantMessage.usage` of each side turn.

Capture, per turn:

- `cache_creation_input_tokens` (where the provider reports it), and
- `cache_read_input_tokens`.

**Expected shape:** turn 1 = cache *creation* (read ≈ 0, creation > 0 on
Anthropic); turn 2+ = cache *hit* → `cache_read_input_tokens > 0`.

## 4. Steps (craft, live)

1. Open a real interactive omp session on a project, with the recommended
   provider's session model active.
2. Reach any `lsc_ask` / `lsc_select` / `lsc_confirm` question that mounts the
   side-chat component.
3. **Turn 1 —** trigger the one-button detail (`?`) on the focused option (or the
   question header). This creates + freezes the `SideChatSession` and issues the
   first side call. Record turn-1 `usage`.
4. **Turn 2 —** in the *same* panel, send a follow-up free prompt (`t`). This
   reuses the frozen session and the identical cacheable prefix. Record turn-2
   `usage`.
5. Close the panel / answer the question normally (the session disposes).

## 5. Pass / fail — **fail-closed** (critical)

- **PASS (AC6.2 met)** iff turn-2 `cache_read_input_tokens > 0` is observed
  (and, on Anthropic, turn-1 `cache_creation_input_tokens > 0`).
- **FAIL (AC6.2 NOT met)** if telemetry is **absent** *or* the value is **0**.
  This is fail-closed by design:
  - Passing the AC6.1 structure test (U3) does **not** substitute for this
    evidence.
  - The mere fact that `prompt_cache_key` / `cacheRetention` was *passed* is
    **not** a pass.
  - Recording "provider does not support cache telemetry" is **not** a pass —
    switch to a provider that does (Anthropic) and re-run.

  A FAIL means the request-shape unit test can still be green while AC6.2 stays
  unmet; the correct response is to diagnose the prefix/session construction
  (§2), not to relax this criterion.

## 6. Recording the evidence

Write the captured actuals to **`.lsc/crafts/ask-readability-option-chat/plan/appendix-cache-probe.md`**
(a new file the craft stage creates — this procedure doc stays fixed; the results
file is where numbers land). Include:

- provider + model (`provider/id`),
- turn-1 `usage` (creation/read) and turn-2 `usage` (creation/read),
- the turn-2 `cache_read_input_tokens` count that satisfies §5,
- ISO-8601 timestamp of the capture,
- PASS/FAIL verdict per §5 (fail-closed).

If FAIL, record the FAIL verdict and the observed telemetry (or its absence) —
do **not** mark AC6.2 satisfied.
