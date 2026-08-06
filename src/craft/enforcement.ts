// The two platform seams that make C20 ("run_test.sh/테스트 코드 수정 절대 금지")
// and the "loop runs until tests pass" contract (C19) more than LLM cooperation:
//
//   - tool_call:    block write/edit/ast_edit/bash calls that target the active
//                   craft's protected test tree (tool-wrapper.ts:46-58 fail-closed
//                   on a handler throw already; we return an explicit
//                   {block, reason} instead so the LLM sees *why*, rather than a
//                   generic wrapper error).
//   - session_stop: force one more continuation while a craft is active and its
//                   tests haven't passed yet (agent-session.ts:5341-5369). We
//                   deliberately do NOT track our own continuation counter or
//                   read event.stop_hook_active — cap 8, the reset, and
//                   stop_hook_active are entirely platform-owned; duplicating them
//                   risks desync with the platform's own state (iter2 redesign,
//                   plan §Phase 3 (4), R1). We just decide "does craft still need
//                   a turn" fresh every time and trust the platform to stop
//                   asking once its cap is hit — agent-session.ts:5351 also
//                   discards our {continue:true} outright once an abort is
//                   already in progress, so there is nothing left for us to
//                   duplicate there either.
//
// Both decisions are exposed as pure functions (evaluateToolCallForActiveCraft,
// shouldContinueCraftLoop) so tests can assert the block/continue logic directly
// without booting a session.
import { isAbsolute, relative, resolve } from "node:path";
import type { ExtensionAPI, ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
import { craftTestDir } from "../artifacts/paths.js";
import { type CraftState, getActiveCraft, registerCraftStateResets } from "./state.js";

const PROTECTED_TOOLS = new Set(["write", "edit", "ast_edit"]);

function isPathWithin(parent: string, child: string): boolean {
	const rel = relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Glob metacharacters ast_edit's `paths` entries may use (e.g. `test/**/*.ts`) — resolve()
// can't evaluate those exactly, so they fall back to the fail-closed substring match below.
// Plain write/edit paths never contain these and must go through isPathWithin only, or a
// sibling directory that merely starts with the same prefix (e.g. `test-other/`) would
// false-positive against the protected `test/` dir.
const GLOB_CHARS_RE = /[*?[\]{}]/;

// The `edit` tool's default mode ("hashline") has a schema of `{ input: string }` only — no
// top-level `path`/`paths` field exists for this mode, so extractPathCandidates's `path`/`paths`
// checks alone silently never block a hashline `edit` call. This was found to be a REAL bypass
// (not a hypothetical): a real E2E run had a subagent's `edit` call against a hash-protected
// test file go straight through the block undetected. The target path instead lives inside
// `input.input`'s text, as one or more `[path#TAG]` header lines (TAG = 4 hex chars, optional).
// The less common `apply_patch` mode (also `{ input: string }`-only) instead marks paths with
// `*** Add/Delete/Update File: path` / `*** Move to: path` lines. Both formats are replicated
// here as self-contained regexes rather than importing omp-internal packages (not part of the
// stable extension API) — the same "mirror the platform's own conventions by hand" pattern this
// plugin already uses elsewhere (every skills/*/SKILL.md replicates src/artifacts/paths.ts's
// path conventions without importing it).
const HASHLINE_HEADER_RE = /^[ \t]*\[([^\r\n\]]+)\][ \t]*$/gm;
const HASHLINE_HASH_TAG_RE = /^(.*)#[0-9a-fA-F]{4}$/;
const APPLY_PATCH_FILE_RE = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm;
const APPLY_PATCH_MOVE_RE = /^\*\*\* Move to: (.+)$/gm;

/** Extract every file path referenced by an `edit` tool's payload text, regardless of which edit mode wrote it (hashline header lines or apply_patch markers — see the block comment above). */
function extractEditPayloadPaths(text: string): string[] {
	const out: string[] = [];
	for (const match of text.matchAll(HASHLINE_HEADER_RE)) {
		const body = match[1];
		const hashTag = HASHLINE_HASH_TAG_RE.exec(body);
		out.push(hashTag ? hashTag[1] : body);
	}
	for (const match of text.matchAll(APPLY_PATCH_FILE_RE)) out.push(match[1]);
	for (const match of text.matchAll(APPLY_PATCH_MOVE_RE)) out.push(match[1]);
	return out;
}

function extractPathCandidates(input: Record<string, unknown>): string[] {
	const out: string[] = [];
	if (typeof input.path === "string") out.push(input.path);
	if (Array.isArray(input.paths)) {
		for (const entry of input.paths) if (typeof entry === "string") out.push(entry);
	}
	if (typeof input.input === "string") out.push(...extractEditPayloadPaths(input.input));
	return out;
}

/**
 * Substring match for bash: we can't parse arbitrary shell, so this checks only the two most
 * common ways a command's text would reference the protected path (the absolute `testDir`, and
 * `testDir` written relative to the anchor `cwd` the caller passes in — the event's own cwd for
 * the common case, or a craft's `worktreeRoot` when the protected path lives inside a worktree
 * and the command references it worktree-relatively, e.g. `git -C {worktree} ... .lsc/crafts/...`).
 * This is a best-effort first line of
 * defense, not a guarantee — it has known fail-OPEN gaps a determined or merely differently-
 * phrased command can slip through: a `cd`-chain that changes directory mid-command before
 * touching a bare relative filename (`cd .lsc/crafts/f/test && rm run_test.sh` is caught since
 * the literal segment still appears in the text, but a multi-hop `cd ../../x && cd y/test-dir`
 * that never spells out the real path as a substring is not); a relative path computed via shell
 * expansion/variables rather than literal text; or a symlink located outside `testDir` whose
 * target resolves inside it (the command text referencing the symlink's own path won't contain
 * `testDir` as a substring at all). None of these are hypothetical hardening for its own sake —
 * they are the deliberate reason this function is a *first* line of defense, not the *only* one:
 * `lsc_verify_hash`'s content-hash comparison (hash-manifest.ts) is authoritative regardless of
 * which tool or shell trick produced a change, because it re-reads the actual file bytes on disk
 * (following symlinks, oblivious to how the write happened) rather than trying to predict every
 * way a write could be expressed. Any gap here is caught there on the next verify (C23b) — this
 * function existing at all is purely to fail fast and give the LLM an immediate, actionable
 * `{block, reason}` for the common cases, not to be a complete guarantee (plan §Phase 3 (4)).
 */
function containsProtectedPath(text: string, cwd: string, testDir: string): boolean {
	if (text.includes(testDir)) return true;
	const rel = relative(cwd, testDir);
	return rel.length > 0 && !rel.startsWith("..") && text.includes(rel);
}

function blockResult(testDir: string): ToolCallEventResult {
	return {
		block: true,
		reason: `lets-craft: ${testDir} is under active craft hash protection (C20) — run_test.sh and test assets cannot be modified while the craft loop is running. If this change is intentional, ask the user to pause the craft first.`,
	};
}

export interface ToolCallDecisionInput {
	toolName: string;
	input: Record<string, unknown>;
	/** The tool call's working directory (ctx.cwd) — resolves relative candidates and anchors the bash substring match. */
	cwd: string;
}

/** Pure decision for the `tool_call` handler: block iff the call targets the active craft's protected test tree. */
export function evaluateToolCallForActiveCraft(
	event: ToolCallDecisionInput,
	craft: Pick<CraftState, "projectRoot" | "feature" | "worktreeRoot"> | undefined,
): ToolCallEventResult | undefined {
	if (!craft) return undefined;
	// Root + substring anchor both need worktree awareness (the block-vs-allow logic itself is
	// unchanged): testDir must point at the worktree's protected tree when one is active, and the
	// substring anchor below must be the same root so a worktree-relative command (e.g.
	// `git -C {worktree} checkout -- .lsc/crafts/{f}/test/...`) is still recognized.
	const testDir = craftTestDir(craft.worktreeRoot ?? craft.projectRoot, craft.feature);

	if (event.toolName === "bash") {
		const command = typeof event.input.command === "string" ? event.input.command : "";
		const bashCwd = typeof event.input.cwd === "string" ? event.input.cwd : undefined;
		if (bashCwd) {
			// event.cwd is intentionally kept here (not worktreeRoot): this resolves the bash call's
			// own --cwd option against where it actually executes, and using the worktree root
			// instead would misinterpret that execution location (false-negative).
			const resolvedBashCwd = isAbsolute(bashCwd) ? bashCwd : resolve(event.cwd, bashCwd);
			if (isPathWithin(testDir, resolvedBashCwd)) return blockResult(testDir);
		}
		// Only the substring anchor changes to worktreeRoot — this is the one line the worktree
		// topology actually requires: it lets a worktree-relative command's text (which never spells
		// out the worktree's own absolute path against testDir) still substring-match correctly.
		if (containsProtectedPath(command, craft.worktreeRoot ?? event.cwd, testDir)) return blockResult(testDir);
		return undefined;
	}

	if (!PROTECTED_TOOLS.has(event.toolName)) return undefined;
	for (const candidate of extractPathCandidates(event.input)) {
		const abs = isAbsolute(candidate) ? candidate : resolve(event.cwd, candidate);
		if (isPathWithin(testDir, abs)) return blockResult(testDir);
		if (GLOB_CHARS_RE.test(candidate) && candidate.includes(testDir)) return blockResult(testDir);
	}
	return undefined;
}

/** Wire the tool_call block and active-craft reset on session transitions. */
export function registerCraftEnforcement(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		return evaluateToolCallForActiveCraft(
			{ toolName: event.toolName, input: event.input as Record<string, unknown>, cwd: ctx.cwd },
			getActiveCraft(),
		);
	});

	registerCraftStateResets(pi);
}
