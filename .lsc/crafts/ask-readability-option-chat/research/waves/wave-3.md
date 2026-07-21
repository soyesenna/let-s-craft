# Wave 3 — 확장 2파, 최종 (2026-07-20)

## Roster

| Worker | Agent | Axis | Status |
|---|---|---|---|
| W3PiTuiSurface | lsc-explore | @oh-my-pi/pi-tui 프리미티브 export 표면 + ctx.ui.custom 계약 | completed 17m53s |

## 판정 (마지막 리드 해소)

1. **pi-tui 후보 프리미티브 전원 가용** (16.4.0 pinned / 16.4.5 tarball / 16.5.2 tarball 동일): 런타임 값 — Container, Markdown, Editor, Text, Spacer, TUI, KeybindingsManager, Key, matchesKey, fuzzyFilter, truncateToWidth, wrapTextWithAnsi, CURSOR_MARKER. 타입 전용 — Component(tui.d.ts:39 — interface: render(width) 필수, handleInput/dispose 선택), MarkdownTheme, EditorTheme, OverlayHandle, OverlayOptions, Keybinding. 유일 예외: decodeKittyPrintable(비공개 — decodePrintableKey로 대체), getMarkdownTheme은 pi-tui가 아닌 coding-agent 루트 export(theme.d.ts:358; getEditorTheme :360도 존재).
2. **ctx.ui.custom<T> 정확 계약** (ExtensionUIContext 한정 — hook UI의 3-param custom과 구분): factory(tui: TUI[pi-tui], theme: Theme[coding-agent host], keybindings: KeybindingsManager[coding-agent, inMemory 인스턴스], done:(result:T)=>void) → Component|Promise<Component>; 반환 Promise<T>. 종료 시 controller가 dispose·오버레이 해제·에디터 복원 (controller.ts:763-815). ExtensionUiComponent = Component & {dispose?} — Container 상속 또는 인터페이스 구현으로 충분.
3. **버전 안정성**: 루트 barrel byte-identical(16.4.0↔16.4.5↔16.5.2), 후보 d.ts 차이는 비후보 항목뿐. 17.0.5 vendored 소스도 동일 이름 유지 — 안정 공개 표면으로 판정 (wave 1 lane 3의 critical unknown 해소).
4. **의존성 권고**: 커스텀 컴포넌트가 pi-tui 런타임 값을 import하면 @oh-my-pi/pi-tui를 **직접 runtime dependency**(exact pin, coding-agent/pi-ai와 락스텝)로 추가 — 현재는 dev-transitive(package-lock:1486-1500). 선례: provider-usage-status-bar plan.md:123-128(pi-ai direct exact pin). 호스트 legacy-pi-compat 로더가 compiled-binary 모드에서 pi-tui import를 호스트 번들 인스턴스로 리맵(중복 런타임 카피 방지) — direct dep 선언과 양립.
5. **Bun/Node 경계 재확인**: pi-tui도 Node 값-import 불가(ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING) — pi-ai와 동일 격리 규칙 적용.
6. **askDialog 16.4.5 교차 확인**: published coding-agent 16.4.0 tarball엔 hook-selector만, 16.4.5 tarball에 ask-dialog.ts 존재(pi-tui의 ScrollView/Tab/TabBar 사용) — wave 2 판정과 정합.

## EXPAND
- none — TUI export 리드는 16.4.0 pinned/16.4.5 tarball/16.5.2 tarball/호스트 import·re-export/custom 팩토리 타입·라이프사이클/Node·Bun 경계/의존성 권고까지 전수 확인 완료.

## 수렴 판정 (연구 프로토콜)
- 확장 웨이브 2회 완료(wave 2, wave 3) ✓
- 미확인 리드 zero ✓ (wave 3 EXPAND: none; wave 2 잔여 항목은 설계 결정 사항으로 open-questions 이관)
→ **CONVERGED. 외부 리서치 종료.**
