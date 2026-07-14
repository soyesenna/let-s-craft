# Verification Economics — 무엇을 어디까지 검증했고, 왜 거기서 멈췄나

## 코드 검증 (실행/직독으로 정산 완료)
- resolveSelectOption('yes' × [Consensus Escalation 3옵션]) = undefined: TracerOrchestration이 제어 실험으로 확정 (Tier-1). 환경: repo c39a725, vitest 대상 소스 직접 평가. 추가 재현 불필요 — 단위 테스트(ask.test.ts:191-233)가 티어별 동작을 이미 고정.
- SDK 타입/렌더링 클레임(C1/C2/C7/C8/C9/C16): node_modules 16.4.0 .d.ts + 구현 소스 직독. 실행 재현은 하지 않음 — 이유: 타입 선언과 렌더러 소스가 동일 패키지에서 일치하고, 벤더 16.3.15와의 대조로 회귀 방향까지 확인(O28). 실행 검증의 한계비용 > 추가 확신. craft 단계의 스모크 테스트에서 자연 검증됨.
- placeholder dead-param(C7)·confirm-as-selector(C8): 단일 워커 관측. planner가 이 사실에 설계를 **의존**시키는 경우(예: confirm 재구현) 구현 전 5분 스파이크로 재확인 권장 — 비용 낮고 뒤집힐 시 영향 큼.

## 웹 클레임 (1차 소스 확보, countersearch는 wave 3)
- C10(Claude Code 스키마): 공식 문서+changelog 2도메인. countersearch 비용 낮음(검색 1회) → wave 3 수행.
- C12(라이브러리 자유입력 부재): 5개 리포 소스 직독으로 강함. 반례 클래스(autocomplete형)가 존재할 수 있어 countersearch 가치 있음 → wave 3.
- C14(쉬운 언어 규칙): 규칙별 1차 2+소스로 이미 강함. countersearch는 '균형 프레이밍 역효과' 반론 존재 여부만 → wave 3.
- C11(모델-대면 프롬프트 원문): 공식 비공개가 GitHub issue로 확인된 사안 — 추가 검증 경제성 없음. single-source로 표기 유지하고 하니스 미러를 대리 채택. 종결.

## 검증하지 않기로 한 것 (경제성 판단)
- RPC/ACP 프론트엔드에서의 실제 description 표시(C9의 런타임 재현): lets-craft의 실사용 경로는 interactive TUI + fixture(UI 미경유)뿐. RPC 경로는 영향 서술만 하고 재현 생략.
- 벤더 16.3.15 전체 diff: 드리프트가 timeout API 한정임을 확인한 이상(O28) 전수 대조는 비경제적.
- MCP elicitation draft(2025-11-25) 모드 분리 세부: lets-craft는 MCP 경유 노출 계획이 없음 — 경계 제약으로 기록만.
