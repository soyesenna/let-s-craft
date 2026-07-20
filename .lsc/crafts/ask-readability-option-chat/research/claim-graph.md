# Claim Graph — 검증 상태 서사 뷰 (orchestrator 소유; 정본은 claims.json)

> claims.json이 정본(canonical ledger). 이 파일은 그 projection — 역방향 편집 금지.

## Verified set (비코드 클레임 잠금 기준: ≥2 독립 소스 도메인, ≥2 독립 관찰 그룹, countersearch 1회+, 1차 소스, 시의성)

| # | 클레임(요약) | 소스 도메인 | 관찰 그룹 | 상태 |
|---|---|---|---|---|
| C1 | 16.4.0 SDK에 tool-handler용 LLM 심 없음 | 핀 npm 패키지 타입 + vendored 소스 | TracerHostCapability, RExploreSdk, TracerCodePath, TracerBtwPriorArt (4 독립) | **verified** (코드 클레임 — 타입 표면 검증) |
| C2 | BYO-completion (pi-ai direct import) 패턴 성립 | omp 번들 예제 + pi 번들 예제 + 타입 | RExploreSdk, RExplorePi, TracerHostCapability (3 독립) | **verified-by-type/example** — 라이브 실행만 미검증 (CONFIRMED 아님, PARTIAL) |
| C3 | select key-opaque, custom<T>만 라운드트립 | 호스트 소스 + 타입 | TracerHostCapability, RExploreSdk | verified, 단 onLeft/onRight 시맨틱 보류 (W2) |
| C4 | 호스트 description 렌더 정상 (P1a 반증) | 호스트 렌더 소스 | TracerHostCapability, RExploreTui | **verified** |
| C5 | novel 조합 (선례 부재) | 웹 1차 소스 11개 도구군 | RLibTuiPriorArt (단일 그룹) | locked-with-caveat: 단일 관찰 그룹이나 조사 폭·1차 소스·countersearch(huh ? 토글 hallucination 반증) 충족. 전수성 한계 병기 |
| C6 | MCP sampling deprecated | 스펙 원문 + SEP + 채택 조사 | RLibSampling | **verified** (시의성: 2026-07-28 RC) |
| C7 | fixture kind-mismatch → 무인 CI 파손 | lets-craft 소스 + 기존 테스트 고정 | TracerFixtureContracts | **verified** (코드 클레임) |
| C8 | askDialog 16.4.0 부재/16.5.2 존재, 로컬 chat 행 제거(bcee73e58) | 핀 타입 + vendored 소스 + changelog | RExploreSdk, RExploreTui, RLibOmpDocs (3 독립) | verified; published 최초 수록 버전만 미확정 (W2NpmVersions) |
| C9 | /btw 시맨틱 번들은 host-internal, 플러그인 재현 불가 | vendored 소스 + 타입 + changelog | TracerBtwPriorArt, RLibSampling, RExploreSdk (3 독립) | **verified** |
| C10 | ask.ts는 verbatim pass-through + 재렌더 루프 심 존재 | lets-craft 소스 + 테스트 고정 | TracerCodePath | **verified** (코드 클레임) |

## Code-verification 항목 (CONFIRMED / REFUTED / PARTIAL)
- C2 BYO-completion: **PARTIAL** — 타입·예제 수준 확인, 라이브 in-tool 호출 미실행. 환경: @oh-my-pi/pi-ai@16.4.0 (핀), node_modules 기준.
- P1a "호스트가 description 못 그림": **REFUTED** — hook-selector.ts:330-382.
- P2a "SDK에 first-class LLM 심 있음": **REFUTED** — 16.4.0·16.5.2 공통.

## Wave 2·3 해소분 (최종 — claims.json C11-C16으로 각인)
- onLeft/onRight → **explain 진입키 불가 확정** (`() => void`, settle undefined; b5a471d8 diff). C3 강화.
- askDialog 최초 published 버전 = **16.4.5** (.d.ts 검증); 16.4.0→16.4.5 extension-API 파괴 zero; 17.x loadMode flip 리스크. → C11
- BYO-completion canonical 계약 = completion-bridge 패턴(resolver+stopReason 게이트+에러 이원성); Node/Vitest 값-import 불가(Bun 전용). → C12, C13
- 로컬 chat-row 재도입 없음 확정 + 제거 전 wiring 복원(직접 선례). → C14
- ReadonlySessionManager Pick에 forkFrom/branch/appendMessage 부재 — sidebranch 패턴 배제. → C15
- pi-tui 프리미티브 전원 가용·버전 안정, custom<T> 4-param 계약 확정, exact-pin 락스텝 직접 의존 권고. → C16

## 수렴
확장 웨이브 2회(wave 2·3) + 미확인 리드 zero → **CONVERGED** (2026-07-20). 잔여 항목은 리서치가 아닌 설계 결정: 컨텍스트 스코핑(full-history vs question-only), 가독성 축 A/B/C, 채팅 축 (i)/(ii)/(iii) — open-questions.md 이관.

## 오라벨 우회 한계 (병기)
이 원장의 결정 사다리는 비적대·부주의 실수에 대한 결정론적 하한이다 — 고의로 오라벨된 소스는 여전히 우회 가능하다.
