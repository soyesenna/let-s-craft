# Plan Revision Ledger — Iteration 1 (2026-07-20)

## 개요
- 작성자 초안: PlannerAskChat (lsc-planner) — plan.md 코어 21.5KB + 부록 5종(appendix-{dr,pre-mortem,test-plan,precedent,palette-and-prompts}.md), open-questions 7항 해소, lsc-explore 5종 병렬 스폰으로 코드베이스 그라운딩.
- 리뷰 순서: architect(ArchPlanIter1) → critic(CriticPlanIter1) — 계약대로 순차.

## Architect (lsc-architect) — blocking + Change Spec 8항 (AWC-equivalent)
Blocking 5 + Major 1:
1. [BLOCKING] Bun/Node import graph 미정의 — src/ask-ui/ 디렉터리 배치만으로는 vitest 수집이 깨지거나 production 로직 미검증 (statusbar 선례 위반).
2. [BLOCKING] PR 분해가 DR-3 "가독성 우선 수직 슬라이스" 선언과 모순 (구 PR2=completion 수평 인프라); PR1 게이트에 lockfile/clean install/real omp smoke 부재.
3. [BLOCKING] 단일 마운트의 상태 소유·question-header focus·ask 에디터 키 충돌·HookSelector 검색 parity 미정의.
4. [BLOCKING] custom fallback(RPC의 custom()→undefined 실측)·side-turn 비동기 실패 격리·destructive wrapper 보존·secret redaction 계약 부재.
5. [BLOCKING] 캐시 수명(세션 freeze·getBranch 1회·byte prefix invariant)·실측 fail-closed 조건 부재.
6. [MAJOR] 팔레트 role 수 7/8/9 드리프트, 24-bit SSOT/256 파생 미정.
Consensus Addendum: steelman(HookSelector 유지론) → "single mount 안에서 host baseline parity 복원" 제약으로 수렴; 3대 트레이드오프 긴장 명시; synthesis 실행가능. Change Spec 1-8 동봉.

## Critic (lsc-critic) — **VERDICT: APPROVE-WITH-CHANGE**
(1차 스폰이 provider 장애로 yield 유실 → idle-recovery 표준 절차로 복구, 전문 local://critic-plan-iter1.md)
- 인용 ~60건 전수 검증(드리프트 4건), architect blocking 5건 전건 실측 재확정(6/6 agree), Change Spec 8항의 완전성 검증.
- 신규 Major 4: ①공유 systemPrompt의 "~150 words" 상한이 CS6 freeze로 자유 멀티턴까지 구속(spec R4/R6 모순) ②CS1 적용 시 plan 내 교차 참조(AC 매트릭스 PR 열 18행·출하 문장·DR-3) 일관 갱신 필요 ③CS7 Bun Adapter 테스트 러너 부재(bun test/test-bun/test:bun 신설) ④AC5.1 채팅 패널 스냅샷(R6) 누락.
- Minor ⓐ-ⓓ(인용 정정 5건, prompt 주석, CS3 보강 2문장, I5 헤드리스) + What's-Missing 3소항(redactor 벡터 3종, U5 loadMode 검증법, omp 설치 채널).
- Critic veto 아님 — 전 blocking apply-only → AWC 경로 성립.

## AWC 적용 (PlannerApplyAwc1 → 재스폰 PlannerApplyAwc1R)
- 1차 적용 스폰이 Anthropic stream stall로 유실(파일 미수정 확인) → §1.8 표준 절차: idle-recovery 무응답 → cancel 후 동일 배정 재스폰.
- 재스폰이 CS1-8 + critic Major 1-4 + Minor ⓐ-ⓓ + WM 3소항 전량 신규적용. plan.md 22,306B(≤30KB), 부록 4종 수정(appendix-precedent 무변경).

## Diff-only 재확인 (RecheckPlanAwc1, lsc-critic-recheck) — **RECHECK: PASS**
- check1(항목별 diff↔fix 1:1): Pass — 전 항목 verbatim, 초과 변경 없음.
- check2(file:line 재검증): Pass — 코어/부록 전 인용 위치 직접 확인.
- check3(관련 AC + parity 클래스): Pass — PR 순서·9역할·캐시 문구가 코어/부록/테스트계획 상호 일치, spec AC 6그룹 매핑 유지.
- 비차단 노트: open-questions.md:21 구 '7역할' 잔존(→ 본 커밋에서 1줄 정정 완료), destructive wrapper 범위 표기 :630-681 vs :627-684 리뷰 원문 간 상이(→ craft에서 :627-684로 통일 권장).

## 결과
**Iteration 1에서 AWC 경로로 합의 도달** (diff-only recheck는 동일 iteration의 마감 스텝 — iteration 카운터 미소모). plan.md는 최종 확정본, ADR 요약 코어 포함.
