# SYNTHESIS — ask-tool-enhancement 외부 리서치 종합

작성: 2026-07-14, 수렴 후(웨이브 3회, 워커 14명). 소스 인덱스는 문서 말미. 관측 ID(O#)/클레임 ID(C#)는 observation-manifest.md / claim-graph.md 참조.

## 1. 요구사항과 현실의 간극 — 무엇이 진짜 gap인가

사용자 요구 4종: ① 모든 질문에 자유 답변 칸, ② 선택지 title/description 분리, ③ description에 제안 배경+장단점 상세 서술, ④ 쉬운 언어.

전제 감사 결과, gap은 "호스트 UI가 못해서"가 아니라 "lets-craft 래퍼가 안 해서"다 [Source 1]. omp SDK 16.4.0의 `ctx.ui.select`는 이미 `{label, description?}` 옵션 객체를 받고, TUI가 description을 muted 색·인라인 마크다운·자동 줄바꿈·ellipsis로 렌더링한다 [Source 1][Source 2]. 요구 ②③의 렌더링 통로는 완성돼 있다. lets-craft가 좁힌 지점은 정확히 3곳 — zod 스키마 `z.array(z.string())`, AskUI/SelectUI/ConfirmUI 포트 인터페이스, fixture의 `resolveSelectOption(scripted, options: string[])` — 이 3곳을 넓히면 된다 [Source 1].

반면 요구 ①(자유 답변 상시 제공)은 프리미티브가 없다. select는 `Promise<string | undefined>`(기존 라벨 또는 취소)만 반환하고, confirm은 boolean 전용이다 [Source 1][Source 2]. 이것은 omp만의 결함이 아니라 업계 보편이다: 조사한 모든 주요 CLI 프롬프트 라이브러리(inquirer select/clack/enquirer/terkelg)가 select 내 상시 자유입력을 제공하지 않고, inquirer 유지관리자는 core 지원을 명시적으로 거부했다 [Source 3]. 유일한 병존형 선행은 autocomplete 계열의 `suggestOnly:true`(Enter=입력 텍스트 확정, Tab=목록 선택)뿐이며 [Source 4], "순수 select + 상시 텍스트 필드"는 선행이 없다 [Source 4].

검증된 해법은 도구 레벨 조합이다: 옵션 목록 끝에 자유입력 진입 옵션을 붙이고, 선택 시 `ctx.ui.editor`(멀티라인 모달)로 체인한다. omp 하니스 자신의 내장 ask 도구가 정확히 이 패턴이다 — `OTHER_OPTION = "Other (type your own)"`을 항상 append(ask.ts:564)하고, 선택 시 editor를 열어(ask.ts:602) 그 텍스트를 `customInput`이라는 1급 결과 채널로 직렬화한다 [Source 5]. 공식 문서도 "the UI always appends Other (type your own), and callers must not include it"이라 명시한다 [Source 6]. Claude Code 공식 가이드 역시 동일 정책이다: "Display an additional 'Other' choice… **Use the user's custom text as the answer value (not the word 'Other')**" [Source 7].

## 2. 스키마 prior art — 3개 의미론 모델과 선택 기준

자유텍스트 처리에는 서로 다른 3개 의미론 모델이 실재한다 [Source 8]:

| 모델 | 대표 | 의미론 | 판정 |
|---|---|---|---|
| **A. Other = 답값 치환** | Claude Code, omp 벤더 ask | Other 선택 → 사용자가 입력한 텍스트가 곧 답변 값. customInput이 selectedOptions와 병렬 직렬화 | **채택 기준선** — omp 프리미티브와 동형, 요구 ①에 정확 부합 |
| B. custom 강제 병존 | opencode question | custom 필드가 모델 대면 스키마에서 제거되고 시스템이 항상 true 강제(2026-01 커밋) — 에이전트가 자유입력을 끌 수 없음 | 정책으로 차용 가치(자유입력을 옵션이 아닌 불변식으로) |
| C. 거부 옵션 + notes 채널 | codex request_user_input | is_other(질문 단위 bool)는 "None of the above" 거부 옵션만 추가, 자유텍스트는 별도 상시 notes 채널("user_note: …") | 미채택 — 모델 혼동 시 직렬화 버그 원인. 단 '선택지 거부'와 '자유 보충'의 구분이라는 통찰은 유효 |

gemini-cli의 질문 타입 분리(choice|text|yesno)는 한 질문에서 선택지와 자유입력의 병존을 구조적으로 막아 요구 ①과 정면 충돌하는 안티패턴이다 [Source 8]. cline/roo-code의 description 없는 평문 suggestion은 요구 ③의 반면교사다 [Source 8]. MCP elicitation은 enum/enumNames 평행배열이라 per-option description을 전달할 수 없다 — 외부 프로토콜 경계 제약으로 기록 [Source 8]. 요구 ①~④를 동시에 만족하는 선행 하니스는 없다 [Source 8].

스키마 세부 prior art: Claude Code는 questions[1-4] {question, header≤12자, options[2-4]{label, description}, multiSelect}, 회신은 {answers: Record<질문, 라벨>, response?: 자유텍스트} 이원 구조이고 2026-07 현재 안정적이다(preview는 TS 전용 opt-in) [Source 7][Source 9]. codex 지침은 "2-4개의 상호배타적 옵션 + 추천 기본값"을 요구한다 [Source 8]. opencode는 label을 "1-5 단어"로, description을 필수로 스키마 annotation에 박아 모델에게 직접 가르친다 [Source 8] — 스키마 annotation + 시스템 프롬프트 가이드의 2계층이 description 품질을 만든다는 것이 업계 수렴이다.

## 3. 벤더 참조구현의 엣지 시맨틱 — 차용할 것과 피할 것

omp 벤더 ask 도구에서 확인된 세부 [Source 5][Source 10]:
- **차용**: editor Esc는 질문 취소가 아니라 select 복귀(continue) — 자유입력을 잘못 눌러도 안전. 질문 취소는 select 자체 Esc(→ ToolAbortError)만.
- **차용**: recommended는 " (Recommended)" 접미사를 표시에만 붙였다가 직렬화 전 strip하는 원자 패턴(stripRecommendedSuffix) — 어기면 "JWT (Recommended)"가 답변 문자열로 오염된다.
- **차용**: 결과 텍스트 계약 — "User selected: <a>, <b>" / "User provided custom input: <text>"(멀티라인은 들여쓰기) / 혼합 시 두 줄 병기.
- **회피**: 다중질문 포매터가 customInput을 최우선 반환해 multi-select의 checked 옵션을 누락하는 비대칭 결함(ask.ts:630-632). lets-craft는 단일 질문 도구라 직접 해당 없지만, 혼합 응답 직렬화 시 두 채널 병기 원칙을 지켜야 한다.
- **참고**: ui.confirm은 ['Yes','No'] 2-옵션 셀렉터의 설탕(dialogOptions 무시) [Source 2] — lsc_confirm에 자유답변을 붙이려면 confirm 프리미티브로는 불가능하고 select 기반 재구성이 필요하다는 구조적 근거.
- **함정**: ui.input의 placeholder는 interactive TUI에서 렌더링되지 않는 dead param [Source 2] — 현 lsc_ask의 placeholder 의존 설계는 무의미하며, 힌트는 title(마크다운 렌더링됨) 또는 editor prefill로 옮겨야 한다.

## 4. lets-craft 내부 제약 — co-evolution 없이는 깨진다

자유답변 추가는 additive가 아니다. 정확 라벨 분기에 의존하는 소비자가 실재한다: post-craft의 [Spec Change]/[Plan Change] disposition 게이트(3옵션 정확 분기, fallback 없음 — 이전 craft에서 실사용 전례), pre-craft [Consensus Escalation](3옵션), fixture resolveSelectOption(매칭 실패=hard error), parseYesNo(비인식=에러) [Source 11]. 스킬 3종의 SKILL.md에 옵션 배열이 리터럴로 하드코딩되어 있어 스키마 변경은 스킬 문서 동시 개정을 수반한다 [Source 11].

fixture는 오늘도 잠재 결함 상태다: `proceed\??$`→"yes" catch-all과 default "yes"는 lsc_confirm에는 유효하지만 lsc_select 게이트에서는 resolveSelectOption('yes', 다중단어 옵션)=undefined로 hard error가 난다(Tier-1 제어 실험 + answers.json 직독으로 확정 — optionIndex 규칙 0개) [Source 11]. 현 E2E가 통과하는 이유는 fixture 경로에서 select 게이트가 발화하지 않기 때문일 뿐이다. 이번 기능의 fixture 스키마 진화(자유답변 표현 수단 포함)는 이 잠재 결함의 해소 기회다.

안전한 것: fixture의 질문 매칭 자체는 태그 prefix 기반이라 옵션 스키마와 무관하다 [Source 11]. 파괴되는 것은 응답 해석 단계뿐이다. 또한 fixture 모드는 ctx.ui를 경유하지 않으므로 RPC 백엔드의 description 평탄화(rpc-mode.ts:626)는 lets-craft 실사용 경로(interactive TUI + fixture)에 영향 없다 [Source 1].

매칭 규율: options가 객체가 되면 매칭은 라벨로 수렴해야 하고 description은 표시 전용으로 매칭에 절대 참여하면 안 된다 — 상세 서술된 description이 whole-word containment 티어에 노이즈를 넣기 때문 [Source 5].

## 5. description 작성 규칙 — 인코딩 가능한 형태로

영어 plain-language 15항목 + 한국어 고유 10항목이 확보됐고, 요구 ③의 구조는 외부 권위와 정확히 합치한다 [Source 12][Source 13]:

**구조**: description = [WHAT: 이 옵션이 무엇인지 한 문장] + [WHY: 왜 이 선택지가 제안됐는지 배경] + [장점: / 단점: 명시 라벨로 둘 다] — 설명가능 추천 연구(투명성·신뢰·결정 품질)와 균형 프레이밍(설문 설계, framing effect 회피)이 근거 [Source 12].

**균형·중립**: 장단점 동등 무게·병렬 구조, 감정어/유도어 금지, 정답 암시 금지. 단 countersearch가 확인한 단서 — 인지 과부하는 비중복 정보량×옵션 수의 곱이므로 파트당 1-2줄 상한이 필요하고, 추천 기본값+간결 균형 설명 조합이 장황한 설명 단독보다 우수할 수 있다 [Source 14].

**쉬운 언어(한국어)**: 국어기본법 제14조(알기 쉬운 용어·문장) 연장선에서 — 한자어/일본어투/외래어 순화(향후→앞으로, 제고→높이다), 한자식 어미(~적인/~하에/~시) 회피, 명사형 종결(~함/~음) 대신 서술식 완결 문장, 한 문장 50자 이내, 능동태·행위 주체 명시, 시스템(공급자)이 아닌 사용자 입장 단어, 전문용어는 버리지 말고 괄호 원어/일상어 인라인 정의(예: "craft(코드를 짜는 단계)"), 경어체 톤 통일 [Source 13]. 요구 ④("프로젝트를 깊게 이해해야 알 수 있는 단어 금지")는 이 체계에서 "비전문가 첫 읽기 기준 + 인라인 용어 정의"로 조작화된다.

**전달 계층**: 이 규칙들은 코드가 강제할 수 없다 — LLM이 옵션을 작성하므로, 스키마 annotation(zod .describe)과 도구 description + SKILL.md 가이드의 2계층으로 인코딩해야 한다는 것이 opencode/codex의 수렴된 관행이다 [Source 8].

## 6. 설계로 넘기는 결정 항목 (리서치 종결, plan 소유)

1. 자유입력 진입 방식: Other형 trailing 옵션 → editor 체인(검증된 길, 권장 기준선) vs custom<T>() bespoke 컴포넌트(선행 없음, 구현·유지 비용) — [Source 1][Source 4].
2. lsc_select 반환 계약: 라벨 문자열 유지 + 자유답변 시 텍스트 치환(모델 A) vs {selection, freeText} 구조체 — 소비자(스킬 분기·fixture) co-evolution 범위가 갈림 [Source 8][Source 11].
3. lsc_confirm의 자유답변: select 기반 재구성(Yes/No/직접 입력) vs confirm 유지+별도 경로 — C8이 구조 근거 [Source 2].
4. 옵션 수 상한(Claude Code 2-4, opencode 관행) 도입 여부 [Source 7][Source 8].
5. recommended(추천 표시) 도입 여부 — 도입 시 append-then-strip 필수 [Source 5][Source 14].
6. 경어체 톤(합쇼체/해요체) — 제품 톤 결정 [Source 13].
7. fixture 스키마 확장 형태(자유답변 표현 + select 게이트 잠재 결함 해소) [Source 11].

---

## Source Index

- [Source 1] 코드 관측 O1-O9, O17-O20 (TracerCodePath/TracerPremise): node_modules/@oh-my-pi/pi-coding-agent@16.4.0 types.ts:109-114,186-190,248-253; src/ask.ts; rpc-mode.ts:626. claim-graph C1-C4, C9.
- [Source 2] 코드 관측 O21-O28 (ExploreUiApi): hook-selector.ts:163-383,491-551; hook-input.ts:16-78; extension-ui-controller.ts:597-678. claim-graph C1, C2, C7, C8, C16.
- [Source 3] LibPromptLibs: @inquirer/select README/src, clack select.ts/limit-options.ts, enquirer select.js/roles.js, terkelg select.js, inquirer issue #1198/#261/#214. claim-graph C12(원), C13.
- [Source 4] CounterSearchUx: inquirer-autocomplete-prompt README(suggestOnly), @inquirer/search README, InquirerPy fuzzy docs, terkelg PR #405(미병합), dialoguer FuzzySelect docs, fzf discussion #4536, react-select Creatable. claim-graph C12(정정).
- [Source 5] ExploreAskTool + ExploreOtherFlow: oh-my-pi/packages/coding-agent/src/tools/ask.ts:43-62,103-111,136-144,471-481,518-643,753-905; prompts/tools/ask.md. 관측 O29-O32, O55-O58. claim-graph C3, C17.
- [Source 6] oh-my-pi/docs/tools/ask.md:25,61 (공식 도구 문서).
- [Source 7] LibClaudeCode: code.claude.com/docs/en/agent-sdk/typescript §AskUserQuestion(Input/Output), agent-sdk/user-input(Question format/Response format/Support free-text input/Question limits), 공식 changelog v2.0.21-v2.1.208. 관측 O36-O40. claim-graph C10, C11.
- [Source 8] LibRepoDive: openai/codex codex-rs/protocol/src/request_user_input.rs + collaboration-mode-templates/plan.md; sst/opencode packages/schema/src/v1/question.ts + tool/question.ts; RooCodeInc/Roo-Code AskFollowupQuestionTool.ts; google-gemini/gemini-cli ask-user.ts; modelcontextprotocol.io/specification/2025-06-18/client/elicitation. 관측 O47-O52. claim-graph C15.
- [Source 9] CounterSearchSchema (C10 축): code.claude.com/docs/en/agent-sdk/user-input(2026-07 현행, preview=TS-only opt-in), github.com/anthropics/claude-agent-sdk-python#327, github.com/anthropics/claude-code#20275, kirmad/askuserquestion.
- [Source 10] CounterSearchSchema (C15 축): codex-rs/app-server/README.md, codex-rs/tui/src/bottom_pane/request_user_input/mod.rs(OTHER_OPTION_LABEL="None of the above", user_note 직렬화, 테스트), opencode 커밋 0187b6bb72(2026-01-13)·3591372c4(#9201), opencode.ai/docs/tools.
- [Source 11] TracerOrchestration + TracerPremise + 메인 세션 직독: skills/{pre-craft,craft,post-craft}/SKILL.md 옵션 리터럴·태그 규약, fixtures/sample-ts-cli/answers.json(직독), src/fixtures.ts:18-104, resolveSelectOption Tier-1 실험, README.md:263-278, .lsc/crafts/model-preset-session-default/spec.md:182·plan.md:389. 관측 O10-O19, O33-O35, O53-O54. claim-graph C5, C6, C18.
- [Source 12] LibPlainLanguage: plainlanguage.gov(연방 지침), OPM, CDC health-literacy, GOV.UK content design/Design System radios, digital.gov, NN/g progressive disclosure·decisions report, Tintarev&Masthoff(RecSys 2007/Springer), Kantar/InMoment/Delighted/Attest(설문 균형), BehavioralEconomics.com(framing). 관측 O45-O46. claim-graph C14.
- [Source 13] LibKoreanPlain + CounterSearchSchema(PDF 확보): 국어기본법 제14조(law.go.kr lsiSeq=192465)·시행령 제11조, 국립국어원 공공언어 바로 쓰기(etc_seq=699)·쉬운 공문서 쓰기 길잡이(etc_seq=700, /tmp/gongmun.pdf)·알기 쉬운 행정용어(etc_seq=638), 서울시 국어 사용 조례 제13조(urimal.org/3302 인용), 행정안전부 2018 추진계획, 국립국어원 온라인가나다(경어체). 관측 O59.
- [Source 14] CounterSearchUx (C14 축): Chernev et al. 2015(choice overload 메타), Fasolo et al. 2009, Lee&Lee 2004(정보 과부하), Johnson&Goldstein(defaults), Jachimowicz et al. 2019(default 메타), Dinner et al. 2011(default×description 상보).
