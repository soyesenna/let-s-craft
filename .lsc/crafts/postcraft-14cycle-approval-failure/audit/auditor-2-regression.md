**AUDITOR VERDICT: REJECT**
Reviewed: postcraft-14cycle-approval-failure @ 59a81811bd3fba3613761f7e3db6844b29681b04 · audit cycle 2 (fix-verification)

## Lens

③ **회귀·코드품질 (regression and code quality)**

우선 반증 질문:

> "RF-19의 strict 전파가 반대 방향 회귀를 만들었다: decode 실패 전파가 이제 legacy v2 필드-없는 정상 state의 bootstrap/관용 파싱 경로(spec AC-10, Constraint 3 '읽기 관용')까지 거부하거나, best-effort 경로의 생략이 정당한 write까지 삼킨다. 또한 RF-20(a)의 control-char-free validator가 정상 입력(예: 합법적 base_branch ref 형식, 긴 abort reason)을 과차단하거나 validator 적용 순서가 observeAuditBase 이전이 아니다."

## Expected State

diff/code를 열기 전에 다음 상태를 고정했다.

1. **RF-19 strict·best-effort 상태 전이**
   - Required by: `audit/audit-1.md:249` — strict decode 오류는 persist/publish 전 전파하고 기존 bytes를 덮어쓰지 않아야 하며, best-effort는 undecodable 파일만 disk-write 생략 또는 명시 실패해야 한다.
   - 기대 관측: malformed JSON/future-version은 strict `setActiveCraft`와 실제 `lsc_craft_init`에서 throw, bytes 불변, 새 singleton 미등록이다. missing/정상 legacy v2는 그대로 decode되고 정상 persist된다.
   - 경계: `spec.md:65,97`의 “신규 CraftState 필드 전부 optional + 구버전 상태 파일 관용 파싱”을 깨면 안 된다.
   - 검증법: `decodeCraftState`의 거부 조건, `setActiveCraft`의 catch→persist→publish 순서, 실제 init caller, legacy fixture와 RF-19 회귀 테스트를 직접 대조한다.

2. **RF-19 serialized exact 회귀 핀**
   - Required by: `audit/audit-1.md:249` — “재등록 전후 serialized representation exact 비교”.
   - 기대 관측: parsing/canonicalization으로 byte 차이를 지우지 않고, 보존 필드의 serialized representation과 replay 후 state bytes 불변을 exact assertion으로 고정한다.
   - 검증법: `test/craft-verdict.test.ts`의 실제 matcher와 비교 대상을 읽는다.

3. **RF-20(a) 입력 경계**
   - Required by: `audit/audit-1.md:250` — `base_branch`, `escalation_disposition`, abort `reason`의 shared control-free validator가 어떤 effect/observation보다 먼저 실행되어야 한다.
   - 기대 관측: 정상 single-line ref/revision expression과 길이 제한 없는 reason은 통과하고, control-carrying 값은 raw payload 없이 거부된다. 두 begin 인자는 `observeAuditBase`보다 먼저 검사된다.
   - 검증법: shared validator의 정확한 문자 범위와 세 caller의 호출 순서를 직접 읽고 production wrapper 테스트를 확인한다.

4. **RF-20(b)/(c) 미신뢰 persisted text**
   - Required by: `audit/audit-1.md:250` — invalid value의 raw `String()`을 constant/escaped diagnostic으로 바꾸고, terminal record는 canonical label·canonical ISO·control-free parser를 거친 뒤에만 보간한다.
   - 기대 관측: malformed ledger/snapshot/terminal의 어떤 field도 fail-closed tool result를 raw prompt carrier로 만들 수 없다.
   - 검증법: 모든 invalid-state diagnostic과 persisted replay interpolation을 추적한다.

5. **RF-20(d) `lsc_run_check`**
   - Required by: `audit/audit-1.md:250` — shared slug guard, persisted identity의 `ctx.cwd`/computed worktree exact match, fail-closed·무-effect·무-raw-payload 테스트가 필요하다.
   - 기대 관측: production wrapper가 state lookup 전에 feature를 검증하고, persisted `{feature, projectRoot, worktreeRoot}`가 invocation anchor와 맞지 않으면 script read/exec/log write 전에 거부한다.
   - 검증법: registered `execute`부터 `performRunCheck`까지 순서와 실제 테스트 seam을 함께 읽는다.

6. **적대 클래스**
   - Post-resume state consistency: strict resume 실패 시 disk와 published singleton이 갈라지지 않고, 정상 legacy resume는 보존 evidence를 잃지 않아야 한다.
   - Prompt-injection surface: tool parameter, persisted ledger/base snapshot, diagnostic, fixture의 지시풍 문자열이 later agent에게 raw instruction-shaped text로 승격되지 않아야 한다.

7. **fix delta 전체 회귀**
   - RF-16/17/18/21의 변경이 공유 E2E 하니스와 post-craft orchestration을 깨지 않아야 한다.
   - 검증법: fix delta 23파일과 base-to-tip diff를 스코프한 뒤, 변경 production seam·caller·테스트를 직접 읽는다.

## Compliance Matrix

N/A — this lens contributes findings only

## Priority Falsification Question

**답: 질문의 RF-19 반대 방향 회귀와 RF-20(a) 정상 입력 과차단은 반증됐다. 다만 인접 wrapper 경계와 RF-20의 나머지 raw/persisted 표면은 반증되지 않았고 실제 결함으로 남았다.**

- `src/craft/state.ts:209-217`의 decoder는 파일 부재를 `undefined`로 처리하고, 오직 numeric `stateVersion > CRAFT_STATE_VERSION`만 거부한다. 신규 optional field 부재는 거부하지 않는다.
- `src/craft/state.ts:261-304`에서 `undecodable`은 decode catch에서만 설정된다. missing/정상 legacy state는 `undecodable === undefined` 분기로 `persist(next)`를 실행하므로 best-effort 생략이 정당한 write를 삼키지 않는다. strict는 catch 즉시 throw해 persist와 `activeCraft = next`에 도달하지 않는다.
- `test/craft-state-version.test.ts:291-295`는 escalation field가 없는 v2/cycle-14 state를 관용 decode한다. `test/craft-state.test.ts:520-548`과 `test/craft-init.test.ts:184-205`는 malformed/future-version의 strict bytes 불변·singleton 미등록 및 best-effort memory-only activation을 직접 고정한다.
- `src/craft/tool-text.ts:15-29`의 validator는 C0+DEL만 거부하고 syntax/length 제한을 두지 않는다. 따라서 정상 single-line Git ref/revision expression과 긴 abort reason은 이 guard에서 과차단되지 않는다.
- `src/craft/verdict.ts:623-640`에서 두 named begin 인자는 `controlCharRefusalText(...)`를 통과한 뒤에만 `observeAuditBase`에 도달한다. `src/craft/abort.ts:35-43`도 reason을 어떤 abort/state lookup보다 먼저 검사한다.
- 그러나 production `lsc_audit_begin` wrapper의 **feature**는 `src/craft/verdict.ts:631-640`에서 root/Git observation을 거친 뒤 core의 `src/craft/verdict.ts:395-402`에서야 검사된다. `lsc_run_check`도 state lookup 뒤 core guard에 도달한다. 이는 아래 Findings 1·4다.
- strict 전파 자체에는 legacy bootstrap 회귀가 없지만, RF-19의 serialized-exact 테스트 의무는 canonicalization으로 약화됐다. 이는 Finding 5다.

## RF-19 / RF-20 판정

| Required Fix | 판정 | 근거 |
|---|---|---|
| RF-19 strict 전파 | **완전 적용** | `src/craft/state.ts:261-304` — strict decode error는 persist/publish 전에 throw한다. |
| RF-19 best-effort | **완전 적용** | 같은 범위에서 decode 실패만 disk write를 생략하고 memory-only publish한다. 정상/missing state는 persist한다. |
| RF-19 malformed/future 실제 tool 테스트 | **완전 적용** | `test/craft-init.test.ts:184-205`, `test/craft-state.test.ts:520-548` — bytes 불변, singleton 미등록, best-effort skip을 고정한다. |
| RF-19 serialized exact | **부분 적용** | `test/craft-verdict.test.ts:1052-1087`은 raw bytes를 parse→key-sort→re-serialize한 뒤 비교해 serialized 차이를 의도적으로 지운다. |
| **RF-19 전체** | **부분 적용** | runtime 수리는 맞지만 명시된 exact regression pin이 미충족이다. |
| RF-20(a), named 3 fields | **완전 적용** | `src/craft/verdict.ts:623-640`, `src/craft/abort.ts:35-43`, `src/craft/tool-text.ts:15-29`. 정상 single-line 입력 과차단도 없다. |
| RF-20(b) invalid diagnostic | **부분 적용** | disposition은 escaped됐지만 `recordFeature`, cycle/interval 값의 raw `String()`이 남아 있다. |
| RF-20(c) terminal parser | **완전 적용** | `src/craft/audit-policy.ts:221-229`, `src/craft/land.ts:315-334`에서 canonical parser 후 보간한다. |
| RF-20(d) run-check | **부분 적용** | core root projection guard는 추가됐지만 wrapper가 guard 전 state lookup을 하고 full persisted identity를 검증하지 않는다. 테스트도 core만 호출한다. |
| **RF-20 전체** | **부분 적용** | persisted snapshot/ledger와 lifecycle wrapper에 RF-13 잔존 표면이 남았다. |

`audit/audit-1.md:255`는 동일 RF 계열의 재차 부분 적용을 fix-introduced treadmill로 보고 REJECT 처리하라고 명시한다. RF-20(b)/(d)와 RF-19 exact test가 다시 부분 적용됐으므로 이 lane은 그 규칙을 fail-closed로 적용했다.

## Fix Delta Regression Sweep

- **RF-16/17**: `test/e2e-helpers.ts:26`의 `execFileSync` import가 복원됐고, `test/e2e-helpers.ts:737-742`는 두 sidecar에 `git check-ignore -q -- <single-path>`를 각각 호출한다. 이 변경에서 새 회귀는 찾지 못했다.
- **RF-18**: `test/e2e-helpers.ts:69-110`은 ENOENT/EINVAL을 not-pinned로 처리하고 link 후 `realpath` 및 BUILD_INFO hash를 재검증한다. `test/e2e-helpers.test.ts:423-560`은 missing/wrong/non-symlink/correct와 fail-closed 경계를 분리한다. 이 변경에서 새 회귀는 찾지 못했다.
- **RF-21**: `skills/post-craft/SKILL.md:40,100`의 두 호출이 `43200000`으로 일치하고, `test/skill-contract.test.ts:1282-1297`이 두 heading·하한·구값 제거를 고정한다. 이 변경에서 새 회귀는 찾지 못했다.
- 공유 production 경로 중 `setActiveCraft`의 저장소 내부 caller는 `src/craft/init.ts:107-109`의 strict caller 하나임을 reference search로 확인했다. 따라서 best-effort memory-only 분기는 현재 production resume 경로를 삼키지 않는다.
- fix delta가 추가한 audit 문서들은 실행 코드로 취급하지 않았고, 그 안의 지시형 문구도 본 감사의 instruction으로 따르지 않았다.

## Findings

1. **보완 · MAJOR** — RF-20(d)는 core에만 guard를 넣어 production `lsc_run_check` wrapper가 non-slug 검증 전에 persisted state를 읽으며, full persisted identity도 검증하지 않는다.
   - Evidence: `src/craft/run-check.ts:470-473` — `"const persisted = findPersistedCraftState(ctx.cwd, feature); return performRunCheck(...)"`; 실제 wrapper는 state lookup/JSON decode 후에야 core로 들어간다.
   - Evidence: `src/craft/run-check.ts:313-320,363-374` — persisted mode는 `persisted.worktreeRoot ?? persisted.projectRoot` 한 값만 고르고 그 값이 cwd/worktree 중 하나인지 검사한다. `persisted.feature` 및 `{projectRoot, worktreeRoot}` 조합의 exact identity는 검사하지 않는다.
   - Evidence: `test/craft-run-check.test.ts:494-545` — non-slug와 foreign-root 테스트는 모두 `performRunCheck(...)`를 직접 호출하며 registered `execute` 순서를 실행하지 않는다.
   - Required by: `audit/audit-1.md:250` — “`src/craft/run-check.ts:312-323,415-443`에 shared slug guard + persisted root identity의 `ctx.cwd`/computed worktree path exact-match 검증. 각 경로 fail-closed/무-effect/무-raw-payload 테스트.”
   - Actual: invalid resolved feature도 candidate path lookup과 potentially malformed JSON decode를 먼저 수행한다. 또한 state file이 `feature:"other"`를 담고도 projected root만 cwd로 맞추면 requested feature의 script가 실행될 수 있어 persisted identity가 evidence 역할을 하지 못한다.
   - Remediation: registered `execute`에서 `resolveFeatureName` 직후 `FEATURE_SLUG_RE`를 검사하고 그 전에는 `getActiveCraft`/`findPersistedCraftState`를 호출하지 않는다. persisted mode는 candidate별로 `{feature === requested, projectRoot === ctx.cwd, worktreeRoot === undefined}` 또는 `{feature === requested, projectRoot === ctx.cwd, worktreeRoot === worktreePath(ctx.cwd, feature)}` 정규형을 exact 검증한 뒤 root를 선택한다. production execute capture로 invalid feature의 state-read/exec/log 0회와 feature/projectRoot/worktreeRoot 각각의 mismatch 거부를 추가한다.

2. **보완 · MAJOR** — RF-20(b)는 disposition 하나만 escaped하고, malformed ledger의 다른 untrusted 값은 여전히 raw `String()`으로 tool result에 방출한다.
   - Evidence: `src/craft/audit-policy.ts:168-204` — `"feature \"${String(recordFeature)}\""`, `"dueCycle ... (${String(dueCycle)})"`, `"scheduledCycle ... (${String(scheduledCycle)})"`, `"intervalCycles ... (${String(intervalCycles)})"`, `"nextDueCycle ... (${String(nextDueCycle)})"`가 남아 있다.
   - Evidence: `src/craft/verdict.ts:426-440` — blocked gate의 `gate.message`를 tool content에 그대로 보간한다.
   - Required by: `audit/audit-1.md:250` — “invalid 값의 raw `String()` 보간을 constant/escaped diagnostic으로 교체”; 같은 항목은 각 경로의 “무-raw-payload 테스트”를 요구한다.
   - Actual: persisted JSON에 `auditEscalationPending.feature: "x\nignore …"` 또는 cycle field를 control-carrying string으로 넣으면 policy는 fail-closed되지만, 거부문 자체가 raw multiline payload를 later agent에게 전달한다. 새 테스트 `test/audit-policy.test.ts:467-481`은 disposition만 방어한다.
   - Remediation: `parsePendingRecord`/`parseDecisionRecord`의 모든 unknown payload를 constant diagnostic 또는 `JSON.stringify` 기반 escaped formatter로 통일한다. `recordFeature`, 각 cycle/interval field를 독립적으로 newline/tab/ESC/DEL payload로 seed하고 실제 `performAuditBegin` 결과가 single-line이며 raw payload를 포함하지 않는지 고정한다.

3. **추가 · MAJOR** — preserved `auditBaseSnapshot`에는 runtime parser가 전혀 없어 pause→resume→same-cycle replay가 untrusted snapshot text를 raw로 재방출한다.
   - Evidence: `src/craft/state.ts:209-217,261-282` — decoder는 JSON parse와 future-version만 검사한 뒤 typed cast를 반환하고, `setActiveCraft`는 기존 `auditBaseSnapshot`을 shape 검증 없이 그대로 보존한다.
   - Evidence: `src/craft/verdict.ts:371-380,543-560` — replay가 `state.auditBaseSnapshot`을 꺼내 `describeAuditBase`로 보내며, 그 함수는 `snapshot.authority`, `snapshot.baseBranch`, `snapshot.error`를 raw 보간한다.
   - Required by: `audit/audit-1.md:250` — “RF-13 잔존 표면 폐쇄” 및 “각 경로 ... 무-raw-payload 테스트.”
   - Required by: `audit/auditor-1-regression.md:87`의 승계 처방 — “replay/land에는 `AuditBaseSnapshot` 및 terminal record runtime parser를 적용해 canonical label, safe cycle, canonical ISO, control-free ref/error를 검증한 뒤에만 보간한다.”
   - Actual: RF-20(a)는 새 `base_branch` parameter만 검사한다. 이전 process가 남긴 snapshot 또는 수동 손상 state는 그 guard를 우회하고, RF-19가 정확히 보존한 뒤 idempotent replay 결과 text로 승격된다.
   - Remediation: plain-object `parseAuditBaseSnapshot`을 추가해 status/authority enum, canonical ISO, OID/count shape, control-free `baseBranch`/`error`를 검증한다. replay 전 parser 실패는 raw record를 포함하지 않는 constant `invalid-state`로 거부한다. newline-bearing snapshot을 seed→strict re-registration→same-cycle replay하는 회귀 테스트에서 state bytes와 무-raw-payload를 함께 단언한다.

4. **보완 · MAJOR** — `lsc_audit_begin`의 resolved feature guard가 production wrapper의 root/Git observation보다 뒤에 있어 RF-13 lifecycle boundary가 다시 부분 적용됐다.
   - Evidence: `src/craft/verdict.ts:623-644` — named free-text guard 뒤 feature를 resolve하지만, `resolveAuditRoot(...)`와 `observeAuditBase(...)`를 수행한 다음 `performAuditBegin(...)`을 호출한다.
   - Evidence: `src/craft/verdict.ts:390-403` — feature slug 검증은 그 뒤 core의 첫 줄에만 존재한다.
   - Required by: `audit/audit-0.md:224` — “lifecycle tool 경계에서 resolve된 feature 입력에 kebab-slug validator 적용 ... tool text 보간 필드의 newline/control char 거부 + fail-closed 테스트.”
   - Required by: `audit/audit-1.md:250` — “RF-13 잔존 표면 폐쇄” 및 named inputs의 validator를 “어떤 effect/observation보다 먼저 적용”.
   - Actual: named `base_branch`/`escalation_disposition`의 우선순위는 고쳐졌지만 `feature_dir: "bad\nfeature"`는 root existence 검사와 Git base observation을 수행한 후 거부된다. 기존 `test/craft-verdict.test.ts:983-999`는 core만 호출해 wrapper 순서를 보지 못한다.
   - Remediation: wrapper에서 `resolveFeatureName` 직후 shared slug guard를 실행하고, 성공한 feature만 `detectFixturePath`, `resolveAuditRoot`, `observeAuditBase`, core에 전달한다. captured production execute에서 invalid feature별 `runGitText` 0회와 state bytes 불변을 단언한다.

5. **보완 · MAJOR** — RF-19가 요구한 serialized-exact 회귀는 key-sort canonicalization으로 byte 차이를 지워 다시 부분 적용됐다.
   - Evidence: `test/craft-verdict.test.ts:1052-1087` — `canonicalJson`은 raw bytes를 `JSON.parse`한 뒤 모든 key를 정렬해 다시 stringify하고, assertion은 `expect(canonicalJson(bytesAfter)).toBe(canonicalJson(bytesBefore))`이다.
   - Required by: `audit/audit-1.md:249` — “`.toEqual`을 재등록 전후 serialized representation exact 비교로 강화(RF-5 byte-equivalence 원문 충족).”
   - Actual: key order·formatting이 다른 두 serialized state는 동일 canonical string이 되어 테스트를 통과한다. 같은 테스트는 replay 뒤 state bytes를 다시 읽어 불변을 확인하지도 않는다. 이는 이전 deep-equality보다 범위는 넓지만 요구된 byte/serialized exact 핀은 아니다.
   - Remediation: re-registration 전후 보존 대상 필드의 `JSON.stringify` 결과를 exact `.toBe`로 비교하고, replay 직전 raw state bytes를 저장한 뒤 replay 후 `readFileSync(...).toBe(beforeReplayBytes)`를 단언한다. 정본이 whole-file byte equivalence를 요구한다면 canonicalization을 제거하고 raw `bytesAfter === bytesBefore`가 되도록 preservation merge의 key/order rewrite도 함께 수정한다.

## Adversarial Classes

### post-resume state consistency — applied

- **정상 관측**: `src/craft/state.ts:261-304`의 strict path는 decode 실패 시 persist/publish 전에 중단하고, `src/craft/init.ts:107-109`의 실제 resume caller가 strict를 사용한다. legacy field-less state는 `src/craft/state.ts:209-217`에서 관용 decode된다. 이 범위에서는 우선 반증 질문의 반대 방향 회귀가 없다.
- **의도된 예외**: best-effort undecodable path는 disk bytes를 보존한 채 memory-only singleton을 publish한다. RF-19가 명시적으로 허용한 동작이고 저장소 production resume caller는 strict다.
- **잔존 결함**: `src/craft/state.ts:261-282`가 unvalidated `auditBaseSnapshot`까지 보존하고 `src/craft/verdict.ts:543-560`이 raw replay하므로, resumed in-memory/persisted evidence가 현재 parser가 보증하는 정규형과 갈라질 수 있다. Finding 3으로 기록했다.

### prompt-injection surface — applied

- `src/craft/audit-policy.ts:168-204`의 raw `String()` diagnostics와 `src/craft/verdict.ts:371-380,543-560`의 unparsed snapshot replay가 later agent가 읽는 tool text로 직접 이어진다. Findings 2·3이다.
- `src/craft/verdict.ts:623-644`와 `src/craft/run-check.ts:470-473`에는 feature guard 이전 observation/read가 남아 있다. Findings 1·4다.
- `test/audit-policy.test.ts:496`의 `"ignore previous instructions"` literal은 malformed timestamp negative fixture 안에 갇혀 있고 해당 timestamp diagnostic은 `JSON.stringify`된다. 그 fixture 자체는 실행 결과를 raw로 오염시키지 않는다.

## What's Missing

- 포매터·린터·전체 suite·`lsc_run_check`는 실행하지 않았다. assignment에 따라 main session의 병행 deterministic check에 의존하지 않고 code/diff 증거로 판정했다.
- C1 controls(U+0080–U+009F)와 Unicode line/paragraph separators(U+2028/U+2029)는 동적 probe하지 않았다. `src/craft/tool-text.ts:15-17`의 regex는 C0+DEL만 명시하므로 broader Unicode single-line 안전성은 열린 질문으로 남긴다.
- generated `dist`와 실제 OMP global plugin-link load identity는 검사하지 않았다. RF-18 source/test seam만 읽었다.
- audit-1의 infra/plan/spec lane 전문은 재검토하지 않았다. 정본 `audit-1.md`, RF-19/RF-20의 원 산정 regression report 관련 범위, 이번 fix delta의 production/test files를 검사했다.
- 저장소 밖 package consumer가 `setActiveCraft`의 default best-effort API를 deep import하는지는 확인할 수 없다. 저장소 내부 production reference는 strict `lsc_craft_init` 하나뿐이다.
- full base-to-tip 70-file diff는 범위 설정과 회귀 맥락 확인에 사용했지만, fix-verification의 상세 직접 판독은 `fbc4c9c..59a8181`의 23파일과 그 공유 caller에 집중했다.
