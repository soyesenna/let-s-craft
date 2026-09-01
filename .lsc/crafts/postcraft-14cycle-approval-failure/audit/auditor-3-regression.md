**AUDITOR VERDICT: APPROVE-WITH-CHANGE**
Reviewed: postcraft-14cycle-approval-failure @ de596dbc625149962988246b748a4facd8899ad4 · audit cycle 3

## Lens

회귀·코드품질 (③), fix-verification. 우선 반증 질문: "controlSafeEcho(tool-text.ts:43-46)는 모든 신뢰 불가 값의 control 문자를 이스케이프하며, audit-policy.ts/verdict.ts/run-check.ts의 어떤 진단·결과 텍스트 경로에도 신뢰 불가 값의 raw 보간이 남아있지 않다" — 이 주장을 반증하라: C1(U+0080–009F)·U+2028/2029 등 CONTROL_CHARS_RE 밖의 문자, JSON.stringify가 비문자열을 반환하는 값(undefined/symbol/circular), controlSafeEcho를 거치지 않는 잔존 보간 지점을 전수 수색한다.

## Expected State

코드를 열기 전에 정본에서 다음 상태를 고정했다.

- **RF-23** — `audit/audit-2.md:181`: `recordFeature`/`dueCycle`/`scheduledCycle`/`intervalCycles`/`nextDueCycle`가 raw `String()`으로 결과 text에 나오지 않아야 한다. newline/tab/ESC/DEL을 각 필드에 넣은 실제 `performAuditBegin`은 single-line이고 raw payload가 없어야 하며, 두 disposition echo arm도 닫혀야 한다. 검증법: parser의 모든 오류 arm과 fs-backed production-core 회귀를 직접 읽는다.
- **RF-24** — `audit/audit-2.md:182`: `registerRunCheckTool.execute`는 `resolveFeatureName` 직후 slug를 거부하고 그 뒤에만 active/persisted state를 읽어야 한다. persisted identity는 requested feature, `ctx.cwd`, canonical worktree root를 exact 검증해야 한다. 검증법: wrapper 순서, core identity predicate, captured-production invalid/mismatch/control tests를 직접 읽는다.
- **RF-25** — `audit/audit-2.md:183`: audit-begin wrapper는 free-text control guard 직후 shared slug guard를 적용하고, invalid feature일 때 git/state effect가 0이어야 한다. 검증법: wrapper statement order와 captured `runGitText`/state-byte assertions를 읽는다.
- **RF-26** — `audit/audit-2.md:184`: persisted `auditBaseSnapshot`은 status/authority, canonical ISO, 40-hex OID, safe count, control-free `baseBranch`/`error`를 runtime parse한 뒤에만 describe되어야 한다. invalid record는 constant `invalid-state`, no raw record, replay byte-stable이어야 한다. 검증법: parser의 status별 invariant와 replay result/details/write behavior를 읽는다.
- **RF-27** — `audit/audit-2.md:185` 및 `plan.md:189`: canonical whole-file 비교를 유지하면서 replay 직전/직후 raw state bytes exact equality를 고정해야 한다. 검증법: replay 호출을 사이에 둔 `toBe(beforeReplayBytes)`를 확인한다.
- **회귀 경계** — `spec.md:95`의 AC-8은 기존 E2E 전체 green을 요구한다. fix delta가 고친 E2E/test harness도 검토 대상이며, check-6의 실패는 test가 존재한다는 사실로 상쇄되지 않는다.
- **post-resume state consistency** — 재등록 이후 durable bytes와 runtime interpretation이 같아야 하며, invalid persisted snapshot이 replay를 통해 신뢰된 base evidence로 승격되거나 raw 재방출되어서는 안 된다.
- **prompt-injection surface** — 새 diagnostic, fixture, assertion failure, check result에서 later agent가 directive로 오인할 raw untrusted text가 없어야 한다. 의도적 E2E prompt는 trusted harness instruction으로 구분하되, persisted state·child output·session inventory의 raw echo는 별도로 추적한다.

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

**답: 주장은 반증됐다.**

1. `src/craft/tool-text.ts:11-17`의 `CONTROL_CHARS_RE`는 C0와 DEL만 포함한다. `src/craft/tool-text.ts:43-46`의 `controlSafeEcho`도 `JSON.stringify` 후 DEL만 교체한다. 별도 Node probe에서 JSON serialization의 code point sequence는 U+0085=`22,85,22`, U+2028=`22,2028,22`, U+2029=`22,2029,22`였다. 즉 세 문자는 raw로 남는다.
2. `src/craft/audit-policy.ts:174-205,397-432,494-514`의 named persisted-field diagnostics는 이제 `controlSafeEcho`를 통과하지만, 그 helper의 repertoire 밖인 C1/U+2028/U+2029에는 그대로 취약하다.
3. `src/craft/verdict.ts:643-667`은 C0/DEL만 거른 `base_branch`를 git과 `baseSnapshot`으로 넘기고, `src/craft/verdict.ts:373-380`은 `baseBranch`/`error`를 raw 보간한다. replay parser도 같은 좁은 `isControlFreeText`를 사용하므로 C1/U+2028/U+2029 snapshot은 canonical로 통과해 다시 보간된다.
4. `src/craft/run-check.ts:368-384`는 persisted identity를 bare `JSON.stringify(claimed)`로 보간한다. `src/craft/run-check.ts:251-271`은 child stdout/stderr에서 뽑은 `failureLines`를 raw로 model-facing result에 합치며, `:423-428`은 exec exception message를 raw로 합친다.
5. `JSON.stringify(undefined)`와 `JSON.stringify(Symbol())`는 `undefined`를 반환하지만 `controlSafeEcho`의 literal `"undefined"` fallback이 처리한다. circular value는 `TypeError`를 던져 helper가 total하지 않다. durable JSON state에서는 symbol/circular graph가 생성되지 않으므로 현재 production reachability는 확인되지 않았지만, exported helper 자체의 보장은 성립하지 않는다.

### RF-23~RF-27 판정

| RF | 판정 | Evidence | 근거 |
|---|---|---|---|
| RF-23 | **완전 적용** | `src/craft/audit-policy.ts:174-205,397-432,494-514`; `test/audit-policy.test.ts:592-670` | 원문이 열거한 newline/tab/ESC/DEL 및 두 잔존 disposition arm이 실제 `performAuditBegin`에서 single-line/no-raw로 고정됐다. broader Unicode repertoire는 아래 별도 finding이며 RF-23의 열거 범위를 소급 확장하지 않았다. |
| RF-24 | **완전 적용** | `src/craft/run-check.ts:367-384,481-496`; `test/craft-run-check.test.ts:563-664` | wrapper slug guard가 state lookup보다 앞서고, selected persisted identity의 세 필드 exact predicate와 invalid/mismatch/control captured-production 회귀가 있다. broader C1/Zl/Zp echo는 별도 shared-text finding이다. |
| RF-25 | **완전 적용** | `src/craft/verdict.ts:643-668`; `test/craft-verdict.test.ts:1285-1344` | control guard → resolved feature slug guard → fixture/root/git/core 순서이며 invalid feature에서 git 0회와 state-byte 불변을 직접 단언한다. |
| RF-26 | **부분 적용** | `src/craft/audit-policy.ts:232-261`; `src/craft/state.ts:141-151`; `src/craft/verdict.ts:554-577`; `test/craft-verdict.test.ts:1354-1390` | parser/replay/constant/no-write 골격은 구현됐지만 `status:"ok"`에도 empty OID를 허용해 status↔resolution invariant를 닫지 못했다. 또한 shared control-free predicate가 C1/Zl/Zp를 허용한다. |
| RF-27 | **완전 적용** | `test/craft-verdict.test.ts:1078-1093` | 기존 canonical whole-file 비교를 유지하고 replay 직전 bytes를 저장한 뒤 replay 직후 raw string equality를 단언한다. |

**삼차 부분 적용 경계:** RF-23, RF-24, RF-27은 모두 원문 범위에서 완전 적용됐다. 따라서 RF-20 계열(RF-23/24) 및 RF-19 계열(RF-27)의 삼차 부분 적용 경고는 이번 lane에서 발동하지 않는다. 부분 적용은 cycle 2에서 신규 처방된 RF-26이며, 그 경고 계열을 RF-23/24/27에 과장해 귀속하지 않았다.

## Findings

1. **보완 · MAJOR** — RF-26 parser가 `status:"ok"`인 snapshot의 empty OID를 canonical로 수락해, unresolved tips를 “0 behind (in sync)” evidence로 replay할 수 있다.
   - Evidence: `src/craft/audit-policy.ts:232-261` — `isOidShapeOrEmpty`는 `""`를 항상 허용하고, `status === "ok"` branch는 `behindCount`와 `error`만 검사한다: `if (!isOidShapeOrEmpty(baseTip) || !isOidShapeOrEmpty(sourceTip)) return undefined; ... if (status === "ok") { if (!isSafeNonNegativeCycle(behindCount)) return undefined; ... return { ... }; }`.
   - Evidence: `src/craft/state.ts:141-151` — `baseTip`/`sourceTip`의 `""`는 “when ... could not be resolved”이고, status는 `"ok" iff baseTip/sourceTip/behindCount were all measured`라고 정의한다.
   - Required by: `audit/audit-2.md:184` — “status/authority enum, canonical ISO, **40-hex OID shape**, safe count ... 검증한 뒤에만 `describeAuditBase` 보간”.
   - Actual: `{status:"ok", baseTip:"", sourceTip:"", behindCount:0, ...}`가 parser를 통과하고 `describeAuditBase`는 빈 OID 두 개와 “0 behind (in sync)”를 출력한다. `test/audit-policy.test.ts:548-581`에는 이 status/OID coupling negative case가 없다.
   - Remediation: `status === "ok"`에서는 두 tip 모두 정확히 `/^[0-9a-f]{40}$/`이어야 하도록 분기하고, `status === "unknown"`에서만 partial-observation용 empty marker를 허용한다. empty `baseTip`/`sourceTip` 각각을 ok snapshot에 seed한 pure-parser negative와 same-cycle replay constant-`invalid-state`/details suppression/byte-stability 회귀를 추가한다.

2. **보완 · MAJOR** — shared text-safety boundary가 C1 및 Unicode line/paragraph separators를 허용하고, 여러 production result path가 untrusted text를 bare 보간해 model-facing prompt-injection surface를 남긴다.
   - Evidence: `src/craft/tool-text.ts:11-17,43-46` — `const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;` 및 `serialized.replace(/\u007f/g, "\\u007f")`만 수행한다.
   - Evidence: `src/craft/verdict.ts:373-380,643-667` — C0/DEL guard를 지난 `base_branch`가 observation으로 전달되고 `snapshot.baseBranch`/`snapshot.error`가 `describeAuditBase`에서 raw 보간된다.
   - Evidence: `src/craft/run-check.ts:251-271,368-384,423-428` — raw `failureLines.join("\n")`, bare `JSON.stringify(claimed)`, raw exec exception message가 결과 text에 들어간다.
   - Required by: `audit/audit-1.md:250` — shared “control-char-free validator”와 각 경로 “무-raw-payload 테스트”를 요구했다. `audit/audit-2.md:189`도 C1(U+0080–009F)·U+2028/2029 range 검토를 명시했다.
   - Actual: U+0085/U+2028/U+2029는 validator를 통과하고 JSON에도 raw로 남는다. persisted snapshot/identity, invalid feature diagnostic, git error, check child failure line이 directive-shaped suffix를 새 logical line처럼 later agent에 노출할 수 있다. `controlSafeEcho`는 circular programmatic value에서 throw한다.
   - Remediation: model-facing text용 total serializer를 하나로 만든다. 최소 C0+C1+DEL+U+2028/U+2029를 `\uXXXX`로 escape하고 JSON serialization throw/undefined를 constant fallback으로 처리한다. `audit-policy`, invalid-slug messages, `describeAuditBase`, run-check identity/exception/failure summary를 전부 그 seam으로 이관한다. raw child output은 durable log에만 보존하고 tool result에는 bounded escaped summary를 제공한다. U+0085/U+009B/U+2028/U+2029 및 circular pure-helper case를 actual wrapper/core 회귀로 고정한다.

3. **수정 · MAJOR** — `(outside lens)` RF-29 fix가 live session JSONL에 존재하지 않는 `session_init.agent` 필드를 deterministic routing authority로 가정해 standard E2E를 새 precondition assertion에서 실패시킨다.
   - Evidence: `test/e2e-preset-default.test.ts:137-146,219-240` — `sessionAgent`는 `session_init.agent`만 읽고 tracer/explore가 각각 exact agent name인지 강제한다.
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-6.log:692-710` — captured tracer session에서 `tracerAgent`가 `undefined`여서 line 235가 실패했으며 session task evidence는 존재한다.
   - Required by: `audit/audit-2.md:187` — captured session inventory/jsonl로 근인을 판별하고 “설정 로드 완료 관측 또는 sentinel 모델명 기반 라우팅 소스 판별”이라는 결정적 전제를 고정하라고 요구했다. `spec.md:95`는 기존 E2E 전체 green을 요구한다.
   - Actual: 근인을 판별하는 authority 자체가 live record shape에 없어서 override assertion에 도달하지 못한다. 실패를 host-routing defect로 판정할 수 있는 precondition도 성립하지 않는다.
   - Remediation: parent task execution event에서 실제 routed agent identity를 얻는 지원 필드를 먼저 schema-probe해 사용하거나, RF-29가 허용한 tracer/explore별 sentinel model mapping으로 routing source를 판별한다. 실제 JSONL에 존재하는 필드만 authority로 삼고, raw captured schema를 failure artifact로 보존한 회귀로 고정한 뒤 standard E2E를 green으로 복구한다.

4. **보완 · MAJOR** — `(outside lens)` RF-28의 no-commit continuation branch가 §3.0 execution을 입증하지 못해 check-6에서 `taskSpawnCount === 0`으로 실패한다.
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:228-266` — early exit는 commit landing까지 요구하지만, 이후 no-commit branch로 가기 전 `expect(taskSpawnCount(postCraftResult)).toBeGreaterThanOrEqual(1)`을 무조건 요구한다.
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-6.log:717-724` — continuation cycle에서 task spawn count가 0으로 관측되어 line 248이 실패했다.
   - Required by: `audit/audit-2.md:186` — asserted observation 이후에만 early exit하고 “§3.0이 정당하게 무커밋 완료하는 경로”도 명시적으로 처리하라고 요구했다. `spec.md:95`는 기존 E2E 전체 green을 요구한다.
   - Actual: commit branch의 sample timing은 강화됐지만, no-commit branch가 의존하는 “spawn ran at B” 관측이 현재 stream schema에서 성립하지 않는다. fresh log만으로는 그 log가 §3.0 test-authoring spawn의 실행 결과인지 구분되지 않는다.
   - Remediation: §3.0 spawn completion을 실제 emitted tool/event schema에서 구조적으로 캡처하거나, test-engineer가 남기는 OID-bound durable result를 관측한다. with-commit branch는 current commit predicate를 유지하고, no-commit branch는 confirmed spawn result + post-process fresh check log + execution OID가 모두 B에 결합될 때만 허용한다. 관측이 없으면 no-commit success로 해석하지 말고 subprocess evidence failure로 닫는다.

## Adversarial Classes

- **post-resume state consistency — applied.** RF-27은 `test/craft-verdict.test.ts:1088-1093`에서 replay raw bytes를 정확히 고정했고, RF-26 replay는 invalid record를 constant text로 억제한다. 그러나 `src/craft/audit-policy.ts:232-261`의 ok+empty-OID 허용으로 durable state의 “unresolved” bytes가 runtime의 “measured/in sync” 의미로 바뀔 수 있다. C1/U+2028/U+2029 snapshot도 parser를 통과해 `src/craft/verdict.ts:563-575`에서 raw 재방출된다. 따라서 byte consistency는 닫혔지만 semantic/text consistency는 미폐쇄다.
- **prompt-injection surface — applied.** `test/audit-policy.test.ts:622-640`의 `lets-craft: forged` literals는 negative fixture이고 C0/DEL case에서는 결과에 raw로 나오지 않는다. 반면 production `run-check.ts:251-271`의 raw child failure summary와 `verdict.ts:373-380`의 좁게 검증된 snapshot echo는 later agent가 읽는 text surface다. check-6 자체도 `check/logs/check-6.log:692-700`에서 session task의 directive-shaped “Complete the assignment below, thoroughly” text를 assertion evidence로 raw 재방출했다. 이번 감사에서는 이를 데이터로만 취급했지만, 구현 차원의 오염 가능성은 Finding 2로 남는다.

## What's Missing

- 명시적 금지에 따라 formatter, lint, build, vitest, E2E를 재실행하지 않았다. unit 1795 passed/14 skipped와 E2E 3 failed/1 passed는 cycle-fresh `check-6.log`의 기계 증거를 사용했다.
- `check-6.log:291-305,661-686`의 full-cycle post-craft timeout(4,801,148ms test duration, inner result `timedOut=true`)은 check-4 green과 달라졌지만, log에 tool error/last execution/message가 없어 이 lane에서 원인을 특정하지 못했다. timeout budget, provider stall, orchestration hang 중 어느 것인지 추가 capture가 필요하다. 저신뢰 원인 추측을 finding으로 만들지 않았다.
- check-6가 임시 session JSONL 경로를 남겼지만 해당 temp tree는 현재 감사 worktree 밖이며 보존 여부가 확인되지 않아 raw session entries를 직접 열지 못했다. RF-29 판정은 test code와 cycle-fresh failure excerpt에 한정한다.
- fix delta의 11개 파일과 관련 same-decision sites를 읽었지만, unchanged full-cycle implementation 전체, provider/host `omp` task routing 내부, vendored runtime은 검사하지 않았다.
- 실제 terminal renderer가 U+0085/U+2028/U+2029를 어떻게 시각화하는지는 실행하지 않았다. JSON serialization이 세 code point를 raw 보존한다는 Node probe와 model-facing concatenation 경로까지만 증명했다.
- 다른 audit lane의 결론은 열람하지 않았고, 어떤 수렴·중복도 주장하지 않는다.
