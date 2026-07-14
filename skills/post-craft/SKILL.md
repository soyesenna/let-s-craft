---
name: post-craft
description: Runs the lets-craft post-craft adversarial audit — a hostile, evidence-first review of a completed craft implementation against trace.md/spec.md/plan.md, producing a four-level verdict (APPROVE / APPROVE-WITH-COMMENT / APPROVE-WITH-CHANGE / REJECT) recorded to `.lsc/crafts/{feature}/audit/audit-N.md`, followed by a semi-automatic craft-reinvoke-or-land decision. Trigger when the user says "post-craft" / "/post-craft", asks to audit, review, or QA a feature the craft skill just finished, or when the craft skill's own finalization handoff recommends running post-craft next. Takes `.lsc/crafts/{feature}/` as input (implementation source is always the `.lsc/worktrees/{feature}/` worktree pre-craft creates — C6/R5). Ends by either handing off the exact `audit/audit-N.md` path back to `craft` for another fix cycle, or — on an APPROVE-family verdict — requesting explicit merge approval and landing the implementation.
---

# post-craft

## 0. Role in the pipeline

lets-craft is a 3-stage pipeline: **pre-craft → craft → post-craft**. This skill owns the third and final stage: adversarially auditing what `craft` actually built against what `pre-craft` actually specified and planned, recording a disciplined four-level verdict, and — depending on that verdict — either handing the feature back to `craft` for another fix cycle or landing it (merging the implementation branch and cleaning up its worktree, if any).

**This skill never writes implementation code and never edits the protected `test/` tree.** If the audit finds the implementation wanting, the fix is always implemented by re-invoking `craft` (§6.1) — this skill only ever writes to `.lsc/crafts/{feature}/audit/` and, for user-approved amendments only, to `spec.md`/`plan.md` themselves (§6.2). It is also the sole owner of the `land` step (§7) — merging is gated on an explicit user confirmation per this project's global rule (git merge is never run without direct user instruction).

## 1. Common contract

1. **Question seam.** Every question this skill asks a human goes through `lsc_ask`/`lsc_select`/`lsc_confirm` — the same seam pre-craft and craft use (`skills/pre-craft/SKILL.md` §1.1). In headless mode without a fixture configured these tools hard-error; that is correct, not a bug.
2. **Question tagging convention (load-bearing).** Every question starts with a bracketed English tag and every gate/escalation question ends in one of `approve?`/`proceed?`/`continue?`/`merge?`/`land?` (case-insensitive, optional `?`) — identical rule to pre-craft/craft, so fixture-mode E2E runs (Phase 7, `LSC_FIXTURE`) can answer deterministically. Tags this skill uses:
   - `[Precondition] ... Proceed?` — implementation-source sanity check (§2.4), asked only when detection is ambiguous
   - `[Audit] ... Proceed?` — REJECT/APPROVE-WITH-CHANGE craft-reinvoke offer (§6.1)
   - `[Spec Change] ... Proceed?` / `[Plan Change] ... Proceed?` — per-item amendment gate (§6.2)
   - `[Land] ... Merge?` — merge approval gate and worktree-force-remove sub-decision (§7.3, §7.4)
3. **No document length limits (C9).** `audit/audit-N.md` may be as long and detailed as the work requires — do not compress findings for brevity.
4. **Artifact paths (C8)** — mirror `src/artifacts/paths.ts` exactly, same replicate-by-hand discipline pre-craft/craft already establish (nothing in `src/main.ts` registers a tool for audit-directory/merge/worktree-removal setup, so this skill is the sole owner of replicating those conventions by hand):

   | Artifact | Path |
   |---|---|
   | Worktree | `.lsc/worktrees/{feature}/` — always present (C6/R5); every artifact below lives inside it. Its absolute form is referred to as `{worktreeAbs}` throughout this document. |
   | Audit report | `{worktreeAbs}/.lsc/crafts/{feature}/audit/audit-{N}.md` (N from 0, existing max + 1) |
   | Trace / spec / plan (read, and spec/plan conditionally amended) | `{worktreeAbs}/.lsc/crafts/{feature}/{trace,spec,plan}.md` |
   | Plan revision ledger (read) | `{worktreeAbs}/.lsc/crafts/{feature}/plan/plan-{N}.md` — prior per-iteration plan revision history; `plan.md` is only the latest confirmed plan |
   | Test suite (read + re-run only, never edited) | `{worktreeAbs}/.lsc/crafts/{feature}/test/` |
   | Craft state (read-only signal, §2.4) | `{worktreeAbs}/.lsc/crafts/{feature}/test/.craft-state.json` |

   `.lsc/crafts/{feature}/` (including `audit/`) resolves relative to the **worktree** — `{worktreeAbs}` per the table above, not the project root. This is the pipeline's fixed policy now (C6/R5, all-in-worktree): pre-craft always creates the worktree, craft always operates inside it, and this skill inherits the same root for every artifact it reads or writes, with no per-artifact exception. `craftAuditDir`/`craftStatePath`/etc. in `src/artifacts/paths.ts` keep their existing `cwd`-parameterized signatures (unchanged by R5) — this skill is simply the caller now passing `{worktreeAbs}` as that `cwd` argument instead of the project root. The only departure from this is §2.3's own escape hatch: if no worktree exists for this feature and the user explicitly approves continuing anyway, every path in this table falls back to the project root for that one audit run — note this explicitly in the audit doc's Header (§4.1 point 1) when it happens.
5. **Tool inventory.** `lsc_ask`/`lsc_select`/`lsc_confirm` for every human-facing question; `task` (batch form) to spawn `lsc-explore` and `lsc-critic` in parallel (§3.1); `lsc_run_tests` opportunistically, with a `bash` fallback (§3.4 — see why there); `bash`/`read`/`write`/`edit`/`glob`/`grep` directly for git orchestration, audit-doc authoring, and (only for user-approved amendments) editing `spec.md`/`plan.md`. Do **not** call `lsc_craft_init`/`lsc_verify_hash`/`lsc_restore_tests`/`lsc_craft_abort` — those activate the craft loop's hash-protection/active-craft state and are `craft`'s tools, not this skill's; calling `lsc_craft_init` here would incorrectly re-register this feature as an in-flight craft loop for the rest of the session (and would arm the `tool_call` block against §3.4's own bash-based test run — see the note there).
6. **Feature slug.** Same resolution rule as `craft` (`src/artifacts/paths.ts`'s `resolveFeatureName`): the path segment right after `crafts/`, or the last path segment for a bare name. Works whether you were handed a bare feature name, the `.lsc/crafts/{feature}/` dir, or (on a re-audit) an `audit/audit-N.md` path.
7. **Verdict vocabulary — two distinct scales, do not conflate them.** `lsc-critic`'s own output always begins with `**VERDICT: [REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT]**` (`agents/lsc-critic.md`) — a narrower, agent-scoped scale for its own review. This skill's audit judgment (C25) is a *different*, four-level scale — `APPROVE` / `APPROVE-WITH-COMMENT` / `APPROVE-WITH-CHANGE` / `REJECT` — that only the main session assigns, holistically, after weighing `lsc-critic`'s verdict alongside `lsc-explore`'s findings, the compliance matrices you build yourself (§3.2), and the re-run test result (§3.4). Never copy `lsc-critic`'s verdict word directly into the audit's judgment line. §4.2 gives a disciplined (non-mechanical) correspondence between the two scales.
8. **Waiting discipline — polling is forbidden, not merely discouraged.** Background `task` spawns (§3.1's parallel `lsc-explore`/`lsc-critic` batch, and any other spawn this skill makes) deliver their results automatically the moment they finish; this skill never polls to retrieve them. Issuing a `job {"poll": [...]}` call against a task already in flight is a **contract violation**, not a style preference: registering a watch/acknowledgement on an already-tracked task *suppresses* that automatic delivery instead of speeding it up, and each such call burns a turn for nothing. So: **never call `job {"poll": [...]}` on an in-flight spawn.** When this skill genuinely has nothing left to do until every in-flight spawn returns, call `job` with **no arguments, exactly once**, to block until they do — a single blocking wait, never a poll loop and never a sequence of short blocking waits used as a poll substitute. **429 / rate-limit backoff.** If a spawned worker dies to a rate-limit (429), retry it with the **same model and same effort under exponential backoff first**; escalating the model or effort is a last resort only after backoff is genuinely exhausted, never the first response. Any direct wait on another agent rather than on a `task` spawn's own completion should use `irc {"op": "wait", "timeoutMs": ...}` instead — event-driven, and it releases automatically if the counterpart agent dies.

## 2. Input resolution and implementation-source detection (C22, C7)

1. **Validate pre-craft artifacts exist**: `trace.md`, `spec.md`, `plan.md`, `test/run_test.sh` under `.lsc/crafts/{feature}/`. If any is missing, stop and tell the user this feature never completed pre-craft — there is nothing to audit.
2. **Determine the audit cycle number `N`.** `glob .lsc/crafts/{feature}/audit/audit-*.md`, parse the numeric suffixes, `N = max + 1` (or `0` if the directory is empty/missing — C8).
3. **Locate the implementation worktree** (mirrors `craft/SKILL.md` §2.5, same rationale — every craft always runs against a worktree now, C6/R5, so this is a presence check, not a mode branch):
   - `.lsc/worktrees/{feature}/` exists → implementation root = that absolute path (`{worktreeAbs}`). Implementation branch = `git -C {worktreeAbs} rev-parse --abbrev-ref HEAD` (ground truth — no guessing needed, since the worktree checkout *is* the branch).
   - Missing → this is not a valid signal to fall back to auditing the project root instead: it means craft never actually ran (or ran before this all-in-worktree design existed). Ask immediately:

     `[Precondition] No worktree found at .lsc/worktrees/{feature}/ — craft may not have run against this feature yet. Continue auditing anyway (against the current working tree)? Proceed?`

     via `lsc_confirm`. A decline stops the skill here. An approval falls back to implementation root = the project root, purely as an escape hatch for a pre-R5 feature or manual recovery — every other step in this skill still assumes a worktree exists by default; treat this branch as the exception, not the routine path.
4. **Precondition sanity check — ask only if something looks off**, combining both signals into one gate rather than interrupting twice (skip entirely if §2.3 already asked and got an answer):
   - Does the worktree's checked-out branch name contain the feature slug (or the convention prefix pre-craft would have used, e.g. `lets-craft/{feature}` or `{detected-prefix}/{feature}`)? If not, this is a strong signal something is wrong (a manually-repointed worktree, a stale one from a different feature).
   - Read `{worktreeAbs}/.lsc/crafts/{feature}/test/.craft-state.json` if it exists (project-root-relative instead, only in §2.3's missing-worktree escape-hatch case). If `testsPassed` is `false`, or the file is missing entirely and no obvious implementation commits exist on the detected branch (`git -C {worktreeAbs} log --oneline` since the branch's fork point), craft may not have actually finished.
   - If either check is suspicious, ask:

     `[Precondition] {specific concern — e.g. "the worktree's branch 'main' does not look like the lets-craft implementation branch for 'my-feature'" or "test/.craft-state.json shows testsPassed: false — craft may not have finished"}. Continue auditing anyway? Proceed?`

     via `lsc_confirm`. A decline stops the skill here (report why, do not fabricate an audit).
   - If both checks pass cleanly, do not ask anything — proceed silently.
5. **Detect the base (merge target) branch** — needed both for scoping the implementation diff (§3.1) and for landing (§7.2), so detect it once here and reuse it. Priority chain, first match wins:
   ```bash
   base=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
   [ -z "$base" ] && git show-ref --verify --quiet refs/heads/main   && base=main
   [ -z "$base" ] && git show-ref --verify --quiet refs/heads/master && base=master
   ```
   If `base` is still empty, ask via `lsc_select` (`[Precondition] Which branch should this audit treat as the merge target/base for "{feature}"? Proceed?`) listing `git branch --format='%(refname:short)'` minus the implementation branch itself. Record the result — it is reused verbatim in §3.1 and §7.2.
6. **Read prior audit context, if any.** If `N > 0`, `read` the **latest** existing `audit-{N-1}.md` in full. Its verdict determines this cycle's scope:
   - Latest verdict was **APPROVE-WITH-CHANGE** → this cycle runs the **narrower fix-verification path** (§5) instead of a full fresh audit — carry that document's exact "Required Fix" text forward into §3.1's assignments.
   - Latest verdict was **REJECT**, or `N == 0` (first audit) → run the **full audit** (§3–§4 as written, no scope narrowing). Still read the prior audit's findings as background context (has this exact issue already been raised and dismissed once, or is it new?) — but do not skip any of the four dimensions on the strength of that context alone.

## 3. Adversarial verification (C24)

**Read `trace.md`, `spec.md`, and `plan.md` in full yourself before spawning anything** — you need to know what "correct" means before you can judge whether `lsc-explore`/`lsc-critic`'s reports (or your own compliance-matrix rows) are actually right, not just plausible-sounding.

### 3.1 Parallel spawn — code mapping + adversarial review

Spawn `lsc-explore` and `lsc-critic` in a **single `task` batch call** (independent work, C24's own instruction to use both "병렬") — waiting for both to report follows §1.8's waiting discipline (results deliver automatically; never poll for them). Every assignment must give:
- The absolute paths to `trace.md`, `spec.md`, `plan.md`. When a reviewer needs the reasoning behind a specific plan decision from an earlier consensus iteration, that per-iteration revision history lives under `{worktreeAbs}/.lsc/crafts/{feature}/plan/plan-{N}.md` — point it at the specific iteration file it needs, never at a full re-read of the whole ledger.
- `{worktreeAbs}` as an **absolute path**, explicitly labeled as such — the `task` tool always spawns subagents at the *main session's* cwd (the project root), never a per-spawn cwd (same lesson `craft/SKILL.md` §2.5/§3.2 already states for `lsc-executor`). This is always a genuinely different directory from the subagent's own cwd now (§2.3: no more non-worktree mode) — every git/read command in the assignment must be prefixed accordingly (`git -C {worktreeAbs} ...`, `read {worktreeAbs}/...`), never a bare relative path.
- The implementation branch and base branch from §2.3/§2.5, and the instruction to scope their own investigation to `git -C {implRoot} log {base}..{implBranch} --oneline` / `git -C {implRoot} diff {base}...{implBranch}` (let them run this themselves rather than pasting a full diff into the assignment — keeps the prompt small, matches R2's context-management discipline already established in this project).

**`lsc-explore` assignment** ("code mapping"): map every file the implementation diff touches, how those files relate to each other and to the rest of the codebase, and — critically — whether `test/`'s suite actually exercises the changed code paths (a coverage gap is exactly the kind of thing a hostile audit should not miss). Use its own `Output_Format` (`agents/lsc-explore.md`) as-is.

**`lsc-critic` assignment** ("adversarial review"): review the implementation diff as the final quality gate it already is, against `spec.md` (all of it, but ask it explicitly to use the **compliance matrix format** — `agents/lsc-critic.md`'s `Execution_Policy` calls this out as available "for spec compliance reviews": Requirement | Status | Notes, one row per Acceptance Criterion) and `plan.md` (did the implementation follow the plan's steps and honor its ADR, or deviate silently without justification?). If this is a fix-verification cycle (§5), narrow the assignment explicitly: state the prior audit's exact required fix, and ask it to verify that fix specifically **in addition to** its normal investigation protocol (never skip the protocol just because the nominal scope is narrower — a careless or incomplete fix, or a fix that regresses something else, is exactly the failure mode this pass exists to catch).

### 3.2 Compliance matrices — built by you, verified by you, not copy-pasted

Once both agents report, build (or adopt `lsc-critic`'s, if it already produced one in the right shape) two compliance matrices — Acceptance Criteria (from `spec.md`) and Plan Steps/ADR (from `plan.md`) — each row `Requirement/Step | Status (Met/Partial/Unmet) | Notes`. **For every row, `read` the cited file:line yourself before writing the Status** — this is what "직접 탐색, 추측 절대 금지" (C24) means for the main session's own synthesis step, not just for the agents you delegated the deep exploration to. Do not transcribe a subagent's one-line claim into a matrix row without having looked at the cited evidence yourself.

### 3.3 Code quality and regression risk

Synthesize `lsc-explore`'s mapping and `lsc-critic`'s findings (CRITICAL/MAJOR/MINOR, Multi-Perspective Notes, What's Missing) into your own assessment — do not just concatenate their reports. Note genuine convergence (both flagged the same file/issue independently) as higher-confidence; note disagreement explicitly rather than silently picking one side.

### 3.4 Test re-verification (independent of craft's own last recorded result)

Never trust `.craft-state.json`'s `testsPassed` alone — the audit re-runs the suite itself, since code may have changed since craft's last recorded pass (including, on a fix-verification cycle, the fix you're specifically here to check).

1. **Attempt `lsc_run_tests(feature_dir)` first.** It only succeeds if this session still holds `{feature}` as the active craft (e.g., this post-craft run is a direct continuation of the same session craft just finished in, and nothing has reset it — `src/craft/state.ts`'s resets fire on `session_switch`/`session_branch`/`session_shutdown`, not merely on craft's own completion). This is the common failure path, not an edge case — this skill deliberately never calls `lsc_craft_init` (§1.5), so there usually is no matching active craft, and the tool returns `isError: true` with a "no active craft" message (`src/craft/run-tests.ts`).
2. **On that error, fall back to `bash` directly** — exactly `pre-craft`'s Stage 4 approach (`skills/pre-craft/SKILL.md` §6.4): run `bash {worktreeAbs}/.lsc/crafts/{feature}/test/run_test.sh` with the bash tool's own `cwd` parameter set to `{worktreeAbs}` (the implementation root from §2.3 — always the worktree now, except §2.3's own missing-worktree escape hatch, in which case use the project root instead) — the same `execCwd` selection `src/craft/run-tests.ts` uses internally (`craft.worktreeRoot ?? craft.projectRoot`), just invoked without the trusted-exec wrapper. Save the transcript into `audit/audit-{N}.md` yourself (there is no `logs/run-N.log` numbering to reuse here — that numbering is craft's `lsc_run_tests`-owned sequence, not this skill's). **This fallback is safe from the `tool_call` block by construction**: the block only fires when `getActiveCraft()` matches this feature (`src/craft/enforcement.ts`), and its bash check is a fail-closed substring match on the test dir path that doesn't distinguish read from write — but that's exactly the condition under which step 1 above already succeeded via `lsc_run_tests` instead. The two paths are mutually exclusive; there is no scenario where the bash fallback is both needed and blocked.
3. **Record the outcome as a hard gate on the verdict (§4.2)**: if the re-run fails, the verdict cannot be `APPROVE` or `APPROVE-WITH-COMMENT` regardless of how clean `lsc-critic`'s review otherwise was.

## 4. Verdict and audit-N.md (C25)

### 4.1 Document structure

Write `.lsc/crafts/{feature}/audit/audit-{N}.md` with (no length limit, C9):

1. **Header**: feature, date, audit cycle `N`, implementation branch/worktree, base branch, mode (`full` or `fix-verification` — §5), reference to the prior audit if `N > 0`, and — only if §2.3's missing-worktree escape hatch was used for this cycle — an explicit note that this audit ran against the project root instead of a worktree.
2. **Load-bearing verdict line, placed immediately after the header, on its own line**:
   ```
   **AUDIT VERDICT: APPROVE|APPROVE-WITH-COMMENT|APPROVE-WITH-CHANGE|REJECT**
   ```
   Exactly this prefix (`**AUDIT VERDICT:`), distinct from any `**VERDICT: ...**` line quoted from `lsc-critic`'s own report later in the document — Phase 7's E2E harness greps for `^\*\*AUDIT VERDICT:` specifically, and a naive grep would otherwise match `lsc-critic`'s embedded sub-verdict first. Flag this distinction explicitly for whoever wires the Phase 7 assertion.
3. **Spec Compliance Matrix** (§3.2).
4. **Plan Compliance Matrix** (§3.2).
5. **Code Quality & Regression Risk** (§3.3) — findings with severity + file:line evidence, mirroring `lsc-critic`'s own evidence discipline.
6. **Test Re-verification** (§3.4) — pass/fail, exit code, log excerpt or path.
7. **Full `lsc-explore` report** and **full `lsc-critic` report**, verbatim (not summarized away — C9).
8. **Required Fix** (only when the verdict is `APPROVE-WITH-CHANGE`) — precise enough that `craft` can implement it without asking clarifying questions, and precise enough that the fix-verification cycle (§5) knows exactly what to check. Note in this section that the *next* audit cycle verifying this fix will be narrower in scope than a full audit (§5) — that narrowing is this pipeline's own deliberate, spec-sanctioned design, not a corner being cut.

9. **Rejection Rationale** (only when the verdict is `REJECT`) — why the issues are broad/severe enough that a scoped fix can't be prescribed here; what a fresh implementation attempt needs to address.
10. **Non-blocking Considerations** (only when the verdict is `APPROVE-WITH-COMMENT`) — optional improvements the audit is explicitly *not* requiring before merge.
11. **Proposed Spec/Plan Amendments**, if any (§6.2) — listed here even before the user has approved/rejected/deferred them individually; the audit doc is the durable record of what was proposed, regardless of outcome.

### 4.2 Assigning the verdict — disciplined correspondence, not a lookup table

Weigh, in this order of authority:

1. **Test re-verification (§3.4) is a hard gate.** Failing tests → verdict must be `REJECT` or `APPROVE-WITH-CHANGE`, never `APPROVE`/`APPROVE-WITH-COMMENT`, regardless of what follows.
2. **`lsc-critic`'s verdict and finding severities are the primary signal**, reconciled as follows (not mechanical — use judgment when the two agents' reports pull in different directions, and say so in the audit doc):
   - `lsc-critic` `REJECT`, or any unresolved `CRITICAL` finding → audit `REJECT`.
   - `lsc-critic` `REVISE`, or unresolved `MAJOR` findings that block spec/plan compliance → audit `APPROVE-WITH-CHANGE` (write §4.1's Required Fix precisely).
   - `lsc-critic` `ACCEPT-WITH-RESERVATIONS`, or only `MINOR`/stylistic findings remain → audit `APPROVE-WITH-COMMENT`.
   - `lsc-critic` `ACCEPT`, no findings of consequence, both compliance matrices clean, tests re-confirmed passing → audit `APPROVE`.
3. **`lsc-explore`'s findings can independently upgrade severity** (e.g. it surfaces a coverage gap or cross-module risk `lsc-critic` didn't scope into) but never downgrade what `lsc-critic` already flagged.

## 5. Fix-verification shortcut for a prior APPROVE-WITH-CHANGE

C25's parenthetical for `APPROVE-WITH-CHANGE` — "수정 필수, 수정 후 재검토 없이 merge 가능" — means the *next* cycle after that specific prescribed fix is applied does not need to re-run a full, broad-scope adversarial audit from zero; it needs to **verify the prescribed fix was actually applied, completely and correctly, and that nothing else regressed**. This is still a genuine audit cycle (produces `audit-{N}.md`, §2.6 already routes here when the prior verdict was `APPROVE-WITH-CHANGE`) — it is narrower and faster, not skipped:

- §3.1's assignments to `lsc-explore`/`lsc-critic` are scoped to the prior audit's exact Required Fix text (quoted verbatim into the assignment), plus an explicit instruction not to rubber-stamp — check for incidental regressions the fix might have introduced outside its own stated scope.
- §3.2's compliance matrices only need to re-verify the rows the prior audit marked `Partial`/`Unmet` (not every row from scratch) — but do re-verify them; do not assume the fix succeeded just because `craft` reported success.
- §3.4's test re-run is unconditional regardless of mode.
- The resulting verdict uses the same four-level scale and the same §4.2 rules — a fix-verification cycle can still land on `REJECT` (the fix was wrong or introduced a new problem) or another `APPROVE-WITH-CHANGE` (the fix was partial), not just `APPROVE`.

## 6. Semi-automatic follow-up (C26)

### 6.1 REJECT / APPROVE-WITH-CHANGE → offer to re-invoke craft

**Chaining gate, before asking anything**: check `[ -n "$LSC_FIXTURE" ]` (bash) and, if unset, whether this session's accumulated context is already large (long-running session, several `lsc-explore`/`lsc-critic` spawns behind you). Once `audit-{N}.md` is written and committed (§8), ask regardless of either:

`[Audit] Verdict was {AUDIT VERDICT}. Re-invoke craft against .lsc/crafts/{feature}/audit/audit-{N}.md to address the findings above? Proceed?`

via `lsc_confirm`.
- **Approved, and neither gate above applies (not fixture mode, context not oversized)** → `read skill://craft` in this same turn — it returns craft's full contract text — and continue executing from craft's own §0 immediately, treating `.lsc/crafts/{feature}/audit/audit-{N}.md` as the input (the literal path `craft/SKILL.md` §2.1 already classifies as audit-driven-craft input, so no further translation is needed). **From this point on, this skill's own contract (§0's "This skill never writes implementation code," everything above) no longer applies — only the contract you just read from `skill://craft` governs the rest of this turn.** This is not hypothetical: there is no dedicated "dispatch another skill" primitive, but loading a skill's contract via `read skill://{name}` and continuing to execute it in the same turn has been confirmed against the real host — `read skill://craft` returns the live contract text, and an in-turn `lsc_craft_init` call right after succeeds. If the audit's Required Fix (§4.1 point 8) itself requires modifying the protected `test/` canon (not just implementation source), say so explicitly in the Required Fix text — the re-invoked craft will need its own `[Canon Amendment]` approval → `lsc_craft_release` → edit → `lsc_craft_init` re-baseline path (`craft/SKILL.md` §4) to make that change, not the ordinary executor loop.
- **Approved, but `$LSC_FIXTURE` is set** → do not chain — the E2E harness drives pre-craft, craft, and post-craft as three separate invocations; chaining here would run craft inside this post-craft turn, breaking that structure. Tell the user, plainly and exactly: *"Invoke the craft skill against `.lsc/crafts/{feature}/audit/audit-{N}.md` next"*, and end the turn normally.
- **Approved, but this session's context is already large** → do not chain either — tell the user explicitly that you're recommending a fresh session for `craft` instead, and why, then give the same manual-invocation text as above.
- **Declined** → stop here. The audit stands as the record of what's wrong; nothing further happens automatically.

### 6.2 Spec/Plan amendments — per-item, user-gated, with a durable trail

If the audit's investigation surfaced that `spec.md` or `plan.md` themselves need correcting (not just the implementation — e.g. an Acceptance Criterion turned out ambiguous, or an ADR decision the implementation had to deviate from for a reason that should be documented), propose each amendment **individually**:

`[Spec Change] {or [Plan Change]} Proposed: {precise description of the change}. Reason: {why, tied to a specific audit finding}. Apply this to {spec.md|plan.md}? Proceed?`

via `lsc_select` with options `["Accept — apply to spec.md/plan.md", "Reject — do not apply", "Defer — revisit in a later audit cycle"]`. For every **Accept**:
1. Apply the actual content change inline, in place, via `edit` against `{worktreeAbs}/.lsc/crafts/{feature}/{spec.md|plan.md}` (§1.4) — not just a log entry.
2. Append an entry to a `## Amendment Log` section (create it, once, near the end of the file if it doesn't exist yet) in the same format for both files:
   ```
   ### Amendment — audit cycle {N}, {date}
   - **Change**: {what changed}
   - **Reason**: {audit finding it addresses}
   - **Disposition**: Accepted via [Spec Change]/[Plan Change] lsc_select
   ```
For every **Reject**, do nothing further (do not log rejected proposals into the Amendment Log — §4.1 point 11 already preserves the full proposal list in the audit doc itself as the durable record of what was proposed and rejected). For every **Defer**, note it explicitly in the audit doc's own Proposed Amendments section as "deferred — reconsider next cycle" and do not touch `spec.md`/`plan.md`.

### 6.3 No cycle cap

Unlike pre-craft's plan/test consensus loop (cap 10) or craft's executor loop (no explicit cap, backstopped by the platform's `session_stop` cap 8), the post-craft ↔ craft audit cycle has **no upper bound** (C26) — every cycle is a fresh user gate (§6.1), which is the safety mechanism here, not an iteration count.

## 7. Land (C7 — APPROVE-family verdicts only)

### 7.1 Eligibility

- `APPROVE` → land-eligible immediately, this cycle.
- `APPROVE-WITH-COMMENT` → land-eligible immediately, this cycle — C25 defines this verdict's attached considerations as optional ("수정 고려 사항 첨부"), not a precondition for merge. Surface them to the user in the final report as non-blocking follow-ups, but they do not gate land.
- `APPROVE-WITH-CHANGE` → **not** land-eligible this cycle. §6.1's craft re-invocation must run first; land only becomes reachable once a subsequent audit cycle (§5's fix-verification path, ordinarily) itself reaches `APPROVE`/`APPROVE-WITH-COMMENT`.
- `REJECT` → not land-eligible. §6.1 only.

### 7.2 Merge target

Reuse the base branch detected in §2.5 — do not re-detect or re-ask unless that detection was itself uncertain and unresolved.

### 7.3 Explicit merge approval

`[Land] Merge "{implementation branch}" into "{base branch}" and remove the worktree at .lsc/worktrees/{feature}/? Merge?`

via `lsc_confirm`. This is not optional or skippable under any circumstance — the project's global rule is that `git merge` is never run without direct, explicit user instruction, and an APPROVE-family audit verdict is not itself that instruction.

- **Declined** → stop here. Preserve the worktree/branch exactly as-is (do not remove, do not merge). Report that land was skipped and why (user declined).

### 7.4 On approval — merge, then clean up

This land flow assumes worktree mode (§2.3's default) — §2.3's missing-worktree escape hatch is not land-eligible through this automated flow; if that branch was taken for this audit, merge manually instead.

1. From the project root, `git checkout {base}` if not already on it — in practice this is usually already a no-op: since every artifact and the implementation both live inside the worktree (C6/R5), craft never has reason to switch the main checkout away from `{base}` in the first place. Then `git merge --no-ff {implementation branch}` with a structured commit message following this project's own RULE's `what:`/`why:`/`evidence:`/`verify:` format (reference the feature and the final `AUDIT VERDICT`) — a merge commit, not a fast-forward, keeps a clear audit-trail boundary consistent with this project's feature-granularity commit discipline. The worktree's own checkout is untouched by this — it shares the same `.git`, so merging by branch name doesn't require being inside the worktree.
2. **Worktree cleanup** — replicate `removeWorktree()`/`pruneWorktrees()` (`src/artifacts/worktree.ts`) by hand, exactly as pre-craft replicates `addWorktree()` by hand (no tool wraps these for skill use — `src/main.ts` never registers one):
   ```bash
   git worktree remove .lsc/worktrees/{feature}
   git worktree prune
   ```
   If `git worktree remove` fails because of uncommitted or untracked changes in the worktree, **do not blindly force-remove** — merge only captured what was committed, so forcing could silently discard something real. Show `git -C .lsc/worktrees/{feature} status --short` to the user and ask:

   `[Land] git worktree remove reported uncommitted/untracked changes: {status output}. Force-remove the worktree anyway (uncommitted changes will be lost)? Proceed?`

   via `lsc_confirm`. Only pass `--force` to `git worktree remove` on an explicit approval here; on decline, leave the worktree in place and say so in the final report.
3. **Do not delete the implementation branch itself** — only the worktree checkout is in scope for automatic cleanup (C7's own text is specifically about `.lsc/worktrees/`, not about branch deletion); leave the branch for the user to remove later if they want to.
4. Report: the merge commit hash, confirmation the worktree was removed and pruned, and the branch the working tree now sits on.

## 8. Finalization

1. Stage and commit `{worktreeAbs}/.lsc/crafts/{feature}/audit/audit-{N}.md` (and `spec.md`/`plan.md` if §6.2 amended them) via `git -C {worktreeAbs} add ...` / `git -C {worktreeAbs} commit ...` — landing on the feature branch inside the worktree (§1.4), per this project's own RULE (already part of your system prompt — no need to `read` it as a file; the plugin bundles it as a capability, not a project-tree file): Korean subject line with a conventional-commit prefix, structured `what:`/`why:`/`evidence:`/`verify:` body. Commit this **before** asking the §6.1/§7.3 gate questions — the audit record should exist regardless of what the user decides next.
2. If land (§7) ran and produced a merge commit, that is a separate commit from the audit commit above — do not combine them (feature-granularity discipline, per this project's own RULE).
3. Tell the user plainly, in text: the verdict, the audit doc's path, and whichever of §6.1/§7 actually ran (and its outcome).

## 9. Context management (R2)

`trace.md`/`spec.md`/`plan.md`/prior `audit-*.md` files may be large (C9) — read what you need once during §2/§3, and do not re-read them in full on later steps of the same run. `lsc-explore`/`lsc-critic`'s reports are already condensed by design; quote them into `audit-{N}.md` in full (§4.1 point 7) rather than re-summarizing them yet again, but do not re-fetch them from the agents a second time.
