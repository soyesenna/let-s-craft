# Audit 2 — postcraft-14cycle-approval-failure

## Header

| 항목 | 값 |
|---|---|
| Feature | postcraft-14cycle-approval-failure |
| Date | 2026-09-01 |
| Audit cycle | 2 |
| Mode | **fix-verification** (§5 — prior verdict APPROVE-WITH-CHANGE, RF-16~RF-21 승계) |
| Implementation branch | `feat/postcraft-14cycle-approval-failure` @ `59a81811bd3fba3613761f7e3db6844b29681b04` (frozen OID — §3.0은 검증만 수행, 신규 커밋 0건) |
| Worktree | `.lsc/worktrees/postcraft-14cycle-approval-failure/` |
| Base branch | `feat/lets-craft-v1` (§2.3 검출 — audit-0/1과 동일) |
| Prior audit | `audit/audit-1.md` (APPROVE-WITH-CHANGE, RF-16~RF-21, 전건 apply-only) |
| 결정적 체크 | **FAIL** (exit 1) — `check/logs/check-4.log` (threshold check-3 초과, cycle-freshness 충족) |
| §3.0 | `lsc-test-engineer` — RF 테스트 의무 6/6 실재·유효 판정, 보강 불요, run_check.sh 무변경(diff vs fbc4c9c empty), Test Health **HEALTHY**, targeted 514 passed / 0 failed, 커밋 없음 |
| 감사 lane | §5.2 owner routing: `lsc-auditor` ×3 (lens ② plan / ③ regression / ④ infra — 승계 라우팅: RF-16/17/18→④+explore, RF-19/20→③, RF-21→②④; lens ①은 bundle 미지정으로 §5 예외 하에 부재) + `lsc-explore` ×1. lens ④의 첫 terminal yield가 Expected State+반증 답변까지만 도착하고 verdict/findings가 유실(audit-1 lens ④와 동일 provider 유실 패턴) — 표준 idle-recovery 요청으로 전체 보고서 회수, 재스폰 불요, heard 처리. audit-level prefix를 출력한 lane 없음 |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## Expected State (§4.1.3 — diff 열람 전 고정)

이 사이클의 검증 대상은 audit-1 Required Fix 6건이며, 기대 상태는 RF 원문 좌표에서 사전 고정했다 (각 lane도 자기 Expected State를 spec/plan/RF만으로 선서술 — lane 파일 참조).

| 대상 | 요구 좌표 | 기대 관측 상태 | 검증법 |
|---|---|---|---|
| RF-16 | audit-1.md:246 | `test/e2e-helpers.ts:26`에 `execFileSync, spawn, type ChildProcess` value/type 분리 import 복원, 4-file E2E 로드 가능 | import·사용부 직접 재독 + E2E 실행(check) |
| RF-17 | audit-1.md:247 | 두 sidecar 경로 각각 1회 단일-path `git check-ignore -q --` 호출, 독립 단언 | 호출부 직접 재독 + E2E 실행 |
| RF-18 | audit-1.md:248 | missing/dangling/non-symlink → ENOENT/EINVAL 한정 not-pinned → link 진입 → realpath+gitHash fail-closed 재검증; 3경계 단위 회귀 | helper·테스트·실제 omp link 구현 대조 |
| RF-19 | audit-1.md:249 | strict decode 오류 persist/publish 전 전파, best-effort 생략, bytes 불변+singleton 미등록 테스트, serialized exact 비교 | state.ts·테스트 직접 재독 |
| RF-20 | audit-1.md:250 | (a) 3필드 validator 선적용 (b) raw String() 제거 (c) terminal runtime parser (d) run-check slug guard+root identity; 각 경로 fail-closed/무-effect/무-raw-payload 테스트 | 4경로 코드·테스트 직접 재독 |
| RF-21 | audit-1.md:251 | SKILL 두 heading `timeout_ms: 43200000` 단일값, fixture 예외 제거, drift contract test | SKILL·테스트·package.json 산식 대조 |

## Base Drift (§4.1.4 — lsc_audit_begin 관측, verbatim)

> Base authority: explicit-base "feat/lets-craft-v1" @ 36da9e9fadc3 — source @ 59a81811bd3f, 0 behind (in sync).

`{baseBranch: feat/lets-craft-v1, baseTip: 36da9e9fadc3, sourceTip: 59a81811bd3f, behindCount: 0, status: ok, authority: explicit-base}` — drift WARN 없음.

## Prior Required Fix bundle — 정규형 재구성과 검증 결과 (§5.1/§5.3)

audit-1 Required Fix를 §5.1 정규형으로 재구성: itemId RF-16~21 (unique, non-blank ✓), origin ∈ owners 정확 1회 ✓ (RF-16/17/18 origin=auditor④ ∈ {④, explore}; RF-19/20 origin=auditor③ ∈ {③}; RF-21 origin=auditor② ∈ {②, ④}), duplicate/extra/missing pair 없음 ✓ — bundle invariant 전건 통과, shortcut 진입 유효.

**VerificationResult normalization (owner별, OID `59a8181…` / cycle 2 — 정규화는 메인 세션 수행):**

| itemId | owner | status | evidence 요지 |
|---|---|---|---|
| RF-16 | auditor ④ | FAIL* | lens verdict REJECT(§5.3 표의 문언상 FAIL) — 단 RF-16 criterion 자체는 "완전" 판정, e2e-helpers.ts:26,328-332 직접 근거 |
| RF-16 | explore | PASS | 매핑에서 적용 확인, 무관 유입 0 |
| RF-17 | auditor ④ | FAIL* | 동상 — criterion 자체는 "완전", 단일-path 호출 + 비실존 로그 exit 0 실증 |
| RF-17 | explore | PASS | 매핑 확인; 형해화 재판정 통과 |
| RF-18 | auditor ④ | FAIL | **부분 적용** — non-symlink regular-file 경계에서 production `omp plugin link`(18.0.11 manager.ts:797-806: symlink/directory만 unlink) EEXIST 실패, unit fake의 선행 rmSync(:505)가 은폐 |
| RF-18 | explore | PASS | 3경계+거부 8테스트 운동 확인 (요구 범위 기준; production 경계 결함은 ④ 소관 발견) |
| RF-19 | auditor ③ | FAIL | **부분 적용** — runtime 수리는 완전, serialized-exact 핀이 canonicalJson 키정렬로 byte 축 소거 + replay 후 bytes 재독 부재 |
| RF-20 | auditor ③ | FAIL | **부분 적용** — (a)(c) 완전, (b) raw String() 5필드 잔존, (d) wrapper 순서·identity·테스트 미완 |
| RF-21 | auditor ② | FAIL* | lens verdict REJECT — 단 RF-21 criterion 자체는 "완전 적용" (반증 질문 전면 반증) |
| RF-21 | auditor ④ | FAIL* | 동상 — "완전" 판정, 41,280,000ms 산식 < 43,200,000ms 확인 |

\* = §5.3 normalization 표의 문언(lens verdict가 APPROVE-family가 아니면 FAIL)에 따른 기계적 FAIL이며, 해당 item criterion에 대한 lane의 실질 판정은 "완전 적용"이다 — 이 구분을 §4.2 종합에서 명시적으로 가중했다. 모든 owner가 heard·current-OID·current-cycle이므로 `owner inconclusive` 케이스는 발생하지 않았다.

**RF 판정 종합 (메인 세션 직접 재독 근거 포함):**

| RF | 판정 | 근거 (메인 세션 직접 확인) |
|---|---|---|
| RF-16 | **완전 적용** | e2e-helpers.ts:26 재독 + check-4에서 e2e-audit-escalation 3/3·e2e-full-cycle green — audit-1 CRITICAL N1의 setup 즉사 소멸을 기계 증거로 확인 |
| RF-17 | **완전 적용** | :737-742 루프(경로당 1회 `-q --`) 재독 + check-4 escalation 3/3 green (check-2의 fatal 소멸) |
| RF-18 | **부분 적용** | 3경계 단위 회귀·catch narrowing은 실재(테스트 엔지니어·explore·④ 일치). 단 non-symlink 경계: manager.ts:797-806을 직접 재독 — regular file은 unlink 대상이 아니어서 `symlink` EEXIST → CLI exit 1 → 후검증 미도달. fake의 rmSync(:505)도 직접 재독 — production에 없는 선행 삭제로 이 갭을 은폐 |
| RF-19 | **부분 적용 (runtime 완전 / 테스트 핀 미완)** | state.ts strict 전파·best-effort 생략·bytes 불변·미등록 테스트 실재. 핀: craft-verdict.test.ts:1052-1080 직접 재독 — canonicalJson은 값-exact 전체 파일 비교(구 .toEqual보다 강함)이나 "byte-equivalence 원문 충족"의 문언 미달 + replay 후 bytes 재독 부재 |
| RF-20 | **부분 적용** | (a) verdict.ts:623-628 controlChar 선적용 ✓, abort.ts 선적용 ✓ (c) parseTerminalDispositionSummary:221-228 ✓ (b) audit-policy.ts:172-175,191 직접 재독 — recordFeature/dueCycle/scheduledCycle/intervalCycles/nextDueCycle의 raw `String()` 잔존 (d) run-check.ts:469-473 직접 재독 — execute가 slug guard(:348, core 내부)보다 먼저 findPersistedCraftState 호출; identity 검증은 root projection만(:363-375) |
| RF-21 | **완전 적용** | SKILL.md:40,100 두 좌표 43200000 단일값, skill-contract.test.ts:1282-1298의 exactly-two/singleton/floor/구값-부재 단언 — ②④ 완전 수렴, ②의 Constraint 8 별칭 우려도 반증(cap interval SSOT와 무관한 wall-clock budget) |

## Spec Compliance Matrix (§5.4 — audit-1의 Partial 행만 재검증, 메인 세션 직접 확인)

### Acceptance Criteria (재검증 행)

| Requirement | Status | Evidence (file:line) | Notes |
|---|---|---|---|
| AC-8 E2E | **Partial** | 배선·setup 전체 복구: check-4.log — escalation 3/3 ✓, full-cycle ✓(3,201s 실제 merge까지). 차단 잔존: e2e-preset-default:187 ✗ (explore model 라우팅), e2e-red-cycle-continuation:218 ✗ (B 위 신규 커밋 부재) | audit-1의 CRITICAL 2건(setup 즉사)은 폐쇄 — 4파일 전부 test body 도달은 이 사이클이 최초. 잔존 red 2건은 동일 OID 2회 실행(check-3/check-4) 대조로 **비결정 축 + 표본화 구조 결함**으로 판별(아래 Deterministic Check). RF-28/29 처방 |

### Constraints / Non-Goals

audit-1에서 Partial/Unmet인 행 없음 — 재검증 대상 없음. fix delta의 신규 scope behavior 없음(explore residue 판정).

## Plan Compliance Matrix (재검증 행 — audit-1에서 "실행 증거 유보"였던 축)

| Step/Decision | Status | 메인 세션 재검증 |
|---|---|---|
| PR5-3 Continue 정확 2회 (실행 증거 축) | **Met** | check-4.log:284-285 — Continue 시나리오 56,979ms 실제 subprocess green. assertion 축은 audit-1에서 기 Met |
| PR5-4 Abort delegation (실행 증거 축) | **Met** | check-4.log:286 — 122,983ms green (check-3에서도 green) |
| PR5-5 red continuation (실행 증거 축) | **Unmet** | check-3 :216 red(spawn count 0), check-4 :218 red(커밋 부재) — 2회 연속, 상이 지점. assertion 축은 ② Met 판정 유지; 실행 축은 RF-28의 표본화 결함이 원인 |

## Code Quality & Regression Risk (§3.4 종합)

### 수렴 (2개 이상 lane 독립 지목 — 수렴 선언은 메인 세션만)

1. **RF-20(d) wrapper 순서·identity** — lens ②(Finding 1)·③(Finding 1)·④(Finding 2, 테스트 의무 축) 3-lane 독립 수렴 + 메인 세션 run-check.ts:469-473 직접 확정. 최고 신뢰. 분류: 수정 · **MAJOR** → RF-24.
2. **RF-20(b) raw String() 잔존** — lens ③(Finding 2)·explore(coverage (b) PARTIAL: escaped-echo 무단언) 수렴 + 메인 세션 audit-policy.ts:172-175,191 직접 확정. 분류: 보완 · **MAJOR** → RF-23.

### 단독 lane 발견 (미교차 관측임을 명시 — 전건 메인 세션 직접 재독으로 실재 확정)

- lens ④ 단독 — **RF-18 non-symlink production 경계 + fake 은폐** (MAJOR): manager.ts:797-806·fake rmSync:505 메인 세션 재독 확정 → RF-22.
- lens ③ 단독 — **auditBaseSnapshot runtime parser 부재** (MAJOR): verdict.ts:548-556 replay가 무검증 보존 snapshot을 describeAuditBase로 보간 — 메인 세션 재독 확정. RF-19의 정확한 보존이 무검증 replay 표면과 결합하는 구조 → RF-26.
- lens ③ 단독 — **audit_begin wrapper의 feature guard 후행** (MAJOR): verdict.ts:630-641 재독 — resolveFeatureName 후 slug 미검증 상태로 resolveAuditRoot+observeAuditBase(git) 수행 → RF-25.
- lens ③ 단독 — **RF-19 serialized-exact 핀 미완** (MAJOR, 불일치 기록 참조) → RF-27.
- explore 단독 — e2e-helpers.ts:84 rethrow arm 무운동 (MINOR, 비차단), audit-policy.ts:201/:479-480 escaped-echo 무단언 (RF-23에 병합).
- 메인 세션 단독 — **E2E 표본화 구조 결함 + 비결정 축** (MAJOR ×2): check-3/check-4 동일 OID 대조로 직접 판별 (Deterministic Check 절) → RF-28/29.

### 불일치 기록 (양쪽 판독 + 메인 세션 판정)

- **RF-19 핀**: ② Met("전체 canonical serialized representation 비교가 있다") vs ③ 부분 적용·MAJOR("canonicalization이 byte 차이를 지운다"). 메인 세션 직접 재독(:1052-1080) — **③ 지지**: canonicalJson은 값-축 exact이지만 RF 원문의 "RF-5 byte-equivalence 원문 충족" 문언에는 미달하고, replay 후 bytes 재독 단언도 없다. 단 실질 방어력(sibling 필드 손상 검출)은 구 .toEqual 대비 강화 — 잔여는 문언 축이며 위험 실질은 낮다. 래칫에 따라 MAJOR 유지, RF-27 처방은 잔여 절반(replay bytes 불변)에 집중.
- **treadmill 판정**: ②③④는 audit-1 이월 경고를 기계 적용해 lane REJECT, explore는 "부분 적용 재발(treadmill) 시그니처 없음 — 6 RF 모두 원문 요구를 단일 커밋으로 충족"으로 정반대 판정. 메인 세션 판정은 §4.2 절에서 상술 — **이월 경고의 트리거 사실은 인정하되, 트레드밀 추론은 측정으로 반증**.

### 폐기 기록 (§4.2 Layer 3)

**폐기 0건** — 검증한 모든 finding은 인용 좌표에서 사실로 확인되었다(RF-18 production 경계는 설치된 omp 18.0.11 소스 직접 재독까지 수행).

## Deterministic Check (§3.1)

- **결과: FAIL** (exit 1) — 재저작 cap 미발동(isError 0회), manifest-runner WARN 없음. `timeout_ms=43,200,000`으로 호출(RF-21 계약값 이행).
- Log: `check/logs/check-4.log` (679 lines) — cycle-2 threshold(check-3) 초과, freshness 충족.
- Script sha256: `87fe5a33949f97822554e15d8a2293d8d5c9b4a90db6586c501e03def7b7daa4` (fbc4c9c 이후 무변경 — post-exec 해시 unchanged 확인)
- 실행 단계: `npm run build` PASS → `npm test` **1761 passed | 14 skipped, 67 files** PASS → `npm run test:bun` PASS → `npm run e2e` **2 files failed / 2 tests failed (4 files / 6 tests)** FAIL.
- 발췌 (log:284-304):
  ```
   ✓ test/e2e-audit-escalation.test.ts (3 tests) 269595ms   [3/3 green — RF-17 폐쇄 실증]
   ✓ test/e2e-full-cycle.test.ts (1 test) 3201431ms          [green — land까지 완주]
   ❯ test/e2e-preset-default.test.ts (1 test | 1 failed)
     × … → explicit explore entry must beat preset default: expected 'glm-4.5-flash' to be 'glm-5.1'
   ❯ test/e2e-red-cycle-continuation.test.ts (1 test | 1 failed)
     × … → the continuation cycle must land new commits on top of B: expected '…' not to be '…'
   Test Files  2 failed | 2 passed (4) / Tests 2 failed | 4 passed (6) / Duration 5198.98s
  ```
- **동일 OID(59a8181) 2회 실행 대조 — check-3(craft 재진입 red, 2026-08-31) vs check-4(이번 사이클):**

  | E2E 파일 | check-3 | check-4 | 판독 |
  |---|---|---|---|
  | e2e-audit-escalation | ✓ 3/3 | ✓ 3/3 | 결정적 green — RF-16/17 폐쇄 |
  | e2e-full-cycle | ✗ (subprocess **timeout**) | ✓ | run-to-run 변동 (LLM 소요시간 축) |
  | e2e-preset-default | ✓ | ✗ :187 | run-to-run 변동 (모델 라우팅 축) |
  | e2e-red-cycle-continuation | ✗ :216 (spawn 0) | ✗ :218 (커밋 부재) | 2회 연속 red, **상이 단언 지점** |

- 감사 판단: **§4.2 Layer 1 하드 게이트 발동** — 이 사이클은 APPROVE/APPROVE-WITH-COMMENT 불가. 단 red의 성격이 audit-1과 질적으로 다르다: (1) 이전 CRITICAL 2건은 폐쇄됐고 4파일 전부 test body에 최초 도달, (2) 잔존 red는 TS 구현 결함이 아니라 **E2E 하니스의 표본화 구조 결함(RF-28: earlyExit가 §8 finalization 커밋 이전 시점을 표본)과 LLM-subprocess 비결정 축에 결정적 단언을 건 설계(RF-29)** — 이번 실사이클의 §3.0이 "무커밋 완료"가 정당함을 실증한 것과 :218 단언이 정면 모순. craft가 check-3 red를 [Craft Incomplete]로 반환하고 이 사이클이 canonical continuation으로 재수립한 것 자체는 계약 정합 동작이다.
- check-4는 `[Audit Evidence Mode]`로 기록됨(활성 craft 부재 — post-craft 단독 실행의 정상 경로).

## Lane Reports (§4.1.9)

### lsc-explore — verbatim 전문

```json
{
  "adversarial_a_check_dilution": "없음 — run_check.sh 최종 커밋 fbc4c9c(delta base, fix delta 미변경), 4단계 실호출(build/test/test:bun/e2e)+|| status=1 누적+exit status 유지, package.json:14-17 e2e 스크립트(LSC_E2E=1·4파일·no-file-parallelism·testTimeout=10200000·hookTimeout=120000)와 헤더 기술 정합, vitest.config.ts:12-13 include/exclude 정합, RF-21 예산 산식 41,280,000ms ceiling < 43,200,000ms 정합",
  "adversarial_b_residue_contamination": "없음 — porcelain 空(untracked 포함), base..HEAD 22커밋 전수 본기능 소속, .lsc/crafts 아래 타 기능 디렉터리 0건, fix delta 23파일 전부 RF 매핑 또는 audit-1 기록, vendored 트리(oh-my-pi/oh-my-claudecode/lazycodex/pi) 미터치",
  "coverage_probe": {
    "i_rf18": "PASS — 3요구 경계(missing/wrong-target/non-symlink)+correct no-op+fail-closed 4종 = 8테스트 전수 운동(e2e-helpers.test.ts:463,478,496,514,527,537,545,554); audit-1의 미커버 MINOR 해소. 잔존 1분기: e2e-helpers.ts:84 예상外 errno rethrow arm 무운동(MINOR)",
    "ii_rf19_20": "state.ts 전파 PASS(strict/best-effort × malformed/future-version 4테스트 + craft-init tool 경로 2 + craft-verdict.test.ts:1053-1080 canonicalJson 전체 exact 비교). validator 4종: (a) control-char 가드 PASS(verdict/abort, git 0호출·무effect까지 단언), (b) escaped echo PARTIAL(pending 분기 :458-459만 직접 단언 — :201·:479-480은 라인 실행만, control-payload 탈출 무단언), (c) runtime parser PASS(land-flow:693-707), (d) slug guard+root identity PASS(run-check.test:499-546 4테스트)",
    "iii_unexercised_paths": "3건 — ① e2e-helpers.ts:84 rethrow arm, ② audit-policy.ts:201·:479-480 탈출 동작 무단언, ③ RF-17 seedCraftedFeature 루프는 LSC_E2E=1 e2e 단계에서만 운동(결정적 체크 4단계가 수행, 유닛 테스트 없음)"
  },
  "code_mapping": "fix delta fbc4c9c..59a8181 = 4커밋(cc832f5 RF-16/17/18 · 8587807 RF-19 · 56189a4 RF-20 · 59a8181 RF-21) · 23파일 +1418/−32, RF별 1:1 매핑 완료(무관 유입 0). src 8(tool-text 신규 포함), test 10, skills 1, audit 기록 5(A). 부분 적용 재발(treadmill) 시그니처 없음 — 6 RF 모두 원문 요구를 단일 커밋으로 충족",
  "frozen_oid_recheck": "59a81811bd3fba3613761f7e3db6844b29681b04 = assignment 값 일치",
  "lane": "Aud2Explore (code mapping + coverage probe, 비-auditor 독립 보이스)",
  "residual_gaps_for_main": "MINOR 2류: ① e2e-helpers.ts:84 rethrow arm 무운동, ② audit-policy.ts:201/479-480 escaped-echo 무단언 — 모두 fail-closed 구조 위 잔존, verdict 가중은 메인 세션 몫",
  "verdictRendered": false
}
```

(explore의 "6 RF 모두 원문 요구를 단일 커밋으로 충족" 판정은 커밋-단위 매핑 관점이며, ③④가 발견한 부분-적용 결함과의 불일치는 위 불일치 기록에 정리했다.)

### lsc-auditor 요지 (전문은 각 파일 — 한 부만 보존)

| Lane | 판정 (prefix 원형) | OID echo | Findings | 요지 | 전문 |
|---|---|---|---|---|---|
| lens ② plan·ADR 준수 | `AUDITOR VERDICT: REJECT` · Reviewed cycle 2 | 일치 | MAJOR 1 | RF-21 완전 적용(반증 전면 실패=정합), PR5-3/4/5 assertion 축 Met, PR1-4 (a)~(i)·Guardrails 비회귀; RF-20(d) wrapper 순서 결함(이월 treadmill 규칙 적용으로 REJECT) | `audit/auditor-2-plan.md` |
| lens ③ 회귀·코드품질 | `AUDITOR VERDICT: REJECT` · Reviewed cycle 2 | 일치 | MAJOR 5 | RF-19 runtime 완전·핀 부분, RF-20 (a)(c) 완전·(b)(d) 부분, snapshot parser 부재·begin wrapper 순서 신규 제기; 반증 질문의 역방향 회귀·과차단은 반증 | `audit/auditor-2-regression.md` |
| lens ④ 인프라·설정 | `AUDITOR VERDICT: REJECT` · Reviewed cycle 2 | 일치 | MAJOR 2 | RF-16/17/21 완전(실험 검증 포함: 비실존 로그 check-ignore exit 0, E2E collection 무오류), RF-18 부분(production non-symlink 경계 + fake 은폐 — 설치 omp 소스 재독 근거) | `audit/auditor-2-infra.md` |

## Required Fix (AWC — craft가 추가 질문 없이 구현 가능하도록; 전건 apply-only, 재설계 0건)

- **RF-22 [MAJOR]** (RF-18 잔여 — origin: auditor ④, owners: [④, explore]) `test/e2e-helpers.ts:69-110` `pinLetsCraftPluginToRepo`: non-symlink(regular file) slot을 helper가 안전 정규화(명시 정책으로 regular file 제거; EACCES/EPERM은 전파)한 뒤 실제 `omp plugin link REPO_ROOT`에 진입시켜라 — 현행은 production link가 regular file을 치우지 않아(설치 omp 18.0.11 `manager.ts:797-806`: symlink/directory만 unlink) `symlink` EEXIST→CLI exit 1로 후검증 미도달. `test/e2e-helpers.test.ts:503-506` fake의 선행 `rmSync`를 제거해 helper가 정규화하지 않으면 테스트가 red가 되게 하고, temp HOME/config 기반 hermetic real-`omp plugin link` non-symlink 회귀를 추가하라. 모든 성공 branch에서 realpath+BUILD_INFO.gitHash 후검증 유지.
- **RF-23 [MAJOR]** (RF-20(b) 잔여 — origin: auditor ③, owners: [③]) `src/craft/audit-policy.ts:172-175,191`: `recordFeature`/`dueCycle`/`scheduledCycle`/`intervalCycles`/`nextDueCycle`의 raw `String()` 보간을 `JSON.stringify` 또는 constant diagnostic으로 교체하라. newline/tab/ESC/DEL payload를 각 필드에 seed한 뒤 실제 `performAuditBegin` 결과가 single-line·무-raw-payload임을 고정하는 회귀를 추가하라(explore가 지적한 :201/:479-480 escaped-echo 무단언 폐쇄 포함).
- **RF-24 [MAJOR]** (RF-20(d) 잔여, ②③④ 수렴 — origin: auditor ③, owners: [③, ②]) `src/craft/run-check.ts:469-473` `registerRunCheckTool.execute`: `resolveFeatureName` 직후 shared `FEATURE_SLUG_RE` 거부를 수행하고 그 후에만 `getActiveCraft`/`findPersistedCraftState`를 호출하라(현행은 invalid slug로 candidate existsSync+decode 선행 — ":348 주석의 'before ANY fs access'가 wrapper에서 거짓"). persisted identity는 candidate별 `{feature===requested, projectRoot===ctx.cwd, worktreeRoot ∈ {undefined, worktreePath(ctx.cwd, feature)}}` 정규형 exact 검증으로 강화하라(현행 :363-375는 root projection만). captured production `execute` 회귀: invalid slug → state-read/exec/log-write 0회 + control-marker 무-raw-payload, identity 필드별 mismatch 거부, foreign-root control-payload의 escaped 단언(④ Finding 2의 무-raw-payload 의무 병합).
- **RF-25 [MAJOR]** (RF-13/20 계열 — origin: auditor ③, owners: [③]) `src/craft/verdict.ts:630-641` `registerAuditBeginTool.execute`: controlChar guard 직후 `resolveFeatureName` 결과에 shared slug guard를 적용하고, 성공한 feature만 `detectFixturePath`/`resolveAuditRoot`/`observeAuditBase`/core에 전달하라. captured production 회귀: invalid feature → git 실행 0회·state bytes 불변.
- **RF-26 [MAJOR]** (신규, RF-19 보존과 결합하는 표면 — origin: auditor ③, owners: [③]) `parseAuditBaseSnapshot` runtime parser 신설(`parseTerminalDispositionSummary`(:221-228) 선례 미러): status/authority enum, canonical ISO, 40-hex OID shape, safe count, control-free `baseBranch`/`error`를 검증한 뒤에만 `describeAuditBase` 보간(replay `src/craft/verdict.ts:548-556` 및 land 경로). invalid → raw record를 포함하지 않는 constant `invalid-state`. newline-bearing snapshot seed→strict 재등록→same-cycle replay 회귀에서 state bytes 불변+무-raw-payload 동시 단언.
- **RF-27 [MAJOR]** (RF-19 핀 완결 — origin: auditor ③, owners: [③]) `test/craft-verdict.test.ts:1067-1088`: replay 직전 raw state bytes를 저장하고 replay 후 `readFileSync(...).toBe(beforeReplayBytes)`를 단언하라(replay는 무엇도 재기록하지 않는다는 계약의 byte 축 핀). 기존 canonical whole-file 비교는 유지.
- **RF-28 [MAJOR]** (E2E 표본화 구조 결함 — origin: deterministic-check, owners: [deterministic-check, ④]) `test/e2e-red-cycle-continuation.test.ts:198-224`: earlyExit predicate가 `:217-224`가 단언하는 관측(B 위 신규 test/check 커밋 실재)이 성립한 뒤에만 조기 종료하도록 강화하거나 subprocess 자연 종료까지 대기하라. 근거: §8 finalization 커밋은 §3.0 spawn 완료보다 한참 뒤에 오므로 현행 predicate(:199)는 단언 대상이 생기기 전 시점을 표본한다 — check-3 :216 red(RUN_CHECK_MARKER 선행 경로에서 spawn count 0)·check-4 :218 red(spawn 완료·커밋 이전)가 동일 결함의 두 표본. §3.0이 정당하게 무커밋 완료하는 경로(이번 실사이클이 실증)에 대한 단언 처리도 명시하라.
- **RF-29 [MAJOR]** (E2E 비결정 축 — origin: deterministic-check, owners: [deterministic-check, ④]) `test/e2e-preset-default.test.ts:187`: 동일 OID에서 check-3 PASS→check-4 FAIL(expected 'glm-5.1', got 'glm-4.5-flash')로 재현된 explore override 미적용의 근인을 캡처된 sessionInventory/jsonl로 판별하고, 단언 전 explicit models.yaml entry 적용의 결정적 전제(설정 로드 완료 관측 또는 sentinel 모델명 기반 라우팅 소스 판별)를 고정하라. host(omp) 측 라우팅 결함으로 판명되면 그 증거를 감사 문서에 회부하고 테스트는 결정적 전제 위에서만 단언하게 하라.

**비차단 권고 (Required Fix 아님):** ① `e2e-helpers.ts:84` 예상外 errno rethrow arm 단위 회귀(RF-22와 동일 파일 — 함께 해소 권장), ② test/** 포함 `tsc --noEmit` 단계(audit-1 이월), ③ `tool-text.ts` validator의 C1(U+0080–009F)·U+2028/2029 범위 검토(③ open question), ④ orphan helper 2종(audit-0 이월 MINOR).

**Fix-verification 스코프 노트**: 다음 사이클은 §5 fix-verification. 승계 라우팅 — RF-22: ④+explore, RF-23/25/26/27: ③, RF-24: ③+②, RF-28/29: deterministic-check+④. **주의: 다음 `lsc_audit_begin`은 candidate 3 — live interval의 첫 due cycle이므로 [Audit Escalation] 게이트가 발동한다.** 이는 이 feature가 구현한 바로 그 수렴 장치가 자기 자신의 루프를 바운딩하는 것으로, 계속/중단/보존 처분은 사용자 소관이다. **경고 갱신**: audit-1의 이월 경고(재차 부분 적용=treadmill=REJECT)는 이번 사이클에서 트리거 사실이 관측되었으나 §4.2에서 상술한 측정 근거로 AWC를 유지했다 — 차기 사이클에서 RF-22~29 중 어느 항목이든 **삼차** 부분 적용이 관측되면 그때는 측정 반증의 여지없이 REJECT로 처분한다(동일 계열 3회 반복은 어떤 수렴 곡선으로도 정당화되지 않는다).

## Proposed Spec/Plan Amendments

없음 — 모든 결함은 구현·테스트 하니스 측이다. RF-28의 "B 관측" 논쟁은 plan PR-5.5의 결함이 아니라 earlyExit 표본 시점의 구현 결함으로 판정했다(plan.md:413의 단언 의도는 유지 가능 — 커밋 관측을 기다리면 성립한다).

## Adversarial Class Matrix (§4.1.14 — 판정은 메인 세션)

| Class | Owner | 판정 | 근거 |
|---|---|---|---|
| 결정적 체크의 형해화 | lsc-explore | **excluded** | run_check.sh 무변경(sha 동일, fbc4c9c 이후 diff empty — §3.0 엔지니어·explore·메인 세션 3중 확인), 4단계 실호출·실패 누적 구조 유지, WARN 없음. 이 check는 이번에도 E2E 구조 결함 2건을 기계 검출했다 — 트리거 조건(형해화 존재) 부재 |
| Worktree residue / base contamination | lsc-explore | **excluded** | porcelain 空(untracked 포함), base..HEAD 22커밋 전수 본기능, behind 0(in sync), vendored 트리 무터치, fix delta 23파일 무관 유입 0 |
| Spec AC boundary inputs | (lens ① 부재 — §5 bundle 미지정) **메인 세션 직접 방면** | **applied** | AC-8 실행 경계 잔존: E2E 2/4 red(RF-28/29). RF-18의 non-symlink 경계(④ 발견)도 하니스 경계 결함. AC-1/2 경계는 audit-1에서 폐쇄됐고 fix delta가 해당 경계 로직을 건드리지 않음(explore 매핑 무관유입 0으로 확인). lens ① 부재는 §5 owner routing의 정당 결과이며, 이 클래스는 메인 세션이 직접 방면했음을 명기한다 |
| Post-resume state consistency | lens ③ | **applied** | RF-19 수리 실증(strict 전파·bytes 불변·미등록 — :261-304 재독). 잔존: 무검증 `auditBaseSnapshot`이 RF-19의 정확한 보존을 타고 replay에서 raw 재방출될 수 있음(RF-26 처방) |
| Prompt-injection surface | lens ③ | **applied** | raw `String()` 5필드(:172-175,191 — RF-23), wrapper 순서 2건(RF-24/25), snapshot raw 보간(RF-26). named 3필드 validator(RF-20(a))와 terminal parser(RF-20(c))는 폐쇄 확인. `test/audit-policy.test.ts:496`의 injection literal은 negative fixture 안에 갇힌 무해 관측(③) |

## §4.2 판정 근거 (3-layer 종합 + named case 대응)

- **Layer 1**: 결정적 체크 **FAIL**(check-4.log) — 하드 게이트 발동, APPROVE-family 불가. 무응답 lane 0 (lens ④는 표준 idle-recovery로 회수 완료 — 재스폰 불요).
- **Layer 2**: 생존 CRITICAL 0건. 생존 MAJOR 8건 — RF-22(④), RF-23(③+explore 수렴), RF-24(②③④ 수렴), RF-25(③), RF-26(③), RF-27(③, ② 불일치는 ③ 지지로 해소), RF-28/29(deterministic-check 기계 증거+메인 세션 판별). 래칫 위반 없음(하향 0건).
- **Layer 3**: 폐기 0건 — 전 finding 인용 좌표 직접 재독으로 실재 확정(RF-22는 설치 omp 소스까지 재독).
- **Named case 대응 (§4.2 매트릭스)**: RF-22/23/24/25/27 = `partial original apply-only`(원 항목 부분 적용, remediation 구체 apply-only, owner set 완비) → **AWC**. RF-26/28/29 = `new unrelated apply-only MAJOR` → **AWC**. REJECT 행 해당 0건: 신규 CRITICAL 없음, needs-redesign 없음, unheard/unroutable/inconclusive owner 없음, bundle invariant 위반 없음.
- **lane REJECT 3건과의 불일치 — 명시 판정**: ②③④는 audit-1의 이월 경고("재차 부분 적용=treadmill 시그니처=REJECT")를 기계 적용했다. 트리거 사실은 인정한다 — RF-18/19/20의 3계열이 재차 부분 적용됐다. 그러나 그 경고의 **추론**(treadmill=발산)은 이 사이클의 측정이 반증한다: (1) fix-introduced 신규 TS 결함 **0건**(③ 회귀 sweep·explore residue·메인 세션 재독 일치 — trace H-C의 시그니처 지표인 fix-introduced 비율은 대상 프로젝트 62.5→85.7%였고 이번은 0%), (2) 잔여는 단조 축소(audit-0 RF 15건 → audit-1 RF 6건 → 이번 잔여: 3계열의 하위 경로 + 신규 명명 표면 — 전건 국소), (3) 이전 CRITICAL 2건은 기계 증거로 폐쇄(escalation 3/3·full-cycle green — audit-1의 측정 사각이 아니라 측정 확장이 이번 red의 출처), (4) 독립 보이스(explore)가 treadmill 시그니처 부재를 정면 판정. 여기에 이 feature 자신이 land한 계약(spec AC-7, §4.2 named case matrix — "fixed, not discretionary")이 이 케이스들을 AWC로 고정하며, REJECT의 문서 요건("scoped fix 처방 불가 수준의 broad/severe")은 정직하게 충족 불가하다 — RF-22~29 처방으로 완결됐기 때문이다. REJECT는 §2.6에 의해 차기 full 재감사를 강제하는데, 그것이야말로 trace H-A가 진단한 비수렴 기제다. 마지막으로 루프 바운딩은 판정 재량이 아니라 구조가 담당한다: **다음 begin(candidate 3)은 live interval의 due cycle로 [Audit Escalation] 게이트가 발동, 계속 여부는 사용자 처분으로 넘어간다.** 이상으로 lane 판정 3건과 달리 **APPROVE-WITH-CHANGE**로 확정한다 — lane 판정의 단어를 복사하지 않은 메인 세션 고유 판단이다.
