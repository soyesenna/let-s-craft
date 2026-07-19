# Appendix — 확장 테스트 계획 (deferred-pool)

> Stage 4 테스트 작성자가 그대로 집행하는 명세. 공통 관례(trace Lane 5): 비즈니스 mock·스냅샷 전무, 실제 싱글턴 + `mkdtempSync(tmpdir())` fixture, 필드별 단언, beforeEach/afterEach 정리(craft-release.test.ts 양식). **계층 규율(제약 9)**: 순수 판정(평가 함수·게이트 리듀서·평가기·doctor evaluate·computeExit)은 직접 호출하되, **등록·execute 표면은 fake registrar 캡처로 검증**(test/destructive-approval.test.ts captureConfirmExecute 관례 — iteration 1의 "SDK 래퍼는 검증 대상 아님" 교정: production seam이 1급 검증 대상이다). 산문은 skill-contract 문자열 계층(제약 6). **e2e(LSC_E2E)는 비목표** — 절 존재/행 수 검증만, fixture E2E 실동작 확장 금지.

## 계층 1 — unit (순수, `npm test`)

**W1-a `test/artifacts-worktree.test.ts` 확장 (AC4)**
- evaluateRemovalTarget 거부 매트릭스 전수(관찰 fixture 주입 — inspect는 W2 통합에서 실 fs로 검증): 빈 문자열·공백만·NUL 포함·`.`·`..`·`~`·경로 구분자 주입(`a/../b`, 절대 경로 이탈)·심링크 후보(밖→안 / 안→밖 2방향)·realpath containment 밖·파일시스템 루트·홈 디렉터리·메인 리포(.git 디렉터리 보유).
- **음성 확인**: dirty worktree fixture·locked worktree fixture가 검증 함수를 **통과**함을 단언(비검사 계약 — 제약 1). submodule도 동일.
- listWorktrees 파서: 정상 목록·prunable reason 포함 목록·빈 목록의 파싱(porcelain fixture 문자열 직접 주입 — git 실행 불요 케이스 분리).

**W1-b `test/craft-state.test.ts` 확장 (AC9·AC10)**
- stateVersion: **reader 2종(loadActiveCraft·readPersistedCraftState) 각각** — 신규 쓰기 각인 재읽기 / 필드 부재(구버전 fixture) 관용 / `stateVersion: CRAFT_STATE_VERSION + 1` 명시 에러(메시지에 파일 경로·발견 버전·지원 상한 단언). loadActiveCraft의 미지 신버전 **침묵 active 승격 차단**이 핵심 케이스.
- E 정책 보존: 기존 회귀(:481-533 — open cwd가 stale closed worktree를 이김 / 둘 다 closed면 worktree tie-break) **무수정 green** + both-root open-release·neither 케이스 + 후보 seam은 **descriptor-only**(JSON 미독) 확인. 파싱 불가는 소비자별 분리 고정: findPersistedCraftState(decode 소유자)의 정책 케이스 + **malformed `.craft-state.json`이어도 worktree 디렉터리 존재 시 resolveAuditRoot=worktree**(decode 비의존 회귀 — craft-verdict.test.ts).
- 기존 케이스 전수 무손상(회귀 — 수정 없이 green이어야 함).

**W1-c `test/research-ledger.test.ts` 신규 (AC11)**
- 판정 매트릭스: dropCondition 누락→invalid / 반박 1+·생존 지지 0→rejected(사유에 반박 소스 인용) / 증거 0→uncertain / 지지 생존·반박 0→accepted / 반박+지지 혼재의 dropCondition 매칭 케이스.
- **transition/tombstone**: `evaluateLedger(claims, previousDecisions)`에 previous=rejected/invalid를 입력하고 신규 지지 증거를 추가 재평가 → **불부활 단언**(단조 전이 — stateless 평가로는 판정 불가였던 iteration 1 교정).
- 순수성: fs 무접촉(입력은 인메모리 객체만).

**W1-d `test/doctor.test.ts` 신규 — 판정 단위 (AC8)**
- 검사 8종 각각: 조작 관찰 fixture(인메모리 observations — evaluate 순수 직접 호출)에서 올바른 status: ① srcHash 불일치→FAIL(+BUILD_INFO stale이어도 srcHash 일치면 PASS — canonical 확인) ② plugin 실행-중-로드→UNKNOWN ③ frontmatter 필수 필드 결손→FAIL, README 8종 서술 불일치→WARN ④ 깨진 models.yaml→FAIL ⑤ prunable reason별 세분 ⑥ stale craft-state 3조건 각각 ⑦ gitignore 미등록→FAIL(read-only — ports에 쓰기 없음) ⑧ R0 리터럴 변형→FAIL / 본 리포 형상→PASS.
- **hang 격리**: never-resolving observe 스텁 + 주입 타이머(가짜 시계 — 결정론) → 해당 검사 UNKNOWN(timeout), 나머지 완주. runDoctor exitCode: FAIL 1+→1, WARN-only→0, 전 PASS→0, UNKNOWN-only→0.

## 계층 2 — integration (fixture git repo, `npm test`)

**W2-a `test/craft-land.test.ts` 신규 (AC1·2·3)**
- fixture: mkdtemp 실 git repo(base 브랜치+feature 브랜치+worktree 등록) + persisted `.craft-state.json` + audit/ 실파일(audit-N.md·logs/run-N.log 조작).
- **production 발급 경로(AC2)**: fake registrar로 **실 등록 lsc_confirm execute 캡처**(captureConfirmExecute 관례) — fresh-session(active craft 없음): lsc_land 1차 호출→approval-required+prepared envelope 설치 확인(exact approvalQuestion 포함)→캡처된 confirm execute에 `[Land]` 질문(yes)→승인 설치(**persist-before-install**: recordReleaseApprovalAt exact-root persisted evidence 선기록 단언)→lsc_land 재호출→**approved sourceOID의 merge --no-ff 커밋 존재**·worktree 미등록·prune 잔재 0. craft-bound 발급 경로(active craft 존재) 회귀 green. **D3 production 확장(iter2 Change Spec 6항)**: same-session matching active craft 발급 성공 / mismatched active craft 무발급 / A prepare→B replace→A 질문 무발급(exact question+prepareId 결박) / wrong question 무발급 / scope mismatch→현재 envelope replace→fresh question→O2 재승인 왕복 성공 / no·free·cancel 후 prepared clear / session lifecycle(setActiveCraft·abort·session_switch 등) clear / persist(recordReleaseApprovalAt) throw 시 pending·prepared 모두 부재 / 기존 [Canon Amendment] 발급·release 소비 경로 무변경.
- **AC1 전 변형**: audit-N.md 부재(no-audit-evidence) / auditCycle·threshold 부재(**no-audit-cycle** — missing-threshold fail-open 차단) / 타 사이클(cycle-mismatch) / 비-APPROVE verdict(verdict-not-approve) / fresh passing run log 부재(stale-run-log) / marker cycle-aware: current-cycle 다른 verdict·future-cycle(evidence-tamper) + **이전-cycle stale marker+current live success=WARN으로 통과** / nonce 미소비(approval-required) / persisted 3필드 앵커 불일치(evidence-mismatch) → 각각 isError(WARN 케이스 제외) + 사유 코드 구분 단언.
- **wrong-target/replay(AC2 부속)**: 승인 후 projectRoot HEAD 이동(커밋 추가)→scope-mismatch 거부+현재 envelope prepared replace 확인→**fresh question 재승인→O2 성공(왕복)** / 소비 성공 후 재호출→effect 없음+approval-required 또는 이미 clean이면 not-registered(`no-pending-approval` 코드 제거 반영).
- **실패 경로(AC3)** — happy·실 conflict는 실 git 유지, 외부 비결정 희귀 실패만 **좁은 LandEffects port(기본 실 git) 결정론 주입**(동일 production 오케스트레이터 아래): merge conflict fixture→자동 abort 후 **사후 상태 검증(branch/OID/clean) 통과=merge-aborted** + isError 3요소(원복·nonce 소비·재승인) / **abort 사후검증 실패 주입(verifyPostRecovery)→merge-recovery-failed(원복 미보장 명시)** / **target-dirty: tracked 변경 fixture→거부, untracked-only fixture→통과(양성)** / **source ref drift(승인 후 source branch 이동)→approved sourceOID가 merge됨 단언** / dirty→merged-but-not-cleaned(worktree 보존 단언)→mode=force-clean-only 재승인→force 성공 / **prune 실패 주입→cleaned-but-not-pruned(실제 state flags 단언)** / **삭제 직전 inspectRemovalTarget 재검사 실패 주입→validation-reject**(port 경유 실호출·removeWorktree 미호출 단언 — TOCTOU 재검사 배선 증명) / force 승인 없이 force 호출→scope-mismatch / locked·메인 리포·미등록(membership) 각 거부.
- preflight: projectRoot HEAD == feature 브랜치 → self-merge isError.

**W2-b `test/artifacts-scaffold.test.ts` 신규 (AC5)**
- 1회 실행: worktree 등록·브랜치 존재·crafts 디렉터리·gitignore 행 — 각각을 직접 TS 함수(addWorktree 등) 결과와 동등 대조(경유 검증의 행동 동등성 형태).
- 재실행: **내용 대조** 무변경(no-op — mtime 단언 금지, fs 해상도 취약) + 기존 아티팩트(수기 추가 파일) 보존.
- 경계: 허용 capability 2종(worktree 내부·정확히 projectRoot/.gitignore) 밖 쓰기 거부, 심링크 경유 거부, `branch` 인자 전달 시 해당 브랜치로 addWorktree 경유(기본 lets-craft/{feature}), gitignore는 atomic writer 경유.

**W2-c `test/doctor.test.ts` — 통합 파트 (AC7)**
- 실 리포 형상 fixture 전체 실행: 표 출력(검사별 status+증거 인용), **논리 exitCode**(DoctorReport 필드), **진단 전후 디렉터리 해시 대조 무변경**, 격리(1개 검사 예외 주입→해당 Finding만 FAIL/UNKNOWN·나머지 정상·전체 비중단 / never-resolving 주입→UNKNOWN(timeout)·완주). **어댑터 2 캡처**: fake registrar로 registerDoctorCommand handler(표+exitCode 출력)와 lsc_doctor execute(FAIL fixture→isError / clean fixture→정상) 검증.

**W2-d 신규 — registrar 캡처 일괄 (Success Criterion 4)**
- fake registrar로 신규 표면 5종(lsc_land·lsc_scaffold·lsc_claims·lsc_doctor 도구 + lsc-doctor 커맨드) 등록 확인 + 각 execute/handler 스모크. lsc_claims는 **claims-tool.ts wrapper의 registerClaimsTool을 캡처**(ledger.ts는 pure — import 금지): fixture claims.json 재평가→decision write-back(**주입 atomic-write port로 exactly-once — call count 1·path=craftClaimsPath·payload 단언**, 기본값 writeFileAtomicSync)→tombstone 유지(기 rejected에 지지 추가 후 재호출→불부활) + **wrong-root(root는 worktreePath 고정 — project-root artifact 오염 0 단언)/traversal(`..`·경로 구분자·non-kebab slug 거부)/symlink(target·parent 거부)/invalid-one-no-write(1개 invalid→byte 0 변경)** 단언 포함.

## 계층 3 — skill-contract (`test/skill-contract.test.ts` 확장, AC6·11 산문부)

- post-craft: `:228-240` 4단 bash 시퀀스 부재 + **2-phase `lsc_land` 흐름**(approval-required 요약을 `[Land]` 질문에 인용) 지시 존재 + 탈출구 절("도구 결함 시에만 수동 git merge" + `audit/land-manual-escape.md` durable 기록 지시) 존재.
- pre-craft Stage 0: `:84-96` bash 재현 부재 + `lsc_scaffold` 지시 존재.
- pre-craft 리서치 절: "claims.json" 정본 + "SYNTHESIS.md" projection + 역방향 편집 금지 + "비적대·부주의" 하한 프레이밍 + **각 wave 종료 시 lsc_claims 호출 지시** 문구.
- pre-craft §0: 명시 예외("일회성 임시 변이" + "즉시 원자 복구") — "구현 작성 허용" 문구 부재(`not.toContain` 방향).
- pre-craft Stage 4: 브라운필드 한정·단일 변이·"baseline-green"·failure delta·full run 판정 금지·oracle-mirroring 회피·`git diff` 청결·`D-3: N/A`·**"변이 seam 한정 tautology 스모크"** 존재 + "스위트 변별력 검증" 문구 부재.
- 기존 skill-contract 케이스 전수 무손상.

## 계층 4 — observability

- lsc_land isError는 **사유 코드**(no-audit-evidence / no-audit-cycle / cycle-mismatch / verdict-not-approve / stale-run-log / evidence-tamper / evidence-mismatch / approval-required / scope-mismatch / identity-mismatch / self-merge / not-registered / target-dirty / merge-aborted / merge-recovery-failed / merged-but-not-cleaned / cleaned-but-not-pruned / validation-reject — `no-pending-approval` 제거, plan §6 Step 3b 집합과 동기)를 메시지에 포함 — 테스트가 사유를 구분 단언하고, 운영에서 실패 원인·리포 상태(merge 완료 여부·worktree 보존 여부·prune 여부)가 즉시 판독됨.
- doctor Finding.evidence는 판정 근거(대조 경로·발견 값)를 인용 — AC7 표 출력 단언의 대상.
- stateVersion 에러 메시지는 파일 경로·발견 버전·지원 상한 3요소 — 업그레이드 안내로 기능.

## run_test.sh 구성 (Stage 4 산출물 지침)

- 본체: `npm test`(vitest run 전수 — AC12) + `tsc`. AC별 파일은 위 신규/확장 7파일(craft-land·artifacts-worktree·artifacts-scaffold·research-ledger·claims-tool·doctor + craft-state/skill-contract 확장)이 담당.
- e2e 번들은 실행하지 않음(LSC_E2E 전용 — package.json:16, `npm test` 미포함이 기존 계약).
- doctor read-only 검증은 W2-c 내부 단언으로 충족(별도 셸 해시 스크립트 불요).
