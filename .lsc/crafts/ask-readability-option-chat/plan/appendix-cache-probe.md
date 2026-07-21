# O2 — Side-chat Prompt Cache Live Probe (AC6.2) — RESULTS

> Live evidence capture for the AC6.2 cache measurement, per the `cache-probe-procedure.md`
> canon (§6 requires the actuals to land in THIS file). Run as part of audit-0 Required Fix RF3
> (the three live gates were never executed before). **fail-closed**: absent telemetry or a 0
> read = FAIL; nothing here is success-washed.

## Environment

- host: darwin 25.2.0 (Apple M4 Pro), 2026-07-21
- runtime: real **omp 17.0.6** session, inside a **registered tool `execute`** (throwaway `-e`
  extension), driving omp's bundled `@oh-my-pi/pi-ai` with the real `ctx.modelRegistry.resolver`
  (no mock). Resolver minted a real Anthropic OAuth token (`sk-ant-oat…`, 108 chars).
- provider / model: **anthropic / claude-haiku-4-5**
- cache construction: the feature's own pure builders `createSideChatSession` + `buildSideRequest`
  (`src/ask-ui/completion-core.ts`, verbatim) — one frozen `SideChatSession`, `getBranch` called
  once, stable `promptCacheKey` = main session id, unique side `sessionId` = `{main}:side:{nonce}`,
  `cacheRetention: "short"`, prefix-invariant messages (verified `prefixInvariant: true`).

## Method note (why not through the shipped adapter)

The measurement was issued through pi-ai's resolver-aware `streamSimple` with provider-valid message
shapes (assistant content as content-block arrays). The **shipped adapter** `src/ask-ui/completion.ts`
could **not** be used to reach the provider because it crashes on two real bugs — see
`appendix-live-spike.md` (O1). The AC6.2 question ("does the request SHAPE produce a cache hit?")
is answered against the exact request `buildSideRequest` produces; the cache-relevant fields
(system prefix, message prefix, `promptCacheKey`, side `sessionId`, `cacheRetention`) are byte-identical
to what the adapter would send. The cache-lifetime canon is therefore validated, but the shipped
**delivery** path is currently blocked by the O1 adapter bugs.

## Measured usage (per turn, same frozen SideChatSession, run-unique prefix)

- capture timestamp (ISO-8601): **2026-07-21T06:59:55Z**
- side sessionId: `lsc-o2-1784617204199-vdl58w:side:pe7asedx`  ·  promptCacheKey: `lsc-o2-1784617204199-vdl58w`

| turn | intent | stopReason | input | output | cache_creation_input_tokens | cache_read_input_tokens |
|------|--------|-----------|-------|--------|-----------------------------|-------------------------|
| 1 (one-button `?`) | freeze + first side call | stop | 3 | 238 | **7187** (ephemeral 5m) | 0 |
| 2 (free-prompt `t`) | reuse frozen prefix | stop | 3 | 258 | 259 (new turn-1 exchange) | **7187** |

- **turn-2 `cache_read_input_tokens` = 7187 (> 0)** — the AC6.2 §5 pass signal.
- turn-1 `cache_creation_input_tokens` = 7187 (> 0) — cache created on first call (Anthropic).
- Independently corroborated in the same run: a separate `streamSimple` first-touch of an identical
  prefix reported `cacheWrite = 7160` (creation) and a subsequent `completeSimple`/`streamSimple`
  touch reported `cacheRead = 7160` (hit).

## Threshold note

An earlier attempt with a ~2987-token prefix showed `cache_creation = 0` / `cache_read = 0`: below
claude-haiku-4-5's effective per-model cache minimum. Enlarging the frozen prefix (getBranch history)
to ~7.2k tokens cleared the minimum and produced the creation→read pair above. This is a probe-sizing
detail, not a construction defect — the byte-stable frozen prefix is what the cache keys on.

## VERDICT (fail-closed, procedure §5)

**PASS** — turn-2 `cache_read_input_tokens = 7187 > 0` observed on a real Anthropic model with the
feature's own frozen-session / stable-`promptCacheKey` / prefix-invariant construction; turn-1
cache creation also observed. Caveat: delivery via the shipped `completion.ts` adapter is blocked by
the O1 bugs (see `appendix-live-spike.md`) and must be fixed before this hit is reachable in production.

Raw capture: `/tmp/lsc-live-gates/omp-probe-result.json` (`o2_cache` block), throwaway harness at
`/tmp/lsc-live-gates/` (outside the worktree).
