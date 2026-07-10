import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { worktreePath } from "../src/artifacts/paths";
import { addWorktree, pruneWorktrees, removeWorktree } from "../src/artifacts/worktree";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** A throwaway git repo with one commit on its default branch, for worktree add/remove/prune tests. */
function tmpGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-worktree-"));
	tempDirs.push(dir);
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	writeFileSync(join(dir, "README.md"), "test repo\n");
	execFileSync("git", ["add", "README.md"], { cwd: dir });
	execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

describe("addWorktree / removeWorktree / pruneWorktrees", () => {
	it("creates a new branch + worktree under .lsc/worktrees/{feature}", async () => {
		const cwd = tmpGitRepo();
		const result = await addWorktree(cwd, "my-feature");
		expect(result.reused).toBe(false);
		expect(result.branch).toBe("lets-craft/my-feature");
		expect(existsSync(worktreePath(cwd, "my-feature"))).toBe(true);
	});

	it("reuses an existing worktree directory on a second call (C7 REJECT re-run)", async () => {
		const cwd = tmpGitRepo();
		await addWorktree(cwd, "my-feature");
		const second = await addWorktree(cwd, "my-feature");
		expect(second.reused).toBe(true);
	});

	it("reuses an existing branch when the worktree dir was removed but the branch remains", async () => {
		const cwd = tmpGitRepo();
		await addWorktree(cwd, "my-feature");
		await removeWorktree(cwd, "my-feature");
		expect(existsSync(worktreePath(cwd, "my-feature"))).toBe(false);

		const second = await addWorktree(cwd, "my-feature");
		expect(second.reused).toBe(true);
		expect(existsSync(worktreePath(cwd, "my-feature"))).toBe(true);
	});

	it("removeWorktree is a no-op when the worktree does not exist", async () => {
		const cwd = tmpGitRepo();
		await expect(removeWorktree(cwd, "never-created")).resolves.toBeUndefined();
	});

	it("pruneWorktrees reclaims metadata after an external directory removal", async () => {
		const cwd = tmpGitRepo();
		await addWorktree(cwd, "my-feature");
		rmSync(worktreePath(cwd, "my-feature"), { recursive: true, force: true });

		await pruneWorktrees(cwd);
		const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd }).toString();
		expect(list).not.toContain("my-feature");
	});
});
