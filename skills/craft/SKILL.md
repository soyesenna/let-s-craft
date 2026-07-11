---
name: craft
description: Runs the lets-craft craft pipeline — the skill-owned loop that implements code against pre-craft artifacts (or a post-craft audit's findings) and repeats executor→verify→test until every test passes. Trigger when the user says "craft" / "/craft", asks to implement or build a feature that already has a `.lsc/crafts/{feature}/` directory from pre-craft, or hands this skill a post-craft `audit/audit-N.md` path to fix. Takes `.lsc/crafts/{feature}/` (or `.lsc/crafts/{feature}/audit/audit-N.md`) as input; ends when run_test.sh passes cleanly, with the implementation committed and ready for the post-craft skill.
---

# craft

## 0. Role in the pipeline

lets-craft is a 3-stage pipeline: **pre-craft → craft → post-craft**. This skill owns the second stage: turning implementation-ready artifacts (or an adversarial audit's findings) into working code, by directly owning a forced loop — `lsc-executor` spawn → hash verification → test run → repeat — that does not stop until every test passes or the user explicitly aborts (C19). It never writes plans or specs, and it never touches the protected test tree itself. Its final act is a handoff message telling the user their feature is ready for `post-craft`.

**Why this skill, not the extension, owns the loop**: the platform's `session_stop` backstop only fires for the *main session* (subagents never trigger it), so the loop control has to live in whichever skill the main session is running — that is this SKILL.md, not a TypeScript orchestrator. The extension (`src/craft/*.ts`) only supplies primitives this skill calls in a fixed order: `lsc_craft_init`, `lsc_run_tests`, `lsc_verify_hash`, `lsc_restore_tests`, `lsc_craft_abort`, plus the `tool_call` block and `session_stop` continuation that run silently underneath every step below.

## 1. Common contract

1. **Question seam.** Every question this skill asks a human goes through `lsc_ask`/`lsc_select`/`lsc_confirm` — same seam pre-craft uses (§1.1 of `skills/pre-craft/SKILL.md`). In headless mode without a fixture configured these tools hard-error; that is correct, not a bug.
2. **Question tagging convention (load-bearing).** Every question starts with a bracketed English tag and every gate question ends in `approve?`/`proceed?`/`continue?` (case-insensitive, optional `?`) — identical rule to pre-craft §1.2, so fixture-mode E2E runs can answer deterministically. Tags this skill uses:
   - `[Hash Violation] ... Proceed?` — C23b restore-and-continue gate
   - `[Run Unavailable] ... Proceed?` — C23c run_test.sh-unrunnable escalation
   - `[Craft Complete] ... Proceed?` — final handoff confirmation
3. **No document length limits (C9).** The implementation plan you write for yourself in §2 below may be as detailed as the work requires.
4. **Tool inventory.** `lsc_craft_init` / `lsc_run_tests` / `lsc_verify_hash` / `lsc_restore_tests` / `lsc_craft_abort` (the five craft-phase tools — pre-craft is explicitly forbidden from calling these; this skill is their only caller); `lsc_ask`/`lsc_select`/`lsc_confirm` for every human-facing question; `task` (single-spawn, flat form — one `lsc-executor` at a time, never batched, since each iteration depends on the previous test result) to spawn the executor; `bash`/`read`/`glob`/`grep` directly for reading input documents, deriving the feature slug, checking git state, and producing the diff a hash violation needs for the confirm prompt (`lsc_verify_hash` reports *which* paths changed, not their diff content — this skill gets the diff itself via `git diff`/`git status`, see §3.3; the actual restore, once approved, goes through `lsc_restore_tests`, never `bash`/`git`, see §3.3 point 3).
5. **Artifact paths** — mirror `src/artifacts/paths.ts` exactly (same convention pre-craft replicates by hand): `trace.md`/`spec.md`/`plan.md`/`test/run_test.sh` under `.lsc/crafts/{feature}/`, hash manifest and craft state under `.lsc/crafts/{feature}/test/.hash-manifest.json` / `.craft-state.json` (both excluded from hash protection itself), test logs under `.lsc/crafts/{feature}/test/logs/run-N.log`, worktree (if any) at `.lsc/worktrees/{feature}/`.
6. **Feature slug.** Every tool above accepts either a bare feature name, the pre-craft dir path, or an `audit/audit-N.md` path for `feature_dir` — they resolve it internally (`resolveFeatureName`, same logic: the path segment right after `crafts/`, or the last path segment for a bare name). But `bash`/`read` calls in this skill need the literal slug, so derive it once at the start with the same rule and reuse it everywhere below.
7. **Fixture mode bounding (Phase 7 harness — plan §Phase 7 (b)(c)).** Check `[ -n "$LSC_FIXTURE" ]` (bash) once, right after §2's input resolution, and reuse that answer for the rest of the run. When true, the loop's only cap is otherwise the platform's `session_stop` backstop (C19, effectively unbounded in wall-clock/iteration terms) — that alone is not cost/time-bounded enough for CI, so add two fixture-only limits on top of it (never applied outside fixture mode):
   - **Executor iteration cap: 3.** Track the count yourself starting from the first §3.2 spawn. If the 3rd iteration's §3.3/§3.4 checks still end with `details.passed: false` (a normal loop-continuation outcome, not a hash violation or run-unavailable escalation), do not spawn a 4th `lsc-executor` — instead call `lsc_craft_abort(reason: "fixture mode iteration cap (3) reached without passing tests")` immediately and proceed to §5 exactly as any other aborted exit (report which iteration hit the cap and the last failure summary). The bundled fixture sample is sized to converge within 1-2 iterations (see `fixtures/sample-ts-cli`'s intentional-bug note), so reaching this cap in a passing E2E run should not happen — treat it as a signal something is wrong with the executor's output or the fixture itself, not routine behavior.
   - **`lsc_run_tests` timeout.** Pass a bounded `timeout_ms` (e.g. `120000`) on every `lsc_run_tests` call in §3.4 so a hung or runaway test process cannot stall the harness indefinitely.

## 2. Input resolution and analysis (C22)

1. **Classify the input** you were given (an explicit path/arg, or the pre-craft skill's own handoff message):
   - Ends in `audit/audit-N.md` → **audit-driven craft**: a prior craft→post-craft cycle already ran and post-craft returned REJECT or APPROVE-WITH-CHANGE. The audit's findings are what you now implement.
   - Anything else (bare feature name or the `.lsc/crafts/{feature}/` dir itself) → **first-time craft** against fresh pre-craft output.
2. **Validate the artifacts exist** before doing anything else: `trace.md`, `spec.md`, `plan.md`, `test/run_test.sh` must all be present under `.lsc/crafts/{feature}/`. If any is missing, stop and tell the user to run `pre-craft` for this feature first — do not attempt to improvise a plan from partial artifacts.
3. **Read everything, thoroughly, before writing a single line of your own plan:**
   - Always read `trace.md`, `spec.md`, and `plan.md` in full — they are the ground truth for what "correct" means, even on an audit-driven run (an audit references but does not restate them).
   - Audit-driven runs additionally read the target `audit/audit-N.md` in full — its findings are the concrete action items, not the original spec/plan (those describe the target state; the audit describes the gap between that state and what a prior craft attempt actually produced).
   - Read `test/` (`run_test.sh` plus every test file it delegates to) to understand exactly what "pass" means mechanically — do not infer this from spec.md's prose alone.
4. **Derive a stepwise implementation plan** from all of the above before spawning anything — an ordered breakdown of implementation units (e.g. "fix X in file Y", "add Z per audit finding #3"). This plan is context you hand to the executor in §3.2, not a new artifact file — it is not `plan.md` and does not get written to `.lsc/crafts/{feature}/`.
5. **Worktree detection.** Check whether `.lsc/worktrees/{feature}/` exists. If it does, this craft runs in worktree mode: `lsc_craft_init` takes `worktree: true`, and every executor spawn's assignment must state the worktree's absolute path explicitly (§3.2 — the `task` tool always spawns subagents at the *main session's* cwd, never a per-spawn cwd, so "the worktree is the implementation root" is information only the assignment text can carry).

## 3. The loop (C19, §3.2 of the plan — fixed order)

### 3.1 Initialization (once, before the first iteration)

Call `lsc_craft_init(feature_dir, worktree: <true if §2.5 found a worktree>)`. This records the SHA-256 hash manifest of `test/` and registers the active craft — it activates the `tool_call` block and the `session_stop` backstop from this point on. Call this exactly once per craft run, before iteration 1, never again inside the loop.

**Resume note.** If `.lsc/crafts/{feature}/test/.craft-state.json` already exists (a prior craft run for this feature, possibly interrupted mid-loop by a process restart), `read` it first. `lsc_craft_init` must still be called — it is the only way to re-register the in-memory active-craft singleton after a restart, and it is safe to re-call (the test tree is invariant, so the recomputed manifest matches) — but it always resets `lastFailureSummary` to nothing. If the file you read shows `testsPassed: false` and a non-empty `lastFailureSummary`, manually carry that failure text into the first executor spawn below yourself, since `lsc_craft_init` will not.

### 3.2 Executor iteration

Spawn one `lsc-executor` via `task` (flat form, `agent: "lsc-executor"`). The `assignment` must be self-contained (a fresh subagent instance every iteration, no memory of prior iterations) and state:
- The relevant implementation units from your §2.4 plan (on iteration 1: the full breakdown, or the audit's findings verbatim; on later iterations: the same context plus everything below).
- **If worktree mode**: the absolute path to `.lsc/worktrees/{feature}/` as the implementation root — all file operations must target paths under it, since the subagent's actual working directory is the project root, not the worktree.
- Note that some of the plan may already be done — instruct the executor to check `git log`/`git diff` in the implementation root first rather than assuming a blank slate.
- On iterations after the first: the structured failure summary and the log path from the most recent `lsc_run_tests` call (C21) — this is how the loop feeds test results back without replaying the whole transcript.
- An explicit reminder that `.lsc/crafts/{feature}/test/` (including `run_test.sh`) and `trace.md`/`spec.md`/`plan.md` are read-only and hash/tool-call-protected — this is already in `agents/lsc-executor.md`'s Constraints, but restate it here per that agent's own convention of not relying on the platform block alone.

lsc-executor is expected to make its own feature-granularity commits per the project RULE (`rules/lets-craft.md`) as it works — this skill does not commit on the executor's behalf mid-loop.

### 3.3 Hash verification (C20, C23b)

Call `lsc_verify_hash(feature_dir)` **before** `lsc_run_tests` — this ordering follows the tool's own contract (`src/craft/hash-manifest.ts`'s `lsc_verify_hash` description: "call after every executor iteration, before lsc_run_tests"), not the plan document's literal step numbering, because it is strictly better: never trust a test run against a suite that might have been tampered with.

Read `details.passed`/`details.violations`, not `isError` (a clean result never sets `isError`; violations are reported through `passed: false` + the `violations` array of `{path, kind}`).

**On violation** — stop the loop immediately, do not run tests this iteration:
1. Gather the actual diff for context, since the tool only reports paths and kinds: `git status --short -- .lsc/crafts/{feature}/test/` and `git diff -- .lsc/crafts/{feature}/test/`. This is a read-only inspection, not the restore itself — `git status`/`git diff` never touch the protected tree's contents, so the `tool_call` block has no reason to (and does not) stop them.
2. Present the violated paths (with kind: added/removed/modified) and the diff/status output to the user via `lsc_confirm`:
   `[Hash Violation] {N} protected test asset(s) changed: {violations summary}. Restore them and continue the craft loop? Proceed?`
3. **Approved** → call `lsc_restore_tests(feature_dir)` — **never** attempt the restore yourself via `bash`/`git checkout`/`git clean`, or any other `write`/`edit`/`bash` call. This is not a style preference: the protected tree is under the same `tool_call` block C20 enforces everywhere else, so a `bash`-based restore attempt would be blocked by the very protection it's trying to work around, and the loop would deadlock retrying it forever. `lsc_restore_tests` is a dedicated internal-fs tool built exactly for this — it does not go through `write`/`edit`/`bash` and so is not itself subject to that block. It also re-verifies for you: read `details.passed`/`details.violations` from its result directly (no separate `lsc_verify_hash` call needed). If `details.passed` is still `false` after calling it, treat that as a new, unresolved violation — report it to the user via a fresh `[Hash Violation]` prompt rather than silently retrying. Once `details.passed` is `true`, continue to §3.4 with the executor's already-made implementation-code changes intact (only the protected tree was reverted — no need to re-spawn the executor).
4. **Declined** → call `lsc_craft_abort(reason: "user declined to restore hash-violated test assets")`, then go to §5 and report the abort to the user. Do not attempt any other recovery.

### 3.4 Test execution (C21, C23c)

Call `lsc_run_tests(feature_dir)`. Distinguish two outcomes carefully — they are not the same thing:

- **`isError: true`** — run_test.sh itself could not execute (missing script, exec threw). This is C23c, not an ordinary test failure. Present the error text to the user via `lsc_confirm`:
  `[Run Unavailable] run_test.sh could not be executed: {error}. Retry now (e.g. after you've resolved the underlying issue)? Proceed?`
  - **Approved** → retry `lsc_run_tests` (go back to the top of §3.4, not §3.2 — the executor already did its work this iteration; only the test run itself needs retrying).
  - **Declined** → call `lsc_craft_abort(reason: "user declined to continue past a run_test.sh execution failure")`, then go to §5.
- **`isError` absent, `details.passed: false`** — tests ran and some failed. This is the normal loop-continuation case (C21), not an escalation. **In fixture mode, check the iteration cap first (§1.7)** — if this was the 3rd executor iteration, abort per §1.7 instead of looping again. Otherwise take `details.failureLines` (or the tool's summary text) and `details.logPath`, and go back to §3.2 for another executor iteration, carrying that failure summary and log path forward per §3.2's bullet list.
- **`details.passed: true`** — every test passed. Exit the loop and proceed to §5.

## 4. What this loop never does (C20)

Never call `write`/`edit`/`ast_edit`/`bash` yourself against `.lsc/crafts/{feature}/test/` (including `run_test.sh`) at any point in this skill, and never instruct the executor to. The `tool_call` block enforces this at the platform level and will return `{block: true, reason: ...}` if attempted — but the discipline is stated here too, not just relied on as a backstop. If you conclude a test is actually wrong (poorly written, testing the wrong thing), the correct move is **never** to edit it — report your reasoning to the user via `lsc_confirm` and let them decide (they can pause the craft loop and fix the test themselves outside this skill's scope). Silently working around a test you disagree with, or hard-coding output to satisfy a specific assertion, is exactly the failure mode this whole loop exists to prevent.

## 5. Finalization

1. Confirm the exit condition: the most recent `lsc_run_tests` call returned `details.passed: true` (§3.4), or the loop was aborted per §3.3/§3.4's decline branches.
2. **On a passing exit**: run `git status --short` in the implementation root (worktree or project root per §2.5). If anything is uncommitted (the executor's per-iteration commits per RULE should normally leave nothing behind, but verify rather than assume), commit it yourself per `rules/lets-craft.md`'s structured body (`what:`/`why:`/`evidence:`/`verify:`).
3. **State sanity check**: the last `lsc_run_tests` call already persisted `testsPassed: true` to `.lsc/crafts/{feature}/test/.craft-state.json` via `recordTestResult` (`src/craft/state.ts`) — this is what makes `shouldContinueCraftLoop()` return `false` and releases the `session_stop` backstop (`src/craft/enforcement.ts`). No separate "close craft" call exists or is needed; the active craft simply stops being forced to continue once this condition holds. You do not need to do anything further to "end" the craft — just confirm (e.g. by re-reading the state file) that `testsPassed` is in fact `true` before telling the user the loop is done.
4. Ask for final handoff:

   `[Craft Complete] craft is done for "{feature}" — run_test.sh passes and the implementation is committed. Run the post-craft skill against .lsc/crafts/{feature}/ next. Proceed?`

   via `lsc_confirm`. Regardless of the answer, tell the user plainly, in text: how many test iterations it took, the final pass count/summary from the last `lsc_run_tests` result, the list of commits made during this craft run (`git log --oneline <branch-point>..HEAD` in the implementation root), and the exact path to pass to `post-craft`.
5. **On an aborted exit** (§3.3/§3.4 decline branches): report plainly what was declined and why the loop stopped (hash violation left unrestored, or run_test.sh left unrunnable), point to the relevant log/diff output already shown, and note that `lsc_craft_abort` has already released the `session_stop` backstop — no further tool call is needed to let the session end normally.

## 6. Context management (R2)

`trace.md`/`spec.md`/`plan.md`/audit documents may be large — read them once during §2.3, extract what you need into your own §2.4 plan, and do not re-read them in full on every loop iteration. Failure logs follow the same pattern C21 already establishes: carry the structured summary + `logPath` forward, and only `read` the full `run-N.log` file yourself (or tell the executor to) when the summary genuinely isn't enough to diagnose the next step.
