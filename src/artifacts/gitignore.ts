// Auto-registers `.lsc/worktrees/` in the project `.gitignore` (C6): worktree
// checkouts are throwaway build products of `--worktree` craft runs and must never
// be committed, while `.lsc/crafts/` (trace/spec/plan/audit) is the opposite — a
// git-tracked deliverable. Idempotent and creates the file if it doesn't exist yet;
// pre-craft (Phase 4) calls this before every `git worktree add`.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const IGNORE_ENTRY = ".lsc/worktrees/";
// Matches variants a human or an earlier run might already have written
// (leading slash, trailing slash optional) so we never duplicate the line.
const EXISTING_ENTRY_RE = /^\/?\.lsc\/worktrees\/?$/;

export interface GitignoreResult {
	/** Absolute path of the `.gitignore` that was checked/written. */
	path: string;
	/** True when a new line was appended; false when an equivalent entry already existed. */
	added: boolean;
}

/** Ensure `<cwd>/.gitignore` ignores `.lsc/worktrees/` (C6). Safe to call on every pre-craft run. */
export function ensureWorktreesGitignored(cwd: string): GitignoreResult {
	const path = join(cwd, ".gitignore");
	const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
	const alreadyPresent = existing.split(/\r?\n/).some(line => EXISTING_ENTRY_RE.test(line.trim()));
	if (alreadyPresent) return { path, added: false };

	const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
	writeFileSync(path, `${existing}${needsLeadingNewline ? "\n" : ""}${IGNORE_ENTRY}\n`);
	return { path, added: true };
}
