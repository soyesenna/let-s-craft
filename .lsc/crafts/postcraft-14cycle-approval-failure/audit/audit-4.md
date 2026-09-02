# Audit 4 — postcraft-14cycle-approval-failure

## Header

| 항목 | 값 |
|---|---|
| Feature | postcraft-14cycle-approval-failure |
| Date | 2026-09-02 |
| Audit cycle | 4 |
| Mode | **fix-verification** (§5 — prior verdict APPROVE-WITH-CHANGE, RF-30~RF-35 승계) |
| Implementation branch | `feat/postcraft-14cycle-approval-failure` @ `a1af63b2bfda95b182a8717e3acd8783920c16f6` (frozen OID — craft 재진입 9커밋 `f6bd406..774c705` + §3.0 test-only 커밋 `a1af63b`) |
| Worktree | `.lsc/worktrees/postcraft-14cycle-approval-failure/` |
| Base branch | `feat/lets-craft-v1` (§2.3 검출 — origin/HEAD symbolic-ref, audit-0~3과 동일) |
| Prior audit | `audit/audit-3.md` (APPROVE-WITH-CHANGE, RF-30~35, 전건 apply-only). craft 재진입은 check-7 red(full-cycle :221 pre-craft timeout, continuation :284)로 종료 → §6.1 completion mirror에 따라 정상 새 post-craft cycle(이 문서)로 회귀 |
| [Audit Escalation] | 미발동 — cycle 3에서 소비, 다음 due는 cycle 6. `lsc_audit_begin` 정상 발행(threshold = check-7) |
| 결정적 체크 | **FAIL** (exit 1) — `check/logs/check-8.log` (threshold check-7 초과, cycle-freshness 충족). build/unit 1826/bun 21 PASS, e2e **1 failed / 3 passed** (full-cycle :339 post-craft 50분 timeout) |
| §3.0 | `lsc-test-engineer` — RF-30~35 회귀 6/6 실재·유효, RF-32 replay 축별 보강 + RF-35 JSONL reader 회귀 3건 추가(`a1af63b`, test-only +75), run_check.sh 무변경(sha256 `87fe5a33…` 동일), targeted 273 passed / 0 failed, **Test Health: NEEDS ATTENTION** (3a earlyExit↔delivered race, 3b 산술 — 3b는 Layer 3 폐기, 아래) |
| 감사 lane | §5.2 owner routing: `lsc-auditor` ×3 (② plan / ③ regression / ④ infra — 승계: RF-30→④+③, RF-31→④+explore, RF-32→③+②, RF-33→④+③, RF-34→③, RF-35→deterministic-check+④) + `lsc-explore` ×1 (RF-31 probe + adversarial 2종 + coverage). lens ① 부재(라우팅 정당). 전 lane 응답, OID echo 4/4 일치, audit-level prefix 위반 0, 재스폰 0 — 단 형식 이탈 2건(explore wrapper exit 1 "yield with null data"; ③ JSON 래핑) → 메인 세션 heard 판정, §Lane Reports 참조 |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## Expected State (§4.1.3 — diff 열람 전 고정)

이 사이클의 검증 대상은 audit-3 Required Fix 6건이며, 기대 상태는 RF 원문 좌표에서 사전 고정했다 (각 lane도 자기 Expected State를 spec/plan/RF만으로 선서술 — lane 파일 참조).

| 대상 | 요구 좌표 | 기대 관측 상태 | 검증법 |
|---|---|---|---|
| RF-30 | audit-3.md:279 | run-check identity 거절문의 `claimed`·`args.feature`가 `controlSafeEcho` 경유; captured execute 테이블에 projectRoot·worktreeRoot 각각 `\u007f` seed → raw DEL 0·escaped 포함·exec 0·log-write 0 | run-check.ts 직접 재독 + 회귀 seed 재독 |
| RF-31 | audit-3.md:280 | hermetic real-omp child env = allowlist(HOME+XDG_DATA/STATE/CACHE temp 고정, OMP_PROFILE/PI_PROFILE/PI_CONFIG_DIR 상속 0) + 실사용자 plugin slot/lockfile before/after 불변 단언 | 테스트 env 블록 직접 재독 + 설치 omp dirs.ts 대조(explore) |
| RF-32 | audit-3.md:281 | `status==="ok"` 분기에서 양 tip non-empty 40-lower-hex 강제, `""`는 unknown 전용; negative ok+empty baseTip/sourceTip + replay constant·details 억제·byte-stability | parser 직접 재독 + 회귀 |
| RF-33 | audit-3.md:282 | `session_init.agent` authority 폐지, parent session task args로 requested agent 확정, diagnostic에 raw session_init + parent task args, 전제 위에서만 override 단언 | 테스트 :140-170·:236-290 직접 재독 + check-7/8 preset 결과 |
| RF-34 | audit-3.md:283 | total escaped serializer 단일 seam(C0+C1+DEL+U+2028/2029, circular/undefined fallback) + 이관(audit-policy 진단, invalid-slug 메시지들, describeAuditBase, run-check identity/exec exception/failure summary — raw child output은 log에만) | tool-text.ts + call site 전수 grep |
| RF-35 | audit-3.md:284 | (a) continuation 단언이 durable JSONL에서 exact agent·feature·cycle·OID 결합, 부재 시 orchestration 결함 명시 실패; (b) post-craft timeout stall 귀속 증거 보존 + 예산 실측 재산정 | 테스트 diff + check-7/8 로그 대조 |
| AC-8 (spec.md:95) | 기존 E2E 전체 green | 4-file `npm run e2e` green | check-8 |

## Base Drift (§4.1.4 — lsc_audit_begin 관측, verbatim)

> lets-craft: audit cycle 4 begun for "postcraft-14cycle-approval-failure" — freshness threshold set at check-7.log (a passing check-8.log or later is required to back an APPROVE-family verdict). Base authority: explicit-base "feat/lets-craft-v1" @ 36da9e9fadc3 — source @ 774c7053f248, 0 behind (in sync).

`{baseBranch: feat/lets-craft-v1, baseTip: 36da9e9fadc3, sourceTip: 774c7053f248, behindCount: 0, status: ok, authority: explicit-base}` — drift WARN 없음. (sourceTip은 begin 시점 = §3.0 커밋 이전 OID; frozen OID는 그 위의 `a1af63b`.)

## Prior Required Fix bundle — 정규형 재구성과 검증 결과 (§5.1/§5.3)

audit-3 Required Fix를 §5.1 정규형으로 재구성: itemId RF-30~35 (unique, non-blank ✓), origin ∈ owners 정확 1회 ✓ (RF-30 origin=④ ∈ {④, ③}; RF-31 origin=④ ∈ {④, explore}; RF-32 origin=③ ∈ {③, ②}; RF-33 origin=④ ∈ {④, ③}; RF-34 origin=③ ∈ {③}; RF-35 origin=deterministic-check ∈ {deterministic-check, ④}), duplicate/extra/missing pair 없음 ✓ (기대 11쌍 = 관측 11쌍) — bundle invariant 전건 통과, shortcut 진입 유효. 전 owner heard·current-OID(`a1af63b`)·current-cycle(4) — `owner inconclusive` 케이스 없음 (explore·③의 형식 이탈은 §Lane Reports에서 heard로 판정, 근거 기록).

**VerificationResult normalization (owner별, OID `a1af63b…` / cycle 4 — 정규화는 메인 세션 수행):**

| itemId | owner | status | evidence 요지 |
|---|---|---|---|
| RF-30 | auditor ④ | FAIL* | criterion "완전 적용" — run-check.ts:392-394 양 값 escaped, DEL seed 2행(:673-683), mutation 판별(:697-698) |
| RF-30 | auditor ③ | FAIL* | criterion "완전 적용" — 동일 좌표 + mutation proof(:392 revert → :697/:698 red) |
| RF-31 | auditor ④ | FAIL* | criterion "완전 적용" — env allowlist :579-585, XDG root 사전 생성 :562, 양축 snapshot :569-594, 설치 dirs.ts 잔여 축 0 |
| RF-31 | explore | **PASS** | probe 5/5 요소 in full — allowlist 5키(완전 치환), 4 dir temp, strip 전부, snapshot 3경로 바이트 비교, 설치 omp 18.1.2 dirs.ts 상담 env 전수(XDG_*, OMP_/PI_PROFILE, PI_CONFIG_DIR, PI_CODING_AGENT_DIR, PWD, OMP_APP_NAME, OMP_*_DB) 중 미고정·미strip 0 |
| RF-32 | auditor ③ | FAIL* | criterion "완전 적용" — audit-policy.ts:244-270, parser negatives :584-585, replay :1398-1433 combined+per-axis, positive empty-tip fixture 잔존 0 |
| RF-32 | auditor ② | FAIL | **부분 적용** 주장 — parser가 producer 불가 shape `ok+equal tips+count>0`, `unknown+""base+measured source` 수용 (:268-276). 메인 세션: RF-32 **원문 literal은 완전 이행**, 이 잔여는 원문 밖 신규 → RF-36 (불일치 기록 1) |
| RF-33 | auditor ④ | FAIL* | criterion "완전 적용" — :255-276 parent task args authority, :280-286 전제 위 override + raw session_init diagnostic, check-7/8 preset 2/2 green |
| RF-33 | auditor ③ | FAIL | **부분 적용** 주장 — tracer inherit 단언(:236-238)이 routing precondition(:250-276)보다 선행 → 잘못된 requested agent를 model-routing 실패로 오귀속. 메인 세션: RF-33 **원문("override를 전제 위에서만")은 완전 이행**, 순서 결함은 실재(직접 재독) → RF-37 (불일치 기록 2) |
| RF-34 | auditor ③ | FAIL | **부분 적용** — seam·4개 직접 이관은 완전(mutation-sensitive)이나 "invalid-slug 메시지들" 복수 이관 미완(abort.ts:51·init.ts:72·land.ts:226 bare JSON.stringify — 메인 세션 grep 확정), run-check.ts:393 raw path, failure summary line-count만 bound, raw stdout/stderr가 public details에 잔존 |
| RF-35 | deterministic-check | FAIL | check-8 exit 1 — full-cycle :339 post-craft 50분 timeout (RF-35(b) 증거 builder 실작동), continuation은 green(check-7 :284 red와 동일 코드 → run-to-run 변동) |
| RF-35 | auditor ④ | FAIL | **부분 적용** — (a) reader·단언 실재하나 earlyExit(stream completed-spawn arm)→1200ms→SIGKILL이 durable toolResult 기록을 앞질러 `resultDelivered===true` 단언이 구조적 flaky; exact OID·isError 결합 부재. (b) stall builder 실작동(check-8 :292-391)이나 50분 예산은 스킬 sanctioned 재스폰 1회(stage 46:56 시점 시작)를 구조적으로 미포함; `RUN_CHECK_MARKER` dead(producer 없음); audit-begin marker 32MB tail 유실 |

\* = §5.3 normalization 표의 문언(lens verdict가 APPROVE-family가 아니면 FAIL)에 따른 기계적 FAIL이며, 해당 criterion에 대한 lane의 실질 판정은 "완전 적용"이다 — audit-2/3과 동일한 구분을 §4.2 종합에서 명시적으로 가중했다.

**RF 판정 종합 (메인 세션 직접 재독 근거 포함):**

| RF | 판정 | 근거 (메인 세션 직접 확인) |
|---|---|---|
| RF-30 | **완전 적용** | run-check.ts:392-393 `controlSafeEcho(claimed)`·`controlSafeEcho(args.feature)` 직접 재독(fix diff 3a7ddd9). 회귀 craft-run-check.test.ts:673-698 projectRoot/worktreeRoot `\u007f` 2행. ③④ 양 owner "완전". **audit-3 이월 경고(RF-20계열 4세대) 미발동** |
| RF-31 | **완전 적용** | e2e-helpers.test.ts:558-594 직접 재독 — allowlist 5키(:579-585, `execFileSync env` 완전 치환), `<xdgData>/omp/plugins/node_modules` 사전 생성(:562), `~/.omp/plugins` + `$XDG_DATA_HOME/omp/plugins` 양축 3경로 바이트 snapshot toEqual(:569-571, :591-594). explore probe 5/5 + ④ 설치 dirs.ts 대조. check-8.log:163 green. **audit-3 이월 경고(RF-18계열 4세대) 미발동** |
| RF-32 | **완전 적용 (원문 기준)** | audit-policy.ts:243-245 `isMeasuredOid`, :269-270 ok 분기 양축 강제 직접 재독(fix diff 488b686). 회귀 :584-585 negatives + craft-verdict replay(§3.0이 축별 분리 :1414-1433). ②의 coupling 잔여(`ok+equal tips+count>0`, `unknown+""+measured`)는 원문 문언 밖의 신규 producer-shape 결함 → RF-36 |
| RF-33 | **완전 적용 (원문 기준)** | e2e-preset-default.test.ts:255-276 parent `sessionTaskSpawns` marker-bound call의 requested agent 단언, :283-286 explore override는 전제 뒤 + `sessionInitDiagnostic`(:153-167) 포함 — 직접 재독. check-7(497,753ms)·check-8(453,568ms) 2/2 green. ③의 순서 결함(:236-238 tracer inherit 단언 선행)은 실재 → RF-37 |
| RF-34 | **부분 적용** | tool-text.ts:44-58 total serializer(try/catch, undefined, `RAW_TEXT_RESHAPE_RE` DEL+C1+2028/2029) 직접 재독. 이관 완료: audit-policy.ts:330, verdict.ts describeAuditBase 3분기 + invalid-slug ×3, run-check.ts invalid-slug ×2 + identity + exec exception + extractFailureLines map. **미완**: `abort.ts:51`, `init.ts:72`, `land.ts:226` bare `JSON.stringify(feature)` (메인 세션 grep 확정), `run-check.ts:393` raw `${args.cwd}`/`${expectedWorktree}`, failure summary byte-bound 부재(:49-54 line count만), raw `stdout/stderr`가 `RunCheckDetails`에 잔존(:269-270 — 외부 소비자 0, :442 자기 게이트뿐 — 메인 grep) |
| RF-35 | **부분 적용** | (a) 1e7fee8·ef526ab 직접 재독 — reader `sessionTaskSpawns`(e2e-helpers.ts:982-1041, toolCallId↔toolResult pairing), 단언 :266-284. `attachOmpRunHandlers :277-279` earlyExit→drain 1200ms→`:294 SIGKILL` 직접 재독; earlyExit :229-230 = begun ∧ (RUN_CHECK_MARKER ∨ completedTaskSpawnSeen) ∧ commit. ③④가 설치 host agent-loop.ts:2468-2494(tool_execution_end push → 이후 ToolResultMessage 생성) 인용 → race 구조 확정, check-7 :284 `delivered=false`가 그 실증. (b) 774c705 직접 재독 — `postCraftStallEvidence`(:136-195) 실재·check-8에서 실작동(:292-391). 그러나 POST_CRAFT 50분 = 내부 wait class 1개와 동일 — check-8 durable timestamps: 시작 08:56:56 → 배치 09:03:21 → 반환 09:22:55 → 재스폰 09:43:52 → kill 09:46:55. 재스폰이 stage 46:56에 시작해 3분 만에 kill. `RUN_CHECK_MARKER="script sha256: "`은 run-check.ts:276-282 결과 text에 부재(transcript :248에만) — 메인 재독 확정 |

## Spec Compliance Matrix (§5.4 — audit-3의 Partial 행만 재검증, 메인 세션 직접 확인)

### Acceptance Criteria (재검증 행)

| Requirement | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| AC-8 E2E | **Partial** | check-8.log:286-291 escalation 3/3 ✓ / :392-393 preset ✓ / :394-395 continuation ✓ / :292-391 full-cycle ✗(:339) | audit-3 대비: preset이 RF-33으로 red→green 전환(2/2), continuation은 check-7 red→check-8 green(동일 코드 — 구조적 race, RF-39), full-cycle은 check-5/6(:241 25분)→check-7(:221 pre 60분)→check-8(:339 post 50분) **4회 연속 timeout 계열** — RF-40/41 |

### Constraints / Non-Goals

audit-3에서 Partial/Unmet인 행 없음 — 재검증 대상 없음. fix delta의 scope behavior 신규 없음(explore: 12파일 전건 RF/§3.0 귀속, 무관 유입 0; state/storage/cap alias 무변경 — ② Must-NOT-Have Met).

## Plan Compliance Matrix (재검증 행 — lens ② 소유, 메인 세션 재검증)

| Step/Decision | Status | 메인 세션 재검증 |
|---|---|---|
| PR5-5 red continuation (실행 증거 축) | **Partial** (audit-3 Unmet → 상향) | exact agent/feature 결합·durable source 전환은 실재(:264-284). 그러나 (i) earlyExit가 transient stream completion에 kill 권한을 두고 durable `resultDelivered`를 사후 요구 → plan.md:413/422의 "B 관측" 계약보다 강한 조건을 RF-28 seam이 보장 못 함(check-7 red/check-8 green), (ii) 실행 OID·isError 미결합. ② 판정 채택 |
| ADR Principle 3 — durable evidence 동일 의미 | **Partial** (유지) | RF-32로 `ok+empty` 전이는 폐쇄(:269-270). 잔여: parser accepted set ⊋ producer set — `ok+equal tips+count>0`(git상 불가)이 canonical "base drift" WARN으로 replay 가능. ②의 producer 9-shape 전수표를 메인 세션이 verdict.ts:312-365 순서(base→source→count)로 확인 → RF-36 |
| PR-1 Guardrail — pure core/thin wrapper | **Met** | wrapper/core 동일 `FEATURE_SLUG_RE`·동일 serializer·동일 문언(run-check.ts:360/:501, verdict.ts:412/:659/:698 — fix diff 직접 재독). identity 판정 core 유지 |
| PR-3 base snapshot contract + parser | **Partial** | ② 행 — 위 ADR P3와 동일 근거(RF-36) |
| PR-5 step 7 / Success 8 — 4-file E2E 전체 green | **Unmet** | check-8 1 failed / 3 passed. ② 행 채택 |
| Plan Must-NOT-Have | **Met** | delta path set에 state.ts/skills/README/package.json/.gitignore 없음(git diff --stat 직접 확인) |

## Code Quality & Regression Risk (§3.4 종합)

### 수렴 (2개 이상 lane 독립 지목 — 수렴 선언은 메인 세션만)

1. **RF-35(a) earlyExit↔durable toolResult race** — ②(F2)·③(F4)·④(F1) **3-lane 독립 수렴** + §3.0 엔지니어 3a + check-7 :284 기계 증거 + 메인 세션 `attachOmpRunHandlers` 직접 재독. ③④는 설치 host `agent-loop.ts:2468-2494`의 이벤트 순서를 독립 인용. 최고 신뢰. 분류: 수정 · **MAJOR** → RF-39.
2. **RF-35(b) post-craft 예산 구조 미달** — ②(F3)·③(F5)·④(F2) 3-lane 수렴 + check-8 durable timestamps(④ 정량: 재스폰 시작 46:56, sanctioned wait 50분 → 최소 112분). 분류: 수정 · **MAJOR** → RF-40.
3. **RF-34 failure summary byte-bound 부재** — ③(F1)·④(F5) 수렴. 분류: 보완 · **MAJOR** → RF-38(d).
4. **RF-34 이관 미완(bare JSON.stringify / raw path)** — ③(F2) + explore Axis 3(invalid-slug 4-site 구분 seed 부재, 인접) + 메인 grep(abort/init/land/run-check:393). 분류: 보완 · **MAJOR** → RF-38(a-c).
5. **stream marker 신뢰성(dead `RUN_CHECK_MARKER`, 32MB tail 유실)** — ④(F3) + ③(F5 "stream loss 실증") + check-8.log:295 vs :308-310 기계 증거 + 메인 run-check.ts:276-282 재독. 분류: 보완 · **MAJOR** → RF-41.

### 단독 lane 발견 (미교차 관측임을 명시 — 전건 메인 세션 직접 재독으로 실재 확정)

- lens ② 단독 — **RF-32 producer-shape coupling** (MAJOR): audit-policy.ts:266-271 재독 — ok 분기에 equality↔count coupling 없음, unknown 분기 tip 독립 → RF-36.
- lens ③ 단독 — **RF-33 단언 순서**(MAJOR, :236-238 vs :250-276 재독) → RF-37; **raw `details.stdout/stderr`**(MAJOR — 메인 grep: 외부 소비자 0) → RF-38(e); **BOM/bidi/zero-width raw**(MINOR, RF-34 최소 범위 밖); **E2E diagnostic raw 재방출**(MINOR).
- lens ④ 단독 — **pre-craft timeout arm 증거 부재**(MAJOR, :220-224 debugSummary만; check-7 :221 red — RF-35(b) 원문 범위 밖 신규) → RF-41; **권고 ① chmod 테스트 root 비결정**(MINOR); **run_check.sh sizing 주석 부정합**(MINOR); **RF-33 diagnostic total bound 부재**(MINOR).
- explore 단독 — invalid-slug 4-site 구분 seed 부재(MINOR → RF-38 회귀에 병합), describeAuditBase drift 분기 미운동(MINOR), `sessionTaskSpawns` 다중 toolResult last-wins 미핀(MINOR → RF-39 회귀에 병합), 버전 주석 drift 18.0.11→18.1.2(MINOR), audit-policy.ts:330 들여쓰기(MINOR cosmetic).

### 불일치 기록 (양쪽 판독 + 메인 세션 판정)

1. **RF-32 완전성**: ② "부분"(accepted superset) vs ③ "완전"(원문 literal + mutation proof). 메인 세션 — **③ 지지(원문 기준 완전)**: RF-32 원문은 ok 분기 non-empty 40-hex와 `""`의 unknown 한정만 요구했고 그 둘은 이행됐다(:269-270, :584-585). ②의 coupling은 사실이며(메인 재독) ADR P3 관점에서 실재 결함이나 **원문 밖 신규**로 재귀속 → RF-36 (named case `new unrelated apply-only MAJOR`). ②의 severity MAJOR는 래칫대로 유지.
2. **RF-33 완전성**: ③ "부분"(단언 순서) vs ④ "완전". 메인 세션 — **④ 지지(원문 기준 완전)**: 원문의 "override 단언"은 explore override(:283-286)이며 전제 뒤에 있다. ③이 지적한 tracer inherit 단언(:237-238) 선행은 실재하고 잘못된 requested agent를 오귀속시킬 수 있다(메인 재독) → RF-33 계열 신규 discriminator 결함으로 RF-37, MAJOR 유지.
3. **3b vitest `--testTimeout` 산술**: §3.0 엔지니어·explore "13.5M > 10.2M 불일치" vs ③④ "per-test local timeout 우선 → 비결함". 메인 세션 — **③④ 지지, 폐기** (폐기 기록 1).
4. **check-8 continuation green의 의미**: ④ "구조적 race를 반증하지 않음(green 경로는 branch/arm 증거 미보존)" — 메인 세션 동의: 동일 코드의 red(check-7)/green(check-8)은 race의 존재를 실증하지 부재를 실증하지 않는다.
5. **RF-34 raw details**: ③ 단독 "RF-34 위반" — ④는 byte-bound만 지목. 메인 세션 — ③ 지지: 원문 "tool result에는 bounded escaped summary"에서 `details`는 tool result의 일부이고 외부 소비자가 없어(grep) 제거가 안전 → RF-38(e).

### 폐기 기록 (§4.2 Layer 3)

- **§3.0 엔지니어 3b + explore 확인 — "TEST_TIMEOUT_MS 13,500,000 > package.json `--testTimeout=10200000` → resume 경로에서 vitest가 먼저 kill" — 폐기.** 근거: `test/e2e-full-cycle.test.ts:471`이 `it(..., TEST_TIMEOUT_MS)`로 per-test timeout을 명시(메인 세션 직접 재독); vitest는 per-test numeric timeout을 config `testTimeout`보다 우선한다(④: `@vitest/runner/dist/chunk-hooks.js:559-606` `options.timeout ?? config.testTimeout`; ③: 동 파일 :606,908 독립 인용). check-8의 red는 vitest kill이 아니라 하니스 자체의 50분 stage kill(:339)이다. 잔여: run_check.sh:19-24 sizing 주석이 local override를 반영하지 않음 — ④ MINOR로 별도 기록(비차단).
- 그 외 폐기 0건 — 검증한 모든 finding은 인용 좌표에서 사실로 확인되었다 (RF-36 coupling은 :266-271 재독, RF-38 미이관 site는 grep, RF-39 race는 attachOmpRunHandlers 재독 + check-7 실증, RF-40 예산은 check-8 timestamps, RF-41 dead marker는 run-check.ts:276-282 재독).

## Deterministic Check (§3.1)

- **결과: FAIL** (exit 1) — 재저작 cap 미발동(isError 0회), manifest-runner WARN 없음. `timeout_ms=43,200,000`으로 호출.
- Log: `check/logs/check-8.log` (856 lines) — cycle-4 threshold(check-7) 초과, freshness 충족. `[Audit Evidence Mode]`로 기록(활성 craft 부재 — post-craft 단독 실행의 정상 경로).
- Script sha256: `87fe5a33949f97822554e15d8a2293d8d5c9b4a90db6586c501e03def7b7daa4` (pre/post 동일 — log:3-4; §3.0 엔지니어·explore·메인 세션 3중 확인, fix delta 미포함)
- 실행 단계: `npm run build` PASS(`git=a1af63b srcHash=1d68b4706c4c`) → `npm test` **1826 passed | 14 skipped, 67 files** PASS → `npm run test:bun` **21 pass / 0 fail** PASS → `npm run e2e` **1 file failed / 3 passed (1 test failed / 5 passed)** FAIL, Duration 7560.58s.
- 발췌 (log:292-295, 297-305, 384, 397-402, 856):
  ```
   ❯ test/e2e-full-cycle.test.ts (1 test | 1 failed) 6234336ms
     × full cycle E2E (AC4/AC5/AC7): ... → post-craft timed out.
  stage markers (stream): audit-begin cycle-0 = 0, run-check = 0
  durable task spawns (<sessionDir>/2026-09-02T08-56-56-168Z_....jsonl):
  #0 agent=lsc-test-engineer delivered=true ...
  #1 agent=lsc-explore delivered=true ...
  #2..#5 agent=lsc-auditor delivered=true ... (lens ①②③④)
  #6 agent=lsc-auditor delivered=false task="이전 시도가 provider 장애로 유실되어 재시도한다 — ... `**AUDITOR VERDICT:` 접두사 없이 JSON으로 ..."
  #7 agent=lsc-auditor delivered=false task="이전 시도가 provider 장애로 유실되어 재시도한다 — ... exit 1 ... 'Subagent called yield with null data' ..."
  attribution: last durable activity 183s before this evidence snapshot — ...
   Test Files  1 failed | 3 passed (4) / Tests  1 failed | 5 passed (6) / Duration 7560.58s
  ==> summary status=1
  --- exit 1 ---
  ```
- **timeout 계열 4회 연속 대조 (동일 assertion family):**

  | E2E 파일 | check-5 (de596db) | check-6 (de596db) | check-7 (774c705) | check-8 (a1af63b) | 판독 |
  |---|---|---|---|---|---|
  | e2e-audit-escalation | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | ✓ 3/3 | 결정적 green — AC-1/2 4회 연속 |
  | e2e-preset-default | ✗ :235 | ✗ :235 | ✓ | ✓ | **RF-33 fix 유효** — 2/2 green |
  | e2e-red-cycle-continuation | ✓ | ✗ :248 | ✗ :284 (delivered=false) | ✓ | 동일 코드 red/green — RF-35(a) 신규 race 축(RF-39) |
  | e2e-full-cycle | ✗ :241 post 25분 | ✗ :241 post 25분 | ✗ :221 **pre** 60분 | ✗ :339 post 50분 | **4회 연속 stage-budget kill** — 재산정 방법 결함(RF-40) + pre-craft 증거 부재(RF-41) |

- 감사 판단: **§4.2 Layer 1 하드 게이트 발동** — 이 사이클은 APPROVE/APPROVE-WITH-COMMENT 불가. red의 구성: TS 구현(src) 결함 red 0건 — 유일 red는 E2E 하니스가 관측하는 subprocess 실행 시간 축이며, check-8의 RF-35(b) 증거가 처음으로 그 귀속을 확정했다: post-craft subprocess는 §3.0→check green→§3.2 5-lane→무응답 2 lane 재스폰까지 **스킬이 sanction하는 경로를 정확히 따르던 중** 50분 예산에 kill됐다(마지막 durable activity 183s 전 — 스킬의 15분 no-progress 기준 미달, hang 아님). 이 red는 구현 결함도 orchestration 결함도 아닌 하니스 예산 결함이다.
- 부수 관측: 이번 lsc_run_check 결과 text의 failure summary 40줄은 전부 `✓` 통과 라인(FAILURE_LINE_RE가 테스트명의 "fail" 문자열에 매칭) — best-effort 추출의 기존 한계이며 RF-34 escaped 형식(JSON-quoted)이 적용된 것을 확인. 비차단.

## Lane Reports (§4.1.9)

### lsc-explore — verbatim 전문

(wrapper status `failed (exit 1)` — "SYSTEM WARNING: Subagent called yield with null data". 메인 세션 판정: **heard** — 4축 전 산출물(OID echo 일치, RF-31 probe 5/5 요소별 근거, 커밋 맵, coverage 표, adversarial 2 클래스 판정) 완결·인용 좌표 실재. 무응답 규칙의 취지("missing voice")에 해당하지 않으므로 재스폰하지 않았다. 아래는 최종 메시지 원문 그대로.)

```
SYSTEM WARNING: Subagent called yield with null data.

OID 재검증 완료. 이제 delta의 전체 파일 표면과 per-commit numstat를 확보한다.Delta 표면 확정: 12개 파일, 모두 `src/craft/` + `test/`로 한정. 이제 Axis 1 (RF-31 probe) — hermetic 테스트와 installed omp dirs 해석 소스를 병렬로 확보한다.grep 결과가 대부분을 보여주지만 elision 구간이 있다. hermetic 테스트 전문, pinLetsCraftPluginToRepo 전문, 그리고 installed omp의 dirs 해석 소스를 병렬로 확보한다.installed omp = bun 설치 18.1.2, pi-utils는 mise 전역 node_modules에 존재. bun 쪽 사본과 dirs 해석 소스를 확인한다.Resolver 전체 env 상담 목록 확보. 이제 (1) OMP_APP_NAME/plugins dir 해석, (2) snapshotPluginsDir 비교 축, (3) GLOBAL_PLUGIN_LINK 기본값을 확인한다.Axis 1 재료가 거의 모였다. 이제 getPluginsDir 해석, worktree `.env` 존재 여부(= refreshDirsFromEnv 경로), 그리고 Axis 2/3용 src diff 4종을 병렬로 확보한다.Diff 요약이 elide 되어 있다. 원문 artifact를 읽고, 신설 reader 4종(e2e-helpers.ts:898+)도 함께 확보한다.Reader 4종 구현 확보. 이제 Axis 3 — 각 src 변경에 대응하는 테스트를 매핑한다. 새 테스트 타이틀과 expect들을 병렬 grep한다.일치 없음 — 프레임워크가 다를 수 있다. 파일 구조를 직접 확인한다.bash grep 이슈 — 내장 grep tool로 전환한다.커밋 소유 확정: :330 chain echo는 f6bd406 소유. 이제 RF-35/33의 세 e2e 테스트 diff를 확보한다.RF-33 확인. 이제 Axis 4(a) — run_check.sh 본문과 check-8.log 정합성을 검증한다.Axis 4 증거 확정. 이제 세부 검증: (1) audit-3 권고 ① 출처, (2) RF-25 wrapper slug 시드, (3) 다중 toolResult 테스트 존재 여부, (4) TEST_TIMEOUT_MS 공식 vs package.json e2e 타임아웃.마지막 정밀 라인 확정 — reader 함수들과 default linkPlugin, EARLY_EXIT_DRAIN_MS 위치를 grep으로 고정한다.# lsc-explore — RF-31 probe + code map + coverage + adversarial classes (audit cycle 4, fix delta `ef43a24..a1af63b`)

## Findings

### OID echo
- 재유도값: `git -C {worktreeAbs} rev-parse HEAD` = **`a1af63b2bfda95b182a8717e3acd8783920c16f6`** — 동결 OID와 일치. 불일치 없음, 계속 진행.
- `run_check.sh` sha256 재계산 = **`87fe5a33949f97822554e15d8a2293d8d5c9b4a90db6586c501e03def7b7daa4`** — 명세값과 일치.
- Delta 규모: 12 files, +936/−77 (`git diff --stat ef43a24..a1af63b`).

---

### Axis 1 — RF-31 probe (ownerRef = {explore, "RF-31 hermetic real-omp env isolation"})

| # | 요소 | 판정 | 근거 (file:line) |
|---|------|------|------------------|
| 1 | allowlist 구성 | **기준 충족 (full)** | `test/e2e-helpers.test.ts:576-587` — `execFileSync("omp", ["plugin","link",root], { stdio:"pipe", env: {…} })`에 전달되는 env 객체는 **정확히 5키**: `PATH`(← `process.env.PATH`), `HOME`(← temp `lsc-pin-hermetic-home-`), `XDG_DATA_HOME`(← temp xdgData), `XDG_STATE_HOME`(← temp xdgState), `XDG_CACHE_HOME`(← temp xdgCache). Node `execFileSync`의 `env` 옵션은 **완전 치환**이므로 그 외 모든 키는 상속되지 않음(allowlist by construction). 값 원천: 4개 루트는 `tmpDir()` 신규 mkdtemp (`:558-561`). |
| 2 | 4개 디렉터리의 temp tree 고정 | **충족 (full)** | `:558-561` 4종 temp 생성, `:581-584` child env에 주입. `:562` `mkdirSync(join(xdgData,"omp","plugins","node_modules"))`로 `<xdgData>/omp`를 **존재시켜** resolver의 XDG 우선 조건을 의도적으로 활성화(`:554-556` 주석 = 재현 의도 명시). `:563-564` slot에 regular file 예치(`:564`) — production omp가 못 지우는 형태. |
| 3 | 상속 제거 키 | **충족 (full)** | allowlist 특성상 `OMP_PROFILE`/`PI_PROFILE`/`PI_CONFIG_DIR`/`PI_CODING_AGENT_DIR`/`OMP_APP_NAME`/`OMP_WORKTREE_DIR`/`OMP_GITHUB_CACHE_DB`/`OMP_COMMIT_CACHE_DB`/`OMP_AUTH_BROKER_SNAPSHOT_CACHE`/`PWD` 전부 child에 부재. RF-31이 명시한 3종(OMP_PROFILE/PI_PROFILE/PI_CONFIG_DIR) 포함 전부 strip. |
| 4 | `snapshotPluginsDir` before/after 불변 | **충족 (full)** | 정의 `test/e2e-helpers.test.ts:474-482`: plugins dir당 3경로 — `node_modules/lets-craft`(slot), `omp-plugins.lock.json`, `package.json`. 비교 방식: symlink → `readlink` 타깃 문자열, file → **utf8 바이트 전문**, 존재 여부 → `<absent>`/`other`. 축: 실사용자 `~/.omp/plugins`(무조건, `:569`) + `$XDG_DATA_HOME/omp/plugins`(부모 env에 XDG 설정 시에만, `:570`) — 설치 omp가 상속으로 닿을 수 있는 **실재하는 두 축 모두** 스냅샷. 단언 `:591-594` `toEqual(before)` + 메시지에 RF-31 명기. |
| 5 | 설치 omp resolver cross-check | **충족 (full) — 잔여 구멍 없음** | 설치 omp = bun 전역 **18.1.2** (`which omp` → `~/.bun/bin/omp`; `omp --version` → `omp/18.1.2`). dirs 소스 판독 가능: `~/.bun/install/global/node_modules/@oh-my-pi/pi-utils/src/dirs.ts` (1,114행). 상담 env 전수: `OMP_PROFILE`(:91,:542), `PI_PROFILE`(:91,:121,:543), `PI_CONFIG_DIR`(:282), `PI_CODING_AGENT_DIR`(:430,:450,:535), `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME`(DirResolver 생성자 :339-364 — linux/darwin + default profile + `$XDG_*_HOME/omp` **존재 시**에만 채택), `PWD`(:190 — cwd 폴백, 쓰기 위치 아님), `OMP_APP_NAME`(:1041 — attribution 라벨만, 경로 불변), `OMP_WORKTREE_DIR`(:677)/`OMP_GITHUB_CACHE_DB`(:748)/`OMP_COMMIT_CACHE_DB`(:757)/`OMP_AUTH_BROKER_SNAPSHOT_CACHE`(:773 — 특정 DB 경로 한정). **이들 중 allowlist가 고정도·strip도 하지 않는 변수는 없다** — env 완전 치환 특성상 비고정 변수는 전부 strip된다. `getPluginsDir`(:606-611): no-arg는 DirResolver 경유 → child 기준 `XDG_DATA/omp/plugins`(존재→authoritative) 또는 `<childHOME>/.omp/plugins` — 둘 다 temp 내부. 보조 확인: worktree에 `.env` 없음(`ls` 확인) → `refreshDirsFromEnv`(:450-465)의 `.env` 재해석 경로도 무해. plugin 영역 부수 쓰기 `install-id`도 `getBaseConfigRoot()`=child HOME 기준(dirs.ts 하단 `getInstallId`) → temp. |

**Probe 종합: success criterion 5/5 요소 충족.** 비교 방식의 한계 2건은 관측 사항(판정 불변): (i) 파일 비교가 바이트+타깃+존재이고 mtime/mode 미비교 — 바이트 동일 리라이트는 미검출이나 내용 불변이란 불변식 자체는 충족; (ii) slot이 **디렉터리** 형태면 내부 파일 열거 없이 `"other"` 1토큰.

---

### Axis 2 — code map (commit → files → dependency)

| 커밋 | RF | 파일 (+/−) | 성격 |
|------|-----|-----------|------|
| `f6bd406` | RF-34 | `src/craft/tool-text.ts` (21/8), `src/craft/audit-policy.ts` (1/1 = :330 chain echo), `test/audit-policy.test.ts` (+42) | **seam 신설** — `controlSafeEcho` total serializer + `RAW_TEXT_RESHAPE_RE` |
| `3a7ddd9` | RF-30 | `src/craft/run-check.ts` (3/2 = :391-393), `test/craft-run-check.test.ts` (21/3) | f6bd406의 seam **소비** — identity 거절문 전환 + DEL seed |
| `58ddcc8` | RF-34 | `src/craft/run-check.ts` (15/5), `src/craft/verdict.ts` (11/7), `test/craft-run-check.test.ts` (38/6), `test/craft-verdict.test.ts` (+54) | f6bd406의 seam **소비** — 8개 보간 표면 이관 |
| `488b686` | RF-32 | `src/craft/audit-policy.ts` (16/1 = isMeasuredOid + ok-guard), `test/audit-policy.test.ts` (+9), `test/craft-verdict.test.ts` (+23) | seam과 **독립** (parser 강화) |
| `ef526ab` | RF-33/35 seam | `test/e2e-helpers.ts` (+197), `test/e2e-helpers.test.ts` (+111) | **reader seam 신설** |
| `6c69af7` | RF-31 | `test/e2e-helpers.test.ts` (92/9) | 기존 `pinLetsCraftPluginToRepo` seam(:76-83) 소비 + audit-3 비차단 권고 ① 반영 |
| `b4e0c1f` | RF-33 | `test/e2e-preset-default.test.ts` (72/33) | ef526ab의 `sessionTaskSpawns` **소비** |
| `1e7fee8` | RF-35(a) | `test/e2e-red-cycle-continuation.test.ts` (37/1) | ef526ab의 `findSessionFileByPrompt`+`sessionTaskSpawns` **소비** |
| `774c705` | RF-35(b) | `test/e2e-full-cycle.test.ts` (101/3) | ef526ab의 `sessionEntryDigests` 등 **소비** |
| `a1af63b` | RF-32/35 보강 | `test/craft-verdict.test.ts` (+22), `test/e2e-helpers.test.ts` (+53) | 488b686의 guard, ef526ab의 reader에 대한 회귀 보강 |

의존 체인: `f6bd406 → {3a7ddd9, 58ddcc8}` (seam→소비), `ef526ab → {b4e0c1f, 1e7fee8, 774c705, a1af63b}` (reader→소비). lane-1(4 fix commits)이 lane-2(6 test commits)에 선행.

**무관 유입 판정: 없음.** 12개 파일의 모든 hunk가 RF-30/32/33/34/35 또는 §3.0 의무에 매핑된다. 유일한 경계 사례: `6c69af7`의 "+비차단 권고 ① rmSync 재던짐 arm"(`test/e2e-helpers.test.ts:597-603` 이후) — audit-3.md:286이 RF-31과 같은 파일에서 함께 해소할 것을 명시 권고한 항목으로, 커밋 메시지에 비차단으로 라벨링됨 → 무관 유입 아님. Subject-RF ↔ 파일 ↔ in-diff RF 주석 3-way 일치 확인 (예: RF-30 커밋 ↔ run-check:391 ↔ test :673-698의 "audit-3 RF-30" 주석). Cosmetic 결함 1건: `audit-policy.ts:330` 들여쓰기 3탭(주변 4탭) — f6bd406이 유입, 동작 무관.

---

### Axis 3 — coverage (변경 라인 → 테스트 → 깨지는 expect)

**src 변경 축:**

| 변경 (file:line) | 테스트 | revert 시 깨지는 expect |
|---|---|---|
| `audit-policy.ts:243-245` `isMeasuredOid` | `audit-policy.test.ts:564-567`(partial-unknown 보존), `:583-584`(ok+empty tip ×2 reject) | `:589` `toBeUndefined()` |
| `audit-policy.ts:269-270` ok-분기 guard | `audit-policy.test.ts:583-584`; `craft-verdict.test.ts:1395-1419`(양축 empty), `:1421-1440` it.each(축별) | `craft-verdict.test.ts:1404` `not.toContain("in sync")`, `:1405` details 억제, `:1406` byte 불변; `:1433-1437` 동일 4종 |
| `audit-policy.ts:330` chain-error echo | `audit-policy.test.ts:507` fixture "(d) broken predecessor link" | `:507`이 invalid-state로 귀결 — 단, echo 대상 `prev.nextDueCycle`은 parseDecisionRecord:193이 **수在不断 정수만** 통과시키므로(에러 시 :193의 echo — 그 축은 `audit-policy.test.ts:644-647` DEL seed가 담당) **제어문자 seed는 구조적으로 도달 불가** |
| `tool-text.ts:44-58` total serializer + RE | `audit-policy.test.ts:692-723` | `:700-701`(C1/CSI/2028/2029 escape), `:713-715`(catch→`<unserializable value>`: circular+BigInt), `:719-721`(undefined arm: undefined/symbol/function) |
| `run-check.ts:50` extractFailureLines map | `craft-run-check.test.ts:62-67` | `:65` toEqual(escaped 형태), `:66` no-raw 정규식 |
| `run-check.ts:360-361` invalid-slug(core) | `craft-run-check.test.ts:533-539` | **없음** — seed가 `\n`/ASCII뿐(`:534`), JSON.stringify도 `\n` escape → 미구분 축 ⚠ |
| `run-check.ts:391-393` identity refusal | `craft-run-check.test.ts:673-698` | `:698` `toContain("\\u007f")`, `:697` total-repertoire no-raw |
| `run-check.ts:437-438` exec exception | `craft-run-check.test.ts:511-526` | `:525` `toContain("\\u2028")`, `:526` |
| `run-check.ts:501-502` invalid-slug(wrapper) | `craft-run-check.test.ts:634-652` | **없음** — seed `"bad\nfeature"`(`:636`), `:650` 정규식도 C0+DEL 한정 ⚠ |
| failure summary (:251-271 경유 map) | `craft-run-check.test.ts:135-155` | `:151` text `\\u007f` 포함, `:152` no-raw, `:154` durable log엔 raw 보존 |
| `verdict.ts:377-378` unknown 분기 | `craft-verdict.test.ts:1476-1489` | `:1483` `\\u0085`, `:1484` no-raw |
| `verdict.ts:380-381` in-sync 분기 | `craft-verdict.test.ts:1460-1474` | `:1469` `\\u2028` |
| `verdict.ts:383-384` **drift 분기** | 실 git drift 테스트(`:905-918`)는 clean `main`뿐 | **없음** — behindCount>0 + 구분 축 seed 부재 ⚠ |
| `verdict.ts:412` invalid-slug | `craft-verdict.test.ts:1004-1022` | `:1007-1020` DEL/C1/sep escaped containment — **구분 seed 있음** ✓ |
| `verdict.ts:659` invalid-slug(wrapper) | `craft-verdict.test.ts:1326-1342` | **없음** — seed `"bad\nfeature"`(`:1334`) ⚠ |
| `verdict.ts:698` invalid-slug(validate) | `craft-verdict.test.ts:995-1002` | **없음** — INJECTIONS(`:984`)가 `\n`/`\t`뿐 ⚠ |

**할당 질문에 대한 직답:** `:330`에 `prev.nextDueCycle` 제어문자 seed 테스트 — **없으며, 구조적으로 불가능**(:193이 수不断 정수가 아닌 nextDueCycle을 먼저 거절; 그 거절의 echo는 `:644-647`이 핀). `:330`의 controlSafeEcho는 이미 검증된 수치에 대한 방어적 중복이며 수치 경로는 fixture (d) `:507`이 커버.

**신설 reader 4종(`e2e-helpers.ts:909-1084`) 단위 커버리지:**

| 질의 | 판정 | 근거 |
|---|---|---|
| corrupt line | **커버** (skip 아님 — **throw**가 설계; `e2e-helpers.ts:913-931` path:line 컨텍스트) | `e2e-helpers.test.ts:753-758` `toThrow(/run\.jsonl:1/)` |
| nested files | **커버** — finder가 top-level `.jsonl`만 매칭, subagent 하위 무시, needle 부재 → undefined | `:761-778` |
| batch `tasks[]` | **커버** — 1개 toolResult가 batch 전 항목 완료 처리, 미결 call_2는 delivered=false | `:735-750` |
| JSON-string `arguments` | **커버** | `:739`(같은 테스트 내) |
| host title/session-header prefix | **커버** (a1af63b +53) | `:794-820` |
| entry-level id 비-페어링 | **커버** | `:822-833` |
| string toolResult content | **커버** | `:835-845` |
| `message.toolCallId` 부재 → skip | **커버** (`:822-833`이 동일 형태 — message에 toolCallId 없음 → skip → delivered=false) | `e2e-helpers.ts:1024-1026` |
| **동일 callId 다중 toolResult** | **미커버** ⚠ — 구현은 `Map.set` 덮어쓰기 = **last wins**(`e2e-helpers.ts:1022-1031`), 테스트 픽스처 어디에도 2중 toolResult 없음 | — |

**미커버 목록 (요약):** ① 동일 callId 다중 toolResult(last-wins), ② describeAuditBase drift 분기의 escaped echo(behindCount>0 + 구분 축 baseBranch), ③ run-check/verdict의 invalid-slug 4개 사이트(`:361`,`:502`,`:659`,`:698`)의 구분 축(DEL/C1/U+2028) seed — 5개 사이트 중 `:412`만 구분 seed 보유.

---

### Axis 4 — 소관 adversarial classes

**(a) 결정적 체크의 형해화 — 판정: 적용됨(형해화 없음).**
- 스크립트 본문 판독: `{worktreeAbs}/.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh` — `set -uo pipefail`, `npm run build/test/test:bun/e2e` 4단계 각각 `|| status=1` 누적, `echo "==> summary status=${status}"`, `exit "$status"`. `|| true` 없음, trailing `exit 0` 없음.
- package.json 정합: 4 스크립트 모두 실재(`package.json:14-17`, `e2e` = `npm run build && LSC_E2E=1 vitest run …4 files… --no-file-parallelism --testTimeout=10200000 --hookTimeout=120000`) — 스크립트가 그대로 호출, SSOT 유지.
- check-8.log 진위: `:3-5` pre/post sha256 동일(87fe5a33…), `:8` 이하 `--- script ---` 에코가 디스크 본문과 일치, `:16` 빌드 라인 `git=a1af63b srcHash=1d68b4706c4c`로 동결 OID 묶임, 배너 `:50`(build)/`:56`(test)/`:269`(test:bun)/`:275`(e2e), `:402` `==> summary status=1`, `:856` `--- exit 1 ---`. RF-35(b) stall-evidence 출력 `:292-391` — durable spawns #0-#5 `delivered=true`, #6/#7 auditor 재스폰 `delivered=false`, durable tail에 `run_check.sh passed (exit 0)`·`check-1.log` 기록 — 배치 컨텍스트와 정확히 일치. `npm test` 스킵 대상 파일이 e2e 스테이지에서 녹색: `:392-395`(preset 453,568ms ✓, red-cycle 645,566ms ✓ — RF-33·RF-35(a) fix green 확인).

**(b) Worktree residue / base contamination — 판정: 적용됨(오염 없음).**
- `git status --porcelain`: **빈 출력** (untracked 포함 clean).
- `git rev-list --count HEAD..feat/lets-craft-v1` = **0** (기대 충족).
- `feat/lets-craft-v1..HEAD` = 39 commits, 전부 feature-scoped(cycle 0-3 docs, RF별 fix/test — `git log` 육안 확인). Delta 파일 표면 = `src/craft/` 4 + `test/` 8 — **한정 확인**, vendored tree 무손상.
- Worktree **외부** 잔류: OS tmpdir(`/var/folders/xt/…/T/`)의 `lsc-e2e*` 엔트리 **43건**(fixture tree + `lsc-e2e-config-*` overlay — 하니스 기존 by-design temp 사용, delta 이전부터 존재), RF-35(b) 증거 artifact `lsc-e2e-postcraft-timeout-*.json` **1건**(설계상 보존 대상 — 셈만 하고 삭제 안 함).
- 실사용자 omp 영역: `~/.omp/plugins/node_modules/lets-craft` → feature worktree symlink(mtime **Aug 31 21:37** — delta(Sep 1) 이전 시각; RF-4 pin의 설계된 재지정, 이번 사이클 신규 잔류 아님), `omp-plugins.lock.json` 동일 시각. `XDG_DATA_HOME` 미설정 → 제2축 부재(테스트의 조건부 스냅샷 `:570`과 일관).

---

## Impact
- **Scope**: multi-file (delta 자체는 src/craft 4 + test 8로 모듈 한정; 파급은 E2E 하니스 계약 전반)
- **Risk**: low — RF-30~35 모두 원문 충족 형태로 적용; 미커버 항목은 전부 MINOR 커버리지 갭
- **Affected areas**: model-facing text safety 표면(run-check/verdict/audit-policy 진단), E2E durable-evidence 계약(RF-33/35), hermetic 테스트 격리(RF-31), 결정적 체크 신뢰성(Axis 4a)

## Relationships
- f6bd406(seam) → 3a7ddd9/58ddcc8(소비), ef526ab(reader) → b4e0c1f/1e7fee8/774c705/a1af63b(소비)의 2본 2단 구조. §3.0의 a1af63b는 ef526ab reader와 488b686 guard 양쪽을 보강하는 후행 커밋. RF-31 테스트(`e2e-helpers.test.ts:541-595`)는 설치 omp의 DirResolver XDG 우선 규칙(dirs.ts:339-364)을 `:562`의 사전 mkdir로 **의도적으로 역이용**해 재현 후 temp에 가둠.
- §3.0 finding (3b) 검증: `e2e-full-cycle.test.ts:94` TEST_TIMEOUT_MS = PRE 3.6M + 3×RESUME 1.2M + CRAFT 2.4M + POST 3.0M + slack 0.9M = **13,500,000ms** vs `package.json:17` `--testTimeout=10200000` — 불일치 **확인됨**(내부 최악값이 외부 vitest 킬보다 55분 큼). 774c705 이전에도 12M>10.2M으로 선존재했던 잔여 리스크이며 RF-35(b) 원문(증거 보존+POST 재산정)은 이행됐으므로 RF 위반은 아니지만, 외부 노브 미조정 상태.
- §3.0 finding (3a) 검증: `EARLY_EXIT_DRAIN_MS=1200`(`e2e-helpers.ts:213,266`) — RF-35(a)의 `resultDelivered===true` 단언(`e2e-red-cycle-continuation.test.ts` 신설 블록)은 JSONL flush가 drain 창(1.2s) 내 완료됨을 timing 가정으로 함. check-8에선 green(`:394-395`) — 잠재적 비결정 축으로 관측 사항 기록.

## Recommendation
- auditor lane들이 판정 가중 시 참고할 MINOR 5건 (전부 apply-only, 비차단):
 1. [개선·MINOR] invalid-slug 4개 사이트(`run-check.ts:361`,`:502`; `verdict.ts:659`,`:698`)의 구분 축 seed 부재 — seed 테이블(`craft-run-check.test.ts:534`,`:636`; `craft-verdict.test.ts:984`,`:1334`)에 DEL/C1 시드 + escaped-containment 단언 추가.
 2. [개선·MINOR] describeAuditBase drift 분기(`verdict.ts:383-384`) — behindCount>0 + U+2028 baseBranch의 persisted ok snapshot(측정 tip 필수 — RF-32 guard로 empty 불가) replay 테스트 신설.
 3. [개선·MINOR] `sessionTaskSpawns` 다중 toolResult last-wins(`e2e-helpers.ts:1022-1031`) — 2중 toolResult(isError false→true) fixture 추가.
 4. [보완·MINOR] 버전 주석 drift: `e2e-helpers.test.ts:542-543`, `e2e-helpers.ts:22,36` "installed omp 18.0.11" → 실제 18.1.2 (dirs.ts:339-364 인용은 설치본에서 정확).
 5. [수정·MINOR cosmetic] `audit-policy.ts:330` 들여쓰기(f6bd406 유입).
- 추가 관측(판단은 auditor 소관): (3b) 외부 `--testTimeout=10200000` vs 내부 13.5M 불일치의 잔여, (3a) drain 1.2s 타이밍 가정.

## Next Steps
- 본 리포트는 3개 auditor lane(Aud4Plan/Aud4Regression)이 볼 수 없으므로, 메인 세션이 위 MINOR 목록·(3a)/(3b) 검증 결과·Axis 4 양 클래스 판정을 각 레인에 릴레이해야 한다. RF-31 소관 판정 요소는 모두 충족(full)이므로, RF-31을 소관에 두는 레인은 이 probe 결과를 그대로 VerificationResult의 evidence로 인용 가능.
```

### lsc-auditor 요지 (전문은 각 파일 — 한 부만 보존)

| Lane | 판정 (prefix 원형) | OID echo | Findings | 요지 | 전문 |
|---|---|---|---|---|---|
| lens ② plan·ADR 준수 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · Reviewed cycle 4 | 일치 | MAJOR 3 | RF-32 부분(producer 9-shape 전수 대조 — 역방향 회귀 없음, forged 2 shape 수용), PR5-5 Unmet→Partial, ADR P3 Partial 유지, PR-1 Guardrail Met, Must-NOT-Have Met, 4-file E2E Unmet; 반증 질문 성립 | `audit/auditor-4-plan.md` |
| lens ③ 회귀·코드품질 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · Reviewed cycle 4 | 일치 | MAJOR 5 · MINOR 2 | RF-30/32 완전(mutation proof), RF-33/34 부분; 9파일 보간 전수표(bypass: run-check:393 path·abort/init/land invalid-slug·land git error·verdict fs error); Unicode 경계 probe(U+FEFF/202E/200B/2060 raw); 반증 질문 반증됨. **형식 이탈**: 최종 메시지가 `{"report": "..."}` JSON 래핑 — 첫 줄이 `{`. 메인 세션 판정: `report` 값의 첫 줄이 정확히 `**AUDITOR VERDICT: APPROVE-WITH-CHANGE**`이고 OID echo·전 섹션 완결 → **heard**, 재스폰 생략(파일은 raw JSON verbatim 보존; `jq -r .report`로 복원) | `audit/auditor-4-regression.md` |
| lens ④ 인프라·설정 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · Reviewed cycle 4 | 일치 | MAJOR 5 · MINOR 3 | RF-30/31/33 완전, RF-35 부분; red 3건 귀속표(check-7 :284 = RF-35 도입 하니스 결함, check-7 :221 = 기존 하니스 결함, check-8 :339 = RF-35 잔여 하니스 결함 — 구현 결함 0); 설치 host agent-loop 이벤트 순서·`async.enabled:false` overlay 인용; 3b 산술 기각; stream marker 2종 결함; 4-file 노출면 열거 | `audit/auditor-4-infra.md` |

## Required Fix (AWC — craft가 추가 질문 없이 구현 가능하도록; 전건 apply-only, 재설계 0건)

**주의 — 대상 구분 (§6.1 symmetric cases):** RF-36·RF-38은 구현(src) 대상, **RF-37·RF-39·RF-40·RF-41은 테스트/하니스(test/, check 주석) 대상**이다 — 재진입 craft의 executor는 후자 4건에서 존재하지 않는 구현 결함을 찾아 헤매지 말 것. 특히 RF-39~41은 "E2E 하니스 자체의 결함"이며, 관측 대상 subprocess의 orchestration이나 src/craft 코드에는 손대지 않는다.

- **RF-36 [MAJOR] 보완** (RF-26/32 계열 신규 — origin: auditor ②, owners: [②, ③], apply-only) `src/craft/audit-policy.ts:266-276` `parseAuditBaseSnapshot`: producer(`verdict.ts:312-365` base→source→count 순서)가 만들 수 없는 두 shape를 거절하라 — (i) `status==="ok" && baseTip===sourceTip && behindCount!==0` (`git rev-list --count X..X`는 항상 0), (ii) `status==="unknown" && baseTip==="" && sourceTip!==""` (base 미해석이면 source는 측정되지 않는다). measured/measured unknown(rev-list 실패)은 정당 shape로 유지. parser doc comment에 **수용 shape 전수 열거**(②의 9행 표)를 기재해 다음 사이클이 고정 집합 대비로 검증하게 하라. 회귀: pure parser negative 2건 + same-cycle replay(constant invalid-state·`details.base` 억제·state bytes 불변) 2건.
- **RF-37 [MAJOR] 수정** (RF-33 계열 신규 — origin: auditor ③, owners: [③, ④], apply-only, **대상=테스트**) `test/e2e-preset-default.test.ts:236-238 → :250-276`: 순서를 재배치하라 — parent JSONL 전제(`sawPresetModelChange`, marker-bound tracer/explore call 존재, exact requested agent `lsc-tracer`/`lsc-explore`)를 **모든** child provider/model 단언(tracer inherit :237-238 포함)보다 먼저 단언하고, 그 뒤 tracer inherit → explore override 순으로 단언하라. 잘못된 requested agent를 seed한 synthetic parent JSONL로 전제가 model 단언보다 먼저 발화함을 reader-level 회귀로 고정하라. ④ MINOR(diagnostic total bound — non-string 필드·inventory 개수 cap)를 같은 파일에서 함께 해소하라.
- **RF-38 [MAJOR] 보완** (RF-34 잔여, ③④ 수렴 — origin: auditor ③, owners: [③, ④], apply-only) total serializer의 clean cutover: (a) `src/craft/abort.ts:51`, `src/craft/init.ts:72`, `src/craft/land.ts:226`의 bare `JSON.stringify(feature)` → `controlSafeEcho`; (b) `src/craft/run-check.ts:393`의 raw `${args.cwd}`/`${expectedWorktree}` 및 `Log:`/`Full log:` 경로 echo(:278-281, :449-450) → `controlSafeEcho`; (c) `abort.ts:64-76` reason echo, `land.ts:287-288,450,474-585` persisted identity/branch/`GitCommandError.message`/merge·remove·prune 메시지, `verdict.ts:426-428,462-463,499-500,526-527,587-588,720-721,793-803` decode/write/read error 메시지 → display boundary에서 `controlSafeEcho` (`GitCommandError` 자체는 raw 유지); (d) `extractFailureLines`에 `MAX_FAILURE_LINE_CHARS`·`MAX_FAILURE_SUMMARY_CHARS`를 추가해 escaped constant 절단 suffix로 byte-bound; (e) public `RunCheckDetails`에서 `stdout`/`stderr`를 제거하고 raw halves는 `isEmptyCheckTranscript`(:442, 유일 소비자 — 메인 grep)와 durable log에만 사용 (`skills/craft/SKILL.md:105` type 이름은 불변). 회귀: 이관 site별 DEL/C1/U+2028 seed(explore 지적 4-site `run-check.ts:361,:502`, `verdict.ts:659,:698` 포함) + escaped containment, multi-MB 단일 라인 failure 절단, details.stdout 부재 단언.
- **RF-39 [MAJOR] 수정** (RF-35(a) 잔여, ②③④ 수렴 — origin: auditor ④, owners: [④, ③], apply-only, **대상=테스트**) `test/e2e-red-cycle-continuation.test.ts:229-230,264-284`: kill 권한을 durable record로 옮겨라 — earlyExit의 `completedTaskSpawnSeen(stdout)` arm과 dead `RUN_CHECK_MARKER` arm을 제거하고, `findSessionFileByPrompt(sessionDir, "/skill:post-craft")`의 `sessionTaskSpawns`에서 `agent==="lsc-test-engineer" && taskText.includes(feature) && resultDelivered && resultIsError===false`가 성립하고 `continuationCommitLanded()`(또는 no-commit 경로의 fresh check-log index)가 관측된 뒤에만 true가 되게 하라(cycle 결합은 durable `.craft-state.json.auditCycle===1` 우선, stream `AUDIT_CYCLE_BEGUN_MARKER(1)`는 보조). 사후 단언(:281-284)은 같은 spawn 레코드의 `resultDelivered && !resultIsError`를 요구하고, 실행 OID 결합은 기존 with-commit/no-commit branch 증거로 명시 문서화하라. 자연 종료·timeout까지 exact call이 부재할 때만 orchestration omission으로 실패시켜라. `sessionTaskSpawns` 다중 toolResult(last-wins) 의미를 단위 회귀로 핀하라(explore 지적).
- **RF-40 [MAJOR] 수정** (RF-35(b) 잔여, ②③④ 수렴 — origin: deterministic-check, owners: [deterministic-check, ④], apply-only, **대상=테스트/하니스**) `test/e2e-full-cycle.test.ts:75-94`: 예산을 "실측 green 1회"가 아니라 **스킬이 sanction하는 최악 경로**로 도출하라 — POST_CRAFT_TIMEOUT_MS ≥ 관측 pre-respawn 47분(check-8 durable 08:56:56→09:43:52) + sanctioned 재스폰 wait class 50분(3,000,000ms) + finalization slack 15분 = **112분(6,720,000ms) 이상**; PRE_CRAFT_TIMEOUT_MS는 C8의 무근거 90→60 축소(:69-74)와 check-7 :221(plan consensus 진행 중 60분 kill)을 반영해 **최소 90분으로 복원**; TEST_TIMEOUT_MS는 기존 공식으로 재계산(`it(..., TEST_TIMEOUT_MS)` :471이 authority — package `--testTimeout`은 무관). 상수 주석에 도출식을 기재하고, green 경로에서 stage별 실측 duration을 evidence artifact에 기록해 다음 사이클이 상한 대비 실측을 핀하게 하라. `check/run_check.sh:19-24` sizing 주석을 per-file local override 기준으로 정정하라(④ MINOR).
- **RF-41 [MAJOR] 보완** (신규, ④ + stream 결함 ③④ 수렴 — origin: auditor ④, owners: [④, explore], apply-only, **대상=테스트/하니스**) (a) `test/e2e-full-cycle.test.ts:220-224` pre-craft(resume 포함)·craft timeout arm에 `postCraftStallEvidence`를 stage-parameterized `stageStallEvidence(stage, result, sessionDir, feature)`로 일반화 적용하라 — check-7 :221은 귀속 증거 0으로 red였다. (b) stage marker를 durable source로 재정의하라: `RUN_CHECK_MARKER="script sha256: "`는 `run-check.ts:276-282` 결과 text에 producer가 없는 dead marker(transcript :248에만) — 결과 text에 실재하는 `"lets-craft: run_check.sh "` prefix로 교체하거나 session JSONL toolResult text·`.craft-state.json.auditCycle`·check-log index를 읽는 durable stage-observation helper로 대체하고, 32MB rolling tail(`e2e-helpers.ts:192-201`)에 의존하는 `streamMarkerCount`/earlyExit 사용처(④ 열거: continuation :229-239, full-cycle :136-142, escalation :121-145,:171-218)를 durable 우선으로 이관하라. explore owner의 probe: `{probe: "stream marker producer/consumer 정합", scope: [src/craft/run-check.ts 결과 text, src/craft/verdict.ts begin 결과 text, test/e2e-helpers.ts marker 상수 + 4 E2E 파일 사용처], successCriterion: "모든 stream marker 상수가 production 결과 text에 producer를 가지며 long-run 단언은 durable source를 authority로 사용"}`.

**비차단 권고 (Required Fix 아님):** ① `controlSafeEcho` regex에 BOM/bidi(U+202A–202E, U+2066–2069)/zero-width(U+200B–200D, U+2060, U+FEFF) 추가(③ MINOR, RF-34 최소 범위 밖), ② E2E diagnostic의 model-authored task/snippet/stdout 재방출에 `controlSafeEcho` + 결정적 절단(③ MINOR), ③ 권고 ① chmod 회귀의 root skip 가드(④ MINOR), ④ `describeAuditBase` drift 분기(behindCount>0 + U+2028 baseBranch) replay 회귀(explore MINOR), ⑤ 버전 주석 18.0.11→18.1.2·audit-policy.ts:330 들여쓰기(explore MINOR), ⑥ test/** 포함 `tsc --noEmit` 단계(audit-1 이월), ⑦ orphan helper 2종(audit-0 이월).

**Fix-verification 스코프 노트**: 다음 사이클은 §5 fix-verification. 승계 라우팅 — RF-36: ②+③, RF-37: ③+④, RF-38: ③+④, RF-39: ④+③, RF-40: deterministic-check+④, RF-41: ④+explore. 다음 `lsc_audit_begin`(candidate 5)은 escalation 게이트 비발동(다음 due는 cycle 6 — cycle 6 진입 시 `[Audit Escalation]` 발동 예정). **경고 갱신 — 계열 반복의 매트릭스 내재화**: (1) audit-3의 RF-18/RF-20 계열 4세대 경고는 RF-30·RF-31 완전 적용으로 **해제**. (2) 신규 경고 — **E2E stage-budget 계열**(check-5/6 :241 → RF-35(b) → check-7 :221 / check-8 :339 → RF-40/41, 2세대)은 이번에 처방 *방법*을 "실측 1회 기준"에서 "sanctioned 최악 경로 기준"으로 교정했다. 차기 사이클에서 RF-40의 도출식대로 예산이 적용됐음에도 full-cycle이 stage timeout으로 또 red면, 그것은 "real-LLM 3단계 파이프라인이 고정 wall-clock 안에 완료된다"는 AC-8 검증 설계 자체의 결함이므로 해당 항목의 fixCompleteness는 `needs-redesign`(예: stage별 분리 E2E·resumable 단계·fixture post-craft lane 수 축소)으로 기재할 수밖에 없고, §4.2 named case matrix의 `new needs-redesign MAJOR` 행이 그 사이클을 **REJECT로 고정**한다. (3) **base-snapshot parser 계열**(RF-26 → RF-32 → RF-36, 3세대)은 RF-36이 수용 shape 전수 열거를 doc comment로 고정하므로 종결점이 명시된다 — 차기에 그 열거 밖 shape가 또 발견되면 동일 규칙으로 `needs-redesign`.

## Proposed Spec/Plan Amendments

없음 — 모든 잔존 결함은 구현·테스트 하니스 측이다. AC-8의 "기존 E2E 전체 green"은 문언 유지 가능(예산이 sanctioned 경로를 담으면 성립한다 — check-4가 실증). 위 경고 (2)의 조건이 차기에 발동하면 그때 AC-8 검증가능성 분류(결정적/E2E → 하이브리드)의 [Spec Change] 제안을 검토한다 — 지금은 제안하지 않는다.

## Adversarial Class Matrix (§4.1.14 — 판정은 메인 세션)

| Class | Owner | 판정 | 근거 |
|---|---|---|---|
| 결정적 체크의 형해화 | lsc-explore | **excluded** | run_check.sh 무변경(sha 3중 확인), 4단계 실호출·`\|\| status=1` 누적·`exit "$status"`, package.json 4 스크립트 정합(explore Axis 4a), check-8.log 진위(:3-5 sha, :16 `git=a1af63b`, 배너 4종, :402/:856). 이 check는 이번에도 E2E 결함을 기계 검출했다 — 트리거 부재 |
| Worktree residue / base contamination | lsc-explore | **excluded** | porcelain 空(untracked 포함), behind 0, base..HEAD 39커밋 전수 본기능, delta 표면 src/craft 4 + test 8 한정, vendored 무터치. OS tmpdir의 `lsc-e2e*` 43건·RF-35(b) artifact 1건은 하니스 by-design(worktree 외부·삭제 대상 아님), `~/.omp/plugins` symlink는 RF-4 pin(Aug 31, delta 이전) |
| Spec AC boundary inputs | (lens ① 부재 — §5 owner routing의 정당 결과) **메인 세션 직접 방면** | **applied** | AC-8 실행 경계 잔존: full-cycle stage-budget 4회 연속 kill(RF-40/41), continuation race(RF-39). RF-31 hermetic 경계는 양축 폐쇄(env-조건부 구멍 해소). AC-1/2 경계는 escalation suite 3/3 green 4회 연속 + 이번 사이클 실사용(cycle 4는 비-due, 정상 발행)으로 실증 |
| Post-resume state consistency | lens ③ | **applied** | RF-32로 `ok+empty`→"in sync" 전이 폐쇄(:269-270, replay byte 불변 :1398-1433). 잔존: parser accepted superset — forged `ok+equal tips+count>0`이 canonical "base drift" WARN으로 replay 가능(RF-36, ② 확정). run-check persisted identity exact 비교(:374-400) 유지 |
| Prompt-injection surface | lens ③ | **applied** | RF-34 seam은 total(C0+C1+DEL+2028/2029, circular/undefined)이나 이관 미완: abort/init/land invalid-slug bare JSON, run-check:393 raw path, land git error raw, verdict fs error raw, failure summary byte-unbound + raw details(RF-38). check-8.log:304-305·:388의 directive-형 재스폰 assignment 재방출은 데이터로 취급(③ 관측, 비차단 권고 ②) |

## §4.2 판정 근거 (3-layer 종합 + named case 대응)

- **Layer 1**: 결정적 체크 **FAIL**(check-8) — 하드 게이트 발동, APPROVE-family 불가. 무응답 lane 0(explore·③ 형식 이탈은 heard 판정 — 근거 §Lane Reports), audit-level prefix 위반 0, 재스폰 0.
- **Layer 2**: 생존 CRITICAL 0건. 생존 MAJOR 6건 — RF-36(②), RF-37(③), RF-38(③④ 수렴 + 메인 grep), RF-39(②③④ 3-lane 수렴), RF-40(②③④ 3-lane 수렴 + deterministic-check 기계 증거), RF-41(④ + ③ stream 관측). 래칫 위반 없음(하향 0건 — ②의 RF-32·③의 RF-33 "부분"은 원문 기준 재귀속했을 뿐 severity MAJOR 유지). explore 상향 래칫: coverage 갭은 전건 MINOR로 기존 MAJOR에 병합, 독립 상향 0건.
- **Layer 3**: 폐기 1건(3b vitest timeout 산술 — :471 직접 재독 + ③④ runner 소스 인용), 그 외 전 finding 인용 좌표 직접 재독으로 실재 확정.
- **Named case 대응 (§4.2 매트릭스)**: RF-34/35 = `partial original apply-only`(원 항목 부분 적용, remediation 구체 apply-only, owner set 완비) → **AWC**. RF-36/37/38(e)/41 = `new unrelated apply-only MAJOR` → **AWC**. REJECT 행 해당 0건: 신규 CRITICAL 없음, `needs-redesign` 없음(RF-40은 상수·주석 변경 + 도출식 기재로 닫히는 apply-only이며, 도출식 자체는 check-8 durable timestamps와 스킬 §1 wait class에서 산술적으로 확정된다 — 단 경고 (2)의 조건부 needs-redesign을 명시했다), unheard/unroutable/inconclusive owner 없음, bundle invariant 위반 없음. audit-3 이월 경고(RF-30·RF-31 4세대) **미발동** — 양 항목 완전 적용을 ③④·explore·메인 세션이 독립 확정.
- **lane 전원 AWC와의 정합**: 세 auditor lane 모두 AWC이고 도달 경로도 동일하다(구현 결함 red 0, 하니스/이관 잔여만). 메인 세션 판정은 lane 복사가 아니라 위 매트릭스 경로로 독립 도출됐다 — REJECT로 갈 근거(broad/severe, needs-redesign, CRITICAL, unheard)가 하나도 성립하지 않고, 모든 생존 blocking finding에 구체 apply-only remediation과 완비된 owner set이 있다.
- **정직성 검토 — "apply-only"의 진실성**: E2E stage-budget 계열이 2세대라는 사실을 감추지 않는다. 이번 처방은 예산 *수치*가 아니라 *도출 방법*을 바꾸며(실측 1회 → sanctioned 최악 경로), 그 방법으로도 실패하면 위 경고 (2)가 매트릭스 메커니즘으로 REJECT를 강제한다. 이는 산문 커밋이 아니라 다음 사이클의 fixCompleteness 기재 규칙이다.

**판정: APPROVE-WITH-CHANGE** — 수정 필수(RF-36~41), §7.1에 따라 이번 사이클 land 불가. 다음 사이클은 §5 fix-verification이며, `lsc_audit_validate`는 check-8 threshold 초과의 fresh green log를 요구한다.
