// AC10 — validates that the git RECIPE post-craft's/craft's skill prose prescribes for parallel
// executor lanes actually works as literal git commands. There is no "lane integration" plugin
// module to unit-test here (Option P2 deliberately never calls `git merge` — see the ralplan ADR):
// the recipe is fork lanes from a shared forkPoint via `performScaffold(feature, branch, cwd,
// base_ref)`, commit to disjoint files per lane, guard with `git merge-base --is-ancestor
// {forkPoint} {laneBranch}`, integrate via `git cherry-pick {forkPoint}..{laneBranch}` applied
// sequentially onto the feature branch, and clean up with a non-forced `git worktree remove` +
// `git branch -D`. This file's job is to catch a broken incantation BEFORE an LLM ever executes it
// for real — a wrong git command in the skill prose would otherwise only surface mid-craft.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { craftAuditDir, worktreePath } from "../src/artifacts/paths";
import { performScaffold } from "../src/artifacts/scaffold";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A throwaway git repo with one commit on its default branch (same fixture shape as artifacts-worktree/artifacts-scaffold's own tmpGitRepo). */
function tmpGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-lanes-"));
	tempDirs.push(dir);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "seed\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

/** Scaffold a lane worktree forked from `forkPoint` and commit one file to it — the recipe's per-lane unit (①②). Returns the lane's worktree path. */
async function createLane(cwd: string, laneFeature: string, forkPoint: string, fileName: string, content: string): Promise<string> {
	const result = await performScaffold(laneFeature, undefined, cwd, forkPoint);
	expect(result.isError, JSON.stringify(result)).toBeFalsy();
	const laneWt = worktreePath(cwd, laneFeature);
	writeFileSync(join(laneWt, fileName), content);
	git(laneWt, ["add", fileName]);
	git(laneWt, ["commit", "-q", "-m", `lane commit: ${fileName}`]);
	return laneWt;
}

function laneBranchOf(laneWt: string): string {
	return git(laneWt, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/**
 * `git status --porcelain`, with the untracked `.gitignore` line filtered out. performScaffold's
 * own `ensureWorktreesGitignored` writes (and never commits) a `.gitignore` into `cwd` as a side
 * effect of scaffolding the FIRST lane — unrelated to what these assertions actually check (a clean
 * cherry-pick / a clean `--abort`). Any other status line still fails the assertion.
 */
function statusIgnoringScaffoldGitignore(cwd: string): string {
	return git(cwd, ["status", "--porcelain"])
		.split("\n")
		.filter(line => line.trim().length > 0 && line.trim() !== "?? .gitignore")
		.join("\n");
}

describe("parallel executor lane git recipe (AC10)", () => {
	it("①② performScaffold(base_ref) forks two lanes from a shared forkPoint, each committing to a disjoint file", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);

		const laneAWt = await createLane(cwd, "feat-c0-lane-1", forkPoint, "a.txt", "lane a\n");
		const laneBWt = await createLane(cwd, "feat-c0-lane-2", forkPoint, "b.txt", "lane b\n");

		expect(git(laneAWt, ["rev-parse", "HEAD~1"])).toBe(forkPoint);
		expect(git(laneBWt, ["rev-parse", "HEAD~1"])).toBe(forkPoint);
		expect(existsSync(join(laneAWt, "b.txt")), "lane A's worktree must not see lane B's file").toBe(false);
		expect(existsSync(join(laneBWt, "a.txt")), "lane B's worktree must not see lane A's file").toBe(false);
	});

	it("③④ merge-base --is-ancestor guards each lane, then cherry-pick {forkPoint}..{laneBranch} applied sequentially lands both disjoint changes on the feature branch", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);
		const laneAWt = await createLane(cwd, "feat-c0-lane-1", forkPoint, "a.txt", "lane a\n");
		const laneBWt = await createLane(cwd, "feat-c0-lane-2", forkPoint, "b.txt", "lane b\n");
		const laneABranch = laneBranchOf(laneAWt);
		const laneBBranch = laneBranchOf(laneBWt);

		// The feature branch itself, checked out in the main repo worktree, starting at forkPoint —
		// the integration target the skill's land step eventually merges.
		git(cwd, ["checkout", "-q", "-b", "feature/feat", forkPoint]);

		for (const laneBranch of [laneABranch, laneBBranch]) {
			// The guard: passes (exit 0, no throw) iff forkPoint really is an ancestor of the lane tip —
			// exactly the relationship performScaffold's base_ref established.
			expect(() => execFileSync("git", ["merge-base", "--is-ancestor", forkPoint, laneBranch], { cwd })).not.toThrow();
			execFileSync("git", ["cherry-pick", `${forkPoint}..${laneBranch}`], { cwd });
		}

		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("lane a\n");
		expect(readFileSync(join(cwd, "b.txt"), "utf8")).toBe("lane b\n");
		expect(statusIgnoringScaffoldGitignore(cwd)).toBe("");
	});

	it("⑤ a conflicting cherry-pick (violating the disjoint-files precondition) aborts cleanly and restores the working tree", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);
		// Both lanes add the SAME file — an intentional violation of "disjoint files", to prove
		// --abort recovers instead of leaving a half-applied cherry-pick behind.
		const laneAWt = await createLane(cwd, "feat-c0-lane-1", forkPoint, "shared.txt", "lane a change\n");
		const laneBWt = await createLane(cwd, "feat-c0-lane-2", forkPoint, "shared.txt", "lane b change\n");
		const laneABranch = laneBranchOf(laneAWt);
		const laneBBranch = laneBranchOf(laneBWt);

		git(cwd, ["checkout", "-q", "-b", "feature/conflict", forkPoint]);
		execFileSync("git", ["cherry-pick", `${forkPoint}..${laneABranch}`], { cwd });
		expect(statusIgnoringScaffoldGitignore(cwd)).toBe("");

		expect(() => execFileSync("git", ["cherry-pick", `${forkPoint}..${laneBBranch}`], { cwd, stdio: "pipe" })).toThrow();
		expect(existsSync(join(cwd, ".git", "CHERRY_PICK_HEAD")), "a conflicting cherry-pick must leave sequencer state behind").toBe(true);

		execFileSync("git", ["cherry-pick", "--abort"], { cwd });

		expect(existsSync(join(cwd, ".git", "CHERRY_PICK_HEAD")), "--abort must clear the sequencer state").toBe(false);
		expect(statusIgnoringScaffoldGitignore(cwd), "the working tree must be restored — no leftover conflict markers or staged halves").toBe("");
		expect(readFileSync(join(cwd, "shared.txt"), "utf8"), "lane A's already-applied content must survive the aborted lane B attempt untouched").toBe(
			"lane a change\n",
		);
	});

	it("⑥ a non-forced worktree remove + branch -D after a clean cherry-pick leaves zero lane traces", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);
		const laneWt = await createLane(cwd, "feat-c0-lane-1", forkPoint, "a.txt", "content\n");
		const laneBranch = laneBranchOf(laneWt);

		git(cwd, ["checkout", "-q", "-b", "feature/cleanup", forkPoint]);
		execFileSync("git", ["cherry-pick", `${forkPoint}..${laneBranch}`], { cwd });

		// The lane worktree has no uncommitted changes at this point, so a non-forced remove succeeds —
		// the recipe never needs --force on the clean-integration path.
		execFileSync("git", ["worktree", "remove", laneWt], { cwd });
		execFileSync("git", ["branch", "-D", laneBranch], { cwd });

		expect(existsSync(laneWt)).toBe(false);
		expect(git(cwd, ["worktree", "list", "--porcelain"])).not.toContain(laneWt);
		expect(git(cwd, ["branch", "--list", laneBranch])).toBe("");
	});

	it("⑦ cycle-scoped lane slugs ({feature}-c{C}-lane-{K}, C derived from the WORKTREE's audit/ dir) never collide across audit cycles — deriving C from the project root instead silently freezes it at 0", async () => {
		const cwd = tmpGitRepo();
		const feature = "feat";
		const featureScaffold = await performScaffold(feature, undefined, cwd);
		expect(featureScaffold.isError, JSON.stringify(featureScaffold)).toBeFalsy();
		const featureWt = worktreePath(cwd, feature);

		/** The recipe's own cycle-number derivation: highest audit-N.md + 1, or 0 when the dir is empty/absent. */
		function cycleNumberFrom(auditDir: string): number {
			if (!existsSync(auditDir)) return 0;
			const numbers = readdirSync(auditDir)
				.map(name => /^audit-(\d+)\.md$/.exec(name)?.[1])
				.filter((n): n is string => n !== undefined)
				.map(Number);
			return numbers.length === 0 ? 0 : Math.max(...numbers) + 1;
		}

		const auditDir = craftAuditDir(featureWt, feature);
		mkdirSync(auditDir, { recursive: true });

		const cycle0 = cycleNumberFrom(auditDir);
		expect(cycle0).toBe(0);
		const lane0Slug = `${feature}-c${cycle0}-lane-1`;

		// Cycle 0 completes: an audit doc appears, advancing the derived cycle number.
		writeFileSync(join(auditDir, "audit-0.md"), "cycle 0 audit\n");
		const cycle1 = cycleNumberFrom(auditDir);
		expect(cycle1).toBe(1);
		const lane1Slug = `${feature}-c${cycle1}-lane-1`;

		expect(lane1Slug).not.toBe(lane0Slug);

		// Both cycle-scoped slugs scaffold as independent, non-colliding lane worktrees.
		const laneResult0 = await performScaffold(lane0Slug, undefined, cwd);
		expect(laneResult0.isError, JSON.stringify(laneResult0)).toBeFalsy();
		const laneResult1 = await performScaffold(lane1Slug, undefined, cwd);
		expect(laneResult1.isError, JSON.stringify(laneResult1)).toBeFalsy();
		expect(worktreePath(cwd, lane0Slug)).not.toBe(worktreePath(cwd, lane1Slug));

		// The misreading this case pins: crafts dirs live INSIDE the worktree, never at project root
		// (Option T2), so a project-root read finds no audit/ dir at all and silently returns 0 for
		// EVERY cycle — one layer of the 3-layer defense dying silently instead of loudly.
		const wrongRootAuditDir = craftAuditDir(cwd, feature);
		expect(cycleNumberFrom(wrongRootAuditDir), "reading from the project root must be provably wrong, not merely different").toBe(0);
	});

	it("⑧ resume: recomputing forkPoint via `git merge-base {featureBranch} {laneBranch}` after losing the recorded value reproduces the identical guard + cherry-pick outcome", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);
		const laneWt = await createLane(cwd, "feat-c0-lane-1", forkPoint, "a.txt", "content\n");
		const laneBranch = laneBranchOf(laneWt);

		git(cwd, ["checkout", "-q", "-b", "feature/resume", forkPoint]);

		// Simulate the recorded forkPoint being lost to a session resume/compaction — re-derive it from
		// the two branches that share it instead of failing.
		const rederived = git(cwd, ["merge-base", "feature/resume", laneBranch]);
		expect(rederived, "re-derivation must reproduce the original forkPoint exactly").toBe(forkPoint);

		expect(() => execFileSync("git", ["merge-base", "--is-ancestor", rederived, laneBranch], { cwd })).not.toThrow();
		execFileSync("git", ["cherry-pick", `${rederived}..${laneBranch}`], { cwd });
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("content\n");
	});
});
