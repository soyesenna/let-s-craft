# O1 (BYO-completion live spike) + E1 (loadMode boot smoke) — RESULTS

> Live evidence for audit-0 Required Fix RF3: the three live gates (O1, O2, E1) had never been
> executed. O2 is recorded in `appendix-cache-probe.md`; O1 and E1 are here. Source canon:
> `o1-live-spike-procedure.md` and the E1/E2 shadow test `test/ask-ui-e2e.test.ts`.
> **fail-closed**: unverified halves are recorded as NOT VERIFIED, never success-washed.

## Environment

- host: darwin 25.2.0 (Apple M4 Pro), 2026-07-21; bun 1.3.14, node 24.14.1
- omp: global **17.0.6** (`~/.bun/bin/omp`) AND the pinned **17.0.5** shipped by the plugin's own
  devDep (`{W}/node_modules/.bin/omp` → `@oh-my-pi/pi-coding-agent@17.0.5`). E1 was run on 17.0.5
  (the channel the smoke pins); O1 was run on 17.0.6 (identical crash reproduced on 17.0.5 Bun too).
- providers authenticated (`omp models list`): anthropic (25), openai-codex (7), zai (14).
- plugin build: `npm run build` clean in {W} → `dist/`, version 0.1.0, srcHash d1a15d954c0b.

---

## O1 — BYO-completion live spike

- date: 2026-07-21T06:59:55Z
- provider/model: anthropic/claude-haiku-4-5 (resolved via `ctx.models.resolve`; the deployed
  preset had overridden `ctx.model` to claude-fable-5, so the probe pinned the intended ship model)
- vehicle: **registered tool `execute`** inside a real omp 17.0.6 session (throwaway `-e` extension) —
  exactly the context trace §8 flagged unverified. Real `ctx.modelRegistry.resolver` (minted a real
  `sk-ant-oat…` OAuth token). No mock; real provider responses.

### Probe ① — resolver auth + completion round-trip

Issued the frozen no-tools request (non-blank system prompt) via the resolver-aware pi-ai entry
points, which is what the procedure §1 specifies (`completeSimple`):

- auth: **ok** — `ctx.modelRegistry.resolver(model, sessionId)` minted a real key; no
  `MissingApiKeyError`, no rotation needed.
- reply text (verbatim, first line): `**Discriminated union**: Each AST node carries a literal `kind` field that identifies its type. The evaluator uses a `switch` statement on `kind`, and the compiler enforces that every variant is handl…`
- stopReason: **stop** (normal)
- usage (completeSimple): input 3 / output 232 / cacheRead 7160 / cacheWrite 0
- streamSimple variant: stopReason stop, **15 incremental `text_delta` events** (streaming is
  incremental, not one final dump), usage input 3 / output 214 / cacheWrite 7160 (created cache).

→ Probe ① **PASS**: a registered omp tool handler CAN authenticate via `modelRegistry.resolver` and
drive a live side completion. trace §8 Critical Unknown #1 (auth + completion round-trip) is cleared.

### Probe ② — stream text_delta → live custom render → done → re-select

- streaming incremental: **yes** (15–18 deltas per turn observed through the live event iterator).
- `ctx.ui.custom<T>` mount → `done(result)` → re-`select` round-trip: **NOT EXERCISED** — this
  requires an interactive TTY (`ctx.hasUI === true`); the automated headless run had `hasUI === false`
  (the headless `-p` path deliberately never mounts the component). Per fail-closed, the UI
  round-trip half is recorded as **NOT VERIFIED in this environment** (needs a human at an
  interactive omp session to complete).

### CRITICAL FINDINGS — the SHIPPED adapter fails live (fail-closed, evidence-only)

The capability works, but `src/ask-ui/completion.ts` as shipped does **not** reach it. Two real
bugs, both reproduced against the real runtime and both masked by the mocked Bun adapter tests
(B1–B3 stub `stream`, so the green code suite / run-7 never exercises these):

1. **Raw `stream` never resolves the `ApiKeyResolver`.** completion.ts calls
   `stream(model, ctx, { apiKey: ctx.modelRegistry.resolver(...) })`. pi-ai's raw `stream`
   forwards a non-string `apiKey` straight to the provider (`streamAnthropic → isOAuthToken(apiKey)`);
   only `streamSimple`/`completeSimple` resolve a resolver to a string first (stream.ts:1149-1152).
   Observed error (omp 17.0.6 AND pi-ai 17.0.5 Bun, identical):
   `key.includes is not a function. (In 'key.includes("sk-ant-oat")', 'key.includes' is undefined)`.
2. **Assistant message content is passed as a string.** completion.ts builds `Context.messages` as
   `{ role, content: <string> }` for every role. pi-ai's `transform-messages.redactSensitiveCredentialsInMessages`
   (unconditional on the request path) requires ASSISTANT content to be a content-block array — the
   assistant arm has no string guard (only user/developer do). Any side call carrying assistant
   history (i.e. every real session) crashes:
   `assistantMsg.content.map is not a function`.

When the adapter uses a resolver-aware entry (`streamSimple`/`completeSimple`) AND assistant content
is a block array, the exact same request succeeds (probe ① above). Fix direction (NOT applied here —
RF3 is evidence-only): switch `completion.ts` to `streamSimple` and emit assistant content as
`[{type:"text", text}]`.

### O1 VERDICT (fail-closed §3)

- Underlying capability (resolver auth + completion round-trip + incremental streaming): **PASS**.
- Shipped adapter live path: **FAIL** (two bugs above) — do not mark BYO delivery production-ready
  until fixed.
- Probe ② UI round-trip (custom mount → done → re-select): **NOT VERIFIED** (needs interactive TTY).

---

## E1 — loadMode / plugin boot smoke (AC2.1 + AC2.4)

Run on the pinned **omp 17.0.5** (`{W}/node_modules/.bin/omp` prepended to PATH), loading the
worktree's own `dist/main.js` via `-e`, with the deployed (main-repo) lets-craft copy temporarily
disabled during the observation and restored immediately after (verified byte-identical on restore).

- **Clean boot (AC2.1 "loads without crash"):** plugin loaded without crash; `pi.zod` present and
  functional at load time (a `-e` load provides the full plugin API).
- **① ask 3종 exposed top-level (essential):** the model enumerated `lsc_ask`, `lsc_select`,
  `lsc_confirm` as **directly-callable top-level tools**; NO `xd://lsc_{ask,select,confirm}` markers
  appeared anywhere in the transcript.
- **② representative batch tool discoverable (xd://):** `lsc_doctor` was invoked via
  **`xd://lsc_doctor`** (6 occurrences) and actually ran (reported PASS 4 / WARN 1 / UNKNOWN 2 /
  FAIL 1). The model listed all 13 batch tools under `xd://` (lsc_craft_init, lsc_verify_hash,
  lsc_restore_tests, lsc_run_tests, lsc_craft_abort, lsc_craft_release, lsc_audit_begin,
  lsc_audit_validate, lsc_land, lsc_scaffold, lsc_claims, lsc_doctor, lsc_latency_report).
- **Code-level cross-check (real built dist/main.js + real zod):** invoking the default export with a
  recording pi registered 16 tools with the exact split — `lsc_ask/lsc_select/lsc_confirm = essential`,
  the other 13 = discoverable (loadMode unset).

### E1 e2e vitest — FAILED, root cause is a TEST-HARNESS bug (not the feature)

`LSC_E2E=1 LSC_E2E_STRICT=1 npx vitest run test/ask-ui-e2e.test.ts --no-file-parallelism` (PATH-pinned
to 17.0.5) → 2 failed. Both failures are "ask tool X never executed" because the plugin's tools were
never registered in the spawned session — the model reported the lsc_ tools simply do not exist.

Root cause (isolated empirically): the harness spawns omp with `--no-extensions --extension DIST_ENTRY`.
In this omp (17.0.5 AND 17.0.6), `--no-extensions` **suppresses explicit `-e`/`--extension` loads**,
contradicting `omp --help` ("explicit -e paths still work"). Proof:
- `omp -e probe.ts` (no `--no-extensions`) → extension runs, `pi.zod` present.
- `omp --no-extensions -e probe.ts` → extension never runs (no side effect).

So the plugin never loads under the harness's flag combination → tools never register → the per-tool
guards fail. This is a **harness bug**, not a loadMode/feature defect (the feature is proven correct
above, both at runtime on 17.0.5 and at the code level). Fix direction (NOT applied here): drop
`--no-extensions` or load the plugin as a linked plugin instead of `--extension` under `--no-extensions`.

### E1 VERDICT

- Feature (clean boot + ask trio essential + batch discoverable): **PASS** (observed live on 17.0.5).
- e2e shadow test as written: **FAILS due to a harness flag bug** — needs fixing (evidence-only).

---

Raw captures (throwaway harness, outside the worktree): `/tmp/lsc-live-gates/omp-probe-result.json`
(O1/O2), `/tmp/lsc-live-gates/e1-runtime.log` + extracted enumeration (E1),
`/tmp/lsc-live-gates/zod-probe-result.json` (`--no-extensions` vs `-e` isolation).

---

## POST-FIX RE-VERIFICATION — O1 RF3 bugs fixed, shipped adapter live path now PASSES

> Follow-up to the O1 CRITICAL FINDINGS above (fix cycle after audit-0 RF3). The two live bugs the O1
> spike proved were then fixed in `src/ask-ui/completion.ts` and RE-VERIFIED live against the real
> provider — driving the **fixed, shipped `createCompletionPort` DIRECTLY** (not the raw builders).
> **fail-closed**: results recorded exactly as observed.

### The fix (src/ask-ui/completion.ts)

1. **`import { stream }` → `streamSimple`** (the resolver-aware entry). The event-iteration logic is
   unchanged (`streamSimple` returns the same `AssistantMessageEventStream`; text_delta/done/error
   handling, stopReason gate, and redaction are all invariant). The `apiKey` is still forwarded as the
   resolver BY IDENTITY — `streamSimple` resolves it internally (stream.ts:1015-1116), so the O1 bug ①
   crash (`key.includes is not a function`) can no longer occur.
2. **Assistant content → content-block array.** `Context.messages` now maps an `assistant` message's
   content to `[{ type: "text", text }]`; user/other roles keep the plain string. This satisfies
   pi-ai's unconditional redaction pass (`transform-messages`), which has no string guard for the
   assistant arm — so the O1 bug ② crash (`assistantMsg.content.map is not a function`) is gone.

### Live re-verification probe

- date: 2026-07-21T09:26:14Z
- omp: global **17.0.6** (`~/.bun/bin/omp`), plain `-e` load (no `--no-extensions`, per the E1 finding).
- provider/model: **anthropic/claude-haiku-4-5** (resolved via `ctx.models.resolve`; ctx.model was the
  preset's claude-fable-5, so the probe pinned the ship model, same as O1).
- vehicle: **registered tool `execute`** (throwaway `-e` extension `postfix-probe-ext.ts`) inside a real
  omp session — the same context O1 used. Real `ctx.modelRegistry.resolver` (minted a real key), real
  provider response, no mock. The probe imports the **freshly-built `dist/ask-ui/completion.js`** and
  calls `createCompletionPort(ctx)` → `port.run(request, { signal, onDelta })`.
- request: built with the production `createSideChatSession` + `buildSideRequest` over a seeded history
  containing **4 assistant turns** (`assistantHistoryCount: 4`, `messageCount: 9`) — the exact history
  shape that crashed the old adapter's redaction pass (bug ②).

### Result — a no-throw round-trip carrying assistant history

- `run.ok`: **true**; `status`: **complete**; `error`: null (no throw — neither `key.includes` nor
  `content.map`).
- reply text: **973 chars**, non-empty; first line: `**Discriminated union: what it does**`.
- streaming incremental: **yes** — `deltaCount: 16` `onDelta` increments (`onDeltaIncremental: true`),
  firstDeltaMs 1186, totalMs 4157; usage cacheRead 0 / cacheWrite 0 (fresh session).
- omp confirmed the tool succeeded and echoed the marker `LSC-POSTFIX-PROBE-DONE 842 bytes written`
  (no spurious tool error).

Contrast with the pre-fix O1 captures above (`omp-probe-result.json`): `o1_stream_adapter` (raw
`stream` + string messages = the OLD adapter) FAILED with `key.includes is not a function`;
`o1_rawmsg_streamSimple` (streamSimple but string assistant messages) FAILED with
`assistantMsg.content.map is not a function`. The fixed adapter (streamSimple + assistant blocks) now
matches the passing `o1_streamSimple` path.

### Deterministic suite (fixed adapter, run-9)

- build: **PASS** (tsc, 0). type-check gate (ask-ui contract `.test-d.ts`): **PASS** (0).
- Vitest (`LSC_E2E= LSC_FIXTURE= npx vitest run`): **1491 passed / 16 skipped**, all green.
- Bun (`bun test test-bun`): **21 pass / 0 fail** — including the new B2 assistant-block-array pin
  (`B2 — assistant history is forwarded as a CONTENT-BLOCK array`) that was RED at run-8.

### POST-FIX VERDICT (fail-closed)

- Shipped adapter live path (resolver-aware completion + assistant-history round-trip + incremental
  streaming): **PASS** — the two O1 RF3 bugs are fixed and confirmed live. BYO-completion adapter is no
  longer blocked by the O1 findings.
- Probe ② UI round-trip (custom mount → done → re-select): still **NOT VERIFIED** (needs an interactive
  TTY; unchanged by this fix, which is on the completion path only).

Raw captures (throwaway, outside the worktree): `/tmp/lsc-live-gates/postfix-probe-result.json`
(this re-verification) + `/tmp/lsc-live-gates/postfix-probe-ext.ts` (the probe extension).
