**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ fbc4c9c73237441d653e26c7a6a15456f8afc7b2 · audit cycle 1

## Lens

- 배정 lens: **① spec 정합 — fix-verification**
- 승계 Required Fix: **RF-12**
- 우선 반증 질문: **“`test/craft-land-flow.test.ts:1345-1402`의 RF-12 테스트는 사실은 land seam(`performLand` 전체 경로)이 아니라 순수 함수 레벨만 검증하거나, reason 문자열 멤버십만 확인하고 merge 미호출·worktree 존치·nonce 재승인 요구 중 하나 이상을 단언하지 않는다”**

## Expected State (commit-first)

아래 기대 상태는 `spec.md:68,88-96`과 이전 감사의 Required Fix(`audit/audit-0.md:212-226`)만 읽고, 구현 diff와 대상 코드를 열기 전에 고정했다.

1. **RF-12**: real-git unrelated-history fixture가 실제 등록된 `lsc_land` → `[Land]` 승인 → `performLand` Phase X로 들어가야 한다. `merge-base` 실패는 `reason=added-path-unknown`으로 닫히고, `effects.merge`는 0회, worktree는 존치, single-use nonce는 소비되며, 다음 호출은 새 승인을 요구해야 한다 (`audit/audit-0.md:223`).
2. **AC-1/AC-2**: raw canonical label만 소비되고, history↔pending mixed interval과 `candidateCycle === auditCycle` + open pending은 어떤 durable write보다 먼저 `invalid-state`여야 한다. pending 없는 equality만 replay여야 하며 terminal 처분은 durable 기록 후 후속 begin을 막아야 한다 (`spec.md:88-89`).
3. **AC-8**: 표준 `e2e`는 기존 2개+신규 2개를 실제 실행하고, child가 frozen worktree plugin을 로드해야 한다. Continue는 completed begin의 정확한 `[isError, success]` tuple, Abort는 실제 abort 위임, red continuation은 completed task/run-check만 증거로 인정해야 한다. `run_check.sh`는 `test:bun`과 `e2e`를 실제 호출해야 한다 (`spec.md:95`, `audit/audit-0.md:216,219-220,229`).
4. **AC-9**: RF-11/12/15가 지목한 모든 공백은 해당 production branch를 실제로 통과하는 vitest assertion으로 닫혀야 한다 (`spec.md:96`, `audit/audit-0.md:222-223,226`).
5. **C-6**: 세 label의 경계는 trim/normalize가 아닌 raw membership이어야 한다 (`spec.md:68`).

## Priority Falsification Question

**답: 우려는 성립하지 않는다. RF-12는 완전 적용됐다.**

- 테스트 helper는 real production tool registration을 사용한다. `test/craft-land-flow.test.ts:108-123`의 `buildTools`가 `registerLandTool`을 등록하고, `:316-329`의 `issueLandApproval`이 첫 `lsc_land` refusal → exact `[Land]` 질문 → real `lsc_confirm` → live pending approval을 만든다. 순수 함수 직접 호출만 하는 테스트가 아니다.
- `test/craft-land-flow.test.ts:1345-1376`은 orphan-root source branch를 만들고 실제 `git merge-base(targetOID, sourceOID)` 실패를 먼저 확인한다.
- 같은 테스트는 승인 후 등록된 `lsc_land`를 다시 호출한다 (`:1378-1386`). production code는 `src/craft/land.ts:365`에서 nonce를 소비하고 Phase X로 진입한 뒤(`:391`), 실제 `merge-base`를 수행한다(`:415-418`). `GitCommandError`는 `reason="added-path-unknown"`으로 반환된다(`:431-440`); `effects.merge`는 그 뒤 `:445-447`에서만 호출 가능하다.
- 테스트는 structured `details.reason` exact equality, merge 0회, worktree 존치, pending nonce 소멸을 각각 독립 단언한다 (`test/craft-land-flow.test.ts:1388-1396`). 재호출이 `approval-required`인 것도 단언한다 (`:1398-1401`). reason-code 배열 멤버십만 보는 테스트가 아니다.

## RF-12 적용 완전성

| 의무 | 판정 | Evidence |
|---|---|---|
| land-flow seam 전체 경로 | PASS | `test/craft-land-flow.test.ts:108-123,316-329,1384-1386` |
| 결정적 git failure fixture | PASS | `test/craft-land-flow.test.ts:1345-1376` |
| exact `added-path-unknown` reason | PASS | `test/craft-land-flow.test.ts:1388-1392`; `src/craft/land.ts:431-440` |
| merge 미호출 | PASS | `test/craft-land-flow.test.ts:1378-1393`; merge effect 위치 `src/craft/land.ts:445-447` |
| worktree 존치 | PASS | `test/craft-land-flow.test.ts:1394` |
| nonce 소비 | PASS | `test/craft-land-flow.test.ts:1395`; consume 위치 `src/craft/land.ts:365,391` |
| fresh approval 요구 | PASS | `test/craft-land-flow.test.ts:1398-1401` |

## Compliance Matrix

### Acceptance Criteria — audit-0의 Partial 행만 재검증

| Requirement | Status (Met/Partial/Unmet) | Evidence (file:line) | Notes |
|---|---|---|---|
| **AC-1 사이클 상한** | **Met** | `src/craft/audit-policy.ts:314-315,398-415,464-465`; `test/audit-policy.test.ts:248-263,335-361`; `test/craft-verdict.test.ts:1012-1035` | pending interval은 persisted interval과 exact 비교되고, equality+pending은 `auditCycle+1` invariant로 write 전 거부된다. perform seam 회귀가 state bytes·cycle·check threshold·base snapshot 불변까지 단언한다. 이전 Partial 근거인 mixed interval/equality 순서가 해소됐다. |
| **AC-2 처분 기록** | **Met** | `src/craft/audit-policy.ts:53-54,398-442`; `src/craft/state.ts:426-431`; `test/audit-policy.test.ts:441-463`; `test/craft-verdict.test.ts:380-399` | raw exact labels만 guard를 통과한다. padded 세 label은 `invalid-disposition`+byte-stable이고 exact label은 정상 소비된다. terminal은 history+mirror에 저장되며 후속 begin은 `terminal`로 거부된다. 이전 trim 경계 Partial이 해소됐다. |
| **AC-8 E2E** | **Partial** | Positive wiring: `package.json:17`; `README.md:239-256`; `check/run_check.sh:32-40`; `test/e2e-helpers.ts:52-70,270-271,763-821`; `test/e2e-audit-escalation.test.ts:116-159,163-194`; `test/e2e-helpers.test.ts:370-409`. Blocking regression: `test/e2e-helpers.ts:26,287`; clean-link gap: `test/e2e-helpers.ts:52-57` | RF-7/8 assertion 강도와 RF-10의 four-command 배선은 복구됐다. 그러나 RF-4 편집이 `spawn` import를 삭제한 채 `runOmpPrint`에서 사용해 4-file E2E 실행 경로가 runtime에서 막힌다. 또한 global plugin link가 아예 없는 환경은 relink 전에 `readlinkSync`가 throw한다. 실제 green 미관측 자체를 감점한 것이 아니라, 정적 실행 불능을 근거로 Partial 판정했다. |
| **AC-9 단위** | **Met** | RF-11: `test/audit-policy.test.ts:320-326`; RF-12: `test/craft-land-flow.test.ts:1345-1401`; RF-15: `test/craft-verdict.test.ts:1077-1153`, `test/craft-state.test.ts:447-508`, `test/craft-abort.test.ts:123-143`, `test/git-runner.test.ts:68-87` | RF-11의 unconditional block assertion, RF-12 land failure seam, RF-15의 anchorBaseSnapshot 3분기·unknown WARN·singleton sync/invalidation·base snapshot clear 2경로·git exitCode가 모두 직접 branch assertion으로 존재한다. 실행 green은 main의 결정적 체크가 판정한다. |

### Constraints — audit-0의 Partial 행만 재검증

| Requirement | Status (Met/Partial/Unmet) | Evidence (file:line) | Notes |
|---|---|---|---|
| **C-6 질문 태깅·exact labels** | **Met** | `spec.md:68`; `src/craft/audit-policy.ts:47-54`; `test/audit-policy.test.ts:84-99,441-463` | canonical 배열은 그대로이고 membership은 `.includes(value)` raw equality다. leading/trailing whitespace·newline·tab은 false/`invalid-disposition`, exact 세 label은 정상 소비된다. |

### Non-Goals

재검증 대상 없음 — audit-0에서 Partial/Unmet으로 판정된 Non-Goal 행이 없고, 사용자가 전 행 재구축을 명시적으로 제외했다. fix delta의 경로·원문 sweep에서는 새로운 scope behavior를 발견하지 않았지만, 이를 전 Non-Goal 재승인으로 확대 해석하지 않는다.

## 부수 회귀 점검

- 전체 feature diff 62개 경로와 fix delta 29개 경로를 열거하고, fix delta 원문 전 구간을 spec 각도에서 확인했다.
- RF-1/2/3의 policy 변경은 raw label, mixed interval, equality replay 순서를 닫았고, RF-11/12/15 테스트는 지목 branch와 대응했다.
- RF-7/8의 assertion 변경과 RF-10 배선 자체는 요구대로 강화됐다.
- 다만 RF-4의 `runOmpPrint` 재작성에서 **기존 `spawn`/`ChildProcess` import가 소실된 CRITICAL 회귀**와 **missing global link를 처리하지 않는 MAJOR 누락**을 발견했다. 아래 Findings에 각각 기록한다.

## Findings

1. **수정 · CRITICAL** — RF-4 재작성으로 `runOmpPrint`의 `spawn` import가 삭제되어 표준 4-file E2E가 첫 child 생성에서 실행 불능이다.
   - Evidence: `test/e2e-helpers.ts:26` — `import { execFileSync } from "node:child_process";`; `test/e2e-helpers.ts:287` — `const child: ChildProcess = spawn("omp", ompArgs, {`. `package.json:17`의 네 E2E 파일은 모두 이 helper를 사용하며, 직접 callsite도 `test/e2e-audit-escalation.test.ts:99`, `test/e2e-red-cycle-continuation.test.ts:139,184`, `test/e2e-full-cycle.test.ts:210,233`, `test/e2e-preset-default.test.ts:146`에 있다. `tsconfig.json:15`는 `src/**/*.ts`만 include하므로 package build가 이 test helper 오류를 선검출하지도 않는다.
   - Required by: `spec.md:95` — “fixture E2E에 다중 사이클 … 시나리오 신설 + 기존 E2E 전체 green”; `audit/audit-0.md:216` — `runOmpPrint`가 검증 대상 repo plugin으로 child를 실행하고 첫 model turn 전에 preflight해야 한다.
   - Actual: [INFERENCE] Vitest가 E2E를 실행해 `runOmpPrint`에 진입하면 module scope에 `spawn` binding이 없어 child 생성식에서 `ReferenceError`가 발생한다. `ChildProcess` type import도 함께 소실됐다. 따라서 RF-7/8 assertion까지 도달하지 못하고 AC-8 증거 경로 전체가 막힌다.
   - Remediation: `node:child_process` import를 `import { execFileSync, spawn, type ChildProcess } from "node:child_process";`로 복원한다. 그 후 정확히 `package.json:17`의 표준 4-file 명령을 실행해 네 파일이 child spawn 이후 assertion까지 도달하는 fresh 증거를 남긴다.

2. **보완 · MAJOR** — RF-4의 “global link 암묵 의존 제거”가 link-target mismatch만 처리하고 link 부재는 처리하지 않는다.
   - Evidence: `test/e2e-helpers.ts:52-57` — 첫 동작이 `if (readlinkSync(GLOBAL_PLUGIN_LINK) !== REPO_ROOT)`이고, 그 뒤에야 `omp plugin link`를 호출한다. 존재 검사나 `ENOENT` 처리 없이 `readlinkSync`가 선행한다.
   - Required by: `audit/audit-0.md:216` — per-run repo pinning과 “global link 암묵 의존 제거”.
   - Actual: [INFERENCE] clean machine/CI에서 `GLOBAL_PLUGIN_LINK`가 아직 없으면 `readlinkSync`가 throw하여 link를 생성하는 `omp plugin link`에 도달하지 못한다. 현재 workstation의 read-only `readlink` 관측은 해당 link가 frozen worktree를 가리켜 이 branch를 가리지만, 구현의 missing-link 경계를 닫지는 않는다.
   - Remediation: link의 존재/유형/해석을 try/catch로 관측하고, missing·dangling·wrong-target이면 먼저 `omp plugin link REPO_ROOT`를 실행한다. 이후에만 `realpathSync(link) === realpathSync(REPO_ROOT)`와 build hash를 fail-closed 재검증한다. missing-link와 wrong-target 두 경우를 별도 helper 회귀로 고정한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- assignment의 동시 실행 오염 금지에 따라 `npm run build`, `npm test`, `npm run test:bun`, `npm run e2e`, formatter/linter를 이 lane에서 실행하지 않았다. 실제 cycle-1 green/red 결과는 main 세션의 단일 결정적 체크가 소유한다. 실행 증거 부재 자체는 본 판정의 거부 근거가 아니다.
- missing global-link branch는 read-only 제약 때문에 실제 symlink를 제거해 동적으로 재현하지 않았다. 현재 link가 frozen worktree를 가리킨다는 read-only 관측까지만 했다.
- 사용자가 지정한 fix-verification 범위에 따라 audit-0에서 이미 Met이던 AC/Constraint/Non-Goal 전 행은 재구축하지 않았다.
- `trace.md`, plan revision ledger, 두 appendix, research corpus의 의미론은 이번 RF-12/Partial-row 검증에 필요하지 않아 재검토하지 않았다.
- 실제 provider/model 응답 안정성, 장시간 E2E transcript, generated `dist` parity는 검사하지 않았다.
