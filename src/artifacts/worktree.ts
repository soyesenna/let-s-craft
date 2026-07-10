// `git worktree add/remove/prune` helpers for `.lsc/worktrees/{feature}` (C7).
//
// Land (merge into the target branch) is explicitly NOT here — post-craft (Phase 6)
// owns that decision because merging requires a user-confirmed gate (project RULE:
// git merge only on explicit user instruction). These are plain, dependency-free
// helpers over the `git` CLI so pre-craft (add/reuse), craft (reads worktreeRoot
// from craft state), and post-craft (remove+prune after a confirmed merge) can all
// call them without needing the omp SDK.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { worktreePath } from "./paths.js";

const execFileAsync = promisify(execFile);

function stderrOf(error: unknown): string {
	if (error && typeof error === "object" && "stderr" in error) {
		const stderr = (error as { stderr?: unknown }).stderr;
		if (typeof stderr === "string" && stderr.length > 0) return stderr;
	}
	return error instanceof Error ? error.message : String(error);
}

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		return await execFileAsync("git", args, { cwd });
	} catch (error) {
		throw new Error(`git ${args.join(" ")} failed: ${stderrOf(error)}`);
	}
}

async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
	try {
		await execFileAsync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd });
		return true;
	} catch {
		return false;
	}
}

export interface WorktreeAddOptions {
	/** Branch name to create or reuse. Defaults to `lets-craft/{feature}`. */
	branch?: string;
	/** Base ref for a newly created branch. Defaults to `HEAD`. */
	baseRef?: string;
}

export interface WorktreeAddResult {
	path: string;
	branch: string;
	/** True when an existing worktree directory or branch was reused (C7 — REJECT re-run reuses). */
	reused: boolean;
}

/**
 * `git worktree add .lsc/worktrees/{feature}` — reuses an existing worktree
 * directory (no-op) or an existing local branch (checks it out into the worktree
 * instead of failing on "branch already exists"), so a post-craft REJECT that
 * re-invokes craft on the same feature reuses state instead of erroring (C7).
 */
export async function addWorktree(cwd: string, feature: string, options: WorktreeAddOptions = {}): Promise<WorktreeAddResult> {
	const path = worktreePath(cwd, feature);
	const branch = options.branch ?? `lets-craft/${feature}`;

	if (existsSync(path)) {
		return { path, branch, reused: true };
	}

	if (await localBranchExists(cwd, branch)) {
		await git(cwd, ["worktree", "add", path, branch]);
		return { path, branch, reused: true };
	}

	await git(cwd, ["worktree", "add", "-b", branch, path, options.baseRef ?? "HEAD"]);
	return { path, branch, reused: false };
}

export interface WorktreeRemoveOptions {
	/** Force-remove even with uncommitted changes or untracked files. */
	force?: boolean;
}

/** `git worktree remove .lsc/worktrees/{feature}` — no-op if the directory doesn't exist. */
export async function removeWorktree(cwd: string, feature: string, options: WorktreeRemoveOptions = {}): Promise<void> {
	const path = worktreePath(cwd, feature);
	if (!existsSync(path)) return;
	await git(cwd, ["worktree", "remove", ...(options.force ? ["--force"] : []), path]);
}

/** `git worktree prune` — reclaims stale worktree metadata after external/manual directory removal. */
export async function pruneWorktrees(cwd: string): Promise<void> {
	await git(cwd, ["worktree", "prune"]);
}
