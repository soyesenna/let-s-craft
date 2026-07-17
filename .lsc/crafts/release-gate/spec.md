# Spec — release-gate

## Metadata

| 항목 | 값 |
|---|---|
| Feature | release-gate — lsc_craft_release 승인 게이트 패키지 (A-1 nonce + A-2 open-release 증거 + A-3 상태 토큰화) |
| 분류 | Brownfield (trace 확정 — 기존 도구 개조, git 이력·정본 file:line 인용 실재) |
| 공식 | ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| 최종 ambiguity | **0.047** (게이트 0.05 통과, 7라운드) |
| Challenge modes | contrarian@R4, simplifier@R6 (각 1회 발동) · ontologist 미발동(R7 종료, ambiguity 0.053 < 0.3) |
| 인터뷰 특성 | fixture 태그-키 스크립트 환경 — 4개 차원 블롭([Goal]/[Constraints]/[Success Criteria]/[Context]) 자유 답변 수확, 블롭 간 모순 0. 미시 결정은 블롭 자체 언어("방금 소비"·"판별 가능")와 trace 증거의 유일 정합 해석으로 종합 |
| 환경 고정 | repo cc17764 기반 feat/release-gate, worktree .lsc/worktrees/release-gate |
| 정본 | `_docs/reference-insights.md` A-1/A-2/A-3, `.omc/plans/ralplan-reference-insights-impl.md` Phase 4 미션 브리프 (rev.4, land 예외 조항 포함) |
| 작성일 | 2026-07-17 |

## Clarity Breakdown (최종)

| Dimension | Score | Weight | Weighted | 근거 |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | 3부 패키지·발급/소비 매트릭스·권위 분리 전부 확정 |
| Constraints | 0.95 | 0.25 | 0.238 | 검증자 유보 계약화 + 스키마·쓰기·enforcement·land 예외 규칙 확정 |
| Criteria | 0.96 | 0.25 | 0.240 | AC 7항 기계 검증 목록 사용자 원문 확보 (R5=R7 멱등 확인) |
| Context | 0.93 | 0.15 | 0.140 | trace 5-lane 종합 + 코드 좌표 + 시나리오5 정합 지시 |

## Topology (sub-components)

| ID | 컴포넌트 | 소유 파일 | 최종 점수(G/C/Cr) |
|---|---|---|---|
| A | nonce 게이트 (발급→권위→소비) | src/ask.ts(래퍼), src/craft/state.ts(슬롯), src/craft/release.ts(소비) | 0.96 / 0.95 / 0.96 |
| B | open-release 증거 상태머신 | src/craft/release.ts(기록), src/craft/hash-manifest.ts(verify 게이트+init close), src/craft/run-tests.ts(메시지) | 0.96 / 0.95 / 0.96 |
| C | 소비자 co-evolution | skills/craft/SKILL.md, test/enforcement-rules.test.ts(시나리오5), test/craft-release.test.ts, fixtures | 0.93 / 0.94 / 0.95 |

라운드별 타깃: A+C(R1)→A(R2)→A+C(R3)→A(R4 contrarian)→B+전역(R5)→B+C(R6 simplifier)→전역(R7). `topology.last_targeted_component_id = 전역(R7)`.

## Goal

문서화된 보안 MEDIUM — `src/craft/release.ts:68`의 `approval:"read"`(lsc_craft_release가 사용자 승인 검증 없이 실행됨) — 을 닫는다. 세 부분:

- **(A-1) nonce 승인 토큰**: `lsc_confirm`이 파괴적 게이트 질문([Canon Amendment]/[Land] 등)에서 UUID nonce를 발급해 `.craft-state.json`에 기록하고, `lsc_craft_release`는 "해당 nonce가 걸린 confirm이 방금 사용자 yes로 소비되었음"을 TS 레벨에서 fail-closed 검증할 때만 실행된다 (승인 없으면 isError 거부).
- **(A-2) open-release 증거 계약**: release 실행 시점에 open-release 증거(승인 게이트 태그와 응답 원문, 해제 시점 해시 매니페스트 지문, 예정 수정 범위 reason)를 `.craft-state.json`에 선기록하고, open-release가 닫히지 않은 동안 `lsc_verify_hash`와 `lsc_run_tests`는 fail-closed로 거부한다 — release 후 재베이스라인 전 verify blind 창(정본 hash-manifest.ts:268, 현행 :310의 ctx.cwd 폴백)을 상태머신으로 닫는다. `lsc_craft_init` 재베이스라인이 open-release를 close하며 old/new 매니페스트 diff 요약을 상태에 남겨 post-craft 감사 입력으로 쓰이게 한다.
- **(A-3) 상태 토큰화**: release 승인 상태를 durable 파일 토큰으로 남겨 세션 재시작 후에도 **판별** 가능하게 한다.

핵심 엔티티와 관계 (한 문장 각):
- **파괴적 게이트 태그 집합**: `[Canon Amendment]`·`[Land]`·`[Hash Violation]` — TS 상수 모듈이 SSOT, 별칭 없음.
- **nonce**: confirm 래퍼가 (태그 집합 매칭 ∧ active craft 존재 ∧ 플랫폼 산출 yes)에서 발급하는 UUID — **소비 권위는 in-process 메모리 대기 슬롯 1개**(최신 발급이 교체), 모델이 쓸 수 없고 abort/세션 전환/재시작 시 자동 실효.
- **소비 규칙**: `lsc_craft_release`만 소비, single-use, 소비 즉시 무효화 — 무승인·기소비·태그 불일치 호출은 isError.
- **승인 증거 + durable 토큰**: 발급·소비 사실(태그·질문·응답 원문·시점)을 `.craft-state.json`에 기록 — 재시작 후 판별·감사 전용이며 소비 권위가 아니다.
- **open-release 증거**: release가 소비 직전 기록(태그·응답 원문·해제 시점 매니페스트 지문·reason) — init 재베이스라인이 close하고 old/new diff 요약을 남긴다.
- **fail-closed 게이트**: open-release 미폐쇄 동안 verify(실 게이트 신설)와 run_tests(기존 no-active-craft 가드의 메시지 업그레이드)가 재베이스라인 안내를 포함해 거부.

## Constraints

1. **검증자 유보의 계약화**: 주입-예시 소독은 구현하지 않는다 (lsc_confirm의 yes/no는 ctx.ui 산출물 — 모델 에코 위조 불가; 실 위협은 confirm을 건너뛴 직접 release 호출이며 nonce-소비 게이트가 막는다). npm tarball 다운로드-백 대조는 이식하지 않는다 — 증거 스키마는 lets-craft 도메인(해시 매니페스트·게이트 태그)으로 재정의. (R2)
2. **권위/증거 분리** (R4 contrarian 생존): 소비 권위 = in-process 메모리 싱글턴, `.craft-state.json` = 판별·감사 전용 durable 증거. 재시작 시 미소비 nonce 실효(새 confirm 필요). **정본 교정 기록**: A-1 원문은 "파일에 기록하고 게이트가 검증"으로 읽히나, A-3의 요구는 '판별 가능'이지 '소비 가능'이 아니고("방금 소비" freshness 의미론), `.craft-state.json`은 매니페스트 EXCLUDED + fail-open 1차 방어뿐이라 파일 권위는 자기모순(trace V2) — 파일 기록 요구는 증거 원장 반쪽으로 충족한다.
3. **CraftState 확장 필드 전부 optional + 읽기 관용** — 구버전 상태 파일 호환, failureSignature 선례(state.ts:38-48). (R2)
4. **durable 쓰기는 기존 `writeFileAtomicSync`**. (R2)
5. **enforcement 설계 원칙 유지** (cap·카운터는 플랫폼 소유) — open-release 창의 tool_call 블록 확장은 하지 않는다(R6 simplifier에서 가정된 복잡성으로 배제; 창 방어는 verify/run_tests 거부 + init diff 감사 기록이 담당). (R2+R6)
6. **fixture 모드(LSC_FIXTURE)에서도 confirm 소비가 동일 경로로 nonce를 발급·소비** — 향후 E2E 가능성 보장. (R2)
7. **land 예외 조항** (합의 계획 rev.4): 이 feature 자신의 land는 개조 **이전** dist로 수행하고 land 후 rebuild — nonce 소비 강제는 다음 feature부터 활성. **이 feature의 구현이 현재 세션의 진행 자체를 막아서는 안 된다.** (R2)
8. **A-2 표면 교정** (trace Lane 3): run_tests는 기존 no-active-craft 가드(run-tests.ts:206-211)가 open-release 구간을 이미 fail-closed로 덮는다 — 신설 게이트는 verify(hash-manifest.ts:310 폴백 전)에만, run_tests는 open-release 감지 시 재베이스라인 안내를 포함하는 **메시지 업그레이드**로 AC(4)를 충족한다.
9. **순수 함수/thin wrapper 관례 유지**: vitest가 omp SDK를 import할 수 없으므로(기존 6파일 명시 근거) 게이트·증거 로직은 순수 함수로 분리하고 pi.registerTool 래퍼는 얇게. 발급은 performConfirm 내부가 아니라 execute 래퍼(ask.ts:627-629)에서 — performConfirm의 craft-agnostic 순수성 보존.
10. **태그 상수는 TS 모듈 SSOT** — 스킬 산문·테스트가 이를 따르며 별칭 금지. 시나리오5의 `[Release]` prefix는 `[Canon Amendment]`로 정규화(테스트 co-evolution). (R6)
11. **질문 태깅 규약 불변**: 태그 prefix + proceed?/land? 계열 suffix는 fixture 매칭의 안전 지대 — 이 feature가 도입하는 태그 인식은 발급 조건일 뿐 규약 자체를 바꾸지 않는다.

## Non-Goals

- **lsc_land 도구 신설** — land는 post-craft 스킬의 bash `git merge` 유지; merge 차단 배선은 Phase 5(audit-verify)의 명시 범위. 발급 인프라는 [Land] 태그를 포함해 마련되므로 향후 소비자 추가만으로 확장 가능.
- **lsc_restore_tests 소비 게이트** — 보안 MEDIUM 문서화 범위 밖. [Hash Violation] 발급 인프라만 마련.
- **enforcement tool_call 블록의 open-release 창 확장** (Constraints 5).
- **주입-예시 소독 / AUDIT VERDICT 라인 확장** (검증자 유보 그대로).
- **npm tarball 다운로드-백 대조 이식** (패키지 발행 특화).
- **시간 기반 nonce 만료** — 이벤트 기반 실효(abort/세션 전환/재시작/재발급 교체/소비)로 충분 (trace V5).
- **CraftState 스키마 버전 필드** — E-3 후순위 승계 (ralplan pre-mortem #3).
- **오래된 정본 라인 번호의 소급 수정** — spec/plan은 현행 HEAD 라인으로 재고정하되 정본 문서 자체는 불변.

## Acceptance Criteria (R5 사용자 원문, R7 멱등 재확인)

`run_test.sh`가 다음을 기계 검증한다:

1. **무승인 거부**: nonce 미발급/미소비 상태에서 `lsc_craft_release` 호출 → isError fail-closed 거부.
2. **승인 직후 성공**: 파괴적 게이트 confirm이 yes로 소비된 직후의 release → 성공.
3. **일회용**: 같은 nonce의 재사용(두 번째 release) → 거부.
4. **open-release 봉쇄**: open-release가 열린 동안 `lsc_verify_hash`/`lsc_run_tests` → fail-closed 거부, 명시 에러 메시지에 재베이스라인 안내 포함.
5. **재베이스라인 복귀**: `lsc_craft_init` 재베이스라인 후 → 정상 동작 복귀 + open-release close + old/new 매니페스트 diff 기록 존재.
6. **구버전 관용**: 신규 필드가 없는 구버전 `.craft-state.json` 로드 시 관용 파싱 (기존 동작 무변화).
7. **무회귀**: 기존 단위 테스트 스위트 전수 green 유지.

테스트는 순수 함수/도구 계층 위주의 vitest로 작성하고 **실제 LLM 호출을 요구하지 않는다**.

## Assumptions Exposed & Resolved

| 가정 | 노출 방식 | 해소 |
|---|---|---|
| "approval:'read'가 어떤 보호를 제공한다" | trace Lane 1 (Tier 1) | 반증 — tier 분류 필드일 뿐, yolo 기본값에서 무조건 allow. 게이트는 0행 |
| "nonce를 파일에 두면 durable해서 좋다" | trace Lane 4 V2 + R4 contrarian | 반증 — EXCLUDED+fail-open 매체에 권위 저장은 자기모순. 권위=메모리/증거=파일 분리 |
| "재시작 후에도 nonce가 소비 가능해야 한다" | R4 contrarian | 반증 — A-3 원문은 '판별 가능'. 재시작 시 실효+재확인(비용: confirm 1회)이 안전 |
| "A-2는 verify와 run_tests에 동격 게이트 신설" | trace Lane 3 (Tier 1급) | 교정 — run_tests는 기존 가드가 커버, 신설은 verify 1곳 + run_tests 메시지 업그레이드 |
| "land도 이번에 도구로 게이트해야 한다" | R1+R3 (Goal 블롭: 소비자는 release만 언급) | 비목표 확정 — 발급 인프라([Land] 태그)만 마련, 소비는 Phase 5 |
| "fixture 자동 yes는 게이트 우회다" | trace Lane 4 V6 | 반증 — LSC_FIXTURE는 운영자 신뢰 seam, 모델 자가 활성화 불가. 동일 경로 소비 제약(R2)으로 E2E 정합성만 확보 |
| "open-release 창은 enforcement 블록도 유지해야 한다" | R6 simplifier | 배제 — AC에 없는 가정된 복잡성. verify/run_tests 거부 + init diff 감사가 설계된 방어 |
| "게이트 도입이 정상 플로우를 막을 수 있다" | trace Lane 1 critical unknown + R2 | 해소 — 스킬 계약이 이미 모든 release 전 confirm을 강제(craft §1.4:26, §4:124)하므로 무손상; 이 feature 자신의 land는 land 예외 조항 |
| "번들 E2E가 release 경로를 회귀 검증한다" | trace Lane 5 (grep) | 반증 — e2e-full-cycle은 release 미호출. 회귀 표면은 시나리오5(enforcement-rules)와 단위 테스트 |

## Technical Context

- **삽입 지점** (trace Lane 1, 현행 HEAD 재고정): 발급 = `ask.ts:627-629` lsc_confirm execute 래퍼 (pi·getActiveCraft·params.question 접근 가능). 소비 = `release.ts:26`(getActiveCraft)~`:30`(clearActiveCraft) 사이 — 소비 표시·증거 기록은 clearActiveCraft **전에** persist (markCraftAborted state.ts:132-136 양식). verify 게이트 = `hash-manifest.ts:310` ctx.cwd 폴백 **전**. init close = `hash-manifest.ts:272-279` setActiveCraft가 fresh 객체로 교체하는 지점 (기존 durable 증거를 읽어 close 처리 후 diff 요약 기록).
- **상태 기반**: CraftState(state.ts:18-57) — 현행 필드 feature/projectRoot/worktreeRoot?/testsPassed/lastFailureSummary?/failureSignature?/consecutiveFailures?/aborted. persist(state.ts:61-65)=writeFileAtomicSync. `.craft-state.json`은 EXCLUDED_FILES(hash-manifest.ts:57) — 증거 기록이 해시 위반을 유발하지 않음. loadActiveCraft(state.ts:86-91)는 shape 무검증 → optional 역호환. clearActiveCraft(:139-141)는 파일 잔존 → open-release 증거가 디스크 생존.
- **재시작 의미론**: loadActiveCraft 호출자 0 (자동 복구 없음) — 재시작 직후엔 active craft 부재로 release 자체가 불가, resume 계약이 lsc_craft_init 재호출 강제. 미소비 nonce의 재시작 실효는 이 구조와 정합.
- **run_tests 기존 가드**: run-tests.ts:206-211 `!craft || craft.feature !== feature → isError` — open-release 구간(=무활성 craft) 전체를 이미 fail-closed로 커버.
- **이력**: v1.1 R8이 lsc_craft_release 경로 도입 — 이번 작업은 그 경로에 승인 게이트 부착. Phase 0~3 완료 확인(quick win 7건, C-1, E2E 기준선 — trace Lane 3 커밋 매핑). atomic-write(2fda955)·init 산출물 검사(a052004, A-3(a) 기완료) 기반 위에 얹는다.
- **테스트 지도** (trace Lane 5): test/craft-release.test.ts(3 tests, FreshState 헬퍼 확장 필요), mock·스냅샷 전무 관례(실 싱글턴+tmpdir, 필드별 단언), `npm test`=단위/`npm run e2e`=build+3파일 직렬. 시나리오5(enforcement-rules.test.ts:352-435)가 confirm→release→re-init 실주행 — `[Release]`(:380) prefix를 `[Canon Amendment]`로 정규화하고 무승인 거부 1암 추가. 번들 e2e-full-cycle은 release 미호출(회귀 무관).
- **fixture 경로**: performConfirm fixture 분기(ask.ts:494-504)와 UI 분기가 같은 confirmResult로 수렴 — 발급을 래퍼에서 하면 채널 무관 동일 경로 소비(Constraints 6) 자동 충족.

## Trace Findings

`trace.md` 참조 — 최유력 설명(권위/증거 분리형 A-1+A-2+A-3 패키지, A-2 표면 verify 1곳 축소, 태그-바인딩 single-use nonce). 임계 미지수 5건은 인터뷰 R1-R6에서 전부 해소: land 스코프(R1+R3→비목표), 권위 매체(R4→분리), 발급·소비 매트릭스(R3→태그 집합/release만), open-release 잔여 방어(R6→enforcement 확장 배제), 라인 드리프트(R6→현행 재고정). 외부 리서치는 fixture 스텁 (trace.md "External Research Summary").

## Ontology

최종 엔티티(18): 파괴적 게이트 태그 집합(TS SSOT) · nonce(UUID) · 인메모리 대기 슬롯(권위, 최신 교체) · 소비 규칙(single-use 즉시 무효화) · 재시작 실효 규칙 · 승인 증거(durable) · durable 판별 토큰(A-3) · open-release 증거(태그·응답 원문·매니페스트 지문·reason) · open-release 상태머신(open→close) · verify fail-closed 게이트 · run_tests 안내 메시지 업그레이드 · init 재베이스라인 close · old/new diff 요약 기록 · 발급 래퍼(ask.ts execute) · 소비 검증(release 순수 함수) · 시나리오5 정규화 · fixture 동일 경로 소비 · land 예외 조항.

CORE 개념: **인메모리 대기 슬롯(권위)과 durable 증거의 분리** — 모든 결정(발급 조건, 소비 규칙, 실효 이벤트, A-2/A-3의 파일 역할, 테스트 표면)이 이 분리에서 파생된다.

## Ontology Convergence

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 9 | — | — | 9 | 0 | N/A |
| 2 | 13 | 9 | 0 | 4 | 0 | 0.69 |
| 3 | 13 | 12 | 1 | 0 | 0 | 1.00 |
| 4 | 15 | 12 | 1 | 2 | 0 | 0.87 |
| 5 | 17 | 15 | 0 | 2 | 0 | 0.88 |
| 6 | 18 | 17 | 0 | 1 | 0 | 0.94 |
| 7 | 18 | 18 | 0 | 0 | 0 | **1.00** |

Changed 이력: R3 파괴적 게이트 태그→태그 집합(SSOT 승격, rename), R4 nonce→인메모리 권위+durable 증거 이원화(retype) — 전부 rename/retype으로 stability 가산.

## Interview Transcript

3-point injection: Override 1(최유력 설명 보강 — 저신뢰 분기 미적용), Override 2(trace 종합 = 코드베이스 컨텍스트, 재탐색 없음), Override 3(임계 미지수 → R1-R3 주입).

| R | 태그/모드 | 질문 요지 | 답변 (fixture 태그-키 자유 답변) | ambiguity(후) |
|---|---|---|---|---|
| 1 | [Goal] 주입#1 | land 스코프: release 한정 vs lsc_land 신설 vs 순수 함수 선반영 | **[Goal] 블롭**: 3부 목표 원문 — 발급 태그에 [Land] 포함, 소비는 release만 언급 → release 한정 | 0.305 |
| 2 | [Constraints] 주입#2 | nonce 소비 권위 매체: 메모리+파일 분리 vs 파일 권위 vs 메모리 전용 | **[Constraints] 블롭**: 검증자 유보 계약화, optional 관용, atomic write, enforcement 원칙, fixture 동일 경로, land 예외(세션 진행 차단 금지) | 0.240 |
| 3 | [Goal] 주입#3 | 발급·소비 매트릭스: 태그 집합/소비 도구/SSOT/시나리오5 | [Goal] 블롭 재수신 — 매트릭스 확정(발급=태그 집합, 소비=release만) | 0.212 |
| 4 | [Constraints] CONTRARIAN | "재시작 후 소비 가능" 제약이 실재하는가 — 권위/증거 분리 확정? | [Constraints] 블롭 재수신 — 블롭 언어("방금 소비"·"판별 가능")로 판정: 제약 부존재, 분리 채택 | 0.182 |
| 5 | [Success Criteria] | 수용 기준 5개 관측 형태 | **[Criteria] 블롭**: run_test.sh 기계 검증 AC 7항 + vitest 순수 계층 + 실 LLM 불요 | 0.103 |
| 6 | [Context] SIMPLIFIER | 잔여 통합 지점 (a)~(d)의 필수 vs 가정 | **[Context] 블롭**: 정본 좌표 + v1.1 R8 이력 + 시나리오5 정합 검토 지시 → (a)정규화 (b)배제 (c)유지 (d)채택 | 0.053 |
| 7 | [Success Criteria] 총체 | 7항 패키지 확정? | [Criteria] 블롭 재수신 = AC 멱등 재확인, 모순 0 | **0.047 ✓** |

각 라운드에서 점수표(Dimension/Score/Weight/Weighted/Gap)·병목 1문장·컴포넌트 로테이션을 채팅에 표시. 질문 도구: lsc_select(R1·R3·R7), lsc_confirm(R4), lsc_ask(R5·R6). 전 질문 §1.2 태깅 규약 준수. 자유 답변은 인터뷰 혼합 규칙(§1.2(c))에 따라 해당 라운드의 답으로 채점.
