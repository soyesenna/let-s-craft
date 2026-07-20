# Verification Economics — 무엇을 어떤 비용으로 어디까지 검증했나

## 검증 티어 현황 (wave 1 종료 시점)

| 사실 | 검증 수단 | 티어 | 잔여 격차 |
|---|---|---|---|
| 16.4.0 SDK에 LLM 심 부재 | 핀 버전 .d.ts/.ts 전수 스캔 (4워커 독립 교차) | 2 (primary artifact) | 없음 — 타입 표면이 곧 컴파일 계약 |
| BYO-completion 실행 가능 | 타입 시그니처 + 호스트 번들 공식 예제 3종 + pi 예제 4종 | 2 | **라이브 실행 미검증** — 인터뷰 후 스파이크(D-3 아님, 별도) 또는 craft에서 확인 필요. 통제 재현(티어 1) 비용: 20-30분 스파이크 |
| select key-opaque / custom<T>가 유일 라운드트립 | 호스트 렌더 소스 + 타입 | 2 | onLeft/onRight 시맨틱 미확인 → W2AskDialogArch |
| 호스트 description 렌더 정상 | 렌더 코드 직독 | 2 | 실화면 캡처(티어 1) 미실시 — 비용 대비 가치 낮음(코드가 결정적) |
| fixture kind-mismatch → CI 파손 | 소스 + 기존 테스트 고정 확인 | 2 | 에러 경로의 once-소비 순서만 테스트 미고정(설계 시 유의) |
| novel 조합 (선례 부재) | 웹 11개 도구군 1차 소스 조사 | 3 (다독립소스) | 전수성 한계 명시(모바일/웹 wizard 미조사) — 수용 |
| MCP sampling deprecated | 스펙 원문 + SEP | 2 | 없음 |
| /btw 시맨틱 host-internal | vendored 소스 file:line | 2 | 없음 |

## 경제성 판단
- **타입 표면 스캔(저비용·고확실)** 을 우선했고, 라이브 스파이크(중비용)는 유일하게 BYO-completion 실행 검증에만 필요 — 이는 Stage 4의 변이 프로브가 아니라 craft 단계 초기 스파이크 또는 인터뷰 후 확인 항목으로 이월.
- 스크린샷/실렌더 캡처는 렌더 코드가 결정적이므로 비용 대비 무가치 — 스킵.
- npm published 타입 vs vendored 소스 불일치 리스크(askDialog 최초 수록 버전)는 저비용 npm 조회로 해소 가능 → W2NpmVersions에 위임.
