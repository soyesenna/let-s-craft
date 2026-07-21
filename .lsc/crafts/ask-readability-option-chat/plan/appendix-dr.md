# Appendix — Deliberation Record (full detail)

> Core 요약은 `plan.md` §DR. 이 부록은 per-branch 상세와 무효화 근거를 담는다.
> 클레임 인용 [C1..C19]은 `research/claims.json`의 순서(1-based) — 매핑은 `plan.md` §Claim Legend.

## Principles (5)

1. **호스트 무변경.** 두 서브피처(가독성·사이드챗)는 전적으로 lets-craft 코드(BYO-completion + `ctx.ui.custom<T>`)로 구현한다. SDK 심 추가·호스트 PR 요청 없음 — extension SDK에 generation 심이 없음이 확정되었고([C1]), BYO가 공식 선례로 성립하며([C2], eval/completion-bridge.ts:124-164), 유일 라운드트립 UI 표면은 custom<T>다([C3], types.ts:271-279).
2. **계약 불변 우선.** envelope 문법·fixture 스키마·AC9 SSOT·pure-core/wrapper 경계는 기능보다 우선한다. CONTENT는 불변([C7] §1.2(c) reflect-and-reask 회피), fixtures.ts 스키마 불변(fixtures.ts:30-34 closed 4-kind), .describe 수정 시 3 SKILL.md 동기화(Constraint 12).
3. **pure-core 격리.** Bun 전용 SDK 값 import(pi-ai/pi-tui)는 wrapper 심(src/ask-ui/)에만 두고, 순수 `performX`·컴포넌트 로직은 포트 주입으로 유지한다(vitest-on-Node 로드 가능성 보존, [C12]; 기존 선례 src/statusbar/index.ts:1-6).
4. **결정론 CI + 라이브 실측 분리.** 캐시 구성·스타일·채팅 로직은 단위/스냅샷 테스트로 형태 고정, 실제 캐시 히트는 craft 1회 라이브 실측(AC6.2 / R14).
5. **최소 표면.** 3-6 PR, askDialog 미채택([C19] key-opaque + 로컬 chat 훅 부재로 in-question 채팅과 구조 충돌), 목록 행 추가 없음(키바인딩+푸터, R10), 범위 3도구 한정(R7).

## Decision Drivers (top 3, expanded)

1. **CI 안전성(무인 결정론).** 스크립트되지 않은 사이드챗 질문은 fixture kind-mismatch로 무인 CI를 파손한다([C7], fixtures.test.ts:846-851). 따라서 채팅은 fixture 경로에 원천 비노출(UI 우회)이어야 한다 — 이 제약이 컴포넌트 진입 지점을 지배한다.
2. **pure-core 테스트 경계 유지.** Node/vitest는 pi-ai·pi-coding-agent·pi-tui의 런타임 값을 import할 수 없다([C12], ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). 새 completion·컴포넌트 값 import가 vitest-도달 모듈로 새면 전 스위트가 로드 실패한다 — 어댑터 배치가 두 번째 드라이버.
3. **사용자 확정 UX.** in-question 채팅(R1) + 상태 보존(AC1.3) + 포커스 전문 가독성(R9/AC3). 이 세 요구가 컴포넌트 상태기계(목록↔채팅 패널, 체크/커서 보존)를 규정한다.

## DR-1 — 컴포넌트 아키텍처

| 옵션 | 설명 | Pros | Cons |
|---|---|---|---|
| **A. 단일 마운트 coordinator + 내부 pure subview 합성 (채택)** | 하나의 `custom<T>` 마운트의 outer coordinator가 목록·채팅 상태를 소유하고, browse/search/ask-editor/chat/error는 pure subview/reducer 모듈로 분리. | 상태 보존(체크/커서)이 outer coordinator 필드라 왕복 후 자연 보존(AC1.3); 하나의 done(result)로 performX 복귀; 키 라우팅 일원화; pure reducer/subview는 Node 단위 검증 가능. | 모듈과 port가 늘고 Bun adapter용 별도 smoke test(B1-B3) 필요. |
| B. 합성 컴포넌트 | 목록 컴포넌트 + 별도 채팅 오버레이(각각 custom<T> 또는 overlay). | 관심사 분리; 채팅 오버레이 독립 테스트. | 목록 상태를 오버레이 진입/복귀 간 외부 보존해야 함(체크/커서 유실 리스크 AC1.3); custom<T>가 done 시 종료되므로 중첩 마운트 계약 복잡; 키 포커스 이관 취약. |

**채택: A.** AC1.3(상태 보존)이 결정적 — outer coordinator가 상태를 mount 전체 수명 동안 소유하므로 왕복이 무손실. B는 trace가 close-and-reopen의 약점으로 지목한 "질문 상태 유실 리스크"(trace §3 H-D)를 컴포넌트 내부에서 재현할 위험. 관심사 분리는 outer coordinator + pure reducer/subview 합성으로 확보(§Import graph 정본).

## DR-2 — completion 어댑터 경계

| 옵션 | 설명 | Pros | Cons |
|---|---|---|---|
| **A. 전용 Bun 심 모듈 src/ask-ui/completion.ts (채택)** | pi-ai 값 import를 이 파일에 격리; pure core엔 `CompletionPort` 인터페이스+페이크+래퍼 3곳 주입. | statusbar 선례와 동형(index.ts:1-6이 유일 값 import 홀더); 경계 회귀 테스트로 고정 가능(statusbar-regression.test.ts:31-41 패턴); pure performX/컴포넌트 로직 vitest 유지. | 포트 3곳 동시 추가 규율 필요(Constraint 13). |
| B. ask.ts 래퍼에 인라인 | registerAskTools 래퍼(ask.ts:543-685) 안에서 직접 pi-ai 호출. | 파일 수 최소. | ask.ts는 이미 pure performX와 얇은 래퍼가 공존(ask.ts:17-22) — 값 import가 같은 모듈에 들어가면 performX 테스트가 위태로움; 컴포넌트(pi-tui 값)까지 끌면 경계 붕괴. |

**채택: A.** [C12] 경계가 절대선. 새 디렉터리 `src/ask-ui/`에 completion.ts(pi-ai)·component.ts(pi-tui) 값 import를 모으고, pure core는 포트로만 접근. 기존 statusbar가 정확히 이 형태를 이미 증명(src/statusbar/index.ts:1-6, 5개 pure 모듈 + 1 registrar).

## Import graph (정본)

```text
Node-safe: src/ask-ui/{types,state,render-model,palette,completion-core}.ts
  - @oh-my-pi/* runtime value import 금지; reducer/request builder/error normalizer만 소유.
Bun-only leaves: src/ask-ui/{component,completion,index}.ts
  - component.ts만 pi-tui/coding-agent runtime 값을, completion.ts만 pi-ai runtime 값을 import.
  - index.ts가 두 leaf를 조립해 AskRuntimeFactory를 export.
Wiring: src/main.ts → ask-ui/index.ts; main이 createAskRuntimeFactory(pi)를 registerAskTools(pi, factory)에 주입.
  - src/ask.ts와 모든 Node-safe module은 index/component/completion을 정적·동적으로 import하지 않음.
  - fixture/unavailable branch는 factory를 호출하지 않음.
```

## DR-3 — PR 분해 전략

| 옵션 | 설명 | Pros | Cons |
|---|---|---|---|
| **A. 범프-우선 + 가독성-우선 수직 슬라이스 (채택)** | PR1 범프 hard gate → PR2 가독성 컴포넌트(단독 출하 가능) → PR3 completion 어댑터+원버튼 수직 슬라이스 → PR4 멀티턴/캐시 → PR5 계약+실측. | 각 PR이 독립 검증 가능한 관측 계약; 가독성(정적·저비용)과 채팅(동적·고비용)을 분리(trace Lane 5 §6 "가독성 먼저"); PR2만으로도 사용자 가치(가독성) 출하 가능; 범프 회귀를 PR1 hard gate에서 조기 차단(AC2.1). | PR2↔PR3/PR4가 같은 컴포넌트 파일을 순차 확장. |
| B. 기능-수평(가독성 전체 vs 채팅 전체 2 PR) | 큰 2덩이. | PR 수 최소. | 각 PR이 거대·혼재; 범프 회귀·경계 위반이 늦게 드러남; 리뷰/롤백 단위 과대. |

**채택: A.** 5 PR(3-6 범위). 순서 의존은 실재하나(범프 hard gate→가독성 컴포넌트→completion 수직 슬라이스), 이는 "B가 A의 산출을 요구"하는 진짜 선후 관계라 정당(core interface/스키마 마이그레이션 선행). PR2↔PR3/PR4의 파일 공유는 PR2가 목록 상태기계를, PR3/PR4가 채팅 서브상태를 추가하는 확장 관계로 깔끔히 분리.

## DR-4 — loadMode 배분

| 옵션 | 설명 | Pros | Cons |
|---|---|---|---|
| **A. ask 3종 essential / 13 batch discoverable (채택)** | 대화형 게이트 3종만 top-level 고정, 나머지는 xd:// 마운트. | ask 3종은 인간 게이트라 신뢰성 최우선(essential=top-level, types.ts:539-540); 13종은 현행 운영에서 xd:// 마운트로 동작 관측됨(open-questions.md #1); top-level 표면 최소화(컨텍스트 절약). | 13종 각각에 명시 discoverable 표기 필요(생략 시 기본도 discoverable이나 default-flip 방어를 위해 명시). |
| B. 16종 전부 essential | 전부 top-level 고정. | 단순·최대 신뢰성. | top-level 도구 표면 비대(컨텍스트 비용); xd:// 마운트가 이미 동작하는 13종에 이득 없음; 17.x가 discoverable 기본으로 플립한 설계 의도와 역행. |

**채택: A.** Constraint 2가 ask 3종 essential을 기본선으로 명시. 13 batch 도구는 명시적 `discoverable`(기본과 동일하나 향후 default 변경 방어 + 의도 문서화). 근거: types.ts:539-540(기본 discoverable, essential=top-level), tools/xdev.ts:64-66(isMountableUnderXdev = loadMode==="discoverable"), 현행 xd:// 동작 관측(open-questions.md #1).

## 단일 생존 옵션의 명시적 무효화 (spec 확정분 재확인)

- **askDialog 채택**: 무효 — [C19]/[C8] key-opaque + 로컬 chat 훅 제거로 in-question 채팅 키바인딩(R10)·멀티선택 상태 보존(AC1.3)을 그 위에서 충족 불가. custom<T>가 유일 대안([C3]). spec Non-Goals·R2·R15에서 2회 확정.
- **close-and-reopen(H-D)**: 무효(리더 아님) — 질문 상태 유실 리스크·"in-question" 체감 상실(trace §3). 단 설계 노트로 잔존.
- **경량 모델 라우팅·비용 상한**: 무효 — R8 세션 모델·무상한 확정(사용자 자율 우선, 리스크 명시 수용).
- **글자 확대(OSC 66)**: 무효 — [C17] kitty 전용 생태계, R12 미채택. 크기감은 위계로.
- **메인 턴 캐시 프리픽스 히트**: 무효 — [C18] 호스트 비공개 변환 바이트 동일성 재현 불가. 사이드챗 내부 캐시로 대체.
