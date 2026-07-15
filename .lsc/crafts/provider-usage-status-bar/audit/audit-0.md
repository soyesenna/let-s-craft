# Audit — provider-usage-status-bar (cycle 0)

## Header
- **Feature:** `provider-usage-status-bar`
- **Date:** 2026-07-15
- **Audit cycle:** N = 0 (first audit)
- **Mode:** `full` (no prior audit; N == 0)
- **Implementation branch:** `feat/provider-usage-status-bar`
- **Worktree:** `.lsc/worktrees/provider-usage-status-bar` (all artifacts, source, and this audit live inside it — C6/R5)
- **Base (merge target) branch:** `feat/lets-craft-v1` (detected via priority chain; `origin/HEAD` → `feat/lets-craft-v1`)
- **Prior audit:** none
- **Escape hatch:** not used — a worktree exists for this feature; every artifact path resolves under the worktree.
- **Implementation commits (since fork):** `9277cea` pure core (gather/view-model/render/controller), `b4ab76d` registrar + main.ts wiring, `8fd43f9` pi-ai 16.4.0 dep pin, `8942884` synced test-suite copies.

**AUDIT VERDICT: APPROVE-WITH-COMMENT**

> _Note for the Phase 7 E2E harness:_ the load-bearing verdict line above uses the exact prefix `**AUDIT VERDICT:` — grep `^\*\*AUDIT VERDICT:` to extract it. This is distinct from the `**VERDICT: ...**` line embedded inside the quoted `lsc-critic` report below (`ACCEPT-WITH-RESERVATIONS`, the agent's own 5-level scale). Do not match the critic's sub-verdict.

---

## Verdict rationale (§4.2)
Weighed in order of authority:
1. **Test re-verification (hard gate): PASS.** `run_test.sh` re-run green (build + 131 vitest + 9/9 Bun adapter-probe); e2e **Gate 0** additionally run under `LSC_E2E=1` → PASS. Passing tests permit an APPROVE-family verdict.
2. **`lsc-critic` verdict: ACCEPT-WITH-RESERVATIONS**, 0 CRITICAL / 0 MAJOR / 4 MINOR. Per the §4.2 correspondence, "ACCEPT-WITH-RESERVATIONS, or only MINOR/stylistic findings remain → audit **APPROVE-WITH-COMMENT**."
3. **`lsc-explore` findings** independently surface the same non-blocking gap (Gate 1 is manual/`it.skip`; adapter-probe identity coverage is single-account) — these do not upgrade severity; nothing raises a blocking concern.

Both compliance matrices are clean (all Met / all Pass). The only substantive reservation is the **deliberate, spec/plan-sanctioned** deferral of live-TUI behavior to a manual Gate 1 (no PTY/frame-capture harness exists), plus four MINOR code nits — all non-blocking. Hence **APPROVE-WITH-COMMENT**, not clean APPROVE (four reservations remain) and not APPROVE-WITH-CHANGE/REJECT (zero blocking defects).

**Convergence note (§3.3):** the main session's independent review and `lsc-critic` **independently** flagged the same `index.ts` `handleToggle` argument-scanning shim (critic Minor #2) — genuine convergence, higher confidence it is real-but-minor. The critic additionally found three MINOR items (#1 window-label fallback, #3 tiny-row width overflow, #4 lock noise), each re-verified against the cited code by the main session.

---

## Spec Compliance Matrix (main-session, file:line re-verified)
| AC | Requirement | Status | Evidence |
|---|---|---|---|
| AC1 | belowEditor placement; clears when no accounts | **Met** (live placement = Gate 1 manual) | `index.ts` `sink.renderCollapsed` → `setWidget(WIDGET_KEY, factory, {placement:"belowEditor"})`; empty path `controller.ts` `refresh` → `forceCloseExpanded`+`sink.clear`→`setWidget(undefined)` |
| AC2 | provider headers, per-account rows, email local-part, multi-same-provider, api-key fallback | **Met** | `view-model.ts accountLabel` (email split@; else accountId trunc; else `#position\|credentialId`); per-provider groups; `render.ts renderExpanded`/`packAccountText` |
| AC3 | `<label> <bar> <used%> <countdown>`, defined quantization | **Met** | `render.ts expandedWindowRow`/`cellText`; `miniBar` DR-E round; countdown from resetsAt |
| AC4 | subscription first/emphasized; non-sub dim/note; never fake 0% | **Met** | `view-model.ts` ordering (withSub groups first; sortedSubs then nonSubs); `buildNonSubscriptionVM note`; `render.ts accountStyle` strong/dim |
| AC5 | stale⇒dim+(stale); no-data/429/unavailable⇒—/n/a never 0% | **Met** (report-level `fetchedAt` lossy per F7, documented) | `view-model.ts buildSubscriptionVM` freshness; `render.ts` `- n/a`/window-na/(stale)+window-stale; fraction sanitize NaN/±Inf→undefined |
| AC6 | ~5min timer + turn_end + switch/branch re-render; race-safe; never rejects | **Met** | `controller.ts start` interval 5min; `index.ts` turn_end→refresh; switch/branch→lifecycleStart→start; epoch/abort/latest-wins + post-await try/catch; all callsites `void .catch` |
| AC7 | bounded collapsed (maxRows + near-first +N + width ladder + tiny ladder); expandable full | **Met** (rows≤maxRows by construction; live tune Gate 1) | `render.ts deriveMaxRows` (H≤1→0); `renderCollapsedBudget` byRisk+`+N more`; `renderTiny`; `packSubscriptionRow` width ladder; `renderExpanded` full |
| AC8 | no provider HTTP / no token; data only via authStorage | **Met** | `gather.ts` AuthStoragePort-only; EnumeratedAccount copies fields individually, never credential/token; regression asserts no fetch/URL/socket/token under `src/statusbar/` |
| AC9 | resolveUsedFraction injected+sanitized; window key all scope dims+limit.id; countdown from resetsAt | **Met** | `index.ts load` passes `resolveUsedFraction`; `view-model.ts windowKey` serializes 8 scope dims + `#window.id#limit.id`; `Number.isFinite` sanitize; `resetsAt=window.resetsAt` |
| AC10 | shortcut+slash both expand; overlay closes chord/Esc; whole subsystem hasUI-gated | **Met** (live keybind/overlay = Gate 1 manual; handleToggle shim → Non-blocking #2) | `index.ts` registerCommand+registerShortcut→handleToggle→toggleExpanded; `makeExpandedOverlay handleInput matchesKey(escape\|\|TOGGLE_CHORD)→done`; openExpanded+lifecycle+turn_end all hasUI-gated |
| AC11 | collapsed packing one row/account ·-joined; expanded one-per-line | **Met** | `render.ts packSubscriptionRow` SEP=" · "; `renderExpanded` one window/line |

## Constraints 1–6
| C | Requirement | Result | Evidence |
|---|---|---|---|
| C1 | omp-native data only | **Pass** | `gather.ts` sole `fetchUsageReports`; `AuthStorageSatisfiesPort` compile-time Assert |
| C2 | setWidget(belowEditor); never setFooter/Header/Status | **Pass** | `index.ts` uses only setWidget/ctx.ui.custom/ctx.ui.notify; grep `setFooter\|setHeader\|setStatus\|aboveEditor\|onTerminalInput` in `src/statusbar/` → 0 matches |
| C3 | OAuth-only; non-sub never 0% | **Pass** | non-sub → note + `windows:[]`; missing → undefined → n/a |
| C4 | cost bound ~TTL | **Pass** | `REFRESH_INTERVAL_MS = 5*60_000`; single host fetch/refresh, no independent provider load |
| C5 | bounded + non-destructive; re-render on session change | **Pass** (live = Gate 1) | deriveMaxRows bound; switch/branch→start; normal-buffer overlay |
| C6 | generic window handling; no hardcoded taxonomy | **Pass** | `windowKey` generic; label `window.label ?? window.id ?? limit.id`; grep window/provider literals → 0 matches |

## Plan Compliance Matrix (Steps §6 + load-bearing DRs)
| Item | Status | Notes |
|---|---|---|
| Step 1 controller | **Followed** | matches plan primitives verbatim (epoch/abort/latest-wins, forceCloseExpanded single owner, overlayGeneration, never-reject, toggle state) |
| Step 2 gather | **Followed +** | adds defensible OAuth-summary↔stored-cred credentialId **intersection** (rejects phantom summaries; tested) — a strict improvement over the plan's plain attach |
| Step 3 view-model | **Followed** | DR-F host-equivalent; trivial window-label deep-fallback deviation → Non-blocking #1 |
| Step 4 render | **Followed** | DR-E round + tiny-height ladder + packing + width ladder per plan |
| Step 5 wiring | **Followed** | two value imports (allowlist regression-enforced); toggle-handler shape deviation → Non-blocking #2 |
| DR-E round quantization | **Honored** | `render.ts miniBar` `round(clamp01(raw)*cells)` |
| DR-F identityUnsafe + singleton-fallback exclusion | **Honored** | `view-model.ts digestReport` (unique-Set, unsafeA conflict, unsafeB ≥2 distinct); `safe()` excludes unsafe+consumed from **all** tiers incl. singleton; consume-once. **No wrong-account path.** |
| DR-G forceClose/overlayGeneration/per-open ownDone | **Honored** | `controller.ts` + `index.ts openExpanded` (`activeDone===ownDone`); validated by controller suite + adapter-probe (f) |
| tiny-height ladder 0/1/2 | **Honored** | `deriveMaxRows` (H≤1⇒0); `renderTiny` (+N omitted when N===0) |
| whole-subsystem hasUI gate | **Honored** | all lifecycle + turn_end + toggle + openExpanded gated |
| never-rejecting refresh | **Honored** | post-await try/catch + `.catch` at every callsite |
| §9 test obligations | **Discharged (reorganized)** | isolation-structural→`statusbar-regression.test.ts`; isolation-behavioral→`statusbar-gather.test.ts`; pipeline fixture→`statusbar-pipeline.test.ts`; controller (a)-(j)→`statusbar-controller.test.ts`. The single `statusbar-isolation.test.ts` name from plan §4 is unused, but **all obligations are met** — not a gap. |

---

## Code Quality & Regression Risk
No CRITICAL, no MAJOR (both `lsc-critic` and the main session's independent pass agree). Positives verified directly:
- **No wrong-account path.** DR-F `identityUnsafe` (metadata/scope conflict, or ≥2 distinct account/project/org scope values) excludes a report from every tier **including the singleton fallback**; consumed-report exclusion; every comparison requires both sides defined. (`view-model.ts digestReport` + tiered match)
- **No overage/NaN crash.** `miniBar` clamps `[0,1]` before `repeat` (no RangeError at fraction=1.4); `usedPercent` floors negatives at 0; VM sanitizes NaN/±Inf→undefined→`n/a`.
- **Lifecycle race-safe & leak-free.** epoch + abort-previous + `running` guard + post-await try/catch; `overlayGeneration` + per-open `ownDone` identity guard prevent a stale overlay close from flipping a reopened overlay.
- **hasUI gate complete** across session_start/switch/branch, turn_end, toggle, openExpanded; `main.ts` wiring additive (preset session_start handler untouched; regression suite enforces).
- **package.json** +1 exact pin `@oh-my-pi/pi-ai: 16.4.0`; **no stray diff** beyond the feature (explore confirmed).

MINOR findings (all non-blocking, apply-only) are enumerated in **Non-blocking Considerations** below.

---

## Test Re-verification (§3.4)
Re-run independently by the audit (not trusting `.craft-state.json testsPassed:true`).

- **`lsc_run_tests` attempt:** `isError` — "no active craft for provider-usage-status-bar" (expected; this skill never calls `lsc_craft_init`). Fell back to bash per §3.4.
- **Command:** `bash run_test.sh` with `cwd = .lsc/worktrees/provider-usage-status-bar` (the worktree source root). **Exit 0.**
  ```
  === type gate: npm run build (tsc) ===            build : PASS
  === unit + integration + regression (vitest) ===
    ✓ statusbar-regression (13)  ✓ statusbar-gather (8)  ✓ statusbar-pipeline (9)
    ✓ statusbar-controller (22)  ✓ statusbar-view-model (40)  ✓ statusbar-render (39)
    Test Files  6 passed (6)      Tests  131 passed (131)
  === adapter probe (Bun fake-host of real registerUsageStatusBar) ===
    9/9 checks passed  (a subscribe set · a registration · b hasUI-inert · c belowEditor factory ·
    d shortcut/Esc · d command/chord · e empty-VM force-close+clear · f per-open ownDone · g reporter dedupe)
  === SUMMARY ===  build PASS · unit+integration+regression PASS · adapter probe PASS
    e2e Gate 0 SKIPPED (LSC_E2E unset) · e2e Gate 1 SKIPPED (manual)
  === RESULT: all run suites passed ===
  ```
- **Extra — e2e Gate 0 (blocking craft gate, never run in the recorded craft loop):** `LSC_E2E=1 npx vitest run test/statusbar-e2e.test.ts` (real omp 16.5.2; hermetic `--no-extensions --extension dist/main.js`) → **1 passed, 5 skipped**. Gate 0 (dist/main.js loads in a real Bun omp session with the two value imports + shortcut/command registration, no extension-load error) **PASSES**. The 5 Gate 1 probes are `it.skip` manual (need an interactive TTY / hasUI=true; no PTY-frame harness).
- **Gate:** re-run PASS → verdict not blocked from the APPROVE family.

---

## Non-blocking Considerations (APPROVE-WITH-COMMENT)
These are explicitly **not required** before merge. Surface to the user as follow-ups; consider addressing in a future touch-up or the next craft pass.

1. **Gate 1 live-TUI behavior is manual/unautomated (accepted, by design).** Five `it.skip` probes in `test/statusbar-e2e.test.ts` (collapsed-fits-at-~10-rows + prompt-visible; shortcut+command expand without typing into the prompt; overlay full-detail + chord/Esc close + normal-buffer restore; session_switch re-render; overlay teardown + stale-close guard). Print/RPC harness is `hasUI=false` with no PTY/frame capture, so these cannot be automated here. AC7 is additionally provable-by-construction + unit-tested; AC10's "chord does not type into the prompt" is the least-covered (a pure host-routing claim resting on omp contract V1). **Recommendation:** run Gate 1 manually in an interactive omp session with ≥1 logged-in account before relying on the bar in anger. This matches the spec's own testability note.
2. **`index.ts handleToggle` argument-scanning shim (critic Minor #2; independently flagged by the main session — convergence).** It scans `[...args, ctx]` for the first object with `hasUI`, to accommodate the adapter-probe calling `handler(ctx)` vs the host's `handler(args, ctx)`. Verified correct for both real signatures (`RegisteredCommand.handler=(args:string, ctx)`, `registerShortcut handler=(ctx)`, both contexts carry `hasUI`), but it is test-shaped and slightly more permissive than needed. **Optional fix:** use the plan's literal `handler: () => { if (ctx?.hasUI) controller.toggleExpanded(); }` for both registrations.
3. **`view-model.ts` window-label deep-fallback deviates from plan (critic Minor #1).** Code uses `limit.window.label ?? limit.window.id ?? limit.id`; plan Step 3.3 wrote `?? limit.label` as the final operand. `UsageWindow.id` is required, so the third operand is effectively unreachable — near-zero impact. **Optional fix:** `?? (limit.id ?? limit.label)` or add a justifying comment (silent plan deviation).
4. **`render.ts renderTiny` can emit one row wider than `width` on a sub-~10-column terminal (critic Minor #3).** It clips the packed text to `width - suffix.length` then appends the `· +N more` suffix; when `width < suffix.length` the row exceeds `width`. Every other collapsed path clips to `width`. Sub-10-col terminals are not realistic, so held MINOR. **Optional fix:** `return clip(packAccountText(...) + suffix, opts.width)`.
5. **`package-lock.json` incidental normalization noise (critic Minor #4).** Beyond the necessary `@oh-my-pi/pi-ai: 16.4.0` addition and the correct dev→prod re-marking of its subtree, ~30 optional/dev packages drop `libc[]`/`license` fields. **No `version`/`resolved`/`integrity` line changed** → `npm ci` stays deterministic and integrity-verified. **Optional hygiene:** regenerate the lock with the repo's pinned npm.
6. **Adapter-probe identity coverage is single-account (explore gap #3); adapter-probe runs only if `bun` is on PATH (critic).** The multi-account/conflict/`identityUnsafe` matrix is proven only in the pure `statusbar-view-model.test.ts`, not re-driven through the impure adapter; and `run_test.sh` SKIPs the Bun probe (loudly) when `bun` is absent. omp's runtime is Bun, so this is a soft gap.

## Proposed Spec/Plan Amendments (§6.2)
**None.** The audit found the implementation faithful to `spec.md`/`plan.md`; the four MINOR items are code-level nits (or a trivial code↔plan mismatch with near-zero impact, #1), not defects in the spec or plan themselves. No per-item amendment gate is raised.

---

## Full `lsc-explore` report (verbatim)

# provider-usage-status-bar — Code Map (AuditExplore)

Branch `feat/provider-usage-status-bar` vs base `feat/lets-craft-v1`. {W} = `/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/provider-usage-status-bar`. 10 commits (`d7b8b6d`→`8942884`); 33 files touched (9 `.lsc/crafts/` docs, 9 `.lsc/crafts/.../test/` canon incl. `run_test.sh`+`adapter-probe.mts`+7 vitest files, 5 `src/statusbar/*.ts`, `src/main.ts`, `package.json`, `package-lock.json`, 7 `test/statusbar-*.test.ts`). Full name-status confirmed — no stray files outside the feature scope.

## Findings

### File-by-file map (implementation modules)

| File | Role | Key exports | Purity |
|---|---|---|---|
| `{W}/src/statusbar/controller.ts` (A, 163ln) | Lifecycle state machine: latest-wins/epoch-guarded refresh, abort, force-close owner, interval arming, never-reject | `Clock`, `IntervalHandle`, `Scheduler`, `UsageWidgetSink`, `UsageLoader`, `Reporter`, `UsageControllerDeps`, `UsageBarController` (ifaces/types), `createUsageBarController(deps)` (factory) | **PURE** — `import type { UsageViewModel } from "./view-model.js"` (controller.ts:1); zero omp values |
| `{W}/src/statusbar/gather.ts` (A, 98ln) | Data-gather seam: enumerate stored creds, OAuth-identity intersection, one fetch, token-free copy | `StoredCredentialLike`, `OAuthAccountLike`, `AuthStoragePort`, `AuthStorageSatisfiesPort` (compile-time Assert), `gatherUsageInput(port, now, staleAfterMs, signal)` | **PURE** — `import type { AuthStorage, UsageReport } from "@oh-my-pi/pi-ai"` (gather.ts:1) + `import type {...} from "./view-model.js"` (gather.ts:2) |
| `{W}/src/statusbar/view-model.ts` (A, 289ln) | VM transform: DR-F attribution, full-scope window keying, fraction sanitize, subscription-first ordering | `UsedFractionResolver` (type), `EnumeratedAccount`, `UsageInput`, `WindowVM`, `AccountVM`, `ProviderGroup`, `UsageViewModel` (ifaces), `NEAR_LIMIT=0.75`, `buildUsageViewModel(input, resolveFraction)` | **PURE** — `import type { UsageLimit, UsageReport, UsageScope, UsageWindow } from "@oh-my-pi/pi-ai"` (view-model.ts:1) |
| `{W}/src/statusbar/render.ts` (A, 262ln) | Render layer: collapsed row-budget packing, expanded one-per-line, DR-E glyphs (▓░·…) | `RESERVE_ROWS=8`,`MIN_BAR_ROWS=1`,`MAX_BAR_ROWS=12`,`BAR_CELLS=5`, `RowStyle`(type), `RenderRow`,`RenderOptions`(ifaces), `miniBar`,`usedPercent`,`formatCountdown`,`localPart`,`deriveMaxRows`,`renderRows` | **PURE** — `import type {...} from "./view-model.js"` (render.ts:1); **no omp at all** |
| `{W}/src/statusbar/index.ts` (A, 224ln) | **IMPURE** registrar: wires the pipeline into the omp host (lifecycle, belowEditor widget, overlay, command, shortcut); dedupe reporter | `registerUsageStatusBar(pi)` | **IMPURE — sole value-import holder** |
| `{W}/src/main.ts` (M, +2) | Plugin entry; additive wiring point | — (modifies default export) | impure (pre-existing) |
| `{W}/package.json` (M, +1) | Declares the runtime dep the value import needs | `dependencies.@oh-my-pi/pi-ai` | — |

### Import / dependency graph of `src/statusbar/`

```
                       @oh-my-pi/pi-ai  (type: UsageLimit/Report/Scope/Window) ──┐
                                  ▲                                            │
                                  │                                   view-model.ts ◀── type ──┐
                                  └── type (AuthStorage/Report) ── gather.ts ─── value(EnumeratedAccount/UsageInput) ─┤
                                                                                       │          │
              controller.ts ─── type(UsageViewModel) ───────────────────────────────┘          │
                  ▲                                                                            │
       value(create,Reporter,Loader,Sink)                                                     │
       type                                                                                   │
                  │                                                                            │
              index.ts ──── value(gatherUsageInput, buildUsageViewModel, deriveMaxRows/renderRows) ─────────┘
                  │
                  ├── VALUE: resolveUsedFraction  ← @oh-my-pi/pi-ai/usage   (index.ts:5)
                  ├── VALUE: matchesKey           ← @oh-my-pi/pi-tui        (index.ts:6)
                  └── type: ExtensionAPI/Context/UiComponent/.../Theme/ThemeColor ← @oh-my-pi/pi-coding-agent ; KeyId ← @oh-my-pi/pi-tui (index.ts:8-16)
```

**Pure/impure boundary — VERIFIED:** the grep over `src/statusbar/` finds omp VALUE imports ONLY in `index.ts` — `resolveUsedFraction` (index.ts:5) + `matchesKey` (index.ts:6). `gather.ts:1` and `view-model.ts:1` are `import type`; `controller.ts:1` and `render.ts:1` import only local modules (`import type`). This satisfies the plan mandate that value imports be confined to `index.ts` ONLY. (Asserted structurally by `{W}/test/statusbar-regression.test.ts` `ompValueImportBindings` allowlist = exactly those two.)

### main.ts wiring point
`{W}/src/main.ts:12` adds `import { registerUsageStatusBar } from "./statusbar/index.js";` and `{W}/src/main.ts:33` calls `registerUsageStatusBar(pi);` inside the default export, alongside all pre-existing registrars (registerPresetCommand, registerHashManifestTools, registerRunTestsTool, registerCraftEnforcement, registerAskTools, registerCraftAbortTool, registerCraftReleaseTool) and the pre-existing preset `pi.on("session_start", …)` (~main.ts:28). **Additive — no substitution.**

### package.json
`{W}/package.json` `dependencies` = `{ "@oh-my-pi/pi-ai": "16.4.0", "yaml": "^2.9.0" }`. **`@oh-my-pi/pi-ai` pinned EXACTLY `16.4.0` (no caret/tilde)** — matches plan §3 F8/DR-C. NOTE: `@oh-my-pi/pi-coding-agent` is in `devDependencies` (also 16.4.0); `@oh-my-pi/pi-tui` is **NOT** directly declared anywhere in `package.json` (index.ts value-imports it transitively through the omp host).

### Relationship to the rest of the codebase
- **No collisions / no shared state.** The feature is a self-contained new dir `src/statusbar/`. `git diff --name-status` shows NO edits to `src/craft/`, `src/preset/`, `src/ask.ts`, `src/fixtures.ts`, `src/artifacts/`. The sole cross-module touch is the 2-line additive wiring in `src/main.ts`.
- **Module isolation** (asserted by regression test): no file outside `src/statusbar/` imports from it except `src/main.ts`, and main.ts reaches it ONLY via the public entry `./statusbar/index.js`.
- **Second `session_start` handler — by design, not a collision.** `main.ts` keeps its preset `pi.on("session_start")` (~main.ts:28); `registerUsageStatusBar` installs its OWN `pi.on("session_start", lifecycleStart)` (index.ts, alongside session_switch/branch/shutdown/turn_end). The host stores handlers array-per-event (plan §3/loader.d.ts:28), so the two coexist. The exact event subscription set is asserted by adapter-probe check (a): `[session_branch, session_shutdown, session_start, session_switch, turn_end]`.

## Test-coverage map

| Source module | Exercised by | Notes / uncovered paths |
|---|---|---|
| `controller.ts` | `{W}/test/statusbar-controller.test.ts` (9 describe blocks: start/interval/refresh, stop/teardown, generation-guarded latest-wins, refresh-never-rejects, empty-VM forceCloseExpanded, expanded toggle, overlayGeneration close→reopen→old-close, restart, inert-without-start hasUI gate); also the REAL controller is driven end-to-end through `adapter-probe.mts` | Well covered. Minor: `refresh(reason)` voids `reason` (controller.ts, `void reason`) — the reason string is never asserted. |
| `gather.ts` | `{W}/test/statusbar-gather.test.ts` (enumeration, usage-reports-verbatim, isolation-AC8); `{W}/.lsc/.../test/assets/test/adapter-probe.mts` (real gatherUsageInput via FakeAuthStorage full/empty/reject modes) | Well covered (port-only, token-free). |
| `view-model.ts` | `{W}/test/statusbar-view-model.test.ts` (sanitize matrix, full-scope window-key matrix, DR-F attribution sub-cases incl. identityUnsafe/singleton); `{W}/test/statusbar-pipeline.test.ts` (integration) | Comprehensive. |
| `render.ts` | `{W}/test/statusbar-render.test.ts`; `{W}/test/statusbar-pipeline.test.ts` (collapsed+expanded) | Comprehensive. |
| `index.ts` (**impure**) | `{W}/.lsc/.../test/assets/test/adapter-probe.mts` (Bun fake-host, 7 checks a–g); `{W}/test/statusbar-e2e.test.ts` Gate 0 (real omp, `LSC_E2E=1`); Gate 1 = **5 `it.skip` MANUAL probes** | **ZERO vitest-on-Node coverage — by design (DR-C: index.ts value-imports Bun-only runtimes).** Covered instead by the deterministic Bun probe (runs every craft iteration) + e2e Gate 0 (real-omp load smoke) + Gate 1 (manual). |

### Plan §9 named obligations — where each landed
- **Isolation suite** → `{W}/test/statusbar-regression.test.ts` (structural: no statusbar imports outside main.ts; value-import boundary = exactly 2 in index.ts; no fetch/URL/socket/token-field under `src/statusbar/`; dep pin `16.4.0`; additive registration + own session_start) **+** the behavioral AC8 case in `{W}/test/statusbar-gather.test.ts` ("gatherUsageInput — isolation (AC8)"). **PRESENT.**
- **Pipeline fixture** → `{W}/test/statusbar-pipeline.test.ts` ("end-to-end pure pipeline fixture": 4-provider UsageInput → `buildUsageViewModel` → `renderRows({expanded:false})` AND `renderRows({expanded:true})` — exactly plan §9 line 508). **PRESENT.**
- **Adapter identity ordering** → `{W}/.lsc/crafts/provider-usage-status-bar/test/assets/test/adapter-probe.mts` (Bun fake-host probe of the REAL `registerUsageStatusBar`; check (c) proves real `authStorage.fetchUsageReports` → identity match → `renderCollapsed` belowEditor; check (a) proves registration ordering). **PRESENT, with a scope note** (see gap #3 below).

### Coverage gaps / flags
1. **`index.ts` has no Node vitest test** (intentional). Its entire correctness rests on `adapter-probe.mts` (deterministic Bun, every iteration) + e2e Gate 0 (`LSC_E2E=1`, real omp) + Gate 1 (manual).
2. **Gate 1 (5 interactive TUI probes) is UNAUTOMATED** — `it.skip` in `{W}/test/statusbar-e2e.test.ts`: collapsed-fits-at-10-rows (1a), shortcut+command expand without typing (1b), overlay full-detail + chord/Esc close + normal-buffer restore (1c), session_switch re-render (1d), teardown + stale-overlay guard (1e). Needs an interactive Bun omp TTY; no PTY-frame harness exists in the repo.
3. **adapter-probe identity coverage is single-account.** Its fixture `fullReports()` = one anthropic account (`acc-1`/`user@example.com`, accountId AND email both match → DR-F-conformant, non-empty). The **multi-account ordering / conflict / `identityUnsafe` matrix** is exercised ONLY in the PURE `statusbar-view-model.test.ts`, not re-driven through the adapter. So "adapter identity ordering" as a multi-account contract lives in the pure layer; the adapter proves the identity path is fed end-to-end for one unambiguous account.
4. **Default `run_test.sh` path = `npm run build` (tsc type gate) + 6 vitest files (view-model/render/controller/gather/pipeline/regression — e2e EXCLUDED) + adapter-probe (if `bun` present).** e2e Gate 0 runs ONLY when `LSC_E2E=1`; Gate 1 is never automated. `adapter-probe.mts` is canon-only (`.lsc/.../test/assets/test/`) — it is NOT synced into `test/` because `run_test.sh` copies only `*.ts` and runs the probe directly via `bun` from its canon path.

### Stray / unintended changes
**None.** Beyond the feature scope, the only non-craft/non-test changes are `package.json` (+1 exact-pinned dep) and `package-lock.json` (~156 lines of lock churn for that single dep — consistent with one added dependency, not unrelated drift). No edits to any pre-existing `src/` module other than the 2 additive lines in `src/main.ts`. The `{W}/test/statusbar-*.test.ts` files are committed synced copies of the canon (commit `8942884`); `statusbar-e2e.test.ts` reuses the PRE-EXISTING `{W}/test/e2e-helpers.ts` (not added by this diff).

## Impact
- **Scope**: cross-module (new self-contained subsystem `src/statusbar/` + 2-line additive wiring into `src/main.ts` + 1 direct dep).
- **Risk**: low-to-medium. Pure core (4 modules) is heavily unit-tested; the single impure seam (`index.ts`) is isolated and Bun-probed; the only unautomated surface is the interactive TUI (Gate 1, documented manual).
- **Affected areas**: only `src/main.ts` (additive registration) and `package.json`/lock (one dep). No existing module's behavior changes.

## Recommendation
- Treat the code map as ground-truth for the spec/plan-compliance pass: the pure/impure boundary, value-import confinement to `index.ts`, exact `16.4.0` pin, additive main.ts wiring, and isolation are all **concretely verified and regression-asserted** — so the critic can focus on behavioral AC fidelity (AC1–AC11) and the documented manual-only Gate 1, not on structural wiring.

---

## Full `lsc-critic` report (verbatim)

**VERDICT: ACCEPT-WITH-RESERVATIONS**

{W} = /Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/provider-usage-status-bar

**Overall Assessment**: Faithful, high-quality realization of a heavily-deliberated plan. All AC1–AC11 Met, all six spec constraints pass, all five plan steps followed, and every load-bearing DR decision (DR-E round, DR-F identityUnsafe incl. singleton-fallback exclusion, DR-G forceCloseExpanded/overlayGeneration/per-open ownDone, tiny-height ladder, whole-subsystem hasUI gate, never-rejecting refresh) honored in code. No CRITICAL and no MAJOR defects: no wrong-account path, no overage/NaN crash, no lifecycle race, no teardown leak, no hasUI-gating hole, no manifest corruption. Test coverage comprehensive; plan §9 obligations all discharged, reorganized across regression+gather+pipeline+e2e+adapter-probe instead of the single statusbar-isolation.test.ts named in plan §4. Reservations: four MINOR items + the accepted gap that live-TUI behavior is Gate 1 manual.

**Pre-commitment Predictions**: Expected likely defects were (1) attribution wrong-account regression, (2) overage/NaN renderer crash, (3) lifecycle race / stale overlay onClose flipping a reopened overlay, (4) incomplete hasUI gate (headless turn_end fetch), (5) handleToggle shim mis-resolving the host (args,ctx) command signature, (6) noisy/incorrect lock churn. Actual: (1)–(4) correctly handled and well-tested; (5) functionally correct but a smell (Minor #2); (6) benign but noisy (Minor #4).

=== Compliance Matrix — AC1–AC11 (Requirement | Status | Notes@{W}) ===
AC1 belowEditor placement, only with ≥1 account | Met | src/statusbar/index.ts:122 setWidget(...,{placement:"belowEditor"}); empty→clear controller.ts:97-101 + index.ts:156; probe check (c) adapter-probe.mts; live=Gate1 manual.
AC2 headers/per-account rows/email local-part/multi-same-provider/api-key fallback | Met | accountLabel view-model.ts:148-158 (#position fallback :157); grouping view-model.ts:283-289; rows render.ts:199-206 (collapsed)/243-259 (expanded); multi-account proven statusbar-gather.test.ts.
AC3 per-window <label> <bar> <used%> <countdown> + defined quantization | Met | cellText render.ts:105-113; miniBar :49-54; usedPercent :57-59; formatCountdown :62-70; expanded one-per-line :227-237; all windows kept view-model.ts:173-184.
AC4 subscription first/emphasized; non-sub dim/note; never fake 0% | Met | ordering view-model.ts:270-286; note :194; styles render.ts:159-161 + index.ts:50-58; verified statusbar-pipeline.test.ts.
AC5 stale⇒dim+(stale); no-data/429/unavailable⇒—/n/a never 0%; unmatched emits row | Met | freshness view-model.ts:171 (report-level lossy F7); (stale) render.ts:154,246; unavailable→- n/a render.ts:152,251-253; window-na render.ts:105,228; undefined→n/a view-model.ts:176.
AC6 ~5-min timer+turn_end+switch/branch re-render; race-safe; never rejects | Met | interval+immediate refresh controller.ts:126-133; epoch/abort/latest-wins :80-105; .catch at :128,132 + index.ts:198; turn_end index.ts:195-199; switch/branch→start index.ts:174-176; F6 covered statusbar-controller.test.ts.
AC7 bounded collapsed (maxRows+near-limit-first +N+width ladder+tiny ladder); expandable | Met | deriveMaxRows render.ts:79-81 (H≤1⇒0); budget renderCollapsedBudget:189-212 (rows≤maxRows); tiny renderTiny:215-224; width ladder packSubscriptionRow:117-149; asserted statusbar-render.test.ts + pipeline; live prompt-visibility=construction+Gate1.
AC8 no provider HTTP/no token; data only via authStorage | Met | port-only token-free gather.ts:72-95; structural scan statusbar-regression.test.ts; behavioral (JSON no SECRET + fetch spy) statusbar-gather.test.ts.
AC9 injected resolveUsedFraction→sanitized; key all scope dims+limit.id; countdown from resetsAt | Met | resolver wired index.ts:114-115,118; sanitize view-model.ts:176; windowKey :136-153 (8 dims + #window.id#limit.id); countdown render.ts:112.
AC10 shortcut+slash both expand; overlay closes on same chord or Esc; whole subsystem TUI-only | Met | registerShortcut/Command index.ts:210-223; custom({overlay:true}) :128-137; chord/Esc handleInput+matchesKey :86-88; controller toggleExpanded/overlayGeneration controller.ts:135-152; hasUI gates index.ts:126,178,197,206-207; probe (b)(d)(d′)(f); live=Gate1.
AC11 collapsed packing (·-joined) vs expanded one-per-line | Met | packSubscriptionRow render.ts:115-149 (SEP :23); expanded :227-259; verified statusbar-pipeline.test.ts + statusbar-render.test.ts.

=== Compliance Matrix — Constraints 1–6 ===
C1 omp-native data only | Pass | gather.ts:96 sole fetchUsageReports; AuthStorageSatisfiesPort gather.ts:41-44; regression+gather suites.
C2 setWidget(belowEditor); never setFooter/Header/Status | Pass | index.ts:122; grep src/statusbar setFooter|setHeader|setStatus|aboveEditor|onTerminalInput → zero matches.
C3 OAuth-only; non-sub never 0% | Pass | non-sub note+windows:[] view-model.ts:188-195; missing→undefined→n/a :176.
C4 cost bound ~TTL | Pass | REFRESH_INTERVAL_MS=5*60_000 index.ts:37; single host fetch/refresh, no independent load.
C5 bounded+non-destructive; re-render on session change | Pass | budget render.ts:79-212; switch/branch→start index.ts:174-176; normal-buffer overlay; live=Gate1.
C6 generic window handling; no hardcoded taxonomy | Pass | windowKey view-model.ts:136-153; grep "5h"/"7d"/"monthly"/"weekly"+provider-equality → zero matches.

=== Plan-Compliance (Steps 1–5 + load-bearing DRs) ===
Step1 controller | Followed | controller.ts:60-155 matches plan primitives verbatim.
Step2 gather | Followed | gather.ts entire; adds defensible OAuth-summary↔stored-cred intersection gather.ts:64-70 (rejects phantom, tested).
Step3 view-model | Followed | view-model.ts entire; trivial window-label deep-fallback deviation (Minor #1).
Step4 render | Followed | render.ts entire; DR-E round + tiny ladder per plan.
Step5 wiring | Followed | index.ts entire; value-import allowlist enforced by regression suite; toggle-handler shape deviation (Minor #2).
DR-E round | Honored | miniBar render.ts:49-54.
DR-F identityUnsafe incl singleton-fallback exclusion | Honored | digestReport view-model.ts:90-127 (unique-Set :109-110, unsafeA :114, unsafeB :115); safe() excludes unsafe+consumed from all tiers AND singleton :221,259-262; c.length===1 + consume-once :222-253. No wrong-account path.
DR-G forceClose/overlayGeneration/per-open ownDone | Honored | controller.ts:71-78,135-152; adapter index.ts:127-153; validated statusbar-controller.test.ts + adapter-probe.mts (f).
tiny-height ladder 0/1/2 | Honored | deriveMaxRows render.ts:79-81; renderTiny :215-224 (+N omitted when N===0 :217).
whole-subsystem hasUI gate | Honored | index.ts:126,178,197,206-207; probe (b).
never-rejecting refresh | Honored | controller.ts:88-104 + .catch :128,132,198.
§9 obligations (isolation structural+behavioral; pipeline fixture; controller (a)-(j)) | Discharged (reorganized) | structural→statusbar-regression.test.ts; behavioral→statusbar-gather.test.ts (token-free+fetch-spy); pipeline→statusbar-pipeline.test.ts; controller (a)-(j)→statusbar-controller.test.ts. Single isolation file name unused but ALL obligations met — NOT a gap.

=== Critical Findings === None.
=== Major Findings === None. (ADVERSARIAL escalation considered and declined: no CRITICAL, zero MAJOR, no systemic pattern.)

=== Minor Findings ===
Minor #1 — window-label deep-fallback deviates (limit.id vs plan limit.label) but practically unreachable. view-model.ts:179 uses limit.window.label ?? limit.window.id ?? limit.id; plan Step 3.3 says ...?? limit.label. UsageWindow.id is required (pi-ai usage.d.ts:5-14) so third operand rarely reached. Confidence HIGH, impact near-zero; flagged as a silent plan deviation. Fix: limit.id → limit.id ?? limit.label at view-model.ts:179, or add justifying comment. [apply-only]
Minor #2 — handleToggle arg-scanning shim is test-shaped/over-built. index.ts:204-208 scans [...args,ctx] for first hasUI object; comment index.ts:200-203 ties shape to adapter-probe handler(ctx) vs host handler(args,ctx). Verified against real signatures: RegisteredCommand.handler=(args:string,ctx:ExtensionCommandContext) types.d.ts:627; registerShortcut handler=(ctx:ExtensionContext) types.d.ts:697-698; ExtensionCommandContext extends ExtensionContext so both carry hasUI (types.d.ts:245,274). Scan skips string arg, finds ctx, falls back to module ctx — correct for both. Functionally correct, not a bug; smell only. Fix: use plan form handler: () => { if (ctx?.hasUI) controller.toggleExpanded(); } for both registrations. [apply-only]
Minor #3 — renderTiny can emit one row wider than width on a <~10-col terminal. render.ts:218-220 clips packed text to Math.max(0,width-suffix.length) then appends the · +N more suffix; when width<suffix.length the row exceeds width and a TUI wrap could momentarily break rows≤maxRows (V7). Confidence MEDIUM; realist: sub-10-col terminals don't occur; every other collapsed path clips to width (render.ts:148,202,211). Fix: return clip(packAccountText(...)+suffix, opts.width) at render.ts:220. [apply-only]
Minor #4 — package-lock.json incidental npm-version normalization noise. Beyond the necessary +"@oh-my-pi/pi-ai":"16.4.0" and correct dev→prod re-marking of pi-ai's subtree, ~30 optional/dev packages lose libc[]/license fields (artifact://32 throughout). NO version/resolved/integrity line removed or changed → npm ci deterministic + integrity-verified. Fix: regenerate lock with the repo's pinned npm. [apply-only, optional hygiene]

=== What's Missing ===
- Live-TUI behavior has no automated proof (by design): AC1 live placement, AC7 live prompt-visibility, AC10 'chord does not type into prompt' live, session_switch re-render, overlay teardown are five it.skip manual probes (statusbar-e2e.test.ts:180-224) — print/RPC harness, hasUI===false, no PTY/frame capture. Rest on host contract V1/V6/V7 + human at Gate 1. AC7 additionally provable-by-construction + unit-tested (rows≤maxRows); AC10 'no prompt typing' is the least-covered (pure host-routing claim). Matches spec testability note — accepted, non-blocking.
- Impure index.ts SUT coverage is contingent on bun on PATH: run_test.sh runs adapter-probe.mts only if command -v bun, else SKIPPED without failing (test/run_test.sh). vitest FakeSink reimplements adapter behavior, so a wrong index.ts stays green under vitest alone. On a bun-less runner, per-open ownDone/hasUI-gate/overlay wiring loses automated coverage. Soft gap (loud SKIP; omp runtime is Bun).
- Real-vs-stub resolveUsedFraction divergence unexercised outside Gate 0: all pure suites inject a stub; real overage-capable normalizer (F1) runs only behind the value import at Gate 0/1. Accepted (AC9 mandates the exported fn).
- No last-good cache on transient reports===null: a single null fetch drops the whole bar to n/a until next success. Explicit §11 post-v1 follow-up, not a regression.

=== Multi-Perspective Notes ===
Executor: plan implementable verbatim; code mirrors plan pseudocode almost line-for-line. Two decision points diverge — gather OAuth×stored-cred intersection (strict improvement) and handleToggle shape (smell, Minor #2).
Stakeholder: feature solves the stated problem end-to-end; success criteria measurable and mostly automated. Honesty caveat: 'prompt stays visible' and 'chord doesn't steal typing' are the headline UX promises and both are Gate-1-manual, not automated.
Skeptic: the strongest counter-arguments — V7 off-screen scroll and F6 shared-fetch-outlives-abort — are both defeated (bounded-collapsed+overlay construction proof; epoch+running+abort guard with slow-then-fast + late-aborted-loader replays). Could not construct a surviving wrong-account or crash argument against DR-F/miniBar.

=== Verdict Justification ===
ACCEPT-WITH-RESERVATIONS, not clean ACCEPT, because four real-but-minor reservations remain (Minor #1 silent plan deviation, #2 test-shaped shim, #3 narrow-terminal row-overflow, #4 lock noise), none blocking. Not REVISE/REJECT: zero CRITICAL, zero MAJOR. Attribution is provably wrong-account-free (view-model.ts:114-124,221-262); renderer cannot crash on overage/NaN (render.ts:49-54 + view-model.ts:176); lifecycle race-safe and leak-free (controller.ts:80-152 + adapter index.ts:127-153); hasUI gate complete; main.ts wiring additive with preset handler untouched (main.ts:12,26; regression suite enforces); manifest change deterministic. Review operated in THOROUGH mode throughout — ADVERSARIAL escalation evaluated at Phase 4 and declined (no CRITICAL/MAJOR, no systemic pattern). Realist Check: Minor #3 held at MINOR (sub-10-col terminals don't occur; other paths clip to width); Minor #4 held at MINOR (no integrity/resolved/version changed). Upgrade to clean ACCEPT: apply Minor #1–#3 (apply-only) + regenerate lock (#4).

=== Open Questions (unscored) ===
- Does the host ever invoke the registerCommand handler with anything other than (args:string,ctx) (e.g., an arg-completion dry-run)? Low-confidence; the command-dispatch source is not present as .ts in this worktree's node_modules to fully trace.
- At Gate 1, does TOGGLE_CHORD="ctrl+n" (index.ts:46) collide with any user-configured binding or future omp default beyond the cleared defaults? /usage-bar is the collision-proof fallback — non-blocking.
- Is the bun-absent SKIP of adapter-probe acceptable as standing policy, or should the harness hard-fail when bun is missing so impure-adapter coverage is never silently lost?

(Consensus review summary row not applicable — post-craft implementation audit, not a plan/test agreement-loop review.)
