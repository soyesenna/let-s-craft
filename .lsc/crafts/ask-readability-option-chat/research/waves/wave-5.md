# Wave 5 — SDK 최신 버전 축 재조사 (2026-07-20, 인터뷰 중 재개 2차)

사용자 질문: oh-my-pi/pi SDK를 최신으로 올리면 ask UI를 더 유려하고 예쁘고 직관적으로 만들 수 있는가? (vendored 저장소 ~9h 전 갱신 반영)

## Roster

| Worker | Agent | Axis | Status |
|---|---|---|---|
| W5OmpLatest | lsc-explore | vendored oh-my-pi HEAD의 ask UI 표면 델타 | completed 22m6s |
| W5PiLatest | lsc-explore | vendored pi HEAD의 extension 질문 UI 진화 | completed 16m17s |
| W5NpmLatest | lsc-librarian | npm published 최신 확인 + 범프 비용 재산정 | completed 16m29s |

## 판정

1. **최신 = 17.0.5** (npm, 2026-07-18; 이후 신규 없음). vendored oh-my-pi HEAD 39c95e5e = v17.0.5 태그 동가(ask 관련 후속 커밋 없음). pi published(@mariozechner)는 0.73.1(구식, askDialog 없음).
2. **askDialog API 표면은 16.4.5→17.0.5 불변** (published d.ts diff: askDialog/ExtensionAskDialog* 변경 0건; 델타는 loadMode/LocalProtocolOptions/managed timers뿐). "최신 범프"가 주는 ask 개선은 전부 **런타임 폴리시**: bcee..HEAD의 ask-dialog 커밋은 정확히 4개 — e80bc9a0f(Space 오제출 수정), a741e0b38(전 옵션 인라인 preview + Markdown/코드펜스 + 폭 캐시, split-pane 제거), 59b9f6568(동적 취소 푸터 힌트), 2300c9ff4(tall-preview 행 내 페이징).
3. **pi 계열은 기여 없음**: extension select 여전히 string[] 전용(blame으로 확인 — SelectList의 rich 재료를 브리지가 안 씀); custom overlay 옵션(%/anchor/margin, OverlayHandle)만 강화 — omp에 이미 동가 존재. "유려한 ask" 경로는 oh-my-pi askDialog 또는 자체 custom뿐.
4. **자체 컴포넌트용 최신 TUI 신규 재료**(17.0.5): FuzzyText(fuzzy.ts:328-346, 검색 하이라이트), Editor.setScrollbarVisible(editor.ts:588-590 — 멀티라인 프롬프트 입력에 직접 유용), Loader 애니메이션 색/스피너, requestDirectWrite(성능). 신규 Form/Panel류 프리미티브는 없음. ScrollView/TabBar/SelectList/SettingsList는 16.4.0 기저에 이미 존재.
5. **구조 함정(설계 충돌)**: askDialog는 key-opaque(호스트가 키 소유)이고 로컬 'Chat about this'는 제거됨 — **R10(키바인딩 채팅 진입)과 AC1.3(멀티선택 체크 상태 보존)을 askDialog 위에서 충족할 수 없다**. askDialog에 채팅용 옵션 행을 끼워 닫고-재열기하는 우회는 Question에 initial-checked 파라미터가 없어 체크 상태 복원 불가.
6. **17.x 마이그레이션 비용 재확인**: ToolDefinition.loadMode:"essential" 지정(기본 discoverable→xd:// 마운트; 17.0.0 registerTool 데모션 버그 → 17.0.5 필수), sibling 11종 exact-pin 락스텝(16.4.0→17.0.5 전부), @agentclientprotocol/sdk 0.25→1.2.1 transitive major, 제거된 host tool 타입(irc/job 등)은 lets-craft 미사용이라 무관. package.json diff는 런타임 churn(OTEL 5종 추가 등)이 큼.

## 결론 (인터뷰 R15 입력)

"최신으로 올리면 유려해지는가"의 정답은 **조건부**: (i) askDialog를 채택하면 호스트가 다듬어 놓은 rich dialog(탭·헤더칩·인라인 markdown preview·노트·멀티토글·스크롤)를 공짜로 얻고 17.0.5 런타임이 가장 다듬어져 있다 — 그러나 그 위에 in-question 채팅을 얹을 수 없어 R1/R10/AC1.3과 충돌한다. (ii) 자체 컴포넌트 경로에서는 최신 범프가 주는 것이 편의 재료 3종(FuzzyText/Editor scrollbar/Loader 애니메이션) 수준이며 API 표면은 16.4.0 기저로 충분하다. (iii) 범프 자체 비용은 관리 가능하나(loadMode essential + 락스텝) 무범프 대비 순증 리스크다.

## EXPAND
- none — SDK-최신 축은 published/vendored/ancestor 3방향에서 전수 확인 완료. 잔여는 설계 결정(범프 여부·askDialog 채택 여부)으로 인터뷰 R15 이관.
