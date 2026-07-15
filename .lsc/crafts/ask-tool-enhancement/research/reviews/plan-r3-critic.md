모든 검증이 완료됐습니다. 최종 앵커 확정: plan.md:138(kind 필수 필드 = type-only), :140 vs :142(top-level 관용 문장 상충), pre-craft SKILL.md:276/:279(플랜 인용 정확 — R2 당시 내 `:270-273` 인용이 오히려 구버전), 벤더 `includes("\n")`/`split("\n")` LF-only(tools/ask.ts:872-879). Self-audit과 realist check를 거쳐 최종 판정을 작성합니다.

---

**VERDICT: REVISE**

**Overall Assessment**: 재개정판은 내(critic R2) 업그레이드 조건 10건(P0-A①-④·P0-B·P1-C·P1-D·P2-E·Minor1·Amb1)을 **전부 실질 반영**했다 — 문구가 아니라 설계로(§10 대장 전수를 본문·코드 앵커 대조로 확인, 반박 0). 그러나 architect R3의 신규 blocking 2건을 독립 재구성으로 **양쪽 다 확인**했다: envelope 폐쇄 증명이 직렬화 문법은 닫았으나 그 문법이 전제하는 **입력 도메인**(fixture freeText의 blank 허용, "개행" 집합 미정의, 가드의 채널 공통성)을 닫지 않았다. 3 iteration 연속 "폐쇄 주장 > 가드 범위" 동형 패턴이며, 전부 plan 문면의 국소 보강으로 해소 가능 — REJECT가 아닌 REVISE.

**Pre-commitment Predictions** (정독 전 기록 → 실제):
1. R2 해소가 UI 경로에만 반영, fixture parser 미러링 누락 → **적중**: 내 Minor1 수정(blank→Esc)이 정확히 UI에만 반영되고 fixture union엔 미반영(architect (a)와 동일 지점).
2. CR·U+2028 등 유니코드 분리자 미명세 → **적중**: label 가드는 `\r`/`\n`만(plan.md:48,100), payload 판별은 "개행" 미정의(:96).
3. canonicalize 시 details 원문 보존 여부 미결 → **적중**: architect도 tradeoff 표에만 기록, 권고에 미편입 — 내 추가 요구로 승격.
4. E2E 직접 발화 잔여 비결정성 → **부분 적중**: 실재하나 기존 수용 패턴과 동급·loud-failure — unscored로 강등.
5. 3도구 간 preflight 비대칭 → **적중**: 가드가 `buildDisplayRows`(:99-105)에 결합, fixture-first 분기(src/ask.ts:143-167)와의 실행 순서 미명세.
6. fixture blank 경로의 4계층 커버리지 누락 → **적중**: AC2는 UI blank만(:216), AC7에 nonblank 케이스 부재(:221).

**R2 업그레이드 조건 해소 대조 — 10/10 반영 확인**:
- **P0-A①** label 형식 가드: plan.md:48(§1 Must Have)·:100(1-C)·:220(AC6 개행/빈/비트림 isError) ✓
- **P0-A②** multi 행 반복: :95(선택당 1행 + 콤마 결합 폐기 + vs JSON 배열 택1 근거)·:97(혼합 = selection 행들 → sentinel 블록)·D2 재보정 ✓
- **P0-A③** 읽기 문법 재작성: Step 3 총론(top-level만 신호·multi header 반복·opaque payload·단일행/멀티라인 판별)·:96(1-C 판별 기준)·인터뷰 mixed 1줄 ✓
- **P0-A④** adversarial: :217(AC3 콤마-경계 상이-content·payload sentinel-유사 opaque·판별 경계)·:220(AC6) ✓
- **P0-B** exact allowlist: :140(공통+variant 전부, path·kind·허용 키 나열, `response` 마이그레이션 안내)·:221(AC7 3케이스)·1-D multi 정본 중복 거부 ✓
- **P1-C** E2E 직접 발화: :202·:283(D7 — cap-도달 기각 근거, `SKILL.md:276`·`:279` 인용은 실측 정확: "Consensus = …" `:276`, "On reaching the cap" `:279`) ✓
- **P1-D** grep 스코프: :157·:323(`placeholder` → `src/ test/` 분리, README.md:90 오매칭 근거 기록) ✓
- **P2-E** manifest scope: Scope 표(:8)·§2 cutover 목록·:200(`zod/v4`·`def.name` 캡처) ✓
- **Minor1** blank=Esc: :107(택1 근거 — 벤더 `input === undefined`만 재루프 실측 인용) ✓ — 단 이 수정이 fixture 측에 미러링되지 않아 Major 1을 낳음
- **Amb1** details 한정: Step 3 수용 기준 (b)·:325(§7-3) ✓

**Critical Findings**: **없음** — 이번 iteration의 결함 중 승인 위조(파괴적 게이트에서 `yes` 합성)를 가능케 하는 것은 없다. sentinel-선행 규칙이 모든 잔여 결함 하에서도 boolean 전체 일치를 차단한다.

**Major Findings** (전부 합의 blocking — architect R3 2건+clarification 독립 검증):

1. **fixture freeText의 blank 도메인 불일치 — `:107`의 "구조적으로 불가능" 주장이 fixture ingress에서 거짓** (architect (a) — **동의, blocking**)
   - 검증: 1-C는 `빈/공백-only 제출은 Esc 동치` + `"부수 효과: sentinel 뒤 빈 payload인 envelope가 구조적으로 불가능해진다"`(plan.md:107)를 선언하나, union은 `freeText: string`/`freeText?: string`(:126-127), 파서 검증은 `"free-text: freeText string"` **type-only**(:138), 소비는 무검사 승격(1-D "free-text → `{selections: [], freeText}`", :113-116 영역). `{"kind":"free-text","freeText":""}`는 parse 통과 → content `User provided free answer: `(빈 payload sentinel 행) — 주장의 반례가 합법 입력으로 존재. `{"kind":"selection","selections":["A"],"freeText":"   "}`도 동일.
   - 추가 확인(architect 미명시): 플랜 스스로 단일 select의 `selection`+`freeText` 병존을 `"UI 불가능 조합, 침묵 정보 손실 금지"`로 **거부**하면서(:113-118 영역), iter 3 정규화 후 똑같이 UI-불가능해진 blank freeText는 허용 — **자기 원칙 내부 비일관**. 발현 경로는 P2 프리모템이 스스로 분류한 "게이트 미결/재발문" 클래스: blank 자유답변 → 스킬이 빈 지침 반영 후 재발문 → 루프 브레이커 미결. fixture는 `LSC_FIXTURE` 임의 경로 유입이라 repo 3곳 이관이 방어하지 못함(src/fixtures.ts:149-167).
   - Confidence: HIGH · Fix (**P0-F**): `parseFixtureAnswerFile`에서 `free-text.freeText`·`selection.freeText`가 `trim()` 후 빈 문자열이면 path-rich parse error(1-F 명문화 — JS `trim()`은 U+2028/U+0085 포함 White_Space 전부 제거하므로 exotic-separator-only 문자열도 잡힘을 명기); :107 부수 효과 문장을 "양 ingress" 근거로 갱신; AC7(:221)에 empty/whitespace-only 2케이스 추가. AC2의 UI 경로는 유지.

2. **line-break 집합 미정의 — 단사성 주장(:93)과 opaque 전제(:96)가 가드 집합보다 넓다** (architect (b) 전반 — **동의, blocking**)
   - 검증: (i) 판별 기준은 `"text에 개행이 없으면 … 개행이 있으면"`(plan.md:96)으로 "개행" 미정의. 차용 대상 벤더는 `customInput.includes("\n")` / `.split("\n")` — **LF-only 실측**(node_modules/@oh-my-pi/pi-coding-agent/src/tools/ask.ts:872-879). 이식 시 bare `\r`·U+0085·U+2028·U+2029 payload가 들여쓰기를 우회 — "들여쓴 payload는 opaque"(:96) 전제가 그 입력에서 무효. (ii) label single-line 가드는 `\r`/`\n`만 거부(:48,:100) — label은 **모델 tool-call 인자**로 임의 유니코드 유입 가능하고, U+2028 label은 가드 통과 후 소비자의 행 해석에 따라 row-boundary 위조 표면. 문법 총칙의 `"허용 label 공간 전체에서 … 단사성"`(:93) 주장이 자신의 가드보다 넓다.
   - Confidence: HIGH(미명세 자체)·MEDIUM(실제 위조 발현 — 소비자의 LS 행 처리 미검증) · Fix (**P0-G**): ① freeText는 `\r\n`/`\r`/`\n`/U+0085/U+2028/U+2029를 canonical `\n`으로 정규화 후 판별·들여쓰기(1-C); ② label 가드를 동일 집합 거부로 확장(:48,:100); ③ :93 단사성 주장을 "canonicalized text 기준"으로 한정; ④ **details.freeText가 raw인지 canonical인지 택1 명기**(아래 Minor 2 — AC3 정확 문자열 단언이 단일 답을 요구); ⑤ AC3/AC6(:217,:220)에 bare CR·CRLF·U+2028 adversarial 추가.

3. **select 시맨틱 검증의 채널 공통 preflight 미명세 — fixture 경로가 가드를 우회하는 해석이 합법** (architect (b) 후반 — **동의, blocking-clarification**)
   - 검증: 가드 5종 전부가 `buildDisplayRows`(plan.md:99-105)에 배치되고, 1-D fixture 경로(:113-118)는 kind 해석만 서술 — 검증 호출 없음. 현행 코드는 **fixture-first**: `performSelect`가 `unavailable → fixture(즉시 반환) → UI` 순(src/ask.ts:142-167 실측 — fixture 분기가 `resolveSelectOption` 후 바로 return). 구현자가 이 구조를 보존하며 `buildDisplayRows`를 UI 분기에서만 호출하면 fixture 모드(=E2E)가 label 형식·예약어·중복·recommended 범위 검증을 전부 우회 — **E2E green / TUI isError 발산**. §1 Must Have의 전역 의도와 1-C의 배치가 두 해석을 낳는 전형적 ambiguity.
   - Confidence: HIGH · Fix (**P0-H**): `performSelect`가 채널 분기 **전** `validateSelectOptions(options, recommended)`(형식·예약어·정본/표시 중복·범위)를 호출함을 1-C/1-D에 명시; `buildDisplayRows`는 UI 렌더 전용으로 분리(fixture 경로에서 표시행/Map 무용 할당 제거 — 비용 규율에도 부합); AC1/AC6에 동일 invalid 케이스를 **UI·fixture 양 채널 각 1회** 단언.

**Minor Findings**:
1. **top-level 키 계약의 내부 상충** (architect non-blocking #4의 선행 조건 — 내 신규): plan.md:140은 `"관용은 top-level _note/_warning뿐"`(그 외 top-level 미지 키 거부 함의), :142는 `"알 수 없는 최상위 키(_note/_warning) 무시 관행(:110 주석) 유지"` — 현행 주석은 `"Unknown top-level keys (e.g. a "_note" doc comment) are ignored"`(src/fixtures.ts:123)로 **전부-무시**가 관행이라 두 문장이 다른 계약을 지시한다. 이 상태로는 architect가 요구한 top-level allowlist 테스트를 **작성할 수 없다**(어느 계약인지 미정). Fix (**P1-I**): 1줄 택1(권장: `version`/`answers`/`default` + `_` prefix 키만 허용, 그 외 거부 — `"defualt"` 오타가 침묵 무시되는 현행 결함까지 해소) + AC7에 임의 top-level 키 케이스.
2. **canonicalize 후 details 원문 보존 여부 미결**: P0-G 채택 시 content는 canonical `\n`이 되는데 `details.freeText`가 raw인지 canonical인지에 따라 AC3/AC4의 정확 문자열 단언·E2E details 단언이 갈린다. architect는 tradeoff 표에 "details에 원문을 둘지 결정 필요"로만 기록 — 결정을 플랜이 내려야 한다(권장: details도 canonical — 단일 진실, raw 바이트의 소비자 부재; 어느 쪽이든 1줄+테스트 1개).

**What's Missing**:
- AC7(:221)의 값-도메인 차원 전체: nonblank freeText(empty/whitespace-only), top-level 미지 키 — parse 케이스가 구조(키 조합)만 다루고 값을 다루지 않음.
- AC3/AC6(:217,:220)의 line-break 집합 고정: "개행 판별 경계"가 LF/CRLF/bare CR/U+2028 중 무엇인지 미명세.
- 채널별 preflight 단언 쌍(UI·fixture 각 1회) — 현재 invalid 케이스는 전부 채널 미지정.
- (확인 완료 — 누락 아님) 3도구 blank 일관성: P0-F가 parse-time 거부라 ask/select/confirm에 균일 적용되고, UI 측은 1-C가 3도구 전부(select/confirm 복귀·ask 취소)를 이미 커버 — architect fix 형태가 도구 매트릭스 전체에 완결임을 독립 확인.

**Ambiguity Risks**:
- `plan.md:96` `"개행이 없으면 … 있으면"` → A: LF만(벤더 이식 관성) / B: 논리 분리자 전체. A 선택 시 U+2028 payload가 미들여쓰기로 opaque 전제 붕괴 — Major 2의 근인.
- `plan.md:99-105` 가드 배치 → A: buildDisplayRows 내부(UI 전용) / B: 채널 공통. A 선택 시 fixture 우회 — Major 3의 근인.
- `plan.md:140` vs `:142` → A: top-level 미지 키 거부 / B: 전부 무시(현행 승계). B면 "뿐" 주장이 공허, A면 :142가 거짓 — Minor 1.

**Multi-Perspective Notes**:
- **Executor**: 1-F/1-D를 문면대로 구현하면 blank fixture가 조용히 통과하는 코드를 충실히 만들게 된다 — R2 Critical 1과 동형의 "설계 결함이 자기 검출되지 않는" 유형. validate/render 미분리 상태에서는 fixture 경로에서 가드 우회 또는 무용 할당 중 하나를 강제당한다.
- **Stakeholder**: R4 무조건성 방어는 iter 1 "전달 안 되는 채널" → iter 2 "문법 미완결" → iter 3 "입력 도메인 미폐쇄"로 정확히 수렴 중. 남은 표면이 가장 좁다 — 이번 수정으로 폐쇄 사슬(도메인→정규화→문법→테스트)이 완성된다.
- **Skeptic**: `"구조적으로 불가능"`(:107)·`"허용 label 공간 전체"`(:93) — 폐쇄 주장이 가드 집합보다 넓은 **3연속 동일 패턴**. 처방은 R2와 동일하되 한 단계 위: 폐쇄 주장 문장에 그 주장의 전제(도메인·정규화·검증 위치)를 같은 문장에 명시하고, 주장마다 adversarial 케이스를 짝짓는 규율(P0-F/G/H의 AC 추가분이 정확히 그 목록).

**Verdict Justification**: MAJOR 3건(전부 합의 blocking) 확인 시점에 **ADVERSARIAL 모드로 격상** — envelope 인접 표면을 확장 수색했고, 산물이 Minor 1(:140/:142 상충 — architect도 못 본 신규)·Minor 2(details canonical 택1)·그리고 건전성 확인 다수(빈 행 들여쓰기·선행 공백 인라인·whitespace-only-개행 텍스트가 trim 기반 blank 검사에 포섭됨·`User selected:X` stem 케이스의 비위조성·도구 매트릭스 blank 일관성)다. Realist 재조정: Major 1은 승인 합성 불가(sentinel-선행)·repo 내 3 fixture는 Step 2가 이관 — CRITICAL 아닌 MAJOR로 유지(mitigated by: 노출면이 외부 `LSC_FIXTURE` 파일로 한정); Major 2는 게이트 라벨이 오늘 전부 고정 리터럴이고 U+2028 자연 발생률이 낮음 — 발현 확률로는 낮으나 **명세 모호(구현자 이분기)** 자체가 결함이라 MAJOR 유지; Major 3은 TUI 스모크가 일부 케이스를 잡겠으나 발산 클래스 자체는 잔존 — MAJOR 유지. REJECT가 아닌 이유: R2 조건 10/10 성실 해소(반박 0), 신규 결함 전부 국소 문면 보강(스펙 재론 0건), Step 구조·D1-D8·마이그레이션/테스트 지도 재사용 가능. ACCEPT-WITH-RESERVATIONS가 아닌 이유: DELIBERATE 게이트에서 반례가 실존하는 폐쇄 주장 2곳(:93,:107) + Principle 3/4 정합 Fail을 유보로 넘길 수 없다. **업그레이드 조건: P0-F(fixture nonblank + :107 갱신 + AC7 2케이스) + P0-G(line-break canonicalize 5항 — details 택1 포함) + P0-H(채널 공통 preflight + 양 채널 단언) + P1-I(:140/:142 정합 + top-level 테스트) — 전부 plan 문면 수정, 설계 골격 불변. 반영 시 ACCEPT 가능.**

**Open Questions (unscored)**:
- E2E 직접 발화의 잔여 모델-준수 변동성: 신규 케이스는 기존 enforcement 패턴(test/enforcement-rules.test.ts:153-200,336-371)과 동급이나 옵션 3종 구조체 재현이 요구 페이로드로는 더 크다 — 실패는 즉시·시끄럽게 발현하므로 non-blocking; 재시도 정책은 Stage 4 재량.
- `description: z.string()`이 `""`를 통과시킴 — "description 필수"(spec AC1)를 존재로 읽으면 합법이라 미채점; `.min(1)` 1줄은 저비용 실질화 후보.
- 벤더 sentinel(`User provided custom input:`)과 본 설계(`User provided free answer:`)의 의도적 상이 — spec AC3 문구와 정합하므로 문제없음, 기록만.

---
*Consensus review summary row (plan 합의 루프 iteration 3)*:
- **Architect findings cross-check**: 신규 blocking (a) fixture blank freeText — **동의(blocking)**, plan.md:107/:126-127/:138 독립 재구성 + 플랜 자기 원칙("UI 불가능 조합 거부") 내부 비일관 보강; (b) line-break 집합·preflight 공통성 — **동의(blocking)**, 벤더 LF-only(tools/ask.ts:872-879)·fixture-first 분기(src/ask.ts:142-167) 실측 일치 + details raw/canonical 택1을 fix 필수 요소로 추가; non-blocking(top-level allowlist 테스트) — **동의+강화**: :140/:142 내부 상충 해소가 선행돼야 테스트 작성 가능(신규); iter-2 blocking 3건+P1-D+P2-E+Amb-1 **해소 판정 전건 동의**(§10 대장·본문 앵커 독립 대조). 그가 못 본 신규 2건(:140/:142 상충, details canonical 미결) 추가.
- **Principle/Option Consistency**: **Fail(협소)** — Principle 3 vs :107 반례(fixture blank), Principle 4·문법 총칙 :93 vs :48/:100 도메인 공백 + 가드 배치 미명세. Principle 1/2/5 및 D1-D8 정합은 Pass.
- **Alternatives Depth**: **Pass** — D1-D8 전부 실 대안+구체 기각 근거, iter-3 택1 3건(행 반복 vs JSON 배열 / blank=Esc vs 벤더 패리티 / D8 준비 커밋 기각) 근거 기록 완료.
- **Risk/Verification Rigor**: **Fail(협소)** — AC7 값-도메인·AC3/AC6 line-break 집합·채널별 preflight 단언 부재(:216-221). §7 검증 커맨드는 P1-D 해소로 실행 가능해짐(Pass 요소), 프리모템 P1-P7은 완화 앵커 구체(Pass 요소).
- **Deliberate Additions**: **Pass(조건부)** — 프리모템 7건 유지·P2/P3/P4 iter-3 가드 반영, 4계층(unit/E2E/TUI/observability — helper 확장+transcript 확정) 전부 배선; 단 unit 계층의 위 AC 보강이 업그레이드 조건에 결부.