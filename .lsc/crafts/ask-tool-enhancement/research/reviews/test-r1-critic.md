전 자산 정독·독립 검증·메인 체크아웃 대조가 완료되었습니다. 최종 판정을 제출합니다.

---

**VERDICT: REVISE**

**Overall Assessment**: 정본은 envelope 문법 폐쇄(단사성·mandatory break 7종·opaque payload), fixture v2 illegal-state 매트릭스, §13 R-1/R-2 binding 유보를 매우 강하게 고정하고 테스트 간 모순·비결정성이 없다. 그러나 Architect B1-B5를 전부 독립 재구성으로 확인했고(5건 모두 실제 false-green 성립), 추가로 **multi select-Esc 취소 미고정**(신규 MAJOR) 1건을 발견했다. "전량 green = plan 계약 충족"이 현재 성립하지 않으므로 정본 수정 후 재리뷰가 필요하다 — 다만 수정은 표적화된 ~10개 케이스 추가이며 구조 재작업이 아니다.

**경로 규약**: `{C}` = `{W}/.lsc/crafts/ask-tool-enhancement/test`, `{W}` = `/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/ask-tool-enhancement`. 기준선 인용은 메인 체크아웃(`/Users/soyesenna/Desktop/workspace/lets-craft`) 기준.

---

## Pre-commitment Predictions (정독 전 기록 → 실제)

| # | 예측 | 결과 |
|---|---|---|
| 1 | mock 시퀀서가 질문↔응답 매핑을 느슨하게 둠 | **부분 적중** — mock이 미제공 문자열도 반환하는 구조가 B1의 enabler |
| 2 | exact 문구가 plan 문면과 미세 불일치 | **빗나감** — 진단 2종·envelope 리터럴 전부 plan 1-C와 자구 일치 확인 |
| 3 | run_test.sh 실패 전파 결함 | **빗나감** — sync 실패 exit 2, build/unit/e2e 상태 집계 후 nonzero 전파 정상(`{C}/run_test.sh:120-129`) |
| 4 | answers.json 스키마/기대 불일치 | **빗나감** — asset 자체는 정확(아래 검증); 대신 **미검증**이 문제(B5) |
| 5 | private 구조 과잉 고착 | **경미하게만 적중** — 등록 순서·checkedIndices 정렬 핀 2건(Minor); helper는 의도적으로 관용적(`unpackDisplayRows`/`validationMessage`) |
| 6 | 프리모템 P1-P7 중 1-2개 무커버 | **적중** — P6(multi 상태전이)이 B2·M1로 부분 공백 |

**ESCALATION**: 검증 중 blocking 5건이 확인되어 프로토콜에 따라 **ADVERSARIAL 모드로 격상** — 인접 표면(다중 Esc 경로, 리터럴 핀, 정규식 대소문자, import 스타일)을 확장 수색했고 그 결과가 M1과 Minor/OQ 발견들이다.

---

## Architect B1-B5 독립 검증 (각 반례를 테스트 본문으로 재구성)

**B1 — 동의 (성립).** 실제 `ui.select` 호출 인자에서 `OTHER_OPTION` 존재를 단언하는 select 테스트가 0건이다. Other 배선 단언은 helper(`buildDisplayRows`, `{C}/assets/test/ask.test.ts:480-486`)와 confirm 경로(`:855-861`, rows `["Yes","No",OTHER]` 완전 단언)뿐. single Other 체인(`:690-695`)은 `editorCalls`·content만 검사하고 `selectCalls[0].options` 무단언; multi는 DONE 존부만 actual rows에서 검사(`:749-753`). **반례 재구성**: 구현이 `ui.select(question, 정본행만)`을 호출하고 반환 문자열 `=== OTHER_OPTION`로 분기하면 — editor-Esc 재루프의 `initialIndex === BASE_OPTIONS.length`(`:698-706`, 값 2)도 Other 없는 2행 배열에 hardcode `options.length`로 재현 가능 — 960행 스위트 전량 green, 실제 TUI에는 자유답변 진입행 부재. AC2 헤드라인 불변식("항상 자동 append", spec AC2·plan §3 AC2 "ui-mock이 수신한 행 배열에 Other 존재 단언")이 정확히 미이행. Confidence: HIGH.

**B2 — 동의 (성립).** `multi: true` 전수 열거(grep) 결과 모든 시퀀스가 단조 증가(check-only): `["Beta","Alpha",DONE]`(`:742-755`), `["Beta",OTHER,DONE]`(`:757-770`), `["Beta",OTHER]`(`:772-786`), `:788-799`, `selectTwoLabels`(`:214-218`), adversarial `:369-380`. 재선택-해제 시퀀스 0건, `checked.size → 0` 후 Done 재소멸 단언 0건. **반례**: `Set.add`만 있고 `delete` 없는 구현 전량 통과 — plan.md:116("옵션 행 활성화 = **토글**", "Done은 `checked.size > 0`일 때만") 위반이 침묵. Confidence: HIGH.

**B3 — 동의 (성립).** free-only는 single-UI(`:690-695`)·single-fixture(`ask.test.ts:610-618`, `fixtures.test.ts:498-505`)뿐이고 multi는 항상 checked ≥ 1 혼합(`:772-786`; `fixtures.test.ts:575-596`). multi + `kind:"free-text"` fixture, multi + 첫 응답 Other→editor UI — 양 ingress 모두 0건. **반례**: multi에서 `checked.size===0`이면 editor 확정을 에러 처리하거나 빈 `User selected:` 행을 선행 부착하는 구현 전량 통과 — plan.md:116-121("`free-text`를 single/multi 동일하게 `{selections: [], freeText}`로 소비, Other는 체크 유무 무관 확정") 위반이 침묵. Confidence: HIGH.

**B4 — 동의 (성립, 기준선 후퇴 실증).** v1 기준선(메인 `test/fixtures.test.ts:54-88`)에 있던 공통 경계 — non-object payload(:66-68) / answers 부재(:70-72) / match 부재(:74-76) / once 비boolean(:82-84) / default 비문자열(:86-88) — 이 v2 정본(`{C}/assets/test/fixtures.test.ts`)에서 전부 탈락했고, version 경계는 v1-신호 3건(`:315-334` 부근: versionless+response / version:1+response / string default)뿐이다. `version:3`·`version:"2"`·answers 부재/비배열·rule 비객체·match 부재/비문자열·`once:"true"` 전부 0건. **반례**: `version >= 2` 수용 구현, match 부재를 catch-all로 보정하는 구현(allowlist가 {kind, confirm}만으로 통과) 전량 green — 후자는 게이트 과매칭으로 C5-class 결정 무결성 침해. plan 1-F("`version !== 2` → 에러", "`match` string 필수, `once` boolean") 계약 미고정. Confidence: HIGH.

**B5 — 동의 (성립; 인용 라인 1건 정정).** plan **:227**(AC7 행 말미)이 "**answers.json 실파일 로드 스냅샷**"을 명시 요구 — architect 인용 `plan.md:229`는 2행 오차(:229는 AC9 행)이나 실질 유효. 정본의 disk-load 테스트는 전부 tmp 파일(`fixtures.test.ts:453-474` 부근 `tmpAnswersFile`)이고, canonical asset의 유일 소비는 gated E2E copy(`e2e-helpers.ts:302-322` `setupFixtureProject`)이며 direct-trigger(test 6)는 별도 인라인 fixture 생성(`enforcement-rules.test.ts:406-428`). **반례**: canonical에서 `proceed\??$` 규칙을 select-gate 규칙들 앞으로 이동하거나 라벨 오타(`"Proceed with current versoin"`) — 기본 craft run 전량 green, LSC_E2E=1에서도 test 6은 인라인이라 green, full-cycle은 escalation 발화(비결정) 시에만 red. **asset 자체는 검증 결과 PASS**: v1 5개 답변 문자열 완전 보존(메인 `fixtures/sample-ts-cli/answers.json` 대조 — 5/5 동일), select-gate 2규칙이 `proceed\??$` 앞(first-hit 정합), 라벨은 SKILL 정본과 일치(`skills/pre-craft/SKILL.md:283` "Proceed with current version…", `skills/post-craft/SKILL.md:165` "Accept — apply to spec.md/plan.md"). Confidence: HIGH.

**Non-blocking NB1-NB4 — 전부 동의** (NB1 LSC_E2E=1 acceptance 로그 규율 / NB2 direct-trigger 정확-1회 미단언, `enforcement-rules.test.ts:452-470` `.find()`만 / NB3 등록 순서 과잉 고정, `ask-schema.test.ts:68` / NB4 multi 재호출 cursor·blank-editor 미고정).

---

## Critical Findings (합의 차단 — 정본 수정 필수)

위 B1-B5. 각 수정 액션은 하단 우선순위 목록. Realist 완화 요인 명시: B1은 TUI 스모크 ②·⑤가, B2는 스모크 ⑤가 수동 검출 가능성을 제공하나, 스모크는 hash-보호 밖의 수동·사후 절차이고 craft loop의 iteration 판정은 run_test.sh 단독이므로 — C20의 존재 이유(구현자 선의 비가정·결정론적 고정)에 비추어 **완화가 blast radius를 실질 봉쇄하지 못한다**. B4·B5는 파괴적 게이트 승인 무결성 사슬이라 강등 금지 규칙 적용. 전원 CRITICAL 유지.

## Major Findings

**M1 — [신규] multi select-Esc 취소가 어디서도 단언되지 않는다.** plan 1-D multi: "select Esc = 취소". `multi:true` 테스트 전수에서 select가 `undefined`를 반환하는 유일한 지점은 recommended-cursor 테스트(`{C}/assets/test/ask.test.ts:726-737`)인데 **result를 버린다**(dialog만 단언). checked ≥ 1 상태의 mid-loop Esc는 아예 0건. single(`:716-722`)·confirm(`:895-899`)의 Esc 취소는 단언됨 — multi만 구멍. **반례**: mid-loop Esc를 "현재 checked로 finalize"로 처리하는 구현(사용자 취소가 제출로 둔갑) 전량 green. Confidence: HIGH. **Fix**: `makeSelectUI(["Beta", undefined])` + `multi:true` → `isError:true` + `/cancelled.*lsc_select/i` + selections 미유출 단언 1케이스 (B2 수정과 같은 절에 추가).

## Minor Findings

**m1** — `OTHER_OPTION` 리터럴 `"Other (type your own)"`(plan 1-C 정확 지정, 벤더 패리티)이 어떤 테스트에도 핀되지 않음(전 정본 grep 0건). DONE은 `"done (submit selections)"` 변형 리터럴로(`ask-adversarial.test.ts:427-437`, `fixtures.test.ts:747-759`), 두 envelope stem은 reserved-stem 리터럴·top-level content 리터럴로 핀됨 — Other만 누락. 표시 전용이라 결정 문법 무영향. Fix: `"other (TYPE YOUR OWN)"` 충돌 케이스 1줄.
**m2** — `checkedIndices` 정렬 순서 과잉 고정(`ask.test.ts:749-753`, Beta→Alpha 삽입에 `[0,1]` 요구). plan "재구성"은 순서 무계약, SDK 렌더는 순서 무관 — 합법 구현(삽입순 spread)의 false-RED 위험. 유지해도 무해하나 계약 밖 핀임을 기록.
**m3** — import 스타일 혼재: `ask-adversarial.test.ts:2-10`만 `"../src/ask.js"`, 나머지 정본·기존 관례는 bare(`"../src/ask"`, 메인 `test/ask.test.ts:5`). tsconfig가 test/를 빌드에서 제외하고 vitest는 양쪽 해석 — 기능 무해, 관례 일관성 nit.
**m4** — NB3(등록 순서 `toEqual`, `ask-schema.test.ts:68`)·NB4(multi blank-editor Esc 동치·재호출 cursor 미고정) — architect와 동일 판단.

## What's Missing (정본이 다루지 않는 것)

- B1-B5·M1의 케이스들(위 참조) — AC2 배선 seam·multi 음의 전이·parser 공통 도메인·실제 asset identity.
- E2E direct-trigger "정확히 1회" 단언(NB2) — `filter(toolName==="lsc_select").length === 1`.
- 기본 run green ≠ AC10 full green(NB1) — post-craft acceptance에 `LSC_E2E=1` 로그 필수를 운영 규율로.
- run_test.sh가 unit 범위를 mutable `vitest.config.ts`(include `test/**/*.test.ts`)·E2E 범위를 mutable `package.json:16`에 위임 — include 축소 false-green은 post-craft diff audit 몫(architect 유보에 동의; vitest는 no-test 시 exit 1이므로 전삭제는 loud).

## Ambiguity Risks

실질 위험 수준의 모호성 없음. `unpackDisplayRows`(`ask.test.ts:141-160`)·`validationMessage`(`:117-131`)가 `buildDisplayRows`/`validateSelectOptions` 반환 형태를 의도적으로 관용 수용(tuple/객체, message/throw) — 서로 다른 두 합법 구현이 모두 통과하는 것은 **의도된 구현 자유**로 판단(과잉 고착 회피와 상충 없음).

## Multi-Perspective Notes

- **Executor(craft 구현자)**: 정본만 보고 구현 시 Other 배선·toggle-off·zero-checked 경로를 빠뜨려도 green이 나온다 — RED→GREEN 신호가 이 3개 계약에 대해 무의미. B1-B3 수정이 곧 구현 가이드가 된다.
- **Stakeholder(파이프라인 게이트)**: 파괴적 게이트 사슬(confirm 정확 `yes`/`no`, sentinel 비승인, fixture confirmation-only 승인)은 이미 3중으로 강하게 고정됨(`ask.test.ts:869-878`, `ask-adversarial.test.ts:355-368`, `fixtures.test.ts:521-540`) — 잔여 위험은 fixture parse 도메인(B4)과 canonical asset(B5)에 집중.
- **Skeptic(steelman)**: "B1-B3은 helper+스모크+full-cycle로 자연 충족된다"는 반론은 C20의 전제(결정론적 canon이 구현자 선의를 대체)와 충돌 — 스모크는 수동, full-cycle은 질문 형태 무단언. 반대로 "모든 음의 전이를 추가하면 과잉 고착"이라는 우려는 이번 수정 목록이 사용자-가시 call 인자·상태 전이·parse 결과만 검사하므로 해당 없음.

## Verdict Justification

BLOCKING-급 false-green 5건(전부 독립 재구성 성립) + 신규 MAJOR 1건이 "전량 green ⇒ 계약 충족"을 깨므로 ACCEPT 계열 불가. 구조·결정성·R-1/R-2 binding 충족(아래)·envelope 문법·illegal-state 매트릭스·하니스 exit 의미론은 우수하고 수정이 표적화된 케이스 추가(~10개, 파일 2-3곳)에 그치므로 REJECT가 아닌 **REVISE**. 리뷰는 THOROUGH로 시작, blocking 확인 후 ADVERSARIAL로 격상(M1·m1-m3·OQ가 그 산출). Realist 재조정: B1·B2에 수동 스모크 완화 요인을 검토했으나 결정론적 canon의 목적 자체를 대체하지 못해 강등하지 않음("Mitigated by" 불충분 판정); B4·B5는 파괴적 승인 무결성이라 강등 금지.

**업그레이드 조건(재리뷰 시 확인 목록, 우선순위순)**:
1. **[P0/B1]** `ask.test.ts` AC2 절: single 첫 호출·multi 첫 호출 각각 `selectCalls[0].options.at(-1)?.label === OTHER_OPTION` 단언 + multi checked≥1 재호출에서 `[-2]===DONE, [-1]===OTHER` actual-call 단언.
2. **[P0/B2]** `["Beta","Beta","Alpha",DONE]` 시퀀스: 2번째 Beta 후 `checkedIndices: []` + 해당 call의 actual rows에 Done 부재 + 최종 `selections === ["Alpha"]`.
3. **[P0/B3]** UI: `multi:true` + `[OTHER]`+editor text → content 정확 `${FREE_ANSWER_SENTINEL} …`·details `{selections: [], freeText}`; fixture: `kind:"free-text"`+`multi:true` 동일 exact 쌍.
4. **[P0/B4]** `fixtures.test.ts` table-driven 복원: `version:3`·`version:"2"`·`answers` 부재·비배열·rule 비객체·`match` 부재·비문자열·`once:"true"` → path-rich 에러 8케이스.
5. **[P0/B5]** canonical `fixtures/sample-ts-cli/answers.json`을 `loadFixtureAnswerFile`로 실로드: 5개 태그 free-text body exact·2개 select-gate 라벨 exact·`"...Proceed?"` 질문의 first-hit이 select-gate 규칙(확인: proceed 규칙 선점 아님)·generic `Proceed?`→confirmation true·unmatched→default true. (대문자 "Proceed?" 사용 시 `matchesRule`의 `"i"` 플래그도 무료로 핀됨 — 현재 valid-regex 대소문자 무시가 어디에도 핀 안 됨.)
6. **[P1/M1]** multi select-Esc 취소 1케이스(checked≥1 포함).
7. **[P1/NB2]** test 6에 `lsc_select` 호출 수 === 1.
8. **[P2]** m1(OTHER 리터럴 핀)·NB3(순서 → 집합 비교)·NB4(multi blank-editor·재호출 cursor)·m3(import 스타일 통일).

## Open Questions (unscored)

- valid-regex 대소문자 무시(`matchesRule`의 `"i"`)는 plan상 불변 함수라 위험 낮음 — B5 수정이 자연 핀하므로 별도 케이스는 재량.
- `zod/v4`는 현재 devDep 부재(메인 `package.json` 확인) 상태에서 transitive hoisting에 의존 — cutover가 devDep을 추가하므로(P2-E) 정본 결함 아님; craft 시 lockfile 포함 여부만 diff audit에서 확인.
- `선택-index→ask` 소비 에러 케이스 부재는 plan §3 AC7 소비 매트릭스가 ask←selection·confirmation만 요구하므로 결함 아님(기록만).
- architect 리뷰의 B5 인용 `plan.md:229`는 실제 `:227` — 실질 무영향 정정.

---

*Consensus review summary row (Stage 4 합의 루프)*:
- **Architect findings cross-check**: B1 **동의**(반례 재구성 성립·Other 배선 무단언 실증) / B2 **동의**(toggle-off 시퀀스 0건 grep 실증) / B3 **동의**(양 ingress 부재 실증) / B4 **동의**(v1 기준선 :54-88 대조로 후퇴 실증) / B5 **동의**(plan :227 요구 실증, 인용 :229→:227 정정) / NB1-NB4 **동의**. 반박 0건, 신규 발견 1건(M1) 추가.
- **Principle/Option Consistency**: **Pass** — 정본이 plan 채택안(행 반복 직렬화·tagged union·채널 공통 preflight·canonicalizer 단일 소유·DONE 전역 예약·R-1/R-2)만을 고정하고 기각 대안을 강제하는 단언 없음; 테스트 간 상충 0건.
- **Alternatives Depth**: **Pass** — "helper 유지 + 최소 반례 통합" 전략은 타당하고 architect tradeoff 표와 정합; 수정 목록도 그 전략 안에서 닫힘.
- **Risk/Verification Rigor**: **Fail** — B1-B5·M1 해소 전에는 AC2/AC7의 계약 고정이 불완전하고 프리모템 P6 대응 공백.
- **Deliberate Additions**: **부분 Fail** — 프리모템 대응: P1 ✓(`ask.test.ts:772-786`+`ask-adversarial.test.ts:370-390`) P2 ✓(v1 targeted·blank·free-text default 거부) P3 ✓(exact-equality 반례 양 채널) P4 ✓(위장 매트릭스 전종) P5 ✓(build gate) **P6 ✗(B2·M1)** P7 수동(설계상 타당); 확장 테스트 4계층(unit/integration/e2e/observability-details)은 전부 존재.