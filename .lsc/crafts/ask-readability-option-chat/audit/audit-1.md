# Audit — ask-readability-option-chat, cycle 1

| 항목 | 값 |
|---|---|
| Feature | ask-readability-option-chat |
| Date | 2026-07-21 |
| Audit cycle | 1 |
| Mode | **fix-verification** (§5 — 직전 verdict APPROVE-WITH-CHANGE의 Required Fix RF1/RF2/RF3에 스코프; 파이프라인 설계상 의도된 스코프 축소) |
| Prior audit | audit-0.md — **AUDIT VERDICT: APPROVE-WITH-CHANGE** (RF1 입력 에코 / RF2 검색 filtered projection / RF3 라이브 게이트 3건) |
| Implementation | worktree `.lsc/worktrees/ask-readability-option-chat/`, branch `feat/ask-readability-option-chat` |
| Base branch | `feat/lets-craft-v1` (audit-0 검출 재사용, §7.2) |
| Fix commits (a40fb0e..HEAD, 7개) | 36dc3f6 (RF1/RF2 렌더 + Minor6/8) → 6003f6c·d98b278 (canon amendment 1: 에코·projection 핀) → 98f7a6e (RF3 증거) → 0f1ac48 (canon amendment 2: streamSimple·assistant-block 핀) → 4e15dff (어댑터 실버그 2건 수정) → 86c7975 (Bun shadow sync) |
| Audit evidence run | test/logs/run-11.log (lsc_audit_begin threshold=run-10 이후 fresh pass, exit 0, audit-evidence 모드) |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## 1. Spec Compliance Matrix (fix-verification 스코프)

§5 규칙에 따라 직전 감사의 Partial/Unmet 행 + RF1/RF2 변경이 접촉한 기존 Met 행만 재검증. (v) = 메인 세션이 인용 file:line을 직접 read로 재검증한 행. 나머지 근거는 run-11 실측 + 두 에이전트의 수렴 인용.

| Requirement | Status | Notes |
|---|---|---|
| AC1.2 자유 멀티턴 + Esc | **Met** (was Partial) | RF1 완결: editorDraft 커서 렌더 (v: render-model.ts:65-78,156), 검색어 에코 (v: :154), chatDraft+포커스 에코 (v: :177-181); component.ts 전달 (v: :201-205,223). canon 핀: render-model asset :203-252 + Bun mounted :806-846, run-11 green. 잔여: overflow 시 draft 절단 가능(Minor 1, §3) |
| AC2.4 loadMode 노출 | **Met** (was Partial) | E1 라이브 실측(appendix-live-spike §E1): 실 omp 17.0.5 부팅, ask 3종 essential 직접 노출 + `xd://lsc_doctor` discoverable 실행 관측 + built dist 16종 분배 코드레벨 크로스체크. 잔여: gated e2e 하네스 버그로 LSC_E2E=1 스위트는 여전히 RED(공시·미수정, Minor 4) — spec 문언("17.x 런타임에서 노출")의 라이브 관측 자체는 충족 |
| AC6.2 라이브 cache_read 1회 실측 | **Met** (was Unmet) | O2 실측(appendix-cache-probe): 2턴째 `cache_read_input_tokens = 7187 > 0`, 동결 세션·안정 promptCacheKey·프리픽스 불변 구성, fail-closed 기록. 결합 증거: post-fix 어댑터 자체의 라이브 왕복 PASS(appendix-live-spike POST-FIX, 2026-07-21T09:26:14Z, run.ok=true, deltaCount 16). 잔여: appendix-cache-probe의 "shipped adapter blocked" stale caveat가 post-fix 증거와 문서상 모순(RF5) |
| AC5.1/AC5.2 팔레트 위계·명암 적응 | Still Met | RF1 신규 렌더 전부 palette.paint 역할 경유 (v: render-model.ts:154-156,179-180); palette 22 + snapshot 40 green(run-11) |
| AC3.1-3.3 행수 상한·도달성 | Still Met | 신규 헤더 라인(검색 에코·에디터 초안)이 행수 예산에 반영 (v: render-model.ts:113-115); R-series green(run-11) |
| AC1.3 체크/커서 보존 | Still Met | outer state 소유 구조 무변경; 체크 마킹은 원본 index 매핑 유지 (v: render-model.ts:126); U8/I3 green(run-11) |
| AC6.1 캐시 히트 형태 고정 | Still Met | B2 forwarding pins가 streamSimple 경계에서 그대로 적용(canon test-bun :555-706), completion-core 34 green(run-11). 단 raw-stream 회귀 트랩 부재(MAJOR 1, §3) |

## 2. Plan Compliance Matrix (fix-verification 스코프)

| Plan Step / 계약 | Status | Notes |
|---|---|---|
| PR1 hard gate (실 omp 부팅 loadMode smoke) | **Met — 실질** (was 절차 위반) | E1 라이브 부팅+essential/discoverable 실측 완료. cycle-0의 게이트 순서 위반은 과거사로 기록 유지 |
| PR2 mandatory baseline parity 가시 층위 | **Met** (was Partial) | RF1/RF2로 입력 에코·filtered projection 렌더 완결; 하이라이트≡커밋 대상은 커밋 경로와 동일한 `searchOptions` 재사용으로 구조 보장 (v: component.ts:202 ↔ state.ts:380,391-398) |
| PR5 O2 캐시 실측 | **Met** (was Partial) | appendix-cache-probe 실측 기록(§1 AC6.2 행) |
| Guardrails Import graph | Still Met | pi-ai 값 import는 completion.ts(Bun leaf)만 (v: completion.ts:6); explore가 소스 단위 실증 |
| 캐시 수명 정본 (동결 세션·getBranch 1회) | Still Met | 어댑터 수정은 이벤트 루프·stopReason·redaction 무변경 (v: completion.ts:60-72); U3/B2 green(run-11) |
| RF2 "substring 유지 — fuzzy 금지" 지시 | Met | state.ts:111-121 substring `.includes` 무변경 (v); fuzzy 스코어링 미도입 |
| Canon 보강 고지의 [Canon Amendment] 경로 | Met | 2회 모두 승인→`lsc_craft_release`→편집→`lsc_craft_init` 재베이스라인 경로 준수(.craft-state.json releaseApproval consumed; lsc_run_tests가 open-release 잔존 시 거부하는데 run-11 정상 실행됨). canon 변경은 append-only(약화 0건, critic 산술 대조), assistant-block 핀은 run-8 RED→run-9 GREEN으로 식별력 실증 |

## 3. Code Quality & Regression Risk

### MAJOR (1)

**M1 — canon Bun mock의 streamSimple 핀이 raw-stream 회귀를 감지 못함 (HIGH confidence, v)**
canon `test/assets/test-bun/ask-ui-adapter.test.ts:232-257`의 mock.module에서 `stream`(:235-239)과 `streamSimple`(:250-254)이 **동일 `streamCalls` 배열**에 push하고, "raw stream 호출 0건" 어서션이 스위트 전체에 없다 — mock 주석 스스로 "same capture array: every existing B2 forwarding assertion applies unchanged"라 명시(v: :245-249). 따라서 어댑터가 O1 버그 ①(raw `stream`은 ApiKeyResolver를 해소하지 않음 — 라이브에서 `key.includes is not a function` 크래시, appendix-live-spike :59-64)로 회귀해도 전 스위트가 green으로 남는다. 현재 어댑터는 올바르게 streamSimple을 사용하나(v: completion.ts:6,60), 이 버그는 **실제로 한 번 발생해 라이브에서만 적발된 클래스**이므로 회귀 트랩 부재는 차단 결함이다. 대조: assistant-block 핀은 run-8 RED로 식별력이 실증된 진짜 핀. 악화 요인: spec.md:134가 여전히 raw `stream` 계약을 기술(§6 amendment 1). 수정은 기계적(RF4): mock의 `stream` 항목을 throw로 교체 — 현재 raw stream 호출 0건이므로 기존 green 불변.

### MINOR (4, 비차단)

1. **chat panel overflow 시 draft 에코 절단** — chatDraft 라인이 height clamp(:186-190, keepTail=2) 앞에 추가되어 긴 대화에서 잘릴 수 있음(explore·critic 독립 수렴 — 신뢰도 상향). canon은 짧은 draft만 테스트. 기존 Minor(chat 스크롤 부재)와 동근.
2. **멀티라인 paste 초안의 개행 내장 단일 라인 에코** — AC3 행수 회계와 시각 행수 불일치 가능(component.ts:32-35, state.ts:283-286).
3. **신규 렌더 상태(search/editor/chat-draft)의 구조·팔레트 불변식이 R-series 스냅샷 canon에 미핀** — render-model/Bun 테스트로는 덮이나 스냅샷 계층 공백.
4. **E1 gated e2e canon이 LSC_E2E=1에서 여전히 RED** — `--no-extensions --extension` 하네스 버그(canon·shadow :287,371, 7커밋 동안 무변경), 근본 원인·수정 방향 공시됨(appendix-live-spike :106-126). 기본 실행에서는 self-skip이라 무해.

### 커버리지 공백 (explore 실측, 비차단 — 후속 보강 후보)

mounted multi-select에서 filtered projection 대상 Space 토글 E2E 부재; mounted empty-search 렌더 미검증; RF1 에디터 커서 위치·chat focused:false 시각 구분 미핀; Minor8 수정 분기(state.ts:353-355 error→blur)의 free-prompt focused 상태 발화 테스트 부재; ask.ts:163-166 build() 동기 throw 분류(Minor6 수정분)의 직접 회귀 테스트 부재.

### 회귀 리스크

낮음. diff는 예상 11파일뿐(잔여물 0), canon 변경 append-only(어서션 약화 0건), canon↔shadow cmp 전부 exit 0, working tree clean, 기존 스위트 전량 green(run-11: vitest 1491, bun 21). 에이전트 수렴: chat-draft 절단·e2e 하네스·cache-probe 문서 모순 3건을 양측이 독립 지목. 판단 불일치: streamSimple 핀의 허울성은 critic만 적발(explore는 커버리지로 분류) — 메인 세션 직접 read로 critic 판정 확증(v: :232-257).

## 4. Test Re-verification

- 방법: `lsc_run_tests` **audit-evidence 모드**(본 세션에 active craft 없음 — active-craft 부기 비오염), cycle 1 threshold=run-10 이후.
- 결과: **exit 0** — `test/logs/run-11.log`. build PASS · type-check PASS(ask-ui contract pins hold) · vitest 58 files passed/5 skipped, **1491 passed/16 skipped/0 failed** · Bun **21 pass/0 fail**(RF1/RF2 신규 3종 + B2 streamSimple·assistant-block 핀 포함) · e2e: LSC_E2E 미설정 self-skip(정상).
- 판정 하드 게이트: 통과(APPROVE 계열 허용).

## 5. Full lsc-explore report (verbatim)

> ## Findings
> - **Files**: 수정 diff(`git -C {W} diff a40fb0e...HEAD`)는 정확히 11개 파일이다. RF1/RF2 구현은 `{W}/src/ask-ui/component.ts:184-205`, `{W}/src/ask-ui/render-model.ts:12-24,80-158`, `{W}/src/ask-ui/render-model.ts:161-180`에 있고, 인접 수정은 `{W}/src/ask-ui/state.ts:341-356`와 `{W}/src/ask.ts:157-171`이다. RF3 증거 문서는 `plan/appendix-cache-probe.md:1-62` 및 `plan/appendix-live-spike.md:1-202`이다. Canon amendment는 `test/assets/test/ask-ui-render-model.test.ts:193-252` 및 `test/assets/test-bun/ask-ui-adapter.test.ts:555-706,797-846`이며, shadow는 각각 `{W}/test/ask-ui-render-model.test.ts`와 `{W}/test-bun/ask-ui-adapter.test.ts`이다.
> - **Root cause**: RF1/RF2와 adapter 실버그 수정은 코드와 canon에 반영됐지만, E1 harness flag 버그는 7개 fix commit 어디에서도 수정되지 않았고 RF3 cache 문서에는 이전 adapter 차단 문구가 남아 있다.
> - **Evidence**:
>   - commit ownership은 `36dc3f6`(RF1/RF2 + Minor6/8), `6003f6c`/`d98b278`(canon/shadow RF1/RF2 amendment), `98f7a6e`(RF3 evidence), `0f1ac48`/`86c7975`(Bun adapter pins), `4e15dff`(adapter 수정 + post-fix live evidence)로 관측됐다. post-audit diff의 name-status에는 위 11개 이외 파일이 없다.
>   - RF1 상태는 `state.ts:74-78`의 `searchQuery`, `askDraft`, `askCursor`, `chatDraft`, `chatEditorFocused`가 원천이다. `SelectViewModel`은 literal `askDraft`/`askCursor` 두 필드가 아니라 equivalent한 `editorDraft:{text,cursor}` 형태로 `render-model.ts:12-24`에 운반한다. `component.ts:184-205`가 editor/search 상태를 VM으로 매핑하고, `:165-166`이 mode별 renderer를 호출한다. `render-model.ts:154-156`은 query/editor draft와 cursor를, `:177-180`은 chat draft와 focus cursor를 실제 출력한다.
>   - RF2의 reducer commit domain은 `state.ts:70,380-398`에서 search cursor를 filtered position으로 두고 `filtered[canonicalCursor].index`를 Enter/Space target으로 사용한다. 같은 helper인 `searchOptions`는 `state.ts:111-120`에서 label/description `.includes()` substring matching을 그대로 유지한다. `component.ts:199-202`가 동일 helper로 original indices를 VM에 넣고, `render-model.ts:84-93`가 그 projection을 그대로 row로 만들며 focus position을 filtered position으로 해석한다. checked marker는 original `orig` index를 사용하고(`render-model.ts:124-128`), search에서는 Other/Done을 숨긴다(`render-model.ts:99-104`). empty projection도 query header를 남긴다(`render-model.ts:151-158`).
>   - adapter는 `completion.ts:6-8`에서 `streamSimple`/`SimpleStreamOptions`를 import하고, `completion.ts:47-50`에서 assistant history만 `[{type:"text",text}]` block array로 변환하며, `:60`에서 `streamSimple`을 호출한다. 변경 diff의 나머지 event iteration은 `:63-71`, `:75-81`에 그대로 있어 `text_delta`, `done/error`, usage, `stopReason`, `redactSecrets` 처리가 유지된다. Bun canon은 resolver-aware streamSimple forwarding을 `test/assets/test-bun/ask-ui-adapter.test.ts:555-619`, usage/error/aborted/iterator invariants를 `:621-664`, assistant block array를 `:674-706`에서 pin한다.
>   - RF3 live appendix는 post-fix adapter를 실제 provider에 직접 연결해 `run.ok=true`, complete, incremental streaming을 기록한다(`appendix-live-spike.md:136-183`)고, deterministic run-9 기록도 남긴다(`:185-198`).
>   - 그러나 E1 harness는 canon `test/assets/test/ask-ui-e2e.test.ts:287,371`와 shadow `{W}/test/ask-ui-e2e.test.ts:287,371` 모두 `--no-extensions --extension DIST_ENTRY`를 유지한다. `git diff --quiet a40fb0e...HEAD --`로 두 e2e 파일은 7개 commit 동안 변경되지 않았고, appendix도 이 조합이 explicit extension load를 억제하는 harness bug라고 기록한다(`appendix-live-spike.md:106-126`).
>   - Evidence residue: cache appendix는 O2 측정 자체(`cache_read_input_tokens=7187>0`)를 기록하지만(`appendix-cache-probe.md:31-45`), 여전히 shipped adapter가 O1 bugs로 blocked라고 쓴다(`appendix-cache-probe.md:20-29,56-59`). 이는 같은 cycle의 post-fix live appendix(`appendix-live-spike.md:192-198`)와 문서상 모순이다.
>   - shadow sync contract는 `test/run_test.sh:103-131`에서 canon을 shadow로 purge/copy하고 read-only로 고정한다. 직접 `cmp` 결과는 render canon-shadow, adapter canon-shadow, E1 e2e canon-shadow 모두 exit 0이다. `git -C {W} status --short` 출력은 비어 있어 tree는 clean하다. post-audit diff에는 audit 디렉터리 수정도 없다.
>
> ## Coverage Gaps
> - **Covered**: pure renderer invariants는 `test/assets/test/ask-ui-render-model.test.ts:203-252`에서 filtered-only rows, filtered focus, query echo, original-index checked marks, empty projection, ask draft, chat draft를 pin한다. 실제 component 경로(state → view-model → render)는 Bun canon `test/assets/test-bun/ask-ui-adapter.test.ts:806-846`에서 mounted ask echo+commit, mounted select projection+Enter target, mounted chat echo를 exercise한다. reducer의 substring/description/case/original-index/empty/Enter commit은 `test/assets/test/ask-ui-state.test.ts:405-493`에 있다.
> - **Gap 1**: mounted multi-select search에서 filtered projection을 대상으로 Space toggle하는 E2E가 없다. pure render test는 `checkedIndices` mapping을 직접 VM에 넣고(`:221-228`), reducer는 original-index Enter와 empty를 검증하지만 mounted Space target을 함께 검증하지 않는다(`test/assets/test/ask-ui-state.test.ts:463-479`). mounted empty-result rendering도 없다.
> - **Gap 2**: RF1의 cursor 위치와 focus 분기를 강하게 pin하지 않는다. pure editor test는 draft text만 확인한다(`:240-243`), chat test는 `focused:true`만 사용해 `focused:false`와의 visual distinction을 비교하지 않는다(`:245-252`). **[INFERENCE]** chat draft는 `render-model.ts:177-180`에서 turns/errors 뒤에 추가된 뒤 `:186-190`의 head truncation을 거치므로 긴 대화에서는 draft/focus line이 잘릴 수 있으며, 이를 검증하는 overflow test가 없다.
> - **Gap 3**: Minor8 수정(`state.ts:353-355`)의 `error → chatEditorFocused=false` 분기는 free-prompt editor가 focused인 상태에서 settle하는 테스트가 없다. 기존 error/retry 테스트(`test/assets/test/ask-ui-state.test.ts:697-746`)는 one-button 상태에서 시작한다.
> - **Gap 4**: `{W}/src/ask.ts:163-166`의 `build()` 동기 throw를 새 try 범위가 error로 분류하는 직접 회귀 테스트는 없다. 기존 fallback test는 `custom()` reject만 다룬다(`test/assets/test/ask-ui-fallback.test.ts:344-348`).
> - **Gate gap**: live evidence 스스로 custom→done→re-select UI round-trip을 아직 NOT VERIFIED로 남긴다(`appendix-live-spike.md:44-51,192-198`). 이는 adapter fix로 변경되는 경로가 아니지만 RF3 live evidence의 잔여 gap이다.
>
> ## Impact
> - **Scope**: cross-module
> - **Risk**: medium — RF1/RF2/adapter의 핵심 경로는 pure + mounted Bun canon으로 덮였지만, E1 gate는 여전히 harness bug로 실패하며 chat draft clipping과 일부 state/error 경계는 **[INFERENCE]** 또는 미고정이다.
> - **Affected areas**: `src/ask-ui/{state,component,render-model,completion}.ts`, `src/ask.ts`, 보호 canon assets 2개와 그 shadows, RF3 appendix 문서 2개.
>
> ## Relationships
> `src/main.ts:5,37`가 `createAskRuntimeFactory`를 `registerAskTools`에 주입하고, `src/ask-ui/index.ts:32-55`가 invocation context당 하나의 `CompletionPort`와 `createComponentFactory`를 조립한다. `src/ask.ts:195-199,524-528,569-573`가 `mountComponent`를 통해 custom 결과를 받고, `src/ask-ui/component.ts:165-166`가 reducer state를 select/chat renderer로 보낸다. `state.ts`가 query/cursor/draft를 소유하고, `component.ts`가 `searchOptions`와 original indices를 view-model로 투영하며, `render-model.ts`가 실제 ANSI lines를 만든다. side-chat provider 경로는 `completion.ts:47-81`이고, Bun adapter canon의 captured stream boundary는 `test/assets/test-bun/ask-ui-adapter.test.ts:245-251,555-706`이다. Canon → shadow → run_test pipeline은 `test/run_test.sh:103-131`이다.
>
> ## Recommendation
> - `test/assets/test/ask-ui-e2e.test.ts:287,371`의 `--no-extensions`를 explicit `--extension`과 함께 쓰지 않도록 수정하고, 보호된 canon release 절차 후 shadow를 재동기화한다. 현재 shadow `{W}/test/ask-ui-e2e.test.ts:287,371`도 동일하게 갱신해야 한다.
> - `appendix-cache-probe.md:20-29,56-59`의 "adapter blocked" 문구를 post-fix 결과와 조화되게 역사적 pre-fix caveat로 명시하거나 `appendix-live-spike.md:136-198`의 post-fix 근거를 링크하는 addendum을 남긴다.
> - 다음 canon amendment에서 mounted multi-select filtered Space, mounted empty search, editor cursor index, chat focused/unfocused 및 long-panel draft retention, free-prompt error blur, `mountComponent` build-throw를 observable contract로 추가한다. 특히 chat draft를 row clamp에서도 보존할지 결정하고, 보존이 요구되면 `render-model.ts:186-190`의 tail policy를 수정한다.
> - main session은 사용자 제약대로 `run_test.sh`를 재실행하고, E1은 harness flag 수정 후 `LSC_E2E=1 LSC_E2E_STRICT=1`로 다시 관측한다. 이 탐색에서는 project-wide suite를 실행하지 않았다.
>
> ## Next Steps
> - RF1/RF2 mapping과 `streamSimple`/assistant-block adapter fix는 `lsc-critic`의 cycle-1 verdict 검토로 넘길 수 있다.
> - 최종 land 전에는 E1 harness 잔여 버그와 cache appendix 문서 모순을 먼저 처리하고, 위 coverage gaps 중 mounted projection/row-budget 경계를 추가 검증한다.
> - Ready for `lsc-critic` review; no files modified by this agent.

(주: 인용 내 `{W}` = `/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/ask-readability-option-chat` — 원문 절대경로를 가독성 위해 축약; 내용 무변경. 추가로 explore는 IRC 보완 보고 2건을 송신: ① [INFERENCE] 검색 후 stale optionScroll이 filtered focus를 가릴 수 있음, ② [INFERENCE] chat draft가 height clamp(:185-190) 앞에 append되어 긴 turns/errors에서 절단 가능 — canon은 short draft만 테스트.)

## 6. Full lsc-critic report (verbatim)

> ```json
> {
>   "verdict": "APPROVE-WITH-CHANGE",
>   "mode": "THOROUGH (targeted adversarial expansion around Major 1)",
>   "rf_status": {
>     "RF1": "Met — editor draft+cursor, search query line, chat draft+focus 전부 렌더 (render-model.ts:150-155,174-178; component.ts:184-223); canon 핀 완료 (d98b278/6003f6c append-only)",
>     "RF2": "Met — reducer와 동일 searchOptions 재사용으로 highlight==commit 보장 (component.ts:198-203 ↔ state.ts:380,391), 체크는 원본 index 매핑, empty-result는 쿼리 에코로 표현+canon 핀; substring 유지(fuzzy 미도입)",
>     "RF3": "Met — O2 cache_read=7187>0 실측 기록(fail-closed), O1 스파이크가 실버그 2건 적발→4e15dff 수정→라이브 재검증(POST-FIX, shipped createCompletionPort 직접 구동), E1 17.0.5 라이브 부팅+essential/discoverable 실측; 잔여(Probe ② TTY, e2e 하네스 버그)는 증거와 함께 정직 공시"
>   },
>   "blocking_findings": [
>     {
>       "severity": "MAJOR",
>       "tag": "apply-only",
>       "finding": "canon Bun mock에서 raw stream과 streamSimple이 동일 streamCalls 배열 공유 + raw stream 무호출 assertion 0건 — 어댑터가 O1 버그 ①(raw stream 회귀)로 되돌아가도 전 스위트 green. streamSimple '핀'은 허울(assistant-block 핀은 run-8 RED로 실증된 진짜 핀). 악화 요인: spec.md:134이 여전히 raw stream 계약을 기술",
>       "evidence": "canon test/assets/test-bun/ask-ui-adapter.test.ts:233-259; src/ask-ui/completion.ts:60; spec.md:134",
>       "fix": "Canon Amendment 경로로 mock의 stream 항목을 throw new TypeError('key.includes is not a function (simulated — O1)')로 교체 (현재 스위트에서 raw stream 호출 0건이므로 기존 green 불변)"
>     }
>   ],
>   "minor_findings": [
>     "chat panel overflow 시 draft 에코 절단 (render-model.ts:186-189 keepTail=2)",
>     "멀티라인 paste 초안의 개행 내장 단일 라인 에코 — AC3 회계와 시각 행수 불일치 (component.ts:32-35, state.ts:283-286)",
>     "신규 렌더 상태(search/editor/chat-draft)의 구조·팔레트 불변식이 R-series 스냅샷 canon에 미핀",
>     "E1 gated e2e canon이 LSC_E2E=1에서 여전히 RED (--no-extensions 하네스 버그, 공시됨·미수정)"
>   ],
>   "compliance_matrix": {
>     "AC1.2": "Met (was Partial)",
>     "AC2.4": "Met (was Partial; gated e2e 하네스 버그 잔여)",
>     "AC6.2": "Met (was Unmet; pre-fix builders 경유 실측 + post-fix 어댑터 라이브 왕복의 결합 증거)",
>     "PR1_hard_gate": "Met (실질; 순서 위반은 cycle-0 기록 과거사)",
>     "PR2": "Met (was Partial)",
>     "PR5": "Met (was Partial)",
>     "AC5.1_AC5.2": "Still Met",
>     "AC3.1-3.3": "Still Met",
>     "AC1.3": "Still Met"
>   },
>   "regression_sweep": "clean — diff 범위는 예상 파일만, canon append-only(약화 0건, +6 vitest/+4 bun 산술 일치), shadow byte-동기 실측, streamSimple leaf 격리 유지, Minor6/8 공언 범위 일치, run-9 exit 0 (58 files/1491 pass, bun 21/0) 로그 실측 일치, run-8 RED→run-9 GREEN으로 assistant-block 핀 식별력 실증",
>   "residuals_accepted": [
>     "O1 Probe ② (실 TTY custom→done→re-select) NOT VERIFIED — land 시 첫 dogfood 확인 항목 권고",
>     "raw 라이브 캡처는 /tmp 휘발 — 영속 증거는 appendix 산문",
>     "spec.md:134 stream 문언 정정 amendment 후보"
>   ],
>   "next_step": "Major 1의 apply-only canon 패치([Canon Amendment]→lsc_craft_release→편집→lsc_craft_init) 적용 후 diff-only 재확인이면 APPROVE 궤도 — 전면 재감사 불요"
> }
> ```

**Verdict correspondence note (§1.7/§4.2)**: critic의 `APPROVE-WITH-CHANGE`(5값 에이전트 척도 — 차단이되 모든 수정이 기계적으로 완결)는 §4.2 규칙상 본 감사 4값 척도의 **APPROVE-WITH-CHANGE**(수정 필수)에 대응한다 — 이름이 같을 뿐 다른 척도의 값이며, 복사가 아니라 대응 규칙 적용 결과다. 테스트 재검증 통과 + 결함이 정밀 처방 가능(REJECT 요건 불성립).

## 7. Required Fix (APPROVE-WITH-CHANGE — craft 재호출 대상)

다음 2건이 필수(MUST). 구현 루트는 worktree(`.lsc/worktrees/ask-readability-option-chat/`), 기존 canon 스위트 전량 green 유지 전제.

**RF4 — canon Bun mock raw-stream 회귀 트랩 (Major 1)**
- 대상: hash-protected canon `test/assets/test-bun/ask-ui-adapter.test.ts`의 mock.module(@oh-my-pi/pi-ai) — **[Canon Amendment] 승인 → `lsc_craft_release` → 편집 → `lsc_craft_init` 재베이스라인 경로로만 수행**(craft/SKILL.md §4).
- 변경: mock의 `stream` 항목(:235-239)을 O1 버그 ① 크래시를 시뮬레이션하는 throw로 교체 — 예: `stream: () => { throw new TypeError("key.includes is not a function (simulated — O1 ①: raw stream never resolves an ApiKeyResolver)"); }`. `completeSimple`(:240-244)은 resolver-aware 정본 엔트리이므로 유지, `streamSimple`(:250-254)도 유지.
- 근거: 현재 스위트에서 raw `stream` 호출은 0건이므로 이 교체로 기존 green은 불변이며, 이후 어댑터가 raw stream으로 회귀하는 순간 B2/라우팅 테스트가 RED가 된다(assistant-block 핀의 run-8 RED와 같은 식별력 확보).
- 완료 기준: run_test.sh 전량 green + 교체된 mock으로도 bun 스위트 green + shadow sync 커밋(run_test.sh가 canon→shadow sync를 검증).

**RF5 — appendix-cache-probe.md stale caveat 정정 (문서 정합성)**
- 대상: `plan/appendix-cache-probe.md` :20-29(Method note) 및 :56-59(VERDICT caveat) — hash 보호 대상 아님(일반 편집).
- 변경: "shipped adapter는 O1 버그로 blocked" 문구를 **pre-fix 시점의 역사적 기술**로 명시 재작성하고, post-fix 라이브 재검증(appendix-live-spike.md POST-FIX 섹션, 2026-07-21T09:26:14Z, shipped `createCompletionPort` 직접 구동 `run.ok=true`) 참조를 추가해 "현재는 delivery 경로도 라이브 검증 완료"로 문서 정합화. 측정 자체의 provenance(당시 pure builders 경유)는 사실이므로 유지.
- 근거: 동일 사이클 두 증거 문서가 상호 모순 상태로 남으면 후속 감사·사용자가 어댑터가 여전히 차단됐다고 오독한다(explore·critic 수렴 지적).

**비차단 권고 (SHOULD, 선택 — RF4와 동회차 처리 권장)**: ① e2e 하네스 `--no-extensions` 수정(canon·shadow :287,371 — RF4와 같은 [Canon Amendment] 회차에 처리하면 release 1회로 완결; 수정 후 가능 환경에서 `LSC_E2E=1 LSC_E2E_STRICT=1` 재관측), ② chat overflow 시 draft 보존 정책 결정+tail policy(render-model.ts:186-190)·canon 핀, ③ explore Coverage Gaps 1-4(mounted filtered Space/empty-search, 에디터 커서·chat focused:false 핀, Minor8 blur 분기, build() throw)의 observable 테스트 보강, ④ R-series 스냅샷에 신규 렌더 상태 핀.

**다음 사이클 고지**: 본 verdict가 APPROVE-WITH-CHANGE이므로 다음 감사 사이클(audit-2)은 위 Required Fix에 스코프된 fix-verification(§5)으로 진행된다 — 파이프라인 설계상 의도된 스코프 축소다. critic 판단으로는 RF4 적용 후 diff-only 재확인이면 APPROVE 궤도.

## 8. Proposed Spec/Plan Amendments

1. **[Spec Change 후보] spec.md:134 completion 계약 문언 정정** — Technical Context의 "`stream(model, {systemPrompt:[...], messages}, {apiKey: modelRegistry.resolver(...)...})`" 기술을 resolver-aware 엔트리(`streamSimple`, apiKey 리졸버 identity 전달·내부 해소) 기준으로 정정하고 assistant content-block 요건을 병기. 근거: O1 라이브 실측이 raw `stream`은 resolver를 해소하지 않음을 증명(appendix-live-spike :59-64); 문언 방치 시 후속 작업자가 spec을 따라 raw stream으로 "회귀 구현"할 유인이 됨(critic Major 1 악화 요인).
   - Disposition: (§6.2 게이트 결과 추기)
2. **[Plan Change 후보, cycle-0 Deferred 재상정] "fuzzy" 문언의 substring 비준 명문화** — plan.md의 "label+description fuzzy filter"(상태 전이 정본) 및 §OQ2 검색 기술, appendix-palette-and-prompts §2의 "FuzzyText 검색" 문언을 canon·구현이 비준한 substring 매칭(label+description `.includes`, original-index mapping)으로 정정. 근거: audit-0에서 Deferred("다음 사이클에서 재검토") — RF2가 substring 유지를 지시했고 이번 사이클 canon 핀이 substring을 고정했으므로 문언 정합화 시점 도래.
   - Disposition: (§6.2 게이트 결과 추기)

## 9. Adversarial Class Matrix

| # | Class | 판정 | 근거 |
|---|---|---|---|
| 1 | Test logic delegated outside hash protection | **Excluded** | pass/fail 어서션 전부 hash-protected canon 내부 유지; canon 변경 2회 모두 release→re-baseline 경로 준수, run_test.sh sync 계약(:103-131) 무변경. M1은 canon **내부** 핀의 약한 식별력 문제로 본 클래스(외부 위임)의 발동 조건이 아님 |
| 2 | Worktree residue / base contamination | **Excluded** | fix diff 전수 11파일이 전부 스코프 내(src 5·canon 2·shadow 2·appendix 2); working tree clean; base 브랜치 미접촉; audit 디렉터리 무단 수정 없음(explore 실측) |
| 3 | Spec AC boundary inputs | **Applied** | AC1.2 가시성의 행수-경계: chat draft가 height clamp(render-model.ts:186-190) 앞에 append되어 overflow 시 절단 가능 — canon은 short draft만 테스트(Minor 1); 멀티라인 paste 초안의 행수 회계 경계(Minor 2); mounted empty-search 렌더 미검증(Gap 1) |
| 4 | Post-resume state consistency | **Excluded** | durable 상태 스키마 무변경; .craft-state.json의 releaseApproval 2건 모두 consumed(미결 open-release였다면 lsc_run_tests가 거부 — run-11 정상 실행이 반증); testsPassed=true와 run-11 fresh pass 정합 |
| 5 | Prompt-injection surface | **Excluded** | 신규 텍스트는 파이프라인 소유 문서(hash 검증 canon·appendix 증거)와 발주한 에이전트 리포트뿐 — 감사 판단을 조향하는 외부 지시성 주입 미관찰. appendix의 "fix direction" 산문은 제안일 뿐 본 감사가 독립 재검증함(M1 직접 read 확증) |

## 10. 종합

RF1/RF2/RF3는 **전부 이행 확인**됐다 — 에코·projection은 구현+canon 핀+mounted 검증까지 완결됐고(하이라이트≡커밋은 동일 함수 재사용으로 구조 보장), 라이브 게이트는 실측 증거가 기록됐으며 그 과정에서 O1 스파이크가 적발한 실버그 2건(라이브에서만 재현되는 클래스)까지 수정·라이브 재검증됐다. 이는 audit-0가 지적한 "라이브 5분이면 발견됐을 결함" 패턴이 실제로 검증 계층을 채우자 즉시 배당을 지불한 사례다. 그러나 그 교훈의 마지막 조각이 미완이다: 라이브에서만 죽는 raw-stream 회귀를 canon이 여전히 감지하지 못한다(M1 — streamSimple 핀이 허울). 수정은 기계적·1파일·기존 green 불변이며 canon amendment 1회로 완결된다(RF4) + 증거 문서 모순 정정(RF5). 테스트 재검증 통과 + critic AWC + 정밀 처방 가능 → **APPROVE-WITH-CHANGE**. land는 본 사이클에서 불가하며, RF4/RF5 적용 후 fix-verification 사이클(audit-2)의 APPROVE 계열 판정이 선행되어야 한다.
