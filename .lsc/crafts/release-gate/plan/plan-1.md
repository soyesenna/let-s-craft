# plan-1 — release-gate consensus iteration 1 (AWC 적용 기록)

- 일시: 2026-07-17
- 리뷰 입력: architect `BLOCKING_AWC_EQUIVALENT` (Change Spec CS1~CS11 — blocking 지적 전부에 기계 적용 가능 fix 동봉) · critic `APPROVE-WITH-CHANGE` (blocking C1~C3·M1~M6 전부 CS 매핑 확인, cross-check 6/6 동의, 추가분 F-11~F-14)
- 처리 원칙: 동봉 fix verbatim 적용. 확정 설계 결정 재개방 없음, fix 외 개선 없음. spec.md/trace.md 불변, 코드 무변경.
- critic 예고 수렴 경로: "CS1-11 + F-11~F-14 적용 후 diff-only 재확인으로 ACCEPT 가능."

## 적용 체크리스트 (CS/F → plan.md 반영 위치)

| 항목 | 요지 | plan.md 반영 위치 (섹션 / 행) |
|---|---|---|
| CS1 | `destructive-approval.ts` 개명, `PendingDestructiveApproval`, identity 필드, `RELEASE_CONSUMABLE_TAGS`→release.ts 소유, ADR 채택 사유 = "휘발성 권위의 우발적 직렬화 방지", "회귀 반경" 논거 철회 | §2 Options :48-62 · Step 1 :70-100 · Step 4a :207-210 · §8 Decision :446, Alternatives :451·:455 |
| CS2 | 발급 = `createPendingApproval`(prepare)/`installPendingApproval`(install) 2단계 + confirm execute (a)~(f) 트랜잭션(선철회→await→identity→persist 성공→install), persist throw 시 install 미실행 | Step 1 exports :93-95 · Step 3 전체 :173-203 · §6 R4 :425 |
| CS3 | state mutation commit point 통일: setActiveCraft/markCraftAborted/record* = invalidate·next→persist→대입, clearActiveCraft = invalidate→undefined, loadActiveCraft = local parse→invalidate·unclosed 미승격, setActiveCraft unclosed 직접 activation 거부(active+open 비공존 불변식) | Step 1 :101-109 · Step 2 mutator 주석 :139-141, 불변식 :152-155 |
| CS4 | `readPersistedCraftState` exact-root / inactive lookup open 우선, closeOpenRelease `기폐쇄→동일 closed 승계`, init fresh state가 releaseApproval·closed openRelease 승계, 다음 release가 교체 | Step 2 :142-150·:168-171 · Step 5b :283-288 · §7-4 :439 |
| CS5 | A-2 트랜잭션 순서 고정(①state 선독→②old manifest 선독→③compute→④save→⑤snapshots→⑥closed 증거 persist→active publish), critical section 무await·single-process/single-writer 명시, persist 실패 시 active 미공개·open 잔존→verify/run_tests 계속 거부 | Step 5b :269-290 · §5 P1 :406 |
| CS6 | W1 확장 6암: (a) same-tag no/free/cancel 슬롯 empty (b) deferred confirm 중 clear/set 후 yes 무발급 (c) write 실패 시 증거·슬롯 미설치 (d) fake `pi.on` 세션 3콜백 후 consume 거부 (e) performCraftAbort 후 거부 (f) open persisted 로드 후 getActiveCraft() undefined | §4 W1 :364-366 (실배선 :365, 발급 트랜잭션 :366) |
| CS7 | W2를 actual registered tool execution으로 교체(mock pi로 registerAskTools :541/registerHashManifestTools :385-388/registerRunTestsTool :186 capture), 필수 단언 6종(yes→durable→release / open 중 actual verify·run_tests 거부 / actual init diff+close / verify 복귀 / 2차 init 증거 보존 / persist 실패 시 init 실패·active 미공개), helper 수동 재연 불인정, AC4 integration 필수 | §4 intro :357 · W2 :371-378 · AC표 AC4/AC5 :396-397 · Step 5 검증 :306 |
| CS8 | purity 3분류: pure = match/consume 판정/close/guidance만, 슬롯 mutator·FS reader/writer = SDK-independent effectful core, registerTool = thin wrapper; Driver 2 문구 교체 | §2 P3 :36, D2 :43 · Step 1 :100 · Step 2 주석(effectful/pure 표기) :139-150·:161-166 · §4 intro :357 · §8 Why :459 |
| CS9 | 시나리오5 co-evolution을 Step 4 커밋으로 이동([Canon Amendment] fixture/prompt + 무승인 선행 암 + executions.filter 정확 2건·순서 단언 + "예상된 오류 후 계속" 문구 + 단일 runOmpPrint 유지), known-red window 서술 전부 삭제 | §3 intro :66 · Step 4d :243-246 · Step 6 :309-311 · §3.7 표 :322-331 · §6 구R6 삭제 :428 · §8 Consequences :461 |
| CS10 | land runbook 교체: canonical post-craft는 build 미수행, one-time build는 main orchestrator 소유, terminal gate = merge 성공→main root build exit 0→새 세션→다음 craft 허용, 복구표 4항, P5 "실행 중 세션 reload" 삭제→운영 오류로 교체 | §3.8 :333-353 (terminal gate :341, 복구표 :344-350) · §5 P5 :410 · §7-5 :440 |
| CS11 | tag-mismatch 조건부 비소각 확정: mismatch = isError+pendingTag·슬롯 보존, 단 새 destructive prompt 시작/identity 변화/abort·세션·re-init/persist 실패는 반드시 invalidate(ADR 동일 항목), W1에 mismatch 후 same-tag no 철회 연속 시나리오 | §1 CORE :18 · Step 1 consume 주석 :96 · Step 4b :237 · §4 W1 :362 · §8 Alternatives :456 |
| F-11 | 인용 드리프트 3건 정정: verify 삽입점 getActiveCraft :309·ctx.cwd 폴백 :310(구 :308/:309-310), run-tests `_ctx` :203(구 :204), 기존 스위트 34→**33**파일(실측 glob 확인) | §1 A-2 :15 · §2 P4 :37 · Step 5a :253·:266 · Step 5c :292 · §4 W4 :386, AC표 AC7 :402 |
| F-12 | CS2(d) 참조 비교→feature/projectRoot/worktreeRoot 필드 동등 비교(근거: recordTestResult가 state.ts:117/:126 spread로 객체 교체 — 실측 확인) | Step 1 identity 주석 :86, `sameCraftIdentity` :92 · Step 3 (d) :185-186 · §4 W1 :363 |
| F-13 | pre-mortem P7(persist 실패 경로 fail-open)·P8(stale yes 경로) 추가 | §5 헤더(7 시나리오) :404 · P7 :411 · P8 :412 |
| F-14 | releaseApproval/openRelease 단일 슬롯 덮어쓰기 명시(새 증거가 교체할 때까지 승계) | Step 2 CraftState 주석 :128-130, recordReleaseApproval :139, closeOpenRelease 진리표 :169 · Step 5b :287 · §4 W1 :367 |

## critic blocking → 적용 확인 (C/M → CS 매핑 그대로)

- C1(stale yes) → CS2+F-12 적용 ✓ · C2(persist 실패 capability 잔존) → CS2(e) ✓ · C3(재-init 증거 소거·자기모순) → CS4 ✓
- M1(publish-before-persist) → CS3+CS5 ✓ · M2(active-open 불변식) → CS3+CS6(f) ✓ · M3(W2 수동 시퀀스) → CS7 ✓ · M4(await 경계 귀속) → CS2(a)(d)+F-12 ✓ · M5(known-red 구간) → CS9 ✓ · M6(land 자기모순·복구 부재) → CS10 ✓

## 미적용 항목

없음 (0건).

## open-questions.md 동기화

- 항목 1 (tag-mismatch 보존 vs 소각): CS11로 확정 — 조건부 비소각. 해결 처리.
- 항목 2 (시나리오5 단일 프롬프트 vs 별도 it): CS9로 확정 — 단일 runOmpPrint + "예상된 오류 후 계속" 문구, flake 실관측 시 분리 재량은 W3 유지. 해결 처리.

## 마감 — diff-only 재확인 결과 (동일 iteration)

- critic diff-only 재확인: **VERDICT: PASS** — (1) 항목별 diff↔fix 대조 15/15 미변형 적용·범위 외 변경 없음, (2) file:line 재검증 전수 일치(F-11 정정 3건 포함, HEAD cc17764), (3) 연관 AC 교차 검증 성립(발급↔소비 미러 invariant, 전이 4지점↔W1 실배선, init 트랜잭션↔W2 wiring, C8 패리티 verbatim).
- **합의 성립: iteration 1, AWC path** — architect BLOCKING_AWC_EQUIVALENT + critic APPROVE-WITH-CHANGE → fix 전량 적용 → diff-only PASS. critic 예고 수렴 경로(ACCEPT) 충족. 재확인은 신규 iteration 미소모.
