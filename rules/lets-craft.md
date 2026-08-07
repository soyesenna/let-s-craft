---
description: lets-craft project-wide working rules — subagent delegation, feature-sized commits, and structured commit messages
alwaysApply: true
---

# lets-craft Working Rules

These rules apply to every session working inside this project, regardless of which pipeline phase (pre-craft / craft / post-craft) is active.

## 1. Delegate to subagents aggressively

Prefer spawning a specialized `lsc-*` subagent over doing the work yourself in the main session:

- Read-only investigation ("where is X", "how does Y connect to Z") → `lsc-explore`.
- Explaining *why* something happened, with competing hypotheses and evidence → `lsc-tracer`.
- Reviewing a plan, spec, or diff for flaws → `lsc-critic`.
- Diagnosing a bug or evaluating an architectural decision, read-only → `lsc-architect`.
- Implementing a specified code change → `lsc-executor`.
- Turning a confirmed spec into an actionable plan → `lsc-planner`.
- Test strategy, post-implementation test authoring, or flaky-test hardening → `lsc-test-engineer`.
- post-craft 감사 전용(lens assignment와 implBranch OID 앵커가 필요) — spec/plan 대비 구현 감사 → `lsc-auditor`.

Use the `task` tool to spawn these in parallel whenever the work is independent (e.g. multiple `lsc-explore` lookups across unrelated areas, or `lsc-explore`+lens별 `lsc-auditor` in post-craft's own adversarial-review batch). Do not do multi-step implementation, investigation, or review work directly in the main session when a subagent contract already exists for it — the main session's job is to orchestrate the pipeline (trace → interview → plan → craft → post-craft's own test authoring + audit), not to substitute for the agents that own each step.

## 2. Commit at feature granularity — never in large, mixed batches

- Each commit must correspond to one coherent unit of work (one pipeline phase's output, one primitive, one bugfix, one test suite) — not an accumulation of unrelated changes.
- Do not let changes pile up across multiple unrelated concerns before committing. If you notice a commit would span more than one logical concern, split it.
- Trivial, mechanical changes (formatting, typo fixes) may be batched with the adjacent feature commit they support; everything else gets its own commit.

## 3. Commit messages: Korean, conventional-commit prefix, structured body

Every commit message MUST:

1. Use a Korean subject line with a conventional-commit type prefix (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, etc.).
2. Include a structured body with these four labeled sections (in Korean or terse technical English, whichever is clearer for that field — labels themselves stay as shown):
   - `what:` — what changed, concretely (files/behavior).
   - `why:` — why this change was made (the decision or requirement it satisfies).
   - `evidence:` — what you observed that grounds the "why" (a spec/plan reference, a reproduced failure, a discriminating probe result, etc.).
   - `verify:` — how you confirmed the change works (command run, test output, manual check performed).

Example shape:

```
feat: lsc- 에이전트 7종 및 RULE 주입 정의

what: agents/lsc-{7종}.md frontmatter+행동계약, rules/lets-craft.md(alwaysApply)
why: 파이프라인 각 단계에 전용 에이전트 행동계약을 부여하기 위함
evidence: <구체적 근거>
verify: <구체적 검증 방법>
```

Do not skip `evidence:` or `verify:` by writing a placeholder — if you cannot state real evidence or a real verification step, the work is not ready to commit yet.
