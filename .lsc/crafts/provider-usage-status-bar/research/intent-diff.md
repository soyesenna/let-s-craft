# Intent Diff — provider-usage-status-bar

## Feature idea (verbatim, Korean)
> lets-craft plugin 에 하단 상태바를 추가하고싶어. 위에 기본적으로 나오는 곳 말고 프롬프트 입력창 하단에 만들고싶어. 하단 상태바에서 보여주고 싶은 내용은, omp 에 provider 로 로그인 된 계정들의 5시간, 1week 사용량이야. omp 는 하나의 provider 여도 같은 provider (eg. anthropic, openai) 에 여러 계정을 등록할 수 있으니까, 그 계정들도 전부 보여줘야해.

## Lazy read (what to AVOID assuming)
- "add a status bar" → just print some text somewhere on screen.
- "usage" → a single number, trivially available from one API call.
- one account per provider.

## Actual intent (what must really be investigated)
1. **Position is specific**: a PERSISTENT bar rendered BELOW the prompt input box — explicitly NOT omp's existing top status/header area ("위에 기본적으로 나오는 곳"). Whether that region is addressable by a plugin at all is the #1 unknown (internal — codebase lanes).
2. **Multi-account, multi-provider**: every account of every logged-in provider; one provider (anthropic/openai) may have several accounts → per-account enumeration + correct attribution required.
3. **Two rolling windows**: 5-hour AND 1-week usage, per account. Strongly matches Claude subscription (Pro/Max) 5-hour session + weekly limits and/or provider rate-limit windows — not obviously the same as API-key billing usage.
4. **"provider 로 로그인 된 계정"**: implies OAuth subscription logins as well as API keys; usage semantics differ between the two.

## External research scope (this journal)
- How per-account usage over 5h / 1week windows is obtained for Anthropic and OpenAI (rate-limit headers, usage/cost APIs, subscription quota endpoints, local token accounting).
- API-key billing usage vs OAuth subscription quota usage — different sources, different attribution.
- Prior art: how ccusage / Claude Code / opencode / similar compute & display 5h + weekly windows and where the numbers come from.
- (Light) prior art for persistent bottom/footer status bars rendered under a prompt in terminal agent UIs.

## Explicitly OUT of external scope (handled by codebase lanes + terrain scout)
- How omp itself stores accounts / exposes usage / renders its TUI — internal to `oh-my-pi/`, owned by the trace lanes.
