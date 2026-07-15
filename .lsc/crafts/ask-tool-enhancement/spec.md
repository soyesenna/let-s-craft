# Spec — ask-tool-enhancement

## Metadata

| 항목 | 값 |
|---|---|
| Feature | ask-tool-enhancement — lsc_ask/lsc_select/lsc_confirm 고도화 |
| 분류 | Brownfield (trace 확정, src/ask.ts 303행 직접 확장) |
| 공식 | ambiguity = 1 − (goal×0.35 + constraints×0.25 + criteria×0.25 + context×0.15) |
| 최종 ambiguity | **0.045** (게이트 0.05 통과, 12라운드) |
| Challenge modes | contrarian@R4, simplifier@R6 (각 1회 발동) · ontologist 미발동(R8 시점 ambiguity 0.12 < 0.3) |
| 환경 고정 | repo c39a725 기반 feat/ask-tool-enhancement, SDK @oh-my-pi/pi-coding-agent 16.4.0 |
| 작성일 | 2026-07-14 |

## Clarity Breakdown (최종)

| Dimension | Score | Weight | Weighted | 근거 |
|---|---|---|---|---|
| Goal | 0.97 | 0.35 | 0.340 | 산출물 집합·반환 계약·경계 전부 확정 |
| Constraints | 0.96 | 0.25 | 0.240 | 무조건성·상한·클린 컷·non-goal 확정 |
| Criteria | 0.95 | 0.25 | 0.238 | AC 10항목 사용자 확정(R12) |
| Context | 0.92 | 0.15 | 0.138 | trace 3-lane + 리서치 14워커가 시스템 맥락 제공 |

## Topology (sub-components)

| ID | 컴포넌트 | 소유 파일/문서 | 최종 컴포넌트 점수(G/C/Cr) |
|---|---|---|---|
| A | 도구 스키마·UI 흐름 | src/ask.ts (3도구 재구성) | 0.98 / 0.96 / 0.95 |
| B | fixture·소비자 계약 | src/fixtures.ts, fixtures/sample-ts-cli/answers.json, skills/*/SKILL.md, README.md | 0.96 / 0.96 / 0.95 |
| C | description 품질 가이드 | 도구 스키마 annotation(zod .describe), SKILL.md 작성 가이드 | 0.95 / 0.95 / 0.93 |

라운드별 타깃 로테이션: A(R1)→B(R2)→A(R3)→A(R4 contrarian)→전역(R5)→A(R6 simplifier)→B(R7)→A(R8)→A(R9)→A(R10)→C(R11)→전역(R12). `topology.last_targeted_component_id = 전역(R12)`.

## Goal

lets-craft의 사용자 질문 도구 3종을 다음과 같이 재구성한다: **모든 질문에서 사용자가 제시된 선택지 대신 자유 답변으로도 응답할 수 있고**(끄는 방법 없음), **선택지는 짧은 label과 상세 description으로 분리되어** description이 그 선택지를 제안한 배경과 장단점을 쉬운 언어로 설명하며, **응답은 선택과 자유답변을 구조적으로 구분하는 형태로** 파이프라인에 돌아온다.

핵심 엔티티와 관계 (한 문장 각):
- **lsc_select**: options 2-4개 `{label, description}` + `multi?` + `recommended?`(인덱스)를 받아, TUI select(자유입력 진입 옵션 자동 append) → 선택 또는 editor 자유입력 → `{selections[], freeText?}` 구조 반환.
- **lsc_confirm**: select 기반으로 재구성된 yes/no 게이트 — Yes/No/직접 입력 3진, `{confirmed, freeText?}` 구조 반환.
- **lsc_ask**: `ctx.ui.editor`(멀티라인) 승격, `placeholder` → `prefill`로 대체.
- **fixture v2**: 신 스키마 전용(클린 컷) — 선택·자유답변·yes/no를 명시 표현, select 게이트 catch-all 결함 해소.
- **작성 가이드**: description 품질 규칙(배경+장단점+쉬운 언어)을 스키마 annotation과 SKILL 가이드 2계층에 인코딩.

## Constraints

1. **자유답변 무조건 상시 제공** — 비활성 플래그를 스키마에 만들지 않는다(opencode 모델). 오독 위험은 구조체 반환 + 스킬 분기 규칙으로 방어한다. (R4, contrarian 생존)
2. **옵션 수 2-4 스키마 강제** (zod `.min(2).max(4)`) — description 가시성(compact 모드 물리 제약, O23) 보장. 초과 필요 시 질문 분할 또는 자유답변 흡수. (R10)
3. **recommended는 표시 + 초기 커서만** — " (Recommended)" 표시는 append-then-strip 원자 패턴(C17), timeout 자동선택 없음, 무한 대기가 기본. (R8)
4. **혼합 응답 병기 직렬화** — multi에서 checked 옵션과 freeText가 공존하면 둘 다 직렬화한다. 벤더 formatQuestionResult의 customInput-우선 checked-누락 결함(O56)을 복제하지 않는다. (R6 파생)
5. **description은 표시 전용** — fixture 매칭·분기 로직에 절대 참여하지 않는다(매칭은 label로만). (trace 제약)
6. **fixture 클린 컷** — 구 포맷(response 단일 문자열 계약)은 명확한 마이그레이션 에러로 거부, repo 내 fixture 일괄 갱신, README 재작성. (R7)
7. **질문 태깅 규약 유지** — 태그 prefix + `Proceed?` 계열 suffix 규약(§1.2)은 불변(fixture 질문 매칭의 안전 지대, C18).
8. **순수 코어/래퍼 분리 유지** — performX 순수 함수 + registerAskTools 래퍼 패턴, TS2589 회피용 명시적 타입 인자 관례 유지(기존 코드베이스 관례).
9. **언어 중립 톤** — description 언어는 사용자 언어를 따르고, 경어체(합쇼체/해요체 등)는 강제하지 않되 한 세션 내 통일만 요구. (R11)
10. **description 작성 규칙(2계층 인코딩)** — 구조: [WHAT 한 문장]+[WHY 제안 배경]+[장점:/단점: 병기]; 균형 프레이밍(감정어·정답 암시 금지); 파트당 1-2줄 상한; 쉬운 언어(영 15항목·한 10항목 규칙 — 전문용어는 버리지 않고 괄호 인라인 정의); label은 description 없이도 자명. (C14+O59)

## Non-Goals

- 호스트 SDK/벤더(oh-my-pi) 변경 — 외부 의존성, ctx.ui 프리미티브 계약을 그대로 사용.
- timeout/auto-continue/자동선택 — 게이트 자동 승인 위험(R8에서 명시 배제).
- 자유답변 비활성 플래그 — R4에서 명시 배제.
- `preview`·`header` 필드 — 호스트 ctx.ui.select 미지원(O1), 도입 불가로 종결.
- `custom<T>()` bespoke 단일 위젯 — 선행 없음(C12), 조합 패턴(Other→editor) 채택으로 배제.
- MCP elicitation 경유 노출 — per-option description 전달 불가(O51), 경계 제약으로만 기록.
- 구 fixture 포맷 하위 호환 — 클린 컷(R7).
- RPC/ACP 프론트엔드의 description 표시 보장 — 실사용 경로(interactive TUI + fixture) 밖(C9).

## Acceptance Criteria (R12 사용자 확정, 10항목)

1. **lsc_select 신스키마**: options 2-4개 `{label: string, description: string}`(zod 강제, description 필수 + 작성 규칙 annotation), `multi?: boolean`, `recommended?: number`(유효 인덱스).
2. **자유답변 무조건 상시**: 자유입력 진입 옵션이 항상 자동 append되고(호출자가 직접 넣으면 안 됨 — 도구가 거부 또는 문서로 금지), 선택 시 `ctx.ui.editor` 체인, editor Esc는 select 복귀(질문 취소는 select Esc만).
3. **구조체 반환**: `details = {selections: string[], freeText?: string, source}` + content 텍스트는 선택·자유입력을 병기 직렬화(예: "User selected: …" / "User provided free answer: …" 두 줄 병기, 멀티라인 들여쓰기). multi에서 checked+freeText 공존 시 둘 다 보존.
4. **lsc_confirm 재구성**: select 기반(Yes/No/직접 입력), `details = {confirmed: boolean | null, freeText?: string, source}` — 자유답변 시 confirmed는 null(스킬이 분기 규칙으로 처리).
5. **lsc_ask editor 승격**: 멀티라인 입력, `placeholder` 파라미터 제거 및 `prefill`로 대체(TUI dead-param 해소).
6. **recommended**: " (Recommended)" 표시 접미사가 반환 값에 절대 오염되지 않음(append-then-strip 검증), 초기 커서가 recommended 위치, timeout 자동선택 없음.
7. **fixture v2**: (a) 자유답변을 표현하는 명시 필드, (b) select 게이트용 응답 표현(catch-all "yes"의 select 매칭 실패 해소 — [Consensus Escalation]류 규칙 표현 가능), (c) 구 포맷 감지 시 마이그레이션 안내를 포함한 명확한 에러, (d) fixtures/sample-ts-cli/answers.json 갱신.
8. **소비자 co-evolution**: 스킬 3종 SKILL.md — 게이트 질문의 자유답변 분기 규칙(예: [Land]에서 freeText → 승인 아님, 지침으로 해석 후 재확인), post-craft §2.5 브랜치 선택의 "후보 ≤4 + 직접 입력" 패턴, lsc_select 옵션 리터럴의 {label, description} 구조화; README.md fixture 절 재작성.
9. **description 품질 게이트**: 작성 체크리스트(WHAT/WHY/장점:/단점: 구조, 균형, 파트당 1-2줄, 쉬운 언어 영15+한10, 사용자 언어·세션 내 톤 통일, label 자명성)가 (a) zod `.describe` annotation과 (b) SKILL 가이드 문서에 인코딩되어 있음 — 리뷰로 검증.
10. **검증 3계층**: (a) 단위 — 신스키마 매칭(resolveSelectOption 후속)·직렬화·구조체 반환·구포맷 거부 에러, 기존 ask/fixtures 테스트의 신스키마판 red→green; (b) E2E — select 게이트 발화 fixture 시나리오 + 기존 E2E 스위트 무파손; (c) TUI 스모크 — 실제 omp 세션에서 3도구의 description 렌더링·자유답변 흐름 육안 확인.

## Assumptions Exposed & Resolved

| 가정 | 노출 방식 | 해소 |
|---|---|---|
| "UI가 못 해서 기능이 없다" | trace 전제 감사(Lane 3) | 반증 — SDK는 이미 {label, description} 지원, 좁힌 건 플러그인 3지점(C1/C4). gap은 구현 부재 |
| "자유답변 추가는 additive" | trace 소비자 감사(O19) | 반증 — 최소 4개 소비자 계약 변경 필수 → AC8 co-evolution이 범위에 포함 |
| "자유답변은 항상 좋다" | R4 contrarian | 생존 — 무조건 제공 확정, 방어는 구조체 반환+스킬 분기 규칙(플래그 없음) |
| "recommended = 벤더처럼 timeout 자동선택" | R8 | 분리 — 표시+커서 전용, 파괴적 게이트 자동 승인 차단 |
| "벤더 동급 = 벤더 그대로 복제" | R6 파생 | 벤더의 다중질문 checked-누락 결함(O56)은 명시적 회피 대상(Constraints 4) |
| "placeholder가 사용자에게 힌트를 준다" | 리서치 O25 | 반증(TUI dead param) — R9에서 editor prefill로 이전 |
| "옵션은 많을수록 친절" | R10 + C14 단서 | 반증 — 과부하=정보량×옵션 수, compact 모드가 description을 숨김 → 2-4 강제 |
| "post-craft 브랜치 선택은 옵션 수 제한과 충돌" | R10 파생 분석 | 자유답변 채널이 흡수 — "후보 ≤4 + 직접 입력" 패턴(AC8) |
| "fixture는 지금 잘 동작한다" | Tier-1 실험(C5) | 반증 — select 게이트 잠재 결함 실재, R2에서 해소를 범위에 포함 |
| "설명은 상세할수록 좋다" | countersearch(C14 단서) | 단서 부착 — 파트당 1-2줄 상한, 비중복 정보만 |

## Technical Context

- **호스트 역량(확정)**: `ctx.ui.select(title, ExtensionUISelectItem[], dialogOptions?)`가 `{label, description?}` 수용, TUI가 description을 마크다운·자동 줄바꿈·ellipsis로 렌더링(compact 모드: 목록이 maxVisible 초과 시 커서 옵션만 description 표시). `ctx.ui.editor(title, prefill?)`가 멀티라인 모달. `dialogOptions.selectionMarker/checkedIndices/markableCount`로 라디오/체크박스 + trailing 제어행. confirm 프리미티브는 boolean 전용(재구성 근거). — trace §3, C1/C2/C8, O21-O27.
- **참조구현**: 벤더 ask 도구(oh-my-pi/packages/coding-agent/src/tools/ask.ts) — OTHER_OPTION append(:564), editor 체인(:602), append-then-strip(:144), editor Esc→select 복귀(:537,:606), 혼합 직렬화(:825-843). 단 builtin/hardwired라 재사용 불가(O32) — 패턴만 차용.
- **좁힘 3지점(변경 표면)**: zod 스키마(src/ask.ts:271), AskUI/SelectUI/ConfirmUI 포트(:46-48,:84-86,:186-188), resolveSelectOption(:120-134). + FixtureAnswerRule(src/fixtures.ts:18-35).
- **소비자 지도**: post-craft disposition 게이트(SKILL.md:163-174)·pre-craft [Consensus Escalation](:281-283) — 정확 라벨 분기(HIGH); parseYesNo·resolveSelectOption — 에러 처리(MEDIUM); 브랜치 선택(LOW); 인터뷰(LOW-MEDIUM). — O19.
- **잠재 결함**: answers.json의 `proceed\??$`→"yes" + default "yes"는 select 게이트에서 resolveSelectOption=undefined → hard error(Tier-1 실험 + 직독, C5/O11/O53). 이번 fixture v2가 해소.
- **기존 테스트 지도**: test/ask.test.ts:94-234(performSelect 8 + resolveSelectOption 10), fixtures.test.ts — 신스키마 red-test의 기준선(trace §9 주 probe).

## Trace Findings

`trace.md` 참조 — 최유력 설명(4계층 동시 이행: widening + Other→editor 조합 + 계약 co-evolution + 지시 계층 인코딩), critical unknown 3건은 인터뷰 R1-R3에서 전부 해소됨. 전체 인용 트레일: `research/SYNTHESIS.md`(클레임 C1-C18 countersearch 잠금).

## Ontology

최종 엔티티(21): lsc_select(신스키마) · lsc_confirm(select 재구성) · lsc_ask(editor 승격) · option{label, description} · 자유답변 채널(editor 체인) · 응답 구조체{selections, freeText} · 자유답변 무조건성(불변식) · recommended(표시 전용) · multi-select 모드 · 옵션 상한(2-4) · fixture 스키마 v2 · fixture freeText 표현 · select 게이트 fixture 규칙 · 구포맷 거부 에러 · 스킬 게이트(disposition/escalation) · 게이트 자유답변 정책 · 작성 가이드(2계층) · 톤 규칙(세션 내 통일) · 수용 3계층 · prefill 파라미터 · 질문 태깅 규약(불변).

CORE 개념: **응답 구조체{selections, freeText}** — 모든 결정(R1)이 여기서 파생됐고, 나머지 엔티티는 이를 만들거나(A), 소비하거나(B), 채우는 내용의 품질을 다룬다(C).

## Ontology Convergence

| Round | Entity Count | Stable | Changed | New | Removed | Stability Ratio |
|---|---|---|---|---|---|---|
| 1 | 9 | — | — | 9 | 0 | N/A |
| 2 | 11 | 9 | 0 | 2 | 0 | 0.82 |
| 3 | 12 | 10 | 1 | 1 | 0 | 0.92 |
| 4 | 13 | 12 | 0 | 1 | 0 | 0.92 |
| 5 | 14 | 13 | 0 | 1 | 0 | 0.93 |
| 6 | 16 | 14 | 0 | 2 | 0 | 0.875 |
| 7 | 17 | 15 | 1 | 1 | 0 | 0.94 |
| 8 | 18 | 17 | 0 | 1 | 0 | 0.94 |
| 9 | 19 | 17 | 1 | 1 | 0 | 0.95 |
| 10 | 20 | 19 | 0 | 1 | 0 | 0.95 |
| 11 | 21 | 20 | 0 | 1 | 0 | 0.95 |
| 12 | 21 | 21 | 0 | 0 | 0 | **1.00** |

Changed 엔티티 이력: R3 lsc_confirm→confirm-as-select(재구성), R7 fixture 규칙→fixture 스키마 v2(클린 컷), R9 lsc_ask→ask-as-editor — 전부 rename/retype으로 stability에 가산.

## Interview Transcript

3-point injection: Override 1(최유력 설명 보강 — 저신뢰 분기 미적용), Override 2(trace 종합 = 코드베이스 컨텍스트), Override 3(critical unknown 3건 = R1-R3).

| R | 태그/모드 | 질문 요지 | 답변 | ambiguity(후) |
|---|---|---|---|---|
| 1 | [Goal] 주입#1 | 자유답변의 반환 계약: 라벨 치환 vs 구조체 vs 혼합 | **구조체 반환** — {선택 라벨, 자유 텍스트} 구분, 소비자 전면 개정 | 0.388 |
| 2 | [Constraints] 주입#2 | fixture 개정 범위: 전체(결함 해소 포함) vs 확장만 vs 최소 | **전체 포함** — fixture 스키마 완성형 | 0.343 |
| 3 | [Goal] 주입#3 | "모든 질문" 경계: confirm 포함 vs 제외 vs 절충 | **confirm도 포함** — select 기반 재구성(Yes/No/직접 입력) | 0.298 |
| 4 | [Constraints] CONTRARIAN | 자유답변이 무조건이어야 하나? (파괴적 게이트 오독 위험 vs 형해화) | **무조건 상시** — 플래그 없음, 구조체+스킬 분기로 방어 | 0.268 |
| 5 | [Success Criteria] | 완료 검증선: 자동화만 vs +스모크 vs +품질 게이트 | **자동화+스모크+품질 게이트** (3계층) | 0.180 |
| 6 | [Constraints] SIMPLIFIER | 최소 가치 버전: 미니멀 vs recommended만 vs 풀 스펙 | **풀 스펙** — recommended+multi (벤더 동급) | 0.150 |
| 7 | [Success Criteria] | 구 fixture 포맷: 하위 호환 vs 클린 컷 | **클린 컷** — 전면 개정, 구 포맷 명확 에러 | 0.120 |
| 8 | [Goal] | recommended 의미론: 표시 전용 vs timeout 자동선택 vs 호출자 선택 | **표시+초기 커서만** — 무한 대기 기본 | 0.095 |
| 9 | [Goal] | lsc_ask 처리: editor 승격 vs 불변 vs placeholder만 정리 | **editor 승격** — placeholder→prefill | 0.088 |
| 10 | [Constraints] | 옵션 수 상한: 2-4 강제 vs 2-5 vs 상한 없음 | **2-4 스키마 강제** | 0.073 |
| 11 | [Constraints] | 한국어 경어체 톤: 합쇼체 vs 해요체 vs 중립 | **언어 중립** — 세션 내 통일만 | 0.065 |
| 12 | [Success Criteria] | AC 10항목 총체 확정. Proceed? | **yes** | **0.045 ✓** |

각 라운드에서 점수표(Dimension/Score/Weight/Weighted/Gap)·병목 1문장·weakest_component 로테이션을 채팅에 표시하고 lsc_select(11회)/lsc_confirm(1회)로 질의함. 질문은 전부 §1.2 태깅 규약 준수.
