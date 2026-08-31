**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ 59a81811bd3fba3613761f7e3db6844b29681b04 · audit cycle 2 (fix-verification)

## Lens

④ **인프라·설정 (infrastructure and configuration)** — fix delta 전체를 E2E harness, tool contract, path/environment assumption 관점에서 감사했다.

우선 반증 질문:

> "RF-17 수정은 형식만 고쳤고 실행 경계에서 다시 죽는다: 두 경로를 각각 1회 호출하더라도 두 번째 경로(check-0.log 등)가 그 시점에 디스크에 존재하지 않거나 gitignore 매칭 전제가 달라서 check-ignore가 non-zero로 실패한다(check-ignore는 파일 실존과 무관하나 경로 구성/상대화 오류는 가능). 또한 RF-16 import 복원이 tsconfig/verbatimModuleSyntax·type-only import 규칙과 충돌하거나, RF-18의 try/catch가 ENOENT/EINVAL 외 오류(EACCES 등)를 삼켜 fail-closed 재검증을 우회한다."

## Expected State

diff를 열기 전에 `spec.md`, `plan.md`, `audit/audit-1.md`의 RF 원문만으로 다음 상태를 고정했다.

| Requirement | 사전 고정한 기대 상태 | 검증 방법 |
|---|---|---|
| RF-16 (`audit/audit-1.md:246`, `spec.md:95`, `plan.md:414,437,452`) | `execFileSync`와 `spawn`은 value import, `ChildProcess`는 type-only import여야 한다. 공유 helper를 import하는 표준 4-file E2E가 collection 단계에서 모두 로드되어야 한다. | import와 runtime/type 사용부를 직접 읽고 4-file Vitest collection을 수행한다. |
| RF-17 (`audit/audit-1.md:247`) | `statePath`와 check-log path를 `git check-ignore -q -- <단일 path>`로 각각 정확히 한 번 검사한다. `cwd=worktreeRoot`에서 absolute path가 올바른 ignore rule에 매칭되어야 하며 check log의 실존 여부에 의존하지 않아야 한다. | 생성·commit·assert 호출 순서를 읽고, 존재하는 state path와 존재하지 않는 check-log path에 exact 단일-path 명령을 실행한다. |
| RF-18 (`audit/audit-1.md:248`, `spec.md:95-96`) | missing/dangling/non-symlink는 ENOENT/EINVAL에 한해 not-pinned로 처리하고 실제 `omp plugin link` 경로를 거친 뒤 realpath와 `BUILD_INFO.gitHash`를 fail-closed 재검증한다. EACCES 등은 전파한다. missing→생성, wrong-target→재지정, correct→no-op 회귀가 실제 production command의 경계를 대표해야 한다. | helper/catch/후검증, unit seams, 실제 설치된 `omp`의 link 구현을 함께 읽는다. |
| RF-21 (`audit/audit-1.md:251`, `spec.md:45,64,92,95`) | post-craft의 두 heading이 같은 `timeout_ms >= 43,200,000`을 사용하고 fixture 120000 예외가 없어야 한다. 4-file × (`testTimeout=10,200,000` + `hookTimeout=120,000`) = 41,280,000ms를 포괄하고 heading drift를 contract test가 막아야 한다. | `package.json`, `run_check.sh`, SKILL 두 heading, contract test를 대조한다. |
| fix delta 인프라 회귀 (`spec.md:82,95`, `plan.md:403-415`) | RF 수정이 공유 helper API, 4-file E2E wiring, unit-test environment, tool root identity를 우발적으로 깨지 않아야 하며 check harness 표준화 비목표를 확장하지 않아야 한다. | `fbc4c9c..59a8181` 전체 변경 파일과 관련 same-decision site를 훑는다. |

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

**답: 질문에 직접 제시된 세 실패 가설은 반증됐다. 다만 일반 RF-18 sweep에서 그와 별개의 production non-symlink 경계 결함을 발견했다(Findings 1).**

- **RF-17 호출 형식/시점** — `test/e2e-helpers.ts:718-741`에서 state는 `writeFileSync` 후 commit까지 거친 다음 검사된다. `:740-742`는 두 원소를 순회하며 각 invocation의 argv에 단일 `sidecarPath`만 넣는다.
- **RF-17 비실존 check log** — `.gitignore:12-13`은 각각 `.craft-state.json`과 `check/logs/`를 매칭한다. 실제 worktree에서 state path와 존재하지 않는 `check-never-created.log`에 `git check-ignore -q -- <path>`를 각각 실행했고 둘 다 exit 0이었다. 따라서 파일 비실존이나 absolute-path/cwd 조합은 실패 원인이 아니다.
- **RF-16 module/type 경계** — `test/e2e-helpers.ts:26`은 정확히 `import { execFileSync, spawn, type ChildProcess } ...`이고, `spawn`/`ChildProcess`는 `:328-332`에서 각각 runtime value/type으로 쓰인다. `package.json:5`는 ESM, `tsconfig.json:4-5`는 NodeNext이며 `verbatimModuleSyntax` 강제 설정은 없다. 4개 E2E 파일을 `LSC_E2E` 없이 collection한 결과 import/transform 오류 없이 4 files·6 tests가 정상 skip됐다.
- **RF-18 EACCES 등 예외** — `test/e2e-helpers.ts:78-87`은 code가 ENOENT/EINVAL이 아닐 때 `throw error`한다. 후속 `realpathSync` catch도 성공으로 바꾸지 않고 `:97-99`의 mismatch throw로 귀결되므로 검증 우회가 아니다.
- **RF-18 필수 unit 경계** — `test/e2e-helpers.test.ts:463-525`에 missing→생성, wrong-target→재지정, correct→no-op이 독립 테스트로 존재하고 scoped run에서 통과했다. 다만 같은 파일의 non-symlink test는 production `omp`와 다른 fake cleanup을 수행해 별도 결함을 숨긴다.

## RF Fix Verification

| RF | 판정 | 직접 근거 |
|---|---|---|
| **RF-16** | **완전** | `test/e2e-helpers.ts:26,328-332`가 exact import와 runtime/type 사용을 복원했다. `test/e2e-helpers.test.ts` 34 tests 통과 및 표준 4-file E2E collection 성공으로 공유 import 경로가 로드됨을 확인했다. |
| **RF-17** | **완전** | `test/e2e-helpers.ts:737-742`가 `statePath`와 `check-0.log`를 각각 한 번씩 단일-path `check-ignore -q --` invocation으로 검사한다. `.gitignore:12-13` 및 존재하지 않는 log path를 사용한 두 exact 명령의 exit 0으로 실행 경계를 확인했다. |
| **RF-18** | **부분** | `test/e2e-helpers.ts:78-110`의 catch narrowing과 realpath/hash fail-closed 검증, `test/e2e-helpers.test.ts:463-560`의 필수 3경계 및 refusal tests는 구현됐다. 그러나 non-symlink production 경로는 실제 `omp plugin link`가 기존 regular file을 치우지 않아 후검증 전에 종료되고, unit fake가 이 차이를 숨긴다. |
| **RF-21** | **완전** | `skills/post-craft/SKILL.md:40,100` 모두 43,200,000ms다. `package.json:17`은 4개 파일·`--no-file-parallelism`·10,200,000/120,000ms이고 `run_check.sh:19-22,39-40`도 같은 산식을 전제한다. `test/skill-contract.test.ts:1282-1298`은 exactly two call sites, same value, floor, 120000/600000 부재를 고정하며 scoped run에서 통과했다. |

검증 실행:

- `test/e2e-helpers.test.ts` + `test/skill-contract.test.ts`: **2 files, 222 tests passed**.
- 표준 4-file E2E collection (`LSC_E2E` 미설정): **4 files collected, 6 tests skipped**, import/transform 오류 없음.
- RF-17 exact 단일-path `git check-ignore -q` 두 호출: **둘 다 exit 0**.
- 실제 production command identity: `omp --version`은 **18.0.11**.

## Findings

1. **수정 · MAJOR** — RF-18의 non-symlink 경계가 production `omp plugin link`에서는 여전히 setup 단계에서 실패하며, 새 unit test의 fake가 그 실패를 대신 수리해 감춘다.
   - Evidence: `test/e2e-helpers.ts:72-90` — production default는 `execFileSync("omp", ["plugin", "link", root], ...)`이고 EINVAL을 not-pinned로 바꾼 뒤 그대로 이 command를 호출한다.
   - Evidence: `test/e2e-helpers.test.ts:496-511` — regular file fixture의 fake `linkPlugin`이 직접 `rmSync(linkPath, { force: true }); symlinkSync(root, linkPath);`를 수행한다.
   - Evidence: `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/plugins/manager.ts:796-806` — 실제 `omp/18.0.11`은 기존 path가 symlink 또는 directory일 때만 `unlink`하고 곧바로 `symlink`한다. regular file은 남으므로 `symlink`가 EEXIST로 실패한다.
   - Evidence: `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/cli/plugin-cli.ts:624-640` — link 오류를 catch한 CLI는 `process.exit(1)`한다. 그 결과 helper의 realpath/hash 후검증에는 도달하지 않는다.
   - Required by: `audit/audit-1.md:248` — “**missing/dangling/non-symlink link를 ... ‘not pinned’ 처리해 그 경우에도 `omp plugin link REPO_ROOT`로 진입시킨 뒤 realpath+BUILD_INFO.gitHash를 fail-closed 재검증**.”
   - Actual: missing/wrong symlink/correct symlink는 동작하지만 regular-file non-symlink는 production command가 실패한다. 테스트만 production에 없는 선행 삭제를 수행한다. 이전 감사의 동일 RF가 다시 부분 적용됐으므로 `audit/audit-1.md:255`의 fix-introduced treadmill REJECT 조건에 해당한다.
   - Remediation: known global plugin slot의 EINVAL/non-symlink 상태를 helper가 안전하게 정규화한 뒤 실제 `omp plugin link`를 호출하도록 한다. regular file과 directory를 교체하는 정책을 명시하고, EACCES/EPERM은 계속 전파한다. unit fake에서는 선행 `rmSync`를 제거해 helper가 slot을 정규화하지 않으면 테스트가 실패하게 만들고, temp HOME/config를 사용한 hermetic real-`omp plugin link` non-symlink 회귀를 추가한다. 이후 모든 성공 branch에서 기존 realpath + build hash 후검증을 그대로 실행한다.

2. **보완 · MAJOR** — RF-20(d)의 명시적 “무-raw-payload” 회귀 의무가 run-check test block에 구현되지 않았다. **(outside assigned RF ownership; infra path contract)**
   - Evidence: `test/craft-run-check.test.ts:499-505` — `"bad\nfeature"`를 넣지만 assertion은 `isError`와 `"kebab-case slug"` 포함만 확인한다. raw newline/payload 부재를 확인하지 않는다.
   - Evidence: `test/craft-run-check.test.ts:507-520` — foreign-root case는 평범한 temp path만 사용하고 `"foreign root"` 포함과 log directory 부재만 확인한다.
   - Evidence: `test/craft-run-check.test.ts:523-546` — 나머지는 두 accepted-root positive cases이며 block이 끝날 때까지 control-carrying persisted root, stable escaped/constant diagnostic, raw payload 부재 assertion이 없다.
   - Required by: `audit/audit-1.md:250` — RF-20(d)의 root identity 검증 뒤 “**각 경로 fail-closed/무-effect/무-raw-payload 테스트**.”
   - Actual: `src/craft/run-check.ts:348-372`의 현재 구현은 feature와 persisted `target.root`를 `JSON.stringify`해 핵심 payload를 escape하지만, 테스트는 그 계약을 방어하지 않는다. raw payload echo를 재도입해도 현재 assertions는 통과할 수 있다.
   - Remediation: non-slug와 foreign persisted-root 각각에 control-carrying marker/newline payload를 넣고, raw marker/newline이 result text에 없으며 escaped 또는 constant diagnostic만 존재함을 assert한다. exec 호출 수 0, foreign script/log bytes 불변, log directory 미생성을 함께 assert해 fail-closed·무-effect·무-raw 세 속성을 각 경로에서 독립 고정한다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 실제 4-file E2E는 provider token과 장시간 subprocess를 소비하므로 이 lane에서 실행하지 않았다. main session의 cycle-fresh deterministic check 결과에도 의존하지 않았다.
- 실제 global plugin slot을 regular file/directory로 바꾸는 재현은 read-only 감사 제약과 사용자 환경 훼손 위험 때문에 수행하지 않았다. 대신 현재 실행 binary(`omp/18.0.11`)의 exact manager/CLI source를 직접 읽어 실패 경계를 판정했다.
- RF-19의 state durability semantics와 RF-20(a–c)의 보안 의미론은 이 lane에서 전수 재감사하지 않았다. RF-20(d)는 infra/path surface와 fix-delta test 의무에 한해 조사했다.
- full build, lint, 전체 Vitest/Bun suite는 배치 제약에 따라 실행하지 않았다. scoped unit tests와 E2E collection만 실행했다.
- `trace.md`와 plan appendix는 원 문제 framing이나 ADR 상세가 이 lens의 RF 판정에 필요하지 않아 열지 않았다.
