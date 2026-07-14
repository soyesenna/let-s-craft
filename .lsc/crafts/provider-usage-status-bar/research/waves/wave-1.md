# Wave 1 — Saturation wave

## Roster (6 lsc-librarian workers)
| Worker | Axis | Outcome |
|---|---|---|
| ResAnthropicUsage | Anthropic 5h/7d acquisition (official + unofficial) | Yielded. Official CC statusline `rate_limits.five_hour/seven_day` (v2.1.80); unofficial `/api/oauth/usage` + unified `/v1/messages` headers; Admin usage API = historical proxy only; API-key `anthropic-ratelimit-*` ≠ subscription. |
| ResOpenAIUsage | OpenAI/Codex usage acquisition | Yielded (final IRC). Codex `/wham/usage` & `/api/codex/usage` (primary=5h/secondary=weekly `used_percent`/`limit_window_seconds`/`reset_at`); app-server `account/rateLimits/read`; API-key `x-ratelimit-*` = per-minute only; Admin Usage API = historical. |
| ResPriorArtUsageTools | Prior-art tools (compute + display) | Yielded (final IRC). ccusage/ccmonitor = local proxy (calendar-week, hour-floored 5h); claudeline/claude-hud/ccstatusline = native-stdin-first; AgentLimits = internal APIs. |
| ResOAuthSubUsage | OAuth subscription remaining-quota endpoints | Yielded. Server snapshot machine-readable (CC statusline official; oauth/usage + wham/usage unofficial); legal caveat; safe order server→countdown→local. |
| ResRepoDiveUsage | External OSS code (windowing/multi-account) | Yielded. ccusage windowing; CodexBar multi-account (`claude-swap`, opaque per-slot identity, ≤4 items, api-key rows flagged unavailable); Maciek monitor `(kind,account)` keying + SHA256 dedupe warehouse. |
| ResTuiFooterPriorArt | Persistent bottom-footer rendering | Yielded (final IRC). pi-powerline-footer (Pi extension, raw-ANSI reserve-bottom + scroll-region); Gemini CLI Ink `<Footer/>`; OpenTUI split-footer; Crush Bubble Tea; ccstatusline multi-line/truncation. |

Delivery note: workers front-loaded findings via IRC throughout the wave; formal reports at `agent://Res*`. Findings integrated into `observation-manifest.md` and `claim-graph.md`.

## EXPAND leads harvested + disposition
- **Anthropic schema drift (flat `seven_day_*` → structured `limits[]`)** — RESOLVED (C2). Disposition: MOOT for the plugin — omp's `pi-ai` parser (`claude.ts`) already normalizes both into `UsageLimit[]`; plugin renders `limits[]` generically.
- **oauth/usage 429 / legal risk** — RESOLVED (C5/C6). Disposition: MOOT for the plugin — omp owns the fetch (LaneUsageData); the plugin never calls provider endpoints, so the 429/legal exposure is omp's, not the plugin's.
- **Codex `/wham/usage` version/path drift** — RESOLVED (C5). Disposition: MOOT — omp's `openai-codex.ts` provider impl owns it.
- **Multi-same-provider-account display** — CONFIRMED GAP (no surveyed tool renders >1 account of the same provider; CodexBar `claude-swap` ≤4 opaque slots is the closest). Disposition: carried into the trace as a genuine novelty / design-risk note; no further external lead exists to chase.
- **Persistent bottom-footer rendering mechanism** — RESOLVED via internal discovery (C7/LaneUiRender): omp's native `setWidget(belowEditor)` supersedes the raw-ANSI prior-art approaches; external footer prior art retained only as UX/layout guidance.

## Convergence decision (orchestrator)
**CONVERGED at wave 1 (saturation), no external expansion waves run — documented deviation from the rote "≥2 expansion waves" default, justified below:**
1. **Saturation reached:** the final IRC rounds were heavily corroborative (same endpoints/algorithms re-confirmed from new independent sources) with no new mechanism; three workers yielded with mutually consistent conclusions matching `claim-graph.md` C1–C9.
2. **Pivot moved all load-bearing uncertainty INTERNAL:** the terrain scout + all 3 lane tracers VERIFIED that omp natively (a) fetches per-account 5h/7d usage (`authStorage.fetchUsageReports`, cost-bounded, all accounts) and (b) exposes a below-input render surface (`ctx.ui.setWidget(belowEditor)`). The plugin therefore reads omp's own data and never calls a provider endpoint. Every open external lead above is consequently MOOT for the implementation.
3. **The genuine "expansion" was executed as internal lane verification** (LaneUiRender / LaneUsageData / LanePremiseAudit), which is where the remaining uncertainty actually lived — not in more web waves. Spawning 2–3 further 6-worker external waves to re-confirm provider-endpoint minutiae with zero design impact would be busywork, contrary to the "optimize for correctness, don't do busywork" principle.
4. **No open external lead could change the design.** Domain/UX semantics are saturated; the one residual open question (short-terminal clipping of a `belowEditor` widget, P4) is an INTERNAL empirical probe deferred to the craft phase (pre-craft is read-only), not an external research question.
