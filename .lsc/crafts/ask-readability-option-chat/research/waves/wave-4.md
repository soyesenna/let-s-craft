# Wave 4 — 사용자 추가 축 재조사 (2026-07-20, 인터뷰 중 재개)

사용자 추가 요구 2축: (1) 가독성에 텍스트 자체 속성(크기·컬러) 포함, (2) 옵션 질문 시 프롬프트 캐시 유지 방법.

## Roster

| Worker | Agent | Axis | Status |
|---|---|---|---|
| W4TextStyle | lsc-explore | pi-tui/host 16.4.0 텍스트 스타일·크기 능력 인벤토리 | completed 13m25s |
| W4PromptCache | lsc-explore | pi-ai 16.4.0 캐시 옵션 + /btw 캐시 메커니즘 재현 가능성 | completed 20m |
| W4TextSizing | lsc-librarian | 터미널 텍스트 크기 생태계(OSC 66/DECDWL/TUI 관행) | completed 4m3s |

## 판정

### 텍스트 스타일·크기
1. **커스텀 컴포넌트의 스타일 제어는 사실상 무제한**: host Theme 시맨틱 API(fg/bg/bold/italic/underline/strikethrough/inverse, ThemeColor 시맨틱 토큰 ~40종 + ThemeBg; theme.ts:1121-1694), 임의 24-bit ANSI도 렌더 파이프라인이 보존(wrap/truncate ANSI-aware — pi-natives d.ts:1584-1616; Bun 프로브 재현).
2. **현행 select도 인라인 markdown 강조가 이미 렌더됨**: HookSelector가 label/description을 renderInlineMarkdown으로 처리 — **bold**/`code`/*italic*/~~strike~~가 실스타일로 출력(실컴포넌트 Bun 프로브 확인; hook-selector.ts:271-387, markdown.ts:2199-2270). underline은 markdown 토큰 없음(링크 경유만).
3. **텍스트 크기: pi-tui에 Kitty OSC 66 구현이 실존** — encodeTextSized(utils.ts:86-103), terminal-capabilities.textSizing(Kitty만 true, :445-450), setTerminalTextSizing(:575-580), visibleWidth가 OSC66 payload 스케일 인지(:243-249); coding-agent 설정은 기본 off·Kitty 전용(settings-schema.ts:825-833); markdown H1이 이미 OSC66 경로 사용(markdown.ts:701-727,1497-1506). DECDWL/DECDHL 코드는 없음.
4. **생태계 현실(W4TextSizing)**: OSC 66 완전 지원은 kitty뿐(foot는 width만, Ghostty 파서만, iTerm2/Alacritty/WezTerm/WT/xterm.js 부재). 이식성 있는 '크기감'은 문자 그리드 관용구(bold·색 대비·여백·보더·헤더룰·레터스페이싱·figlet)이며, OSC 66은 **capability-gated progressive enhancement**로만 타당(스펙의 CPR 프로브). "가독성이 OSC 66에 의존하면 안 됨" — 미지원 터미널엔 이스케이프 누출이 아니라 자동 폴백이어야 함(단, OSC는 원래 pass-through라 대부분 무해 — kitty 스펙 명시).
5. 타이포그래피 대체 수단 카탈로그: Box(padding/bg/border), Text, Spacer, DynamicBorder, theme 심볼 프리셋(UNICODE/ASCII), getSelectListTheme/getEditorTheme/getMarkdownTheme.

### 프롬프트 캐시
6. **3단 판정**: ① **메인 턴 프리픽스 히트 = 사실상 불가** — 캐시 키(promptCacheKey는 OpenAI/Codex의 prompt_cache_key; Anthropic은 키 개념 없이 cache_control 마커+직렬화 프리픽스 동일성)만으로 부족하고, provider-wire 프리픽스의 바이트 동일성(시스템+정규화 툴 카탈로그+히스토리+호스트 비공개 변환·난독화)이 필요 — extension은 ctx만으로 재현 불가. ② **사이드챗 내부 멀티턴 캐시 = 가능** — 안정 promptCacheKey + 안정 side sessionId + 프리픽스 유지; Anthropic은 pi-ai provider가 cacheRetention에 따라 cache_control 마커 자동 배치(applyPromptCaching :2919-3064). ③ **unique side sessionId 필수** — OpenAI/Codex의 append-chain/세션 상태가 sessionId로 키잉되므로 메인 오염 방지(/btw도 동일: `${cacheSessionId}:side:${snowflake}` + promptCacheKey=cacheSessionId; 16.4는 providerSessionState 미전달 — vendored 17.0.5와 혼동 금지).
7. **재료 가용성**: ctx.sessionManager.getSessionId()(캐시 키 시드), ctx.getSystemPrompt(): string[], getBranch() → SessionEntry[](message 엔트리 필터 필요), coding-agent가 `convertToLlm(messages)` export(session/messages.ts:724-728; 단 호스트의 완전 변환 체인과는 다름).
8. cacheRetention: Anthropic none=마커 없음/short=ephemeral/long=ttl 1h(모델 호환 시); OpenAI Responses long=24h retention; Codex는 옵션 무시.

## 원장 반영
- C17(텍스트 스타일·크기 능력), C18(캐시 3단 판정) 추가 → claims.json.

## EXPAND
- none — 두 축 모두 판정 완료. 잔여는 설계 결정(스타일 위계의 테마 준수 수준, OSC 66 조건부 채택 여부, 캐시 요구 수준)으로 인터뷰 R11+에 이관; 실측(provider cache hit usage 관찰)은 craft 단계 테스트 계약으로 이월.
