// AC3e — the `--worktree` path, real omp integration: pre-craft's `addWorktree()` replica
// (skills/pre-craft/SKILL.md §2 step 4) creates `.lsc/worktrees/{feature}/` and registers it
// in `.gitignore`; craft (§2.5's worktree detection) implements against that worktree instead
// of the project root; post-craft's land step (§7) merges and prunes it once the user approves
// via a `[Land] ... Merge?` lsc_confirm gate. This mirrors e2e-full-cycle.test.ts's three-stage
// structure but swaps the fixture's `[Worktree]` answer to "yes" and asserts the worktree/git
// side effects instead of re-deriving every artifact-existence check already covered there.
//
// Gated behind LSC_E2E=1 — spends real tokens. `npm test` never runs this file; `npm run e2e` does.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	E2E_MAIN_MODEL,
	debugSummary,
	listCraftFeatures,
	preCraftArtifactsComplete,
	runOmpPrint,
	runToCompletion,
	setupFixtureProject,
} from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

// Sized identically to e2e-full-cycle.test.ts — see its comment for the sequence of actual
// timed-out runs and fixes (file-level sequencing, synchronous task spawns, main model upgrade)
// these numbers are based on.
const PRE_CRAFT_TIMEOUT_MS = 90 * 60_000;
const CRAFT_TIMEOUT_MS = 40 * 60_000;
const POST_CRAFT_TIMEOUT_MS = 25 * 60_000;
// See e2e-full-cycle.test.ts's identical constants for why a resume gets its own, much shorter
// budget and why TEST_TIMEOUT_MS below accounts for the worst case of all of them.
const PRE_CRAFT_RESUME_TIMEOUT_MS = 20 * 60_000;
const PRE_CRAFT_MAX_RESUMES = 3;
const TEST_TIMEOUT_MS = PRE_CRAFT_TIMEOUT_MS + PRE_CRAFT_MAX_RESUMES * PRE_CRAFT_RESUME_TIMEOUT_MS + CRAFT_TIMEOUT_MS + POST_CRAFT_TIMEOUT_MS + 15 * 60_000;

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

const FEATURE_DESCRIPTION =
	"Fix slugify so it collapses consecutive non-alphanumeric separators into a single hyphen and trims leading/trailing " +
	"hyphens, matching the behavior already documented in src/slugify.ts's bug note.";

const FIXTURE_NOTE =
	"Every question you would ask a human must go through lsc_ask/lsc_select/lsc_confirm as usual — LSC_FIXTURE is " +
	"already configured with scripted answers, so just call those tools normally and use whatever they return; do not " +
	"address me directly and do not wait for a reply outside those tools.";

/** Flip the shared fixture's `[Worktree]` answer from "no" to "yes" — every other rule (including the catch-all `default: "yes"`, which covers `[Land] ... Merge?` since none of the existing rules end in "merge?") stays as-is. */
function useWorktreeAnswers(answersPath: string): void {
	const raw = JSON.parse(readFileSync(answersPath, "utf8"));
	raw.answers = raw.answers.map((rule: { match: string; response: string }) =>
		rule.match === "^\\[Worktree\\]" ? { ...rule, response: "yes" } : rule,
	);
	writeFileSync(answersPath, JSON.stringify(raw, null, 2));
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** preCraftArtifactsComplete plus the worktree itself — the extra thing this test's pre-craft stage must produce that e2e-full-cycle.test.ts's does not. */
function preCraftWorktreeComplete(projectDir: string): boolean {
	if (!preCraftArtifactsComplete(projectDir)) return false;
	const features = listCraftFeatures(projectDir);
	return features.length === 1 && existsSync(join(projectDir, ".lsc", "worktrees", features[0]));
}

// Sent (via --continue, runToCompletion) if pre-craft's initial attempt stops before the worktree
// and all four Stage 1-4 artifacts exist — see runToCompletion's own comment in e2e-helpers.ts for
// why this can happen at all under `-p` mode. Explicitly told not to redo existing work.
const PRE_CRAFT_RESUME_PROMPT =
	"이전 pre-craft --worktree 세션이 .lsc/worktrees/{feature}/와 trace.md/spec.md/plan.md/test/run_test.sh를 " +
	"모두 만들기 전에 멈췄다. 이미 존재하는 것은 절대 다시 만들지 말고, 현재 상태를 확인해 아직 없는 부분부터 " +
	`이어서 pre-craft를 끝까지 진행하라. ${FIXTURE_NOTE}`;

describe.skipIf(!RUN_E2E)("worktree E2E (AC3e): --worktree add → craft in worktree → land merge+remove+prune", () => {
	it(
		"creates .lsc/worktrees/{feature}/, gitignores it, implements against the worktree, and merges+removes+prunes it on a Land approval",
		async () => {
			const { base, projectDir, answersPath, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);
			useWorktreeAnswers(answersPath);
			const fixtureEnv = { LSC_FIXTURE: answersPath };

			const baseBranch = git(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);

			// ---- Stage 1: pre-craft --worktree ----
			const preCraftRun = await runToCompletion({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: PRE_CRAFT_TIMEOUT_MS,
				prompt: `/skill:pre-craft ${FEATURE_DESCRIPTION} Use an isolated git worktree (.lsc/worktrees/{feature}/) for this feature — answer the worktree question "yes". ${FIXTURE_NOTE}`,
				isComplete: () => preCraftWorktreeComplete(projectDir),
				continuationPrompt: PRE_CRAFT_RESUME_PROMPT,
				resumeTimeoutMs: PRE_CRAFT_RESUME_TIMEOUT_MS,
				maxResumes: PRE_CRAFT_MAX_RESUMES,
			});
			const preCraftResult = preCraftRun.last;
			expect(preCraftResult.timedOut, `pre-craft timed out (attempt ${preCraftRun.attempts.length}).\n${debugSummary(preCraftResult)}`).toBe(false);
			expect(
				preCraftRun.completed,
				`pre-craft never produced the worktree plus all of trace.md/spec.md/plan.md/test/run_test.sh, even after ${preCraftRun.attempts.length - 1} resume(s).\n${debugSummary(preCraftResult)}`,
			).toBe(true);

			const features = listCraftFeatures(projectDir);
			expect(features.length, `expected exactly one .lsc/crafts/{feature} dir, found ${JSON.stringify(features)}.\n${debugSummary(preCraftResult)}`).toBe(1);
			const feature = features[0];
			const craftDir = join(projectDir, ".lsc", "crafts", feature);
			const worktreePath = join(projectDir, ".lsc", "worktrees", feature);

			// Individually, for a precise failure message pinpointing which one — `preCraftRun.completed`
			// above already guarantees all of these exist, so none of these can actually fail on their own.
			expect(existsSync(worktreePath), `worktree not created at ${worktreePath}.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(join(craftDir, "trace.md")), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(join(craftDir, "spec.md")), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(join(craftDir, "plan.md")), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(join(craftDir, "test", "run_test.sh")), debugSummary(preCraftResult)).toBe(true);

			const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
			expect(gitignore, `.gitignore does not register .lsc/worktrees/.\n${gitignore}`).toMatch(/^\/?\.lsc\/worktrees\/?$/m);

			const worktreeBranch = git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(worktreeBranch, "worktree checkout must not be on the base branch").not.toBe(baseBranch);
			const worktreeCommitsBeforeCraft = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]);
			const worktreeTipShaBeforeCraft = git(worktreePath, ["rev-parse", "HEAD"]);

			// ---- Stage 2: craft (auto-detects worktree mode per craft/SKILL.md §2.5) ----
			const craftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: CRAFT_TIMEOUT_MS,
				prompt: `/skill:craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
			});
			expect(craftResult.timedOut, `craft timed out.\n${debugSummary(craftResult)}`).toBe(false);

			// Indirect assert (per the Phase 7 handoff): the implementation commit(s) landed on
			// the WORKTREE's branch, not the project root's working tree (which never checked out
			// the feature branch in --worktree mode at all).
			const worktreeCommitsAfterCraft = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]);
			expect(
				worktreeCommitsAfterCraft.length,
				`expected new commits on the worktree branch after craft (before: ${JSON.stringify(worktreeCommitsBeforeCraft)}).\n${debugSummary(craftResult)}`,
			).toBeGreaterThan(worktreeCommitsBeforeCraft.length);
			const worktreeTipShaAfterCraft = git(worktreePath, ["rev-parse", "HEAD"]);
			expect(worktreeTipShaAfterCraft, "craft must have committed something new on the worktree branch").not.toBe(worktreeTipShaBeforeCraft);

			const runTestPath = join(craftDir, "test", "run_test.sh");
			execFileSync("chmod", ["+x", runTestPath]);
			const rerun = spawnSync("bash", [runTestPath], { cwd: worktreePath, encoding: "utf8" });
			expect(
				rerun.status,
				`run_test.sh did not exit 0 in the worktree after craft (status=${rerun.status}).\nstdout:\n${rerun.stdout}\nstderr:\n${rerun.stderr}\n\n${debugSummary(craftResult)}`,
			).toBe(0);

			// ---- Stage 3: post-craft (land gated on an APPROVE-family verdict, §7.1) ----
			const postCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: POST_CRAFT_TIMEOUT_MS,
				prompt: `/skill:post-craft .lsc/crafts/${feature}/ If the audit reaches an APPROVE-family verdict, land is approved — answer the Land/Merge question "yes". ${FIXTURE_NOTE}`,
			});
			expect(postCraftResult.timedOut, `post-craft timed out.\n${debugSummary(postCraftResult)}`).toBe(false);

			const auditPath = join(craftDir, "audit", "audit-0.md");
			expect(existsSync(auditPath), `audit/audit-0.md missing.\n${debugSummary(postCraftResult)}`).toBe(true);
			const auditContent = readFileSync(auditPath, "utf8");
			const verdictMatch = auditContent.match(/^\*\*AUDIT VERDICT: (APPROVE|APPROVE-WITH-COMMENT|APPROVE-WITH-CHANGE|REJECT)\*\*/m);
			expect(verdictMatch, `audit-0.md has no line-start "**AUDIT VERDICT:" line.\n---\n${auditContent.slice(0, 2000)}`).not.toBeNull();
			const verdict = verdictMatch?.[1];
			const landEligible = verdict === "APPROVE" || verdict === "APPROVE-WITH-COMMENT";

			if (!landEligible) {
				// §7.1: APPROVE-WITH-CHANGE/REJECT are not land-eligible this cycle — the worktree
				// must be left exactly in place, not merged/removed. This is still a meaningful,
				// asserted outcome (land correctly did NOT run), just not the merge+prune path.
				expect(existsSync(worktreePath), `verdict was ${verdict} (not land-eligible) but the worktree was removed anyway.\n${debugSummary(postCraftResult)}`).toBe(true);
				return;
			}

			expect(existsSync(worktreePath), `verdict was ${verdict} (land-eligible) but the worktree was not removed.\n${debugSummary(postCraftResult)}`).toBe(false);

			const worktreeList = git(projectDir, ["worktree", "list"]);
			expect(worktreeList, `git worktree list still references the pruned worktree.\n${worktreeList}`).not.toContain(feature);

			// Merge landed: craft's final worktree-branch commit is now an ancestor of the base
			// branch's HEAD. `--is-ancestor` exits non-zero (execFileSync throws) when it is not,
			// so a clean call is the assertion — robust to whatever exact commit-message text
			// post-craft's land step (§7.4) composed, unlike grepping for the branch name.
			expect(() => execFileSync("git", ["merge-base", "--is-ancestor", worktreeTipShaAfterCraft, "HEAD"], { cwd: projectDir })).not.toThrow();
		},
		TEST_TIMEOUT_MS,
	);
});
