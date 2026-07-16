# Trace — release-gate (lsc_craft_release 승인 게이트 패키지: A-1 nonce + A-2 open-release 증거 + A-3 상태 토큰화)

- 기준 HEAD: cc17764 (feat/release-gate 워크트리 분기점)
- 정본: `_docs/reference-insights.md` A-1(:29-33)/A-2(:35-39)/A-3(:41-44), `.omc/plans/ralplan-reference-insights-impl.md` Phase 4 미션 브리프(:68) + land 예외 조항
- 분류: **Brownfield** — git 이력 실재, 정본이 `src/craft/*.ts` file:line 인용, 피처가 기존 도구(`lsc_craft_release`) 개조. Stage 2는 brownfield 공식 사용.
- Lane 구성: 5 lanes (code-path / orchestration / premise-audit / adversarial / test-harness), 전원 Lane_Discipline 준수, 수렴 판정은 본 종합에서만.

---

## 1. Observed Result

lets-craft의 문서화된 유일한 보안 MEDIUM: `lsc_craft_release`(해시 보호 해제 도구)가 사용자 승인 없이 실행 가능하다.

실측 (Lane 1/4, Tier 1-2):
- `release.ts:68`의 `approval:"read"`는 omp SDK의 **tier 분류 필드일 뿐 게이트가 아니다**. 유일 소비자는 tool wrapper의 `requiresApproval()`이며, 설정 기본값 `yolo`(settings-schema.ts:3336)에서는 `approval.ts:102-103`이 tier 비교 자체를 건너뛰고 무조건 allow. 효과는 "omp 승인 프롬프트를 띄우지 않음"이 전부.
- `performCraftRelease`(release.ts:25-40)는 `getActiveCraft()` truthy 검사(:26-29) 후 `clearActiveCraft()`(:30)만 수행 — confirm 소비 검증 0행. 승인 요구는 description 산문(release.ts:58-67)에만 존재.
- release 직후~재init 전 창에서: `lsc_verify_hash`는 active craft 부재 시 `ctx.cwd`로 폴백(hash-manifest.ts:310)해 **조용히 메인 체크아웃을 재해시 → blind PASS 가능**, 동시에 `enforcement.ts:132`가 craft 부재로 tool_call 블록도 해제. verify blind 창 실재.
- `lsc_confirm`의 yes/no CONTENT는 플랫폼 산출물(ask.ts:512-515 ui.select → confirmResult)이라 모델이 에코 위조 불가 — 위협은 위조가 아니라 **건너뛰기**.

## 2. Ranked Hypotheses

| # | 가설 | 순위 근거 |
|---|---|---|
| H1 | **게이트 권위/증거 분리형 A-1+A-2+A-3 패키지**: nonce 게이트 권위는 in-process 메모리 싱글턴(state.ts:59 activeCraft와 동급), `.craft-state.json`은 A-2/A-3 감사 증거 원장 전용. 태그-바인딩 single-use nonce가 V1~V7을 닫고, open-release 상태머신이 V8(verify blind)을 닫는다. | 5개 lane 증거 수렴 (아래 §6). 채택 유력. |
| H2 | **정본 문자 그대로**: nonce 자체를 `.craft-state.json`에 기록하고 release가 파일에서 읽어 검증. | 정본 원문(reference-insights.md:32)과 일치하나 Lane 4의 자기모순 반박에 패배 (§5). durable 감사 기록 측면만 H1에 흡수. |
| H3 | **A-2 원문 그대로 verify+run_tests 이중 게이트**: open-release 미폐쇄 시 두 도구 모두 fail-closed 추가. | Lane 3이 부분 반증 — run_tests는 이미 fail-closed(run-tests.ts:206-211), 실제 blind 창은 verify 1곳. run_tests 게이트는 중복(해롭지 않으나 구현 표면 아님). |

## 3. Evidence Summary by Hypothesis

**H1 (선두):**
- 게이트 삽입 seam 실재 (Lane 1, Tier 2): 발급 = `lsc_confirm` execute 래퍼(ask.ts:627-629 — pi·getActiveCraft·params.question 모두 접근 가능, performConfirm 순수성 보존). 소비 = release.ts:26과 :30 사이. 공유 채널 = state.ts 모듈 싱글턴 (main.ts:23-30 등록 순서상 경합 없음).
- 메모리 게이트의 구조적 안전성 (Lane 4, Tier 4 소거법): 모델에게 인메모리 변수를 쓰는 도구가 없다 (write/edit/bash/ast_edit 전부 디스크 경로). abort(state.ts:132-136)·session_switch/branch/shutdown(state.ts:151-155)에서 자동 소멸 → stale yes가 생명주기 밖으로 못 나감(V5 자동 닫힘). 시간 만료 불필요.
- durable 원장 적합성 (Lane 1, Tier 3): persist(state.ts:61-65)는 writeFileAtomicSync(원자적), `.craft-state.json`은 EXCLUDED_FILES(hash-manifest.ts:57)라 증거 기록이 매니페스트를 흔들지 않음, loadActiveCraft(state.ts:86-91)는 shape 무검증 JSON.parse라 optional 필드 역호환 (failureSignature 선례, state.ts:38-48).
- 재베이스라인 = 자연 만료점 (Lane 1, Tier 2): lsc_craft_init 재호출이 fresh state 객체로 전체 교체(hash-manifest.ts:272-279) → nonce/증거의 close가 코드 수준에서 자연 성립 (A-2 "재init이 증거를 close"와 정합).
- 테스트 표면 정합 (Lane 5, Tier 2-3): 순수 함수 분리 관례 6파일 수렴(vitest가 omp SDK import 불가 — release.ts:23 등 명시), mock 전무·실 싱글턴 사용 관례 → 게이트 순수 함수 + thin wrapper가 기존 관례와 일치. C-1(784ab94)이 "CraftState optional 필드 + 역호환 테스트" 직접 선례.

**H2 (기각, 부분 흡수):**
- 지지: 정본 A-1 적용안 원문 "`.craft-state.json`에 기록"(reference-insights.md:32), A-3 "파일 토큰화"(:44).
- 반박 (Lane 4, Tier 2): §5 참조.

**H3 (부분 반증):**
- 지지: A-2 원문 "lsc_verify_hash/lsc_run_tests가 fail-closed로 거부"(reference-insights.md:38).
- 반박 (Lane 3, Tier 1급): run-tests.ts:206-211 `if (!craft || craft.feature !== feature) return isError` — 이미 fail-closed. loadActiveCraft 호출자 0(자동 복구 없음) → open-release 구간은 항상 무활성 craft 상태 → run_tests의 기존 가드가 구간 전체를 커버. **A-2의 실 구현 표면은 verify 1곳.**

## 4. Evidence Against / Missing Evidence

- **메모리 게이트 안전성은 소거법(Tier 4)**: "모델이 enforcement fail-open 갭(symlink/cd-chain/변수전개, enforcement.ts:96-103 공식 인정) 경유로 `.craft-state.json`을 실제로 쓸 수 있는가"는 미실증. 쓰기 가능이면 파일 저장안 기각 확정, 불가능이어도 메모리안이 우월(의존 제거) — 결론 불변이나 실증 갭 (Lane 4 critical unknown).
- **land 도구 부재** (Lane 2, Tier 2): 등록 도구 전수에 lsc_land 없음, land는 post-craft/SKILL.md §7.4:217의 bash `git merge --no-ff`. A-1 "release/land 도구" 전제의 land 절반은 현존 코드가 아님 — lsc_land 신설이 숨은 범위인지, release 한정인지 설계 미결.
- **nonce 발급 트리거 미정의** (Lane 2/4): 파괴적 게이트 태그 집합([Canon Amendment]/[Land]/[Hash Violation]…)이 스킬 SSOT 산문(pre-craft §1.2(c))에만 존재, TS 인식 코드 0행. 태그-바인딩 발급이면 산문→코드 상수 co-evolution 필요, 드리프트 위험.
- **기존 태그 드리프트 실재** (Lane 5, Tier 2): enforcement-rules.test.ts 시나리오 5(:380)는 `[Release]` prefix, craft/SKILL.md §4(:122)는 `[Canon Amendment]` — 현재는 catch-all default가 가려주나 태그-바인딩 nonce 도입 시 load-bearing 불일치로 승격.
- **번들 E2E는 release 미경유** (Lane 5): e2e-full-cycle.test.ts는 lsc_craft_release를 호출하지 않음(grep 확정), answers.json에 [Canon Amendment]/[Land] 규칙 부재(:5-50) — 게이트 회귀 표면은 enforcement-rules 시나리오 5 확장 + 단위 테스트가 담당, "기존 E2E 회귀"는 조건부.
- **게이트 규칙 의미론 명시 필요** (Lane 1 critical unknown): "nonce 부재 = 거부"(fail-closed)가 정상 플로우를 막지 않는 근거는 스킬 계약이 이미 모든 release 전 confirm을 강제(craft §1.4:26, §4:124)하기 때문 — 이 전제를 spec에 명문화해야 함. 이 피처 자체의 land 부트스트랩은 land 예외 조항(개조 이전 dist로 land, land 후 rebuild)이 해소.
- E2E pass 상태(ralplan Phase 3 게이트)는 커밋 메시지 기반 추론(Tier 4) — 실 API 비용 게이트라 독립 재검증 안 함 (Lane 3).

## 5. Rebuttal Round

**도전 (H2 → H1)**: "정본이 명시적으로 `.craft-state.json` 기록을 지시했고, enforcement.ts가 활성 craft 중 test/ 쓰기를 차단하므로(isPathWithin, :128-163) 파일 저장도 충분히 안전하지 않은가?"

**H1의 증거 응답 (Lane 4)**:
- (a) 그 블록은 활성 craft 존재 시에만 발동 — release 자체가 craft를 clear(release.ts:30)하므로 **release 직후~재init 전 창에서 블록이 사라진다**. 정확히 그 창이 이 피처가 닫으려는 구간.
- (b) enforcement.ts:96-103 주석이 bash 매칭을 "first line of defense, not the only one"(fail-open, symlink/cd-chain/변수전개 갭 공식 인정)으로 스스로 규정.
- (c) 결정적: `.craft-state.json`은 hash-manifest.ts:57 EXCLUDED — 위조가 lsc_verify_hash에 절대 보고되지 않음. "the only one" 백스톱조차 이 파일엔 없다.

**판정**: H2 패배 — 위조 가능 매체에 위조 방지 토큰을 두는 자기모순. 단 H2의 durable 기록 요구(A-3 "파일 토큰화", A-2 증거)는 감사 원장 역할로 H1에 병합: **같은 메커니즘의 두 반쪽** — 메모리 = 권위, 파일 = 증거. 검증자 유보("주입-예시 소독 불요, nonce-소비 게이트가 핵심")와도 정합.

**H1의 유일 약점 인정**: 메모리 nonce는 프로세스 재시작에 생존 불가. 수용 근거 — 재시작 직후엔 active craft도 없어(loadActiveCraft 호출자 0) release가 어차피 진행 불가, resume 계약이 lsc_craft_init 재호출을 강제하므로 재확인 비용 저렴.

## 6. Convergence / Separation Notes

**수렴 (동일 인과 기전 확인, 언어 유사 아님):**
1. V1(confirm 생략 직접 호출) 전면 노출 — Lane 1(omp approval 의미론, Tier 1) + Lane 4(release.ts 직독, Tier 2) + Lane 2(grep 전수) 독립 스트림 동일 결론.
2. state.ts 모듈 싱글턴 + optional persisted 필드 = 삽입 seam — Lane 1(코드 지도)과 Lane 5(테스트 관례) 독립 수렴.
3. A-2 표면 = verify 1곳 — Lane 3(도구 대조)과 Lane 1(비대칭 관찰: run-tests fail-closed vs verify 폴백) 독립 수렴. **정본 교정 사항.**
4. 태그-바인딩 필요 + 태그 SSOT 부재 — Lane 4(V4 교차 소비) + Lane 2(산문 전용) + Lane 5([Release]/[Canon Amendment] 드리프트) 수렴.
5. Lane 4 내부: V2/V3/V4/V5/V7 5개 벡터가 "인메모리 태그-바인딩 single-use nonce" 단일 기전으로 동시 닫힘 — 진성 수렴.

**분리 유지:**
- V8(verify blind/TOCTOU)은 nonce 게이트와 **별개 축** — A-2 open-release 상태머신이 독자 담당. 서로 다른 next-probe.
- land 스코프 결정(lsc_land 신설 vs release 한정)은 조사로 닫을 수 없는 설계 분기 — 인터뷰로 이관.
- V6(fixture 자동 yes)은 위협 아님(신뢰 seam, LSC_FIXTURE는 운영자 설정·모델 자가 활성화 불가) — 단 게이트 부정 경로(무승인 release 거부)는 fixture E2E로 검증 불가, 단위 테스트 몫이라는 테스트 설계 제약으로만 분리 기록.

## 7. Most Likely Explanation

release 승인 게이트 공백은 실재하며 현행 전면 노출 (V1 WIDE OPEN). 올바른 해법은 A-1+A-2+A-3 패키지를 다음 3가지 증거 기반 교정과 함께 구현하는 것:

1. **권위/증거 분리**: nonce 게이트 권위는 in-process 메모리 싱글턴(모델 쓰기 도구 부재 + abort/세션 이벤트 자동 소멸), `.craft-state.json`은 A-2 open-release 증거 + A-3 승인 상태 토큰의 **감사 원장** (원자적 쓰기·EXCLUDED·optional 역호환 3중 확인 완료). 정본의 "파일 기록"은 원장 반쪽으로 충족.
2. **A-2 구현 표면 축소**: fail-closed 추가 대상은 verify(hash-manifest.ts:310 폴백 전)뿐 — run_tests는 기존 가드가 이미 커버. (+설계 옵션: open-release 중 enforcement 블록 유지)
3. **태그-바인딩 single-use nonce**: 발급 = confirm execute 래퍼(태그 매칭 + active craft + 플랫폼 yes), 소비 = release.ts:26-30 사이 즉시 무효화. 게이트 규칙은 "nonce 부재 = 거부"(fail-closed) — 스킬 계약이 모든 release 전 confirm을 이미 강제하므로 정상 플로우 무손상, 이 피처 자체의 land는 land 예외 조항으로 부트스트랩.

## 8. Critical Unknown

Lane별 임계 미지수 (인터뷰 이관):
1. **[Lane 2] land 스코프**: lsc_land 도구 신설(A-1 "release/land 도구" 전제 충족, 닭-달걀은 land 예외 조항으로 절단)인가, release 한정 + land는 Phase 5 merge-차단 배선으로 이관인가.
2. **[Lane 4] 권위/증거 분리 승인**: 정본 원문("nonce를 파일에 기록")과 다른 메모리-게이트/파일-원장 분리를 계약으로 확정할 것인가.
3. **[Lane 1+2+5] 발급·소비 매트릭스**: 어떤 태그가 발급하고([Canon Amendment]/[Land]/[Hash Violation]?) 어떤 도구가 소비하는가(release만? restore_tests도?). 태그 상수의 SSOT 위치(TS enum ↔ 스킬 산문), 시나리오 5 `[Release]` 드리프트 정규화 포함.
4. **[Lane 4] open-release 창의 잔여 방어**: 프로세스 재시작으로 메모리 flag 소실 시 durable 증거 기반 verify 거부를 유지할 것인가(위조 가능성 트레이드오프 포함).
5. **[Lane 3] 정본 라인 드리프트**: hash-manifest.ts 268→310 등 — spec/plan은 현행 라인 기준으로 재고정 필요 (계약 위반 아님, Phase 1-2 커밋의 자연 이동).

## 9. Recommended Discriminating Probe

1. **(최우선, 저비용) fail-open 실증**: vitest에서 performCraftRelease를 confirm 없이 직접 호출 — 현행이 성공 반환함을 Tier 1로 승격. 순수 함수라 SDK 불필요 (release.ts:20-24). 이 테스트가 곧 이 피처의 RED 테스트 씨앗.
2. **(V2 종결) 상태 파일 쓰기 벡터 프로브**: evaluateToolCallForActiveCraft 단위 테스트로 write/edit/bash(직접·symlink·cd-chain) 각각의 `.craft-state.json` 차단 여부 실측 — 파일-저장안의 잔여 위험을 정량화하고 enforcement 신뢰 경계 확정.

## 10. Additional Trace Lanes

불필요 — 잔여 불확실성은 전부 설계 분기(§8)로, 추가 조사가 아니라 인터뷰/plan의 결정 대상.

---

## External Research Summary

**stubbed in fixture mode** — `LSC_FIXTURE` 활성, `recorded-research.md` 부재. 외부 리서치 웨이브는 스폰하지 않았고 본 절은 구조적 스탠드인이다. 코드베이스 근거는 위 5개 lane이 전담.

---

## Lane Sub-Reports (전문)

### Lane 1 — Code-path / Implementation

- **Hypothesis**: 현행 코드에는 nonce 발급(confirm 측)과 소비 검증(release 측)을 삽입할 자연스러운 seam이 존재하며, CraftState(싱글턴+`.craft-state.json`)가 durable 저장소로 적합. release는 approval:"read"에도 불구 프로그램적 게이트 부재(fail-open).
- **Evidence For**:
  - approval:"read"는 tier 분류 필드 — requiresApproval(wrapper.ts:122)→resolveApproval(approval.ts:93-132), TIER_RANK read=0, 기본 yolo(settings-schema.ts:3336)에서 tier 비교 생략 무조건 allow(approval.ts:102-103). confirm↔release 프로그램 연결 0행.
  - 발급 seam: ask.ts:627-629 execute 래퍼 (performConfirm 순수성 보존, ask.ts:17-21). 발급 조건 = 게이트 태그 prefix AND active craft AND 플랫폼 yes(ask.ts:512-515, 에코 위조 불가).
  - 소비 seam: release.ts:26(getActiveCraft)~:30(clearActiveCraft) 사이. 소비 표시는 clearActiveCraft 전에 persist 필요(markCraftAborted state.ts:132-136 양식).
  - 저장소 3중 적합: writeFileAtomicSync(state.ts:61-65), EXCLUDED_FILES(hash-manifest.ts:57), shape 무검증 로드 → optional 역호환(state.ts:86-91, failureSignature 선례 :38-48).
  - 재init = 자연 만료: hash-manifest.ts:272-279 fresh 객체 전체 교체.
  - verify blind 실재: hash-manifest.ts:310 ctx.cwd 폴백 (run-tests.ts:206-211 fail-closed와 비대칭). 정본 :268 인용은 현행 :310으로 이동.
  - land 도구 부재: 전 프로젝트 grep — lsc_land 없음, reference-insights.md:54는 미래 제안. 현존 release형 도구는 lsc_craft_release 유일.
  - 등록 순서: main.ts:23-30, 공유 상태는 state.ts 싱글턴 하나 — 경합 없음.
- **Evidence Against / Gaps**: 신규 필드 optional 강제(제약). 태그 집합 코드 부재(SSOT 미결). clearActiveCraft가 persist 미호출 → 기록 순서 설계 필요. fixture 모드 nonce 결정론 미검증(구현 후 테스트 몫).
- **Strength**: Tier 1(approval 의미론) / Tier 2(전 삽입점·EXCLUDED·land 부재) / Tier 3(저장소 적합성) / Tier 4(verify blind의 실 오판 발생은 코드 추론).
- **Critical Unknown**: 게이트 규칙 — "nonce 부재도 거부"인가 "존재 시에만 검증"인가. 전자여야 A-1 벡터가 닫히며, 정상 플로우 무손상 근거는 스킬 계약의 confirm 선행 강제. 명문화 필요.
- **Probe**: confirm 없는 performCraftRelease 직접 호출 단위 테스트 (fail-open Tier 1 승격 + RED 씨앗).
- **Confidence**: High (지도 정확도), 게이트 규칙 방향은 종합 이관.

### Lane 2 — Config / Orchestration

- **Hypothesis**: 게이트 도입 시 스킬 계약과 fixture 양쪽 co-evolution 필요, 현행 계약에 nonce 개념 전무.
- **Evidence For**: nonce 어휘 전수 부재(src/test 0 hit). 스킬은 이미 정확한 순서 명령(craft §1.4:26 "only immediately after an explicit lsc_confirm approval on a [Canon Amendment] gate", §4:124 "Approved → lsc_craft_release … re-call lsc_craft_init — mandatory") → 부재는 코드 백스톱 반쪽뿐. release 도구 무조건 실행 가능(release.ts:68, :25-40). land = bash(post-craft §7.4:217), lsc_land 부재. fixture v2는 nonce 몰라도 됨(fixtures.ts:30-44 kind 3종, 발급은 래퍼 내부 채널 무관). 파괴적 액션 분류는 SSOT 산문에만(pre-craft §1.2(c)).
- **Evidence Against / Gaps**: 스킬 산문 갱신은 문구 수준(불변식은 기존)이나 land 보호는 산문만으로 불가(가로챌 도구 부재). 태그 집합 TS enum 이전 co-evolution. answers.json catch-all default {confirm:true}(:47-50)는 문서화된 자동 승인 위험(_warning :3)으로 잔존하나 nonce '우회'는 아님(정상 발급).
- **Strength**: Tier 2 (계약·도구·fixture 3축 인공물 직독).
- **Critical Unknown**: land 도구 부재 — 이 feature가 lsc_land를 신설해야 land 경로가 게이트에 들어오는가, release 한정인가. ralplan:68은 전자 암시하나 신설 시 최초 land의 닭-달걀은 land 예외 조항으로만 절단 가능.
- **Probe**: 소비 검증을 release에만 넣는 설계와 lsc_land 신설 설계의 A-1 전제 충족도를 종합자가 판정 — 한 결정으로 (a) A-1 전제 진위 (b) co-evolution 반경 (c) 예외 조항 적용 범위 동시 확정.
- **Confidence**: Medium-High.

### Lane 3 — Premise Audit

| 감사 항목 | 판정 | 증거 |
|---|---|---|
| 1. release.ts:68 approval:"read" | **CONFIRMED** | 라인 정확, f01a838 이후 고정 |
| 2. hash-manifest.ts:268 폴백 | **DRIFTED(라인)/메커니즘 CONFIRMED** | 현행 :310. ralplan 시점(9e006c2)엔 정확히 :268 — Phase 1-2 커밋(a052004 +43행, 2fda955 +5행)이 42행 하향 이동. 인과 입증 |
| 2b. verify AND run_tests 동격 blind | **PARTIALLY REFUTED** | run-tests.ts:206-211 이미 fail-closed. loadActiveCraft 호출자 0 → open-release 구간=무활성 → run_tests 게이트는 중복. **실 표면 verify 1곳** |
| 3. .craft-state.json EXCLUDED | **CONFIRMED** | hash-manifest.ts:57. 함의: 증거 기록이 해시 위반 미유발(양호) + 파일 자체는 변조 감지 밖 → 토큰 무결성은 TS 소비 게이트만이 보증 |
| 4. init의 trace/spec/plan 검사 | **CONFIRMED (기구현)** | hash-manifest.ts:177 REQUIRED_PRECRAFT_ARTIFACTS, :188-201, :249. a052004 land — **A-3(a) 완료, 잔여는 (b) release 승인 상태 토큰화 1건** |
| 5. atomic-write 실재·사용 | **CONFIRMED** | atomic-write.ts:20, state.ts:16·hash-manifest.ts:20 import, 2fda955 |
| 6. Phase 0~3 실행 이력 | **CONFIRMED (E2E pass는 잔여 불확정)** | quick win 7건 전 매핑(2fda955/a052004/d976e1c/b6fad2f/bf6f1dc/9ce943f/28723d3), C-1=784ab94, E2E 기준선 4커밋. npm test 690 passed. e2e 통과 자체는 커밋 메시지 추론(Tier 4) |
| 7. CraftState 현재 스키마 | **CONFIRMED** | state.ts:18-57 — release 승인 필드 0개. C-1 필드 실재(단 plan의 consecutiveCount ↔ 코드 consecutiveFailures 명명 드리프트). clearActiveCraft(:138-141) 파일 잔존(A-2에 양호), setActiveCraft(hash-manifest.ts:272)는 기존 증거 미독 덮어쓰기 → "init이 close" 단계는 init 수정 전제 |

- **Summary**: 5 CONFIRMED / 1 DRIFTED(메커니즘 유효) / 1 PARTIALLY REFUTED. 최대 전제 결함 = A-2의 run_tests 동격 blind 묶음.
- **Critical Unknown**: (종합 이관) 정본 라인 재고정 + A-2 표면 축소를 spec에 반영할 것인가.
- **Probe**: spec 작성 시 전 인용을 현행 HEAD 라인으로 재검증하는 기계적 재고정 패스.
- **Confidence**: High.

### Lane 4 — Security / Adversarial

- **Hypothesis**: 핵심 위협은 confirm 건너뛰고 release 직접 호출. nonce-소비 게이트가 닫되, 상태 파일 위조·재사용·교차 소비·stale yes·TOCTOU가 명시 처리돼야 하며, "위조 가능 파일에 위조 방지 토큰" 자기모순 해소가 선행.
- **Vector Table**:

| 벡터 | 현행 노출 | 게이트 후 | 잔여 위험 |
|---|---|---|---|
| V1 confirm 생략 직접 호출 | **WIDE OPEN** (release.ts:68, :26-29 active craft만 검사, 승인 검증 0행) | 닫힘 (nonce-소비를 TS 전제화) | 게이트 구현 정확성이 전부 |
| V2 상태 파일 위조 | 부분 노출 (paths.ts:69-72 test/ 내부, EXCLUDED :57, enforcement fail-open :96-103 — 유일 방어가 fail-open 매칭) | 조건부 — **메모리 저장 시 닫힘** (모델에 메모리 쓰기 도구 없음) | 파일 저장 채택 시 fail-open 갭 경유 위조 |
| V3 재사용/이중 소비 | N/A | 닫힘 (single-use + 소비 즉시 무효화) | 무효화 시점 미지정 시 1 yes→N release |
| V4 게이트 교차 소비 | N/A (land 도구 부재) | 닫힘 (태그 바인딩, "any yes" 금지) | 미바인딩 시 교차 소비 |
| V5 yes 후 abort/세션 전환 | 노출 (state.ts:132-136, :151-155) | 닫힘 (메모리 nonce 자동 소멸 — 이벤트 기반 무효화, 시간 만료 불필요) | durable 저장 시 stale yes 생존 |
| V6 fixture 자동 yes | 의도적 (ask.ts:494-504) | **위협 아님** (LSC_FIXTURE는 운영자 seam, 모델 자가 활성화 불가, headless+무fixture=hard error) | 부정 경로 테스트는 단위 테스트 몫 |
| V7 fail-closed 의미론 | 현행 파일 미독 | 닫힘 (메모리 게이트: 스토어 빈/nonce 없음/태그 불일치/기소비 → isError) | 파일 읽기를 게이트에 끌어들이면 V2 재등장 |
| V8 TOCTOU verify blind | 노출 (release.ts:30 → hash-manifest.ts:309-310 ctx.cwd + enforcement.ts:132 블록 해제 동시 저하) | 닫힘 (A-2 증거 계약) | A-2 미구현 시 잔존 — 별개 축 |

- **Rebuttal round(lane 내부)**: "enforcement가 이미 파일을 막는다" 반론 격파 — (a) release 후 창에서 블록 소멸 (b) fail-open 공식 인정 (c) EXCLUDED라 verify 백스톱 부재. 리더(메모리 게이트) 유지. 약점: 프로세스 재시작 비생존 — 재시작 후 active craft도 없어 release 불가, 재확인 저렴으로 수용.
- **수렴**: V2/V3/V4/V5/V7이 "인메모리 태그-바인딩 single-use nonce" 단일 기전으로 동시 닫힘. V1(게이트 실재)·V6(신뢰 seam)·V8(A-2 축) 분리 유지.
- **Critical Unknown**: 활성 craft 중 fail-open 갭 경유 `.craft-state.json` 실쓰기 가능 여부 — 파일안 안전성의 유일 판별자.
- **Probe**: evaluateToolCallForActiveCraft 단위 프로브 (write/edit/bash 직접·symlink·cd-chain 5종) — V2 종결 + V8 폭 측정 + enforcement 신뢰 경계 확정.
- **Confidence**: V1·V2 High(Tier 2), 메모리안 우월성 Medium(Tier 4 소거법), V8 High(Tier 2-3).

### Lane 5 — Test / E2E Harness

- **Hypothesis**: 3층 테스트 표면 (a)순수 단위 (b)confirm→release 통합 (c)기존 E2E 회귀.
- **커버리지 실측**:
  - test/craft-release.test.ts(1-73, 3 tests): happy path·no-active-craft·싱글턴 격리 커버. **공백**: nonce 검증·open-release 단언·구버전 상태 호환·무confirm 거부 전무. FreshState 헬퍼(:24) 확장 필요.
  - 관례: vitest(package.json:15), `npm test`=단위(LSC_E2E 없으면 e2e skip), `npm run e2e`=build+3파일 직렬(package.json:16). **mock 전무**(grep 0 hit) — 실 싱글턴+tmpdir. **스냅샷 전무** — 필드별 단언 필수. 순수 함수 분리 6파일 수렴(SDK import 불가 근거 명시).
  - C-1(784ab94)이 직접 선례: optional 필드 + 역호환 테스트 패턴.
- **판정**: (a) CONFIRMED — ≥4 신규 단위(거부 3암 + 역호환). (b) CONFIRMED(축소) — enforcement-rules 시나리오 5(:352-435)가 이미 confirm→release→re-init 주행, 증분은 "무confirm release 거부" 1암. **단 시나리오 5의 `[Release]` prefix(:380) ↔ SKILL `[Canon Amendment]`(:122) 드리프트가 태그-바인딩 하에서 load-bearing 승격**. (c) **PARTIALLY REFUTED** — 번들 E2E는 release 미호출(grep 확정), answers.json에 게이트 규칙 부재 — 회귀는 조건부, 신규 터치포인트 도입 시 fixture 규칙 필수(catch-all 자동 yes는 비결정성).
- **Critical Unknown**: 발급 위치 — performConfirm 내부(부작용화) vs 순수 헬퍼+래퍼 — 가 테스트 표면 지도를 2층/3층으로 가른다.
- **Probe**: 발급 위치 단일 질문 확정 → 표면 지도 즉시 붕괴 (래퍼 발급이면: 신규 단위 1파일 + 시나리오 5 확장 1암 + fixture 규칙 1개).
- **Confidence**: Medium-High.
