# Audit — deferred-pool, cycle 0

## Header

| 항목 | 값 |
|---|---|
| Feature | deferred-pool — 이연 풀 핵심 6종 도구화 + D-3 계약 예외 (A: lsc_land, B: lsc_scaffold, C: /lsc-doctor+lsc_doctor, D: stateVersion, E: craftStateCandidates seam, F: claim 원장+lsc_claims, G: D-3 프로브 절) |
| 날짜 | 2026-07-20 |
| Audit cycle | **0** (첫 감사) |
| 모드 | **full** (§2.6 — 선행 감사 없음) |
| 구현 브랜치 / worktree | `feat/deferred-pool` @ 3691d8e, `.lsc/worktrees/deferred-pool/` (worktree 모드 — 프로젝트 루트 escape hatch 미사용) |
| Base(merge target) 브랜치 | `feat/lets-craft-v1` (origin/HEAD 자동 탐지, merge-base 92e5d12 = trace 고정 HEAD와 일치) |
| 선행 감사 참조 | 없음 (N=0) |
| Freshness threshold | run-3.log (lsc_audit_begin 기록) — 본 사이클 증거는 run-4.log |
| 조사 주체 | lsc-explore(코드 매핑) + lsc-critic(적대적 리뷰) 병렬 스폰 + 메인 세션 자체 file:line 검증(§3.2) + lsc_run_tests 재실행(§3.4) |

**AUDIT VERDICT: APPROVE-WITH-COMMENT**

---

## 1. Spec Compliance Matrix (AC 12항 — 전 행 메인 세션 직접 검증)

각 행의 Status는 서브에이전트 주장 전사가 아니라 메인 세션이 인용 file:line을 직접 read한 뒤 판정했다 (§3.2, C24).

| AC | Requirement | Status | Notes (직접 검증 증거) |
|---|---|---|---|
| 1 | 무검증 land 거부 — 사유 코드 8계열 fail-closed | **Met** | `validateLandAuditEvidence`(verdict.ts:219-246) 직독: no-audit-evidence(:222) → no-audit-cycle(:224, `Number.isInteger` 양필드 — undefined-tolerant 분기 없음) → cycle-mismatch(:227) → verdict-not-approve(:235, LAND_ACCEPTED_VERDICTS=APPROVE 3계열 :208) → stale-run-log(:237-238, `number > threshold && passed` 필수) → evidence-tamper(:240-243, future-cycle·current-cycle 타 verdict; 부재·이전-cycle은 WARN 통과 — land.ts:288-293). evidence-mismatch: land.ts:270-279 persisted 3필드 앵커 대조. approval-required: land.ts:331-352 consume miss 폴딩, `no-pending-approval` 코드 부재를 LAND_REASON_CODES 18종(land.ts:63-84) 직독으로 확인. run-4.log에서 변형별 테스트 green |
| 2 | production 승인 경로 — 실 등록 lsc_confirm 발급 → 소비 → approved sourceOID merge+remove+prune, replay/wrong-target | **Met** | ask.ts:641-669 직독: prepared branch가 craft-bound보다 우선(:646), exact-question(:646)·prepareId 전후 유지(:649)·identity(:651) 결박, persist-before-install(:653-664 — recordReleaseApprovalAt throw 시 미설치), craft-bound 경로 무변경(:670-680). recordReleaseApprovalAt(state.ts:424-440) exact-root + 3필드 검사 후 writeFileAtomicSync. 왕복(O2)·replay는 craft-land-flow.test.ts로 run-4 green |
| 3 | 실패 경로 — conflict abort 사후검증, target-dirty tracked 한정, source drift, 부분 실패 상태기계 | **Met** | land.ts 직독: target-dirty `??` 이외 tracked만 거부(:248-253, untracked는 git 원생 위임), approved sourceOID로 merge(:374 — durable evidence에서 source 차원 구성 :313-329), 실패 시 abortMerge 후 `verifyPostRecovery`(branch/OID/clean — abort exit code 아님)로 merge-aborted(:384-391, "원복"은 이 경우에만)/merge-recovery-failed(:393-399) 구분, 삭제 직전 재검사 실패 시 removeWorktree 미호출(:406-418), merged-but-not-cleaned+force-clean-only 재승인 안내(:420-442), cleaned-but-not-pruned(:444-456), effect-boundary target drift 재확인(:359-369). 희귀 3종은 LandEffects port 주입 테스트 |
| 4 | 검증 함수 거부 매트릭스 + dirty/locked 비검사 음성 | **Met** | evaluateRemovalTarget(worktree.ts:180-193) + RemovalObservation(:113-125 — "no git-state facets") 직독: OMC 순서 보존(sanity→symlink→root/home→containment→main-repo), `.git` 판별의 git R1/R2 중복 주석(:123), dirty/locked/submodule 관찰 자체가 없음. land-removal-target.test.ts 18 tests green |
| 5 | scaffold 결정성 — no-op·심링크·capability 2종·TS 함수 경유·branch 인자 | **Met** | scaffold.ts:61-95 직독: validate-before-effect(slug 게이트 :63, `.lsc`/`.lsc/worktrees`/target 이중 realpath containment :70-81, .gitignore exact-path 심링크 거부 :83-88), 효과는 ensureWorktreesGitignored/addWorktree(branch 전달)/mkdirSync(craftDir) 기존 seam만(:91-95). artifacts-scaffold.test.ts green |
| 6 | 스킬 co-evolution — B(lsc_scaffold+branch 지시)·G(D-3 절) | **Met** | 두 SKILL.md diff 직독: pre-craft Stage 0이 bash 재현 3분기+gitignore 4행을 삭제하고 lsc_scaffold 호출로 대체(branch-prefix 탐지는 산문 유지 — co-evolution 계약 명문), §0에 D-3 예외("일회성 임시 변이 + 즉시 원자 복구 — 구현 작성 허용이 아님"), claims 정본-projection 절 신설. skill-contract-deferred-pool.test.ts 14 tests green |
| 7 | doctor 표·논리 exit·도구 isError·read-only·격리 | **Met** | doctor.ts 직독: computeExit FAIL≥1→1/WARN·UNKNOWN-only→0, registerDoctorTool `isError iff exitCode===1`(:521-527), registerDoctorCommand UI 뷰+exitCode 표기(:490-501), 관찰은 Promise.all+observeWithDeadline per-check 격리(:417-436), DoctorPorts read-only. doctor-adapters.test.ts에 byte-for-byte 무변경 검증 포함, green |
| 8 | doctor 8검사 정확성 + hung UNKNOWN(timeout) | **Met** | DOCTOR_CHECK_IDS 8종(doctor.ts:141-151 — R0=skill-path-drift) 직독, frontmatter 필수/선택 스키마(:161-171). 조작 fixture 23건 doctor-evaluate/adapters green |
| 9 | stateVersion — reader 2종 각각 각인·신버전 에러·부재 관용 | **Met** | decodeCraftState(state.ts:187-197 — 경로·발견 버전·지원 상한 포함 throw, 부재 관용) 직독, loadActiveCraft(:273-280)·readPersistedCraftState(:447-449) 모두 decoder 경유, persist가 stateVersion 각인(:172). craft-state-version.test.ts green |
| 10 | E seam — named policy 2종 보존·기존 회귀 무수정·malformed decode 비의존 | **Met** | `git diff feat/lets-craft-v1...feat/deferred-pool -- test/craft-state.test.ts test/craft-verdict.test.ts` = **0줄** (직접 실행). craftStateCandidates descriptor-only(state.ts:471-476 — "NEVER reads/parses"), findPersistedCraftState open-release 중재 보존(:486-493), resolveAuditRoot rootExists만(verdict.ts:167-170). craft-state-candidates·deferred-pool-regression green |
| 11 | 평가기 사다리+tombstone 단조+lsc_claims 게이트+exactly-once atomic write | **Met** | evaluateLedger(ledger.ts:85-144) 직독: dropCondition 누락→invalid(:87-93), tombstone 단조(:95-102 — 판정 사다리 최우선), 반박+무지지→rejected(:107-113), no-evidence→uncertain(:129-131). claims-tool.ts:67-129 직독: slug→registered worktree 고정 root→symlink/parent containment→all-or-nothing(1건 invalid 시 byte 0 변경 :121-129)→previousDecisions on-disk 구성(:114-119)→단 1회 주입 atomic port 쓰기. research-ledger·claims-tool.test.ts green |
| 12 | 기존 단위 스위트 전수 green (회귀) | **Met** | 본 감사 자체 재실행 run-4.log: 48 files passed / 4 skipped(e2e self-skip), 1182 tests passed, exit 0 — 기존 37 + 신규 11 |

## 2. Plan Compliance Matrix (Step/ADR — 메인 세션 검증)

| Step/결정 | Status | Notes |
|---|---|---|
| Step 1a (D decoder) = 커밋 55ef495 | Met | state.ts:187-197 단일 decoder, reader 2종 경유 확인 |
| Step 1b (E seam) = 2c4018c | Met | descriptor seam + named policy 2종, 기존 회귀 diff 0줄 |
| Step 2 (A 관찰/평가) = 562614d | Met | inspect/evaluate 분리(worktree.ts:106-193), porcelain 파서+membership |
| Step 3a (발급 seam) = 79851cf | Met | prepared envelope + ask.ts 분기 + recordReleaseApprovalAt, release.ts diff **0줄**(직접 실행) |
| Step 3b (lsc_land+SKILL) = ba38198 | Met | 2-phase R→C/P→X 구조 직독 일치, post-craft SKILL §7.3-7.5 co-evolution |
| Step 4 (B scaffold) = aabdff8 | Met | gitignore atomic화 포함, pre-craft SKILL Stage 0 co-evolution |
| Step 5a (F) = 10c4a3d / 5b (G) = 24129d1 | Met | ledger 순수/claims-tool wrapper 분리(pure boundary), D-3 절 |
| Step 6 (C doctor) = 2175b0f | Met | shared runner+어댑터 2, read-only 체커 |
| 9커밋 계획 vs 실제 16커밋 | Met (정당한 추가) | 9 구현 커밋 1:1 + pre-craft 산출물 5 + 추가 2: 5ebef55(canon 사본 — byte 동일 확인, 판정 비개입) / 3691d8e(flake fix — 판정 완화 아님, vitest.config.ts 주석에 근거 문서화) |
| Must-NOT-Have 8항 | Met | dirty/locked 비관찰(관찰 구조 자체에 부재), override 플래그 없음(§7.5 수동 탈출구 산문), release.ts 0변경, persisted 필드는 evidence 강등(land.ts:255-256 주석), doctor 무쓰기, HashManifest/ModelsFile version 비접촉, E2E 비확장, R0는 doctor 검사 ⑧ |
| ADR D1-D7 | Met | D1(LAND_CONSUMABLE_TAGS 소비자 소유 land.ts:56), D2(operation 결박+effect boundary), D3(prepared 슬롯+ask 분기), D4(strict 검증+recordAuditCycleBegin marker 원자 clear state.ts:378-381), D5(named policy 보존), D6(논리 exit+어댑터 2), D7(transition-aware+도구 등록) |
| **침묵 이탈 (문서화됨, 비차단)** | Partial→기록 | ① setActiveCraft `SetActiveCraftOptions{durability}` 신설(state.ts:204-263) — plan 미기재, canon 테스트가 강제, 프로덕션 유일 호출자 hash-manifest.ts:311은 strict로 구계약 보존 ② setActiveCraft merge-preserve(:240-252 — 증거 필드 보존) — canon 강제. 두 건 모두 소유 목록 밖 파일 hash-manifest.ts 변경의 원인이며 코드 docstring+canon 테스트+본 문서로 durable 기록됨 |

## 3. Code Quality & Regression Risk (§3.3 종합)

**수렴(양 에이전트 독립 도달 — 고신뢰)**: (a) run_test.sh의 sync 구조 — canon이 판정 바이트를 공급하되 실행 위치는 리포 test/ 사본이라는 사실을 explore·critic이 각각 독립 확인, 현재 byte 동일(diff -rq)·매 실행 canon 덮어쓰기로 완화됨. (b) hash-manifest.ts·vitest.config.ts의 소유 목록 밖 변경 — 양쪽 모두 지적, 양쪽 모두 정당(계약 적응/flake fix) 판정.

**불일치**: 없음 — critic이 MAJOR 후보로 봤던 merge-preserve 성질 변화를 스스로 canon 계약+다중 게이트 근거로 MINOR 강등했고, explore의 매핑과 모순 없음.

**메인 세션 자체 평가**: 보안 게이트의 핵심 성질(prepared=비권위 발급 컨텍스트/pending=유일 소비 권위, persist-before-install, strict 재검증의 비관용성, effect-boundary 재관찰)은 코드 직독으로 전부 성립. 아키텍처는 관찰/평가/순수 게이트/effect port 분리 관례를 일관 준수. 회귀 위험은 ask.ts·destructive-approval.ts 개봉이 유일한 표면이나 craft-bound 경로 무변경 + 기존 스위트 green으로 고정.

## 4. Test Re-verification (§3.4)

- 방법: `lsc_run_tests(deferred-pool)` — **audit-evidence 모드** (본 세션에 active craft 없음, 루프 북키핑 비오염).
- 결과: **PASS, exit 0** — `test/logs/run-4.log` (threshold run-3 이후 fresh).
- 요약 발췌:
  ```
  Test Files  48 passed | 4 skipped (52)
       Tests  1182 passed | 14 skipped (1196)
  === SUMMARY: deferred-pool ===
  build (tsc type gate, src/)     : PASS
  feature suite (11/11 files)      : PASS
  AC12 full regression (npm test) : PASS
  === RESULT: all executed suites passed ===
  --- exit 0 ---
  ```

## 5. Full lsc-explore report (verbatim)

## Findings
- **Files**:
  - **정본 문서(21)** — `git diff --name-status`가 추가한 경로: [/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/deferred-pool/.lsc/crafts/deferred-pool/open-questions.md:1, plan.md:11, plan/appendix-adr-branches.md:1, plan/appendix-pre-mortem.md:1, plan/appendix-security-land.md:1, plan/appendix-test-plan.md:1, plan/plan-1.md:1, plan/plan-2.md:1, plan/plan-3.md:1, plan/plan-4.md:1, research/SYNTHESIS.md:1, research/cause-disappearance.md:1, research/claim-graph.md:1, research/intent-diff.md:1, research/observation-manifest.md:1, research/verification-economics.md:1, research/waves/wave-1.md:1, research/waves/wave-2.md:1, research/waves/wave-3.md:1, spec.md:29-35, trace.md:1] — 파이프라인의 trace/spec/plan/research 산출물이다.
  - **신규/개조 source** — [**src/craft/land.ts:36-53,218-352,371-464,468-495** — `paths`·`worktree`·`destructive-approval`·`state`·`verdict`를 묶은 2-phase `lsc_land` 오케스트레이터와 registrar; **src/artifacts/scaffold.ts:20-22,61-94,112-136** — `gitignore`·`paths`·`worktree` 재사용 Stage 0 도구; **src/doctor.ts:27-33,141-174,417-475,490-525** — read-only observe/evaluate/exit runner와 `lsc_doctor`/`lsc-doctor` adapter; **src/research/ledger.ts:85-144** — fs 없는 `evaluateLedger`; **src/research/claims-tool.ts:12-15,67-83,159-182** — worktree 고정 경로·검증·단일 atomic write·`lsc_claims` registrar; **src/craft/destructive-approval.ts:55-59,135-173,178-219** — scope 비교와 prepared-operation/pending slot; **src/ask.ts:24-25,631-681** — `[Land]` exact-question confirm 발급 분기; **src/craft/state.ts:24-33,171-195,273-274,424-492** — `stateVersion`, 단일 decoder, exact-root approval writer, descriptor candidate seam; **src/craft/verdict.ts:13-14,167-169,195-253** — audit-root named policy와 strict land audit validator; **src/artifacts/worktree.ts:63-91,105-180,237-261** — branch-aware add, remove trap 주석, removal safety pure/effect 분리, porcelain membership; **src/artifacts/gitignore.ts:23-60** — atomic writer와 read-only checker; **src/artifacts/paths.ts:57-86,94-106** — craft/test/worktree roots와 `craftClaimsPath`; **src/main.ts:3-23,39-44** — 신규 imports와 4 tools + 1 command 등록 표면.]
  - **skills** — [skills/pre-craft/SKILL.md:10,80-89,123-154,353-361 — D-3 예외, `lsc_scaffold`, claims projection, Stage 4 probe; skills/post-craft/SKILL.md:210,218-242 — `lsc_land` 2-phase/정확한 질문/manual escape 산문].
  - **테스트 정본·sync 사본** — 보호 정본 [test/run_test.sh:1-63,88-137,149-185 + test/assets/test/{artifacts-scaffold:27-30, claims-tool:29-31, craft-land-flow:30-46, craft-state-candidates:5-15, craft-state-version:5-18, deferred-pool-regression:35-57, doctor-adapters:28, doctor-evaluate:2, land-removal-target:7, research-ledger:2, skill-contract-deferred-pool:60-61}.test.ts] 및 동일 basename의 sync 사본 [worktree test/ 하위 11파일] — 11+11 files.
  - **Diff 경계 밖 추가 source/config** — [src/craft/hash-manifest.ts:311-323 — `setActiveCraft(..., { durability: "strict" })`; vitest.config.ts:11-22 — `testTimeout: 20_000`, `maxWorkers: 6`]. 두 파일은 `spec.md:29-35`의 component owner 목록과 `plan.md:11`의 구현 목록에 없으며, 후자는 특히 테스트 실행기 설정이다.
- **Root cause**: 테스트 정본은 `.lsc/crafts/deferred-pool/test/`에 해시 보호되지만 `run_test.sh`의 실제 vitest와 `npm test` 판정은 매번 복사된 worktree `test/` 사본을 실행하므로, 코드 매핑과 별개로 보호 경계 밖 사본이 pass/fail에 개입한다.
- **Evidence**:
  1. `test/run_test.sh:88-93`가 `assets/test/*.ts`를 `$SRC_ROOT/test/`로 `cp`한다. `:102-137`의 `FEATURE_FILES`는 `test/$name.test.ts`만 `npx vitest run`에 넘기고, `:149-185`가 `LSC_E2E= npm test`와 세 status를 OR 결합한다. `package.json:14-16`은 실제 `build`/`test` 명령을, `tsconfig.json:3-15`는 `tsc`가 `src/**/*.ts`만 포함함을 확인한다.
  2. `diff -rq .../test/assets/test .../test`의 출력은 repo `test/`에만 존재하는 기존 38개 파일을 열거했고, 11개 공통 deferred-pool 파일의 `differ` 출력은 없었다. 따라서 현재 공통 11개는 바이트 동일하지만, 실행 위치는 보호 밖 사본이다.
  3. 보호 범위 자체는 `src/artifacts/paths.ts:57-60`의 `.lsc/crafts/{feature}/test/`와 `src/craft/hash-manifest.ts:57-80,93-99`의 `testDir` walk/SHA-256로 한정된다. repo `test/`는 그 manifest 대상이 아니다.
  4. 등록 surface는 `src/main.ts:39-44`에서 `registerLandTool`, `registerScaffoldTool`, `registerClaimsTool`, `registerDoctorTool`, `registerDoctorCommand`가 호출되고, `src/doctor.ts:490-505`에서 각각 `lsc-doctor`와 `lsc_doctor`로 등록된다. feature tests는 개별 registrar fake capture만 한다: `craft-land-flow.test.ts:110-148`, `artifacts-scaffold.test.ts:61-72`, `claims-tool.test.ts:96-107`, `doctor-adapters.test.ts:185-204`; `src/main.ts` default export 자체를 capture하는 feature test는 없다.
  5. source-to-test 대응은 `run_test.sh:44-58`과 imports로 확인된다: land/ask/approval/state/worktree는 `craft-land-flow.test.ts:30-46`, scaffold/path/worktree는 `artifacts-scaffold.test.ts:27-30`, doctor는 `doctor-evaluate.test.ts:2`와 `doctor-adapters.test.ts:28`, ledger는 `research-ledger.test.ts:2`, claims tool은 `claims-tool.test.ts:29-31`, state/verdict seam은 `craft-state-candidates.test.ts:5-15`와 `deferred-pool-regression.test.ts:35-57`, gitignore는 `deferred-pool-regression.test.ts:35` 및 full-suite의 기존 `artifacts-gitignore.test.ts`다. `paths.ts`는 여러 feature tests와 기존 path suite가 exercise하지만, `main.ts` registration adapter는 build/import gate만 거친다.
  6. skills 변경은 실행이 아니라 문자열 계약이다. `test/assets/test/skill-contract-deferred-pool.test.ts:100-129,132-149,151-191,197-236`가 pre-craft Stage 0/claims/D-3와 post-craft land 문장을 `readFileSync` 후 heading-scoped string assertion으로 검사한다. 실제 pre/post pipeline 실행이나 main 등록 통합 실행은 이 11개에 없다.
- **Impact**:
  - **Scope**: cross-module
  - **Risk**: medium
  - **Affected areas**: `src/main.ts` 통합 등록 surface, `run_test.sh`의 보호 경계와 vitest 실행 경로, `lsc_land`/`lsc_scaffold`/`lsc_claims`/doctor adapter, pre-craft/post-craft SKILL prose, 그리고 owner 목록 밖 `src/craft/hash-manifest.ts`·`vitest.config.ts`.

## Relationships
`src/main.ts:3-23`가 신규 모듈을 import하고 `:39-44`에서 등록한다. `lsc_land`는 `paths.ts:94-106`의 worktree root를 anchor로 삼아 `state.ts:471-492`의 descriptor seam과 `decodeCraftState(:187-195)`를 사용하고, `verdict.ts:219-253`의 strict audit와 `worktree.ts:143-180,237-261`의 관찰·평가·membership을 거친다. 승인 발급은 `ask.ts:642-665`가 `destructive-approval.ts:178-219`의 prepared envelope와 pending slot을 연결하고, durable evidence는 `state.ts:424-448`에 기록된다. 기존 `[Canon Amendment]` consumer인 `release.ts:60-63`은 `expectedScope` 없이 그대로 남아 operationScope 확장과 분리된다.

`lsc_scaffold`는 `scaffold.ts:91-94`에서 `gitignore.ts:41-52`의 ignore writer/checker, `worktree.ts:63-75`의 branch-aware `addWorktree`, `paths.ts:84-106`의 craft/worktree 경로를 결합한다. `lsc_claims`는 `claims-tool.ts:12-15,67-83`에서 path/membership/atomic-write boundary를 소유하고, 순수 `ledger.ts:85-144`가 판정한다. doctor는 `doctor.ts:417-475`에서 read-only observations를 병렬 수집하고 pure findings/exit를 계산하며, `gitignore.ts:51-52` checker와 `worktree.ts:238-245` porcelain parser를 재사용한다.

`run_test.sh:20-25,88-93`이 protected canon을 conventional repo `test/`로 투영하고, `:102-137` feature subset와 `:149-185` full regression이 그 투영을 실행한다. 즉 hash manifest의 입력은 canonical `.lsc/crafts/.../test`이고, 테스트 verdict의 실행 입력은 worktree `test/`다. 현재 bytes는 동일하지만 두 트리는 서로 다른 권위/보호 표면이다.

## Recommendation
- `lsc-critic`에 위 매핑을 넘겨 (1) main default registrar 통합 미검증, (2) SKILL prose가 string-only임, (3) run_test 판정이 보호 밖 sync 사본임, (4) `src/craft/hash-manifest.ts`와 `vitest.config.ts`의 owner-list 밖 변경을 각각 독립 항목으로 대조하라.

## Next Steps
- `lsc-critic` 검토로 넘길 준비가 됐다. 구현 수정이나 테스트 실행은 하지 않았다.

## 6. Full lsc-critic report (verbatim)

> 기록: 최초 yield가 provider 장애로 유실됨(null-data, 12m49s 조사 후) — §1.8 표준 idle-recovery 요청으로 전문 재렌더 수신. 아래는 재렌더 전문. critic의 기계 증거는 run-3.log(스폰 시점 최신) 기준이며, 본 감사의 §4 재실행(run-4.log)이 동일 결과를 재확인했다.

**VERDICT: ACCEPT-WITH-RESERVATIONS**

**Overall**: spec AC 12항 전수 Met (기계 증거: test/logs/run-3.log — 48 files/1182 tests green, build+feature 11/11+regression PASS, exit 0). plan 9커밋·ADR D1-D7 구조 일치. lsc_land fail-closed 성질 코드 수준 확인. 적대 클래스 5종 전부 불발. 잔여 reservation은 canon 강제 계약 변경 2건(문서화됨) + 스펙 모델 한계 2건 — 전부 비차단.

### 1. Spec Compliance Matrix (12/12)
| AC | Status | Notes |
|---|---|---|
| AC1 무검증 land 거부 8계열 | Met | validateLandAuditEvidence verdict.ts:214-243 — no-audit-evidence(:217)/no-audit-cycle(:219, Number.isInteger 양필드·비정수 변형 테스트)/cycle-mismatch(:222)/verdict-not-approve(:230, APPROVE 3계열 수용 별도)/stale-run-log(:233, N===threshold 경계+post-threshold FAILING 케이스)/evidence-tamper(:236-238, current-cycle 타 verdict·future-cycle; 부재·이전-cycle WARN 통과 각각 테스트). evidence-mismatch: land.ts Phase R ⑥ 3필드 앵커 per-field 3테스트. approval-required: consume miss 전부 폴딩, no-pending-approval 제거(LAND_REASON_CODES 18종). run-3.log 변형별 ✓ |
| AC2 production 경로 | Met | ask.ts:634-668 prepared branch(exact question+prepareId 전후 유지+identity), recordReleaseApprovalAt persist-before-install(state.ts:424-440). 테스트: fresh-session 발급→approved sourceOID merge --no-ff+remove+prune ✓, replay ✓, wrong-target O2 왕복 ✓, P7 write-failure 미설치 ✓, await-race T10 ✓ |
| AC3 실패 경로 | Met | verifyPostRecovery(branch/OID/clean — abort exit 아님)로 merge-aborted/merge-recovery-failed 구분, "원복"은 merge-aborted에만; target-dirty `??` 제외(Phase R ⑤); source drift에도 approved sourceOID merge; merged-but-not-cleaned force-clean-only 재승인 안내; cleaned-but-not-pruned/validation-reject(removeWorktree 미호출 단언)는 LandEffects port 주입; locked("even one --force cannot")·main-repo symlink·unregistered 각 ✓ |
| AC4 거부 매트릭스+음성 | Met | evaluateRemovalTarget(worktree.ts): empty/nul/`.` `..` `~`/symlink/fs-root/home/outside-roots/main-repo OMC 순서 보존; "does NOT check dirty/locked/submodule" 음성 테스트 실재. 18 tests green |
| AC5 scaffold 결정성 | Met | scaffold.ts:61-89 validate-before-effect(slug→이중 realpath containment→.gitignore exact-path symlink 거부), 효과는 ensureWorktreesGitignored/addWorktree/mkdirSync(craftDir) 재사용만. no-op 내용 대조+traversal 2+symlink 2+TS seam 경유+branch pass-through ✓ |
| AC6 스킬 co-evolution | Met | skill-contract-deferred-pool.test.ts 14 tests: Stage 0 lsc_scaffold+branch, bash 시퀀스 부재, §0 예외, D-3 절 문구 전수(tautology 스모크·baseline-green delta·atomic revert·D-3: N/A·제약 12) ✓ |
| AC7 doctor 표·exit·read-only | Met | computeExit(FAIL≥1→1, WARN/UNKNOWN-only→0); DoctorPorts 무 write + byte-for-byte unchanged 테스트; throwing check 격리·hung→UNKNOWN(timeout); lsc_doctor isError 관계 불변식+실 FAIL; 커맨드 표+exitCode 표기 ✓ |
| AC8 8검사 정확성 | Met | DOCTOR_CHECK_IDS 8종(doctor.ts:142-151, R0=skill-path-drift). 조작 fixture 23건: dist-drift FAIL/BUILD_INFO-stale PASS, plugin UNKNOWN/FAIL, frontmatter 필수·선택 스키마·README WARN(물리 9종 SSOT), models FAIL, orphan prunable reason, stale craft-state 3조건 각각, gitignore FAIL, R0 drift FAIL ✓ |
| AC9 stateVersion reader 2종 | Met | decodeCraftState(state.ts:180-196 — 경로·발견 버전·상한 포함 throw); loadActiveCraft(:273-275)·readPersistedCraftState(:447-449) 모두 decoder 경유. reader별 {각인/신버전 에러/부재 관용} 3케이스 각각 + 전 durable mutator 각인(M6) ✓ |
| AC10 E seam 회귀 무수정 | Met | craft-state.test.ts·craft-verdict.test.ts diff 부재(무수정)+green(37·41). craftStateCandidates descriptor-only(state.ts:455-470, "NEVER reads" 테스트), resolveAuditRoot rootExists만(verdict.ts:168-171), malformed state decode-비의존 회귀+both-root open-release ✓ |
| AC11 평가기+lsc_claims | Met | evaluateLedger ledger.ts:85-144 사다리 6단+tombstone 3테스트("blocks revival, not death" 포함); claims-tool.ts slug/NUL 사전 거부·worktree 고정+registered·target/parent symlink·containment·all-or-nothing 0-byte·exactly-once port+기본 atomic rename 검증; 정본-projection 산문 ✓ |
| AC12 전수 green | Met | run-3.log npm test 48 files pass(기존 37+신규 11), e2e 4 self-skip, exit 0 |

### 2. Plan 준수/이탈
Step 대응 1:1: 1a=55ef495/1b=2c4018c/2=562614d/3a=79851cf/3b=ba38198/4=aabdff8/5a=10c4a3d/5b=24129d1/6=2175b0f + pre-craft 산출물 5커밋. 추가 2커밋 정당: 5ebef55(canon byte-identical 사본 — cmp 전수 SAME, run_test.sh가 매 실행 덮어쓰므로 판정 비개입, AC12 자기충족용, feature 커밋 이후라 guardrail 10 정합) / 3691d8e(sync→async 스폰+vitest testTimeout 20s·maxWorkers 6 — flake fix, 판정 완화 아님). release.ts diff 공백 = 0 변경 확인. Must-NOT-Have 8항 전 준수. ADR D1-D7 전 일치(D4의 recordAuditCycleBegin marker 원자 clear state.ts:378-381, producer docstring 갱신 verdict.ts:405-411 포함).
침묵 이탈: ① setActiveCraft SetActiveCraftOptions durability 기본 best-effort(state.ts:204-262) — plan 미기재, canon 강제(craft-land-flow.test.ts:1150), 프로덕션 유일 호출자 hash-manifest.ts:311은 strict로 구계약 보존 ② setActiveCraft merge-preserve(state.ts:240-252) — canon 강제(:379-383 same-session land) ③ hash-manifest.ts·vitest.config.ts는 소유 목록 밖이나 ①·3691d8e 귀결.

### 3. 보안 게이트
prepared=non-authoritative(installPreparedOperation은 Map 설치만, consumePendingApproval은 pendingApproval 슬롯만 읽음 — destructive-approval.ts:139-160, 물리 성립) / pending=sole authority(canonical JSON 재귀 key-sort; unscoped [Land] pending은 편측 mismatch로 소비 불가 — 우회 없음) / persist-before-install(ask.ts:653-661, 실패 주입 테스트 확인) / validateLandAuditEvidence는 validateAuditFreshness 미재사용 독립 strict / 우회 경로: main.ts 등록 5종뿐, registerLandTool(pi) 무 effects, merge 실행 코드는 defaultLandEffects 유일, removeWorktree src 호출자 0, evidence 변조는 pending equality mismatch로 fail-closed, approval:"read"는 release.ts:116 기존 관례.

### 4. 적대 클래스 5종
(i) 불발 — run_test.sh:83-91 canon cp-sync 선행, 5ebef55 사본 byte-identical, vitest.config 변경은 완화 불가 방향 / (ii) 불발 — git status clean, 61파일 전수 feature 귀속 / (iii) 불발 — 경계 전수 테스트 실측(N===threshold, 비정수, per-field mismatch, untracked-only 양성, mode scope 결박, 희귀 3종 주입, hung UNKNOWN, tombstone) / (iv) 불발 — 3필드 앵커 대조, 매 호출 디스크 재파생, marker cycle-aware, decode 실패 폴딩 / (v) 불발 — crafts md/json+run-1/2/3.log 주입 패턴 grep 0건.

### 5. Findings
CRITICAL: 없음. MAJOR: 없음.
MINOR: ① setActiveCraft 기본 durability best-effort 전환(state.ts:253-259) — 미래 호출자 fail-open 위험, mitigated: 호출자 1곳+docstring ② merge-preserve로 "재init가 새 audit 강제"하던 우발 성질 소실 — mitigated: canon 명시 승인+cycle별 lsc_audit_begin+[Land] 질문 OID 노출 ③ sourceBranch fallback `lets-craft/${feature}`(detached 시 질문 라벨 부정확 — merge는 OID 결박이라 무결성 무영향) ④ vitest.config.ts가 해시 보호 밖 판정 인프라(향후 exclude류 변경 감사 사각).
What's Missing: stale-run-log가 "threshold 초과 passing 존재"만 요구 — 더 나중 fresh 로그 FAIL이어도 통과(spec 문구 그대로라 위반 아님, 후속 강화 후보) / audit 증거 cycle-결박·commit-비결박(같은 cycle 내 post-audit 커밋 land 가능 — 스펙 모델 고유) / scaffold branch 인자 git ref 검증 위임 명시 테스트 부재 / doctor adaptersRegistered 전역의 미래 진입점 오관찰 가능성.

Justification: THOROUGH 모드 유지(ADVERSARIAL 승격 조건 미충족 — CRITICAL 0·MAJOR 0). Realist check: Minor ②는 MAJOR 후보였으나 canon 계약+다중 게이트로 강등. ACCEPT가 아닌 이유: plan 밖 공유 함수 계약 변경 2건 기록 필요+latest-run-red 간극 후속 추적 가치.

## 7. Non-blocking Considerations (APPROVE-WITH-COMMENT — merge 전 요구 아님)

1. **setActiveCraft 기본 durability = best-effort** (state.ts:253-259): 미래 신규 호출자가 strict를 잊으면 fail-open 소지. 현재 프로덕션 호출자는 hash-manifest.ts:311(strict) 1곳뿐이고 docstring이 계약을 명시. 후속 개선 후보: strict-by-default 재검토 또는 lint 가드.
2. **merge-preserve 도입으로 "재init가 audit 증거를 지운다"는 우발 성질 소실** (state.ts:240-252): canon 테스트가 명시 강제한 계약이며 cycle별 lsc_audit_begin + [Land] 질문의 OID 노출이 방어선. 후속 관측 대상.
3. **sourceBranch fallback `lets-craft/${feature}`** (land.ts:233): detached HEAD worktree에서 [Land] 질문 라벨이 부정확할 수 있음 — merge 자체는 approved sourceOID 결박이라 무결성 무영향.
4. **vitest.config.ts가 해시 보호 밖의 판정 인접 인프라**: 이번 변경(testTimeout·maxWorkers)은 판정 완화가 아니나, 향후 exclude류 변경은 감사 사각 — doctor 검사 후보로 기록.
5. **stale-run-log 의미론**: "threshold 초과 passing 로그 존재"만 요구 — 그보다 나중의 로그가 FAIL이어도 통과(spec AC1 문구 그대로 구현, 위반 아님). latest-run-green 강화는 후속 feature 후보.
6. **audit 증거는 cycle-결박, commit-비결박**: 같은 cycle 내 감사 후 추가 커밋이 land될 수 있음 — 스펙 모델 고유 한계, 후속 강화 후보.
7. **main.ts default export 등록 표면**: 개별 registrar는 fake capture로 기계 검증되나 main.ts 배선 자체는 build/type gate만 경유. 표면이 9줄 순수 배선이라 위험 낮음.

## 8. Proposed Spec/Plan Amendments

**정식 amendment 미제안 (0건).** 후보였던 setActiveCraft 계약 변경 2건(durability options·merge-preserve)은 검토 결과 spec/plan 자체의 결함이 아니라고 판정: spec 제약 10("CraftState 확장 필드 optional + 읽기 관용")과 plan guardrail 5(단일 decoder)는 그대로 준수되고, 해당 계약은 Stage 4 합의를 거친 canon 테스트(craft-land-flow.test.ts:1150 등)가 강제한 것으로 코드 docstring(state.ts:204-231) + plan 원장(plan-3/plan-4) + 본 감사 문서 §2·§7이 durable 기록을 제공한다. spec/plan 편집은 검증된 판정의 무효화(§6.2 verdict invalidation guard)를 대가로 얻는 것이 없어 기각.

## 9. Adversarial Class Matrix (5종 전수 — 트리거 사실 기준)

| # | 클래스 | 판정 | 근거 |
|---|---|---|---|
| 1 | 해시 보호 밖 테스트 판정 로직 | **배제** (완화 조건부) | 판정(assertion) 로직 전체가 canon `.lsc/crafts/deferred-pool/test/` 내부: canon 11파일의 import는 node 내장·vitest·zod·`../src/**` 프로덕션 모듈뿐(메인 세션 grep 전수 — 보호 밖 테스트 헬퍼 import 0건), run_test.sh(자체가 해시 보호 대상):88-93이 매 실행 canon→리포 test/ 덮어쓰기 sync, 현재 사본 byte 동일(diff -rq). 잔여: 실행 위치가 보호 밖 + vitest.config.ts(§7-4) — 판정 로직이 아닌 실행 인프라로 분류 |
| 2 | worktree 잔여물 / base 오염 | **배제** | diff 61파일 전수 feature 귀속(explore name-status 분류: 정본 문서 21 + 보호 테스트 12 + skills 2 + src 14 + sync 사본 11 + vitest.config 1), worktree `git status` clean, base 브랜치 무변경(merge-base 92e5d12 = base tip). worktree 정리는 §7 land 단계 소관(미도래 정상) |
| 3 | spec AC 경계 입력·에러 경로 미구현 | **배제** | 경계 전수 테스트 실측: N===threshold 경계, 비정수 cycle/threshold 변형, 3필드 per-field mismatch, untracked-only 양성(target-dirty 아님), mode scope 결박, 희귀 실패 3종 LandEffects 결정론 주입, hung check→UNKNOWN(timeout), tombstone 단조, all-or-nothing 0-byte — run-4.log green |
| 4 | resume/persisted 상태 vs 실제 불일치 | **배제** | land는 매 호출 디스크 재파생(strict 재검증) + persisted 3필드는 ctx.cwd 앵커 대비 evidence 강등(불일치=isError), marker cycle-aware(future-cycle=tamper), decode 실패는 no-audit-evidence 폴딩. 본 감사 자체 확인: persisted testsPassed=true ↔ 실제 재실행 run-4 green 일치 |
| 5 | 프롬프트 주입 표면 | **배제** | critic이 crafts md/json + run-1/2/3.log에 지시문 위장 패턴 grep 0건; 메인 세션의 trace/spec/plan 정독에서도 지시문 위장 텍스트 미발견. run-4.log는 vitest 출력+SUMMARY만 |

## 10. 처분

- 판정 근거 사슬(§4.2): ① 테스트 재실행 PASS(하드 게이트 통과) ② lsc-critic ACCEPT-WITH-RESERVATIONS + CRITICAL 0/MAJOR 0 → 대응 규칙상 APPROVE-WITH-COMMENT ③ lsc-explore 발견은 severity 상향 불요(전부 critic MINOR와 동일 항목으로 수렴). §1.7 규율에 따라 critic의 verdict 단어를 전사하지 않고 본 감사 4단계 척도로 독립 판정했다.
- **land 자격 (§7.1)**: APPROVE-WITH-COMMENT → 즉시 land-eligible. §7의 [Land] 게이트로 진행하되, 위 §7 고려사항 7건은 비차단 후속으로 사용자에게 보고.
