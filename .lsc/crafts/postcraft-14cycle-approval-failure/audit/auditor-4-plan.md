**AUDITOR VERDICT: APPROVE-WITH-CHANGE**
Reviewed: postcraft-14cycle-approval-failure @ a1af63b2bfda95b182a8717e3acd8783920c16f6 · audit cycle 4 · lens plan·ADR 준수

## Lens

- 할당 lens: **② plan·ADR 준수**
- fix-verification 대상: audit-3의 `PR5-5 red continuation (실행 증거 축)` Unmet, `ADR Principle 3 — durable evidence 동일 의미` Partial, 그리고 fix delta가 건드린 PR-1/PR-3/PR-4/PR-5 결정.
- Priority falsification question:

> RF-32's ok-branch enforcement (`src/craft/audit-policy.ts` isMeasuredOid on baseTip+sourceTip, commit 488b686) restores ADR Principle 3 ('durable evidence has the same meaning across retry · fresh process · legacy state') ONLY IF the parser now accepts exactly the shape set `src/craft/state.ts`'s AuditBaseSnapshot writer can produce and rejects everything else. Disprove: enumerate every snapshot shape `observeAuditBase` (src/craft/verdict.ts) and state.ts can persist — explicit-base ok, explicit-base unknown (unresolvable ref: baseTip ""? sourceTip measured?), legacy-current-branch attached ok/unknown, detached/unborn unknown, git failure unknown — and check each against `parseAuditBaseSnapshot` at the frozen OID: is there a LEGITIMATE persisted shape the stricter parser now rejects (→ replay of a valid record degrades to the constant invalid-state text = a regression of Principle 3 in the other direction), or a still-forged shape it accepts (unknown + 40-hex tips + behindCount 'unknown'? ok + tips equal + behindCount>0?)?

## Expected State

코드/diff를 열기 전에 canon에서 다음 상태를 고정했다.

1. **RF-32 / PR-3 snapshot shape**
   - Required by: `audit/audit-3.md:283`, `plan.md:241-244`, `plan.md:68-71`.
   - `status:"ok"`는 두 tip이 모두 non-empty exact 40-lower-hex이고 `behindCount`가 측정된 경우에만 성립해야 한다.
   - `status:"unknown"`은 실제 관측 실패 단계에 따라 `""/""`, measured/`""`, measured/measured tip 조합을 보존해야 한다.
   - 검증법: `observeAuditBase`의 모든 return arm을 먼저 열거하고 parser의 수용 집합과 대조하며, fresh/replay prose도 같은 snapshot에서 대조한다.

2. **PR-1 (i) same-cycle replay**
   - Required by: `plan.md:177-190`.
   - replay는 기존 `auditCycle`, `checkLogAtCycleStart`, base snapshot bytes를 갱신하지 않고 같은 durable 의미를 돌려줘야 한다.
   - 검증법: replay code path와 invalid/valid snapshot 회귀의 byte-stability·details suppression을 확인한다.

3. **ADR Principle 3**
   - Required by: `plan.md:68-71`.
   - retry, fresh process, legacy state에서 같은 canonical snapshot은 동일한 base-authority prose 의미를 가져야 하며, invalid persisted bytes만 constant invalid-state text로 격리돼야 한다.
   - 검증법: fresh begin과 replay가 공통 formatter를 쓰는지, RF-34 serializer가 JSON quotes까지 보존하는지 확인한다.

4. **PR-1 Guardrail — pure core/thin wrapper**
   - Required by: `plan.md:37-59`, `spec.md:79-89`.
   - wrapper/core는 동일 `FEATURE_SLUG_RE`와 동일 refusal wording/serializer를 사용해야 하며, identity/policy 판단은 core에 남아야 한다.
   - 검증법: RF-30/RF-34가 고친 production wrapper와 pure core를 양쪽 모두 비교한다.

5. **PR-4 정규형**
   - Required by: `plan.md:332-380`.
   - §3.2/§4.2/§5/§6.1은 structural `ReviewerRef`, OID/cycle-bound `VerificationResult`, exact owner pair set, four-level precedence를 같은 의미로 유지해야 한다.
   - 검증법: 현재 post-craft 계약과 fix delta의 변경 경계를 비교한다.

6. **PR-5 red continuation의 `B 관측`**
   - Required by: `plan.md:413`, `plan.md:422`, `plan.md:451-452`.
   - exact `HEAD === B`가 아니라 §3.0이 B production snapshot을 입력으로 읽고, 뒤이은 test/check snapshot OID에서 실행됐음을 증명해야 한다. §3.0이 green을 만들었다는 단언은 금지된다.
   - 검증법: early-exit 조건, durable task args/result, cycle marker, commit/check 실행 evidence를 각각 분리해 확인한다.

7. **RF-35(b)와 전체 E2E**
   - Required by: `audit/audit-3.md:286`, `plan.md:415`, `plan.md:451-452`.
   - post-craft timeout은 stall attribution을 보존해야 하고, 외부 stage budget과 Vitest budget은 실제 허용되는 pipeline wait보다 짧아 정상 진행을 kill하지 않아야 하며 표준 4-file E2E가 green이어야 한다.
   - 검증법: stage 상수의 합, package script timeout, check-8의 실제 kill 지점을 대조한다.

8. **Must-NOT-Have**
   - Required by: `plan.md:52-62`, `spec.md:79-93`.
   - fix delta는 새 state top-level field, 새 storage/migration, `writeFileAtomicSync` 경로, cap 숫자 alias를 만들지 않아야 한다.

## Compliance Matrix

| Step/Decision | Status (Met/Partial/Unmet) | Evidence (file:line) | Notes |
|---|---|---|---|
| PR-3 base snapshot `{status,authority,baseTip,sourceTip,behindCount}` + RF-32 canonical parser | **Partial** | `src/craft/state.ts:141-158`; `src/craft/verdict.ts:312-365`; `src/craft/audit-policy.ts:258-278` | 모든 legitimate production shape는 수용하고 `ok+empty tip`은 거절한다. 그러나 parser는 production writer가 만들지 않는 `unknown + baseTip:"" + measured sourceTip`과, Git 의미상 불가능한 `ok + equal tips + behindCount>0`을 여전히 수용한다. |
| PR-1 (i) same-cycle replay byte-stability | **Met** | `src/craft/verdict.ts:561-579`; `test/craft-verdict.test.ts:1395-1433` | invalid snapshot은 constant text/details suppression으로 격리되고 replay write가 없다. empty-tip 각 축 회귀가 state bytes 불변까지 단언한다. |
| ADR Principle 3 — durable evidence 동일 의미 | **Partial** | `src/craft/verdict.ts:373-384,561-579,590-600`; `src/craft/audit-policy.ts:268-276` | canonical snapshot의 base prose segment는 fresh/replay 모두 같은 `describeAuditBase` return bytes를 사용한다. 다만 parser의 accepted superset이 forged drift prose를 canonical replay로 재생할 수 있어 전체 principle은 아직 Partial이다. |
| PR-1 Guardrail — pure core/thin wrapper | **Met** | `src/artifacts/paths.ts:96-104`; `src/craft/run-check.ts:354-395,493-507`; `src/craft/verdict.ts:408-413,651-672` | wrapper/core가 같은 `FEATURE_SLUG_RE`, `controlSafeEcho`, refusal wording을 사용한다. persisted identity 판단은 `performRunCheck` core에 있고 wrapper에는 slug-before-fs guard와 dependency wiring만 남는다. |
| PR-4 §3.2/§4.2/§5/§6.1 정규형 | **Met** | `skills/post-craft/SKILL.md:225-313` | fix delta는 이 계약을 변경하지 않았다. structural owner equality, exact result pair set, current OID/cycle binding, fix-verification precedence가 한 정규형으로 유지된다. |
| PR5-5 red continuation — `B 관측` 실행 증거 축 | **Partial** | `test/e2e-red-cycle-continuation.test.ts:220-290`; `test/e2e-helpers.ts:270-295`; `check/logs/check-7.log:774-790`; `check/logs/check-8.log:394-397` | exact agent/feature/cycle와 B-descendant test/check commit은 강화됐다. 하지만 with-commit arm은 `completedTaskSpawnSeen`만으로도 early-exit할 수 있어 그 commit OID에서 check가 실행됐음을 증명하지 않고, kill 뒤 `resultDelivered===true`를 별도 요구해 plan보다 강하고 RF-28 seam이 보장하지 못하는 race를 만든다. 같은 test code가 check-7 red/check-8 green이었다. |
| PR-5 step 7 / Success 8 — 표준 4-file E2E 전체 green | **Unmet** | `test/e2e-full-cycle.test.ts:75-101,330-350`; `package.json:15-17`; `check/logs/check-8.log:292-320` | unit/build/preset/continuation은 green이지만 full-cycle post-craft가 50-minute stage timeout으로 killed됐다. `TEST_TIMEOUT_MS` 13,500,000ms보다 package `--testTimeout=10200000`도 55분 짧다. |
| Plan Must-NOT-Have — 새 state/storage/migration/cap alias 금지 | **Met** | `src/craft/state.ts:110-128`; `src/craft/tool-text.ts:48-59`; `package.json:15-17` | `ef43a24..a1af63b` path set에 `state.ts`, `skills/`, `README.md`, `.gitignore`, `package.json` 변경이 없다. source 변화는 parser/message serializer seam뿐이며 새 top-level CraftState key, storage path, migration, cap alias는 없다. |

## Priority Falsification Question

**답: 우려가 성립한다. stricter parser가 legitimate production snapshot을 거절하는 역방향 회귀는 없지만, production writer가 만들 수 없는 forged shape를 여전히 수용한다. 따라서 RF-32는 literal empty-tip 교정은 적용됐어도 ADR Principle 3의 exact-shape 복원 기준에서는 부분 적용이다.**

### Producer shape 전수 대조

| Producer path | `observeAuditBase`가 persist할 수 있는 shape | Parser | 판정 |
|---|---|---|---|
| explicit base resolve + source resolve + `rev-list` 성공 | `ok`, explicit authority, measured/measured tips, safe integer count | 수용 | legitimate |
| explicit base ref unresolvable | `unknown`, explicit authority, `""/""`, `"unknown"`, error | 수용 | legitimate; source를 아예 측정하지 않으므로 sourceTip도 `""` |
| explicit base measured, source `HEAD` 실패 | `unknown`, explicit authority, measured/`""`, `"unknown"`, error | 수용 | legitimate partial observation |
| explicit base+source measured, `rev-list` 실패 또는 non-integer | `unknown`, explicit authority, measured/measured, `"unknown"`, error | 수용 | legitimate; 따라서 `unknown + 40-hex tips + "unknown"`은 forged가 아니다 |
| legacy attached branch | 위 세 anchor 결과와 동일하되 `legacy-current-branch` authority | 수용 | legitimate |
| legacy detached/unborn/current-branch 또는 base resolve 실패 | `unknown`, legacy authority, `""/""`, `"unknown"`, error | 수용 | legitimate |
| project/source Git failure | 실패 단계에 따라 `""/""` 또는 measured/`""` unknown | 수용 | legitimate |
| forged persisted record | `unknown`, baseTip `""`, sourceTip measured | **수용** | `observeAuditBase`는 base를 먼저 resolve하므로 만들 수 없는 inverse-partial shape |
| forged persisted record | `ok`, `baseTip===sourceTip`, `behindCount>0` | **수용** | `git rev-list --count <oid>..<same oid>`는 반드시 0이므로 production writer가 만들 수 없는 false drift |

근거:

- `src/craft/verdict.ts:312-365`는 base resolve → source resolve → count 순서로 snapshot을 만든다.
- `src/craft/audit-policy.ts:258-278`는 `ok`에서 두 measured OID와 safe non-negative count만 검사하고 tip equality↔zero-count coupling을 검사하지 않는다. `unknown`에서는 두 tip 각각을 독립적으로 empty-or-OID로 허용한다.
- `src/craft/state.ts:141-158`의 의미 계약은 `"ok" iff baseTip/sourceTip/behindCount were all measured`이다.
- canonical snapshot의 prose는 `src/craft/verdict.ts:373-384`의 한 formatter가 fresh begin과 replay 양쪽에서 호출되므로 base suffix는 byte-identical하다. `controlSafeEcho("feat/lets-craft-v1")`가 JSON quotes를 공급해 fresh/replay 모두 `explicit-base "feat/lets-craft-v1"` 형태다.
- 문제는 formatter divergence가 아니라 parser accepted set이다. `ok + equal tips + positive count`는 replay에서 canonical `WARN: base drift`로 재생돼 durable bytes의 의미가 production observation과 달라진다.

## VerificationResult — RF-32

- **itemId:** `RF-32`
- **ownerRef:** `{ kind: "auditor", lens: "plan" }`
- **implementationOid:** `a1af63b2bfda95b182a8717e3acd8783920c16f6`
- **auditCycle:** `4`
- **raw judgment:** **부분 적용**
- **evidence:**
  - `src/craft/audit-policy.ts:244-270` — `isMeasuredOid`와 `status === "ok"` 양 tip 강제가 추가됐다.
  - `test/audit-policy.test.ts:564-588` — legitimate measured-tip unknown 보존과 `ok+empty baseTip`/`ok+empty sourceTip` 거절이 고정됐다.
  - `test/craft-verdict.test.ts:1395-1433` — both-empty와 각 단일-empty 축에서 constant invalid-state, details suppression, byte-stability가 고정됐다.
  - `src/craft/audit-policy.ts:268-276` + `src/craft/verdict.ts:324-332` — equal measured tips와 positive count의 불가능 coupling을 parser가 아직 수용한다.
  - Scoped verification: `npx vitest run test/audit-policy.test.ts test/craft-verdict.test.ts` → **2 files, 179 tests passed**.
- **closure assessment:** literal RF text의 empty-tip remediation과 negative fixtures는 적용됐으나, 이 lens에 할당된 exact producer-shape falsification에서 same durable meaning을 깨는 accepted superset이 남았다. 아래 finding의 remediation은 **apply-only**다.

## Findings

1. **보완 · MAJOR** — **[RF-32 residual · apply-only]** parser가 production observation으로 만들 수 없는 snapshot coupling을 canonical replay로 수용한다.
   - Evidence: `src/craft/audit-policy.ts:268-276` — `"if (!isMeasuredOid(baseTip) || !isMeasuredOid(sourceTip)) return undefined; return { baseBranch, baseTip, sourceTip, behindCount, status, authority, observedAt };"`; tip equality와 count coupling 검사가 없다.
   - Evidence: `src/craft/verdict.ts:324-332` — `"rev-list", "--count", \`${sourceTip}..${baseTip}\`` 뒤 safe count를 기록한다. 같은 tip이면 production count는 0이다.
   - Required by: `plan.md:70` — `"durable evidence는 retry·fresh process·legacy state에서 같은 의미를 가져야 한다."`
   - Required by: `src/craft/state.ts:151-155` — `"ok" iff baseTip/sourceTip/behindCount were all measured`.
   - Actual: `ok + equal 40-hex tips + behindCount>0`과 `unknown + empty baseTip + measured sourceTip`이 parser를 통과한다. 전자는 false drift prose를 만들고, 후자는 base-first producer ordering에 존재하지 않는다.
   - Remediation: `parseAuditBaseSnapshot`에 `(status==="ok" && baseTip===sourceTip && behindCount!==0)` 거절과 `(status==="unknown" && baseTip==="" && sourceTip!=="")` 거절을 추가한다. 두 shape 각각에 pure parser negative와 same-cycle replay의 constant invalid-state·details suppression·byte-stability 회귀를 추가하고, measured/measured unknown은 `rev-list` failure의 legitimate shape로 계속 허용한다.

2. **수정 · MAJOR** — **[RF-35(a) residual · apply-only]** red-continuation E2E가 plan의 executed-OID evidence를 증명하지 않으면서 post-kill `resultDelivered`를 더 강한 성공 조건으로 요구한다.
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:220-234` — early exit은 `RUN_CHECK_MARKER || completedTaskSpawnSeen(stdout)` 중 하나와 commit landing만 요구한다.
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:281-290` — process 종료 뒤 `engineerSpawn?.resultDelivered === true`를 hard assertion으로 요구한다.
   - Evidence: `test/e2e-helpers.ts:277-294` — early-exit match 후 1,200ms 뒤 result를 resolve하고 parent process에 `SIGKILL`을 보낸다.
   - Evidence: `check/logs/check-7.log:774-790` — exact `lsc-test-engineer` call은 존재하지만 kill 시점 durable record가 `delivered=false`여서 red였다. `check/logs/check-8.log:394-397`은 같은 production test code로 green이었다.
   - Required by: `plan.md:413` — `"B 관측"은 exact HEAD equality가 아니라 "§3.0이 B production snapshot을 입력으로 읽었고 이후 test/check commit OID에서 실행"했음을 뜻한다.
   - Required by: `plan.md:422` — `"B 관측은 exact HEAD B가 아니라 §3.0의 B production snapshot 입력과 이후 test/check commit OID 실행으로 단언한다."`
   - Actual: with-commit branch는 B-descendant test/check commit 존재를 증명하지만 그 OID에서 check가 실행됐다는 durable evidence를 요구하지 않는다. 반대로 toolResult flush는 plan의 B-observation 의미가 아닌데 SIGKILL 뒤 hard-gate해 구조적 race를 만든다.
   - Remediation: early-exit의 completed-task arm을 제거하고 `cycle-1 marker ∧ continuation commit landed ∧ fresh run-check execution after that snapshot`을 요구한다. exact task args는 durable JSONL로 유지하되 `resultDelivered`가 필요하다면 **kill 전에** durable pair가 존재할 때만 early-exit하도록 한다. with-commit/no-commit 양쪽 모두 fresh check log index와 실행 snapshot OID를 명시적으로 결합하고, post-kill `resultDelivered` 단독 assertion은 제거한다.

3. **수정 · MAJOR** — **[RF-35(b) residual · apply-only]** timeout attribution은 적용됐지만 stage/global 예산 재산정은 실제 orchestration wait 구조와 서로 일치하지 않아 표준 E2E가 여전히 killed된다.
   - Evidence: `test/e2e-full-cycle.test.ts:75-101` — `POST_CRAFT_TIMEOUT_MS`는 단 하나의 50-minute 내부 wait와 같은 3,000,000ms이고, 계산된 `TEST_TIMEOUT_MS`는 13,500,000ms다.
   - Evidence: `package.json:15-17` — 표준 E2E의 Vitest timeout은 `--testTimeout=10200000`으로 계산값보다 3,300,000ms 짧다.
   - Evidence: `check/logs/check-8.log:292-320` — post-craft는 초기 test-authoring/review 결과 뒤 auditor respawn 2건이 `delivered=false`인 상태에서 50-minute stage budget에 의해 killed됐다. 새 stall builder는 spawns, entry tail, stage markers, 외부 artifact를 실제 보존했다.
   - Required by: `audit/audit-3.md:286` — `"단계 예산을 실측 green run(check-4: 3,201s 파일 시간) 기준으로 재산정하라."`
   - Required by: `plan.md:451-452` — targeted/full E2E가 `"실제 exit/test count와 함께 green"`이어야 한다.
   - Actual: outer post-craft stage budget을 내부 wait 한 번과 같게 설정했지만 post-craft는 §3.0 wait, §3.2 batch wait, 허용된 한 번의 respawn wait를 순차적으로 가질 수 있다. 또한 file-level 계산값도 package-level timeout에 반영되지 않았다.
   - Remediation: `POST_CRAFT_TIMEOUT_MS`를 허용되는 세 순차 wait class(§3.0, initial review batch, one respawn)와 bounded overhead의 합으로 계산하고, 그 결과로 `TEST_TIMEOUT_MS`를 재계산한다. `package.json`의 `--testTimeout`을 그 계산값 이상으로 같은 변경에서 맞추고 두 값의 drift를 검출하는 작은 contract assertion을 추가한다. check-8이 증명한 stall attribution builder는 그대로 유지한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 지시대로 `LSC_E2E` test와 전체 suite는 재실행하지 않았다. E2E 판정은 frozen OID의 deterministic `check-8.log`와 동일 test code의 `check-7.log`를 직접 읽어 내렸다.
- RF-32 scoped proof로만 `npx vitest run test/audit-policy.test.ts test/craft-verdict.test.ts`를 실행했고 179/179 green을 확인했다.
- SHA-256 object-format Git repository는 canon이 RF-32에 exact 40-lower-hex를 명시하므로 조사하지 않았다.
- `plan/appendix-*`는 core plan에 이번 결정과 falsification 기준이 충분히 적혀 있어 열지 않았다.
- RF-35(b)는 post-craft timeout attribution만 처방했다. check-7의 pre-craft timeout은 여전히 `debugSummary`만 사용하지만, 그 축의 일반화는 이번 Required Fix의 명시 범위 밖이라 별도 finding으로 승격하지 않았다.
- 외부 설치 `omp`의 실제 plugin/profile 경로와 RF-31 hermeticity는 이 lens의 owner criterion이 아니어서 runtime 재현하지 않았다. fix delta의 해당 test code는 whole-delta sweep에서 읽었지만 RF-31 closure 판정은 하지 않았다.
