# Plan — ask-readability-option-chat

## Metadata

| 항목 | 값 |
|---|---|
| Feature | ask 도구 가독성(레이아웃+텍스트 스타일) 향상 + 옵션 설명 사이드 채팅(캐시 최적화 포함) |
| 분류 | Brownfield — src/ask.ts(685행) 확장 + 자체 TUI 컴포넌트(`src/ask-ui/`) 신설 |
| 입력 | spec.md(ambiguity 0.047), trace.md(5레인+리서치 5웨이브), open-questions.md(7항목), research/claims.json(19클레임 전원 accepted) |
| 환경 | lets-craft@feat/ask-readability-option-chat; **SDK @oh-my-pi/* 17.0.5 락스텝 범프** |
| SDK 재확인 | vendored oh-my-pi 17.0.5 동가(HEAD 39c95e5e)로 시그니처 explore 완료 — 파괴 변경 0건(§Context) |
| PR 수 | 5 (범위 3-6) |
| 복잡도 | MEDIUM (경계·계약 제약 다수, 신규 novel UX) |
| 작성 | lsc-planner, 2026-07-20 (iteration 1 리뷰 반영) |
| 부록 | plan/appendix-{dr, pre-mortem, test-plan, precedent, palette-and-prompts}.md |

### Claim Legend

[Cn] = `research/claims.json` claims 배열의 n번째(1-based). 요지:
C1 SDK에 completion 심 부재 · C2 BYO-completion(pi-ai) 성립 · C3 select key-opaque, custom<T>만 라운드트립 · C4 가독성 병목=compact+텍스트 · C5 novel 조합 · C6 MCP sampling deprecated · C7 fixture unscripted→CI 파손 · C8 askDialog 16.4.0 부재/chat guest 전용 · C9 /btw 시맨틱 host-internal · C10 ask 텍스트 verbatim+재렌더 루프 존재 · C11 askDialog 16.4.5 최초·16.4.0→16.4.5 무파괴·락스텝·17.x loadMode flip · C12 Node/Vitest pi-ai/pi-tui 값-import 불가(Bun 심) · C13 canonical completion-bridge 패턴 · C14 'Chat about this' wiring 선례 · C15 ReadonlySessionManager Pick=forkFrom/branch/appendMessage 제외 · C16 pi-tui 프리미티브 안정·custom<T> 4-param·pi-tui exact-pin 추가 · C17 텍스트 스타일 무제한(테마+ANSI)·OSC 66 kitty 전용 · C18 프롬프트 캐시 3단 판정 · C19 17.0.5=latest·askDialog=16.4.5·범프는 편의 재료.

## Context

두 서브피처 모두 호스트 변경 없이 lets-craft 코드로 구현한다. extension SDK에 generation 심이 없고([C1], vendored types.ts 전수), select는 key-opaque라 유일 라운드트립 UI 표면은 `ctx.ui.custom<T>`([C3])다. BYO-completion(pi-ai 직접 호출)이 공식 선례로 성립([C2], eval/completion-bridge.ts:124-164). 가독성 병목은 호스트가 아니라 compact 물리 제약 + lets-craft 자신의 텍스트([C4][C10], ask.ts는 verbatim pass-through).

**현행 구조(lets-craft):** src/main.ts:30-47이 단일 진입점(registerAskTools는 :36). ask.ts:17-22가 pure `performX` + 얇은 `registerAskTools` 래퍼(SDK는 `import type`만). 포트 `SelectUI`(ask.ts:176-188)/`AskUI`(:133-135 editor)를 ctx.ui로 주입, performConfirm은 SelectUI 재사용(:488-492, 별도 ConfirmUI 없음). 재렌더 루프 while(true) 3개(:404-424/433-459/513-527)에 Other→editor→continue 존재. envelope 합성 ask.ts:75-107(`User selected:`/free-answer sentinel), details 3종 :127-131/:169-174/:481-486. zod .describe + TS2589 명시 타입 인자 :546-599.

**Bun/Node 경계:** Node/vitest는 pi-ai·pi-coding-agent·pi-tui 런타임 값을 import 불가([C12]). 선례: src/statusbar/index.ts:1-6이 유일 값 import 홀더(pi-ai/usage, pi-tui matchesKey), 나머지 5 모듈은 pure(포트 주입). pi-tui는 현재 package.json에 **미기재**(transitive) — 직접 exact-pin 필요.

**SDK 17.0.5 시그니처 재확인(OQ4 — vendored oh-my-pi, HEAD 39c95e5e):**

| 계약 | 17.0.5 시그니처 / 위치 | 16.4 대비 |
|---|---|---|
| stream | `stream(model, ctx, options?)`→AssistantMessageEventStream (ai/src/stream.ts:757-764) | 동일 |
| completeSimple | `completeSimple(model, ctx, options?: SimpleStreamOptions)`→`Promise<AssistantMessage>` (stream.ts:1211-1215, streamSimple 위임 :1216-1221) | 동일 |
| StreamOptions 캐시/인증 | `signal`/`apiKey`/`cacheRetention` (ai/src/types.ts:370-372), `sessionId` (:413), `promptCacheKey` (:419), `providerSessionState`(Map) | **캐시 필드 전부 존재 — 추가 없음** |
| resolver | `resolver(model: ApiKeyResolverModel, sessionId?)`→ApiKeyResolver (config/api-key-resolver.ts:39-40, model-registry.ts:2148-2150); ApiKeyResolverModel=Pick<Model,"provider"\|"baseUrl"\|"id"> (:5) | 동일 |
| ctx.sessionManager | `ReadonlySessionManager` (extensions/types.ts:422); session-manager.ts:321-344 Pick(getSessionId :325, getBranch :337), 제외 forkFrom/branch/appendMessage([C15]) | 동일 |
| getBranch | `getBranch(fromId?)`→SessionEntry[] (session-manager.ts:1715-1717) | 동일 |
| getSystemPrompt | `ctx.getSystemPrompt()`→string[] (extensions/types.ts:440) | 동일 |
| custom<T> | `custom<T>(factory:(tui:TUI, theme:Theme, keybindings:KeybindingsManager, done:(r:T)=>void)=>ExtensionUiComponent\|Promise, options?:{overlay?})`→`Promise<T>` (extensions/types.ts:271-279); ExtensionUiComponent=Component&{dispose?()}(:208) | 동일 |
| loadMode | `ToolLoadMode`="essential"\|"discoverable"; extension 기본 discoverable, essential=top-level (extensions/types.ts:539-540); isMountableUnderXdev=loadMode==="discoverable" (tools/xdev.ts:64-66) | **신규(추가형)** |

→ **결론:** 유일 실질 변경은 `ToolDefinition.loadMode` 추가 + default-flip. completion/resolver/session/custom 표면은 무파괴 → 기존 코드 컴파일 호환 예상(AC2.1로 게이트).

**스타일/키 재료:** 명암 적응은 `Theme.isLight`(theme.ts:1528-1534) — `getColorMode()`(truecolor/256color, theme.ts:1271,1669-1671)가 아님. 임의 24-bit ANSI 보존(utils.ts:157-180, natives index.d.ts:1590-1605, [C17]). pi-tui barrel export: Container(tui.ts:486)/FuzzyText(fuzzy.ts:332-345)/Editor+setScrollbarVisible(editor.ts:396,588-591)/matchesKey(keys.ts:547-549); **DynamicBorder는 pi-tui 아님 → coding-agent(dynamic-border.ts:13)**. custom<T>는 fresh inMemory KeybindingsManager 주입(extension-ui-controller.ts:998-1018), handleInput은 raw data:string(tui.ts:2412-2419) → 컴포넌트가 전 키 소유.

**계약층:** fixtures.ts:30-34 closed 4-kind union(free-text/selection/selection-index/confirmation), free-text default 거부(:42) — unscripted 사이드챗=CI 파손이므로 채팅은 fixture 경로 원천 비노출([C7]). AC9 SSOT 3파일: skills/{pre-craft,craft,post-craft}/SKILL.md(§1.2).

## Work Objectives

1. **가독성** — 포커스 옵션 설명 전문 보장(내부 스크롤) + 목록 스크롤(소실 제거), lets-craft 팔레트 위계(제목/label/설명/푸터/채팅), 라이트/다크 적응. 글자 확대 미채택.
2. **옵션 설명 사이드 채팅** — 원버튼 상세(빠른 경로) + 자유 프롬프트 멀티턴, BYO-completion(세션 모델·히스토리 스냅샷·no-tools), 사이드챗 내부 캐시 확보, 종료는 Esc.
3. **무해성** — envelope 불변, fixture 불변, custom 미지원 폴백, 헤드리스 하드에러 유지, 17.0.5 범프 회귀 zero.
4. **기록** — details.sideChat에만 문답 기록(CONTENT 불변).

## Guardrails

**Must Have**
- pure-core 포트 주입; pi-ai/pi-tui 값 import는 `src/ask-ui/` Bun leaf(component.ts/completion.ts)에만([C12], statusbar 선례).
- **Import graph(정본):**
  ```text
  Node-safe: src/ask-ui/{types,state,render-model,palette,completion-core}.ts
    - @oh-my-pi/* runtime value import 금지; reducer/request builder/error normalizer만 소유.
  Bun-only leaves: src/ask-ui/{component,completion,index}.ts
    - component.ts만 pi-tui/coding-agent runtime 값을, completion.ts만 pi-ai runtime 값을 import.
    - index.ts가 두 leaf를 조립해 AskRuntimeFactory를 export.
  Wiring: src/main.ts → ask-ui/index.ts; main이 createAskRuntimeFactory(pi)를 registerAskTools(pi, factory)에 주입.
    - src/ask.ts와 모든 Node-safe module은 index/component/completion을 정적·동적으로 import하지 않음.
    - fixture/unavailable branch는 factory를 호출하지 않음.
  ```
- 새 포트/메서드는 인터페이스+테스트 페이크+래퍼 3곳 동시(Constraint 13).
- CONTENT envelope 문법 무변경(ask.ts:75-107); fixtures.ts 스키마 무변경; .describe 수정 시 3 SKILL.md 동기화(AC9).
- @oh-my-pi/* 17.0.5 exact-pin 락스텝(pi-coding-agent devDep, pi-ai dep, pi-tui 신규 dep).
- side 호출: 비공백 systemPrompt + no-tools; 고유 side sessionId `{main}:side:{nonce}`; 안정 promptCacheKey(메인ID); cacheRetention 마커.
- custom<T> 미지원 → ctx.ui.select/editor 폴백; 헤드리스 하드에러 유지.
- TS2589 회피 명시 타입 인자 유지(ask.ts:546-548 패턴).

**Must NOT Have**
- askDialog 채택([C8][C19]); 신규 fixture kind; 채팅의 CONTENT/메인 트랜스크립트 노출; OSC 66/크기 프로토콜([C17]); 비용 상한·경량 라우팅(R8); 메인 턴 캐시 프리픽스 히트 재현([C18]); 호스트/SDK 변경; forkFrom/branch/appendMessage 사용([C15]).

## DR (Deliberation Record) 요약

전체 상세·per-branch pros/cons·무효화 근거 → **plan/appendix-dr.md**.

- **Principles(5):** ①호스트 무변경(BYO+custom<T>) ②계약 불변 우선(envelope/fixture/SSOT/경계) ③pure-core 격리(Bun 값 import는 심에만) ④결정론 CI + 라이브 캐시 1회 실측 분리 ⑤최소 표면(3-6 PR, askDialog·목록 행 미채택).
- **Decision Drivers(top 3):** ①CI 안전성(무인 결정론, [C7]) ②pure-core 테스트 경계([C12]) ③사용자 확정 UX(in-question 채팅+상태 보존+포커스 전문).
- **DR-1 컴포넌트 아키텍처:** (A)단일 마운트 coordinator + 내부 pure subview 합성[채택] — 상태 보존이 outer coordinator 필드라 왕복 무손실(AC1.3), pure reducer/subview는 Node 단위 검증 가능; vs (B)합성/오버레이 — 상태 외부 보존 리스크·중첩 마운트 복잡.
- **DR-2 completion 어댑터 경계:** (A)전용 Bun 심 src/ask-ui/completion.ts + 포트[채택] — statusbar 선례 동형, 경계 회귀 테스트 가능; vs (B)ask.ts 인라인 — performX 테스트 경계 위태.
- **DR-3 PR 분해:** (A)범프-우선 + 가독성-우선 수직 슬라이스[채택] — 독립 검증·가독성 조기 출하; vs (B)기능-수평 2 PR — 거대·혼재.
- **DR-4 loadMode:** (A)ask 3종 essential / 13 batch discoverable[채택] — Constraint 2 기본선 + xd:// 동작 관측; vs (B)16종 전부 essential — top-level 표면 비대.
- **단일 생존 무효화:** askDialog/close-and-reopen/경량 라우팅/OSC 66/메인 캐시 히트 — 전부 무효 근거 명시(appendix-dr §무효화).

## ADR (요약 — 코어 필수)

- **Decision:** `ctx.ui.custom<T>` 위 **단일 마운트 coordinator + 내부 pure subview 합성**(src/ask-ui/, §Guardrails Import graph 정본) + **BYO-completion(pi-ai) 전용 Bun leaf + pure-core 포트 주입**으로 3 질문 도구를 재구성한다. SDK는 17.0.5 락스텝 exact-pin 범프(pi-tui 직접 dep 추가), ask 3종 loadMode=essential/13 batch=discoverable.
- **Drivers:** CI 무인 결정론([C7]) · pure-core 테스트 경계([C12]) · 확정 UX(in-question 채팅+상태 보존+포커스 전문 가독성).
- **Alternatives considered:** askDialog 채택(무효 — key-opaque+chat 훅 부재, [C8][C19]) · close-and-reopen(무효 — 상태 유실·체감 상실) · completion 인라인(무효 — 경계 위반) · 합성 오버레이 컴포넌트(무효 — 상태 보존 취약) · 16종 전부 essential(비채택 — 표면 비대).
- **Why chosen:** custom<T>가 유일한 full-focus 라운드트립 표면이며([C3]) 상태를 outer coordinator 필드로 보존해 AC1.3을 자연 충족; BYO는 공식 선례로 성립([C2][C13]); Bun leaf 격리는 statusbar가 이미 증명한 경계 패턴([C12]).
- **Consequences:** 컴포넌트가 전 키 소유(handleInput raw) → 키맵·폴백을 우리가 전담; BYO는 캐시 재사용·계측·시크릿 난독화를 상실(수용, [C9]); details.sideChat 신규 필드; pi-tui가 직접 의존이 됨; 모듈과 port가 늘고 Bun adapter용 별도 smoke test(B1-B3) 필요.
- **Follow-ups:** craft 초기 BYO 라이브 스파이크(티어1 격상, trace §9); 캐시 1회 실측(AC6.2); 팔레트 RGB는 모드별 스냅샷으로 튜닝.

## Task Flow

```text
PR1 SDK 17.0.5 + lockfile + loadMode hard gate
  → PR2 single-mount readability core + selector parity + fallback
  → PR3 completion adapter + one-button detail vertical slice + details.sideChat
  → PR4 free-prompt multi-turn + streaming/error/retry + cache-session invariant
  → PR5 contract parity + Bun/runtime regression + live cache evidence
```

PR2만으로 가독성 단독 출하 가능(가독성/채팅 분리, trace Lane 5 §6).

## Detailed TODOs (PR 단위)

### PR1 — SDK 17.0.5 락스텝 범프 + lockfile + loadMode hard gate
- package.json: `@oh-my-pi/pi-coding-agent` 16.4.0→17.0.5(devDep, :19), `@oh-my-pi/pi-ai` 16.4.0→17.0.5(dep, :24), **`@oh-my-pi/pi-tui` 17.0.5 신규 dep**(현재 transitive, statusbar/index.ts:6이 이미 값 사용) — 전부 exact-pin([C11][C16]).
- ask 3종 registerTool 정의(ask.ts:553/600/619)에 `loadMode:"essential"`; 13 batch 도구(hash 3·audit 2·run_tests·scaffold·abort·release·land·latency·claims·doctor)에 명시 `loadMode:"discoverable"`(정의 위치 §OQ1 표).
- **Hard gate:** "`package-lock.json`을 같은 exact-pin으로 재생성하고 clean `npm ci` 후 build+기존 Vitest를 실행한다. 이어 실제 17.0.5 omp에서 built plugin을 부팅해 ask 3종이 essential로 직접 노출되고 대표 batch tool 1개가 `xd://` discoverable로 실행되는 smoke를 통과한다. 어느 단계든 실패하면 PR2로 진행하지 않는다."
- smoke의 omp 설치 채널: **npm published 17.0.5**(레지스트리 설치본 위에서 built plugin 부팅; vendored build 실행이 아님 — vendored HEAD 39c95e5e는 시그니처 재확인 참고용, [C19] 17.0.5=latest).
- **AC(수용):** 전 모듈 `tsc` 컴파일 성공 + clean `npm ci` build + 기존 vitest 전 스위트 green(AC2.1); 3 도구 essential/13 discoverable 값 단위 확인(AC2.4); real omp plugin boot/loadMode smoke(E1 포함).

### PR2 — 단일 마운트 가독성 코어(custom<T>) + selector parity + 폴백
- 신규 `src/ask-ui/` — Node-safe pure core `{types,state,render-model,palette}.ts`(reducer/render model) + Bun leaf `component.ts` + `index.ts` 조립(§Guardrails Import graph 정본). 목록 렌더: 포커스 옵션 설명 전문+내부 스크롤, 비포커스 label+첫 줄 유지, 목록 스크롤(AC3).
- 팔레트 위계(9역할) + `Theme.isLight` 적응 + 256color 폴백은 24-bit SSOT에서 결정론적 파생(§appendix-palette-and-prompts §1). 굵기·색·여백·구분선만(OSC 66 금지). DynamicBorder는 coding-agent에서.
- 키맵(browse: ↑↓/PgUp·PgDn/Enter/Space/`?`/`t`/`/`/Esc) + 푸터 상시 힌트(§appendix-palette-and-prompts §2). matchesKey 사용(keys.ts:547-549).
- **상태 전이(정본):**
  ```text
  outer state owner는 mode, returnMode, canonicalCursor, checkedIndices, optionScroll,
  descriptionScrollByTarget, searchQuery, askDraft/askCursor, sideSession, activeTurnId를
  custom mount 전체 수명 동안 소유한다. view 전환은 이 owner를 재생성하지 않는다.
  select/confirm: question header는 option row가 아닌 canonicalCursor=-1 focus target이다.
  첫 option에서 Up→question, question에서 Down→첫 option; header에서 Enter/Space는 no-op,
  ?/t는 question target에 작동한다.
  ask: printable ?/t는 editor 입력으로 전달한다. Esc 1회는 draft/cursor를 보존한 채
  question-header focus로 이동하고, header의 ?/t가 side chat을 열며, Enter/Down은 editor로
  복귀하고 header에서 Esc 2회째만 질문을 취소한다. side panel 종료 시 returnMode로 복귀한다.
  / search는 optional이 아니라 mandatory baseline parity다. label+description fuzzy filter,
  original-index mapping, checked state, empty result, backspace/clear, Esc-to-browse를 보존한다.
  ```
  마운트 시 초기 포커스는 recommended ?? 0의 옵션 행이며 question header가 아니다. ask의 2단 Esc(에디터→header→취소)는 현행 1단 Esc 대비 의도된 UX 변경이며, 폴백(ctx.ui.editor) 경로는 현행 1단 Esc를 유지한다.
- **Fallback/Failure 계약(정본 — PR2 폴백 + PR3/PR4 실패 격리 공용):**
  ```text
  custom result는 undefined를 정상 결과로 사용하지 않는 discriminated union이다.
  hasUI=false는 기존 hard error. hasUI=true에서 custom 함수 부재, 또는 factory가 시작되지
  않은 채 custom promise가 undefined로 resolve될 때만 legacy select/editor로 fallback한다.
  factory 시작 뒤의 render/completion 오류는 fallback으로 숨기지 않고 side error state로 흡수한다.
  각 side turn은 AbortController+monotonic activeTurnId를 갖고 모든 resolver/iterator/render update
  예외를 terminal state event로 변환한다. Esc/dispose는 abort하고, stale id delta는 무시한다.
  side failure/abort/retry는 custom done을 호출하지 않으며 최종 answer/cancel만 done을 호출한다.
  provider/resolver error는 pure redactor를 통과한 뒤에만 details.sideChat.error에 저장한다.
  ```
- 포트/배선: SelectUI/AskUI에 컴포넌트 구동 메서드 추가(인터페이스 ask.ts:176-188 + 페이크 test/ask.test.ts:169-216 + 래퍼 :553-684 — 원자적, Constraint 13). 배선은 §Guardrails Import graph 정본 — main이 createAskRuntimeFactory(pi)를 registerAskTools(pi, factory)에 주입하고, ask.ts는 leaf를 import하지 않는다. 헤드리스 하드에러 유지.
- **AC:** ANSI 위계 스냅샷(AC5.1 — R1,R6) + 라이트/다크 스냅샷(AC5.2 — R4,R6) + OSC 66 부재(AC5.3 — R5); 포커스 전문+목록 스크롤+24행(AC3.1-3.3); 폴백/헤드리스(AC2.3 — I5); 상태 필드(체크/커서) 보존 스캐폴딩(AC1.3 — U8); 전이표+Host parity reducer 테스트(U9/U10, appendix-test-plan).

### PR3 — completion 어댑터(BYO) + 원버튼 상세 수직 슬라이스 + details.sideChat
- 신규 `src/ask-ui/completion.ts`(Bun leaf, pi-ai 값 import 격리) + pure `completion-core.ts`(request builder/error normalizer/redactor) + `CompletionPort` 인터페이스 + 테스트 페이크 + 래퍼 배선(3곳, Constraint 13).
- `completeSimple`/`stream`을 ctx.models + `resolver(model, sessionId)`로 구동(completion-bridge.ts:124-164 패턴, [C13]); 비공백 systemPrompt; tools 미제공(no-tools); text_delta event iterator 소비(스트리밍); 에러 이원(stopReason error/aborted 게이트 + try/catch resolver reject) — §PR2 Fallback/Failure 계약 준수.
- **캐시 수명(정본):**
  ```text
  SideChatSession은 질문당 최초 side interaction에서 정확히 한 번 생성한다.
  nonce/sessionId/promptCacheKey/model/systemPrompt/canonicalized getBranch snapshot을 freeze하고,
  panel close/reopen·turn·retry 전체에서 재사용하며 도구가 끝날 때만 폐기한다. getBranch는 1회만 호출한다.
  U3는 request2.messages의 request1 길이 prefix가 provider-ready 구조로 deep-equal이고,
  sessionId/promptCacheKey/cacheRetention이 동일하며 getBranch call count가 1임을 검증한다.
  O2는 cache_creation(가능한 provider)과 두 번째 turn cache_read_input_tokens>0을 기록한다.
  telemetry 부재 또는 값 0은 구조 테스트 통과와 별개로 AC6.2 미충족이며 증거 성공으로 기록하지 않는다.
  ```
  (캐시 구성치: promptCacheKey=메인 세션ID 시드, sessionId=`{main}:side:{nonce}`, cacheRetention 마커 — StreamOptions ai/types.ts:372/413/419; 히스토리=getBranch() 스냅샷 직렬화, session-manager.ts:1715-1717.)
- 원버튼 상세 수직 슬라이스: browse `?` → SideChatSession 생성(freeze) → 고정 프롬프트(§appendix-palette-and-prompts §3) → 답변 패널 표시 → 목록 복귀. select(single/multi)·confirm·ask 3도구 + 질문 자체 대상 전부 지원(R7).
- details.sideChat 필드를 3 details 타입에 추가(§appendix-palette-and-prompts §4); 채팅 발생 시에만 기록; CONTENT 불변(ask.ts:75-107 무변경).
- **Destructive/fixture parity(정본):** "`src/ask.ts:630-681`의 capture-before-await, stale-yes revoke, identity/scope check, persist-before-install 흐름은 결과 details 타입 확장 외에는 변경하지 않는다. registered `lsc_confirm`을 capture한 테스트에서 (a) side response가 literal `yes`여도 final No/free/cancel은 approval을 발급하지 않음, (b) side failure/abort 뒤에도 approval이 없음, (c) final confirmed true만 기존 단일 approval을 발급함을 검증한다. fixture 경로에서는 custom factory와 CompletionPort 호출 수가 모두 0임을 검증한다."
- **AC:** 요청 형태+프리픽스 deep-equal+getBranch 1회 단위 고정(AC6.1 — U3); 3도구 원버튼 왕복(AC1.1 — I1); CONTENT 동일+details 기록(AC1.4 — U1,U2); 에러 매핑/redactor 단위(AC4.1 — U4); destructive/fixture parity(I7); craft 초기 라이브 스파이크(trace §9, 티어1).

### PR4 — 자유 프롬프트 멀티턴 + streaming/error/retry + cache-session invariant
- 채팅 서브상태 확장: 자유 프롬프트 멀티턴(스트리밍 표시) + 단계적 Esc(§PR2 상태 전이 정본); 에러=패널 내 상태(재시도) — 각 side turn은 AbortController+monotonic activeTurnId(§PR2 Fallback/Failure 계약), 도구 결과 비오염(AC4).
- cache-session invariant: PR3에서 freeze한 SideChatSession을 turn/retry/panel close-reopen 전체에서 재사용(§PR3 캐시 수명 정본); 멀티턴 프리픽스 불변은 U3의 deep-equal oracle로 검증.
- 왕복 후 체크/커서 보존(AC1.3); details.sideChat 멀티턴 기록.
- **AC:** 멀티턴+Esc(AC1.2 — I2) + 상태 보존(AC1.3 — I3) + details 기록(AC1.4) + 실패 격리 UI(AC4.1/4.2 — I4).

### PR5 — 계약 동기화 + Bun/runtime 회귀 + 캐시 실측 증거
- envelope 불변 회귀 + fixtures.ts 스키마 불변 확인(신규 kind 없음, 채팅 fixture 비노출) — 단위/통합(AC2.2). ask-ui 경계 회귀: **허용 leaf 2개(component.ts/completion.ts)만 @oh-my-pi 값 import를 갖고, pure 모듈·ask.ts에서 leaf(index/component/completion)로 가는 import edge가 없음**을 검사(statusbar-regression 패턴 확장, [C12]).
- Bun Adapter 테스트 B1-B3(`bun test test-bun`, §appendix-test-plan §Bun Adapter) — PR5 게이트: 실패는 PR5 미통과.
- .describe 변경분 있으면 3 SKILL.md §1.2 동기화(AC9, Constraint 12).
- 캐시 1회 라이브 실측(§appendix-palette-and-prompts §5) → `plan/appendix-cache-probe.md`에 증거 기록(AC6.2); telemetry 부재/값 0은 AC6.2 미충족(fail-closed).
- **AC:** AC2.2(I6,E2), AC6.2(O2), AC9 동기화, B1-B3 green.

## AC Coverage Matrix

| AC | 요지 | PR | 테스트 유형 |
|---|---|---|---|
| AC1.1 | 3도구 원버튼 왕복 | PR3 | integration (I1) |
| AC1.2 | 자유 멀티턴 + Esc | PR4 | integration (I2) |
| AC1.3 | 체크/커서 보존 | PR2/PR4 | unit(U8)+integration(I3) |
| AC1.4 | CONTENT 동일 + details.sideChat | PR3/PR4 | unit (U1,U2) |
| AC2.1 | 범프 후 기존 suite green + 컴파일 | PR1 | e2e/regression (E1) |
| AC2.2 | fixture 채팅 비노출 + 스크립트 동일 | PR5 | integration/e2e (I6,E2) |
| AC2.3 | 헤드리스 하드에러 + custom 미지원 폴백 | PR2 | unit/integration (I5) |
| AC2.4 | loadMode 노출(essential/배분) | PR1 | unit (U5) |
| AC3.1 | 포커스 전문 접근(+스크롤) | PR2 | snapshot (R1) |
| AC3.2 | 비포커스 유지·목록 스크롤·무소실 | PR2 | snapshot (R2) |
| AC3.3 | 소형 터미널(24행) | PR2 | snapshot (R3) |
| AC4.1 | 실패/중단/resolver 실패→질문 생존 | PR3/PR4 | unit(U4)+integration(I4) |
| AC4.2 | 패널 에러+재시도, 결과 비오염 | PR4 | integration (I4) |
| AC5.1 | 위계 ANSI 스냅샷 | PR2 | snapshot (R1,R6) |
| AC5.2 | 라이트/다크 적응 스냅샷 | PR2 | snapshot (R4,R6) |
| AC5.3 | OSC 66 부재 | PR2 | snapshot (R5) |
| AC6.1 | 캐시 히트 형태 요청 단위 고정 | PR3 | unit (U3) |
| AC6.2 | 라이브 cache_read 1회 실측 | PR5 | observability (O2) |

전 6그룹(AC1-AC6) 및 세부 전부 매핑됨. 상세 테스트 정의 → plan/appendix-test-plan.md.

## Success Criteria

- 5 PR 전부 각 AC 통과, 17.0.5 범프 후 기존 suite green + 전 모듈 컴파일(AC2.1).
- 포커스 옵션 설명이 어떤 조건에서도 소실되지 않음(AC3); 팔레트 위계가 라이트/다크 모두 스냅샷 고정(AC5).
- 3도구에서 원버튼+자유 멀티턴 채팅 왕복, 상태 보존, CONTENT 불변, details.sideChat 기록(AC1).
- 실패 시 질문 생존·목록 복귀(AC4); fixture/헤드리스/폴백 무해(AC2).
- 캐시 히트 형태 단위 고정(AC6.1) + 라이브 1회 실측 증거(AC6.2).

## Open Questions (7항목 해소)

전부 spec 확정 결정을 바꾸지 않는 하위 설계 — plan에서 확정. 상세 구현치는 부록.

1. **loadMode 배분** — **확정:** ask 3종(lsc_ask/lsc_select/lsc_confirm)=`essential`; 13 batch(lsc_doctor/scaffold/craft_abort/craft_init/verify_hash/restore_tests/land/latency_report/craft_release/run_tests/audit_begin/audit_validate/claims)=명시 `discoverable`. 근거: types.ts:539-540(기본 discoverable, essential=top-level), xdev.ts:64-66, 현행 xd:// 동작 관측(open-questions.md #1). 정의 위치·근거 표 → §OQ1 표(아래). (appendix-dr §DR-4)
2. **키맵** — **확정:** browse(↑↓ nav·PgUp/PgDn 스크롤·Enter 선택·Space 토글·`?` 상세·`t` 채팅·Esc 취소), chat(Enter 전송·단계적 Esc), 검색은 `/` 게이트(**mandatory baseline parity** — 기존 HookSelector 검색 대체). custom<T>가 전 키 소유(진짜 호스트 충돌 없음, extension-ui-controller.ts:998-1018/tui.ts:2412-2419); `?`/`t`는 검색 서브모드와만 겹쳐 `/` 게이트로 무모호화. 충돌검사=statusbar TOGGLE_CHORD 선례(statusbar/index.ts:41-43). 상세 → appendix-palette-and-prompts §2 + §PR2 상태 전이 정본.
3. **컬러 팔레트** — **확정:** lets-craft 브랜드 RGB 9역할 매핑, `Theme.isLight`로 라이트/다크 적응(getColorMode() 아님), 256color 폴백(24-bit SSOT에서 결정론 파생), 대비 목표(본문 ≥4.5:1 — 명시 reference background 대비 proxy). RGB 표는 제안치 — 모드별 스냅샷(AC5.2)으로 craft 튜닝. 상세 → appendix-palette-and-prompts §1.
4. **17.0.5 시그니처 재확인** — **확정(explore 완료):** stream/completeSimple/StreamOptions(캐시 필드 전부 존재)·resolver·getBranch/getSystemPrompt·custom<T> 파괴 변경 0건, 유일 신규는 loadMode. §Context 표 참조.
5. **원버튼 상세 고정 프롬프트** — **확정:** 비공백 systemPrompt(no-tools 리마인더) + 옵션/질문 대상 2변형 유저 프롬프트 + getBranch 스냅샷 주입. 전문 → appendix-palette-and-prompts §3.
6. **details.sideChat 스키마** — **확정:** optional `sideChat.turns[]`(target/mode/prompt/response/model/startedAt/endedAt/status[/error]), 3 details 타입 모두에 배치, CONTENT 불변, 시크릿 미기록. 전문 → appendix-palette-and-prompts §4.
7. **캐시 1회 실측 절차** — **확정:** Anthropic 권장, 2턴째 onResponse usage의 cache_read>0 관찰, `plan/appendix-cache-probe.md`에 증거 기록(상시 테스트 아님); telemetry 부재 또는 값 0은 AC6.2 미충족으로 기록(fail-closed). 절차 → appendix-palette-and-prompts §5.

### OQ1 표 — 16 도구 loadMode 배분 (정의 file:line)

| 도구 | 정의 | 인터랙티브 | loadMode |
|---|---|---|---|
| lsc_ask | src/ask.ts:553-564 | 예(ctx.ui.editor) | **essential** |
| lsc_select | src/ask.ts:600-612 | 예(ctx.ui.select) | **essential** |
| lsc_confirm | src/ask.ts:619-684(destructive wrapper :627-684 — CS5 수정 금지 영역) | 예(ctx.ui.select) | **essential** |
| lsc_doctor | src/doctor.ts:510-527 | 아니오 | discoverable |
| lsc_scaffold | src/artifacts/scaffold.ts:122-137 | 아니오 | discoverable |
| lsc_craft_abort | src/craft/abort.ts:47-65 | 아니오 | discoverable |
| lsc_craft_init | src/craft/hash-manifest.ts:239-333 | 아니오 | discoverable |
| lsc_verify_hash | src/craft/hash-manifest.ts:340-384 | 아니오 | discoverable |
| lsc_restore_tests | src/craft/hash-manifest.ts:394-420 | 아니오 | discoverable |
| lsc_land | src/craft/land.ts:478-506 | 아니오 | discoverable |
| lsc_latency_report | src/craft/latency-report.ts:652-670 | 아니오 | discoverable |
| lsc_craft_release | src/craft/release.ts:103-125 | 아니오 | discoverable |
| lsc_run_tests | src/craft/run-tests.ts:308-329 | 아니오 | discoverable |
| lsc_audit_begin | src/craft/verdict.ts:295-312 | 아니오 | discoverable |
| lsc_audit_validate | src/craft/verdict.ts:441-461 | 아니오 | discoverable |
| lsc_claims | src/research/claims-tool.ts:165-186 | 아니오 | discoverable |

(전원 현재 main.ts:32-47에서 pi.registerTool로 등록, loadMode 미지정=런타임 discoverable.)

## Review Status

- **Architect:** reviewed — iteration 1, blocking(AWC-equivalent); Change Spec 8항(CS1-CS8) 전량 반영.
- **Critic:** APPROVE-WITH-CHANGE — iteration 1; Major Fix 1-4 + Minor ⓐ-ⓓ + What's-Missing 3소항 전량 반영. diff-only recheck 대기.
- **Consensus:** DR/ADR 골격 유지 위에 PR 재배치(가독성-우선 수직 슬라이스 실현), Import graph·상태 전이·Fallback/Failure·캐시 수명·destructive parity 계약 정본화, 팔레트 9-role SSOT 통일 반영.
