# Intent Diff — ask-tool-enhancement

## What a lazy read would assume
"lsc_select 옵션에 description 필드 하나 추가하고 'Other' 자유입력 항목을 붙이는 스키마 수정."

## What is actually being asked
사용자 요청 원문(요약 번역):
1. **모든 질문**(lsc_ask/lsc_select/lsc_confirm 전부)에 사용자가 자유롭게 답할 수 있는 칸이 존재해야 한다 — 선택지가 있어도 자유 답변이 항상 가능.
2. 선택지를 **title(짧은 제목) / description(상세 설명)으로 분리**.
3. description은 (a) 그 선택지를 제안하게 된 **배경**, (b) 그 선택지를 골랐을 때의 **장단점**을 정확하고 상세하게 서술.
4. description은 **쉬운 언어**로 — 프로젝트를 깊게 이해해야만 알 수 있는 용어/문장 금지.

즉 이 작업은 네 층위에 걸친다:
- **도구 스키마 변경**: options string[] → {title, description} 구조체 + 자유입력 채널.
- **호스트 UI 역량 문제**: omp의 ctx.ui.select/input/confirm이 무엇을 렌더링할 수 있는가 (SDK 16.4.0).
- **LLM 지시 계약**: description의 품질 요건(배경+장단점+쉬운 언어)은 코드가 아니라 tool description / 스킬 문서가 LLM에게 지시해야 하는 계약.
- **소비자 호환성**: 스킬 3종(SKILL.md)의 태그·라벨 분기, fixture 매칭(resolveSelectOption 티어, parseYesNo), E2E 하니스가 "응답 = 제시된 옵션 중 하나" 전제에 의존.

## What needs EXTERNAL research (vs. what trace lanes cover internally)
- 유사 도구 prior art: Claude Code AskUserQuestion(label/description/multiSelect + "Other" 자유입력), MCP elicitation 스펙, cline/roo/gemini-cli 등의 ask 도구 스키마.
- CLI 프롬프트 라이브러리(inquirer/@clack/prompts/enquirer)의 choice title/description 분리와 free-text escape 관례, 렌더링 함정.
- 쉬운 언어(plain language)로 장단점을 서술하는 검증된 작성 규칙 — tool description에 인코딩할 체크리스트 소재.
- (로컬 코드베이스 리서치) oh-my-pi 벤더 소스의 UI 프리미티브 실제 렌더링 능력과 하니스 내장 ask 도구 구현 — trace lane이 다루는 lets-craft 자체 코드와 별개 축.
