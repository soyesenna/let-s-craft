**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ de596dbc625149962988246b748a4facd8899ad4 · audit cycle 3

## Lens

**② plan·ADR 준수 — fix-verification.**

우선 반증 질문:

> “RF-24의 wrapper slug guard 추가와 identity 정규형 검증은 plan PR-4/Guardrails의 ‘pure core / thin wrapper’ 분리와 ‘performAuditBegin이 cap의 최종 경계’ 원칙을 훼손하지 않았다” — 이 주장을 반증하라: wrapper(:483-496)와 core(:348)의 이중 guard가 거절 문언/동작을 분기시켜 단일 SSOT 원칙을 깨는 사례, identity 검증(:361-386)이 wrapper가 아니라 core에 들어가 thin-wrapper 관례와 충돌하거나 반대로 정당한 호출을 과차단하는 경계 입력을 찾아라.

## Expected State

코드와 diff를 열기 전에 정본에서 다음 상태를 고정했다.

| Requirement | 정본 좌표 | 기대 observable / boundary / error state | 검증법 |
|---|---|---|---|
| RF-24 wrapper slug boundary | `.lsc/crafts/postcraft-14cycle-approval-failure/audit/audit-2.md:182` | `resolveFeatureName` 직후 shared `FEATURE_SLUG_RE`가 실행되고, invalid slug에서는 state read/decode·exec·log write가 모두 0이어야 한다. | captured production `execute` 순서와 malformed candidate 회귀를 직접 추적한다. |
| RF-24 persisted identity | `audit/audit-2.md:182` | audit-evidence candidate는 `{feature===requested, projectRoot===ctx.cwd, worktreeRoot∈{undefined,worktreePath(ctx.cwd,feature)}}`를 모두 만족해야 한다. 불일치는 exec/log 전에 거부되고 모든 C0/DEL payload는 escaped/constant여야 한다. | 세 identity 필드의 비교, canonical positive, newline/tab/ESC/DEL 진단을 직접 운동한다. |
| PR-4 pure core / thin wrapper | `plan.md:41,46` | wrapper는 resolved input·state·injected dependency를 core에 넘기고, 의미 판정은 injected core에 남는다. wrapper/core가 공유 regex SSOT를 사용하며 같은 입력에서 서로 다른 거절 의미를 만들지 않아야 한다. | wrapper와 core guard 및 identity 판정의 landing site를 비교한다. |
| cap 최종 경계 | `plan.md:41`; ADR `plan.md:68-74` | `performAuditBegin` 안의 policy가 cycle/check-threshold write보다 먼저 실행되고 RF fix delta가 별도 preflight나 우회 경계를 만들지 않아야 한다. | `evaluateAuditBeginGate`와 `applyAuditBeginOutcome`의 호출 순서를 확인한다. |
| PR5-5 red continuation | `plan.md:413,422` | A→B, B의 executed-red incomplete, 별도 정상 post-craft의 next-cycle begin, exact §3.0 test-authoring 실행, B production snapshot 입력과 이후 test/check 실행 OID가 subprocess 경계에서 결정적으로 증명돼야 한다. | latest check-6과 same-OID check-5, early-exit 조건, task 증거 수집 방식을 함께 대조한다. |
| RF-26 persisted base canonical form | `audit/audit-2.md:184`; `src/craft/state.ts:141-155`의 기존 계약 | `status:"ok"`이면 base/source OID가 실제 측정된 40-hex 값이어야 하고, unresolved `""` marker는 `unknown` 의미와 결합돼야 한다. | runtime parser의 status/OID coupling과 negative fixtures를 확인한다. |
| RF-29 deterministic routing precondition | `audit/audit-2.md:187` | 실제 host가 내는 durable evidence로 config load와 exact task routing을 판별한 뒤에만 override를 단언해야 한다. | session JSONL parser와 check-5/check-6 실패 payload를 대조한다. |
| Must-NOT sweep | `plan.md:51-58` | 새 저장소·full re-audit 개편·land 권한 확대·check harness ownership 변경·새 cap alias가 없어야 한다. | 11-file fix delta 전체와 신규 파일/계약 파일/check script 변동을 확인한다. |

## Compliance Matrix

이번 cycle은 fix-verification이므로 audit-2에서 Unmet이던 plan 실행 행과 RF-24/관련 Guardrail만 재검증했다.

| Requirement/Step | Status (Met/Partial/Unmet) | Evidence (file:line) | Notes |
|---|---|---|---|
| **RF-24 전체** | **Partial** | `src/craft/run-check.ts:368-384,483-496`; `test/craft-run-check.test.ts:602-666` | wrapper 순서와 identity 비교는 구현됐다. 그러나 foreign identity 진단이 bare `JSON.stringify(claimed)`를 써 DEL을 raw 방출하므로 무-raw-payload 의무가 미완이다. **RF-24 판정: 부분 적용.** |
| RF-24 wrapper slug ordering | **Met** | `src/craft/run-check.ts:483-496` | shared regex 거부가 `getActiveCraft`/`findPersistedCraftState`보다 앞선다. malformed candidate 테스트도 state decode 선행을 판별한다. |
| RF-24 identity normal form | **Met** | `src/craft/run-check.ts:367-375`; `test/craft-run-check.test.ts:623-666` | 세 필드를 모두 exact 비교하고 canonical legacy identity를 production wrapper에서 허용한다. computed-worktree positive는 core 회귀에도 존재한다. |
| PR-4 Guardrail — pure/injected core + thin wrapper | **Met** | `src/craft/run-check.ts:344-375,483-496` | wrapper/core 모두 같은 `FEATURE_SLUG_RE`를 사용한다. wrapper는 pre-I/O boundary와 state/dependency 조립, core는 identity/실행 판정을 맡는다. 현재 두 guard의 거절 문언도 동일하다. |
| cap 최종 경계 / ADR entry fail-closed | **Met** | `src/craft/verdict.ts:434-456,486-493,580-584` | `evaluateAuditBeginGate`가 모든 `applyAuditBeginOutcome`보다 먼저다. RF delta는 cap preflight나 write ordering을 추가하지 않았다. |
| **PR5-5 red continuation 실행 축** | **Unmet** | `test/e2e-red-cycle-continuation.test.ts:232-258`; `check/logs/check-6.log:717-725` | check-6에서 `taskSpawnCount===0`이다. check-5 동일 OID에서는 pass했으므로 production 결함으로 단정할 수 없지만, 현재 증거 수집은 exact §3.0 실행을 결정적으로 식별하지 못한다. |
| ADR Principle 3 — durable evidence의 동일 의미 | **Partial** | `src/craft/audit-policy.ts:232-261`; `src/craft/state.ts:141-155` | parser가 `status:"ok"`과 unresolved empty OID를 함께 canonical로 수용해 persisted evidence 의미가 갈린다. |
| Must-NOT sweep | **Met** | `src/craft/tool-text.ts:34-46`; `check/logs/check-6.log:1-45`; `git diff c8cd96a..de596db --name-status` | 신규 파일 0개, `skills/`, `agents/`, `state.ts`, `land.ts`, `package.json`, `README.md` 변경 0개다. `run_check.sh`는 sha256 `87fe5a33…`로 무변경이다. 새 저장소, full re-audit, land/cap 권한, check ownership 개편은 관측되지 않았다. |

## Priority Falsification Question

**좁은 아키텍처 주장 자체는 반증되지 않았다.** 다음 세 공격은 모두 실패했다.

1. **wrapper/core 이중 guard의 분기:** `src/craft/run-check.ts:350-351`과 `:488-491`은 같은 shared `FEATURE_SLUG_RE`와 같은 거절 문언을 쓴다. production wrapper는 state I/O 전 경계, core는 direct/injected 호출 경계로 역할이 다르다. 현재 받아들여지는 입력이나 오류 의미가 갈리는 사례는 찾지 못했다.
2. **identity 판정의 core 배치:** `src/craft/run-check.ts:367-375`는 `cwd`, persisted state, injected `exec`만으로 판정한다. 이를 wrapper로 옮기면 direct core 호출의 방어가 사라진다. `test/craft-run-check.test.ts:654-666`의 canonical legacy identity와 기존 computed-worktree positive가 통과하므로 정당한 두 형상을 과차단하지도 않는다.
3. **cap 최종 경계 침해:** `src/craft/verdict.ts:434-456`에서 policy가 먼저 결정되고, write는 gate branch 안에서만 일어난다. RF-24 변경은 `run-check.ts`에 국한돼 이 순서를 건드리지 않았다.

다만 **RF-24 완전 적용 주장은 별도로 반증됐다.** identity 거절문 `src/craft/run-check.ts:382`가 shared `controlSafeEcho` 대신 `JSON.stringify(claimed)`를 사용한다. 현재 dist를 대상으로 한 좁은 probe는 `{isError:true, hasRawDel:true, lineCount:1}`을 반환했다. 따라서 구조 분리는 맞지만 RF-24의 merged 무-raw-payload 경계는 미완이다.

## Findings

1. **보완 · MAJOR** — RF-24 identity 거절문이 DEL(U+007F)을 raw 방출해, 삼차 fix-verification에서도 무-raw-payload 경계가 부분 적용으로 남았다.
   - Evidence: `src/craft/run-check.ts:382-384` — ``claims the identity ${JSON.stringify(claimed)}``.
   - Evidence: `src/craft/tool-text.ts:39-45` — “`Every diagnostic that names an untrusted persisted field echoes through THIS, never bare JSON.stringify/String.`”
   - Evidence: `test/craft-run-check.test.ts:630-649` — foreign-root fixture는 `"\n"`과 `"\t"`만 seed하고, DEL을 포함하는 regex로 결과만 검사한다. 따라서 bare `JSON.stringify`의 DEL blind spot을 운동하지 않는다.
   - Required by: `audit/audit-2.md:182` — “`foreign-root control-payload의 escaped 단언(④ Finding 2의 무-raw-payload 의무 병합)`.”
   - Required by: `audit/audit-2.md:191` — “RF-20계열(→RF-23/24)의 삼차 부분 적용이 관측되면 측정 반증의 여지없이 REJECT.”
   - Actual: newline/tab은 JSON escaping으로 우연히 안전하지만 DEL은 그대로 남는다. current dist의 `performRunCheck`에 `projectRoot:"/tmp/foreign\u007fmarker"`를 넣은 scoped probe에서 raw DEL이 실제 검출됐고 exec는 실행되지 않았다. 즉 effect 차단은 맞지만 diagnostic 경계는 불완전하다.
   - Remediation: `JSON.stringify(claimed)`를 `controlSafeEcho(claimed)`로 교체하고, expected identity에 향후 untrusted 값이 추가될 때도 같은 helper를 통과시켜라. captured production `execute` table에 `projectRoot`와 `worktreeRoot` 각각의 `\u007f` payload를 추가해 raw DEL 0, escaped `\\u007f`, exec 0, log-write 0을 단언하라.

2. **보완 · MAJOR** — PR5-5의 §3.0 증거가 exact `lsc-test-engineer` 실행에 결합되지 않아 latest check의 `taskSpawnCount===0`을 테스트 결함, 실제 orchestration 누락, subprocess LLM 비결정성 중 하나로 판별할 수 없다.
   - Evidence: `test/e2e-helpers.ts:855-857` — “`toolExecutions(result).filter(call => call.toolName === "task").length`”; agent·assignment·OID·cycle을 전혀 식별하지 않는다.
   - Evidence: `test/e2e-helpers.ts:265-277` — stdout은 `appendBounded`의 trailing buffer만 보존하고, 최종 `result.events`도 그 buffer에서 파싱된다.
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:248` — “`expect(taskSpawnCount(postCraftResult) ...).toBeGreaterThanOrEqual(1)`.”
   - Evidence: `check/logs/check-5.log:358-359`에서는 같은 `de596db` build가 pass했지만, `check/logs/check-6.log:717-725`에서는 “`expected 0 to be greater than or equal to 1`”로 실패했다.
   - Required by: `plan.md:413` — “`§3.0이 B production snapshot을 입력으로 읽었고 이후 test/check commit OID에서 실행`했음을 … 단언한다.”
   - Required by: `plan.md:422` — “`별도 정상 post-craft의 next-cycle begin을 실제 subprocess 경계에서 증명한다`.”
   - Actual: **확정 가능한 것은 테스트 설계/관측 식별이 불충분하다는 점이다.** 같은 OID의 pass→fail은 subprocess LLM 비결정성을 시사하지만, bounded stream에서 event가 소실됐는지 실제 process가 §3.0을 생략했는지 남은 로그만으로 구별할 수 없다. 따라서 관측 대상 production 결함으로 단정하지 않으며, PR5-5 실행 축은 증명 실패로 Unmet이다.
   - Remediation: 종료 후 parent session JSONL을 durable source로 읽어 marker가 있는 `task` call의 args/result를 결합하고, exact agent `lsc-test-engineer`, feature, cycle 1, frozen B/input snapshot을 확인하라. generic `task >= 1`은 제거하고, with-commit은 해당 task 결과 OID→descendant test/check commit을, no-commit은 동일 task 완료 + B-pinned fresh log를 결합하라. exact task가 실제로 없으면 관측 대상 orchestration 결함으로 명시적으로 실패시키고, event가 있으면 bounded stdout 유실로 오판하지 않게 하라.

3. **수정 · MAJOR** — RF-29가 실제 host에서 존재하지 않는 `session_init.agent`를 결정적 전제로 삼아 override 판정 전에 반복 실패한다. **(outside lens)**
   - Evidence: `test/e2e-preset-default.test.ts:144-146` — `sessionAgent`는 오직 `session_init.agent` string만 인정한다.
   - Evidence: `test/e2e-preset-default.test.ts:229-236` — explore override를 보기 전에 tracer의 값도 exact `"lsc-tracer"`로 강제한다.
   - Evidence: `check/logs/check-6.log:692-711` — marker-identified tracer session은 존재하지만 `tracerAgent`가 `undefined`여서 실패한다. 동일 현상은 `check/logs/check-5.log:349-357`에도 재현됐다.
   - Required by: `audit/audit-2.md:187` — “`단언 전 explicit models.yaml entry 적용의 결정적 전제(설정 로드 완료 관측 또는 sentinel 모델명 기반 라우팅 소스 판별)를 고정하라`.”
   - Actual: 추가된 전제는 두 번의 live subprocess에서 host schema와 맞지 않았고, 테스트는 실제 관심 대상인 explore override assertion에 도달하지 못했다. 이는 host routing defect의 증거가 아니라 새 precondition 자체의 결함이다.
   - Remediation: child의 optional `session_init.agent`를 authority로 쓰지 말고 parent session의 marker-bound `task` invocation args에서 requested agent를 확인하라. host가 durable agent field를 제공하지 않으면 RF-29가 허용한 sentinel 방식으로 바꿔, default/main과 다른 explore-only sentinel model을 seed하고 marker-identified explore child의 실제 provider/model로 routing 결과를 판별하라. 실패 diagnostic에는 raw `session_init` shape와 parent task args를 남겨 host routing 결함과 schema 부재를 구분하라.

4. **수정 · MAJOR** — `parseAuditBaseSnapshot`이 unresolved empty OID 두 개를 `status:"ok"`와 함께 canonical로 수용해 persisted base evidence를 거짓 “in sync”로 재생한다.
   - Evidence: `src/craft/audit-policy.ts:233-257` — `isOidShapeOrEmpty`가 `""`를 허용하고, `status === "ok"` branch는 OID non-empty 여부를 다시 검사하지 않은 채 반환한다.
   - Evidence: `src/craft/verdict.ts:373-380` — accepted `status:"ok", behindCount:0`은 empty tips라도 “`0 behind (in sync)`”로 출력된다.
   - Required by: `audit/audit-2.md:184` — “`status/authority enum, canonical ISO, 40-hex OID shape, safe count ... 를 검증한 뒤에만 describeAuditBase 보간`.”
   - Required by: `src/craft/state.ts:144-153` — “`status: "ok" iff baseTip/sourceTip/behindCount were all measured`”; empty OID는 “`when ... could not be resolved`” marker다.
   - Actual: current dist probe에 `{baseTip:"",sourceTip:"",behindCount:0,status:"ok"}`를 넣으면 parser가 그 객체를 그대로 반환한다. 테스트의 negative table에는 이 status/OID coupling 경계가 없다.
   - Remediation: `status:"ok"` branch에서 `baseTip`과 `sourceTip` 모두 exact 40-lower-hex이면서 non-empty임을 요구하라. `""` marker는 `status:"unknown"`에서만 허용하되 partial-resolution unknown은 기존대로 보존하라. `ok+empty baseTip`, `ok+empty sourceTip`, replay의 constant invalid-state/no-raw/byte-stable 회귀를 추가하라.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- fix delta 11파일은 모두 plan/ADR 관점으로 열람했다. 다만 unmodified `land.ts`의 전체 merge state machine과 `skills/` 계약 전체를 재감사하지는 않았고, Must-NOT 관련 diff 부재와 인접 seam만 확인했다.
- check-6의 throwaway red-continuation session directory는 테스트 cleanup 뒤 남아 있지 않아, `taskSpawnCount===0`이 실제 §3.0 생략인지 NDJSON/tool-name/rolling-buffer 관측 손실인지 raw session으로 확정할 수 없다. 이 불확실성 자체가 Finding 2의 durable-evidence 보완 대상이다.
- `e2e-full-cycle`의 4,801초 timeout은 check-4 green 및 fix delta 비접촉과 함께 보았으나, 남은 로그에 tool error가 없어 provider stall과 회귀를 구분할 근거가 없다. 그래서 finding으로 단정하지 않았다.
- 제약에 따라 project-wide suite와 E2E를 재실행하지 않았다. 수행한 좁은 검증은 `npx vitest run test/craft-run-check.test.ts`의 **45/45 pass**, RF-24 DEL direct probe의 **raw DEL=true**, RF-26 empty-OID probe의 **canonical accept 재현**이다. scoped test의 green은 DEL fixture 부재 때문에 Finding 1을 반증하지 않는다.
