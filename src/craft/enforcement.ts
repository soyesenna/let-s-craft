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
import type { ExtensionAPI, SessionStopEventResult, ToolCallEventResult } from "@oh-my-pi/pi-coding-agent";
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

/** Conservative substring match for bash: we can't parse arbitrary shell, so fail closed (plan §Phase 3 (4)). */
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
	craft: Pick<CraftState, "projectRoot" | "feature"> | undefined,
): ToolCallEventResult | undefined {
	if (!craft) return undefined;
	const testDir = craftTestDir(craft.projectRoot, craft.feature);

	if (event.toolName === "bash") {
		const command = typeof event.input.command === "string" ? event.input.command : "";
		const bashCwd = typeof event.input.cwd === "string" ? event.input.cwd : undefined;
		if (bashCwd) {
			const resolvedBashCwd = isAbsolute(bashCwd) ? bashCwd : resolve(event.cwd, bashCwd);
			if (isPathWithin(testDir, resolvedBashCwd)) return blockResult(testDir);
		}
		if (containsProtectedPath(command, event.cwd, testDir)) return blockResult(testDir);
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

/** Pure decision for the `session_stop` handler: continue iff a craft is active, its tests haven't passed, and it hasn't been user-aborted. */
export function shouldContinueCraftLoop(craft: Pick<CraftState, "testsPassed" | "aborted"> | undefined): boolean {
	return craft !== undefined && !craft.testsPassed && !craft.aborted;
}

function continuationResult(craft: CraftState): SessionStopEventResult {
	const failure = craft.lastFailureSummary ? ` Last failure: ${craft.lastFailureSummary}` : "";
	return {
		continue: true,
		additionalContext: `lets-craft: craft "${craft.feature}" has not passed run_test.sh yet — continue the craft loop (re-invoke the executor with the failure summary, then lsc_run_tests / lsc_verify_hash).${failure}`,
	};
}

/** Wire the tool_call block, the session_stop backstop, and active-craft reset on session transitions. */
export function registerCraftEnforcement(pi: ExtensionAPI): void {
	pi.on("tool_call", (event, ctx) => {
		return evaluateToolCallForActiveCraft(
			{ toolName: event.toolName, input: event.input as Record<string, unknown>, cwd: ctx.cwd },
			getActiveCraft(),
		);
	});

	pi.on("session_stop", () => {
		const craft = getActiveCraft();
		if (!shouldContinueCraftLoop(craft)) return undefined;
		return continuationResult(craft as CraftState);
	});

	registerCraftStateResets(pi);
}
