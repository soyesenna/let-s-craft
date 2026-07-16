// Active craft: the single in-flight craft loop the extension enforces against.
// Modeled as a main-session module-scope singleton (C1 — active craft is a
// per-session concept, and session_stop only fires for the main session,
// agent-session.ts:5341) with restart-durable persistence to
// `test/.craft-state.json` — a process restart mid craft-loop (crash, `omp`
// upgrade) must not silently disable the tool_call block or the session_stop
// backstop until the next lsc_craft_init call.
//
// Every mutation goes through the functions below rather than the module-scope
// variable directly, so persistence and every reader (enforcement.ts,
// hash-manifest.ts, run-tests.ts) always see the same state.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftStatePath } from "../artifacts/paths.js";
import { writeFileAtomicSync } from "../utils/atomic-write.js";

export interface CraftState {
	feature: string;
	/**
	 * Absolute path of the main project root — this field itself is always the main checkout,
	 * never the worktree (§3.3). It is no longer the sole artifact/state root, though: the
	 * persisted state file below, the hash manifest, snapshots, and run_test.sh all resolve
	 * against `worktreeRoot ?? projectRoot` (see `persist` below, and the matching root
	 * resolution in hash-manifest.ts/run-tests.ts/enforcement.ts).
	 */
	projectRoot: string;
	/** Absolute path of the worktree source root, when `--worktree` was used. */
	worktreeRoot?: string;
	/** Whether the most recent lsc_run_tests call passed every test. */
	testsPassed: boolean;
	/** Structured summary of the last failure, re-injected into the next executor call (C21). */
	lastFailureSummary?: string;
	/**
	 * Set once the user has explicitly declined to continue (a hash-violation
	 * restore decline, a run_test.sh-unrunnable escalation decline — C23; Phase
	 * 3.5/5 wire the actual confirmation prompt). The session_stop backstop must
	 * not force continuation once this is true, or it would fight a user who
	 * already asked to stop.
	 */
	aborted: boolean;
}

let activeCraft: CraftState | undefined;

function persist(state: CraftState): void {
	const path = craftStatePath(state.worktreeRoot ?? state.projectRoot, state.feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileAtomicSync(path, JSON.stringify(state, null, 2));
}

/** The in-flight craft, if any. */
export function getActiveCraft(): CraftState | undefined {
	return activeCraft;
}

/** Register a new active craft (called by lsc_craft_init) and persist it immediately. */
export function setActiveCraft(state: CraftState): void {
	activeCraft = state;
	persist(state);
}

/**
 * Load a persisted craft state from disk into the in-memory singleton. A primitive for direct
 * testing and for callers that want to inspect a feature's last-recorded state without becoming
 * its active-craft owner — not the mechanism that recovers active-craft after a process restart
 * mid-craft-loop. That recovery is skill-driven: `craft/SKILL.md`'s own "Resume note" has the
 * skill re-call `lsc_craft_init` itself, which recomputes the manifest and re-registers the
 * singleton from scratch. Nothing in this extension calls this function automatically.
 */
export function loadActiveCraft(projectRoot: string, feature: string): CraftState | undefined {
	const path = craftStatePath(projectRoot, feature);
	if (!existsSync(path)) return undefined;
	activeCraft = JSON.parse(readFileSync(path, "utf8")) as CraftState;
	return activeCraft;
}

/** Update pass/fail status after an lsc_run_tests call. No-op when there is no active craft. */
export function recordTestResult(passed: boolean, failureSummary?: string): void {
	if (!activeCraft) return;
	activeCraft = { ...activeCraft, testsPassed: passed, lastFailureSummary: passed ? undefined : failureSummary };
	persist(activeCraft);
}

/** Mark the active craft as user-aborted. Stops the session_stop backstop (see CraftState.aborted). */
export function markCraftAborted(): void {
	if (!activeCraft) return;
	activeCraft = { ...activeCraft, aborted: true };
	persist(activeCraft);
}

/** Clear the in-memory active craft. The persisted file is left in place — a later `lsc_craft_init` call (craft/SKILL.md's own resume flow) re-attaches it; nothing does so automatically. */
export function clearActiveCraft(): void {
	activeCraft = undefined;
}

/**
 * Reset active-craft on session transitions that leave the current craft's
 * context behind. Wired on the *completed* transition events (`session_switch`,
 * `session_branch`, `session_shutdown`), not their `session_before_*`
 * counterparts — those are cancellable, and clearing state for a switch/branch
 * that a later handler aborts would silently disable enforcement for the craft
 * that is, in fact, still running in the still-current session.
 */
export function registerCraftStateResets(pi: ExtensionAPI): void {
	pi.on("session_switch", () => clearActiveCraft());
	pi.on("session_branch", () => clearActiveCraft());
	pi.on("session_shutdown", () => clearActiveCraft());
}
