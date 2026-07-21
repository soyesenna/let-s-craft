# Audit — ask-readability-option-chat, cycle 0

| 항목 | 값 |
|---|---|
| Feature | ask-readability-option-chat |
| Date | 2026-07-21 |
| Audit cycle | 0 (첫 감사, full audit — fix-verification 아님) |
| Implementation | worktree `.lsc/worktrees/ask-readability-option-chat/`, branch `feat/ask-readability-option-chat` |
| Base branch | `feat/lets-craft-v1` (origin/HEAD 기반 자동 검출) |
| Mode | full |
| Prior audit | 없음 (N=0) |
| Implementation commits | bdb5e46 (PR1) → 088c091 (PR2+PR4) → cb5fe73 (PR3) → 3d83b3d (PR5) → d43f555 (스위트 sync 사본) |
| Audit evidence run | test/logs/run-3.log (lsc_audit_begin threshold=run-2 이후 fresh pass, exit 0) |

**AUDIT VERDICT: APPROVE-WITH-CHANGE**

---

## 1. Spec Compliance Matrix

메인 세션이 인용 file:line을 직접 read로 재검증한 행에는 (v) 표기. 나머지 행의 근거는 run-3.log 실측 + 두 에이전트의 수렴 인용.

| Requirement | Status | Notes |
|---|---|---|
| AC1.1 3도구 원버튼 왕복 | Met | I1 green (integration 16); renderChatPanel live turn 표시 (v: component.ts:162-166) |
| AC1.2 자유 멀티턴 + Esc | **Partial** | 기전·단계적 Esc는 정합(I2 green, v: state.ts:399-425)이나 **작성 중 채팅 프롬프트가 화면에 렌더되지 않음** (Major 1) — 사용자는 타이핑을 못 본 채 전송 |
| AC1.3 체크/커서 보존 | Met | outer state 소유 (v: state.ts:66-85), U8/I3 green |
| AC1.4 CONTENT 동일 + details.sideChat | Met | serializeEnvelope 무변경 (v: ask.ts:77-87), attachSideChat은 turn 존재 시에만 (v: ask.ts:90-94), U1/U2 green |
| AC2.1 범프 후 기존 suite green + 컴파일 | Met | run-3.log: build PASS·typegate PASS·58 files/1485 tests green (기존 suite 포함) |
| AC2.2 fixture 채팅 비노출 + 스크립트 동일 | Met | fixture-isolation 16 green (factory·CompletionPort 호출 0회); fixture 선결정 (v: ask.ts:182-193) |
| AC2.3 헤드리스 하드에러 + custom 미지원 폴백 | Met | mountComponent 분류 계약 구현 (v: ask.ts:157-171), fallback 14 + B3 green |
| AC2.4 loadMode 노출 | **Partial** | 정적 U5 green(essential 3/discoverable 13). 그러나 spec 문언 "17.x 런타임에서 노출"의 라이브 관측(E1)은 SKIPPED — plugin boot는 성공했으나 loadMode 실측은 모호로 종결(craft 공시) |
| AC3.1 포커스 전문 접근(+스크롤) | Met | descWindow+maxDescScroll 도달성, R1(dense segment union) green |
| AC3.2 비포커스 유지·목록 스크롤·무소실 | Met | R2 green |
| AC3.3 소형 터미널(24행) | Met | R3 SMALL 스냅샷 green |
| AC4.1 실패/중단/resolver 실패 → 질문 생존 | Met | 에러 이원+normalizeSideError+stale turnId 무시 (v: state.ts:325-331), done 미호출, U4/I4 green |
| AC4.2 패널 에러+재시도, 결과 비오염 | Met | retry r=동결 세션 재사용·byte-equal (v: state.ts:410-415). 단 free-prompt 에러 후 r은 Esc 선행 필요(Minor 8 — 힌트와 어긋남, 기능 자체는 성립) |
| AC5.1 위계 렌더 불변식 | Met | 9역할 SSOT (v: palette.ts:22-32), pairwise·RESET 불변식, palette 22+snapshot 40 green |
| AC5.2 라이트/다크 적응 불변식 | Met | Theme.isLight 분기 (v: component.ts:84), light≠dark green |
| AC5.3 OSC 66 부재 | Met | R5 green; src grep — SGR+RESET만 |
| AC6.1 캐시 히트 형태 요청 단위 고정 | Met | promptCacheKey=메인ID, `{main}:side:{nonce}`, freeze, deep-equal 프리픽스, getBranch 1회 (completion-core 34 green; v: component.ts:95-102) |
| AC6.2 라이브 cache_read 1회 실측 | **Unmet** | 미수행 — craft가 fail-closed 규칙대로 정직 공시(가짜 증거 없음). appendix-cache-probe.md 부재 확인. spec 문언상 Unmet |

**Constraints 1-16**: 준수. 예외: Constraint 11의 푸터 힌트에서 "Space 체크" 누락(Minor 3, v: render-model.ts:41). Constraint 12는 `.describe` 무변경이라 SKILL 동기화 불요 — 단 Minor 1(ask.ts:632 description이 custom 경로에서 부정확)을 고치면 3 SKILL.md 동기화가 필요해짐.

**Non-Goals**: 위반 없음 — askDialog/forkFrom/branch()/appendMessage/OSC66 grep 0건, fixture kind 무추가, destructive 흐름(src/ask.ts:630-681 상당 영역) 호출부 details 확장 외 무변경(destructive-parity 13 green).

## 2. Plan Compliance Matrix

| Plan Step / 계약 | Status | Notes |
|---|---|---|
| PR1 — SDK 17.0.5 락스텝 + lockfile + loadMode 16종 | Met (게이트 절차 위반 1건) | 핀·lockfile·loadMode 이행 확인. 단 **hard gate의 "실제 17.0.5 omp 부팅 후 loadMode smoke 통과 전 PR2 진행 금지" 문언이 집행되지 않은 채 PR2-5 진행** — boot는 성공, loadMode 실측은 모호로 남김 (Major 3의 일부) |
| PR2 — 단일 마운트 가독성 코어 + parity + 폴백 | Partial | 구조·상태 전이 정본·폴백 계약·팔레트 전부 정합. 그러나 **입력 에코 렌더 부재**(Major 1)와 **검색 filtered projection 미렌더**(Major 2)가 "mandatory baseline parity"의 가시 층위를 위반 |
| PR3 — completion 어댑터 + 원버튼 + details.sideChat | Met | v2 §4 CompletionPort·캐시 수명 정본(getBranch 1회·freeze)·이벤트 어휘 §10(startTurn=effect, delta에 at 없음) 전부 정합 |
| PR4 — 자유 멀티턴 + 실패 격리 + cache-session invariant | Met (구현 위치는 PR2 커밋에 원자 포함 — 무단 이탈 아님, reducer 소유가 설계상 자연) | AbortController+monotonic turnId·stale 무시·byte-equal retry 정합 |
| PR5 — 계약 동기화 + 경계 회귀 + Bun + 캐시 실측 | Partial | 경계 스캐너(static/dynamic/side-effect/re-export) green, B1-B3 green, test:bun 추가. **O2 캐시 실측 미수행**(AC6.2 Unmet, Major 3의 일부) |
| Guardrails Import graph (정본) | Met | 값 import는 component.ts(pi-tui)·completion.ts(pi-ai) 2 leaf뿐; ask.ts/Node-safe→leaf edge 없음 — explore가 소스 라인 단위로 실증, 스캐너 테스트 green |
| Must NOT Have | Met | 전 항목 준수 (Non-Goals 행과 동일 근거) |
| 공시 deviation ① statusbar-regression 핀 갱신 | 정당 | Constraint 1(락스텝)의 필연적 결과; exact-pin 어서션 유지(약화 아님) |
| 공시 deviation ② isError:false 5곳 | 정당 | falsy→false 의미 동일, destructive 게이트(!result.isError) 불변, Bun B계약 요구 |

## 3. Code Quality & Regression Risk

### MAJOR (3)

**M1 — 입력 에코 전면 부재 (HIGH confidence, 사용자 가시)**
ask 초안·Other 초안·채팅 프롬프트·검색어가 화면에 렌더되지 않는다. 상태는 축적되지만(state.ts:74-78 askDraft/askCursor/chatDraft/searchQuery; reducer 축적 state.ts:280-306) view-model이 운반하지 않는다: `SelectViewModel`(render-model.ts:12-22)에 askDraft/searchQuery 필드 부재, `ChatPanelViewModel`(render-model.ts:29-35)에 chatDraft 부재, `selectViewModel()`/`chatViewModel()`(component.ts:183-212)이 전달하지 않음. lsc_ask 사용자는 타이핑을 보지 못한 채 Enter 제출(component.ts:149 — editor 모드 Enter=submitAsk). canon 렌더/스냅샷 스위트에 에코 어서션이 0건이라 테스트 갭과 구현 갭이 동시 존재.

**M2 — 검색 하이라이트↔커밋 대상 불일치 (HIGH confidence)**
검색 모드에서 `canonicalCursor`는 filtered 위치(state.ts:70 주석, :288/:303/:379-390)이고 커밋은 `filtered[cursor].index`(state.ts:384/:390)로 원본 index를 올바르게 매핑한다. 그러나 `selectViewModel()`(component.ts:183-196)은 이 filtered 위치를 무필터 전체 목록의 `focusIndex`로 렌더한다 — 필터가 선행 옵션을 제외하면 하이라이트된 행과 Enter가 커밋하는 행이 달라진다. 검색어·필터 상태·활성 표시도 전무(M1과 동근). critic의 Realist 재보정으로 CRITICAL→MAJOR 강등(완화: `/` opt-in 진입, CONTENT에 선택 라벨이 에코되어 사후 확인 가능, confirm Yes/No 2옵션 배치에서는 위험 방향 역전 불성립).

**M3 — 라이브 게이트 3건 미실행 패턴**
① AC6.2 캐시 실측 미수행(공시됨), ② PR1 hard gate의 실 omp loadMode smoke 미완(boot만 성공, 공시됨), ③ O1 티어1 스파이크 미수행(공시됨) + E1 LSC_E2E 스위트 3개 run 로그 전부 skipped(이것만 공시 목록에 부재). 개별로는 각각 정직한 fail-closed지만, 라이브 5분이면 M1/M2를 즉시 발견했을 검증 계층 전체가 비어 있다는 패턴이 실질 리스크.

### MINOR (8, 비차단)

1. ask.ts:632 description "multi-line editor (ctx.ui.editor)"가 custom 경로에서 부정확 — 수정 시 3 SKILL.md §1.2 동기화 필요(AC9).
2. 채팅 패널 스크롤 부재 — 긴 답변 tail-keep 절단, chat 모드 PgUp/PgDn noop (render-model.ts:118-142).
3. footer 기본 힌트에 "Space 체크" 누락 (render-model.ts:41 vs appendix-palette §2 힌트 정본).
4. SideChatTurn.model=`ctx.model?.id`(component.ts:99) vs appendix §4 "provider/id" 형식.
5. searchOptions는 substring 매칭(state.ts:111-121) vs plan 문언 "fuzzy" — canon이 substring을 비준하므로 실害 없음(§6 amendment 제안 참조).
6. mountComponent에서 `build()`가 try 밖(ask.ts:162) — factory 동기 throw 시 분류 우회(현 구현상 실제 throw 경로는 관찰 안 됨).
7. renderEnv가 tui width/height duck-typing + 80×24 폴백, render(maxWidth) 미사용 (component.ts:79-92).
8. free-prompt 에러 후 `r` 재시도는 Esc(에디터 blur) 선행 필요 (component.ts:142,158 textEntry 게이팅) — footer 힌트와 어긋남.

### 회귀 리스크

낮음. 기존 스위트 전량 green(run-3), destructive-parity 13 green, envelope/fixture 계약 무변경 실측. 경계 스캐너가 Node/Bun 경계를 회귀 가드로 고정. 공시 deviation 2건 모두 정당 판정.

### 커버리지 공백 (explore 실측, 비차단 — 후속 보강 후보)

buildConfirm/buildAsk의 Bun 실 mount 부재(typeof만, test-bun:707-750), component dispose 미호출, canonicalizeEntry 실입력 변형 미운동(fake getBranch가 항상 []), completion.ts extractText/mapUsage undefined 폴백·model resolve 폴백 미운동, reducer search space guard·chat enter guard 직접 어서션 부재, renderChatPanel error-without-message·footerHint override 미검사, rgbToXterm256 threshold edge(7/249) 미고정.

## 4. Test Re-verification

- 방법: `lsc_run_tests` (audit-evidence 모드 아님 — 세션 active craft 상태에서 정상 실행), cycle 0 threshold=run-2 이후.
- 결과: **exit 0** — `test/logs/run-3.log`. build PASS · typegate PASS · vitest 58 files passed/5 skipped, 1485 tests passed/16 skipped/0 failed · Bun 17 pass/0 fail · E2E: LSC_E2E 미설정 self-skip(정상).
- craft 주장 수치와 실측 일치. 판정 하드 게이트: 통과(APPROVE 계열 허용).

## 5. Full lsc-explore report (verbatim)

> ## Findings
> - **Files**: 구현/의존성 전수는 `/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/ask-readability-option-chat` 기준 `git diff feat/lets-craft-v1...feat/ask-readability-option-chat --name-status` 결과 75개다. 정본 문서·리서치 25개는 `/Users/soyesenna/Desktop/workspace/lets-craft/.lsc/worktrees/ask-readability-option-chat/.lsc/crafts/ask-readability-option-chat/{trace.md:1,spec.md:24-52,plan.md:1,plan/appendix-dr.md:38-49,plan/appendix-test-plan.md:6-72,plan/appendix-wiring-contract.md:1-95,plan/appendix-palette-and-prompts.md:1-155,plan/appendix-pre-mortem.md:1-38,plan/appendix-precedent.md:1-23,plan/plan-1.md:1-35,research/SYNTHESIS.md:1-80,research/cause-disappearance.md:1-4,research/claim-graph.md:1-37,research/claims.json:1,research/intent-diff.md:1-22,research/observation-manifest.md:1-80,research/verification-economics.md:1-19,research/waves/wave-1.md:1-24,research/waves/wave-2.md:1-26,research/waves/wave-3.md:1-23,research/waves/wave-4.md:1-31,research/waves/wave-5.md:1-27,open-questions.md:1-17}`이다. 이들은 구현 소스가 아니라 pre-craft 정본·근거다.
> - **Files**: 보호 canon 14개는 `run_test.sh:1-33`, `assets/typecheck/ask-ui-contract.test-d.ts:1-91`, `assets/test/ask-ui-{completion-core,contract-regression,destructive-parity,e2e,fallback,fixture-isolation,integration,palette,render-model,snapshot,state}.test.ts:1`, `assets/test-bun/ask-ui-adapter.test.ts:1`, `assets/docs/{o1-live-spike-procedure,cache-probe-procedure}.md:1`이다. 실행 위치·hash 보호·동기화 규칙은 `run_test.sh:1-33`에 있다. synced shadow 14개는 `test-bun/ask-ui-adapter.test.ts:1`, `test/ask-ui-*.test.ts:1`, `test/ask-ui-contract.test-d.ts:1`, `test/statusbar-regression.test.ts:1`이다.
> - **Files**: 런타임/의존성 22개는 `package.json:16-26`, `package-lock.json:11-19`, `src/ask-ui/{types.ts:1-106,state.ts:1-495,render-model.ts:1-143,palette.ts:1-87,completion-core.ts:1-182,component.ts:1-212,completion.ts:1-75,index.ts:1-62}`, `src/ask.ts:22-27,89-209,613-720`, `src/main.ts:4-7,36-38`, `src/artifacts/scaffold.ts:120`, `src/craft/{abort,hash-manifest,land,latency-report,release,run-tests,verdict}.ts`의 각 등록 함수 loadMode 변경부, `src/doctor.ts:508`, `src/research/claims-tool.ts:165`이다. SDK 17.0.5 exact pin 및 16개 tool `loadMode` 지정은 spec `:49-52`, 기술 좌표는 spec `:128-131`과 일치한다. `test/statusbar-regression.test.ts`의 pi-ai 16.4.0→17.0.5 pin 갱신은 공유 SDK 락스텝 회귀 기준이며 statusbar production 소스는 diff에 없다.
> - **Root cause**: 구현은 계획된 순수 Node-safe core와 Bun-only leaves 경계를 지켰고, pure/reducer/adapter 테스트는 실제로 통과했지만, 실제 provider 라이브 스파이크·캐시 관찰과 confirm/ask의 실제 Bun mount는 아직 완전히 증명되지 않았다.
> - **Evidence**: `test/logs/run-3.log:175-201`은 `58 passed`, `1485 passed | 16 skipped`, build/type-check/unit+regress PASS, Bun deterministic `17 pass`, gated E2E SKIPPED를 기록한다. `run-3.log:187-199`은 `LSC_E2E` 미설정으로 live smoke가 실행되지 않았음을 명시한다.
>
> ## Coverage Gaps
> - **Node-safe core**: `test/ask-ui-completion-core.test.ts` 34 tests는 `completion-core.ts`의 `createSideChatSession`, `buildSideRequest`, `renderTurnPrompt` 양식, `buildSideChatDetails`, `redactSecrets`, `normalizeSideError`를 각각 운동한다(`:23-28,116-300,318-368`). `test/ask-ui-state.test.ts` 83 tests와 `test/ask-ui-integration.test.ts` 16 tests는 `state.ts` reducer의 browse/search/editor/chat, timestamp, stale delta/settle, retry, abort, state preservation 및 select/ask/confirm 결과 매핑을 운동한다(`state.test.ts:185-526,529-872`, `integration.test.ts:147-241,300-487`). `render-model.ts`는 15 model tests+40 snapshot tests로 focus/header/option/Other/Done, list/description scroll, empty/out-of-range, chat target/status와 256color를 운동한다(`render-model.test.ts:51-190`, `snapshot.test.ts:66-809`). `palette.ts`는 22 tests로 9-role light/dark, truecolor→256 파생, SGR/RESET 불변식을 운동한다(`palette.test.ts:130-188`). `types.ts`는 실행 심볼이 없는 type-only 모듈이므로 별도 runtime branch는 없고 dedicated tsc gate가 계약을 검사한다(`assets/typecheck/ask-ui-contract.test-d.ts:1-91`, `run-3.log:18-20`).
> - **Bun leaves/index**: `test-bun/ask-ui-adapter.test.ts` 17 tests가 real `pi-tui.matchesKey`, 실제 component의 select mount, `?`/`t` side completion, fuzzy search, multi Done, scrolling, real `pi-ai.stream`, resolver/session/cacheRetention/usage/error/abort/reject와 `main`→`registerAskTools`→runtime→custom→completion select assembly를 운동한다(`test-bun/ask-ui-adapter.test.ts:545-753`, `run-3.log:201-227`). 그러나 `index.ts:43-59`의 `buildConfirm`·`buildAsk`는 Bun suite에서 `typeof`만 확인한다(`:707-750`); 실제 confirm/ask component mount/answer는 없다. component lifecycle `dispose`도 구현만 있고 호출 assertion이 없다(`component.ts:175-180`).
> - **Uncovered component branches**: `component.ts:26-27`의 `finiteNumber` invalid/NaN fallback과 `component.ts:39-54`의 `canonicalizeEntry` object/message/role 필터는 `createFakeCtx().sessionManager.getBranch()`가 항상 빈 배열이어서 실입력 변형을 받지 않는다(`test-bun:271-287`). `printableChar`/raw-key routing은 positive paths로 운동되지만 unknown/escape/non-printable 입력을 통한 `undefined` 결과는 직접 assertion이 없다(`component.ts:31-36,141-160`).
> - **Uncovered completion branches**: `completion.ts:11-21`의 `extractText(undefined)`·`mapUsage(undefined)` fallback은 Bun fixture `finalMessageWith`가 항상 AssistantMessage와 usage를 제공하여 미운동이다(`test-bun:183-207`). `completion.ts:35`의 `ctx.models.resolve(request.model) ?? ctx.model` fallback도 fake `resolve`가 항상 SIDE_MODEL을 반환하여 미운동이다(`test-bun:271-276`). event 분기 text_delta/done/error 및 stopReason error/aborted와 iterator throw는 각각 Bun assertions로 운동된다(`completion.ts:55-72`, `test-bun:619-663`).
> - **Uncovered reducer guards**: 핵심 reducer는 넓게 커버되지만 search mode의 `space` multi-toggle와 `filtered.length===0 || !multi` guard, chat `enter`의 editor-focused/draft/session 부정 조건 및 default no-op는 직접 assertion이 없다(`state.ts:372-397,399-425`; 현재 search empty 테스트는 down/up/enter만 `state.test.ts:463-492`).
> - **Uncovered rendering edges**: `renderChatPanel`의 `status:"error"`이면서 `error===undefined`인 suppress branch와 사용자 지정 `footerHint` override는 직접 검사되지 않는다(`render-model.ts:129-142`; error fixture는 `render-model.test.ts:175-184`에서 error 문자열을 제공한다). `rgbToXterm256`은 black/white로 low/high 분기를 통과하지만 threshold edge 7/249 자체는 명시적으로 고정되지 않았다(`palette.ts:40-48`, `palette.test.ts:150-174`).
> - **O1/O2 evidence gap**: live provider spike는 `assets/docs/o1-live-spike-procedure.md:1`에 절차만 있고 실행 증거가 없다. cache hit 관찰도 `appendix-palette-and-prompts.md:152-155`의 procedure 수준이며 `run-3.log:187-199`에서 E2E가 skipped다. 이는 craft가 명시적으로 honest fail-closed 공시한 두 deviation이며, 가짜 green 증거는 아니다.
>
> ## Impact
> - **Scope**: cross-module / **Risk**: high / **Affected areas**: `src/ask-ui` Node/Bun import boundary, `src/ask.ts` channel/fallback/result envelope, `src/main.ts` runtime binder wiring, `fixtures.ts`의 fixture-first channel 선택(`src/fixtures.ts:309-325`), SDK package/loadMode registration, side-chat provider/cache behavior, destructive confirm parity.
>
> ## Relationships
> `src/main.ts:4-7,36-38`가 `registerAskTools(pi, createAskRuntimeFactory(pi))`를 연결한다. `src/ask.ts:613-640`의 wrapper는 UI channel일 때만 `runtimeFor` binder를 호출하고, fixture/unavailable에서는 binder를 호출하지 않는다. `src/ask.ts:157-209,513-529,551-575`의 `mountComponent`는 `ctx.ui.custom`이 없으면 legacy fallback, `undefined`면 factory 미시작 fallback, reject면 error, 결과면 answer로 분류한다. fixture 선결정은 `src/ask.ts:45-47,180-203`과 `src/fixtures.ts:309-325`에서 수행되어 side chat이 fixture 경로에 노출되지 않는다.
>
> ```text
> main.ts
>  ├─> ask.ts ──> fixtures.ts / craft state+approval / ask-ui/completion-core.ts / ask-ui/types.ts
>  └─> ask-ui/index.ts
>        ├─> ask-ui/component.ts ──value import─> @oh-my-pi/pi-tui
>        │     ├─> state.ts ──> completion-core.ts / types.ts / ask.ts constants
>        │     └─> render-model.ts ──> palette.ts / types.ts / ask.ts constants
>        └─> ask-ui/completion.ts ──value import─> @oh-my-pi/pi-ai
>              └─> completion-core.ts
> ```
>
> `types.ts:1-8`, `completion-core.ts:1-7`, `palette.ts:1-9`, `render-model.ts:1-10`, `state.ts:1-10`, `ask.ts:22-27`은 SDK runtime value를 import하지 않는다. 허용된 external runtime value import는 `component.ts:1-10`의 pi-tui와 `completion.ts:1-8`의 pi-ai뿐이며, `index.ts:1-10`은 local Bun leaves를 조립할 뿐이다. static import, side-effect import, dynamic import, re-export를 모두 검사하는 boundary scanner는 `test/ask-ui-contract-regression.test.ts:303-435`에 있고, ask.ts→leaf 음성 edge와 main→index 양성 edge는 `:412-419,457-473`에서 검사된다. 따라서 정적/동적/재수출 형태의 Node-safe→leaf 누출은 관찰되지 않는다.
>
> 기존 statusbar와의 접점은 production statusbar 구현이 아니라 SDK pin 회귀 테스트뿐이다(`test/statusbar-regression.test.ts:21-41`). craft 도구 16개 등록부의 loadMode 변경은 SDK 17.x의 discoverable 기본값에 대한 plan 계약(`spec.md:49-52`, `plan/appendix-dr.md:60-67`)을 만족시키는 횡단 변경이고, ask UI 실행 그래프와 별개다.
>
> ## Recommendation
> - [실행] `LSC_E2E=1`과 실제 provider/token이 있는 환경에서 `o1-live-spike-procedure.md`를 수행하고, select·confirm·ask 각각의 실제 `ctx.ui.custom` mount/answer/cancel을 Bun smoke로 추가해 `index.ts:43-59`의 buildConfirm/buildAsk와 `component.ts:63-180`을 실제로 운동하라.
> - [실행] 동일 side session에서 최초 요청과 후속 요청의 provider usage `cacheReadInputTokens`/`cacheCreationInputTokens`를 기록하여 `appendix-palette-and-prompts.md:152-155`의 AC6.2를 입증하라. 증거가 없으면 해당 AC는 APPROVE로 간주하지 말고 fail-closed로 남겨라.
> - [실행] 무인 회귀 보강이 요구되면 `canonicalizeEntry`, model-resolve fallback, `extractText/mapUsage` undefined, reducer search-space guard, chat enter guard, `dispose`, error-without-message, `footerHint`를 각각 observable behavior 테스트로 추가하라. 포매터·린터·전체 스위트 재실행은 이 감사 범위에서 수행하지 않았다.
>
> ## Next Steps
> - [현재 판정] 구현 diff의 계획/그래프/fixture 격리/Node-Bun 경계는 `run-3.log:175-227`의 실행 증거와 일치하며 unrelated production 영역은 발견되지 않았다.
> - [차단 조건] AC6.2 및 실제 O1 라이브 provider 결과가 필요한 post-craft 최종 승인은 현재 증거만으로 닫을 수 없다. 이 결과를 `lsc-critic`/post-craft 감사에 넘겨 `APPROVE-WITH-CHANGE` 또는 live 증거 확보 후 재판정하라.
> - [후속] live O1/O2와 confirm/ask 실제 mount가 통과하면 다시 audit freshness를 기록하고 post-craft verdict를 검증할 준비가 됐다.

## 6. Full lsc-critic report (verbatim)

**Provenance note**: lsc-critic 스폰의 최초 yield는 provider 장애로 null 유실(부분 출력: Phase 1 사전 예측 5건까지 수신). §1.8 표준 idle-recovery 절차로 동일 인스턴스에서 완결 리포트를 복구 수신함. 아래는 복구 리포트 전문 verbatim.

> **VERDICT: [REVISE]** — ask-readability-option-chat post-craft full audit (cycle 0) 완결 리포트.
>
> ## Overall
> 계약·경계·캐시·회귀 층위는 전부 정합: wiring v2(6-member Pick/결과 union/CompletionPort/이벤트 어휘 §10), 캐시 수명 정본(getBranch 1회·freeze·프리픽스 불변·retry byte-equal), import graph(값 import는 component.ts=pi-tui, completion.ts=pi-ai 두 leaf뿐), envelope/fixture/destructive(:630-681) 불변 확인. craft 주장 수치는 run-3.log(git=d43f555 스탬프)로 실측 일치: vitest 1485/16/0, bun 17 pass, build·typegate PASS. canon 13파일 blob OID = repo 사본 전부 동일(약화 없음). 그러나 사용자 가시 MAJOR 결함 2건 + 라이브 게이트 3건 전부 미실행 → REVISE.
>
> ## Spec Compliance Matrix (Requirement | Status | Notes)
> - AC1.1 | Met | I1 green; 답변 표시는 renderChatPanel live turn으로 동작
> - AC1.2 | Partial | 기전·단계적 Esc 정합(I2 green)이나 작성 중 프롬프트 미표시(Major1)
> - AC1.3 | Met | outer state 소유(state.ts:70-88), U8/I3 green
> - AC1.4 | Met | serializeEnvelope 무변경, attachSideChat(ask.ts:90-95) turn 존재 시에만
> - AC2.1 | Met | build+typegate+기존 스위트 포함 58 files green(run-3)
> - AC2.2 | Met | fixture-isolation 16 green(factory·port 0회); E2 라이브 절반 미실행 주석
> - AC2.3 | Met | mountComponent 폴백 분류(ask.ts:157-169), fallback 14 + B3 green
> - AC2.4 | Partial | 정적 U5 green(essential 3/discoverable 13); 실런타임 노출(E1) SKIPPED — spec 문언은 "런타임에서 노출"
> - AC3.1 | Met | descWindow+maxDescScroll 도달성(render-model.ts:74-83), R1 green
> - AC3.2 | Met | 첫줄 유지+optionScroll, R2 green
> - AC3.3 | Met | SMALL(24행) 스냅샷 green
> - AC4.1 | Met | 에러 이원+normalizeSideError, done 미호출, stale turnId 무시(state.ts:325-350)
> - AC4.2 | Met | retry r=동결 세션 재사용·byte-equal(state.ts:411-416); free-prompt 에러 후 r은 Esc 선행 필요(Minor8)
> - AC5.1 | Met | 9역할 SSOT(palette.ts:22-32)·pairwise·RESET, 팔레트22+스냅샷40 green
> - AC5.2 | Met | Theme.isLight 분기, light≠dark green; light error RGB 미세조정은 D4 비계약 범위
> - AC5.3 | Met | src grep — SGR+RESET만, OSC66/DECDWL 전무
> - AC6.1 | Met | promptCacheKey=메인ID, {main}:side:{nonce}, freeze, deep-equal 프리픽스, getBranch 1회(completion-core 34 green)
> - AC6.2 | **Unmet** | 라이브 실측 미수행 공시(fail-closed); appendix-cache-probe.md 부재로 교차 확인 — 가짜 증거 없음
>
> Constraints 1-16: 전부 준수(11만 footer의 "Space 체크" 힌트 누락 — Minor3; 12는 .describe 무변경이라 동기화 불요). Non-Goals: askDialog/forkFrom/branch()/appendMessage/OSC66 grep 0건, fixture kind 무추가, destructive 흐름 호출부 1행 외 무변경(destructive-parity 13 green).
>
> ## Plan 대조
> PR1 핀·lockfile·loadMode 16종 이행 ✓, 단 hard gate의 "실제 17.0.5 omp 부팅 smoke" 미실행인 채 PR2-5 진행(plan: "어느 단계든 실패하면 PR2로 진행하지 않는다"). PR2-4 상태전이/Fallback/캐시 정본 및 v2 §5+§10 어휘(startTurn=effect, delta에 at 없음, retry는 createSession 재호출 없음) 전부 정합. PR5 경계 스캐너(dynamic/side-effect/re-export 포함)·B1-B3·production 조립 판별자(bun 로그 실측) ✓, O2 미수행 공시. 무단 이탈 없음.
>
> ## 공시 deviation 2건 판단
> 1) statusbar-regression 핀 16.4.0→17.0.5(2행): **정당** — Constraint 1 필연, exact-pin 어서션 유지(약화 아님). 2) isError:false 5곳: **정당** — falsy→false 의미 동일, destructive 게이트(!result.isError) 불변, 5곳 실측 일치.
>
> ## O1/O2 미수행 심각도
> **MAJOR**. AC6.2는 문언상 Unmet이 맞고 craft는 fail-closed 규칙을 정확히 따름(가짜 증거 없음). 그러나 미실행 라이브 검증이 O2 단건이 아니라 O1(ADR follow-up 티어1 스파이크)+E1(PR1 hard gate)까지 3건의 패턴이며 공시는 O1/O2만 명시(E1 스킵은 run 로그에만). 이 패턴의 비용은 아래 Major1/2가 증명 — 라이브 5분이면 발견됐을 결함.
>
> ## Major Findings (3)
> 1. **입력 에코 전면 부재** — ask 초안·Other 초안·채팅 프롬프트·검색어가 화면에 렌더되지 않음. selectViewModel(component.ts:183-196)에 askDraft/searchQuery 부재, chatViewModel(component.ts:198-212)에 chatDraft 부재, render-model.ts:12-35 view-model에 필드 자체가 없음. lsc_ask 사용자는 타이핑을 못 본 채 Enter 제출(Enter=submitAsk, 개행은 paste로만). canon 렌더/스냅샷에 에코 어서션 0건(테스트 갭+구현 갭 동시). Confidence HIGH. Fix: view-model에 draft/query 추가+렌더+canon 보강(release 절차 필요) — needs-redesign.
> 2. **검색 하이라이트↔커밋 불일치** — 검색 중 canonicalCursor는 filtered 위치(state.ts:288,303; 커밋 state.ts:382-390 filtered[cursor].index)인데 component.ts:183-190이 이를 무필터 목록의 focusIndex로 렌더 → 필터가 선행 옵션을 제외하면 하이라이트와 Enter 커밋 대상이 달라짐. 검색어/필터/활성상태 전부 미표시. plan 정본 "mandatory baseline parity"의 가시 층위 위반. Confidence HIGH. Realist 강등 CRITICAL→MAJOR(완화: `/` opt-in·CONTENT transcript 에코·confirm Yes/No 배치에서 위험 방향 역전 불성립). Fix: filtered projection 렌더 — needs-redesign.
> 3. **라이브 게이트 3건 미실행**(AC6.2 Unmet + PR1 hard gate 미집행 + O1 미수행; E1 스킵은 공시 목록에 부재, run 로그 3개 전부 "e2e: skipped"). Confidence HIGH. Fix: land 전 LSC_E2E=1 LSC_E2E_STRICT=1 실행(E1/E2) + Anthropic 세션 O2 실측→appendix-cache-probe.md 기록 + O1 겸행 — apply-only(절차 실행).
>
> ## Minor Findings (8)
> 1) ask.ts:632 description "multi-line editor (ctx.ui.editor)"가 custom 경로에서 부정확(최소 에디터·커서 이동 불가) — 갱신 시 3 SKILL.md 동기화 필요. 2) 채팅 패널 스크롤 부재 — 긴 답변 tail-keep 절단, chat 모드 PgUp/PgDn noop. 3) footer에 "Space 체크" 누락(render-model.ts:41). 4) SideChatTurn.model=ctx.model?.id(component.ts:100) vs appendix §4 "provider/id". 5) searchOptions는 substring(state.ts:107-117) vs 계약 문언 "fuzzy"(canon이 substring 수용). 6) mountComponent의 build()가 try 밖(ask.ts:157-166) — factory 동기 throw가 분류 우회. 7) renderEnv tui.width duck-typing+80×24 폴백, render(maxWidth) 미사용(component.ts:79-95). 8) free-prompt 에러 후 r 재시도는 Esc 선행 필요(component.ts:142 textEntry 게이팅) — footer 힌트와 어긋남.
>
> ## What's Missing / Ambiguity
> canon에 입력 에코·검색 렌더·채팅 스크롤 테스트 부재(구현 갭이 숨은 구조적 원인); E1 스킵의 명시 공시 부재; appendix-cache-probe.md 슬롯 미기입. Ambiguity: "fuzzy filter" — 구현·canon은 substring(해석 B)을 비준.
>
> ## Justification
> Major1 발견 직후 ADVERSARIAL 격상, 인접 확장 수색으로 Major2·Minor6-8 추가 발견. Realist 재보정 1건(Major2 강등, 완화 사유 명시). APPROVE-WITH-CHANGE 불가: Major1/2가 렌더 설계 판단+hash-protected canon 보강(release 절차)을 요구하는 needs-redesign. 계약 층위가 견고하므로 REJECT는 과잉 — 입력 표면 렌더 보완+라이브 게이트 실행 후 재감사 시 APPROVE 궤도. (자기공시: canon 로그에 읽기 전용 wc -l bash 1회 실행 — 문언 위반, 변경 없음, 이후 read/glob만 사용.)
>
> ## Open Questions (unscored)
> custom이 done 미호출 dispose에서 undefined resolve 시 폴백이 질문을 레거시로 재게시하는 시나리오의 실호스트 동작(E1 범위 권장); completion.ts의 `as unknown as` 이중 캐스트로 stream 이벤트 형태(event.error가 AssistantMessage인지)의 컴파일 검증 우회 — O1에서 교차 확인 가치; 검색 Esc의 커서 0 리셋(state.ts:377-378)이 HookSelector parity인지 미확인.
>
> Consensus row: 해당 없음(agreement-loop 아님, post-craft full audit).

**Verdict correspondence note (§1.7/§4.2)**: critic의 REVISE(5값 에이전트 척도)는 "미해결 MAJOR가 spec/plan compliance를 차단"하는 경우로, 본 감사 4값 척도에서 APPROVE-WITH-CHANGE에 대응한다(테스트 재검증 통과 + 결함이 정밀 처방 가능한 범위 — REJECT 요건인 "scoped fix 처방 불가" 불성립). critic 자신의 "APPROVE-WITH-CHANGE 불가" 문구는 critic 척도의 AWC(모든 수정이 기계적으로 완결) 정의에 대한 것이며 본 감사 척도와 무관하다.

## 7. Required Fix (APPROVE-WITH-CHANGE — craft 재호출 대상)

다음 3건이 필수(MUST). 구현 루트는 worktree(`.lsc/worktrees/ask-readability-option-chat/`), 기존 canon 스위트는 전량 green 유지가 전제.

**RF1 — 입력 에코 렌더 (Major 1)**
- `SelectViewModel`(src/ask-ui/render-model.ts:12-22)에 ask 에디터 초안(askDraft+askCursor 표시)·검색어(searchQuery) 표시 필드를, `ChatPanelViewModel`(:29-35)에 채팅 입력 초안(chatDraft)+에디터 포커스 표시 필드를 추가한다.
- `selectViewModel()`/`chatViewModel()`(src/ask-ui/component.ts:183-212)이 state의 해당 필드(state.ts:74-78)를 view-model로 전달하고, `renderSelectView`/`renderChatPanel`이 이를 실제로 렌더한다(에디터 모드: 초안+커서 위치 가시화; 검색 모드: 활성 검색어 라인; 채팅 모드: 입력 라인+포커스 상태).
- 렌더는 기존 9역할 팔레트 불변식(AC5.1)·행수 상한(AC3)을 유지한다.

**RF2 — 검색 filtered projection 렌더 (Major 2)**
- 검색 모드에서 view-model이 filtered projection을 운반하도록 하여(searchQuery를 넘겨 render-model이 state.ts의 `searchOptions`와 동일 함수로 파생하거나, filtered 목록 자체를 전달) 하이라이트 행과 Enter/Space 커밋 대상(state.ts:384/:390의 `filtered[cursor].index`)이 항상 일치하게 한다.
- 체크 표시는 원본 index 기준 매핑을 유지하고, empty-result 상태를 렌더로 표현한다.
- **매칭 알고리즘은 canon이 비준한 substring 매칭(state.ts:111-121)을 유지한다 — fuzzy 스코어링으로 "개선"하지 말 것**(canon 어서션과 충돌).

**RF3 — 라이브 게이트 실행 (Major 3)**
- O2 캐시 실측: canon `docs/cache-probe-procedure.md` 절차대로 라이브 사이드챗 2턴 실행, 2턴째 provider usage `cache_read_input_tokens > 0` 확인 후 `plan/appendix-cache-probe.md`에 provider·모델·1/2턴 usage·타임스탬프 기록. telemetry 부재/값 0은 기록하되 성공으로 표기 금지(fail-closed).
- O1 스파이크: canon `docs/o1-live-spike-procedure.md` 절차대로 실 omp 세션에서 resolver 인증+stream 라운드트립+custom→done→재select 확인, 로그를 craft 증거로 남김.
- E1 loadMode smoke: 실제 omp 17.0.5에서 built plugin 부팅, ask 3종 essential 직접 노출 + 대표 batch 도구 1개 xd:// discoverable 실행 관측. 가능하면 `LSC_E2E=1 LSC_E2E_STRICT=1`로 gated 스위트 실행.
- 위 라이브 항목 중 환경상 진짜 불가한 것이 남으면 무엇이 왜 불가였는지 증거와 함께 명시 공시(가짜 증거 금지) — 다음 감사가 잔여 리스크를 재평가한다.

**Canon 보강 필요 고지 (craft §4 [Canon Amendment] 경로 대상)**: 입력 에코·검색 렌더에 대한 canon 테스트 어서션이 현재 0건이다(구현 갭이 테스트 갭 뒤에 숨은 구조적 원인). RF1/RF2 구현 후, 에코·filtered projection 불변식을 고정하는 canon 테스트 보강이 필요하며 이는 hash-protected canon 수정이므로 재호출된 craft의 `[Canon Amendment]` 승인 → `lsc_craft_release` → 편집 → `lsc_craft_init` 재베이스라인 경로로만 수행해야 한다.

**비차단 권고 (SHOULD, 선택)**: Minor 1-8(§3) — 특히 footer "Space 체크"(Minor 3), chat 패널 스크롤(Minor 2), retry 도달성(Minor 8)은 RF1/RF2와 인접하므로 동회차 처리 권장. Minor 1 처리 시 3 SKILL.md §1.2 동기화 필수(AC9).

**다음 사이클 고지**: 본 verdict가 APPROVE-WITH-CHANGE이므로 다음 감사 사이클(audit-1)은 전면 재감사가 아닌 위 Required Fix에 스코프된 fix-verification(§5)으로 진행된다 — 이는 파이프라인 설계상의 의도된 스코프 축소다.

## 8. Proposed Spec/Plan Amendments

1. **[Plan Change 후보] "fuzzy" 문언의 substring 비준 명문화** — plan.md §OQ2/appendix-palette-and-prompts §2의 "FuzzyText 검색"/"fuzzy filter" 문언을 canon·구현이 비준한 substring 매칭(label+description, original-index mapping)으로 정정. 근거: critic Ambiguity 판정 — canon 스위트가 substring 동작을 고정하고 있어, 문언을 방치하면 후속 fix 사이클이 fuzzy 스코어링을 "구현"하다 canon과 충돌할 위험. (사용자 게이트 결과: 본 문서 커밋 후 §6.2 게이트로 개별 질의 — 결과는 아래 Disposition에 추기)
   - Disposition: **Deferred — reconsider next cycle** (사용자 선택, audit-0 §6.2 게이트. RF2의 "substring 유지" 지시가 당면 충돌 위험을 차단하므로 문언 정정은 다음 사이클에서 재검토)

## 9. Adversarial Class Matrix

| # | Class | 판정 | 근거 |
|---|---|---|---|
| 1 | Test logic delegated outside hash protection | **Excluded** | pass/fail을 결정하는 어서션 전부가 hash-protected canon(assets/test 11 + typecheck 1 + test-bun 1) 내부에 있고 run_test.sh가 read-only shadow로 sync — 외부 helper 위임 없음. 경계 스캐너도 canon 소유(contract-regression:303-435) |
| 2 | Worktree residue / base contamination | **Excluded** | explore 전수 diff 75파일 그룹핑 결과 land 대상 밖 무관 파일 없음(statusbar production 미변경, 핀 테스트 2행만); base 브랜치 미접촉; working tree clean(d43f555 이후) |
| 3 | Spec AC boundary inputs | **Applied** | AC1.2의 입력-가시성 경계(작성 중 초안)가 미구현·미테스트(M1: render-model.ts:12-35 필드 부재, canon 에코 어서션 0건); 검색 경계(필터 중 하이라이트 정합)가 미구현·미테스트(M2: component.ts:183-196); reducer 경계 가드(search space/chat enter) 직접 어서션 부재(state.ts:388-391/:405-409) |
| 4 | Post-resume state consistency | **Excluded** | 이 피처는 durable 상태 경로를 신설/변경하지 않음(craft-state 스키마 무변경); .craft-state.json testsPassed=true와 run-3 fresh pass가 정합 — 발동 조건 부재 |
| 5 | Prompt-injection surface | **Excluded** | 아티팩트·로그·도구 결과 내 지시성 텍스트는 전부 파이프라인 소유 canon(hash 검증됨)·에이전트 리포트(발주한 조사 결과)로 출처 추적 가능 — 감사 판단을 조향하려는 외부 주입 텍스트 미관찰. 신설 side-chat 프롬프트는 no-tools 강제+details 전용 기록으로 CONTENT 재진입 불가(fixture-isolation 16 green) |

## 10. 종합

계약 계층(타입 핀·envelope·fixture 격리·Node/Bun 경계·캐시 수명·destructive parity)은 견고하고 실측 green이다. 결함은 렌더 표면의 사용자 가시 갭 2건(입력 에코·검색 projection)과 라이브 검증 계층 공백 1건으로 국한되며, 셋 모두 정밀 처방 가능하다(§7). 테스트 재검증 통과 + critic REVISE + 처방 가능성 → **APPROVE-WITH-CHANGE**. land는 본 사이클에서 불가하며, Required Fix 적용 후 fix-verification 사이클(audit-1)의 APPROVE 계열 판정이 선행되어야 한다.
