# Cause Disappearance Ledger — ruled-out explanations and why

| 배제된 설명 | 배제 근거 | 워커 |
|---|---|---|
| "craft가 audit 지시를 이행하지 않아서" (불복종) | finding 참조율 cycle-11 8/8, cycle-12 10/10; 어떤 audit도 미이행을 REJECT 사유로 기록 안 함 | Lane2 |
| "병렬 구현 lane 간 파일 충돌" | cycle 8/13/14 --stat 표본에서 충돌 0, 스코프 상호 배타 | Lane2 |
| "auditor가 finding을 조작(manufacture)해서" | 반-조작 규약 실재·작동 (lsc-auditor.md:51), 폐기율 극히 낮음 (204건 중 2건), Layer 3 file:line 재검증 | Lane1, Lane3 |
| "AC 검증불가가 REJECT의 직접 사유" (가설 원문) | audit-4~14 전원 명문: live PENDING은 REJECT 사유 아님 — 구조적 조건이지 직접 사유 아님 (수정 가설로 대체) | Lane4 |
| "85% 수치·eligible 정의의 골대 이동" | 수치 축 15사이클 동결; 이동은 범위 예외·절차 축에서만 | Lane4 |
| "check 스크립트의 flaky 비결정성(테스트 자체)" | audit-9가 --rerun-tasks 2회 격리로 flaky 아님 확정; 비결정성은 Gradle lane 커버리지(스케줄링)였고 cycle 10에 교정 | Lane3 |
| "순수 diff-anchored 오판이 REJECT를 지배" | 형성 순서 코딩에서 D=0 — 오판은 오인용(M형 내부) 형태로만 실재 | W3AnchoringAudit |
| "반복이 부족했다 — 더 돌리면 수렴했을 것" | fix-introduced 비율 62.5→85.7% 상승, oracle 의무 재생산, F14-1은 루프 밖 항목 — cycle 15+도 구조적으로 REJECT 지속 | W2 프로브 3종 |
| "sparse-proposal형 livelock" (2607.24604 원형) | 제안(신규 finding·fix)이 지속 생산됨 — 조건 정반대; 실제 모드는 게이트·심판 상호작용 트레드밀 | W2LivelockDeep, W2ProbeFixIntroduced |
