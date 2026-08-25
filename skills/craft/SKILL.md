---
name: craft
description: Runs the lets-craft craft pipeline — a single-shot implementation pass against pre-craft artifacts (or a post-craft audit's findings), spawning exactly one `lsc-executor` (or, when plan.md's work decomposes cleanly, several in parallel lanes this skill integrates itself). Trigger when the user says "craft" / "/craft", asks to implement or build a feature that already has a `.lsc/crafts/{feature}/` directory from pre-craft, or hands this skill a post-craft `audit/audit-N.md` path to fix. Takes `.lsc/crafts/{feature}/` (or `.lsc/crafts/{feature}/audit/audit-N.md`) as input; ends once the single pass (or parallel-lane set) completes and the implementation is committed, ready for the post-craft skill.
---

# craft

## 0. Role in the pipeline

lets-craft is a 3-stage pipeline: **pre-craft → craft → post-craft**. This skill owns the second stage: turning implementation-ready artifacts (or an adversarial audit's findings) into working code. **It is not a loop owner.** It reads `plan.md`'s Detailed TODOs, decides once whether the work decomposes into independent units worth running as parallel executor lanes, spawns either exactly one `lsc-executor` or one batch of lane executors, integrates their result onto the feature branch itself (cherry-pick, never `git merge` — that is post-craft's `lsc_land` alone, per this project's own RULE), and hands off. There is no forced continue-until-tests-pass loop, no protected test tree, and no `session_stop` backstop — those belonged to the implementation-before-tests design this refactor replaces (tests are now authored in post-craft, against the finished implementation, per `skills/post-craft/SKILL.md` §3.0). Its final act is a handoff message telling the user their feature is ready for `post-craft` — and, per §5's chaining gate, that handoff often continues straight into `post-craft`'s own contract in the same turn rather than ending the session here.

## 1. Common contract

1. **Question seam.** Every question this skill asks a human goes through `lsc_ask`/`lsc_select`/`lsc_confirm` — same seam pre-craft uses (§1.1 of `skills/pre-craft/SKILL.md`). In headless mode without a fixture configured these tools hard-error; that is correct, not a bug.
2. **Question tagging convention (load-bearing).** Every question starts with a bracketed English tag and every gate question ends in `approve?`/`proceed?`/`continue?` (case-insensitive, optional `?`) — identical rule to pre-craft §1.2, so fixture-mode E2E runs can answer deterministically. Tags this skill uses:
   - `[Parallel Lanes] ... Proceed?` — the §3.2 parallelization decision
   - `[Craft Incomplete] ... Proceed?` — the one-shot re-entry gate on a reported build/typecheck failure (§5)
   - `[Craft Complete] ... Proceed?` — final handoff confirmation

   **Option authoring & free-answer branching (follow pre-craft's SSOT).** Author every `lsc_select` option as `{label, description}`, and branch on each gate's result **CONTENT** exactly as `skills/pre-craft/SKILL.md` §1.2 "Option authoring & free-answer policy (SSOT)" parts (a)-(d) prescribe — never read `details` (the model never receives it). Each gate below restates its own free-answer branch, but that SSOT is the canonical rule.
3. **No document length limits (C9).** The implementation plan you derive for yourself in §2 below may be as detailed as the work requires.
4. **Tool inventory.** `lsc_craft_init` (call once, §3.1) / `lsc_craft_abort` (call only following an explicit user instruction to stop this craft run — there is no longer any gate in this skill whose decline branch triggers it automatically; the hash-violation/run-unavailable/no-progress escalations that used to call it are gone); `lsc_scaffold` to create each parallel lane's sibling worktree (§3.3, carrying the `base_ref` parameter C4 added); `lsc_ask`/`lsc_select`/`lsc_confirm` for every human-facing question; `task` — flat form for a single `lsc-executor` spawn, or **one batch call** carrying one `tasks[]` item per lane when §3.2 decides to parallelize (never mix the two shapes in one call, and never spawn a second batch/flat call for the same decision); `bash`/`read`/`glob`/`grep` directly for reading input documents, deriving the feature slug, and driving every git operation this skill performs itself — forkPoint capture, the parallel-lane guard/cherry-pick/cleanup sequence (§3.3/§3.4), and the completion commit (§4).
5. **Artifact paths** — mirror `src/artifacts/paths.ts` exactly (same convention pre-craft replicates by hand): `trace.md`/`spec.md`/`plan.md` under `{worktreeAbs}/.lsc/crafts/{feature}/`, and craft's own state (`.craft-state.json`, gitignored) directly at that same crafts root (C3 — it no longer lives nested under a test/ subtree). `{worktreeAbs}` is the absolute path to `.lsc/worktrees/{feature}/` — pre-craft always creates it, and this skill always operates against it (§2.5: no project-root fallback at the skill-policy level). Any `bash`/`read` call this skill makes directly against these files must use `{worktreeAbs}`, never the project root.
6. **Feature slug.** `lsc_craft_init`/`lsc_craft_abort`/`lsc_scaffold` all accept either a bare feature name, the pre-craft dir path, or an `audit/audit-N.md` path for `feature_dir` — they resolve it internally (`resolveFeatureName`: the path segment right after `crafts/`, or the last path segment for a bare name). But `bash`/`read` calls in this skill need the literal slug, so derive it once at the start with the same rule and reuse it everywhere below.
7. **Waiting discipline — polling is forbidden, not merely discouraged.** Each executor spawn (a single one, or every lane in a batch) delivers its result automatically the moment it finishes; this skill never polls to retrieve it. Issuing a `job {"poll": [...]}` call against a task already in flight is a **contract violation**, not a style preference: registering a watch/acknowledgement on it *suppresses* that automatic delivery instead of speeding it up, and each such call burns a turn for nothing. So: **never call `job {"poll": [...]}` on a task in flight.** If this skill genuinely has nothing else to do while the executor(s) run, call `job` with **no arguments, exactly once**, to block until they return — a single blocking wait, never a poll loop and never a sequence of short blocking waits used as a poll substitute. In the parallel path, that one blocking wait covers the whole batch — do not wait on each lane separately. **429/5xx/overloaded backoff — trigger scope covers provider failures broadly, not literal 429 alone.** If an executor spawn dies to a rate-limit or any 5xx/overloaded-class provider failure (429, 500/502/503/529, `overloaded_error`, and equivalent transient provider errors — a measured stall in this project was triggered by `overloaded_error`, never a literal 429, so do not gate this rule on the literal string "429"), retry it with the **same model and same effort under exponential backoff first**; escalating the model or effort is a last resort only after backoff is genuinely exhausted, never the first response.

**No-progress early detection (standard procedure, 15 minutes).** While waiting on an executor spawn, if its retryState shows repeated failures, or no progress event has been observed for 15 minutes: ① send it an idle-recovery request using this standard wording — `"provider 장애로 yield가 유실된 것으로 보인다. 이미 수행한 조사를 이어서 지금 답장으로 렌더하라"` (or the session's working-language equivalent) — before assuming anything is actually stuck. ② If that idle-recovery request itself produces no response, re-spawn the same worker at the same model, opening the new assignment verbatim with this standard respawn template — `"이전 시도가 provider 장애로 유실되어 재시도한다"` (or its working-language equivalent) — followed by the same assignment content the original spawn received. This is a standard procedure, not an ad hoc judgment call each time it happens. In the parallel path, this applies per lane — a stalled lane is re-spawned on its own without disturbing its siblings (the batch host isolates sibling failures, `skills/pre-craft/SKILL.md` §3.1 step 4).

**Wait `timeoutMs` — unify to the 3,000,000ms (50-minute) class across every wait in this skill**, not a shorter one for early stages and a longer one later. A measured run that used shorter timeouts in its early stages burned 42 repolling turns once each timeout lapsed, consuming 26.6% of total session cost for zero wall-clock benefit — a short timeout does not make the wait resolve any sooner, it only forces more repolling turns after it expires.

Any direct wait on another agent rather than on a spawned `task`'s own completion should use `irc {"op": "wait", "timeoutMs": ...}` instead — event-driven, and it releases automatically if the counterpart agent dies.

**Escape valve.** If the user explicitly asks to stop the craft run at any point in §2 or §3, call `lsc_craft_abort(reason: "...")` immediately and end the turn — do not continue into whichever section you were on, and do not proceed to §4/§5 (there is nothing to complete or hand off).

## 2. Input interpretation (C22)

1. **Classify the input** you were given (an explicit path/arg, or the pre-craft skill's own handoff message):
   - Ends in `audit/audit-N.md` → **audit-driven craft**: a prior craft→post-craft cycle already ran and post-craft returned REJECT or APPROVE-WITH-CHANGE. The audit's findings are what you now implement.
   - Anything else (bare feature name or the `.lsc/crafts/{feature}/` dir itself) → **first-time craft** against fresh pre-craft output.
2. **Validate the artifacts exist** before doing anything else: `trace.md`, `spec.md`, `plan.md` must all be present under `.lsc/crafts/{feature}/`. If any is missing, stop and tell the user to run `pre-craft` for this feature first — do not attempt to improvise a plan from partial artifacts.
3. **Read everything, thoroughly, before writing a single line of your own plan:**
   - Always read `trace.md`, `spec.md`, and `plan.md` in full — they are the ground truth for what "correct" means, even on an audit-driven run (an audit references but does not restate them). Prior plan revision history (per consensus iteration) lives under `{worktreeAbs}/.lsc/crafts/{feature}/plan/plan-{N}.md`; `plan.md` itself is only the latest confirmed plan's core sections. Consult `plan/` only when you need the reasoning behind a specific plan decision — do not read the whole ledger by default. Deliberation detail beyond the plan's core (full DR per-branch detail, pre-mortem in full, verification strategy, external precedent, security/multi-repo detail) lives in `plan/appendix-{topic}.md` alongside it; `plan.md` itself carries only a 1-line summary + pointer to each.
   - Audit-driven runs additionally read the target `audit/audit-N.md` in full — its findings are the concrete action items, not the original spec/plan (those describe the target state; the audit describes the gap between that state and what a prior craft attempt actually produced).
4. **Derive a stepwise implementation plan** from all of the above before spawning anything — an ordered breakdown of implementation units (e.g. "fix X in file Y", "add Z per audit finding #3"), each one specific enough to judge whether it is independent of the others (§3.2 needs this). This plan is context you hand to the executor(s) in §3.3, not a new artifact file — it is not `plan.md` and does not get written to `.lsc/crafts/{feature}/`.
5. **Worktree presence check.** Every craft now always runs against a worktree — pre-craft always creates `.lsc/worktrees/{feature}/` in its own Stage 0 (C6/R5) — so this is a presence check, not a mode branch. If it's missing, that is not a valid signal to fall back to the project root: it means pre-craft never finished (or finished before this all-in-worktree design existed). Stop and tell the user to (re-)run `pre-craft` for this feature rather than silently operating against the project root. Once confirmed, resolve and record `{worktreeAbs}` (the absolute path to `.lsc/worktrees/{feature}/`) — `lsc_craft_init` always takes `worktree: true` (§3.1), and every executor spawn's assignment must state `{worktreeAbs}` explicitly (the `task` tool always spawns subagents at the *main session's* cwd, never a per-spawn cwd, so "the worktree is the implementation root" is information only the assignment text can carry).

## 3. Single-shot execution

### 3.1 Initialization (once)

Call `lsc_craft_init(feature_dir, worktree: true)` — always `true` now (§2.5: craft only ever runs against a worktree). This registers the active craft (`getActiveCraft()`), verifying `trace.md`/`spec.md`/`plan.md` exist and are non-blank.

**Record `forkPoint` now, once:** `forkPoint = git -C {worktreeAbs} rev-parse HEAD`. This is the fork point every parallel lane (§3.3) branches from and every lane's integration (§3.4) cherry-picks against; on the single-executor path it is still useful for deriving the commit list this run produces (`git -C {worktreeAbs} log --oneline {forkPoint}..HEAD`). It is a plain in-context value, not persisted state — if a compaction or session resume loses it mid-run, §3.4 step 0 below is the recovery rule; do not guess or substitute the feature branch's current tip.

### 3.2 Parallelization decision (new prose)

Read `plan.md`'s Detailed TODOs. Parallelize **only** when 2 or more units both satisfy: ① the units touch disjoint file sets (no ordering dependency the plan's Task Flow names) ② each unit is independently committable. When that judgment holds, ask via `lsc_confirm`:

`[Parallel Lanes] plan.md에서 서로소인 구현 유닛 {K}개를 병렬 executor로 실행한다: {유닛 요약}. Proceed?`

Only CONTENT exactly `yes` takes the parallel path (§3.3's parallel branch). Anything else — a `no`, or a free answer (result CONTENT begins `User provided free answer:`, which is guidance, not approval — reflect it and re-ask per pre-craft §1.2 SSOT (c)) — goes to the single-executor path instead. When you are not confident the units are genuinely independent, do not ask at all — go straight to the single-executor path. Parallelization is an optimization, not a contract: the safe default is one executor.

### 3.3 Execution

- **Single-executor path.** Spawn one `lsc-executor` via `task` (flat form, `agent: "lsc-executor"`) — **exactly one `lsc-executor` spawn**, this run's entire implementation pass. The `assignment` must be self-contained and state:
  - The full stepwise implementation plan from §2.4 (or the audit's findings verbatim, on an audit-driven run).
  - `{worktreeAbs}` as the implementation root — all file operations must target paths under it, since the subagent's actual working directory is the project root, not the worktree.
  - Note that some of the plan may already be done — instruct the executor to check `git log`/`git diff` in the implementation root first rather than assuming a blank slate.
  - **"After implementing, run this project's own build/typecheck yourself once and include the result in your report."** There is no verification tool this skill calls on the executor's behalf anymore — the executor is the one that knows how to invoke its own project's build, and its self-report is what §5's `[Craft Incomplete]` gate reads.

  `lsc-executor` is expected to make its own feature-granularity commits per this project's own RULE (already part of its system prompt as a bundled capability, not a project-tree file) as it works.

- **Parallel-lane path.** The audit cycle `C` = the count of `audit-*.md` files under **`{worktreeAbs}/.lsc/crafts/{feature}/audit/`** (a first craft has `C = 0`). **Anchoring `C` to this exact root is load-bearing**: reading the project root's `.lsc/crafts/` instead would always find `C = 0` (audit documents only ever live inside the worktree), so the cycle-scoped lane slug below could never distinguish one audit cycle's lanes from the next's — one layer of §3.4's three-layer defense would then silently die (only the merge-base guard and the branch cleanup would remain).

  For each lane `K`, call `lsc_scaffold({feature: "{feature}-c{C}-lane-{K}", branch: "{featureBranch}-c{C}-lane-{K}", base_ref: "{forkPoint}"})` — the lane slug `{feature}-c{C}-lane-{K}` passes the existing kebab-slug validation unchanged. Record the returned absolute worktree path as that lane's own implementation root in its assignment. Spawn **all lanes in one `task` batch call** (never a mix of separate flat calls) — this host isolates sibling failures within a batch, so one lane dying to a provider error never cancels the others (`skills/pre-craft/SKILL.md` §3.1 step 4). Instruct each lane's commit subjects to carry a `[lane-K]` prefix, so §3.4's integration can attribute each commit to its lane at a glance. Each lane assignment carries the same two closing instructions the single-executor path states above (implementation root, self-run build/typecheck and report it).

### 3.4 Integration (new prose, BL3 + forkPoint recovery)

**0. Confirm `forkPoint` — re-derive it if it was lost.** If the value §3.1 recorded is not present in this turn (session resumed, or a compaction happened since), do not guess it or substitute the feature branch's current tip — if any lane has already been partially integrated, that tip has already moved. Every lane branched from the **same** fork point, so re-derive it from any one lane via `git -C {worktreeAbs} merge-base {featureBranch} {laneBranch}`. With multiple lanes, run this against all of them and confirm they agree — a disagreement means one lane was built from a different baseline than the others; do not integrate, report it to the user instead.

For each lane `K`, in order:
1. **Guard**: `git -C {worktreeAbs} merge-base --is-ancestor {forkPoint} {laneBranch}` — a failure means this lane did not fork from this cycle's fork point (possibly a reused branch from a prior cycle); do not integrate it, report it to the user instead.
2. **Apply**: `git -C {worktreeAbs} cherry-pick {forkPoint}..{laneBranch}`. Under any circumstances, **never run `git merge` in this skill** — merging is `lsc_land`'s alone (post-craft owns it, per this project's own RULE), and a cherry-pick of a disjoint file set is a linear replay, not a merge.
3. **Conflict**: `git -C {worktreeAbs} cherry-pick --abort`, then report which lane/file conflicted and re-run that lane's work sequentially through a single executor instead. A conflict is a signal that §3.2's disjointness judgment was wrong.
4. **Cleanup, after a successful integration**: `git -C {projectRoot} worktree remove .lsc/worktrees/{feature}-c{C}-lane-{K}` (**no `--force`**) → `git -C {projectRoot} worktree prune` → **`git -C {projectRoot} branch -D {featureBranch}-c{C}-lane-{K}`**. The branch delete matters as much as the worktree removal: without it, the next cycle's `lsc_scaffold` call would find a same-named branch already exists and reuse it (ignoring `base_ref`, per `src/artifacts/worktree.ts`'s own reuse semantics, C4 BL3) instead of forking a fresh lane from the new cycle's fork point. The cycle number already inside the slug means no cycle can structurally collide with another, but the delete is still worth doing — for hygiene, and so `doctor`'s orphan-worktree check does not accumulate WARNs across cycles.
5. If a non-forced `worktree remove` is refused, that means uncommitted changes remain — **do not force it**; show the state to the user and leave it as-is.

## 4. Completion and commit

1. **Confirm the exit condition.** Either the single-shot execution (§3) completed normally — the executor (or, on the parallel path, every lane) finished and §3.4 integrated cleanly onto the feature branch — or the escape valve in §1 was used (an explicit user stop, via `lsc_craft_abort`).
2. **On a completed exit**: run `git -C {worktreeAbs} status --short` (the implementation root is always the worktree now — §2.5). If anything is uncommitted (the executor's own commits per RULE should normally leave nothing behind, but verify rather than assume), commit it yourself per this project's own RULE's structured body (`what:`/`why:`/`evidence:`/`verify:`).
3. **On an aborted exit** (the §1 escape valve was used): report plainly that the user asked to stop and where in the run that happened, and end the turn here — do not proceed to §5; there is nothing to hand off for a run that was explicitly cut short.

## 5. Handoff — exit evidence, the 20 reachable cases, and the canonical red continuation

### 5.0 Exit evidence — executor state × fresh check evidence (corrected Goal (C) contract)

Every exit is decided by TWO independent facts, never one alone:

1. **Executor state** — `complete` or `incomplete`: the executor's (or, on the parallel path, every lane's) own report of whether it finished the whole assignment, plus §4's uncommitted-work check.
2. **Fresh check evidence** — on every audit-driven re-entry where post-craft's authored `check/run_check.sh` exists, run `lsc_run_check(feature_dir, timeout_ms: 600000)` yourself (fresh — never reuse a log an earlier step or a prior cycle produced) and classify the ACTUAL tool result, before any attribution:

```ts
type CheckEvidence =
  | { state: "green"; details: RunCheckDetails & { passed: true }; logPath: string }
  | {
      state: "executed-red";
      details: RunCheckDetails & { passed: false };
      logPath: string;
      repairHint: "implementation" | "test-check" | "unknown";
    }
  | {
      state: "infrastructure";
      diagnostic: string;
      logPath?: string; // tool이 이 실패에서도 실제 log를 생성한 경우에만
      repairHint?: never;
    };
```

Classification is exact: `details.passed === true` is the ONLY `green`. A well-formed `details` carrying `passed === false` (nonzero exit or a killed run) is the ONLY `executed-red` — a cause-neutral observation of an executed red, never in itself proof of a production defect. A details-less `isError`, invalid/missing `details`, target refusal · execution exception · empty transcript, or an unregistered/unavailable `lsc_run_check` is `infrastructure`. `green` and `executed-red` REQUIRE the actual `details` and the tool-created `logPath`. `infrastructure` preserves the raw `diagnostic`, carries `logPath` ONLY when the tool actually produced one for this failure, and NEVER a synthetic path or a `repairHint`.

**Boundary.** A FIRST-time craft has no post-craft-authored check script yet — §3.3's executor self build/typecheck report is the only check evidence there, and §5.2's EXEC-RETRY is the only retry selector that can fire. The fresh-green obligation binds every audit-driven re-entry from the moment `check/run_check.sh` exists.

**`executed-red` attribution — a best-effort `repairHint`, never an owner authority.** Compare ONLY the current OID's just-created check log/transcript against the prior Required Fix's target/remediation; the prior OID's §3.0 test-authoring report is removed from the attribution inputs. `RunCheckDetails` carries no per-step command identity, so an exact failing command counts as best-effort evidence ONLY when it is uniquely identifiable from the script/log; multi-command ambiguity or a missing path/category closes as `unknown`. The record keeps the current implementation OID and the required `details`/`logPath`/observation basis/`repairHint`, and is never reused as the next cycle's authority. The three hints:
- `implementation` — only when the prior fix targeted a production path/behavior AND the fresh failure evidence directly identifies an immediately-repairable mismatch on that same target AND there is not a single `test-check` signal.
- `test-check` — a diagnostic hint used when the prior fix directly targeted tests/checks, or the fresh log directly identifies a defect in the check entrypoint/load/compile/collection/path artifact itself. Craft does not repair this artifact here — it `CYCLE-RETURN`s.
- `unknown` — path not extractable, mixed signals, missing/conflicting evidence, or an assertion that cannot be decided between test defect and production defect. Production repair is not allowed; `CYCLE-RETURN`.

**`[Craft Complete]` is a conjunction (load-bearing).** The completion declaration — and the §5.5 chaining gate — is permitted ONLY when executor = `complete` AND the fresh check evidence is `green`. Executor success never outranks an `executed-red`/`infrastructure` observation, and green never covers an incomplete executor. Declaring completion with a red or not-run check is FORBIDDEN; a red is returned only as a `[Craft Incomplete]` carrying the actual red evidence (§5.3).

### 5.1 The 20 reachable cases (union branches expanded; green/infrastructure get no hint axis)


executor (2) × evidence (3) × `retryUsed` (2), expanded per union branch ONLY — the hint axis multiplies neither green nor infrastructure: **4 + 12 + 4 = 20**. The `action` column is the route §5.2/§5.3/§5.4 take.

| # | executor | evidence state | `retryUsed` | `repairHint` field | action |
|---:|---|---|---:|---|---|
| 1 | complete | green | false | 금지(필드 없음) | `COMPLETE` |
| 2 | complete | green | true | 금지(필드 없음) | `COMPLETE` |
| 3 | incomplete | green | false | 금지(필드 없음) | `EXEC-RETRY` |
| 4 | incomplete | green | true | 금지(필드 없음) | `RETRY-EXHAUSTED` |
| 5 | complete | executed-red | false | `implementation` | `IMPL-RETRY` |
| 6 | complete | executed-red | false | `test-check` | `CYCLE-RETURN` |
| 7 | complete | executed-red | false | `unknown` | `CYCLE-RETURN` |
| 8 | complete | executed-red | true | `implementation` | `CYCLE-RETURN` |
| 9 | complete | executed-red | true | `test-check` | `CYCLE-RETURN` |
| 10 | complete | executed-red | true | `unknown` | `CYCLE-RETURN` |
| 11 | incomplete | executed-red | false | `implementation` | `IMPL-RETRY` |
| 12 | incomplete | executed-red | false | `test-check` | `CYCLE-RETURN` |
| 13 | incomplete | executed-red | false | `unknown` | `CYCLE-RETURN` |
| 14 | incomplete | executed-red | true | `implementation` | `CYCLE-RETURN` |
| 15 | incomplete | executed-red | true | `test-check` | `CYCLE-RETURN` |
| 16 | incomplete | executed-red | true | `unknown` | `CYCLE-RETURN` |
| 17 | complete | infrastructure | false | 금지(필드 없음) | `CYCLE-RETURN` |
| 18 | complete | infrastructure | true | 금지(필드 없음) | `CYCLE-RETURN` |
| 19 | incomplete | infrastructure | false | 금지(필드 없음) | `CYCLE-RETURN` |
| 20 | incomplete | infrastructure | true | 금지(필드 없음) | `CYCLE-RETURN` |

### 5.2 Retry selectors — EXEC-RETRY / IMPL-RETRY only; one shared `retryUsed`

Only two rows of the table open the user's one-shot retry selector, and they share a SINGLE boolean `retryUsed` for the whole parent invocation — an executor failure and an immediately-repairable implementation red consume the same one shot:

- **EXEC-RETRY** (rows 3–4: executor `incomplete`, evidence `green`) — the existing one-shot re-entry gate, unchanged. If the executor (or any lane) reported a build/typecheck failure in §3.3, ask this **before** the chaining gate below — and only once:

  `[Craft Incomplete] executor가 빌드/타입체크 실패를 보고했다: {요약}. executor를 1회만 다시 실행할까? (아니오 = 실패 상태 그대로 post-craft 감사로 넘긴다) Proceed?`

  CONTENT exactly `yes` → set `retryUsed = true` immediately before the re-spawn, re-spawn that executor once carrying the failure summary into the new assignment, **and whatever that re-spawn reports, there is no second re-entry.** `no`, or a free answer (reflect it as guidance and re-ask this exact gate, pre-craft §1.2 SSOT (c)) → proceed as-is, failure and all, ending at row 4 with `reason=retry-exhausted`. The cap is 1 and the decision is the user's, not an automatic retry — this is not a loop; what the spec dismantled was unconditional automatic repetition, not a single user-directed judgment call.

- **IMPL-RETRY** (rows 5 and 11: `executed-red` with `repairHint=implementation` and `retryUsed=false`) — the immediately-repairable production red. Ask, once, the same shape of one-shot question:

  `[Craft Incomplete] 수정 직후 체크가 여전히 붉다: {details 요약 + 로그 path}. 단일 production repair executor를 1회만 실행할까? (아니오 = red evidence와 함께 다음 post-craft cycle로 돌아간다) Proceed?`

  CONTENT exactly `yes` → set `retryUsed = true`, then run ONE single production-repair `lsc-executor` spawn against the integrated `{worktreeAbs}` (where serial/parallel final commits have all landed). An IMPL-RETRY assignment arriving from `executor=incomplete` covers BOTH the repairHint's specific defect AND the original executor's unfinished leftovers — it is complete only when both are done. `no` → `reason=retry-declined`; a cancelled roundtrip → `reason=retry-cancelled`. A repair executor that ends incomplete or unheard, or makes no commit → end with `reason=repair-incomplete`. On complete+commit: re-run the check EXACTLY once and re-enter the §5.1 table at executor=`complete`, `retryUsed=true` (rows 8–10) — a post-repair red opens NO second production retry; it ends as the hint-appropriate `CYCLE-RETURN` reason (`re-red` for `implementation`, §5.3). Deleted parallel lanes are never re-spawned, and no per-lane token or per-lane executor is ever created.

### 5.3 The eight `[Craft Incomplete]` reasons

Every non-COMPLETE exit ends as a `[Craft Incomplete]` report carrying: the executor state, the current implementation OID, the manual next step, and ONLY the actual union-branch evidence — green/executed-red: required `details` + `logPath`; executed-red only: the `repairHint`; infrastructure: the raw `diagnostic` and, only if the tool actually created one, an optional `logPath`. The eight exact reason labels:

| exact `reason` | when |
|---|---|
| `retry-declined` | the user answered `no` to a §5.2 one-shot selector |
| `retry-cancelled` | the selector roundtrip was cancelled (Esc / no answer) |
| `retry-exhausted` | row 4 — green evidence, executor still `incomplete` with `retryUsed=true` |
| `re-red` | rows 8/14 — `retryUsed=true` AND an `implementation`-hint executed-red (the one-shot repair already ran and the red persists) |
| `repair-incomplete` | the IMPL-RETRY repair executor ended incomplete/unheard or made no commit |
| `test-check-red` | an executed-red whose `repairHint` is `test-check` |
| `red-attribution-unknown` | an executed-red whose `repairHint` is `unknown` |
| `check-infrastructure` | an `infrastructure` evidence branch |

### 5.4 `CYCLE-RETURN` — the canonical continuation is a NORMAL new post-craft cycle

`CYCLE-RETURN` (every row whose action column says so) is not a completion and never a disguised `[Craft Complete]`: end the turn with the §5.3 `[Craft Incomplete]` report, then the user — or the orchestrating session — invokes a normal, fresh `post-craft` run against `.lsc/crafts/{feature}/`. That is the ONE continuation path:

- The normal post-craft run calls `lsc_audit_begin` as always, consuming the next audit cycle, and re-authors/repairs/re-evaluates §3.0's tests at the CURRENT implementation OID, then continues its check/audit as always. If the tests were the problem, §3.0 repairs them and green resumes the complete path; if healthy tests keep a production red alive, the audit's Required Fix → craft path carries it. Do NOT precondition the return on a fresh green for `unknown`/`test-check`/`infrastructure` reds — re-establishing evidence at the current OID is precisely the next cycle's §3.0/check/audit job.
- Each return costs one audit cycle, and the persisted `auditCycle` plus the periodic escalation interval (TS SSOT `LIVE_AUDIT_ESCALATION_INTERVAL` / `FIXTURE_AUDIT_ESCALATION_INTERVAL`, `src/craft/audit-policy.ts`) bound the repetition: at a due cycle `lsc_audit_begin` issues no new cycle without an explicit `Continue auditing`, and `Abort this craft` / `Preserve branch and stop` end the loop durably.
- Never resume a handoff and never reuse a prior report across OIDs: there is no §3.0-only entry mode, no durable handoff envelope, no resume token, and no second-stage executor table in this contract. A crash mid-return simply follows the next post-craft run's same-cycle begin replay rule.

### 5.5 Chaining gate — on COMPLETE only

Only a §5.1 row-1/row-2 `COMPLETE` reaches this gate. Check `[ -n "$LSC_FIXTURE" ]` (bash, one-time check right here) and, if unset, whether this session's accumulated context is already large (long-running session, several executor spawns behind you). Ask for final handoff regardless of either:

`[Craft Complete] craft is done for "{feature}" — the implementation is committed and the fresh check is green. Run the post-craft skill against .lsc/crafts/{feature}/ next. Proceed?`

via `lsc_confirm`. Regardless of the answer, tell the user plainly, in text: whether the run was single-executor or parallel-lane (and how many lanes), any unresolved failure left behind (there is none on a COMPLETE — say so), the CheckEvidence branch backing the completion (`green` + its `logPath`), the list of commits made during this craft run (`git -C {worktreeAbs} log --oneline {forkPoint}..HEAD`), and the exact path to pass to `post-craft`.
A free answer here (result CONTENT begins `User provided free answer:`) is not a yes — reflect it as guidance and re-ask this `[Craft Complete]` gate (pre-craft §1.2 SSOT (c)); only CONTENT exactly `yes` chains to post-craft.
- **"yes", and neither gate above applies (not fixture mode, context not oversized)**: `read skill://post-craft` in this same turn — it returns post-craft's full contract text — and continue executing from post-craft's own §0 immediately, without ending this turn. **From this point on, this skill's own contract (§0's "not a loop owner," everything above) no longer applies — only the contract you just read from `skill://post-craft` governs the rest of this turn.** This is not hypothetical: `read skill://{skill}` returning the live contract text, and an in-turn tool call from that contract succeeding right after, has been confirmed against the real host.
- **"yes", but `$LSC_FIXTURE` is set**: do not chain — the E2E harness drives pre-craft, craft, and post-craft as three separate invocations, and chaining here would run post-craft inside this craft turn, breaking that structure. This confirmation is a courtesy checkpoint under fixture mode, not a hard gate — end the turn normally.
- **"yes", but this session's context is already large**: do not chain either — tell the user explicitly that you're recommending a fresh session for `post-craft` instead, and why, then end the turn.
- **"no"**: end the turn. Tell the user plainly: "Next step is manual — invoke the `post-craft` skill yourself against `.lsc/crafts/{feature}/`."

## 6. Context management (R2)

`trace.md`/`spec.md`/`plan.md`/audit documents may be large — read them once during §2.3, extract what you need into your own §2.4 plan, and do not re-read them in full again this run. **This no-duplicate-read discipline binds not only what this skill instructs `lsc-executor` (or each lane) to do, but each spawned executor's own turn as well** — a spawned executor must not re-`read` a file it already read earlier within that same turn absent its own intervening write/edit.
