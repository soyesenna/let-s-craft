**AUDITOR VERDICT: APPROVE-WITH-CHANGE**
Reviewed: postcraft-14cycle-approval-failure @ fbc4c9c73237441d653e26c7a6a15456f8afc7b2 · audit cycle 1

## Lens

**Lens ② — plan·ADR 준수 (fix-verification)**

승계 범위: RF-1·RF-2·RF-3·RF-6·RF-11·RF-14, 그리고 audit-0에서 `Unmet`/`Partial`이었던 MH-3, PR1-4(c), PR1-4(i), PR4-5, PR4-6, PR5-3, PR5-4, PR5-5, PR3-A3.

우선 반증 질문:

> “RF-3 fix는 `dueCycle === auditCycle + 1` 검증을 추가했지만 그 검증이 pending consume 분기 뒤에 배치되었거나 equality-replay 경로가 여전히 pending 소비보다 후순위여서, audit-0이 관측한 ‘pending consume이 equality replay보다 선행’하는 순서 위반이 실질적으로 잔존한다”

## Expected State — commit-first

아래 기대 상태는 `spec.md`·`plan.md`·audit-0 Required Fix를 먼저 읽고, 구현 diff와 코드를 열기 전에 고정했다.

1. **RF-1 / MH-3** — disposition은 세 canonical raw string만 exact membership으로 받아야 한다. 앞·뒤 whitespace가 붙은 값은 open pending을 소비하지 않고 `invalid-disposition`으로 차단되며, durable state는 byte-stable이어야 한다. 근거: `plan.md:43`, `audit/audit-0.md:213`.
2. **RF-2 / PR1-4(c)** — history와 pending을 포함한 모든 record의 `intervalCycles`는 하나의 persisted interval과 같아야 한다. 양방향 mixed interval은 write 전에 `invalid-state`여야 한다. 근거: `plan.md:42,174-175`, `audit/audit-0.md:214`.
3. **RF-3 / PR1-4(i)** — open pending은 persisted marker가 있으면 `dueCycle === auditCycle + 1`이어야 한다. 이 검증을 통과한 뒤 `candidateCycle === auditCycle`이면 pending 존재 여부와 무관하게 idempotent `replay`여야 하며, cycle/check threshold/base/state를 다시 쓰지 않아야 한다. 최신 completed audit 하나 삭제로 생긴 equality replay도 허용 경계다. 근거: `plan.md:58,177-180`, `audit/audit-0.md:215`.
4. **RF-6 / PR4-5·6** — 두 retry selector의 거절/취소는 각각 `retry-declined`/`retry-cancelled`; `retry-exhausted`는 row 4만 소유한다. 두 retry 모두 integrated `{worktreeAbs}`의 단일 production-repair executor만 실행하고 삭제된 parallel lane을 재실행하지 않으며, post-craft §6.1이 이를 mirror해야 한다. 근거: `plan.md:325-326`, `audit/audit-0.md:218`.
5. **RF-11** — 두 corrupt-state fixture는 `decision.type === "blocked"`와 exact reason을 무조건 단언해야 한다. 근거: `audit/audit-0.md:222`.
6. **RF-14** — `partial original apply-only`, `new unrelated apply-only MAJOR` 두 positive와 열거된 negative case가 각각 기대 four-level 결과에 매핑되어야 한다. §4.2와 §5 양쪽 heading 안에 계약이 있고 각 case가 독립 테스트여야 한다. 근거: `plan.md:389`, `audit/audit-0.md:225`.
7. **이전 Partial 행** — Continue는 completed begin tuple `[isError, success]` 두 건만 허용하고, Abort delegation은 hard assertion이어야 한다. Red continuation은 completed task end 또는 run-check marker만 종료 조건으로 쓰며, land git failure는 real seam에서 fail-closed로 검증되어야 한다. 근거: `plan.md:254,411-413,421-422`.

## Priority Falsification Question

**결론: 우려가 실질적으로 성립한다.** RF-3의 첫 절반은 적용됐지만 equality-replay 우선순위는 여전히 잘못됐다.

분기 순서는 다음과 같다.

1. shape/ledger 및 marker coupling 검증 — `src/craft/audit-policy.ts:375-400`
2. terminal block — `src/craft/audit-policy.ts:402-406`
3. pending branch 진입 — `src/craft/audit-policy.ts:408`
4. 새 `pending.dueCycle === auditCycle + 1` 검증 — `src/craft/audit-policy.ts:412-416`
5. `candidateCycle !== pending.dueCycle`이면 `stale-pending` 반환 — `src/craft/audit-policy.ts:417-423`
6. pending disposition 소비 — `src/craft/audit-policy.ts:425-443`
7. equality replay — 그 뒤인 `src/craft/audit-policy.ts:464-465`

따라서 `{auditCycle:2, pending.dueCycle:3, candidateCycle:2}`처럼 **정상 marker+1 pending이 열린 상태의 equality candidate**는 due invariant를 통과한 뒤 `:417`에서 `stale-pending`으로 끝나며 `:464` replay에 도달하지 못한다. 구현 테스트도 이 잘못된 결과를 명시적으로 고정한다: `test/audit-policy.test.ts:229-239`는 같은 형태를 `blocked/stale-pending`으로 기대한다.

반면 audit-0이 직접 제시한 forged `{auditCycle:3, pending.dueCycle:3, candidateCycle:3}`은 새 검증에서 `invalid-state`로 막힌다(`test/audit-policy.test.ts:248-261`). 즉 **forged equality consume 차단은 적용됐지만, “pending 유무와 무관한 equality replay”는 미적용**이다. 코드 분기만으로 판별 가능해 별도 실행 프로브는 필요하지 않았다.

## Compliance Matrix

이번 fix-verification 범위에서 audit-0의 `Unmet`/`Partial` 행만 재검증했다.

| Requirement / Step | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| MH-3 — exact canonical labels만 소비 | **Met** | `src/craft/audit-policy.ts:48-54`; `test/audit-policy.test.ts:84-98,441-469` | `.trim()`이 제거됐고 세 label 각각의 padded 변형이 차단·byte-stable·후속 exact consume으로 고정됐다. |
| PR1-4(c) — 모든 history/pending record의 interval 동일 | **Met** | `src/craft/audit-policy.ts:256-277,307-315`; `test/audit-policy.test.ts:335-360` | pending parse 후 persisted interval 비교가 있고 history 3/pending 2 및 history 2/pending 3 양방향이 `invalid-state`/무-write다. |
| PR1-4(i) — equality replay와 marker coupling | **Partial** | `src/craft/audit-policy.ts:379-400,408-465`; `test/audit-policy.test.ts:229-261,273-285` | forged pending==marker 차단과 pending 없는 replay는 구현됐지만, 정상 marker+1 pending이 존재하면 equality candidate가 replay보다 먼저 `stale-pending`으로 차단된다. |
| PR4-5 — EXEC/IMPL retry topology | **Met** | `skills/craft/SKILL.md:155-173`; `test/skill-contract.test.ts:1191-1210` | 두 selector 모두 integrated root의 단일 production-repair executor를 사용하고 per-lane re-spawn 문언이 제거됐다. lane ban이 두 경로에 결합됐다. |
| PR4-6 — exact incomplete reasons와 post-craft mirror | **Met** | `skills/craft/SKILL.md:167-188`; `skills/post-craft/SKILL.md:334`; `test/skill-contract.test.ts:1192-1218` | 거절/취소/소진 mapping과 post-craft §6.1 mirror가 동일하게 고정됐다. |
| PR5-3 — Continue 정확 2회 | **Met** | `test/e2e-audit-escalation.test.ts:117-153`; `test/e2e-helpers.ts:763-783`; `test/e2e-helpers.test.ts:370-392` | early-exit와 최종 assertion이 모두 exact ordered tuple `[true,false]`를 요구한다. |
| PR5-4 — Abort delegation 증거 | **Met** | `test/e2e-audit-escalation.test.ts:161-194` | terminal marker와 abort marker가 모두 있어야 종료하며, `state.aborted === true`가 무조건 assertion이다. |
| PR5-5 — red continuation B-bound 증거 | **Met** | `test/e2e-red-cycle-continuation.test.ts:188-225`; `test/e2e-helpers.ts:812-822`; `test/e2e-helpers.test.ts:395-410` | raw task substring arm이 제거됐고 parsed `tool_execution_end`만 completed task로 인정한다. 이후 B descendant/test-check artifact assertion도 유지된다. |
| PR3-A3 — git failure가 손실되지 않음 | **Met** | `src/craft/land.ts:408-437`; `test/craft-land-flow.test.ts:1338-1401` | unrelated-history merge-base 실패가 real land seam에서 `added-path-unknown`, merge 미호출, worktree 존치, nonce 소비, fresh approval 요구로 고정됐다. |

## Required Fix Completeness

| Required Fix | Status | Evidence (file:line) | 판정 |
|---|---|---|---|
| RF-1 | **Met** | `src/craft/audit-policy.ts:48-54`; `test/audit-policy.test.ts:84-98,441-469` | raw exact membership 및 세 canonical padded 경계 회귀가 완전 적용됐다. |
| RF-2 | **Met** | `src/craft/audit-policy.ts:307-315`; `test/audit-policy.test.ts:335-360` | pending interval 검증, mixed-interval 문구, 양방향 fixture, 무-write가 모두 적용됐다. |
| RF-3 | **Partial** | `src/craft/audit-policy.ts:408-465`; `test/audit-policy.test.ts:229-261` | due==marker+1 검증과 forged-state 차단은 적용됐지만 equality replay가 pending branch보다 뒤에 남았다. |
| RF-6 | **Met** | `skills/craft/SKILL.md:167-188`; `skills/post-craft/SKILL.md:334`; `test/skill-contract.test.ts:1191-1218` | reason mapping, integrated single executor, 양 retry lane ban, mirror 및 contract test가 적용됐다. |
| RF-11 | **Met** | `test/audit-policy.test.ts:310-325,365-386` | 두 fixture 모두 먼저 unconditional `expect(decision.type).toBe("blocked")`를 수행하고 exact `invalid-state` reason을 단언한다. |
| RF-14 | **Met** | `skills/post-craft/SKILL.md:227-242,244-313`; `test/skill-contract.test.ts:1229-1270` | 2 positive + 8 negative가 §4.2 표와 §5 synthesis에 명시됐고, 각 case가 독립 heading-bounded `it`으로 고정됐다. |

## Findings

1. **수정 · CRITICAL** — RF-3의 equality replay가 여전히 pending 분기 뒤에 있어, 정상 open pending이 존재하는 same-cycle replay가 `stale-pending`으로 잘못 차단된다.
   - Evidence: `src/craft/audit-policy.ts:408-465` — `pending.dueCycle !== auditCycle + 1` 검증 뒤 `candidateCycle !== pending.dueCycle`가 `stale-pending`을 반환하고, equality `return { type: "replay" }`는 `:464-465`에 있다. `test/audit-policy.test.ts:229-239`는 `{auditCycle:2,pending.dueCycle:3,candidateCycle:2}`를 `blocked/stale-pending`으로 고정한다.
   - Required by: `audit/audit-0.md:215` — “equality(candidate===marker)는 pending 유무와 무관하게 replay로만 귀결”; `plan.md:177` — equality는 idempotent replay; `plan.md:58` — latest completed audit 하나 삭제로 생긴 equality replay는 허용.
   - Actual: forged pending==marker는 올바르게 `invalid-state`가 됐지만, valid marker+1 pending이 열린 상태에서 candidate가 marker와 같으면 replay 대신 오류로 끝난다. 즉 audit artifact 하나 삭제·crash replay 허용 경계가 pending 존재 여부에 따라 달라진다.
   - Remediation: ledger 검증과 `pending.dueCycle === auditCycle + 1` 검증은 write 전에 유지하되, valid terminal block 뒤에는 `candidateCycle === persistedAuditCycle`을 pending stale/consume보다 먼저 `replay`로 반환하라. 현재 `test/audit-policy.test.ts:229-239`를 replay+byte-stable 기대값으로 교체하고, persisted check threshold/base snapshot을 포함한 `performAuditBegin` filesystem fixture로 open-pending equality replay가 상태 파일 bytes를 바꾸지 않음을 고정하라.

2. **보완 · MAJOR** — RF-10이 E2E command는 추가했지만 §3.1 timeout을 E2E 예산에 맞게 상향하지 않았다. `(outside lens)`
   - Evidence: `skills/post-craft/SKILL.md:40,100` — canonical 호출은 여전히 `timeout_ms: 600000`, fixture는 `120000`; `.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh:19-22` — 순차 E2E 최악 예산을 `4 × 10200s`와 file별 hook timeout으로 명시; `package.json:17` — 네 E2E 파일을 `--no-file-parallelism --testTimeout=10200000 --hookTimeout=120000`으로 실행한다.
   - Required by: `audit/audit-0.md:230` — “§3.1 `timeout_ms`를 E2E 예산에 맞게 상향.”
   - Actual: check entrypoint는 `npm run test:bun`과 `npm run e2e`를 실행하지만, post-craft 계약은 E2E의 순차 configured ceiling보다 약 68배 짧은 10분에 check를 kill할 수 있다. 이는 실제 이번 check가 실패했다는 주장이 아니라, Required Fix의 timeout 정합이 적용되지 않았다는 판단이다.
   - Remediation: `skills/post-craft/SKILL.md`의 tool inventory와 §3.1 호출을 같은 단일 값으로 바꾸고, 현재 package ceiling 기준 최소 `41,280,000ms`에 build/unit 여유를 더한 `43,200,000ms`를 사용하라. fixture `120000` 예외도 entrypoint가 E2E를 무조건 실행하는 동안에는 제거하거나 동일 예산으로 맞추고, 두 heading의 timeout이 drift하지 않는 contract test를 추가하라.

3. **보완 · MAJOR** — RF-4의 plugin pinning이 global plugin symlink가 이미 존재한다고 가정해 clean/missing-link 환경에서 self-heal 전에 예외가 난다. `(outside lens)`
   - Evidence: `test/e2e-helpers.ts:52-55` — 첫 연산이 `readlinkSync(GLOBAL_PLUGIN_LINK)`이고, link 재설정 명령은 그 비교 뒤에 있다; `test/e2e-helpers.ts:270-271` — 모든 child spawn 전 이 함수가 실행된다; `package.json:17` — E2E script 자체에는 선행 `omp plugin link` 단계가 없다.
   - Required by: `audit/audit-0.md:216` — per-run repo pinning과 “global link 암묵 의존 제거.”
   - Actual: link가 없거나 symlink가 아닌 경우 `readlinkSync`가 `ENOENT`/`EINVAL`을 던져 `omp plugin link REPO_ROOT`에 도달하지 못한다. 기존 wrong-target symlink는 교정하지만, global link의 존재 자체에는 여전히 암묵 의존한다.
   - Remediation: missing/non-symlink/dangling 상태를 guarded `lstat`/`readlink` 또는 `ENOENT`·`EINVAL` catch로 “not pinned” 처리한 뒤 `omp plugin link REPO_ROOT`를 실행하고, 이후 `realpath`와 `BUILD_INFO.gitHash`를 검증하라. 임시 `HOME`을 사용하는 subprocess 회귀로 missing link → 생성, wrong target → 재지정, correct target → no-op 세 경계를 고정하라.

## 부수 회귀 점검

- `2607199..fbc4c9c` fix delta의 29개 변경 파일을 직접 열어 plan-critical policy, retry prose, E2E assertion/helper, land failure seam, check entrypoint를 점검했다.
- lifecycle slug SSOT와 re-registration durability 변경은 `src/artifacts/paths.ts:104`, `src/craft/state.ts:255-270`, `src/craft/init.ts:107-109`에서 기존 plan의 exact-root/optional-state 방향과 충돌하지 않았다.
- 부수 점검에서 발견한 blocking gap은 위 RF-10 timeout과 RF-4 missing-link 경계 두 건이다. 그 외 재검증 대상 행에서는 새로운 plan·ADR 이탈을 찾지 못했다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 과제의 동시 실행 오염 금지에 따라 worktree에서 build, unit, Bun, E2E, `run_check.sh`를 실행하지 않았다. 현재 main 세션이 실행 중인 deterministic check의 실제 pass/fail·소요 시간은 이 lane이 검증하지 않았다.
- fix-verification 지시대로 audit-0에서 이미 `Met`였던 plan/ADR 전 행은 재구축하지 않았다. 위 표의 9개 이전 `Unmet`/`Partial` 행과 승계 RF, 그리고 fix-induced regression 표면만 직접 재검증했다.
- `trace.md`, plan appendix 두 파일, plan revision ledger `plan-{1..6}.md`는 이번 판정에 원 문제 framing이나 추가 ADR 근거가 필요하지 않아 열지 않았다.
- RF-4 missing-link 시나리오는 global plugin link를 변경해 main의 동시 check를 오염시킬 수 있어 실행 프로브하지 않았다. finding은 `readlinkSync`가 link 생성 명령보다 먼저 실행되는 코드 순서와 RF-4의 명시적 no-implicit-dependency 요구에 근거한다.
- 다른 audit lane의 보고서와 현재 deterministic check log는 보지 않았다. 따라서 다른 lens의 결론이나 수렴 여부는 이 보고서에서 주장하지 않는다.
