# Wave 1 — Saturation wave (roster)

병행 스폰: trace lane 3 + 리서치 워커 7 (floor 6 충족: codebase-facing 3, web librarian 3, repo-dive 1).

## Trace lanes (Stage 1 step 4 — 리서치 워커 아님)
| Worker | Agent | Lane |
|---|---|---|
| TracerCodePath | lsc-tracer | Lane 1: code-path / implementation (src/ask.ts, fixtures.ts, SDK 타입) |
| TracerOrchestration | lsc-tracer | Lane 2: config / orchestration (SKILL.md 3종, answers.json, E2E) |
| TracerPremise | lsc-tracer | Lane 3: measurement / assumption-mismatch (요청 전제 감사) |

## Research workers (Stage 1 step 5 — EXPAND tail 계약)
| Worker | Agent | Role / Axis |
|---|---|---|
| ExploreUiApi | lsc-explore | codebase-facing: omp SDK 16.4.0 + oh-my-pi 벤더 소스의 ctx.ui 표면 |
| ExploreAskTool | lsc-explore | codebase-facing: 하니스 내장 ask 도구 스키마/렌더링/재사용성 |
| ExploreConsumers | lsc-explore | codebase-facing: lets-craft 내 ask 도구 소비자 전수 인벤토리 |
| LibClaudeCode | lsc-librarian | web: Claude Code AskUserQuestion prior art |
| LibPromptLibs | lsc-librarian | web: CLI 프롬프트 라이브러리 choice 모델링/함정 |
| LibPlainLanguage | lsc-librarian | web: plain-language 작성 규칙 → 체크리스트 |
| LibRepoDive | lsc-librarian | repo-dive: MCP elicitation + 타 하니스 ask 스키마 |
## EXPAND tail 수집 (전 워커 도착 완료, 2026-07-14)

| Worker | Lead | 처리 |
|---|---|---|
| ExploreUiApi | option 타입 확장의 lets-craft 내부 전파 범위 | trace lane 1/2가 커버 — 종결 |
| ExploreUiApi | 'Other→input/editor 체인' vs 'custom<T>() 통합 UI' 설계 결정 | 리서치 아님, plan 단계 설계 결정으로 이관 |
| ExploreUiApi | 벤더/installed timeout API 드리프트 | 기록만(C16) — 본 기능 무관, 종결 |
| ExploreAskTool | recommended append-then-strip 패턴 | claim-graph C17로 정착 — 종결 |
| ExploreAskTool | 자유텍스트 = 1급 결과 채널(customInput 병렬 직렬화) | observation O31 정착; Other-flow 엣지 시맨틱은 wave 2 ExploreOtherFlow가 추적 |
| ExploreAskTool | 매칭은 label로 수렴, description은 표시 전용 | 설계 제약으로 spec에 이관 — 종결 |
| ExploreConsumers | none | — |
| LibClaudeCode | UI 자동 Other 주입 정책 차용 | 설계 후보로 이관 |
| LibClaudeCode | header/question/label/description 4계층 | 설계 후보로 이관(단일 질문 도구라 header 불필요 가능성 포함) |
| LibClaudeCode | 모델-대면 프롬프트 원문 비공개(issue #10346) | 하니스 미러를 대리 증거로 채택(C11, single-source) — 종결 |
| LibClaudeCode | 자유답변 이원 회신(answers+response) | 설계 후보로 이관 |
| LibClaudeCode | 옵션 수 상한(2-4) 부재 → 상한 도입 근거 | 설계 후보로 이관 |
| LibClaudeCode | auto-continue/idle-timeout 정책 변천 | 기록만 — 본 기능 범위 밖(타임아웃 정책은 non-goal 후보) |
| LibPromptLibs | 상시 자유입력 선행 부재 → 신규 설계 영역 | C12 정착; countersearch(autocomplete형 반례)를 wave 3 큐에 등록 |
| LibPromptLibs | wrap 처리 관례(terkelg/clack) | omp가 이미 wrap+ellipsis 처리(O22) — 종결 |
| LibPromptLibs | clack 슬라이딩 윈도우 페이지네이션 | omp compact 모드가 동형(O23) — 종결 |
| LibPlainLanguage | 한국어 쉬운 언어 정부 가이드 미조사 | **wave 2 LibKoreanPlain 스폰** |
| LibPlainLanguage | trust calibration(중립성·장단점 병기 상호의존) | O46 정착 — 종결 |
| LibRepoDive | codex+opencode 조합을 설계 원형으로 | 설계 후보로 이관 |
| LibRepoDive | 스키마 annotation + 프롬프트 가이드 2계층 필요 | 설계 후보로 이관 |
| LibRepoDive | isOther vs custom(default true) 비교 | 설계 후보로 이관 |
| LibRepoDive | cline 소스 직독 불가(single-source) | 낮은 가치 — countersearch 큐 하위 항목 |
| LibRepoDive | MCP elicitation 경계 제약 | O51 기록 — 종결 |
| TracerOrchestration(lane) | fixture select 게이트 잠재 결함 | 메인 세션이 answers.json 직독으로 확정(O53/C5) — 종결 |

미종결 lead → wave 2: 한국어 쉬운 언어(LibKoreanPlain), Other-flow 엣지 시맨틱(ExploreOtherFlow). countersearch 4건 → wave 3 큐(claim-graph.md 참조).
