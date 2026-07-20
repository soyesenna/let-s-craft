# Plan Iteration 2 원장 — deferred-pool (리뷰 판정 + AWC fix 적용 기록)

> iteration 2 리뷰-응답 기록. plan.md 코어에 미축적(§10 Review Status가 본 원장을 참조). 선행 원장: plan-1.md.

## 1. 리뷰 판정

| 리뷰어 | 판정 | 요지 |
|---|---|---|
| Architect | **AWC-equivalent** (blocking apply-only; redesign 불필요) | iteration 1 BLOCKING 5건의 방향은 종결. 잔여 결함은 전부 기존 결정 내 기계적 보완 — Change Spec 11항을 verbatim 적용 조건으로 승인 등가. 근본 원인: 정적 데이터 모델은 재결정됐으나 transition system(발급 envelope·mismatch→재승인 전이·strict/legacy 모드 구분·descriptor/decode 분리·mutation containment)으로 끝까지 전개되지 않음. |
| Critic | **APPROVE-WITH-CHANGE** (iteration 2) | Change Spec 11항 전부 지정 소스 실측으로 독립 확증(11/11 동의). MAJOR 2건은 Change Spec의 보정(amend): C1(1항 타깃 누락), C2(9항 target-dirty 과도). minor 3건. gate checks 전부 Pass(6·7·10항 적용 전제). next step: 저자 적용 후 diff-only recheck. |

## 2. 적용 기록 — Change Spec 11항 (verbatim, C1·C2 보정 포함)

| # | 내용 | 적용 위치 (file:section) |
|---|---|---|
| 1 | PreparedDestructiveOperation generic issuance envelope + prepared/pending 권위 구분 + operationScope? optional 2종 + expectedScope 3규칙 비교(release.ts 무변경) | plan.md §6 Step 3a(1번째 불릿) · plan.md §4 D3 요약(동일 결정 동기화) · appendix-adr-branches.md D3 Option A(1번째 불릿) · spec.md Goal-A · spec.md 제약 2. **C1 보정**: appendix-security-land.md §신뢰 경계 — "인메모리 슬롯 2종=권위" 문장을 권위 4분류(pending=sole volatile consume authority / prepared=trusted non-authoritative issuance context / persisted record=non-authoritative durable evidence / live git 재관찰=execution-time gate evidence)로 교체 |
| 2 | ask.ts 분기 계약: craftAtPrompt+preparedAtPrompt 캡처 → prepared branch 우선(tag+exact question+prepareId 유지+active 부재 또는 sameCraftIdentity) → persist 성공 후 install → conditional invalidate(전 실패 경로 포함), craft-bound 무변경 | plan.md §6 Step 3a(2번째 불릿) · appendix-adr-branches.md D3 Option A(1번째 불릿 후반) |
| 3 | Phase 순서 R→C/P→X(consume-first), mismatch 시 현재 envelope install/replace+approval-required(exact question+원인 코드), Phase R 실패 시 prepared clear, public `no-pending-approval` 제거+replay 검증 형태 교체 | plan.md §6 Step 3b Phase R/C·P/X + 사유 코드 집합 · appendix-test-plan.md W2-a(wrong-target/replay 항) · spec.md AC1·AC2(replay 문구) |
| 4 | recordReleaseApprovalAt exact-root writer: craftStatePath(root, identity.feature) 직접 read/write + 3필드 identity 전부-일치 검사 + writeFileAtomicSync, persist(next)·persisted path 권위 사용 금지, 실패 throw=pending 미설치 | plan.md §6 Step 3a(3번째 불릿, 신설) · appendix-adr-branches.md D3 Option A(2번째 불릿) · spec.md 제약 2(exact-root writer 문구) |
| 5 | prepared slot lifetime 종결: TTL 없음 + normative lifecycle 전체 열거 + prepareId conditional invalidation, `[x]` 처리 | open-questions.md iteration 2 절 2번째 항목 · appendix-adr-branches.md D3 Option A(3번째 불릿 — "pending과 동일 의미론" 산문을 lifecycle 열거로 교체) |
| 6 | D3 production cases 9종 추가(same-session 성공/mismatched 무발급/cross-feature replace 무발급/wrong question/재승인 왕복 O2/no·free·cancel clear/session lifecycle clear/persist 실패 시 양 슬롯 부재/Canon 경로 무변경) | appendix-test-plan.md W2-a production 발급 경로 항(D3 production 확장 블록) |
| 7 | strict land audit mode: validateLandAuditEvidence(threshold·cycle 필수, undefined-tolerant 분기 미사용) + no-audit-cycle/stale-run-log + cycle-aware marker(부재·이전=WARN, current 동일=일치, current 상이·future=evidence-tamper) + recordAuditCycleBegin 이전 marker clear + 테스트 2종(missing threshold, stale old marker+live success) | plan.md §4 D4 · plan.md §6 Step 3b Phase R ③ · appendix-adr-branches.md D4 Option A(제목 포함 교체) · spec.md Goal-A · spec.md 제약 2 · spec.md AC1 · appendix-test-plan.md W2-a AC1 변형 항 · appendix-security-land.md T11(marker 정책 서술행 동기화) |
| 8 | craftStateCandidates descriptor-only(`{root,statePath,rootExists,stateFileExists}`, JSON 미독) + decode는 findPersistedCraftState만 + resolveAuditRoot는 rootExists만 + malformed-state 회귀 | plan.md §6 Step 1b(3불릿 전체) · plan.md §7 AC 매트릭스 row 10 · spec.md Goal-E · spec.md 제약 8 · spec.md AC10 · appendix-test-plan.md W1-b |
| 9 | effect binding/recovery: approved sourceOID merge(`--no-ff --no-edit <sourceOID>`) + consume 직후 target 재확인 + target-dirty preflight + abort 후 사후 상태 검증으로 merge-aborted/merge-recovery-failed 구분 + merged-but-not-cleaned/cleaned-but-not-pruned state flags + fixture 4종(source drift·dirty target·abort 실패·prune 실패) | plan.md §4 D2(effect 결박 절) · plan.md §3 Must Have 8 · plan.md §6 Step 3b Phase X + 사유 코드 · plan.md §4 Consequences(상태 기계 집합) · appendix-security-land.md T10·T12 · appendix-pre-mortem.md P7·P8 · spec.md Goal-A · spec.md AC2·AC3 · appendix-test-plan.md W2-a 실패 경로 항. **C2 보정 반영**: target-dirty는 porcelain `??` 이외 엔트리(tracked 변경) 한정 — untracked 충돌은 git merge 원생 거부 위임 + untracked-only 통과 양성 케이스(T9/T15 수동 탈출구 정상화 방지) |
| 10 | lsc_claims root/transaction 종결: `{feature_dir}` kebab-case slug만 + worktreePath(ctx.cwd,feature) 고정 root + registered worktree·realpath containment·symlink/traversal/NUL 거부 + all-validate-then-single-atomic-write(1개 invalid=byte 0) + per-claim 현재 decision("이력"→"현재" 교체, previousDecisions=기존 current status) + decisions.json·TTL 미도입 + 테스트 4종 + open question `[x]` | plan.md §6 Step 5a(1·2번째 불릿) · plan.md §7 row 11(AC11 문구) · open-questions.md iteration 2 절 1번째 항목 · spec.md Goal-F · spec.md AC11 · appendix-test-plan.md W2-d |
| 11 | spec current-facing 명칭 정리: "root-해석 헬퍼 통일"→"candidate/decode seam 공유+named policy 2종 보존", validateWorktreeRemovalTarget→inspect/evaluate 분리, /lsc-doctor 커맨드→/lsc-doctor+lsc_doctor adapters, Ontology 절에 current 엔티티 목록+convergence 표 "iteration 1 historical ontology; current entities above" 라벨 | spec.md Topology row E · spec.md Goal 한 문장 · spec.md §Ontology(엔티티 목록 current화 + 표 라벨 삽입) |

## 3. Critic 판정 상세 반영

- **C1 (MAJOR, 1항 보정)**: appendix-security-land.md 신뢰 경계 절이 1항 타깃에 추가됨 — prepared를 "권위"로 부르던 모순 문장의 실거주지 교체 완료(§2 표 1항 참조).
- **C2 (MAJOR, 9항 보정)**: 9항을 "porcelain 비어 있음 요구"가 아니라 tracked-변경-한정 거부 + untracked-only 성공 양성 케이스로 적용(§2 표 9항 참조).
- **minor 1**: merge-aborted/merge-recovery-failed 판정 기준을 abort exit code가 아닌 **사후 상태 검증(branch/OID/clean)**으로 명시 — plan.md Must Have 8·Phase X, appendix-pre-mortem P7, spec AC3에 "merge 미시작 거부의 false recovery-failed 방지" 문구 포함.
- **minor 2**: 사유 코드 집합 동기화 — plan.md §6 Step 3b 집합(정의부), appendix-test-plan 계층 4 목록, spec AC1 'nonce 미소비' 문구(→ approval-required, no-pending-approval 제거 명시)를 동일 집합으로 통일. 최종 집합(18종): no-audit-evidence / no-audit-cycle / cycle-mismatch / verdict-not-approve / stale-run-log / evidence-tamper / evidence-mismatch / approval-required / scope-mismatch / identity-mismatch / self-merge / not-registered / target-dirty / merge-aborted / merge-recovery-failed / merged-but-not-cleaned / cleaned-but-not-pruned / validation-reject.
- **minor 3**: craft-state.test.ts 인용 범위 표기(:481-533 vs :481-521) — **소스 실측으로 판정, 산출물 변경 불요**. test/craft-state.test.ts의 open-release 중재 회귀 3케이스는 :481-501(open worktree wins)/:503-519(open cwd wins)/:521-534(tie-break, 최종 단언 :533)로, 산출물 전체(plan.md·appendix-test-plan·appendix-adr-branches·open-questions·plan-1)는 이미 `:481-533`으로 통일돼 있고 이 표기가 3케이스 전체를 정확히 포괄한다. `:481-521`은 architect 리포트 측 표기(중재 블록을 중간 절단)로, 산출물 쪽이 정본. 표기 유지.

## 4. 동봉 fix의 동일-결정 전파 (신규 결정 0)

아래는 Change Spec이 직접 지정한 라인 밖이지만, **같은 문서 안에서 같은 결정을 서술하는 요약/매트릭스 행**이라 미동기 시 모순이 남는 지점 — 항목별 근거와 함께 최소 전파:

- plan.md §4 D3 요약: 구 조건 "active craft 부재 + scope 존재"가 2항의 새 계약(부재 **또는** sameCraftIdentity)과 정면 모순 → envelope·eligible 조건으로 동기(2항).
- plan.md §3 Must Have 1: fail-closed 변형 목록에 cycle/threshold 부재·tracked target-dirty 추가, marker 표현 cycle-aware화(7·9항).
- plan.md §3 Must Have 8: 사후 상태 검증 기준(9항+minor 1 — architect Analysis §6이 plan.md:54를 직접 지목).
- plan.md §4 Consequences: 부분 실패 상태 기계 집합 갱신(9항).
- plan.md §7 AC 매트릭스 row 1-3·10-11: spec AC1/AC2/AC3/AC10/AC11 문구 변경의 1:1 대응 행(3·7·8·9·10항+minor 2).
- plan.md §6 Step 3b AC 참조행(166): 신규 fixture 4종 반영(9항).
- appendix-security-land.md T11: marker 정책 서술이 7항의 cycle-aware 정책과 문자 그대로 충돌하는 행(9항 타깃 범위 :23-26 내).

## 5. 미적용 항목

**없음.** Change Spec 11항 전부 + critic MAJOR 보정 2건 전부 + minor 3건 전부 처리(minor 3은 소스 실측 결과 "변경 불요"로 종결 — §3 참조). 동봉 fix 밖 신규 결정·재개방 0건.

## 6. 비고

- plan.md 코어는 fix 서술 추가로 ~30KB 소프트 타깃을 소폭 상회(적용 전 32.8KB) — AWC 적용은 구조 이동이 아닌 지정 라인 교체이므로 appendix 재배치는 하지 않음(diff-only recheck 후 필요 시 별도 정리).
- next step: critic **diff-only recheck** (critic 리뷰 §next_step).
