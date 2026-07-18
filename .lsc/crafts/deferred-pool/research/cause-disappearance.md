# Cause Disappearance — deferred-pool

> 배제된 대안 설명·설계 프레이밍과 배제 사유.

| 배제된 것 | 배제 사유 | 근거 |
|---|---|---|
| "이연 항목 중 일부가 이미 조용히 구현됨(문서 stale)" | 전제 감사 10/10 CONFIRMED + 등록 도구 역방향 열거(11 tools + 2 commands)에서 이연 항목 시그니처 0건 | LanePremiseAudit |
| "D-3 = 스텁 오답 주입" 원안 그대로 | pre-craft는 구현 코드를 안 쓰므로 스텁 자체가 없음; 유효 형태는 브라운필드 기존 seam의 일회성 변이 + 즉시 복구, 그린필드는 명시 N/A | W2MutationTarget |
| "단일 변이로 스위트 변별력 검증" 프레이밍 | n=1 지지 1차 문헌 전무, n=25-50도 50%p 분산 — '변이 seam 한정 tautology 스모크'로 격하 | W2Countersearch C3 |
| "E-3 = 세 durable 파일 일괄 version 필드" | HashManifest는 매 init 전체 재계산이라 창 자체가 없음(REFUTED); ModelsFile은 content-shape 판별이 아직 무모호; CraftState만 창 실재 | W3ClaimClosure, ResSchemaVer |
| "F-3에 flutter식 exit 0 채택" | doctor를 게이트로 쓸 가능성이 있는 lets-craft 맥락에서 brew/npm/expo 관례가 우세; 단 WARN-only는 exit 0으로 분리(C1 countersearch 반영) | ResDoctorArt, W2Countersearch C1 |
| "A-5에 dirty/locked/submodule 검사 포함" | git --force 의미론 재구현은 두 계약의 이중화 드리프트 유발 — git 원생에 일임 | ResGitWorktree |
| "R0를 lazycodex --check 이식으로 처리" | lazycodex에 해당 원형 부재 확정 — 신규 설계 대상 | ResLazycodex K7 |
| "15개 항목 전부를 즉시 단일 코드화" | 7개 항목이 조건부(선행 조건 부재·계약 예외 필요·dogfooding 관측 의존) — 인터뷰의 범위 결정 필요 | LaneInteraction |
| "statusbar/notify가 상태 파일을 읽는 숨은 reader" | 코드 반증 — getActiveCraft()/logs만 읽음 | W3ClaimClosure |
