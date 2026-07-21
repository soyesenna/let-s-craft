# Trace — ask-readability-option-chat

- Feature: lets-craft ask 도구(lsc_ask/lsc_select/lsc_confirm) 고도화 — (1) 텍스트 가독성 향상, (2) 옵션별 에이전트 설명 요청 채팅(oh-my-pi `/btw` 유사)
- 분류: **Brownfield** (src/ask.ts 685행 직접 확장; 선행 landed craft `ask-tool-enhancement`가 현행 v2 구조를 구축)
- 작성: 2026-07-20, 레인 5 + 리서치 3웨이브(11+4+1 워커) 종합
- 환경 고정: lets-craft@feat/ask-readability-option-chat, SDK @oh-my-pi/pi-coding-agent 16.4.0(핀), vendored 호스트 소스 = 16.5.2/HEAD bcee73e58, npm latest = 17.0.5

---

## 1. Observed Result

- lets-craft의 세 질문 도구는 ctx.ui.select/editor로 렌더되며, 텍스트 합성은 **완전 pass-through**다(질문→타이틀 verbatim, 옵션 {label,description} verbatim, 유일 변형은 ` (Recommended)` suffix). 옵션에 대해 에이전트에게 되묻는 어포던스는 존재하지 않는다.
- "가독성이 낮다"는 사용자 체감의 소스-레벨 대응물: description은 muted 색·4-space 들여쓰기로 렌더되고, 옵션 4개 × 긴 description이면 compact 모드가 발동해 **비포커스 옵션의 description이 화면에서 사라진다**(커서를 올려야 잘린 형태로 보임). 질문 태그 prefix(`[Goal]` 등)와 WHAT/WHY/장단점 구조가 눌러 담긴 description이 이 발동을 앞당긴다.
- 호스트(oh-my-pi)에는 동일 문제를 푸는 두 선례가 존재한다: `/btw`(ephemeral 사이드 질문, host-internal) 및 rich askDialog(16.4.5+, 옵션 preview/헤더 칩/노트 — 로컬 "Chat about this"는 16.4.5에서 제거됨).

## 2. Ranked Hypotheses (레인 종합, 반박 라운드 반영)

| 순위 | 가설 | 판정 |
|---|---|---|
| H-A | **기능 부재의 근본 기제**: extension SDK가 tool handler에 LLM-completion 심과 per-option 어포던스 심을 노출한 적이 없다 — 16.4.0·16.5.2 공통. 따라서 옵션-채팅은 (a) BYO-completion(pi-ai 직접 호출) + ctx.ui.custom<T>, (b) tool-result 채널 재진입(close-and-reopen), (c) 호스트 심 요청 중 하나로만 구현 가능 | **수렴 확정** (4개 독립 증거 스트림) |
| H-B | **가독성의 근본 원인**: 호스트 렌더 결함이 아니라 ① compact-mode 물리 제약(O23) ② lets-craft 자신의 텍스트 부피·구조 ③ 미채택 상위 표면(askDialog, 16.4.5+) | **확정** (P1a 반증, P1b·P1c 소스 확인) |
| H-C | **바인딩 제약은 fixture/SSOT 계약층**: 신규 상호작용은 fixture closed 4-kind union·envelope 문법·게이트 규약·AC9 2-계층 대응과 충돌 없이 설계되어야 하며, 무인 CI에서 결정론적이어야 한다 | **확정** (직교 제약으로 유지) |
| H-D | close-and-reopen(도구 결과로 explain-request 신호 반환 → 메인 에이전트가 설명 → 재질문)이 유일한 실현 경로다 | **강등** — "유일"은 반증됨(BYO-completion 성립). 단 정당한 설계 대안으로 잔존(트랜스크립트 영속·구현 단순·fixture 단순) |
| H-E | /btw의 ephemeral 시맨틱은 tool-call 맥락에 직접 이식 불가(라이브 턴 부재) — "ephemeral"의 재정의 필요 | **H-A에 병합** (동일 기제의 따름정리; 설계 노트로 보존) |

## 3. Evidence Summary by Hypothesis

**H-A (심 부재 + 우회로 존재):**
- 16.4.0 published 타입 전수 스캔: ExtensionContext(ui/sessionManager[Readonly]/modelRegistry/model/models/…)와 ExtensionAPI(registerTool/on/sendMessage/exec/…)에 generation 부재; ctx.models는 read-only query. 16.5.2도 동일(신규는 askDialog·localProtocolOptions뿐). [RExploreSdk, TracerHostCapability, TracerCodePath — 독립 수행]
- 우회로의 공식 선례: omp 번들 examples/hooks/qna.ts:78-89(`complete(ctx.model!, {...}, {apiKey, signal})`), handoff.ts, custom-compaction.ts; pi 번들 qna.ts/summarize.ts. canonical 계약은 host eval completion-bridge.ts:122-178(resolver 인증+stopReason 게이트). [RExploreSdk, RExplorePi, W2PiAiDeep]
- UI 라운드트립: ctx.ui.custom<T> factory(TUI, host Theme, host KeybindingsManager, done) — full keyboard focus, done(result) 후 재-select 가능(controller.ts:763-815). 필요한 pi-tui 프리미티브는 16.4.0↔16.5.2 byte-identical export. [W3PiTuiSurface]
- select 위 직접 주입은 불가: HookSelector가 모든 키 소유; onLeft/onRight는 `() => void`(하이라이트 미전달)이고 호출 즉시 settle(undefined)로 select 종료(b5a471d8 도입 diff로 증명). [W2AskDialogArch]

**H-B (가독성):**
- P1a 반증: hook-selector.ts:330-382 — description을 muted·indent·wrap·ellipsis로 정상 렌더.
- P1b: compact 발동 조건·row budget 산식(maxVisible=max(4,min(15,rows-12))) 소스 확인 — 물리 제약이지 결함 아님(hook-selector.ts:429-521, extension-ui-controller.ts:604).
- P1c: ask.ts는 zero 변형(합성 3사이트: :117, :295-310, :75-85) — 텍스트 부피·구조는 전적으로 우리(SSOT 작성 규칙 + zod .describe 계약)의 산물.
- 상위 표면: askDialog는 **16.4.5부터 published .d.ts에 존재**(preview+header 포함, 17.0.5까지 byte-identical), 16.4.0→16.4.5 extension-API 파괴 zero(전 인터페이스 diff), sibling 11종 exact-pin 락스텝. 단 docs 미기재 — `if (ctx.ui.askDialog)` 가드+폴백 필수. 17.x는 loadMode default-flip(xd:// 마운트)로 회피. [W2NpmVersions, RLibOmpDocs]
- 미사용 어포던스: helpText(셀렉터 푸터에 실렌더), editorOptions.promptStyle, outline — ask.ts 미배선. [TracerCodePath, W2AskDialogArch]

**H-C (fixture/SSOT):**
- FixtureAnswerBody = closed 4-kind union(fixtures.ts:30-34); unscripted 질문은 confirmation default로 낙하 → lsc_ask/lsc_select에서 kind-mismatch isError(테스트 고정: fixtures.test.ts:846-851, 814-819) → **무인 CI 파손 경로**.
- `proceed\??$` catch-all(answers.json:42) — 신규 질문 태그가 게이트 suffix와 충돌 금지; 사이드챗 응답은 게이트 CONTENT 재진입 금지(§1.2(c) reflect-and-reask 유발), yes/라벨 파싱 가능 금지(destructive-action 규칙).
- description 수정은 fixture-safe(매칭 미참여, 테스트 고정)나 AC9 2-계층(ask.ts .describe ↔ SKILL §1.2) 동기화 강제.
- once 규칙이 kind-check 전에 소비되는 순서 미고정 갭(설계 시 유의). [TracerFixtureContracts]

**H-D (close-and-reopen 대안):**
- 기존 게이트 free-answer 규칙(§1.2(c) 반영-후-재질의)과 동형 — 스킬 계약이 이미 이 모양의 루프를 규정. 장점: 플러그인 코드 최소, 설명이 메인 트랜스크립트에 영속(오케스트레이터 모델도 봄), fixture 영향 zero에 가까움. 단점: 턴 왕복 비용, 질문 상태(멀티셀렉트 체크 등) 소실 리스크, "in-question" 체감 상실. [TracerUxValue, TracerCodePath H2b]

**H-E (ephemeral 재정의):**
- /btw는 라이브 턴의 사이드채널(in-flight 스냅샷 포함); lsc_select 실행 중엔 메인 턴이 tool 결과 대기로 suspend — 스냅샷할 in-flight 스트림이 없음. 컨텍스트는 ctx.sessionManager.getBranch() 히스토리 스냅샷으로 대체 가능(omp qna.ts가 정확히 이 방식). 상실분: promptCacheKey 재사용, 계측, 시크릿 난독화. [TracerBtwPriorArt, RLibSampling, W2PiAiDeep]

## 4. Evidence Against / Missing Evidence

- **BYO-completion의 라이브 실행 미검증** (티어 2에 머묾): 타입+공식 예제 기반. 실제 registered tool handler에서 resolver 인증·completeSimple 호출이 성공하는지는 통제 재현이 없다. → §9 프로브.
- "가독성 낮음" 자체의 정량 증거 부재: 도그푸딩 로그에서 구체 불만 기록을 찾지 못함(Lane 5) — pain point 목록은 구조 분석 기반(Tier≤2). 인터뷰에서 사용자의 실제 불만 지점을 확정해야 함.
- compact-mode 실발동 빈도 미측정: 실제 lets-craft description 길이 표본 대비 row-budget 임계 계산은 미실시.
- askDialog는 미문서화 표면 — 안정성 보장이 select/editor 4종보다 약함(버전 pin+가드로 완화 가능하나 리스크 잔존).
- fixture 에러 경로의 once-소비 순서는 테스트 미고정.

## 5. Rebuttal Round

- **D(close-and-reopen 유일론) → A(BYO+custom 가능론)에 대한 반박**: "Lane 5는 플러그인이 select 안에서 모델에 접근할 수 없다고 판정했다 — in-tool 채팅은 환상 아닌가?" **응답(증거)**: Lane 5의 전제는 'ctx.ui.select 내부'로 한정하면 참이나, 도구 핸들러는 select 호출 *사이*(performSelect 루프)와 custom<T> 컴포넌트 *내부*에서 자유롭게 코드를 실행한다. omp 자신의 qna.ts가 ctx.ui.custom 로더 안에서 complete()를 호출하는 공식 예제다(:78-89). 전제가 좁았음 — 리더 생존, D는 대안으로 강등.
- **E(맥락 불일치) → A에 대한 반박**: "runEphemeralTurn 동등물이 없으니 심을 새로 만들어도 /btw가 안 된다." **응답**: /btw의 정의적 특성 중 tool-call 맥락에서 무의미한 것(in-flight 스냅샷)과 대체 가능한 것(히스토리 → getBranch() 스냅샷), 상실을 감수할 것(캐시 키·계측)을 분리하면, 남는 요구는 "no-tools 단발 완성 + 스트리밍 표시 + 비영속"이고 이는 BYO로 충족된다. E는 A의 설계 노트로 병합.
- **B에 대한 반박**: "muted 색·들여쓰기 자체가 문제고 우리는 그걸 못 바꾼다." **응답**: 스타일은 호스트 소관이 맞으나, 발동 조건(텍스트 부피)과 표면 선택(askDialog의 preview/헤더/고정높이 ScrollView)은 우리 소관 — 레버는 충분히 우리 쪽에 있다. 리더 유지.

## 6. Convergence / Separation Notes

- **진짜 수렴**: H-A는 4개 독립 증거 스트림(lets-craft 포트 분석 / SDK 타입 전수 / btw 파이프라인 분석 / npm published 타입)이 동일 기제("extension-facing generation 심 부재")를 가리킴 — 언어 유사가 아닌 기제 동일.
- **분리 유지**: H-B(가독성)와 H-A(채팅)는 파일만 공유하는 별개 원인 — 해법도 독립(가독성 수선이 채팅에 기여 zero, 역도 성립). 합치지 말 것.
- **분리 유지**: H-C(fixture/SSOT)는 양쪽 모두에 걸리는 직교 제약층.
- **설계 분기로 보존**: H-A 내부의 (i) in-tool BYO 채팅 vs (ii) close-and-reopen은 서로 다른 다음-프로브를 함의(스파이크 vs 계약 설계) — 가설로는 수렴했으나 설계로는 미결.

## 7. Most Likely Explanation

**기능이 없는 이유이자 구현을 지배하는 구조**: oh-my-pi extension SDK는 tool handler에 LLM-completion 심을 노출한 적이 없고(16.4.0·16.5.2 공통), select UI는 key-opaque다. 그러나 ① pi-ai 직접 호출(BYO-completion, 공식 예제 선례)과 ② ctx.ui.custom<T>(자체 컴포넌트) ③ 16.4.5의 askDialog(가독성 상위 표면)가 모두 존재하므로, 두 서브피처는 **호스트 변경 없이 lets-craft 코드로 구현 가능**하다. 가독성 병목은 호스트가 아니라 compact-mode 물리 제약과 lets-craft 자신의 텍스트 작성이며, 옵션-채팅은 선례 없는(novel) 조합이라 UX·컨텍스트 스코핑·fixture 표현을 이 파이프라인이 처음 설계해야 한다. 바인딩 제약은 fixture 스키마(closed 4-kind)와 SSOT 게이트 문법이다.

## 8. Critical Unknown

1. **(사실 — 유일 잔여 미검증)** 실제 omp 세션의 registered tool handler에서 `modelRegistry.resolver` 인증 + `completeSimple`/`stream` 라이브 호출이 성공하는가(429/OAuth 회전 포함). 타입·예제상 성립하나 통제 재현 없음.
2. **(설계 — 인터뷰行)** 사용자가 원하는 상호작용의 정확한 모양: in-tool 채팅(i) vs close-and-reopen(ii) vs 하이브리드; 설명 컨텍스트 스코핑(full-history vs question-only); 사이드챗 기록의 영속성(ephemeral vs 오케스트레이터 모델에게도 보고); SDK 16.4.5 범프 수용 여부; "가독성"의 실제 불만 지점.

## 9. Recommended Discriminating Probe

**20-30행 스로어웨이 omp extension 스파이크** (pre-craft는 구현하지 않음 — craft 초기 또는 plan 검증용으로 이월): 테스트 도구 하나를 등록해 execute에서 ① `ctx.models.resolve('smol')`+`modelRegistry.resolver(model, sessionId)`로 `completeSimple` 호출 → 텍스트 반환 확인, ② `stream()` iterator의 text_delta를 ctx.ui.custom 컴포넌트에 라이브 렌더 → done → `ctx.ui.select` 재호출 왕복 확인. 이 한 번의 실행이 Critical Unknown 1(P2b/P2c/pi-tui 서브클래스)을 동시에 티어 1로 격상시킨다.

## 10. Additional Trace Lanes

불요 — 잔여 불확실성은 낮고(§8의 1은 프로브로 해소 가능, 2는 인터뷰 소관), 레인 간 모순 없음.

---

# 레인별 서브리포트

## Lane 1 — Code-path (TracerCodePath, confidence: high)
- **가설**: 가독성 상한과 옵션-설명 부재는 lets-craft 자신의 코드 경로에 위치하며 거기서 수정 가능하다.
- **Evidence For**: 텍스트 합성 3사이트 전부 무변형(ask.ts:117, :295-310 [Recommended suffix :303 유일 변형], :75-85); while(true) 재렌더 루프 3개(:404-422, :433-458, :513-527)에 Other→editor→continue 체인 기존재; .describe() 계약(:572-598)이 유일한 코드-상주 prose 레버; 미사용 어포던스 helpText/outline/onLeft·onRight/promptStyle.
- **Evidence Against/Gaps**: 호스트 실렌더 미측정(타 레인 소관); ctx.sessionManager/memory의 generation 경로는 이름 기반 추정(→ wave 2에서 해소).
- **Evidence Strength**: Tier 2 (핀 SDK 타입 + 소스 + 테스트 고정 교차).
- **Critical Unknown**: ctx.* 잔여 표면의 generation 심 존재 여부 → **해소됨** (wave 1-2: 부재 확정).
- **Probe**: SDK 타입 전수 grep → 수행 완료.
- **핵심 판정**: 새 포트 메서드는 인터페이스+테스트 페이크+래퍼 3곳 동시 추가; generation 의존성은 래퍼 주입(승인 게이트 선례 :629-683)으로 pure-core 관례 유지 가능.

## Lane 2 — Fixture/SSOT contracts (TracerFixtureContracts, confidence: high)
- **가설**: 두 서브피처의 바인딩 제약은 fixture 시스템과 SSOT 계약층이다.
- **Evidence For**: closed 4-kind union(fixtures.ts:30-34)+unknown key 거부; unmatched→confirmation default→ask/select kind-mismatch isError(테스트 고정); proceed\??$ catch-all; envelope 헤더-only 파싱; destructive-action 규칙; AC9 2-계층 대응; description은 매칭 미참여(테스트 고정 fixtures.test.ts:874-880).
- **Evidence Against/Gaps**: "사이드챗이 CI를 깬다"는 강한 추론이지 통제 재현 아님(사이드챗 메커니즘 미존재); once 소비-순서 에러경로 테스트 미고정.
- **Evidence Strength**: Tier 2.
- **Critical Unknown**: 사이드챗이 기존 3도구를 재사용하는가, 새 채널인가 → 설계 결정(인터뷰行)으로 확정.
- **Probe**: /btw 구현 방식 확인(→ Lane 4가 수행: 별도 채널) — fixture 신규 kind 또는 fixture-mode 억제 양자택일 구도 확정.

## Lane 3 — Host capability premise audit (TracerHostCapability, confidence: high[P1a/P1b/P2a]·med[P2b/P2c])
- **가설**: 두 전제(가독성 낮음, in-tool 사이드챗 가능)는 호스트 SDK 표면이 지배하며 검증 대상이다.
- **판정**: P1a(호스트 렌더 불능) **REFUTED**; P1b(호스트가 나쁘게 그림) PARTIALLY — compact는 물리 제약; P1c(우리 텍스트가 문제) 진짜 레버로 특정; P2a(first-class 심 존재) **REFUTED**(16.4.0·16.5.2); P2b(BYO 경로) FEASIBLE(타입 검증); P2c(표시+복귀) FEASIBLE via custom<T> only.
- **Evidence Against/Gaps**: BYO는 host 계측(instrumentedCompleteSimple) 우회 — 무계측; 라이브 실행 미검증; pi-tui Component 안정성 → **해소됨**(W3: 안정 공개 표면).
- **Evidence Strength**: Tier 2 전반.
- **Probe**: in-tool completeSimple+custom+재select 스파이크 → §9로 채택.

## Lane 4 — /btw prior art (TracerBtwPriorArt, confidence: med)
- **가설 3종**: H1 대부분 이식 가능(스킨) / H2 핵심이 host-gated(리드) / H3 호출-맥락 불일치(근본 재정의 필요).
- **Evidence For(H2)**: runEphemeralTurn 전체 체인(agent-session.ts:15486-15573: no-tools buildSideRequestContext, :side: sessionId+동일 promptCacheKey, toolCall strip, 비영속) — extension 표면에 동등물 없음. 포터빌리티 테이블: 프롬프트 외피·패널 상태기계·렌더러·복사·키 처리 = 이식 가능; 스트림 소스·스냅샷·branch-to-chat = host 심 필요; AnchoredLiveContainer = 대체 필요(setWidget/custom).
- **Evidence Against**: askDialog {kind:'chat'}의 존재가 "심이 이미 있다" 반론 → main-loop 핸드오프(비-ephemeral)로 반박됨.
- **Evidence Strength**: Tier 2.
- **Critical Unknown**: runEphemeralTurn 동등물의 extension 노출 여부 → 부재 확정; 대안 축(BYO/createAgentSession/askDialog-chat) 특성화 완료.
- **Probe**: SDK grep + custom 스파이크 → §9에 병합.

## Lane 5 — UX/Value (TracerUxValue, confidence: med)
- **가설**: 성패는 배관보다 상호작용 설계(진입점·표시·복귀·기록)와 진짜 pain point 특정에 달렸다.
- **산출**: pain point 7항목(전부 Tier≤2 — 라이브 도그푸딩 증거 부재를 명시 플래그); UX 후보 5종 — D1 close-and-reopen / D2 per-option keybind expand / D3 post-pick follow-up / D4 bespoke widget(custom<T>) / D5 authoring-only; "높은 가독성"의 5개 구체 정의(잠긴 제약 하에서).
- **핵심 판정**: 가독성(정적·저비용·즉시)과 explain-chat(동적·고비용·상태 리스크)은 별개 문제 — **가독성 먼저**; explain-chat의 "like /btw" 프레이밍은 재정의 필요.
- **Evidence Against**: D4의 실현성은 Lane 5 시점에 미확인 → wave 2-3에서 성립 확정(BYO+custom+pi-tui). D1 "유일론"은 반박 라운드에서 강등.
- **Probe**: 인터뷰에서 사용자 pain point·상호작용 모양 확정 → Stage 2 주입.

---

# External Research Summary

전체 인용 트레일: `research/SYNTHESIS.md` (정본 원장: `research/claims.json`, 19클레임 전원 accepted; 웨이브 로그: `research/waves/wave-{1,2,3,4,5}.md` — wave 4·5는 인터뷰 중 사용자 추가 요구로 재개된 조사).

- **버전 경로 확정**: askDialog(옵션 preview/헤더/노트)는 16.4.5가 최초 published 버전(.d.ts 검증), 16.4.0→16.4.5 extension-API 파괴 zero, sibling 11종 exact-pin 락스텝 필수. 17.x는 loadMode default-flip + 17.0.0 registerTool 버그로 회피. askDialog는 docs 미기재 — 가드+폴백 필수.
- **BYO-completion 계약 확정**: completeSimple/stream 시그니처·SimpleStreamOptions 전 필드(onTextDelta 없음 — event iterator 소비)·에러 이원성(provider 에러=terminal AssistantMessage resolve, resolver 실패=reject)·OAuth 스티키(sessionId 일관 전달)·비공백 systemPrompt(Codex 400 가드). canonical 선례 = host completion-bridge.ts:122-178.
- **Bun/Node 경계**: pi-ai·pi-tui·coding-agent 런타임 값은 Node/Vitest에서 import 불가(TS 소스) — completion/TUI 어댑터는 Bun-로드 래퍼 심에 격리, pure core는 포트 주입(기존 statusbar 격리 관례).
- **UX 선례**: 옵션-바인드 LLM explain은 조사 범위 내 선례 부재(novel). 최근접 부분 사례 = pi-ask-user(정적 split-pane, ctrl+g 코멘트)와 /btw(LLM, host-global). 호스트의 제거된 로컬 "Chat about this" wiring(onChat→{kind:'chat'}→chatRedirect details)이 직접 설계 선례.
- **프로토콜 선례**: MCP sampling deprecated(shape 참조만); 리스크 완화 표준 = no-tools 강제+반복 상한+maxTokens+ephemeral 기본+명시적 승격; 컨텍스트 스코핑(full-history vs question-only)은 선례가 갈려 **설계 결정으로 이월**.
- **텍스트 스타일·크기 (wave-4, 인터뷰 중 추가)**: 커스텀 컴포넌트의 스타일 제어는 사실상 무제한 — host Theme 시맨틱 API + 임의 24-bit ANSI(파이프라인 보존, Bun 프로브 재현). 인라인 markdown 강조는 현행 select에서도 렌더됨. '글자 크기'는 pi-tui의 Kitty OSC 66 구현이 실존하나 생태계 지원이 kitty뿐(foot width만, Ghostty 파서만, 나머지 부재) — capability-gated 점진 강화로만 타당, 인터뷰에서 미채택 확정(R12).
- **프롬프트 캐시 (wave-4, 인터뷰 중 추가)**: 3단 판정 — ① 메인 턴 캐시 프리픽스 히트는 사실상 불가(provider-wire 바이트 동일성 + 호스트 비공개 변환·난독화 재현 필요), ② 사이드챗 자체 멀티턴 캐시는 가능(안정 promptCacheKey + 고유 side sessionId + 프리픽스 불변; Anthropic은 cacheRetention 마커 자동), ③ OpenAI/Codex 오염 방지용 고유 side sessionId 필수(/btw 선례 동일). 인터뷰에서 ②로 확정(R13).
- **SDK 최신 버전 (wave-5, 인터뷰 중 추가)**: 2026-07-20 기준 latest=17.0.5(이후 없음), askDialog API 표면은 16.4.5=17.0.5 동일(런타임 폴리시만: 전 옵션 인라인 markdown preview·스크롤 페이징·Space 버그 수정). askDialog는 key-opaque+로컬 chat 훅 부재로 in-question 채팅과 구조 충돌. pi 계열은 select가 여전히 string[] 전용이라 기여 없음. 인터뷰 결정(R15): 17.0.5 락스텝 범프 + 자체 컴포넌트 유지(loadMode 마이그레이션 포함).
