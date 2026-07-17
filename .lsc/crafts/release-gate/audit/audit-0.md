# Audit — release-gate (cycle 0)

| 항목 | 값 |
|---|---|
| Feature | release-gate — lsc_craft_release 승인 게이트 패키지 (A-1 nonce + A-2 open-release + A-3 상태 토큰화) |
| 날짜 | 2026-07-17 |
| Audit cycle | N=0 (최초 감사, 선행 audit 없음) |
| 모드 | **full** (§2.6 — N=0) |
| 구현 브랜치 / 워크트리 | `feat/release-gate` @ `.lsc/worktrees/release-gate/` (HEAD 4dd7e6a) |
| Base 브랜치 | `feat/lets-craft-v1` (origin/HEAD 탐지 체인 1순위) |
| 사전 점검 | 브랜치명 슬러그 포함 ✓ · `.craft-state.json` testsPassed:true/aborted:false ✓ — §2.4 무질문 통과 |
| 감사 입력 | trace.md/spec.md/plan.md(+plan/plan-1.md) 전문 정독, diff 23파일 +5676/−51 (10커밋), lsc-explore/lsc-critic 병렬 보고, run_test.sh 재실행 |

**AUDIT VERDICT: APPROVE-WITH-COMMENT**

판정 근거 요약 (§4.2 가중 순서): (1) 테스트 재검증 **PASS** (하드 게이트 통과 — 아래 §Test Re-verification). (2) lsc-critic CRITICAL 0 / MAJOR 0 / MINOR 4 — critic의 자체 verdict 어휘는 비표준 척도(`APPROVE-WITH-COMMENT`, 5단계 중 4번째)로 보고되었으나 계약 척도의 `ACCEPT-WITH-RESERVATIONS` 위치에 대응하며, 본 감사는 §1.7에 따라 어휘를 복사하지 않고 위치·발견 심각도로 가중 평가함. (3) lsc-explore의 독립 발견(CS9 커밋 시퀀싱 이탈, 방어심층 커버리지 갭 4건)은 본 감사가 직접 사실 검증했고, 스펙 준수·최종 산출물에 영향이 없어 심각도 승격 사유가 아님 — 비차단 고려사항으로 기록.

---

## 1. Spec Compliance Matrix

전 행의 Status는 본 감사(main session)가 인용 file:line을 **직접 읽고** 확정 (§3.2). 두 에이전트 보고는 교차 근거.

### Acceptance Criteria (spec.md §Acceptance Criteria, R5 사용자 원문)

| Requirement | Status | Notes (직접 검증 증거) |
|---|---|---|
| AC1 무승인 거부 | **Met** | release.ts:60-66 consume 게이트 직독 — `consumePendingApproval` 실패 시 isError, 3사유 공통 앵커 `"requires a fresh user approval"`(releaseRejectionText :27-46). 테스트: craft-release.test.ts 거부 4암, flow 실 execute, 시나리오5 선행 암(:391-393, :424-425) |
| AC2 승인 직후 성공 | **Met** | ask.ts:629-659 (a)-(f) 트랜잭션 직독 — `confirmed===true` 엄격 비교(:644)+identity 재확인(:645)+persist(:654)→install(:655). release.ts:60-78 소비→기록→clear. 시나리오5 :439-442 성공 단언 |
| AC3 일회용 | **Met** | destructive-approval.ts consumePendingApproval — ok 시에만 슬롯 소각(`pendingApproval = undefined` 직후 반환), mismatch는 보존(CS11). flow:314-327 re-init 후 기소비 nonce 재사용 거부 실 execute 확인 |
| AC4 open-release 봉쇄 | **Met** | verify 게이트 hash-manifest.ts:354-359 (root 폴백 :360 **전**, F-11 정위치) + run-tests.ts:206-215 메시지 분기(가드 조건·isError shape 불변) 직독. openReleaseGuidance(state.ts:276-283)에 `lsc_craft_init` 명시. flow:331-347 — 실 execute 2종 거부 + 양 표면 byte-identical guidance 단언 |
| AC5 재베이스라인 복귀 | **Met** | init 트랜잭션 hash-manifest.ts:293-320 직독 — ①previousState(:296)→②previousManifest(:297, saveManifest :299 **전** 선독 — P3 방어)→…→⑥setActiveCraft(:311-320, 증거 승계 :318-319). flow:351-369 실제 변경 파일이 rebaselineDiff에 등장, flow:373-394 verify 복귀 |
| AC6 구버전 관용 | **Met** | CraftState 신규 2필드 전원 optional(state.ts:63,:69) 직독. craft-state.test.ts:247-291 — legacy shape를 3리더 전부 무throw 파싱 + hasOpenRelease false + run_tests legacy 문자열 verbatim(run-tests.ts:213) |
| AC7 무회귀 | **Met (본 감사가 직접 실행)** | run_test.sh 재실행 결과: build PASS / feature 4파일 105 passed / 전수 `npm test` **778 passed, 14 skipped(e2e 자체 skip), 0 failed** / exit 0. 아래 §Test Re-verification |

### Constraints (spec.md §Constraints 1-11)

| Constraint | Status | Notes |
|---|---|---|
| C1 검증자 유보 (소독·tarball 미구현) | **Met** | diff 전량에 해당 로직 0행 (critic grep + 본 감사 diff 정독) |
| C2 권위/증거 분리 | **Met** | destructive-approval.ts 전문 직독 — repo-internal runtime import 0(node:crypto만), module-private 슬롯 비영속. 증거는 state.ts 원장(:63,:69) |
| C3 확장 필드 optional+읽기 관용 | **Met** | state.ts:63,:69 optional; loadActiveCraft shape 무검증 유지(:150) |
| C4 writeFileAtomicSync | **Met** | persist(state.ts:109-113)·saveManifest(hash-manifest.ts:120-123) 직독 |
| C5 enforcement 무변경 | **Met** | diff --name-status 23파일에 enforcement.ts 부재 (본 감사 직접 실행) |
| C6 fixture 동일 경로 발급·소비 | **Met** | 발급이 performConfirm 수렴 **후** 래퍼(ask.ts:637-656) — 채널 무관. flow fixture yes/free-text 양채널 검증 |
| C7 land 예외 조항 | **Met** | 코드가 현행 세션 로드 모듈을 변경하지 않음; plan §3.8 terminal gate 문서화. land 시 운영 체크리스트 필요(§Non-blocking 7) |
| C8 A-2 표면 = verify 1곳 + run_tests 메시지만 | **Met** | 신설 게이트는 hash-manifest.ts:354-359 유일; run-tests.ts 가드 조건 불변, 메시지 분기만(:211-213) — 직독 |
| C9 순수/thin wrapper, 발급=execute 래퍼 | **Met** | performConfirm 무변경, lsc_ask/lsc_select 무변경(diff), 발급 로직은 :629-659 래퍼에만 |
| C10 태그 SSOT·별칭 금지·시나리오5 정규화 | **Met** | DESTRUCTIVE_GATE_TAGS(destructive-approval.ts:24) 단일 정의, legacy `[Release]` 의도적 부재(주석 명시). 시나리오5 `[Canon Amendment]` 정규화(enforcement-rules.test.ts:367-378,:394) 직독 |
| C11 태깅 규약 불변 | **Met** | matchDestructiveGateTag는 prefix **인식**만; SKILL.md 게이트 질문 형식 무변경 (diff 2행 확인) |

### Non-Goals (위반 여부)

| Non-Goal | Status |
|---|---|
| lsc_land 도구 신설 금지 | 미위반 — src에 lsc_land 0건, [Land]는 발급 인프라만 |
| lsc_restore_tests 소비 게이트 금지 | 미위반 — restore 경로 무변경 |
| enforcement tool_call 확장 금지 | 미위반 — enforcement.ts diff 부재 |
| 주입-예시 소독/AUDIT VERDICT 확장 금지 | 미위반 |
| npm tarball 대조 금지 | 미위반 |
| 시간 기반 nonce 만료 금지 | 미위반 — 타이머/시각 비교 0행, 이벤트 실효만 |
| CraftState 스키마 버전 필드 금지 | 미위반 — state.ts:19-71에 version 부재 |
| 정본 문서 라인 소급 수정 금지 | 미위반 — _docs/·.omc/ diff 부재 |

## 2. Plan Compliance Matrix

### Steps 1-6 (plan §3)

| Step | Status | Notes |
|---|---|---|
| 1 권위 코어+태그 SSOT+전이 배선 | **Met** | destructive-approval.ts export 목록이 plan 명세와 정확 일치 (전문 직독). 전이 4지점 invalidate: setActiveCraft :134 / loadActiveCraft :151 / markCraftAborted :201 / clearActiveCraft :208 — 전부 직독 확인 |
| 2 증거 스키마·리더·불변식 | **Met** | 스키마·mutator CS3 순서(persist→대입)·exact-root/open-우선 리더·active-open 불변식(throw :128-133, 미승격 :154) 직독 |
| 3 발급 트랜잭션 (a)-(f) | **Met** | ask.ts:629-659 — 주석 포함 (a)-(f) 순서 계약 그대로. free answer는 `confirmed===null`이라 :644에서 배제 |
| 4 소비 게이트+co-evolution | **Met (코드)** / 커밋 배치는 CS9 행 참조 | release.ts:54-88 — 소비·기록이 getActiveCraft(:55)~clearActiveCraft(:78) 사이, 성공 text/details 불변. RELEASE_CONSUMABLE_TAGS 소비자 소유(:24) |
| 5 open-release 표면 | **Met** | verify 게이트 위치·init ①-⑥ 순서·run_tests 메시지 분기 전부 plan 명세와 일치 (직독) |
| 6 SKILL.md 문구 | **Met** | diff가 정확히 :26/:124 2행, 태깅 규약·불변식 불변. fixtures/sample-ts-cli/answers.json 무변경 |

### Change-Spec / Critic-Fix 항목 (plan §2·§8)

| 항목 | Status | Notes |
|---|---|---|
| CS1 generic 모듈·소비자 allowlist 분리·단방향 import | **Met** | explore 전수 grep + 본 감사 직독: approval←state←{ask,release}, release→hash-manifest 신규 edge 단방향, 순환 없음. 단일 발급자(ask.ts:655)/단일 소비자(release.ts:60) |
| CS2 prepare≠install·persist-before-install | **Met** | createPendingApproval 슬롯 무접촉(직독), ask.ts:654→:655 순서 |
| CS3 invalidate→persist→대입 (보안 관련 전이 4지점) | **Met** | 4지점 전부 직독. recordTestResult의 legacy publish-first 잔존은 plan이 명시 한정한 범위 밖 — 비위반 (관례 이원화는 §Non-blocking 6) |
| CS4 증거 승계·exact-root/open-우선 | **Met** | init 승계(:318-319)·기폐쇄 passthrough(hash-manifest.ts:146)·findPersistedCraftState open-우선(state.ts:258-264) 직독; flow 2차 init 보존 단언 |
| CS5 init 트랜잭션 ①-⑥·persist 실패 fail-closed | **Met** | 순서 직독 일치. flow:448-478 — manifest-완료/state-실패 분리 유도(Date.now 고정+tmp 디렉터리 선점) 후 미공개·open 잔존·verify 계속 거부 |
| CS6 발급 매트릭스 실배선 검증 | **Met** | 캡처된 실등록 execute로 yes/no/free/cancel/무태그/무craft/[Land]/await 중 전이/persist 실패/spread 교체 전 매트릭스 (explore d_coverage 확인) |
| CS7 actual registered execute만 wiring 인정 | **Met** | flow 전체가 mock pi 캡처 execute 실호출 — 본 감사가 flow:331-478 직독으로 확인 |
| CS8 3계층 규율 | **Met** | pure/effectful core/thin wrapper 분리 유지, 테스트가 SDK runtime value 미import |
| **CS9 known-red 구간 제거 (시나리오5 co-evolution을 Step 4와 같은 커밋에)** | **Partial** | **본 감사 직접 검증으로 확정한 이탈**: `git show --name-only e0a0288` = release.ts+단위 2파일만 — enforcement-rules.test.ts **부재**; 시나리오5 live co-evolution은 마지막 docs 커밋 4dd7e6a에 동봉. 결과: e0a0288..bf51487 2커밋 구간에서 `LSC_E2E=1 npm run e2e` 계약이 known-red(구 `[Release]` prefix는 nonce 미발급→승인 release 거부) — CS9가 제거하려던 바로 그 창. **완화**: `npm test` 계층은 전 커밋 green(e2e 자체 skip), e2e는 land 전 1회만 실행하는 계약(plan §7.3)이라 실제 red 실행은 발생하지 않았고, **최종 HEAD의 테스트 계약은 정합**. critic의 CS9 "Met"은 커밋 메시지 추론([INFERENCE] 자기표기)이었고 explore의 사실 기록이 정확 — 본 감사가 직접 판별. 이력은 불변이므로 시정 불가능한 과정 이탈로 기록 (§Non-blocking 1) |
| CS10 land 예외 소유권·terminal gate | **Met (문서)** | plan §3.8 존재 — land 시 main orchestrator 체크리스트 의무 (§Non-blocking 7) |
| CS11 조건부 비소각 | **Met** | consume 직독 — mismatch는 pendingTag 반환+슬롯 보존, ok만 소각. W1 연속 시나리오(mismatch 후 same-tag no 철회) 존재 |
| F-11 verify 삽입 지점·run_tests ctx | **Met** | :354-359(폴백 :360 전), run-tests.ts:203 `_ctx`→`ctx` |
| F-12 identity 필드 동등 비교 | **Met** | sameCraftIdentity 직독 — 양측 undefined fail-closed, 참조 비교 부재 |
| F-13 persist 실패 fail-open 차단 | **Met** | 발급 persist-before-install·소비 nonce 미복원(release.ts:67-68 주석+구현)·init 미공개 — 3경로 전부 테스트 실재 |
| F-14 단일 슬롯 wholesale 교체 | **Met** | recordReleaseApproval/recordOpenRelease 직독 — 전체 교체, stale consumedAt 미잔존 |

## 3. Code Quality & Regression Risk (§3.3 종합)

**수렴 (양 에이전트 독립 확인 — 고신뢰)**:
- import 그래프 단방향·순환 없음 (explore 전수 grep ↔ critic CS1 행)
- 전이 4지점 invalidate 배선 완비 + 외부 경유(abort.ts:27, enforcement.ts:211 session-reset 3종) 전부 도달
- canon assets 5종 ↔ 리포 test/ **byte-identical** (양측 diff -q) — run_test.sh sync가 no-op, land 시 드리프트 없음
- 성공 메시지·details shape 불변, run_tests legacy 문자열 verbatim — 회귀 표면 무손상
- 게이트 우회 경로 탐색 실패 (critic §3 — 태그 prefix 엄격, confirmed===true 엄격, identity fail-closed, persist 실패 3경로 fail-closed, 증거 위조는 거부만 추가 가능한 단방향)

**불일치 (본 감사가 판별)**:
- CS9 커밋 시퀀싱: critic "Met"([INFERENCE] 표기) vs explore "이탈 사실 기록" → **explore가 정확** (커밋 파일 목록 직접 확인). Plan Compliance CS9 = Partial.

**발견 심각도 (critic MINOR 4건 — 본 감사 실물 확인)**:
1. **[MINOR] 혼합 루트 re-init sharp edge** — worktree craft release 후 `worktree:true` 없이 re-init하면 worktree 루트의 open 기록이 닫히지 않아 inactive verify/run_tests가 계속 거부. fail-closed 방향·정상 re-init으로 복구 가능·SKILL.md가 worktree:true 재호출 의무화 — 비차단. guidance에 상태 파일 경로 미표기라 진단 비용 존재.
2. **[MINOR] readPersistedCraftState(state.ts:246-250) 무보호 JSON.parse** — 손상된 `.craft-state.json`이 verify/run_tests/init 3도구를 깔끔한 isError 대신 raw throw로 만듦. fail-closed 방향·loadActiveCraft 선례와 일관·atomic-write가 자기 truncation 방지 — 비차단.
3. **[MINOR] setActiveCraft 불변식 throw(:128-133)가 invalidate(:134)보다 선행** — 거부된 activation이 pending 슬롯 보존. 프로덕션 유일 호출자 init은 항상 closeOpenRelease 산출물을 전달하므로 도달 불가 — 기록용.
4. **[MINOR] destructive-approval.ts:5 주석 오탈자** ("the휘발성") — cosmetic.

**커버리지 갭 (explore 4건 — 전부 AC 관측 계약 밖 방어심층 조합, 미커버 AC 없음)**: [Hash Violation] 래퍼 경유 발급 / open 게이트의 타-feature-active 분기 / manifest 부재 release 관통 / tag-vs-identity 판정 우선순위 미고정.

## 4. Test Re-verification (§3.4)

- 1단계 `lsc_run_tests(release-gate)` → isError "no active craft" (이 세션은 의도적으로 lsc_craft_init 미호출 — 계약상 정상 경로).
- 2단계 bash 폴백: `bash .lsc/crafts/release-gate/test/run_test.sh`, cwd=`.lsc/worktrees/release-gate` (run-tests.ts의 execCwd 선택과 동일).

```
=== SUMMARY: release-gate ===
build (tsc type gate, src/)     : PASS
feature suite (4 files)         : PASS        (105 passed)
AC7 full regression (npm test)  : PASS        (Test Files 31 passed | 4 skipped (35); Tests 778 passed | 14 skipped (792))
scenario-5 e2e (LSC_E2E)        : SKIPPED (set LSC_E2E=1 to run; needs built dist + real omp)
=== RESULT: all run suites passed ===
```

exit 0. 시나리오5 e2e는 LSC_E2E 자체 게이트로 skip — plan §7.3이 land 전 1회 실행(`npm run e2e`, 실 토큰)으로 명시한 최종 검증 단계이며 본 감사의 재검증 범위(기계 검증 계층) 밖. `.craft-state.json`의 `testsPassed:true`와 독립적으로 재확인 완료.

## 5. Full lsc-explore report (verbatim)

```json
{
  "scope": {
    "commits": "6998f72(trace)→a67767d(spec)→bda7058(plan)→097541c(test canon)→ba22dca(Step1)→5707f3c(Step2)→04df484(Step3)→e0a0288(Step4)→bf51487(Step5)→4dd7e6a(Step6) — 10 commits, feat/lets-craft-v1..feat/release-gate, 23 files +5676/-51",
    "worktree_residue": "없음 — `git status --porcelain` 출력 0줄, HEAD=feat/release-gate"
  },
  "file_map": [
    {
      "file": "src/craft/destructive-approval.ts (신규, 145L)",
      "role": "권위 코어: 태그 SSOT + in-process 단일 pending-approval 슬롯",
      "exports": "DESTRUCTIVE_GATE_TAGS :24 · matchDestructiveGateTag :76 · sameCraftIdentity :88 · createPendingApproval :98 · installPendingApproval :114 · consumePendingApproval :125 (tag-mismatch/identity-mismatch 시 슬롯 보존 :131-132, 성공 시만 소각 :133) · invalidatePendingApproval :138 · peekPendingApproval :143 · module-private 슬롯 :69"
    },
    {
      "file": "src/craft/state.ts (M)",
      "role": "durable 증거 원장 + 전이 실효 배선 + 싱글턴-무접촉 리더 2종",
      "exports": "CraftState.releaseApproval?/openRelease? 필드 :63/:70 · ReleaseApprovalEvidence/OpenReleaseDiffSummary/OpenReleaseEvidence 인터페이스 · setActiveCraft :127 (unclosed throw :128→invalidate :134→persist :135→publish :136) · loadActiveCraft :147 (invalidate :151, unclosed 미승격 :154) · markCraftAborted :198 (invalidate :201→persist :202→publish :203) · clearActiveCraft :207 (invalidate :208) · recordReleaseApproval/recordOpenRelease (persist→publish, consumedAt 스탬프) · readPersistedCraftState :246 · findPersistedCraftState :258 (open-우선 :261-262) · hasOpenRelease(type guard) · openReleaseGuidance('lsc_craft_init' 포함) · registerCraftStateResets :293-297"
    },
    {
      "file": "src/ask.ts (M, +32/-1)",
      "role": "발급 트랜잭션 — lsc_confirm execute 래퍼만 개조 (lsc_ask/lsc_select 불변)",
      "exports": "래퍼 :629-659 — (a)tag+craft 캡처 :631-632, (b)무조건 선철회 :635, (c)performConfirm 무변경 :637, (d)confirmed===true+identity 재확인 :640-645, (e)persist→install :654-655, (f)원본 result 반환 :658"
    },
    {
      "file": "src/craft/release.ts (M)",
      "role": "소비 게이트 + open-release 선기록",
      "exports": "RELEASE_CONSUMABLE_TAGS=['[Canon Amendment]'] :25 (소비자 소유) · releaseRejectionText :28-48 (3사유 모두 'requires a fresh user approval' 앵커) · performCraftRelease :54 — consume :60→거부 :64-66→recordOpenRelease(+fingerprint) :69-77→clearActiveCraft :78; 성공 text/details shape 불변; registerTool은 approval:'read' 유지(tier 분류일 뿐)"
    },
    {
      "file": "src/craft/hash-manifest.ts (M, +51/-1)",
      "role": "verify 게이트 + init close 트랜잭션 + 지문/close 헬퍼",
      "exports": "fingerprintManifestFile :126-129 · closeOpenRelease :139-151 (진리표: undefined→undefined :145, 기폐쇄 승계 :146, open→closedAt+kind별 diff :147-150) · init 트랜잭션 :293-320 (previousState :296·previousManifest :297을 saveManifest :299 이전 선독, setActiveCraft :311에 releaseApproval 승계 :318 + closeOpenRelease :319) · verify 게이트 :354-359 (root 폴백 :360 이전, findPersistedCraftState+hasOpenRelease)"
    },
    {
      "file": "src/craft/run-tests.ts (M, +10/-6)",
      "role": "가드 메시지 업그레이드만 — 조건·isError shape 불변(C8)",
      "exports": "_ctx→ctx :203, 가드 :206-215: hasOpenRelease(persisted) ? openReleaseGuidance : 기존 legacy 문자열 verbatim :213"
    },
    {
      "file": "skills/craft/SKILL.md (M, 2줄)",
      "role": "co-evolution 문구 — :26 nonce 강제 1구절, :124 소비/close/diff/거부창 구절. 태깅 규약·불변식 무변경",
      "exports": "-"
    },
    {
      "file": "test/* 5파일 + .lsc/crafts/release-gate/** 11파일",
      "role": "테스트 canon(assets)과 live 사본, pre-craft 산출물(trace/spec/plan/plan-1/open-questions/run_test.sh)",
      "exports": "-"
    }
  ],
  "a_import_graph": {
    "verdict": "plan 주장과 일치 — 단방향, 순환 없음 (전수 grep 검증)",
    "evidence": [
      "destructive-approval.ts: repo-internal runtime import 0 — node:crypto만 (:14). CS1 물리 경계 주장 사실",
      "state.ts → destructive-approval (:17)",
      "ask.ts → destructive-approval (:24) + state (:25)",
      "release.ts → destructive-approval (:14) + hash-manifest (:15) + state (:16) + artifacts/paths (:13) — 신규 edge release→hash-manifest, 역방향 없음",
      "hash-manifest.ts → state (:19 runtime 기존 편승, :20 type-only)",
      "run-tests.ts → state (:15)",
      "destructive-approval의 src 내 유일 importer = ask/release/state 3곳; installPendingApproval 호출 지점 = ask.ts:655 유일, consumePendingApproval 호출 지점 = release.ts:60 유일 (단일 발급자/단일 소비자)"
    ]
  },
  "b_invalidation_wiring": {
    "verdict": "전이 4지점 전부 배선 완료 + 외부 경유 경로 전부 도달",
    "evidence": [
      "setActiveCraft state.ts:134 / loadActiveCraft :151 / markCraftAborted :201 / clearActiveCraft :208",
      "abort.ts:27 (무변경) performCraftAbort→markCraftAborted 경유 실효",
      "enforcement.ts:211 (무변경) registerCraftStateResets→session_switch/branch/shutdown 3종 모두 clearActiveCraft (state.ts:294-296)",
      "main.ts (무변경) 등록 순서: hashManifest(24)→runTests(25)→enforcement(26, 리셋 배선 포함)→ask(27)→abort(28)→release(29) — 전부 동기 등록, 모듈-스코프 싱글턴이라 순서 민감성 없음",
      "ask.ts:635 tagged-prompt 진입 선철회(P8), 재시작 실효 = 슬롯 비영속(destructive-approval.ts:67-69 주석+코드)",
      "recordTestResult는 의도적 미실효 — 동일 identity spread 교체 시 승인 유지가 계약(F-12), destructive-approval.test.ts:597이 고정"
    ],
    "observation": "recordTestResult(state.ts:176-195)만 legacy publish-then-persist 순서 잔존(activeCraft 대입 후 persist). plan CS3는 security-relevant mutation에만 통일을 요구했고 recordTestResult는 보안 필드 무접촉이므로 위반은 아니나, '전이 commit point 통일' 커밋(ba22dca) 이후에도 비통일 지점이 남아있다는 사실 자체는 기록함"
  },
  "c_asset_live_sync": {
    "verdict": "5/5 byte-identical",
    "evidence": "diff -q: craft-release-flow / craft-release / craft-state / destructive-approval / enforcement-rules 전부 IDENTICAL — run_test.sh의 sync 단계는 현재 no-op",
    "run_test_sh": "구조 = 소스루트 검증→npm ci(부재시)→assets sync(cp)→npm run build 타입 게이트(실패해도 계속, 최종 status 반영)→feature 4파일 vitest→**전수 `LSC_E2E= npm test`(AC7, e2e 팽창 강제 차단)**→LSC_E2E=1 조건부 시나리오5→통합 exit. base 33개 .test.ts → head 35개(+2 신규) — W4의 '33파일' 주장 실측 일치. e2e-helpers.ts는 asset 아님(리포 test/ 상주, 무변경) — 주석 서술과 실상 일치"
  },
  "d_coverage": {
    "verdict": "AC1-7 및 명시 요청 경로 전부 커버 — 실기능 갭 없음, 미세 갭 4건",
    "covered_highlights": [
      "ask.ts (a)-(f) 트랜잭션: 캡처된 실등록 execute(captureConfirmExecute, destructive-approval.test.ts:151-163)로 검증 — yes 발급+durable 선커밋(:462-482), same-tag no/free/cancel 선철회 3암(:484-500), await 중 clear/전환 무발급(:502-537), persist 실패 시 슬롯·증거·파일 전부 미설치+throw(:539-552), 무태그/무craft(:554,:570), [Land] 발급(:582), 동일-identity spread 교체 정상 발급(:597-616)",
      "persist 실패 5경로 전부: 발급(:539), recordReleaseApproval(:656), recordOpenRelease 미스탬프(:706), release 시 throw+craft 유지+nonce 미복원(craft-release.test.ts:184-195), init 시 manifest-완료/craft-미공개/open-잔존/verify-계속거부(flow:448-478, Date.now 고정+tmp 디렉터리 선점으로 state write만 결정론 실패)",
      "identity-mismatch: consume 계층(:338)+release 계층(craft-release.test.ts:162)+비교 매트릭스(:223-254)",
      "verify/run_tests open 게이트: 실등록 execute 거부+lsc_craft_init 안내+양 표면 byte-identical guidance(flow:331-347), 복귀(:373-394, inactive-closed verify 성공 :386-388 + legacy run_tests exact 문자열 :390-394), legacy 실가드(:400-415)",
      "init close/승계: 실제 변경 파일이 rebaselineDiff에 등장(flow:351-369, P3 방어), 2차 init 증거 보존(:419-440), closeOpenRelease 진리표 4행(:754-784), active-open 불변식 throw(craft-state:368)/미승격(:353,da:436)/리더 싱글턴 무접촉(:374-386)/open-우선(:397-437)",
      "형식 계약: nonce UUID v4 regex + issuedAt ISO 왕복(:267-268). fixture 동일 경로: W2가 LSC_FIXTURE 채널로 yes(flow:237-239)·free-text(:492-495), W1이 UI 채널 — 양채널 커버(C6)",
      "시나리오5(e2e): [Canon Amendment] 정규화(:378,:394), 무승인 선행 암+'예상된 오류 후 계속' 문구(:391-393), filter로 정확 2건+순서(premature<confirm<approved :417-437), 거부 앵커(:425), earlyExit 불변(:406)",
      "session-reset 3종 실배선 캡처 후 consume 거부(da:409-421), performCraftAbort 경유(:423)"
    ],
    "gaps": [
      "1. [Hash Violation] 태그의 래퍼 경유 발급 미검증 — 순수 matchDestructiveGateTag 3태그 루프(:204-208)만. 발급 코드는 tag-generic이라 위험 미미",
      "2. verify/run_tests open 게이트의 '다른 feature가 active인' 분기(craft && craft.feature !== feature 반쪽) 미검증 — 모든 open-게이트 테스트가 무활성 상태에서 실행(release가 clear하므로). 코드 경로는 동일 findPersistedCraftState(ctx.cwd)",
      "3. manifest 파일 부재 상태의 performCraftRelease 관통(fingerprint undefined 端到端) 미검증 — 순수 fingerprintManifestFile undefined 분기(:794)와 스키마 optional만 커버",
      "4. consumePendingApproval의 tag-vs-identity 판정 우선순위(둘 다 불일치 시 tag-mismatch 보고) 미고정 — 어느 쪽이든 fail-closed라 관측 영향 없음"
    ],
    "gap_assessment": "4건 모두 AC1-7 관측 계약 밖의 방어-심층 조합. AC별 매핑표(plan §4) 기준 미커버 AC 없음"
  },
  "e_out_of_scope": {
    "verdict": "없음",
    "evidence": [
      "name-status 23파일 전부 ∈ {.lsc/crafts/release-gate/**(11, pre-craft 산출물), src 6, skills/craft/SKILL.md, test/ 5} — Contract 목록과 정합",
      "SKILL.md 변경 = 정확히 :26/:124 두 줄 재서술(전문 대조 완료) — plan Step 6 범위 내, 태깅 규약 불변",
      "main.ts/abort.ts/enforcement.ts/fixtures/sample-ts-cli/answers.json/e2e-helpers.ts 전부 무변경 (C5·Step 6 확인 사항 충족)",
      "worktree 무잔여(clean), .craft-state.json은 EXCLUDED_FILES(hash-manifest.ts:58, 기존)로 증거 기록이 해시 위반 미유발"
    ]
  },
  "plan_deviations_factual": [
    "CS9 커밋 시퀀싱 이탈: live test/enforcement-rules.test.ts 시나리오5 co-evolution이 plan §3 Step 4d('소비 게이트와 같은 커밋')가 아닌 마지막 docs 커밋 4dd7e6a에 동봉됨(e0a0288은 release.ts+단위 2파일만). 결과: e0a0288..bf51487 구간(커밋 2개)에서 LSC_E2E=1 e2e 계약이 known-red(구 [Release] prefix는 nonce 미발급→2차 release 거부) — CS9가 제거하려던 바로 그 창. npm test 계층은 전 커밋 green 유지(e2e self-skip)이며 최종 HEAD에서는 정합. 판단은 critic 몫, 사실만 기록",
    "live 테스트 동기화 커밋 배치: craft-state.test.ts=5707f3c(Step2), destructive-approval+craft-release=e0a0288(Step4), craft-release-flow=bf51487(Step5) — 각 파일이 필요로 하는 마지막 소스와 동일 커밋에 동봉되어 npm test per-commit green은 성립하는 배치"
  ]
}
```

## 6. Full lsc-critic report (verbatim)

> 주의(§1.7): 아래 문서 내 `**VERDICT: ...**` 라인은 lsc-critic의 **에이전트 자체 척도**이며, 본 감사의 판정 라인은 문서 상단의 `**AUDIT VERDICT: ...**` 하나뿐이다. critic이 보고한 척도 어휘(REJECT/MAJOR-REVISION/APPROVE-WITH-CHANGE/APPROVE-WITH-COMMENT/APPROVE)는 계약 척도(REJECT/REVISE/APPROVE-WITH-CHANGE/ACCEPT-WITH-RESERVATIONS/ACCEPT)와 다른 비표준 표기다 — 위치(5단계 중 4번째)로 대응시켜 가중 평가했다.

# 적대적 감사 — release-gate (post-craft cycle 0, full mode)

**VERDICT: APPROVE-WITH-COMMENT** (5단계 척도: REJECT / MAJOR-REVISION / APPROVE-WITH-CHANGE / APPROVE-WITH-COMMENT / APPROVE)

검토 범위: `git -C {worktreeAbs} diff feat/lets-craft-v1...feat/release-gate` 전량(23파일) + 변경 소스/테스트 전 파일 직독 + spec.md/plan.md 전문. 게이트 우회 경로 탐색에 실패했고(아래 §3), CRITICAL/MAJOR 0건, MINOR 4건. 모든 canon test asset(5종)이 리포 test/와 바이트 동일(diff -q 확인)이며 canon(run_test.sh)은 AC7 전수 `npm test`를 포함한다. 단, AC7의 **실행** 판정은 본 감사 범위 밖(main session의 run_test.sh 몫)이므로 구조적 충족만 확인했다.

---

## CRITICAL 발견

없음.

## MAJOR 발견

없음.

## MINOR 발견

1. **[MINOR] 혼합 루트 re-init의 운영 sharp edge** — `hash-manifest.ts:269,296`: init은 `root = worktreeRoot ?? ctx.cwd`에서 previousState를 exact-root로 선독한다(CS4 준수). worktree craft가 release된 뒤(persist는 `state.worktreeRoot ?? projectRoot` — `state.ts:110-112` → worktree 루트에 unclosed openRelease 잔존) **worktree:true 없이** re-init하면 ctx.cwd 루트만 읽어 worktree의 open 기록이 영원히 닫히지 않는다. 활성 중엔 verify 게이트가 inactive 전용(`hash-manifest.ts:354`)이라 통과하지만, clearActiveCraft 후엔 `findPersistedCraftState`의 open-우선 규칙(`state.ts:258-264`)이 stale open을 집어 verify/run_tests를 계속 거부한다. 방향은 fail-closed(우회 불가·가짜 통과 없음)이고 SKILL.md:124가 `worktree: true` re-call을 의무화하며 올바른 re-init으로 복구 가능 — 그래서 MINOR. plan 위반은 아니나(CS4가 exact-root를 명령) 에러 메시지가 이 원인을 짚어주지 못한다.
2. **[MINOR] 신규 프로덕션 리더의 무보호 JSON.parse** — `state.ts:246-250` `readPersistedCraftState`가 try/catch 없이 JSON.parse하며, 이제 verify(`hash-manifest.ts:355`)/run_tests(`run-tests.ts:210`)/init(`hash-manifest.ts:296`) 실행 경로에서 프로덕션으로 돈다(기존엔 이 파일을 읽는 프로덕션 호출자 0 — loadActiveCraft 호출자 grep 결과 주석뿐). 손상된 `.craft-state.json`(외부 truncate·수동 편집)은 이 3개 도구를 깔끔한 isError 대신 raw throw로 만든다. fail-closed 방향 + loadActiveCraft 선례와 일관 + atomic-write가 자기-truncation을 방지하므로 MINOR. C3의 '읽기 관용'은 필드 부재 관용이지 malformed-JSON 관용이 아니라는 해석은 선례와 정합.
3. **[MINOR] setActiveCraft 불변식 throw가 invalidate보다 선행** — `state.ts:128-134`: unclosed openRelease 거부 throw(:129)가 `invalidatePendingApproval()`(:134) 앞에 있어, 거부된 activation은 pending 슬롯을 보존한다. '실패한 전이는 전이가 아니다'로 방어 가능하고 프로덕션에서 도달 불가(유일 호출자 init은 항상 `closeOpenRelease` 산출물을 넘김 — `hash-manifest.ts:319`, closeOpenRelease는 open 입력에 항상 closedAt을 스탬프 `hash-manifest.ts:144-151`). plan은 순서를 미규정 — 기록용.
4. **[MINOR] 주석 오탈자** — `destructive-approval.ts:5` "so the휘발성 권위 can never be" (공백 누락, 문장 중간 한/영 혼용). 코드 무영향, cosmetic.

---

## 1. Spec 준수 매트릭스

### Acceptance Criteria (spec.md §Acceptance Criteria)

| Requirement | Status | Notes (file:line 증거) |
|---|---|---|
| AC1 무승인 거부 | **Met** | release.ts:60-65 consume 게이트, 거부 텍스트 releaseRejectionText(release.ts:29-47). 테스트: craft-release.test.ts:115(단위), craft-release-flow.test.ts:248(실 execute), enforcement-rules.test.ts:413-425(e2e arm, isError+`requires a fresh user approval` anchor) |
| AC2 승인 직후 성공 | **Met** | ask.ts:640-655 발급 → release.ts:60-78 소비. flow:265(confirm yes→durable commit(파일 재독 nonce 일치)→release 체인), scenario5 :439-442 |
| AC3 일회용 | **Met** | destructive-approval.ts:133(ok시에만 소각). craft-release.test.ts:129(기소비 재시도), flow:314(re-init 후 fresh confirm 없는 release 거부 — setActiveCraft:134 invalidate 경유) |
| AC4 open-release 봉쇄 | **Met** | verify 신설 게이트 hash-manifest.ts:351-359, run_tests 메시지 업그레이드 run-tests.ts:206-214, 안내문 `lsc_craft_init` 포함 state.ts:276-281. flow:331-347이 실 execute 2종 거부 + **byte-identical guidance**(textOf(verify)===textOf(run)) 단언 |
| AC5 재베이스라인 복귀 | **Met** | init 트랜잭션 hash-manifest.ts:293-320(old manifest 선독 → close+diff). flow:351-369(rebaselineDiff에 실제 modified/added 파일), flow:373-394(verify 성공 복귀 + inactive/closed 오판 없음) |
| AC6 구버전 관용 | **Met** | 신규 필드 전원 optional(state.ts:59-71). craft-state.test.ts:247-291(legacy shape 3리더 관용 + hasOpenRelease false), flow:400-415(실 도구 경유 legacy 문자열 verbatim) |
| AC7 무회귀 | **Met [INFERENCE: 실행은 main session 몫]** | run_test.sh:85-89 전수 `npm test`(LSC_E2E 강제 unset). 성공 text/details 완전 불변(release.ts:79-87 = craft-release.test.ts:73-80 exact toEqual). 커밋별 green 주장은 커밋 메시지 verify: 필드 근거(e.g. e0a0288 "66 passed") — 본 감사에서 재실행하지 않음 |

### Constraints (spec.md §Constraints 1-11)

| Requirement | Status | Notes |
|---|---|---|
| C1 검증자 유보(소독·tarball 미구현) | **Met** | diff 전량에 소독/대조 로직 0행. 질문 원문은 증거로만 기록(state.ts:75-83) |
| C2 권위/증거 분리 | **Met** | 권위=module-private 슬롯 destructive-approval.ts:69(repo-internal runtime import 0 — :14 node:crypto뿐), 증거=state.ts 원장(:59-71). 슬롯은 어디에도 직렬화되지 않음 |
| C3 확장 필드 optional+관용 | **Met** | state.ts:64(releaseApproval?), :70(openRelease?); loadActiveCraft shape 무검증 유지(:150) |
| C4 writeFileAtomicSync | **Met** | persist 불변(state.ts:110-113), saveManifest 불변(hash-manifest.ts:120-123) |
| C5 enforcement 무변경 | **Met** | diff --name-status 23파일에 enforcement.ts 부재 |
| C6 fixture 동일 경로 | **Met** | 발급이 performConfirm 수렴 **후** 래퍼에서(ask.ts:637-656) — 채널 무관. flow:482-503(fixture free-answer 미발급+release 거부), armOpenRelease가 fixture yes로 발급(flow:237-242) |
| C7 land 예외 | **Met** | 게이트는 새 dist 로드 후에만 활성(코드가 현행 세션 모듈을 바꾸지 않음); plan §3.8 terminal gate/복구표 문서화. 운영 절차라 코드 검증 대상 아님 |
| C8 A-2 표면 = verify 1곳 + run_tests 메시지만 | **Met** | 신설 게이트는 hash-manifest.ts:354-359 유일. run-tests.ts:206 가드 조건·isError shape 불변, :211-213 메시지 분기만(legacy 문자열 verbatim :213) |
| C9 순수/thin wrapper, 발급=execute 래퍼 | **Met** | performConfirm 무변경(ask.ts:488-528), lsc_ask/lsc_select 무변경(diff), 발급은 execute 래퍼 :629-659에만 |
| C10 태그 SSOT·별칭 금지·시나리오5 정규화 | **Met** | DESTRUCTIVE_GATE_TAGS destructive-approval.ts:22(테스트 :196-197 exact), `[Release]` 별칭 불인정(테스트 :218-220), 시나리오5 정규화(enforcement-rules.test.ts:367-378 fixture rule + :394 프롬프트) |
| C11 태깅 규약 불변 | **Met** | 인식만 수행(prefix 매칭 destructive-approval.ts:76-79), SKILL.md:122 게이트 질문 형식 불변 |

### Non-Goals (위반 여부)

| Non-Goal | Status | Notes |
|---|---|---|
| lsc_land 도구 신설 금지 | **미위반(Met)** | `git grep lsc_land -- src/` 0건. [Land]는 발급 인프라만(SSOT :22, W1 테스트 :582) |
| lsc_restore_tests 소비 게이트 금지 | **미위반(Met)** | restore 도구 diff 무변경(hash-manifest.ts:385-431 컨텍스트 그대로) |
| enforcement tool_call 확장 금지 | **미위반(Met)** | enforcement.ts 미변경 |
| 주입-예시 소독/AUDIT VERDICT 확장 금지 | **미위반(Met)** | 해당 코드 0행 |
| npm tarball 대조 금지 | **미위반(Met)** | 해당 코드 0행 |
| 시간 기반 nonce 만료 금지 | **미위반(Met)** | destructive-approval.ts에 타이머/시각 비교 0행 — 이벤트 실효만 |
| CraftState 스키마 버전 필드 금지 | **미위반(Met)** | state.ts:19-71에 version 필드 없음 |
| 정본 문서 라인 소급 수정 금지 | **미위반(Met)** | _docs/·.omc/ diff에 부재 |

---

## 2. Plan 준수 매트릭스

### Steps 1-6 (plan §3) — 커밋 시퀀스도 plan §3.7과 1:1 (ba22dca→5707f3c→04df484→e0a0288→bf51487→4dd7e6a)

| Step | Status | Notes |
|---|---|---|
| 1 권위 코어+전이 배선 | **Met** | destructive-approval.ts가 plan §3 Step 1 export 목록과 **정확히 일치**(SSOT :22, identity :30-35, record :38-58, ConsumeApprovalResult :59-62, match :76, same :88, create :98, install :114, consume :125, invalidate :138, peek :143). 전이 4지점 CS3: setActiveCraft :134-136, loadActiveCraft :150-155(local parse→invalidate→조건부 대입), markCraftAborted :200-203, clearActiveCraft :208-209 |
| 2 증거 스키마·리더·불변식 | **Met** | 스키마 state.ts:74-105(plan 필드와 동일), mutator :217-236(CS3 순서), readPersistedCraftState :246-250(exact-root), findPersistedCraftState :258-264(open 우선→worktree 우선), hasOpenRelease :267-269, guidance :276-283(`lsc_craft_init` 포함). active-open 불변식: setActiveCraft throw :128-133, loadActiveCraft 미승격 :154 |
| 3 발급 트랜잭션 (a)-(f) | **Met — 순서 계약 정확 일치** | ask.ts:631(a tag match)·:632(a craft 캡처)·:635(b 무조건 선철회, await 전)·:637(c performConfirm)·:640-645(d `!isError && confirmed===true && sameCraftIdentity` — confirmed===null인 free answer 배제, ask.ts:106/:503-504/:524 확인; cancel은 isError :515로 배제)·:647-655(e persist→install)·:658(f 원본 result 반환). performConfirm 무변경 |
| 4 소비 게이트+co-evolution | **Met** | release.ts:60-78 — 소비검증·증거기록이 getActiveCraft(:55)와 clearActiveCraft(:78) **사이**, persist가 clear **전**. RELEASE_CONSUMABLE_TAGS 소비자 소유 :26. 거부 4암+persist실패암(craft-release.test.ts:115-196). 시나리오5 co-evolution: filter로 정확 2건(:417-418), premature isError+anchor(:424-425), confirm이 두 release 사이(:433-437), 기존 성공 단언 보존(:441-442), earlyExit 불변(:406) |
| 5 open-release 표면 | **Met** | verify 게이트 :354-359가 getActiveCraft(:350)와 root 폴백(:360) 사이(F-11 정위치), inactive-only 조건 plan과 동일. init ①previousState(:296)→②previousManifest(:297)→③compute(:298)→④save(:299)→⑤snapshots+gitignore(:300-305)→⑥setActiveCraft(:311-320) — **CS5 순서 정확 일치**, 증거 승계 :318-319. run_tests `_ctx`→`ctx`(:203) + 메시지 분기(:206-214) |
| 6 SKILL.md 문구 | **Met** | :26 "platform now *enforces*… mints a single-use nonce… a call with no approval in flight, or a reused/stale one, is refused with isError"; :124 nonce 소비 구절 + open-release close/old→new diff 구절 + "release-to-re-init window에서 verify/run_tests 거부" 구절 전부 존재. :126 불변. fixtures/sample-ts-cli/answers.json diff 부재(불변 확인) |

### Change-Spec CS1-CS11 / F-11~F-14 (plan §2/§8 ADR)

| 항목 | Status | Notes |
|---|---|---|
| CS1 generic 모듈·소비자 allowlist 분리 | **Met** | destructive-approval.ts repo-internal runtime import 0(:14), RELEASE_CONSUMABLE_TAGS는 release.ts:26 소유(테스트 :200-202 exact). import 그래프 단방향(approval←state←{ask,release,hash-manifest,run-tests}; release→hash-manifest 신규 edge, 순환 없음) |
| CS2 prepare≠install, persist-before-install | **Met** | createPendingApproval 슬롯 무접촉(:98-111, 테스트 :259-269), ask.ts:654(persist)→:655(install) |
| CS3 invalidate→persist→대입 (4전이 전부) | **Met** | 위 Step 1 행 참조. 증거 mutator도 persist→대입(:220-221, :234-235). ※recordTestResult(:177-193)는 legacy publish-first 잔존 — plan이 4전이로 명시 한정했으므로 **비위반**, 다만 관례 이원화(Notes 참조) |
| CS4 증거 승계·exact-root/open-우선 리더 | **Met** | init 승계 :318-319, 기폐쇄 passthrough hash-manifest.ts:146, flow:419-440(2차 init 후 consumedAt·closedAt·원본 diff 생존), craft-state.test.ts:397-440(open-우선 3케이스) |
| CS5 init 트랜잭션 ①-⑥+persist 실패 fail-closed | **Met** | 순서 정확(위). flow:448-478 — manifest 저장 완료+state write만 실패 유도(Date.now 고정+tmp 경로 디렉터리 선점) → init 실패·미공개·open 잔존·verify 계속 거부 |
| CS6 발급 매트릭스 실배선 검증 | **Met** | W1 §issuance transaction — 캡처된 실 execute로 yes발급/no·free·cancel 3암 철회(:484-500)/무태그·무craft/[Land]발급/await 중 craft 전이 2암/spread-replace 발급/persist 실패 미설치(:539) |
| CS7 actual registered execute만 wiring 인정 | **Met** | flow 전체가 mock pi 캡처 execute 직접 호출(buildTools :135-160, callTool :191-200); release도 등록 execute 경유(:241), legacy 문자열도 실 도구 경유(:400-415) |
| CS8 3계층 규율 | **Met** | pure(match/same/close/guidance/hasOpenRelease)·effectful core(슬롯·persist·리더)·thin wrapper 분리 그대로; 테스트가 SDK runtime value 미import(flow:28 type-only) |
| CS9 known-red 구간 제거·시나리오5 단일 run·filter 단언 | **Met** | canon 선커밋(097541c) 후 Step 4 커밋이 repo 테스트 동봉(커밋 메시지 명시 [INFERENCE: 커밋별 suite green은 메시지 verify: 필드 근거]). 프롬프트에 "예상된 오류다…계속 진행하라"(:393) |
| CS10 land 예외 소유권·terminal gate | **Met(문서)** | plan §3.8 존재; 코드 검증 대상 아님 — main session 체크리스트 몫 |
| CS11 조건부 비소각 | **Met** | consume :125-134 — mismatch는 pendingTag 반환+슬롯 보존, ok만 소각(:133). W1 :318-344(tag-mismatch 보존, **mismatch 후 same-tag no 철회 연속 시나리오**, identity-mismatch 보존) |
| F-11 verify 삽입 지점·run_tests ctx | **Met** | :354-359(폴백 :360 전), run-tests.ts:203 |
| F-12 필드 동등 비교 | **Met** | :88-91, undefined 양측 fail-closed(테스트 :250), spread 사본 true(:224), await 중 spread-replace 발급 유지(:597) |
| F-13 persist 실패 fail-open 차단 | **Met** | 발급(e) persist-before-install, release 소비 미복원(release.ts:67-68 주석+구현), init 미공개. W1 :539/:656/:706 + W2 :448 |
| F-14 단일 슬롯 wholesale 교체 | **Met** | recordReleaseApproval :219(전체 교체 — stale consumedAt 미잔존, 테스트 :642-654), recordOpenRelease :233(openRelease 교체) |

---

## 3. 게이트 자체 보안 리뷰 (우회 시도 결과: 우회 경로 발견 실패)

1. **태그 매칭**: `question.startsWith(tag)`(destructive-approval.ts:77-78) — prefix 정확 매칭이며 substring 아님. 무괄호·중간 출현·legacy `[Release]` 전부 불인정(테스트 :210-220). 참고: 태그 뒤 구분자(공백)를 요구하지 않아 `[Land]xyz…`도 매칭되지만, 태그 집합이 닫혀 있고 발급엔 여전히 플랫폼 yes+active craft가 필요해 권한 확대가 아니다.
2. **confirmed===true 엄격성**: ask.ts:644 strict equality. free answer는 confirmed===null(ask.ts:106; fixture :504, UI :524) → 미발급. cancel/headless는 isError(:515/:494) → :643에서 배제. envelope 텍스트 오인 경로 없음(details boolean만 판정).
3. **identity 비교**: 필드 동등(:88-91), 양측 undefined 시 false(fail-closed). worktreeRoot는 `undefined === undefined`만 동등 — 올바름. 참조 비교 부재(recordTestResult spread-replace에도 발급 유지, W1 :597).
4. **슬롯 소각 의미론**: ok에서만 소각(:133). **mismatch 보존이 '잘못된 소비자'에게 누수되는가 → 아니오**: 현 코드베이스의 소비자는 release 유일. 보존된 슬롯은 same-tag(RELEASE_CONSUMABLE_TAGS)+same-identity에서만 소비 가능하고, identity가 바뀌는 모든 경로(set/load/clear/abort/세션 3이벤트)가 invalidate를 경유하며(state.ts:134/:151/:201/:208 + registerCraftStateResets가 clearActiveCraft 경유), 새 tagged prompt가 결과 무관 선철회(ask.ts:635). 남는 소비 경로 = 발급받은 그 craft의 정당한 release뿐.
5. **persist 실패 fail-closed 3경로**: 발급 — recordReleaseApproval throw 시 install 미도달, 슬롯은 (b)에서 이미 공백(ask.ts:635,652-655; W1 :539). 소비 — recordOpenRelease throw 시 clearActiveCraft 미도달·nonce 미복원(release.ts:69-78; 단위 :184, W1 :706). init — setActiveCraft persist throw 시 미공개·open 잔존·verify 계속 거부(hash-manifest.ts:311-320; W2 :448-478, manifest-완료/state-실패 분리 유도까지 검증).
6. **verify 게이트 배치**: getActiveCraft(:350)와 ctx.cwd 폴백(:360) 사이, inactive/타feature 조건(:354)만 — F-11 정위치. active 경로 안전성은 active-open 불변식이 담보: setActiveCraft가 unclosed를 throw(:128-133)하고, release 내부의 recordOpenRelease(unclosed 대입)→clearActiveCraft는 await 없는 인접 2행(release.ts:69-78)이라 tool boundary에서 active+unclosed 공존 불가.
7. **loadActiveCraft 미승격**: :154 — unclosed면 record 반환·싱글턴 무접촉. 프로덕션 호출자 0(grep: 주석 참조뿐) — run_tests의 `!craft` 가드가 open 창에서 그대로 fail-closed.
8. **증거 위조 표면(R1 악화 여부 → 악화 없음)**: `.craft-state.json`은 여전히 EXCLUDED(hash-manifest.ts:58, diff 무변경). 신규 표면(findPersistedCraftState 기반 게이트)은 **거부만 추가할 수 있고 허가를 추가할 수 없는** 단방향: 파일 위조→스푸리어스 거부(fail-closed DoS, init으로 복구), 파일 삭제→기존 폴백 복귀(= 기수용 R1, 이 feature 이전과 동일 수준). 소비 권위는 메모리 전용이라 파일 조작으로 release 게이트 자체는 불변. 오히려 manifestFingerprint(release.ts:76)와 rebaselineDiff가 조작 탐지 증거를 **추가**한다(old manifest 삭제 시 diff 생략 자체가 감사 red flag, plan §5b 명시).

## 4. 회귀 위험

- **release 성공 text/details**: byte-불변(release.ts:79-87) — craft-release.test.ts:73-80의 exact `toEqual` 계약 유지. details에 nonce/tag 미노출(ADR 기각 항목 준수).
- **run_tests legacy 문자열**: verbatim 보존(run-tests.ts:213), 실 도구 경유로 2회 단언(flow:392-394, :412-415). 가드 조건·isError shape 불변.
- **setActiveCraft persist-순서 역전의 가시 효과**: persist throw 시 이전엔 publish 후 throw(유령 활성), 이제 미공개 — 실패 경로에서만 관측되는 안전한 방향의 변화. 신규 throw 표면(active-open 불변식)은 프로덕션 유일 호출자 init에서 도달 불가.
- **verify/run_tests 신규 파일 읽기**: 증거 없는 feature/legacy 파일에선 완전 기존 동작(AC6 검증); 추가 비용은 가드 실패 경로의 파일 stat/read 2회뿐.
- **run_test.sh의 리포 테스트 덮어쓰기**: canon assets 5종이 리포 test/와 현재 바이트 동일(diff -q 확인) — sync가 no-op이라 land 시 드리프트 없음.
- **ask.ts가 craft 계층 최초 import**: ADR 예고대로 단방향 edge — vitest import 가능성 유지(W1이 registerAskTools를 vitest에서 실 import·실행함이 그 증명).

## 5. What's Missing

spec/plan이 **요구**하는 것 중 부재한 항목: **없음**. 재량으로 명시된 미구현 2건만 확인:
- 시나리오5 open-window verify/run_tests e2e 암 — plan Step 4d "(선택 보강, 같은 재량)". 필수 방어선인 W2-2(flow:331-347)는 존재.
- verify active 경로의 방어적 openRelease 검사 — plan Step 5a "executor 재량". active-open 불변식으로 불필요.
- AC7 **실행** 증거(run_test.sh green)는 본 read-only 감사가 생성하지 않음 — main session 실행 필요.

## 6. Multi-Perspective Notes

- **Security 관점**: 잔존 수용 창 4건은 전부 spec이 명시 수용한 것 — (i) yes와 release 사이 **비태그** confirm/도구 호출은 실효 이벤트가 아님(이벤트 기반 freshness, 시간 만료는 비목표·trace V5); (ii) 질문 산문은 모델이 작성 — 기만적 문구로 사용자 yes를 유도하는 사회공학 표면은 C1 검증자 유보 범위(완화: 질문 verbatim이 durable 증거에 남아 감사 가능); (iii) R1 파일 조작 — 권위 비저장으로 무력화, fingerprint로 탐지 강화; (iv) fixture catch-all yes — 운영자 seam(R2), 모델이 LSC_FIXTURE를 자가 설정할 경로 없음.
- **Architecture 관점**: recordTestResult(state.ts:177-193)만 publish-before-persist 잔존 — plan이 의도적으로 스코프 밖에 뒀으나 commit-point 관례가 파일 내 이원화됨. 후속 정리 후보(비차단). closeOpenRelease가 `OpenReleaseDiffSummary` 타입을 추가 import(plan은 OpenReleaseEvidence만 언급) — type-only, 무해.
- **Testing 관점**: CS5 fail-injection(Date.now 고정+atomic tmp 경로 디렉터리 충돌, flow:455-467)은 manifest 저장과 state 저장을 **분리 유도**해 정확한 commit point를 때린다 — 이 스위트에서 가장 인상적인 부분. 전 스위트가 필드별 단언/실 싱글턴/스냅샷 전무 관례를 유지. UUID v4·ISO 8601 형식 계약도 단언됨(W1 :267-268).
- **Ops 관점**: MINOR-2(혼합 루트 re-init)의 발현 시 사용자가 보는 메시지는 '왜 열려 있는가'만 말하고 '어느 루트의 기록인가'를 말하지 않음 — 후속에서 guidance에 상태 파일 경로를 포함하면 진단 비용이 줄어든다. land는 §3.8 terminal gate 체크리스트(merge→main build exit 0→새 세션)를 main orchestrator가 직접 이행해야 함.

## 결론

구현은 spec AC 7항·Constraints 11항·Non-Goals 8항, plan Steps 1-6·CS1-CS11·F-11~F-14를 **전 항목 충족**하며, 발급(a)-(f)·CS3 4전이·CS5 ①-⑥·CS11 조건부 비소각 같은 순서 계약을 무언의 이탈 없이 그대로 구현했다. 게이트 우회 경로는 발견하지 못했고 모든 실패 경로가 fail-closed다. MINOR 4건은 전부 비차단(cosmetic 1, 도달불가 순서 1, fail-closed 방향의 강건성/운영 edge 2)이므로 **APPROVE-WITH-COMMENT** — 병합 전 수정 불요, 후속 정리 후보로 기록.

*(critic 보고 끝 — 위 verdict는 critic 자체 척도임을 재차 명시)*

## 7. Required Fix

해당 없음 (APPROVE-WITH-CHANGE 아님).

## 8. Rejection Rationale

해당 없음 (REJECT 아님).

## 9. Non-blocking Considerations (APPROVE-WITH-COMMENT 부속 — merge 전제 조건 아님)

1. **CS9 커밋 시퀀싱 이탈 (과정 기록)** — 시나리오5 live co-evolution이 e0a0288(Step 4)이 아닌 4dd7e6a(Step 6)에 동봉되어 e0a0288..bf51487 2커밋 구간의 `LSC_E2E=1` e2e 계약이 known-red였다. 최종 HEAD 정합·`npm test` 전 커밋 green·실 red 실행 0회. 이력 불변으로 시정 불가 — 다음 craft부터 plan의 커밋 동봉 계약을 커밋 전 체크리스트로 확인할 것.
2. **readPersistedCraftState 무보호 JSON.parse** (critic MINOR-2) — try/catch로 감싸 손상 파일을 undefined(→기존 폴백)로 관용하거나 명시 isError로 변환하는 후속 정리 후보. 현재도 fail-closed 방향.
3. **openReleaseGuidance에 상태 파일 경로 미표기** (critic MINOR-1 파생) — 혼합 루트 re-init 시 진단 비용 절감을 위해 guidance에 open 기록의 실제 경로를 포함하는 개선 후보.
4. **setActiveCraft throw-before-invalidate** (critic MINOR-3) — 도달 불가이나 방어적 순서 통일(invalidate 선행) 고려 가능.
5. **destructive-approval.ts:5 주석 오탈자** (critic MINOR-4) — cosmetic.
6. **recordTestResult publish-before-persist 관례 이원화** (양 에이전트 수렴 관찰) — CS3 통일 범위 밖이었으나 후속 정리 후보.
7. **land 시 운영 체크리스트 (plan §3.8 terminal gate — 이 feature의 land 예외 조항)**: merge 성공 → **main root에서 `npm run build` exit 0** → **새 세션 시작** → 그 후에만 다음 craft 허용. merge 성공만으로 완료 보고 금지. 실패 시 plan §3.8-4 복구표 적용. land 전 1회 `npm run e2e`(LSC_E2E=1, 실 토큰) 최종 검증도 plan §7.3의 계약.
8. **방어심층 테스트 후보 4건** (explore 갭): [Hash Violation] 래퍼 경유 발급 / 타-feature-active open 게이트 분기 / manifest 부재 release 관통 / tag-vs-identity 우선순위 고정.

## 10. Proposed Spec/Plan Amendments

**없음.** 감사 발견 중 spec.md/plan.md 자체의 교정을 요구하는 항목 없음 — CS9 이탈은 구현 과정의 이탈이지 plan 결함이 아니고, MINOR 4건은 전부 spec 제약과 정합하는 구현 세부다. (§6.2 게이트 미발동.)

## 11. Adversarial Class Matrix (§4.1-12 — 5개 클래스 전수, trigger fact 기준)

| # | 클래스 | 판정 | 관측/제외 근거 |
|---|---|---|---|
| 1 | 해시 보호 밖 테스트 로직 위임 | **applied** | trigger 실재: canon asset `enforcement-rules.test.ts`가 `./e2e-helpers`(리포 test/ 상주, 보호 트리 **밖**)를 import — toolExecutions 파싱 결과가 시나리오5 expect에 직결. 평가: e2e-helpers는 이 diff에서 **무변경**(name-status 23파일에 부재 — 본 감사 확인), 기존 공용 하네스이며 run_test.sh:13-15가 이 의존을 명시 문서화. 4개 단위/통합 파일의 판정 로직은 전부 canon 내부(+`../src` 프로덕션 import — 필연적 예외). LSC_E2E 게이트라 루프 판정에 미개입. 비차단이나 [Hash Violation]급 변조 표면으로 기록 |
| 2 | Worktree 잔여물 / base 오염 | **excluded** | `git status --porcelain` 0줄(explore), diff 23파일 전부 계약 목록 내(본 감사 name-status 대조), enforcement.ts/main.ts/fixtures 무변경. worktree 정리는 §7 land 시점 작업으로 아직 미도래 |
| 3 | Spec AC 경계 입력 | **applied** | trigger 실재: explore 갭 4건 중 #2(open 게이트의 `craft && craft.feature !== feature` 반쪽 분기 — AC4 표면의 미검증 조합)와 #3(manifest 부재 release 관통 — AC 경계의 optional 지문 경로). 평가: 두 경로 모두 코드상 동일 함수(findPersistedCraftState/fingerprintManifestFile undefined 분기)로 수렴하고 순수 계층 테스트는 존재, fail-closed 방향 — AC 매핑표 기준 미커버 AC 없음(explore 판정, 본 감사 동의). 비차단, §9-8 후속 후보 |
| 4 | 재개 후 상태 정합성 | **applied** | trigger 실재: 재시작/재개 의미론이 이 feature의 설계 대상 자체. 검증됨 — 메모리 슬롯 비영속(재시작 실효), loadActiveCraft unclosed 미승격(state.ts:154), open-우선 리더, durable 증거 재-init 승계(flow 2차 init 단언). 발견된 divergence 형태 1건 = critic MINOR-1(혼합 루트 re-init 시 worktree 루트 stale open 잔존 → verify/run_tests 지속 거부) — fail-closed 방향, 올바른 `worktree:true` re-init으로 복구 가능. 현 worktree의 `.craft-state.json`(testsPassed:true)은 실제 상태와 정합 |
| 5 | Prompt-injection 표면 | **applied** | trigger 실재: 감사 입력에 지시형 텍스트 다수 포함 — 시나리오5 프롬프트(enforcement-rules.test.ts:389-402, LLM 구동용 명령문)·fixture answers 규칙·SKILL.md 인용. 전부 데이터로 취급했고 본 감사 판정에 미개입(판정 라인은 §4.1-2의 `**AUDIT VERDICT:`뿐이며 critic 내장 `**VERDICT:` 라인과 명시 분리 — 6절 주의문). 잔존 표면: confirm 질문 산문은 모델 작성(사회공학 유도 가능) — C1 검증자 유보로 spec이 명시 수용, 질문 verbatim이 durable 증거에 남아 사후 감사 가능(critic Security (ii)) |

---

*감사 종료. 본 문서는 post-craft §8.1에 따라 feat/release-gate 브랜치(워크트리)에 커밋된다.*
