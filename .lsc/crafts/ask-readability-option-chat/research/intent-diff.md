# Intent Diff — ask-readability-option-chat

## What a lazy read would assume
"ask 도구 텍스트를 예쁘게 다듬고, 채팅 기능 하나 추가한다" — 표면적 스타일링 + 단순 기능 추가.

## What is actually being asked
lets-craft의 질문 심(lsc_ask/lsc_select/lsc_confirm, src/ask.ts)에 대한 두 개의 결합된 변경:

1. **가독성 고도화** — 질문/옵션/description/CONTENT envelope 텍스트의 표시 품질을 호스트(oh-my-pi ctx.ui) 렌더링 제약 안에서 끌어올리는 표현 계층 작업. 어디가 실제로 읽기 어려운지(select 행에 눌려 들어간 긴 description? 태그 prefix? envelope 직렬화?)는 검증 대상이지 전제가 아니다.
2. **옵션별 에이전트 설명 요청 (btw 유사)** — select 질문에 답하는 도중, 특정 옵션에 대해 사용자가 자유 프롬프트로 에이전트에게 설명을 요청하고(측면 채팅), 답을 본 뒤 다시 원래 질문으로 복귀하는 상호작용. oh-my-pi `/btw`(BtwController + runEphemeralTurn ephemeral side turn)가 참조 모델.

## Central feasibility question (external research target)
lets-craft는 oh-my-pi coding-agent의 **plugin(extension)** 이다. 질문은 블로킹 tool call 내부에서 ctx.ui로 렌더된다. 따라서:
- extension tool handler가 **LLM 완성(completion)을 직접 호출할 수 있는 호스트 심이 존재하는가?** (runEphemeralTurn은 호스트 내부 — extension에 노출되는가?)
- 설명 텍스트를 **어떻게 표시**하는가? (ctx.ui의 표시 프리미티브 — markdown/panel/editor 재활용?)
- 설명 후 **select 재렌더 루프**가 가능한가? (performSelect 내부 루프)
- **fixture 모드(LSC_FIXTURE, CI 무인)** 에서 이 상호작용은 어떻게 결정론적으로 스킵/스크립트되는가?

## What needs external research (beyond this repo)
- oh-my-pi extension SDK가 노출하는 표면 (ExtensionAPI/ExtensionContext — UI 프리미티브, LLM 접근, 커스텀 컴포넌트) — 현재 고정 버전 16.4.0 기준 + 이후 버전 변화.
- TUI select-with-help/explain UX 선례 (Claude Code AskUserQuestion, gum/huh/inquirer/clack 등).
- "tool 내부에서 모델에게 되묻기" 프로토콜 선례 (MCP sampling/createMessage 등)와 비용/루프 리스크 완화책.
