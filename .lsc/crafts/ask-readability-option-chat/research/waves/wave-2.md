# Wave 2 — 확장 1파 (2026-07-20)

## Roster

| Worker | Agent | Axis | Status |
|---|---|---|---|
| W2AskDialogArch | lsc-explore | ask-dialog git 고고학 + onLeft/onRight + ReadonlySessionManager | completed 15m22s |
| W2PiAiDeep | lsc-explore | pi-ai BYO-completion 계약 (auth/abort/에러/vitest 경계) | completed 25m |
| W2NpmVersions | lsc-librarian | npm 버전 경로 (askDialog 최초 버전, 17.x loadMode) | completed 7m27s |
| W2PiAskUser | lsc-librarian | edlsh/pi-ask-user 구현 기법 | completed 5m29s |

## 핵심 판정 (wave 1 리드의 해소)

1. **askDialog 최초 published 버전 = 16.4.5** (.d.ts 직접 검증; preview+header 포함, 16.4.5→17.0.5 byte-identical). 16.4.0→16.4.5 extension-API 파괴 변경 **zero**. 락스텝 exact-pin(11개 sibling 동시 범프) 필수. 17.x는 loadMode default-flip(xd:// 마운트) + 17.0.0 registerTool 버그 → 회피. **권고: 16.4.5.**
2. **onLeft/onRight는 explain 진입키 불가 확정** — `() => void`(하이라이트 index/label 미전달), 호스트가 호출 직후 settle(undefined)로 select를 종료함 (b5a471d8 도입 커밋 diff로 증명). C3 dropCondition 미충족 → 클레임 유지·강화.
3. **로컬 "Chat about this" 재도입 없음 확정** (`git log --all -S` — 38a5c8a89 도입, 48b2a742c typed 결과, bcee73e58 제거가 전부). 제거 전 wiring 복원: CHAT_ABOUT_THIS_OPTION 행(Other/Next 뒤) → #finishChat → callbacks.onChat({kind:'chat'}) → controller settle({kind:'chat'}) → AskTool "User chose to chat..." + details{chatRedirect:true}. **lets-craft 자체 chat-row 설계의 직접 선례.**
4. **preview는 현재 인라인** — a741e0b38이 side pane을 인라인 preview로 교체(`│` prefix 캐시 라인, ask-dialog.ts:318-319). 커스텀 컴포넌트가 복제할 대상은 인라인 방식(historical split-pane 아님). historical pane 산식도 확보(폭>=73 side-by-side, previewWidth=max(40,floor(w*.45))).
5. **BYO-completion 계약 완전 특성화**: SimpleStreamOptions에 onTextDelta 없음 → 스트리밍은 `for await (event of stream(...))`의 text_delta 소비(호스트 agent-session.ts:14619-14658, bench-cli.ts:251-268이 정확한 루프 선례). canonical 패턴은 host eval completion-bridge.ts:122-178: getApiKey preflight → `completeSimple(model, ctx, {apiKey: registry.resolver(model, sessionId), signal, ...})` → stopReason error/aborted 시 ToolError. 에러 이원성: provider 에러는 terminal AssistantMessage(stopReason:'error'|'aborted'+errorMessage/errorStatus, result()는 resolve)·resolver/키 부재는 reject → try/catch+stopReason 게이트 둘 다 필요. OAuth: getApiKey가 유효 bearer 반환(sk-ant-oat 자동 감지), 세션 스티키 위해 sessionId 일관 전달. systemPrompt 비어있으면 Codex 400 → 비공백 기본값.
6. **Node/Vitest는 pi-ai/coding-agent 값-import 불가** (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` — node_modules 내 TS 소스). 타입-import는 안전(d.ts). completion 어댑터는 Bun-로드 wrapper 심에만 두고 pure core엔 포트 주입 — statusbar의 기존 격리 패턴(src/statusbar/index.ts 단독 런타임 import + test/statusbar-regression.test.ts 경계 고정)이 관례 선례.
7. **ReadonlySessionManager Pick은 forkFrom/branch/appendMessage 제외** (16.4.0·16.5.2 동일) — sidebranch 패턴은 지원 표면 밖(런타임 객체엔 있으나 비지원). 배제.
8. **pi-ask-user 기법 카탈로그 확보** — @earendil-works fork의 pi-tui 프리미티브(Container/Component/Markdown/Editor/OverlayHandle/KeybindingsManager/matchesKey/fuzzyFilter/truncateToWidth/wrapTextWithAnsi 등) 위에 구축. 유일 잔여 리드: 동일 심볼이 @oh-my-pi/pi-tui 16.4.x에 존재하는가.

## EXPAND (잔여 리드 → wave 3)

1. [W2PiAskUser] @oh-my-pi/pi-tui 16.4.0/16.4.5의 후보 프리미티브 export 확인 + ctx.ui.custom 팩토리 파라미터 타입 + 직접 의존성 추가 필요 여부. → **W3PiTuiSurface**
2. [W2AskDialogArch] 인라인 preview vs historical pane 구분은 planner 명세 사항 — 리서치 리드 아님.
3. [W2PiAiDeep] completion-bridge 계약 재사용은 설계 검토 사항 — 리서치 리드 아님.
4. [W2NpmVersions] lets-craft 등록 표면 확인은 이미 해소(ExtensionAPI.registerTool — ask.ts:546+, TracerCodePath wave 1).
