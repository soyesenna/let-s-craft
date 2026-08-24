# Spec — postcraft-14cycle-approval-failure

## Metadata

| 항목 | 값 |
|---|---|
| Feature | post-craft 수렴 장치 종합 구현 — 루프 바운딩(상한3+주기 에스컬레이션+처분) · 측정 위생(check 의무·commit-first·인용 검증) · 사전 차단(AC 검증가능성 게이트·base drift) · 다중-lens AWC 경로 |
| 분류 | Brownfield (trace 확정 — lets-craft 저장소의 계약·TS seam 개조) |
| 공식 | ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| 최종 ambiguity | **0.046** (게이트 0.05 통과, 9라운드) |
| Challenge modes | contrarian@R5(fail-closed 실재성), simplifier@R6(강제 경계) · ontologist 미발동 (R8 시점 ambiguity 0.073 < 0.3) |
| 주입 | 3-point injection 적용 — Override 1(4중 합성 최유력 설명), Override 2(trace 종합=컨텍스트, 재탐색 없음), Override 3(임계 미지수 → R1~R3) |
| 환경 고정 | lets-craft feat/postcraft-14cycle-approval-failure, worktree .lsc/worktrees/postcraft-14cycle-approval-failure |
| 진단 정본 | trace.md + research/claims.json (18/18 accepted) — 대상 사례: 대상 프로젝트 <대상 기능> (15/15 REJECT) |
| 작성일 | 2026-08-24 |

## Clarity Breakdown (최종)

| Dimension | Score | Weight | Weighted | 근거 |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | 장치 4묶음 in/out + 다중-lens AWC 포함 + 스코프 동결 비목표 확정 |
| Constraints | 0.95 | 0.25 | 0.238 | fail-closed 불변·TS/산문 강제 경계·base drift 2단 구성·하위 호환 관례 확정 |
| Criteria | 0.97 | 0.25 | 0.243 | AC 10항 사용자 원문 확정 (R9 yes) |
| Context | 0.92 | 0.15 | 0.138 | trace 5-lane + 판별 프로브 + 코드 좌표 (verdict.ts/state.ts/land.ts/SKILL 라인) |

## Topology (sub-components)

| ID | 컴포넌트 | 소유 파일 | 강제 수준 |
|---|---|---|---|
| A | 루프 바운딩 (상한 카운터·[Audit Escalation] 게이트·처분 기록) | src/craft/verdict.ts, src/craft/state.ts, skills/post-craft/SKILL.md | TS fail-closed |
| B | base drift 게이트 (감지@audit_begin, 차단@land) | src/craft/verdict.ts, src/craft/land.ts | TS fail-closed |
| C | 측정 위생 계약 (craft pre-yield check 의무·auditor commit-first·인용 실증) | skills/craft/SKILL.md, skills/post-craft/SKILL.md §3.0, agents/lsc-auditor.md, audit 문서 템플릿 | 산문+템플릿 |
| D | 사전 차단 (AC 검증가능성 분류 의무·live-전용 AC의 대리 게이트 범위 명시) | skills/pre-craft/SKILL.md Stage 2 | 산문 |
| E | 다중-lens AWC 경로 | skills/post-craft/SKILL.md §5 | 산문(계약) |
| F | 검증 표면 (vitest 단위 + 다중 사이클 E2E) | test/, fixtures/ | 테스트 |

라운드별 타깃: A·전역(R1)→전역(R2)→E(R3)→F(R4 [Criteria])→A·불변식(R5 contrarian)→경계(R6 simplifier)→A 수치(R7)→B(R8)→전역 멱등(R9). `topology.last_targeted_component_id = 전역(R9)`.

## Goal

대상 프로젝트 `<대상 기능>`의 14-cycle 전-REJECT 사태(trace.md 4중 합성: 요구 축 H-B / 계약 축 H-A / 트레드밀 H-C / 측정 오염 H-D / 종단 봉쇄 H-E)에서 **lets-craft가 소유한 수정 가능 표면 전부**를 닫는 수렴 장치 패키지를 구현한다:

1. **(A) 루프 바운딩**: post-craft audit 사이클에 상한 3(fixture 모드 2)을 도입한다. 상한 도달 시 `[Audit Escalation]` 사용자 게이트가 발동하고, 소비 전에는 `lsc_audit_begin`이 fail-closed로 거부된다. 사용자가 "계속"을 선택하면 이후 3사이클마다 재발동하는 주기형이다. 처분은 3종 — 계속 / 중단(abort 위임) / branch 보존 종결 — 이며 durable 기록된다.
2. **(B) base drift 게이트**: `lsc_audit_begin`이 base branch 뒤처짐(커밋 수)을 계산해 WARN+감사 문서 기재 의무로 남기고, `lsc_land`가 merge 직전 base tip 대비 경로 충돌(F14-1형 이중 점유)을 fail-closed로 검사한다.
3. **(C) 측정 위생**: craft가 yield 전 `run_check.sh` 실행을 의무화하고(red 상태 yield 금지 — C-13: 예방 가능 red 83%), auditor는 diff 열람 전 기대 상태를 먼저 서술(commit-first — C-17: 코드-선행형 83.6%)하며, finding의 spec/plan 인용은 file:line 실증을 의무화한다(오인용 7/10).
4. **(D) 사전 차단**: pre-craft spec 단계에서 AC마다 검증가능성 분류(결정적/하이브리드/live-전용)를 의무화하고, live-전용 AC가 존재하면 그 대리 게이트의 증명의무 범위를 spec에 명시하도록 강제한다(C-07/C-15: 개방형 증명의무 재생산 차단).
5. **(E) 다중-lens AWC**: post-craft §5의 단수-lens 공백을 닫아, 여러 lens의 blocking finding을 한 사이클의 Required Fix 묶음으로 처방하고 lens별 fix-verification으로 재확인하는 경로를 정의한다(AWC 종결 도달성 회복 — C-12).

핵심 엔티티와 관계 (한 문장 각):
- **사이클 상한 카운터**: `.craft-state.json`의 auditCycle을 상한 3(fixture 2)과 비교하는 TS 판정 — `lsc_audit_begin`이 소유.
- **[Audit Escalation] 게이트**: 상한 도달 시 발동하는 사용자 선택 게이트 — 로드베어링 라벨 3종("Continue auditing" / "Abort this craft" / "Preserve branch and stop"), §1.2 태깅 규약 준수.
- **처분 기록**: 선택 결과를 CraftState에 durable 기록 — 중단·보존 선택 후 audit_begin은 거부.
- **주기형 재발동**: 계속 선택 시 +3사이클마다 게이트 재발동 — 일회성 아님.
- **fail-closed land 불변식**: merge는 여전히 APPROVE-family verdict + 사용자 승인만 — 에스컬레이션은 merge 권한을 만들지 않는다 (R5 contrarian 생존).
- **base drift 감지/차단 분리**: 감지·기록은 audit 시작(진행 비방해), 차단은 land(오염 merge 방지).
- **commit-first 의무**: auditor가 판정 대상 코드를 인용하기 전 spec/plan 기반 기대 상태를 서술 — 산문 계약+Expected State 템플릿 섹션.
- **AC 검증가능성 분류**: spec의 AC 테이블 필수 열 — live-전용 AC는 대리 게이트 증명의무 범위 명시 없이는 spec 완성으로 치지 않는다.

## Constraints

1. **fail-closed 불변** (R5 contrarian 생존): 상한 도달·에스컬레이션 어떤 경로로도 REJECT 상태 merge는 불가. `lsc_land`의 APPROVE-family 요구는 무손상. 처분 "branch 보존 종결"은 merge가 아니라 worktree/branch 존치+상태 토큰화다.
2. **강제 경계 = 혼합** (R6): 상한·처분·base drift는 TS fail-closed(위반 시 피해가 큰 장치), 측정 위생(check 의무·commit-first·인용 검증)은 SKILL/agents 산문+템플릿 의무. 산문 장치도 audit 문서에 관측 가능한 흔적(Expected State 섹션, 인용 실증 표기)을 남겨 사후 감사 가능해야 한다.
3. **CraftState 확장 필드 전부 optional + 읽기 관용** — 구버전 상태 파일 호환 (release-gate 선례, state.ts 관례).
4. **durable 쓰기는 기존 `writeFileAtomicSync`** — 새 저장 경로 신설 금지.
5. **순수 함수/thin wrapper 관례 유지** — 게이트·판정 로직은 순수 함수로 분리, pi.registerTool 래퍼는 얇게 (vitest가 omp SDK를 import 불가한 기존 제약).
6. **질문 태깅 규약 준수**: `[Audit Escalation]` 태그 + suffix(proceed?/continue? 계열) — fixture 매칭 안전 지대. 라벨 3종은 로드베어링(fixture 규칙이 verbatim 매칭).
7. **fixture 모드 상한 2** — pre-craft [Consensus Escalation]의 fixture 축소 관례 미러링. E2E 다중 사이클 시나리오는 이 값으로 구동.
8. **cap 수치의 SSOT는 TS 상수 모듈** — SKILL.md 산문은 상수를 참조 서술 (별칭·중복 수치 금지).
9. **에스컬레이션은 방향 결정 전용** — "계속" 외 처분의 실행(abort)은 기존 도구(lsc_craft_abort)에 위임, 새 파괴 경로 신설 금지.
10. **기존 15개 audit 산출물 형식과 호환**: audit-N.md 헤더/verdict 파싱(literal parser) 무손상 — Expected State 섹션은 추가 섹션이지 기존 섹션 개편이 아니다.

## Non-Goals

- **재감사 스코프 동결(IEEE 1028식 축소 재검사)** — R2에서 명시 제외. §2.6의 full 재감사는 유지하되 상한이 총량을 바운딩한다.
- **대상 프로젝트 feature 회생 절차 산출물** — R1에서 제외 (trace.md §9의 권고 문단으로 갈음).
- **REJECT 상태 최선안 land 예외** — R5에서 기각.
- **인용 검증·commit-first의 기계 강제 도구** — R6에서 산문 경계로 확정 (방향성 적용; exact-match 개방형 문제는 문헌상 future work).
- **auditor 병렬 멀티패스+집계 체제 개편** — countersearch가 시사한 대안이나 이번 범위 밖 (open-questions.md).
- **pre-craft/craft의 상한 변경** — post-craft만 다룬다 (pre-craft cap 10, craft re-entry cap 1 불변).
- **check/run_check.sh 하니스 자체의 표준화** — 대상 프로젝트 소관.

## Acceptance Criteria (R9 사용자 확정 원문)

각 AC는 검증가능성 분류를 동반한다 (이 spec 자신이 D 장치의 형식을 준수):

1. **AC-1 사이클 상한** [결정적/vitest]: audit cycle 3(fixture 2) 도달 시 [Audit Escalation] 게이트 미소비 상태의 `lsc_audit_begin`은 isError 거부; 소비 후 재개; 이후 3회마다 재발동.
2. **AC-2 처분 기록** [결정적/vitest]: 에스컬레이션 처분(계속/중단/branch 보존 종결)이 `.craft-state.json`에 durable 기록; 중단·보존 선택 후 audit_begin 거부.
3. **AC-3 fail-closed 불변** [결정적/vitest]: REJECT 상태의 `lsc_land` 거부 동작 무회귀.
4. **AC-4 base drift** [결정적/vitest]: audit_begin이 base 뒤처짐(커밋 수)을 계산·기록(WARN); `lsc_land`가 merge 직전 base tip 대비 경로 충돌을 fail-closed 검사.
5. **AC-5 측정 위생 산문** [결정적/문서 존재 검사]: craft/post-craft SKILL에 'craft yield 전 run_check 의무' 명문 + lsc-auditor.md에 commit-first·인용 file:line 실증 의무 + audit 템플릿에 Expected State 섹션.
6. **AC-6 검증 불가 AC 게이트** [결정적/문서 존재 검사]: pre-craft spec 단계에 AC 검증가능성 분류 의무화 + live-전용 AC 존재 시 대리 게이트 증명의무 범위 명시 강제.
7. **AC-7 다중-lens AWC** [결정적/문서 존재 검사]: post-craft §5에 다중-lens Required Fix 묶음 + lens별 fix-verification 경로 정의.
8. **AC-8 E2E** [결정적/E2E]: fixture E2E에 다중 사이클(REJECT 반복→에스컬레이션→처분) 시나리오 신설 + 기존 E2E 전체 green.
9. **AC-9 단위** [결정적/vitest]: 신규 TS 로직 전부 vitest 커버.
10. **AC-10 하위 호환** [결정적/vitest]: 신규 CraftState 필드 전부 optional + 구버전 상태 파일 관용 파싱.

live-전용 AC: 없음 — 전 항목이 루프 내 결정적 검증 가능 (D 장치의 자기 준수).

## Assumptions Exposed & Resolved

| 가정 | 노출 방식 | 해소 |
|---|---|---|
| "원인 규명(보고서)이 최종 산출물이다" | R1 [Goal] | 반증 — 사용자는 수렴 장치 종합 구현을 선택 |
| "스코프 동결이 트레드밀 해소의 필수 요소다" | R2 [Goal] 복수선택 | 배제 — full 재감사 보증 유지, 상한이 총량 바운딩 |
| "AWC 경로는 현행 계약으로 충분하다" | R3 [Goal] (trace 임계 미지수 #2) | 반증 — §5 단수-lens 공백 수리 포함 |
| "상한 도달 시 최선안 land가 필요할 수 있다" | R5 CONTRARIAN | 기각 — fail-closed 불변식 유지, 에스컬레이션은 방향 결정 전용 |
| "전 장치 기계 강제가 안전하다" | R6 SIMPLIFIER | 교정 — 위반 피해 큰 3종만 TS, 위생은 산문 (의미론적 검사의 기계화 품질 한계) |
| "상한은 일회성 게이트면 충분하다" | R7 [Criteria] | 교정 — 주기형(3회마다 재발동) 채택 |
| "base drift는 감사 시작에서 차단해야 한다" | R8 [Constraints] | 교정 — 감지@begin / 차단@land 2단 분리 (진행 비방해) |
| "cap 단독으로 수렴이 회복된다" | 외부 문헌 (C-16: caps rarely bind) | 반영 — cap은 4묶음 중 하나일 뿐, 측정 위생·사전 차단과 합성 |

## Technical Context

- **A 삽입 지점**: `src/craft/verdict.ts:255+` performAuditBegin — 기존 cycleWarn(:277-282, 판정 무영향)을 fail-closed 게이트로 승격. 상태 필드는 `src/craft/state.ts` CraftState에 optional 추가(escalation 소비 기록·처분·다음 발동 사이클). persist = writeFileAtomicSync. 게이트 소비 증거는 release-gate의 nonce/승인 증거 선례(발급·소비 매트릭스) 참조 — 단 여기서는 파괴적 태그가 아니라 방향 결정 게이트.
- **B 삽입 지점**: 감지 = performAuditBegin (base branch tip 대비 `git rev-list --count` 산출·기록); 차단 = `src/craft/land.ts`의 기존 fail-closed 검증 체인에 경로 충돌 검사 추가 (merge-base..양측 tip의 신규 경로 교집합 — F14-1형 이중 점유 탐지).
- **C 삽입 지점**: skills/craft/SKILL.md (yield 전 check 의무), skills/post-craft/SKILL.md §3.0/§4 (Expected State 템플릿 섹션 + 인용 실증 의무), agents/lsc-auditor.md (commit-first 서술 순서 계약).
- **D 삽입 지점**: skills/pre-craft/SKILL.md Stage 2 Output spec.md 절 — AC 분류 열 의무 + live-전용 AC 처리 규칙.
- **E 삽입 지점**: skills/post-craft/SKILL.md §5 (:225-235) — 단수 lens 승계 문언을 다중-lens 묶음으로 확장.
- **계약 정본 좌표** (trace): §2.6=:77-79, §4.2 any-CRITICAL veto, "No cycle cap"=:266-268(개정 대상), check 재저작 cap=:95-103, lane respawn=:132.
- **테스트 지도**: test/e2e-full-cycle.test.ts:205-241(post 호출), :271-295(auditPath=audit-0 단일 검증 — 다중 사이클 시나리오 신설 지점), fixtures answers.json 규칙 형식(태그-키 매칭; [Audit Escalation] 규칙 추가 필요). 단위는 abort.ts/release.ts의 performX 순수 함수 패턴 미러.
- **파괴 게이트 비간섭**: [Audit Escalation]은 destructive-approval의 파괴적 태그 집합([Canon Amendment]/[Land]/[Hash Violation])에 추가하지 않는다 — 방향 결정 게이트이며 소비 권위가 필요한 release 경로가 아니다.

## Trace Findings

`trace.md` 참조 — 4중 합성(H-B 대리 게이트 증명의무 재생산 / H-A 수렴 장치 부재 / H-C fix-introduced 트레드밀 62.5→85.7% / H-D 측정 오염 red 83%·오인용 7/10 / H-E base drift 종단 봉쇄). 임계 미지수 4건 중 #1(장치 조합)은 R1·R2·R6·R7에서, #2(다중-lens AWC)는 R3에서 해소; #3(85% 물리적 달성 가능성)은 대상 프로젝트 소관 비목표로 확정; #4(commit-first 개방형 적용)는 산문 방향성 적용으로 한정(R6). 외부 리서치 정본: research/claims.json 18/18 accepted.

## Ontology

최종 엔티티(19): 수렴 장치 패키지 · 사이클 상한 카운터 · [Audit Escalation] 게이트 · 처분 기록(3종) · 주기형 재발동 · fail-closed land 불변식 · base drift 감지 · land 경로 충돌 검사 · pre-audit check 의무 · auditor commit-first · 인용 실증 의무 · Expected State 템플릿 · AC 검증가능성 분류 · live-전용 AC 명시 규칙 · 다중-lens AWC 경로 · TS 강제 경계 · 다중 사이클 E2E 시나리오 · 단위 테스트 표면 · 게이트 태그·라벨 규약.

CORE 개념: **"수렴은 상한이 아니라 합성으로 달성된다"** — 상한(A)은 무한 루프의 바운딩일 뿐이고, 트레드밀 자체는 측정 위생(C)·사전 차단(D)·AWC 도달성(E)이 줄이며, base 게이트(B)가 종단 봉쇄를 제거한다. 모든 결정(강제 경계, 처분 설계, 태그 규약)이 이 합성 관점에서 파생된다.

## Ontology Convergence

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 10 | — | — | 10 | 0 | N/A |
| 2 | 11 | 9 | 0 | 2 | 1 | 0.82 |
| 3 | 12 | 11 | 0 | 1 | 0 | 0.92 |
| 4 | 14 | 12 | 0 | 2 | 0 | 0.86 |
| 5 | 15 | 14 | 0 | 1 | 0 | 0.93 |
| 6 | 16 | 15 | 0 | 1 | 0 | 0.94 |
| 7 | 17 | 16 | 0 | 1 | 0 | 0.94 |
| 8 | 18 | 17 | 0 | 1 | 0 | 0.94 |
| 9 | 19 | 18 | 0 | 1 | 0 | **0.95** |

R9의 +1은 게이트 태그·라벨 규약의 명시화(관례 채택) — 이후 신규·제거 0으로 수렴.

## Interview Transcript

3-point injection: Override 1(4중 합성 설명 주입 — 저신뢰 분기 미적용), Override 2(trace 종합=코드베이스 컨텍스트, 재탐색 없음), Override 3(임계 미지수 → R1~R3 주입).

| R | 태그/모드 | 질문 요지 | 답변 | ambiguity(후) |
|---|---|---|---|---|
| 1 | [Goal] 주입#1 | 무엇을 만들 것인가 (구현 vs 보고서 vs +대상 프로젝트) | 수렴 장치 종합 구현 | 0.459 |
| 2 | [Goal] 주입#2 (multi) | 장치 4묶음 중 채택 | 바운딩+위생+사전차단 (스코프 동결 제외) | 0.390 |
| 3 | [Goal] 주입#3 | §5 단수-lens 공백 포함 여부 | 포함 — 다중-lens AWC 확장 | 0.367 |
| 4 | [Success Criteria] | 완료의 기계 검증 형태 | 단위 + 다중 사이클 E2E | 0.256 |
| 5 | [Constraints] CONTRARIAN | fail-closed가 실재 제약인가 (최선안 land?) | fail-closed 유지 | 0.198 |
| 6 | [Constraints] SIMPLIFIER | 기계 강제 vs 산문의 경계 | 혼합 — 상한·처분·base TS / 위생 산문 | 0.146 |
| 7 | [Success Criteria] | 상한 수치·발동 주기 | 상한 3 + 3회마다 재발동 (fixture 2) | 0.100 |
| 8 | [Constraints] | base drift 발동 지점·강도 | 감지@audit begin, 차단@land | 0.073 |
| 9 | [Success Criteria] 총체 | AC 10항 확정? | yes (멱등 확인) | **0.046 ✓** |

각 라운드에서 점수표(Dimension/Score/Weight/Weighted/Gap)·병목 1문장을 채팅에 표시. 질문 도구: lsc_select(R1~R8), lsc_confirm(R9). 전 질문 §1.2 태깅 규약 준수. R2는 multi-select — 선택 3건이 그 라운드의 답 (혼합 규칙 §1.2(c)).
