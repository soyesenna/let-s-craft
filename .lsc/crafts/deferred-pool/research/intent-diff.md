# Intent Diff — deferred-pool

## 실제로 요청된 것
`_docs/deferred-pool.md`의 이연 항목 **전체**(T-1, T-2, A-5, E-1, F-3, E-3, D-1, D-2, D-3, D-4, A-4p2, E-2확장, C-2p2, B-2확장, R0)를 구현하라는 요청. 단, 문서 자체가 항목별로 성숙도가 다르다고 명시한다:
- §0/§1은 즉시 착수 가능(선행 조건 없음), 검증자가 범위를 이미 좁혀둠.
- §2는 선행 조건(D-1: fixture E2E 기준선)·불변식 충돌(D-3 vs 구현금지 불변식 2)·조건부 판단(E-2확장·B-2확장: dogfooding 후)·과차단 위험(A-4p2)이 붙어 있음.
- §3(R0)은 기각됐다가 경량형으로만 재검토 가치.

## 게으른 독해가 가정할 것 (교정 대상)
- "15개 항목을 전부 같은 무게로 즉시 코드화" — 실제로는 §2의 4개 항목이 명시적 조건부이며, '전부 구현'의 의미(조건부 항목 처리 방식)는 인터뷰에서 확정해야 한다.
- "외부 리서치 = 레퍼런스 리포 재탐색" — 세 리포(lazycodex, gajae-code, oh-my-claudecode)는 리포 루트에 **로컬 체크아웃**으로 존재하며 이미 2중 적대 검증(reference-insights.md)을 통과했다. 외부 리서치의 실제 공백은 도메인 선행 기술이다.

## 외부에서 리서치해야 할 것 (내부 레인이 못 덮는 것)
1. **git worktree 원생 거부 의미론** (A-5): `git worktree remove/prune`가 자체적으로 거부하는 것의 정확한 경계 — 검증자 유보("상당 부분 중복")를 정량화해 validator의 순증분을 확정.
2. **doctor 커맨드 선행 기술** (F-3): brew/flutter/npm doctor의 검사 분류·PASS/WARN/FAIL 출력·exit code·read-only 계약 관례.
3. **상태 파일 스키마 버전·마이그레이션 관례** (E-3): lockfileVersion, Terraform state version 등 정수 스키마 버전 + 미지 버전 명시적 에러 패턴.
4. **뮤테이션 프루프 최소형** (D-3): 테스트 변별력 검증의 일회성 뮤테이션 관행, revert 안전성.
5. **LLM 자기채점 하한 클램프** (D-1): 앵커링/과신 문헌 + 객관 신호 기반 결정론적 floor 선행 기술.
6. **클레임 원장·반증 사전 등록** (D-2): dropCondition/kill-criteria 패턴, 자동 사실검증 원장.
7. **omp 플랫폼 API 표면** (T-1/E-1/F-3/C-2p2): registerTool/registerCommand/이벤트 타입 — node_modules 로컬 확인 (SessionStopEvent stop 사유 필드 부재 클레임 검증 포함).

## 내부 레인이 덮는 것 (중복 금지)
- 이 리포의 코드 seam 좌표·스킬 산문 계약·전 사이클 착지분 감사·항목 간 충돌·테스트 인프라 → trace 레인 1-5.
