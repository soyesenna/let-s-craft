# Appendix — Pre-mortem (deliberate mode)

> Core 요약은 `plan.md` §DR. 5개 실패 시나리오와 완화. 클레임 인용 [Cn] = `research/claims.json` 순서.

## S1 — SDK 17.0.5 범프가 컴파일/런타임을 깬다

- **가정 실패:** 16.4.0→17.0.5 델타가 추가형이라던 판정([C11])이 틀려 기존 코드가 컴파일 실패하거나, 17.0.0 registerTool 데모션 버그가 17.0.5에도 잔존.
- **관측 신호:** `tsc` 타입 에러, 또는 도구가 런타임에 노출/실행 안 됨.
- **완화:** (a) 17.0.5 고정(17.0.0 버그 회피, [C11]); (b) PR1을 compile+기존 suite green 게이트로 격리(AC2.1); (c) 16종 전부 loadMode 명시(default-flip 방어); (d) vendored oh-my-pi(17.0.5 동가, HEAD 39c95e5e)로 시그니처 사전 재확인 완료 — stream/completeSimple/StreamOptions·resolver·getBranch·custom<T> 파괴 변경 0건(plan.md §Context 표).

## S2 — Bun/Node 경계 위반으로 전 테스트 스위트 로드 실패

- **가정 실패:** 새 pi-ai/pi-tui 값 import가 vitest-도달 모듈(performX 또는 그 import 그래프)로 누출.
- **관측 신호:** vitest 수집 단계에서 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX([C12]).
- **완화:** (a) 모든 값 import를 src/ask-ui/completion.ts·component.ts에 격리(pure core는 포트); (b) statusbar 선례 준수(src/statusbar/index.ts:1-6 유일 값 import 홀더); (c) 경계 회귀 테스트 추가(test/statusbar-regression.test.ts:31-41 패턴을 ask-ui에 복제) — CI가 경계 붕괴를 즉시 잡음.

## S3 — 사이드챗이 메인 세션 캐시/CONTENT를 오염

- **가정 실패:** side 호출이 메인 sessionId 재사용 → OpenAI/Codex 프리픽스 오염([C18]); 또는 채팅 텍스트가 envelope로 새어 게이트 재진입 유발([C7] §1.2(c)).
- **관측 신호:** 메인 세션 캐시 이상, 또는 도구 결과 CONTENT에 채팅 문자열 출현 → reflect-and-reask 루프/destructive gate 오파싱.
- **완화:** (a) 고유 side sessionId `{main}:side:{nonce}`, promptCacheKey=메인 세션ID 시드(Constraint 16, [C18]); (b) 채팅은 details.sideChat에만 기록, envelope 합성 코드(ask.ts:75-107) 무변경; (c) 단위 테스트로 envelope 불변 + details.sideChat 분리 고정(AC1.4/AC2.2).

## S4 — custom<T> 미지원 환경에서 질문 사망

- **가정 실패:** RPC/ACP/print 등에서 custom<T>가 스텁이라 컴포넌트 마운트가 성립하지 않음 — 실측: RPC context는 `hasUI=true`로 주입되지만(rpc-mode.ts:889-890) `custom()`이 존재한 채 `undefined`를 resolve한다(rpc-mode.ts:816-819). 즉 `typeof custom === "function"` 검사는 capability 판별이 아니다.
- **관측 신호:** 비인터랙티브 세션에서 질문 hang 또는 크래시, 혹은 custom promise가 `undefined`로 조용히 resolve.
- **완화(plan §PR2 Fallback/Failure 계약 — unsupported-before-mount와 runtime failure-after-mount를 구분):** (a) custom result는 `undefined`를 정상 결과로 사용하지 않는 discriminated union; hasUI=false는 기존 hard error 유지; hasUI=true에서 custom 함수 부재, 또는 factory가 시작되지 않은 채 custom promise가 `undefined`로 resolve될 때만 legacy ctx.ui.select/editor로 fallback(Constraint 10, AC2.3); (b) factory 시작 뒤의 render/completion 오류는 fallback으로 숨기지 않고 side error state로 흡수; (c) 폴백 판별 통합 테스트(AC2.3, I5 — B3가 RPC-style `custom()→undefined` 경로를 Bun에서 실행).

## S5 — 라이브 BYO completion 인증이 런타임에 실패 (Critical Unknown 1)

- **가정 실패:** 타입·예제상 성립하나([C2][C13]) 실제 registered tool handler에서 resolver 인증/completeSimple가 429/OAuth 회전/런타임 사유로 실패(trace §8-1, 티어2 미검증).
- **관측 신호:** craft 초기 스파이크에서 completion 예외/빈 응답.
- **완화(plan §PR2 Fallback/Failure 계약 — side-turn runner가 모든 비동기 실패를 state event로 흡수):** (a) craft 초기 20-30행 스파이크로 티어1 격상(trace §9) — 패널 구축 전에 검증; (b) 각 side turn은 AbortController+monotonic activeTurnId를 갖고 모든 resolver/iterator/render update 예외를 terminal state event로 변환 — Esc/dispose는 abort, stale id delta 무시, side failure/abort/retry는 custom done 미호출(최종 answer/cancel만 done) → 실패해도 질문 생존·목록 복귀(AC4, U4/I4); (c) provider/resolver error는 pure redactor를 통과한 뒤에만 details.sideChat.error에 저장(에러 이원의 정본 선례: [C13], completion-bridge.ts:124-164).

## 추가 리스크 상수 (trace §9)

- BYO 라이브 = 티어2 → craft 초기 스파이크로 격상 권고.
- 캐시 실효 = craft 1회 실측(AC6.2, appendix-palette-and-prompts.md §캐시 실측).
- 17.0.5 범프 회귀 = AC2.1 게이트.
