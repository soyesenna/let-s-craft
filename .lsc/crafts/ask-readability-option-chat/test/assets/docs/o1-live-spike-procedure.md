# O1 — BYO-completion Live Spike Procedure (trace §9, tier-1 escalation)

> **What this is.** The manual, run-once *spike* that clears the single
> remaining unverified assumption behind this whole feature: that a **registered
> omp tool handler can actually authenticate and drive a side completion**
> (`modelRegistry.resolver` → `completeSimple`/`stream`) and then mount a
> `ctx.ui.custom<T>` component, stream a live answer into it, `done()`, and
> re-open the selector. Source of truth: `trace.md` §8 (Critical Unknown #1) +
> §9 (Recommended Discriminating Probe), `plan.md` §PR3 (BYO-completion 계약,
> `craft 초기 라이브 스파이크(trace §9, 티어1)`), `plan/appendix-palette-and-prompts.md`
> §2-§3, `local://ask-ui-wiring-contract-v2.md` §1/§4.
>
> **Why it is separate from the automated suites.** The Bun adapter suite
> (`test-bun/ask-ui-adapter.test.ts`, B1-B3) proves the adapter's *shape* against
> a **typed pi-ai fake** — model/systemPrompt/message/no-tools/resolver/signal/
> cache args and the terminal-state + usage mapping — with **zero network**. It
> can never prove that a *real* provider accepts the request, that OAuth/API-key
> rotation works under a registered tool handler, or that a 429 recovers. Trace
> classed BYO-completion at **tier 2** (types + official examples) for exactly
> that reason; O1 is the one live execution that escalates it to **tier 1**.
>
> **Who runs it, and when.** The craft operator, **once, at the very start of the
> craft stage — before PR3/PR4 build on BYO-completion**. It spends real provider
> tokens; **never wire it into `run_test.sh` or any unattended path** (same rule
> as O2). If O1 FAILS, stop and reconsider the BYO approach *before* writing the
> side-chat implementation — do not discover the assumption was wrong at PR4.

---

## 0. Preconditions

- The 17.0.5 lockstep bump has landed (AC2.1) and `npm run build` is clean, so
  `dist/main.js` and the `src/ask-ui/` leaves load under the real Bun-native omp
  runtime (`@oh-my-pi/pi-ai`, `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-coding-agent`
  value imports resolve).
- At least one **authenticated** session provider account (`omp models list`
  shows an authenticated model). The probe uses the session's *current* model —
  the same one the production side chat will use — so run it under the model you
  actually intend to ship against, not a synthetic one.
- An **interactive** omp session (`ctx.hasUI === true`) for probe ②: the
  `ctx.ui.custom<T>` mount and its `done()` → re-`select` round-trip cannot run in
  headless `-p`/RPC mode (that path deliberately never mounts the component).
- The probe vehicle is either (a) a throwaway ~20-30 line extension that
  registers a single test tool, or (b) the feature's own registered
  `lsc_select`/`lsc_ask` execute driven interactively. Either way the completion
  is issued from **inside a registered tool `execute`**, because that is the exact
  context trace §8 flagged as unverified — not from a top-level script.

## 1. Probe ① — resolver auth + `completeSimple` round-trip

Inside a registered tool's `execute(_id, _params, signal, _onUpdate, ctx)`:

1. Resolve the model the production side chat will use:
   `const model = ctx.models.current();` (or `ctx.models.resolve("<provider/id>")`
   for an explicit pin). Abort the probe if it is `undefined`.
2. Mint the side session identity exactly as the cache canon requires
   (`plan.md` §PR3, appendix §5): `sessionId = \`${ctx.sessionManager.getSessionId()}:side:${nonce}\``
   and `promptCacheKey = <main session id seed>`.
3. Build the api-key resolver the same way every host call site does
   (`api-key-resolver.ts:39`, `agent-session.ts:14612-14616` side-chat precedent):
   `const apiKey = ctx.modelRegistry.resolver(model, sessionId);`
4. Issue a **no-tools** completion with a **non-blank** system prompt (Codex 400
   guard, appendix §3):
   ```ts
   const reply = await completeSimple(
     model,
     { systemPrompt: ["You have NO tools. Answer the question directly."],
       messages: [{ role: "user", content: "Reply with the single word: pong", timestamp: Date.now() }] },
     { apiKey, signal, sessionId, promptCacheKey, cacheRetention: "short" },
   );
   ```
5. Read the returned `AssistantMessage`: its text content and
   `reply.stopReason` (expect a normal stop, not `"error"`/`"aborted"`), and its
   `reply.usage` (`input`/`output`/`cacheRead`/`cacheWrite` — the domain camelCase
   `Usage`, pi-catalog `types.ts`).

**Observe:** a non-empty assistant text was returned, `stopReason` is a normal
stop, no `MissingApiKeyError`/auth exception was thrown, and (if the account was
rate-limited) the host's built-in auth-retry rotated credentials and the call
still completed. Record the raw text, `stopReason`, and `usage`.

## 2. Probe ② — `stream()` text_delta → live custom render → done → re-select

Still inside the same interactive `execute`:

1. Call `const events = stream(model, { systemPrompt: [...], messages: [...] },
   { apiKey, signal, sessionId, promptCacheKey, cacheRetention: "short" });`
   (no `tools` field — no-tools).
2. Mount a `ctx.ui.custom<T>` component (a minimal one is fine for the spike) and
   **consume the event iterator live**: `for await (const ev of events) { if
   (ev.type === "text_delta") <append ev.delta to the panel and re-render>; }`
   then `await events.result()` for the final `AssistantMessage`.
3. When the answer is complete, call the factory's `done(result)` and confirm the
   custom mount resolves and control returns to the tool `execute` loop.
4. Immediately re-open a `ctx.ui.select(...)` (or re-mount the component) to prove
   the **done → re-select round-trip** works without the host tearing the tool
   down — the interaction the whole "explain, then keep answering" UX depends on.

**Observe:** deltas rendered incrementally (not one final dump), `done(result)`
returned the streamed answer to `execute`, and the subsequent `ctx.ui.select`
mounted and accepted input. Record whether streaming was incremental and whether
the re-select succeeded.

## 3. Pass / fail — **fail-closed** (critical)

- **PASS (O1 cleared, BYO escalated to tier 1)** iff **all** of:
  - Probe ① returned real assistant text with a normal `stopReason` and no auth
    error (rotation-recovered counts as pass).
  - Probe ② streamed deltas incrementally, `done()` returned the answer, and the
    re-`select` round-trip succeeded.
- **FAIL (O1 not cleared)** if **any** of the above did not happen, including:
  - `resolver`/auth threw, or a 429/limit did not recover.
  - `completeSimple`/`stream` returned `stopReason: "error"`/`"aborted"` for a
    request that should have succeeded.
  - the custom mount never rendered deltas, `done()` never returned, or the
    re-`select` after `done()` failed.

  This is fail-closed by design: **the typed-fake Bun adapter tests (B1-B3)
  passing is NOT a substitute for this evidence** — they mock the network. A
  "types compile / examples exist" argument is **not** a pass; only a real
  round-trip is. If O1 FAILS, **do not proceed to PR3/PR4 on the BYO assumption**
  — diagnose auth/model resolution or reconsider the approach, then re-run.

## 4. Recording the evidence

Record the spike outcome in the **craft log** (tier-1 escalation evidence, per
`plan.md` §PR3 / trace §9) using this template. This procedure doc stays fixed;
the actuals live in the craft log (and, if the operator prefers a durable file,
a new `.lsc/crafts/ask-readability-option-chat/plan/appendix-o1-spike.md`).

```
O1 BYO-completion live spike
- date (ISO-8601):
- provider/model (provider/id):
- vehicle: [throwaway extension | registered lsc_* execute]
- probe ① resolver+completeSimple:
    - auth: [ok | rotated-then-ok | FAILED: <error>]
    - reply text (verbatim, first line):
    - stopReason:
    - usage (input/output/cacheRead/cacheWrite):
- probe ② stream+custom+done+re-select:
    - streaming incremental: [yes | no]
    - done() returned answer: [yes | no]
    - re-select after done(): [ok | FAILED: <what>]
- VERDICT (fail-closed §3): [PASS | FAIL]
- if FAIL: observed failure + decision (diagnose / reconsider BYO):
```

If FAIL, record the FAIL verdict and the observed failure — do **not** mark the
trace §8 Critical Unknown resolved or the BYO tier escalated.
