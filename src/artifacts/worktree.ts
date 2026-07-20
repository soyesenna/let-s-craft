// `git worktree add/remove/prune` helpers for `.lsc/worktrees/{feature}` (C7).
//
// Land (merge into the target branch) is explicitly NOT here — post-craft (Phase 6)
// owns that decision because merging requires a user-confirmed gate (project RULE:
// git merge only on explicit user instruction). These are plain, dependency-free
// helpers over the `git` CLI so pre-craft (add/reuse), craft (reads worktreeRoot
// from craft state), and post-craft (remove+prune after a confirmed merge) can all
// call them without needing the omp SDK.
import { execFile } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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

/**
 * `git worktree remove .lsc/worktrees/{feature}` — TRAP (K4): no-op when the directory is absent,
 * so a caller that treats "no throw" as "removed" can be fooled by an already-missing/unregistered
 * path. Land never relies on this: it confirms membership (isRegisteredWorktree) and re-validates
 * the target (inspect/evaluateRemovalTarget) itself, so a missing path is an explicit isError there,
 * not a silent success here. force passes a SINGLE `--force` — never `--force --force`, so a locked
 * worktree stays inviolable (N1, git owns lock/dirty semantics).
 */
export async function removeWorktree(cwd: string, feature: string, options: WorktreeRemoveOptions = {}): Promise<void> {
	const path = worktreePath(cwd, feature);
	if (!existsSync(path)) return;
	await git(cwd, ["worktree", "remove", ...(options.force ? ["--force"] : []), path]);
}

/** `git worktree prune` — reclaims stale worktree metadata after external/manual directory removal. */
export async function pruneWorktrees(cwd: string): Promise<void> {
	await git(cwd, ["worktree", "prune"]);
}

// ===========================================================================
// A (deferred-pool): removal-target observation/evaluation + porcelain parser +
// membership. inspectRemovalTarget is the SDK-independent EFFECT; evaluateRemovalTarget is the
// PURE judgment (spec §제약 1, N1 — path safety ONLY; dirty/locked/submodule are git's `--force`
// business and are never observed). Ported from oh-my-claudecode worktree-cleanup-safety (검사 순서
// 원천 보존: sanity → symlink → root/home → containment → main-repo).
// ===========================================================================

/** What inspectRemovalTarget observes and evaluateRemovalTarget consumes — no git-state facets. */
export interface RemovalObservation {
	/** The raw candidate path the sanity checks run on. */
	input: string;
	exists: boolean;
	isSymlink: boolean;
	isDirectory: boolean;
	/** realpath (symlinks followed) when it exists, else a lexical resolve — the containment/root checks key off this. */
	resolvedPath: string;
	/** Resolved home directory, for the home boundary. */
	home: string;
	/** `join(resolvedPath, ".git")` exists AND is a directory — the main-repo tell (git R1/R2 already refuse this; the check is a defensive DUPLICATE, N1). */
	dotGitIsDirectory: boolean;
}

/** The fs/os subset inspectRemovalTarget observes through — injectable so land can drive a deterministic re-check. */
export interface RemovalInspectPorts {
	existsSync(path: string): boolean;
	lstatSync(path: string): { isSymbolicLink(): boolean; isDirectory(): boolean };
	realpathSync(path: string): string;
	homedir(): string;
}

const defaultRemovalInspectPorts: RemovalInspectPorts = { existsSync, lstatSync, realpathSync, homedir };

/**
 * Observe a removal candidate (SDK-independent effect — NOT pure): lstat for symlink/dir, realpath
 * for the resolved location a removal would actually hit, and whether the resolved dir is a git
 * main repo (`.git` directory). A non-existent candidate is resolved lexically so the pure
 * evaluator still has an absolute path to range-check.
 */
export function inspectRemovalTarget(candidate: string, ports: RemovalInspectPorts = defaultRemovalInspectPorts): RemovalObservation {
	const exists = ports.existsSync(candidate);
	let isSymlink = false;
	let isDirectory = false;
	let resolvedPath = resolve(candidate);
	if (exists) {
		const stat = ports.lstatSync(candidate);
		isSymlink = stat.isSymbolicLink();
		isDirectory = stat.isDirectory();
		resolvedPath = ports.realpathSync(candidate);
	}
	const dotGit = join(resolvedPath, ".git");
	const dotGitIsDirectory = ports.existsSync(dotGit) && ports.lstatSync(dotGit).isDirectory();
	return { input: candidate, exists, isSymlink, isDirectory, resolvedPath, home: ports.homedir(), dotGitIsDirectory };
}

export type RemovalRejectReason =
	| "empty"
	| "nul"
	| "suspicious"
	| "symlink"
	| "filesystem-root"
	| "home-directory"
	| "outside-roots"
	| "main-repo";

export type RemovalEvaluation =
	| { ok: true; resolvedPath: string; matchedRoot: string }
	| { ok: false; reason: RemovalRejectReason };

/**
 * PURE removal-safety judgment (spec AC4). Rejects, in the OMC-preserved order: empty/blank input,
 * a NUL byte, the suspicious literals `.`/`..`/`~`, a symlink candidate, the filesystem root, the
 * home directory, a resolved path outside every expected containment root, and a git main repo
 * (`.git` directory). It DELIBERATELY never inspects dirty/locked/submodule state — git `--force`
 * owns those (N1). `expectedRoots` are pre-resolved absolute containment roots (worktreesRootDir).
 */
export function evaluateRemovalTarget(observation: RemovalObservation, expectedRoots: readonly string[]): RemovalEvaluation {
	const raw = observation.input;
	if (raw.trim().length === 0) return { ok: false, reason: "empty" };
	if (raw.includes("\0")) return { ok: false, reason: "nul" };
	const trimmed = raw.trim();
	if (trimmed === "." || trimmed === ".." || trimmed === "~") return { ok: false, reason: "suspicious" };
	if (observation.isSymlink) return { ok: false, reason: "symlink" };
	if (observation.resolvedPath === "/") return { ok: false, reason: "filesystem-root" };
	if (observation.resolvedPath === observation.home) return { ok: false, reason: "home-directory" };
	const matchedRoot = expectedRoots.find(root => observation.resolvedPath === root || observation.resolvedPath.startsWith(`${root}/`));
	if (!matchedRoot) return { ok: false, reason: "outside-roots" };
	if (observation.dotGitIsDirectory) return { ok: false, reason: "main-repo" };
	return { ok: true, resolvedPath: observation.resolvedPath, matchedRoot };
}

/** One `git worktree list --porcelain` block — the prunable/locked REASON is preserved (doctor's orphan-worktree check needs the granularity, N1). */
export interface WorktreeEntry {
	path: string;
	head?: string;
	branch?: string;
	bare?: boolean;
	detached?: boolean;
	locked?: string;
	prunable?: string;
}

/** PURE `git worktree list --porcelain` parser — blank-line-delimited blocks into path/HEAD/branch/flags. */
export function parseWorktreePorcelain(text: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | undefined;
	for (const rawLine of text.split("\n")) {
		const line = rawLine.trimEnd();
		if (line === "") {
			if (current) entries.push(current);
			current = undefined;
			continue;
		}
		const space = line.indexOf(" ");
		const key = space === -1 ? line : line.slice(0, space);
		const value = space === -1 ? "" : line.slice(space + 1);
		if (key === "worktree") {
			if (current) entries.push(current);
			current = { path: value };
			continue;
		}
		if (!current) continue;
		if (key === "HEAD") current.head = value;
		else if (key === "branch") current.branch = value;
		else if (key === "bare") current.bare = true;
		else if (key === "detached") current.detached = true;
		else if (key === "locked") current.locked = value;
		else if (key === "prunable") current.prunable = value;
	}
	if (current) entries.push(current);
	return entries;
}

/** `git worktree list --porcelain` parsed into entries (land preflight, pre-removal re-check, doctor orphan check). */
export async function listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
	const { stdout } = await git(cwd, ["worktree", "list", "--porcelain"]);
	return parseWorktreePorcelain(stdout);
}

/** True iff `target` is a git-registered worktree of `cwd` (membership gate — closes removeWorktree's missing-success trap). Compares literal and realpath'd paths so a symlinked/normalized registration still matches. */
export async function isRegisteredWorktree(cwd: string, target: string): Promise<boolean> {
	const entries = await listWorktrees(cwd);
	let targetReal = target;
	try {
		targetReal = realpathSync(target);
	} catch {
		// target may not exist (or be a dangling symlink) — fall back to the literal path.
	}
	return entries.some(entry => {
		if (entry.path === target || entry.path === targetReal) return true;
		try {
			return realpathSync(entry.path) === targetReal;
		} catch {
			return false;
		}
	});
}
