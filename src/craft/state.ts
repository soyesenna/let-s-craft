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
import { invalidatePendingApproval } from "./destructive-approval.js";

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
	 * Structured signature of the last failure (C-1 no-progress detection) — recordTestResult's
	 * own comparison key, derived by computeFailureSignature (src/craft/run-tests.ts) from the
	 * same failure-summary text as lastFailureSummary above. Optional so older persisted state
	 * files (written before this field existed) still parse: JSON.parse in loadActiveCraft never
	 * validates shape, so an absent field simply reads as undefined, not a parse error.
	 */
	failureSignature?: string;
	/**
	 * Consecutive `lsc_run_tests` failures whose failureSignature matched the immediately
	 * preceding one — i.e. no forward movement, not merely "failed again" (C-1). Reset to 1 when
	 * the signature changes (a different failure IS progress, even though the suite still fails),
	 * cleared on a pass. Same backward-compat rationale as failureSignature above.
	 */
	consecutiveFailures?: number;
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

/**
 * Register (or re-register) the active craft and publish it AFTER a successful persist (CS3
 * commit-point order: invalidate → persist → publish). A persist throw leaves the previous
 * in-memory value intact — a failed activation must never expose active state. Activating a new
 * (or re-initialized) craft also revokes any pending destructive approval carried from the prior
 * context, so a stale "just approved" nonce cannot survive a re-init the user skipped.
 */
export function setActiveCraft(state: CraftState): void {
	invalidatePendingApproval();
	persist(state);
	activeCraft = state;
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
	const restored = JSON.parse(readFileSync(path, "utf8")) as CraftState;
	invalidatePendingApproval();
	activeCraft = restored;
	return restored;
}

/** Consecutive same-signature test failures at which the loop is considered stuck, not merely retrying (C-1). */
export const NO_PROGRESS_THRESHOLD = 3;

/** What recordTestResult reports back, so callers (the lsc_run_tests tool wrapper) know whether to escalate. */
export interface RecordTestResultOutcome {
	consecutiveFailures: number;
	noProgress: boolean;
}

/**
 * Update pass/fail status after an lsc_run_tests call, and own the no-progress counting/reset
 * semantics (C-1): on failure, compare `failureSignature` against the one already recorded — an
 * unchanged signature increments `consecutiveFailures` (same failure, no forward movement); a
 * changed one resets it to 1 (a different failure IS progress, even though the suite still
 * fails). A pass clears both fields. `failureSignature` is caller-supplied rather than computed
 * here — computeFailureSignature lives in run-tests.ts, which already imports this module, so
 * computing it here too would create a cycle; the caller (run-tests.ts) derives it once from the
 * same failure-summary text as `failureSummary` and threads it through. No-op when there is no
 * active craft.
 */
export function recordTestResult(passed: boolean, failureSummary?: string, failureSignature?: string): RecordTestResultOutcome {
	if (!activeCraft) return { consecutiveFailures: 0, noProgress: false };

	if (passed) {
		activeCraft = { ...activeCraft, testsPassed: true, lastFailureSummary: undefined, failureSignature: undefined, consecutiveFailures: undefined };
		persist(activeCraft);
		return { consecutiveFailures: 0, noProgress: false };
	}

	const progressed = failureSignature === undefined || failureSignature !== activeCraft.failureSignature;
	const consecutiveFailures = progressed ? 1 : (activeCraft.consecutiveFailures ?? 0) + 1;
	const noProgress = consecutiveFailures >= NO_PROGRESS_THRESHOLD;

	activeCraft = { ...activeCraft, testsPassed: false, lastFailureSummary: failureSummary, failureSignature, consecutiveFailures };
	persist(activeCraft);
	return { consecutiveFailures, noProgress };
}

/** Mark the active craft as user-aborted. Stops the session_stop backstop (see CraftState.aborted). */
export function markCraftAborted(): void {
	if (!activeCraft) return;
	const next = { ...activeCraft, aborted: true };
	invalidatePendingApproval();
	persist(next);
	activeCraft = next;
}

/** Clear the in-memory active craft and revoke any pending destructive approval. The persisted file is left in place — a later `lsc_craft_init` call (craft/SKILL.md's own resume flow) re-attaches it; nothing does so automatically. */
export function clearActiveCraft(): void {
	invalidatePendingApproval();
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
