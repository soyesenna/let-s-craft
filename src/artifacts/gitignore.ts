// Auto-registers throwaway build products in the project `.gitignore` — idempotent, creates
// the file if it doesn't exist yet. Two independent entries:
//   - `.lsc/worktrees/`: worktree checkouts from `--worktree` craft runs. `.lsc/crafts/`
//     (trace/spec/plan/audit) is the opposite — a git-tracked deliverable (C6). pre-craft
//     (Phase 4) calls ensureWorktreesGitignored() before every `git worktree add`.
//   - `.lsc/crafts/*/test/.snapshots/`: per-feature file-content snapshots lsc_craft_init
//     writes for lsc_restore_tests to restore from (C23b) — a full byte-for-byte duplicate of
//     the protected test tree, regenerated on every craft run, with no reason to live in git
//     history (the tree it's a copy of is already committed there once, by pre-craft).
//     lsc_craft_init calls ensureSnapshotsGitignored() itself, once, right after writing the
//     first snapshot.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomicSync } from "../utils/atomic-write.js";

export interface GitignoreResult {
	/** Absolute path of the `.gitignore` that was checked/written. */
	path: string;
	/** True when a new line was appended; false when an equivalent entry already existed. */
	added: boolean;
}

/** Idempotent single-line `.gitignore` append: skip if an equivalent line (per `existingEntryRe`) is already present, otherwise append `entry` (creating the file if needed, adding a leading newline only if the file has trailing content without one). The write is atomic (temp+rename — B): a crash mid-write can never leave a truncated `.gitignore` behind; content is byte-identical to the previous direct write. */
function ensureGitignored(cwd: string, entry: string, existingEntryRe: RegExp): GitignoreResult {
	const path = join(cwd, ".gitignore");
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
	const alreadyPresent = existing.split(/\r?\n/).some(line => existingEntryRe.test(line.trim()));
	if (alreadyPresent) return { path, added: false };

	const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
	writeFileAtomicSync(path, `${existing}${needsLeadingNewline ? "\n" : ""}${entry}\n`);
	return { path, added: true };
}

// Matches variants a human or an earlier run might already have written (leading slash,
// trailing slash optional) so we never duplicate the line.
const WORKTREES_ENTRY = ".lsc/worktrees/";
const WORKTREES_ENTRY_RE = /^\/?\.lsc\/worktrees\/?$/;

/** Ensure `<cwd>/.gitignore` ignores `.lsc/worktrees/` (C6). Safe to call on every pre-craft run. */
export function ensureWorktreesGitignored(cwd: string): GitignoreResult {
	return ensureGitignored(cwd, WORKTREES_ENTRY, WORKTREES_ENTRY_RE);
}

const SNAPSHOTS_ENTRY = ".lsc/crafts/*/test/.snapshots/";
const SNAPSHOTS_ENTRY_RE = /^\/?\.lsc\/crafts\/\*\/test\/\.snapshots\/?$/;

/** Ensure `<cwd>/.gitignore` ignores every feature's `.snapshots/` restore-source directory (C23b). Safe to call on every lsc_craft_init call. */
export function ensureSnapshotsGitignored(cwd: string): GitignoreResult {
	return ensureGitignored(cwd, SNAPSHOTS_ENTRY, SNAPSHOTS_ENTRY_RE);
}
