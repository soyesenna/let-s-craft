# Research Synthesis — provider-usage-status-bar

> Scope: external + ecosystem research feeding the pre-craft trace. Every load-bearing claim carries an inline `[Source N]`; sources listed at the bottom. Internal omp source claims (file:line) come from the terrain scout + three lane tracers and are marked `[omp: …]`.

## 0. Executive summary — the pivot

The feature ("a persistent bar below the omp prompt input showing 5-hour and 1-week usage for every logged-in provider account, multiple accounts per provider") is **feasible as a lets-craft plugin using omp's own ExtensionAPI, without the plugin ever calling a provider HTTP endpoint or handling an OAuth token.** omp already (a) fetches per-account 5h/7d subscription usage natively and caches it, and (b) exposes a persistent render slot directly below the input. This *pivots* the design away from the entire ecosystem pattern (every third-party tool re-implements provider-endpoint calls + token handling) and, as a side effect, sidesteps the ecosystem's central legal/reliability hazards. The external research below establishes the domain (what the windows are, how the ecosystem gets them, the UX conventions) and validates that omp's native surface matches it.

## 1. What "5시간 / 1week 사용량" actually is

The 5-hour and 7-day (weekly) windows are the canonical **subscription** usage limits, not API rate limits:
- Anthropic Pro/Max: a rolling **5-hour session limit** plus a **weekly limit** (Max carries two weekly buckets — all-models + Sonnet-only; an Opus-specific limit may also exist), the weekly resetting at a **fixed account-assigned time** `[S1][S2][S3]`. Subscription quota is account-wide across web/desktop/mobile/Claude Code/IDE; API-key auth bills separately `[S4]`.
- OpenAI/Codex mirrors this: a `primary_window` (≈5h, `limit_window_seconds` ~18000) and a `secondary_window` (≈weekly, ~604800) `[S5][S6]`.
- The canonical machine-readable shape is **`used_percentage` (0–100, or 0..1) per window + an absolute `resets_at` timestamp**, confirmed by Claude Code's official statusline schema (`rate_limits.five_hour/seven_day.{used_percentage,resets_at}`, added v2.1.80) `[S7][S8]` and OpenAI Codex's `RateLimitWindow {usedPercent, windowDurationMins, resetsAt}` `[S6]`.
- **Window durations are provider/plan-dependent and server-driven** — Codex tests show primary=3600s/secondary=86400s in some fixtures; clients infer the "5h"/"weekly" label from the returned `windowDurationMins`, they do not hardcode it `[S6]`. Design consequence: render whatever windows the server returns, keyed by duration, rather than assuming exactly {5h, 7d}.

**API rate-limit headers are NOT this.** Anthropic `anthropic-ratelimit-*` and OpenAI `x-ratelimit-*` are per-minute token-bucket windows (RPM/TPM), explicitly not the subscription 5h/weekly allowance `[S9][S10][S11]`.

## 2. How the ecosystem obtains it (and why omp's native path is better)

Across ~15 surveyed tools, subscription 5h/weekly usage is obtained by one of three means, in descending fidelity:
1. **Provider server snapshot (authoritative, cross-device).**
   - Anthropic: the **undocumented** `GET https://api.anthropic.com/api/oauth/usage` (Bearer OAuth + `anthropic-beta: oauth-2025-04-20` + `User-Agent: claude-code/<ver>`) returning `five_hour`/`seven_day`(+scoped `limits[]`) utilization/resets `[S12][S13][S14]`; also **undocumented** unified response headers `anthropic-ratelimit-unified-{5h,7d}-*` on `/v1/messages` `[S15]`. Schema has drifted (flat `seven_day_*` → structured `limits[]`) — parsers must tolerate both `[S16]`.
   - OpenAI/Codex: the **internal** `chatgpt.com/backend-api/wham/usage` / `/api/codex/usage`, used by the official Codex client itself and its app-server RPC `account/rateLimits/read` `[S5][S6]`.
   - Claude Code's **official** statusline stdin exposes the same Anthropic data, but only *inside* a Claude Code session `[S7]`.
2. **Local token-log inference (weaker proxy).** ccusage/ccmonitor reconstruct "5h blocks" from `~/.claude/**/*.jsonl` (hour-floored, contiguous-activity) and "weekly" as a **calendar** bucket — no server reset times, no cross-device usage; explicitly *not* subscription quota `[S17][S18]`.
3. **Dashboard scraping (brittle fallback).** e.g. scraping OpenCode's SSR dashboard for `usagePercent`/`resetInSec` `[S19]`.

**omp collapses all of this into a native call.** `ctx.modelRegistry.authStorage.fetchUsageReports()` returns per-account `UsageReport[]` with 5h/7d windows; omp owns the provider HTTP, the OAuth refresh, the unified-header ingestion, and SQLite persistence `[omp: auth-storage.ts:2873, agent-session.ts:15672-15695]`. It supports anthropic, openai-codex, google-gemini-cli, and kimi-code `[omp: claude.ts/openai-codex.ts/gemini.ts/kimi.ts]`. The plugin reads; it never touches endpoints or tokens.

## 3. Capability boundary — OAuth vs API-key (reshapes acceptance criteria)

Subscription 5h/7d exists **only for OAuth/subscription accounts** (Pro/Max/Team). API-key, Enterprise, and Bedrock accounts have no such quota — every surveyed tool hides or flags them `[S20][S21]`, and omp gates every 5h/7d-emitting provider on `credential.type === "oauth"` `[omp: claude.ts:595/501, openai-codex.ts:350/355]`. So **"every logged-in account" cannot show 5h/7d** — the bar must enumerate all accounts (`listStoredCredentials`, which includes api_key) yet render usage only for subscription accounts and surface the rest as "usage unavailable"/omitted — exactly omp's own `usage-cli` policy `[omp: usage-cli.ts:281-309,702-712]`.

## 4. Rendering the below-input bar

omp exposes a persistent slot directly below the input: `ctx.ui.setWidget(key, content, {placement:'belowEditor'})` renders into `hookWidgetContainerBelow`, the last child under the editor `[omp: types.ts:211,160-168; interactive-mode.ts:923-928]`. `content` is `string[]` (≤10 lines) or a component factory; re-calling the same `key` replaces, `undefined` clears; each call triggers a render `[omp: extension-ui-controller.ts:260-273]`. **Do not use `setFooter`/`setHeader`** — they are literal no-ops; `setStatus` renders in the *top* border (the existing "위에 기본" area) `[omp: extension-ui-controller.ts:99-100, component.ts:1311-1324]`. There is **no periodic widget tick** — the plugin holds the stable `ctx.ui` from `session_start` and drives its own `setInterval`, re-rendering on `session_switch`/`session_branch` (widgets clear on session change); the bundled `autoresearch` extension is the live precedent `[omp: dashboard.ts:32-64]`.

This matches the ecosystem's persistent-footer patterns — Ink `<Footer/>` below `<InputPrompt/>` (Gemini CLI) `[S22]`, OpenTUI `split-footer` `[S23]`, and notably a **Pi-ecosystem extension** (`pi-powerline-footer`) that paints a fixed bottom cluster `[S24]` — but omp's native `setWidget` supersedes needing any raw-ANSI compositor. UX conventions worth adopting: compact one-row-per-account, width-aware truncation with `…`, color thresholds, reset countdown, and **rendering used/remaining/reset/window as one atomic snapshot** to avoid rollover desync `[S6][S25]`; nested `provider → account(email, plan) → indented 5h/7d rows` is the cleanest surveyed multi-account layout `[S26]`.

## 5. Multi-account modeling (the novel surface)

**No surveyed tool renders more than one account of the *same* provider simultaneously** `[S26][S27]` (CodexBar's `claude-swap` integration — ≤4 opaque per-slot identities — is the closest `[S27]`). This is the feature's least-precedented requirement and its main UX/design risk. omp supplies stable per-account identity: `listStoredCredentials()`/`listOAuthAccounts(provider)` enumerate all accounts with `{provider, accountId?, email?, position}`, and each `UsageReport` carries `metadata.email`/`accountId` for attribution `[omp: auth-storage.ts:1813,4251; usage.ts:97-113]`. Prior art warns identity must be a **stable per-account key**, not email or config-path alone `[S27][S28]`.

## 6. Cost, refresh, and staleness

`fetchUsageReports` is not a pure cache read, but cost is strictly bounded: a **5-minute per-credential TTL (±25% jitter)**, per-credential + aggregate in-flight coalescing, a **10s serve-stale-on-failure** backoff, and 24h last-good; all errors (incl. 429) are swallowed to serve-stale; the active Anthropic account is warmed for free by omp's 60s-gated header ingestion `[omp: auth-storage.ts:558,2407-2451,2440-2444]`. So the plugin may poll on a timer — cadence ≥5 min guarantees zero extra provider load; faster is still safe (cache hits dominate). This bound is exactly what the ecosystem had to build by hand (180–300s caches, flock, serve-stale) to survive the undocumented endpoints' persistent 429s `[S13][S29]` — omp already provides it. (Broker mode `OMP_AUTH_BROKER_URL` bypasses the local TTL; the broker owns caching and is not per-IP throttled `[omp: auth-storage.ts:2886-2904]`.)

## 7. Legal / risk posture

Anthropic's terms restrict OAuth credentials to subscribers' ordinary use of Claude Code / native apps and **do not permit third-party products to route requests via Pro/Max credentials** `[S30][S31]`. Every ecosystem tool that calls `/api/oauth/usage` directly sits in this grey zone. **The omp-native path avoids it**: omp *is* the user's native agent making ordinary calls; the plugin only reads usage omp already collected via its public ExtensionAPI, and never presents itself as a third party routing the user's credentials. This is a decisive argument for the native path over the ecosystem pattern — and it is why the design should NOT fall back to the plugin calling provider endpoints itself.

## 8. Consolidated design implications (for the plan)

1. **Data source = omp only.** `ctx.modelRegistry.authStorage.{listStoredCredentials, fetchUsageReports}`. No provider HTTP, no token handling, no local-log inference in the plugin.
2. **Render = `setWidget(belowEditor)`**, plugin-owned `setInterval`, re-render on `session_switch`/`session_branch`. Never `setFooter`/`setHeader`.
3. **Enumerate all accounts, render usage only for subscription ones**; surface api-key/no-usage accounts as "unavailable"/omit (C10/§3).
4. **Render server windows generically** by `window.id`/duration + `scope` (tier/model), normalized via `resolveUsedFraction`→0..1; show `resets_at` as a countdown; render each window's used/remaining/reset atomically (§1, §4).
5. **Multi-same-provider-account layout is novel** — design it deliberately (nested per-account compact rows), width-truncate, cap rows sanely (string[] hard-capped at 10; a factory component if more control needed).
6. **Respect the cache** — poll cadence ~5 min (aligned to omp's TTL); treat `report.fetchedAt` as the only staleness signal.
7. **One residual empirical unknown** (P4/C12): does a `belowEditor` widget stay visible (unclipped) on short terminals with a tall transcript? No in-tree `belowEditor` caller exists. Resolve with a trivial live probe in the craft phase (pre-craft is read-only).

## Sources
- [S1] Anthropic Support — Pro plan (5h session reset): https://support.claude.com/en/articles/8325606
- [S2] Anthropic Support — Max plan (two weekly limits, fixed reset): https://support.claude.com/en/articles/11049741
- [S3] Anthropic Support — usage limit best practices (Settings>Usage bars): https://support.claude.com/en/articles/9797557
- [S4] Anthropic Support — Claude Code with Pro/Max (account-wide vs API-key): https://support.claude.com/en/articles/11145838
- [S5] OpenAI Codex — app-server `account/rateLimits/read` + `/wham/usage`|`/api/codex/usage`: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md ; backend-client/src/client/rate_limit_resets.rs
- [S6] OpenAI Codex — RateLimitWindow schema (usedPercent/windowDurationMins/resetsAt): https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/GetAccountRateLimitsResponse.json ; issue #24080
- [S7] Anthropic Claude Code — statusline `rate_limits.five_hour/seven_day` (official): https://code.claude.com/docs/en/statusline
- [S8] Anthropic Claude Code — CHANGELOG v2.1.80 (rate_limits added): https://code.claude.com/docs/en/changelog
- [S9] Anthropic API rate limits (RPM/ITPM/OTPM, not 5h/7d): https://platform.claude.com/docs/en/api/rate-limits
- [S10] Anthropic Support — approach to API rate limits: https://support.claude.com/en/articles/8243635
- [S11] OpenAI API rate limits (x-ratelimit-*): https://developers.openai.com/api/docs/guides/rate-limits
- [S12] claude-usage-monitor issue #202 (oauth/usage sample response): https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/202
- [S13] Anthropic claude-code issues #31021 / #31637 (oauth/usage 429, no Retry-After): https://github.com/anthropics/claude-code/issues/31021
- [S14] CodexBar ClaudeOAuthUsageFetcher (flat + limits[] decode): https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Claude/ClaudeOAuth/ClaudeOAuthUsageFetcher.swift
- [S15] Anthropic claude-code issues #12829 / #55333, CodexBar #1894 (unified 5h/7d headers): https://github.com/anthropics/claude-code/issues/12829
- [S16] PyPI ccusage note — oauth/usage schema drift (flat→limits[]): https://pypi.org/project/ccusage/
- [S17] ccusage — local block/weekly reconstruction (blocks.rs/summary.rs): https://github.com/ccusage/ccusage/blob/main/rust/crates/ccusage/src/blocks.rs
- [S18] ccusage issue #658 — local cost not meaningful as subscription quota: https://github.com/ccusage/ccusage/issues/658
- [S19] opencode-quota PR #41 — dashboard SSR scraping fallback: https://github.com/slkiser/opencode-quota/pull/41
- [S20] jarrodwatts/claude-hud — native stdin only, no api-key display: https://github.com/jarrodwatts/claude-hud
- [S21] fredrikaverpil/claudeline — quota bars require Pro/Max/Team: https://github.com/fredrikaverpil/claudeline
- [S22] Gemini CLI — Footer below InputPrompt (Ink): https://github.com/google-gemini/gemini-cli/blob/main/packages/cli/src/ui/components/Composer.tsx
- [S23] OpenTUI — split-footer screen mode: https://opentui.com/docs/core-concepts/renderer/
- [S24] pi-powerline-footer — Pi extension fixed bottom cluster (raw ANSI): https://github.com/nicobailon/pi-powerline-footer
- [S25] OpenAI Codex issue #24080 — atomic compound status token (avoid rollover desync): https://github.com/openai/codex/issues/24080
- [S26] drogers0/aistat — nested per-account compact rows; multi-account (Claude-only): https://github.com/drogers0/aistat
- [S27] CodexBar — claude-swap multi-account, opaque per-slot identity, ≤4 items: https://github.com/steipete/CodexBar/blob/main/docs/claude-multi-account-and-status-items.md
- [S28] CodexBar PlanUtilizationHistoryStore — stable per-account hashed identity: https://github.com/steipete/CodexBar/blob/main/Sources/CodexBar/PlanUtilizationHistoryStore.swift
- [S29] ccstatusline-usage / ohugonnot — 180s/60s cache + serve-stale + flock: https://github.com/ohugonnot/claude-code-statusline
- [S30] Anthropic — Claude Code legal & compliance (OAuth use restrictions): https://code.claude.com/docs/en/legal-and-compliance
- [S31] Anthropic — Consumer Terms §3(4)/§3(7): https://www.anthropic.com/legal/consumer-terms
