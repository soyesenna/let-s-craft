**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ 59a81811bd3fba3613761f7e3db6844b29681b04 · audit cycle 2 (fix-verification)

## Lens

**Lens ② — plan·ADR 준수.** Fix delta 전체를 plan·ADR 준수 관점에서 검토했으며, 승계 소유는 RF-21과 PR5-3/4/5 실행 증거 축, RF-19/20의 PR-1 invariant·precedence·Guardrails 비회귀다.

우선 반증 질문:

> "RF-21의 contract test(test/skill-contract.test.ts:1282-1298 근방)는 SKILL.md 표면 문자열만 고정할 뿐이어서: (1) 두 heading 중 하나만 갱신되고 다른 하나에 fixture 120000 또는 구 600000이 잔존해도, 또는 (2) drift가 생겨도 실제로는 green이다. 그리고 43,200,000이라는 수치가 spec Constraint 8(cap 수치 SSOT는 TS 상수; 독립 수치 별칭 금지)의 정신을 위반하는 새 산문 독립 수치일 수 있다."

## Expected State

아래 기대 상태는 `spec.md`·`plan.md`·audit-1 Required Fix만 읽은 뒤, 구현 diff와 코드를 열기 전에 고정했다.

1. **RF-21** — `audit/audit-1.md:251`, `spec.md:70`: `skills/post-craft/SKILL.md`의 §1.5 tool inventory와 §3.1 호출이 하나의 `timeout_ms >= 43,200,000`을 사용하고, fixture `120000` 및 구 `600000` 예외가 없어야 한다. Contract test는 두 호출의 개수·동일성·하한·구값 부재를 판별해야 한다. 검증법은 두 SKILL 좌표와 test matcher를 직접 대조하고 `package.json`의 순차 E2E ceiling을 재산정하는 것이다.
2. **PR5-3** — `plan.md:411`, `audit/audit-1.md:246-248`: 실제 fixture subprocess 경로가 `spawn` 가능하고, 두 ignore invariant가 각각 성공한 뒤 Continue가 completed begin 결과 정확히 `[true,false]`, success 1회, durable next-due를 단언해야 한다. 검증법은 공용 helper의 import/spawn/seed와 Continue test의 early-exit·최종 assertion을 연결해 읽는 것이다.
3. **PR5-4** — `plan.md:412`: Abort subprocess는 terminal marker와 abort-tool marker를 모두 기다리고 `aborted === true`를 무조건 단언해야 하며, branch/worktree/land 부재를 보존해야 한다. 검증법은 공용 setup과 Abort branch의 wait/assertion을 직접 추적하는 것이다.
4. **PR5-5** — `plan.md:413`: A→B descendant commit, B의 executed-red `[Craft Incomplete]`, 별도 정상 post-craft process, completed task/run-check 관측, B 위 test/check descendant commit을 증명해야 한다. 검증법은 두 subprocess 경계와 OID·diff assertion을 직접 추적하는 것이다.
5. **RF-19 / PR1-6** — `audit/audit-1.md:249`, `plan.md:181`: strict preservation decode 실패는 persist/publish 전에 전파되고, best-effort는 undecodable disk bytes를 쓰지 않아야 한다. malformed/future-version의 실제 init·strict 경로에서 bytes 불변/미등록, 재등록 전후 전체 serialized representation 동등성이 고정돼야 한다. 기존 atomic/exact-root 저장과 optional v2 표면은 바뀌지 않아야 한다.
6. **PR1-4 (a)~(i) 및 precedence** — `plan.md:175-180`: shape·산술·연쇄 검증 → terminal → exact pending → history-derived schedule 순서를 유지하고, RF-19/20이 ledger 산술·mirror·candidate marker 의미를 바꾸지 않아야 한다. 검증법은 `validateEscalationLedger`와 `evaluateAuditBeginGate` 전체 분기를 직접 읽는 것이다.
7. **RF-20 / Guardrails / ADR** — `audit/audit-1.md:250`, `plan.md:41-58,68-70`: shared control validator가 지정 input의 effect/observation보다 앞서고, diagnostic은 escaped/constant이며, land terminal은 canonical runtime parse 뒤에만 보간되고, run-check는 실제 tool boundary에서 slug를 filesystem access 전에 거부한 뒤 persisted root를 `ctx.cwd` 또는 computed worktree와 exact 비교해야 한다. 새 storage·파괴 경로·cap alias·land 권한 확대는 없어야 한다.

## Compliance Matrix

| Requirement / Step | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| 승계 RF-21 — 두 heading의 단일 E2E-budget timeout | **Met** | `skills/post-craft/SKILL.md:40,100`; `test/skill-contract.test.ts:1275-1298`; `package.json:15-17` | 두 호출은 모두 `43200000`; test는 match 2개, singleton set, 하한, exact value, 구값 부재를 독립 단언한다. |
| PR5 공통 실행 전제 — RF-16/17/18 | **Met** | `test/e2e-helpers.ts:26,69-110,312-331,737-743`; `test/e2e-helpers.test.ts:415-535` | `spawn` import가 복구됐고 state/log ignore는 `--` 포함 단일-path 호출 2회다. Missing/non-symlink/wrong/correct plugin slot과 realpath/hash fail-closed 경계가 존재한다. |
| PR5-3 — Continue 정확 2회 실행 증거 | **Met** | `test/e2e-audit-escalation.test.ts:117-153`; `test/e2e-helpers.ts:816-835` | 실제 `runOmpPrint` subprocess의 completed 결과 tuple만 `[true,false]`로 인정하고 cycle 2 success/consume 각각 1회와 durable cycle/next-due를 단언한다. 런타임 green 주장이 아니라 코드상 실행·판별 경로 판정이다. |
| PR5-4 — Abort delegation 실행 증거 | **Met** | `test/e2e-audit-escalation.test.ts:158-194` | terminal+abort marker를 모두 기다리고, `state.aborted === true` 및 branch/worktree 생존·land 부재를 무조건 단언한다. RF-16/17 공용 setup 차단도 제거됐다. |
| PR5-5 — B-bound red continuation 실행 증거 | **Met** | `test/e2e-red-cycle-continuation.test.ts:128-223`; `test/e2e-helpers.ts:847-866` | A→B, 실제 red log, `[Craft Incomplete]`, 별도 정상 post-craft, completed task/run-check, B descendant test/check commit을 직접 단언한다. |
| PR1-4 (a)~(h) ledger invariant | **Met** | `src/craft/audit-policy.ts:169-376` | safe integer, feature, interval, chain, due, nextDue, terminal mirror, pending schedule/conflict를 전수 fail-closed한다. RF-20은 diagnostic escaping/parser를 추가했을 뿐 invariant control flow를 바꾸지 않았다. |
| PR1-4 (i) + agreed precedence | **Met** | `src/craft/audit-policy.ts:387-507` | invariant/candidate coupling → terminal → pending → history schedule 순서가 plan 원문과 일치한다. 기존 canonical stale-pending/equality 해석도 변경되지 않았다. |
| PR1-6 / RF-19 — preservation·atomic durability | **Met** | `src/craft/state.ts:189-218,261-299`; `test/craft-state.test.ts:514-551`; `test/craft-init.test.ts:181-207`; `test/craft-verdict.test.ts:1053-1086` | strict는 decode 오류를 전파하고 publish하지 않으며, best-effort는 disk write를 생략한다. malformed/future bytes 불변과 init 미등록, 전체 canonical serialized representation 비교가 있다. 기존 `writeFileAtomicSync` 경로를 유지한다. |
| RF-20 (a)~(c) — control validation/escaped diagnostic/terminal parse | **Met** | `src/craft/tool-text.ts:12-31`; `src/craft/abort.ts:38-73`; `src/craft/verdict.ts:622-645`; `src/craft/audit-policy.ts:183-226,455-483`; `src/craft/land.ts:315-337` | 지정 free-text는 begin/abort 관측·효과 전에 차단되고, disposition diagnostic은 escaped이며, terminal 보간 전에 canonical label/ISO/cycle parser가 실행된다. |
| RF-20 (d) — run-check actual boundary slug/root guard | **Partial** | `src/craft/run-check.ts:344-375,469-473`; `src/craft/state.ts:543-559`; `test/craft-run-check.test.ts:495-520` | Core guard와 root exact-match는 존재하지만 registered tool은 guard 호출 전에 `findPersistedCraftState`로 filesystem을 관측·decode한다. Production wrapper ordering과 그 회귀 test가 미완이다. |
| Guardrails Must NOT Have | **Met** | `src/craft/state.ts:189-199`; `src/craft/land.ts:315-337`; `skills/post-craft/SKILL.md:352-360` | 새 state/migration/base-policy storage, land 권한 확대, cap 숫자 산문 alias, full-re-audit/check-ownership 개편은 fix delta에 없다. Terminal은 계속 nonce 전에 차단되고 escalation cap은 TS symbol 참조다. |
| ADR Principles 1·3 — entry fail-closed와 durable evidence 일관성 | **Partial** | `plan.md:68-70`; `src/craft/state.ts:261-299`; `src/craft/run-check.ts:469-473` | RF-19 durable evidence는 충족하지만 RF-20(d)의 실제 tool 입구가 slug guard보다 persisted lookup을 먼저 수행해 entry-boundary closure가 미완이다. |

## Priority Falsification Question

**답: 질문에 적시된 RF-21 실패 시나리오는 반증됐다.**

- `skills/post-craft/SKILL.md:40`과 `:100`은 모두 `lsc_run_check(feature_dir, timeout_ms: 43200000)`이다. Fixture `120000` 문언과 구 `timeout_ms: 600000`은 두 heading에서 제거됐다.
- `test/skill-contract.test.ts:1282-1298`은 `CALL_RE`로 호출 literal을 모아 **정확히 2개**인지, `new Set(values).size === 1`인지, 각 값이 `>= 43_200_000`인지, canonical 값이 `43200000`인지 검사한다. 다른 heading이 구 `600000`을 유지하면 match set과 exact-value assertion이 실패하고, fixture `120000`이 남으면 별도 negative assertion이 실패한다. 임의의 숫자 drift도 singleton-set assertion이 실패한다.
- `package.json:17`은 4개 E2E 파일을 `--no-file-parallelism --testTimeout=10200000 --hookTimeout=120000`으로 실행한다. 요구 산식 $4 \times (10{,}200{,}000 + 120{,}000)=41{,}280{,}000$보다 `43,200,000`이 크므로 RF-21의 build/hook margin 하한을 만족한다.
- Matcher는 heading별 slice가 아니라 문서 전체의 exactly-two 호출을 검사한다. 그러나 현재 각 heading에 한 호출씩 있고, 질문이 제시한 one-old-value·fixture-residue·numeric-drift 변형은 모두 green이 될 수 없다. 동시 삭제+다른 heading 중복이라는 보상형 구조 변이는 관측된 diff 결함이 아니므로 finding으로 과장하지 않았다.

## RF-21 판정

**완전 적용.** `SKILL.md` 두 좌표의 값·fixture 예외 제거·구값 제거·두 호출 drift contract가 모두 존재한다.

`spec.md:70`의 Constraint 8은 audit-escalation **cap interval**의 SSOT를 `LIVE_AUDIT_ESCALATION_INTERVAL` / `FIXTURE_AUDIT_ESCALATION_INTERVAL` TS 상수에 두라는 요구다. 현행 `skills/post-craft/SKILL.md:357`은 그 숫자를 재서술하지 않고 TS symbol만 참조한다. 반면 `43,200,000`은 `lsc_run_check` 한 호출의 외부 wall-clock budget이며 RF-21이 명시적으로 요구한 값이다. 따라서 이를 cap alias로 보아 Constraint 8 위반으로 확대할 근거는 없다. Test의 하한 literal은 runtime cap authority가 아니라 이 Required Fix를 고정하는 regression oracle이다.

## Findings

1. **수정 · MAJOR** — RF-20(d)의 slug guard가 production `lsc_run_check` tool boundary보다 늦어, invalid feature가 거부되기 전에 persisted-state filesystem lookup/decode에 도달한다.
   - Evidence: `src/craft/run-check.ts:469-473` — `const persisted = findPersistedCraftState(ctx.cwd, feature);`가 `return performRunCheck(...)`보다 먼저 실행된다. 실제 slug guard는 후자의 `src/craft/run-check.ts:344-352` 안에 있다.
   - Evidence: `src/craft/state.ts:543-559` — `craftStateCandidates`가 `existsSync`를 수행하고, 존재하는 candidate는 `findPersistedCraftState`가 `decodeCraftState`로 읽는다.
   - Evidence: `test/craft-run-check.test.ts:499-503` — “before any fs access” test는 registered execute가 아니라 `performRunCheck({ persisted: undefined, ... })`를 직접 호출하므로 이 production ordering을 운동하지 않는다.
   - Required by: `audit/audit-1.md:250` — “`src/craft/run-check.ts:312-323,415-443`에 shared slug guard + persisted root identity의 `ctx.cwd`/computed worktree path exact-match 검증. 각 경로 fail-closed/무-effect/무-raw-payload 테스트.”
   - Required by: `plan.md:68` — “우회 가능한 경고가 아니라 피해가 발생하는 입구/merge 경계에서 fail-closed한다.”
   - Actual: core에 전달된 뒤에는 invalid slug가 잘 차단되지만, registered tool은 그 전에 invalid/traversal-shaped feature로 두 candidate path를 `existsSync`하고, candidate가 있으면 JSON decode까지 한다. 따라서 코드 주석과 test 이름이 주장하는 “before ANY fs access”는 실제 tool 호출에서는 거짓이며, malformed candidate가 있으면 canonical slug refusal 전에 decode 예외가 날 수 있다.
   - Remediation: `registerRunCheckTool.execute`에서 `resolveFeatureName` 직후 shared `FEATURE_SLUG_RE` validation/refusal을 수행하고, 그 다음에만 `getActiveCraft`/`findPersistedCraftState`를 호출하라. Refusal text 중복을 피하려면 pure feature-refusal helper를 core와 wrapper가 공유한다. Registered execute를 capture하는 회귀를 추가해 invalid slug candidate 위치에 malformed state를 심어도 decode가 일어나지 않고 canonical `isError`가 반환되며 exec/log write가 0임을 단언하라.

이 finding은 audit-1에서 승계된 RF-20 [MAJOR]의 **재차 부분 적용**이다. 이번 배치에 명시적으로 이월된 treadmill 처분 규칙에 따라 scoped remediation의 존재와 무관하게 이 lane은 fail-closed `REJECT`를 부여한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 지시대로 formatter, linter, build, unit suite, Bun suite, E2E, `run_check.sh`를 실행하지 않았고 main session의 check 결과에도 의존하지 않았다. PR5-3/4/5의 `Met`는 repaired setup과 실제 subprocess assertion의 **코드상 도달성·정확성** 판정이며 fresh runtime green 주장이 아니다.
- RF-16/17/18은 이 lens의 독립 소유가 아니므로, PR5 실행 증거를 여는 공통 전제와 plan 비회귀까지만 읽었다. 그 RF들의 전체 coverage 품질을 별도 lens처럼 재판정하지 않았다.
- `trace.md`, plan iteration ledger, 두 appendix는 이번 fix의 정본 requirement와 ADR summary만으로 판별 가능해 열지 않았다.
- 전체 base diff를 열어 fix delta의 plan 영향은 확인했지만, fix-verification 지시에 따라 audit-1에서 이미 Met인 나머지 모든 PR/ADR 행을 새로 재구축하지 않았다.
- 실제 long-running 4-file E2E가 43,200,000ms 안에 끝나는 wall-clock 관측은 이 lane이 수행하지 않았다. 이번 판정은 package ceiling과 RF-21의 명시 산식에 한정한다.
