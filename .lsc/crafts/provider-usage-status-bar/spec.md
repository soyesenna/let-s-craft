# Spec — provider-usage-status-bar

## Metadata
- **Feature:** `provider-usage-status-bar`
- **Classification:** BROWNFIELD (reused from trace.md — a lets-craft omp plugin extending an existing host)
- **Mode:** live (no `LSC_FIXTURE`)
- **Trace:** `trace.md` (H1 verified by 3 lanes; research journal `research/`)
- **Interview:** 7 rounds; ambiguity gate (**strictly < 0.05**) cleared at **4.15%**; hard cap (20) NOT reached.
- **Challenge modes fired:** Contrarian (R4), Simplifier (R6). Ontologist not fired (ambiguity ≤ 0.3 throughout).

## Clarity Breakdown (final)
| Dimension | Score | Weight | Weighted | Residual gap |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | none material — display-only, always-show-all-with-degrade |
| Constraints | 0.95 | 0.25 | 0.238 | provider-scope & refresh-cadence are informed defaults (recorded below) |
| Success Criteria | 0.97 | 0.25 | 0.243 | none material — layout/format/identity/staleness all decided |
| Context | 0.95 | 0.15 | 0.143 | sole residual = P4 short-terminal clipping — an empirical craft-time probe, not a spec ambiguity |
| **ambiguity = 1 − Σweighted** | | | **0.0415** | **< 0.05 ✓** |

Formula (brownfield): `ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15)`.

## Topology
Single component (`UsageStatusBar`). No sub-component rotation was needed; all seven interview rounds targeted the one component's weakest dimension.

## Goal
Add a **persistent, collapsible status bar rendered directly below the omp prompt input** (via `ctx.ui.setWidget(..., {placement:'belowEditor'})`, NOT the existing top status border) showing, for **every logged-in provider account** (including multiple accounts of the same provider), each account's usage across **all usage windows omp reports** (5h / 7d / model-weekly / monthly / extra). **By default it is a bounded, compact SUMMARY** (row-capped so it does not push the prompt off-screen); the user can **toggle it expanded to full per-account detail and back**, via a keyboard shortcut AND a slash command (the built-in `autoresearch` dashboard pattern). It reads omp's own data only (no provider interaction).

## Constraints
1. **omp-native data only.** The plugin MUST obtain all account and usage data through `ctx.modelRegistry.authStorage` (`listStoredCredentials`, `listOAuthAccounts`, `fetchUsageReports`). It MUST NOT make any provider HTTP request and MUST NOT read or handle any OAuth token / credential file itself. (Legal + reliability rationale: trace C6/C5 — the provider usage endpoints are undocumented, 429-prone, and third-party OAuth routing is prohibited; omp already owns fetching as the user's native agent.)
2. **Render surface.** MUST use `ctx.ui.setWidget(key, content, {placement:'belowEditor'})`. MUST NOT use `setFooter`/`setHeader` (no-ops) or `setStatus` (renders in the top border).
3. **OAuth-only reality.** 5h/7d (and all subscription windows) exist ONLY for OAuth/subscription accounts. Non-subscription (API-key/Enterprise/Bedrock/no-usage-endpoint) accounts have no such data and MUST NOT be shown as `0%`.
4. **Cost bound.** Refresh cadence MUST NOT exceed omp's usage cost budget — poll aligned to omp's ~5-min per-credential TTL; rely on omp's coalescing/serve-stale rather than adding independent provider load.
5. **Bounded default; non-destructive.** In its default (collapsed) state the bar MUST be **row-bounded** so the prompt input stays visible — it MUST NOT push the prompt off-screen in normal use. Expanding to full detail is an explicit user action (AC10) and MAY use more rows or a fullscreen overlay. The bar MUST NEVER corrupt/garble the prompt or transcript, and MUST re-render on session change (omp clears hook widgets on new/switch session). Rationale: omp shows only the last `terminal-height` rows of an oversized frame (tui.ts:2705-2764), so an unbounded below-editor widget would scroll the prompt into scrollback — hence the collapsed cap.
6. **Generic window handling.** MUST render windows generically keyed by `window.id`/`scope` (5h/7d/model-weekly/monthly/extra), normalizing utilization via the exported `resolveUsedFraction` — MUST NOT hardcode a fixed bucket taxonomy (provider/plan-dependent, drifts upstream).

## Non-Goals
- Not calling provider usage endpoints directly, not managing OAuth tokens, not scraping dashboards, not reconstructing usage from local token logs (all rejected in trace: H2/H3).
- Not replacing or modifying omp's existing top-border usage segment or the `/usage` command.
- Interactivity is limited to **expand/collapse of the whole bar** (keyboard shortcut + slash command, A12/AC10). Out of scope: per-account clicking / mouse interaction (omp does not route clicks to a below-editor widget), inline account switching, or editing — display + expand/collapse only.
- Not modifying omp core (`oh-my-pi/`) — this is a plugin-only change in `src/`.
- Not an API-key billing/cost tracker (subscription quota ≠ API billing; trace C3).

## Acceptance Criteria
1. **Placement:** With ≥1 logged-in account, the bar renders in `hookWidgetContainerBelow` (below the prompt input), not the top status area.
2. **Grouping & identity:** Accounts are grouped under a per-provider header; each account renders on its own indented row labeled by its **email local-part** (e.g. `user`, `user.work`); multiple accounts of the same provider each get a distinct row.
3. **Per-window format:** For each usage window of a subscription account, render `<window-label> <mini-bar> <used%> <reset-countdown>` (illustrative: `5h ▓▓░░░ 33% 2h10m` — exact mini-bar quantization defined in plan DR-E, not asserted verbatim), for every window omp returns (5h, 7d, model-weekly, monthly, extra).
4. **Ordering & emphasis:** Subscription (OAuth) accounts are emphasized and ordered first; non-subscription accounts appear after, **dimmed/compact**, present but without usage windows (or an explicit "no usage" marker) — never fabricated as 0%.
5. **Staleness/errors:** A window whose cached data is older than the TTL renders dimmed with a `(stale)` marker; a window with no data / a 429 / an unavailable account renders `—`/`n/a` (never `0%`).
6. **Refresh:** The bar updates on a ~5-min timer (aligned to omp's TTL) and re-renders when the active account is refreshed via omp's header-warming; it re-renders on `session_switch`/`session_branch`.
7. **Overflow & degradation (A12 — bounded collapsed, expandable):** The **collapsed (default) view is row-bounded** to a budget derived from terminal height (reserving rows for editor/transcript) so the prompt stays visible: accounts beyond the budget collapse into a `+N more` line, near-limit accounts/windows first. Per-row **width** degradation still applies (width ladder: drop reset-countdown from non-near-limit windows → shrink mini-bar → drop mini-bar → keep near-limit). The **expanded view** (user toggle, AC10) shows every account × every window in full and MAY exceed the collapsed budget and/or render as a fullscreen overlay (planner's choice; `autoresearch` precedent). The renderer takes `width` AND a `maxRows` budget (collapsed); expanded passes an unbounded/overlay budget. Never corrupt the prompt/transcript (C5). Live reflow/overlay behavior is the P4 craft probe.
8. **Isolation:** The plugin issues no provider HTTP and touches no OAuth token — verified by the data flowing solely through `authStorage` APIs.
9. **Data mapping:** Utilization is normalized via `resolveUsedFraction(limit)`→0..1; windows are keyed by `window.id`/`scope` (no hardcoded bucket names); reset countdown derived from `window.resetsAt`.
10. **Interactivity (expand → collapse):** The bar defaults to **collapsed** (bounded summary). A **keyboard shortcut** (a non-reserved chord via `pi.registerShortcut`, verified at implementation time against TUI/app/runner/bundled bindings; MUST NOT steal prompt typing or shadow an editor binding) and a **slash command** (`pi.registerCommand`) both **expand** it to full detail. When the expanded view is a **focused overlay** it owns input, so it closes via the **same shortcut chord or `Esc`** (the overlay's own `handleInput`) — the slash command cannot be typed while modal; net: both transports trigger expansion, and closing is always available via the shortcut or `Esc` (the `autoresearch` Ctrl+X-inline + Ctrl+Shift+X-overlay pattern). (If expanded is instead a non-modal below-render, both transports toggle both directions.) **The ENTIRE subsystem — polling, widget, and input handlers — is `ctx.hasUI`-gated and MUST NOT start when `hasUI=false` (headless/RPC), where overlays/shortcuts are unavailable anyway.**
11. **Collapsed density (packing):** The collapsed view SHOULD pack an account's windows compactly — one row per account, windows joined by ` · ` (e.g. `user  5h ▓▓░░░ 33% · 7d ▓▓▓░░ 60%`) — so the common multi-account case fits the row budget without a `+N more` collapse; the expanded view uses the fuller one-window-per-line layout.

Testability note (feeds Stage 4): criteria 2–5, 7 (pure width-ladder + row-budget/`+N` packing), 9, and 11 (collapsed packing) are unit-testable on the pure data→display transform with fixture `UsageReport` inputs + a given `(width, maxRows)`; criteria 1, 6, 10 (live below-editor placement, refresh cadence, keybind/slash toggle re-render) and the collapsed-fits/prompt-visible behavior are integration/manual — the P4 craft probe verifies the collapsed bar keeps the prompt visible and expand/collapse works, confirming the expanded view's reflow-vs-overlay behavior live.

## Assumptions Exposed & Resolved
**Resolved by interview (see transcript):**
- **A1 [R1] Account coverage:** show ALL accounts; subscription accounts emphasized, non-subscription dimmed/compact (not hidden). Exposes the collision between the user's "show all accounts" and the OAuth-only data reality.
- **A2 [R2] Layout:** provider-grouped headers + indented per-account rows (aistat style) — makes the multi-account-per-provider structure explicit.
- **A3 [R3] Window scope:** show ALL windows omp returns (5h/7d/model-weekly/monthly/extra), rendered generically.
- **A4 [R4 Contrarian] Density framing:** always show all, but auto-condense on narrow terminals (near-limit priority) — confirms display-only and rejects a "summary-only" reframe.
- **A5 [R5] Per-window format:** mini-bar + used% + reset countdown.
- **A6 [R6 Simplifier] Identity label:** email local-part (distinguishes same-provider accounts, compact).
- **A7 [R7] Staleness/errors:** serve-stale + dim + `(stale)`; unavailable/429 → `—`/`n/a`.
- **A11 [SUPERSEDED by A12] Height/overflow policy (unbounded grow):** originally 'no summary, grow vertically, prompt may be pushed up.' SUPERSEDED after the architect/critic proved (tui.ts:2705-2764) that an oversized below-editor frame scrolls the prompt fully OFF-SCREEN (not merely 'up') and hides leading account rows — a stronger consequence than the user had accepted.
- **A12 [review+user-driven; SUPERSEDES A11; overrides the 'display-only' aspect of A4/Goal] Bounded + interactive:** the bar defaults to a **row-bounded compact summary** (prompt stays visible; accounts beyond budget → `+N more`, near-limit first; windows packed per-account row) and is **expandable to full detail and collapsible**, triggered by BOTH a keyboard shortcut AND a slash command (built-in `autoresearch` dashboard pattern: `setWidget` re-render on an expanded flag). Mouse-click to the below-editor widget is infeasible (omp routes input only to the focused editor; no click hit-test) — hence keybind + command. Expanded view MAY be a fullscreen overlay (planner's choice). This resolves the AC2×AC3×AC7 viewport contradiction by bounding the default footprint rather than sacrificing prompt visibility.

**Informed defaults (low-risk, recorded here rather than asked):**
- **A8 Provider scope:** all providers omp exposes usage for that have logged-in accounts — anthropic, openai-codex, google-gemini-cli, kimi-code. Rationale: the user wrote "eg. anthropic, openai" (examples, not an exhaustive list) and asked for "accounts logged into omp as providers"; trace confirms omp gates usage on these four.
- **A9 Refresh cadence:** poll ≈5 min (aligned to omp's `USAGE_REPORT_TTL_MS`), plus opportunistic re-render when omp header-warms the active account. Rationale: trace cost model — cadence ≥ TTL = zero extra provider load; faster is cache-hit-dominated but pointless.
- **A10 Data path / mechanism:** `fetchUsageReports` for data; a **factory Component** (not `string[]`) for rendering, to bypass the 10-line `string[]` cap given grouped multi-account × multi-window content; widget set from `session_start`, refreshed via `setInterval`. Rationale: trace LaneUiRender (factory uncapped; `autoresearch` precedent) + A3/A2 density.

## Technical Context (from trace — verified omp APIs)
- **Render:** `ctx.ui.setWidget(key: string, content: string[] | ((tui,theme)=>Component) | undefined, {placement:'belowEditor'})` → `hookWidgetContainerBelow` (below the editor). `string[]` capped at 10 lines; factory components uncapped. Re-call same key replaces; `undefined` clears; each call triggers render. `ctx.ui` is stable from `session_start`; omp has no periodic widget tick (plugin drives `setInterval`); widgets cleared on `newSession`/`switchSession` → re-render on `session_switch`/`session_branch`. Precedent: `autoresearch` dashboard.
- **Accounts:** `authStorage.listStoredCredentials(provider?)` → all providers incl. api_key (`{id, provider, credential:{type}, disabledCause}`); `authStorage.listOAuthAccounts(provider)` → OAuth-only (`{position, credentialId, accountId?, email?, projectId?}`).
- **Usage:** `authStorage.fetchUsageReports({signal?})` → `UsageReport[]` (all accounts), each `report.limits[]` of `UsageLimit {id, label, scope, window?, amount, status?}`; `UsageWindow {id, label, durationMs?, resetsAt?(epoch ms)}`; normalize with `resolveUsedFraction(limit)`→0..1; attribute via `report.metadata.email`/`accountId`. Cost bounded: 5-min per-credential TTL + jitter + coalescing + 10s serve-stale + 24h last-good; all errors incl. 429 → serve-stale. Reachable as the SAME shared `AuthStorage` instance the host uses.
- **Existing state:** the built-in `usage` status segment renders only the active account, in the top border, and is excluded from every shipped preset. `/usage` shows all accounts on demand. This feature is non-redundant (always-visible × all-accounts × below-input).

## Trace Findings (link)
Full analysis in `trace.md`. Load-bearing conclusions:
- **H1 (adopted):** native-plugin path — read omp's per-account usage, render via `setWidget(belowEditor)`. H2 (plugin calls endpoints) and H3 (local-log inference) rejected.
- **C10:** "every account has 5h/7d" is false — OAuth-only; drives A1/AC-4.
- **P4 (residual, deferred to craft):** whether a `belowEditor` widget stays unclipped on short terminals with a tall transcript — no in-tree `belowEditor` caller exists; resolve with a live probe during craft.

## Ontology
Core entities (stable from R2–R3; later rounds refined rendering/policy without disturbing the core):
- **UsageStatusBar** — the below-input widget (a factory Component).
- **Provider** — anthropic / openai-codex / google-gemini-cli / kimi-code.
- **ProviderAccount** — a logged-in account; ≥1 per provider; identified by email local-part; has a **CredentialType** (oauth=subscription | api_key=non-subscription).
- **UsageWindow** — 5h / 7d / model-weekly / monthly / extra; carries used-fraction + `resetsAt`.
- **WindowRendering** — mini-bar + used% + reset-countdown.
- **FreshnessState** — fresh | stale | unavailable.
- **DegradationPolicy** — auto-condense on narrow terminal, near-limit priority.
- **RefreshCycle** — setInterval (~5 min) + session/turn events + session_switch re-render.

### Ontology Convergence
| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 5 | — | — | 5 | — | N/A |
| 2 | 7 | 5 | 0 | 2 | 0 | 0.71 |
| 3 | 7 | 6 | 1 | 0 | 0 | 1.00 |
| 4 | 8 | 7 | 0 | 1 | 0 | 0.88 |
| 5 | 9 | 8 | 0 | 1 | 0 | 0.89 |
| 6 | 9 | 8 | 1 | 0 | 0 | 1.00 |
| 7 | 10 | 9 | 0 | 1 | 0 | 0.90 |

Interpretation: the core domain (bar, account, provider, window, credential-type) converged by R2–R3 (ratio ≥ 0.71, hitting 1.0 at R3); R4–R7 added rendering/policy/freshness concepts (DegradationPolicy, WindowRendering, FreshnessState) and refined labels without disturbing the core — final ratio 0.90 with no removals, indicating stable convergence rather than churn.

## Interview Transcript
**Injection (Stage 1 → 2):** initial-idea enrichment used H1 as trace's most-likely explanation (high-confidence branch); codebase context = trace synthesis; first 3 questions = trace §8 per-lane critical unknowns (scope / layout / freshness).

**R1 [Constraints] — account coverage.** Q: 5h/7d exists only for OAuth accounts; how to treat api-key/non-subscription accounts? → **Decision: emphasize subscription accounts, show non-subscription dimmed/compact** (option 3). Bottleneck: OAuth-only reality reshapes acceptance (trace C10).

**R2 [Success Criteria] — layout.** Q: layout for multiple accounts (10-line string cap)? → **Decision: provider-grouped headers + indented per-account rows (aistat style)** (option 2). Bottleneck: multi-same-provider-account display is the least-precedented surface (trace C13).

**R3 [Constraints] — window scope.** Q: which windows (omp returns more than 5h/7d)? → **Decision: show ALL windows omp returns** (option 3). Bottleneck: window scope drives bar density.

**R4 [Goal] — CONTRARIAN.** Q: is "always show everything" the right framing, or habitual? behavior when many accounts/windows? → **Decision: always show all, but auto-condense on narrow terminals (near-limit priority)** (option 3). Confirms display-only; rejects summary-only reframe.

**R5 [Success Criteria] — per-window format.** Q: format per window? → **Decision: mini-bar + used% + reset countdown** (`5h ▓▓▓░░ 33% 2h10m`) (option 3).

**R6 [Success Criteria] — SIMPLIFIER.** Q: simplest account label that still distinguishes same-provider accounts? → **Decision: email local-part** (`user`, `user.work`) (option 2).

**R7 [Success Criteria] — staleness/errors.** Q: display when stale/absent/429? → **Decision: serve-stale + dim + `(stale)`; unavailable/429 → `—`/`n/a`** (option 1). Matches prior-art consensus (never conflate stale/absent with 0%).

Gate cleared after R7 at 4.15% (< 5%), with A8–A10 set as informed defaults. Hard cap (20) not reached; no round-cap caveat applies.
