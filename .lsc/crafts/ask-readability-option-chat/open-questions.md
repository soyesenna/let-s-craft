# Open Questions — ask-readability-option-chat

인터뷰 게이트(ambiguity 0.047) 통과 후 plan 단계로 이월되는 미결 항목. 전부 spec의 확정 결정을 바꾸지 않는 하위 설계 사항이다.

1. **loadMode 배분 (Constraint 2)** — 17.0.5 범프 시 lsc_ask/lsc_select/lsc_confirm은 `loadMode:"essential"` 기본선. 나머지 lsc_* 도구(craft 루프·scaffold·doctor 등 ~15종)의 essential/discoverable 배분은 plan에서 확정. 참고: 현행 운영 환경에서 xd:// 마운트로도 파이프라인이 동작함이 관찰됨 — essential은 신뢰성 보수선.
2. **채팅/상세 키맵 구체값 (Constraint 11)** — 원버튼 상세·자유 채팅 진입 키(예: `?`/`t`), Esc 시맨틱(채팅 패널 → 목록 → 질문 취소의 단계적 이스케이프), 푸터 힌트 문안. 호스트 예약 키(위/아래/Enter/Space/n/Tab/PgUp/PgDn — askDialog 관례)와의 충돌 회피 포함.
3. **컬러 팔레트 구체값 (Constraint 14)** — lets-craft 브랜드 RGB 세트, 명암(colorMode) 적응 규칙(라이트/다크별 대비 목표), 위계 매핑(제목/label/설명/푸터/채팅 질문/채팅 답변/에러 상태).
4. **17.0.5 시그니처 재확인** — wave-2/4의 pi-ai 계약 조사는 16.4.0 기준. 17.0.5에서 stream/completeSimple/SimpleStreamOptions·modelRegistry.resolver·getBranch/getSystemPrompt 시그니처 델타를 plan의 lsc-planner가 explore로 재확인(파괴 변경은 없다고 판정되었으나 캐시 관련 필드 추가 여부 등 확인 가치 있음).
5. **원버튼 상세의 고정 프롬프트 문안** — 옵션 지정 상세 요청 시 사이드 호출에 실을 표준 프롬프트(no-tools 리마인더 포함, /btw의 btw-user.md 상당물)와 질문-자체 대상일 때의 변형.
6. **details.sideChat 스키마 상세** — 문답 배열의 필드 구성(대상 옵션 label/prompt/response/타임스탬프/중단 여부/사용 모델), SelectResultDetails·ConfirmResultDetails·AskResultDetails 3종 모두에의 배치.
7. **craft 1회 캐시 실측 절차 (AC6.2)** — 어떤 provider로, 무엇을 관찰하고(usage.cache_read), 어디에 기록하는지(테스트 로그 vs plan 부록).
