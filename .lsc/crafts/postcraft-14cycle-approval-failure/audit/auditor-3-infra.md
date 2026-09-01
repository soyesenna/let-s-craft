**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ de596dbc625149962988246b748a4facd8899ad4 · audit cycle 3

## Lens

인프라·설정 (④) — E2E 하니스, fixture, subprocess 배선, 설치 `omp` 경계, 패키징/설정 경로를 포함한 전체 fix delta.

우선 반증 질문: **"check-6의 E2E red 3건(full-cycle subprocess timeout / preset-default:235 tracerAgent undefined / red-continuation:248 taskSpawnCount 0)은 어느 것도 RF-22/28/29 fix 자신이 새로 만든 테스트 결함이 아니다" — 이 주장을 반증하라.**

## Expected State

코드/diff를 열기 전에 `spec.md`, `plan.md`, 직전 Required Fix 원문만으로 다음을 고정했다.

| 요구 | 정본 좌표 | 기대 observable / boundary / error state | 검증법 |
|---|---|---|---|
| RF-22 regular-file link slot | `audit/audit-2.md:180` | helper가 **regular file만** 명시적으로 제거하고 `EACCES`/`EPERM` 등 제거 오류는 전파한 뒤 실제 설치 `omp plugin link REPO_ROOT`를 호출한다. fake는 slot을 대신 지우지 않는다. 성공한 모든 branch가 `realpath`와 `BUILD_INFO.gitHash`를 재검증한다. real-`omp` 회귀는 temp HOME뿐 아니라 config/XDG/profile 경로까지 격리하여 사용자 상태를 쓰지 않는다. | helper 본문, fake, real-`omp` test env, 설치 `omp`의 plugin-root resolution을 직접 대조하고 check-6의 test 실행 기록을 확인한다. |
| RF-28 early-exit 표본 시점 | `audit/audit-2.md:186`; `plan.md:413,422` | with-commit 경로는 B 후손의 test/check commit이 실제 존재한 뒤에만 early exit한다. 정당한 no-commit 경로는 subprocess 자연 종료 후, §3.0 worker가 실행됐고 B에서 fresh check evidence가 생겼음을 단언한다. **no commit은 no spawn을 뜻하지 않는다.** | predicate와 양 branch를 읽고, §3.0 mandatory spawn 계약 및 check-6의 `taskSpawnCount` 관측을 대조한다. |
| RF-29 routing 전제 | `audit/audit-2.md:187` | 기존 check-3→4 변동의 원인을 보존된 session JSONL로 판별하고, explicit `models.yaml` entry가 로드·적용됐다는 결정적 관측 또는 sentinel 기반 routing-source 판별이 선행한다. host 결함이면 원시 증거를 보존·회부하며, optional/불안정 메타데이터를 새 deterministic gate로 만들지 않는다. | JSONL parser/단언 순서를 host의 persisted schema와 대조하고 check-6 failure 위치가 원래 override 단언 전인지 확인한다. |
| 기존 E2E 회귀 | `spec.md:95`; `plan.md:452` | 신규 두 suite뿐 아니라 기존 E2E 전체가 canonical command에서 green이어야 한다. | E2E 재실행 없이 cycle-fresh `check-6.log`의 exit/test count와 세 failure를 코드에 귀속한다. |
| 인프라 안전성 전체 sweep | `audit/audit-2.md:182-187` | lifecycle wrapper는 untrusted persisted identity/config를 effect 전에 검증하고, result/log text에 control payload를 raw로 내보내지 않는다. 변경된 테스트는 production seam을 숨기지 않는다. | 11-file fix delta 전체와 설치 `omp` seam, check-6의 Vitest/E2E 결과를 대조한다. |

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

**반증 성공.** 세 red 중 `preset-default`는 RF-29가 새로 도입한 hard precondition 자체가 actual host에서 성립하지 않아 원래 override 단언 전에 실패했다. 따라서 “셋 모두 fix 자신이 만든 결함이 아니다”라는 주장은 거짓이다.

| check-6 red | 귀속 판정 | 근거와 결론 |
|---|---|---|
| `e2e-full-cycle` post-craft timeout | **(b) 관측 대상 subprocess/LLM liveness**; RF fix 자체 결함으로는 판별되지 않음 | `check/logs/check-6.log:661-685`는 `exitCode=null timedOut=true`만 남긴다. 기존 assertion은 `test/e2e-full-cycle.test.ts:67,237-241`의 25분 bounded timeout이고 RF delta가 이 파일을 바꾸지 않았다. 직전 check-4에서는 같은 기존 suite가 green이었다. 정확한 stall 원인은 로그에 last tool/message가 없어 미확정이며 provider/LLM 진행 문제라는 귀속은 **[INFERENCE]**다. |
| `e2e-preset-default:235` `tracerAgent === undefined` | **(a)+(c) RF-29 신규 assertion 결함 / RF-29형 비결정 축 재발** | 새 code `test/e2e-preset-default.test.ts:231-240`가 `session_init.agent`를 hard prerequisite로 만들었고, check-6은 바로 이 줄에서 `undefined`로 실패했다(`check/logs/check-6.log:692-710`). 설치 host schema는 `agent?: string`인 optional field다. 이 실패는 explore override가 적용됐는지 또는 host routing이 override를 무시했는지를 판별하지 못하고 원래 단언 전에 끝난다. |
| `e2e-red-cycle-continuation:248` `taskSpawnCount === 0` | **(b) 관측 대상 post-craft/LLM orchestration 위반**; RF-28 assertion은 계약상 정당 | `skills/post-craft/SKILL.md:88-93`는 매 cycle §3.0에서 `lsc-test-engineer`를 `task`로 spawn하도록 명령한다. `test/e2e-red-cycle-continuation.test.ts:248-273`은 spawn을 먼저 요구하고, 그 뒤에만 with-commit/no-commit을 나눈다. 따라서 “정당한 무커밋 완료”는 worker가 실행됐지만 변경할 것이 없어 commit이 없는 경우이지 spawn 0이 아니다. check-6의 `expected 0 to be >= 1`(`check/logs/check-6.log:717-722`)은 관측 대상이 §3.0을 수행하지 않았다는 유효한 red다. |

### RF-22 / RF-28 / RF-29 적용 판정

| RF | 판정 | 직접 근거 | 결론 |
|---|---|---|---|
| **RF-22** | **부분 적용** | Production helper의 regular-file 제거·오류 전파·실제 link 진입·후검증은 `test/e2e-helpers.ts:100-126`에 존재한다. fake는 더 이상 선행 제거하지 않는다(`test/e2e-helpers.test.ts:497-510`). 그러나 real-link test는 `HOME`만 바꾸고 inherited config/XDG/profile env를 그대로 넘긴다(`test/e2e-helpers.test.ts:522-531`). | Production 동작과 red-sensitive fake는 완전하다. 하지만 Required Fix에 포함된 **temp HOME/config hermetic real-omp 회귀**가 완전하지 않다. RF-18→RF-22 삼차 부분 적용 경계가 발동한다. |
| **RF-28** | **완전 적용** | Predicate는 B 후손의 test/check commit 존재까지 기다린다(`test/e2e-red-cycle-continuation.test.ts:195-228`). 자연 종료 no-commit branch는 mandatory spawn과 newer check log를 요구한다(`:248-273`). | check-6 red는 조기 표본 결함이나 no-commit 오해가 아니라 subprocess가 mandatory §3.0 spawn을 수행하지 않은 관측이다. 다만 canonical deterministic-check 결과 자체는 red라 bundle-level PASS는 될 수 없다. |
| **RF-29** | **부분 적용** | Parent `model_change` 관측은 추가됐으나, routing 판정은 optional `session_init.agent` hard assertion에 의존한다(`test/e2e-preset-default.test.ts:144-155,223-247`). check-6은 tracer field 부재로 원래 explore override 단언 전에 실패한다. | 기존 원인 판별과 deterministic prerequisite 고정이 완료되지 않았다. 새 precondition이 별도 비결정 축이 됐다. |

## Findings

1. **수정 · MAJOR** — RF-24의 foreign persisted identity diagnostic이 DEL(U+007F)을 raw로 방출하여 RF-20계열이 삼차 부분 적용됐다.
   - Evidence: `src/craft/run-check.ts:381-384` — ``identity ${JSON.stringify(claimed)}``; `src/craft/tool-text.ts:35-45` — “`JSON.stringify` … leaves raw — DEL (U+007F)”이며 이를 막기 위해 `controlSafeEcho()`가 `replace(/\u007f/g, "\\u007f")`를 수행한다.
   - Required by: `audit/audit-2.md:182` — “`foreign-root control-payload의 escaped 단언(④ Finding 2의 무-raw-payload 의무 병합)`”.
   - Actual: Wrapper ordering과 identity equality는 구현됐지만 mismatch result가 여전히 bare `JSON.stringify(claimed)`를 사용한다. Newline fixture는 JSON escaping으로 통과하나 persisted `projectRoot`/`worktreeRoot`의 DEL은 result text에 그대로 남는다. RF-23에서 같은 blind spot을 고치려고 만든 shared helper를 RF-24 seam이 사용하지 않았다.
   - Remediation: `claimed` 및 untrusted persisted path echo를 `controlSafeEcho()`로 통일한다. Captured production execute 회귀를 `feature/projectRoot/worktreeRoot × newline/tab/ESC/DEL`로 확장하여 모든 case에서 single-line, C0/DEL-free text, zero exec/log-write를 고정한다.

2. **보완 · MAJOR** — RF-22 real-`omp` regression은 temp HOME만 설정해 inherited XDG/config routing이 사용자 plugin state를 오염할 수 있으므로 hermetic하지 않다.
   - Evidence: `test/e2e-helpers.test.ts:522-531` — `env: { ...process.env, HOME: home }`; 설치 host `~/.bun/install/global/node_modules/@oh-my-pi/pi-utils/src/dirs.ts:339-360,606-615` — 기존 `$XDG_DATA_HOME/omp`가 있으면 resolver가 이를 선택하고 production `getPluginsNodeModules()`는 그 root를 사용한다. 설치 `omp`의 `manager.ts:784-818`은 그 경로에 symlink와 runtime config를 쓴다.
   - Required by: `audit/audit-2.md:180` — “`temp HOME/config 기반 hermetic real-omp non-symlink 회귀를 추가하라`”.
   - Actual: 현재 check-6에서 real-link test 자체는 통과했다(`check/logs/check-6.log:154-160`) and helper core는 올바르다. 그러나 test child는 user `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`, `OMP_PROFILE`/`PI_PROFILE`, `PI_CONFIG_DIR` 등을 상속한다. 특히 pre-existing XDG app root가 있으면 real `omp`가 temp slot 대신 user XDG plugin slot/lockfile을 변경한 뒤 helper postcheck가 실패할 수 있다. Check-6은 user 경로의 before/after bytes를 기록하지 않아 “사용자 환경 무오염”을 증명하지 않는다.
   - Remediation: child env를 allowlist로 구성하거나 `HOME`과 모든 `XDG_*`를 같은 temp tree로 고정하고 profile/config override를 제거한다. 실제 host가 선택할 plugin root를 temp slot과 일치시키며, real user plugin symlink/lockfile의 before/after 불변도 단언한다.

3. **수정 · MAJOR** — RF-29가 optional host metadata를 deterministic routing prerequisite로 승격해 원래 override 결함을 판별하기 전에 새 flake를 만들었다.
   - Evidence: `test/e2e-preset-default.test.ts:231-247` — `tracerAgent`/`exploreAgent`를 각각 exact agent name으로 hard assert한 뒤에만 explore model을 단언한다. `check/logs/check-6.log:692-710` — tracer 값이 `undefined`라 첫 hard assert에서 종료했다. 설치 host `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/session/session-entries.ts:210-221` — persisted schema는 `agent?: string`이다.
   - Required by: `audit/audit-2.md:187` — “`explore override 미적용의 근인을 캡처된 sessionInventory/jsonl로 판별하고, 단언 전 explicit models.yaml entry 적용의 결정적 전제(설정 로드 완료 관측 또는 sentinel 모델명 기반 라우팅 소스 판별)를 고정하라`”; “`host(omp) 측 라우팅 결함으로 판명되면 그 증거를 감사 문서에 회부하고 테스트는 결정적 전제 위에서만 단언하게 하라`”.
   - Actual: Parent default `model_change`는 preset file의 default가 적용됐다는 것만 보이며, explicit `lsc-explore` entry가 validation을 통과해 `task.agentModelOverrides`에 들어갔다는 사실은 관측하지 않는다. 새 `session_init.agent` gate는 actual host run에서 부재했고, 그것이 metadata omission인지 wrong route인지 구분할 raw entry도 failure output에 없다. 따라서 check-3→4 원인은 여전히 판별되지 않았고 새 assertion이 별도 red를 만들었다.
   - Remediation: optional `session_init.agent`을 hard authority로 쓰지 않는다. Parent `task` execution input처럼 exact requested agent를 보존하는 stable event를 읽거나, explicit agent별 sentinel model을 seed하여 routing source와 적용 key를 함께 판별한다. `lsc-explore` override key가 실제 applied map에 들어갔다는 관측을 추가하고, host defect 시 raw `session_init`/task routing evidence를 cleanup 전에 failure text 또는 durable artifact에 남긴 뒤에만 model precedence를 단언한다.

4. **보완 · MAJOR** — frozen OID는 AC-8의 “기존 E2E 전체 green”을 충족하지 못한다.
   - Evidence: `.lsc/crafts/postcraft-14cycle-approval-failure/check/logs/check-6.log:319-322` — `Test Files 3 failed | 1 passed`; 세 상세 failure는 `:661-722`에 있다.
   - Required by: `spec.md:95` — “`AC-8 E2E [결정적/E2E]: fixture E2E에 다중 사이클(REJECT 반복→에스컬레이션→처분) 시나리오 신설 + 기존 E2E 전체 green.`”
   - Actual: Audit-escalation 3 cases만 green이고 full-cycle timeout, RF-29 prerequisite failure, continuation의 mandatory spawn 부재가 남았다. RF-28 코드 적용이 완전하다는 국소 판정은 canonical command가 red라는 release-level 사실을 상쇄하지 않는다.
   - Remediation: 위 RF-22/RF-24/RF-29 결함을 고치고, full-cycle session/progress evidence를 보존해 post-craft liveness 원인을 수리하며, continuation process가 §3.0 mandatory spawn을 실행하도록 orchestration/fixture 경로를 교정한다. 이후 새 cycle의 exact canonical check가 exit 0이어야 한다.

**REJECT 근거:** Finding 1은 RF-20→RF-24, Finding 2는 RF-18→RF-22의 **삼차 부분 적용**이다. 공유 계약은 어느 한 계열이라도 다시 부분 적용되면 측정 반증 여지 없이 REJECT하도록 명시한다. RF-29도 별도로 부분 적용이며 canonical deterministic check는 exit 1이다. 심각도 자체는 각 MAJOR로 유지하고, 반복 경계가 lane verdict를 REJECT로 올린다.

## Adversarial Classes

N/A — not owned by this lens

## What's Missing

- 지시대로 E2E, formatter, lint, build, project-wide suite를 재실행하지 않았다. 실행 판정은 cycle-fresh `check-6.log`와 코드/설치 host source 읽기에 한정된다.
- Check-6의 temp session directory는 test cleanup 뒤 보존되지 않았고 failure text는 task 문자열만 싣는다. 실제 `session_init` object 전체, parent `task` call args, runtime override map이 없어 `agent` 누락의 host 내부 원인까지는 확정하지 못했다.
- Full-cycle timeout summary는 last tool/message가 비어 있어 post-craft가 어느 단계에서 멈췄는지 판별할 수 없다. Preserved JSONL/process trace가 필요하다.
- RF-22 test가 실제 check-6 실행 중 user XDG/plugin bytes를 바꾸었는지는 before/after 관측이 없어 미측정이다. Finding은 설치 host의 경로 선택 코드와 inherited env로 증명되는 hermeticity 결함이며, 실제 오염 발생 주장과 구분한다.
- `check/run_check.sh`와 package/build/CI wiring은 이번 fix delta에서 무변경이며 check-6은 script sha256 `87fe5a33…` unchanged를 기록했다. 따라서 새 패키징 산출물의 contents나 외부 CI runner는 별도로 검사하지 않았다.
