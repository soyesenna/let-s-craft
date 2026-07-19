# Plan Iteration 3 원장 — deferred-pool (Stage 4 test-canon 루프 iteration 1: 리뷰 판정 + 소폭 개정 기록)

> Stage 4(test canon) 합의 루프 iteration 1의 리뷰-응답 기록. plan.md 코어에 미축적(§10 Review Status가 본 원장을 참조). 선행 원장: plan-1.md(iteration 1) · plan-2.md(iteration 2). 본 원장은 **plan/test 계획 개정**만 다룬다 — test asset(정본) 자체의 apply-only 수정은 test 작성자(lsc-test-engineer) 소관이며 여기서 산출물 변경 대상이 아니다.

## 1. 리뷰 판정

| 리뷰어 | 판정 | 요지 |
|---|---|---|
| Architect | **BLOCKING_REVISE** | 하네스 실측(import-RED·build PASS·기존 37 green·exit 1)은 하네스 작동 증거일 뿐 "각 AC가 오답 구현을 죽인다"는 증거 아님. 정적 판독으로 5개 BLOCKING(scaffold root 모순·land strict-audit/no-ff/partial-failure false-green·doctor unit↔integration fixture 모순·skill-contract 전역 token·claims atomic/parent-symlink 미검증) + 권고 7항. 근본 원인: 각 계약에 discriminating counterimplementation을 대입해보지 않음. |
| Critic | **REVISE** (THOROUGH→ADVERSARIAL) | architect BLOCKING_REVISE에 독립 동의(refined). C1-C5 critical + m1-m5 minor. 그 중 **2건이 planner 재결정(needs-redesign)**: C3(land effect port) · C4(claims wrapper 위치). 나머지 C1·C2·C5는 apply-only canon 수정. upgrade_condition: "planner re-decides C3 LandEffects port surface + C4 claims wrapper module; C1/C2/C5 apply-only canon fixes applied; then single-diff recheck". |

## 2. planner 개정 대상 판별 (needs-redesign만 plan 변경)

리뷰가 요구한 결함 중 **plan/test 계획 문서의 재결정을 요구하는 항목만** 본 iteration에서 개정한다. 판별 근거는 critic의 `tag` 필드와 architect 권고의 노력/성격:

| 결함 | tag | planner scope? | 근거 |
|---|---|---|---|
| critic C3 / architect rec 2 (land rare-failure port + inspectRemovalTarget 미배선) | **needs-redesign** | **예 — 개정 1** | rare failure(merge-recovery-failed·cleaned-but-not-pruned·validation-reject)를 결정론적으로 만들 seam이 계획에 없어 test 작성자가 결정 불가. |
| critic C4 / architect rec 6 (claims wrapper 위치 = pure ledger vs main.ts 모순) | **needs-redesign** | **예 — 개정 2** | pure ledger도 SDK인 main.ts도 fs 접촉 tool execute를 담을 수 없어 신규 파일 재결정 필요(신규 파일 목록 변경). |
| architect rec 6 (injectable atomic-write port; Main 추적 라벨 "M5 minor") | minor | **예 — 개정 3** | claims-tool의 exactly-once atomic write를 관찰 가능하게 하는 writer port 주입 — 개정 2의 claims-tool 계약에 종속된 동일 결정. |
| critic C1 (scaffold crafts root 모순) | apply-only | 아니오 | test asset 수정(`craftDir(cwd)`→`craftDir(worktreePath(cwd))`) — test 작성자 소관. |
| critic C2 (doctor benign-empty↔gitignore FAIL 모순) | apply-only | 아니오 | benignPorts를 실제 healthy fixture로 재작성 — test 작성자 소관. |
| critic C5 (skill-contract 전역 token smoke) | apply-only | 아니오 | heading-scoped 산문 계약으로 재작성 — test 작성자 소관. |
| critic m1 (harness FEATURE_FILES 10 vs 11) | apply-only | 아니오 | run_test.sh 배열/주석 수정 — test 작성자 소관(gate 보존, false-green 아님). |
| critic m2 (candidate seam 구조 재사용 비관찰) | minor | 아니오 | architect #6 MAJOR→MINOR 재보정, code review로 이연(비관찰 구조는 source-oracle 회피). |
| critic m3·m4 (regression oracle-mirroring·canonical-JSON key-order) | minor | 아니오 | test asset 보강 — test 작성자 소관. |
| critic m5 (doctor optional-field/plugin linked:false/9-count) | minor | 아니오 | doctor observe-layer gap — test 작성자 소관(개정 3의 atomic-write port와 무관, Main 라벨과 구분). |

→ **plan 개정 = 정확히 3건**(개정 1·2·3). 그 외는 test 정본의 apply-only 수정으로 planner 산출물 변경 0(§5).

## 3. 적용 기록 — 소폭 개정 3건

| # | 근거 | 내용 | 적용 위치 (file:section) |
|---|---|---|---|
| 1 | critic C3 / architect rec 2 | **LandEffects 주입 seam**: lsc_land 오케스트레이터가 주입받는 좁은 effect port `LandEffects{merge(sourceOID), abortMerge(), verifyPostRecovery(expected), inspectRemovalTarget(candidate), remove(path), prune()}` — 기본 실 git(순수 리듀서 무변경). happy·실 conflict는 실 git 유지, 외부 비결정 희귀 실패(merge-recovery-failed=verifyPostRecovery 실패·cleaned-but-not-pruned=prune 실패·validation-reject=삭제 직전 재검사 실패)만 결정론 주입. `inspectRemovalTarget`이 port 경유로 **삭제 직전 실호출**됨을 계약 명시(dead-code false-green 차단) — 재검사 실패 시 removeWorktree 미호출 단언. happy path 2-parent merge commit(--no-ff 변별)+seeded stale metadata prune 강화. | plan.md §6 Step 3b(신규 LandEffects 불릿, 163행) · plan.md §6 Step 3b AC1·AC2·AC3 참조행(167행 — validation-reject·port 주입 추가) · plan.md §7 AC 매트릭스 row 3(203행) · appendix-test-plan.md W2-a 실패 경로 항(33행 — port 주입·verifyPostRecovery·inspectRemovalTarget 재검사 실호출 동기화) |
| 2 | critic C4 / architect rec 6 | **src/research/claims-tool.ts 신규**: SDK-independent thin wrapper에 `registerClaimsTool` execute + fs 접촉(읽기·경로 해석·쓰기) 소재. ledger.ts는 fs 무접촉 순수 유지, main.ts는 wrapper 경유로만 등록(pure boundary 불변식). | plan.md §1 Metadata 규모(11행 — 신규 src 4→5, 테스트 ~8→~9) · plan.md §2 Work Objectives F 소유 파일(40행 — claims-tool.ts 추가) · plan.md §6 Step 5a(181행 — wrapper 소재·pure/registrar 분리) · plan.md §7 AC 매트릭스 row 11(211행 — claims-tool.test.ts 추가) · appendix-test-plan.md W2-d(45행 — wrapper 캡처·ledger import 금지) · appendix-test-plan.md run_test.sh 절(64행 — 파일 목록 claims-tool 추가) |
| 3 | architect rec 6 (Main 라벨 "M5 minor") | **atomic-write 주입 port**: claims-tool의 exactly-once atomic write를 검증 가능하게 injectable writer port(기본값 `writeFileAtomicSync`) — 테스트가 port를 주입해 call count·path·payload로 exactly-once 확증. 직접 writeFileSync·다회 overwrite·temp후삭제 false-oracle 차단(architect §5). | plan.md §6 Step 5a(181행 — "주입 가능 atomic-write port로 정확히 1회 쓰기") · plan.md §6 Step 5a AC11 불릿(183행) · plan.md §7 AC 매트릭스 row 11(211행) · appendix-test-plan.md W2-d(45행 — call count 1·path·payload 단언) |

## 4. 동일-결정 전파 (신규 결정 0)

개정 1·2·3이 지정 라인 밖이지만 **같은 결정을 서술하는 요약/매트릭스 행**이라 미동기 시 모순이 남는 지점 — 최소 전파:

- plan.md §1 Metadata §14(개정 이력): Stage 4 루프 iteration 1 절 추가 + 본 원장(plan-3.md) 참조.
- plan.md §6 Step 3b 167행 & §7 row 3: 개정 1의 LandEffects/validation-reject를 test 매핑에 1:1 반영(사유 코드 집합 163행은 이미 validation-reject 포함 — 무변경).
- plan.md §2 F 소유 파일 & §7 row 11 & appendix run_test.sh 파일 목록: 개정 2의 claims-tool.ts를 파일-목록성 서술 전체에 반영.
- appendix-test-plan.md W2-d & plan.md AC11: 개정 2·3의 wrapper 캡처 + atomic-write port 검증을 test 명세와 AC에 동기.

**재개방 0**: D1-D7 결정, spec/plan의 그 외 계약(발급 seam·strict audit·operation 결박·E named policy·doctor 표면·D-3 예외)은 손대지 않음. 개정 1은 D-decision을 바꾸지 않고 Phase X effect를 port로 배선하는 test-가능성 보강, 개정 2·3은 D7 F consumer 결정의 배치(파일 경계)만 구체화.

## 5. 미개정 항목 (planner scope 밖 — apply-only 정본 수정)

아래는 리뷰가 지적했으나 **plan/test 계획 변경이 아니라 test 정본(asset) 수정**으로 종결되어야 하는 항목 — test 작성자(lsc-test-engineer) 소관. planner 산출물 변경 0:

- **critic C1 / architect rec 1**: artifacts-scaffold.test.ts:146,173 `craftDir(cwd,f)`→`craftDir(worktreePath(cwd,f),f)` + project-root craftDir 부재 negative assert + tree delta/traversal. (계획은 이미 "정확히 2 capability + worktree 내부 crafts"를 명시 — plan.md:170; 모순은 test 쪽.)
- **critic C2 / architect rec 4**: doctor-adapters benignPorts를 실제 healthy fixture(9 agents·valid models·linked plugin·registered gitignore·clean literals)로 재작성 + 검사별 단일 throw/hang·exact 8 IDs·나머지 7 불변.
- **critic C5 / architect rec 5**: skill-contract를 heading-scoped 산문 계약으로(appendix :47-53 clause 1:1 positive+negative).
- **architect rec 3**: strict audit + envelope 표 기반 완성(cycle-only/threshold-only/non-integer/N===threshold/fresh-failing/current-matching-marker/APPROVE-family verdict·canonical JSON equal/different·replay regex에서 evidence-mismatch 제거). (계획 D4/D2는 이미 strict 계약 명시 — 공백은 test coverage 쪽.)
- **critic m1 / architect rec 7**: run_test.sh FEATURE_FILES에 deferred-pool-regression 추가 + 10→11 주석/요약.
- **critic m2·m3·m4·m5, architect rec 7 후반**: candidate 구조 재사용(code review 이연)·regression oracle-mirroring/canonical-JSON key-order·doctor optional-field/plugin/9-count·stateVersion 전 mutator stamping — test asset 보강.

## 6. 비고

- 개정 방식: plan.md 코어 in-place 증분 edit(9 hunk) + appendix-test-plan.md 동기(3 hunk). **구조 이동(코어→appendix) 없음** — 소폭 라인 교체/1불릿 삽입이라 core/appendix 분리 규율 불변.
- 개정 1은 architect Trade-off 표 Option B(권장 synthesis) 준거: happy·실 conflict는 real git production execute 유지, OS/permission race 등 외부 비결정 분기만 동일 오케스트레이터 아래 좁은 port로 주입 — black-box realism과 결정론 양립.
- Review Status(plan.md §10): 본 iteration 후 Architect BLOCKING_REVISE(rec 2·6 반영) · Critic REVISE(C3·C4 재결정·atomic-write port). next step: apply-only 정본 수정(C1·C2·C5·m1) 완료 후 **critic single-diff recheck**(upgrade_condition).
