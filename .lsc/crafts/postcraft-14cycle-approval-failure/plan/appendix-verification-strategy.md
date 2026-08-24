# Appendix — Verification Strategy

## 검증 원칙

1. TS policy는 순수 함수에서 경계값과 상태 전이를 전수 검사하고, SDK wrapper는 production registration seam으로 별도 검사한다.
2. fail-closed 장치는 성공 경로보다 먼저 우회·재시도·stale state·git 실패 경로를 증명한다.
3. fixture E2E는 LLM이 우연히 REJECT를 내릴 것이라고 가정하지 않는다. 결정적으로 seed한 두 REJECT cycle을 입력으로 실제 post-craft subprocess가 cap=2 escalation과 처분을 수행하는지를 검증한다.
4. 산문 계약은 `test/skill-contract.test.ts`의 heading-bounded assertions로 검증하되, 기존 audit header/verdict literal을 source-wide 치환하지 않는다.
5. 아래 명령은 구현 단계의 검증 계획이다. 이 plan 작성 단계에서는 build/test/lint를 실행하지 않았다.

## 1. Unit — 순수 policy와 state 호환성

### `src/craft/audit-policy.ts` / 신규 `test/audit-policy.test.ts`

| 계약 | 케이스 |
|---|---|
| active interval owner | TS live/fixture constants는 한 곳에만 있고 `registerAuditBeginTool`이 `detectFixturePath(name => pi.getFlag(name))`의 env-first 결과를 pure policy에 주입; env unset+interactive `--lsc-fixtures=<path>` flag-only도 interval 2, separate-process E2E/chaining suppression은 `LSC_FIXTURE`만 사용 |
| 최초 발동 | live candidate 0/1/2 proceed, 3 required; fixture 0/1 proceed, 2 required |
| record-local provenance | pending과 모든 decision에 required `intervalCycles`; top-level cap mirror 없음; field-less legacy만 active interval로 bootstrap |
| positive reactivation | live 3 pending→Continue history 유지→4/5 proceed→6 pending 생성/소비; fixture 2→Continue→3 proceed→4 pending/소비 |
| 미소비 멱등/stale | exact feature·due candidate는 pending 재사용; candidate가 다른 stale pending은 교체 없이 거부 |
| legacy overdue | 필드 없는 cycle-14 + candidate 15 → `{scheduledCycle:3,dueCycle:15,intervalCycles:3}` gate 1회 → Continue next due 18 → 16/17 proceed → 18 gate |
| candidate↔marker | marker 없음 legacy bootstrap; candidate===marker replay는 threshold/base snapshot byte-stable하고 latest completed audit 하나 삭제로 candidate가 marker와 같아져도 허용; candidate===marker+1만 새 cycle; candidate<marker backward/candidate>marker+1 forward gap은 write 전 reject |
| conflict precedence | duplicate due, nextDue↔history, **pending + 동일 `(feature,dueCycle)` decision**, pending+terminal, terminal mirror mismatch는 validation 단계에서 fail-closed; prior 다른-due Continue history+new pending은 valid |
| mode switch | persisted fixture interval 2를 live interval 3으로 읽기(역방향 포함)는 cycle/threshold write 없이 `invalid-state` |
| terminal | Abort/Preserve 뒤 모든 candidate가 blocked; terminal decision/history mirror가 exact |
| invalid input | unknown/blank/free-answer label, due 불일치, malformed evidence는 cycle/threshold write 없이 fail-closed |

canonical corrupt-state matrix는 다음 invariant 각각을 독립 fixture로 뒤집어 `invalid-state`를 요구한다: **(a)** cycle/next cycle safe integer, **(b)** current feature exact match, **(c)** first `scheduledCycle===intervalCycles`와 persisted interval 전수 동일, **(d)** decision `scheduledCycle===직전 Continue.nextDueCycle`, **(e)** `dueCycle>=scheduledCycle`, **(f)** safe `nextDueCycle===dueCycle+intervalCycles`, **(g)** terminal position/top-level exact mirror, **(h)** `pending.scheduledCycle`이 no-history 첫 threshold 또는 latest Continue `nextDueCycle`과 exact 일치하고 interval도 같으며 terminal 뒤 금지, **(i)** candidate가 persisted marker와 exact 동일 또는 safe +1이고 same-cycle replay는 byte-stable하다. history key는 `dueCycle`이며 strictly increasing/unique다. 별도 negative fixture는 완료 artifact 둘 이상 제거 또는 crash-window visible latest 추가 제거로 만든 `candidate<auditCycle` backward gap, forged audit-number forward gap, `dueCycle > auditCycle + 1` self-consistent future chain이다. latest completed audit 하나 삭제는 equality replay로 허용되며 manual tamper 전수 검출 증거가 아니다.

### `src/craft/state.ts` / 기존 state tests

- `test/craft-state.test.ts:67-108,219-276`: `intervalCycles`를 포함한 Pending/Continue/Terminal, next-due mirror, base snapshot의 exact-root atomic round-trip과 기존 release evidence 보존.
- `test/craft-state-version.test.ts:79-159,240-279`: 새 top-level field가 없는 version 2와 cycle-14 legacy state 허용, future version reject, 새 writer의 `stateVersion: 2` stamp; 존재하는 신규 record의 interval 누락/invalid는 reject.
- `test/craft-state-candidates.test.ts:126-155`: base checkout cwd보다 feature worktree state를 고르는 현행 rule, re-registration preservation, persisted fixture↔live mode mismatch 거부, bounded candidate backward/forward gap과 latest-one-deletion equality replay byte-stability 유지.
- `test/deferred-pool-regression.test.ts:188-229`: 새 audit cycle이 `auditValidated`만 clear하고 pending/history/interval/terminal/base evidence를 지우지 않으며 same-cycle replay가 threshold/base snapshot을 갱신하지 않음.

## 2. Integration — audit begin, abort, land

### Audit begin production seam

`test/craft-verdict.test.ts:174-293`의 temp project fixture와 등록 wrapper capture를 확장한다.

- production registration capture에서 `registerAuditBeginTool`이 `detectFixturePath(name => pi.getFlag(name))`를 env-first로 한 번 사용하고 pure policy/`performAuditBegin`에 live/fixture interval을 정확히 주입함을 spy/matrix로 검사한다. env unset+flag path만 설정한 execute는 candidate 2를 gate하고, flag/env 모두 없으면 candidate 2가 proceed한다.
- cap 도달 첫 호출은 `isError`, pending persist, `auditCycle`/check threshold 불변이며 TS `composeAuditEscalationQuestion`이 조립한 exact question과 labels가 details에 있다.
- `test/craft-verdict.test.ts:258-280`의 cycle≥3 WARN-success 2건은 삭제 후 escalation-required/pending/cycle-불변 기대 테스트로 교체한다.
- exact pending disposition만 소비한다. Continue는 cycle을 한 번 기록하고 Abort/Preserve는 기록하지 않으며 live 3→history+6 pending/consume, fixture 2→history+4 pending/consume, overdue 15→18이 persisted interval/history/mirror에 일치한다. `candidate<auditCycle` artifact rewind와 audit-number forward gap은 write 전 거부한다. latest completed audit 하나 삭제로 생기는 equality replay는 허용하며 audit marker/check threshold/base snapshot bytes를 보존한다.
- post-craft orchestration contract는 feature worktree→land base 탐지→`lsc_audit_begin({feature_dir,base_branch})` 순서를 독립 assertion으로 고정한다.
- real-git fixture의 project-root HEAD를 제3 branch에 두고 explicit base를 다른 branch로 전달해 0/양수 behind가 전달 ref 기준인지 검사한다.
- resolvable explicit ref는 argv 형태 `git rev-parse --verify --end-of-options <expr>^{commit}`으로 고정하고 unresolvable explicit ref는 `{status:"unknown",authority:"explicit-base"}`로 둬 current-branch fallback을 금지한다. explicit 부재 legacy caller만 attached current branch를 fallback하며 detached/unborn/unresolvable은 guessed ref 없이 WARN/unknown evidence를 낸다.
- cap 미만 success의 기존 `{feature, auditCycle, checkLogAtCycleStart}`와 `performAuditValidate` APPROVE-family/freshness parser는 additive evidence와 무관하게 유지된다.

### Abort/terminal production seam

- `test/craft-abort.test.ts:28-64`: active craft 기존 호출과 optional `feature_dir` exact-root 호출이 동일한 `aborted` 전이를 만들고 legacy caller가 깨지지 않는다.
- fresh process처럼 active singleton이 없는 상태에서도 exact-root abort가 동작한다.
- terminal persist 실패 시 approval invalidation/clear를 진행하지 않고 error를 반환한다.
- 성공 시 pending destructive approval과 prepared operation이 모두 무효화된다.
- Preserve는 abort 도구를 호출하지 않지만 같은 terminal land/audit guard를 갖고 worktree/branch를 남긴다.

### Land + real git seam

`test/craft-land-flow.test.ts:103-118,249-322`의 `buildTools`/`setupLandableFeature`/`issueLandApproval`을 사용한다.

| 케이스 | 기대 |
|---|---|
| REJECT verdict | 기존 audit evidence 단계에서 먼저 거부; escalation/base gate가 merge 예외를 만들지 않음 |
| Abort/Preserve terminal | approval consume 전에 전용 reason으로 거부; nonce로 우회 불가 |
| APPROVE-family + disjoint added paths | 기존 승인 뒤 merge 성공 |
| 양측 A/A 동일 repo-relative path | merge 호출 전 fail-closed; conflict path와 세 OID 관측 |
| rename destination 대 상대 add | `--no-renames --diff-filter=A -z` 집합에서 동일 destination 차단 |
| 공백/개행 path | NUL parser가 path를 손실하지 않고 exact intersection 탐지 |
| merge-base/diff 실패 | 빈 집합으로 간주하지 않고 전용 fail-closed reason |
| target OID drift | 기존 live re-observation이 path gate보다 우선하여 거부 |
| `force-clean-only` | merge를 하지 않으므로 path-overlap gate를 실행하지 않고 기존 cleanup 계약 유지 |

기존 same-path M/M merge/recovery 테스트는 added-path gate 대상이 아니므로 기존 merge 충돌 복구 seam을 유지한다. 새 gate를 모든 touched path로 넓혀 이 회귀를 가리지 않는다.

## 3. Contract tests — 측정 위생, 사전 차단, multi-lens AWC

`test/skill-contract.test.ts:25-32,737-739`의 기존 document reader/agent 검사를 heading-bounded assertions로 확장한다.

- `test/skill-contract.test.ts`가 craft Handoff와 post-craft audit-driven craft handoff/§6.1을 각각 독립 검사한다. 정정된 spec Goal (C)에 맞춰 post-craft-authored check가 있는 re-entry는 executor-complete와 yield 전 fresh `lsc_run_check` green이 모두 필수이고, red/미실행/unavailable/incomplete self-report는 `[Craft Complete]`를 만들지 못한다. executed-red는 실제 red evidence를 동반한 `[Craft Incomplete]`로만 반환한다.
- 같은 두 heading에서 exact discriminated union을 고정한다: `green {details,logPath}`, `executed-red {details,logPath,repairHint}`, `infrastructure {diagnostic,logPath?; repairHint 금지}`. `details.passed===true`만 green, well-formed details+`passed===false`만 executed-red, details 없는 `isError`, invalid/missing details, refusal/exec exception/empty transcript, tool unavailable는 infrastructure다. green/executed-red의 `details`/`logPath`는 required이고 infrastructure `logPath`는 tool이 실제 생성했을 때만 허용한다.
- best-effort hint fixture는 parent craft 오케스트레이터만 판정 주체로 허용하고 current OID의 fresh log/transcript와 prior Required Fix target/remediation만 대조한다. prior §3.0 report는 입력에서 금지하며 exact failing command는 script/log에서 단일하게 식별될 때만 evidence다. direct production-target mismatch만 `implementation`, direct test/check artifact failure는 `test-check`, missing/mixed/multi-command ambiguity는 `unknown`이고 후자의 두 hint는 production retry를 열지 않는다. infrastructure에 `repairHint` 또는 fabricated `logPath`가 있으면 contract failure다.
- 아래 기대표를 parameterized test로 실행해 union branch별 도달 가능한 **20 cases(green 4 + executed-red 12 + infrastructure 4)**만 생성한다.

| # | executor | evidence state | `retryUsed` | `repairHint` field | action |
|---:|---|---|---:|---|---|
| 1 | complete | green | false | 금지(필드 없음) | `COMPLETE` |
| 2 | complete | green | true | 금지(필드 없음) | `COMPLETE` |
| 3 | incomplete | green | false | 금지(필드 없음) | `EXEC-RETRY` |
| 4 | incomplete | green | true | 금지(필드 없음) | `RETRY-EXHAUSTED` |
| 5 | complete | executed-red | false | `implementation` | `IMPL-RETRY` |
| 6 | complete | executed-red | false | `test-check` | `CYCLE-RETURN` |
| 7 | complete | executed-red | false | `unknown` | `CYCLE-RETURN` |
| 8 | complete | executed-red | true | `implementation` | `CYCLE-RETURN` |
| 9 | complete | executed-red | true | `test-check` | `CYCLE-RETURN` |
| 10 | complete | executed-red | true | `unknown` | `CYCLE-RETURN` |
| 11 | incomplete | executed-red | false | `implementation` | `IMPL-RETRY` |
| 12 | incomplete | executed-red | false | `test-check` | `CYCLE-RETURN` |
| 13 | incomplete | executed-red | false | `unknown` | `CYCLE-RETURN` |
| 14 | incomplete | executed-red | true | `implementation` | `CYCLE-RETURN` |
| 15 | incomplete | executed-red | true | `test-check` | `CYCLE-RETURN` |
| 16 | incomplete | executed-red | true | `unknown` | `CYCLE-RETURN` |
| 17 | complete | infrastructure | false | 금지(필드 없음) | `CYCLE-RETURN` |
| 18 | complete | infrastructure | true | 금지(필드 없음) | `CYCLE-RETURN` |
| 19 | incomplete | infrastructure | false | 금지(필드 없음) | `CYCLE-RETURN` |
| 20 | incomplete | infrastructure | true | 금지(필드 없음) | `CYCLE-RETURN` |

- repair executor complete는 new-OID recheck 후 `retryUsed=true` 행으로 재진입하고 incomplete·unheard·no-commit은 `repair-incomplete`다. `executor=incomplete`의 IMPL-RETRY assignment는 hint target과 원 executor 미완 잔여를 모두 포함한다. `reason=re-red`는 `retryUsed=true` 상태의 implementation-hint executed-red로만 정의한다.
- craft/post-craft 양 heading은 `retry-declined|retry-cancelled|retry-exhausted|re-red|repair-incomplete|test-check-red|red-attribution-unknown|check-infrastructure`의 branch-appropriate evidence와 manual next step을 동일하게 갖는다. `CYCLE-RETURN`은 executed-red에서 정정된 spec Goal (C)의 required red evidence, infrastructure에서 raw `diagnostic`+실제 생성된 optional `logPath`만 보존한 `[Craft Incomplete]`로 끝나며, 사용자/오케스트레이션이 feature dir의 **정상 새 post-craft cycle**을 호출한다. 그 cycle이 current OID에서 §3.0→check→audit을 수행하며 prior report·§3.0-only entry/envelope·second-stage table·unknown fresh-green 의무를 금지한다.
- post-craft audit template은 Header 직후 exact `**AUDIT VERDICT: ...**` 1줄과 뒤이은 `Expected State`/Base Drift를 유지한다. `agents/lsc-auditor.md`는 spec/plan Expected State를 diff/code보다 먼저 읽고 양쪽 인용을 각각 직접 재독한다.
- `skills/pre-craft/SKILL.md`는 모든 AC class와 live-only proxy proof/non-proof/residual-uncertainty 완결 gate를 가진다.
- post-craft §3.2/§4.2/§5/§6.1은 5종 concrete `ReviewerRef`, item별 `fixCompleteness`, `VerificationResult {itemId,ownerRef,implementationOid,auditCycle,status,evidence}`를 같은 의미로 사용한다. 각 owner는 실제 관측 OID/cycle을 기록하고 결합 범위는 그 current audit cycle의 Required Fix closure에 한정한다. auditor exact lens, explore probe/scope/criterion, main procedure/criterion, test obligation/paths, deterministic command/cwd/criterion identity와 explicit current OID/cycle의 필드 누락 fixture는 REJECT다.

**Bundle relational invariants:** `itemId`와 모든 `ReviewerRef`/evidence 자유 문자열은 trim 후 non-blank이고, `itemId`는 bundle 안에서 unique다. 각 `verificationOwners`는 structural-unique이며 해당 item의 `originReviewer`를 정확히 한 번 포함한다. 기대 pair set은 모든 `(itemId, verificationOwner)`의 Cartesian set이고, `VerificationResult`의 `(itemId, ownerRef)` pair set은 기대 set과 exact equality여야 한다. duplicate·extra·missing pair, blank payload/evidence는 shortcut 전에 REJECT한다.

**§5 owner execution routing (authority).** Fix-verification 시작 시 prior Required Fix bundle의 모든 `verificationOwners`를 structural equality로 dedupe한 union을 만든 뒤, 결과를 합성하기 전에 전부 다음과 같이 route한다. `auditor`는 exact lens마다 `lsc-auditor` 1개, `explore`는 exact `{probe,scope,successCriterion}`마다 `lsc-explore` 1개를 같은 review batch에서 실행한다(수정 path가 test/check인지와 무관). `test-authoring`은 §3.0의 단일 `lsc-test-engineer` assignment에 item별 `{obligation,testPaths}` 전부를 전달하고, `deterministic-check`는 §3.1에서 실제 실행한 canonical `{command,cwd,successCriterion}`과 structural-equal한 ref만 그 결과에 결합하며, `post-craft-main`은 main이 각 `{procedure,successCriterion}`을 직접 수행한다. §3.0 변경을 commit한 뒤 current implementation OID를 freeze하고, 각 route의 관측 bytes/OID와 audit cycle이 그 freeze와 일치할 때만 `VerificationResult`를 정규화한다. unsupported ref, route 누락, 무응답, OID/cycle mismatch는 result를 합성하거나 다른 owner에게 재배정하지 않고 shortcut 전에 REJECT한다. 기존 §5의 “single lsc-auditor” 및 “tests/check를 touch한 경우에만 explore” 규칙은 이 routing으로 교체하며 unrelated owner/lens는 추가하지 않는다.

Contract proof는 (a) two-auditor-lens + production-origin explore + test-authoring + deterministic-check + main bundle이 각 exact route/result를 한 번씩 생성하는 positive, (b) production-origin explore를 current path 조건으로 누락한 경우, auditor lens 하나를 single-lens로 축약한 경우, unsupported ref, duplicate route, OID/cycle mismatch가 REJECT인 negative를 추가한다.

- normalizer table을 owner별 positive/negative fixture로 고정한다: auditor `APPROVE|APPROVE-WITH-COMMENT`만 PASS; explore는 bounded evidence가 binary criterion을 전부 만족할 때만 PASS; main은 procedure 전수 관측만 PASS; test-authoring은 listed obligation+`Test Health: HEALTHY`+fresh `0 failed`; deterministic check는 exact current identity의 `details.passed===true`만 PASS다. 현행 agent vocabulary에 새 literal PASS를 요구하지 않는다.

§4.2는 raw owner report와 surviving finding을 현행 four-level correspondence로 다시 분류한다. 새 CRITICAL, broad/severe finding, `needs-redesign`, unheard/unroutable/mismatched/inconclusive owner는 REJECT다. `owner FAIL` 또는 새 MAJOR라는 사실만으로 REJECT하지 않는다. surviving blocking finding이 모두 concrete `apply-only` remediation과 complete owner set을 가지면 APPROVE-WITH-CHANGE, 하나라도 scoped prescription으로 닫히지 않으면 REJECT다. 모든 expected owner가 current-OID PASS이고 새 blocking finding이 없을 때만 fix-verification shortcut이 APPROVE/APPROVE-WITH-COMMENT로 닫힌다. 새 MINOR는 non-blocking evidence로 남긴다.

- positive fixtures는 `partial original apply-only → AWC`, `new unrelated apply-only MAJOR → AWC`; negative fixtures는 `origin omitted`, `duplicate itemId`, `duplicate owner`, `extra result`, `blank criterion/evidence`, wrong lens/probe, missing result, stale OID/cycle, `owner inconclusive → REJECT`, `new needs-redesign MAJOR → REJECT`, `new CRITICAL → REJECT`다.
- periodic escalation은 TS constant symbol만 참조하고 `No cycle cap` 및 Markdown 숫자 별칭이 없다. README는 optional exact-root abort, base handoff, escalation, corrected-Goal-(C)-compliant prior-report-free canonical red cycle return, multi-source concrete-owner bundle을 설명하며 공개 E2E command/file count/suite 설명은 기존 2개+신규 2개인 4-file 목록과 일치한다.

검사는 필수 heading/불변 literal과 금지 문언을 section-scoped로 확인한다. 단순 source-wide snapshot이나 문구 순서에 무관한 grep 테스트는 만들지 않는다.

## 4. Fixture matcher

- `fixtures/sample-ts-cli/answers.json:4-60`에 generic `proceed\\??$`보다 앞선 anchored selection rule을 둔다.
- `test/fixtures.test.ts:418-466,600-679,776-931`에서 다음 JSON body 세 가지를 각각 canonical option으로 매핑한다.

```json
{"match":"^\\[Audit Escalation\\]","kind":"selection","selections":["Continue auditing"]}
{"match":"^\\[Audit Escalation\\]","kind":"selection","selections":["Abort this craft"]}
{"match":"^\\[Audit Escalation\\]","kind":"selection","selections":["Preserve branch and stop"]}
```

- selection이 `User selected: <label>` CONTENT로 유지되고 confirmation default가 이 gate를 대신하지 못함을 검사한다.
- `src/fixtures.ts:104-129,214-279,304-327`의 선언 순서·kind allowlist·process-local `once` 의미는 이미 충분하므로 production matcher는 의도적으로 변경하지 않는다.
- branch별 answers variant는 독립 subprocess/project에 제공한다. 한 process의 `once` 상태가 다음 `runOmpPrint` 호출로 이어진다고 가정하지 않는다. `--lsc-fixtures`는 interactive-only alias이고 separate-process E2E·chaining suppression은 환경변수 `LSC_FIXTURE`를 쓴다.

## 5. Fixture E2E — cap 2 세 처분과 red cycle continuation

### 구조

신규 `test/e2e-audit-escalation.test.ts`와 `test/e2e-red-cycle-continuation.test.ts`를 비용이 큰 happy-path와 분리한다. `test/e2e-helpers.ts:161-180,223-253,282-334`의 기존 `earlyExit`/run/tool-execution/setup seam을 확장한다.

1. throwaway git project와 feature worktree를 준비한다.
2. old-format-compatible `audit-0.md`, `audit-1.md`에 exact `**AUDIT VERDICT: REJECT**`를 seed하고 state를 cycle 1로 맞춘다.
3. branch마다 별도 external answers JSON으로 canonical label 하나를 제공한다.
4. 실제 `omp -p --mode=json`, `LSC_FIXTURE` subprocess를 호출한다. candidate 2에서 gate가 먼저 발동해야 한다.
5. Continue는 tool stream에서 **두 번째 lsc_audit_begin 호출(전체 호출 2개)의 success; 첫 호출은 isError, success count는 1**이고 filesystem의 durable Continue/next-due 4가 모두 보이는 즉시 `earlyExit`한다. `earlyExit` predicate는 `total executions=2 ∧ last.isError=false`로 고정한다. subprocess 종료 후에도 captured trace/state를 assertion input으로 보존하며 비싼 full audit에 진입하지 않는다.

현행 fixture에는 audit verdict를 고정하는 rule이 없고 기존 full-cycle도 verdict semantic quality를 검증하지 않는다(`test/e2e-full-cycle.test.ts:27-32,243-315`). 따라서 cycle 0/1을 LLM 우연에 맡기지 않는다.

### 공통 단언

- cap 미소비 시 `audit-2.md`가 없고 state cycle은 1이다.
- exact `[Audit Escalation] ... continue?/proceed?` 질문과 canonical `User selected:` CONTENT가 tool execution trace에 남는다.
- base checkout에는 craft artifact가 생기지 않고 feature worktree/branch는 존재한다.
- escalation은 `[Land]` destructive tag나 merge 권한을 만들지 않는다.

### branch별 단언

1. **`Continue auditing`**: cycle 2 begin 성공, Continue record와 fixture next due 4가 durable한 시점에 evidence-bound early exit. prior due-2 history와 candidate-4 pending의 정상 공존/소비는 unit/integration positive matrix가 증명한다.
2. **`Abort this craft`**: disposition과 `aborted=true` durable, cycle 2 미생성, 후속 begin/land 거부, worktree/branch 존치. 여기서 `aborted=true`는 SKILL의 기존 abort-tool 위임 준수 증거이고 안전 속성은 terminal TS guard tests가 소유한다.
3. **`Preserve branch and stop`**: preserve terminal durable, `aborted` 기존 의미 유지, cycle 2 미생성, 후속 begin/land 거부, worktree/branch 존치.

기존 `test/e2e-full-cycle.test.ts:102-375`도 그대로 실행해 pre-craft→craft→단일 post-craft→APPROVE-family land happy path가 무회귀임을 확인한다.

`package.json`의 표준 `npm run e2e` script는 기존 `e2e-full-cycle`/`e2e-preset-default`와 함께 `test/e2e-audit-escalation.test.ts`와 `test/e2e-red-cycle-continuation.test.ts`를 명시해 두 신규 suite를 매 전체 E2E 회귀에서 실행한다. `README.md:239-253`의 exact command, “2개 파일” count, suite 설명도 같은 4-file 목록으로 갱신하고 package script와 대조한다.

### red canonical continuation 단언

1. audit OID A의 Required Fix에서 실제 craft subprocess를 시작해 fixture executor가 production commit B를 만들고 `B !== A`임을 기록한다.
2. B에서 command/path owner를 특정할 수 없는 deterministic multi-command fresh check red를 만들어 첫 process가 current B와 `executed-red {details,logPath,repairHint:"unknown"}` evidence 및 exact `reason=red-attribution-unknown`의 `[Craft Incomplete]`로 끝나는지 확인한다. prior A §3.0 report를 B에 exact-bind하거나 새 envelope/resume token을 만들면 실패다.
3. 같은 feature dir에 `LSC_FIXTURE`를 둔 별도 **normal post-craft** subprocess를 시작한다. 다음 `lsc_audit_begin`이 cycle 하나를 발행한 뒤, exact HEAD B를 요구하지 않고 **§3.0이 B production snapshot을 입력으로 읽었으며 이후 test/check commit OID에서 실행**했다는 input-snapshot/execution-OID evidence가 보이면 early-exit한다.
4. 다음 §3.0 결과에 fresh green을 강제하지 않는다. artifact-fixed green은 같은 post-craft audit/complete로, healthy test+executed-red는 audit Required Fix→production craft로 갈 수 있다는 heading contract를 함께 검사한다.
5. trace/state가 red return당 다음 audit cycle 하나를 계상하고 due cycle에서는 explicit Continue 없이 발행하지 않음을 cap integration proof와 결합한다. 전용 §3.0-only entry나 second-stage executor table은 없어야 한다.

## 6. Observability / 사후 감사 표면

| 표면 | 반드시 보이는 증거 |
|---|---|
| `lsc_audit_begin` error/details | feature, candidate/due/scheduled cycle, persisted `intervalCycles`와 active interval, TS 조립 question, pending/terminal 상태; mode mismatch 및 candidate backward/gap reason; replay byte-stability; 미소비 상태에서 land 권한 없음 |
| `.craft-state.json` | record-local interval, 별도 pending, ordered decision history, validated next due/terminal mirror, candidate↔auditCycle marker, legacy-overdue scheduled 근거, base ref/tip/source tip/behind/status/authority |
| audit document | 기존 canonical verdict line 1개, 그 뒤 Expected State, Base Drift WARN/0/unknown, finding별 requirement·implementation `file:line` |
| `lsc_land` failure | terminal 또는 exact added-path overlap reason, anchored merge-base/target/source OID, 정렬된 paths; merge 미호출 |
| Required Fix bundle | item별 concrete origin/structural-unique owners/fixCompleteness, exact expected-result pair set, explicit implementation OID/audit cycle, four-level 재분류 근거 |
| check logs/continuation | `green {details,logPath}` / `executed-red {details,logPath,repairHint}` / `infrastructure {diagnostic,logPath?; repairHint 금지}`와 parent `retryUsed`, integrated root/current OID, repair outcome·recheck; infrastructure log는 tool이 실제 생성한 경우만 존재; 또는 여덟 incomplete reason+manual next step; `CYCLE-RETURN`은 정상 새 post-craft cycle 번호와 §3.0의 B production snapshot 입력/후속 test-check execution OID로 이어지고 prior report/envelope/forced-green은 없음 |

## 7. 구현 완료 시 명령 순서

먼저 빠른 targeted suite로 실패를 좁힌 뒤 build와 E2E를 실행한다.

```sh
npx vitest run \
  test/audit-policy.test.ts \
  test/craft-state.test.ts \
  test/craft-state-version.test.ts \
  test/craft-state-candidates.test.ts \
  test/deferred-pool-regression.test.ts \
  test/craft-verdict.test.ts \
  test/craft-abort.test.ts \
  test/craft-land-flow.test.ts \
  test/fixtures.test.ts \
  test/skill-contract.test.ts

npm run build

LSC_E2E=1 npx vitest run \
  test/e2e-audit-escalation.test.ts \
  test/e2e-red-cycle-continuation.test.ts \
  --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000

npm test
npm run e2e
```

마지막 두 명령은 기존 전체 회귀 확인용이며 feature 구현이 모두 합쳐진 뒤 한 번만 실행한다. 각 명령의 실제 exit code와 test count를 implementation commit의 `verify:` 및 post-craft check log에 기록한다.
