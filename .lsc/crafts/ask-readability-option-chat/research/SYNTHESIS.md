# External Research Synthesis — ask-readability-option-chat

> 정본 원장: `research/claims.json` (16 claims, 전원 accepted, 2026-07-20 재각인). 이 문서는 원장의 projection — 역방향 편집 금지. 소스 표기: [Source N] = 아래 소스 대장.

## 1. 문제 재정의 (intent-diff 요약)

요청은 두 개의 결합된 변경이다: (1) lsc_ask/lsc_select/lsc_confirm 텍스트의 **가독성 고도화**, (2) select 옵션에 대해 사용자가 자유 프롬프트로 에이전트 설명을 요청하고 답을 본 뒤 질문으로 복귀하는 **옵션-바인드 사이드 채팅**(oh-my-pi `/btw` 유사). lets-craft는 oh-my-pi coding-agent의 **플러그인**이므로, 두 변경 모두 "extension SDK가 무엇을 허용하는가"가 지배 변수다.

## 2. 핵심 결론

### 2.1 가독성: 병목은 호스트가 아니라 물리 제약 + 우리 자신의 텍스트

- 호스트 HookSelector는 description을 정상 렌더한다(muted 색·4-space indent·wrap·ellipsis) — "호스트가 못 그린다"는 반증됨 [Source 1].
- 실제 병목은 ① compact-mode 물리 제약(전체 확장 리스트가 row budget(`max(4,min(15,rows-12))`)을 넘으면 비포커스 옵션 description이 사라짐 — O23의 소스 확인) ② lets-craft가 description에 눌러 담는 텍스트 부피·구조다 [Source 1][Source 2].
- lets-craft ask.ts는 완전 pass-through(질문→타이틀 verbatim, 옵션 verbatim)라 코드-상주 가독성 레버는 (a) zod `.describe()` 작성 계약, (b) 미사용 SDK 어포던스(helpText 푸터 힌트 — 셀렉터 푸터에 실제 렌더됨, editorOptions.promptStyle), (c) 텍스트 작성 규칙 자체다 [Source 3][Source 4].
- **급소 발견: `ctx.ui.askDialog`** — 호스트의 rich ask 다이얼로그(질문 탭·헤더 칩·옵션별 preview·노트·멀티셀렉트, 고정 높이 70%·ScrollView·인라인 preview)가 **16.4.5부터 published .d.ts에 존재**하고(16.4.0에는 없음), 16.4.0→16.4.5의 extension-API 파괴 변경은 **zero**다(전 인터페이스 diff로 검증). @oh-my-pi sibling 11종 exact-pin 락스텝 범프 필수. 17.x는 loadMode default-flip(extension tool이 xd:// 디바이스로 마운트)이라는 실질 파괴 변경 + 17.0.0 registerTool 버그가 있어 회피 대상 [Source 5]. askDialog는 docs 미기재 표면이므로 `if (ctx.ui.askDialog)` 가드 + select/editor 폴백이 필수 [Source 6].

### 2.2 옵션 설명 채팅: 선례 없음(novel) — 그러나 모든 부품이 존재

- **선행 사례 부재**: 11개 도구군 조사 결과, bounded-select ⊗ 옵션-바인드 온디맨드 LLM 설명 결합은 어디에도 없다. 가장 근접한 부분 사례는 pi-ask-user(정적 split-pane description)와 /btw(LLM 온디맨드지만 host-global·옵션 비바인드) [Source 7].
- **SDK에 first-class LLM 심 없음** (16.4.0·16.5.2 공통): ExtensionContext/ExtensionAPI에 complete/runEphemeralTurn 부재; sendMessage/sendUserMessage는 메인 루프(tools on, persisted) 하이재킹이라 부적합 [Source 8].
- **그러나 BYO-completion이 공식 선례로 성립**: 호스트 번들 예제(omp examples/hooks/qna.ts·handoff.ts·custom-compaction.ts)와 pi 번들 예제(qna.ts·summarize.ts)가 extension 핸들러에서 `@oh-my-pi/pi-ai`의 `complete()`를 직접 호출한다 — ctx.model + ctx.modelRegistry.getApiKey로 조립. lets-craft는 pi-ai를 이미 직접 의존한다 [Source 9].
- **canonical 계약은 host eval completion-bridge**: getApiKey preflight → `completeSimple(model, {비공백 systemPrompt, messages}, {apiKey: modelRegistry.resolver(model, sessionId), signal})` → stopReason error/aborted 게이트 + try/catch(resolver reject는 예외, provider 에러는 terminal AssistantMessage로 resolve되는 이원성). 스트리밍 표시가 필요하면 `stream()`의 event iterator에서 text_delta를 직접 소비(SimpleStreamOptions에 onTextDelta 없음). OAuth는 getApiKey가 유효 bearer를 반환(sk-ant-oat 자동 감지)하고 세션 스티키를 위해 sessionId를 일관 전달 [Source 10].
- **UI 라운드트립 표면은 ctx.ui.custom<T>가 유일**: ctx.ui.select는 key-opaque(호스트가 모든 키 소유)이고, onLeft/onRight 콜백은 `() => void`(하이라이트 미전달)이며 호출 즉시 select를 undefined로 종료시켜 explain 진입키로 쓸 수 없음이 확정됨. custom<T>는 (TUI, host Theme, host KeybindingsManager, done) 4-param factory로 full keyboard focus를 가진 컴포넌트를 마운트하고 done(result)로 복귀한다 [Source 11].
- **필요 pi-tui 프리미티브 전원 가용·안정**: Container/Markdown/Editor/TUI/matchesKey/wrapTextWithAnsi 등 런타임 값과 Component 인터페이스(render 필수, handleInput/dispose 선택)가 16.4.0↔16.4.5↔16.5.2 byte-identical export. 직접 사용 시 @oh-my-pi/pi-tui를 exact-pin 락스텝 runtime dep으로 추가 [Source 12].
- **`/btw` 시맨틱의 정확한 상실분**: 플러그인측 BYO completion은 runEphemeralTurn의 promptCacheKey 재사용·계측·시크릿 난독화·in-flight 스냅샷을 상실한다. 또한 /btw는 라이브 턴의 사이드채널이지만 lsc_select는 에이전트가 결과를 기다리며 턴이 멈춘 blocking tool — "ephemeral"의 의미 자체를 tool-call 맥락에 맞게 재정의해야 한다(대화 히스토리 접근도 ctx.sessionManager.getBranch() 스냅샷으로 대체) [Source 13].
- **호스트 자신의 UX 선례**: 초기 rich ask에는 로컬 "Chat about this" 행이 있었고(38a5c8a89 도입 → 48b2a742c typed {kind:'chat'} → AskTool이 chatRedirect details 반환) bcee73e58(16.4.5)에서 로컬 행이 제거되어 collab/guest 경로에만 남았다. 재도입 없음이 git -S로 증명됨. 이 wiring은 lets-craft 자체 chat-row 설계의 직접 선례다 [Source 14].

### 2.3 파이프라인 계약(내부) 제약

- fixture 스키마는 closed 4-kind union(비결정 kind 없음) — 스크립트되지 않은 사이드챗 질문은 kind-mismatch 에러로 **무인 CI를 파손**한다. CI-안전 설계는 fixture-mode 억제 또는 신규 fixture kind 확장 중 하나를 강제한다 [Source 15].
- 사이드챗은 게이트 CONTENT envelope에 재진입하면 안 되고(§1.2(c) reflect-and-reask 유발), yes/옵션-라벨로 파싱 가능해도 안 되며(destructive-action 규칙), 게이트 suffix(`proceed?` 등)로 끝나는 질문 태그와 충돌해도 안 된다 [Source 15].
- description 텍스트 수정은 fixture-safe(매칭 미참여, 테스트 고정)지만 AC9 2-계층 대응(ask.ts `.describe` ↔ SKILL.md §1.2 SSOT) 동기화를 강제한다 [Source 15].

### 2.4 프로토콜 선례의 교훈

- MCP sampling(정확한 shape 매치)은 2026-07-28 RC에서 **deprecated**(SEP-2577) — 기반이 아닌 shape 참조. 단 deprecation 근거(held stateful connection)는 in-process 플러그인에 미적용 [Source 16].
- 리스크 완화 카탈로그(전 선례 종합): 루프 방지 = 툴콜 폐기+no-tools 리마인더(/btw) 또는 반복 상한(MCP); 비용 = maxTokens 상한·프롬프트 캐시; 컨텍스트 스코핑 = full-history(/btw) vs question-only(MCP 기본) — **미해결 설계 축(인터뷰行)**; 영속성 = ephemeral 기본 + 명시적 승격(branch-to-persist) [Source 16][Source 13].

## 3. 설계 공간 요약 (인터뷰/플랜 입력)

두 부품 축:
- **가독성 축**: (A) SDK 16.4.5 범프 + askDialog 채택(preview/header/notes — 최대 가독성 이득, 미문서화 표면 가드 필수) vs (B) 현행 select 유지 + 텍스트 작성 규칙·helpText·envelope 개선(무범프·보수적) vs (C) 자체 custom 컴포넌트로 셀렉터 대체(최대 자유도·최대 구현비).
- **채팅 축**: (i) ctx.ui.custom<T> 안에서 BYO-completion(pi-ai) 인라인 사이드챗 — 진짜 in-question 채팅, novel; (ii) close-and-reopen — select 결과에 explain-request 신호를 담아 반환하고 메인 에이전트가 설명 후 재질문(기존 free-answer 재질의 규칙과 동형, 플러그인 코드 최소·메인 트랜스크립트에 영속); (iii) 둘의 하이브리드.
- 두 축은 독립적으로 결정 가능하되, (A)+(i) 결합 시 askDialog와 custom 컴포넌트의 UI 이중화를 피하는 설계 판단 필요.

## 4. 소스 대장

| # | 소스 | 성격 |
|---|---|---|
| 1 | TracerHostCapability — pinned SDK hook-selector.ts:330-382,429-521; extension-ui-controller.ts:604 | 1차 소스(핀 패키지) |
| 2 | RExploreTui — 렌더 경로 walkthrough(HookSelector/AskDialog/HookEditor/custom/setWidget) | 1차 소스(vendored) |
| 3 | TracerCodePath — ask.ts:75-85,117,295-310,404-458,513-527,546-548,572-598 | 1차 소스(lets-craft) |
| 4 | TracerCodePath/W2AskDialogArch — helpText 렌더(hook-selector footer :264-267) | 1차 소스 |
| 5 | W2NpmVersions — published tarball .d.ts 검증(16.4.0~17.0.5), lockstep exact-pin, 17.0.0 changelog | 1차 소스(npm) |
| 6 | RLibOmpDocs — askDialog docs 언급 zero | 1차 소스(docs 부재 확인) |
| 7 | RLibTuiPriorArt — 9패턴 카탈로그(inquirer/clack/huh/gum/opencode/Claude Code/Gemini/Codex/aider/ratatui/pi-ask-user + NNG) | 다독립 1차 소스 |
| 8 | TracerHostCapability P2a + RExploreSdk — 타입 표면 전수 스캔 | 1차 소스 |
| 9 | RExploreSdk(omp examples/hooks/qna.ts:78-89 등) + RExplorePi(pi examples) | 1차 소스(공식 예제) |
| 10 | W2PiAiDeep — completion-bridge.ts:122-178, stream.ts:756-1228, 에러 이원성, OAuth 스티키 | 1차 소스(핀 패키지) |
| 11 | W2AskDialogArch — onLeft/onRight 판정(b5a471d8 diff, controller :611-622), custom<T> 계약 | 1차 소스(git+타입) |
| 12 | W3PiTuiSurface — 심볼별 대조표(16.4.0/16.4.5/16.5.2), legacy-pi-compat 로더 | 1차 소스(npm tarball) |
| 13 | TracerBtwPriorArt + RLibSampling — runEphemeralTurn 계약 전문, 포터빌리티 테이블 | 1차 소스(vendored) |
| 14 | W2AskDialogArch — chat-row git 고고학(38a5c8a89/48b2a742c/bcee73e58) | 1차 소스(git) |
| 15 | TracerFixtureContracts — fixtures.ts:30-34,102-134; ask.ts:152-154,344-345; SKILL §1.2; 테스트 고정 | 1차 소스(lets-craft) |
| 16 | RLibSampling — MCP spec 2025-11-25/draft, SEP-2577/2596/2322, VS Code LM API, LangGraph interrupt | 1차 소스(스펙/공식 문서) |

검증 상태 상세와 각 클레임의 dropCondition은 `claims.json`(정본), 서사 뷰는 `claim-graph.md`, 배제 대안은 `cause-disappearance.md` 참조.
