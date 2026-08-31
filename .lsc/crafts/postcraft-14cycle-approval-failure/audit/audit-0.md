# Audit 0 — postcraft-14cycle-approval-failure

## Header

| 항목 | 값 |
|---|---|
| Feature | postcraft-14cycle-approval-failure |
| Date | 2026-08-31 |
| Audit cycle | 0 (첫 full audit) |
| Mode | full |
| Implementation branch | `feat/postcraft-14cycle-approval-failure` @ `2607199f3a15f5a840e6301840b2e08881c4d5c5` (frozen OID — §3.0 테스트/체크 저작 커밋 포함) |
| Worktree | `.lsc/worktrees/postcraft-14cycle-approval-failure/` |
| Base branch | `feat/lets-craft-v1` (origin/HEAD 체인 1순위 검출) |
| Prior audit | 없음 (N=0) |
| 결정적 체크 | PASS — `check/logs/check-1.log` (threshold check-0 초과, cycle-freshness 충족) |
| 감사 lane | `lsc-explore` ×1 + `lsc-auditor` ×4 (lens ①②③④ — diff에 tool registration·env/flag 경계·package.json e2e 배선·fixture 변경이 실재하여 lens ④ 스폰 조건 충족). 무응답 lane 0 |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## Spec Compliance Matrix (lens ① 소유 — 전 행 메인 세션 직접 재검증 또는 수렴+green 테스트 근거 명기)

### Acceptance Criteria

| Requirement | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| AC-1 사이클 상한 | **Partial** | `src/craft/audit-policy.ts:24-41,345-454`; `test/audit-policy.test.ts:106-177`; `test/craft-verdict.test.ts:267-385` | live 3/fixture 2 SSOT·durable pending·Continue 주기 재발동 구현·테스트 확인(직접 재독). 단 disposition validator의 trim-통과(RF-1)가 exact-label 경계를 깨고, equality+pending 순서(RF-3)·mixed interval(RF-2)이 계획 invariant를 위반 — 메인 세션이 `:53-54,:391-442,:253-261` 직접 확인. |
| AC-2 처분 기록 | **Partial** | `src/craft/state.ts:371-445`; `src/craft/audit-policy.ts:404-418`; `test/e2e-audit-escalation.test.ts:152-193` | 3처분 atomic 기록·terminal 후 begin/land 거부는 구현·검증됨. 단 trim-통과 padded label이 비정규 문자열의 malformed TerminalDecision으로 durable 저장될 수 있음(RF-1, 직접 확인: `:417` raw disposition 전파). |
| AC-3 fail-closed 불변 | **Met** | `src/craft/land.ts:283-313` (직접 재독); `test/craft-land-flow.test.ts:575-589,643-692` | strict 재검증(verdict-not-approve)·aborted·terminal이 nonce 소비 전(⑦b) 거부 — 코드로 확인. |
| AC-4 base drift | **Met** | `src/craft/verdict.ts:298-391`; `src/craft/land.ts:385-434` (직접 재독) | 감지@begin(behind count·authority 구분·unknown no-fallback), 차단@land(effect-boundary live recheck 직후·`effects.merge` 직전 added-path 교집합, `GitCommandError`→`added-path-unknown` fail-closed). recheck가 approved targetOID=live base tip을 보증하므로 spec 문언("merge 직전 base tip 대비") 충족 — lens ①의 반증 시도 결과와 메인 세션 재독 일치. |
| AC-5 측정 위생 산문 | **Met** | `skills/craft/SKILL.md:100-129`; `skills/post-craft/SKILL.md:91-110,155-180`; `agents/lsc-auditor.md:104-135`; `test/skill-contract.test.ts:850-882,965-968,1073-1088,1142-1159` | yield 전 check 의무·red 완료 금지·commit-first·양쪽 인용·Expected State 템플릿 전부 명문+green 테스트. |
| AC-6 검증 불가 AC 게이트 | **Met** | `skills/pre-craft/SKILL.md:279-285` (직접 재독) | AC class 의무 + live-전용/하이브리드 잔여의 scope/비증명/잔여 불확실성 3중 completeness gate. |
| AC-7 다중-lens AWC | **Met** | `skills/post-craft/SKILL.md:227-294`; `test/skill-contract.test.ts:1002-1063` | concrete `ReviewerRef`/bundle 정규형/owner routing/four-level precedence 정의됨(문서 존재 검사 기준 충족). plan acceptance의 명명된 case fixture 미고정은 RF-14 (plan 매트릭스 소관). |
| AC-8 E2E | **Partial** | `package.json:17`; `README.md:239-256`; `test/e2e-audit-escalation.test.ts`; `test/e2e-red-cycle-continuation.test.ts`; `check/logs/check-1.log:53-56` | 4-file 배선·신규 2 suite 실재. 그러나 이 OID에서 4-file E2E의 green 실행 증거 0건(check는 e2e skip — RF-10), 표준 명령의 자식 프로세스는 global plugin link가 가리키는 base checkout 빌드를 로드(RF-4, 메인 세션 프로브로 재확인: readlink → base root), Continue/Abort/red-continuation assertion이 plan 고정 predicate보다 약함(RF-7/8). |
| AC-9 단위 | **Partial** | `test/audit-policy.test.ts` 전편; `test/craft-verdict.test.ts`; `test/git-runner.test.ts` | 대부분 커버. 미커버: land `added-path-unknown` 분기 행동(RF-12), 조건부 assertion 2건(RF-11), explore 지적 6개 분기(RF-15). |
| AC-10 하위 호환 | **Met** | `src/craft/state.ts:103-128,189-218,252-270` (직접 재독); `test/craft-state-version.test.ts:284-334` | 신규 필드 전부 optional·legacy 관용·미래 version 거부. `setActiveCraft` 보존 누락(RF-5)은 호환성 결함이 아니라 durability 결함으로 분류 (lens ③ finding). |

### Constraints

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| C-1 fail-closed 불변 | Met | `src/craft/land.ts:283-313` | REJECT/terminal은 approval·selection·base와 무관하게 land 불가 — 직접 확인. |
| C-2 강제 경계 혼합 | Met | TS: `audit-policy.ts`/`verdict.ts`/`land.ts`; 산문: SKILL/agents + Expected State 관측 흔적 | 계획대로 분리. |
| C-3 optional + 읽기 관용 | Met | `src/craft/state.ts:103-128` | AC-10과 동일 근거. |
| C-4 기존 atomic writer | Met | `src/craft/state.ts:189-198,371-445` | 모든 outcome 단일 persist 경로 — 직접 확인. |
| C-5 순수 함수/thin wrapper | Met | `audit-policy.ts` pure core / `verdict.ts:576-632` wrapper | wrapper만 flag/env 판독. |
| C-6 태깅·exact labels | **Partial** | `src/craft/audit-policy.ts:53-54`; `test/audit-policy.test.ts:87` | 태그/suffix/canonical 배열은 준수하나 validator trim이 verbatim 경계 위반(RF-1) — 4/4 lane 수렴 + 직접 확인. |
| C-7 fixture 상한 2 | Met | `audit-policy.ts:27`; `test/audit-policy.test.ts:119-177` | 2→4 재발동 고정. |
| C-8 cap SSOT TS 상수 | Met | `audit-policy.ts:24,27`; `skills/post-craft/SKILL.md:339` (직접 재독: "Never restate those numbers here") | 산문 수치 별칭 없음. |
| C-9 방향 결정 전용 | Met | `verdict.ts:509-514`; `skills/post-craft/SKILL.md:344` | Abort 실행은 `lsc_craft_abort` 위임, merge 권한 미생성. |
| C-10 기존 audit 형식 호환 | Met | `verdict.ts:25-68`; Expected State/Base Drift는 additive 섹션 | literal parser 무손상. |

### Non-Goals (scope creep 검사)

| Non-Goal | Status | Evidence | Notes |
|---|---|---|---|
| 재감사 스코프 동결 미도입 | Met | `skills/post-craft/SKILL.md` full 재감사 유지 | 상한만 추가. |
| 대상 프로젝트 회생 산출물 없음 | Met | `open-questions.md:3-9` | 후속 후보로만 기록. |
| REJECT 최선안 land 예외 없음 | Met | `land.ts:283-313` | APPROVE-family 요구 무손상. |
| 인용/commit-first 기계 강제 도구 없음 | Met | `agents/lsc-auditor.md:104-135` (산문 계약) + explore 파일 맵에 해당 모듈 부재 | 산문 경계 준수. |
| 병렬 멀티패스 집계 미도입 | Met | diff 파일 집합(explore 맵) | 해당 기구 없음. |
| pre-craft/craft 상한 불변 | Met | `skills/pre-craft/SKILL.md:274-275` (soft 10/hard 20, 직접 재독); `skills/craft/SKILL.md:167` ("The cap is 1") | 불변 확인. |
| check 하니스 표준화 없음 | Met | run_check.sh는 per-feature 산출물 | 준수. |

## Plan Compliance Matrix (lens ② 소유 — 채택 + 쟁점 행 메인 세션 재검증)

lens ②가 저작한 전수 매트릭스(Guardrails MH-1~9/MNH-1~6, ADR-1~7, PR-1~PR-5 항목별, Cross-PR SC-1~8)는 `audit/auditor-0-plan.md`에 원문 보존. 메인 세션은 다음을 직접 재검증하여 채택·수정했다:

| Step/Decision (쟁점 행) | 채택 Status | 메인 세션 재검증 결과 |
|---|---|---|
| MH-3 exact labels만 소비 | **Unmet** | `audit-policy.ts:53-54` trim + `:411-417` raw 분기 직접 확인 — lane 판정 유지. |
| PR1-4(c) 전 record interval 동일 | **Partial** | `:253-261` history-only 루프 직접 확인, pending 비교 부재 — lane 판정 유지 (RF-2). |
| PR1-4(i) equality replay 무-write | **Partial** | `:391-442` pending consume가 `:440` equality replay보다 선행 — 직접 확인 (RF-3). lens ②의 실코드 프로브(consume-continue 관측)와 일치. |
| PR4-5 EXEC-RETRY topology | **Partial (Notes 수정)** | lane 주장 중 "테스트가 요구하는 'Deleted parallel lanes are never re-spawned' 문구가 skill에 없다"는 **반증됨** — 문구는 `skills/craft/SKILL.md:173`에 실재(grep + suite green). 생존 잔여: `:167` EXEC-RETRY의 "re-spawn that executor" 문언 및 `no → retry-exhausted` 매핑이 `:181-183` 표·`plan.md:325-326`과 모순(RF-6). |
| PR4-6 exact incomplete reasons | **Partial** | `skills/craft/SKILL.md:167` vs `:181` 모순 직접 확인 (RF-6). |
| PR5-3 Continue 정확 2회 | **Partial** | `test/e2e-audit-escalation.test.ts:118-126` 직접 재독 — 실제로는 success 정확 1회+last-is-success까지 단언하나 isError 재발행을 `>=2`로 허용, plan.md:411의 `total executions=2` predicate와 불일치 (RF-7). lane 서술("임의 duplicate 통과")보다 좁은 결함이나 계획 위반은 실재. |
| PR5-4 Abort delegation 증거 | **Partial** | `:173-178` 조건부 assert+warn 직접 확인 (RF-7). |
| PR5-5 red continuation B-bound 증거 | **Partial** | `:193-194` raw `"toolName":"task"` substring early-exit 직접 확인 — 결과는 false-pass가 아니라 구조적 flake(§3.4 불일치 기록 참조) (RF-8). |
| PR3-A3 git 실패 손실 없음 | **Partial** | `land.ts:422-431` fail-closed 분기는 실재(직접 확인)하나 land seam 통합 테스트 부재 (RF-12). |
| MH-1/MH-4/MH-5/MH-6/ADR-1~4/PR1-5/PR1-6/PR2 계열/PR3-1~8/PR4-1~4/7~12/PR5-1/6 등 Met 행 | **Met (채택)** | 쟁점 없는 Met 행은 lens ②·lens ① 판정 수렴 + green 테스트(check-1.log 61 files/1690 passed) + 메인 세션의 load-bearing 지점 spot 재독(`land.ts:283-434`, `verdict.ts:425-560`, `state.ts:236-270`, `audit-policy.ts` 전편, pre-craft/post-craft SKILL 해당 절)으로 채택. |

## Code Quality & Regression Risk (§3.4 종합)

### 수렴 (2개 이상 lane 독립 지목 — 메인 세션만 수렴 선언)

1. **disposition trim 결함** — lens ④(CRITICAL)·②(CRITICAL)·③(MAJOR)·①(MAJOR) 4/4 수렴. Layer 2 래칫: **CRITICAL**. 메인 세션 직접 확인: `audit-policy.ts:54` `includes(value.trim())` → `:411` raw 비교 실패 → `:417` padded 문자열이 TerminalDecision으로 durable persist → 이후 `parseDecisionRecord` 거부로 feature 영구 invalid-state. `test/audit-policy.test.ts:87`이 결함을 정답으로 고정. 분류: 수정 · CRITICAL.
2. **AC-8 E2E 증거 공백** — lens ①(MAJOR)·④(MAJOR)·explore(사각지대 관측) 수렴 + lens ④ 단독의 **plugin link CRITICAL**(메인 세션 프로브 재확인: `readlink ~/.omp/plugins/node_modules/lets-craft` → base checkout, worktree dist `2607199` vs 자식 프로세스가 로드할 base 빌드). 래칫: **CRITICAL**. 분류: 수정 · CRITICAL (하니스) + 보완 · MAJOR (check e2e 생략 — §3.0 소관).
3. **Continue E2E exact-2 완화** — lens ②③④ 수렴, MAJOR. 4. **Abort E2E soft-pass** — lens ②③④ 수렴, MAJOR. 5. **red-continuation raw substring early-exit** — lens ②③④ 수렴, MAJOR. 6. **added-path-unknown 통합 테스트 부재** — lens ①②+explore 수렴, MAJOR.

### 단독 lane 발견 (커버리지≠신뢰 — 미교차 관측임을 명시)

- lens ② 단독: **mixed interval CRITICAL** (RF-2)·**equality+pending CRITICAL** (RF-3) — 둘 다 메인 세션 코드 재독으로 실재 확정. 자연 발생 경로는 없고(pending은 항상 ledger.interval로 생성, cycle+decision은 단일 atomic write) 위조/손상 state 표면이나, (a)~(i) fail-closed 장치의 명시적 계획 범위(`plan.md:174-177`) 내 위반.
- lens ③ 단독: `setActiveCraft` 보존 목록에 `releaseApproval`(주석 `:242-245`는 보존 명시)·`auditBaseSnapshot` 누락(`:259-265`), init.ts:97의 release 수동 보상만 존재 — 직접 확인, MAJOR (RF-5). seeded E2E `.craft-state.json` 추적(`e2e-helpers.ts:623-636` `git add -A`, worktree 브랜치에 ignore 부재 — 직접 확인), MAJOR (RF-9). prompt-injection 표면(feature/decidedAt 무구획 보간 — `audit-policy.ts:96-100,385-386`, `verdict.ts:452-454`), MAJOR (RF-13). dead helper `toolCallSummaries`, MINOR.
- lens ② 단독: 조건부 corrupt-state assertion(`test/audit-policy.test.ts:277,296` — 직접 확인), MAJOR (RF-11); bundle 명명 case fixture 부재(plan.md:389 대비), MAJOR (RF-14).
- explore 단독: 커버리지 공백 6건(관측; RF-15), `state.ts:354 recordAuditCycleBegin` 프로덕션 고아(src 호출자 0, 테스트 전용 잔존) — clean-cutover 관점 개선 · MINOR, non-blocking.

### 불일치 기록 (양쪽 판독 + 메인 세션 판정)

- **trim 심각도**: ②④ CRITICAL vs ①③ MAJOR → 래칫상 CRITICAL 유지. 메인 세션 판정도 CRITICAL 지지(복구 불가능한 durable ledger 오염 + 결함을 정답으로 고정한 테스트).
- **Continue E2E 완화의 폭**: lane들은 "중복 begin 전반 허용"으로 서술했으나 실제 테스트는 success 정확 1회·최종 호출 success까지 단언(`:121-126`) — isError 재발행만 허용. 계획의 load-bearing predicate(`total executions=2`) 위반은 실재하므로 MAJOR 유지하되 폭은 메인 세션 판독으로 정정.
- **red-continuation early-exit 결과**: ④는 증거 유실, ③은 구조적 flake — 메인 세션 판독: early-exit가 task start에서 발화하면 후속 assertion(`taskSpawnCount`, descendant commit)이 실패하므로 **false-negative flake**이지 false-pass가 아님. MAJOR 유지.

### 폐기 기록 (§4.2 Layer 3 — 직접 검증으로 거짓 판명된 것만)

| 폐기 대상 | 제기 lane | 주장 | 메인 세션 관측 | 처분 |
|---|---|---|---|---|
| plan lane finding 5의 부분 주장 | lens ② | "`test/skill-contract.test.ts:935`가 요구하는 'Deleted parallel lanes are never re-spawned' 문구가 craft skill에 없다" | 문구는 `skills/craft/SKILL.md:173`에 실재(grep 매치). check-1.log 전 suite 0 failed와도 정합 — 문구 부재라면 해당 테스트가 실패했어야 함 | **부분 폐기** — 거짓 전제만 폐기. 생존 잔여(`:167` EXEC-RETRY 문언·reason 매핑 모순)는 RF-6으로 이월 |

그 외 폐기 없음 — 검증한 모든 finding은 인용 좌표에서 사실로 확인되었다.

## Deterministic Check (§3.1)

- **결과: PASS** (exit 0) — 재저작 cap 미발동 (isError 0회), manifest-runner WARN 없음.
- Log: `check/logs/check-1.log` (516 lines) — cycle-0 threshold(check-0) 초과, freshness 충족.
- Script sha256: `faae7e2f5cfcd1e5512d22486e77d3e399d9a51e5b43639cbfdfdb14d239d973` (pre/post-exec 동일 — 로그 헤더 기록)
- 실행 단계: `npm run build`(gen-version+tsc — typecheck 포함) → `npm test`(vitest run). 생략+사유 주석: lint(스크립트 부재)/typecheck 단독(build가 tsc 포함)/test:bun/e2e(장시간 subprocess).
- 발췌:
  ```
  $ bash .../check/run_check.sh
  script sha256: faae7e2f...d973
  ==> build (includes tsc typecheck)
  ==> test (vitest run)
   Test Files  61 passed | 6 skipped (67)
        Tests  1690 passed | 14 skipped (1704)
     Duration  66.38s
  ==> summary status=0
  ```
- 한계(감사 판단): 6 skipped 파일 = e2e 4종(describe.skipIf(LSC_E2E)) 포함 — AC-8의 E2E green은 이 로그가 증명하지 않음. 형해화 판정은 아래 Adversarial Class Matrix 항목 1.

## Lane Reports (§4.1.7)

### lsc-explore — verbatim 전문

```json
{
  "auditCycle": 0,
  "checkHollowing": {
    "conclusion": "Floor 수준 형해화 아님 — build/tsc/typecheck와 §3.0 저작 유닛 스위트 전부 실호출됨. 단 PR-5 e2e 계층(실 스킬 §2.4 게이트 라운드트립·fixture 정답 소비·red-cycle OID 재증명, AC-1/2/3/8 서브프로세스 증거)은 LSC_E2E=1 수동 실행에서만 검증 가능하며 결정적 체크 사각지대.",
    "evidence": [
      "{worktreeAbs}/.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh:27 'npm run build || status=1' (package.json:13 gen-version+tsc → typecheck 포함), :29 'npm test || status=1' (package.json:14 vitest run), :31 exit, :19 set -uo pipefail",
      "vitest.config.ts:12 include ['test/**/*.test.ts'] → 저작 스위트(git-runner/audit-policy/craft-verdict/state 3종/abort/land-flow/skill-contract/fixtures/deferred-pool) 전부 실행; :13 exclude fixtures/**(의도적 실패 node:test 프로젝트 방어)",
      "신규 e2e 2종은 include glob에 매치되나 describe.skipIf로 무음 스킵: test/e2e-audit-escalation.test.ts:45,106 / test/e2e-red-cycle-continuation.test.ts:42,122 (RUN_E2E = LSC_E2E==='1')",
      "run_check.sh:15 자각적 문서화('e2e — omitted: hours-long'); package.json:23 수동 npm run e2e만 4종 e2e 실행"
    ]
  },
  "coverageGaps": [
    {
      "gap": "anchorBaseSnapshot unknown-degradation 3분기 미커버 (source tip 실패 / rev-list 실패 / non-integer count). 검증된 것은 baseTip 해석 실패뿐(test/craft-verdict.test.ts:845-881)",
      "loc": "src/craft/verdict.ts:318-340"
    },
    {
      "gap": "added-path-unknown fail-closed 분기 + throw 재던지기 미커버 — test/craft-land-flow.test.ts:65는 reason-code 리스트 멤버십만 assert (added-path-overlap은 :721,:755,:771 실분기 검증과 대비)",
      "loc": "src/craft/land.ts:424-432"
    },
    {
      "gap": "describeAuditBase unknown-status WARN 문안('could not be measured') 미커버 — test/ 내 0매치",
      "loc": "src/craft/verdict.ts:372-373"
    },
    {
      "gap": "markCraftAbortedAt singleton-sync 분기 미커버 — test/craft-abort.test.ts:106은 singleton 부재 경로만",
      "loc": "src/craft/state.ts:313-315"
    },
    {
      "gap": "singleton-path invalidatePreparedOperation() 미커버 — featureDir 경로는 test/craft-abort.test.ts:104-105 검증, singleton은 test/destructive-approval.test.ts:426-433이 pending approval만",
      "loc": "src/craft/abort.ts:59"
    },
    {
      "gap": "auditBaseSnapshot 클리어 분기 미커버 — 스냅샷 보유 중 observation 없는 begin이 prior snapshot을 undefined로 지우는 동작 무assert (test/deferred-pool-regression.test.ts:276-289는 auditValidated만)",
      "loc": "src/craft/state.ts:418,430"
    },
    {
      "gap": "minor: GitCommandError.exitCode 미검증(test/git-runner.test.ts:60-69); src/utils/git.ts:35-37 Buffer 분기는 encoding:'utf8' 하 도달 불가",
      "loc": "test/git-runner.test.ts + src/utils/git.ts"
    }
  ],
  "frozenOidCheck": {
    "computed": "2607199f3a15f5a840e6301840b2e08881c4d5c5",
    "match": true
  },
  "mapping": {
    "clusters": {
      "A_git_runner_SSOT": "src/utils/git.ts(runGit/runGitText/splitNul/GitCommandError) ← src/artifacts/worktree.ts:16-27 위임 ← src/craft/land.ts:135-139 gitIn ← src/craft/verdict.ts:12 runGitText; test/git-runner.test.ts",
      "B_audit_escalation_SSOT": "src/craft/audit-policy.ts(pure) → verdict.ts:392 performAuditBegin 게이트(6 branch) + 래퍼:578-632(interval/baseSnapshot 주입) → state.ts:399 applyAuditBeginOutcome·:306 markCraftAbortedAt → abort.ts:36-59 exact-root 위임 → land.ts:302-316 ⑦b 차단; test 5종",
      "C_base_and_added_path": "verdict.ts:343 observeAuditBase + land.ts:398-434 added-path 게이트(reason codes :72-73) → state.ts:128,147-164 auditBaseSnapshot; test/craft-verdict.test.ts:769-918"
    },
    "counts": "51 files (지칭 49 아님): .lsc/crafts 23 + src 7 + test 14 + prose/config 7, +5986/−159",
    "proseContracts": "skills/post-craft/SKILL.md §2.3/2.4/5.0-5.5·skills/craft/SKILL.md §5.0·agents/lsc-auditor.md ↔ test/skill-contract.test.ts:1100-1111,1164-1173; fixtures/sample-ts-cli/answers.json:52-58 ↔ test/fixtures.test.ts ↔ test/e2e-helpers.ts writeEscalationAnswersVariant"
  },
  "recommendation": "lens lane들이 위 6개 공백 + state.ts:354 recordAuditCycleBegin 프로덕션 고아(verdict.ts가 applyAuditBeginOutcome으로 대체, src 호출자 0, 테스트 전용 잔존)의 clean-cutover 정당성을 verdict 가중 요소로 반영할 것. 본 lane은 verdict 미렌더.",
  "residue": {
    "conclusion": "residue/오염 없음",
    "worktree": "git status --porcelain 비어있음; ignored 런타임 아티팩트만(.craft-state.json, check/logs/, dist/, node_modules/, src/generated/)",
    "scope": "51개 변경 전체 기능 범위 내 — 벤더드 트리 무터치, package.json은 e2e 스크립트 +1/−1뿐",
    "base": "feat/lets-craft-v1..HEAD 10커밋 모두 본기능(docs 4 + PR-1~5 + test/check), 이질 혼입 없음"
  }
}
```

### lsc-auditor 요지 (전문은 각 파일 — 한 부만 보존)

| Lane | 판정 (prefix 원형) | Findings | 요지 | 전문 |
|---|---|---|---|---|
| lens ① spec 정합 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · OID echo 일치 · Reviewed 0 | MAJOR 4 | AC-4 반증 실패(=구현 정합), trim 경계·AC-8 미입증·E2E assertion 약화·added-path-unknown 미테스트 | `audit/auditor-0-spec.md` |
| lens ② plan·ADR 준수 | `AUDITOR VERDICT: REJECT` · OID echo 일치 · Reviewed 0 | CRITICAL 3 · MAJOR 8 | 실코드 프로브로 mixed-interval·equality+pending 반례 관측, trim, EXEC-RETRY 모순, 테스트 약화 계열 | `audit/auditor-0-plan.md` |
| lens ③ 회귀·코드품질 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · OID echo 일치 · Reviewed 0 | MAJOR 6 · MINOR 1 | fail-open 제거 자체는 무회귀 확인; setActiveCraft 보존 누락·seeded state 추적·injection 표면·E2E 약화 | `audit/auditor-0-regression.md` |
| lens ④ 인프라·설정 | `AUDITOR VERDICT: REJECT` · OID echo 일치 · Reviewed 0 | CRITICAL 2 · MAJOR 4 | trim, plugin link(base checkout 로드) 프로브, check e2e 생략, E2E predicate 약화 | `audit/auditor-0-infra.md` |

## Required Fix (AWC — craft가 추가 질문 없이 구현 가능하도록)

**구현 대상 (craft executor 소관):**

- **RF-1 [CRITICAL]** `src/craft/audit-policy.ts:53-54`: `isAuditEscalationDisposition`에서 `.trim()` 제거 — raw exact membership만 허용. `test/audit-policy.test.ts:87`을 `false`로 교체. 회귀 추가: open pending 상태에서 세 canonical label 각각의 whitespace-padded 변형 → `blocked/invalid-disposition` + state byte-stable + 이후 exact label 정상 소비.
- **RF-2 [CRITICAL]** `src/craft/audit-policy.ts:298-313` pending parse 직후 `parsedPending.intervalCycles === interval` 검증 추가(불일치 → `invalid-state`, mixed-interval evidence 문구). 양방향 fixture(history 3+pending 2 / history 2+pending 3) — blocked + 무-write 단언.
- **RF-3 [CRITICAL]** `evaluateAuditBeginGate`: persisted `auditCycle`이 있으면 open pending은 `pending.dueCycle === auditCycle + 1`만 유효(위반 → write 전 `invalid-state`). 이로써 equality(candidate===marker)는 pending 유무와 무관하게 `:440` replay로만 귀결. fixture: `{auditCycle:3, pending.dueCycle:3}` + candidate 3 + Continue → blocked, cycle/checkLog/base/state bytes 불변. (자연 발생 pending은 항상 marker+1이므로 정상 경로 무영향 — `verdict.ts:436-443` escalation-pending write 시점 marker 확인.)
- **RF-4 [CRITICAL]** `test/e2e-helpers.ts`: E2E 자식이 로드하는 lets-craft plugin을 **검증 대상 repo로 고정**. `runOmpPrint` 경로에서 (a) plugin root를 REPO_ROOT로 명시 배선(호스트가 지원하는 수단: per-run link 재설정 또는 plugin-dir 인자)하고 (b) 첫 model turn 전 fail-fast preflight: 로드된 `BUILD_INFO.gitHash === git -C REPO_ROOT rev-parse --short HEAD` 불일치 시 suite abort. global link 암묵 의존 제거.
- **RF-5 [MAJOR]** `src/craft/state.ts:259-265` 보존 목록에 `releaseApproval`·`auditBaseSnapshot` 추가; `src/craft/init.ts:97`의 release 수동 전달은 제거해 보존 authority를 한 곳으로. 테스트: bare 재등록 후 두 필드 byte-equivalent + 재등록 후 same-cycle replay가 persisted base snapshot 반환.
- **RF-6 [MAJOR]** `skills/craft/SKILL.md:167` EXEC-RETRY: `no` → `reason=retry-declined`, 취소 → `retry-cancelled`로 정정(`:181-183` 표·plan.md:325-326 정합); "re-spawn that executor" 문언을 `:173`과 동일한 "integrated `{worktreeAbs}` 단일 production-repair executor" 문언으로 교체하고 "Deleted parallel lanes are never re-spawned"가 양 retry 경로에 적용됨을 명시. post-craft mirror 동기화 + skill-contract 테스트로 매핑 고정.
- **RF-7 [MAJOR]** `test/e2e-audit-escalation.test.ts`: Continue — completed begin 실행을 순서 파싱해 `total === 2 ∧ [isError, success]` 정확 tuple을 early-exit 조건·최종 assertion으로 고정(plan.md:411 predicate); README:255는 유지. Abort — `CRAFT_ABORTED_MARKER` 관측을 필수 대기 조건으로, `state.aborted === true` 무조건 단언, 미관측 timeout은 실패.
- **RF-8 [MAJOR]** `test/e2e-red-cycle-continuation.test.ts:193-194`: raw `"toolName":"task"` substring arm 제거 — `tool_execution_end`의 completed task 파싱 또는 `RUN_CHECK_MARKER`만 early-exit 조건으로. helper 단위 회귀(start event → false / end event → true) 추가.
- **RF-9 [MAJOR]** `test/e2e-helpers.ts seedCraftedFeature`: state 쓰기 전 feature worktree 자체 `.gitignore`에 `.lsc/crafts/*/.craft-state.json`·`.lsc/crafts/*/check/logs/` 설치·커밋; seed 직후 `git ls-files`에 sidecar 부재 + `git check-ignore` 매칭 단언.
- **RF-11 [MAJOR]** `test/audit-policy.test.ts:273-297`: 조건부 `if (blocked)` assertion을 무조건 `expect(decision.type).toBe("blocked")` + exact reason으로 교체.
- **RF-12 [MAJOR]** land `added-path-unknown` 통합 테스트: 결정적 git 실패 fixture(예: unrelated-history target/source로 merge-base 실패)로 `reason=added-path-unknown`·merge 미호출·worktree 존치·nonce 소비 후 fresh-approval 요구를 land-flow seam에서 단언.
- **RF-13 [MAJOR]** injection 표면: lifecycle tool 경계에서 resolve된 feature 입력에 kebab-slug validator 적용(scaffold와 동일 규칙), persisted `decidedAt`류 timestamp는 canonical ISO 검증, tool text 보간 필드의 newline/control char 거부 + fail-closed 테스트.
- **RF-14 [MAJOR]** plan.md:389의 명명 case matrix(2 positive + 열거 negative → 기대 four-level 결과)를 post-craft SKILL §5/§4.2 계약에 명시하고 heading-bounded 테스트로 각 case 독립 고정.
- **RF-15 [MAJOR, targeted]** explore 지적 6개 미커버 분기 단위 테스트: `verdict.ts:318-340` anchorBaseSnapshot 3분기, `verdict.ts:372-373` unknown WARN 문안, `state.ts:313-315` singleton-sync, `abort.ts:59` singleton invalidatePreparedOperation, `state.ts:418,430` auditBaseSnapshot 클리어(RF-5와 함께), `git.ts` exitCode.

**구현이 아닌 대상 (§6.1 대칭 케이스 — 다음 사이클 §3.0 test/check 저작 소관, craft executor는 건드리지 말 것):**

- **RF-10 [MAJOR]** `check/run_check.sh` 재저작: `npm run test:bun || status=1`·`npm run e2e || status=1` 포함(RF-4 반영 후라야 e2e가 이 worktree를 검증), §3.1 `timeout_ms`를 E2E 예산에 맞게 상향. E2E-skip된 `npm test`를 AC-8 증거로 재사용 금지.

**Fix-verification 스코프 노트**: 다음 사이클은 full 재감사가 아니라 §5 fix-verification(이 파이프라인의 의도된 축소 설계)이다. 블로킹 finding의 발생 lens가 ①②③④ 전반에 걸치므로, 승계는 RF별 발생 lens(RF-1: ②④, RF-2/3/6/11/14: ②, RF-5/9/13: ③, RF-4/7/8: ④, RF-12: ①)로 라우팅하고, fix가 tests/check를 대량 건드리므로 `lsc-explore`를 배치에 포함할 것.

## Proposed Spec/Plan Amendments

없음 — 모든 결함은 구현·테스트·저작 산출물 측이며 `spec.md`/`plan.md` 자체의 정정 필요는 발견되지 않았다.

## Adversarial Class Matrix (§4.1.12 — 판정은 메인 세션)

| Class | Owner | 판정 | 근거 |
|---|---|---|---|
| 결정적 체크의 형해화 | lsc-explore | **applied** | 트리거 실재(저작된 check 존재). floor 형해화 아님: `run_check.sh:27` build(tsc 포함)·`:29` npm test 실호출, vitest include가 저작 스위트 전부 실행(`vitest.config.ts:12`). 단 e2e 4종 silent skip(`e2e-*.test.ts:42-45 describe.skipIf`)으로 AC-8 축이 체크 사각지대 — 약한 체크 관측, RF-10으로 처방. |
| Worktree residue / base contamination | lsc-explore | **excluded** | 트리거 사실 부재 — `git status --porcelain` 공백, base..HEAD 10커밋 전부 본기능 소속, 벤더드 트리 무터치 (explore residue 섹션, 메인 세션 status 재확인). |
| Spec AC boundary inputs | lens ① | **applied** | AC-1/AC-2의 label 경계 입력(whitespace-padded)이 오소비됨 — `audit-policy.ts:53-54,411-417` + 이를 정답으로 고정한 `test/audit-policy.test.ts:87` (RF-1). AC-9 경계: `added-path-unknown` 예외 경로 미테스트 (RF-12). |
| Post-resume state consistency | lens ③ | **applied** | 재등록(pause→`lsc_craft_init`→fresh process)이 `auditBaseSnapshot`·(bare 경로에서) `releaseApproval`을 소거 — `state.ts:259-265` 보존 목록 누락, 주석 `:242-245`와 모순; 이후 replay(`verdict.ts:539`)가 소거된 snapshot을 undefined로 반환해 on-disk 이력과 불일치 (RF-5). same-cycle replay·mode-switch·v2 round-trip 자체는 무-write/fail-closed 확인. |
| Prompt-injection surface | lens ③ | **applied** | 미신뢰 `feature`·persisted `decidedAt`이 명령문형 tool text에 무구획 보간(`audit-policy.ts:96-100,385-386`; `verdict.ts:452-454` "Ask ... EXACT" 지시문 사이) — 지시풍 텍스트 승격 경로 실재 (RF-13). fixture 매칭 자체는 anchored exact로 안전(`answers.json:56-59`). |

## §4.2 판정 근거 (3-layer 종합)

- **Layer 1**: 결정적 체크 PASS(fresh check-1.log), 무응답 lane 0 — 하드 게이트 비발동.
- **Layer 2**: 래칫 적용 후 생존 CRITICAL 4건(RF-1 trim, RF-2 mixed interval, RF-3 equality+pending, RF-4 plugin link) + MAJOR 11건. `lsc-explore` 상향 래칫으로 커버리지 공백을 AC-9 Partial에 반영.
- **Layer 3**: 폐기 1건(부분 — 위 폐기 기록), 나머지 전건 인용 좌표에서 직접 확인.
- **판정**: lane 판정은 REJECT 2 / APPROVE-WITH-CHANGE 2로 갈렸다. 참조점("생존 CRITICAL → REJECT")과 달리 **APPROVE-WITH-CHANGE**로 확정한 이유: (1) 생존 CRITICAL 4건 전부가 좁고 열거 가능한 apply-only 처방으로 닫힌다(위 RF-1~4 — 재설계 요구 0건). (2) 그중 2건(RF-2/3)은 자연 발생 경로가 없는 위조-state 검증 공백으로, 계획이 명시한 invariant의 미이행이지 아키텍처 결함이 아니다. (3) 게이트 배치·atomic 전이·land 순서·base authority 등 구조 전반은 4개 lane과 메인 세션 재독이 일관되게 건전 판정. (4) REJECT의 문서 요건(§4.1.9: "scoped fix를 처방할 수 없을 만큼 broad/severe")을 정직하게 충족할 수 없다 — 처방은 위에 완결됐다. REJECT 2개 lane의 근거 결함 집합은 전부 이 Required Fix 묶음에 포섭된다(lane verdict는 단독 권위가 아님, §4.2). 이 판정은 트레이드오프를 안다: 참조점 이탈이므로 다음 fix-verification 사이클은 RF 전건의 완전 적용 + 부수 회귀 부재를 엄격 재확인해야 하며, 부분 적용은 또 한 번의 AWC가 아니라 REJECT 사유가 될 수 있다.
