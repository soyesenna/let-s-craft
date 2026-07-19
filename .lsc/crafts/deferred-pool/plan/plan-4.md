# plan-4.md — Stage 4 (test canon) 합의 루프 iteration 2 원장

> iteration 1 원장은 plan-3.md(동 루프의 첫 iteration — plan 소폭 개정 3건 포함).

## 리뷰 판정
- **architect (ArchReviewTest2)**: BLOCKING이나 잔여 우려 전부 apply-verbatim — **AWC-equivalent**. iteration 1 BLOCKING 5군(C1 scaffold root / C3·M1-M3 land / C2·M4·m5 doctor / C5 skill-contract / C4·M5 claims / M6·m1 state·harness) **종결 매트릭스로 확인**. 잔여: B1(scope 브랜치 2필드·anchor 3필드 미결박) B2(prepareId await-race·No-후 prepared clear) B3(claims default writer 미실행) B4(prose 명령 변형 우회) M1(doctor README 9-count observe) M2(scaffold 거부 경로 git control-plane) → **Change Spec 9항**.
- **critic (CriticReviewTest2)**: **APPROVE-WITH-CHANGE**. Change Spec 8항(1-6·8·9) 수용 + **item 7 반박·보정(CF1)**: §7.4 checkout/switch 부재 단언은 정본 프로즈(post-craft SKILL.md:228 `git checkout {base}` 보존)와 충돌하는 immutable-RED — `git merge --no-ff` + `git worktree remove|prune` 두 부류 한정으로 보정. 신규 blocking gap 0·과주입 없음 판정.

## AWC 적용 (iteration 2의 마감 단계 — iteration 미소모)
- ApplyAWCTest: 9항(+CF1 보정판) 전부 적용, 범위 밖 변경 0, 격리 스모크 5/5 구문 유효·import-RED 정상.
- RecheckTestAWC (lsc-critic-recheck): **RECHECK: PASS** — ①diff↔fix 항목별 대조(스코프 크리프 0) ②핵심 문구 전수 grep/read 실측(CF1 한정 확인: checkout/switch/bare-merge 단언 0건) ③결합 AC 교차(기존 positive↔신규 negative 양립, doctor 2파일 fixture 정합, LAND_REASON_CODES 18종 불변).

## 최종 하네스 실측 (오케스트레이터)
- build(tsc) PASS / feature suite 11/11 실행·RED(미구현 정상) / 전체 회귀: 기존 37파일 green 유지 / exit 1. sync 잔여물 정리 완료.

## 합의 결과
Stage 4 test canon **합의 도달** — hash-protect 준비 완료. 구현 소스 무접촉(전 단계 git status 검증).
