# Trace protocol reference (Stage 1 / C15)

Ported verbatim from OMC's `deep-dive`/`trace` skills (`.omc/state/deep-dive-lane-reports/lane2-omc-contracts-full.md` L423-609, itself sourced from `oh-my-claudecode/skills/{deep-dive,trace}/SKILL.md`). Read this in full before spawning any `lsc-tracer` worker.

## 1. Lane partition rule (3-lane default, unlimited count)

Unless the problem strongly suggests a better partition, use exactly these three lanes:

1. **Lane 1 — Code-path / implementation cause.**
2. **Lane 2 — Config / environment / orchestration cause.**
3. **Lane 3 — Measurement / artifact / assumption-mismatch cause.** Covers verification-method defects, not just system defects. Examples: a verification query reuses one dimensional key across distinct entities/tenants/streams/groups; a comparison filter shape doesn't match the schema grain; a catalog/column name is assumed portable across runtimes without enumeration. Includes multi-entity premise/key-assumption mismatches.

**Premise audit (mandatory when the problem statement has a cross-entity discrepancy shape).** If the feature/bug idea says something like "X is empty but Y is not", "N streams differ", or "values mismatch across entities": Lane 3 must test the verification premise FIRST. Enumerate entity dimensions (cohort IDs, tenant IDs, partition keys, dimensional keys per stream) via a metadata table or schema introspection **before** treating a zero-row result or mismatch as a system defect. The result may turn out to be a verification-methodology defect, not a system defect — don't foreclose that outcome by skipping the audit.

`lsc-tracer`'s own `Lane_Discipline` block (`agents/lsc-tracer.md`) already encodes this default partition — you do not need to re-explain it in each spawn's assignment, just state which lane number/hypothesis this particular worker owns.

## 2. The 7 preserved distinctions (do not collapse)

Every trace — per-lane and the final synthesis — must keep these distinct:

1. **Observation** — what was actually observed.
2. **Hypotheses** — competing explanations.
3. **Evidence For** — what supports each explanation.
4. **Evidence Against / Gaps** — what contradicts it or is still missing.
5. **Current Best Explanation** — the leading explanation right now.
6. **Critical Unknown** — the missing fact keeping the top explanations apart.
7. **Discriminating Probe** — the highest-value next step to collapse uncertainty.

Do **not** collapse into: a generic fix-it coding loop, a generic debugger summary, a raw dump of worker output, or fake certainty when evidence is incomplete.

## 3. Worker contract (each spawned `lsc-tracer`)

Already baked into `agents/lsc-tracer.md`'s `<Lane_Discipline>` and `<Tracing_Protocol>` blocks — restated here for what the orchestrator (you) must verify came back:

Each worker owns exactly one lane and must: restate its lane's hypothesis explicitly; gather evidence **for**; gather evidence **against** / gaps; rank evidence strength using the 6-tier hierarchy (controlled reproduction > primary artifact with tight provenance > multiple independent sources > single-source code-path inference > weak circumstantial clues > intuition/speculation); name the lane's critical unknown; recommend the lane's best discriminating probe; avoid collapsing into implementation. A worker must never claim convergence with another lane on its own initiative — that judgment belongs only to the synthesis step (§4 below), which you (the main session) perform, not a spawned agent.

Expected per-worker return shape: Lane / Hypothesis / Evidence For / Evidence Against-Gaps / Evidence Strength / Critical Unknown / Best Discriminating Probe / Confidence.

## 4. Leader synthesis contract (performed by the orchestrating main session — no separate "lead" agent exists in lets-craft)

OMC's team-mode has an implicit "Lead" role that a Claude Code team-mode coordinator instance fills; lets-craft has no equivalent bundled agent for this, so the session running the pre-craft skill performs it directly. Your synthesis, and `trace.md`'s top-level structure, must return:

1. Observed Result
2. Ranked Hypotheses
3. Evidence Summary by Hypothesis
4. Evidence Against / Missing Evidence
5. Rebuttal Round
6. Convergence / Separation Notes
7. Most Likely Explanation
8. Critical Unknown
9. Recommended Discriminating Probe
10. Additional Trace Lanes (optional, only if uncertainty remains high)

Preserve the ranked shortlist even when one explanation dominates — do not prune to a single answer.

**Rebuttal round (mandatory, before you write anything down as final):** let the strongest non-leading lane present its best rebuttal to the current leader. Force the leader to answer with evidence, not assertion. If the rebuttal materially weakens the leader, re-rank. If two "different" hypotheses turn out to reduce to the same underlying mechanism, merge them and say so explicitly. If two hypotheses still imply different next probes, keep them separate even if they sound similar in prose.

**Convergence detection.** Do NOT claim convergence just because multiple workers happen to use similar language. Convergence requires either: the same root causal mechanism, or independent evidence streams that happen to point to the same explanation. Anything short of that stays a ranked shortlist, not a single verdict.

## 5. What `trace.md` must expose for Stage 2 (interview) to consume

Stage 2's 3-point injection (see `references/interview-protocol.md`) reads directly from this trace's synthesis. For that to work, `trace.md`'s top-level synthesis section must have an unambiguous **"Most Likely Explanation"** field (or an explicit statement that none exists — see the low-confidence branch below) and a **per-lane "Critical Unknown"** list that can be lifted into interview's first questions without further interpretation.

**Low-confidence handling.** If no clear "most likely explanation" emerges (all lanes low-confidence or genuinely contradictory after the rebuttal round): say so explicitly in `trace.md` rather than forcing a verdict. Stage 2 will then skip the initial-idea enrichment override and instead inject *all* per-lane critical unknowns as open questions — more open questions guide the interview toward the actual gaps instead of anchoring on an unearned conclusion.
