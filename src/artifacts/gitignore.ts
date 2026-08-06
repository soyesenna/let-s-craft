// Auto-registers throwaway build products in the project `.gitignore` — idempotent, creates
// the file if it doesn't exist yet. `.lsc/worktrees/`: worktree checkouts from `--worktree`
// craft runs. `.lsc/crafts/` (trace/spec/plan/audit/check/run_check.sh) is the opposite — a
// git-tracked deliverable (C6) — EXCEPT its two restart-durable/transcript sidecars,
// `.craft-state.json` and `check/logs/`, which must stay untracked (C3, plan.md's BL2): staging
// them would let a feature's craft state or check transcripts land on the base branch through
// craft's own "commit everything uncommitted" step. pre-craft (Phase 4) calls
// ensureWorktreesGitignored() before every `git worktree add`; `lsc_craft_init` (F3) calls
// ensureCheckLogsGitignored()/ensureCraftStateGitignored() so a consumer project that installs
// this plugin — and so never inherits this repo's OWN hand-written `.gitignore` — still gets
// these two entries registered automatically, the same way `.lsc/worktrees/` already is.
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

/**
 * PURE read-only membership check for the `.lsc/worktrees/` entry (doctor check ⑦ — spec 제약 4).
 * The doctor must never call the ensure* writers during a diagnosis (they read-and-immediately-write);
 * this is the extracted read-only half over already-read `.gitignore` content. The ensure* helpers
 * keep their write-when-absent behavior unchanged.
 */
export function hasWorktreesGitignoreEntry(content: string): boolean {
	return content.split(/\r?\n/).some(line => WORKTREES_ENTRY_RE.test(line.trim()));
}

// F3 — the two per-feature sidecars that must never be tracked (C3): `.craft-state.json` (restart-
// durable active-craft state) and `check/logs/` (run_check.sh transcripts). Both use a bare `*` for
// the feature segment (gitignore's own glob syntax, matching this repo's own hand-written entries),
// so one line covers every feature under `.lsc/crafts/`.
const CHECK_LOGS_ENTRY = ".lsc/crafts/*/check/logs/";
const CHECK_LOGS_ENTRY_RE = /^\/?\.lsc\/crafts\/\*\/check\/logs\/?$/;
const CRAFT_STATE_ENTRY = ".lsc/crafts/*/.craft-state.json";
const CRAFT_STATE_ENTRY_RE = /^\/?\.lsc\/crafts\/\*\/\.craft-state\.json$/;

// Note: these two doc comments deliberately avoid writing the literal glob inline — a bare `*/`
// substring (feature-wildcard immediately followed by a path separator) would close the `/** */`
// comment early and break the parser.

/** Ensure the project `.gitignore` ignores every feature's check-transcript directory, `check/logs/` under `.lsc/crafts/{feature}/` (F3, `CHECK_LOGS_ENTRY` above for the exact glob). Called by `lsc_craft_init`. */
export function ensureCheckLogsGitignored(cwd: string): GitignoreResult {
	return ensureGitignored(cwd, CHECK_LOGS_ENTRY, CHECK_LOGS_ENTRY_RE);
}

/** Ensure the project `.gitignore` ignores every feature's restart-durable state file, `.craft-state.json` under `.lsc/crafts/{feature}/` (F3, `CRAFT_STATE_ENTRY` above for the exact glob). Called by `lsc_craft_init`. */
export function ensureCraftStateGitignored(cwd: string): GitignoreResult {
	return ensureGitignored(cwd, CRAFT_STATE_ENTRY, CRAFT_STATE_ENTRY_RE);
}
