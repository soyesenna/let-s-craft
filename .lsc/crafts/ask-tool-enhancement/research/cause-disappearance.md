# Cause Disappearance — 배제된 대안 설명과 배제 근거

이 파일은 조사 중 진지하게 검토되었으나 증거로 배제된 설명을 기록한다 (부활 방지).

## D1. "SDK UI 프리미티브가 title/description을 지원하지 않아서 새 렌더링 계층이 필요하다" — 배제
- 배제 근거: O1/O2/O18/O22 — ExtensionUISelectItem이 {label, description?}을 네이티브 수용, TUI 렌더링(마크다운+wrap+ellipsis+compact)까지 전 스택 확인. 3개 독립 워커가 동일 결론.
- 남는 것: 플러그인 자신의 3개 좁힘 지점(C4)만 넓히면 됨. 새 UI 계층 불필요.

## D2. "하니스 내장 ask 도구를 확장에서 직접 재사용하면 된다" — 배제
- 배제 근거: O32 — AskTool은 builtin/hardwired(tools/index.ts:453), 확장 재사용 API 아님. subpath export는 비공식/비semver.
- 남는 것: 참조구현으로만 사용(패턴 차용: OTHER_OPTION append, editor 체인, append-then-strip).

## D3. "자유답변 추가는 순수 additive 기능이라 소비자 영향 없음" — 배제
- 배제 근거: O19 — 정확 라벨 분기 소비자 2곳(HIGH) + 에러 처리 소비자 2곳(MEDIUM). O11/O53 — fixture는 이미 select 게이트에서 깨질 수 있는 상태.
- 남는 것: 응답 계약(자유텍스트 유입 시 스킬 분기/fixture 스키마)의 co-evolution이 필수 범위.

## D4. "ctx.ui.select가 자유입력을 지원하도록 SDK를 고치거나 기다려야 한다" — 배제
- 배제 근거: O42 — 업계 전반(CLI 라이브러리 전부, inquirer core 명시 거부)이 프리미티브 수준 자유입력을 제공하지 않음; O3/O18 — 도구 레벨 조합(Other append → editor)이 검증된 관례이고 호스트 자신이 그렇게 구현.
- 남는 것: lets-craft도 도구 레벨 조합으로 구현 (SDK 변경 불필요·불가 — SDK는 외부 의존성).

## D5. "gemini-cli처럼 질문 타입(choice/text/yesno)을 분리하면 깔끔하다" — 배제
- 배제 근거: O50 — 타입 분리는 한 질문에서 선택지와 자유입력의 병존을 구조적으로 불가능하게 함 → 요구 (1) '모든 질문에 자유 답변 칸'과 정면 충돌.
- 남는 것: opencode의 custom-default-true / Claude Code의 UI 자동 Other 주입 계열이 요구에 부합.

## D6. "placeholder로 자유입력 힌트를 주면 된다" — 배제
- 배제 근거: O25 — placeholder는 interactive TUI에서 렌더링되지 않는 dead param.
- 남는 것: 힌트는 title 문자열(마크다운 렌더링됨, O22) 또는 editor prefill로 전달.
