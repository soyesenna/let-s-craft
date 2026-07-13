# Intent Diff — model-preset-session-default

## What a lazy read would assume
"Add a `default` model field to the preset YAML and apply it." — treats it as a pure schema addition.

## What is actually being asked
Feature idea (verbatim): "model preset에 세션 default 모델 설정 지원기능을 개발해줘."

Two load-bearing ambiguities a lazy read skips:

1. **Semantics of "세션 default 모델"** — at least two competing readings:
   - (a) the preset sets the *omp session's own main model* when activated (changing what the top-level session runs on);
   - (b) the preset carries a *fallback default* used for lsc agents that have no explicit per-agent entry (today those fall back to the session model — `_docs/spec.md` L49, README L130).
2. **Whether the host even allows (a)** — `src/preset/spike.ts` documents that lets-craft only touches `task.agentModelOverrides`; the session's own model is owned by omp. Whether an extension can set the session's main model (API? settings key? persistence semantics?) is an open external contract question.

## What needs EXTERNAL research (this journal's scope)
- The `@oh-my-pi/pi-coding-agent` (pinned 16.4.0) extension API surface for model/settings control — node_modules types + vendored `oh-my-pi/`/`pi/` sources + public npm/GitHub/docs if they exist.
- omp harness documentation (omp:// internal docs) on extensions, settings keys, session model resolution.
- Prior art: how other coding-agent tools (Claude Code, opencode, aider, continue, cursor…) model "preset/profile with a default model + per-role overrides" — naming, layering, activation semantics.
- YAML config schema evolution: additive optional keys, forward/backward compatibility, validation conventions.

## What the codebase trace lanes already cover (NOT this journal's scope)
- Internal integration points (models-file.ts / inject.ts / command.ts / validate.ts / main.ts).
- The premise audit of interpretation (a) vs (b) against repo docs/tests.
