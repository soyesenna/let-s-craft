// Active craft: the single in-flight craft loop the extension enforces against.
// Modeled as a main-session module-scope singleton (C1 — active craft is a
// per-session concept) with restart-durable persistence to
// `test/.craft-state.json` — a process restart mid craft-loop (crash, `omp`
// upgrade) must not silently lose track of the active craft until the next
// lsc_craft_init call.
//
// Every mutation goes through the functions below rather than the module-scope
// variable directly, so persistence and every reader (run-tests.ts,
// watchdog.ts, statusbar/craft-progress.ts) always see the same state.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftStatePath, worktreePath } from "../artifacts/paths.js";
import { writeFileAtomicSync } from "../utils/atomic-write.js";
import { type ApprovalCraftIdentity, invalidatePendingApproval } from "./destructive-approval.js";

/**
 * The current on-disk `.craft-state.json` schema generation (D, AC9). A hard pin: bumping it is a
 * deliberate, reviewed act — it changes what `decodeCraftState` rejects as "too new" and what every
 * durable write stamps. Cargo first-class-error precedent (N6).
 */
export const CRAFT_STATE_VERSION = 1;

export interface CraftState {
	/**
	 * On-disk schema version (D). Stamped to CRAFT_STATE_VERSION by every durable write (persist).
	 * Optional so an older, pre-version file still parses: `decodeCraftState` reads an absent value
	 * tolerantly (a legacy file), but rejects an unknown NEWER value (> CRAFT_STATE_VERSION) with an
	 * explicit throw rather than silently mis-reading it.
	 */
	stateVersion?: number;
	feature: string;
	/**
	 * Absolute path of the main project root — this field itself is always the main checkout,
	 * never the worktree (§3.3). It is no longer the sole artifact/state root, though: the
	 * persisted state file below and run_test.sh both resolve against `worktreeRoot ?? projectRoot`
	 * (see `persist` below, and the matching root resolution in run-tests.ts).
	 */
	projectRoot: string;
	/** Absolute path of the worktree source root, when `--worktree` was used. */
	worktreeRoot?: string;
	/**
	 * Set once the user has explicitly declined to continue, or explicitly aborted via
	 * `lsc_craft_abort`. Durable stop record: it invalidates any pending destructive approval
	 * (invalidatePendingApproval, called wherever this is set) and is watchdog.ts's own explicit-stop
	 * check (`craft?.aborted`, a full no-op trigger there) — craft no longer has a session_stop
	 * backstop of its own to suppress (C1).
	 */
	aborted: boolean;
	/**
	 * Durable A-1 issuance evidence + A-3 판별 토큰 for the last release approval — NOT the consume
	 * authority (that is destructive-approval.ts's in-memory slot). Single slot: a new issuance
	 * overwrites the previous evidence wholesale (F-14). Optional so older state files parse (C3).
	 */
	releaseApproval?: ReleaseApprovalEvidence;
	/**
	 * The post-craft audit cycle number (`audit-N.md`'s N) that `lsc_audit_begin` most recently
	 * recorded (B-1, cycle-freshness) — informational cross-check alongside `runLogAtCycleStart`
	 * below. Optional so older persisted state files (written before this field existed) still
	 * parse: `validateAuditFreshness` (verdict.ts) treats an absent value as "cycle tracking
	 * unavailable," never a violation — same backward-compat rationale as every other optional field.
	 */
	auditCycle?: number;
	/**
	 * The highest `test/logs/run-N.log` index that existed at THIS audit cycle's start (set
	 * alongside `auditCycle` by `lsc_audit_begin`) — the actual freshness threshold `verdict.ts`'s
	 * `validateAuditFreshness` compares against: an APPROVE-family verdict for this cycle must be
	 * backed by a passing run-N.log whose N is STRICTLY GREATER than this value, never a log
	 * carried over from before the cycle began.
	 */
	runLogAtCycleStart?: number;
	/**
	 * Durable machine-trace evidence that `lsc_audit_validate` (verdict.ts, B-1) succeeded for a
	 * specific audit cycle — recorded so (a) a validated verdict leaves a durable trace independent
	 * of the audit-N.md prose itself (post-hoc audit), and (b) a future code-level enforcement seam
	 * has something persisted to key off. Per the review that requested this field: the merge-block
	 * is currently a skill-contract-only backstop (skills/post-craft/SKILL.md §7.1's scope note) not
	 * because a persisted-state-keyed seam is structurally impossible — this marker proves one is
	 * possible — but because introducing that new enforcement seam is deferred to a follow-up
	 * feature. Optional/read-tolerant, same backward-compat rationale as every other optional field.
	 */
	auditValidated?: AuditValidatedEvidence;
}

/**
 * Recorded by `recordAuditValidated` below. `verdict` holds one of verdict.ts's `AuditVerdict`
 * literals but is typed as `string` here (not imported from verdict.ts) so this module's
 * dependency direction stays one-way — verdict.ts already imports several functions from this
 * module; state.ts importing a type back from verdict.ts would be a needless cycle for a field
 * that is otherwise pure data.
 */
export interface AuditValidatedEvidence {
	/** The audit-N.md cycle number this validation covered. */
	cycle: number;
	verdict: string;
	/** ISO timestamp of the validation. */
	at: string;
}

/** A-1 issuance evidence + A-3 durable 판별 토큰 — recorded at confirm, consumed (stamped) at release. Not the consume authority. */
export interface ReleaseApprovalEvidence {
	nonce: string;
	tag: string;
	question: string;
	response: string;
	issuedAt: string;
	/** Reserved for a consumer to stamp when this approval is consumed. Nothing currently writes it (its sole writer, the openRelease state machine, was removed in C2) — kept optional so an old persisted file that has it still parses. */
	consumedAt?: string;
	/** The concrete operation scope this approval was bound to at issuance (A land — a LandOperation). Optional so an unscoped confirm (one that never binds a scope) records none. */
	operationScope?: unknown;
}

let activeCraft: CraftState | undefined;

function persist(state: CraftState): CraftState {
	// Stamp the current schema version IN PLACE on every durable write (D, AC9) — a legacy
	// (unversioned) file a mutator rewrites picks up the stamp here so the version gate can protect
	// it thereafter, and the caller's just-persisted object reflects exactly what landed on disk
	// (getActiveCraft() and the persisted bytes stay one-to-one — the incumbent state contract).
	state.stateVersion = CRAFT_STATE_VERSION;
	const path = craftStatePath(state.worktreeRoot ?? state.projectRoot, state.feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileAtomicSync(path, JSON.stringify(state, null, 2));
	return state;
}

/**
 * The single decoder BOTH readers (loadActiveCraft, readPersistedCraftState) route through, so
 * on-disk schema-version handling can never be bypassed by one reader's own JSON.parse (D, AC9).
 * Absent file → undefined. An unknown NEWER stateVersion (> CRAFT_STATE_VERSION) is an EXPLICIT
 * throw naming the file, the found version, and the supported ceiling (Cargo first-class-error,
 * N6) — never a silent mis-read/active-promotion. An ABSENT stateVersion (an older, pre-version
 * file) is read tolerantly, same backward-compat rationale as every other optional field.
 */
export function decodeCraftState(path: string): CraftState | undefined {
	if (!existsSync(path)) return undefined;
	const decoded = JSON.parse(readFileSync(path, "utf8")) as CraftState;
	if (typeof decoded.stateVersion === "number" && decoded.stateVersion > CRAFT_STATE_VERSION) {
		throw new Error(
			`lets-craft: craft state ${path} has stateVersion ${decoded.stateVersion}, which is newer than the supported ` +
				`stateVersion ${CRAFT_STATE_VERSION} — upgrade lets-craft (this build cannot safely read a newer schema).`,
		);
	}
	return decoded;
}

/** The in-flight craft, if any. */
export function getActiveCraft(): CraftState | undefined {
	return activeCraft;
}

export interface SetActiveCraftOptions {
	/**
	 * "strict" = persist-or-throw, publish only after a successful durable write (the CS3/CS5
	 * transactional publish lsc_craft_init relies on — a state-write failure leaves the craft
	 * unpublished and any open-release still gating). Default "best-effort": the in-memory slot is
	 * the enforcement authority and the persisted file restart-durable evidence, so an unwritable
	 * evidence root (e.g. a foreign identity outside this process's filesystem authority) never
	 * blocks in-memory activation (A).
	 */
	durability?: "strict" | "best-effort";
}

/**
 * Register (or re-register) the active craft. Order: invalidate → merge-preserve → persist →
 * publish. Two properties matter (A/D4):
 *
 * 1. PRESERVATION: durable evidence fields owned by the exact-root writers (recordAuditCycleBegin /
 *    recordAuditValidated / recordReleaseApprovalAt — auditCycle, runLogAtCycleStart,
 *    auditValidated, releaseApproval) survive a re-registration whose caller does not itself
 *    provide them — activating a craft must never erase audit/approval evidence it did not produce.
 * 2. DURABILITY POLICY: see SetActiveCraftOptions — strict persist-or-throw for the lsc_craft_init
 *    transaction, best-effort (default) everywhere else.
 *
 * Activating a new (or re-initialized) craft also revokes any pending destructive approval carried
 * from the prior context, so a stale "just approved" nonce cannot survive a re-init the user skipped.
 */
export function setActiveCraft(state: CraftState, options: SetActiveCraftOptions = {}): void {
	invalidatePendingApproval();
	let next = state;
	try {
		const existing = decodeCraftState(craftStatePath(state.worktreeRoot ?? state.projectRoot, state.feature));
		if (existing) {
			const preserved: Partial<CraftState> = {};
			if (state.auditCycle === undefined && existing.auditCycle !== undefined) preserved.auditCycle = existing.auditCycle;
			if (state.runLogAtCycleStart === undefined && existing.runLogAtCycleStart !== undefined) preserved.runLogAtCycleStart = existing.runLogAtCycleStart;
			if (state.auditValidated === undefined && existing.auditValidated !== undefined) preserved.auditValidated = existing.auditValidated;
			if (state.releaseApproval === undefined && existing.releaseApproval !== undefined) preserved.releaseApproval = existing.releaseApproval;
			if (Object.keys(preserved).length > 0) next = { ...state, ...preserved };
		}
	} catch {
		// An undecodable existing file never blocks activation — the caller's state stands alone.
	}
	try {
		next = persist(next);
	} catch (error) {
		if (options.durability === "strict") throw error;
		// Keep the in-memory stamp convention even when the disk half is unreachable.
		next.stateVersion = CRAFT_STATE_VERSION;
	}
	activeCraft = next;
}

/**
 * Load a persisted craft state from disk into the in-memory singleton. A primitive for direct
 * testing and for callers that want to inspect a feature's last-recorded state without becoming
 * its active-craft owner — not the mechanism that recovers active-craft after a process restart
 * mid-craft-loop. That recovery is skill-driven: `craft/SKILL.md`'s own "Resume note" has the
 * skill re-call `lsc_craft_init` itself, which re-registers the singleton from scratch. Nothing
 * in this extension calls this function automatically.
 */
export function loadActiveCraft(projectRoot: string, feature: string): CraftState | undefined {
	const restored = decodeCraftState(craftStatePath(projectRoot, feature));
	if (!restored) return undefined;
	invalidatePendingApproval();
	activeCraft = restored;
	return restored;
}

/** Mark the active craft as user-aborted (see CraftState.aborted). */
export function markCraftAborted(): void {
	if (!activeCraft) return;
	const next = { ...activeCraft, aborted: true };
	invalidatePendingApproval();
	activeCraft = persist(next);
}

/** Clear the in-memory active craft and revoke any pending destructive approval. The persisted file is left in place — a later `lsc_craft_init` call (craft/SKILL.md's own resume flow) re-attaches it; nothing does so automatically. */
export function clearActiveCraft(): void {
	invalidatePendingApproval();
	activeCraft = undefined;
}

/**
 * Record A-1 issuance evidence into the durable ledger (CS3 persist-before-publish). Single slot —
 * a new issuance replaces the previous evidence wholesale (F-14), so a stale consumedAt never
 * survives. No-op without an active craft. A persist throw propagates with in-memory unchanged.
 */
export function recordReleaseApproval(evidence: ReleaseApprovalEvidence): void {
	if (!activeCraft) return;
	const next: CraftState = { ...activeCraft, releaseApproval: evidence };
	activeCraft = persist(next);
}

/**
 * Record the post-craft audit cycle-start marker (B-1, cycle-freshness) directly against a
 * feature's persisted CraftState at an EXACT root (CS4-style, no candidate guessing) — NOT the
 * active-craft singleton. Post-craft deliberately never calls lsc_craft_init
 * (skills/post-craft/SKILL.md §1.5), so by the time an audit cycle begins there is typically no
 * active craft in this session at all — gating this on `activeCraft` the way
 * recordReleaseApproval does would make it a silent no-op for post-craft's actual call pattern.
 * Fails closed (throws) when no persisted state exists yet at `root` for `feature`
 * — there is no craft to begin an audit cycle against. Keeps the in-memory singleton in sync when
 * it happens to already be this exact craft (harmless either way, never required for correctness).
 */
export function recordAuditCycleBegin(root: string, feature: string, auditCycle: number, runLogAtCycleStart: number): CraftState {
	const existing = readPersistedCraftState(root, feature);
	if (!existing) {
		throw new Error(`lets-craft: no persisted craft state at ${craftStatePath(root, feature)} — run craft before starting a post-craft audit cycle.`);
	}
	// D4: a new cycle atomically clears any prior cycle's auditValidated marker (JSON.stringify drops
	// the undefined), so a stale marker can never remain re-citable across cycles — land's cycle-aware
	// evidence check (validateLandAuditEvidence) relies on this.
	const next: CraftState = { ...existing, auditCycle, runLogAtCycleStart, auditValidated: undefined };
	const stamped = persist(next);
	if (activeCraft && activeCraft.feature === feature && (activeCraft.worktreeRoot ?? activeCraft.projectRoot) === root) {
		activeCraft = stamped;
	}
	return stamped;
}

/**
 * Record durable evidence that `lsc_audit_validate` succeeded for `cycle` with `verdict` (B-1
 * follow-up, review NEEDS-FIX MEDIUM) — same "exact root, no active-craft singleton required"
 * discipline as `recordAuditCycleBegin` above (post-craft typically has no active craft in
 * session at all by the time it validates). Fails closed (throws) when no persisted state exists
 * — mirrors `recordAuditCycleBegin`'s own precondition.
 *
 * NON-AUTHORITATIVE trace (A/D4): this marker is best-effort EVIDENCE, never a land gate on its own.
 * lsc_land re-derives the verdict + cycle-freshness from disk independently every call
 * (validateLandAuditEvidence) and treats this marker only as a cycle-aware consistency cross-check
 * (a current-cycle verdict mismatch, or a future-cycle marker, is evidence-tamper). recordAuditCycleBegin
 * clears it atomically when a new cycle begins, so it can never be re-cited across cycles.
 */
export function recordAuditValidated(root: string, feature: string, cycle: number, verdict: string, at: string): CraftState {
	const existing = readPersistedCraftState(root, feature);
	if (!existing) {
		throw new Error(`lets-craft: no persisted craft state at ${craftStatePath(root, feature)} — cannot record audit validation.`);
	}
	const next: CraftState = { ...existing, auditValidated: { cycle, verdict, at } };
	const stamped = persist(next);
	if (activeCraft && activeCraft.feature === feature && (activeCraft.worktreeRoot ?? activeCraft.projectRoot) === root) {
		activeCraft = stamped;
	}
	return stamped;
}

/**
 * Exact-root release-approval writer (A land path, CS4). Reads the feature's persisted state at the
 * EXACT `root` (never the active-craft singleton, never candidate guessing), verifies the persisted
 * feature/projectRoot/worktreeRoot all match `identity` (anchor cross-check — a mismatch fails
 * closed), then stamps the durable release-approval evidence via persist (writeFileAtomicSync +
 * stateVersion, persist-before-install P7). Throws on absent/mismatched state or a write failure so
 * the caller (ask.ts) installs no live capability. Keeps the in-memory singleton in sync only when
 * it happens to already be this exact craft.
 */
export function recordReleaseApprovalAt(root: string, identity: ApprovalCraftIdentity, evidence: ReleaseApprovalEvidence): CraftState {
	const existing = readPersistedCraftState(root, identity.feature);
	if (!existing) {
		throw new Error(`lets-craft: no persisted craft state at ${craftStatePath(root, identity.feature)} — cannot record a release approval.`);
	}
	if (existing.feature !== identity.feature || existing.projectRoot !== identity.projectRoot || existing.worktreeRoot !== identity.worktreeRoot) {
		throw new Error(
			`lets-craft: persisted craft state at ${craftStatePath(root, identity.feature)} does not match the approval identity ` +
				"(feature/projectRoot/worktreeRoot) — refusing to record a release approval against mismatched evidence.",
		);
	}
	const stamped = persist({ ...existing, releaseApproval: evidence });
	if (activeCraft && activeCraft.feature === identity.feature && (activeCraft.worktreeRoot ?? activeCraft.projectRoot) === root) {
		activeCraft = stamped;
	}
	return stamped;
}

/**
 * Read a feature's persisted craft state at an EXACT root (CS4) — no candidate guessing. Never
 * touches the active-craft singleton (unlike loadActiveCraft), so a gate/reader can inspect
 * last-recorded state without resurrecting a cleared craft. Used by lsc_craft_init's re-baseline.
 */
export function readPersistedCraftState(root: string, feature: string): CraftState | undefined {
	return decodeCraftState(craftStatePath(root, feature));
}

/**
 * A single root's craft-state descriptor — the shared candidate seam (E, AC10). It reports only
 * EXISTENCE (fs stat), never the parsed content: `stateFileExists` is `existsSync` on the state
 * file, `rootExists` is `existsSync` on the candidate root DIRECTORY. Deliberately JSON-free (lazy)
 * so a consumer that keys off directory existence (resolveAuditRoot) can never be diverted by a
 * malformed state file it never decodes — decode is each consumer's own, explicit call.
 */
export interface CraftStateCandidate {
	root: string;
	statePath: string;
	rootExists: boolean;
	stateFileExists: boolean;
}

/**
 * The two roots a feature's craft state can live at, in [cwd, worktree] order (E, AC10). persist()
 * writes to `worktreeRoot ?? projectRoot`, so both `cwd` and `worktreePath(cwd, feature)` are
 * candidates. Descriptor-only — it NEVER reads/parses the state file (an unparseable candidate
 * does not throw here); each consumer decodes only the candidates its own named policy needs.
 */
export function craftStateCandidates(cwd: string, feature: string): CraftStateCandidate[] {
	return [cwd, worktreePath(cwd, feature)].map(root => {
		const statePath = craftStatePath(root, feature);
		return { root, statePath, rootExists: existsSync(root), stateFileExists: existsSync(statePath) };
	});
}

/**
 * Inactive-lookup reader for run_tests' audit-evidence mode (CS4). Worktree-first simple
 * fallback: the worktree file wins when both candidates exist, otherwise the cwd file. Never
 * touches the active-craft singleton.
 */
export function findPersistedCraftState(cwd: string, feature: string): CraftState | undefined {
	const [cwdCandidate, worktreeCandidate] = craftStateCandidates(cwd, feature);
	const cwdState = cwdCandidate.stateFileExists ? decodeCraftState(cwdCandidate.statePath) : undefined;
	const worktreeState = worktreeCandidate.stateFileExists ? decodeCraftState(worktreeCandidate.statePath) : undefined;
	return worktreeState ?? cwdState;
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
