# Plan/test consensus loop reference (Stage 3 & Stage 4 / C17)

Ported from OMC's `ralplan` skill (`.omc/state/deep-dive-lane-reports/lane2-omc-contracts-full.md` L688-792, sourced from `oh-my-claudecode/skills/ralplan/SKILL.md`). This loop runs **twice** in pre-craft: once over `plan.md` (Stage 3) and once over `test/` (Stage 4, per the Phase 4 delegation contract's explicit extension of C18). Both runs follow this same reference exactly, just with a different artifact under review.

## What was ported verbatim, and what was deliberately excluded

The core consensus mechanics (planner drafts → architect reviews first → critic reviews second → non-approval loops back → cap → escalate; ADR requirement) are ported as-is (§2 below). Three pieces of the OMC source text do **not** apply to lets-craft and are excluded on purpose, not by oversight:

1. **Step 0 (company-context call).** The OMC source optionally calls out to `.claude/omc.jsonc` / `~/.config/claude-omc/config.jsonc` for a `companyContext.tool`. This is Claude-Code-specific infrastructure that this project's Non-Goals explicitly exclude ("OMC의 Claude Code 종속 인프라 ... 이식" is out of scope). Skip this step entirely — there is no lets-craft equivalent.
2. **The `--interactive` `AskUserQuestion` review step (OMC step 2)**, where the user is shown the draft plan + RALPLAN-DR summary before architect/critic review even starts. C17 does not call for a user review at this point — only at the iteration cap (§3 below) — and `AskUserQuestion` is a Claude-Code-only tool with no omp equivalent (the seam here is `lsc_select`/`lsc_ask`/`lsc_confirm`, per SKILL.md §1). Skip this optional pre-review step.
3. **Steps 6-8 (mark plan `pending approval`, present team/ralph execution options, invoke `Skill("team")`/`Skill("ralph")`).** These steps hand off to OMC's own execution skills, which don't exist in lets-craft. In this pipeline, the artifact under review (`plan.md` or `test/`) simply gets finalized once consensus is reached — actual implementation is a completely separate pipeline stage (the `craft` skill), invoked later by the user, not by this loop.

## 1. Verdict-vocabulary reconciliation (read this before judging any review)

The OMC source text describes Critic's verdict as `APPROVE | ITERATE | REJECT` and Architect's as an "implicit" verdict (feedback if issues found, otherwise silently proceed). **The actual agents bundled in this repo do not use that vocabulary** — `agents/lsc-critic.md` and `agents/lsc-architect.md` were authored independently (Phase 1) with their own general-purpose review contracts. Use the mapping below, not the OMC source's literal tokens:

| Role | What the OMC source says | What this repo's agent actually outputs | How to read it |
|---|---|---|---|
| `lsc-critic` | `APPROVE` \| `ITERATE` \| `REJECT` | `**VERDICT: [REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT]**` (first line of its structured output, `agents/lsc-critic.md` Output_Format) | `ACCEPT` or `ACCEPT-WITH-RESERVATIONS` → pass (≈ `APPROVE`). `REVISE` or `REJECT` → not yet (≈ `ITERATE`/`REJECT`) — send feedback back to `lsc-planner` (or, in Stage 4, back to the relevant `lsc-test-engineer` spawn) and loop. |
| `lsc-architect` | Implicit: feedback if issues found, else silently proceed to critic | A structured review ending in a `## Consensus Addendum` section (Antithesis / Tradeoff tension / Synthesis / Principle violations) — no single verdict token | Read the Consensus Addendum yourself: an explicit **principle violation** (deliberate-mode) or an antithesis the plan/tests genuinely cannot survive = blocking, back to the author. A tradeoff tension that has a workable synthesis, or no principle violation, = not blocking, proceed to critic. This is a judgment call you make, not a token you parse. |

## 2. The loop (ported mechanics)

1. **Author drafts.** Stage 3: `lsc-planner` produces `plan.md` + a RALPLAN-DR summary (Principles 3-5, Decision Drivers top 3, ≥2 viable options with bounded pros/cons — or explicit invalidation rationale if only one survives). Stage 4: the relevant `lsc-test-engineer` spawn(s) produce/revise the flagged `test/` assets.
2. **Architect reviews first, and must complete before critic starts — never in parallel.** Critic's evaluation depends on architect's antithesis/tradeoff findings; issuing both `task` calls in the same batch is a contract violation of this loop, not just a style preference.
   - Required output: strongest steelman antithesis against the favored direction; at least one real tradeoff tension; a synthesis where one is viable; in deliberate mode, explicit principle-violation flags.
   - Judge per §1's table: blocking → back to the author (step 1), then re-review from architect again (do not skip straight to critic on the next pass). Not blocking → step 3.
3. **Critic reviews** (after architect only). Required investigation depth per `agents/lsc-critic.md`: pre-commitment predictions, full verification of every referenced file/claim, multi-perspective review (executor/stakeholder/skeptic angles for a plan; the equivalent code-review angles for test assets), explicit gap analysis ("what's missing"), self-audit, realist check. For this consensus context specifically, it must also gate: principle-option consistency, fairness of alternatives explored, risk-mitigation clarity, testable acceptance criteria, concrete verification steps — and, in deliberate mode, pre-mortem quality (3+ scenarios) and expanded test-plan coverage (unit/integration/e2e/observability).
   - Read the `**VERDICT:**` line per §1's table.
4. **Consensus = architect not-blocking AND critic ACCEPT/ACCEPT-WITH-RESERVATIONS, in the same iteration.** A critic pass that only happened because an earlier architect blocking issue was silently skipped does not count.
5. **Re-review loop.** Any non-passing outcome (architect blocking, or critic REVISE/REJECT) sends the author back to revise, then back through architect, then critic again — the full closed loop, not a partial re-check.
6. **Iteration cap: 10** (C17 explicitly overrides the OMC source's 5 — use 10, not 5, for both the plan loop and the test loop). One iteration = one full (author-revise → architect-review → critic-review) cycle.
7. **On reaching the cap without consensus**, present the best version to the user for a decision — this is where lets-craft's `lsc_select` seam replaces OMC's `AskUserQuestion`:

   `[Consensus Escalation] {plan.md|test/} did not reach architect/critic consensus after 10 iterations. Unresolved: {latest architect antithesis + critic findings, summarized}. Proceed with the current {plan.md|test/} as-is?`

   Options: `["Proceed with current version", "Give additional guidance and continue iterating", "Abort pre-craft"]`. If the user chooses to continue with guidance, treat that as a fresh, separately-budgeted attempt at this same loop — do not let it silently bypass a future cap check.
8. **ADR requirement.** The final `plan.md` — reached by consensus or by user escalation — must include an ADR: Decision, Drivers, Alternatives considered, Why chosen, Consequences, Follow-ups. (`test/` has no equivalent ADR requirement; its "final" state is simply the hash-manifest-ready asset set once this loop passes or is escalated through.)
