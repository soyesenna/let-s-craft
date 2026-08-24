# Appendix — Pre-mortem

## 목적과 전제

이 문서는 `postcraft-14cycle-approval-failure` 구현이 실패했다고 가정하고, 실패가 어떤 경로로 발생했을지 사전에 역추적한다. 확정 spec의 fail-closed 불변식, live cap 3/fixture cap 2, 방향 결정 전용 `[Audit Escalation]`, base drift 감지/차단 분리, 정정된 Goal (C)의 “red `[Craft Complete]` 금지 + red evidence 동반 `[Craft Incomplete]` 반환”을 전제로 한다.

## 시나리오 1 — cap 경계에서 cycle을 먼저 발행해 게이트를 우회한다

### 실패 서사

`performAuditBegin`이 현행 순서대로 `recordAuditCycleBegin`을 먼저 실행한 뒤 cap을 검사한다. live candidate cycle 3 또는 fixture candidate cycle 2가 `.craft-state.json`에 기록되고 check freshness threshold까지 이동한 다음 `isError`가 반환된다. 재시도는 다음 cycle을 계산하므로 미소비 게이트가 사실상 한 cycle씩 건너뛰고, 반복 호출만으로 상한을 우회한다.

### 조기 신호

- cap 거부 응답 뒤 `auditCycle` 또는 `checkLogAtCycleStart`가 바뀐다.
- 같은 입력을 두 번 호출했을 때 요구 cycle이 3→4 또는 2→3으로 이동한다.
- `audit-N.md`가 없는데 state의 `auditCycle`만 증가한다.

### 예방 장치

- `src/craft/audit-policy.ts`의 순수 판정을 I/O보다 먼저 실행한다.
- 미소비 상태에서는 pending escalation evidence만 atomic persist하고 audit cycle marker/freshness threshold는 쓰지 않는다.
- 동일 feature·candidate cycle에 대한 반복 호출은 같은 pending record를 관찰하는 멱등 동작으로 만든다.
- live 0/1/2→3 차단, fixture 0/1→2 차단, 반복 거부 후 state 불변을 단위 테스트로 고정한다.

### 복구

이미 잘못 발행된 cycle을 자동 감산하지 않는다. 오류를 fail-closed로 보고 state와 audit artifact 불일치를 명시적으로 진단한 뒤 사용자가 복구하도록 한다. 자동 보정은 freshness 증거를 조작할 수 있으므로 금지한다.

## 시나리오 2 — fixture의 generic confirmation이 escalation 선택으로 오인된다

### 실패 서사

`[Audit Escalation]` 전용 selection rule이 generic `proceed\\??$` confirmation rule 뒤에 있거나 label 철자가 달라진다. fixture provider가 kind mismatch를 내거나 generic `yes`를 반환하고, orchestration이 이를 `Continue auditing`으로 간주한다. 별도로 cap owner가 `LSC_FIXTURE` env만 읽으면 `--lsc-fixtures=<path>` 단독 실행은 scripted selection을 쓰면서 live interval 3을 적용해 UI와 policy mode가 갈라진다.

### 조기 신호

- tool CONTENT에 `User selected: <label>` 대신 `yes`가 나타난다.
- fixture E2E가 selection kind mismatch로 멈추거나 flag-only candidate 2를 gate하지 않는다.
- `Continue auditing`, `Abort this craft`, `Preserve branch and stop` 중 하나가 문서·fixture·state에서 서로 다르게 표기되거나 env/flag가 서로 다른 interval을 주입한다.

### 예방 장치

- 세 label을 canonical literal로 한 곳에서 타입화하고 SKILL/fixture가 verbatim 사용한다.
- `registerAuditBeginTool`이 `detectFixturePath(name => pi.getFlag(name))`를 env-first로 한 번 호출해 `LSC_FIXTURE`와 interactive-only `--lsc-fixtures` alias를 같은 fixture interval 2로 주입하며, `performAuditBegin`은 env를 직접 읽지 않는다. 별도 process E2E·chaining suppression은 `LSC_FIXTURE`만 authority로 쓴다.
- env unset + flag-only wrapper unit이 candidate 2 gate를 고정하고 live candidate 2 proceed와 대조한다.
- `fixtures/sample-ts-cli/answers.json`에서 anchored `^\\[Audit Escalation\\]` selection rule을 generic proceed rule보다 앞에 둔다.
- branch별 E2E는 독립 answers variant를 사용한다. `once` 소비 상태가 subprocess 사이에 유지된다고 가정하지 않는다.
- free answer와 cancellation은 처분으로 해석하지 않고 같은 gate를 재질문하며, 반복 free answer는 unresolved로 종료한다.

### 복구

kind mismatch 또는 알 수 없는 label은 pending evidence를 소비하지 않는다. audit begin은 같은 candidate cycle에서 계속 거부하고, state에 임의의 Continue를 기록하지 않는다.

## 시나리오 3 — Abort/Preserve 뒤 stale Land 승인이 살아 있어 branch가 merge된다

### 실패 서사

처분만 state에 쓰고 in-memory pending approval 또는 prepared operation을 남긴다. 특히 fresh post-craft process에서 active craft가 없기 때문에 현행 active-only `performCraftAbort`가 실패한다. 이후 `[Land]` confirm이 stale prepared envelope를 사용해 승인을 발급하거나, `performLand`가 terminal disposition을 확인하지 않고 nonce를 소비해 merge/remove를 실행한다.

### 조기 신호

- Abort 선택 뒤 `aborted`가 false이거나 exact-root state가 갱신되지 않는다.
- Preserve 선택 뒤 `lsc_land`가 approval prompt를 만든다.
- terminal 처분 뒤 worktree가 삭제되거나 base branch가 이동한다.
- `setActiveCraft` 재등록 후 terminal disposition이 사라진다.

### 예방 장치

- `lsc_craft_abort`에 backward-compatible optional `feature_dir` exact-root 경로를 추가해 기존 abort 도구가 post-craft fresh process에서도 같은 상태 전이를 수행하게 한다.
- terminal disposition persist가 성공한 다음 pending approval과 prepared operation을 모두 무효화한다.
- `setActiveCraft`의 durable-field preservation에 escalation history/terminal disposition을 포함한다.
- `performLand`는 destructive approval 소비 전 `aborted`와 Preserve/Abort terminal disposition을 거부한다.
- Abort와 Preserve 모두 후속 audit begin 및 land 거부, branch/worktree 존치를 실제 temp git repo에서 검증한다.

### 복구

terminal persist 이후 abort 위임의 부수 작업이 실패해도 audit/land는 계속 차단한다. 사용자는 남은 worktree를 수동 정리할 수 있지만 자동 merge/remove로 전환하지 않는다.

## 시나리오 4 — audit base authority 또는 land path 파싱이 drift를 false-negative로 만든다

### 실패 서사

post-craft가 land target base를 탐지하기 전에 begin을 호출하고, `performAuditBegin`이 우연히 project-root HEAD를 base로 쓴다. checkout이 제3 branch면 audit 문서의 behind 수치가 실제 land target과 무관해진다. land에서도 newline/공백 path를 line split하거나 audit 때 본 stale base tip을 재사용하면 양측 동일 신규 path의 교집합이 비어 보이고 merge가 시작된다.

### 조기 신호

- state의 base authority/ref가 post-craft가 이후 land에 넘긴 target과 다르다.
- HEAD≠detected-base fixture에서 behind count가 HEAD 이동에 따라 바뀐다.
- explicit base 없는 detached/unborn checkout이 `main` 또는 `origin/HEAD`로 조용히 보정된다.
- 공백/개행 path overlap이 통과하거나 git 명령 실패가 빈 집합으로 정규화된다.

### 예방 장치

- post-craft 순서를 worktree 확인→land base 탐지→optional `base_branch` begin 호출로 바꾸고 normal orchestration은 동일 ref를 audit와 eventual land에 재사용한다.
- explicit ref는 argv 형태 `git rev-parse --verify --end-of-options <expr>^{commit}`으로 resolve해 leading `-`도 option으로 해석하지 않는다. 해석 불가이면 `{status:"unknown",authority:"explicit-base",baseBranch,error}`를 기록하고 current branch로 fallback하지 않는다. legacy direct caller만 attached current branch로 fallback하며 detached/unborn/unresolvable이면 audit에 WARN/unknown을 기록하고 ref를 추측하지 않는다.
- HEAD를 제3 branch, 전달 base를 실제 target branch로 둔 real-git test와 explicit resolved/unresolvable·legacy fallback/unknown matrix를 둔다.
- land는 승인 target/source OID의 merge-base와 `--diff-filter=A --name-only -z --no-renames` 결과를 raw NUL parser로 비교한다.
- overlap/merge-base/diff 실패는 merge 직전 fail-closed하며 disjoint add, same A/A, rename destination, `force-clean-only`를 각각 검증한다.

### 복구

audit base를 해석할 수 없으면 unknown evidence를 남긴 채 audit만 진행하고, land는 live approved OID 계산을 계속 fail-closed로 수행한다. overlap 또는 계산 실패 시 merge/remove를 실행하지 않고 OID/path evidence를 남겨 새 승인 흐름으로 돌아간다.

## 시나리오 5 — cross-OID report와 §3.0-only handoff가 red continuation을 막는다

### 실패 서사

post-craft가 implementation OID A에서 만든 §3.0 report를 audit-driven craft commit B의 fresh red 귀속에 exact-bind하려 한다. A를 유지하면 current-OID mismatch이고 B로 바꾸면 관측하지 않은 OID를 허위 표기한다. 이를 피하려고 `[Craft Incomplete]` 뒤 별도 §3.0-only mode/envelope와 second-stage executor table을 만들거나, `unknown`을 test defect로 단정해 test-engineer에게 fresh green을 강제하면 현행 정상 entry·ownership·cycle accounting이 모두 갈라진다. 더 나아가 infrastructure에도 존재하지 않는 `details`/`logPath`/`repairHint`를 채우려 하면 fabricated evidence가 감사 표면에 남는다.

### 조기 신호

- attribution이 prior §3.0 report의 OID A를 craft tip B와 같다고 요구하거나 report를 B로 재표기한다.
- `[Craft Incomplete]` 다음 단계가 feature dir의 정상 post-craft가 아니라 정의되지 않은 §3.0-only mode/resume token이다.
- `complete|incomplete + test-check|unknown`에 fresh green 뒤 새 craft를 일률 강제하거나 healthy test+production red의 exit가 없다.
- `RunCheckDetails`에 없는 exact per-step command를 항상 존재하는 authority처럼 다루거나, infrastructure에 fabricated `logPath`/`repairHint`를 넣거나, `retryUsed=true` implementation-hint red가 두 번째 production retry를 연다.

### 예방 장치

- 옵션 (c)를 채택해 prior §3.0 report를 craft attribution에서 제거한다. current OID의 fresh check log/transcript와 prior Required Fix target만 best-effort `repairHint`로 대조하며, exact failing command는 script/log에서 단일하게 식별될 때만 쓰고 multi-command 모호성·path/category 누락은 `unknown`이다.
- craft/post-craft가 같은 discriminated evidence를 사용한다: `green {details,logPath}`, `executed-red {details,logPath,repairHint}`, `infrastructure {diagnostic,logPath?; repairHint 금지}`. green/executed-red의 logPath는 tool이 실제 생성한 required path이고 infrastructure는 raw diagnostic과 실제 생성된 경우의 optional log만 보존한다. synthetic log/hint는 금지한다.
- `implementation`은 fresh evidence가 prior production target의 즉시 수리 가능한 불일치를 직접 식별하고 test-check 신호가 없을 때만 허용한다. `test-check`/`unknown`은 진단 hint일 뿐 defect-owner authority가 아니며 production repair를 호출하지 않는다.
- 아래 표는 union branch별 도달 가능한 **20 cases(green 4 + executed-red 12 + infrastructure 4)**만 전수한다. green/infrastructure에는 존재하지 않는 hint 축을 곱하지 않는다.

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

- `[Craft Complete]`는 executor complete+green만 허용한다. 정정된 spec Goal (C)에 따라 executed-red의 `CYCLE-RETURN`은 완료 선언이 아니라 required `details`/`logPath`/`repairHint`를 보존한 `[Craft Incomplete]` 종료이고, infrastructure는 `diagnostic`+실제 optional `logPath`만 보존한 incomplete 종료다.
- `EXEC-RETRY`/`IMPL-RETRY`만 기존 selector를 열고 spawn 직전에 invocation-global token을 소비한다. `executor=incomplete`에서 온 IMPL-RETRY assignment는 hint target과 원 executor의 미완 잔여를 함께 포함한다. repair incomplete·unheard·no-commit은 `repair-incomplete`; `retryUsed=true` 상태의 implementation-hint red는 `reason=re-red`로 `CYCLE-RETURN`한다.
- 정상 새 post-craft invocation은 기존 `lsc_audit_begin`→current-OID §3.0→check→audit 흐름을 그대로 쓴다. test/check repair가 green이면 그 cycle에서 complete하고, 건강한 test가 production red를 유지하면 audit가 Required Fix를 만들어 craft로 보낸다. 따라서 `unknown`에 fresh green 의무가 없고 original executor state를 보존할 second-stage 표도 없다.
- `CYCLE-RETURN` 다음 normal begin은 audit cycle 하나를 소비한다. persisted marker와 live 3/fixture 2 periodic escalation은 due cycle의 explicit Continue 전 자동 진행을 막고 Abort/Preserve로 종결하므로 반복이 무상하지 않다.
- audit A→craft commit B red→`[Craft Incomplete]`→별도 정상 post-craft next cycle을 실제 fixture subprocess E2E로 고정한다. 여기서 B 관측은 exact HEAD equality가 아니라 §3.0이 B production snapshot을 입력으로 읽고 이후 test/check commit OID에서 실행한 evidence다. prior A report, 신규 mode/envelope, forced-green assertion은 fixture에 두지 않는다.

### 복구

stale report 귀속이나 정의되지 않은 handoff를 발견하면 production retry를 추가하지 않는다. executed-red면 current B와 required `details`/`logPath`/`repairHint`, infrastructure면 `diagnostic`과 실제 생성된 optional `logPath`만 보존한 `[Craft Incomplete]`로 끝내고 feature dir의 정상 post-craft를 호출한다. 이미 begin한 continuation이 crash하면 새 envelope를 만들지 않고 existing same-cycle replay 규칙으로 재개하며, due escalation에서 Continue가 없으면 cycle을 더 발행하지 않는다.

## 시나리오 6 — category owner 또는 자의적 PASS 정규화가 거짓 AWC를 만든다

### 실패 서사

`originReviewer:"auditor-lens"`/`"lsc-explore"` 같은 category만 저장해 exact lens나 probe를 재현하지 못한다. origin을 owners에서 빼거나 duplicate item/owner·extra/missing result를 한 PASS로 재사용하고, stale OID/cycle result를 current closure로 위장한다. partial apply-only owner FAIL이나 새 apply-only MAJOR를 무조건 REJECT로 축약하면 현행 AWC 수렴도 깨지고, 반대로 `needs-redesign`/CRITICAL을 shortcut하면 거짓 closure가 된다.

### 조기 신호

- auditor ref에 `spec|plan|regression|infra` lens가 없거나 explore ref에 probe/scope/success criterion이 없다.
- main ref에 procedure/criterion, test-authoring ref에 obligation/non-empty test paths, deterministic check ref에 exact command/cwd/criterion identity가 없다.
- `verificationOwners`가 empty/중복이거나 origin을 정확히 한 번 포함하지 않고, item/result pair set이 duplicate·extra·missing이거나 current `implementationOid`/`auditCycle`과 다르다.
- explorer recommendation, `Test Health`, auditor verdict를 근거표 없이 모두 PASS로 바꾸거나 raw `owner FAIL`/새 MAJOR만으로 four-level 재분류 없이 REJECT한다.

### 예방 장치

- §3.2/§4.2/§5/§6.1이 같은 discriminated `ReviewerRef`를 쓴다: auditor `{lens}`, explore `{probe,scope,successCriterion}`, post-craft-main `{procedure,successCriterion}`, test-authoring `{obligation,testPaths}`, deterministic-check `{checkIdentity:{command,cwd,successCriterion}}`.
- 각 item은 stable `itemId`, `originReviewer`, owners, `fixCompleteness:"apply-only"|"needs-redesign"`, 양쪽 좌표/remediation을 가진다. 각 owner는 exact structural ref와 **자신이 실제 관측한 current audit cycle의** `VerificationResult {itemId,ownerRef,implementationOid,auditCycle,status:"PASS"|"FAIL",evidence}` 하나를 남긴다. 이 binding은 그 cycle의 shortcut 결합에만 쓰고 craft red나 cross-cycle §3.0 report attribution에는 재사용하지 않는다.

**Bundle relational invariants:** `itemId`와 모든 `ReviewerRef`/evidence 자유 문자열은 trim 후 non-blank이고, `itemId`는 bundle 안에서 unique다. 각 `verificationOwners`는 structural-unique이며 해당 item의 `originReviewer`를 정확히 한 번 포함한다. 기대 pair set은 모든 `(itemId, verificationOwner)`의 Cartesian set이고, `VerificationResult`의 `(itemId, ownerRef)` pair set은 기대 set과 exact equality여야 한다. duplicate·extra·missing pair, blank payload/evidence는 shortcut 전에 REJECT한다.

**§5 owner execution routing (authority).** Fix-verification 시작 시 prior Required Fix bundle의 모든 `verificationOwners`를 structural equality로 dedupe한 union을 만든 뒤, 결과를 합성하기 전에 전부 다음과 같이 route한다. `auditor`는 exact lens마다 `lsc-auditor` 1개, `explore`는 exact `{probe,scope,successCriterion}`마다 `lsc-explore` 1개를 같은 review batch에서 실행한다(수정 path가 test/check인지와 무관). `test-authoring`은 §3.0의 단일 `lsc-test-engineer` assignment에 item별 `{obligation,testPaths}` 전부를 전달하고, `deterministic-check`는 §3.1에서 실제 실행한 canonical `{command,cwd,successCriterion}`과 structural-equal한 ref만 그 결과에 결합하며, `post-craft-main`은 main이 각 `{procedure,successCriterion}`을 직접 수행한다. §3.0 변경을 commit한 뒤 current implementation OID를 freeze하고, 각 route의 관측 bytes/OID와 audit cycle이 그 freeze와 일치할 때만 `VerificationResult`를 정규화한다. unsupported ref, route 누락, 무응답, OID/cycle mismatch는 result를 합성하거나 다른 owner에게 재배정하지 않고 shortcut 전에 REJECT한다. 기존 §5의 “single lsc-auditor” 및 “tests/check를 touch한 경우에만 explore” 규칙은 이 routing으로 교체하며 unrelated owner/lens는 추가하지 않는다.

- normalizer는 auditor `APPROVE|APPROVE-WITH-COMMENT`만 PASS(AWC/REJECT/inconclusive는 FAIL), explore는 bounded evidence가 binary criterion을 전부 만족할 때만 PASS, main은 procedure 전수 관측만 PASS, test-authoring은 listed obligation+`Test Health: HEALTHY`+fresh `0 failed`만 PASS, deterministic check는 current identity의 `details.passed===true`만 PASS로 바꾼다. 모든 result의 explicit OID/cycle은 해당 owner가 관측한 current closure와 일치해야 하며 다른 cycle/OID의 report로 보정하지 않는다.

§4.2는 raw owner report와 surviving finding을 현행 four-level correspondence로 다시 분류한다. 새 CRITICAL, broad/severe finding, `needs-redesign`, unheard/unroutable/mismatched/inconclusive owner는 REJECT다. `owner FAIL` 또는 새 MAJOR라는 사실만으로 REJECT하지 않는다. surviving blocking finding이 모두 concrete `apply-only` remediation과 complete owner set을 가지면 APPROVE-WITH-CHANGE, 하나라도 scoped prescription으로 닫히지 않으면 REJECT다. 모든 expected owner가 current-OID PASS이고 새 blocking finding이 없을 때만 fix-verification shortcut이 APPROVE/APPROVE-WITH-COMMENT로 닫힌다. 새 MINOR는 non-blocking evidence로 남긴다.

- positive fixtures는 mixed auditor/non-lens success, `partial original apply-only → AWC`, `new unrelated apply-only MAJOR → AWC`다. negative fixtures는 wrong lens/probe, missing result, unheard owner, test health 불량, `origin omitted`, `duplicate itemId`, `duplicate owner`, `extra result`, `blank criterion/evidence`, stale OID/cycle, `owner inconclusive → REJECT`, `new needs-redesign MAJOR → REJECT`, `new CRITICAL → REJECT`다.

### 복구

bundle relation/OID-cycle binding이 불완전하면 shortcut 전에 REJECT한다. structurally valid한 owner FAIL 또는 surviving MAJOR는 broad REJECT로 축약하지 않고 four-level precedence로 재분류하며, complete next cycle에서 authoritative owner set과 result를 다시 합성한다.

Contract proof는 (a) two-auditor-lens + production-origin explore + test-authoring + deterministic-check + main bundle이 각 exact route/result를 한 번씩 생성하는 positive, (b) production-origin explore를 current path 조건으로 누락한 경우, auditor lens 하나를 single-lens로 축약한 경우, unsupported ref, duplicate route, OID/cycle mismatch가 REJECT인 negative를 추가한다.

## 시나리오 7 — interval provenance·ledger chain 손상이 periodic gate를 건너뛴다

### 실패 서사

새 필드를 required top-level로 decode하거나 pending과 decision을 한 union에 섞는다. record interval을 현재 process mode에서 재유도하면 fixture interval 2 state를 live interval 3이 다른 schedule로 해석한다. 완료 artifact를 둘 이상 제거하거나 crash window에서 visible latest artifact를 더 제거해 candidate가 persisted marker보다 작아지거나 forged audit number가 forward gap을 만들고도 writer가 marker를 덮을 수 있다. 반대로 marker N에서 latest completed `audit-N.md` 하나만 삭제한 candidate N은 equality replay이므로 tamper로 검출된다고 과장할 수 있다. `{scheduledCycle:6,dueCycle:997,nextDueCycle:1000}` 같은 자기일관 future-due chain이 actual audit cycle과 분리되면 candidate 4~999 gate를 건너뛴다.

### 조기 신호

- escalation field가 없는 version 2 fixture가 decode 실패하거나 fixture→live mode switch가 proceed한다.
- `candidateCycle < auditCycle` backward gap이나 forged audit-number forward gap이 state/check threshold/base snapshot write를 수행한다.
- latest completed audit 하나 삭제로 생긴 `candidateCycle === auditCycle` equality replay를 backward tamper로 잘못 거부하거나, same-cycle replay가 `auditCycle`, `checkLogAtCycleStart`, base snapshot bytes를 바꾸거나 future `dueCycle > auditCycle + 1` chain이 통과한다.
- live due-3 Continue history가 있는 candidate-6 pending 또는 fixture due-2 history+due-4 pending이 conflict로 거부된다.
- foreign feature, negative/unsafe cycle, wrong first threshold, mixed interval, predecessor gap, due-before-scheduled, forged next due, duplicate/non-final terminal, off-schedule `pending.scheduledCycle`이 decode/transition을 통과한다.
- candidate 15 pending의 `dueCycle`이 15가 아니거나 Continue의 next due가 18이 아니다.

### 예방 장치

- 새 top-level 필드는 optional이고 각 pending/decision의 required `intervalCycles`가 record-local provenance다. persisted interval과 active interval이 다르면 fixture↔live mode switch를 write 전 `invalid-state`로 거부하며 field-less legacy만 현재 interval로 bootstrap한다.
- validation→terminal→exact pending→schedule precedence에서 **(a)** safe cycle, **(b)** current feature, **(c)** first threshold/persisted interval, **(d)** predecessor link, **(e)** due≥scheduled, **(f)** safe next due, **(g)** terminal position/mirror, **(h)** pending의 `scheduledCycle`이 no-history first threshold 또는 latest Continue `nextDueCycle`과 exact 일치함을 전수 검증한다. history key는 `dueCycle`이고 strictly increasing/unique다.
- **(i)** artifact-derived candidate와 persisted marker는 safe integer이며 legacy만 bootstrap한다. 값이 있으면 candidate는 marker와 exact 동일한 idempotent replay 또는 safe `marker+1`만 허용하고 backward/forward gap은 모든 write 전 `invalid-state`다. same-cycle replay는 marker/check threshold/base snapshot을 byte-stable하게 유지한다. 같은 cross-invariant pass는 모든 pending/decision의 `dueCycle <= auditCycle + 1`을 강제해 architect의 self-consistent future-due chain 지적을 통합 차단한다.
- corrupt fixtures는 (a)~(i)를 각각 독립적으로 뒤집고 `candidate<auditCycle` backward gap(완료 artifact 둘 이상 제거 또는 crash-window visible latest 추가 제거), forged audit-number forward gap, future-due self-consistent chain, duplicate/mirror/**pending + 동일 `(feature,dueCycle)` decision** conflict를 포함한다. latest completed audit 하나 삭제는 `candidate===auditCycle` equality replay로 허용되고 manual tamper 전수 검출 증거가 아니다. positive는 same-cycle byte-stable replay, prior 다른-due Continue history+new pending, live 3→6, fixture 2→4, overdue 15→18이다.
- `CRAFT_STATE_VERSION=2`, future-version reject, exact-root atomic writer, re-registration preservation과 interval/history/terminal/base snapshot round-trip을 유지한다.

### 복구

field 부재만 legacy default로 수용한다. 존재하지만 interval/산술/chain이 모순된 evidence는 자동 삭제·dedupe·Continue하지 않고 명시적 state error로 중단해 수동 복구를 요구한다. 손상 state 또는 mode switch는 cycle/threshold/land 권한을 만들지 않는다.
