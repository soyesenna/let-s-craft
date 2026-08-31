**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ fbc4c9c73237441d653e26c7a6a15456f8afc7b2 · audit cycle 1

## Lens

④ **인프라·설정 (infrastructure and configuration)** — fix-verification, 승계 RF-4·RF-7·RF-8·RF-1(공동)·RF-10.

우선 반증 질문:

> RF-4의 plugin 고정은 실제로는 global link를 per-run으로 갈아끼우거나 preflight만 추가했을 뿐, e2e 자식 프로세스가 로드하는 빌드는 여전히 base checkout(현재 `readlink ~/.omp/plugins/node_modules/lets-craft`가 가리키는 곳)의 dist이거나, preflight가 첫 model turn 전이 아닌 suite 진입 후에만 발화해 비싸게 실패한다 — `test/e2e-helpers.ts`의 실제 배선 순서와 readlink 프로브(읽기 전용)로 입증 또는 반증하라. 단, 프로브가 글로벌 link를 변경해서는 안 된다.

## Expected State

세부 implementation code 판정 전에 고정한 기대 상태는 다음과 같다.

1. **RF-4**: `runOmpPrint`는 자식을 시작하기 전에 `REPO_ROOT` plugin을 명시 선택하고, 실제 load 대상 `BUILD_INFO.gitHash`와 `git -C REPO_ROOT rev-parse --short HEAD`를 비교해야 한다. 불일치는 첫 model turn 전에 suite를 중단하며, 기존 global link의 존재·대상에 암묵 의존하지 않아야 한다.
2. **RF-7**: Continue는 completed `lsc_audit_begin` 결과가 정확히 `[isError, success]`인 2-tuple일 때만 early-exit 및 통과해야 한다. Abort는 `CRAFT_ABORTED_MARKER`를 필수 대기하고 `state.aborted === true`를 무조건 단언해야 한다.
3. **RF-8**: red-cycle early-exit은 `RUN_CHECK_MARKER` 또는 completed `task`의 `tool_execution_end`에만 반응해야 한다. `tool_execution_start`는 false, end는 true인 단위 회귀가 있어야 한다.
4. **RF-1**: disposition은 raw canonical label exact membership만 허용하며 whitespace-padded 입력은 state를 바꾸지 않고 거부해야 한다.
5. **RF-10**: `run_check.sh`는 build → test → test:bun → e2e 네 단계를 실패 누적으로 전부 실행하고 마지막에 종합 상태로 종료해야 한다. `npm test`의 skipped E2E를 AC-8 증거로 쓰지 않고, 별도 `npm run e2e`가 RF-4 배선을 통해 이 worktree build를 검증해야 한다. 외부 `timeout_ms`는 순차 E2E의 선언된 시간 예산을 포괄해야 한다.

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

**답: 질문의 두 핵심 우려—현재 자식 load 대상이 base checkout이라는 우려와 preflight가 첫 model turn 뒤라는 우려—는 현재 관측에서는 반증되었다. 그러나 RF-4 전체 closure는 성립하지 않는다.**

- 읽기 전용 `readlink`와 `realpath`는 모두 `~/.omp/plugins/node_modules/lets-craft`가 현재 worktree `<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure`를 가리킴을 보였다.
- `git -C REPO_ROOT rev-parse --short HEAD`는 `fbc4c9c`였고, `dist/generated/version.js:2-5`의 `BUILD_INFO.gitHash`도 `fbc4c9c`였다.
- `test/e2e-helpers.ts:52-70`은 link 재설정 후 `realpath`를 확인하고 build hash를 HEAD와 exact 비교한다.
- `test/e2e-helpers.ts:269-287`은 `pinLetsCraftPluginToRepo()`를 `spawn("omp", …)`보다 먼저 호출한다. 따라서 preflight 순서는 첫 model turn 전, 더 강하게는 자식 생성 전이다.
- 다만 실제 자식 load까지의 end-to-end 증명은 실패했다. `test/e2e-helpers.ts:26,287`의 누락 import 때문에 자식 생성 자체가 `spawn is not defined`로 중단됐다. 또한 `test/e2e-helpers.ts:53`은 global link가 아예 없는 경우 `readlinkSync`부터 호출하므로 “global link 암묵 의존 제거”의 clean-environment 경계도 미완성이다.

읽기 전용 프로브는 global link나 dist를 변경하지 않았다.

## Required Fix 적용 판정

| RF | 판정 | 직접 증거 | 결론 |
|---|---|---|---|
| **RF-4** | **Partial** | `test/e2e-helpers.ts:52-70,269-287`; `dist/generated/version.js:2-5`; `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-2.log:284-289,690-710` | 현재 link/root/hash 및 pre-spawn 순서는 맞다. 그러나 `spawn` 누락으로 자식이 하나도 시작되지 않았고, link 부재 경계도 처리하지 않는다. |
| **RF-7** | **Partial** | `test/e2e-audit-escalation.test.ts:120-144,162-194`; `test/e2e-helpers.ts:763-787`; `plan.md:411` | 코드상 Continue exact `[true,false]` tuple과 Abort marker/무조건 `aborted=true`는 정확하다. 하지만 세 E2E 모두 `seedCraftedFeature` setup에서 먼저 실패하여 실제 orchestration 관측은 없었다. |
| **RF-8** | **Partial** | `test/e2e-red-cycle-continuation.test.ts:190-200`; `test/e2e-helpers.ts:812-820`; `test/e2e-helpers.test.ts:395-408` | raw substring arm은 제거됐고 start→false/end→true 단위 회귀는 존재하며 일반 test 단계에서 통과했다. 그러나 red-cycle E2E가 setup에서 중단되어 subprocess 경로는 검증되지 않았다. |
| **RF-1** | **Met** | `src/craft/audit-policy.ts:52-54,428-451`; `test/audit-policy.test.ts:89-98,441-466`; `check-2.log:136,247-250` | `.trim()` 없이 raw `includes(value)`를 사용하고, 세 label의 padded 변형 차단·byte stability·후속 exact consume 회귀가 존재한다. `audit-policy` 포함 unit suite가 통과했다. |
| **RF-10** | **Partial** | `check/run_check.sh:32-42`; `package.json:12-17`; `check-2.log:55-62,247-301` | 네 단계 accumulate와 별도 E2E 실행은 정확히 배선되어 실제로 모두 실행됐다. 하지만 E2E는 4/4 파일, 6/6 tests 실패했고, source contract의 `timeout_ms`는 아직 600000/fixture 120000이다. |

## 부수 회귀 점검

- **4-file wiring 자체는 유지됨**: `package.json:17`과 `README.md:239-256`은 `e2e-full-cycle`, `e2e-preset-default`, `e2e-audit-escalation`, `e2e-red-cycle-continuation`을 동일한 순서로 열거하며 `--no-file-parallelism`을 유지한다.
- **fixture rule 자체는 유지됨**: `fixtures/sample-ts-cli/answers.json:55-61`은 generic confirmation보다 앞선 anchored `[Audit Escalation]` selection rule을 갖는다.
- **기존 suite 회귀 발생**: `e2e-full-cycle`과 `e2e-preset-default`는 공용 helper의 `spawn` import 삭제로 둘 다 child 시작 전에 실패했다.
- **신규 suite 회귀 발생**: escalation 3개 branch와 red-cycle은 공용 seed helper의 invalid `git check-ignore -q <path1> <path2>` 호출로 본 경로에 진입하지 못했다.
- **RF-10 accumulate는 실제 작동**: fresh `check-2.log`는 build, 일반 test, test:bun, e2e를 순서대로 모두 실행하고 E2E 실패를 `summary status=1`로 누적했다. 일반 `npm test`는 E2E 6파일을 skip했고 별도 E2E 단계가 실제 4파일을 실행했다.
- package의 `omp.extensions: ["./dist/main.js"]`와 worktree link/hash는 정합했다. 이 delta에는 별도 CI, release packaging, model/preset routing 설정 변경은 없었다.

## Findings

1. **수정 · CRITICAL** — RF-4 변경이 `spawn`/`ChildProcess` import를 삭제하여 기존 `e2e-full-cycle`과 `e2e-preset-default`를 포함한 모든 `runOmpPrint` 자식 경로를 깨뜨렸다.
   - Evidence: `test/e2e-helpers.ts:26` — `import { execFileSync } from "node:child_process";`
   - Evidence: `test/e2e-helpers.ts:287` — `const child: ChildProcess = spawn("omp", ompArgs, {`
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-2.log:284-289` — 두 기존 E2E가 모두 `spawn is not defined`
   - Required by: `audit/audit-0.md:216` — RF-4는 E2E **자식이** 검증 대상 plugin을 load하도록 요구한다. `plan.md:403,415,452`는 기존 full-cycle 회귀와 전체 E2E green을 요구한다.
   - Actual: preflight는 실행되지만 바로 다음 자식 생성에서 `ReferenceError`가 발생해 model process와 plugin load가 전혀 시작되지 않는다.
   - Remediation: line 26 import를 `import { type ChildProcess, execFileSync, spawn } from "node:child_process";`로 복구한 뒤 기존 full-cycle/preset-default와 신규 두 E2E를 표준 4-file command로 다시 실행한다.

2. **수정 · CRITICAL** — `seedCraftedFeature`가 `git check-ignore -q`에 두 path를 한 번에 넘겨 신규 escalation/red-cycle E2E 전부를 setup에서 중단시킨다.
   - Evidence: `test/e2e-helpers.ts:696` — `execFileSync("git", ["check-ignore", "-q", statePath, join(craftDir, "check", "logs", "check-0.log")], …)`
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-2.log:271-293` — escalation 3건과 red-cycle이 모두 `fatal: --quiet 옵션은 하나의 경로 이름과 같이 써야 합니다`
   - Required by: `plan.md:411-415,421-422` — 세 disposition subprocess와 red continuation을 실제 경계에서 증명하고 표준 E2E를 green으로 유지해야 한다.
   - Actual: Git의 quiet mode는 단일 pathname만 받는데 두 path를 전달한다. 따라서 RF-7/8의 새 assertion은 존재하지만 실제 E2E가 그 지점까지 도달하지 않는다.
   - Remediation: `git check-ignore -q -- <path>`를 state와 log sample에 대해 각각 한 번씩 호출해 두 ignore invariant를 독립 단언한다. 수정 후 escalation 3건과 red-cycle을 모두 재실행한다.

3. **보완 · MAJOR** — RF-4의 per-run link reset이 global link의 **존재**를 여전히 선행 조건으로 둔다.
   - Evidence: `test/e2e-helpers.ts:52-56` — `readlinkSync(GLOBAL_PLUGIN_LINK)`가 `omp plugin link REPO_ROOT`보다 먼저 무조건 실행된다.
   - Required by: `audit/audit-0.md:216` — “global link 암묵 의존 제거” 및 per-run link 재설정.
   - Actual: 현재 probe처럼 symlink가 존재하면 wrong-target 재설정과 realpath 검증이 가능하다. 반면 clean HOME, 삭제된 link, non-symlink slot에서는 `[INFERENCE — Node fs contract]` `readlinkSync`가 먼저 throw하여 link 명령에 도달하지 못한다.
   - Remediation: 가장 단순하게 매 run마다 `omp plugin link REPO_ROOT`를 무조건 실행한 뒤 `realpath`와 hash를 검증한다. 조건부 실행을 유지한다면 absent/dangling/non-symlink를 명시 처리해 그 경우에도 link command로 진입시킨다.

4. **수정 · MAJOR** — RF-10의 실제 cycle 호출은 4시간으로 상향됐지만 canonical §3.1 contract는 여전히 10분/fixture 2분이며, 선언된 순차 E2E 상한도 포괄하지 못한다.
   - Evidence: `skills/post-craft/SKILL.md:40,100` — `timeout_ms: 600000`, fixture mode `120000`
   - Evidence: `test/e2e-full-cycle.test.ts:65-75`, `test/e2e-preset-default.test.ts:24-25`, `test/e2e-audit-escalation.test.ts:59-60,112-219`, `test/e2e-red-cycle-continuation.test.ts:50-52` — 순차 실행되는 explicit test 상한 합계는 200+11+60+65 = **336분**이며 build/hooks 여유는 별도다.
   - Required by: `audit/audit-0.md:230` — “§3.1 `timeout_ms`를 E2E 예산에 맞게 상향.”
   - Actual: 이번 cycle은 orchestration에서 `14,400,000ms`를 전달해 기존 600,000ms보다는 상향했지만 source contract에는 반영되지 않았다. 4시간도 선언된 336분 합계보다 짧다. 이번 E2E는 4.62초 만에 다른 결함으로 실패했으므로 timeout 적합성은 행동 검증되지 않았다.
   - Remediation: `skills/post-craft/SKILL.md:40,100`의 normal/fixture 값을 순차 explicit 상한 합계와 build/hook 여유 이상으로 통일한다. 현재 suite 기준 최소 20,160,000ms에 build/hook margin을 더한 값을 사용하고, 120,000ms fixture 예외는 제거하거나 동일 산식으로 상향한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 이 lane은 동시 실행 오염 금지에 따라 npm/build/test/E2E를 직접 실행하지 않았다. 행동 증거는 main session이 `timeout_ms=14,400,000`으로 생성한 fresh `check-2.log`를 사용했다.
- global link나 dist를 일부러 깨뜨리는 probe는 금지된 mutation이므로 수행하지 않았다. 따라서 hash-mismatch fail-fast와 link-absent branch는 static ordering/API analysis만 했다.
- `spawn` 회귀 때문에 실제 `omp` 자식이 load한 module의 in-process `BUILD_INFO`는 관측할 수 없었다. 현재 symlink realpath와 on-disk dist hash까지만 확인했다.
- RF-7 Continue/Abort 및 RF-8 red continuation의 본 subprocess behavior는 공용 seed/setup 실패 때문에 관측되지 않았다. assertion 코드와 일반 unit helper test만 검증했다.
- feature 전체 62-file diff를 인프라·설정 관점에서 열거했지만, RF-2/3/5/6/9/11~15의 domain logic 정확성은 이 lens에서 재판정하지 않았다. 다만 RF-9 변경이 유발한 `check-ignore` setup 회귀는 영향이 커서 보고했다.
- 느리지만 정상인 4-file E2E가 outer timeout 안에서 끝나는지는 이번 fast-fail run으로 검증되지 않았다.
