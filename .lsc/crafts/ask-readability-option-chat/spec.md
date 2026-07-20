# Spec — ask-readability-option-chat

## Metadata

| 항목 | 값 |
|---|---|
| Feature | ask-readability-option-chat — ask 도구 가독성(레이아웃+텍스트 스타일) 향상 + 옵션 설명 사이드 채팅(캐시 최적화 포함) |
| 분류 | Brownfield (trace 확정, src/ask.ts 685행 직접 확장 + 자체 TUI 컴포넌트 신설) |
| 공식 | ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| 최종 ambiguity | **0.047** (게이트 0.05 통과, 15라운드 — R10에서 0.049로 1차 통과, 사용자 추가 요구 2회로 재개방[텍스트 스타일·캐시→R11-R14, SDK 최신→R15] 후 재통과) |
| Challenge modes | contrarian@R4(발동), simplifier@R6(발동 — 기각됨), ontologist 미발동(R8 시점 ambiguity 0.109 < 0.3) |
| 환경 고정 | lets-craft@feat/ask-readability-option-chat; **SDK @oh-my-pi/* 17.0.5 락스텝 범프**(pi-coding-agent/pi-ai + pi-tui 직접 의존 신규 추가, exact-pin) |
| 작성일 | 2026-07-20 |

## Clarity Breakdown (최종)

| Dimension | Score | Weight | Weighted | 근거 |
|---|---|---|---|---|
| Goal | 0.96 | 0.35 | 0.336 | 구조(자체 컴포넌트)·층위(원버튼+채팅)·범위(3도구)·진입(키바인딩)·스타일(자유 팔레트, 확대 미채택)·경로(범프+자체 컴포넌트) 확정 |
| Constraints | 0.95 | 0.25 | 0.238 | 기록(details)·컨텍스트(히스토리)·예산(세션 모델·무상한)·캐시(내부 확보)·SDK(17.0.5 락스텝+loadMode) 확정 |
| Criteria | 0.95 | 0.25 | 0.238 | AC 4그룹(R5) + 소형 터미널 최소선(R9) + 신규 축 검증 방법(R14) 확정 |
| Context | 0.95 | 0.15 | 0.143 | trace 5레인 + 리서치 5웨이브(19클레임 전원 accepted)가 시스템 맥락 제공 |

## Topology (sub-components)

| ID | 컴포넌트 | 소유 파일/문서 | 최종 점수(G/C/Cr) |
|---|---|---|---|
| A | 통합 셀렉터·채팅 컴포넌트 (+컬러 위계) | src/ask-ui/(신설), src/ask.ts 포트 확장 | 0.96 / 0.95 / 0.95 |
| B | completion 어댑터 (BYO + 캐시 구성) | src/ask-ui/ 또는 src/main.ts 인접(Bun 전용 심) | 0.97 / 0.95 / 0.94 |
| C | 계약·fixture·SSOT·SDK 마이그레이션 | src/fixtures.ts(불변 확인), skills/*/SKILL.md §1.2, package.json, test/ | 0.96 / 0.95 / 0.95 |

라운드별 타깃 로테이션: A(R1)→B겸A(R2)→C(R3)→A(R4 contrarian)→전역 Criteria(R5)→B(R6 simplifier)→A(R7)→B(R8)→A/Cr(R9)→A(R10)→A스타일(R11)→A스타일(R12)→B캐시(R13)→전역 Criteria(R14)→C/SDK(R15). `topology.last_targeted_component_id = C(R15)`.

## Goal

lets-craft의 질문 심 3종(lsc_ask/lsc_select/lsc_confirm)을 **자체 TUI 컴포넌트**(ctx.ui.custom<T> 기반, SDK 17.0.5) 위에 재구성하여:

1. **가독성** — (a) 레이아웃: 옵션 설명이 compact-mode에서 소실되는 현행 한계를 제거하고(포커스 옵션 설명 전문 보장 + 목록 스크롤), (b) **텍스트 스타일: lets-craft 고유 컬러 팔레트(임의 RGB)** 와 굵기·여백·구분선의 시각 위계를 질문 제목/옵션 label/설명/푸터에 설계한다. 글자 확대(OSC 66)는 채택하지 않는다 — '크기감'은 위계로 충족한다.
2. **옵션 설명 사이드 채팅** — 사용자가 질문에 답하는 도중 옵션(또는 질문 자체)을 지정해 원버튼 상세 또는 자유 프롬프트 멀티턴 채팅으로 에이전트 설명을 받고 목록으로 복귀한다. pi-ai 직접 호출(BYO-completion, 세션 모델, 대화 히스토리 스냅샷 포함)로 구동하되, **사이드챗 내부 프롬프트 캐시를 확보**한다(두 번째 문답부터 캐시 히트). CONTENT envelope 문법은 불변, 문답 기록은 details에만 남긴다.

핵심 엔티티와 관계 (한 문장 각):
- **통합 셀렉터·채팅 컴포넌트**: ctx.ui.custom<T>로 마운트되는 lets-craft 소유 Component — 옵션 목록 렌더(포커스 전문+스크롤, 컬러 팔레트 위계), 키바인딩 진입(원버튼 상세/채팅), 채팅 패널(스트리밍 답변), done(result)로 기존 performX 루프에 복귀. 17.0.5 편의 재료(FuzzyText 검색 하이라이트, Editor.setScrollbarVisible, Loader 애니메이션) 활용 가능.
- **lets-craft 컬러 팔레트**: 테마 시맨틱 토큰에 얽매이지 않는 고유 RGB 팔레트 — 단 호스트 Theme의 명암 모드(colorMode)를 감지해 라이트/다크 각각에서 대비를 유지하도록 적응한다.
- **completion 어댑터**: Bun-전용 심에서 pi-ai `stream`/`completeSimple`을 `ctx.models`+`modelRegistry.resolver(model, sessionId)`로 구동 — pure core에는 포트로 주입(vitest 경계); **캐시 구성**: promptCacheKey=메인 세션ID 시드(안정), sessionId=`{main}:side:{nonce}`(고유), 채팅 세션 동안 프리픽스 불변 유지 + cacheRetention 마커.
- **원버튼 상세**: 포커스 옵션에 대해 고정 프롬프트로 1회 생성하는 빠른 경로; **자유 프롬프트 채팅**: 같은 패널에서 이어지는 멀티턴 문답(Esc 종료, 상한 없음).
- **details.sideChat**: 채팅 발생 여부·문답 기록을 담는 신규 details 필드 — CONTENT(envelope)는 현행 문법 그대로.
- **fixture 채널**: 불변 — fixture 모드는 UI 자체를 우회하므로 채팅 어포던스가 원천 비노출.

## Constraints

1. **SDK 17.0.5 락스텝 범프** — @oh-my-pi/pi-coding-agent·pi-ai를 16.4.0→17.0.5로, @oh-my-pi/pi-tui 17.0.5를 직접 runtime 의존으로 신규 추가(전부 exact-pin; 락스텝 규칙). askDialog는 여전히 채택하지 않는다 — key-opaque라 채팅 진입(R10)·상태 보존(AC1.3)과 구조 충돌(wave-5 확정). (R15; R2의 무범프 결정을 대체)
2. **loadMode 마이그레이션** — 17.x에서 extension tool 기본이 discoverable(xd:// 마운트)로 플립되므로 lsc_ask/lsc_select/lsc_confirm은 `loadMode: "essential"` 지정을 기본선으로 한다(그 외 lsc_* 도구의 essential/discoverable 배분은 plan에서 확정 — open-questions). 17.0.0의 registerTool 데모션 버그 때문에 17.0.5 고정. (R15 + wave-2/5)
3. **Bun/Node 경계** — pi-ai·pi-tui 값 import는 vitest-도달 모듈에 금지; pure core(performX)는 UI·completion을 포트로 주입받는다(기존 statusbar 격리 관례). (리서치 C12)
4. **CONTENT envelope 문법 불변** — `User selected:`/`User provided free answer:` 헤더 문법, 게이트 파싱 규칙(§1.2 SSOT), destructive-action 규칙 무변경. 사이드챗 문답은 CONTENT에 나타나지 않는다. (R3)
5. **details에만 기록** — 신규 `details.sideChat`(문답 배열: 대상 옵션/프롬프트/응답/타임스탬프 등)로 테스트·감사 가능. (R3)
6. **컨텍스트 스코핑: 대화 히스토리 포함** — ctx.sessionManager.getBranch() 스냅샷 + 질문/옵션 텍스트를 사이드 호출에 싣는다(/btw 충실도; 비용은 사용자 수용). (R6)
7. **예산: 세션 모델·상한 없음** — ctx.model(세션 현재 모델) 사용, 턴·토큰 인위 상한 없음, 종료는 사용자 Esc. (R8)
8. **no-tools 강제** — 사이드 호출은 tools 미제공 + no-tools 지시 프롬프트(루프 방지, /btw 선례). 시스템 프롬프트는 비공백(Codex 400 가드).
9. **인증·에러 계약** — modelRegistry.resolver(model, sessionId) 인증(OAuth 스티키·회전), provider 에러=terminal AssistantMessage(stopReason 게이트)·resolver 실패=예외의 이원 처리, 실패·취소 시 목록 복귀(질문 생존). (리서치 C13 + AC4)
10. **fixture 불변·비노출** — fixtures.ts 스키마 무변경; fixture 모드는 UI 우회로 채팅 원천 비노출; 헤드리스(hasUI=false)는 현행 하드에러 유지, custom 불가 환경(RPC/ACP 등 custom 스텁 모드)에서는 기존 ctx.ui.select/editor로 안전 폴백. (R5 AC2)
11. **진입 어포던스: 키바인딩 + 푸터 안내** — 옵션 포커스 상태에서 지정 키로 원버튼 상세/채팅 진입, 푸터에 키 힌트 상시 표시(구체 키맵은 plan에서 확정). 목록 행 추가 없음. (R10)
12. **질문 태깅·AC9 규약 유지** — 태그 prefix+게이트 suffix 규약 불변; ask.ts `.describe` 수정 시 3개 SKILL.md SSOT 동기화. (trace H-C)
13. **pure-core/wrapper 관례 유지** — performX 순수 함수 + registerAskTools 래퍼, TS2589 회피 명시 타입 인자, 새 포트는 인터페이스+테스트 페이크+래퍼 3곳 동시 추가.
14. **컬러 팔레트: 자유 RGB + 명암 적응** — lets-craft 고유 팔레트(테마 토큰 비종속, 임의 24-bit ANSI — 파이프라인 보존 검증됨)를 쓰되, 호스트 Theme colorMode(라이트/다크)를 감지해 팔레트를 명암별로 적응시켜 대비를 유지한다. (R11 + wave-4 C17)
15. **글자 확대 미채택** — OSC 66/DECDWL 등 크기 프로토콜 비도입, 단일 렌더 경로. 크기감은 굵기·색 대비·여백·구분선 위계로 구현. (R12)
16. **사이드챗 내부 캐시 확보** — promptCacheKey=메인 세션ID 시드(안정), sessionId=`{main}:side:{nonce}`(고유 — OpenAI/Codex 메인 오염 방지 필수), 채팅 세션 동안 시스템 프롬프트+히스토리 스냅샷 프리픽스 불변, cacheRetention 마커 적용(Anthropic cache_control 자동). 메인 턴 프리픽스 히트 재현은 비목표. (R13 + wave-4 C18)

## Non-Goals

- 호스트(oh-my-pi) 변경·SDK 심 추가 요청 — BYO로 충분함이 검증됨.
- **askDialog 채택** — 17.0.5에서도 key-opaque + 로컬 chat 훅 부재로 질문 안 채팅과 구조 충돌(R2·R15에서 2회 명시 배제; 자체 컴포넌트로 대체).
- 사이드챗의 메인 트랜스크립트 영속(branch-to-persist류) — details 기록으로 종결(R3).
- CONTENT envelope 문법 확장 — 명시 배제(R3).
- fixture 스키마 확장(신규 kind) — 채팅이 fixture 경로에 나타나지 않으므로 불필요(R5 AC2).
- 경량 모델 라우팅·비용 상한 장치 — 세션 모델·무상한으로 확정(R8에서 명시 배제).
- 원격 collab/guest 경로의 채팅 UI — 로컬 인터랙티브 TUI 한정.
- **글자 확대(OSC 66/Kitty 프로토콜)** — R12에서 명시 배제(pi-tui 구현 존재하나 비채택).
- **메인 턴 캐시 프리픽스 히트 재현** — 호스트 비공개 변환의 바이트 동일성이 필요해 사실상 불가(R13에서 명시 배제; 내부 캐시로 대체).

## Acceptance Criteria (R5 확정 4그룹 + R9/R14 세부 + R15 범프)

**AC1 — 채팅 왕복과 상태 유지.**
1. select(단일/멀티)·confirm·ask 각각에서: 옵션(또는 질문) 지정 → 원버튼 상세 → 답변 표시 → 목록 복귀가 동작한다.
2. 같은 패널에서 자유 프롬프트 멀티턴 채팅이 동작하고 Esc로 종료해 목록으로 복귀한다.
3. 복귀 후 멀티선택 체크 상태·커서 위치가 보존된다.
4. 최종 도구 결과의 CONTENT는 채팅 발생 여부와 무관하게 동일 문법이고, details.sideChat에 문답이 기록된다.

**AC2 — 파이프라인 계약 무해성 (+SDK 범프 회귀).**
1. 기존 테스트 전량 통과(envelope/fixture/스킬 계약 회귀 zero) — **17.0.5 범프 후 기준**(전 모듈 컴파일 + 기존 suite green).
2. LSC_FIXTURE 모드에서 채팅 어포던스가 노출되지 않고 스크립트 응답이 현행과 동일하게 동작한다.
3. 헤드리스(no fixture)는 현행 하드에러 유지; custom 미지원 UI 모드에서는 기존 select/editor 폴백으로 질문이 성립한다.
4. lsc_ask/lsc_select/lsc_confirm이 17.x 런타임에서 의도한 loadMode로 노출된다(essential 기본선; 배분은 plan 확정치 기준).

**AC3 — 가독성 물리 기준 (R9: 포커스 전문 + 목록 스크롤).**
1. 옵션 4개 × SSOT 상한 길이 설명 조건에서, 포커스 옵션의 설명은 항상 전문 접근 가능(필요 시 내부 스크롤)하다.
2. 비포커스 옵션은 label+설명 첫 줄을 유지하고, 목록 전체가 스크롤로 접근 가능하다 — 어떤 옵션의 설명도 '소실'되지 않는다.
3. 소형 터미널(예: 24행)에서도 1·2가 성립한다.

**AC4 — 실패 격리.**
1. 사이드 호출의 provider 에러(429/5xx/인증)·중단(Esc)·resolver 실패가 발생해도 진행 중인 질문은 죽지 않고 목록으로 복귀하며 정상 응답 가능하다.
2. 에러는 패널 내 상태로 표기되고(재시도 가능), 도구 결과를 오염시키지 않는다.

**AC5 — 컬러 위계 (R11/R12 + R14 검증 방법).**
1. 질문 제목/옵션 label/설명/푸터/채팅 패널이 lets-craft 팔레트의 위계(굵기·색·여백·구분선)로 렌더되고, 렌더 출력의 ANSI가 스냅샷 테스트로 고정된다.
2. 호스트 Theme의 라이트/다크 모드 각각에서 팔레트가 적응해 대비가 유지된다(모드별 스냅샷).
3. 글자 확대 시퀀스(OSC 66 등)는 출력에 나타나지 않는다.

**AC6 — 캐시 구성 (R13 + R14 검증 방법).**
1. 사이드 호출 요청이 캐시 히트 가능한 형태로 구성됨을 단위 테스트로 고정: 안정 promptCacheKey(메인 세션ID 시드), 고유 side sessionId, 채팅 멀티턴 간 프리픽스(시스템 프롬프트+히스토리 스냅샷+선행 문답) 불변, cacheRetention 마커 옵션 전달.
2. 실제 캐시 히트(provider usage의 cache_read 토큰)는 craft 단계에서 1회 라이브 실측해 증거로 기록한다(상시 테스트 아님).

## Assumptions Exposed & Resolved

| # | 가정 | 노출 계기 | 해소 |
|---|---|---|---|
| 1 | "btw처럼" = 호스트 심 재사용 가능 | trace Lane 3/4 | 반증 — BYO-completion + custom<T>로 재구성(R1) |
| 2 | 가독성 문제 = 호스트 렌더 결함 | trace P1a | 반증 — compact 물리 제약 + 텍스트 부피; 자체 컴포넌트로 해소(R2, R9) |
| 3 | 자유 프롬프트가 유일 형태 | contrarian R4 | 정교화 — 원버튼 상세(빠른 경로) + 자유 채팅(심층) 병행 |
| 4 | 설명 호출은 경량이 합리적 | simplifier R6 | 기각 — 사용자가 히스토리 포함(품질 우선) 선택, 비용 수용 |
| 5 | 사이드챗 기록이 에이전트에게 필요 | R3 | 기각 — details만; envelope 불변이 우선 |
| 6 | 채팅은 select 옵션 한정 | R7 | 확장 — 3도구 전부 + 질문 자체 대상 포함 |
| 7 | 비용 폭주 방지 상한 필요 | R8 | 기각 — 세션 모델·무상한, Esc 종료(사용자 자율 우선; 리스크 명시 수용) |
| 8 | 스타일은 호스트 테마 토큰을 따라야 한다 | R11 | 기각 — lets-craft 고유 자유 팔레트(단 명암 모드 적응으로 충돌 완화) |
| 9 | "텍스트 크기" = 실제 글자 확대 | R12 + wave-4 | 기각 — OSC 66은 kitty 전용 생태계라 미채택; 크기감은 위계로 충족 |
| 10 | 사이드 호출도 메인 캐시에 히트시킬 수 있다 | R13 + wave-4 | 반증 — 호스트 비공개 변환 재현 불가; 사이드챗 내부 캐시로 대체 확정 |
| 11 | 최신 SDK가 더 유려한 ask API를 준다 | R15 + wave-5 | 정정 — askDialog API는 16.4.5=17.0.5 동일(런타임 폴리시만); 유려함은 자체 컴포넌트 소관, 범프는 재료·최신성 확보 목적으로 채택 |

## Technical Context

- **SDK 마이그레이션 (R15)**: package.json — @oh-my-pi/pi-coding-agent 16.4.0→17.0.5(devDep), @oh-my-pi/pi-ai 16.4.0→17.0.5(dep), @oh-my-pi/pi-tui 17.0.5 신규(dep, exact-pin). 도구 등록에 loadMode 지정(ask 3종 essential 기본선). 16.4.0→17.0.5 extension-API 델타는 추가형(askDialog·loadMode·localProtocolOptions·managed timers)이라 기존 코드 컴파일 호환 예상 — AC2.1로 검증.
- **구현 좌표**: src/ask.ts의 performX 루프(:404-458, :513-527)가 컴포넌트 호출로 대체/확장되는 지점; SelectUI/AskUI 포트에 신규 메서드(컴포넌트 구동·completion 주입) 추가 — 인터페이스+페이크+래퍼 3곳.
- **컴포넌트 계약**: ctx.ui.custom<T>(factory(tui: TUI, theme: Theme, keybindings: KeybindingsManager, done)) — Component 인터페이스(render 필수, handleInput/dispose 선택), Container 상속 가능; Markdown·Editor·wrapTextWithAnsi·truncateToWidth·matchesKey + 17.0.5 신규 FuzzyText·Editor.setScrollbarVisible·Loader 애니메이션 가용; 테마는 getMarkdownTheme()/getEditorTheme()(coding-agent 루트 export).
- **스타일 재료 (wave-4)**: 렌더 파이프라인은 임의 ANSI(24-bit)·SGR 속성을 보존(wrap/truncate ANSI-aware — pi-natives 검증); Theme.getColorMode()로 명암 감지; 인라인 markdown 강조는 renderInlineMarkdown 경유로 현행도 동작; Box/Text/Spacer/DynamicBorder + 심볼 프리셋이 위계 재료.
- **completion 계약**: `stream(model, {systemPrompt:[...], messages}, {apiKey: modelRegistry.resolver(model, sessionId), signal, sessionId: side고유, promptCacheKey: 메인ID, cacheRetention})`의 event iterator에서 text_delta 소비(스트리밍 표시), stopReason 'error'/'aborted' 게이트 + try/catch(resolver reject); 히스토리는 ctx.sessionManager.getBranch() 스냅샷 직렬화(omp examples/hooks/qna.ts 선례). /btw도 16.4에선 providerSessionState 미전달 — Codex append-chain 재사용은 비목표(17.0.5 시그니처 재확인은 plan에서).
- **캐시 재료 (wave-4)**: promptCacheKey는 OpenAI/Codex prompt_cache_key로 전달; Anthropic은 키 개념 없이 cacheRetention에 따른 cache_control 마커+프리픽스 동일성(applyPromptCaching 자동); 멀티턴 프리픽스 불변이 히트 조건.
- **선례 재사용**: 호스트의 제거된 'Chat about this' wiring(onChat→{kind:'chat'})은 UX 참고; /btw의 no-tools 리마인더 프롬프트 패턴 재사용; pi-ask-user의 검색·랩핑 기법 + 17.0.5 askDialog의 인라인 preview 렌더 기법(a741e0b38) 참고.
- **리스크 상수**: BYO 라이브 실행은 티어2(타입+예제) — craft 초기 스파이크로 티어1 격상 권고(trace §9); 캐시 실효는 craft 1회 실측(AC6.2); 17.0.5 범프 회귀는 AC2.1로 게이트.

## Trace Findings

`trace.md` 참조 — Most Likely Explanation: extension SDK에 generation 심 부재(수렴 확정)이나 BYO-completion+custom<T>로 우회 가능; 가독성 병목은 compact 물리 제약+텍스트 작성; 바인딩 제약은 fixture/SSOT 계약층. wave-4 추가 판정: 텍스트 스타일 제어는 무제한(ANSI 보존)·크기(OSC 66)는 kitty 전용이라 미채택, 캐시는 사이드챗 내부 확보로 확정. wave-5 추가 판정: 최신(17.0.5)의 askDialog API는 16.4.5와 동일(런타임 폴리시만 개선)이고 in-question 채팅과 구조 충돌 — 범프는 하되 자체 컴포넌트 유지. 전체 인용: `research/SYNTHESIS.md` + `research/waves/wave-4.md`·`wave-5.md`(19클레임 전원 accepted).

## Ontology + Ontology Convergence

최종 엔티티(12): 질문 도구 3종(lsc_ask/lsc_select/lsc_confirm) · 옵션{label,description} · 통합 셀렉터·채팅 컴포넌트 · lets-craft 컬러 팔레트 · 원버튼 상세 · 자유 프롬프트 채팅 레이어 · completion 어댑터(캐시 구성 포함) · 히스토리 스냅샷 · details.sideChat · envelope(CONTENT, 불변) · fixture 채널(불변) · 푸터 키 힌트.

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 8 | — | — | 8 | 0 | N/A |
| 2 | 8 | 7 | 1 (사이드챗→통합 컴포넌트) | 0 | 0 | 1.00 |
| 3 | 9 | 8 | 0 | 1 (details.sideChat) | 0 | 0.89 |
| 4 | 10 | 8 | 1 (채팅 레이어 세분화) | 1 (원버튼 상세) | 0 | 0.90 |
| 5 | 10 | 10 | 0 | 0 | 0 | 1.00 |
| 6 | 11 | 10 | 0 | 1 (히스토리 스냅샷) | 0 | 0.91 |
| 7 | 11 | 10 | 1 (도구 범위 select→3종) | 0 | 0 | 1.00 |
| 8 | 11 | 11 | 0 | 0 | 0 | 1.00 |
| 9 | 11 | 11 | 0 | 0 | 0 | 1.00 |
| 10 | 11 | 11 | 0 | 0 (푸터 힌트는 속성) | 0 | 1.00 |
| 11 | 12 | 11 | 0 | 1 (컬러 팔레트) | 0 | 0.92 |
| 12 | 12 | 12 | 0 | 0 | 0 | 1.00 |
| 13 | 12 | 12 | 0 (캐시 구성은 어댑터 속성) | 0 | 0 | 1.00 |
| 14 | 12 | 12 | 0 | 0 | 0 | 1.00 |
| 15 | 12 | 12 | 0 (SDK 버전은 환경 속성) | 0 | 0 | 1.00 |

## Interview Transcript

**R1 [Goal]** 채팅 구조 — 질문 안 사이드 채팅(권장)/재질의 루프/하이브리드 → **질문 안 사이드 채팅**.
**R2 [Goal]** 가독성 구현 위치 — 자체 컴포넌트 통합(권장)/askDialog 병행(16.4.5 범프)/텍스트 규칙만 → **자체 컴포넌트에 통합**.
**R3 [Constraints]** 문답 기록 — details만(권장)/CONTENT 병기/완전 휘발 → **details에만 기록**.
**R4 [Goal, CONTRARIAN]** 자유 프롬프트 필요성 심문 — 필수/원버튼 충분/병행(권장) → **원버튼 + 자유 프롬프트 병행**.
**R5 [Success Criteria, multi]** 수용 기준 — 채팅 왕복·상태 유지/계약 무해성/가독성 물리 기준/실패 격리 → **4종 전부**.
**R6 [Constraints, SIMPLIFIER]** 컨텍스트 스코핑 — 질문·옵션만(권장)/히스토리 포함/기능 요약 절충 → **대화 히스토리 포함**.
**R7 [Goal]** 적용 범위 — select 옵션만/옵션+질문(권장)/3도구 전부 → **3개 도구 전부**.
**R8 [Constraints]** 예산 프로필 — 세션 모델·보수 상한(권장)/세션 모델·무상한/경량 모델 → **세션 모델·상한 없음**.
**R9 [Success Criteria]** 소형 터미널 최소선 — 포커스 전문+목록 스크롤(권장)/통스크롤/요청 시 확장 → **포커스 전문 + 목록 스크롤**.
**R10 [Goal]** 진입 어포던스 — 키바인딩+푸터(권장)/목록 행/병행 → **키바인딩 + 푸터 안내**.
— (사용자 추가 요구 1: 텍스트 크기·컬러 포함, 캐시 유지 조사 → wave-4 재조사 후 재개) —
**R11 [Goal]** 텍스트 스타일 수준 — 테마 위계+조건부 확대(권장)/테마 위계만/자유 컬러 커스텀 → **자유 컬러 커스텀**.
**R12 [Goal]** 글자 확대 채택 — 감지 시 자동(권장)/설정 opt-in/미채택 → **확대 미채택**.
**R13 [Constraints]** 캐시 요구 수준 — 사이드챗 내부 캐시 확보(권장)/메인 프리픽스 시도/미고려 → **사이드챗 내부 캐시 확보**.
**R14 [Success Criteria]** 신규 축 검증 방법 — 단위 CI+크래프트 1회 실측(권장)/단위 CI만/라이브 상시 → **단위 CI + 크래프트 1회 실측**.
— (사용자 추가 요구 2: SDK 최신 범프 시 ask UI 개선 가능성 조사 → wave-5 재조사 후 재개) —
**R15 [Constraints]** SDK 버전×UI 경로 — 16.4.0 유지+자체 컴포넌트(권장)/17.0.5 범프+자체 컴포넌트/17.0.5 범프+askDialog → **17.0.5 범프 + 자체 컴포넌트**.

각 라운드에서 점수표(Dimension/Score/Weight/Weighted/Gap)·병목 1문장·타깃 로테이션을 채팅에 표시하고 lsc_select(15회)로 질의함. 질문 전부 §1.2 태깅 규약 준수. 3-point injection: trace §7을 초기 아이디어에 주입, 코드베이스 컨텍스트를 trace 종합으로 대체, 첫 질문(R1)을 Lane 4/5 critical unknown에서 추출. R10 이후 사용자 추가 요구 2회로 Goal/Constraints 재개방(각각 wave-4·wave-5 리서치 선행) 후 R11-R15로 게이트 재통과.
