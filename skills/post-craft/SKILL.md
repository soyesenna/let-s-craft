---
name: post-craft
description: Runs the lets-craft post-craft adversarial audit — a hostile, evidence-first review of a completed craft implementation against trace.md/spec.md/plan.md, producing a four-level verdict (APPROVE / APPROVE-WITH-COMMENT / APPROVE-WITH-CHANGE / REJECT) recorded to `.lsc/crafts/{feature}/audit/audit-N.md`, followed by a semi-automatic craft-reinvoke-or-land decision. Trigger when the user says "post-craft" / "/post-craft", asks to audit, review, or QA a feature the craft skill just finished, or when the craft skill's own finalization handoff recommends running post-craft next. Takes `.lsc/crafts/{feature}/` as input (implementation source auto-detected: `.lsc/worktrees/{feature}/` if it exists, else the current working tree). Ends by either handing off the exact `audit/audit-N.md` path back to `craft` for another fix cycle, or — on an APPROVE-family verdict — requesting explicit merge approval and landing the implementation.
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
   | Audit report | `.lsc/crafts/{feature}/audit/audit-{N}.md` (N from 0, existing max + 1) |
   | Trace / spec / plan (read, and spec/plan conditionally amended) | `.lsc/crafts/{feature}/{trace,spec,plan}.md` |
   | Test suite (read + re-run only, never edited) | `.lsc/crafts/{feature}/test/` |
   | Craft state (read-only signal, §2.4) | `.lsc/crafts/{feature}/test/.craft-state.json` |
   | Worktree, if used | `.lsc/worktrees/{feature}/` |

   `.lsc/crafts/{feature}/` (including `audit/`) always resolves relative to the **project root**, never the worktree, even when the implementation itself lives in a worktree (§2.3) — this mirrors `craftAuditDir`/`craftStatePath` in `src/artifacts/paths.ts`, which are `projectLscDir(cwd)`-rooted regardless of `--worktree`.
5. **Tool inventory.** `lsc_ask`/`lsc_select`/`lsc_confirm` for every human-facing question; `task` (batch form) to spawn `lsc-explore` and `lsc-critic` in parallel (§3.1); `lsc_run_tests` opportunistically, with a `bash` fallback (§3.4 — see why there); `bash`/`read`/`write`/`edit`/`glob`/`grep` directly for git orchestration, audit-doc authoring, and (only for user-approved amendments) editing `spec.md`/`plan.md`. Do **not** call `lsc_craft_init`/`lsc_verify_hash`/`lsc_restore_tests`/`lsc_craft_abort` — those activate the craft loop's hash-protection/active-craft state and are `craft`'s tools, not this skill's; calling `lsc_craft_init` here would incorrectly re-register this feature as an in-flight craft loop for the rest of the session (and would arm the `tool_call` block against §3.4's own bash-based test run — see the note there).
6. **Feature slug.** Same resolution rule as `craft` (`src/artifacts/paths.ts`'s `resolveFeatureName`): the path segment right after `crafts/`, or the last path segment for a bare name. Works whether you were handed a bare feature name, the `.lsc/crafts/{feature}/` dir, or (on a re-audit) an `audit/audit-N.md` path.
7. **Verdict vocabulary — two distinct scales, do not conflate them.** `lsc-critic`'s own output always begins with `**VERDICT: [REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT]**` (`agents/lsc-critic.md`) — a narrower, agent-scoped scale for its own review. This skill's audit judgment (C25) is a *different*, four-level scale — `APPROVE` / `APPROVE-WITH-COMMENT` / `APPROVE-WITH-CHANGE` / `REJECT` — that only the main session assigns, holistically, after weighing `lsc-critic`'s verdict alongside `lsc-explore`'s findings, the compliance matrices you build yourself (§3.2), and the re-run test result (§3.4). Never copy `lsc-critic`'s verdict word directly into the audit's judgment line. §4.2 gives a disciplined (non-mechanical) correspondence between the two scales.

## 2. Input resolution and implementation-source detection (C22, C7)

1. **Validate pre-craft artifacts exist**: `trace.md`, `spec.md`, `plan.md`, `test/run_test.sh` under `.lsc/crafts/{feature}/`. If any is missing, stop and tell the user this feature never completed pre-craft — there is nothing to audit.
2. **Determine the audit cycle number `N`.** `glob .lsc/crafts/{feature}/audit/audit-*.md`, parse the numeric suffixes, `N = max + 1` (or `0` if the directory is empty/missing — C8).
3. **Detect the implementation source** (mirrors `craft/SKILL.md` §2.5, same rationale — `.lsc/worktrees/{feature}/` existing means that's where the code actually is):
   - `.lsc/worktrees/{feature}/` exists → **worktree mode**. Implementation root = that absolute path. Implementation branch = `git -C {absolute worktree path} rev-parse --abbrev-ref HEAD` (ground truth — no guessing needed, since the worktree checkout *is* the branch).
   - Otherwise → **non-worktree mode**. Implementation root = the project root (this session's cwd). Implementation branch = `git rev-parse --abbrev-ref HEAD` (whatever is currently checked out here — `craft` never switches branches on your behalf, so this should be the same branch `pre-craft` created).
4. **Precondition sanity check — ask only if something looks off**, combining both signals into one gate rather than interrupting twice:
   - Non-worktree mode: does the current branch name contain the feature slug (or the convention prefix pre-craft would have used, e.g. `lets-craft/{feature}` or `{detected-prefix}/{feature}`)? If not, this is a strong signal you're about to audit the wrong branch.
   - Read `.lsc/crafts/{feature}/test/.craft-state.json` if it exists (always project-root-relative, per §1.4's table — never inside the worktree). If `testsPassed` is `false`, or the file is missing entirely and no obvious implementation commits exist on the detected branch (`git log --oneline` since the branch's fork point), craft may not have actually finished.
   - If either check is suspicious, ask:

     `[Precondition] {specific concern — e.g. "the current branch 'main' does not look like the lets-craft implementation branch for 'my-feature'" or "test/.craft-state.json shows testsPassed: false — craft may not have finished"}. Continue auditing anyway? Proceed?`

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

Spawn `lsc-explore` and `lsc-critic` in a **single `task` batch call** (independent work, C24's own instruction to use both "병렬"). Every assignment must give:
- The absolute paths to `trace.md`, `spec.md`, `plan.md`.
- The implementation root as an **absolute path**, explicitly labeled as such — the `task` tool always spawns subagents at the *main session's* cwd (the project root), never a per-spawn cwd (same lesson `craft/SKILL.md` §2.5/§3.2 already states for `lsc-executor`). In worktree mode this is genuinely a different directory from the subagent's own cwd — every git/read command in the assignment must be prefixed accordingly (`git -C {absolute worktree path} ...`, `read {absolute worktree path}/...`), never a bare relative path.
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
2. **On that error, fall back to `bash` directly** — exactly `pre-craft`'s Stage 4 approach (`skills/pre-craft/SKILL.md` §6.4): run `bash {absolute path to test/run_test.sh}` with the bash tool's own `cwd` parameter set to the implementation root from §2.3 (`.lsc/worktrees/{feature}/` if worktree mode, else the project root) — the same `execCwd` selection `src/craft/run-tests.ts` uses internally (`craft.worktreeRoot ?? craft.projectRoot`), just invoked without the trusted-exec wrapper. Save the transcript into `audit/audit-{N}.md` yourself (there is no `logs/run-N.log` numbering to reuse here — that numbering is craft's `lsc_run_tests`-owned sequence, not this skill's). **This fallback is safe from the `tool_call` block by construction**: the block only fires when `getActiveCraft()` matches this feature (`src/craft/enforcement.ts`), and its bash check is a fail-closed substring match on the test dir path that doesn't distinguish read from write — but that's exactly the condition under which step 1 above already succeeded via `lsc_run_tests` instead. The two paths are mutually exclusive; there is no scenario where the bash fallback is both needed and blocked.
3. **Record the outcome as a hard gate on the verdict (§4.2)**: if the re-run fails, the verdict cannot be `APPROVE` or `APPROVE-WITH-COMMENT` regardless of how clean `lsc-critic`'s review otherwise was.

## 4. Verdict and audit-N.md (C25)

### 4.1 Document structure

Write `.lsc/crafts/{feature}/audit/audit-{N}.md` with (no length limit, C9):

1. **Header**: feature, date, audit cycle `N`, implementation branch/worktree, base branch, mode (`full` or `fix-verification` — §5), reference to the prior audit if `N > 0`.
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

Once `audit-{N}.md` is written and committed (§8), ask:

`[Audit] Verdict was {AUDIT VERDICT}. Re-invoke craft against .lsc/crafts/{feature}/audit/audit-{N}.md to address the findings above? Proceed?`

via `lsc_confirm`.
- **Approved** → this skill does not, and cannot, call `craft` directly (skills cannot invoke each other — the same architectural constraint pre-craft/craft's finalization steps already work within). Tell the user, plainly and exactly: *"Invoke the craft skill against `.lsc/crafts/{feature}/audit/audit-{N}.md` next"* — this is the literal path `craft/SKILL.md` §2.1 already classifies as audit-driven-craft input, so no further translation is needed on craft's side.
- **Declined** → stop here. The audit stands as the record of what's wrong; nothing further happens automatically.

### 6.2 Spec/Plan amendments — per-item, user-gated, with a durable trail

If the audit's investigation surfaced that `spec.md` or `plan.md` themselves need correcting (not just the implementation — e.g. an Acceptance Criterion turned out ambiguous, or an ADR decision the implementation had to deviate from for a reason that should be documented), propose each amendment **individually**:

`[Spec Change] {or [Plan Change]} Proposed: {precise description of the change}. Reason: {why, tied to a specific audit finding}. Apply this to {spec.md|plan.md}? Proceed?`

via `lsc_select` with options `["Accept — apply to spec.md/plan.md", "Reject — do not apply", "Defer — revisit in a later audit cycle"]`. For every **Accept**:
1. Apply the actual content change inline, in place, via `edit` — not just a log entry.
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

`[Land] Merge "{implementation branch}" into "{base branch}"{" and remove the worktree at .lsc/worktrees/{feature}/" if worktree mode}? Merge?`

via `lsc_confirm`. This is not optional or skippable under any circumstance — the project's global rule is that `git merge` is never run without direct, explicit user instruction, and an APPROVE-family audit verdict is not itself that instruction.

- **Declined** → stop here. Preserve the worktree/branch exactly as-is (do not remove, do not merge). Report that land was skipped and why (user declined).

### 7.4 On approval — merge, then clean up

1. **Worktree mode**: from the project root, `git checkout {base}` if not already on it, then `git merge --no-ff {implementation branch}` with a structured commit message following this project's own RULE's `what:`/`why:`/`evidence:`/`verify:` format (reference the feature and the final `AUDIT VERDICT`) — a merge commit, not a fast-forward, keeps a clear audit-trail boundary consistent with this project's feature-granularity commit discipline. The worktree's own checkout is untouched by this — it shares the same `.git`, so merging by branch name doesn't require being inside the worktree.
2. **Non-worktree mode**: the current working tree *is* on the implementation branch (§2.3) — `git checkout {base}` (this switches the working tree away from the implementation branch; say so plainly in the final report, since it's a visible side effect), then `git merge --no-ff {implementation branch}` with the same structured message.
3. **Worktree cleanup, worktree mode only** — replicate `removeWorktree()`/`pruneWorktrees()` (`src/artifacts/worktree.ts`) by hand, exactly as pre-craft replicates `addWorktree()` by hand (no tool wraps these for skill use — `src/main.ts` never registers one):
   ```bash
   git worktree remove .lsc/worktrees/{feature}
   git worktree prune
   ```
   If `git worktree remove` fails because of uncommitted or untracked changes in the worktree, **do not blindly force-remove** — merge only captured what was committed, so forcing could silently discard something real. Show `git -C .lsc/worktrees/{feature} status --short` to the user and ask:

   `[Land] git worktree remove reported uncommitted/untracked changes: {status output}. Force-remove the worktree anyway (uncommitted changes will be lost)? Proceed?`

   via `lsc_confirm`. Only pass `--force` to `git worktree remove` on an explicit approval here; on decline, leave the worktree in place and say so in the final report.
4. **Do not delete the implementation branch itself** — only the worktree checkout is in scope for automatic cleanup (C7's own text is specifically about `.lsc/worktrees/`, not about branch deletion); leave the branch for the user to remove later if they want to.
5. Report: the merge commit hash, confirmation the worktree was removed and pruned (worktree mode), and the branch the working tree now sits on.

## 8. Finalization

1. Stage and commit `.lsc/crafts/{feature}/audit/audit-{N}.md` (and `spec.md`/`plan.md` if §6.2 amended them) per this project's own RULE (already part of your system prompt — no need to `read` it as a file; the plugin bundles it as a capability, not a project-tree file): Korean subject line with a conventional-commit prefix, structured `what:`/`why:`/`evidence:`/`verify:` body. Commit this **before** asking the §6.1/§7.3 gate questions — the audit record should exist regardless of what the user decides next.
2. If land (§7) ran and produced a merge commit, that is a separate commit from the audit commit above — do not combine them (feature-granularity discipline, per this project's own RULE).
3. Tell the user plainly, in text: the verdict, the audit doc's path, and whichever of §6.1/§7 actually ran (and its outcome).

## 9. Context management (R2)

`trace.md`/`spec.md`/`plan.md`/prior `audit-*.md` files may be large (C9) — read what you need once during §2/§3, and do not re-read them in full on later steps of the same run. `lsc-explore`/`lsc-critic`'s reports are already condensed by design; quote them into `audit-{N}.md` in full (§4.1 point 7) rather than re-summarizing them yet again, but do not re-fetch them from the agents a second time.
