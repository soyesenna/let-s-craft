# Trace — deferred-pool

> Feature idea: `_docs/deferred-pool.md`에 적힌 이연 항목 **전체**(T-1, T-2, A-5, E-1, F-3, E-3, D-1, D-2, D-3, D-4, A-4파트2, E-2확장, C-2파트2, B-2확장, R0)를 구현한다.
> 분류: **Brownfield** (src/**/*.ts 실재, 전 항목이 기존 모듈 개조·확장; git 이력 및 4개 선행 craft 존재).
> 환경 고정: repo HEAD 92e5d12 (feat/lets-craft-v1), worktree `.lsc/worktrees/deferred-pool` (feat/deferred-pool), SDK @oh-my-pi/pi-coding-agent 16.4.0.
> 레인: 5 (코드 seam / 스킬 산문 / 전제 감사 / 상호작용·충돌 / 테스트 인프라) + 외부 리서치 3 waves 13워커 (research/SYNTHESIS.md).

---

## 1. Observed Result

- 사용자 요청: 이연 풀 15항목 전부 구현. 문서 자체가 항목별 성숙도 차이를 명시한다 — §0/§1은 즉시 착수 가능(검증자가 범위를 좁혀둠), §2는 선행 조건·불변식 충돌·조건부 판단이 붙음, §3(R0)은 기각 후 경량 재검토 대상.
- HEAD 92e5d12 기준: **15항목 전부 진짜 미구현**(stale 0건), 직전 사이클 착지분 12건은 문서 헤더와 커밋이 1:1 대응(37커밋 대조). 등록 도구 11개 + 커맨드 2개 전수 열거에 이연 항목 시그니처 0건.
- T-1의 하부 인프라([Land] 태그 발급·auditValidated 마커·APPROVE_FAMILY 상수)는 release-gate feature가 이미 완비 — 소비자 배선만 부재.

## 2. Ranked Hypotheses

| 순위 | 가설 | 상태 |
|---|---|---|
| H1 (Lane 4) | 15항목은 즉시 코드화 6(T-1+A-5 통합, E-1, F-3, E-3-좁힘, T-2, D-2-리서치한정) + 조건부 7(D-1, D-3, D-4, A-4p2, E-2확장, C-2p2, B-2확장)로 분할되며, T-1+A-5 선행이 강제 | **CONFIRMED (반박 라운드에서 정제됨 — §5)** |
| H2 (Lane 1) | 도구화 항목의 통합 seam은 서술대로 실재하며 구조적 리팩터 없이 부착 가능 | CONFIRMED with caveats (T-2는 순수 additive 아님, E-3는 seam 동작 변경 수반) |
| H3 (Lane 2) | T-1/A-5/E-1이 스킬 산문→도구 승격 지점의 완전한 집합 | PARTIALLY REFUTED — '완전 집합'은 과장(추가 산문-중복 지점 5+), 단 이연 풀이 지목한 부분집합은 정확 |
| H4 (Lane 3) | 두 문서의 사실 클레임은 전부 정확, stale 없음 | CONFIRMED 10/10 |
| H5 (Lane 5) | 기존 vitest+fixture 인프라로 도구화 항목 전부 회귀 커버 가능하나 D-1 선행 조건(green E2E 기준선)은 미검증 | CONFIRMED (A: High / B: Medium-High) |

## 3. Evidence Summary by Hypothesis

### H1 — 분할·순서 (Lane 4 + 연구 종합)
- T-1+A-5 수렴: 같은 기능의 두 면(merge 도구화 + 그 force-remove 경로의 안전장치). deferred-pool.md:27이 통합을 명시 권고, A-5 원천(OMC)은 teleport 커맨드에서 삭제 직전 검증을 2회 배선한 실전 선례.
- E-1+R0 상보성: 같은 paths.ts 드리프트 과제의 능동 해소(E-1) vs 수동 탐지(R0) — 묶되 E-1 선행.
- 조건부 7의 세 가지 상이한 기제: (i) 외부 산출물 의존(D-1: E2E 기준선), (ii) 계약 예외 필요(D-3: 불변식 2 정면충돌 / A-4p2: 과차단 / D-4: Override 2 긴장), (iii) dogfooding 관측 의존(E-2확장·B-2확장·C-2p2).
- 가설의 '최소 4개 조건부'는 실제 7개로 상회.

### H2 — 코드 seam (Lane 1, 전부 primary artifact)
- T-1: destructive-approval.ts:22 (`[Land]` in DESTRUCTIVE_GATE_TAGS), release.ts:24 (RELEASE_CONSUMABLE_TAGS에 [Land] 미포함 — 소비처 대기), release.ts:54-88 (소비→기록→정리 3단 트랜잭션 템플릿), state.ts:315-326 (recordAuditValidated), verdict.ts:36 (APPROVE_FAMILY_VERDICTS).
- A-5: worktree.ts:84-93 (removeWorktree — existsSync만 검사하는 fail-open, 검증 전무 확인), paths.ts:94 (worktreePath — expectedRoots 소스로 직결).
- T-2: state.ts:345-351 (findPersistedCraftState — 후보 추측) vs verdict.ts:163-166 (resolveAuditRoot — 존재 분기). **동일 알고리즘 아님** — 통합은 의미 변경 수반.
- E-3: readPersistedCraftState(state.ts:333-337)는 raw JSON.parse, shape 무검증 — version 도입은 이 seam 최초의 의미적 검증.
- F-3/E-1: registerTool 11 + registerCommand 2 (preset command.ts:224, statusbar index.ts:232), paths.ts 전체가 SSOT.

### H3 — 스킬 산문 (Lane 2)
- T-1 대체 대상: post-craft SKILL.md:228-240 (git checkout→merge --no-ff→worktree remove→prune 4단 bash 손수 시퀀스), :208-210 scope note가 도구 부재를 자인. verdict.ts:350-353 주석이 recordAuditValidated를 "future code-level enforcement가 걸 수 있는 seam"으로 명시.
- E-1 대체 대상: pre-craft SKILL.md:84-87 (addWorktree 3분기 재현) + :90-96 (gitignore 4행 bash) — TS와 기능 동등하나 텍스트 발산 실측(드리프트 표면 실존).
- ralplan Phase 5의 "merge 차단 배선"이 T-1로 명시 이연됨 — T-1은 재설계가 아니라 Phase 5의 자연 완결.
- 잔여 산문-중복 지점 5+ (craft §4 금지 도구 표, §1.5 도구 금기 3스킬, worktree 존재 검사 등) — 이연 풀 범위 밖, 스코프 결정 필요.
- F-3 'agents 8종'은 stale — 물리 9종 (lsc-critic-recheck가 8bfac8d에서 추가).

### H4 — 전제 감사 (Lane 3, 10/10 CONFIRMED)
- 대표: version 필드 부재 3파일 확인(fixtures.ts만 version:2); atomic-write 호출부 정확히 2곳; SessionStopEvent 7필드에 stop-사유 부재(이웃 이벤트는 reason 보유 → 구조적 부재; SDK runner.d.ts로 재확인); C-2p1·B-3·QW4·F-1·F-2·E-4 착지 확인.

### H5 — 테스트 인프라 (Lane 5)
- 수용력: 순수 함수/thin wrapper 관례(vitest는 omp SDK import 불가), skill-contract.test.ts(산문 기계 검증), e2e-full-cycle(LSC_E2E+fixture) — 도구화 항목 전부 기존 계층으로 커버 가능.
- D-1 기준선: green E2E 기록 부재가 5개 독립 정황으로 수렴(CI 부재, test/logs 부재, npm test 14 skip, e2e-helpers 다중 실패 서술, git log에 green 기록 커밋 0).

### 외부 리서치 (수렴 세트 — 상세는 §10의 External Research Summary)
- A-5 순증분 4종 확정(git 소스 수준), F-3 exit 계약 잠금(FAIL=non-zero/WARN=0), E-3 대상 CraftState로 좁힘(wave 3 코드 검증), D-3 재정의(브라운필드 seam + differential proof), D-1 전제 정량 실증, D-2 4축 정당화+정본-projection 계약, R0 원형 부재.

## 4. Evidence Against / Missing Evidence

- T-1: post-craft 시점에는 active craft가 없어 lsc_land의 identity 조립이 신규 경로(persisted state의 3필드 재조립) — identity 불일치 false-reject 리스크 미검증. 도구가 §7.1 프로즈 게이트("사용자 명시적 merge 승인")를 approval 소비로 대체하는 것의 계약 정합은 스킬 문서 확정 필요.
- T-2: "구조적 리팩터 없이 부착"은 T-2에 한해 과장 — 두 호출점의 의미가 미세하게 바뀜.
- H1: D-4의 '조건부' 성격은 약함 — 구조 충돌보다 '증분 미미로 채택 보류'가 실제 사유.
- H5: E2E의 마지막 실행이 red였는지 green이었는지 확정하는 단일 1차 artifact 부재(정황 수렴만). 직접 실행은 비용 문제로 미수행.
- '불변식 2' 번호 체계의 공식 출처 미확인 — 실체는 SKILL.md §0 명문 규율로 확인되나 번호는 비공식 참조로 보임.
- E-3 downgrade 방향(구버전 바이너리가 신버전 openRelease 필드를 읽는 경우)의 실동작은 옛 바이너리 부재로 프로브 불가 — [INFERENCE]로만 존재.

## 5. Rebuttal Round

**리더(H1)에 대한 최강 반박** (Lane 4 자신의 critical unknown에서): "release-gate 선례는 다중 도구(A-1+A-2+A-3)를 단일 feature·단일 test canon으로 묶는 데 성공했다 — '15개 단일 feature 비합리' 추론은 관측이 아니라 추정이다."

**리더의 증거 응답**: release-gate spec을 직접 확인한 결과(메인 세션 판독) — 서브컴포넌트 3개(A/B/C)의 토폴로지, 단일 run_test.sh, 기계 검증 AC 7항으로 실제 성립했다. 그러나 그 3부는 **하나의 보안 표면**(release 승인 게이트)에 수렴하는 부품이었다. 이연 풀은 ≥6개의 서로 무관한 표면(land/doctor/scaffold/버전/인터뷰 floor/클레임 원장)에 걸치고, 조건부 7은 지금 AC를 쓸 수조차 없다(D-1은 기준선 부재[H5], E-2확장·B-2확장은 dogfooding 관측 의존, D-3은 스킬 계약 예외 조항이 선행). **재순위 결과**: H1은 기각되지 않되 정제된다 — "다중 feature 강제"가 아니라 "**단일 feature는 가능하되, 조건부 7을 비목표(또는 계약-문서-한정)로 명시 분리하는 조건에서만**". 이 분리 결정은 trace가 내릴 수 없는 소유자 결정 — 인터뷰 1순위 질문으로 승격.

**병합 판정**: T-1과 A-5는 같은 기저 메커니즘(land 도구화와 그 삭제 경로 안전장치)으로 **병합**. E-1과 R0는 같은 드리프트 과제의 다른 프로브(능동 해소 vs 수동 탐지)이므로 산문상 유사해도 **분리 유지**.

## 6. Convergence / Separation Notes

- **진짜 수렴**: "핵심 6은 지금 구현 가능"에 독립 증거 스트림 3개가 도달 — 코드 직독(Lane 1), git 이력+역방향 열거(Lane 3), 레퍼런스 원천 메커니즘 검증(리서치 repo-dive). 언어 유사가 아니라 상이한 관측 경로의 동일 결론.
- **분리 유지**: D-1과 D-3은 둘 다 "LLM 재량 판정에 결정론적 하한" 철학이지만 다음 프로브가 다름(D-1: E2E 기준선 확보 → 캘리브레이션 / D-3: 스킬 계약 예외 조항 설계) — 병합하지 않음.
- **조건부 7 내부의 3분류**(외부 산출물 의존 / 계약 예외 필요 / dogfooding 관측 의존)는 표면 유사성에도 불구하고 서로 다른 기제 — 인터뷰에서 개별 결정 필요.

## 7. Most Likely Explanation

이연 풀 문서는 HEAD 기준 정확하며 15항목 전부 미구현이다. 올바른 구현 형태는:

1. **T-1+A-5를 통합한 lsc_land 도구**가 강제 선두 — 발급 인프라(release-gate)가 완비되어 소비자 배선 + `validateWorktreeRemovalTarget` 순수 함수(순증분 4종: feature sanity·containment·심링크·root/home; dirty/locked 재구현 금지)만 남음. post-craft §7.4의 bash 손수 시퀀스를 도구로 승격하고 §7.1 프로즈 계약을 fail-closed 코드로 격상.
2. **핵심 6**(T-1+A-5, E-1, F-3, E-3-좁힘, T-2, D-2-리서치한정)은 즉시 코드화 가능하되, 리서치가 각 항목을 재정의했다: E-3는 CraftState 한정(HashManifest 반증·ModelsFile 연기), F-3는 FAIL=non-zero/WARN=0 exit 계약 + 실측 재사용 매트릭스, D-2는 claims.json=정본/SYNTHESIS=projection 계약, R0는 신규 설계(원형 부재).
3. **조건부 7**은 이 feature의 범위 결정이 필요: D-1(기준선 선행), D-3(계약 예외 조항 — 브라운필드 seam 한정 tautology 스모크로 격하된 형태), D-4·A-4p2(증분 미미·과차단 위험), E-2확장·B-2확장·C-2p2(dogfooding 후). trace는 "핵심 6 구현 + 조건부 7 중 문서/계약-한정 항목 선별"을 권고하나 최종 분리선은 소유자 결정.

## 8. Critical Unknown

**전체 1순위**: 조건부 7의 범위 분리선 — 이번 craft에 무엇을 포함하고 무엇을 명시적 비목표로 남기는가(특히 D-3 계약 예외를 스킬 산문 변경으로 이번에 넣을지, D-1을 기준선 확보 뒤로 완전 이연할지).

레인별:
- Lane 1: lsc_land의 identity 조립(active craft 부재 시 persisted 3필드 재조립)의 false-reject 여부; §7.1 프로즈 게이트의 도구 대체 계약 정합.
- Lane 2: 이연 풀 밖 잔여 산문-중복 지점 5+의 포함 여부(비목표 명시 필요).
- Lane 3: (문서는 정확하나) E2E 런타임 실동작 미검증.
- Lane 4: 단일 feature vs 분할의 소유자 결정 (release-gate 선례 조건 충족 여부).
- Lane 5: `npm run e2e`의 현재 green/red — D-1 착수 가능성의 유일 판별자.

## 9. Recommended Discriminating Probe

1. **최고가치**: 인터뷰의 범위 질문 자체 — 조건부 7의 분리선은 증거로 좁힐 수 없는 소유자 결정 (Stage 2 1순위 주입).
2. **D-1 한정**: `npm run e2e` 1회 실행(고비용, ~90분 타임아웃) — green이면 D-1 즉시 착수 가능, red면 완전 이연 확정. 이번 pre-craft에서 실행하지 않고 D-1을 조건부로 남기는 것이 비용 합리적 [권고].
3. **T-1 한정**: lsc_land 설계 시 identity 조립 경로의 fixture 테스트를 test canon에 선작성(false-reject 리스크를 RED 테스트로 고정).

## 10. Additional Trace Lanes — 불필요 (불확실성 낮음)

핵심 6의 seam·관례·원천이 3중 수렴했고, 잔여 불확실성은 전부 소유자 결정 또는 고비용 프로브(E2E)로 귀속. 추가 레인 없이 Stage 2로 진행.

---

## External Research Summary

전문: `research/SYNTHESIS.md` (인용 트레일 [S1]-[S18] 포함). 요약:

- **A-5**: git 원생 거부 R1-R5를 소스 수준 확정. 순증분 = feature sanity·containment(realpath 충돌 공격의 유일 방어)·심링크·root/home 4종. dirty/locked 재구현 금지. prune --expire 의미론, list --porcelain 안정 계약 확보.
- **F-3**: 4개 doctor 소스 판독 — exit 계약 잠금(FAIL=non-zero, WARN=0; flutter의 항상-0은 '게이트 비사용 설계'로 분류), expo 격리 뼈대 + flutter timeout + brew 서문·Finding 구조. 재사용 매트릭스 실측(즉시 재사용: src-hash·validatePreset / 소폭: worktree list·state 스캔·gitignore 체커 / 신규: plugin link·frontmatter 파서·registrar). BUILD_INFO.gitHash stale 함정, agents 9 vs 8 불일치 확인.
- **E-3**: 업계 관례(npm/Terraform/Cargo/ESLint) + countersearch + 내부 코드 검증으로 **CraftState 한정**으로 좁힘 — 업그레이드-중-craft 창 실재(파일 미삭제·post-craft 재기록·reader 4경로), HashManifest는 반증(매 init 전체 재계산), ModelsFile 연기.
- **D-1**: 앵커링 전제 정량 실증(+0.22 부풀림 등 7+ 1차 소스), max(reported,floor)는 산업 표준 동형. floor 고착 상한 안전장치는 선례 부재 — 자체 설계 필요. 캘리브레이션은 E2E 기준선 의존(현재 부재).
- **D-2**: 사전등록·FEVER·tombstone·projection 4축 정당화. claims.json=정본/SYNTHESIS=projection이 드리프트 경고의 정석 해법. "비적대·부주의 케이스의 결정론적 하한"으로 프레이밍(오라벨 우회 한계 병기).
- **D-3**: 재정의 — 스텁이 아니라 브라운필드 기존 seam의 일회성 변이 + baseline-green 독립 서브셋의 failure delta로만 kill 판정(full RED로는 불가) + 즉시 원자 복구. n=1은 스위트 변별력 검증이 아님(countersearch) — 'seam 한정 tautology 스모크'로 계약 문구 격하. 그린필드는 명시 N/A.
- **E-1/R0**: scaffold 원천의 이식 코어(sentinel no-op·2단 reset·심링크 containment) + loose sentinel·비원자 쓰기 교정 여지. R0 원형은 lazycodex에 부재 — 신규 설계.
- **omp SDK**: registerTool/registerCommand/pi.exec/이벤트 채널 전수 — 신규 도구·커맨드에 충분. SessionStopEvent stop-사유 구조적 부재 재확인(C-2p2 원안 불가 확정).
