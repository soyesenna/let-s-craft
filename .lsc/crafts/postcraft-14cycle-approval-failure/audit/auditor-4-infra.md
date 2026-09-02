**AUDITOR VERDICT: APPROVE-WITH-CHANGE**
Reviewed: postcraft-14cycle-approval-failure @ a1af63b2bfda95b182a8717e3acd8783920c16f6 · audit cycle 4 · lens 인프라·설정

## Lens

lens ④ 인프라·설정 — fix delta 전체를 E2E harness wiring, stage budget, host session-file reader, plugin-link env isolation, check entrypoint/package script 정합성 관점에서 감사했다.

Priority falsification question:

> "check-7's continuation red (:284 `agent=lsc-test-engineer delivered=false`) and check-8's full-cycle red (:339 `post-craft timed out`, 50-min budget) are NOT defects of the implementation under audit — they are defects that the RF-35 prescription itself introduced or left in the harness."

## Expected State

아래 기대 상태는 `spec.md`·`plan.md`와 prior Required Fix만 읽은 뒤, fix delta와 구현 코드를 열기 전에 고정했다.

| 대상 | Required coordinates | 기대 observable / boundary / error state | 검증 방법 |
|---|---|---|---|
| RF-30 | `.lsc/crafts/postcraft-14cycle-approval-failure/audit/audit-3.md:279` | persisted identity의 `projectRoot`·`worktreeRoot`에 DEL이 들어가도 raw DEL은 model-facing text에 0회, escaped `\\u007f`는 존재하고, exec/log write는 0회여야 한다. | production execute seam과 captured wrapper table을 직접 대조한다. |
| RF-31 | `audit/audit-3.md:280` | real `omp plugin link` child가 `HOME`과 XDG data/state/cache 전부를 temp tree로 사용하고 profile/config/agent-dir redirect를 상속하지 않아야 한다. 실제 사용자 `~/.omp`와 활성 `$XDG_DATA_HOME/omp` plugin write surfaces는 before/after byte-equivalent여야 한다. | child env 구성, 설치된 `pi-utils/src/dirs.ts`, 두 사용자 경로 snapshot을 직접 대조한다. |
| RF-33 | `audit/audit-3.md:282` | optional `session_init.agent`에 의존하지 않고 parent session의 marker-bound `task` args가 requested agent의 authority여야 한다. flat/batch task 형태를 모두 처리하고, raw session-init shape와 parent task args가 실패 진단에 남아야 한다. | 설치 host schema, durable JSONL parser, preset assertion chain, check-7/8 결과를 대조한다. |
| RF-35(a) | `audit/audit-3.md:284` | continuation 종료 후 durable parent JSONL에서 exact `lsc-test-engineer`·feature·cycle·execution OID와 successful result를 하나의 관측으로 결합해야 한다. Stream truncation이나 early kill이 실제 수행을 omission으로 바꾸어 보고해서는 안 된다. | stream event 발생 시점과 durable toolResult 기록 순서, early-exit/kill 순서, check-7/8 reds를 대조한다. |
| RF-35(b) | `audit/audit-3.md:284` | post-craft timeout은 마지막 durable activity, task completion/in-flight 상태, 단계 marker를 진실하게 남겨야 한다. Stage budget은 measured green과 post-craft가 허용하는 한 번의 re-spawn/wait를 포함해야 한다. | timeout builder, stage constants, package/Vitest timeout precedence, check-4/7/8 timestamps를 산술 검증한다. |
| 전체 E2E | `spec.md:95`; `plan.md:452` | 신규 escalation/continuation E2E뿐 아니라 기존 E2E 전체가 green이어야 하며, standard `npm run e2e`와 check entrypoint가 실제 동일한 네 파일을 실행해야 한다. | `package.json`, `check/run_check.sh`, deterministic logs를 대조한다. |

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

### 결론

질문의 핵심 주장은 **확인됐다**. check-7 continuation red와 check-8 full-cycle red는 feature production implementation 결함을 입증하지 않는다. 둘 다 RF-35가 새로 도입했거나 불완전하게 남긴 harness 결함이다. check-7 pre-craft red 역시 production 결함이 아니라 기존 stage-budget/observability 결함이다.

### 1. Continuation: 이 host에서 `task`의 stream end는 spawn ack가 아니라 subagent completion이다

- 모든 `runOmpPrint` 호출은 `async.enabled: false` overlay를 주입한다 (`test/e2e-helpers.ts:135-163,342-343`). 따라서 이 E2E에서 `task`는 background spawn ack를 즉시 반환하는 경로가 아니라 sync fallback을 탄다.
- 설치된 host의 `TaskTool.execute`는 sync fallback에서 `await this.#executeSyncFanout(...)` 뒤에 반환한다 (`@oh-my-pi/pi-coding-agent/src/task/index.ts:733-783`). 그러므로 이 구성의 `tool_execution_end(toolName="task")`는 subagent가 끝난 뒤 발생한다.
- 그러나 host agent loop는 `tool_execution_end`를 먼저 stream에 push하고, 그 뒤에야 `toolResult` message를 만들고 `message_start`/`message_end`를 push한다 (`@oh-my-pi/pi-agent-core/src/agent-loop.ts:2468-2494`). Stream completion event와 durable session-file toolResult는 같은 관측이 아니다.
- Harness는 completion event가 보이고 commit이 landed되면 1,200ms drain 후 process를 `SIGKILL`한다 (`test/e2e-helpers.ts:265-294`; `test/e2e-red-cycle-continuation.test.ts:197-230`).
- check-7은 이 race를 실제로 밟았다. Exact `lsc-test-engineer` call은 durable file에 있었지만 `resultDelivered=false`였다 (`check/logs/check-7.log:352-355,774-777`). 즉 task가 생략된 것이 아니라, stream end가 관측된 뒤 durable message가 기록되기 전에 harness가 process를 죽였다.

따라서 `completedTaskSpawnSeen ∧ continuationCommitLanded → 1,200ms drain → SIGKILL` 뒤 `resultDelivered===true`를 요구하는 현재 조합은 structurally flaky하다. RF-35(a)가 durable authority를 추가하면서도 termination authority는 transient stream에 남겨 새 nondeterminism axis를 만들었다.

check-8의 continuation green (`check/logs/check-8.log:394-395`)은 이 구조적 race를 반증하지 않는다. 성공 로그는 fixture tree와 parent session을 정리한 뒤 어느 branch를 탔는지 남기지 않는다.

- Early exit가 실제 발동했다면 predicate상 반드시 **with-commit branch**였다.
- Process가 자연 종료했다면 with-commit 또는 no-commit branch 모두 가능하다.
- 따라서 현존 durable evidence만으로 check-8이 `:286+` with-commit인지 no-commit인지, 또는 `RUN_CHECK_MARKER`/`completedTaskSpawnSeen` 중 어느 arm이 발동했는지는 판정할 수 없다.

### 2. Full cycle: 50분은 이 run에서 skill이 허용한 re-spawn을 담을 수 없다

check-8 durable timestamps (`check/logs/check-8.log:308-352`)를 기준으로 한 타임라인:

| 시점 | 관측 | post-craft 시작 후 | audit batch 시작 후 |
|---|---|---:|---:|
| 08:56:56.168 | parent post-craft session 시작 | 0:00 | — |
| 09:01:53.371 | `run_check.sh` exit 0, check-1 기록 | 4:57 | — |
| 09:03:21.006 | explore + auditors batch spawn | 6:25 | 0:00 |
| 09:22:55.728 | explore durable result | 25:59 | 19:35 |
| 09:43:52.401 | unheard lens ③/④ 두 re-spawn 시작 | 46:56 | 40:31 |
| 09:46:55.770 | 50분 harness kill | 49:59.6 | 43:34.8 |

Re-spawn 둘은 kill 시점에 겨우 약 **3분 3초** 실행 중이었고, 마지막 durable activity도 kill 183초 전이었다. Post-craft 계약의 3,000,000ms wait class는 각 re-spawn batch에 최대 50분을 허용한다. 같은 schedule에서 그 wait가 만료될 수 있는 최초 시점은 약 10:33:52, 즉 post-craft 시작 후 **96분 56초**다. 이후 synthesis/finalization/land 시간도 필요하다.

따라서:

- 50분 budget은 “한 번의 sanctioned 50분 wait”만 보아도 부족하다. 해당 wait가 stage 시작 46분 56초 뒤에 시작됐기 때문이다.
- 기존 15분 slack을 유지하면 이 관측 schedule을 담는 계산 가능한 최소 권고치는 약 **112분**이다: 관측된 pre-respawn 47분 + sanctioned wait 50분 + finalization slack 15분.
- 두 re-spawn의 실제 완료 시각은 kill 때문에 알 수 없다. 따라서 “이 run의 실제 최종 필요 시간”을 더 짧게 주장할 증거는 없다.
- 183초 silence와 `delivered=false`는 50분 wait contract 안에서 아직 정상 in-flight다. 이를 orchestration hang으로 분류할 근거가 아니다. Provider variability가 trigger였지만, red를 만든 직접 원인은 이를 담지 못한 harness budget이다.

### 3. Per-red attribution

| Red | Attribution | Durable evidence | Judgment |
|---|---|---|---|
| check-7 continuation, source assertion `:284` | **harness defect introduced by RF-35** | `check/logs/check-7.log:352-355,774-777`에 exact engineer call이 존재하지만 `delivered=false`; stream end가 durable toolResult보다 먼저 발생하는 host 순서와 1,200ms kill seam이 결합된다. | 실제 task omission이나 subprocess orchestration defect가 아니다. |
| check-7 full-cycle, source assertion `:221` | **harness defect pre-existing**; provider-budget nondeterminism이 trigger | `check/logs/check-7.log:291-295,699-703`에서 60분 pre-craft kill. 실패 메시지는 `debugSummary`뿐이고 당시 durable stage attribution artifact는 없다. | RF-35(b)의 명시적 post-craft scope 밖에 있던 기존 budget/observability 결함이다. |
| check-8 full-cycle, source assertion `:339` | **harness defect introduced or left by RF-35**; provider variability가 trigger | `check/logs/check-8.log:293-352`: test authoring 완료, check-1 green, 첫 audit batch 5/5 delivered, 계약 위반 lane 2개 re-spawn, kill 시 re-spawn 2개만 in-flight. | Production implementation defect도, 확정된 subprocess orchestration hang도 아니다. |

### 4. Stream-marker reliability

`stage markers (stream): audit-begin cycle-0 = 0, run-check = 0`은 한 종류의 실패가 아니다.

1. **`RUN_CHECK_MARKER`는 현재 stream result에 존재하지 않는다.**
   - Helper는 `"script sha256: "`를 marker로 정의한다 (`test/e2e-helpers.ts:784`).
   - Production은 이 문자열을 durable check transcript에만 쓴다 (`src/craft/run-check.ts:245-248`).
   - Model-facing successful result text는 `"lets-craft: run_check.sh passed ... Log: ..."`뿐이다 (`src/craft/run-check.ts:277-281`).
   - `streamMarkerCount`는 `tool_execution_end.result.content[].text`만 읽는다 (`test/e2e-helpers.ts:792-806`).
   - 따라서 generic tool name이 `write`인 것이 문제가 아니라, 선택한 marker에 stream producer가 없는 것이 핵심이다. `RUN_CHECK_MARKER` count 0은 long-run truncation 없이도 구조적으로 가능하다.

2. **Audit-begin marker는 stream에 존재하지만 32MB rolling tail에서 유실될 수 있다.**
   - stdout은 `MAX_BUFFERED_OUTPUT_BYTES = 32 MiB` trailing tail만 보존한다 (`test/e2e-helpers.ts:201,265-277`).
   - check-8의 durable tail은 begin과 run-check가 실제 완료됐음을 보이지만 long-run failure snapshot의 audit-begin count는 0이다 (`check/logs/check-8.log:295,308-310`).
   - Generic `write` tool name은 `streamMarkerCount`가 tool name을 보지 않으므로 이 count에 영향을 주지 않는다.

노출된 E2E surface:

- `e2e-red-cycle-continuation.test.ts:229-230,236-239`: audit marker가 다른 조건이 성립하기 전에 tail에서 밀리면 early exit와 후속 count assertion이 모두 false가 된다. `completedTaskSpawnSeen`도 task end 이후 commit까지 출력이 32MB를 넘으면 같은 문제가 생긴다. `RUN_CHECK_MARKER` fallback은 현재 실질적으로 dead arm이다.
- `e2e-full-cycle.test.ts:136-142`: timeout attribution이 수행된 stage를 0으로 오보고한다.
- `e2e-audit-escalation.test.ts:121-145,171-218`: stream-only이지만 marker 직후 즉시 종료하는 짧은 run이라 현재 위험은 낮다. 그래도 durable authority는 아니다.
- `e2e-preset-default.test.ts`: 이 marker helper들을 사용하지 않아 해당 결함에 직접 노출되지 않는다.

## Verification Results

### RF-30

- **itemId:** `RF-30`
- **ownerRef:** `{ kind: "auditor", lens: "infra" }`
- **implementationOid:** `a1af63b2bfda95b182a8717e3acd8783920c16f6`
- **auditCycle:** `4`
- **judgment:** **완전 적용**
- **evidence:**
  - `src/craft/run-check.ts:389-397` — claimed identity와 expected feature 모두 `controlSafeEcho(...)`를 통한다.
  - `test/craft-run-check.test.ts:681-708` — `projectRoot`와 `worktreeRoot` 각각의 DEL seed가 존재한다.
  - `test/craft-run-check.test.ts:697-708` — raw C0/C1/DEL/separator 부재, escaped `\\u007f` containment, exec 0, log dir 부재를 함께 단언한다.
- **판정 근거:** RF 원문의 production seam과 두 DEL axis가 모두 닫혔다. 4세대 carry-forward warning의 “부분 적용” 조건은 발동하지 않으며 `needs-redesign`으로 올릴 근거가 없다.

### RF-31

- **itemId:** `RF-31`
- **ownerRef:** `{ kind: "auditor", lens: "infra" }`
- **implementationOid:** `a1af63b2bfda95b182a8717e3acd8783920c16f6`
- **auditCycle:** `4`
- **judgment:** **완전 적용**
- **evidence:**
  - `test/e2e-helpers.test.ts:562-564` — `<xdgData>/omp/plugins/node_modules`를 선생성해 XDG data root를 실제 authority로 만든다.
  - `test/e2e-helpers.test.ts:569-594` — 실제 `~/.omp/plugins`와, 설정된 경우 실제 `$XDG_DATA_HOME/omp/plugins`의 slot/lockfile/package를 before/after 비교한다.
  - `test/e2e-helpers.test.ts:579-585` — child env는 `PATH`, temp `HOME`, temp `XDG_DATA_HOME`, temp `XDG_STATE_HOME`, temp `XDG_CACHE_HOME`만 전달한다.
  - 설치된 `pi-utils/src/dirs.ts:339-360` — resolver가 읽는 XDG data/state/cache 세 축.
  - 설치된 `pi-utils/src/dirs.ts:280-282,90-91,430` — `PI_CONFIG_DIR`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CODING_AGENT_DIR`가 나머지 redirect inputs이며 allowlist 때문에 모두 제거된다.
  - `check/logs/check-8.log:163` — real-omp hermetic test가 현 cycle deterministic run에서 green.
- **판정 근거:** `XDG_CONFIG_HOME`, `OMP_HOME`, `PI_HOME`은 설치된 DirResolver에서 읽지 않는다. 확인 가능한 directory-affecting env 중 allowlist가 고정하거나 제거하지 못한 축은 없다. 4세대 carry-forward warning의 “부분 적용” 조건은 발동하지 않는다.
- **부가 관측:** 권고 ①의 chmod test는 현재 macOS 일반 사용자에서는 green (`check-8.log:164`)이지만 root는 directory write-bit를 우회할 수 있어 portable deterministic test는 아니다. SIP는 temp directory unlink 권한과 무관하다.

### RF-33

- **itemId:** `RF-33`
- **ownerRef:** `{ kind: "auditor", lens: "infra" }`
- **implementationOid:** `a1af63b2bfda95b182a8717e3acd8783920c16f6`
- **auditCycle:** `4`
- **judgment:** **완전 적용**
- **evidence:**
  - 설치된 `@oh-my-pi/pi-ai/src/types.ts:838-842` — host `ToolCall.arguments` authority는 `Record<string, unknown>`.
  - `test/e2e-helpers.ts:993-1010` — parsed object를 기본으로 사용하며 provider variance의 JSON string도 허용하고 flat args와 `tasks[]` batch를 모두 normalize한다.
  - `test/e2e-preset-default.test.ts:255-275` — TRACER-PING/EXPLORE-PING marker-bound parent task를 찾은 뒤 requested agent가 exact `lsc-tracer`/`lsc-explore`인지 먼저 단언한다.
  - `test/e2e-preset-default.test.ts:280-286` — 위 precondition이 성립한 뒤에만 override model을 단언하며 두 child의 session-init shape와 parent task inventory를 실패 메시지에 포함한다.
  - `check/logs/check-7.log:349-350`; `check/logs/check-8.log:392-393` — 새 precondition으로 2회 연속 green(497,753ms / 453,568ms).
- **판정 근거:** optional `session_init.agent`는 authority에서 제거됐다. Marker lookup은 normalized batch item 각각의 `taskText`를 사용하므로 one-item-per-call과 `tasks[]` 모두 견딘다.
- **부가 관측:** diagnostics는 common string fields와 task text를 자르지만 전체 byte cap은 아니다. 이는 RF-33 criterion을 깨지는 않지만 아래 MINOR finding으로 기록한다.

### RF-35

- **itemId:** `RF-35`
- **ownerRef:** `{ kind: "auditor", lens: "infra" }`
- **implementationOid:** `a1af63b2bfda95b182a8717e3acd8783920c16f6`
- **auditCycle:** `4`
- **judgment:** **부분 적용**
- **evidence:**
  - 적용된 부분: `test/e2e-helpers.ts:889-1084`에 durable session-file readers가 생겼고, `test/e2e-full-cycle.test.ts:136-190`은 timeout failure message와 외부 JSON artifact에 task inventory/entry tail을 보존한다.
  - 미완 부분 (a): `test/e2e-red-cycle-continuation.test.ts:229-230,272-284`가 transient stream completion으로 kill을 시작한 뒤 durable `resultDelivered`를 요구한다. check-7은 실제로 `delivered=false`였다 (`check-7.log:352-355`).
  - 미완 부분 (a): `test/e2e-red-cycle-continuation.test.ts:272-284`는 첫 `agent==="lsc-test-engineer"` call을 선택하고 feature substring과 delivery만 확인한다. Exact `commitB`/execution OID marker, `resultIsError===false`, result-text binding은 없다.
  - 미완 부분 (b): `test/e2e-full-cycle.test.ts:77-94`는 stage 시작부터 50분만 허용하지만 check-8의 sanctioned re-spawn은 stage 시작 46분 56초 뒤에 시작했다.
  - 미완 부분 (b): `test/e2e-helpers.ts:784,792-806`의 run-check stream marker는 production result content에 존재하지 않고, audit marker는 rolling tail에서 유실된다.
  - cycle-4 deterministic result: `check/logs/check-8.log:293-395` — full-cycle 1 red / 나머지 3 green.
- **fixCompleteness:** **apply-only**. Durable result를 termination predicate로 승격하고, exact execution binding을 추가하며, measured pre-respawn duration + sanctioned wait + finalization slack으로 budget을 다시 계산하면 된다. Architecture 재설계가 필요하지 않다.

## 추가 인프라 검증

### RF-35(b) timeout arithmetic

`test/e2e-full-cycle.test.ts:75-94`의 산술은 정확히 다음과 같다.

- initial pre-craft: 3,600,000ms
- 최대 3 resume: 3 × 1,200,000 = 3,600,000ms
- craft: 2,400,000ms
- post-craft: 3,000,000ms
- slack: 900,000ms
- **local test timeout: 13,500,000ms**
- package CLI default: 10,200,000ms
- 차이: **3,300,000ms**

하지만 `it(..., TEST_TIMEOUT_MS)`가 `test/e2e-full-cycle.test.ts:471`에 명시되어 있고 Vitest는 numeric third argument를 local timeout으로 변환한 뒤 `options.timeout ?? config.testTimeout` 순서로 선택한다 (`node_modules/@vitest/runner/dist/chunk-hooks.js:559-606`). 따라서 package CLI의 10,200,000ms가 이 test를 먼저 죽이지 않는다. 세 resume를 모두 타는 path도 local 13,500,000ms 계산 안에 있다.

check-7의 pre-craft timeout arm (`test/e2e-full-cycle.test.ts:221`)이 `debugSummary`만 남기는 것은 RF-35(b)의 verbatim post-craft scope에는 포함되지 않는다. 다만 실제 deterministic red가 된 별도 NEW harness finding이다.

### Measured-green rebudget 여부

`check/logs/check-4.log:288-290`은 full-cycle file/test가 3,201,431ms, 즉 53분 21.431초에 green이었음을 보여 준다. 새 comment가 이 수치를 인용하기는 하지만 (`test/e2e-full-cycle.test.ts:77-85`), 전체 file 시간에서 post-craft stage 시간을 분리하지 않았고 “50분 internal wait와 같으므로 sanctioned wait 중 kill되지 않는다”는 결론은 check-8 타임라인에 의해 반증됐다. 따라서 “측정값을 언급함”은 적용됐지만 “측정값으로 충분한 stage budget을 산출함”은 적용되지 않았다.

### Check entrypoint

- `.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh` sha256는 `87fe5a33949f97822554e15d8a2293d8d5c9b4a90db6586c501e03def7b7daa4`로 지정값과 일치한다.
- `run_check.sh:31-39`는 `package.json`의 `build`, `test`, `test:bun`, `e2e` 네 script를 모두 호출한다.
- `package.json`에 이번 delta가 추가한 script는 없다.
- `tsconfig.json:13`은 여전히 `src/**/*.ts`만 포함하므로 audit-1의 `test/**` strict `tsc --noEmit` 부재는 그대로다. 이는 prior non-blocking carry-over이며 RF-30/31/33/35의 closure를 바꾸지 않는다.
- `run_check.sh:19-24`의 “4 × 10,200s” sizing 설명은 full-cycle의 13,500,000ms local override를 반영하지 않아 exact하지 않다. 실제 12시간 outer check budget에는 아직 여유가 있어 non-blocking이다.

## Findings

1. **보완 · MAJOR** — **[Residual RF-35(a), apply-only]** transient `task` stream completion으로 process를 죽인 뒤 durable toolResult를 요구해 continuation test가 structurally flaky하며, exact execution OID/result-success binding도 빠져 있다.
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:229-230` — `completedTaskSpawnSeen(stdout) && continuationCommitLanded()`
   - Evidence: `test/e2e-red-cycle-continuation.test.ts:272-284` — `find(spawn => spawn.agent === "lsc-test-engineer")` 뒤 `resultDelivered`만 단언한다.
   - Evidence: `check/logs/check-7.log:352-355` — `#0: agent=lsc-test-engineer delivered=false`
   - Required by: `.lsc/crafts/postcraft-14cycle-approval-failure/audit/audit-3.md:284` — “종료 후 parent session JSONL을 durable source로 읽어 marker-bound `task` call의 args/result에서 exact agent(`lsc-test-engineer`)·feature·cycle·실행 OID를 결합하라.”
   - Actual: 이 host의 sync task end는 completion event이지만 durable toolResult message보다 먼저 stream된다. 1,200ms 뒤 kill이 persistence를 앞지를 수 있다. Test는 assignment/result에 exact `commitB`를 요구하지 않고 `resultIsError`도 확인하지 않는다.
   - Remediation: early-exit closure가 parent session file을 읽어 marker-bound engineer call의 `resultDelivered===true && resultIsError===false`, assignment/result의 exact feature + `commitB`/execution-OID evidence, state `auditCycle===1`, with-commit 또는 fresh check-log evidence가 모두 성립한 뒤에만 종료하도록 바꾼다. Transient `completedTaskSpawnSeen`은 kill authority에서 제거한다. Exact call이 natural exit/timeout까지 없을 때만 orchestration omission으로 실패시킨다.

2. **수정 · MAJOR** — **[Residual RF-35(b), apply-only]** 50분 POST_CRAFT budget은 stage 46분 56초 뒤에 시작된 sanctioned 50분 re-spawn wait를 구조적으로 담지 못한다.
   - Evidence: `test/e2e-full-cycle.test.ts:77-86` — “matches the skill's own single-wait class so the kill never fires on a sanctioned wait.”
   - Evidence: `check/logs/check-8.log:308-352` — batch 09:03:21, re-spawn 09:43:52, kill 09:46:55, two re-spawns `delivered=false`.
   - Required by: `audit/audit-3.md:284` — “단계 예산을 실측 green run(check-4: 3,201s 파일 시간) 기준으로 재산정하라.”
   - Actual: budget은 stage 전체에 50분인데 내부 wait 하나도 최대 50분이다. 이 run은 re-spawn에게 약 3분만 주고 종료됐다.
   - Remediation: 같은 관측 schedule 기준으로 POST_CRAFT budget을 최소 112분(47분 pre-respawn + 50분 allowed wait + 15분 finalization slack)으로 재산정하거나, phase별 deadline을 두어 re-spawn 시점에 별도 50분 wait budget을 부여한다. `TEST_TIMEOUT_MS`와 check-entrypoint sizing comment도 같은 authority에서 함께 갱신한다.

3. **수정 · MAJOR** — **[Residual RF-35(b), apply-only]** timeout의 stage-marker tuple이 실제 durable stage를 오보고하며, red-continuation의 run-check fallback은 producer가 없는 dead marker다.
   - Evidence: `test/e2e-helpers.ts:784` — `RUN_CHECK_MARKER = "script sha256: "`
   - Evidence: `src/craft/run-check.ts:245-248,277-281` — marker는 log transcript에만 있고 tool result text에는 없다.
   - Evidence: `test/e2e-helpers.ts:792-806` — `streamMarkerCount`는 result content text만 센다.
   - Evidence: `check/logs/check-8.log:295,308-310` — stream count는 0/0이지만 durable tail은 `run_check.sh passed`와 check-1 작성을 증명한다.
   - Required by: `audit/audit-3.md:284` — “마지막 tool execution/message·단계별 marker 등 stall 귀속 증거를 실패 메시지/durable artifact로 보존.”
   - Actual: run-check count 0은 truncation 이전부터 구조적으로 가능하고, audit-begin은 32MB tail에서 유실될 수 있다. Generic `write` name은 text-marker parser가 tool name을 무시하므로 원인이 아니다.
   - Remediation: session JSONL의 durable `toolResult` text, `.craft-state.json.auditCycle`, 새 check-log index를 한 번에 읽는 durable stage-observation helper를 추가한다. Run-check marker는 실제 production result content에 존재하는 stable text로 바꾸거나 production result가 digest marker를 명시적으로 내도록 한다. Long-run post assertions/early-exit에서 rolling stdout을 authority로 사용하지 않는다.

4. **보완 · MAJOR** — **[NEW, apply-only]** pre-craft timeout은 check-7을 red로 만들었지만 post-craft 전용 stall builder가 적용되지 않아 원인 귀속 evidence가 없다.
   - Evidence: `test/e2e-full-cycle.test.ts:220-224` — pre-craft timeout은 `debugSummary(preCraftResult)`만 사용한다.
   - Evidence: `check/logs/check-7.log:291-295,699-703` — 3,600,467ms 후 attempt 1 timeout.
   - Required by: `spec.md:95` — “기존 E2E 전체 green.”
   - Required by: `plan.md:452` — “targeted test/build/fixture E2E/full E2E가 실제 exit/test count와 함께 green.”
   - Actual: 60분 budget은 실제 progressing pre-craft run을 죽였고, durable session tail/task inventory가 남지 않아 provider stall, budget exhaustion, orchestration hang을 구분할 수 없다. 이는 RF-35(b)의 verbatim post-craft target 밖이라 prior RF의 residual은 아니지만 cycle-4가 새로 관측한 harness defect다.
   - Remediation: `postCraftStallEvidence`를 phase-parameterized `stageStallEvidence`로 일반화해 pre-craft attempt별 parent session, durable task inventory, artifact progress를 남긴다. 60분 budget은 fresh timing 없이 90→60분으로 낮췄다는 자체 comment와 check-7 evidence를 반영해 measured slow tail 이상으로 복원한다. **apply-only**이며 state-machine redesign은 필요 없다.

5. **보완 · MAJOR** — **[Residual RF-34, outside lens, apply-only]** model-facing failure summary는 line count만 제한하고 line/total byte 길이는 제한하지 않아 “bounded escaped summary” 요구를 완전히 충족하지 않는다.
   - Evidence: `src/craft/run-check.ts:36,49-54` — `.slice(0, max)`로 최대 40줄만 제한한 뒤 각 full line을 `controlSafeEcho`한다.
   - Evidence: `src/craft/run-check.ts:279-281` — 제한되지 않은 escaped lines 전체를 tool result에 join한다.
   - Required by: `audit/audit-3.md:283` — “raw child output은 durable log에만 보존하고 tool result에는 bounded escaped summary.”
   - Actual: `error`를 포함한 단일 초대형 line은 그대로 model-facing result에 들어간다. Escaping은 완전하지만 byte bound는 아니다.
   - Remediation: raw line별 character cap과 aggregate output cap을 적용한 뒤 `controlSafeEcho`하고, 잘림을 constant suffix로 표시한다. Durable check log의 raw stdout/stderr는 그대로 보존한다.

6. **개선 · MINOR** — **[NEW, apply-only]** RF-33 failure diagnostic은 일반 문자열만 200자로 자를 뿐 nested `outputSchema` 등 non-string session-init field와 task-call 개수에 total bound가 없다.
   - Evidence: `test/e2e-preset-default.test.ts:148-166` — “strings capped at 200 chars”지만 non-string은 `bounded[key] = value`.
   - Evidence: `test/e2e-preset-default.test.ts:255-258` — 각 task text만 160자로 자르고 inventory item 수는 제한하지 않는다.
   - Required by: 같은 파일 `:148-151`의 self-contract — “a bounded, shape-preserving view.”
   - Actual: 현 preset fixture의 두 call에서는 작지만 host `session_init.outputSchema`나 비정상 다수 task call이 커지면 diagnostic 전체가 unbounded다.
   - Remediation: depth/array/key/string cap을 가진 diagnostic serializer와 aggregate character cap을 사용하고, truncation metadata를 남긴다.

7. **개선 · MINOR** — **[NEW, apply-only]** 권고 ①의 permission regression은 root에서 deterministic하지 않다.
   - Evidence: `test/e2e-helpers.test.ts:597-607` — parent directory를 `0o555`로 바꾸어 `rmSync`의 `EACCES/EPERM`을 기대하며, source comment도 “Same root-user caveat”를 인정한다.
   - Required by: `plan.md:452` — targeted tests가 deterministic하게 green이어야 한다.
   - Actual: 일반 macOS user에서는 기대대로 동작하고 check-8에서 green이지만, effective UID 0은 directory permission bit를 우회해 unlink할 수 있다. SIP는 `/tmp`의 이 permission model을 보강하지 않는다.
   - Remediation: root이면 명시적으로 skip하는 환경 전제 검사를 추가하거나, filesystem removal seam을 inject해 `EACCES`를 결정적으로 발생시키는 unit test로 바꾼다.

8. **개선 · MINOR** — **[NEW, apply-only]** check entrypoint의 timeout-sizing comment가 full-cycle local timeout override와 더 이상 exact하게 정합하지 않는다.
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh:19-24` — 네 파일 모두 package `--testTimeout=10200000`이 worst-case authority라고 설명한다.
   - Evidence: `test/e2e-full-cycle.test.ts:94,471` — full-cycle은 local 13,500,000ms timeout을 넘긴다.
   - Required by: `run_check.sh:19`의 self-contract — 해당 문단은 §3.1 `timeout_ms` sizing을 안내한다.
   - Actual: 실행 wiring 자체는 맞고 12시간 outer budget에도 들어오지만, 설명의 수치 authority는 실제 Vitest precedence와 다르다.
   - Remediation: 파일별 local timeout 합을 설명하거나, exact worst-case 산술을 제거하고 package/local timeout 중 effective value를 기준으로 outer budget을 산정한다고 명시한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- check-8 continuation green은 success-path fixture/session artifact를 보존하지 않아 with-commit/no-commit branch와 early-exit arm을 확정할 수 없다. 위 보고서는 이 부재를 clean evidence로 간주하지 않았다.
- check-8에서 kill된 두 auditor re-spawn의 실제 완료 시간은 관측 불가다. 97분은 sanctioned wait가 만료될 수 있는 earliest structural bound이고, 112분은 기존 finalization slack을 포함한 권고치다.
- 설치된 `omp` source는 읽을 수 있었고 현재 package version은 18.1.2다. Test comment는 18.0.11을 고정적으로 적지만 check-7/8 log는 당시 실행 binary version/path를 기록하지 않아 해당 run의 exact installed version provenance는 재구성할 수 없다.
- 지시에 따라 deterministic check와 어떤 `LSC_E2E` test도 재실행하지 않았다. Cycle-4 실행 증거는 제공된 `check-8.log`와 timeout artifact를 직접 판독했다.
- Lens ④는 spec/plan compliance matrix를 소유하지 않는다. RF-32의 전체 semantic closure와 RF-34의 다른 model-facing callsite 전수 정합성은 matrix 판정하지 않았지만, whole-delta sweep 중 발견한 RF-34 summary-bound residual은 `(outside lens)`로 보고했다.
- `test/**`에 대한 strict `tsc --noEmit`은 여전히 check entrypoint에 없다. Prior non-blocking carry-over로 남으며 이번 RF closure와 별개다.
