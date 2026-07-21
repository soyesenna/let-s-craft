# Observation Manifest — ask-readability-option-chat (worker-attributed raw findings)

각 항목은 워커 귀속 원 관찰. 전문은 `agent://<worker>` / `history://<worker>`.

## TracerCodePath (Lane 1)
- ask.ts는 prose를 전혀 변형하지 않음: question→UI title verbatim (ask.ts:117,406,436,514); buildDisplayRows는 {label,description} verbatim push, 유일한 변형은 ` (Recommended)` suffix (ask.ts:303-304); serializeEnvelope가 유일한 합성기 (ask.ts:75-85).
- select/multi/confirm 각각 blocking `while(true)` 재렌더 루프 보유 (ask.ts:404-422, 433-458, 513-527) — Other→editor→Esc→continue 체인이 이미 존재. 사이드챗 복귀 루프의 자연스러운 심.
- SelectUI/AskUI/EditorPort는 UI-method-subset만 노출 (select+editor) — model generation 포트 없음. ctx.models는 read-only query (SDK types.ts:342-360,380).
- 미사용 SDK 어포던스: ExtensionUIDialogOptions.helpText(전역 푸터 힌트, types.ts:142-143), outline(134-135), onLeft/onRight(136-139), editorOptions.promptStyle(252) — src/ask.ts 어디에서도 미참조.
- 관례: pure-core/wrapper 분리(vitest가 omp SDK 값 import 불가, ask.ts:17-21), registerTool마다 명시적 타입 인자(TS2589 회피, ask.ts:546-548). 새 포트 메서드는 인터페이스+테스트 페이크+래퍼 3곳 동시 추가 필요.
- lsc_confirm 래퍼가 cross-cutting 로직(승인 게이트, ask.ts:629-683)을 이미 보유 — generation-injection의 선례 심.

## TracerFixtureContracts (Lane 2)
- FixtureAnswerBody는 closed 4-kind union: free-text|selection|selection-index|confirmation (fixtures.ts:30-34) — 비결정(non-decision) kind 없음. 신규 kind는 fixtures.ts 스키마 변경 필요 (checkAllowedKeys 162-188, parseFixtureAnswerFile 263-269가 unknown key 거부).
- matchFixtureAnswer: 규칙 미매치+default 없으면 throw (fixtures.ts:102-119). canonical fixture default는 confirmation (answers.json:47-50) — lsc_ask/lsc_select가 이 default를 받으면 kind-mismatch로 isError (ask.ts:152-154, 344-345; 테스트 고정: fixtures.test.ts:846-851, 814-819). 즉 **fixture 모드에서 unscripted 사이드챗 질문은 에러 → CI 파손**.
- `proceed\??$` catch-all (answers.json:42) — 'proceed?'로 끝나는 어떤 질문도 자동 승인. 사이드챗 질문 태그가 게이트 suffix와 충돌 금지.
- envelope 문법은 SSOT 게이트 파싱의 로드베어링 (User selected: / User provided free answer: 헤더만 파싱, 들여쓰기 payload는 opaque). 사이드챗 응답이 게이트 CONTENT에 재진입하면 §1.2(c) reflect-and-reask 유발.
- once 규칙은 kind-check 전에 소비됨 (fixtures.ts:128-134 vs ask.ts kind check) — 에러 경로에서 소비 순서 미고정(테스트 갭).

## TracerHostCapability (Lane 3 — premise audit)
- **P1a 반증**: 호스트는 description을 렌더함 — HookSelectorComponent.#renderOptionLines: muted 색, 4-space indent, wrapTextWithAnsi 랩, truncateToWidth ellipsis (hook-selector.ts:330-382).
- **P1b 부분**: compact mode는 터미널 높이 물리 제약 (O23 소스 확인) — 전체 확장 리스트가 row budget 초과 시 발동; 비포커스 옵션은 label만, 포커스 옵션 description만 truncate 표시 (hook-selector.ts:429-433,495-521); maxVisible=max(4,min(15,rows-12)) (extension-ui-controller.ts:604). 긴 description일수록 compact 조기 발동.
- **P1c 미해결(진짜 레버)**: 가독성 결함은 호스트 렌더 실패가 아니라 lets-craft가 description에 눌러 담는 텍스트 양+스타일의 함수.
- **P2a 반증 (16.4.0과 16.5.2 공통)**: ExtensionContext/ExtensionAPI에 complete/llm/runAgent/prompt 부재. tool execute는 base ExtensionContext만 수신 (types.ts:486) — ExtensionCommandContext(newSession/branch)는 커맨드 전용.
- **P2b 실행가능**: @oh-my-pi/pi-ai는 lets-craft 직접 의존성; completeSimple(model, context, options) export (stream.ts:1215-1225); ctx.models.resolve('smol')→Model; ctx.modelRegistry.getApiKey(model, sessionId?)→키. 단 host 계측(instrumentedCompleteSimple) 우회 — 텔레메트리/동시성/재시도 레이어 없음. 라이브 실행 미검증(타입 검증만).
- **P2c**: ctx.ui.select는 key-handling opaque — per-option explain 키 주입 불가. 유일한 라운드트립 심은 ctx.ui.custom<T>(factory,{overlay?}) — full keyboard focus, done(result) 후 재-select 가능. 긴 답변 표시는 custom 스크롤러블 Markdown 또는 editor; notify는 부적합.
- Critical unknown: pi-tui Component 베이스가 플러그인이 서브클래스해도 되는 안정 공개 API인가.

## TracerBtwPriorArt (Lane 4)
- /btw 전체 메커니즘 file:line 체인 확보 (생성→프롬프트→스트림→렌더→해제/복사/브랜치). 포터빌리티 테이블:
  - Portable: btw-user.md 프롬프트 외피, 패널 상태기계, 렌더러(pi-tui Markdown), 복사, b/c/Esc 키(→ctx.ui.onTerminalInput).
  - Needs host seam(THE blocker): runEphemeralTurn(no-tools 보장, history 미persist, promptCacheKey 재사용, 스트림 소스), #buildEphemeralSnapshot(in-flight 스트림 텍스트), branch-to-chat(다단 host 오케스트레이션).
  - Not portable: AnchoredLiveContainer/btwContainer(호스트 레이아웃 전용) — setWidget/custom({overlay})로 대체.
- **H3 (구조 불일치)**: /btw는 라이브 턴 밖 유저 슬래시 커맨드; lsc_select는 에이전트가 결과 대기로 턴을 멈춘 blocking tool handler — "ephemeral over live turn"의 직접 유사물이 없음. 사이드 완성의 의미를 tool-call 맥락에 재정의 필요.
- askDialog {kind:'chat'}은 main-loop 핸드오프(tools on, persisted) — ephemeral 시맨틱 아님, UX 선례로만 유효.
- createAgentSession은 공개 export지만 독립 풀세션 스폰 — 캐시/컨텍스트 공유 없음, 저하된 대안.

## TracerUxValue (Lane 5)
- 7항목 가독성 pain-point 목록(모두 Tier≤2 — 라이브 도그푸딩 데이터 부재, '가독성 낮음' 전제 자체가 미실증으로 플래그).
- UX 후보 5종: D1 close-and-reopen 채팅 / D2 per-option keybind expand / D3 post-pick follow-up / D4 bespoke widget(custom component) / D5 authoring-only. 각각 entry/model/루프복귀/fixture/CONTENT/오남용 트레이드오프 정리.
- 헤드라인: "like /btw" 프레이밍은 explain 반쪽에 대해 구조적으로 불가(플러그인 도구는 ctx.ui.select 안에서 모델 접근 없음) — 진짜 explain-chat은 기존 게이트 free-answer 규칙과 동형인 close-and-reopen sentinel→re-ask 패턴 또는 custom component로 강제됨. **가독성(정적·저비용)과 explain-chat(동적·고비용·multi-select 체크상태 소실 리스크)은 별개 문제 — 가독성 먼저.**

## RExploreSdk
- 16.4.0 ExtensionUIContext 전체 시그니처 (types.d.ts:102-178): select(title, options:(string|{label,description})[], dialogOptions?), confirm, input, notify, onTerminalInput, setStatus, setWorkingMessage, setWidget, setFooter/setHeader/setTitle, custom<T>(factory,{overlay?}), setEditorText/pasteToEditor/getEditorText, editor(title,prefill?,dialogOptions?,editorOptions{promptStyle?}), addAutocompleteProvider, setEditorComponent, theme APIs. **askDialog/preview/header 없음.**
- 16.4.0 ExtensionContext (types.d.ts:237-267): ui, getContextUsage, compact, hasUI, cwd, sessionManager(ReadonlySessionManager — getCwd/getSessionDir/…/putBlobSync, forkFrom·appendMessage 없음), modelRegistry(카탈로그+auth: getApiKey/getApiKeyForProvider/resolver 등, 완성 호출 없음), model, models(list/current/resolve/family), isIdle, abort, hasPendingMessages, shutdown, getSystemPrompt, memory?. **ctx.session/runEphemeralTurn 없음.**
- pi.pi가 AgentSession/createAgentSession re-export; AgentSession.runEphemeralTurn은 16.4 타입에 존재(agent-session.d.ts:1227-1241)하나 새로 만든 세션 객체에서만 — 라이브 세션 핸들은 미제공.
- 16.5.2 추가: ExtensionAskDialogOption{label,description?,preview?}, Question{id,question,header?,options,multi?,recommended?}, result union(submit/chat: selectedOptions/customInput/note/timedOut), ExtensionUIContext.askDialog?(239-244), ExtensionContext.localProtocolOptions?. **extension-facing runEphemeralTurn/ctx.session은 16.5.2에도 없음.**
- 호스트 rich ask: src/tools/ask.ts:878-904 — extensionUi.askDialog 있으면 사용, 없으면 select/editor 폴백. AskDialogComponent: preview pane(ask-dialog.ts:676-701), header chips(126-139).
- **BYO-completion 공식 예제 (핵심)**: vendored examples/hooks/qna.ts:1-5,43-90 + handoff.ts:76-115 + custom-compaction.ts:33-87 — extension/hook 핸들러가 `@oh-my-pi/pi-ai`의 complete()를 직접 호출: ctx.model 확인 → ctx.sessionManager.getBranch()로 history 수집 → ctx.modelRegistry.getApiKey(ctx.model!) → complete(ctx.model!, {systemPrompt,messages}, {apiKey, signal}). qna는 ctx.ui.custom loader로 스트리밍 UI 처리.
- 모드별 편차: RPC select는 description 드랍(rpc-mode.ts:683-707), custom/footer/header 스텁; ACP는 select/confirm/input만; headless runner는 no-op UI + hasUI false. setLabel 타입-구현 불일치(사소).

## RExploreTui
- ctx.ui.select → extension-ui-controller.ts:80-120 → showHookSelector:844-893 → HookSelector가 editorContainer에 마운트(오버레이 아님). title은 full Markdown; label/description 인라인 Markdown 렌더.
- 호스트 rich ask 경로: ask.ts:878-943 → showAskDialog:584-705 → AskDialog — 고정 높이 ~70% 터미널(min12), ScrollView body, question title 인라인 Markdown 최대 4행, option label+description(최대 2 wrapped rows, ellipsis), preview는 width>=73이면 사이드 패널, 아니면 리스트 아래. 로컬엔 Chat 옵션 없음 — guest 경로만 'Chat about this' 추가(extension-ui-controller.ts:584-658,714-818); ChatResult 타입은 존재(types.ts:148-155). ASK_CHAT_OPTION 상수는 controller:34-37.
- collab wire는 preview를 strip(extension-ui-controller.ts:55-61; wire/src/index.ts:301-311) — 원격 게스트는 chat은 있으나 preview 없음.
- HookEditor: title 평문 accent, promptStyle borderless>gutter, Enter 제출/Shift+Enter 개행 (hook-editor.ts:40-95, editor.ts:546-550,690-825,1455-1559).
- ctx.ui.custom: 임의 Component 마운트 + overlay 옵션(고정 bottom-center, 100% maxHeight) (types.ts:254-291; controller.ts:1007-1057); setWidget은 에디터 위/아래 부착, focus/modal 없음(controller.ts:279-333).
- 참고 커밋: #3269 Other-Escape 복귀 수정 = 12aedd738; rich ask 도입 changelog 16.4.5(coding-agent/CHANGELOG.md:224-225); HEAD bcee73e58(Jul11); 더 새로운 preview 개선 커밋 a741e0b38/59b9f6568/2300c9ff4(Jul18).

## RExplorePi (ancestor)
- pi ExtensionUIContext: select는 options:string[]만(descriptions 불가); ExtensionSelectorComponent가 editorContainer 대체(문자열 리스트만). SelectList(pi/packages/tui)는 {value,label,description?} 지원하나 브리지 경로가 아님.
- **번들 예제가 결정적 선례**: examples/extensions/question.ts(35-52 스키마 label+description; 73-210 ctx.ui.custom 상태기계 — 옵션 아래 description 상시 출력, 인라인 에디터, Escape-to-list), questionnaire.ts(탭 멀티질문), qna.ts(10-12,79-103 — **ctx.ui.custom loader 안에서 pi-ai complete(ctx.model,...) 직접 호출**), summarize.ts/handoff.ts/custom-compaction.ts(동일 BYO-completion), subagent/(격리 pi 서브프로세스).
- pi에 /btw 없음(/tmp/extensions/btw.ts는 테스트 합성 데이터일 뿐 — interactive-mode-status.test.ts:724-735). sendUserMessage/steer/followUp은 persistent 큐잉 턴 — ephemeral 아님(대조 선례).
- ExtensionAPI에 complete() 없음 — completion은 pi-ai(compat.ts:256-283 export complete/completeSimple/stream/streamSimple)를 직접 import.

## RLibOmpDocs
- ExtensionAskDialogChatResult{kind:"chat"}은 공개 계약에 잔존, AskTool은 chatRedirect details 반환 — 그러나 bcee73e58(v16.4.5)에서 로컬 AskDialogComponent의 "Chat about this" 행 제거, collab/guest 경로에만 잔존.
- npm 17.0.0: custom/extension tool 기본 loadMode "discoverable"(xd:// 마운트) — 17.x 범프 시 registerTool마다 loadMode:"essential" 필요 추정(검증 필요).
- Issue #6085: sidebranch.ts — SessionManager.forkFrom + orphan tool-call stub 수리 + Q&A append. extension발 사이드 대화의 유일한 공개 선행 사례.
- askDialog는 공개 인터페이스지만 docs/ 언급 zero — 문서화되지 않은 표면, 안정성 보장 약함. `if (ctx.ui.askDialog)` 가드 권장.

## RLibTuiPriorArt
- 9패턴 카탈로그: A 전역 expand 키(@inquirer/expand h키) / B 포커스-preview(@inquirer/select description, clack hint, **pi-ask-user split-pane**) / C 필드-레벨(huh — per-option 없음, ? 토글 주장 hallucination 확인) / D 유저 토글 코멘트(pi-ask-user ctrl+g) / E 구조화 질문 도구(opencode question=free-answer 모델 직계, Claude Code AskUserQuestion, Gemini ask_user, Codex request_user_input — **전부 explain affordance 없음**) / F 승인 게이팅 / G **ephemeral LLM 사이드 질문(/btw — 유일한 LLM-on-demand, 단 host-global·옵션 비바인드)** / H aider 자유 대화 / I 원시요소(ratatui, gum — description 필드조차 없음).
- **결론: 옵션-바인드 LLM explain-then-return 결합 선례 부재 — novel 조합 (Pattern E ⊗ G).** 최근접 부분 사례 = pi-ask-user(정적 split-pane) + /btw(LLM, 비바인드).
- NNG progressive disclosure의 'contextual help on demand' 변형이 이론적 근거.

## RLibSampling
- MCP sampling/createMessage: 정확한 프로토콜 매치이나 **2026-07-28 RC에서 deprecated(SEP-2577)** — "New implementations SHOULD NOT adopt"; 후속은 MRTR(SEP-2322, InputRequiredResult). 채택도 원래 얇았음(Claude Desktop/Code, OpenCode, ChatGPT Apps 전부 미출시 요청 상태). shape 참조로만 사용.
- deprecation 근거(held stateful connection)는 in-process 플러그인엔 미적용 — sampling shape(host-중개, 플러그인 무키, 중앙 비용)는 lets-craft에 여전히 유효할 수 있음.
- VS Code Language Model API(vscode.lm): extension↔host 스트리밍 완성, per-call 휴먼 게이트 없음 — UX상 최근접 유사물.
- LangGraph interrupt(): 중단점+재개가능 상태 핸들 필요 교훈.
- 리스크/완화 카탈로그: 루프(툴콜 폐기+no-tools 리마인더 / 반복 상한), 비용(캐시 재사용, maxTokens), 프롬프트 인젝션(2-체크포인트 휴먼 게이트, 시크릿 난독화), 컨텍스트 스코핑(full-history[omp 선택] vs question-only[MCP 기본] — **미해결 설계 축**), persistence(ephemeral 기본 + branch-to-persist).
- runEphemeralTurn 계약 전문 확보 (JSDoc + side-channel-no-tools.md 원문 + CHANGELOG 교차확인).
