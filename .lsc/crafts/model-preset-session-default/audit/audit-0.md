# Audit — model-preset-session-default

| Field | Value |
|---|---|
| Feature | model-preset-session-default |
| Date | 2026-07-13 |
| Audit cycle | 0 (first audit — full mode) |
| Implementation | worktree `.lsc/worktrees/model-preset-session-default/` · branch `feat/model-preset-session-default` (7 commits `b560cf0..deb639f`) |
| Base branch | `feat/lets-craft-v1` (origin/HEAD) |
| Mode | **full** |
| Prior audit | none (N=0) |
| Host under audit | installed omp **16.4.8** (pinned dep 16.4.0) |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

> Note for the Phase 7 harness: the `**VERDICT: ...**` lines further below are `lsc-critic`'s embedded sub-verdicts, not this audit's judgment — grep `^\*\*AUDIT VERDICT:` only.

## 1. Spec Compliance Matrix (verified row-by-row by the main session — every cited location read directly)

| AC | Requirement | Status | Notes |
|---|---|---|---|
| AC1 | 신규 세션 turn-1 메인 모델 = preset default | **Met (live-verified)** | impl `main.ts:37-47`; contracted e2e **executed in this audit** (user-approved, plugin symlink temporarily repointed): first assistant `message_end` = `zai`/`glm-4.5-flash` = E2E_DEFAULT_MODEL — assertion passed on live omp 16.4.8. This also live-validates the fresh gate against real 16.4.8 boot-stamp shapes and `pi.setModel`-at-session_start turn-1 visibility (trace C7/C14 execution unknowns → observed) |
| AC2 | 미지정 lsc 에이전트 스폰 모델 = default | **Partial** | impl correct (`session-default.ts:33` session_init exclusion; no frontmatter/override for tracer); e2e executed and the tracer assertion **failed for an environment reason, not an implementation defect**: tracer spawned on `openai-codex/gpt-5.6-sol` = the user's own `~/.omp/agent/config.yml:12` `modelRoles.task` — on live 16.4.8, a user-configured host-level task-role model outranks parent-live inheritance for task-spawned agents. The AC's inheritance premise (trace C5 chain, pinned 16.4.0) holds only when `modelRoles.task` is unset. Test premise is environment-fragile → Required Fix |
| AC3 | switch 즉시 전환 | **Met** | unit leg executed (order/pairing pins, `preset-session-default.test.ts`); spec's proxy leg (AC1 e2e, same primitive via session_start) now executed and passed live; reinject wiring verified by direct read (`command.ts:155,178`) |
| AC4 | resume 무간섭 · 수동 /model 우선 | **Met** | gate matrix ①–⑦ green (`preset-session-default.test.ts:36-92`); mid-session non-interference is structural (no re-apply code outside the gate; no polling — verified by read); strengthened predicate deviation user-ACK'd (open-questions.md RESOLVED) |
| AC5 | resolve 실패 소프트 처리 | **Met** | short-circuit pins green; inject-level 독립성 pins green (`preset-inject.test.ts`); auto path `console.warn` = spec-quiet (`main.ts:48-51`), explicit path `ctx.ui.notify` warning (`command.ts:120-123`) — both read directly |
| AC6 | 레거시 평면 파싱 무파손 | **Met** | tolerant-parse pins green (`preset-models.test.ts`); `writeCheapModelPreset` untouched → 기존 3개 e2e가 라이브 회귀 감시 겸임 |
| AC7 | default C13 검증 + 예약 키 가드 | **Met** | `validate.ts:56-82` read directly — slash format incl. trailing-slash corner (:59), effort, resolvability, dual reserved-key guard (:74-82) + loop skip (:85); 14/14 unit green |
| AC8 | summarize 표시 + create/edit default 최우선 | **Met** | summarize exported + 2 unit pins green; default-first flow verified by read (`command.ts:77-100` buildPreset); AC8's flow leg is code-review-scoped per spec |
| AC9 | 문서/라벨 갱신 | **Met** | `command.ts:23-24` SKIP_LABEL/DEFAULT_SKIP_LABEL = user-ACK'd exact strings; README §model preset + 신규 '세션 default 모델' 절; `_docs/spec.md:46-49` fallback 서술 갱신 — all read |

## 2. Plan Compliance Matrix

| Step / Item | Status | Notes |
|---|---|---|
| Step 0 probe | **Partial** | authored + committed (`scripts/spike-session-default-probe.sh`, 192L, 5 scenarios incl. cycle-resume + direct-Model no-key); executed but 0/5 observations (isolated `--profile` lacks zai key — honest disclosure in commit `b560cf0`; log only in volatile `/tmp`). **Materially superseded**: this audit's live e2e observed the two load-bearing unknowns the probe targeted (gate true on real fresh boot; setModel turn-1 visibility) |
| Step 1 schema | Met | `models-file.ts:21-26,65-71,91-102,120-128` — PresetEntry, isPresetEntryShape, normalize-to-absent (incl. `default:null`), tolerant flat parse (C2 preserve), merge `??` + conditional spread, save unchanged |
| Step 2 validate | Met | see AC7 |
| Step 3 pure module | Met | `session-default.ts:6-79` read in full — gate 3-condition incl. count bound (:30-39), Assert proof (:47-58, enforced by build), state machine + pairing (:67-79), SDK value-import 0 |
| Step 4 wiring | Met | inject 3-path defaultSpec (:32,:40,:48); main.ts gated auto-apply + unconditional override re-apply + LSC_DEBUG histogram (:52-56); command reinject `applyDefaultFor` + name-match (:111) |
| Step 5 UX/docs | Met | all checklist items present; MINOR effort-title regression (below) |
| Step 6 e2e | **Partial** | artifacts complete + registered (`package.json:16`); pass-path executed once in this audit → AC1 half green, AC2 half env-blocked (Required Fix) |
| ADR | Met | incl. landing-ACK obtained pre-implementation |
| M1 reinject gating | Met | switch always (:155) / create pre-capture `autoActivated=!file.active` (:171) + conditional (:178) / edit (:200), delete (:219) never — read directly |
| Fresh gate (강화 술어) | Met | 3 conditions + count bound; **live-passed on 16.4.8** (AC1 e2e implies gate=true on a real fresh boot) |
| Guardrails Must-Have / Must-NOT-Have | Met | sync inject preserved; no persisted modelRoles writes; no snapshot/폴링/락; scoped tests only (`grep` hunt for hard-coded test-aware output: clean — only env read is LSC_DEBUG) |

## 3. Code Quality & Regression Risk (synthesis)

**Convergence (independent, higher-confidence):** both agents independently confirmed — clean worktree (7 commits, no strays), canon↔worktree test byte-match, 66/66 unit + tsc seam-proof reproduction, every diff hunk 1:1 traceable to a plan step, zero dead code, zero plan-required-missing items.

**Findings (from lsc-critic, severities preserved; none upgraded by lsc-explore):**
- ~~MAJOR — runtime evidence leg unexecuted~~ → **restated after the audit's own e2e run**: AC1/gate/setModel now live-verified; the residual concrete defect is the **AC2 e2e premise fragility vs `modelRoles.task`** (drives the verdict; see Required Fix).
- MINOR — `main.ts:50` `console.warn` vs plan Step-4 pseudo-code `ctx.ui.notify`: plan was internally contradictory (§2 AC5 + R10 say quiet); impl resolved toward spec. Deviation note absent from commit `7f2f078` body. No action required beyond the plan amendment below.
- MINOR — `session-default.ts:76` unchecked `effort as EffortLevel | null` cast in an exported primitive: safe at both current call sites (validated upstream), unguarded for future callers.
- MINOR — effort-prompt title regression via `pickModelSpec` generalization: `Effort for Model for executor …` (`command.ts:58`) — awkward label, cosmetic.
- MINOR — probe attempt log only in `/tmp` (volatile).

**lsc-explore's uncovered-changed-paths register (plan-sanctioned code-review-only surfaces, recorded for future witnesses):** main.ts console.warn / LSC_DEBUG branches; command.ts reinject wrapper + 4 run* call sites + interactive flows; validate trailing-slash corner (impl present `validate.ts:59`, no dedicated unit); gate `service_tier_change` dup corner (2/3 stamp types dup-tested).

**Regression risk to untouched behavior:** LOW — spike suite 7/7 green; `writeCheapModelPreset` flat format untouched (live sentinel); settings write path unchanged (`override` only, asserted).

## 4. Test Re-verification (§3.4)

1. **Authoritative suite re-run** (`lsc_run_tests`, run-3, log `.../test/logs/run-3.log`): **PASS exit 0** — build (tsc) PASS, unit **66/66** across 6 files, e2e gated off by design.
2. **Contracted e2e leg — executed within this audit** (user-approved via `[Audit] … Proceed?` = yes; plugin symlink repointed to the worktree for the run and restored immediately after; `E2E_EXIT=1`, duration 57.8s):
   - **AC1 assertions PASSED live** (parent turn-1 assistant = `zai` + `glm-4.5-flash`, separate-field assertions).
   - **AC2 tracer assertion FAILED**: `expected 'openai-codex' to be 'zai'` — root cause pinned to `~/.omp/agent/config.yml:12` → `modelRoles.task: openai-codex/gpt-5.6-sol:max` (user host config) taking precedence over parent-live inheritance for task-spawned agents on omp 16.4.8. Explore-agent override assertion did not run (fail-fast before it); its mechanism is spike-proven + unit-covered.
3. **Hard gate consequence (§4.2.1):** an executed, failing contracted verification bars APPROVE/APPROVE-WITH-COMMENT → verdict is APPROVE-WITH-CHANGE (scoped, prescribable, no implementation-code change).

## 5. Required Fix (drives the next, narrower fix-verification cycle — §5 scope narrowing is the pipeline's own design)

The implementation source needs **no change**. The fix targets the protected test canon + docs:

1. **Hermeticize the AC2 e2e against user host config** — in the protected canon `test/assets/test/e2e-helpers.ts`, the omp-invocation config overlay used by `runOmpPrint` (the file `syncModeConfigPath()` writes) must additionally pin `modelRoles: { task: "default" }`. The literal `"default"` is the host's documented session-inherited sentinel (`model-resolver.ts:871-873`: empty/`default`/`pi/default` → inherit), so task-spawned agents inherit the parent live model regardless of the operator's `config.yml`, making AC2's inheritance assertion environment-independent. (Rejected alternatives: pinning `modelRoles.task` to E2E_DEFAULT_MODEL — tautologizes the assertion; env-aware expected values — makes the test assert different contracts per machine.)
2. **Protected-tree ownership:** that file is pre-craft-owned, hash-protected canon. The amendment must be applied outside this session's armed tool-call block (user editor, or a fresh session before the next craft run — `lsc_craft_init` recomputes the manifest at init, so a pre-craft-style user-approved canon edit made before re-init is legitimate and violation-free). Post-craft (this skill) does not edit it; craft's executor cannot.
3. **Re-run acceptance:** one credentialed `LSC_E2E=1` run of `run_test.sh` (worktree cwd; symlink repoint + restore per the script's own remediation text) must pass **both** AC1 and AC2 assertions.
4. **Housekeeping (same cycle):** copy the Step-0 probe attempt log out of `/tmp` into a durable location (e.g. the audit dir); optionally re-run the probe with credentials for the remaining un-observed scenarios (cycle-resume counterexample, no-key false path).

## 6. Rejection Rationale

n/a (verdict is not REJECT).

## 7. Non-blocking Considerations

n/a for gating (verdict is not APPROVE-WITH-COMMENT); the three cosmetic MINORs in §3 (cast guard, effort-title label, console-warn commit-note) are recorded for an eventual cleanup commit but are explicitly not part of the Required Fix.

## 8. Proposed Spec/Plan Amendments (per-item user gates follow in-session; dispositions recorded by the amendment log in each file)

1. **[Spec Change]** spec.md AC2 + Goal 서술에 발견 사실 반영: task-스폰 에이전트는 사용자의 host-수준 `modelRoles.task` 설정이 있으면 그것을 부모-live 상속보다 우선한다(omp 16.4.8 실측; 호스트 설계 법칙 "명시적 사용자 설정 > 프리셋"과 일관). AC2의 상속 계약은 "host task-role 미설정 시" 조건부로 명시하고, e2e는 hermetic overlay(`modelRoles.task: "default"`) 하에서 검증한다.
2. **[Plan Change]** plan.md 리스크 레지스터에 R11 추가: 라이브 호스트의 task-role 우선순위 상호작용 + e2e hermeticization 요구(§5 Required Fix 1 내용); Step 4 auto-path notify 채널의 계획 내 모순(pseudo-code vs 합성 계약 ③)은 합성 계약 쪽이 정본임을 각주로 명시.

## 9. Full lsc-explore report (verbatim)

```json
{"report":"# Code Mapping — model-preset-session-default (post-craft cycle 0)","scope":"diff feat/lets-craft-v1...feat/model-preset-session-default, implRoot=/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/model-preset-session-default","git_state":"CLEAN — git status: 커밋할 사항 없음 on feat/model-preset-session-default; 7 commits, all committed; no uncommitted hunks.","canon_byte_match":"All 7 worktree test/ copies BYTE-MATCH the protected canon (e2e-helpers.ts, e2e-preset-default.test.ts, preset-command.test.ts, preset-inject.test.ts, preset-models.test.ts, preset-session-default.test.ts, preset-validate.test.ts — all MATCH). run_test.sh re-syncs canon → test/ each run (self-healing).","suite_evidence":"run-3.log: build PASS (tsc, enforces SessionApiSatisfiesHost seam proof); unit 66/66 PASS across 6 files (spike 7, command 2, session-default 18, validate 14, models 19, inject 6); e2e SKIPPED in that run (LSC_E2E unset).","files":"[17-file mapping with per-file commit/plan-step/summary/seams — src/preset/session-default.ts (NEW, Step 3), models-file.ts (Step 1), validate.ts (Step 2), inject.ts + main.ts + command.ts (Step 4/5), 7 test assets (deb639f), package.json (Step 6), README.md + _docs/spec.md (Step 5/AC9), scripts/spike-session-default-probe.sh (Step 0) — full text preserved at agent://AuditExplore lines 1-224]","coverage_matrix":{"models_file_parse":"9/10 branches COVERED; agents-as-string edge handled via validate guard (parse-time preservation untested, behaviorally inert)","merge_default_precedence":"3/3 covered; erase = Non-Goal by design","validate_default_guards":"6/7 covered; trailing-slash corner (slash===len-1) has no dedicated unit (impl present)","session_default_gate":"conditions i/ii/iii covered; service_tier_change dup not explicitly tested (2/3 dup types)","applySessionDefaultModel":"6/6 covered","inject_defaultSpec_all_return_paths":"6/6 covered","main_ts_session_start_gate_wiring":"predicate unit-covered; main.ts CALL SITE code-review only; applied path e2e-gated; console.warn + LSC_DEBUG branches ZERO automated coverage","command_ts_reinject":"summarize covered; reinject wrapper + all 4 run* call sites + interactive flows NO automated coverage (plan-sanctioned code-review)","package_json_e2e_registration":"VERIFIED by diff","docs_vs_plan_step5":"ALL checklist items present"},"uncovered_changed_paths":["main.ts:46-50 console.warn branch","main.ts:52-54 LSC_DEBUG histogram branch","command.ts reinject wrapper incl. appliedDefault notify","command.ts run* wiring incl. runCreate autoActivated capture","command.ts reinject unresolved/no-key notify branch","command.ts interactive flows (AC8 code-review)","validate.ts trailing-slash corner","session-default.ts service_tier_change dup corner"],"dead_code":"NONE","untraceable_hunks":"NONE — every hunk maps 1:1 to a plan step; 7 commits each a coherent unit","plan_required_but_missing":"NONE (test delivery exceeded plan scope-count — over-delivery, not gap)","deviations_from_plan_snippet":[{"item":"main.ts auto-path failure notify channel","detail":"Plan Step 4 snippet showed ctx.ui.notify; impl uses console.warn — CONSISTENT with plan 합성 계약 ③ (자동 경로 조용함, R7); resolved tension, not a defect"}],"impact":{"scope":"cross-module","risk":"medium — high-risk axis is the isFreshMainSession gate; predicate thoroughly unit-covered, production call-site wrappers code-review-only with applied path e2e-gated","affected_areas":["models-file","validate","session-default","inject","main","command","e2e harness","docs"]},"recommendation":"main.ts LSC_DEBUG branch + command.ts reinject wrapper are the two load-bearing code-review-only surfaces; predicate/primitive fully unit-covered — risk is wiring, not predicate correctness"}
```

## 10. Full lsc-critic report (verbatim)

```json
{"verdict":"ACCEPT-WITH-RESERVATIONS","summary":"Implementation is plan-faithful across all 6 steps, the ADR, and every guardrail; 66/66 scoped units + tsc type gate independently reproduced; test files byte-identical to hash-protected canon; no test-aware branches. Sole MAJOR: the contracted runtime verification has never executed — AC1/AC2 gated e2e skipped in every run (run-3.log) and Step 0 probe captured 0/5 observations (all scenarios died at 'No API key found for zai', honestly disclosed in commit b560cf0). AC1/AC2/AC3 therefore Partial (implementation-present, verification-pending); AC4–AC9 Met with executed contracted methods. Gate-semantics spec deviation was user-ACK'd (open-questions.md RESOLVED, lsc_confirm=yes).","spec_matrix":{"AC1":"Partial — impl main.ts:39-49; e2e authored (e2e-preset-default.test.ts:166-168) + registered (package.json:16) but NEVER executed","AC2":"Partial — session_init exclusion session-default.ts:33; e2e authored :170-189, never executed","AC3":"Partial — unit leg executed (order/pairing pins); e2e-observation proxy leg unexecuted","AC4":"Met — gate matrix ①–⑦ pinned (preset-session-default.test.ts:36-92); strengthened predicate deviation user-ACK'd","AC5":"Met — short-circuit pins + inject-level partial-activation pin; auto path console.warn (main.ts:51) = spec-quiet","AC6":"Met — flat/structural/round-trip/null-normalize pins","AC7":"Met — 3 violation classes + BOTH reserved keys pinned (preset-validate.test.ts:71-160)","AC8":"Met — summarize pinned; default-first buildPreset (command.ts:77-100) code-reviewed","AC9":"Met — README:42-146, _docs/spec.md:46, SKIP_LABEL command.ts:24 (ACK-exact)"},"plan_matrix":{"step0_probe":"Partial — authored per contract; attempted, 0/5 observed (API key); honest disclosure; R1 fallback chain still open","step1_schema":"Met — models-file.ts:21-26,65-71,91-102,120-128","step2_validate":"Met — validate.ts:52-88 incl. slash-format (N3) + dual reserved-key guard","step3_pure_module":"Met — session-default.ts:6-79; SessionApiSatisfiesHost :49-58 enforced by build gate; 0 SDK value imports","step4_wiring":"Met — inject/main/command per plan; one letter-deviation: auto-failure console.warn vs pseudo-code notify (MINOR)","step5_ux_docs":"Met — all Step 5 bullets delivered; MINOR effort-prompt title regression (command.ts:58)","step6_e2e":"Partial — artifacts complete + plan-exact; pass-path acceptance (LSC_E2E=1 run) unverified","adr":"Met — incl. landing ACK obtained","m1_gating":"Met — switch always (command.ts:155), create pre-capture+conditional (:171-177), edit/delete never (:200,:218), name-match guard (:112)","fresh_gate":"Met — 3 conditions + count bound (session-default.ts:30-39)","must_have":"Met","must_not_have":"Met — sync inject preserved; no persisted writes; no snapshot/polling/locking; scoped tests only"},"findings":[{"severity":"MAJOR","finding":"Entire runtime evidence leg unexecuted: AC1/AC2 e2e never run (run-3.log 'e2e : skipped'); Step 0 probe 0/5 observations (No API key found for zai). Auto-apply path correctness rests solely on pinned-source static analysis + synthetic-entry units.","fix":"Before landing: one credentialed LSC_E2E=1 run via run_test.sh (plugin-link guard prevents false green); ideally re-run probe. No code change required."},{"severity":"MINOR","finding":"main.ts:51 console.warn vs plan Step 4 pseudo-code ctx.ui.notify(warning) — plan internally contradictory (§2 AC5 + R10 say quiet); impl resolved toward spec; undisclosed in commit 7f2f078."},{"severity":"MINOR","finding":"session-default.ts:77 unchecked `effort as EffortLevel|null` cast in exported primitive; safe at current call sites, unguarded for future callers."},{"severity":"MINOR","finding":"Effort-prompt title regression: 'Effort for Model for executor …' (command.ts:58 via pickModelSpec generalization)."},{"severity":"MINOR","finding":"Probe attempt log only in volatile /tmp; planned test/logs location unwritable (hash-protection); copy to durable location."}],"unverified_by_executed_tests":["AC1 live turn-1 model replacement","AC2 live subagent inheritance + override precedence","isFreshMainSession vs real host entry shapes at all 4 emit sites (ACP unprobed by design)","setModel-at-session_start turn-1 visibility, false-return path, effort terminal behavior on live host","B1 cycle-no-turn-resume counterexample live","main.ts wiring + all interactive command flows (code-review only, per plan scoping)","Plan Verification 5 manual smoke (no recorded evidence)"],"integrity_checks":{"canon_vs_committed_tests":"byte-identical","independent_unit_run":"66/66 pass, 6 files (reproduced run-3.log)","worktree_git_status":"clean","hardcoded_test_output_hunt":"clean — only env read in feature src is LSC_DEBUG (main.ts:52)","ack_hard_gate":"RESOLVED 2026-07-13, lsc_confirm=yes"},"mode":"THOROUGH (0 CRITICAL, 1 MAJOR evidence-gap, no systemic pattern; targeted adversarial spot-checks all clean)"}
```

*(Critic's matrices were produced BEFORE the audit's own e2e execution; §1/§4 above supersede its AC1/AC3/step-6 statuses with the executed-run evidence — its MAJOR is thereby narrowed to the AC2 premise defect, per §4.2's "explore/critic reports are evidence, the main session assigns the verdict".)*

## 11. Audit-run e2e transcript excerpt (evidence for §4.2)

```
❯ test/e2e-preset-default.test.ts (1 test | 1 failed) 57596ms
  × applies the preset default to the fresh main session and an unspecified tracer while preserving the explore override
    → tracer must inherit preset default provider: expected 'openai-codex' to be 'zai'
      (AC1 assertions at :158-161 passed — failure is the AC2 tracer row at :178)
root cause: ~/.omp/agent/config.yml:12 → modelRoles.task: openai-codex/gpt-5.6-sol:max (host 16.4.8)
E2E_EXIT=1 · symlink restored to main checkout immediately after the run
```
