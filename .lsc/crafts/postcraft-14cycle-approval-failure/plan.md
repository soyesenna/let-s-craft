# Plan — postcraft-14cycle-approval-failure

## Metadata

| 항목 | 값 |
|---|---|
| Feature | post-craft 수렴 장치 종합 구현 — 루프 바운딩·측정 위생·사전 차단·다중-lens AWC |
| 입력 정본 | `.lsc/crafts/postcraft-14cycle-approval-failure/spec.md` AC-1~AC-10, `trace.md`, `research/SYNTHESIS.md` |
| 분류 | Brownfield / Mid-sized boundary change |
| 계획 모드 | **DELIBERATE** — audit/land fail-closed 상태 전이와 destructive approval 인접 변경 |
| 구현 루트 | lets-craft feature worktree의 `src/`, `skills/`, `agents/`, `test/`, `fixtures/` |
| 전달 단위 | 5개 순차 PR 단위; PR-1 이후 PR-2/PR-3, 그 뒤 PR-4/PR-5 |
| 예상 복잡도 | **HIGH** — optional durable state, git OID/path gate, fresh-process abort, fixture subprocess E2E |
| 문서 상태 | **합의 도달 (iteration 6, AWC 경로)** — architect NOT-BLOCKING(6연속) + critic APPROVE-WITH-CHANGE(동봉 Fix 3건 verbatim 적용) + lsc-critic-recheck RECHECK: PASS |

## Context

대상 프로젝트 `<대상 기능>`는 cycle 0~14가 전부 REJECT였다. trace는 검증 불가능 AC의 개방형 대리 증명의무, 무상한 full 재감사, fix-introduced treadmill, 예방 가능한 red/오인용, base drift 종단 봉쇄의 합성을 확인했다. lets-craft는 cap 단독이 아니라 audit-begin 바운딩, audit/land drift 경계, 측정·요구 위생, multi-lens Required Fix bundle을 함께 구현해야 한다.

### lsc-explore로 재검증한 seam 요약

- **Audit/state:** `src/craft/verdict.ts`의 `performAuditBegin`은 현재 candidate 기록 뒤 non-binding `cycleWarn`만 내며 wrapper는 `{feature_dir}`만 받는다. `src/craft/state.ts`의 optional v2 decode(`:149-159`)와 atomic persist(`:129-137`)가 신규 evidence의 유일한 저장 seam이다.
- **Abort/land/git:** abort는 active-only exact tool, `[Land]`는 nonce/prepared lifecycle을 갖고 `performLand`는 Phase R/C/P/X와 live target recheck를 수행한다. shared raw/NUL git runner와 added-path gate는 아직 없다.
- **Pipeline contracts:** craft는 exactly-one executor+one-shot retry, post-craft는 begin 뒤 base를 탐지하고 single-lens Required Fix를 사용한다. pre-craft AC class, auditor Expected State/양쪽 citation, craft/post-craft green mirror는 아직 없다.
- **Fixture/E2E:** ordered regex/kind/`once` matcher와 `earlyExit` helper가 존재한다. 기존 full-cycle E2E는 verdict 의미를 검증하지 않으므로 deterministic REJECT prefix와 전용 selection fixture가 필요하다.

구현 후 line number가 이동하므로 executor는 위 symbol/heading과 각 PR의 좁은 좌표를 함께 anchor로 사용한다.

## Work Objectives

1. **Bound and persist audit cycles.** TS SSOT interval(live 3/fixture 2), record-local interval provenance, canonical pending/history/next-due/terminal과 overdue legacy schedule로 begin을 결정적으로 바운딩한다.
2. **Close terminal paths safely.** 세 exact disposition을 atomic 기록하고 Abort/Preserve 뒤 audit·land·stale approval을 차단한다.
3. **Use one base authority, then block drift.** post-craft detected base로 audit WARN을 만들고 approved OID added-path intersection으로 land를 막는다.
4. **Reduce avoidable audit noise.** re-entry green check, Expected State commit-first, 양쪽 citation, pre-craft AC verification class/proxy obligation과 current-OID 정상 post-craft continuation을 고정한다.
5. **Keep AWC and E2E bounded.** mixed-source Required Fix owner 전수 검증, fixture cap-2 세 처분과 cross-OID red→새 audit cycle continuation을 증명한다.

## Guardrails

### Must Have

- `performAuditBegin`이 cap의 최종 경계이며 policy 판정은 cycle/check-threshold write보다 먼저다. `registerAuditBeginTool`만 `detectFixturePath(name => pi.getFlag(name))`로 env-first `LSC_FIXTURE`와 `--lsc-fixtures` alias를 함께 판독해 active interval을 pure policy에 주입한다. `--lsc-fixtures`는 interactive invocation의 bonus alias에만 적용하고, 별도 process E2E·chaining suppression authority는 환경변수 `LSC_FIXTURE`다.
- 모든 신규 `CraftState` top-level field는 optional v2이고 기존 atomic/exact-root 저장을 쓴다. 각 pending/decision record의 `intervalCycles`가 cap provenance이며, history authority·validated next-due/terminal mirrors와 산술·연쇄 invariant 위반은 자동 보정 없이 fail-closed다.
- TS 조립 `[Audit Escalation] … continue?`와 exact labels `Continue auditing` / `Abort this craft` / `Preserve branch and stop`만 소비한다.
- Abort는 optional exact-root `lsc_craft_abort`에 위임하고 Preserve는 branch/worktree를 남긴다. terminal persist 뒤 approvals/prepared operation을 지우고 land는 nonce 전에 terminal을 본다.
- audit base authority는 post-craft가 land target으로 먼저 탐지해 전달한 ref다. legacy caller는 attached current branch만 fallback하며 unknown은 audit WARN, land git 계산 실패는 fail-closed다.
- audit header/canonical verdict parser를 보존하고 Expected State/Base Drift를 뒤에 추가한다. 신규 TS 판정은 pure/injected core, wrapper는 schema/exception 변환만 담당한다.
- Required Fix item은 concrete discriminated `originReviewer`, non-empty `verificationOwners`, `fixCompleteness`를 가지며 item별 normalized `VerificationResult`가 없거나 owner가 unheard/unroutable이면 누락·임의 배정 대신 REJECT한다.
- `passed === false`는 원인 중립적 `executed-red` 관측으로만 기록한다. parent craft 오케스트레이터의 attribution은 prior Required Fix와 fresh post-fix log를 이용한 best-effort repair hint일 뿐이며, 즉시 수리 가능한 `implementation` hint만 기존 one-shot retry를 소비한다. 정정된 spec Goal (C)에 따라 post-craft-authored check가 존재하는 audit-driven re-entry에서 `[Craft Complete]`는 executor complete+fresh green일 때만 허용하고 red/미실행 상태의 완료 선언은 금지하며, executed-red는 실제 red evidence를 동반한 `[Craft Incomplete]`로만 반환한다. 불확실·test-check·post-repair red와 infrastructure도 각 evidence union branch를 보존한 `[Craft Incomplete]`로 끝내고 정상 새 post-craft cycle로 반환한다.
- Required Fix bundle은 origin-owner 포함, item/owner uniqueness, expected-result pair exact equality, current implementation OID/audit cycle binding을 shortcut 전에 검증한다. 이 binding은 한 current audit cycle의 owner 결과 결합에만 적용하고 craft red attribution이나 cross-OID report 재사용에는 쓰지 않는다.

### Must NOT Have

- escalation을 `[Land]` nonce에 넣거나 REJECT를 land-eligible로 만들지 않고, 우회 가능한 별도 cap preflight만 두지 않는다.
- 새 state/migration/base-policy 저장소를 만들거나 added-path gate를 all-touched/semantic 충돌로 넓히지 않는다.
- full re-audit, audit literal 형식, pre-craft cap, craft exactly-one executor/one-shot retry, check harness ownership을 개편하지 않는다.
- commit-first/인용 의미를 불완전한 exact-match 도구로 강제하지 않는다.
- 대상 프로젝트 회생, 병렬 auditor 집계, capture-recapture, scope freeze를 끌어오지 않는다.
- **Non-Goal:** manual audit artifact tamper 전수 탐지는 spec 요구가 아니다. 방어 범위는 invariant (i)가 포착하는 `candidateCycle < auditCycle` backward gap과 `candidateCycle > auditCycle + 1` forward gap까지이며, latest completed audit 하나 삭제로 생기는 `candidateCycle === auditCycle` equality replay는 허용한다.

## ADR summary

### DR 요약

**Mode:** DELIBERATE

**Principles**

1. 우회 가능한 경고가 아니라 피해가 발생하는 입구/merge 경계에서 fail-closed한다.
2. 사용자 방향 결정과 destructive merge 권위를 분리한다.
3. durable evidence는 retry·fresh process·legacy state에서 같은 의미를 가져야 한다.
4. 의미 판단은 산문으로 남기되 결과는 Expected State/인용/base drift/bundle에 관측 가능하게 한다.
5. 수렴은 cap 단독이 아니라 바운딩·측정 위생·사전 차단·AWC의 합성으로 달성한다.

**Decision Drivers — top 3**

1. `lsc_audit_begin`/`lsc_land` 직접 호출에도 우회되지 않는 fail-closed 불변식.
2. stale/replayed selection, fresh post-craft process, version 2 state에 대한 안전성과 하위 호환.
3. 최소 API/저장 표면으로 vitest와 fixture E2E에서 결정적으로 증명 가능한 구조.

**Viable options with bounded pros/cons — iteration 6 load-bearing choices 포함**

| 결정 | 채택안과 bounded trade-off | 배제안과 근거 |
|---|---|---|
| cap gate | `performAuditBegin` 내부 — 직접 호출도 막지만 begin 분기가 늘어난다. | 별도 preflight — caller 생략으로 fail-closed 위배 |
| direction evidence | feature/due-bound durable state — fresh process에 강하지만 destructive nonce 권위는 없다. | `[Land]` nonce 일반화 — 권위 결합·restart evidence 소실 |
| land path | approved OID 양측 exact added-path 교집합 — F14-1을 막지만 semantic collision은 제외한다. | 외부 정책/all-touched — stale 설정 또는 정상 M/M 과차단 |
| **base authority** | **옵션 (a): post-craft가 land base를 먼저 탐지해 optional `base_branch`로 begin에 전달** — audit/land가 일치하나 호출 순서를 바꾼다. | 옵션 (b): project-root branch 상시 authority — HEAD≠land target에서 거짓 측정이므로 legacy attached fallback으로만 유지 |
| **ledger 정규형·cap provenance** | **별도 pending + decided history, 각 record의 persisted `intervalCycles`, history authority와 validated mirrors** — mode 전환도 검출하지만 strict 산술·연쇄 validation이 늘어난다. | current process mode에서 interval 재유도/top-level cap mirror — fixture→live 재개와 forged schedule을 구분하지 못함; pending-history union — duplicate/stale/terminal 의미가 불명확 |
| **craft red / report identity** | **옵션 (c): prior §3.0 report를 attribution에서 제거하고, fresh log로 즉시 수리 가능한 `implementation` hint만 one-shot retry하며 나머지 red/infrastructure는 `[Craft Incomplete]`→정상 새 post-craft cycle로 반환** — current OID에서 §3.0·check·audit을 다시 수행하므로 stale report와 별도 handoff protocol이 사라지지만 red continuation 하나가 audit cycle 하나를 소비한다. 이는 정정된 spec Goal (C)의 계약, 즉 red 상태의 `[Craft Complete]` 금지와 실제 red evidence를 동반한 `[Craft Incomplete]` 반환에 정합한다. | 옵션 (a): executor 뒤 report 재생성 — craft가 test-authoring을 재소유하고 추가 pass가 필요; 옵션 (b): test/check blob-set binding — path inventory·rename·script 변경의 durable schema/freshness/invalidation이 필요; `passed === false` 즉시 implementation 귀속 — 원인 증명 부재 |
| **non-lens provenance** | **concrete discriminated owner reference + item-level normalizer-owned `VerificationResult`** — 현행 AWC reachability를 보존하지만 source별 판정표가 필요하다. | category string/agent literal PASS — same lens/probe 재현과 현행 output vocabulary에 맞지 않음; auditor-only provenance — deterministic/explore/main finding을 불필요하게 REJECT |
`passed === false`는 실행된 red만 증명하며 production defect는 증명하지 않는다. 그래서 prior audit OID A의 §3.0 report를 craft OID B에 재귀속하지 않는 옵션 (c)를 채택한다. fresh post-fix log와 prior Required Fix가 같은 production target을 직접 식별할 때만 best-effort `implementation` hint로 즉시 one-shot repair하고, 누락·mixed·test-check·post-repair red는 정상 새 post-craft cycle의 current OID §3.0이 다시 판별한다. check evidence는 `green {details,logPath}` / `executed-red {details,logPath,repairHint}` / `infrastructure {diagnostic,logPath?}`의 discriminated union이고 infrastructure에는 `repairHint`를 금지한다.

위 bold 결정은 executor가 재해석할 수 없는 ADR 선택이다. conflict/stale/mode-switch/owner 부재는 자동 보정하지 않고 fail-closed하며, PR-1의 (a)~(i), PR-4의 bundle relational invariant·four-level precedence·discriminated evidence·도달 가능한 20-case product table·canonical cycle return이 authority다.

### ADR

**Decision**  
`performAuditBegin` 내부 cap gate+record-local interval ledger와 candidate↔persisted-cycle cross-invariant, pre-begin detected `base_branch`, approved-OID added-path land gate, 원인 중립 `green | executed-red | infrastructure` evidence union+best-effort immediate-repair hint+정상 새 post-craft cycle 반환, concrete owner reference+current-audit-cycle-bound normalized result 모델을 채택한다. Continue만 cycle을 발행하고 Abort/Preserve·malformed/mode-switched state·unowned finding은 fail-closed다. 정정된 spec Goal (C)에 맞춰 red 상태의 `[Craft Complete]`는 금지하고 실제 red evidence를 동반한 `[Craft Incomplete]`만 허용한다.

**Drivers**  
직접 호출 우회 불가, direction/destructive 권위 분리, fresh-process/v2 legacy 안전, 결정적 testability다.

**Alternatives considered**  
별도 preflight/release nonce, current-branch 상시 authority, process-mode interval 재유도/pending-history union, `passed === false` 즉시 production 귀속, lane별 또는 check 전용 production executor, cross-OID report 재생성 (a), test/check blob-set binding (b), category-only/auditor-only provenance, external/all-touched path policy를 검토해 위 DR 표의 근거로 제외했다.

**Why chosen**  
실제 land base와 cycle 발행 경계에 권위를 두고 interval·pending·candidate marker·owner-bound result·global retry를 명시하면 legacy·artifact replay·mode-switch·non-lens·parallel-red 상태를 추측 없이 막는다. red observation과 repair hint를 분리하고 옵션 (c)의 기존 정상 post-craft entry를 재사용하면 stale A→B report, 새 mode/envelope, post-handoff second-stage state 없이 current OID에서 test/check health와 production finding을 다시 세울 수 있다. 이 반환은 정정된 spec Goal (C)가 금지하는 red 완료 선언이 아니라 red evidence를 보존한 `[Craft Incomplete]` 종료다.

**Consequences**

- wrapper에 optional `escalation_disposition`/`base_branch`, state record에 required `intervalCycles`와 optional ledger/base snapshot이 추가된다. explicit base가 없는 legacy caller만 attached-current fallback/unknown을 쓰며 explicit ref 해석 실패는 fallback하지 않는다.
- initial craft는 기존 검증, audit-driven re-entry는 executor 완료와 fresh check green의 conjunction을 요구한다. `executed-red`는 parent craft 오케스트레이터가 best-effort `implementation | test-check | unknown` hint로 분류하되, fresh log가 prior production target을 직접 식별한 `implementation`만 parent-context global retry 하나를 쓴다. green/executed-red에는 실제 `details`/`logPath`가 필수이고 executed-red에만 `repairHint`가 있으며, infrastructure는 raw `diagnostic`과 tool이 실제 생성한 경우에만 optional `logPath`를 갖고 `repairHint`는 금지한다. 나머지 red/infrastructure는 `[Craft Incomplete]`로 끝난 뒤 정상 새 post-craft cycle로 이어진다.
- Expected State/citations와 direction selection은 관측 가능한 prose 계약이다. Required Fix는 origin 포함 owner/result exact pair set, explicit `implementationOid`/`auditCycle`, all apply-only 및 현행 four-level correspondence를 함께 요구한다. 이 OID/cycle 결합은 각 owner가 실제 관측한 current audit cycle 안에서만 유효하며 craft 전후 report를 이어 붙이지 않는다.

**Follow-ups**  
인용 기계화, multi-pass 집계, capture-recapture, semantic path policy는 `open-questions.md`의 별도 후보다.

- Pre-mortem 7개 실패 시나리오와 예방/복구 전문: `plan/appendix-pre-mortem.md`.
- Unit·integration·fixture E2E·observability 검증 전문과 실행 순서: `plan/appendix-verification-strategy.md`.

## Task Flow

`PR-1 policy/state → PR-2 begin/terminal → PR-3 base/land → PR-4 contracts/provenance → PR-5 fixture E2E` 순서다. PR-1 뒤 PR-2/PR-3 조사는 병행할 수 있지만 공유 `state.ts`/`verdict.ts`와 `land.ts` terminal/path edits는 이 순서로 통합한다. 각 PR은 targeted proof와 conventional commit을 남기고 전체 build/E2E는 통합 뒤 한 번 실행한다.

## Detailed TODOs

### PR-1 — Audit policy SSOT와 optional durable state

**대상**

- 신규 `src/craft/audit-policy.ts`
- `src/craft/state.ts:25-30,34-105,129-137,149-208,259-283`
- 신규 `test/audit-policy.test.ts`
- `test/craft-state.test.ts`, `test/craft-state-version.test.ts`, `test/craft-state-candidates.test.ts`, `test/deferred-pool-regression.test.ts`

**변경**

1. live/fixture interval과 세 canonical disposition을 TS constant/type SSOT로 정의한다. registration wrapper만 `detectFixturePath(name => pi.getFlag(name))` 결과를 읽고 pure policy/`performAuditBegin`에는 active interval을 인자로 준다.
2. 신규 state 필드는 다음 정규형으로 고정한다. `dueCycle`은 selection이 묶이는 실제 candidate, `scheduledCycle`은 그 gate를 촉발한 기존 threshold다.

```ts
type AuditEscalationInterval =
  | typeof LIVE_AUDIT_ESCALATION_INTERVAL
  | typeof FIXTURE_AUDIT_ESCALATION_INTERVAL;
type AuditEscalationDisposition =
  | "Continue auditing"
  | "Abort this craft"
  | "Preserve branch and stop";
interface AuditEscalationPending {
  feature: string;
  dueCycle: number;
  scheduledCycle: number;
  intervalCycles: AuditEscalationInterval;
  createdAt: string;
}
interface ContinueDecision extends AuditEscalationPending {
  disposition: "Continue auditing";
  decidedAt: string;
  nextDueCycle: number;
}
interface TerminalDecision extends AuditEscalationPending {
  disposition: "Abort this craft" | "Preserve branch and stop";
  decidedAt: string;
}
type AuditEscalationDecision = ContinueDecision | TerminalDecision;
type AuditEscalationStateFields = {
  auditEscalationPending?: AuditEscalationPending;
  auditEscalations?: AuditEscalationDecision[];
  nextAuditEscalationCycle?: number;
  auditTerminalDisposition?: TerminalDecision;
};
```

3. cap provenance는 별도 top-level mirror가 아니라 pending과 모든 decision에 required `intervalCycles`로 저장한다. 새 evidence의 첫 interval은 injected active interval이며 이후 모든 record가 이를 이어받는다. persisted interval과 현재 active interval이 다르면 fixture→live/live→fixture mode switch를 지원하지 않고 어떤 write보다 먼저 `invalid-state`로 거부한다. escalation field가 전혀 없는 legacy v2만 현재 active interval로 첫 pending을 만들 수 있다.
4. precedence는 **shape/산술·연쇄 invariant 검증 → valid terminal block → exact pending 재사용/소비 → history-derived schedule 판정** 순서다. history와 mirror를 다음 정규형으로 전수 검증한다: **(a)** `scheduledCycle`·`dueCycle`·`nextDueCycle`·top-level next cycle은 모두 non-negative safe integer, **(b)** pending과 모든 history record의 `feature`는 현재 feature와 exact 일치, **(c)** 첫 record(아직 history가 없으면 pending)의 `scheduledCycle === intervalCycles`이고 모든 evidence의 persisted interval이 동일, **(d)** 첫 record 이후 각 decision의 `scheduledCycle`은 바로 앞 Continue의 `nextDueCycle`과 exact 일치, **(e)** 모든 pending/decision은 `dueCycle >= scheduledCycle`, **(f)** 각 Continue는 safe한 `nextDueCycle === dueCycle + intervalCycles`, **(g)** terminal은 최대 1개이며 history 마지막이고 top-level terminal이 exact mirror, **(h)** pending의 `scheduledCycle`은 history가 없으면 첫 threshold와, history가 있으면 latest Continue의 `nextDueCycle`과 exact 일치하고 `intervalCycles`도 latest Continue와 일치하며 terminal 뒤 pending은 금지다. history key는 `dueCycle`이며 strictly increasing/unique이고 top-level next due는 latest Continue의 exact mirror다.

**(i)** artifact-derived `candidateCycle`과 persisted `auditCycle`은 safe integer다. `auditCycle`이 없는 legacy state만 현재 artifact set으로 bootstrap한다. 값이 있으면 `candidateCycle`은 정확히 `auditCycle`(이미 begin된 cycle의 idempotent replay) 또는 safe `auditCycle + 1`(새 cycle)이어야 하며, 그 밖의 backward/forward gap은 어떤 write보다 먼저 `invalid-state`다. `candidateCycle === auditCycle` replay는 기존 `auditCycle`, `checkLogAtCycleStart`, base snapshot을 갱신하지 않는다.

같은 cross-invariant pass에서 persisted `auditCycle`이 있는 state의 모든 pending/decision에 `dueCycle <= auditCycle + 1`도 강제한다. 이는 `(i)`의 candidate↔marker 결합과 함께 architect가 지적한 산술적으로 자기일관한 future-due 위조 chain을 통합 차단하며, crash-window·overdue legacy의 `dueCycle === auditCycle + 1`은 허용한다.
5. pending은 `candidateCycle === dueCycle`에서만 재사용·소비한다. candidate가 앞서거나 지나간 stale pending은 교체하지 않고 `stale-pending`으로 거부한다. 정상 schedule은 candidate가 next due 이상일 때 pending을 만들되, overdue legacy state는 현재 candidate에 묶는다: 필드 없는 cycle-14 state의 candidate 15는 `{scheduledCycle:3,dueCycle:15,intervalCycles:3}`으로 한 번 gate하고 Continue는 `nextDueCycle:18`을 history와 top-level mirror에 함께 쓴다.
6. exact-root writer와 pure transition을 추가하고 `setActiveCraft` preservation, audit-cycle writer, atomic persist가 evidence를 지우지 않게 한다. `CRAFT_STATE_VERSION=2`와 기존 `.craft-state.json`을 유지한다.

**Acceptance**

- positive reactivation은 live `3 pending → Continue decision 유지 → 4/5 proceed → candidate 6의 새 pending이 prior due-3 history와 정상 공존 → consume`, fixture `2 pending → Continue → 3 proceed → candidate 4 pending/consume`을 각각 고정한다.
- overdue matrix는 legacy field 없는 cycle 14 + candidate 15 → gate 1회 → Continue next due 18 → 16/17 proceed → 18 재발동을 고정한다.
- 같은 due pending 재호출은 멱등이고 stale pending은 replacement 없이 거부된다. conflict는 **pending + 동일 `(feature,dueCycle)` decision**에만 적용하며 prior 다른-due Continue history와 새 pending은 valid다.
- (a) unsafe/negative cycle, (b) foreign feature, (c) wrong first threshold/mixed interval, (d) broken predecessor link, (e) due-before-scheduled, (f) forged/overflow next due, (g) duplicate/non-final terminal, (h) off-schedule `pending.scheduledCycle`, (i) `candidateCycle < auditCycle` backward gap·forged audit-number forward gap·future-due self-consistent chain의 독립 corrupt-state fixtures와 mirror/duplicate/same-key pending conflict를 `invalid-state`로 고정한다. marker N에서 latest completed `audit-N.md` 하나만 삭제해 candidate가 N이 되는 경우는 equality replay로 허용되며 tamper 검출 증거가 아니다; backward fixture는 candidate가 marker 아래로 내려가도록 완료 artifact를 둘 이상 제거하거나 crash window에서 visible latest artifact를 더 제거하는 경우로 만든다.
- same-cycle replay는 `auditCycle`·`checkLogAtCycleStart`·base snapshot bytes를 바꾸지 않고 동일 결과를 반환한다.
- persisted fixture interval 2를 live interval 3으로(역방향 포함) 읽는 mode switch는 write 없이 거부하고, field-less legacy state만 현재 mode로 bootstrap한다.
- old version 2 state가 읽히고 round-trip/re-registration 뒤 release/audit/escalation interval/history/terminal evidence가 보존되며 모든 write는 기존 atomic 경로만 사용한다.

**AC:** AC-1, AC-2, AC-9, AC-10

### PR-2 — `lsc_audit_begin` fail-closed gate와 terminal disposition

**대상**

- `src/craft/verdict.ts:249-319,471-475`
- `src/craft/abort.ts:17-57`
- `src/craft/destructive-approval.ts:20-231`
- `src/craft/land.ts:255-345`의 state/approval preflight
- `test/craft-verdict.test.ts`, `test/craft-abort.test.ts`, `test/craft-land-flow.test.ts`

**변경**

1. `registerAuditBeginTool`이 `detectFixturePath(name => pi.getFlag(name))`를 한 번 호출해 env-first `LSC_FIXTURE`와 interactive-only `--lsc-fixtures` alias를 포함한 active interval을 `performAuditBegin`/PR-1 pure policy에 주입한다. 별도 process E2E와 chaining suppression은 `LSC_FIXTURE`만 authority로 사용하고, `performAuditBegin` 자체는 env나 CLI flag를 직접 읽지 않는다. candidate 계산 직후, `recordAuditCycleBegin` 전에 gate를 처리하고 기존 fail-open `cycleWarn`은 제거한다.
2. land의 `composeLandQuestion` 선례처럼 `composeAuditEscalationQuestion`이 feature/candidate/active-cap symbol과 canonical labels로 `[Audit Escalation] … continue?` 문자열을 TS에서 조립한다. begin의 structured `isError.details.question`에 싣고 SKILL은 이를 verbatim 사용한다.
3. wrapper schema에 optional `escalation_disposition` canonical label을 추가한다. 기존 `{feature_dir}` 호출은 cap 미만에서 동일하게 동작한다.
4. 첫 cap 호출은 exact pending을 atomic persist한 뒤 `isError`를 반환한다. pending 없는 선제 disposition, stale candidate, unknown/free-answer label은 소비하지 않는다.
5. Continue는 pending을 history로 옮기고 validated next due mirror를 쓴 뒤 현재 cycle을 한 번 기록한다. Abort/Preserve는 terminal decision/history를 한 atomic write로 남기고 cycle을 발행하지 않는다.
6. fresh post-craft에서도 기존 도구 위임을 지키도록 `lsc_craft_abort`에 optional `feature_dir` exact-root 입력을 추가하고 active legacy caller를 유지한다. Abort/Preserve 성공 뒤 pending approval/prepared operation을 무효화한다.
7. `performLand`는 nonce consume 전에 existing `aborted`와 terminal disposition을 거부한다. begin success details의 기존 세 필드는 유지하고 escalation status/next due는 additive evidence다.
8. `test/craft-verdict.test.ts:258-280`의 cycle≥3 WARN 성공 테스트 2건은 그대로 두지 않고 escalation-required/pending-persist/cycle-불변 기대 테스트로 교체한다.

**Acceptance**

- env-only와 `--lsc-fixtures=<path>` flag-only(환경변수 unset) registration-wrapper unit 모두 fixture interval 2를 주입하며 live interval 3과 구분된다.
- cap matrix와 legacy overdue matrix에서 미소비 호출은 `isError`, state cycle/threshold 불변, retry 멱등이다. live 3→Continue→6과 fixture 2→Continue→4의 prior-history+new-pending transition이 실제 wrapper seam에서도 유지된다.
- TS가 조립한 질문·세 label이 wrapper details와 SKILL 입력에서 동일하고 Continue 뒤 persisted interval 간격으로 재발동한다.
- Abort/Preserve는 durable record 이후 begin/land를 거부하며 branch/worktree를 삭제하지 않는다.
- REJECT land와 terminal/nonce 우회 negative test가 path/approval보다 먼저 fail-closed다.
- 기존 active abort caller와 cap 미만 begin caller가 무회귀이고 교체된 WARN 테스트는 더 이상 fail-open을 허용하지 않는다.

**AC:** AC-1, AC-2, AC-3, AC-9, AC-10

### PR-3 — Base drift 관측과 merge 전 added-path gate

**대상**

- 신규 `src/utils/git.ts`
- `src/artifacts/worktree.ts:16-39,195-239`
- `src/craft/verdict.ts:249-319`
- `src/craft/state.ts`의 PR-1 base snapshot writer
- `src/craft/land.ts:59-95,129-165,218-475`
- `skills/post-craft/SKILL.md`의 worktree/base 탐지 및 audit-begin 호출 순서
- `test/craft-verdict.test.ts`, `test/craft-land-flow.test.ts`

**변경**

1. raw `{stdout,stderr}`와 NUL bytes를 보존하는 shared git runner를 추출하고 touched `worktree.ts`/`land.ts` caller를 함께 이관해 세 번째 private runner를 만들지 않는다.
2. post-craft SKILL의 순서를 **feature worktree 확인 → 실제 land target base 탐지 → `lsc_audit_begin({feature_dir, base_branch})` → audit**로 재배치한다. 이때 land에 넘길 동일 base ref가 audit-time canonical authority다.
3. wrapper에 optional `base_branch`를 추가한다. 값이 있으면 argv로 `git rev-parse --verify --end-of-options <expr>^{commit}`을 실행해 그 ref만 사용하며 해석 불가이면 current branch로 fallback하지 않고 `{status:"unknown",authority:"explicit-base",baseBranch:<input>,error}`를 기록한다. 값이 없는 legacy direct caller만 attached project-root current branch를 fallback으로 쓰고 detached/unborn/unresolvable이면 base를 추측하지 않은 채 `{status:"unknown",authority:"legacy-current-branch",error}`를 기록한다.
4. canonical/fallback base tip과 feature source tip을 anchor하고 `rev-list --count <source>..<base>`를 계산한다. snapshot/details에는 `{baseBranch,baseTip,sourceTip,behindCount,status,authority,observedAt,error?}`를 남기며 behind=0/양수/unknown을 구분한다.
5. land는 승인 scope target/source OID의 merge-base를 구하고 양측 `--diff-filter=A --name-only -z --no-renames` exact path intersection을 계산한다.
6. live target recheck 뒤 `effects.merge` 직전에 overlap 또는 merge-base/diff 실패를 fail-closed로 차단한다. `force-clean-only`는 merge-only gate를 건너뛴다.
7. reason/details를 갱신하고 conflict paths와 OID를 deterministic하게 노출한다. 기존 strict audit evidence/APPROVE-family/target drift 검사가 먼저이며 M/M recovery를 가리지 않는다.
8. real-git fixture에서 project-root HEAD를 제3 branch에 두고 explicit detected base를 다른 branch로 전달해 behind가 **전달 base** 기준임을 증명한다. 별도로 base 생략 attached fallback과 detached/unresolvable unknown을 검사한다.

**Acceptance**

- HEAD≠detected-base real-git case가 전달 base의 ref/tip을 state/output에 남기며 current HEAD를 측정하지 않는다. explicit resolvable ref와 explicit-unresolvable(no fallback)이 각각 증명된다.
- explicit/legacy-attached/legacy-unknown authority 경로가 결정적으로 구분되고 모든 unknown은 audit만 non-blocking이다.
- disjoint A/A는 land되고 동일 A/A·rename destination은 merge 전 차단되며 newline/space path와 git 실패가 손실되지 않는다.
- REJECT/terminal/target drift는 base gate 전에 거부되고 외부 base 설정·새 storage는 없다.

**AC:** AC-3, AC-4, AC-9, AC-10

### PR-4 — 측정 위생·AC 사전 차단·multi-lens AWC 계약

**대상**

- `skills/craft/SKILL.md:63-111`
- `skills/post-craft/SKILL.md` §3.2/§4.2/§5/§6.1 및 audit template/finalization
- `skills/pre-craft/SKILL.md:190-211,255-281`
- `agents/lsc-auditor.md:70-136,154-201`
- `agents/lsc-explore.md:71-91`, `agents/lsc-test-engineer.md:89-109`의 현행 output vocabulary(정규화 입력; agent별 새 PASS literal은 추가하지 않음)
- `README.md:104,169-174,229`
- `test/skill-contract.test.ts`

**변경**

1. craft contract에 post-craft-authored `check/run_check.sh`가 존재하는 모든 audit-driven fix re-entry의 yield 전 fresh `lsc_run_check` green 의무를 넣고 initial craft에는 아직 script가 없다는 경계를 명시한다. 정정된 spec Goal (C)에 따라 `[Craft Complete]`는 executor complete+fresh green일 때만 가능하고 red/미실행 상태로는 금지되며, red는 실제 red evidence를 동반한 `[Craft Incomplete]`로만 반환한다. 동일 문언과 판정식을 `skills/post-craft/SKILL.md`의 audit-driven craft handoff/§6.1에 exact mirror하여 fresh green 없는 `[Craft Complete]`를 post-craft가 audit 재진입 신호로 수용하지 않게 한다.
2. 실제 tool 결과를 attribution 전 다음 discriminated union으로 분류하고 craft/post-craft mirror가 같은 필드 존재 규칙을 쓴다.

```ts
type CheckEvidence =
  | { state: "green"; details: RunCheckDetails & { passed: true }; logPath: string }
  | {
      state: "executed-red";
      details: RunCheckDetails & { passed: false };
      logPath: string;
      repairHint: "implementation" | "test-check" | "unknown";
    }
  | {
      state: "infrastructure";
      diagnostic: string;
      logPath?: string; // tool이 이 실패에서도 실제 log를 생성한 경우에만
      repairHint?: never;
    };
```

`details.passed===true`만 `green`, well-formed details의 `passed===false`(nonzero/killed 포함)만 `executed-red`다. details 없는 `isError`, invalid/missing details, target refusal·exec exception·empty transcript, tool unregistered/unavailable는 `infrastructure`다. green/executed-red의 `details`와 tool-created `logPath`는 필수다. infrastructure는 raw `diagnostic`을 보존하고 tool이 실제 생성한 log가 있을 때만 `logPath`를 싣고, synthetic path나 `repairHint`를 만들지 않는다.
3. `executed-red`의 attribution은 defect-owner authority가 아니라 **parent craft 오케스트레이터의 best-effort `repairHint`**다. current OID에서 방금 생성된 check log/transcript와 prior Required Fix target/remediation만 대조하고 prior OID의 §3.0 test-authoring report는 입력에서 제거한다. `RunCheckDetails`에는 per-step command identity가 없으므로 exact failing command는 script/log에서 단일하게 식별될 때만 best-effort evidence로 쓰며 multi-command 모호성·path/category 누락은 `unknown`으로 닫는다. 이 record는 current implementation OID와 required `details`/`logPath`/관측 근거/`repairHint`를 남기되 다음 cycle의 authority로 재사용하지 않는다.
   - `implementation`: prior fix가 production path/behavior를 target하고 fresh failure evidence가 같은 target의 즉시 수리 가능한 불일치를 직접 식별하며 `test-check` 신호가 하나도 없을 때만 허용한다.
   - `test-check`: prior fix가 test/check를 직접 target하거나 fresh log가 check entrypoint/load/compile/collection/path artifact 자체의 결함을 직접 식별할 때 쓰는 진단 hint다. craft가 이 artifact를 수리하지 않고 `CYCLE-RETURN`한다.
   - `unknown`: path 미추출, mixed signal, evidence 누락/충돌, assertion이 test defect인지 production defect인지 결정하지 못한 모든 경우다. production repair를 허용하지 않고 `CYCLE-RETURN`한다.
4. `[Craft Complete]`는 **executor가 complete이고 integrated root의 fresh check evidence가 green인 conjunction**만 허용한다. executor success보다 executed-red/infrastructure가 우선하고 green은 executor incomplete를 덮지 않는다. parent invocation의 단일 boolean `retryUsed`는 executor failure와 immediately-repairable implementation red가 공유한다. 아래 표는 union branch별로만 전개한 도달 가능한 **20 cases(green 4 + executed-red 12 + infrastructure 4)**이며 green/infrastructure에 hint 축을 곱하지 않는다.

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

정정된 spec Goal (C) 기준에서 `CYCLE-RETURN`은 red 상태의 완료 선언이 아니라 branch-appropriate evidence를 담은 `[Craft Incomplete]` 종료다. executed-red는 required `details`/`logPath`/`repairHint`, infrastructure는 `diagnostic`과 실제 생성된 경우의 optional `logPath`만 보존한다.

5. `EXEC-RETRY`/`IMPL-RETRY`만 기존 사용자 one-shot selector를 연다. 승인되면 spawn 직전에 `retryUsed=true`로 바꾸고 serial/parallel 최종 commit이 모인 integrated `{worktreeAbs}`에서 단일 production repair `lsc-executor`를 실행한다. `executor=incomplete`에서 `IMPL-RETRY`로 온 assignment는 repairHint가 특정한 defect뿐 아니라 원 executor가 남긴 미완 잔여도 함께 포함하며 둘 모두 완료해야 complete로 판정한다. 거절/취소는 `retry-declined`/`retry-cancelled`다. repair executor가 incomplete·unheard이거나 commit을 만들지 못하면 `repair-incomplete`로 종료한다. complete+commit이면 새 OID에서 check를 정확히 한 번 재실행해 executor=`complete`, `retryUsed=true`로 표에 재진입하며, post-repair red는 두 번째 production retry를 열지 않고 표의 hint별 `CYCLE-RETURN` reason으로 끝난다. 삭제된 parallel lane은 재소환하지 않고 lane별 token/executor를 만들지 않는다.
6. craft와 post-craft audit-driven handoff/§6.1은 action, exact incomplete reason, `CheckEvidence` 필드 존재 규칙을 동일하게 mirror한다. 사용자 거절/취소는 `reason=retry-declined|retry-cancelled`, green+executor incomplete에서 token 소진은 `reason=retry-exhausted`, **`reason=re-red`는 `retryUsed=true` 상태의 `implementation`-hint executed-red**, repair incomplete/unheard/no-commit은 `reason=repair-incomplete`, `test-check` hint는 `reason=test-check-red`, `unknown` hint는 `reason=red-attribution-unknown`, infrastructure는 `reason=check-infrastructure`다. 각 `[Craft Incomplete]`는 executor/current OID/manual next step과 실제 union branch evidence만 포함한다: green/executed-red는 required `details`/`logPath`, executed-red만 `repairHint`, infrastructure는 `diagnostic`+실제 생성된 경우의 optional `logPath`이며 repairHint는 금지한다.
   - `CYCLE-RETURN`은 `[Craft Complete]`로 위장한 same-cycle 재진입을 금지한다. executed-red는 정정된 spec Goal (C)이 허용한 required red evidence 동반 `[Craft Incomplete]`, infrastructure는 raw `diagnostic`과 실제 생성된 optional `logPath`만 가진 `[Craft Incomplete]`로 종료한 뒤 **사용자 또는 오케스트레이션이 feature dir로 정상 새 post-craft를 호출하는 canonical continuation**을 요구한다.
   - 정상 post-craft는 기존 entry 그대로 `lsc_audit_begin`을 호출해 다음 audit cycle 하나를 소비한 뒤 current OID에서 §3.0 test를 재저작·수리·재평가하고 check/audit을 계속한다. test/check가 고쳐져 green이면 complete 경로로, 건강한 test가 production red를 유지하면 audit Required Fix→craft 경로로 간다. `unknown`/test-check/infrastructure에 fresh green을 선행 의무로 걸지 않는다.
   - 각 return이 다음 audit cycle 하나를 비용으로 쓰므로 persisted `auditCycle`과 live 3/fixture 2 periodic escalation이 반복을 바운딩한다. due cycle에서는 explicit Continue 없이는 새 cycle을 발행하지 않고 Abort/Preserve가 종결한다. prior report를 재사용하거나 handoff state를 resume하지 않으므로 §3.0-only entry mode, durable handoff envelope, resume token, second-stage executor table은 만들지 않으며 crash retry는 기존 same-cycle begin replay 규칙을 따른다.
7. post-craft audit template은 기존 Header→canonical verdict line을 유지하고 그 뒤 `Expected State`와 `Base Drift` evidence를 추가한다. Expected State는 requirement 좌표, 기대 observable/boundary/error state, 검증법을 담는다.
8. auditor가 spec/plan만 읽은 상태에서 Expected State와 requirement `file:line`을 먼저 고정한 뒤 diff/code를 열게 한다. finding은 `Required by`와 implementation evidence를 각각 직접 재독해 실증한다. pre-craft Stage 2는 모든 AC에 `결정적 | 하이브리드 | live-전용` class를 요구하고 live-전용에는 proxy 증명의무/비증명/잔여 불확실성 완결 gate를 둔다.
9. post-craft §3.2 synthesis, §4.2 verdict, §5 Required Fix, §6.1 craft re-entry가 아래 정규형을 verbatim 공유한다. category string은 금지하고 `originReviewer`/각 ownerRef는 structural equality로 식별한다.

```ts
type NonEmpty<T> = readonly [T, ...T[]];
type ReviewerRef =
  | { kind: "auditor"; lens: "spec" | "plan" | "regression" | "infra" }
  | { kind: "explore"; probe: string; scope: NonEmpty<string>; successCriterion: string }
  | { kind: "post-craft-main"; procedure: string; successCriterion: string }
  | { kind: "test-authoring"; obligation: string; testPaths: NonEmpty<string> }
  | { kind: "deterministic-check"; checkIdentity: { command: string; cwd: string; successCriterion: string } };
interface RequiredFixItem {
  itemId: string;
  originReviewer: ReviewerRef;
  verificationOwners: NonEmpty<ReviewerRef>;
  fixCompleteness: "apply-only" | "needs-redesign";
  // classification/severity, requirement/implementation coordinates, exact remediation
}
interface VerificationResult {
  itemId: string;
  ownerRef: ReviewerRef;
  implementationOid: string;
  auditCycle: number;
  status: "PASS" | "FAIL";
  evidence: NonEmpty<string>;
}
```

**Bundle relational invariants:** `itemId`와 모든 `ReviewerRef`/evidence 자유 문자열은 trim 후 non-blank이고, `itemId`는 bundle 안에서 unique다. 각 `verificationOwners`는 structural-unique이며 해당 item의 `originReviewer`를 정확히 한 번 포함한다. 기대 pair set은 모든 `(itemId, verificationOwner)`의 Cartesian set이고, `VerificationResult`의 `(itemId, ownerRef)` pair set은 기대 set과 exact equality여야 한다. duplicate·extra·missing pair, blank payload/evidence는 shortcut 전에 REJECT한다.

각 expected result의 `implementationOid`와 `auditCycle`은 shortcut 대상 current implementation OID/current audit cycle과 exact 일치해야 한다. 각 owner는 자신이 실제 관측한 OID/cycle을 이 필드에 기록하며, 이 결합 범위는 **그 한 audit cycle의 Required Fix closure**로 한정된다. 값 누락·stale OID·다른 cycle은 evidence 산문으로 보정하지 않고 mismatched result로 처리하고, craft red attribution이나 cross-cycle §3.0 report 재사용에는 이 binding을 적용하지 않는다.

**§5 owner execution routing (authority).** Fix-verification 시작 시 prior Required Fix bundle의 모든 `verificationOwners`를 structural equality로 dedupe한 union을 만든 뒤, 결과를 합성하기 전에 전부 다음과 같이 route한다. `auditor`는 exact lens마다 `lsc-auditor` 1개, `explore`는 exact `{probe,scope,successCriterion}`마다 `lsc-explore` 1개를 같은 review batch에서 실행한다(수정 path가 test/check인지와 무관). `test-authoring`은 §3.0의 단일 `lsc-test-engineer` assignment에 item별 `{obligation,testPaths}` 전부를 전달하고, `deterministic-check`는 §3.1에서 실제 실행한 canonical `{command,cwd,successCriterion}`과 structural-equal한 ref만 그 결과에 결합하며, `post-craft-main`은 main이 각 `{procedure,successCriterion}`을 직접 수행한다. §3.0 변경을 commit한 뒤 current implementation OID를 freeze하고, 각 route의 관측 bytes/OID와 audit cycle이 그 freeze와 일치할 때만 `VerificationResult`를 정규화한다. unsupported ref, route 누락, 무응답, OID/cycle mismatch는 result를 합성하거나 다른 owner에게 재배정하지 않고 shortcut 전에 REJECT한다. 기존 §5의 “single lsc-auditor” 및 “tests/check를 touch한 경우에만 explore” 규칙은 이 routing으로 교체하며 unrelated owner/lens는 추가하지 않는다.

Contract proof는 (a) two-auditor-lens + production-origin explore + test-authoring + deterministic-check + main bundle이 각 exact route/result를 한 번씩 생성하는 positive, (b) production-origin explore를 current path 조건으로 누락한 경우, auditor lens 하나를 single-lens로 축약한 경우, unsupported ref, duplicate route, OID/cycle mismatch가 REJECT인 negative를 추가한다.

10. post-craft main이 현행 agent output을 OID/cycle-bound `VerificationResult`로 정규화하고 agent가 임의 literal PASS를 발명하지 않는다.

| owner kind | `PASS` 정규화 | `FAIL` 정규화 |
|---|---|---|
| `auditor` | 동일 OID/cycle/exact lens의 `APPROVE` 또는 `APPROVE-WITH-COMMENT`이고 해당 criterion에 blocking finding 없음 | `APPROVE-WITH-CHANGE`, `REJECT`, inconclusive/OID·lens mismatch |
| `explore` | 동일 probe/scope 보고서의 cited evidence가 binary `successCriterion`을 전부 충족 | contradiction·unknown·scope 누락·criterion 미충족·무응답 |
| `post-craft-main` | 인용된 procedure를 현재 OID에서 전부 수행해 criterion별 관측 evidence 기록 | 단계 누락·오류·inconclusive·evidence 없음 |
| `test-authoring` | listed test paths가 obligation을 방어하고 현행 `Test Health: HEALTHY`와 fresh command `0 failed`를 함께 보고 | `NEEDS ATTENTION`/`CRITICAL`, path/obligation 누락, 미실행·실패 |
| `deterministic-check` | exact command/cwd identity를 현재 integrated OID에서 실행해 success criterion과 `details.passed===true` 충족 | 다른/stale identity, `passed===false`, killed, infrastructure/inconclusive |

11. §4.2 verdict는 다음 precedence 문단을 §3.2/§5/§6.1과 exact 의미로 공유한다.

§4.2는 raw owner report와 surviving finding을 현행 four-level correspondence로 다시 분류한다. 새 CRITICAL, broad/severe finding, `needs-redesign`, unheard/unroutable/mismatched/inconclusive owner는 REJECT다. `owner FAIL` 또는 새 MAJOR라는 사실만으로 REJECT하지 않는다. surviving blocking finding이 모두 concrete `apply-only` remediation과 complete owner set을 가지면 APPROVE-WITH-CHANGE, 하나라도 scoped prescription으로 닫히지 않으면 REJECT다. 모든 expected owner가 current-OID PASS이고 새 blocking finding이 없을 때만 fix-verification shortcut이 APPROVE/APPROVE-WITH-COMMENT로 닫힌다. 새 MINOR는 non-blocking evidence로 남긴다.
12. `No cycle cap`을 PR-1 symbols 기반 periodic escalation로 교체하고 TS 조립 질문/free-answer/cancellation/세 labels/Abort 위임/Preserve stop을 §2.6/finalization에 연결한다.
13. README의 active-only abort 설명을 optional exact-root caller까지 갱신하고 post-craft 개요에 periodic escalation, base authority handoff, corrected-Goal-(C)-compliant canonical red cycle return, multi-source concrete-owner Required Fix bundle을 반영한다. heading-bounded contract tests는 craft/post-craft green 및 여덟 incomplete reason을 독립 검사하고, 동일한 discriminated evidence field rules, 도달 가능한 20-case product table, infrastructure의 `repairHint` 부재·실제 생성되지 않은 `logPath` 부재 negative fixtures, global token/integrated repair·정상 post-craft continuation(§3.0-only mode/envelope 및 forced-green 금지), bundle relational invariant/current-audit OID-cycle binding/normalizer/four-level precedence를 §3.2/§4.2/§5/§6.1 각각에 고정한다. four-level verdict, any-CRITICAL veto, audit literal parser는 유지한다.

**Acceptance**

- craft와 post-craft의 독립 heading 모두 정정된 spec Goal (C)의 동일 계약을 가진다: post-craft-authored check가 존재하는 audit-driven re-entry에서 `[Craft Complete]`는 executor-complete+fresh green일 때만 허용하고, red/미실행은 완료 선언 금지, executed-red는 실제 `details`/`logPath`/`repairHint`를 동반한 `[Craft Incomplete]`로만 반환한다.
- `green {details,logPath}` / `executed-red {details,logPath,repairHint}` / `infrastructure {diagnostic,logPath?; repairHint 금지}`와 도달 가능한 20 cases가 heading-bounded tests에 고정된다. infrastructure `logPath`는 tool이 실제 생성했을 때만 허용하며 fabricated log/hint negative fixture가 있다.
- retry 거절·취소·소진·`retryUsed=true` implementation-hint re-red·repair-incomplete·test-check-red·red-attribution-unknown·infrastructure는 mirror된 exact reason/branch evidence/manual next step으로 incomplete 종료한다. `executor=incomplete`의 IMPL-RETRY repair assignment는 원 executor 미완 잔여까지 포함하고, 모든 불확실·test-check·post-repair red/infrastructure는 forced green이나 §3.0-only handoff 없이 정상 새 post-craft cycle로 돌아가 current OID §3.0→check→audit에서 재판별된다.
- Expected State, 양쪽 citation, AC class/proxy gate가 owner 문서와 contract test에서 관측된다.
- auditor/non-lens mixed bundle은 `originReviewer`가 owners에 정확히 한 번 포함되고 unique non-blank item/owner와 exact expected-result pair set, current-audit `implementationOid`/`auditCycle`을 만족해야 한다. 각 result는 owner의 실제 관측 OID/cycle만 기록하고 cross-cycle report attribution에는 재사용하지 않는다. `partial original apply-only → AWC`, `new unrelated apply-only MAJOR → AWC` positive와 `origin omitted`, `duplicate itemId`, `duplicate owner`, `extra result`, `blank criterion/evidence`, `owner inconclusive`, `new needs-redesign MAJOR`, `new CRITICAL` negative fixtures를 고정한다.
- README와 SKILL에 독립 cap 숫자 별칭이 없고 TS symbols 및 새 API/운영 흐름이 일치한다.

**AC:** AC-1, AC-5, AC-6, AC-7

### PR-5 — Fixture cap-2 escalation·red cycle continuation E2E와 전체 회귀

**대상**

- `fixtures/sample-ts-cli/answers.json:4-60`
- `test/fixtures.test.ts:418-466,600-679,776-931`
- `test/e2e-helpers.ts:161-180,223-253,282-334`
- 신규 `test/e2e-audit-escalation.test.ts`
- 신규 `test/e2e-red-cycle-continuation.test.ts`
- `package.json`의 `e2e` script와 기존 `test/e2e-full-cycle.test.ts:102-375` 회귀
- `README.md:239-253`의 공개 E2E command, file count, suite 설명
- `src/fixtures.ts:104-129,214-279,304-327`는 검증 후 의도적 무변경

**변경**

1. generic confirmation보다 앞에 anchored `[Audit Escalation]` selection rule을 두고 세 exact label의 `User selected:` CONTENT를 fixture unit test로 고정한다.
2. E2E helper에 branch별 external answers, state/OID snapshot, old-format-compatible audit seed와 red-continuation early-exit probe를 추가한다.
3. 세 throwaway project의 실제 fixture post-craft subprocess에서 candidate 2를 연다. Continue는 **두 번째 lsc_audit_begin 호출(전체 호출 2개)의 success; 첫 호출은 isError, success count는 1**이고 durable Continue/next-due state가 관측되는 즉시 기존 `earlyExit` seam으로 종료해 full audit 진입을 기다리지 않고 trace/state를 보존한다. `earlyExit` predicate는 `total executions=2 ∧ last.isError=false`로 고정한다. Abort/Preserve는 terminal·audit/land/cleanup 부재와 branch/worktree 존치를 단언한다.
4. Abort E2E의 `aborted=true`는 SKILL이 기존 abort 도구로 위임했다는 orchestration 준수 증거이며, 안전 속성 자체는 terminal disposition에 대한 TS begin/land tests가 증명한다고 구분한다.
5. red continuation suite는 audit OID A의 Required Fix로 craft를 호출해 executor commit B(`B !== A`)를 만든 뒤 command/path owner를 특정할 수 없는 deterministic multi-command fresh check red를 유도한다. 첫 process가 current B와 `executed-red {details,logPath,repairHint:"unknown"}` evidence 및 exact `reason=red-attribution-unknown`의 `[Craft Incomplete]`로 끝나고 별도 §3.0 mode/envelope를 만들지 않음을 확인한다. 이어 같은 feature dir에 환경변수 `LSC_FIXTURE`로 **정상 post-craft process**를 호출해 `lsc_audit_begin`이 다음 cycle을 발행하게 한다. 여기서 “B 관측”은 exact HEAD equality가 아니라 **§3.0이 B production snapshot을 입력으로 읽었고 이후 test/check commit OID에서 실행**했음을 뜻하며, 이를 input snapshot/실행 OID evidence로 단언한다. A report를 B attribution으로 요구하거나 §3.0이 무조건 green을 만들었다고 단언하지 않는다.
6. `--lsc-fixtures`는 interactive-only alias이며 위 separate-process continuation과 chaining suppression은 `LSC_FIXTURE`만 사용한다. 두 신규 suite를 `package.json`의 표준 `npm run e2e` 파일 목록에 추가하고, `README.md:239-253`의 exact E2E command·“2개 파일” count·suite 설명을 기존 2개+신규 2개인 **4-file** 표준 회귀로 갱신한다.
7. process-local `once` 공유를 가정하지 않는다. fixture cycle 4 재발동은 PR-1/2 unit에서만 고정하고 신규 suites 뒤 기존 full-cycle E2E와 전체 vitest/build를 실행한다.

**Acceptance**

- fixture cap 2에서 세 labels가 각각 실제 selection gate를 통과한다.
- seeded REJECT 0/1 뒤 cap 미소비 state는 cycle 1이며 선택별 durable state/branch/worktree 결과가 일치한다.
- Continue subprocess는 두 번째 begin/state 증거 뒤 일찍 끝나 gate trace를 잃지 않고, Abort assertion의 orchestration/TS-safety 역할이 구분된다.
- red continuation은 A→B commit, B fresh red `[Craft Incomplete]`, 별도 정상 post-craft의 next-cycle begin을 실제 subprocess 경계에서 증명한다. B 관측은 exact HEAD B가 아니라 §3.0의 B production snapshot 입력과 이후 test/check commit OID 실행으로 단언한다. escalation은 destructive tag/merge 권한을 만들지 않고 generic confirmation으로 우회되지 않으며 두 신규 suite는 targeted command와 `npm run e2e` 양쪽에 배선되고 README의 command/file count/suite 설명도 4-file 목록과 일치한다.

**AC:** AC-1, AC-2, AC-3, AC-4, AC-8, AC-9, AC-10

## AC Coverage Matrix

| AC | 상태 | 구현 TODO | 결정적 증거 |
|---|---|---|---|
| **AC-1 사이클 상한** | **Met** | PR-1 persisted interval/정규 policy+(i) candidate marker 결합, PR-2 env+flag 주입, PR-4 orchestration, PR-5 fixture | live 3→6·fixture 2→4 positive; legacy 15→18; `candidate<auditCycle` backward/`candidate>auditCycle+1` forward gap reject; latest completed 1개 삭제 equality replay 허용; same-cycle threshold/base byte-stability; cap-2 세 처분 E2E |
| **AC-2 처분 기록** | **Met** | PR-1 record-local provenance+(a)~(i), PR-2 atomic transition, PR-5 branches | invariant별 corrupt fixture, self-consistent future-due chain reject, same-key conflict·different-due coexistence, terminal mirror/후속 begin 거부 |
| **AC-3 fail-closed 불변** | **Met** | PR-2 terminal land guard, PR-3 strict gate order, PR-5 | existing REJECT regression + terminal/nonce 우회 negative tests |
| **AC-4 base drift** | **Met** | PR-3 pre-begin detected-base handoff, WARN/state, land path gate, PR-4 template | HEAD≠base, explicit resolved/unresolvable(no fallback), legacy fallback/unknown, A/A overlap pre-merge reject |
| **AC-5 측정 위생 산문** | **Met** | PR-4 corrected spec Goal (C) craft Handoff + post-craft exact mirror/정상 re-entry/§3.0/§6.1 + auditor/template | post-craft-authored check가 존재하는 audit-driven re-entry에서 `[Craft Complete]` iff executor-complete+fresh green; red/미실행 완료 선언 금지; green/executed-red/infrastructure discriminated evidence와 20-case transition; executed-red evidence `[Craft Incomplete]`→current-OID 새 audit cycle; fabricated infrastructure log/hint 금지 |
| **AC-6 검증 불가 AC 게이트** | **Met** | PR-4 pre-craft Stage 2 | AC class 전수 + live-only proxy proof/non-proof/residual uncertainty 없으면 incomplete contract test |
| **AC-7 다중-lens AWC** | **Met** | PR-4 §3.2/§4.2/§5/§6.1 공통 concrete provenance | origin 포함·item/owner unique·exact pair set, explicit OID/cycle, partial/new apply-only→AWC와 needs-redesign/CRITICAL→REJECT fixtures |
| **AC-8 E2E** | **Met** | PR-5 fixture rule/helper/두 신규 suite+`package.json`/README 4-file 표준 회귀 | deterministic REJECT 0/1→fixture cycle 2→세 처분 subprocess; audit A→craft B red→정상 post-craft next-cycle, §3.0의 B production snapshot 입력+후속 test/check commit OID 실행; targeted suites와 `npm run e2e`/README 배선 |
| **AC-9 단위** | **Met** | PR-1~PR-3 TS tests, PR-4 contract, PR-5 matcher/state | (a)~(i), bounded backward/forward gap+equality replay, flag-only/mode-switch, union별 4+12+4 product/canonical cycle return, infrastructure no-hint/optional-actual-log negative fixture, bundle relation·four-level positive/negative 경계 |
| **AC-10 하위 호환** | **Met** | PR-1 optional v2 top-level fields/required fields only inside new records, PR-2/3 optional args/additive details | field-less cycle-14 caller/state, attached fallback, interval round-trip, future-version reject, old parser 무회귀 |

이 표의 `Met`는 **계획 artifact가 exact seam과 실패 가능한 proof를 모두 배정했다는 뜻**이며 구현/test 실행 완료 주장이 아니다. iteration 5 critic Major #1은 spec Goal (C)의 Amendment가 red 상태의 완료 선언 금지와 red evidence 동반 `[Craft Incomplete]` 반환을 canon으로 정정해 CYCLE-RETURN과의 충돌을 해소했다. iteration 6은 잔여 Major #2의 실제 tool-shape evidence union, 두 MINOR와 두 scored Open Question 결정을 반영했으며, 실제 결과는 craft/post-craft 검증에서 판정한다.

## Success Criteria

1. normal/overdue gate가 cycle을 선소비하지 않고 live 3→6과 fixture 2→4에서 prior Continue history와 새 pending을 정상 공존·소비하며 candidate replay/rewind/gap이 marker를 바꾸지 못한다.
2. record-local interval과 (a)~(i)를 만족한 ledger만 atomic하게 진행하며 same-key conflict/stale/mode-switch/future-due chain/corruption은 자동 보정 없이 차단된다.
3. REJECT/terminal은 selection·nonce·base state와 무관하게 land되지 않는다.
4. detected land base가 audit authority이고 HEAD≠base, explicit unresolvable, legacy fallback/unknown 및 exact added-path failure가 테스트된다.
5. re-entry는 executor-complete+green만 complete하며 red/미실행의 완료 선언을 금지한다. `green {details,logPath}` / `executed-red {details,logPath,repairHint}` / `infrastructure {diagnostic,logPath?; repairHint 금지}`의 도달 가능한 20-case table을 닫고, 즉시 수리 가능한 implementation만 one-shot retry하며 나머지 red/infrastructure는 branch evidence를 가진 `[Craft Incomplete]`→정상 새 post-craft cycle→current-OID §3.0/check/audit로 이어진다.
6. 모든 auditor/non-lens item은 origin을 정확히 한 번 포함한 unique owner set, unique non-blank item, exact result pair, **그 current audit cycle에서 각 owner가 관측한** OID/cycle를 가지며 현행 four-level mapping이 partial/new apply-only는 AWC로, needs-redesign/CRITICAL은 REJECT로 분류한다.
7. Expected State/citations/AC class와 audit literals, v2 state, legacy callers가 하위 호환된다.
8. appendix 순서의 targeted test/build/fixture E2E/full E2E가 실제 exit/test count와 함께 green이고 cap escalation·A→B red cycle continuation 두 신규 suite가 표준 `npm run e2e`와 README 4-file command/count/설명에 포함된다. continuation은 §3.0의 B production snapshot 입력과 후속 test/check commit OID 실행을 구분해 증명한다.

## Open Questions

**구현을 막는 미해결 질문은 없다. 다음 다섯 항목은 확정 결정 또는 의도적인 범위 선언이다.**

- direct `lsc_land`의 `APPROVE-WITH-CHANGE` land-eligible 현행 동작은 확정 spec의 APPROVE-family 불변에 따라 유지하며, owner verification은 post-craft orchestration-only이고 이 iteration에서 TS verdict gate를 넓히지 않는다.
- optional `base_branch`는 local branch에 한정하지 않고 commit으로 resolve되는 git revision expression을 받되 production post-craft는 detected local land-target branch를 넘긴다. resolve는 argv 형태 `git rev-parse --verify --end-of-options <expr>^{commit}`으로 고정해 leading `-`를 option으로 해석하지 않는다. audit snapshot ref/OID는 관측 evidence이고 direct land target을 묶는 TS invariant가 아니며 normal orchestration만 같은 detected ref를 audit와 eventual land에 재사용한다.
- `--lsc-fixtures`는 interactive invocation의 bonus alias일 뿐 craft/post-craft separate-process chaining suppression authority가 아니며, E2E subprocess는 환경변수 `LSC_FIXTURE`를 사용한다.
- `VerificationResult.implementationOid`와 `.auditCycle`은 필수 explicit field이고 각 owner가 실제 관측한 current audit cycle 안에서만 결합한다. non-empty evidence로 stale result를 추론하거나 craft red의 cross-OID report attribution에 재사용하지 않으며 current shortcut mismatch는 결정적으로 거부한다.
- red report identity는 옵션 (c)로 확정한다. prior §3.0 report attribution과 §3.0-only handoff를 없애고 normal post-craft cycle이 current OID에서 evidence를 다시 만들므로 별도 durable authority/envelope/freshness/invalidation/second-stage 표는 필요하지 않다.

범위 밖 후속 후보(병렬 auditor 집계, 인용 기계화, capture-recapture, 대상 프로젝트 회생, open-ended commit-first)는 기존 `.lsc/crafts/postcraft-14cycle-approval-failure/open-questions.md`에 유지한다.

## Review Status

| Lane | 상태 |
|---|---|
| Plan artifact | Iteration 6 확정 — iteration 5 지적 전건 폐쇄(critic 확인) + iteration 6 critic AWC 동봉 Fix 3건(§5 owner execution routing/Contract proof, Continue E2E 2-calls/1-success predicate, [Craft Complete] qualifier 3곳) verbatim 적용 |
| Architect | iteration 6 `**ARCHITECT VERDICT: NOT-BLOCKING**` @ sha256 51b917d0…97c7 — spec Amendment 정합·evidence union 도달가능성 전수·iteration 5 전건 폐쇄 실증, Change Spec 없음 |
| Critic | iteration 6 `**VERDICT: APPROVE-WITH-CHANGE**` @ sha256 51b917d0…97c7 (plan-only lane) — MAJOR 1(apply-only)·MINOR 2 전건 동봉 Fix로 폐쇄 |
| Join gate | 통과 — 3-way digest 일치(배정=양 레인 echo=신선 재계산), 양 레인 iteration 6 echo |
| Consensus | **도달 — AWC 경로** (item 5): Fix verbatim 적용 → 단일 lsc-critic-recheck 3중 기계 체크 `RECHECK: PASS` (diff 9 hunk 전건 fix 귀속·file:line 재검증·AC-5/7/8 parity 무손상). 원장: plan/plan-{1..6}.md |
