# Appendix — Expanded Test Plan (deliberate mode)

> Core 요약은 `plan.md` §AC Coverage Matrix. 여기는 층위별 상세. 클레임 [Cn] = claims.json 순서.
> lets-craft는 vitest 사용(package.json:21). 스냅샷은 ANSI 문자열 고정.

## Unit (vitest-on-Node, 포트 페이크)

| # | 대상 | 검증 | AC |
|---|---|---|---|
| U1 | envelope 합성 (ask.ts:75-107) | `User selected:`/free-answer sentinel 문법이 채팅 발생 여부와 무관하게 동일 | AC1.4, AC2.2 |
| U2 | details.sideChat 스키마 | 채팅 발생 시 turns[] 필드(target/mode/prompt/response/model/startedAt/endedAt/status[/error]) 채워짐; 미발생 시 필드 부재 | AC1.4 |
| U3 | CompletionPort 요청 형태 + 캐시 수명 | systemPrompt 비공백, tools 미제공(no-tools), messages에 getBranch 스냅샷+질문/옵션 포함, promptCacheKey=메인ID, sessionId=`{main}:side:{nonce}`, cacheRetention 마커 전달; **request2.messages의 request1 길이 prefix가 provider-ready 구조로 deep-equal이고, sessionId/promptCacheKey/cacheRetention이 동일하며 getBranch call count가 1임을 검증** (plan §PR3 캐시 수명 정본) | AC6.1 |
| U4 | 실패 계약 + redactor | plan §PR2 Fallback/Failure 계약: provider 에러(stopReason error/aborted)·resolver reject·iterator/render update 예외 전부 terminal state event로 변환(side error state, 도구 결과 비오염); side failure/abort/retry는 custom done 미호출; **pure redactor adversarial 벡터 3종 — ①`Bearer <token>` 헤더 문자열 ②`sk-` 프리픽스 API key ③URL-embedded key(`?api_key=...`)를 포함한 에러 문자열이 details.sideChat.error에 원문 저장되지 않음** | AC4.1, AC4.2 |
| U5 | loadMode 값 | 3 ask 도구 정의에 essential, 13 batch 도구에 discoverable — **검증 방법: 도구별 기존 capture 스위트에 loadMode assert 1줄씩 추가**(registerAskTools(pi, factory) 시그니처 변화와 무관하게 동작) | AC2.4 |
| U6 | palette role→ANSI | **9역할**(질문 제목/옵션 label/포커스 label/옵션 설명/푸터/채팅 질문/채팅 답변/에러/**보더**)이 isLight별로 지정 SGR 산출; 256 index는 24-bit SSOT role table에서 결정론적 근사 함수로 파생 | AC5.1, AC5.2 |
| U7 | 키맵 디스패치 | `?`=one-button, `t`=chat, `/`=search, ↑↓=nav, Space=토글(multi), Esc=단계적(plan §PR2 상태 전이 정본) | AC1.1, AC1.2 |
| U8 | 상태 보존 | 채팅 왕복 후 checkedIndices·cursor 필드 불변 | AC1.3 |
| U9 | 상태 전이표 reducer | plan §PR2 상태 전이 정본의 각 전이: question header=canonicalCursor=-1 focus target(첫 option Up→question, question Down→첫 option, header Enter/Space no-op, header ?/t 작동); ask 모드 printable ?/t=editor 입력, Esc 1회=draft/cursor 보존 header 이동, header ?/t=side chat, Enter/Down=editor 복귀, header Esc 2회째=취소; side panel 종료 시 returnMode 복귀; **마운트 시 초기 포커스는 recommended ?? 0의 옵션 행(question header 아님)**; view 전환이 outer owner를 재생성하지 않음 | AC1.1, AC1.3 |
| U10 | Host parity reducer | initialIndex/recommended, radio/checkbox, checkedIndices, markableCount, Other/Done, fuzzy search(label+description filter, original-index mapping, checked state, empty result, backspace/clear, Esc-to-browse), scroll, cancel — 각각 reducer test | AC1.3, AC3.2 |

## Integration (pure reducer/render-model/completion-core + 포트 페이크, 라이브 completion 없이)

| # | 시나리오 | AC |
|---|---|---|
| I1 | select(single/multi)·confirm·ask 각각: 옵션/질문 지정→원버튼 상세→답변 표시→목록 복귀 | AC1.1 |
| I2 | 같은 패널 자유 프롬프트 멀티턴→Esc 종료→목록 복귀 | AC1.2 |
| I3 | 멀티선택 체크+커서 보존(왕복 후) | AC1.3 |
| I4 | plan §PR2 Fallback/Failure 계약 준수: provider 에러/Esc(abort)/resolver 실패/iterator 예외 → side error state로 흡수, 질문 생존·목록 복귀·재응답 가능, 패널 내 에러 표기+재시도; stale activeTurnId delta 무시; failure/abort/retry에서 custom done 미호출(최종 answer/cancel만 done); 결과 비오염 | AC4.1, AC4.2 |
| I5 | fallback 판별(plan §PR2 계약): hasUI=false는 기존 하드에러 — **헤드리스(hasUI=false, fixture 없음) HEADLESS_ERROR 유지 케이스 명기(기존 스위트와 중복 허용)**; hasUI=true에서 custom 함수 부재 또는 factory 미시작 상태 custom promise `undefined` resolve일 때만 legacy ctx.ui.select/editor 폴백으로 질문 성립; factory 시작 뒤 오류는 폴백으로 숨기지 않음; 폴백(ctx.ui.editor) 경로는 현행 1단 Esc 유지 | AC2.3 |
| I6 | LSC_FIXTURE 모드→채팅 어포던스 원천 비노출, 스크립트 응답 현행 동일; **custom factory와 CompletionPort 호출 수 모두 0** | AC2.2 |
| I7 | destructive production-seam parity: registered `lsc_confirm` capture(test/destructive-approval.test.ts:155-163 선례) — (a) side response가 literal `yes`여도 final No/free/cancel은 approval 미발급, (b) side failure/abort 뒤에도 approval 없음, (c) final confirmed true만 기존 단일 approval 발급; `src/ask.ts:630-681`의 capture-before-await·stale-yes revoke·identity/scope check·persist-before-install 흐름은 details 타입 확장 외 무변경(수정 금지 영역) | AC1.4, AC4.1 |

## Snapshot / Render (ANSI 고정, 결정론)

| # | 조건 | 검증 | AC |
|---|---|---|---|
| R1 | 옵션 4개 × SSOT 상한 설명 | 포커스 옵션 설명 전문 접근(내부 스크롤), ANSI 위계 스냅샷 | AC3.1, AC5.1 |
| R2 | 동 조건 | 비포커스 옵션 label+설명 첫 줄 유지, 목록 스크롤 접근, '소실' 없음 | AC3.2 |
| R3 | 소형 터미널(24행) | R1·R2 성립 | AC3.3 |
| R4 | isLight=true / false | 모드별 팔레트 적응 스냅샷(대비 유지) | AC5.2 |
| R5 | 임의 출력 | OSC 66/DECDWL 등 크기 시퀀스 부재 assert | AC5.3 |
| R6 | 채팅 패널 열림(원버튼 답변 표시 상태) × isLight true/false | 채팅 질문/채팅 답변/에러/보더 역할 위계 ANSI 스냅샷(pure render-model 경유) | AC5.1, AC5.2 |

주: ANSI 스냅샷은 **색 코드 회귀 증거**이고, 대비 수치는 **명시한 reference light/dark background에 대한 proxy**다 — 실제 미지 host background 전체에 대한 증명이 아니다.

## Bun Adapter (PR5 게이트)

러너: `bun test`(omp 런타임과 동일 Bun 툴체인)로 신규 `test-bun/` 디렉터리에서 실행한다(vitest 기본 `test/` glob 밖이라 무인 CI와 격리). package.json에 `"test:bun": "bun test test-bun"` 스크립트를 추가한다. B1-B3는 무인 CI가 아니라 PR5 게이트+craft 라이브 단계(O1/E1과 동급)에서 실행하며, 실패는 PR5 미통과다.

| # | 대상 | 검증 |
|---|---|---|
| B1 | `src/ask-ui/index.ts` | 실제 import → AskRuntimeFactory instantiate → render → done 왕복 실행 |
| B2 | `src/ask-ui/completion.ts` | pi-ai stream event→state wiring(text_delta 소비→상태 반영) |
| B3 | fallback | RPC-style `custom()→undefined`(함수 존재+undefined resolve) 시 legacy fallback 실행 확인 |

## E2E (LSC_FIXTURE 전 파이프라인)

| # | 시나리오 | AC |
|---|---|---|
| E1 | 17.0.5 범프 후 기존 전 스위트 green + 전 모듈 컴파일 + **PR1 hard gate의 real plugin boot/loadMode smoke(npm published 17.0.5 omp에서 built plugin 부팅 → ask 3종 essential 직접 노출 + 대표 batch tool 1개 `xd://` discoverable 실행)** | AC2.1, AC2.4 |
| E2 | fixture 모드 무인 실행: 채팅 비노출, 스크립트 응답 현행과 동일 | AC2.2 |

## Observability (craft 라이브, 상시 아님)

| # | 절차 | 기록 | AC |
|---|---|---|---|
| O1 | craft 초기 스파이크: resolver 인증 + completeSimple/stream 라운드트립 + custom→done→재select | craft 로그(티어1 격상 증거) | trace §9 |
| O2 | 캐시 실측: 2턴 이상 사이드챗 — **cache_creation(가능한 provider)과 두 번째 turn cache_read_input_tokens>0을 기록. telemetry 부재 또는 값 0은 구조 테스트(U3) 통과와 별개로 AC6.2 미충족이며 증거 성공으로 기록하지 않는다(fail-closed)** | 증거 파일(appendix-cache-probe 절차) | AC6.2 |

## 회귀 가드(신규)

- ask-ui 경계 회귀 테스트: "src/ask-ui/* 전체가 값-import 없음"이 아니라 **허용 leaf 2개(component.ts=pi-tui/coding-agent 값, completion.ts=pi-ai 값)만 값 import를 갖고, pure 모듈(types/state/render-model/palette/completion-core)과 ask.ts에서 leaf(index/component/completion)로 가는 import edge가 없음**을 검사한다(statusbar-regression.test.ts:31-41 패턴 확장, [C12]).
