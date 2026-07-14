# Trace — ask-tool-enhancement

- Feature: lets-craft 플러그인 ask 도구 3종(lsc_ask/lsc_select/lsc_confirm) 고도화 — ① 모든 질문에 자유 답변 칸, ② 선택지 title/description 분리, ③ description에 제안 배경+장단점 상세 서술, ④ 쉬운 언어(프로젝트 깊은 이해 불요).
- 분류: **Brownfield** (근거: src/ask.ts 303행 구현 실재, 요청이 이를 직접 확장. Stage 2는 이 분류를 재사용할 것).
- 환경 고정: repo c39a725(feat/lets-craft-v1), SDK @oh-my-pi/pi-coding-agent **16.4.0**(node_modules 권위), 벤더 oh-my-pi/=16.3.15(대조용), 조사일 2026-07-14.
- 근거 세부: 관측 O1-O59 = `research/observation-manifest.md`, 클레임 C1-C18 = `research/claim-graph.md`.

## 1. Observed Result

현재 구현(src/ask.ts)은:
- lsc_select의 options가 `z.array(z.string()).min(2)` — title/description 분리 불가(ask.ts:271).
- 세 도구 모두 자유 답변 경로 없음: select는 제시 라벨 또는 취소(=isError)만, confirm은 yes/no만(parseYesNo 비인식 시 에러), 취소는 답변이 아니라 에러다(ask.ts:170-172, 191-196, 227).
- lsc_ask만 자유 텍스트이며, placeholder 파라미터는 interactive TUI에서 렌더링되지 않는 dead param(O25).
- fixture 모드(answers.json)는 response 단일 문자열 + optionIndex 탈출구뿐 — 자유답변/옵션 객체 표현 수단 없음(O8, O53).

사용자 요구 4종은 이 상태와의 간극이다. 단, 간극의 성질이 요구마다 다르다는 것이 본 trace의 핵심 결과다(아래).

## 2. Ranked Hypotheses

| 순위 | 가설 | 한 줄 요약 | 상태 |
|---|---|---|---|
| **H1** | **복합 3계층 작업** (Lane 1+2+3 종합) | 이 기능 = (a) 플러그인 좁힘 3지점의 widening(호스트는 이미 지원) + (b) 자유입력의 도구 레벨 조합(Other형 옵션→editor 체인) + (c) 응답 계약 co-evolution(스킬 분기·fixture·README) + (d) description 품질은 코드가 아닌 지시 계층(스키마 annotation+SKILL 가이드) | **선두** — 전 lane 증거 수렴 |
| H2 | 오케스트레이션 결정론 (Lane 2 원안) | 구현은 쉽고, fixture/스킬 계약 이행이 진짜 작업이자 위험 중심 | H1의 (c)로 **흡수 병합** — 단 위험 중심이라는 주장은 유지되어 (c)를 critical path로 격상 |
| H3 | SDK 프리미티브 제약론 (Lane 1 원안) | 결정적 제약은 SDK ui 프리미티브 표면 | **기각(부분 구제)** — ②③에 대해 반증됨(SDK가 이미 더 관대, C1). ①에 한해 "단일 프리미티브 부재 → 조합 필수"로 구제되어 H1(b)에 흡수 |

의도적으로 shortlist를 보존한다: H2·H3는 H1에 흡수/기각됐지만 각자 다른 probe를 남겼다(§9).

## 3. Evidence Summary by Hypothesis

### H1(a) — widening: 호스트는 이미 지원, 좁힌 것은 플러그인
- SDK select는 `ExtensionUISelectItem = string | {label, description?}` 수용(types.ts:109-114, 186-190) [C1, Tier-2, 독립 3그룹].
- TUI 렌더링 실체: description은 label 아래 4-스페이스 muted, 인라인 마크다운, 자동 줄바꿈+ellipsis, compact 모드(리스트가 maxVisible 초과 시 커서 옵션만 description 표시), fuzzy 검색이 label+description 모두 매칭(hook-selector.ts:315-383, 491-551) [O22-O24].
- 좁힘 3지점 전수: zod 스키마(ask.ts:271) / AskUI·SelectUI·ConfirmUI 포트(ask.ts:46-48,84-86,186-188) / resolveSelectOption(ask.ts:120-134) [C4].
- 벤더 16.3.15와 렌더링 동일(드리프트는 timeout API 한정) — 회귀 위험 낮음 [C16].

### H1(b) — 자유입력 = 조합 패턴 (프리미티브 아님)
- select 반환은 `string | undefined`, confirm은 `boolean` — 단일 프리미티브로 옵션+자유텍스트 불가 [C2, O7].
- 검증된 관례: 벤더 ask 도구가 OTHER_OPTION을 항상 append(ask.ts:564) → 선택 시 ctx.ui.editor 체인(ask.ts:602) → customInput 1급 채널 직렬화 [C3, O31]. 공식 문서 교차: docs/tools/ask.md:25 [O18].
- 업계 수렴: Claude Code 공식 가이드 "Other 선택 시 사용자 텍스트가 곧 답값(단어 'Other'가 아니라)" [O38]; opencode는 custom=true를 모델이 끌 수 없는 불변식으로 강제(2026-01) [C15].
- 순수 select+상시 텍스트 필드 병존은 업계 선행 없음(유일 병존형 = autocomplete suggestOnly) — Other형 조합이 유일하게 검증된 길 [C12 정정판].
- 엣지 시맨틱(벤더): editor Esc→select 복귀(질문 취소 아님), 질문 취소는 select Esc만; recommended는 append-then-strip; 혼합 응답은 두 줄 병기(다중질문 포매터의 customInput 우선 checked 누락은 벤더 결함 — 복제 금지) [O55-O58, C17].

### H1(c) — 응답 계약 co-evolution은 필수 범위
- 정확 라벨 분기 소비자(fallback 없음): post-craft [Spec Change]/[Plan Change] 3옵션 게이트(실사용 전례 O16), pre-craft [Consensus Escalation] 3옵션 [O19 — HIGH 2건].
- 에러 처리 소비자: resolveSelectOption(비매칭=hard error), parseYesNo(비인식=에러) [O19 — MEDIUM 2건].
- **Tier-1 제어 실험**: resolveSelectOption({response:'yes'}, [Consensus Escalation 3옵션]) = undefined — fixture의 `proceed\??$`→"yes"는 confirm에만 유효, select 게이트에선 오늘도 hard error. answers.json 직독으로 optionIndex 규칙 0개 확정 [C5, O11+O53].
- 스킬 3종 SKILL.md에 옵션 리터럴 하드코딩 — 스키마 변경 시 동시 개정 대상 [O10]. README.md:263-278의 fixture 스키마 문서도 동일 [O15].
- 안전 지대: fixture 질문 매칭은 태그 prefix 기반이라 옵션 스키마와 독립 [C18]. fixture 모드는 ctx.ui 미경유 → RPC description 평탄화(rpc-mode.ts:626)는 실사용 경로 무영향 [O6, C9].

### H1(d) — description 품질은 지시 계층의 계약
- 매칭 규율: description은 표시 전용, 매칭은 라벨로만 — 상세 서술이 whole-word 티어에 노이즈 주입 [O-ExploreAskTool EXPAND, C4 연계].
- 작성 규칙 인코딩 가능: 영어 15항목(WHAT/WHY/장점:/단점: 구조, 균형 프레이밍, ≤20단어/문장, 인라인 용어 정의, 정답 암시 금지) [C14] + 한국어 10항목(순화, 한자식 어미 회피, 서술식 종결, 50자, 능동, 사용자 입장, 괄호 원어, 경어체 통일) [O59].
- countersearch 단서: 과부하는 비중복 정보량×옵션 수 — 파트당 1-2줄 상한 필수; 추천 기본값+간결 균형 설명 조합 우수 가능 [C14 단서].
- 전달 메커니즘 선행: opencode(스키마 annotation) + codex(plan.md 지침) 2계층 [O48, C15].

## 4. Evidence Against / Missing Evidence

- (H1a 반대) 없음 — 3개 독립 그룹이 동일 결론. 단 compact 모드에서 비커서 옵션의 description이 숨겨지는 표시 한계(O23)는 "상세 서술" 요구와 긴장 — 옵션 수·길이 상한의 실증 근거이지 반증은 아님.
- (H1b 반대) custom<T>() bespoke 컴포넌트로 단일 위젯 병존을 만들 수는 있음(O27) — 그러나 선행 없음(C12), 구현·유지 비용, fixture 모드 무관(ui 미경유)이라 조합 대비 이득이 표시 UX뿐. 기각 아닌 열등 대안으로 기록.
- (H1c 반대/완화) E2E가 질문/답변 형태를 직접 assert하지 않아(O13) 스키마 변경이 E2E를 "직접" 깨뜨린다는 것은 추론임; select 게이트가 fixture 경로에서 발화하지 않을 가능성(O12, Tier-4 추론). — 완화 요인일 뿐, 도달 시 치명적이라는 점은 불변.
- (H3 반증) types.ts:186-190 + hook-selector.ts:329-339 — SDK는 요구 ②③보다 이미 관대. "SDK가 결정적 제약"은 ②③에 대해 거짓.
- (누락 증거) ① UI 모드에서 editor 체인의 실제 사용감(취소 복귀 루프 등)은 코드 추적만 있고 실행 관측 없음 — craft 단계 스모크에서 자연 검증. ② 국립국어원 지침의 경어체 명시 권장 여부(1차 PDF 본문 부분 미확보) — 제품 톤 결정으로 이관.

## 5. Rebuttal Round

- **Lane 2 → H1 선두에 대한 최강 반박**: "H1은 (c)를 4분의 1 요소로 취급하지만, fixture는 *이미* select 게이트에서 깨져 있고(Tier-1) 스킬 리터럴이 하드코딩돼 있다. 계약 이행 없이는 기능이 CI에서 출고 즉시 깨진다 — (c)가 곧 critical path다."
- **선두의 응답(증거로)**: 인정. H1은 (c)를 additive가 아닌 필수 범위로 이미 포함하며(O19 "최소 4개 소비자 계약 변경"), 반박의 실질은 우선순위 재조정 요구다. 수용하여 **(c)를 (a)(b)와 동급 critical path로 격상** — plan 단계에서 fixture 스키마·스킬 문서 개정을 구현과 동일 단계로 편성해야 한다.
- **Lane 1 원안(H3)의 자기 반박 처리**: Lane 1 스스로 "SDK가 결정적 제약" 명제를 적극 반박(O1-O5)했고, 살아남은 핵심("자유입력은 프리미티브가 아니라 조합 설계 결정")은 H1(b)로 흡수. 가설 기각이 lane의 실패가 아니라 성과임을 명시.
- **재순위 결과**: H1(c 격상) > H2(흡수) > H3(기각·부분 구제). 순위 변동 없음, 내부 가중치만 변경.

## 6. Convergence / Separation Notes

- **수렴 인정**: H1(a)의 "호스트는 이미 지원" — TracerCodePath(SDK 타입), TracerPremise(전제 감사), ExploreUiApi(렌더링 실체)가 **서로 다른 증거 스트림**(타입 선언 / 전제 검증 / TUI 구현 추적)으로 같은 기제에 도달. 언어 유사성이 아닌 독립 스트림 합류 — 진짜 수렴.
- **수렴 인정**: "자유입력=조합 패턴" — 벤더 구현(코드), 공식 문서, Claude Code 가이드, CLI 생태계 조사가 독립적으로 동일 관례 지목.
- **분리 유지**: H1(b)의 두 구현 후보(Other→editor 체인 vs custom<T>())는 프로즈로는 비슷해 보여도 **다른 probe를 함의** — 전자는 기존 단위 테스트 red-test로, 후자는 TUI 컴포넌트 계약 스파이크로 검증된다. 별개 대안으로 유지하고 인터뷰/plan에 넘긴다.
- **분리 유지**: 응답 계약 후보(라벨 치환 vs 구조체 반환)도 fixture 스키마와 소비자 분기에 완전히 다른 하류 영향 — 병합 금지, critical unknown으로 유지.

## 7. Most Likely Explanation

**이 기능은 "UI 역량 추가"가 아니라 4계층 동시 이행이다**: (a) 플러그인이 스스로 좁힌 3지점(zod 스키마·포트 인터페이스·fixture 매처)을 호스트가 이미 지원하는 {label, description} 수준으로 widening하고, (b) 자유 답변은 검증된 조합 패턴(항상 append되는 자유입력 진입 옵션 → ctx.ui.editor 체인, 입력 텍스트가 곧 답값)으로 구현하며, (c) 응답 계약에 의존하는 소비자(스킬 2게이트·fixture 스키마·README — 그리고 오늘도 잠재적으로 깨져 있는 select 게이트 fixture 규칙)를 동시 개정하고, (d) description의 품질 요건(배경+장단점+쉬운 언어)은 코드가 아니라 스키마 annotation + 도구 description + SKILL.md 가이드의 지시 계층에 인코딩한다. (a)(b)는 낮은 구현 위험(참조구현 실재), (c)는 critical path(누락 시 CI 파손), (d)는 요구 ③④의 유일한 전달 수단.

## 8. Critical Unknown

**단일 최상위 미지수: lsc_select(및 confirm)의 응답 계약을 어떻게 바꿀 것인가.**
1. (Lane 1×2 합류) 자유 답변이 **라벨 치환**(반환은 여전히 string, 자유텍스트가 그 자리에 흐름 — Claude Code 모델)인가, **구조체 반환**({selection, freeText} — fixture 스키마와 모든 소비자 시그니처 변경)인가. 이 결정이 resolveSelectOption·FixtureAnswerRule·스킬 분기 문구의 변경 형태를 전부 결정한다.
2. (Lane 2) fixture answers.json의 확장 형태 — 자유답변 표현 수단(예: freeText 필드? response 그대로?)과, 이번 범위에 select 게이트 잠재 결함(proceed→yes) 해소를 포함하는가.
3. (Lane 3) "모든 질문"의 경계 — lsc_confirm(게이트 질문: [Land] merge 승인, [Hash Violation] 등)에도 자유 답변을 붙이는가? confirm은 boolean 계약이라 자유답변을 받으면 게이트 결정성(yes/no)이 흔들린다. 붙인다면 select 기반 재구성(C8이 구조 근거)이 필요하고, 안 붙인다면 요구 ①의 범위 축소를 사용자가 승인해야 한다.

## 9. Recommended Discriminating Probe

**주 probe (H1 전체를 한 번에 붕괴)**: 응답 계약 확정 직후, 기존 단위 테스트(test/ask.test.ts:94-234 — performSelect 8개, resolveSelectOption 10개)의 신스키마판을 red-test로 먼저 작성한다. 어느 단언이 깨지는지가 (a) widening의 정확한 삽입 지점, (c) fixture 스키마의 필요 변경, 그리고 proceed→yes select 게이트 결함의 회귀 고정을 동시에 드러낸다. — Stage 4(test)의 자연스러운 선행 작업과 합치.
**부 probe (H2 잔여 위험)**: fixture E2E에서 [Spec Change] select 게이트를 강제 발화시키는 시나리오(post-craft APPROVE-WITH-CHANGE 유도)로 잠재 결함의 실제 발현을 확인 — 신 fixture 스키마가 이를 해소하는지 검증.
**소 probe (H1b 열등 대안 봉인)**: custom<T>() 경로는 채택 시에만 TUI 컴포넌트 계약(Component & {dispose?}) 5분 스파이크 — 기본 권장은 조합 패턴이므로 조건부.

## 10. Additional Trace Lanes

불요 — 불확실성이 설계 결정(§8)으로 압축됐고, 그것은 인터뷰(Stage 2)의 소관이다.

---

## Lane Sub-Reports

### Lane 1 — Code-path / implementation (TracerCodePath)
- Hypothesis(재진술): 현 구조(string[] options, ui 프리미티브, 코어/래퍼 분리, 4-tier 매칭)가 삽입 지점을 결정하며 결정적 제약은 SDK 프리미티브 표면이다.
- Evidence For: SDK {label,description} 수용(types.ts:109-114,186-190); hook-selector 렌더링(329-339); 벤더 ask 참조구현(OTHER_OPTION:111, toSelectOption:103-105, CustomInputContext:149-153); markableCount trailing 제어행 공식 주석(types.ts:151-154); 좁힘 3지점 국한(ask.ts:271/84-86/120-134).
- Evidence Against/Gaps: SDK는 이미 관대 → "SDK가 제약" 명제 반박; RPC/ACP description 평탄화(rpc-mode.ts:626); 옵션+자유텍스트 단일 프리미티브 부재(조합 설계 결정); confirm boolean 전용; fixture 데이터모델에 객체 표현 수단 없음.
- Evidence Strength: Tier-1(벤더 참조구현) / Tier-2(타입·렌더러·좁힘 3지점) / Tier-3(CHANGELOG·예제 4건) / Tier-4(fixture 미반영 추론).
- Critical Unknown: fixture 모드의 객체 옵션 매칭 방식(라벨 수렴 + description 배제 + 기존 answers.json 호환).
- Best Discriminating Probe: SelectUI.select 시그니처 widening 후 (1) 구조적 타입호환, (2) ask.test.ts 파손 지점, (3) RPC 라벨 축소의 fixture 모드 영향 확인.
- Confidence: High(구조 매핑) / Medium(자유답변 삽입 설계·fixture 이전 방식 미정).

### Lane 2 — Config / environment / orchestration (TracerOrchestration)
- Hypothesis(재진술): 오케스트레이션 계층(태깅 규약+fixture 매칭+E2E)이 결정적 제약 — 계약 co-evolution 없는 스키마 변경은 fixture와 스킬 분기를 깨뜨린다.
- Evidence For: options string[] 전 역직렬화 계약(ask.ts:120-174,269-272); FixtureAnswerRule.response 단일 string(fixtures.ts:18-35); **Tier-1 실험** proceed→yes의 select 게이트 실패; SKILL.md 옵션 리터럴(pre-craft:283, post-craft:65,165); 태깅 규약 load-bearing(3 SKILL.md §1.2); README:263-278 공식 스키마; 이전 craft 실사용 전례.
- Evidence Against/Gaps: E2E 형태 assertion 부재(간접 파손만); select 게이트 도달 회피 가능성(latent); optionIndex는 선택엔 유효하나 freeText/description 반환엔 무력; 태그 prefix 매칭 자체는 안전.
- Evidence Strength: Tier-1(제어 실험) / Tier-2(소스·fixture·스킬·README·전례 6개 독립 아티팩트) / Tier-3(단위·fixture 테스트) / Tier-4(도달 회피 추론).
- Critical Unknown: lsc_select 반환 타입의 정확한 변경 형태(옵션 객체화 방식 × 자유답변 반환 구조) — 하류 영향이 완전히 갈림.
- Best Discriminating Probe: 신스키마 red-test 선작성(ask.test.ts 18개 단언 기준) + [Spec Change] 게이트 강제 발화 E2E.
- Confidence: High(6개 독립 아티팩트 수렴 + 실험) — 단 critical unknown 확정 전 영향 범위 정밀 계산 불가로 수렴 판정은 보류(→ §6에서 메인 세션이 판정).

### Lane 3 — Measurement / assumption-mismatch (TracerPremise)
- Hypothesis(재진술): 요청 능력 일부는 호스트에 이미 존재하고, 일부는 소비자의 "응답=옵션 중 하나" 가정과 충돌 — UI 능력 부재 전제와 미검증 계약 변경이 섞여 있으며 하나로 수렴시키면 안 된다.
- Evidence For(전제 1): 래퍼에 자유답변 경로 부재 확증(취소=에러 ask.ts:170-172; confirm boolean:227). (전제 2): description 전 스택 통과(controller:37-45→wire:301→select-list:26-27); Other는 도구 레벨 조합(ask.ts:564,602); 공식 문서 교차(docs/tools/ask.md:25); ctx.ui.editor 존재(types.ts:248-253). (전제 3): 소비자 6개 감사 — HIGH 2(post-craft disposition, pre-craft escalation: fallback 없는 정확 분기), MEDIUM 2(resolveSelectOption, parseYesNo), LOW 1(브랜치 선택), LOW-MEDIUM 1(인터뷰).
- Evidence Against/Gaps: 자유답변의 스킬 측 처리 관례가 이미 존재(lsc_ask 경로) — 적응 비용은 게이트 분기에 집중; UI 실행 관측 없음(코드 추적만).
- Evidence Strength: Tier-2 일관(래퍼 소스·SDK 타입·벤더 소스·공식 문서·스킬 문서).
- Critical Unknown: "모든 질문" 요구의 경계 — 게이트 confirm의 결정성과 자유답변의 양립 방식(소비자별 fallback 분기 설계).
- Best Discriminating Probe: 소비자 인벤토리 기반으로 자유답변 유입 시 분기 fallback을 스킬 문서에 명문화한 뒤 fixture로 재생 — 계약 변경이 관리되는지 확인.
- Confidence: High — 결론("additive 아님, 최소 4개 소비자 계약 변경")은 소스 직독 전수 기반.

## External Research Summary

전체 인용 트레일: **research/SYNTHESIS.md** (소스 인덱스 14그룹, 관측 O1-O59, 클레임 C1-C18 — countersearch로 잠금). 요지:
- 호스트 UI는 요구 ②③을 이미 렌더링 가능(C1); 자유입력은 업계 공통으로 프리미티브가 아닌 조합 패턴이며(C2/C3/C12), 벤더·Claude Code·opencode가 "입력 텍스트=답값, 자유입력 상시 제공"으로 수렴. codex만 "거부 옵션+notes 채널"의 제3 모델(C15) — 혼동 시 직렬화 버그 원인이므로 미채택.
- 요구 ①~④ 동시 만족 선행 없음(C15) — 조합 자체가 신규 기여. 스키마 상한(옵션 2-4개)·recommended(append-then-strip)·이원 회신(answers+response)은 차용 가능한 선행.
- description 작성 규칙: 영어 15항목+한국어 10항목, WHAT/WHY/장점/단점 구조, 균형 프레이밍+길이 상한(과부하=비중복 정보량×옵션 수), 스키마 annotation+가이드 2계층 전달(C14).
- fixture-모드 유의: 3회 웨이브 리서치는 live로 수행(LSC_FIXTURE 미설정 확인 완료) — 스텁 아님.
