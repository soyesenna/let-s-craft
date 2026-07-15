# Claim Graph — provider-usage-status-bar

Orchestrator-owned. Status vocabulary:
- **VERIFIED** — ≥2 independent source domains + ≥2 independent observation groups + a countersearch pass + primary-source backing + time-relevant.
- **VERIFIED-INTERNAL** — grounded in omp source at file:line by the terrain scout AND confirmed by a lane tracer.
- **PENDING-LANE** — asserted by the terrain scout (single agent); awaiting lane-tracer verification against source.
- **UNVERIFIED-FLAGGED** — single/weak source or explicitly conflicting; carried as caveat only.

---

## C1 — The canonical subscription usage windows are a 5-hour window and a 7-day (weekly) window, per account. [VERIFIED]
Sources (primary): Claude Code statusline docs (`rate_limits.five_hour/seven_day.{used_percentage,resets_at}`, code.claude.com/docs/en/statusline); CHANGELOG v2.1.80 (added these fields, code.claude.com/docs/en/changelog). Support articles (Pro 8325606, Max 11049741) describe a 5h session limit + weekly limit(s). OpenAI/Codex mirror: `rate_limit.primary_window` (limit_window_seconds=18000 ≈ 5h) + `secondary_window` (≈604800 ≈ weekly) (openai/codex `rate_limit_window_snapshot.rs`; app-server `account/rateLimits/read`). Observation groups: official Anthropic docs; official OpenAI/codex OSS; ≥6 third-party tools. Countersearch: API-key `anthropic-ratelimit-*` / OpenAI `x-ratelimit-*` are per-minute token-bucket windows, explicitly NOT 5h/7d (support 8243635; AWS Claude Platform rate-limits; developers.openai.com rate-limits). **This window model is the feature's semantic target.**

## C2 — utilization is a 0–100 (or 0..1) percentage per window, with a server reset timestamp; weekly may have MULTIPLE model-scoped buckets + extra_usage. [VERIFIED]
Sources: oauth/usage sample (five_hour/seven_day utilization + resets_at; seven_day_sonnet/opus nullable; extra_usage{is_enabled,monthly_limit,used_credits,utilization}) — Maciek issue #202, CodexBar `OAuthUsageResponse` (flat + `limits[]` entries kind/group/percent/resets_at/scope.model). Schema DRIFT observed: flat `seven_day_*` → structured `limits[]` (PyPI ccusage note). Design implication: parser must tolerate both and preserve unknown optional buckets. Some clients see 0..1 and normalize to 0..100.

## C3 — Subscription 5h/7d quota is available ONLY for OAuth subscription accounts (Pro/Max/Team); API-key / Enterprise / Bedrock accounts have NO such quota. [VERIFIED]
Sources: claude-hud, claudeline, CodexBar (flags API-key rows "subscription usage unavailable"); Claude Code costs docs (Pro/Max see plan bars; API users see local cost estimate only). Design implication: **non-subscription accounts must be surfaced as "usage unavailable", not as 0% or omitted silently** (matches ecosystem). [Cross-checked by LanePremiseAudit P3 — pending.]

## C4 — Local token-log accounting (ccusage/ccmonitor style) is a STRICTLY WEAKER proxy, NOT provider quota. [VERIFIED]
Sources: ccusage (`blocks.rs` floors to hour, 5h contiguous-activity blocks; `summary.rs` weekly = CALENDAR week, not rolling 7×24h; reset time only passively copied from a logged "limit reached" error). ccmonitor (hourly-bucket 5h approximation, no weekly). ccusage issue #658 + Claude Code costs docs: local cost/breakdown is approximate, excludes other devices/claude.ai, must NOT be labeled as remaining plan quota. Design implication: prefer provider-authoritative fields; local logs are last-resort fallback only.

## C5 — Machine-readable subscription usage exists via provider surfaces, but all are UNOFFICIAL/undocumented except Claude Code's own statusline stdin. [VERIFIED]
- Anthropic: `GET api.anthropic.com/api/oauth/usage` (Bearer OAuth + `anthropic-beta: oauth-2025-04-20` + `claude-code/<ver>` UA) → five_hour/seven_day/limits[] — undocumented, needs `user:profile` scope, frequent 429 (issues #30930/#31021/#40094/#31637), poll ≥180s + cache + serve-stale. Unified `/v1/messages` response headers `anthropic-ratelimit-unified-{5h,7d}-{status,reset,utilization}` — undocumented (issues #12829/#55333, CodexBar #1894). `claude.ai/api/organizations/{orgId}/usage` (sessionKey cookie) — internal. Official negative: no public quota API (#44328/#13585).
- OpenAI/Codex: `chatgpt.com/backend-api/wham/usage` (Bearer + `ChatGPT-Account-Id`) / `/api/codex/usage` → rate_limit.primary/secondary — undocumented internal (openai/codex OSS + AgentLimits + lhl/pi-codex-status). Official: UI-only (Codex Settings>Usage).
- Observation groups: official provider docs (negative), official OSS clients (openai/codex), ≥8 third-party tools.

## C6 — Using OAuth credentials / the undocumented endpoints from a THIRD-PARTY product may violate provider terms. [VERIFIED — legal caveat]
Sources: code.claude.com/docs/en/legal-and-compliance ("OAuth intended exclusively for subscribers' ordinary use of Claude Code/native Anthropic apps; developers building products should use API keys; Anthropic does not permit third parties to route requests via Free/Pro/Max credentials"); Anthropic Consumer Terms §3(4)/§3(7). **Implication: a design that independently scrapes `/api/oauth/usage` with a user's token is legally risky. A design that reads usage OMP ITSELF already collected (as the user's own native agent) sidesteps this — see C7.**

## C7 — [PIVOTAL] omp ALREADY collects per-account usage natively and exposes it (plus a below-input render surface) to extensions. [PENDING-LANE → being verified by all 3 lanes]
Asserted by terrain scout (`agent://OmpTerrainMap`), file:line in oh-my-pi / node_modules @oh-my-pi/*:
- **Render below input:** `ctx.ui.setWidget({placement:'belowEditor'})` → `ExtensionUiController.setHookWidget` → `hookWidgetContainerBelow` (interactive layout `…→editorContainer→hookWidgetContainerBelow`). [LaneUiRender verifying]
- **Traps:** `setFooter`/`setHeader` declared but interactive controller no-op; `setStatus` renders in TOP border; `FooterComponent.ts` legacy/dead. [LaneUiRender verifying]
- **Accounts:** `ctx.modelRegistry.authStorage.listOAuthAccounts()` → OAuthAccountSummary (multiple per provider). [LaneUsageData verifying]
- **Usage:** `authStorage.fetchUsageReports()` → per-account UsageReport with 5h/7d windows + resets, persisted to SQLite `usage_history`; omp ingests unified rate-limit headers itself (AgentSession header ingestion). [LaneUsageData verifying — CRITICAL: network vs cache? all accounts vs active?]
- **Existing UI:** built-in top status shows ACTIVE account only, gated by preset (default preset EXCLUDES usage); `/usage` command groups ALL accounts/windows on demand. [LanePremiseAudit verifying non-redundancy]
**If C7 holds, the feature = read omp's own native reports + setWidget(belowEditor); NO third-party endpoint calls or token handling by the plugin → C6 legal risk does not apply, and the C5 429/undocumented-fragility risk is omp's to own, not the plugin's.**

## C8 — Persistent-bottom-footer rendering is a well-established pattern; a Pi-ecosystem extension precedent exists. [VERIFIED — prior art]
Sources: nicobailon/pi-powerline-footer (a **Pi coding-agent extension** — raw-ANSI reserve-bottom-rows + scroll-region compositor, multi-row, extension-contributed status keys, debounced scheduler); Gemini CLI (Ink `<Footer/>` below `<InputPrompt/>`, event-driven); OpenTUI `screenMode:'split-footer'`; Crush (Bubble Tea reserved footer rect); sirmalloc/ccstatusline (multi independent lines, width-truncation with `…`). Design implication (UX): compact per-account rows, color thresholds, reset countdown, truncation, stale labeling. NOTE: omp's native `setWidget(belowEditor)` (C7) likely supersedes needing a raw-ANSI compositor — prior art informs UX/layout, not the rendering mechanism.

## C9 — Multi-account keying must use a STABLE per-account identity, not just email or config-dir path. [VERIFIED — prior art]
Sources: CodexBar (`SHA256(provider:token-account:<uuid>)` for token accounts; `claude:oauth-history-owner:v2:` hashed identity for OAuth; refuses to merge OAuth samples lacking a high-entropy owner); Maciek monitor (keys by `(source.kind, source.account)` but for local logs account = config-dir PATH — a weaker proxy that can collide when a token is swapped in the same dir). Design implication: key per (provider, account-identity from omp's own OAuthAccountSummary); do NOT collapse distinct accounts.

---

## Convergence assessment (external research)
- **Saturation reached** on Facets A–F: the final wave-1 IRC rounds were heavily corroborative (same endpoints/algorithms re-confirmed from new sources) with no materially new mechanism. Remaining open leads are LOW-VALUE post-pivot (C7): once omp is confirmed to own the fetching, third-party endpoint minutiae stop being load-bearing.
- **Protocol status:** wave 1 (saturation) complete. Expansion-wave decision pending harvest of wave-1 `## EXPAND` tails (to log wave-1.md and decide whether a scoped wave 2 adds anything beyond confirming C7 internally — which is the lane tracers' job, not external librarians').

---

## Lane Verification Results (post-wave-1) — C7 RESOLVED, C10 added

### C7 — [PIVOTAL] RESOLVED → VERIFIED-INTERNAL (all 3 lanes)
- **Render (LaneUiRender, CONFIRMED):** `ctx.ui.setWidget(key: string, content: string[] | ((tui,theme)=>Component) | undefined, {placement:'belowEditor'})` (pi-coding-agent extensibility/extensions/types.ts:211,160-168). `string[]` capped at 10 lines (MAX_WIDGET_LINES); re-call same key REPLACES; `undefined` CLEARS; each call → `requestRender`. Layout `…→editorContainer→hookWidgetContainerBelow` (interactive-mode.ts:923-928) = below the input. `setFooter`/`setHeader` are literal no-ops (extension-ui-controller.ts:99-100); `setStatus` renders TOP. `ctx.ui` is a STABLE object held from session_start → plugin drives its own `setInterval` (omp exposes NO widget tick). Must re-render on `session_switch`/`session_branch` (widgets cleared on new/switch session). Live precedent: autoresearch `dashboard.ts:32-54`.
- **Data (LaneUsageData, CONFIRMED):** `ctx.modelRegistry.authStorage` is the PUBLIC, SHARED `AuthStorage` (same instance as AgentSession). `listStoredCredentials(provider?)` → all providers incl. api_key `{id,provider,credential:{type},disabledCause}`; `listOAuthAccounts(provider)` → OAuth-only `{position,credentialId,accountId?,email?,projectId?}`. `fetchUsageReports({signal?})` → `UsageReport[]` covering ALL accounts (one request per credential), each `report.limits[]` carrying separate `window.id==='5h'` and `'7d'` `UsageLimit`s with `window.resetsAt` (epoch ms); normalize via exported `resolveUsedFraction(limit)`→0..1; attribute via `report.metadata.email`/`accountId`. **Cost bounded:** 5-min per-credential TTL (±25% jitter) + per-credential & aggregate in-flight coalescing + 10s serve-stale-on-failure + 24h last-good; active Anthropic account warmed free by 60s-gated header ingestion. All errors incl. 429 caught→null→serve-stale. Broker mode (`OMP_AUTH_BROKER_URL`) bypasses local TTL (broker owns caching, less IP-throttled). NO `fromCache`/`stale` flag — only `report.fetchedAt`.
- **The plugin never calls a provider endpoint or touches an OAuth token** → C6 legal risk and C5 429/fragility are omp's, not the plugin's. Sources: auth-storage.ts (listOAuthAccounts:4251, listStoredCredentials:1813, fetchUsageReports:2873, #collectUsageRequests:2622-2671, TTL:558, serve-stale:2440-2444), usage.ts (UsageReport:97-113, UsageLimit:53-64, UsageWindow:14-23, resolveUsedFraction:120-129), model-registry.d.ts:62-63.

### C10 — "EVERY logged-in account has 5h/7d" is FALSE (LanePremiseAudit P3, FALSIFIED). [VERIFIED-INTERNAL]
5h/7d windows are OAuth-only across every emitting provider — anthropic (claude.ts:595,501), openai-codex (openai-codex.ts:350,355), google-gemini-cli (gemini.ts:198,201), kimi-code (kimi.ts:210,215). API-key / non-subscription accounts (and api-key-only providers zai/minimax-code/opencode-go) have NO 5h/7d. `listOAuthAccounts` returns `[]` under an api-key override → enumerate via `listStoredCredentials` (OAuth + api_key) and surface non-subscription accounts as "usage unavailable"/omit, mirroring omp's own `usage-cli.ts` policy (selectReportableAccounts:702-712, collectUnreportedAccounts:281-309). **This reshapes the acceptance criteria** — the bar cannot claim per-account 5h/7d for "every" account.

### C11 — Non-redundancy confirmed (LanePremiseAudit P1, UPHELD). [VERIFIED-INTERNAL]
omp's `usage` status segment exists (segments.ts:590-611) but is in NO shipped preset (default excludes it; presets.ts:5,15-101) and is active-account-only even when enabled (component.ts:878,884-888); `/usage` is on-demand (command-controller.ts:461,481-483). The true gap — always-visible × ALL accounts × below-input — is genuinely new.

### C12 — belowEditor slot viable but empirically unproven (LanePremiseAudit P4, UPHELD-WITH-RESIDUAL). [PENDING-CRAFT-PROBE]
`hookWidgetContainerBelow` is the last child below the input, 0-height when empty, fully wired — but has ZERO in-tree `belowEditor` callers (autoresearch uses default `aboveEditor`), and short-terminal clipping under a tall transcript is unconfirmed. RESIDUAL — the single unknown not decidable from static source; a trivial `setWidget('probe',['x'],{placement:'belowEditor'})` in a live session (incl. a 10-row terminal) closes it. Deferred to craft (pre-craft is read-only).

### C13 — Multi-same-provider-account display is genuinely NOVEL (UX design risk). [VERIFIED — prior-art gap]
No surveyed tool renders >1 account of the SAME provider simultaneously (CodexBar `claude-swap` ≤4 opaque slots is the closest; aistat multi-account for Claude but single for Codex due to upstream credential-store limits). Combined with Codex #24080's UX lesson (render used/remaining/reset/window as ONE atomic compound token per window to avoid rollover desync) and C1's variable window durations, the layout/labeling is the design's least-precedented surface.
