# Audit 1 — postcraft-14cycle-approval-failure

## Header

| 항목 | 값 |
|---|---|
| Feature | postcraft-14cycle-approval-failure |
| Date | 2026-08-31 |
| Audit cycle | 1 |
| Mode | **fix-verification** (§5 — prior verdict APPROVE-WITH-CHANGE, RF-1~RF-15 승계) |
| Implementation branch | `feat/postcraft-14cycle-approval-failure` @ `fbc4c9c73237441d653e26c7a6a15456f8afc7b2` (frozen OID — §3.0 check 재저작 커밋 포함) |
| Worktree | `.lsc/worktrees/postcraft-14cycle-approval-failure/` |
| Base branch | `feat/lets-craft-v1` (§2.5 재사용 — audit-0과 동일 검출) |
| Prior audit | `audit/audit-0.md` (APPROVE-WITH-CHANGE, RF-1~RF-15) |
| 결정적 체크 | **FAIL** — `check/logs/check-2.log` (threshold check-1 초과, cycle-freshness 충족) |
| 감사 lane | `lsc-explore` ×1 + `lsc-auditor` ×4 (audit-0 fix-verification 스코프 노트의 lens 승계 라우팅: RF-12→①, RF-1/2/3/6/11/14→②, RF-5/9/13→③, RF-4/7/8/1/10→④; fix가 tests/check를 대량 터치하여 explore 포함). 무응답 lane 0 — 단 lens ④의 첫 terminal yield가 provider 측에서 report를 유실해 표준 idle-recovery 재렌더로 회수(전문 `audit/auditor-1-infra.md` 보존, heard 처리) |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## Spec Compliance Matrix (lens ① 소유 — audit-0의 Partial 행만 재검증, 전 행 메인 세션 직접 재독)

### Acceptance Criteria (재검증 행)

| Requirement | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| AC-1 사이클 상한 | **Met** | `src/craft/audit-policy.ts:48-54,383-395,406-465`; `test/audit-policy.test.ts:229-262,335-361`; `test/craft-verdict.test.ts:1012-1035` | RF-1(trim 제거)·RF-2(mixed interval)·RF-3 core(forged equality-consume 차단) 전부 적용 — 메인 세션 `:406-465` 직접 재독. lens ② 단독 제기의 equality+valid-pending 잔여는 §3.4 폐기 기록 참조(plan 정합 행동으로 판정, 비차단). |
| AC-2 처분 기록 | **Met** | `src/craft/audit-policy.ts:52-54,424-442`; `test/audit-policy.test.ts:84-98,441-469` | raw exact membership만 소비(직접 재독: `.includes(value)`, trim 부재 + 계약 주석), padded 3종 차단·byte-stable·후속 exact 소비 회귀 실재. |
| AC-8 E2E | **Partial** | 배선 복구: `package.json:17`; `check/run_check.sh:32-42`; `test/e2e-helpers.ts:52-70,269-287`. 차단 결함: `test/e2e-helpers.ts:26,287` (spawn 미import — check-2.log:284-289 기계 증거), `:696` (check-ignore -q 다중 경로 — check-2.log:271-293), `:52-57` (link 부재 경계) | RF-7/8 assertion 강도·RF-10 4단계 배선은 복구됐으나 **이 OID에서 E2E green 증거 0건 유지** — 4파일 전부 setup 즉사. 메인 세션이 결함 2건을 코드+check-2.log로 직접 확정. |
| AC-9 단위 | **Met** | RF-11: `test/audit-policy.test.ts:310-325`; RF-12: `test/craft-land-flow.test.ts:1345-1401`; RF-15 6/6: `test/craft-verdict.test.ts:1077-1153`, `test/craft-state.test.ts:447-508`, `test/craft-abort.test.ts:123-143`, `test/git-runner.test.ts:68-87` | lens ①·explore 좌표 1:1 대응 수렴 + check-2.log 단위 스위트 1734 passed. |

### Constraints (재검증 행)

| Requirement | Status | Evidence | Notes |
|---|---|---|---|
| C-6 태깅·exact labels | **Met** | `src/craft/audit-policy.ts:48-54`; `test/audit-policy.test.ts:84-99,441-463` | RF-1 적용으로 verbatim 경계 복원 — 4개 lane 중 판정 lane 전부 Met 수렴 + 직접 재독. |

### Non-Goals

audit-0에서 Partial/Unmet인 Non-Goal 행 없음 — 재검증 대상 없음. lens ①의 fix delta sweep에서 신규 scope behavior 미발견.

## Plan Compliance Matrix (lens ② 소유 — audit-0의 Unmet/Partial 행만 재검증)

lens ②의 전체 매트릭스는 `audit/auditor-1-plan.md` 원문 보존. 메인 세션 재검증 결과:

| Step/Decision | 채택 Status | 메인 세션 재검증 |
|---|---|---|
| MH-3 exact labels만 소비 | **Met** | `:53-54` raw membership 직접 확인 — lane 판정 채택. |
| PR1-4(c) 전 record interval 동일 | **Met** | `:311-315` pending parse 직후 interval 비교(lens ② 좌표) + 양방향 fixture `test:335-361` — 채택. |
| PR1-4(i) equality replay·marker coupling | **Met (Notes 수정)** | lens ②는 Partial(CRITICAL) 판정. 메인 세션 직접 재독으로 **규범 절반 폐기**: plan PR-1 변경 5항("pending은 `candidateCycle === dueCycle`에서만 재사용·소비, 그 외 `stale-pending` 거부")과 변경 4항 precedence(pending 소비 → history-derived 판정)가 현행 `:417` 순서를 정확히 명시한다. audit-0 RF-3의 처방 fixture({auditCycle:3, pending.dueCycle:3} forged)는 `:412`+`test:248-262`로 green. 상세 §3.4 폐기 기록. |
| PR4-5 EXEC-RETRY topology | **Met** | `skills/craft/SKILL.md:155-173` + `test/skill-contract.test.ts:1191-1210` — lane 판정 채택. |
| PR4-6 exact incomplete reasons | **Met** | `:167-188` reason 매핑 + mirror — 채택. |
| PR5-3 Continue 정확 2회 | **Met** (assertion 축) | exact ordered tuple `[true,false]` — `test/e2e-audit-escalation.test.ts:117-153`. 단 subprocess 실행 증거는 N2로 차단(AC-8 축에 귀속). |
| PR5-4 Abort delegation 증거 | **Met** (assertion 축) | marker 필수 대기 + 무조건 `aborted===true` — 동일 유보. |
| PR5-5 red continuation B-bound 증거 | **Met** (assertion 축) | raw substring arm 제거 + start→false/end→true 단위 회귀 — 동일 유보. |
| PR3-A3 git 실패 손실 없음 | **Met** | real land seam 통합 테스트 `test/craft-land-flow.test.ts:1345-1401` — lens ① 반증 실패(=정합)와 수렴, check-2.log에서 해당 테스트 green 확인. |

## Code Quality & Regression Risk (§3.4 종합)

### 수렴 (2개 이상 lane 독립 지목 — 메인 세션만 수렴 선언)

1. **N1: `spawn`/`ChildProcess` import 소실** — lens ①(CRITICAL)·④(CRITICAL) 독립 지목 + 기계 증거(check-2.log:284-289 `spawn is not defined` ×2). 메인 세션 직접 확인: `test/e2e-helpers.ts:26`은 `execFileSync`만 import, `:287`이 `spawn()` 호출. tsconfig가 `src/**`만 include해 build로 검출 불가(lens ① 정정 보고와 일치). RF-4 fix 커밋(f2537ed)이 도입한 회귀. 분류: 수정 · **CRITICAL**.
2. **N2: `git check-ignore -q` 다중 경로** — lens ④(CRITICAL)·③(MINOR로 과소평가 — 불일치 기록 참조) + 기계 증거(check-2.log:271-293, escalation 3건+red-cycle 전부 `fatal: --quiet 옵션은 하나의 경로 이름과 같이 써야 합니다`). 메인 세션 직접 확인: `:696` 한 호출에 경로 2개. RF-9 fix가 도입. 분류: 수정 · **CRITICAL** (래칫).
3. **N3: RF-4 link-부재 경계 미처리** — lens ①②③④ **4/4 수렴** (전부 MAJOR). 메인 세션 직접 확인: `:53` 무가드 `readlinkSync`가 link 생성 명령(:54)보다 선행 — clean 환경 ENOENT. 분류: 보완 · MAJOR.
4. **N6: RF-10 timeout 계약 미반영** — lens ②④ 수렴(MAJOR). 메인 세션 직접 확인: worktree `skills/post-craft/SKILL.md:40,100`에 `timeout_ms: 600000`/fixture `120000` 잔존, run_check.sh:19-22의 순차 E2E 최악 예산(4×10200s)과 모순. 분류: 수정 · MAJOR.

### 단독 lane 발견 (미교차 관측임을 명시)

- lens ③ 단독 — **N4: RF-5 preservation decode-swallow 덮어쓰기** (MAJOR): `state.ts:273-275` `catch {}`가 future-version/malformed decode 실패를 삼키고 `:277 persist(next)`로 덮어씀; `init.ts:107-109`가 선행 reader를 제거해 전파 경로 소실 — **메인 세션 코드 직접 재독으로 실재 확정**. fix delta가 만든 회귀.
- lens ③ 단독 — **N5: RF-13 잔존 보간 표면** (MAJOR ×2): `base_branch`가 plain `z.string()`으로 `verdict.ts:632 observeAuditBase`에 raw 전달(메인 세션 `:587-633` 직접 확인), invalid disposition의 `String()` 보간(`audit-policy.ts:432,451` — 메인 세션 확인), abort reason·land terminal raw 보간, run-check slug guard 부재(lens ③ 좌표 인용, 대표 경로 메인 검증).
- lens ③ 단독 — RF-5 byte-equivalence 단언 약화(`test/craft-verdict.test.ts:1050-1065` `.toEqual`만), MINOR. orphan helper 2종(`toolCallSummaries`, `recordAuditCycleBegin`) 잔존, 삭제 · MINOR (audit-0에서 이월).
- explore 단독 — `pinLetsCraftPluginToRepo` 4분기 단위 미커버(MINOR — N3 수정 시 회귀로 함께 해소 처방), RF-15 6/6 전부 닫힘 확인(긍정 관측).
- 메인 세션 단독 — **개선 · MINOR (비차단)**: test/** 가 어떤 typecheck에도 포함되지 않아 N1류 미정의 식별자가 정적 검출 불가. 차기 §3.0에서 test 포함 `tsc --noEmit` 단계 추가를 권고(Required Fix 아님).

### 불일치 기록 (양쪽 판독 + 메인 세션 판정)

- **N2 심각도**: ④ CRITICAL(setup 전멸 유발) vs ③ MINOR("단언 강도 문제" — `-q` 다중 경로가 fatal임을 미인지). 기계 증거(check-2.log)가 fatal을 증명 — ④ 판독 지지, 래칫 CRITICAL 유지.
- **AC-1/PR1-4(i)**: ① Met vs ② Partial(CRITICAL). 메인 세션 직접 재독이 plan PR-1 변경 5항·precedence와 대조해 **① 지지** — 아래 폐기 기록.
- **PR5-3/4/5**: ② Met(assertion 축) vs ①④의 "실행 증거 부재" — 모순 아님: assertion 정확성과 실행 증거는 별개 축. 전자는 Met, 후자는 AC-8 Partial + Layer 1로 귀속.

### 폐기 기록 (§4.2 Layer 3 — 직접 검증 근거)

| 폐기 대상 | 제기 lane | 주장 | 메인 세션 관측 | 처분 |
|---|---|---|---|---|
| RF-3 잔여 finding의 규범 절반 | lens ② | "equality candidate + valid open pending이 `:417 stale-pending`으로 차단되는 것은 audit-0.md:215·plan.md 위반 — CRITICAL, 분기 재배치 필요" | 관측 사실(차단 + `test:229-238` pin)은 참. 그러나 plan PR-1 **변경 5항 원문**: "pending은 `candidateCycle === dueCycle`에서만 재사용·소비한다. candidate가 앞서거나 지나간 stale pending은 교체하지 않고 `stale-pending`으로 거부한다" — 현행 동작을 정확히 명시. 변경 4항 precedence("… → exact pending 재사용/소비 → history-derived schedule 판정")도 pending 처리의 선행을 규정. audit-0 RF-3의 "pending 유무와 무관하게 replay" 결과 조항이 plan을 넘어선 과처방이며, RF-3의 처방 fixture 자체(`{auditCycle:3, pending.dueCycle:3}` forged → invalid-state)는 `test:248-262`로 green. 차단되는 유일 자연 경로는 gate 개방 중 latest audit artifact 수동 삭제(Non-Goal이 tamper 방어 범위 밖으로 선언)이고 fail-closed·복구 가능 | **부분 폐기** — 사실 관측은 기록 유지(비차단), 규범 판단(CRITICAL·must-fix)은 폐기. plan이 canon이고 prior audit 처방의 결과 조항은 canon이 아니다 |

그 외 폐기 없음 — 검증한 모든 finding은 인용 좌표에서 사실로 확인되었다.

## Deterministic Check (§3.1)

- **결과: FAIL** (exit 1) — 재저작 cap 미발동(isError 0회 — 스크립트는 정상 실행·보고했고 실패는 실재 결함), manifest-runner WARN 없음.
- Log: `check/logs/check-2.log` (733 lines) — cycle-1 threshold(check-1) 초과, freshness 충족. `timeout_ms=14400000`으로 호출(RF-10 상향 이행; 계약 산문 잔존은 N6).
- Script sha256: `87fe5a33949f97822554e15d8a2293d8d5c9b4a90db6586c501e03def7b7daa4`
- 실행 단계: `npm run build`(tsc) PASS → `npm test`(vitest) **1734 passed | 14 skipped, 61 files** PASS → `npm run test:bun` **21 pass** PASS → `npm run e2e` **4 files failed / 6 tests failed** FAIL.
- 발췌 (log:271-299):
  ```
   ❯ test/e2e-audit-escalation.test.ts (3 tests | 3 failed) 1901ms
     × Continue auditing: … → Command failed: git check-ignore -q …/.craft-state.json …/check-0.log
       fatal: --quiet 옵션은 하나의 경로 이름과 같이 써야 합니다
   ❯ test/e2e-full-cycle.test.ts (1 test | 1 failed) 1285ms
     × … → spawn is not defined
   ❯ test/e2e-preset-default.test.ts (1 test | 1 failed) 308ms
     × … → spawn is not defined
   ❯ test/e2e-red-cycle-continuation.test.ts (1 test | 1 failed) 655ms
     × … → Command failed: git check-ignore -q … (동일 fatal)
   Test Files  4 failed (4) / Tests 6 failed (6) / Duration 4.62s
  ```
- 감사 판단: **§4.2 Layer 1 하드 게이트 발동** — 이 사이클은 APPROVE/APPROVE-WITH-COMMENT 불가. 실패는 harness 결함의 결정적 재현이며 flake가 아니다(전 실패가 setup 단계 즉사, 자식 프로세스 0개 spawn). 재저작된 check가 audit-0의 AC-8 사각지대(E2E silent skip)를 정확히 닫아 이 결함들을 처음으로 기계 검출했다 — 형해화의 정반대.

## Lane Reports (§4.1.7)

### lsc-explore — verbatim 전문

```json
{
  "auditCycle": 1,
  "coverageGaps": {
    "newCodeIntroducedGaps": [
      {
        "branchCount": 4,
        "branches": "재link execFileSync / link 미해결 throw / dist 부재 throw / 해시 불일치 throw(정규식 unparsed arm 포함)",
        "file:line": "WT/test/e2e-helpers.ts:52-83 (정의), :271 (runOmpPrint 배선, 실재)",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/test/e2e-helpers.ts:52-83",
        "note": "fail-closed preflight, happy path는 LSC_E2E=1 실행 시 운동됨. npm test 도달 불가라는 점만 MINOR",
        "severity": "MINOR",
        "title": "pinLetsCraftPluginToRepo (RF-4 신규 helper) 단위 미커버"
      }
    ],
    "rf15Closed": [
      {
        "closedBy": "test/craft-verdict.test.ts:1032-1114 RF-15① it 3개 (observeAuditBase 공개 seam)",
        "headCoordinates": "source tip :317-321 / non-integer :326-328 / behind-count :337-339",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/craft/verdict.ts:313-341 anchorBaseSnapshot 3분기"
      },
      {
        "closedBy": "test/craft-verdict.test.ts:1128-1140 RF-15②",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/craft/verdict.ts:371-373 unknown WARN"
      },
      {
        "closedBy": "test/craft-state.test.ts:442-464 RF-15③ (양방향)",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/craft/state.ts:313-315 singleton-sync"
      },
      {
        "closedBy": "test/craft-abort.test.ts:119-139 RF-15④",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/craft/abort.ts:59 invalidatePreparedOperation"
      },
      {
        "closedBy": "test/craft-state.test.ts:466-509 RF-15⑤ (양 kind, on-disk 키 소멸 단언)",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/craft/state.ts:418,430 auditBaseSnapshot clear"
      },
      {
        "closedBy": "test/git-runner.test.ts:76 (exit 128 verbatim) + :81-90 (spawn 실패 exitCode undefined)",
        "location": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure/src/utils/git.ts:62-63 exitCode"
      }
    ],
    "summary": "audit-0 RF-15의 6개 미커버 분기 6/6 전부 실제 테스트로 닫힘(좌표 HEAD 재계산으로 1:1 대응 확인). slug validator·보존 목록·audit-policy 신규 분기·auditBeginOutcomes/completedTaskSpawnSeen 전부 커버. claims-tool SSOT 이동 후 기존 커버(test/claims-tool.test.ts:181-193) 유효."
  },
  "checkHollowing": {
    "adversarialClass": "결정적 체크의 형해화",
    "details": [
      "run_check.sh:34 npm run build || status=1 (tsc 포함), :36 npm test, :38 npm run test:bun, :40 npm run e2e — 4단계 실호출, 조기 종료·무조건 pass 없음 (:26 set -uo pipefail, :42 exit \"$status\")",
      "스킬 자체 gate 정합: src/craft/run-check.ts:130 evaluateCheckScriptShape 기준 rule ②③④ 전부 통과 (실행행 4개, non-trivial, npm 토큰 존재)",
      "vitest.config.ts:12 include test/**/*.test.ts — e2e 4종은 describe.skipIf(!RUN_E2E) (e2e-audit-escalation.test.ts:50,111 / red-cycle :43,123 / full-cycle :51,107 / preset-default :19,123; RUN_E2E = LSC_E2E==='1') — run_check.sh:11-12가 이를 자각 문서화('NOT AC-8 evidence')하고 :40 npm run e2e가 LSC_E2E=1 공급해 사각지대 닫음 — 논리적으로 자기일관",
      "package.json:15 e2e 스크립트의 4파일 목록(e2e-full-cycle/preset-default/audit-escalation/red-cycle-continuation) = run_check.sh:20,39 코멘트 '4 files' 정확 일치 (--no-file-parallelism --testTimeout=10200000 --hookTimeout=120000 포함)",
      "[관찰, 무해] npm run e2e가 내부에서 npm run build 재실행 → tsc 2회; run_check.sh:14-15 명시됨"
    ],
    "method": "정적 분석만 (실행 금지 준수)",
    "verdict": "applied — 형해화 없음"
  },
  "fixDelta": "2607199..fbc4c9c — 7 검증 대상 커밋 (craft fix 6: fcbba72/af199a9/ad0b380/f2537ed/3494222/2e719a6 + §3.0 check 재저작 fbc4c9c) + audit-0 기록 커밋 bbd1a7d 포함 총 8",
  "frozenOidCheck": {
    "assignmentValue": "fbc4c9c73237441d653e26c7a6a15456f8afc7b2",
    "computed": "git -C WT rev-parse feat/postcraft-14cycle-approval-failure = fbc4c9c73237441d653e26c7a6a15456f8afc7b2",
    "match": true
  },
  "impact": {
    "affectedAreas": [
      "audit escalation ledger (SSOT gate)",
      "lifecycle feature-name 경계",
      "craft state 보존",
      "E2E 하니스 신뢰성",
      "결정적 체크 엔트리포인트"
    ],
    "risk": "low",
    "scope": "cross-module"
  },
  "mapping": {
    "deltaFromAudit0": "이전 사이클 맵(audit-0.md:133-173) 기준 갱신 — 신규: paths.ts FEATURE_SLUG_RE export(SSOT, scaffold/claims-tool 복제본 제거), audit-policy isCanonicalIsoTimestamp+mixed-interval+RF-3 coupling, state.ts 보존 목록 2필드 확장, 5 lifecycle 경계 slug guard, run_check.sh 4단계화",
    "filesTouched": [
      "WT/src/artifacts/paths.ts:103-108 (FEATURE_SLUG_RE SSOT export)",
      "WT/src/artifacts/scaffold.ts (SSOT import로 전환)",
      "WT/src/craft/audit-policy.ts:53,165-168,176,188,311-315,406-413 (RF-1/2/3/13)",
      "WT/src/craft/init.ts:64-75,107-110 (RF-13 guard + RF-5 caller 보상 제거)",
      "WT/src/craft/state.ts:265-266 (RF-5 보존 목록)",
      "WT/src/craft/abort.ts:41-48 (RF-13)",
      "WT/src/craft/land.ts:220-227 (RF-13)",
      "WT/src/craft/verdict.ts:393-400,655-662 (RF-13)",
      "WT/src/research/claims-tool.ts (SSOT import)",
      "WT/test/audit-policy.test.ts (RF-1/2/3/11/13)",
      "WT/test/craft-abort.test.ts:117-158 (RF-13/15④)",
      "WT/test/craft-init.test.ts:164-179 (RF-13)",
      "WT/test/craft-land-flow.test.ts:1337-1415 (RF-12/13)",
      "WT/test/craft-state.test.ts:439-510 (RF-15③⑤)",
      "WT/test/craft-verdict.test.ts:969-1155 (RF-3/5/13/15①②)",
      "WT/test/git-runner.test.ts:76-90 (RF-15⑥)",
      "WT/test/e2e-helpers.ts:52-83,271,649-693,762+,810+ (RF-4/9/7/8)",
      "WT/test/e2e-helpers.test.ts:362-410 (RF-7/8 단위)",
      "WT/test/e2e-audit-escalation.test.ts (RF-7)",
      "WT/test/e2e-red-cycle-continuation.test.ts (RF-8)",
      "WT/test/skill-contract.test.ts:1191,1247 (RF-6/14 heading-bounded)",
      "WT/skills/craft/SKILL.md:164-176 (RF-6)",
      "WT/skills/post-craft/SKILL.md:224-241,309-313,331 (RF-14)",
      "WT/.lsc/crafts/postcraft-14cycle-approval-failure/check/run_check.sh (RF-10)"
    ],
    "relationships": "paths.ts SSOT ← scaffold/abort/init/land/verdict/claims-tool 6소비처(기존 2중 복제 수렴); init.ts caller 보상 제거 → state.ts setActiveCraft가 단일 보존 authority(RF-5, RF-5 테스트가 replay까지 검증); run_check.sh → package.json scripts SSOT → vitest include와 LSC_E2E 플래그 2층 게이팅(유닛/e2e 계층이 동일 config 공유)"
  },
  "residue": {
    "baseHeadCommits": "17커밋 전수 본기능 소속 (11de37d trace → 0ed92a5 spec → b8143ef plan → PR-1..5 → 2607199 AC-1 → bbd1a7d audit-0 → fix 6 → fbc4c9c check)",
    "fixDeltaFiles": "src 8 + test 10 + skills 2 + check 1 = 21파일, 무관 파일 유입 없음",
    "gitStatusPorcelain": "공백 (untracked 포함 무잔류)",
    "verdict": "깨끗함",
    "vendoredTrees": "oh-my-pi/oh-my-claudecode/lazycodex/pi 터치 0; 브랜치 전체 62파일 중 non-.lsc 34파일 전부 본기능 범위 (README/agents 1/fixtures answers.json/package.json/skills 3/src 9/test 16)"
  },
  "reviewed": "2607199..fbc4c9c (audit cycle 1, §5 fix-verification)",
  "verdictRendered": false,
  "wt": "<lets-craft>/.lsc/worktrees/postcraft-14cycle-approval-failure"
}
```

### lsc-auditor 요지 (전문은 각 파일 — 한 부만 보존)

| Lane | 판정 (prefix 원형) | Findings | 요지 | 전문 |
|---|---|---|---|---|
| lens ① spec 정합 | `AUDITOR VERDICT: REJECT` · OID echo 일치 · Reviewed 1 | CRITICAL 1 · MAJOR 1 | RF-12 완전 적용(반증 실패), AC-1/2/9/C-6 Met 복귀; spawn import 소실 CRITICAL, link-부재 MAJOR | `audit/auditor-1-spec.md` |
| lens ② plan·ADR 준수 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · OID echo 일치 · Reviewed 1 | CRITICAL 1 · MAJOR 2 | RF-1/2/6/11/14 Met; RF-3 잔여 제기(메인 세션이 규범 절반 폐기 — §3.4), timeout 계약·link-부재 MAJOR | `audit/auditor-1-plan.md` |
| lens ③ 회귀·코드품질 | `AUDITOR VERDICT: APPROVE-WITH-CHANGE` · OID echo 일치 · Reviewed 1 | MAJOR 4 · MINOR 3 | RF-5 decode-swallow 회귀, RF-13 잔존 표면 2건, link-부재; RF-9 check-ignore를 MINOR로 과소평가(불일치 기록) | `audit/auditor-1-regression.md` |
| lens ④ 인프라·설정 | `AUDITOR VERDICT: REJECT` · OID echo 일치 · Reviewed 1 | CRITICAL 2 · MAJOR 2 | spawn·check-ignore CRITICAL(기계 증거 인용), link-부재·timeout 계약 MAJOR; readlink 프로브로 RF-4 pin 자체는 정합 확인 | `audit/auditor-1-infra.md` |

lens ④의 첫 terminal yield는 report가 유실된 채 Expected State만 반환했고(§3.2 파싱 불가 verdict), 표준 idle-recovery 요청으로 전체 보고서를 회수했다 — 재스폰 불요, heard 처리. audit-level verdict prefix를 출력한 lane은 없다.

## Required Fix (AWC — craft가 추가 질문 없이 구현 가능하도록)

**구현 대상 (craft executor 소관 — 전건 apply-only, 재설계 0건):**

- **RF-16 [CRITICAL]** `test/e2e-helpers.ts:26`: import를 `import { execFileSync, spawn, type ChildProcess } from "node:child_process";`로 복원. 이 한 줄이 4-file E2E 전 경로의 전제다(check-2.log:284-289 기계 증거).
- **RF-17 [CRITICAL]** `test/e2e-helpers.ts:696`: `git check-ignore -q -- <path>`를 statePath와 check-log 경로에 **각각 1회씩** 호출해 두 ignore invariant를 독립 단언(현행 다중 경로 `-q`는 git fatal — check-2.log:271-293). verbose 출력 path별 exact set 비교도 동등 허용.
- **RF-18 [MAJOR]** `test/e2e-helpers.ts:52-57` `pinLetsCraftPluginToRepo`: missing/dangling/non-symlink link를 try/catch(`ENOENT`/`EINVAL`)로 "not pinned" 처리해 그 경우에도 `omp plugin link REPO_ROOT`로 진입시킨 뒤 realpath+BUILD_INFO.gitHash를 fail-closed 재검증. missing→생성 / wrong-target→재지정 / correct→no-op 3경계 단위 회귀 추가(explore 지적 4분기 미커버 동시 해소).
- **RF-19 [MAJOR]** `src/craft/state.ts:255-283`: preservation read의 decode 오류를 `durability:"strict"`에서 persist/publish 전에 전파(덮어쓰기 금지); best-effort에서도 undecodable 기존 파일에 대한 disk write를 생략 또는 명시 실패. future-version·malformed JSON seed 후 실제 `lsc_craft_init`/strict `setActiveCraft`에서 state bytes 불변 + active singleton 미등록 단언. `test/craft-verdict.test.ts:1050-1065`의 `.toEqual`을 재등록 전후 serialized representation exact 비교로 강화(RF-5 byte-equivalence 원문 충족).
- **RF-20 [MAJOR]** RF-13 잔존 표면 폐쇄: (a) `base_branch`·`escalation_disposition`·abort `reason`에 shared control-char-free validator를 어떤 effect/observation보다 먼저 적용(`src/craft/verdict.ts:631-632`의 `observeAuditBase` 호출 이전 포함); (b) invalid 값의 raw `String()` 보간(`src/craft/audit-policy.ts:432,451`)을 constant/escaped diagnostic으로 교체; (c) `src/craft/land.ts:293-320` terminal 보간 전 runtime parser(canonical label·canonical ISO·control-free) 적용; (d) `src/craft/run-check.ts:312-323,415-443`에 shared slug guard + persisted root identity의 `ctx.cwd`/computed worktree path exact-match 검증. 각 경로 fail-closed/무-effect/무-raw-payload 테스트.
- **RF-21 [MAJOR]** `skills/post-craft/SKILL.md:40,100`: `timeout_ms`를 순차 E2E 예산 포괄 단일 값으로 상향(현행 package ceiling 합계 41,280,000ms + build/hook margin ≥ `43,200,000ms` — lens ② 산정), fixture `120000` 예외를 제거하거나 동일 산식으로 상향, 두 heading의 timeout drift를 막는 contract test 추가.

**구현이 아닌 대상: 없음.** §3.0이 재저작한 `check/run_check.sh`는 정확히 작동했다(4단계 실행·실패 누적·red 보고) — 다음 사이클 §3.0은 재저작 불요, 기존 스위트 유효성 재확인만. 다음 사이클 §3.1은 이번과 동일하게 `timeout_ms`를 E2E 예산 이상으로 호출할 것(≥14,400,000ms; RF-21 반영 후에는 계약값). 비차단 권고: test/** 포함 `tsc --noEmit` 단계(§3.4 개선 항목).

**Fix-verification 스코프 노트**: 다음 사이클은 §5 fix-verification. 승계 라우팅 — RF-16/17/18: lens ④(+explore: 커버리지·형해화 재판정), RF-19: lens ③, RF-20: lens ③, RF-21: lens ②④. **경고 이월·강화**: audit-0은 "부분 적용은 REJECT 사유가 될 수 있다"고 경고했고 이번 사이클이 그 부분 적용을 관측했다(RF-4/9의 결함 있는 적용, RF-5의 회귀 동반 적용, RF-10 산문 미반영, RF-13 부분). 이번에도 AWC로 닫는 근거는 아래 §4.2 판정 근거 4항이다 — **차기 사이클에서 동일 RF 계열의 재차 부분 적용이 관측되면 그것은 fix-introduced 트레드밀의 시그니처(trace H-C)이며 REJECT로 처분한다.**

## Proposed Spec/Plan Amendments

없음 — 모든 결함은 구현·테스트 하니스 측이다. RF-3 논쟁은 plan 자체의 모순이 아니라 prior audit 처방의 과잉 결과 조항으로 판정했다(plan 변경 5항+precedence가 자기일관 — §3.4 폐기 기록).

## Adversarial Class Matrix (§4.1.12 — 판정은 메인 세션)

| Class | Owner | 판정 | 근거 |
|---|---|---|---|
| 결정적 체크의 형해화 | lsc-explore | **applied — 형해화 없음** | `run_check.sh:34-40` 4단계 실호출·`evaluateCheckScriptShape` rule 전부 통과·e2e skip 사각지대를 `:40 npm run e2e`(LSC_E2E=1 공급)로 폐쇄(explore 정적 판정 + 메인 세션 스크립트 직접 재독). 이 check가 이번 사이클의 CRITICAL 2건을 처음으로 기계 검출 — 약한 체크가 아니라 작동하는 체크의 증명. |
| Worktree residue / base contamination | lsc-explore | **excluded** | `git status --porcelain` 공백(untracked 포함), base..HEAD 17커밋 전수 본기능 소속, 벤더드 트리 무터치, fix delta 21파일 무관 유입 없음 (explore residue 섹션 + 메인 세션 status 재확인). |
| Spec AC boundary inputs | lens ① | **applied** | AC-1/AC-2의 label·interval·equality 경계는 폐쇄 확인(padded 3종·양방향 mixed·forged equality fixture 전부 green). 잔존 boundary: AC-8의 실행 경계 — E2E 4파일이 setup 경계에서 전멸(N1/N2), green 증거 0건 유지. |
| Post-resume state consistency | lens ③ | **applied** | 재등록 보존 자체는 수리됨(`state.ts:255-271` 단일 authority + replay가 persisted snapshot 반환 — lens ③ 정상 관측). 잔존: decode 실패 시 `catch {}`→덮어쓰기(N4)가 resume 시 durable evidence를 소거 가능 — 메인 세션 직접 확인, RF-19 처방. |
| Prompt-injection surface | lens ③ | **applied** | `base_branch` raw 전달(`verdict.ts:589-591,632` — 메인 세션 직접 확인)·invalid disposition `String()` 보간·abort reason·terminal raw 보간·run-check guard 부재(N5, RF-20 처방). `test/audit-policy.test.ts:479-481`의 injection fixture literal은 malformed data 안에 갇힌 negative fixture로 무해(lens ③ 관측). |

## §4.2 판정 근거 (3-layer 종합)

- **Layer 1**: 결정적 체크 **FAIL**(check-2.log) — 하드 게이트 발동, APPROVE-family 불가. 무응답 lane 0(lens ④ 회수 완료).
- **Layer 2**: 래칫 적용 후 생존 CRITICAL 2건(N1 spawn, N2 check-ignore — 둘 다 기계 증거 동반) + MAJOR 4건(N3 link-부재 4/4 수렴, N4 decode-swallow, N5 RF-13 잔존, N6 timeout 계약). lens ② CRITICAL 1건은 Layer 3에서 규범 절반 폐기.
- **Layer 3**: 폐기 1건(부분 — RF-3 규범 판단, plan 원문 직접 재독 근거), N2 심각도는 ③의 과소평가를 기계 증거로 상향 유지. 나머지 전건 인용 좌표에서 직접 확인.
- **판정**: lane 판정은 REJECT 2 / APPROVE-WITH-CHANGE 2로 갈렸다. **APPROVE-WITH-CHANGE**로 확정한 근거: (1) 생존 CRITICAL 2건이 전부 harness의 단일 지점 결함(import 한 줄, git 호출 형식)으로 즉시 열거 가능한 apply-only 처방으로 닫힌다. (2) 승계 RF 15건 중 9건(RF-1/2/6/7/8/11/12/14/15) 완전 적용 + RF-3 core 적용을 메인 세션이 직접 확인 — 구조·아키텍처 결함 0건, 재설계 요구 0건. (3) REJECT의 문서 요건(§4.1.9: scoped fix 처방 불가 수준의 broad/severe)을 정직하게 충족할 수 없다 — 처방은 RF-16~21로 완결됐다. (4) audit-0의 "부분 적용 시 REJECT 가능" 경고 대비: 이번 부분 적용은 결함 있는 적용(RF-4/9)·회귀 동반 적용(RF-5)·산문 누락(RF-10/13)이지 처방 무시가 아니며, fix-introduced 결함 2건은 이번 사이클 §3.0이 저작한 check가 즉시 기계 검출했다 — 측정 위생 장치가 설계대로 작동했으므로 트레드밀 판정(무한 재생산)의 증거가 아직 아니다. 단 이 유예는 1회다: Required Fix의 이월 경고대로 차기 사이클의 재차 부분 적용은 REJECT로 처분한다.
