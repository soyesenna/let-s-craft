# Trace — provider-usage-status-bar

Feature idea (verbatim): **"lets-craft plugin 에 하단 상태바를 추가하고싶어. 위에 기본적으로 나오는 곳 말고 프롬프트 입력창 하단에 만들고싶어. 하단 상태바에서 보여주고 싶은 내용은, omp 에 provider 로 로그인 된 계정들의 5시간, 1week 사용량이야. omp 는 하나의 provider 여도 같은 provider (eg. anthropic, openai) 에 여러 계정을 등록할 수 있으니까, 그 계정들도 전부 보여줘야해."**

Classification: **BROWNFIELD** — tracked `src/` (the lets-craft omp plugin, entry `src/main.ts`) + a sibling omp harness checkout `oh-my-pi/` (separate gitignored repo) both exist with git history; this idea extends the existing plugin against the existing host. Reused verbatim by Stage 2 (interview) — do not re-classify.

Lanes: 3 (UI-render / usage-data / premise-audit) + a terrain scout + external research (1 saturation wave, 6 workers, converged — `research/`). All three lanes returned CONFIRMED/UPHELD verdicts; this is a **high-confidence** trace (Stage 2 uses the normal 3-point injection, not the low-confidence branch).

---

## 1. Observed Result

The user wants a **new, persistent status bar rendered below the prompt input box** (explicitly *not* omp's existing top status area) that shows, for **every logged-in provider account**, the **5-hour and 1-week usage**. A single provider (anthropic, openai, …) may hold **multiple accounts**, all of which must appear.

Current state of the two relevant systems:
- **lets-craft plugin** (`src/main.ts`): registers tools + a `session_start` hook and today only calls `ctx.ui.notify(...)`; it has never touched a UI widget, the auth store, or usage data.
- **omp host** (`oh-my-pi/`, published as `@oh-my-pi/*`): a TypeScript TUI (`pi-tui`) whose existing status bar renders as the editor's **top border** (`editor.setTopBorderProvider(StatusLine.getTopBorder)`) — this is the "위에 기본적으로 나오는 곳" the user contrasts against. omp *already* owns a full per-account usage subsystem (`AuthStorage.fetchUsageReports`) and a below-input render slot (`hookWidgetContainerBelow`), but its built-in usage display shows only the **active** account and is **off by default** (no shipped preset includes the `usage` segment).

The entering uncertainty was threefold: (a) can a *plugin* render a persistent bar below the input at all, or does this need omp-core changes? (b) where does per-account 5h/1week usage data come from, and can the plugin get it? (c) does the "every account" premise even hold?

## 2. Ranked Hypotheses (post-rebuttal)

| Rank | Hypothesis (interpretation × mechanism) | Confidence |
|---|---|---|
| **H1 (LEADING, verified)** | Build as a lets-craft **plugin** that reads omp's **native per-account usage** (`ctx.modelRegistry.authStorage.fetchUsageReports()` + `listStoredCredentials()`) and renders a persistent bar via **`ctx.ui.setWidget(key, content, {placement:'belowEditor'})`** on a plugin-driven `setInterval`. The plugin performs **no provider HTTP and handles no OAuth token** — omp does all fetching/persistence. | **HIGH** (all 3 lanes CONFIRMED against source) |
| H2 (rejected) | Plugin **independently calls provider endpoints** (`/api/oauth/usage`, `wham/usage`) + manages OAuth tokens + renders — the entire third-party-ecosystem pattern. | REJECTED (subsumed + risk-laden) |
| H3 (rejected) | Plugin infers usage from **local token logs** (ccusage/ccmonitor style). | REJECTED (weaker proxy, not subscription quota) |
| H4 (rejected) | Feature requires **omp-core changes** (no plugin surface exists for a below-input bar). | REJECTED (`setWidget(belowEditor)` is a public plugin surface) |

Premise correction cutting across all: **"every logged-in account has 5h/7d" is FALSE** — those windows are OAuth/subscription-only (see §4, C10).

## 3. Evidence Summary by Hypothesis

### H1 — native plugin path (verified end-to-end)
- **Render surface exists & is plugin-reachable**: `ctx.ui.setWidget(key: string, content: string[]|((tui,theme)=>Component)|undefined, {placement:'belowEditor'})` → `ExtensionUiController.setHookWidget` → `hookWidgetContainerBelow`, the **last child below the editor** in the interactive layout `statusContainer→statusLine→hookWidgetContainerAbove→editorContainer→hookWidgetContainerBelow` [omp: extensibility/extensions/types.ts:211,160-168; extension-ui-controller.ts:260-273; interactive-mode.ts:923-928] [Lane UI, Tier 1-2].
- **`ctx.ui` is a stable object** returned identically on every emit, held from `session_start` (main.ts:30 already uses it) → the plugin can drive its own `setInterval`; **omp exposes no periodic widget tick**. Live precedent: the bundled `autoresearch` extension's `updateWidget` (setWidget on a timer) and its overlay spinner (`setInterval(()=>requestRender())`) [omp: runner.ts:522-528; autoresearch/dashboard.ts:32-64] [Lane UI, Tier 1].
- **Data exists, per-account, both windows, all accounts**: `authStorage.fetchUsageReports()` returns `UsageReport[]` — one per account across all credentials (`#collectUsageRequests` builds one request per stored credential) — each `report.limits[]` carrying separate `window.id==='5h'` and `'7d'` `UsageLimit`s with `window.resetsAt` (epoch ms), normalizable via exported `resolveUsedFraction(limit)`→0..1, attributable via `report.metadata.email`/`accountId` [omp: auth-storage.ts:2873,2622-2671; usage.ts:97-113,53-64,14-23,120-129] [Lane Data, Tier 2].
- **omp owns HTTP/OAuth/persistence + header ingestion**: `AgentSession` uses the identical `authStorage.fetchUsageReports`/`ingestUsageHeaders`; the plugin's `ctx.modelRegistry.authStorage` is the **same shared instance** (single ModelRegistry wired by runner/main) → shared cache; the active Anthropic account is warmed free by 60s-gated response-header ingestion [omp: agent-session.ts:15672-15695; model-registry.d.ts:62-63] [Lane Data, Tier 2].
- **Cost is bounded** (resolves the sharpest unknown): `fetchUsageReports` is not a pure cache read but is guarded by a **5-min per-credential TTL (±25% jitter)** + per-credential & aggregate in-flight coalescing + **10s serve-stale-on-failure** + 24h last-good; all errors incl. 429 → null → serve-stale [omp: auth-storage.ts:558,2407-2451,2440-2444] [Lane Data, Tier 2]. So a render-timer poll degenerates to ≤1 network fetch per credential per ~5 min.
- **Ecosystem confirms the data shape & UX** (external): 5h/7d + `resets_at` is the canonical, machine-readable subscription-usage shape [S7][S6]; persistent-footer-below-input is a proven pattern incl. a Pi-ecosystem extension [S22][S23][S24].

### H2 — plugin-calls-endpoints (rejected)
- Mechanically possible: `/api/oauth/usage` (Anthropic) and `wham/usage` (Codex) return exactly the 5h/7d data, independently confirmed by ~8 OSS tools [S12][S5][S14]. **But** H1 subsumes its observable output *for free* via omp's native fetch, while H2 additionally incurs: (i) legal exposure — Anthropic forbids third parties routing requests via Pro/Max credentials [S30][S31]; (ii) reliability hazard — the endpoints persistently 429 with no `Retry-After` [S13][S29]; (iii) token-handling burden. omp already absorbs (ii) behind its TTL and neutralizes (i) by being the user's own native agent.

### H3 — local token-log inference (rejected)
- ccusage/ccmonitor reconstruct "5h blocks" (hour-floored, contiguous activity) and "weekly" (calendar bucket) from local JSONL — no server reset times, no cross-device usage; ccusage #658 + Claude Code costs docs state this is **not** subscription quota [S17][S18]. Strictly weaker than H1's authoritative server data; only relevant as a last-resort api-key fallback (out of scope, see §4).

### H4 — omp-core change required (rejected)
- The below-input slot and the usage API are both **public ExtensionAPI surfaces**; `setFooter`/`setHeader` are declared no-ops (dead `FooterComponent`), but `setWidget(belowEditor)` is fully wired and symmetric to the exercised `aboveEditor` path [omp: extension-ui-controller.ts:99-100,260-273] [Lane UI]. No core change needed.

## 4. Evidence Against / Missing Evidence

- **Against the "every account" premise (C10 — reshapes acceptance criteria):** 5h/7d windows are **OAuth-only** across every emitting provider — anthropic, openai-codex, google-gemini-cli, kimi-code [omp: claude.ts:595/501, openai-codex.ts:350/355, gemini.ts:198/201, kimi.ts:210/215]. API-key / Enterprise / Bedrock and api-key-only providers (zai/minimax-code/opencode-go) have **no** 5h/7d. `listOAuthAccounts` returns `[]` under an api-key override → must enumerate via `listStoredCredentials` and surface non-subscription accounts as "usage unavailable"/omit, mirroring omp's own `usage-cli` policy [omp: usage-cli.ts:281-309,702-712]. [Lane Premise P3, FALSIFIED — Tier 2].
- **Against display-only assumptions:** omp already shows usage in the top border, but only for the **active** account and **off by default** (no preset includes `usage`; component filters non-active provider/account) [omp: segments.ts:590-611; presets.ts:5,15-101; component.ts:878,884-888]. Confirms the request is *non-redundant* but also that partial overlap exists for a single-account user who manually enables it.
- **Missing (design intent — Stage 2 interview):** refresh cadence & staleness presentation; treatment of api-key/no-usage accounts (omit vs "unavailable"); layout for many accounts (compact rows / truncation / ordering / row budget); which windows to show (5h+7d only, or also monthly / model-scoped weekly buckets that omp returns); which providers to include; always-on vs toggle / interaction with the existing top `usage` segment.
- **Missing (empirical — deferred to craft):** whether a `belowEditor` widget stays **unclipped on short terminals** with a tall transcript — there is **zero in-tree `belowEditor` caller** (autoresearch uses `aboveEditor`), so this is unproven by any bundled feature [Lane Premise P4, residual].
- **Missing (runtime nuance):** no `fromCache`/`stale` flag on `UsageReport` (only `report.fetchedAt`); broker mode (`OMP_AUTH_BROKER_URL`) bypasses the local TTL (broker owns caching).

## 5. Rebuttal Round

**Challenger (H2, "the plugin should just call the endpoints like every other tool does") vs leader (H1):**
1. *Subsumption*: omp's `fetchUsageReports` already returns the identical per-account 5h/7d data H2 would fetch, so H2 buys nothing on output. Evidence: `authStorage.fetchUsageReports` covers all credentials [omp: auth-storage.ts:2622-2671].
2. *Risk asymmetry*: H2 uniquely takes on the legal restriction [S30][S31] and the documented persistent-429 fragility [S13][S29] and OAuth-token handling; H1 offloads all three to omp (which is the user's own native agent, and caps calls at a 5-min TTL).

**Leader's response:** none of H2's arguments survive — its only residual pull was "prior art does it this way," which is a statement about tools that *lack* a host API, not about a plugin that *has* one. **Outcome:** H2 stays rejected, not merged (it implies a different, worse code path). H3/H4 likewise rejected. H1 confirmed as leading with the C10 premise correction attached.

**Premise challenger (P3) vs the raw request:** the request says "every logged-in account." Challenge: api-key accounts have no 5h/7d. Rebuttal holds (OAuth-gated at every provider's `supports()`), so the acceptance criteria must distinguish subscription vs non-subscription accounts. This is a genuine correction, not a rejection of the feature.

## 6. Convergence / Separation Notes

- **Genuine convergence (independent streams, same conclusion):** the internal lane verification (omp source, Tier 2) and the external research (provider docs + ~15 OSS tools, gathered independently) converge on the *same* data model (per-account 5h/7d utilization + `resets_at`, OAuth-only) and the *same* UX conventions — this is real convergence, not shared phrasing.
- **Separation preserved:** H1 (native path) and H2 (endpoint path) are **not** merged — they imply different code paths and risk profiles. The premise findings stay separated: P2 ("all-accounts *data* exists") is true and distinct from P3 ("all accounts *have* 5h/7d"), which is false — conflating them would over-promise coverage. P1 (non-redundancy) and P2 converge on one root fact (data is all-accounts; only *display* is active-only).
- **All three lanes + scout independently land on the same integration seam:** `ctx.ui.setWidget(belowEditor)` for render + `ctx.modelRegistry.authStorage.{listStoredCredentials,fetchUsageReports}` for data, driven from `session_start` with a `setInterval` and a `session_switch` re-render.

## 7. Most Likely Explanation

**H1.** The feature is best built as a **lets-craft plugin** that, from its existing `session_start` hook, (1) enumerates all logged-in accounts via `ctx.modelRegistry.authStorage.listStoredCredentials()`, (2) reads per-account usage via `authStorage.fetchUsageReports()` (both 5h and 7d windows with reset timestamps, all accounts, OAuth-only), and (3) renders a persistent bar **below the prompt input** via `ctx.ui.setWidget(key, lines, {placement:'belowEditor'})`, refreshed on a plugin-owned `setInterval` (cadence ≈ omp's 5-min TTL) and re-drawn on `session_switch`/`session_branch`. **The plugin makes no provider HTTP calls and handles no OAuth tokens** — omp owns fetching, OAuth refresh, header ingestion, SQLite persistence, and TTL/serve-stale caching. This neutralizes the ecosystem's legal and 429 hazards. Acceptance criteria must account for the **OAuth-only** boundary (api-key/non-subscription accounts surfaced as "usage unavailable"/omitted) and the **multi-same-provider-account layout**, which is genuinely novel (no surveyed tool renders >1 account of the same provider). This verdict is design-shaped but structurally settled; the open items are UX/scope decisions for the interview plus one empirical clipping probe for craft.

## 8. Critical Unknown

**Per-lane critical unknowns** (Stage 2 lifts these into its first questions):

1. **[Lane Premise / scope — OAuth-only coverage]** The request says "every logged-in account," but 5h/7d exists only for OAuth/subscription accounts. How should the bar treat api-key / non-subscription / no-usage-endpoint accounts — omit them, or list them as "usage unavailable"? And which providers should it cover (anthropic, openai-codex, google-gemini-cli, kimi-code all expose usage)?
2. **[Lane UI / layout — multi-account rendering]** With N providers × M accounts × 2+ windows and a hard 10-line cap for string content, what layout does the user want (one compact row per account? grouped by provider? which fields — %, reset countdown, plan/email label?), and how should it degrade when it doesn't fit (truncate / prioritize / scroll)? This is the least-precedented surface.
3. **[Lane Data / freshness — refresh & staleness]** What refresh cadence and staleness behavior does the user want (poll ≈5 min to match omp's TTL; show a "stale"/countdown indicator; how to render an account that 429'd or has no fresh data)? Also: show only 5h+7d, or also monthly / model-scoped weekly buckets that omp returns?

Synthesis-level residual (empirical, deferred to craft, not an interview question): does a `belowEditor` widget stay visible/unclipped on short terminals under a tall transcript?

## 9. Recommended Discriminating Probe

1. **Zero-cost, first (interview):** the three §8 questions — they resolve scope (OAuth-only handling), layout, and freshness, which are user-intent decisions, not discoverable from code.
2. **One live probe (defer to craft — pre-craft is read-only):** from the plugin's `session_start`, `setInterval(()=>ctx.ui.setWidget('lsc-usage', ['probe '+Date.now()], {placement:'belowEditor'}), 1000)` in a real omp session, observed at normal height AND a ~10-row terminal with a tall transcript. This single probe simultaneously confirms (a) the line renders below the input, (b) it live-updates, and (c) the row/truncation budget and clipping behavior — closing the only residual structural unknown (P4).
3. **Cheap read probe (plan/craft):** in a scratch context, call `ctx.modelRegistry.authStorage.fetchUsageReports()` twice back-to-back and inspect the returned `UsageReport[]` shape + timing — confirms the exact `limits[]`/`window`/`scope` fields to render and that the second call is cache-fast (validates the TTL cost model).

## 10. Additional Trace Lanes

None required. Residual uncertainty is (1) user intent on scope/layout/freshness — owned by Stage 2, and (2) one empirical clipping probe — deliberately deferred past pre-craft's read-only boundary to craft. All feasibility questions converged at Tier 2.

---

# Lane Sub-Reports

## Lane 1 — Code-path / UI-rendering (LaneUiRender) — VERDICT: CONFIRMED
- **Hypothesis:** a plugin can render a persistent, refreshed bar below the input via `ctx.ui.setWidget(..., {placement:'belowEditor'})`; `setFooter`/`setHeader` are no-ops; `setStatus` renders above.
- **Verified signatures:** `setWidget(key: string, content: string[]|ExtensionUiComponentFactory|undefined, options?: {placement?: 'aboveEditor'|'belowEditor'}): void` (types.ts:211,160-168). `string[]` hard-capped at `MAX_WIDGET_LINES=10` (+"... (widget truncated)"); factory components uncapped. Re-calling same `key` **replaces**; `undefined` **clears**; each call → `#rebuildHookWidgets` → `requestRender` (extension-ui-controller.ts:260-302).
- **Layout CONFIRMED:** `hookWidgetContainerBelow` added after `editorContainer` (interactive-mode.ts:923-928) → renders below the prompt. `setFooter`/`setHeader` are literal empty no-ops (controller:99-100; also headless/RPC/ACP); `FooterComponent` has zero callsites (dead). `setStatus` → top border area (component.ts:1311-1324).
- **Refresh (highest-value):** omp has **no periodic widget tick** — plugin-driven. Pattern A: re-call `setWidget` on a `setInterval` (precedent autoresearch dashboard.ts:32-54). Pattern B: `setWidget` once with a factory capturing the `tui` (which *does* have `requestRender`, unlike `ctx.ui`) + `setInterval(()=>tui.requestRender())`. Events (`agent_end`/`turn_end`/`message_end`/`after_provider_request`) refresh on activity only; wall-clock resets need `setInterval`.
- **ctx.ui lifetime:** stable object held from `session_start` (main.ts:30). Caveat: `newSession`/`switchSession` calls `clearHookWidgets` → re-render on `session_switch`/`session_branch` (types.ts:1006/1011).
- **Critical unknown:** row/truncation budget with many accounts (string[] capped at 10; factory uncapped but competes with transcript for rows) — terminal-height-dependent. **Confidence:** High (Tier 1-2, live precedent exercises the exact path).

## Lane 2 — Config / orchestration / data (LaneUsageData) — VERDICT: CONFIRMED
- **Hypothesis:** the plugin enumerates ALL accounts and reads per-account 5h+7d usage purely via `ctx.modelRegistry.authStorage`, no provider HTTP / no token handling.
- **Enumeration:** `listOAuthAccounts(provider): OAuthAccountSummary[]` = `{position, credentialId, accountId?, email?, projectId?, enterpriseUrl?}`, OAuth-only, per-provider, synchronous local read (auth-storage.ts:4251, no token refresh). `listStoredCredentials(provider?): StoredAuthCredential[]` = `{id, provider, credential:{type,...}, disabledCause}`, ALL providers incl. api_key (auth-storage.ts:1813) — **use this for full enumeration**.
- **Usage:** `fetchUsageReports({baseUrlResolver?, signal?}): Promise<UsageReport[]|null>` (auth-storage.ts:2873). `UsageReport = {provider, fetchedAt, limits: UsageLimit[], resetCredits?, notes?, metadata?, raw?}`; `UsageLimit = {id, label, scope, window?, amount, status?, notes?}`; `UsageWindow = {id:'5h'|'7d'|'monthly'|…, label, durationMs?, resetsAt?(epoch ms)}` (usage.ts:97-113,53-64,14-23). Both 5h and 7d present as separate `UsageLimit`s by `window.id`; multi-bucket weekly = multiple `7d` entries by `scope.tier/modelId`. Normalize utilization via exported `resolveUsedFraction(limit)`→0..1 (usage.ts:120-129). Covers ALL accounts (one request per credential, `#collectUsageRequests` 2622-2671); active-only is purely a *display* filter elsewhere. No omp `extra_usage` field — folded into extra `UsageLimit`s/`notes`.
- **Cost model (critical unknown, resolved):** NOT a pure cache read — live provider HTTP per credential whose 5-min TTL elapsed, but bounded by `USAGE_REPORT_TTL_MS=5min ±25% jitter` + per-credential & aggregate in-flight coalescing + `USAGE_FAILURE_BACKOFF_MS=10s` serve-stale + 24h last-good; all errors incl. 429 caught→null→serve-stale (auth-storage.ts:558,574,2407-2451). Active Anthropic account header-warmed (60s-gated). Safe on a render timer; cadence ≥5 min = zero extra provider load. Broker mode bypasses local TTL. **Residual:** no `fromCache`/`stale` flag (only `report.fetchedAt`).
- **Reachability:** `ExtensionContext.modelRegistry: ModelRegistry` → `readonly authStorage: AuthStorage`; all needed methods are public (not `#private`); same instance as `AgentSession` → shared cache (model-registry.d.ts:62-63; agent-session.ts:15672-15695). **Confidence:** High (Tier 2, primary source).

## Lane 3 — Measurement / premise-audit (LanePremiseAudit)
- **Entity dimensions:** provider × account-identity × credential-type (OAuth vs api_key) × usage-window. The request collapses to a simple render only if credential-type is ignored — which it cannot be.
- **P1 non-redundancy — UPHELD (Strong):** `usage` segment exists (segments.ts:590-611) but in NO shipped preset (presets.ts:5,15-101) and active-account-only when on (component.ts:878,884-888); `/usage` is on-demand (command-controller.ts:461,481-483). True gap = always-visible × ALL accounts × below-input.
- **P2 all-vs-active data — UPHELD (Strong):** `fetchUsageReports` fans out per-credential; `usage_history` keyed `(provider, account_key, limit_id)` (auth-storage.ts:5374-5388, 2458-2478); active-only is a display filter, not a data limit.
- **P3 api-key accounts — FALSIFIED (Strong):** 5h/7d is OAuth-only (claude.ts:595/501, openai-codex.ts:350/355, gemini.ts:198/201, kimi.ts:210/215); api-key accounts have none; enumerate via `listStoredCredentials`, surface non-subscription as "unavailable"/omit (usage-cli.ts:281-309,702-712). **Reshapes acceptance criteria.**
- **P4 below-input visibility — UPHELD-WITH-RESIDUAL (Moderate):** fully wired, last child, 0-height when empty (extension-ui-controller.ts:300,312-317); but zero in-tree `belowEditor` callers and short-terminal clipping unconfirmed — one cheap live probe closes it.
- **Confidence:** P1/P2/P3 Tier 2; P4 mechanics Tier 2, in-practice Tier 4-5 (probe needed).

---

# External Research Summary

Full journal with per-claim citations: **`research/SYNTHESIS.md`** (6 workers, 1 saturation wave, converged; claim status in `research/claim-graph.md`, raw findings in `research/observation-manifest.md`, wave log + convergence rationale in `research/waves/wave-1.md`).

Conclusions in brief:
1. **The 5h/1week windows are the canonical *subscription* usage limits** (not API rate limits), machine-readable as `used_percentage` (0–100) + `resets_at` per window, with **provider/plan-dependent durations** (label inferred from returned duration, not hardcoded) — official Claude Code statusline schema (v2.1.80) and OpenAI Codex `RateLimitWindow`. API-key `anthropic-ratelimit-*`/`x-ratelimit-*` headers are per-minute RPM/TPM, **not** 5h/7d.
2. **Every third-party tool re-implements provider calls** (undocumented `api.anthropic.com/api/oauth/usage`; internal `chatgpt.com/backend-api/wham/usage`) or falls back to weaker local-log inference / dashboard scraping. These endpoints **persistently 429** and are **legally restricted** for third-party products.
3. **omp collapses all of this into a native call** (`authStorage.fetchUsageReports`), which the plugin reads — sidestepping both the 429 fragility (omp's 5-min TTL + serve-stale) and the legal hazard (omp is the user's own native agent; the plugin never routes credentials). This is the decisive reason to prefer H1 over the ecosystem's H2 pattern.
4. **5h/7d is OAuth/subscription-only**; api-key/Enterprise/Bedrock accounts have no such quota — the bar must distinguish and surface non-subscription accounts explicitly.
5. **Persistent-footer-below-input is a proven UX pattern** (Gemini CLI Ink footer, OpenTUI split-footer, a Pi-ecosystem raw-ANSI extension), but **no surveyed tool renders multiple accounts of the same provider** — the multi-same-provider-account layout is genuinely novel and the design's main UX risk. UX conventions to adopt: compact per-account rows, width-aware truncation, color thresholds, reset countdown, and rendering each window's used/remaining/reset **atomically** to avoid rollover desync.
