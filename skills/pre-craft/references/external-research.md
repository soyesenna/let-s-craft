# External research protocol reference (Stage 1 / C15)

Ported from `ulw-research` (`.omc/state/deep-dive-lane-reports/lane3-lazycodex.md`, sourced from `lazycodex/plugins/omo/skills/ulw-research/SKILL.md`). C15 requires external research to always run, using this protocol's original scale and convergence rules — **not** a watered-down version.

**What was ported vs. adapted.** ulw-research's Phase 0-4 orchestration (session journal, saturation waves, EXPAND-tail convergence tracking, code verification, non-code claim locking) is harness-agnostic and is ported as-is below. What was **not** ported — because it is Codex-plugin-specific infrastructure this project's Non-Goals explicitly exclude — is: the `multi_agent_v1.spawn_agent`/`wait_agent` MCP interface, the Stop/SubagentStop hook-based loop enforcement, `.omo/boulder.json`, and the `ulw-loop` CLI (`create-goals`/`status`/`checkpoint`/etc.). In lets-craft, workers are spawned via the `task` tool (batch form), and this stage's own orchestration (§6 of SKILL.md's Stage 1) is what tracks progress and decides when to stop — there is no external hook forcing continuation.

## Session directory (adapted path)

ulw-research used `.omo/ulw-research/<timestamp>/`. The lets-craft-native equivalent, matching this plugin's artifact conventions, is:

```
.lsc/crafts/{feature}/research/
├── intent-diff.md          # what's actually being asked vs. what a lazy read would assume
├── claim-graph.md          # orchestrator-owned; claims + their sourcing/verification state (workers: read-only)
├── observation-manifest.md # raw findings as they come in, worker-attributed
├── verification-economics.md
├── cause-disappearance.md  # tracked alternative explanations that got ruled out, and why
├── waves/
│   └── wave-N.md           # one file per wave: worker roster + EXPAND tail entries
└── SYNTHESIS.md            # final output — trace.md links here, does not inline it
```

## Phase 0 — Decompose and open the journal

Create the directory above and the initial (mostly empty) journal files before spawning anyone. `intent-diff.md` should capture, in a sentence or two, what the feature idea actually needs researched externally (library behavior, API contracts, prior art, known pitfalls) — distinct from what trace's codebase lanes already cover internally.

## Phase 1 — Saturation wave (first wave)

**Scaling floor — do not under-staff this.** A single narrow web topic still gets a floor of 6 workers (4 `librarian`, 1 general-purpose web worker, 1 repo-dive-style worker). A multi-facet research need scales to 14; full due-diligence scope scales to 15. Role breakdown for the first wave:

- **Codebase-facing** (3-4 workers): spawn `lsc-explore`. Use this only for research questions that need *this* repo's code re-examined from a different angle than the trace lanes already covered — not a duplicate of Stage 1's lane spawns.
- **Web librarian** (3-6 workers): spawn the **bundled `librarian` agent** (`agent: "librarian"` — this is an omp built-in agent, distinct from any `lsc-` agent; it is the correct role-match for ulw-research's own "librarian" worker role and is what "task 기본 에이전트" in this pipeline's contract refers to for web-facing roles). Do not use `lsc-explore` for this — it is codebase-only per its own contract and explicitly declines external-doc/literature requests.
- **Browsing** (0-3 workers): also `librarian` — deeper, more exploratory web browsing than a targeted lookup.
- **Repo-dive** (0-2 workers): also `librarian` — "repo-dive" here means diving into *other* (external, e.g. GitHub) repositories for prior art, not this project's own repo (that's the codebase-facing role above).

Each worker's `assignment` must follow ulw-research's worker contract template:

```
TASK: <role>. AXIS: <angle>.
This is an explicit exhaustive-research assignment. Your default retrieval budget and
stop-when-answered rules do not apply — run the full protocol below and report every lead.
SCOPE: <axis, sources, expected completeness>
PROTOCOL: <role-specific instructions>
## EXPAND
- LEAD: <discovery> — WHY: <why it matters> — ANGLE: <next search direction>
(or: none — <reason nothing further to expand>)
```

Every worker's final report must end with an `## EXPAND` section in exactly this shape — this is what Phase 2's convergence check parses.

## Phase 2 — Iterate to convergence

After each wave, read every worker's `## EXPAND` tail and log new leads into `.lsc/crafts/{feature}/research/waves/wave-N.md`.

**Convergence requires all of:**
- at least 2 expansion waves have run (the first saturation wave does not count as an expansion wave on its own),
- AND (zero unconfirmed leads remain, OR 3 consecutive waves produced zero new leads).

**Depth limit:** at 5 waves without convergence, stop and ask the user via `lsc_confirm` whether to extend further — do not silently keep spawning waves past this point.

## Phase 3 — Code verification

For any competing/undocumented/performance claim that can be settled by running code: pin the version, record the environment, and mark each as `CONFIRMED` / `REFUTED` / `PARTIAL`. Record these in `claim-graph.md`.

## Phase 3b — Lock non-code claims

A non-code claim only enters the "verified" set in `claim-graph.md` once it has: ≥2 independent source domains, ≥2 independent observation groups, at least one countersearch pass, primary-source backing, and time-relevance evidence (not stale). `claim-graph.md` is orchestrator-owned — workers read it, they do not edit it directly; you (the orchestrating session) are the one integrating worker reports into it.

## Phase 4 — Synthesis

Write `research/SYNTHESIS.md` by reading `intent-diff.md`, `claim-graph.md`, and `observation-manifest.md` and re-authoring (not concatenating) into a coherent narrative. **Every claim gets an inline `[Source N]` citation.** Only claims that made it into the verified set (§Phase 3b) may be cited for high-risk non-code assertions.

`trace.md`'s "External Research Summary" section (see `references/trace-protocol.md` §5) should summarize this file's conclusions in a few paragraphs and link to `research/SYNTHESIS.md` for the full citation trail — do not inline the whole research journal into trace.md (document-splitting mitigation, keeps trace.md focused and avoids re-reading the entire research corpus on every later reference to trace.md).

## Phase 5 — Asset production (scope this down for pre-craft)

ulw-research's original Phase 5 (HTML/PDF export via weasyprint, chart/diagram asset workers, visual-QA/frontend-review assembly workers) targets stand-alone research deliverables. pre-craft's research output is an internal pipeline artifact consumed by the interview/plan stages, not a polished external deliverable — skip Phase 5 entirely. `research/SYNTHESIS.md` as markdown is the final form.
