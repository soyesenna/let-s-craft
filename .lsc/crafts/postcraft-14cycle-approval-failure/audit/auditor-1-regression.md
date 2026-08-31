**AUDITOR VERDICT: APPROVE-WITH-CHANGE**
Reviewed: postcraft-14cycle-approval-failure @ fbc4c9c73237441d653e26c7a6a15456f8afc7b2 · audit cycle 1

## Lens

③ **회귀·코드품질 (regression and code quality)**

우선 반증 질문:

> RF-13의 slug/ISO/control-char validator는 일부 lifecycle 진입점에만 설치되고, 기존 tool text 보간 좌표나 land/abort/init 중 최소 한 곳은 여전히 미검증 입력을 지시문형 text에 보간하는가?

## Expected State (commit-first)

구현 코드를 기준으로 삼기 전에 `spec.md`·`plan.md`·audit-0 Required Fix에서 다음 기대 상태를 고정했다.

| 대상 | 기대 observable / boundary / error state | 검증 기준 |
|---|---|---|
| RF-5 재등록 durability | `setActiveCraft` 한 곳이 `releaseApproval`·`auditBaseSnapshot`을 보존하고, `lsc_craft_init` caller 보정은 없어야 한다. 유효한 v2/legacy state의 두 필드는 재등록 전후 동일해야 하며 same-cycle replay는 새 관측값이 아니라 persisted snapshot을 반환해야 한다. 기존 state를 decode하지 못하면 덮어쓰지 말고 fail-closed해야 한다. | audit-0 RF-5 (`audit/audit-0.md:223`), plan PR-1 step 6·acceptance (`plan.md:181-195`), AC-10 (`spec.md:97`) |
| RF-9 seed hygiene | 모든 `seedCraftedFeature` 변형은 state 생성 전에 feature worktree 자체 `.gitignore`에 두 sidecar pattern을 설치·커밋해야 한다. 이후 `git add -A`에도 state/log가 추적되지 않고 두 path가 각각 ignore-match되어야 한다. | audit-0 RF-9 (`audit/audit-0.md:227`) |
| RF-13 lifecycle boundary | resolved feature는 모든 lifecycle tool에서 kebab slug여야 하며, 어떤 fs/git effect보다 먼저 거부되어야 한다. `createdAt`/`decidedAt`류 persisted timestamp는 canonical ISO여야 한다. `feature`, `baseBranch`, `disposition`, reason, persisted path/text field의 newline·control char는 raw tool text로 도달하지 않아야 한다. | audit-0 RF-13 (`audit/audit-0.md:230`) |
| Post-resume consistency | retry/fresh process에서 durable evidence가 같은 의미를 유지하고, same-cycle replay는 immutable audit-time observation임을 명확히 보여야 한다. re-registration은 on-disk evidence를 소거하거나 현재 Git 관측으로 가장해서는 안 된다. | plan Principles/Drivers (`plan.md:69-78`), PR-1 acceptance (`plan.md:194-195`) |
| 하위 호환 | 신규 state field는 optional이고 field-less legacy/current v2 파일은 읽혀야 한다. 기존 정상 feature slug는 새 validator로 차단되지 않아야 한다. | `spec.md:65`, AC-10 `spec.md:97`, `plan.md:42` |

## Priority Falsification Question

**답: 우려는 성립한다. RF-13은 부분 적용됐다.**

안전하게 닫힌 부분은 확인됐다.

- `FEATURE_SLUG_RE`는 shared SSOT다 (`src/artifacts/paths.ts:96-104`).
- `lsc_craft_init`은 resolved feature를 fs access 전에 검사한다 (`src/craft/init.ts:63-76`).
- exact-root abort의 feature와 `lsc_land`의 feature도 core 진입 직후 검사한다 (`src/craft/abort.ts:37-46`, `src/craft/land.ts:219-228`).
- audit escalation record의 `createdAt`·`decidedAt`은 `Date#toISOString()` exact round-trip으로 검사된다 (`src/craft/audit-policy.ts:158-188`).
- canonical disposition 세 값만 정상 record로 파싱된다 (`src/craft/audit-policy.ts:187-201`).

그러나 다음 잔존 경로가 우선 반증 질문을 입증한다.

| 보간 field / 경로 | 관측 | 판정 |
|---|---|---|
| `base_branch` | schema가 plain `z.string()`이고, production wrapper가 core slug guard에 도달하기 전에 `resolveAuditRoot`와 `observeAuditBase`를 실행한다 (`src/craft/verdict.ts:588-633`). Raw `baseBranch`는 snapshot에 저장되고 WARN/Base text에 보간된다 (`src/craft/verdict.ts:343-378`). | 미검증 |
| noncanonical `escalation_disposition` 및 forged persisted field | invalid label과 forged record `feature`를 `String(...)`으로 raw error text에 넣고, wrapper 결과가 그 message를 그대로 반환한다 (`src/craft/audit-policy.ts:169-176,183-201,431-451`; `src/craft/verdict.ts:434-438`). | 미검증 |
| persisted terminal | land는 escalation ledger parser를 거치지 않고 `terminal.disposition`·`terminal.decidedAt`을 raw text에 넣는다 (`src/craft/land.ts:293-320`). | 미검증 |
| abort `reason` | plain `z.string()`이며 state를 abort한 뒤 reason을 raw 결과 text에 보간한다 (`src/craft/abort.ts:56-69,77-93`). | 미검증 |
| `lsc_run_check` feature/path | resolved feature에 slug guard가 없고 persisted root identity도 검증하지 않은 채 fs lookup·script execution·결과 text에 사용한다 (`src/craft/run-check.ts:312-323,343-411,415-443`). | validator 자체 부재 |

따라서 `audit-policy.ts`의 question composer에 도달한 **정상 feature** 자체는 안전해졌지만, production wrapper의 `base_branch`, invalid-disposition error, land replay/terminal, abort reason, run-check 경계는 닫히지 않았다.

## Compliance Matrix

N/A — this lens contributes findings only

## Required Fix Verification

| Required Fix | 적용 완전성 | Evidence | 판정 메모 |
|---|---|---|---|
| RF-5 | **부분 적용** | 중앙 preservation list: `src/craft/state.ts:255-271`; caller-side 전달 제거: `src/craft/init.ts:107-109`; replay test: `test/craft-verdict.test.ts:1047-1065` | 유효한 v2 state의 두 field 보존과 persisted replay는 구현됐다. 다만 strict re-registration이 decode error를 삼켜 기존 state를 덮어쓰는 부수 회귀가 있고, 회귀 test는 byte-equivalence가 아니라 deep equality만 단언한다. |
| RF-9 | **적용됨 — 비차단 test 보완 필요** | ignore 설치·선행 commit·`git add -A`·후속 probe: `test/e2e-helpers.ts:649-697`; 두 caller: `test/e2e-audit-escalation.test.ts:80-92`, `test/e2e-red-cycle-continuation.test.ts:126-132` | escalation 변형과 red-check 변형 모두 같은 helper를 통과한다. 현재 worktree read-only probe에서도 두 pattern이 각각 match되고 sidecar는 `git ls-files` 결과가 비어 있었다. 단, helper 내부의 한 번짜리 multi-path `check-ignore -q`는 두 path 각각을 증명하지 못한다. |
| RF-13 | **부분 적용 / blocking** | shared slug: `src/artifacts/paths.ts:96-104`; ISO: `src/craft/audit-policy.ts:158-201`; 잔존 표면은 Findings 2·3 | feature guard 일부와 escalation timestamp validator는 적용됐지만 lifecycle·tool-text field 전수가 아니다. |

## 부수 회귀 점검

- worktree의 기존 craft directory 7개를 열거했으며 모두 shared regex가 허용하는 kebab slug였다. 확인한 정상 feature명에서는 과차단 근거가 없었다.
- `decodeCraftState`는 field-less legacy state와 current v2 state를 계속 허용한다 (`src/craft/state.ts:185-218`; `test/craft-state-version.test.ts:119-205`). ISO 검사는 escalation field가 존재할 때만 적용되므로 field-less legacy state bootstrap은 유지된다.
- valid same-cycle replay는 persisted `auditBaseSnapshot`을 반환하고 새 관측을 덮어쓰지 않는다 (`src/craft/verdict.ts:540-558`; `test/craft-verdict.test.ts:1047-1065`).
- terminal/abort의 `invalidatePreparedOperation` 추가는 terminal record persist 이후 수행되고 정상 Continue path에는 들어가지 않는다 (`src/craft/verdict.ts:510-535`; `src/craft/abort.ts:54-69`). 이 범위에서 기존 정상 path를 과차단하는 분기는 찾지 못했다.
- f2537ed의 plugin pin fix는 기존 link가 있는 현재 환경에서는 target이 frozen worktree로 향함을 `readlink`로 확인했다. 반면 link가 아예 없는 환경의 선행 `readlinkSync` 실패는 Findings 4에 기록했다.
- ad0b380은 production source를 바꾸지 않고 land regression test만 추가했다. 해당 delta에서 production side effect는 없었다.

## Findings

1. **수정 · MAJOR** — RF-5의 caller-side read 제거 후 strict re-registration이 undecodable/future-version state를 fail-closed하지 않고 새 state로 덮어써 durable evidence를 소거한다.
   - Evidence: `src/craft/state.ts:203-217` — `decodeCraftState`는 newer `stateVersion`에 명시적으로 throw한다.
   - Evidence: `src/craft/state.ts:255-279` — preservation decode의 모든 예외를 `catch {}`로 삼킨 뒤 `persist(next)`를 실행한다: `"An undecodable existing file never blocks activation"`.
   - Evidence: `src/craft/init.ts:107-109` — 이전 별도 reader 없이 strict `setActiveCraft(...)`만 호출한다.
   - Required by: audit-0 RF-5 — “보존 authority를 한 곳으로”; plan driver — “fresh-process/v2 legacy 안전” (`plan.md:76-78`).
   - Actual: 정상 v2에서는 중앙 preservation이 작동하지만, malformed JSON이나 이 build보다 newer state는 보존 authority가 decode 실패를 숨기고 같은 path에 v2 state를 새로 쓴다. RF-5 전에는 `init.ts`의 선행 `readPersistedCraftState`가 이 오류를 밖으로 전파했으므로 fix delta가 만든 회귀다.
   - Remediation: `setActiveCraft`의 preservation read 오류를 최소한 `durability: "strict"`에서는 persist/publish 전에 그대로 전파한다. best-effort에서도 decode하지 못한 기존 파일을 덮어쓰지 않도록 disk write를 생략하거나 명시적으로 실패시킨다. future-version 및 malformed state를 seed한 actual `lsc_craft_init`/strict `setActiveCraft` test에서 state bytes 불변과 active singleton 미등록을 단언한다.

2. **보완 · MAJOR** — RF-13의 control-character 방어가 `base_branch`, invalid disposition/record error, abort reason, persisted terminal text에 적용되지 않아 fail-closed 결과 자체가 prompt-injection carrier가 된다.
   - Evidence: `src/craft/verdict.ts:588-633` — `base_branch`는 plain string이고 core guard 전에 base observation을 수행한다.
   - Evidence: `src/craft/verdict.ts:343-378` — raw `baseBranch`를 snapshot과 WARN/Base text에 보존·보간한다.
   - Evidence: `src/craft/audit-policy.ts:169-176,183-201,431-451` — forged `recordFeature`와 noncanonical `disposition`을 `String(...)`으로 error message에 넣는다.
   - Evidence: `src/craft/abort.ts:56-69,77-93` — `reason`을 검증 없이 durable abort 이후 raw text로 반환한다.
   - Evidence: `src/craft/land.ts:293-320` — strict audit evidence check 뒤 escalation ledger validation 없이 persisted terminal label/timestamp를 raw 보간한다.
   - Required by: audit-0 RF-13 — “tool text 보간 필드의 newline/control char 거부 + fail-closed 테스트.”
   - Actual: newline-bearing input은 정상 record로 소비되지 않더라도 error/tool text에 그대로 재방출될 수 있다. `base_branch`는 unknown snapshot으로 durable persist된 뒤 success/replay text에서 반복 방출될 수 있고, land는 audit-begin validator를 우회해 forged terminal text를 직접 읽는다.
   - Remediation: lifecycle shared boundary에 control-character-free string validator를 두고 `base_branch`·`escalation_disposition`·abort `reason`을 effect 전에 검사한다. invalid persisted value를 error에 넣을 때 raw `String`을 쓰지 말고 constant diagnostic 또는 escaped representation을 사용한다. replay/land에는 `AuditBaseSnapshot` 및 terminal record runtime parser를 적용해 canonical label, safe cycle, canonical ISO, control-free ref/error를 검증한 뒤에만 보간한다. captured production wrapper, same-cycle replay, direct land, abort 양 path의 fail-closed/no-effect/no-raw-payload tests를 추가한다.

3. **추가 · MAJOR** — `lsc_run_check`에는 RF-13 feature validator가 전혀 없고 persisted root를 invocation anchor로 검증하지 않아 malformed feature/path가 fs·trusted exec·tool text에 도달한다.
   - Evidence: `src/craft/run-check.ts:312-323` — persisted `worktreeRoot ?? projectRoot`를 그대로 run root로 선택하고 raw feature를 refusal text에 넣는다.
   - Evidence: `src/craft/run-check.ts:343-411` — 그 root로 script path를 만들어 `existsSync`/`readFileSync`/trusted `exec`를 수행하고 path·feature를 결과 text에 보간한다.
   - Evidence: `src/craft/run-check.ts:415-443` — wrapper는 `resolveFeatureName` 직후 `findPersistedCraftState`를 호출하며 `FEATURE_SLUG_RE` guard가 없다.
   - Required by: audit-0 RF-13 — “lifecycle tool 경계에서 resolve된 feature 입력에 kebab-slug validator 적용”; 같은 RF의 path/control-char 방어.
   - Actual: `bad\nfeature` 같은 resolved name은 state lookup 후 raw refusal text까지 갈 수 있다. 또한 candidate state 내부의 root identity가 forged되면 expected `ctx.cwd`/`worktreePath`가 아니라 persisted path에서 check script를 읽고 실행한다.
   - Remediation: wrapper와 directly testable core의 첫 줄에서 shared slug/control validator를 적용하고 어떤 state lookup보다 먼저 거부한다. persisted state는 `{feature, projectRoot, worktreeRoot}`를 `ctx.cwd`와 computed worktree path에 exact-match시킨 뒤 candidate root를 authority로 사용한다. malformed feature·newline path·identity mismatch에서 fs/exec call count 0과 escaped constant error를 단언한다.

4. **보완 · MAJOR** — f2537ed의 E2E plugin pin은 global link가 이미 존재한다고 가정해 fresh environment에서는 link를 생성하기도 전에 실패한다. `(outside lens)`
   - Evidence: `test/e2e-helpers.ts:52-55` — 첫 동작이 `readlinkSync(GLOBAL_PLUGIN_LINK)`이고, 불일치일 때만 이후 `omp plugin link`를 호출한다.
   - Required by: audit-0 RF-4 — per-run link 재설정으로 global link 암묵 의존을 제거하고 child spawn 전에 fail-fast할 것.
   - Actual: [INFERENCE] link path가 없는 정상 fresh CI/dev environment에서는 `readlinkSync`가 `ENOENT`를 throw하므로 `omp plugin link`에 도달하지 못한다. 이는 잘못된 plugin을 통과시키지는 않지만 E2E를 infrastructure failure로 만든다.
   - Remediation: missing/broken link를 정상 “not pinned” 상태로 처리해 먼저 `omp plugin link REPO_ROOT`를 실행하고, 그 뒤 `realpathSync`와 build hash를 검증한다. missing link, broken symlink, foreign link, correct link 네 case를 isolated test로 고정한다.

5. **보완 · MINOR** — RF-5 회귀 test의 이름·주석은 byte-equivalence를 약속하지만 실제 assertion은 parsed object deep equality뿐이다.
   - Evidence: `test/craft-verdict.test.ts:1050-1065` — 재등록 후 `auditBaseSnapshot`과 `releaseApproval`에 `.toEqual(...)`만 사용하며 raw pre/post bytes를 읽지 않는다.
   - Required by: audit-0 RF-5 — “두 필드 byte-equivalent”.
   - Actual: value/shape 손실은 잡지만 object key order나 field serialization 변경은 잡지 못한다. 현재 implementation은 기존 nested object를 그대로 보존하므로 observable behavior는 맞지만 요구된 강도의 regression pin은 아니다.
   - Remediation: 재등록 전후 raw state에서 두 field의 serialized representation을 추출해 exact `.toBe`로 비교하고, same-cycle replay 뒤 전체 state bytes도 불변임을 같은 test에 단언한다.

6. **보완 · MINOR** — RF-9의 `git check-ignore` guard는 두 path를 한 번의 quiet 호출에 넣어 “둘 다 ignored”를 증명하지 못한다.
   - Evidence: `test/e2e-helpers.ts:691-696` — `git check-ignore -q statePath logPath` 한 번만 실행한다.
   - Required by: audit-0 RF-9 — state와 `check/logs/` 두 sidecar pattern의 matching assertion.
   - Actual: Git은 여러 path 중 하나라도 ignored면 success를 반환한다. read-only 판별 probe에서도 ignored state path와 non-ignored `src/main.ts`를 함께 넘긴 호출이 성공하고 ignored path만 출력됐다. 현재 installer는 두 entry를 모두 쓰지만, 한 pattern이 회귀해도 이 guard는 통과할 수 있다.
   - Remediation: state path와 representative log path에 `git check-ignore -q`를 각각 호출하거나 verbose output을 path별 exact set으로 비교한다.

7. **삭제 · MINOR** — audit-0에서 지적된 두 orphan helper가 그대로 남아 있다.
   - Evidence: `test/e2e-helpers.ts:700-702` — `toolCallSummaries` export는 repo search에서 선언 외 caller가 없다.
   - Evidence: `src/craft/state.ts:359-377` — `recordAuditCycleBegin`은 production caller가 없고 `applyAuditBeginOutcome`가 begin write authority를 대체했으며, 남은 caller는 test뿐이다.
   - Required by: 이번 점검 항목의 audit-0 MINOR cleanup 관측; acceptance를 막는 항목은 아니다.
   - Actual: 동작 결함은 없지만 두 번째 convention/obsolete seam이 유지된다.
   - Remediation: `toolCallSummaries`를 제거한다. `recordAuditCycleBegin` test를 `applyAuditBeginOutcome({kind:"audit-cycle"})`로 이관한 뒤 export와 구현을 제거하되, 외부 package export 여부를 먼저 확인한다.

## Adversarial Classes

- **post-resume state consistency — applied (관측 제공; 최종 합성은 main 소관)**
  - 정상 관측: `setActiveCraft`의 한 preservation list가 `releaseApproval`·`auditBaseSnapshot`을 보존하고 (`src/craft/state.ts:255-271`), replay는 새 snapshot 대신 persisted snapshot을 명시적으로 반환한다 (`src/craft/verdict.ts:540-558`). audit-time snapshot이 현재 Git 현실과 달라져도 text가 “already begun / idempotent replay”라고 표시하고 land는 별도로 재검증하므로 이 불일치 자체는 설계된 historical observation이다.
  - 결함 관측: strict re-registration이 decode error를 삼킨 뒤 state를 덮어써 durable evidence와 on-disk reality를 소거할 수 있다 (`src/craft/state.ts:255-279`; Finding 1).
  - 승인 evidence 관측: re-registration 첫 단계의 `invalidatePendingApproval()` 때문에 preserved `releaseApproval`은 durable trace일 뿐 live nonce authority가 아니다. 이 둘의 차이는 의도된 authority separation이다.

- **prompt-injection surface — applied (관측 제공; 최종 합성은 main 소관)**
  - 실제 잔존 표면: raw `base_branch`, invalid disposition/record field, abort reason, terminal timestamp, run-check feature/path가 tool text 또는 trusted path에 도달한다 (Findings 2·3).
  - test fixture 관측: `test/audit-policy.test.ts:479-481`의 `"ignore previous instructions"`는 명시적으로 malformed `decidedAt` data 안에 갇힌 fixture이며 canonical ISO validator가 이를 거부한다. 이 fixture literal 자체는 runtime steering authority가 아니지만, 동일 형태가 다른 raw error field에서는 escaped/constant 처리되지 않는다는 차이를 드러낸다.
  - audit question의 정상 feature/option/cycle interpolation은 shared slug·enum·safe integer를 통과해 이 범위에서는 추가 finding이 없다.

## What's Missing

- 명시된 동시 실행 금지에 따라 이 worktree에서 `npm test`, `npm run build`, `npm run test:bun`, `npm run e2e`, `run_check.sh`를 실행하지 않았다. 이 보고서는 code/diff/read-only Git probe 증거이며 main의 cycle-fresh deterministic check 결과를 대신하지 않는다.
- future-version state overwrite를 실제 temp repo에서 재현하지 않았다. 감사의 read-only 제약 때문에 파일 생성·state mutation을 하지 않았으며, Finding 1은 현재 control flow의 직접 판독에 근거한다.
- global plugin link를 제거하거나 깨뜨리는 재현은 사용자 환경을 변경하므로 수행하지 않았다. Findings 4의 missing-link 결과는 `readlinkSync`의 선행 호출에 대한 [INFERENCE]이며, 현재 link가 frozen worktree를 가리키는 것만 read-only로 확인했다.
- OS-level `ctx.cwd` 자체에 newline/control char가 든 repository path, Git stderr에 외부 directive text가 든 경우는 runtime probe하지 않았다. 현재 code에는 이를 전역적으로 막는 path/text boundary가 없다.
- generated `dist` parity와 provider/OMP child의 실제 loaded module identity는 독립 검사하지 않았다.
- `trace.md`는 RF-5/9/13 및 회귀 판정에 필요한 confirmed requirement가 `spec.md`·`plan.md`·audit-0 Required Fix에 충분히 존재해 열지 않았다.
- `recordAuditCycleBegin`의 repo 내부 production caller 부재는 확인했지만, package 밖 소비자가 deep import하는지는 검사하지 않았다. 따라서 삭제 전 public export surface 확인이 필요하다.
