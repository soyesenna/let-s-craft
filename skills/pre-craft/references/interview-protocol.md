# Interview protocol reference (Stage 2 / C16)

Ported verbatim from OMC's `deep-interview`/`deep-dive` skills (`.omc/state/deep-dive-lane-reports/lane2-omc-contracts-full.md` L423-685). Read this in full before running Stage 2.

## 1. Ambiguity scoring formula (verbatim)

```
Greenfield:  ambiguity = 1 - (goal × 0.40 + constraints × 0.30 + criteria × 0.30)

Brownfield:  ambiguity = 1 - (goal × 0.35 + constraints × 0.25 + criteria × 0.25 + context × 0.15)
```

**Gate for this project: ambiguity strictly below 0.05 (5%)** — this is a project-level override of OMC's 20% default (`.omc/specs/deep-dive-lets-craft-pi-plugin.md` Metadata: "Threshold Source: user request … settings 기본값 20% 오버라이드"). Do not use 20%.

Use the brownfield/greenfield classification Stage 1 (trace) already determined — do not re-run that classification here.

## 2. Dimension definitions (verbatim)

1. **Goal Clarity (0.0-1.0):** Is the primary objective unambiguous? Can you state it in one sentence without qualifiers? Can you name the key entities (nouns) and their relationships (verbs) without ambiguity?
2. **Constraint Clarity (0.0-1.0):** Are the boundaries, limitations, and non-goals clear?
3. **Success Criteria Clarity (0.0-1.0):** Could you write a test that verifies success? Are acceptance criteria concrete?
4. **Context Clarity (0.0-1.0) — brownfield only:** Do we understand the existing system well enough to modify it safely? Do the identified entities map cleanly to existing codebase structures?

For each dimension, each round, record: **score** (float), **justification** (one sentence), **gap** (what's still unclear, when score < 0.9).

Also each round: **weakest_component_id** (if the feature has more than one active sub-component, rotate targeting across them rather than hammering the same one — track `topology.last_targeted_component_id`), **weakest_dimension** for that component, **weakest_dimension_rationale** (one sentence, stated *before* the question), **component_scores** (per-component, per-dimension).

## 3. Ontology extraction (verbatim)

Round 1: skip stability comparison, all entities are "new," `stability_ratio = N/A`.

Round 2+: compare against the previous round's entity list.
- **stable_entities**: same name, present in both rounds.
- **changed_entities**: different name, same type, >50% field overlap — treat as **renamed, not new+removed**. This counts toward stability, not against it.
- **new_entities** / **removed_entities**: unmatched in the respective direction.
- **stability_ratio** = (stable + changed) / total (1.0 = fully converged).

Store each round's ontology snapshot (entities + stability_ratio + matching reasoning) — `spec.md`'s "Ontology Convergence" table (mirroring `.omc/specs/deep-dive-lets-craft-pi-plugin.md`'s own table) is built directly from this accumulated log.

## 4. 3-point injection (Stage 1 → Stage 2 handoff)

This stage does **not** start from a blank slate or its own fresh brownfield explore. It initializes from `trace.md` via exactly three overrides (Reference-not-Copy architecture — read trace.md, do not duplicate its content into spec.md beyond what's needed to state these three things):

**Override 1 — initial-idea enrichment.** Replace the raw feature idea with:
```
Original problem: {original feature idea text}

<trace-context>
Trace finding: {trace.md's "Most Likely Explanation" / synthesis}
</trace-context>

Given this analysis, what should we do about it?
```
**Low-confidence branch:** if trace.md declared no clear most-likely explanation (§5 of `references/trace-protocol.md`), skip this enrichment — use the original feature idea unmodified. Do not inject an uncertain conclusion as if it were settled.

**Override 2 — codebase-context replacement.** Skip a separate brownfield re-explore here entirely. Set the interview's working codebase context to trace.md's full synthesis (wrapped in `<trace-context>` delimiters) — trace already mapped the relevant system areas with evidence; re-exploring would be redundant. This override applies **even in the low-confidence branch** — inconclusive trace findings still provide useful structural context.

**Override 3 — first-question injection.** Extract each lane's Critical Unknown from trace.md. These become this stage's first 1-3 questions, asked *before* normal ambiguity-driven questioning resumes:
```
Trace identified these unresolved questions from per-lane investigation:
1. {critical unknown from lane 1}
2. {critical unknown from lane 2}
3. {critical unknown from lane 3}
Ask these FIRST, then continue with normal ambiguity-driven questioning.
```
**Low-confidence branch:** inject *all* per-lane critical unknowns (not just 1-3) — more open questions guide the interview toward the actual gaps when trace itself couldn't converge on a leading explanation.

Tag every injected and every subsequently-generated question per SKILL.md §1.2 (`[Goal]`/`[Constraints]`/`[Success Criteria]`/`[Context]`) even though these first few questions originate from trace rather than from a fresh dimension-clarity calculation — classify each injected critical-unknown question by whichever dimension it most directly threatens before asking it.

## 5. Interview loop / question targeting (verbatim)

Each round: identify the active component + dimension pair with the LOWEST clarity score. When multiple components are tied or similarly weak, rotate targeting instead of asking about the same one repeatedly. Generate a question that specifically improves that pair's weakest dimension. State, in one sentence, *before* the question, why this pair is the current bottleneck. Questions must expose **assumptions**, not gather feature lists — "what should happen when X" beats "what features do you want."

## 6. Challenge modes (verbatim prompts — do not paraphrase these into something weaker)

Each mode fires exactly once, tracked in a `challenge_modes_used` set, then normal Socratic questioning resumes.

**Round 4+ — Contrarian:**
> You are now in CONTRARIAN mode. Your next question should challenge the user's core assumption. Ask "What if the opposite were true?" or "What if this constraint doesn't actually exist?" The goal is to test whether the user's framing is correct or just habitual.

**Round 6+ — Simplifier:**
> You are now in SIMPLIFIER mode. Your next question should probe whether complexity can be removed. Ask "What's the simplest version that would still be valuable?" or "Which of these constraints are actually necessary vs. assumed?" The goal is to find the minimal viable specification.

**Round 8+ — Ontologist (only if ambiguity is still > 0.3):**
> You are now in ONTOLOGIST mode. The ambiguity is still high after 8 rounds, suggesting we may be addressing symptoms rather than the core problem. The tracked entities so far are: {current_entities_summary from latest ontology snapshot}. Ask "What IS this, really?" or "Looking at these entities, which one is the CORE concept and which are just supporting?" The goal is to find the essence by examining the ontology.

## 7. Round caps

- **Soft cap: round 10.** Start actively steering toward closure — prefer questions that resolve multiple dimensions at once, avoid opening new lines of inquiry.
- **Hard cap: round 20.** Stop unconditionally, even without convergence. Write the best available `spec.md`, and add an explicit note (e.g. under Assumptions Exposed & Resolved, or a dedicated caveat line near the Clarity Breakdown table) that the round cap was hit before the 5% gate was reached. Do not loop past this.
