# Observation Manifest — ask-tool-enhancement (worker-attributed raw findings)

기준 환경: repo HEAD c39a725 (feat/lets-craft-v1), SDK @oh-my-pi/pi-coding-agent **16.4.0** (node_modules, 컴파일/런타임 권위), 벤더 소스 oh-my-pi/ = 16.3.15 (구형, 대조용). 조사일 2026-07-14.

## TracerCodePath (Lane 1: code-path)
- [O1] SDK select 프리미티브가 옵션 객체를 네이티브 수용: `ExtensionUISelectItem = string | ExtensionUISelectOption`, `ExtensionUISelectOption = { label: string; description?: string }` (node_modules .../extensibility/extensions/types.ts:109-114), `select(title, options: ExtensionUISelectItem[], dialogOptions?)` (types.ts:186-190). Tier-2.
- [O2] 인터랙티브 셀렉터가 description을 렌더링: hook-selector.ts:329-339 — muted 색, 인라인 마크다운, 멀티라인 wrap. Tier-2.
- [O3] SDK 내장 ask 도구가 요구 기능의 참조구현: OTHER_OPTION='Other (type your own)' (tools/ask.ts:111), toSelectOption (103-105), CustomInputContext {selectionMarker, checkedIndices, markableCount} (149-153). Tier-1~2.
- [O4] ExtensionUIDialogOptions.markableCount 주석이 trailing 'Other'/'Done' 제어행 패턴을 공식 지원 명시 (types.ts:151-154). Tier-2.
- [O5] 플러그인의 좁힘은 정확히 3곳: (a) zod 스키마 `z.array(z.string()).min(2)` (src/ask.ts:271), (b) AskUI/SelectUI/ConfirmUI 포트 인터페이스 (ask.ts:46-48, 84-86, 186-188), (c) resolveSelectOption(scripted, options: string[]) 4-tier 매칭 (ask.ts:120-134). Tier-2.
- [O6] RPC/print/ACP 백엔드는 description을 라벨로 축소: rpc-mode.ts:626 `options.map(getExtensionUISelectOptionLabel)`, acp/acp-agent.ts:381 동일 — 비인터랙티브 프론트엔드에선 description 소실. Tier-2.
- [O7] select 반환은 `Promise<string | undefined>` (선택 라벨 또는 취소) — 옵션+자유텍스트 동시 반환 프리미티브 없음. confirm은 `Promise<boolean>`뿐. Tier-2.
- [O8] fixture 데이터모델: FixtureAnswerRule.response는 string (fixtures.ts:22), optionIndex가 유일한 비텍스트 탈출구 (ask.ts:131). title/description 표현 수단 없음. Tier-2.
- [O9] 기존 단위 테스트: test/ask.test.ts:94-234 (performSelect 8개 + resolveSelectOption 10개). Tier-3.

## TracerOrchestration (Lane 2: orchestration)
- [O10] lsc_select 옵션 배열이 SKILL.md에 리터럴로 하드코딩: pre-craft:283 ["Proceed with current version", "Give additional guidance and continue iterating", "Abort pre-craft"], post-craft:165 ["Accept — apply to spec.md/plan.md", "Reject — do not apply", "Defer — revisit in a later audit cycle"], post-craft:65 (동적 git branch 목록). Tier-2.
- [O11] **Tier-1 제어 실험**: resolveSelectOption({response:'yes'}, [Consensus Escalation 3옵션]) = **undefined** → fixture의 `proceed\??$`→"yes" 규칙과 default "yes"는 lsc_confirm 게이트에만 유효, lsc_select 게이트에서는 hard error. 옵션 스키마 변경 *이전부터* 잠재 결함.
- [O12] 메인 세션이 answers.json 직접 확인(2026-07-14): optionIndex 규칙 0개, select 전용 규칙 0개 — O11의 잠재 결함이 현 fixture에 실재. 단 fixture 경로에서 select 게이트가 도달 회피 중일 가능성(consensus가 cap 내 수렴, APPROVE-family 판정 시 [Spec Change] 미발화) — pre-craft/SKILL.md:39-40 기반 추론(Tier-4).
- [O13] E2E는 질문/답변 형태를 직접 assert하지 않음(e2e-full-cycle.test.ts:108-315는 산출물 존재/순서/커밋 위상/판정 라인만) — 스키마 변경의 E2E 영향은 간접적(fixture 매칭 실패 → 파이프라인 중단). Tier-2(부재 관측).
- [O14] 태그 prefix regex 매칭(matchesRule, fixtures.ts:53-59)은 question 문자열만 검사 — 옵션 스키마와 무관하게 안전. 응답 해석 단계만 파괴됨. Tier-2.
- [O15] README.md:263-278이 answers.json 스키마를 공식 계약으로 문서화(response 매칭 티어, optionIndex 탈출구) — 스키마 변경 시 동시 개정 대상. Tier-2.
- [O16] 이전 craft에서 [Spec Change]/[Plan Change] lsc_select 실사용 전례(.lsc/crafts/model-preset-session-default/spec.md:182, plan.md:389). Tier-2.

## TracerPremise (Lane 3: premise audit)
- [O17] 전제 1 검증: lsc_select/lsc_confirm에 자유 답변 경로 진짜 없음 — 취소(Esc)는 isError 결과(ask.ts:170-172), confirm은 boolean 전용(ask.ts:227). "자유 답변 칸 부재"는 lets-craft 래퍼에 대해 참. Tier-2.
- [O18] 전제 2 검증: 호스트는 이미 지원 — description은 타입→wire→TUI 전 스택 통과(extension-ui-controller.ts:37-45 → wire/index.ts:301 → select-list.ts:26-27). 'Other' escape는 프리미티브가 아닌 도구 레벨 조합(ask.ts:564 append → :602 editor 체인). 공식 문서 교차 검증: oh-my-pi/docs/tools/ask.md:25 "the UI always appends Other (type your own), and callers must not include it". **gap은 '호스트가 못해서'가 아니라 'lets-craft가 안 해서'**. Tier-2.
- [O19] 전제 3 소비자 감사 (6개): HIGH 2개 — post-craft disposition 게이트(SKILL.md:163-174, fallback 없는 정확 라벨 분기), pre-craft [Consensus Escalation](:281-283, 동일). MEDIUM 2개 — resolveSelectOption(매칭 실패 시 hard error), parseYesNo(비인식 → 에러). LOW 1개 — 브랜치 선택(본질적 enumerable). LOW-MEDIUM 1개 — 인터뷰(lsc_ask 패턴 기존재). **결론: 자유답변 추가는 additive가 아니라 최소 4개 소비자의 계약 변경 수반**. Tier-2.
- [O20] SDK에 ctx.ui.editor(title, prefill?, dialogOptions?, editorOptions?) 존재(types.ts:248-253) — 호스트 ask 도구가 Other 입력에 실사용(ask.ts:527,602). Tier-2.

## ExploreUiApi (research: SDK/벤더 UI 표면)
- [O21] ExtensionUIContext 전 표면 = 필드 1 + 메서드 24 + readonly 1 (types.ts:182-291): select/confirm/input/notify/editor/custom<T>/setWidget/setHeader/setFooter/setEditorText/pasteToEditor/getEditorText/addAutocompleteProvider/setEditorComponent/theme 계열/onTerminalInput/setStatus/setWorkingMessage/setTitle/getToolsExpanded/setToolsExpanded. Tier-2.
- [O22] select 렌더링 실체(HookSelectorComponent, hook-selector.ts:163): description은 label 아래 4-스페이스 들여쓰기 muted, renderInlineMarkdown 적용(326,333,377), wrapTextWithAnsi로 bodyWidth(innerWidth-4) 자동 줄바꿈, maxRows 초과 시 ellipsis(366-383). Tier-2.
- [O23] **compact 모드**: 전체 리스트(모든 description 포함)가 maxVisible(4~15행, terminal.rows-12 기반; extension-ui-controller.ts:604)을 초과하면 모든 옵션 label-only로 축소되고 커서 옵션의 description만 남은 행 예산만큼 표시(491-551). → 긴 description × 많은 옵션 = 커서 올려야만 보임. Tier-2.
- [O24] fuzzyFilter가 label+description 모두 매칭(613-617). Tier-2.
- [O25] **ui.input의 placeholder는 interactive TUI에서 dead param**: HookInputComponent 생성자 `_placeholder` (hook-input.ts:25-26, 미사용), pi-tui Input에 placeholder 개념 없음. 타입에는 존재하나 렌더링 안 됨. Tier-2. → 현 lsc_ask의 placeholder 파라미터는 TUI에서 무의미.
- [O26] **ui.confirm은 2-옵션 셀렉터의 설탕**: showHookConfirm(controller:662) → showHookSelector(`${title}\n${message}`, ['Yes','No']), dialogOptions 무시(controller:66 `_dialogOptions`). Tier-2.
- [O27] ui.custom<T>((tui, theme, keybindings, done) => Component) — 임의 bespoke UI 통로(types.ts:223-231). ui.editor = 멀티라인 모달(prefill 지원). Tier-2.
- [O28] 버전 드리프트: node_modules=16.4.0 vs 벤더=16.3.15(구형), 차이는 timeout API(timeoutStartsOnPresentation/onTimeoutStart/onTimeoutReset 16.4.0 추가)에 한정, select 렌더링 동작 동일. Tier-2.

## ExploreAskTool (research: 벤더 ask 도구)
- [O29] 스키마 정정: 벤더 16.3.15 ask의 옵션은 {label, description?} — **preview 필드 없음, header 필드 없음**(그건 별개 신형 하니스), question 필드는 id/question/options/multi?/recommended? (ask.ts:46-62). 루트는 questions[] (min 1) — 한 호출에 복수 질문 배치. Tier-2.
- [O30] recommended는 " (Recommended)" 표시 접미사를 붙였다가 직렬화 전에 strip(stripRecommendedSuffix, ask.ts:144) — append-then-strip 원자 패턴 필수(안 지키면 "JWT (Recommended)"가 답변 문자열로 오염). Tier-2.
- [O31] 자유텍스트는 escape가 아니라 1급 결과 채널: customInput이 selectedOptions와 병렬로 흐르고 독립 직렬화 — 어느 쪽이든 채워지면 유효 답변. Tier-2.
- [O32] AskTool 자체는 builtin/hardwired(tools/index.ts:453, renderers.ts:81) — 확장이 도구로 재사용 불가. 재사용 가능한 것은 UI 계층(ctx.ui.select + editor). `./tools/*` subpath export는 존재하나 비공식/비semver. Tier-2.

## ExploreConsumers (research: lets-craft 소비자 인벤토리)
- [O33] ask seam 호출은 스킬 3종 SKILL.md 지시에서만 발생 — src/craft/*.ts 코드는 lsc_ask/select/confirm을 직접 호출하지 않음. abort.ts/release.ts/hash-manifest.ts는 "사전 lsc_confirm 승인" 계약 의존만(도구 코드가 질문을 발화하지 않음). enforcement.ts는 ask 참조 0건. Tier-2.
- [O34] fixture 매칭은 질문 태그 prefix에 anchoring — 옵션 내용과 무관(로드베어링). Tier-2.
- [O35] 3개 도구 전부 approval:"read"로 등록(src/ask.ts:255-300). Tier-2.

## LibClaudeCode (web: Claude Code prior art)
- [O36] 공식 스키마(code.claude.com/docs agent-sdk/typescript): AskUserQuestionInput = questions[1-4]: {question, header(≤12자), options[2-4]: {label, description, preview?}, multiSelect}. CONFIRMED(공식 문서 2절).
- [O37] 공식 회신 구조: AskUserQuestionOutput = {answers: Record<questionText, label>, response?: string} — response는 사용자가 구조화 답변 대신 자유 텍스트를 입력했을 때 설정, 모델은 "The user responded: …" 수신. CONFIRMED(공식).
- [O38] 공식 가이드: "Display an additional 'Other' choice after Claude's options that accepts text input. **Use the user's custom text as the answer value (not the word 'Other')**." CONFIRMED(공식).
- [O39] 모델-대면 작성 지침(하니스 미러 ask.md): "Use short option labels; put explanatory tradeoffs in description instead of merging them into the label" + "Do NOT include 'Other' option — UI automatically adds it". single-source(공식 원문 비공개, GitHub issue #10346로 확인된 문서 공백 — 하니스 미러를 대리 증거로 채택).
- [O40] 운영 연혁: v2.0.21 도입 → v2.1.9 Other 입력에 외부 에디터(Ctrl+G) → v2.1.200 auto-continue 기본 해제 → multi-select에서 Other 자유텍스트 유실 버그 수정 이력 existed. CONFIRMED(공식 changelog).

## LibPromptLibs (web: CLI 프롬프트 라이브러리)
- [O41] per-choice description 네이티브 지원은 4개 중 2개뿐: @inquirer/select(name+description, on-focus 하단, **자동 wrap 없음**), prompts/terkelg(title+description, on-focus 인라인, **자동 wrap 있음** margin 3). clack(hint만, active시 괄호), enquirer(hint 항상 인라인, description 없음). CONFIRMED(각 소스 직독).
- [O42] **어떤 주요 라이브러리도 select 내 상시 자유텍스트 입력을 제공하지 않음**. 보편 관례 = 'Other...' choice + 조건부 input follow-up (2단계). inquirer 유지관리자가 core 지원 명시 거부(issue #1198). enquirer의 editable/input role은 throw(미구현). CONFIRMED.
- [O43] 렌더 함정: 긴 choice 줄의 스크롤 점프/ghost line(inquirer #261), wrap 미처리 아티팩트(#214, #304). 완화책 = terkelg의 wrap(margin) 또는 clack의 wrapAnsi({hard}) + 슬라이딩 윈도우(최소 5행, rows 기반 클램프). CONFIRMED.
- [O44] 트레이드오프: 상세 per-choice description ↔ 한 화면 스캔성은 본질 충돌 — on-focus 하단 표시가 균형점(단 wrap 처리 전제). — omp의 compact 모드(O23)와 동형.

## LibPlainLanguage (web: 쉬운 언어 작성 규칙)
- [O45] 15항목 인코딩 가능 체크리스트 확보(출처: PLG/OPM/CDC/GOV.UK/NN-g/Tintarev&Masthoff/설문설계). 핵심 구조: description = [WHAT 한 문장] + [WHY 제안 배경] + [장점:/단점: 명시 라벨 병기] — 균형 프레이밍(비대칭 감정어 금지), 한 문장 한 생각(평균 ≤20단어), 전문용어 인라인 정의(용어 자체는 유지 가능), 정답 암시 금지(사전선택 금지), title은 description 없이도 자명, 공개 깊이 2단계 이내. CONFIRMED(규칙별 1차 2+소스, F2만 single-source).
- [O46] Tintarev&Masthoff: 설명이 설득으로 기울면 trust calibration error — 중립성 규칙(E1/E3)은 장단점 병기(D3)와 한 세트로만 균형 성립. CONFIRMED(학술 1차).

## LibRepoDive (web: 타 하니스 스키마)
- [O47] codex request_user_input(권위 Rust 소스): {id, header, question, is_other: bool, is_secret: bool, options?: [{label: String, description: String}]} → answers: HashMap<id, {answers: Vec<String>}>. 지침: "2-4 mutually exclusive options + a recommended default". CONFIRMED(소스 직독).
- [O48] opencode question 도구: Option {label(1-5 words annotate), description(필수, 'Explanation of choice' annotate)}, Info {question, header(≤30), options, multiple?, custom?: bool **default true** — 모델에 custom 미노출, 항상 자유입력 병존}. 회신: `User has answered your questions: "q"="answers"`. CONFIRMED(소스 직독).
- [O49] roo-code/cline: follow_up suggestion = plain string(+mode), description 없음, 자유입력 항상 허용(<user_message> 래핑) — description 부재로 인지 부하 문제(반면교사). roo-code CONFIRMED, cline single-source.
- [O50] gemini-cli: QuestionType CHOICE/TEXT/YESNO 분리 — CHOICE는 options 2-4(label+description 필수)이나 한 질문에 선택+자유입력 병존 불가 → lets-craft 요구 (1)과 충돌하는 안티패턴. CONFIRMED(소스 직독).
- [O51] MCP elicitation(2025-06-18 스펙): requestedSchema는 flat primitive + enum/enumNames 평행배열 — per-option description 표현 불가. 외부 프로토콜 경계 제약으로 기록. CONFIRMED(스펙 원문).
- [O52] 요구 4종(①자유입력 상시 ②title/desc 분리 ③상세 서술 ④쉬운 언어)을 모두 만족하는 선행 하니스는 없음 — 최근접 codex+opencode 조합(①②③), ④는 어디서도 스키마가 아닌 프롬프트/가이드 계층. CONFIRMED(비교 조사 종합).

## 메인 세션 직접 관측
- [O53] answers.json(fixtures/sample-ts-cli) 직독: 규칙 6개 전부 response 문자열형, optionIndex 사용 0건, select 게이트 전용 규칙 0건, default "yes" + `proceed\??$`→"yes" — O11의 실험 결과와 결합 시 select 게이트 잠재 결함 실재 확정.
- [O54] 이전 craft(model-preset-session-default) spec/plan에서 ctx.ui.notify 사용 관례 + [Spec Change]/[Plan Change] disposition의 lsc_select 실사용 확인 — O16과 동일 소스.

## ExploreOtherFlow (wave 2: 벤더 Other-flow 엣지)
- [O55] editor Esc는 select 다이얼로그 복귀(continue) — 질문 전체 취소 아님(ask.ts:537-538 multi, 606-607 single). 질문 취소는 select 자체 Esc(choice===undefined)만 → ToolAbortError('Ask tool was cancelled by the user', ask.ts:811-814). Tier-2.
- [O56] multi: Other 입력이 checked 옵션과 병존(selected Set 보존, ask.ts:540-541,555 → selectedOptions+customInput 공존). single: customInput 시 selectedOptions=[] 클리어(ask.ts:609-611). 단일질문 포맷은 둘 다 표시(ask.ts:825-839); **다중질문 포매터 formatQuestionResult는 customInput 최우선 반환으로 checked 옵션 누락(ask.ts:630-632) — 벤더 비대칭 결함, lets-craft가 복제하면 안 됨**. Tier-2.
- [O57] timeout 자동선택: hook-selector가 만료 시 현재 하이라이트 옵션 resolve(disabled면 cancel; hook-selector.ts:236-249), ask 폴백 getAutoSelectionOnTimeout은 recommended→options[0], 항상 1개(ask.ts:136-143). 직렬화 "(auto-selected after timeout)" + details.timedOut(ask.ts:829,634-637). initialIndex=recommended(ask.ts:566). Tier-2.
- [O58] 결과 텍스트 계약(단일질문): "User selected: <a>, <b>" / "User provided custom input: <text>"(멀티라인은 개행+2-스페이스 들여쓰기, ask.ts:833-838) / 혼합 시 두 줄 병기(ask.ts:825-843). 다중질문: "User answers:\n<id>: ..."(ask.ts:901-905). Tier-2.

## LibKoreanPlain (wave 2: 한국어 쉬운 언어)
- [O59] 한국어 고유 작성 규칙 10항목 + 법·제도 근거: 국어기본법 제14조(알기 쉬운 용어·문장, 한글 작성)·시행령 제11조(전문어·신조어만 괄호 원어 병기), 국립국어원 공공언어 바로 쓰기 6대 원칙(간결·문장 길이·조사어미·피동 자제·한자식 표현(~적인/~하에/~시) 삼가·일본식 표현 자제), 명사형 종결(~함/~음/~임) 회피 → 서술식, 순화 대체표(조속히→빨리, 향후→앞으로, 제고→높이다 등), 서울시 조례 3원칙(일상어·외래어 회피·사용자 입장), 한 문장 50자 이내(보조 출처), 경어체 통일(합쇼체/해요체 — 권장 주체는 미확정, 제품 톤 결정 사항). 대부분 CONFIRMED, 1차 PDF 본문 미확보 caveat. Tier(웹): 1차 법령 + 기관 교차.
