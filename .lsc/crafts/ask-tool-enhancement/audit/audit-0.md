# Audit — ask-tool-enhancement (cycle 0)

## Header

| 항목 | 값 |
|---|---|
| Feature | ask-tool-enhancement — lsc_ask/lsc_select/lsc_confirm v2 고도화 |
| 감사일 | 2026-07-15 |
| Audit cycle | N = 0 (첫 감사, `audit/` 디렉터리 없음 → **full audit** 경로) |
| 구현 브랜치 | `feat/ask-tool-enhancement` |
| 워크트리 | `.lsc/worktrees/ask-tool-enhancement/` (C6/R5 — 항상-워크트리, escape hatch 미사용) |
| Base(merge target) 브랜치 | `feat/lets-craft-v1` (fork point `c39a725`; origin/HEAD가 이를 가리키며 merge-base와 일치) |
| 구현 커밋 | `daf2143` (단일 원자 cutover — `19a9d27..HEAD`) |
| 선행 감사 | 없음 (N=0) |
| 판정 근거 | lsc-critic `REVISE` + lsc-explore 수렴 + 자체 compliance matrix + 독립 테스트 재실행(run-3) |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

> 형식 주: 이 라인의 prefix `**AUDIT VERDICT:`는 아래 §"Full lsc-critic report"에 인용된 lsc-critic 자신의 `**VERDICT: REVISE**` 라인과 **의도적으로 구별**된다. Phase 7 E2E 하네스는 `^\*\*AUDIT VERDICT:`만 grep해야 하며(단순 grep은 critic sub-verdict를 먼저 매칭함), 이 문서에 `**AUDIT VERDICT:` 라인은 위 하나뿐이다.

---

## 판정 요약

구현의 **코드 절반은 spec 대비 사실상 결함이 없다**: build green, 495 passed | 8 skipped(감사 단계 독립 재실행 run-3에서 재확인), canonical 테스트 자산 byte-identical/무변조(자체 `lsc_verify_hash` + critic 독립 확인), plan이 우려한 4대 실패 모드(envelope 단사성·게이트 안전성·canonicalizeFreeText 7종·fixture silent field-drop) 전부 방어됨.

그러나 **AC8의 README 재작성이 통째로 누락**되었고 커밋 메시지는 이를 했다고 **허위 기재**했으며, **AC10은 3계층 검증 중 1계층(unit)만 입증**되었다(E2E·TUI 스모크 미실행/미기록). CRITICAL은 없으나 명명된 AC 산출물(AC8 README)이 미충족이고 provenance가 거짓이므로 land 전 반드시 시정해야 한다 → **APPROVE-WITH-CHANGE** (§7.1: 이번 사이클 land 불가, §6.1 craft 재호출로 시정).

---

## Spec Compliance Matrix (AC1–AC10)

각 행의 Status는 인용된 file:line을 **직접 열람**하고 기록했다(§3.2 — 하위 에이전트 주장 전사 아님).

| AC | 요건 | Status | 근거 (직접 확인한 file:line) |
|---|---|---|---|
| AC1 | 신스키마: options 2-4 `{label, description 필수}`, `multi?`, `recommended?` 유효 인덱스 | **Met** | `src/ask.ts:580-597` — `z.array(selectOptionSchema).min(2).max(4)`, `description: z.string().min(1)`(:572), `recommended: z.number().int().min(0).optional()`(:591-595), `prefill` optional·`placeholder` 제거(:549). `test/ask-schema.test.ts` 경계 단언 green(17 tests) |
| AC2 | 자유답변 무조건 상시: Other 자동 append, editor 체인, editor Esc→select 복귀 | **Met** | `buildDisplayRows`가 항상 `OTHER_OPTION`을 최종행 push(`:306`), Done은 multi&checked>0에만(`:305`); `promptFreeText` editor 체인(`:114-119`); 호출자 Other 삽입 거부(`:250-252`) |
| AC3 | 구조체+병기 envelope: selections·freeText 둘 다 직렬화, 행 순서 고정, 멀티라인 들여쓰기 | **Met** | `serializeEnvelope`(`:73-83`) — 선택당 `User selected: <label>` 1행(offered order), sentinel 블록 항상 마지막, 멀티라인 2-space 들여쓰기(`:78`); `selectResult`가 details에 둘 다 보존(`:91-93`). 콤마-경계 단사성 방어 확인 |
| AC4 | confirm 재구성: select 기반 Yes/No/Other, `confirmed: boolean\|null` | **Met** | `performConfirm`(`:486-526`) — `[Yes, No, Other]` select(`:509`), Yes→true·No→false·Other→editor→null+freeText(`:514-522`), select Esc→isError(`:513`); `confirmResult`(`:104`) null→sentinel 블록, else 정확 `yes`/`no` |
| AC5 | ask editor 승격: 멀티라인, `placeholder` 제거·`prefill` 대체 | **Met** | `performAsk`(`:135-161`) `ui.editor` 경유(`:156`), `prefill` 전달, canonical 저장(`:117`); `AskUI.editor`(`:131-133`); zod에 placeholder 없음 |
| AC6 | recommended 표시+커서 전용, 반환 오염 없음, timeout 없음 | **Met** | `buildDisplayRows`가 `RECOMMENDED_SUFFIX`를 표시 라벨에만 부착(`:301`)하고 `displayToCanonical` Map으로 정본 복원(`:303`); 반환 selections는 정본 라벨(오염 없음); `validateSelectOptions`가 접미사-후 표시 중복 거부(`:275-282`). timeout/자동선택 코드 없음 |
| AC7 | fixture v2: freeText 필드, select 게이트 규칙, 구포맷 거부 에러, answers.json 갱신 | **Met** | `src/fixtures.ts:30-47` tagged union(free-text/selection/selection-index/confirmation), `parseFixtureAnswerFile`(`:251-328`) v1 targeted 거부, `fixtures/sample-ts-cli/answers.json` v2(daf2143 diff에 포함) |
| AC8 | 소비자 co-evolution: SKILL 3종 + README fixture 절 재작성 + craft-tool description | **PARTIAL — README 미충족** | SKILL 3종 개정 완료(daf2143), `src/craft/{abort,release,hash-manifest}.ts` description 보강 완료. **그러나 `README.md`는 daf2143 diff에 전혀 없고**(`git diff --stat 19a9d27..HEAD -- README.md` 공백), `README.md:267,269,275-277`은 여전히 v1(`"default":"yes"`, `response`, `optionIndex`) — 배포된 v2 파서가 거부하는 포맷을 문서화 중 |
| AC9 | description 품질 게이트: `.describe` annotation + SKILL SSOT 2계층 | **Met** | `.describe`에 WHAT/WHY/장단점/쉬운 언어 규칙 인코딩(`:566-596`); pre-craft SKILL §1.2 SSOT(explore 확인). 리뷰로 검증(spec AC9 명시) |
| AC10 | 3계층 검증: (a) unit red→green, (b) E2E 무파손, (c) TUI 스모크 | **PARTIAL — (a)만 입증** | (a) unit green: run-3 재실행 확인(495 passed). **(b) E2E: `LSC_E2E=1` 미실행** — run-1/2/3 모두 `=== gated e2e: SKIPPED ===`, enforcement-rules 6 + E2E 2 self-skip. **(c) TUI 스모크: 7항목 체크리스트 미기록** |

---

## Plan Compliance Matrix (§2 Step 1-4, §5 ADR)

| Step/항목 | Status | 근거 |
|---|---|---|
| Step1-A~H 코드 절체 | **Met** | `src/ask.ts` 전면 재구성(632행), 타입·포트·performX·상수 전부 계획대로. `parseYesNo`/`ConfirmUI` 삭제(`git grep` 잔존 0) |
| Step1 원자 cutover(단일 커밋) | **Met(코드) / 소비자 집합 불완전** | daf2143 단일 커밋이나 README·manifest가 커밋 집합에서 누락 |
| 1-C envelope 문법 | **Met** | `serializeEnvelope`(`:73-83`) 계획 문법 그대로; 단사성 방어(행 반복) 확인 |
| 1-C 채널 공통 preflight 순서 | **Met** | `validateSelectOptions`(`:236-285`)가 unavailable 후·dispatch 전 실행; run-1의 "reports the headless unavailable error before an invalid-label diagnostic" green |
| 1-C `canonicalizeFreeText` (7종) | **Met** | `src/fixtures.ts:57-59` — `/\r\n/→\n` 후 `[\r\u000B\u000C\u0085\u2028\u2029]→\n`(VT/FF 포함), 멱등. 직접 확인 |
| 1-F union + exact allowlists | **Met(런타임)** | 파서 v2 union + rule/default/top-level allowlist. **단, exported 타입 `selections: string[]`은 계획 `:132`의 `[string, ...string[]]` 튜플보다 느슨**(런타임만 non-empty 강제 — MINOR 편차) |
| 1-I craft-tool description | **Met** | `src/craft/{abort,release,hash-manifest}.ts` 로직 불변, confirm 시맨틱 description만 보강 |
| Step2 fixture 아티팩트 | **PARTIAL — README 재작성 MISSING** | answers.json v2·enforcement 인라인 fixture v2 완료, **README 미개정** |
| Step3 SKILL SSOT | **Met** | pre-craft SSOT + craft/post-craft 참조 + 게이트 자유답변 분기(content envelope 기반) |
| Step4 통합 검증 | **PARTIAL — E2E/스모크 미입증** | unit tier만 실행·기록 |
| §2/DR-D7/P2-E: zod devDep 명시 | **Unmet(계획 이탈)** | `package.json` root devDeps에 zod 없음; `test/ask-schema.test.ts:1`의 `import zod/v4`는 lock의 transitive/peer 설치에 의존(현재 해상되어 green이나 재현성 리스크) |
| §5 ADR 준수 | **Met** | ctx.ui.select/editor 조합, auto-append Other→editor, multi 루프, content envelope — ADR 그대로 |

---

## Code Quality & Regression Risk

lsc-explore(구조·커버리지 매핑)와 lsc-critic(적대적 리뷰)의 수렴/발산을 종합했다. 두 에이전트가 독립적으로 같은 이슈를 지목한 항목은 higher-confidence로 표기한다.

### MAJOR-1 — README.md fixture 절 미재작성 (AC8 미충족 + Constraint 6 클린컷 위반 + 커밋 provenance 허위) · **수렴(critic MAJOR-1 ∧ explore Files/Evidence), HIGH**
- **증거(자체 확인)**: `git diff --stat 19a9d27..feat/ask-tool-enhancement -- README.md` 공백 — 15파일 커밋 daf2143에 README 부재. `README.md:267` `"default":"yes"`, `:269` `"response"/"optionIndex"`, `:275-277` v1 서술 잔존. 배포된 파서 `src/fixtures.ts:251-286`은 version 2 + kind body만 허용하며 v1을 명시 거부.
- **순환 결함**: 배포된 파서 에러 문구가 사용자를 README 가이드로 안내하는데, 그 README가 v1(잘못된 포맷)이다 — README를 따라 fixture를 작성하면 즉시 parser error.
- **provenance**: daf2143 커밋 메시지 `what:`이 "README fixture 절 재작성"을 주장하나 실제 변경 0. `verify:`는 plan §7-2(c) README-잔존 체크를 누락 — 이 단계가 있었으면 MAJOR-1을 잡았을 것.
- **완화**: `answers.json`은 v2로 올바르게 갱신되어 파이프라인 내부 실행은 무영향(샘플 fixture 정상). doc/provenance 결함이지 런타임/데이터/보안 결함 아님 → MAJOR(≠CRITICAL).

### MAJOR-2 — AC10 3계층 중 1계층만 입증 (E2E·TUI 스모크 미실행/미기록) · **수렴(critic MAJOR-2 ∧ explore AC10b caveat), 미기록 HIGH / 실패가능성 LOW**
- **증거(자체 확인)**: run-1/2/3 로그 모두 `=== gated e2e: SKIPPED (set LSC_E2E=1) ===`. `run_test.sh:54`가 기본 vitest에서 `LSC_E2E=`를 비우고, `:59-61`만 `LSC_E2E=1`일 때 실제 omp 3-file E2E 실행. daf2143 `verify:`는 'e2e self-skip'만 기록.
- **함의**: 기본 green은 `registerAskTools`→실제 omp ctx.ui/NDJSON 연동·신규 direct lsc_select E2E를 실행하지 않고 unit performX만 검증한다.
- **완화**: E2E 하네스는 v2-correct임이 입증됨(enforcement-rules 인라인 fixture v2 이관, e2e-helpers.ts details 보존). on-demand 실행 가능하며 self-skip은 비용상 설계된 동작. TUI 스모크(AC10c)는 본질적으로 실제 대화형 omp 세션의 육안 확인이라 자동화 불가.

### MINOR — 저위험 (non-blocking)
- **M1. `FixtureAnswerBody.selection.selections` 타입 편차** (explore, MINOR): `src/fixtures.ts:32` `string[]` vs 계획 `:132` `[string, ...string[]]`. 파서 런타임(`:223 부근`)이 non-empty 강제하므로 동작은 정확하나 exported 타입이 empty array를 허용 — 계획-구현 타입 계약 silent 편차.
- **M2. zod devDep 미선언** (explore, 계획 이탈): 상기 Plan Matrix 참조. 현재 transitive 해상되어 green이나 SDK가 zod 의존을 끊으면 `import zod/v4`가 깨짐 — 재현성 리스크.
- **M3. dead-defensive `?? ""`** (critic MINOR-1, 자체 확인): `src/ask.ts:104` `serializeEnvelope([], freeText ?? "")` — `confirmed===null` 경로는 항상 non-blank freeText를 공급(fixture `:502` body.freeText 파서 nonblank 보장, UI `:522` promptFreeText 정의값)하므로 `?? ""`는 도달 불가. 무해.
- **M4. 커버리지 gap (정적, explore, 저위험)**: `src/ask.ts:147-149,334-336,497-500`의 fixture `answers.match` no-match catch는 performX 경유 테스트 없음(순수 `FixtureAnswerSet.match` throw만 `test/fixtures.test.ts:493-495`); UI retry 분기 `:414-417,447-450,520-522`(unknown SDK label / confirm reset) 직접 호출 테스트 없음; 파서 `:252`(raw non-object)·`:285`(non-object default)·`:311-313`(empty env/flag) 직접 단언 없음; 테스트 헬퍼 `validationMessage`(throw catch)·`unpackDisplayRows`(임의 row-array 탐색)·ask-schema `CapturedToolDefinition`(name/parameters만)이 정확 계약을 pin하지 않음. 구현 shape/return은 현재 정확하나 plausible regression을 놓칠 여지.

### 회귀 안전성 (positive)
- **테스트 자산 무변조**: 6개 canonical 자산과 소스루트 재생성 사본 SHA-256 일치(ask `9bce…`, fixtures `3afae4…`, adversarial `febf715…`, schema `84d4a6…`, enforcement `b3110d…`, e2e-helper `dfa9d2…`); 자체 `lsc_verify_hash` = 9 asset unchanged.
- **hard-coding smell 없음**(critic): envelope를 공유 상수에서 계산, 테스트 입력 특수분기 없음.
- **dangling reference 0**: `git grep -nE 'parseYesNo|ConfirmUI|placeholder' -- src` = 0.

---

## Test Re-verification (§3.4 — craft 기록과 독립)

- **실행**: `lsc_run_tests(ask-tool-enhancement)` (동일 세션이 active craft 유지 중이라 trusted-exec 경로 성공) → **PASS, exit 0**. 로그: `.lsc/crafts/ask-tool-enhancement/test/logs/run-3.log`.
- **결과**: build PASS(tsc), `20 files passed | 3 skipped`, `495 tests passed | 8 skipped`. expected-red 4종(ask 111 / fixtures 110 / ask-adversarial 75 / ask-schema 17) 전부 green, must-stay-green(preset-*/craft-*/artifacts-*/e2e-helpers) 무회귀.
- **E2E**: `LSC_E2E` unset → `enforcement-rules.test.ts` 6 + E2E 2 self-skip(=8 skipped). **AC10(b) 미실행**(MAJOR-2).
- **판정 게이트(§4.2 point 1)**: unit tier PASS → REJECT 강제 아님. 그러나 E2E/스모크 미입증은 APPROVE/APPROVE-WITH-COMMENT를 차단(AC10 PARTIAL).

---

## Required Fix (APPROVE-WITH-CHANGE — craft 재호출 대상)

> 다음 감사 사이클은 이 수정을 검증하는 **fix-verification(narrower) 경로**(post-craft §5)로 실행된다 — full audit보다 좁고 빠르지만 건너뛰지 않는다. 이 좁힘은 파이프라인의 의도된 설계이지 코너 컷이 아니다.

**F1 (필수, craft 구현 가능) — README.md fixture 절 v2 재작성 [MAJOR-1 / AC8]**
- `README.md:259-280`(`### LSC_FIXTURE 응답 주입 모드`)를 plan §Step2(`:173`)의 v2 tagged-union 스키마로 재작성:
  - JSON 예시: `"version": 2`, `answers` 배열, `default`(free-text 아닌 body).
  - 4개 kind 표(free-text / selection / selection-index / confirmation) × 필수 필드 × 소비 도구.
  - 키 allowlist 3종: rule(`match`/`once`/`kind` + variant), top-level(`version`/`answers`/`default` + `_` prefix), default(body 필드만·free-text kind 금지).
  - freeText blank 금지(canonical 정규화-후-trim 기준) + mandatory-break 7종(VT/FF 포함) `\n` 정규화 1줄.
  - multi × selection-index 금지 1줄.
  - v1→v2 마이그레이션 노트(response→kind 매핑 + version:2 필수).
  - v1 어휘(`response`, bare `"default":"yes"`, `optionIndex` fallback 서술) 잔존 0.
- 수정 커밋 provenance 정정: `what:`에 허위 "README rewritten" 재기재 금지, `verify:`에 README v1-어휘 grep=0 체크 포함.

**F2 (필수 — AC10(b) 증거) — E2E green 실행·기록 [MAJOR-2]**
- omp 플러그인 링크가 워크트리를 가리키는 상태에서(run_test.sh가 검증) `LSC_E2E=1 .lsc/crafts/ask-tool-enhancement/test/run_test.sh`를 green으로 실행하고 결과를 기록. **실 모델/토큰·플러그인 링크가 필요**하므로 craft 실행 환경이 이를 지원하지 않으면, AC10(b)를 human pre-land 게이트로 유예한다는 명시적 disposition을 기록.

**F3 (필수 — AC10(c) 증거, human-gated) — TUI 스모크 체크리스트 [MAJOR-2]**
- plan Step 4의 7항목 체크리스트(① 3도구 description 렌더링 ② Other→editor 왕복·editor Esc→select 복귀 ③ select Esc 취소 ④ recommended 표시+커서+반환 무오염 ⑤ multi 토글·Done·혼합 병기 ⑥ 한국어 description ⑦ compact 발동)는 **실제 대화형 omp 세션의 육안 확인**이라 craft executor가 자동화할 수 없다 → **human pre-land 게이트**로 명시하고, land 전 수행·기록.

**F4 (권장, non-blocking — 클린컷 완결도)**
- M2: `package.json` root devDeps에 `zod` 명시 선언 + `package-lock.json` 갱신(plan §2/DR-D7/P2-E).
- M1: `FixtureAnswerBody.selection.selections`를 `[string, ...string[]]`로 좁혀 런타임 invariant와 타입 일치.
- M3: `src/ask.ts:104` dead `?? ""` 제거.
- M4: 최소 커버리지 보강(no-match performX catch, unknown UI retry, 파서 non-object/default, `buildDisplayRows` 정확 return shape, `validateSelectOptions` non-throw 계약).

---

## Non-blocking Considerations

F4(M1-M4)는 land을 차단하지 않는 개선 항목이다. 특히 M2(zod devDep)는 현재 transitive 해상으로 green이므로 즉시 파손은 아니나, 클린컷·재현성 관점에서 다음 fix 사이클에 함께 반영하는 것을 권장한다.

---

## Proposed Spec/Plan Amendments

**없음.** 모든 발견은 **구현/검증-증거 gap**이지 spec.md/plan.md 자체의 결함이 아니다 — plan은 정확하며(README 재작성·zod devDep·튜플 타입·E2E/스모크를 모두 명시), 구현이 이를 따라잡으면 된다. (AC10(c) TUI 스모크가 human-only인 점도 plan Step 4가 이미 "체크리스트를 검증 기록으로 남김"으로 명시 — spec 오류 아님.) 따라서 §6.2 amendment 게이트는 발동하지 않는다.

---

## Full lsc-explore report (verbatim)

```json
{
  "Findings": {
    "Files": "변경된 구현/소비자 파일은 fixtures/sample-ts-cli/answers.json, src/ask.ts, src/fixtures.ts, src/craft/{abort,release,hash-manifest}.ts, skills/{pre-craft,craft,post-craft}/SKILL.md 및 테스트 6개(test/ask*.test.ts, test/fixtures.test.ts, test/enforcement-rules.test.ts, test/e2e-helpers.ts)이다. 계획이 요구한 README.md와 package.json/package-lock.json은 diff에 전혀 없다.",
    "Root cause": "v2 ask/fixture 코어 절체 자체는 연결되어 있으나, 계획이 명시한 README·manifest 공동 절체가 빠졌고, 기본 검증 경로가 실제 omp E2E를 건너뛰므로 소비자 계약과 wrapper 통합에는 검증 공백이 남는다.",
    "Evidence": [
      "진입 흐름: src/main.ts:13-24가 LSC_FIXTURE flag를 등록하고 registerAskTools(pi)를 호출한다. src/ask.ts:558-630(현 :541-631)이 pi.getFlag/ctx.hasUI를 resolveAskChannel에 연결한 뒤 performAsk(editor), performSelect(preflight→fixture/UI), performConfirm(Yes/No/Other)로 dispatch한다.",
      "src/fixtures.ts:17-58,105-154,251-328가 env/flag detection, v2 tagged union parser, canonicalizer, first-hit/once/default matcher, path-keyed cache를 소유한다. src/ask.ts:17(현 :23)이 canonicalizer를 재사용하여 UI/fixture ingress를 동일화한다.",
      "README는 실제로 v1 예시를 남긴다: README.md:267의 \"default\":\"yes\", :269의 response/optionIndex, :275-277의 v1 설명. 반면 parser src/fixtures.ts:251-286은 version 2와 kind body만 허용하며 v1을 명시적으로 거부한다. 계획의 README 재작성·v1 어휘 잔존 0 수용 기준은 plan.md:165-175에 있다.",
      "plan.md:8,286-288은 package.json/package-lock.json에 zod devDependency를 추가하도록 요구한다. 실제 package.json:14-18 root devDependencies에는 zod가 없고, 직접 import는 test/ask-schema.test.ts:1의 zod/v4이다. lock에는 peer 자동 설치로 /node_modules/zod가 존재하지만 root direct declaration은 없다.",
      "타입 계약 mismatch: 계획 plan.md:131-135는 selection.selections: [string, ...string[]]을 요구하는데 구현 src/fixtures.ts:30-34는 string[]이다. parser src/fixtures.ts:223-230의 runtime non-empty 검증은 있으나 exported type은 empty array를 허용한다.",
      "src/craft/abort.ts:51-57, src/craft/hash-manifest.ts:309-313, src/craft/release.ts:63-67는 실행 로직 변경 없이 lsc_confirm의 exact yes/no와 free-answer 재질문 semantics만 description에 추가한다. dangling reference 확인은 git grep -nE 'parseYesNo|ConfirmUI|placeholder' -- src 결과 0이다.",
      "Canonical test assets와 regenerated /test copies는 SHA-256가 일치한다(ask 9bceca…, fixtures 3afae4…, adversarial febf715…, schema 84d4a6…, enforcement b3110d…, e2e-helper dfa9d2…). Unit/parser suite는 313 tests green, craft run log 495 passed이지만, run_test.sh:54,59-61가 기본 Vitest에서 LSC_E2E를 비우고 실제 E2E를 gated 실행한다. run-2.log:38-40,47-60은 enforcement-rules 6개와 E2E 8개가 skipped임을 보여준다.",
      "Coverage gaps: src/ask.ts:147-149,334-336,497-500의 fixture answers.match exception-to-isError catches는 no-match fixture를 performX에 넣는 테스트가 없다(순수 FixtureAnswerSet.match의 throw만 test/fixtures.test.ts:493-495에서 확인). UI retry branches src/ask.ts:414-417,447-450,520-522(unknown SDK label/confirm response reset)는 직접 호출 테스트가 없다. parser raw non-object/default non-object src/fixtures.ts:252,285, empty env/flag fallback :311-313, v2 default의 stale response allowlist branch, non-string variant values도 직접 assertion이 없다.",
      "Coverage quality gaps: test/ask.test.ts의 validationMessage helper는 invalid case에서 validateSelectOptions가 throw해도 catch하여 동일 메시지로 바꾸므로 string-return contract를 고정하지 않는다. display-row unpack helper는 임의 row-array+Map을 찾아 {rows,displayToCanonical} 정확 key shape를 고정하지 않는다. test/ask-schema.test.ts:19-27의 captured tool definition은 name/parameters만 검사하고 tool description, approval:\"read\", execute/channelFor wrapper를 검사하지 않는다. 실제 wrapper/NDJSON details 경로는 optional LSC_E2E에서만 실행된다."
    ]
  },
  "Impact": {
    "Scope": "cross-module",
    "Risk": "high",
    "Affected areas": "README를 따라 fixture를 작성하는 사용자(즉시 parser error), fresh install 및 test loader의 zod dependency resolution, registerAskTools의 실제 omp/NDJSON 실행 경로, craft 도구 description을 해석하는 모델, 그리고 v2 fixture migration 문서 신뢰성"
  },
  "Relationships": "main.ts가 ask tools와 --lsc-fixtures alias를 등록한다. ask.ts는 detectFixturePath→resolveAskChannel로 fixture가 UI보다 우선하고, headless+무fixture는 hard error로 끝낸다. fixture mode에서는 FixtureAnswerSet.match가 반환한 kind를 performAsk/performSelect/performConfirm가 각각 소비하고, UI mode에서는 ctx.ui.editor/select port를 사용한다. performSelect는 unavailable 판정 후 양 채널 공통 validateSelectOptions를 실행하고, UI 쪽만 buildDisplayRows/display-to-canonical Map과 Other/Done 루프를 사용한다. skills의 pre-craft §1.2가 CONTENT envelope와 free-answer gate semantics의 SSOT이고 craft/post-craft가 이를 참조한다. sample answers와 enforcement inline fixtures가 이 tagged body를 공급하며, e2e-helpers.ts가 tool_execution_end.details를 보존해 enforcement direct-select assertion으로 연결한다. craft abort/release/hash-manifest는 이 confirm CONTENT semantics를 description으로만 소비하고 state mutation은 기존 core에 위임한다.",
  "Recommendation": [
    "README.md:259-280을 v2 {version, answers, default} 및 네 kind의 필수/소비 도구 표, selection-index의 명시적 의미, default free-text 금지, migration 예시로 재작성하고 response/bare default/fallback optionIndex 서술을 제거한다.",
    "계획대로 zod를 root devDependencies에 직접 선언하고 lockfile을 갱신하여 test/ask-schema.test.ts의 직접 import가 transitive peer 설치에 의존하지 않게 한다.",
    "FixtureAnswerBody selection을 [string, ...string[]]로 고쳐 parser의 runtime invariant와 exported type을 일치시킨다.",
    "최소 coverage 보강으로 fixture no-match→performX catches, unknown UI retry loops, parser non-object/default and stale-response default, 그리고 exact buildDisplayRows return shape/validateSelectOptions non-throw contract을 고정한다.",
    "별도 gated 실행에서 LSC_E2E=1을 실제로 돌려 registerAskTools→omp→NDJSON details 경로를 증명하거나, 이 경로를 기본 canonical verification에서 의도적으로 제외한다는 명시적 audit disposition을 남긴다."
  ],
  "Next Steps": [
    "주요 README·manifest 누락과 타입 mismatch는 lsc-executor 수정 대상으로 넘기고, E2E gate/coverage significance는 lsc-critic이 AC10 및 plan §Step 4 against 판단을 내린다.",
    "이 보고서는 구조·coverage map이며 디자인 품질 판정은 하지 않았다. Ready for main-session four-level verdict synthesis."
  ]
}
```

## Full lsc-critic report (verbatim)

```json
{
  "verdict": "REVISE",
  "mode": "THOROUGH (no ADVERSARIAL escalation — no CRITICAL, no systemic pattern)",
  "overall": "Code half is essentially flawless vs spec (build green, 495 passed | 8 skipped verified independently, canonical test assets byte-identical/untampered, all 4 plan-worried failure modes defended). But AC8's README rewrite is entirely missing while the commit falsely claims it was done, and AC10 is only 1/3 verification tiers evidenced.",
  "independently_verified": {
    "tsc_build": "exit 0",
    "vitest_run": "495 passed | 8 skipped (matches craft claim); ask 111 / fixtures 110 / ask-adversarial 75 / ask-schema 17 all green",
    "test_asset_integrity": "all 6 source-root test files byte-identical to canonical hash-protected set — no tampering",
    "hard_coding_smell": "none — implementation computes envelopes from shared constants, no test-input special-casing",
    "canonicalizeFreeText_7_mandatory_breaks": "confirmed: /\\r\\n/->\\n then [\\r\\u000B\\u000C\\u0085\\u2028\\u2029]->\\n (VT/FF included), idempotent",
    "envelope_injectivity": "confirmed: per-selection line repetition + single-line label guard defeats comma-boundary counterexample",
    "gate_safety": "confirmed: literal free-text 'yes' -> 'User provided free answer: yes', content.trim() !== 'yes'",
    "fixture_silent_field_drop": "confirmed defended: checkAllowedKeys exact allowlist rejects stray 'response' with targeted v1 migration error"
  },
  "critical_findings": [],
  "major_findings": [
    {
      "id": "MAJOR-1",
      "title": "README.md fixture section not rewritten (AC8 unmet, Constraint 6 clean-cut violation) + false commit provenance",
      "evidence": "git diff --stat 19a9d27..feat/ask-tool-enhancement -- README.md is EMPTY; README absent from 15-file commit daf2143; README.md:269 still v1 {match:...,response:...,optionIndex:0} (no version:2, no kind) which the shipped v2 parser rejects (fixtures.ts:243-251). Commit what: claims 'README fixture 절 재작성'; verify: omits plan §7-2(c) README-residue check. answers.json _note WAS migrated to v2, proving craft handled v2 docs elsewhere but silently missed README. Compounding: shipped parser errors (fixtures.ts:96-98 and :161-164) point users to README guidance that is v1/absent (circular).",
      "confidence": "HIGH",
      "severity_rationale": "Loud-failure doc + provenance defect, not runtime/data/security — MAJOR not CRITICAL. Sample answers.json is v2-correct so pipeline-internal runs unaffected.",
      "fix": "Rewrite README.md:259-280 to v2 tagged-union schema (4 kinds, top-level version/answers/default/_* allowlist, per-tool consumption matrix, blank-freeText + mandatory-break normalization note, multi×selection-index prohibition, v1->v2 migration note). Correct commit what:/verify: provenance."
    },
    {
      "id": "MAJOR-2",
      "title": "AC10 three-tier verification only 1/3 evidenced (E2E + TUI smoke unexecuted/unrecorded)",
      "evidence": "Commit verify: records only 'e2e self-skip'; run-2.log shows '=== gated e2e: SKIPPED (set LSC_E2E=1) ==='. Plan §7-4/Step 4 require npm run e2e (LSC_E2E=1) green + 7-item TUI smoke checklist recorded — no such record. My own vitest run reproduced enforcement-rules(6)+e2e(2) as skipped.",
      "confidence": "HIGH that unrecorded; LOW that they would fail",
      "severity_rationale": "AC10 is an explicit 3-tier criterion, only tier-1 executed. Mitigated: E2E harness provably v2-correct (inline fixtures migrated enforcement-rules.test.ts:151-153,335-337; e2e-helpers.ts:281-298 details?), runnable on demand, self-skip by design for cost.",
      "fix": "Run npm run e2e (LSC_E2E=1) to green and record; perform+record TUI smoke checklist, or explicitly hand AC10(b)(c) to human as pre-land gate."
    }
  ],
  "minor_findings": [
    {
      "id": "MINOR-1",
      "title": "Dead-defensive ?? '' in confirmResult",
      "evidence": "ask.ts:108(현 :104) serializeEnvelope([], freeText ?? '') — every confirmed===null path supplies nonblank freeText; unreachable trailing-space envelope. Harmless, noted for maintainer."
    }
  ],
  "whats_missing": [
    "README v2 rewrite (only missing consumer artifact)",
    "recorded E2E-green run (AC10b)",
    "recorded TUI smoke checklist (AC10c)",
    "README migration note referenced by shipped parser errors but never written",
    "commit verify: does not evidence plan §7-2(c) README-residue check — the omitted step that would have caught MAJOR-1"
  ],
  "ac_matrix": {
    "AC1": "Met", "AC2": "Met", "AC3": "Met", "AC4": "Met", "AC5": "Met",
    "AC6": "Met", "AC7": "Met", "AC8": "PARTIAL — README portion UNMET", "AC9": "Met",
    "AC10": "PARTIAL — only tier(a) evidenced"
  },
  "plan_matrix": {
    "Step1_code": "Met", "Step1_atomic_cutover": "Met code / consumer set incomplete (README)",
    "1C_envelope_grammar": "Met", "1C_preflight_ordering": "Met", "1C_canonicalizeFreeText": "Met (all 7 breaks)",
    "1F_union_allowlists": "Met", "1I_craft_tool_desc": "Met",
    "Step2_fixture_artifacts": "PARTIAL — README rewrite MISSING", "Step3_SKILL_SSOT": "Met",
    "Step4_integration_verify": "PARTIAL — E2E/smoke unevidenced", "ADR_honored": "Met"
  },
  "verdict_justification": "REVISE not REJECT: implementation is sound, no CRITICAL. REVISE not ACCEPT-WITH-RESERVATIONS: a named AC deliverable (AC8 README) is unmet, commit provenance is false, AC10 is 1/3 evidenced — all must be remedied before land. Upgrade to ACCEPT once README rewritten, commit what:/verify: corrected, and E2E/TUI-smoke evidence recorded.",
  "open_questions": [
    "Was TUI smoke (AC10c) done interactively but not recorded? Cannot refute from artifacts.",
    "Was E2E run green with LSC_E2E outside recorded logs? No evidence either way."
  ]
}
```
