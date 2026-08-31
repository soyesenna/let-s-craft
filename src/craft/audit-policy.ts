// Audit-escalation policy SSOT (postcraft-14cycle-approval-failure PR-1).
//
// post-craft's audit cycle had no bound: the old `cycleWarn` in verdict.ts was a fail-open
// informational note. This module is the single source of truth for the periodic escalation
// interval (live 3 / fixture 2), the three canonical user dispositions, and the PURE policy
// that decides what `lsc_audit_begin` may do against a persisted CraftState's escalation
// ledger — shape/arithmetic/chain invariants are validated fail-closed (no auto-repair)
// BEFORE any cycle/threshold write, per the agreed precedence:
//
//   shape/산술·연쇄 invariant 검증 → valid terminal block → exact pending 재사용/소비
//   → history-derived schedule 판정.
//
// Everything here is pure (no fs, no env, no CLI flags): `registerAuditBeginTool` alone reads
// `detectFixturePath(name => pi.getFlag(name))` and injects the active interval; env/flag
// reads inside this module would make the policy untestable and split the interval authority.
//
// Durable records live in state.ts's optional v2 fields (auditEscalationPending /
// auditEscalations / nextAuditEscalationCycle / auditTerminalDisposition). Cap provenance is
// record-local (`intervalCycles` on every pending and decision) — there is deliberately NO
// separate top-level interval mirror, so a fixture↔live mode switch is detectable from the
// records themselves and rejected before any write.

/** The escalation interval for normal (live) runs: the gate first fires at candidate cycle 3, then every 3 cycles after a Continue. */
export const LIVE_AUDIT_ESCALATION_INTERVAL = 3;

/** The escalation interval for fixture-mode runs (E2E): the gate first fires at candidate cycle 2, then every 2 cycles after a Continue — mirrors pre-craft's [Consensus Escalation] fixture-shrink convention. */
export const FIXTURE_AUDIT_ESCALATION_INTERVAL = 2;

export type AuditEscalationInterval =
	| typeof LIVE_AUDIT_ESCALATION_INTERVAL
	| typeof FIXTURE_AUDIT_ESCALATION_INTERVAL;

/** True iff `value` is one of the two declared interval constants (a raw 1/4/7 is NOT an interval). */
export function isAuditEscalationInterval(value: unknown): value is AuditEscalationInterval {
	return value === LIVE_AUDIT_ESCALATION_INTERVAL || value === FIXTURE_AUDIT_ESCALATION_INTERVAL;
}

/** The active interval for a run: fixture mode shrinks the interval to 2, live runs use 3. */
export function auditEscalationInterval(fixtureMode: boolean): AuditEscalationInterval {
	return fixtureMode ? FIXTURE_AUDIT_ESCALATION_INTERVAL : LIVE_AUDIT_ESCALATION_INTERVAL;
}

// ---------------------------------------------------------------------------
// Canonical dispositions — load-bearing exact labels (fixture rules match them verbatim)
// ---------------------------------------------------------------------------

/** The three canonical [Audit Escalation] dispositions, in canonical order. The fixture E2E's selection rules match these labels verbatim — never reword. */
export const AUDIT_ESCALATION_DISPOSITIONS = ["Continue auditing", "Abort this craft", "Preserve branch and stop"] as const;

export type AuditEscalationDisposition = (typeof AUDIT_ESCALATION_DISPOSITIONS)[number];

/** True iff `value` is EXACTLY one of the three canonical disposition labels — no trimming (audit-0 RF-1): a whitespace-padded/blank/free answer is not a disposition and must never reach a durable TerminalDecision, whose disposition is compared raw downstream. */
export function isAuditEscalationDisposition(value: unknown): value is AuditEscalationDisposition {
	return typeof value === "string" && (AUDIT_ESCALATION_DISPOSITIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Durable record shapes (persisted inside CraftState by state.ts's writers)
// ---------------------------------------------------------------------------

/**
 * An open escalation gate. `dueCycle` is the actual candidate cycle the selection binds to;
 * `scheduledCycle` is the pre-existing threshold that fired the gate (the first interval, or
 * the latest Continue's nextDueCycle) — an overdue legacy state binds dueCycle to the current
 * candidate while scheduledCycle keeps the schedule's provenance.
 */
export interface AuditEscalationPending {
	feature: string;
	dueCycle: number;
	scheduledCycle: number;
	/** Cap provenance — required on every record; the first record's interval comes from the then-active interval and every later record inherits it. */
	intervalCycles: AuditEscalationInterval;
	createdAt: string;
}

/** A consumed gate whose disposition was "Continue auditing" — the schedule advances by `intervalCycles`. */
export interface ContinueDecision extends AuditEscalationPending {
	disposition: "Continue auditing";
	decidedAt: string;
	nextDueCycle: number;
}

/** A consumed gate whose disposition ended the run. Durable terminal record — begin and land refuse afterwards. */
export interface TerminalDecision extends AuditEscalationPending {
	disposition: "Abort this craft" | "Preserve branch and stop";
	decidedAt: string;
}

export type AuditEscalationDecision = ContinueDecision | TerminalDecision;

/**
 * The exact question a due gate asks (composed in TS, like land.ts's composeLandQuestion — the
 * skill asks it verbatim; any rewording breaks the fixture match). Ends in `continue?` per the
 * pipeline's question-tagging convention.
 */
export function composeAuditEscalationQuestion(feature: string, dueCycle: number, intervalCycles: AuditEscalationInterval): string {
	return (
		`[Audit Escalation] "${feature}"가 감사 사이클 ${dueCycle}회차에 도달했다 ` +
		`(주기 ${intervalCycles}회마다 재확인 — 이대로 audit를 계속 진행하겠는가)? continue?`
	);
}

// ---------------------------------------------------------------------------
// Pure gate evaluation
// ---------------------------------------------------------------------------

/** Why a begin call was refused. Every refusal happens BEFORE any cycle/threshold write. */
export type AuditBeginBlockedReason =
	| "invalid-state" // corrupt/forged/self-inconsistent escalation evidence or candidate↔marker gap
	| "terminal" // an Abort/Preserve decision durably ended this feature's audit loop
	| "stale-pending" // a pending exists but the candidate is not its exact due cycle
	| "no-pending-escalation" // a disposition arrived with no consumable pending gate (선제 disposition)
	| "invalid-disposition"; // the disposition label is not one of the three canonical labels

export type AuditBeginGateDecision =
	| { type: "proceed" }
	| { type: "replay" }
	| { type: "escalation-required"; pending: AuditEscalationPending; question: string }
	| { type: "consume-continue"; pending: AuditEscalationPending; decision: ContinueDecision }
	| { type: "consume-terminal"; pending: AuditEscalationPending; decision: TerminalDecision }
	| { type: "blocked"; reason: AuditBeginBlockedReason; message: string };

/** The persisted slice of CraftState the gate reads. Unknown-typed: validation is this module's job, not the caller's. */
export interface AuditBeginGatePersisted {
	auditCycle?: unknown;
	auditEscalationPending?: unknown;
	auditEscalations?: unknown;
	nextAuditEscalationCycle?: unknown;
	auditTerminalDisposition?: unknown;
}

export interface AuditBeginGateInput {
	feature: string;
	/** Artifact-derived next cycle number (latest audit-N.md max + 1). */
	candidateCycle: number;
	/** The interval injected by the registration wrapper for this run's mode. */
	activeInterval: AuditEscalationInterval;
	persisted: AuditBeginGatePersisted;
	/** The raw disposition label from the tool call, when the caller is answering an open gate. */
	disposition?: unknown;
	/** Injectable clock for createdAt/decidedAt (deterministic tests). */
	now?: () => Date;
}

function invalid(message: string): { type: "blocked"; reason: "invalid-state"; message: string } {
	return { type: "blocked", reason: "invalid-state", message };
}

function isSafeNonNegativeCycle(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True iff `value` round-trips through `Date#toISOString()` EXACTLY (audit-0 RF-13): the only
 * timestamp shape lets-craft persists, so a forged/localized/newline-carrying `createdAt`/
 * `decidedAt` — a field later interpolated verbatim into command-shaped tool text — is invalid
 * evidence rather than trusted prose.
 */
function isCanonicalIsoTimestamp(value: string): boolean {
	const parsed = new Date(value);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Parse one pending-shaped record. Returns a distinct invalid-state message per violated invariant. */
function parsePendingRecord(raw: unknown, feature: string, where: string): AuditEscalationPending | { error: string } {
	if (!isPlainObject(raw)) return { error: `${where}: not an object` };
	const { feature: recordFeature, dueCycle, scheduledCycle, intervalCycles } = raw;
	if (recordFeature !== feature) return { error: `${where}: feature "${String(recordFeature)}" does not match the current feature "${feature}"` };
	if (!isSafeNonNegativeCycle(dueCycle)) return { error: `${where}: dueCycle is not a non-negative safe integer (${String(dueCycle)})` };
	if (!isSafeNonNegativeCycle(scheduledCycle)) return { error: `${where}: scheduledCycle is not a non-negative safe integer (${String(scheduledCycle)})` };
	if (!isAuditEscalationInterval(intervalCycles)) return { error: `${where}: intervalCycles is not a declared escalation interval (${String(intervalCycles)})` };
	if (typeof raw.createdAt !== "string" || !isCanonicalIsoTimestamp(raw.createdAt)) return { error: `${where}: createdAt is not a canonical ISO-8601 timestamp (${JSON.stringify(raw.createdAt)}) — every record lets-craft persists is Date#toISOString()-shaped` };
	if (dueCycle < scheduledCycle) return { error: `${where}: dueCycle (${dueCycle}) precedes scheduledCycle (${scheduledCycle})` };
	return { feature, dueCycle, scheduledCycle, intervalCycles, createdAt: raw.createdAt };
}

type ParsedDecision = AuditEscalationDecision;

function parseDecisionRecord(raw: unknown, feature: string, where: string): ParsedDecision | { error: string } {
	if (!isPlainObject(raw)) return { error: `${where}: not an object` };
	const pending = parsePendingRecord(raw, feature, where);
	if ("error" in pending) return pending;
	const { disposition, decidedAt } = raw;
	if (typeof decidedAt !== "string" || !isCanonicalIsoTimestamp(decidedAt)) return { error: `${where}: decidedAt is not a canonical ISO-8601 timestamp (${JSON.stringify(decidedAt)}) — every record lets-craft persists is Date#toISOString()-shaped` };
	if (disposition === "Continue auditing") {
		const { nextDueCycle } = raw;
		if (!isSafeNonNegativeCycle(nextDueCycle)) return { error: `${where}: nextDueCycle is not a non-negative safe integer (${String(nextDueCycle)})` };
		const expected = pending.dueCycle + pending.intervalCycles;
		if (nextDueCycle !== expected || !Number.isSafeInteger(expected)) {
			return { error: `${where}: Continue nextDueCycle (${String(nextDueCycle)}) is not dueCycle + intervalCycles (${pending.dueCycle} + ${pending.intervalCycles})` };
		}
		return { ...pending, disposition, decidedAt, nextDueCycle };
	}
	if (disposition === "Abort this craft" || disposition === "Preserve branch and stop") {
		return { ...pending, disposition, decidedAt };
	}
	// audit-1 RF-20(b): an invalid value is echoed ESCAPED (JSON.stringify), never raw — control
	// characters in a forged disposition must not reshape this diagnostic as it flows to tool text.
	return { error: `${where}: disposition ${JSON.stringify(disposition)} is not a canonical escalation label` };
}

/**
 * audit-1 RF-20(c) — runtime-parse a persisted terminal record before ANY of its fields are
 * interpolated into result text (land.ts's terminal-disposition refusal): the persisted state
 * file is untrusted bytes, so the canonical label, canonical ISO-8601 timestamp, and
 * non-negative safe-integer cycle are re-verified here rather than trusted from the decode cast
 * (which also guarantees control-char freedom — the canonical labels carry none, and a
 * `Date#toISOString()` round-trip cannot). Undefined = not canonical → the caller emits a
 * constant diagnostic, never the raw record.
 */
export interface TerminalDispositionSummary {
	disposition: Exclude<AuditEscalationDisposition, "Continue auditing">;
	dueCycle: number;
	decidedAt: string;
}

export function parseTerminalDispositionSummary(raw: unknown): TerminalDispositionSummary | undefined {
	if (!isPlainObject(raw)) return undefined;
	const { disposition, dueCycle, decidedAt } = raw;
	if (disposition !== "Abort this craft" && disposition !== "Preserve branch and stop") return undefined;
	if (!isSafeNonNegativeCycle(dueCycle)) return undefined;
	if (typeof decidedAt !== "string" || !isCanonicalIsoTimestamp(decidedAt)) return undefined;
	return { disposition, dueCycle, decidedAt };
}

/** The validated escalation ledger the gate's later stages consume. */
export interface ValidatedEscalationLedger {
	/** True when no escalation field exists at all — a legacy v2 state that may bootstrap with the active interval. */
	legacy: boolean;
	pending?: AuditEscalationPending;
	history: AuditEscalationDecision[];
	terminal?: TerminalDecision;
	/** The persisted interval (all records agree on it); equals the active interval for a legacy state. */
	interval: AuditEscalationInterval;
	/** The schedule's next due cycle: the first threshold for a legacy/never-continued ledger, else the latest Continue's nextDueCycle. */
	nextDue: number;
}

/**
 * Validate the persisted escalation ledger: shape/arithmetic/chain invariants (a)–(h), the
 * mirror/conflict rules, the fixture↔live mode-switch rejection, and the candidate↔auditCycle
 * coupling (i) + `dueCycle <= auditCycle + 1` — fail-closed, never auto-repairing.
 */
export function validateEscalationLedger(
	feature: string,
	activeInterval: AuditEscalationInterval,
	persisted: AuditBeginGatePersisted,
): ValidatedEscalationLedger | { error: string } {
	const hasPending = persisted.auditEscalationPending !== undefined;
	const hasHistory = persisted.auditEscalations !== undefined;
	const hasNextDue = persisted.nextAuditEscalationCycle !== undefined;
	const hasTerminal = persisted.auditTerminalDisposition !== undefined;
	const legacy = !hasPending && !hasHistory && !hasNextDue && !hasTerminal;
	if (legacy) return { legacy: true, history: [], interval: activeInterval, nextDue: activeInterval };
	// -- history shape + per-record invariants ------------------------------------------------
	const historyRaw = persisted.auditEscalations;
	if (historyRaw !== undefined && !Array.isArray(historyRaw)) return { error: `auditEscalations is not an array` };
	const history: AuditEscalationDecision[] = [];
	let prevDue = -1;
	const historyRecords = (historyRaw ?? []) as unknown[];
	for (let i = 0; i < historyRecords.length; i++) {
		const parsed = parseDecisionRecord(historyRecords[i], feature, `auditEscalations[${i}]`);
		if ("error" in parsed) return { error: parsed.error };
		// history key is dueCycle: strictly increasing → unique.
		if (parsed.dueCycle <= prevDue) {
			return { error: `auditEscalations[${i}]: dueCycle ${parsed.dueCycle} does not strictly increase (previous ${prevDue}) — duplicate/rewound history key` };
		}
		prevDue = parsed.dueCycle;
		// (d) every record after the first chains to the immediately preceding Continue's nextDueCycle.
		if (i === 0) {
			// (c) the first record's scheduledCycle is the first threshold == its own interval.
			if (parsed.scheduledCycle !== parsed.intervalCycles) {
				return { error: `auditEscalations[0]: scheduledCycle ${parsed.scheduledCycle} is not the first threshold (interval ${parsed.intervalCycles})` };
			}
		} else {
			const prev = history[i - 1];
			if (prev.disposition !== "Continue auditing" || prev.nextDueCycle !== parsed.scheduledCycle) {
				return { error: `auditEscalations[${i}]: scheduledCycle ${parsed.scheduledCycle} does not chain to the previous Continue's nextDueCycle (${prev.disposition === "Continue auditing" ? String(prev.nextDueCycle) : "n/a — previous record is terminal"})` };
			}
		}
		history.push(parsed);
	}

	// (c) every record carries the SAME persisted interval.
	const interval = history[0]?.intervalCycles ?? (isPlainObject(persisted.auditEscalationPending) && isAuditEscalationInterval(persisted.auditEscalationPending.intervalCycles) ? persisted.auditEscalationPending.intervalCycles : undefined);
	if (interval === undefined) {
		return { error: `no escalation record carries a valid intervalCycles — cannot determine the persisted interval` };
	}
	for (let i = 0; i < history.length; i++) {
		if (history[i].intervalCycles !== interval) {
			return { error: `auditEscalations[${i}]: intervalCycles ${history[i].intervalCycles} differs from the persisted interval ${interval} — mixed-interval evidence` };
		}
	}

	// Mode switch: persisted interval vs the run's active interval — no fixture↔live resume.
	if (interval !== activeInterval) {
		return { error: `persisted escalation interval ${interval} does not match the active interval ${activeInterval} — fixture↔live mode switch is not supported; refuse instead of writing under a mixed ledger` };
	}

	// -- terminal position/mirror (g) ----------------------------------------------------------
	const lastRecord = history[history.length - 1];
	const terminalInHistory = history.find((record): record is TerminalDecision => record.disposition !== "Continue auditing");
	if (terminalInHistory && terminalInHistory !== lastRecord) {
		return { error: `a terminal decision exists but is not the last history record — records after a terminal are forged evidence` };
	}
	if (hasTerminal) {
		if (!terminalInHistory) return { error: `auditTerminalDisposition is set but no terminal decision exists in the history — mirror without its record` };
		const parsedMirror = parseDecisionRecord(persisted.auditTerminalDisposition, feature, "auditTerminalDisposition");
		if ("error" in parsedMirror) return { error: parsedMirror.error };
		if (parsedMirror.disposition === "Continue auditing") {
			return { error: `auditTerminalDisposition: disposition "Continue auditing" is not a terminal label` };
		}
		const { feature: _f, dueCycle, scheduledCycle, intervalCycles, createdAt, disposition, decidedAt } = parsedMirror;
		if (
			terminalInHistory.disposition !== disposition ||
			terminalInHistory.dueCycle !== dueCycle ||
			terminalInHistory.scheduledCycle !== scheduledCycle ||
			terminalInHistory.intervalCycles !== intervalCycles ||
			terminalInHistory.createdAt !== createdAt ||
			terminalInHistory.decidedAt !== decidedAt
		) {
			return { error: `auditTerminalDisposition does not exactly mirror the history's terminal decision` };
		}
	} else if (terminalInHistory) {
		return { error: `a terminal decision exists in the history but the top-level auditTerminalDisposition mirror is missing` };
	}

	// -- pending (h) + conflicts -----------------------------------------------------------------
	let pending: AuditEscalationPending | undefined;
	if (hasPending) {
		const parsedPending = parsePendingRecord(persisted.auditEscalationPending, feature, "auditEscalationPending");
		if ("error" in parsedPending) return { error: parsedPending.error };
		// (c) for the pending too (audit-0 RF-2): every record — history AND the open gate — carries
		// the SAME persisted interval. With history present the interval comes from history[0], so a
		// forged pending under a different interval is mixed-interval evidence, not a schedule.
		if (parsedPending.intervalCycles !== interval) {
			return { error: `auditEscalationPending.intervalCycles ${parsedPending.intervalCycles} differs from the persisted interval ${interval} — mixed-interval evidence` };
		}
		if (terminalInHistory) return { error: `auditEscalationPending is set after a terminal decision — no gate may open on a terminated feature` };
		// Conflict: a pending PLUS a same-(feature,dueCycle) decision is a same-key fork.
		if (history.some(record => record.dueCycle === parsedPending.dueCycle)) {
			return { error: `auditEscalationPending (dueCycle ${parsedPending.dueCycle}) conflicts with an existing decision at the same dueCycle` };
		}
		// (h) pending.scheduledCycle chains to the first threshold (no history) or the latest Continue's nextDueCycle.
		const lastContinue = [...history].reverse().find((record): record is ContinueDecision => record.disposition === "Continue auditing");
		const expectedScheduled = lastContinue ? lastContinue.nextDueCycle : interval;
		if (parsedPending.scheduledCycle !== expectedScheduled) {
			return { error: `auditEscalationPending.scheduledCycle ${parsedPending.scheduledCycle} does not match the schedule threshold ${expectedScheduled} (${lastContinue ? "latest Continue's nextDueCycle" : "first threshold"})` };
		}
		pending = parsedPending;
	}

	// -- top-level next-due mirror ---------------------------------------------------------------
	const lastContinue = [...history].reverse().find((record): record is ContinueDecision => record.disposition === "Continue auditing");
	const expectedMirror = lastContinue ? lastContinue.nextDueCycle : undefined;
	const persistedNextDue = persisted.nextAuditEscalationCycle;
	if (expectedMirror === undefined) {
		if (hasNextDue && persistedNextDue !== undefined) {
			return { error: `nextAuditEscalationCycle is set (${String(persistedNextDue)}) but no Continue decision exists to mirror` };
		}
	} else {
		if (!isSafeNonNegativeCycle(persistedNextDue) || persistedNextDue !== expectedMirror) {
			return { error: `nextAuditEscalationCycle (${String(persistedNextDue)}) is not the exact mirror of the latest Continue's nextDueCycle (${expectedMirror})` };
		}
	}

	return {
		legacy: false,
		pending,
		history,
		terminal: terminalInHistory,
		interval,
		nextDue: expectedMirror ?? interval,
	};
}

/**
 * The pure `lsc_audit_begin` gate: validates the ledger fail-closed, then applies the agreed
 * precedence (terminal block → exact pending reuse/consume → history-derived schedule). The
 * caller turns each branch into the durable state write (state.ts's applyAuditBeginOutcome)
 * and the tool result — this function itself never touches the filesystem.
 */
export function evaluateAuditBeginGate(input: AuditBeginGateInput): AuditBeginGateDecision {
	const { feature, candidateCycle, activeInterval, persisted, disposition } = input;
	const now = (input.now ?? (() => new Date()))();

	// (i) artifact-derived candidate must be a safe non-negative cycle.
	if (!isSafeNonNegativeCycle(candidateCycle)) {
		return invalid(`candidateCycle ${String(candidateCycle)} is not a non-negative safe integer`);
	}

	const persistedAuditCycle = persisted.auditCycle;
	if (persistedAuditCycle !== undefined && !isSafeNonNegativeCycle(persistedAuditCycle)) {
		return invalid(`persisted auditCycle ${String(persistedAuditCycle)} is not a non-negative safe integer`);
	}

	// Shape/arithmetic/chain invariant validation — BEFORE any write.
	const ledger = validateEscalationLedger(feature, activeInterval, persisted);
	if ("error" in ledger) return invalid(ledger.error);

	// (i) coupling + the integrated future-due chain block: candidate must be exactly the
	// persisted marker (idempotent replay) or marker+1 (a new cycle), and every record's
	// dueCycle must stay at or below marker+1 (an arithmetic self-consistency check alone
	// cannot forge a schedule the marker does not anchor).
	if (persistedAuditCycle !== undefined) {
		for (const record of [...ledger.history, ...(ledger.pending ? [ledger.pending] : [])]) {
			if (record.dueCycle > persistedAuditCycle + 1) {
				return invalid(`${record === ledger.pending ? "pending" : "decision"} at dueCycle ${record.dueCycle} exceeds auditCycle+1 (${persistedAuditCycle + 1}) — a future-due chain the persisted cycle marker does not anchor`);
			}
		}
		if (candidateCycle !== persistedAuditCycle && candidateCycle !== persistedAuditCycle + 1) {
			return invalid(
				`candidateCycle ${candidateCycle} is neither the persisted auditCycle ${persistedAuditCycle} (idempotent replay) nor auditCycle+1 (${persistedAuditCycle + 1}) — ` +
					(candidateCycle < persistedAuditCycle ? "a backward gap (completed audit artifacts were removed)" : "a forward gap (audit numbering jumped)"),
			);
		}
	}

	// Valid terminal block — every candidate on a terminated feature is refused.
	if (ledger.terminal) {
		return {
			type: "blocked",
			reason: "terminal",
			message: `an escalation disposition "${ledger.terminal.disposition}" durably ended this feature's audit loop at cycle ${ledger.terminal.dueCycle} (${ledger.terminal.decidedAt}) — no further audit cycle may begin.`,
		};
	}

	if (ledger.pending) {
		const pending = ledger.pending;
		// audit-0 RF-3: a naturally-opened gate is always marker+1 (the gate opens at candidate
		// marker+1 and never writes the marker itself), so with a persisted auditCycle an open
		// pending at any other dueCycle — including dueCycle === auditCycle, which would otherwise
		// let an equality candidate CONSUME a gate instead of replaying — is forged state.
		if (persistedAuditCycle !== undefined && pending.dueCycle !== persistedAuditCycle + 1) {
			return invalid(
				`an open escalation gate is bound to dueCycle ${pending.dueCycle} but the persisted auditCycle is ${persistedAuditCycle} — a naturally-opened gate is always auditCycle+1; an equality candidate can only be an idempotent replay, never a consumption`,
			);
		}
		if (candidateCycle !== pending.dueCycle) {
			return {
				type: "blocked",
				reason: "stale-pending",
				message: `an open escalation gate is bound to dueCycle ${pending.dueCycle} but this call's candidate is ${candidateCycle} — a stale pending is never replaced; resolve the open gate at its own cycle.`,
			};
		}
		if (disposition === undefined) {
			// Idempotent re-ask: the SAME pending (byte-stable createdAt) and question come back.
			return { type: "escalation-required", pending, question: composeAuditEscalationQuestion(feature, pending.dueCycle, pending.intervalCycles) };
		}
		if (!isAuditEscalationDisposition(disposition)) {
			return {
				type: "blocked",
				reason: "invalid-disposition",
				// audit-1 RF-20(b): escaped echo (JSON.stringify) — a forged control-carrying
				// disposition never reshapes the refusal text it appears in.
				message: `escalation_disposition ${JSON.stringify(disposition)} is not one of the canonical labels ${AUDIT_ESCALATION_DISPOSITIONS.join(" / ")} — a free answer or blank is never consumed.`,
			};
		}
		if (disposition === "Continue auditing") {
			const decidedAt = now.toISOString();
			const decision: ContinueDecision = { ...pending, disposition, decidedAt, nextDueCycle: pending.dueCycle + pending.intervalCycles };
			return { type: "consume-continue", pending, decision };
		}
		const decidedAt = now.toISOString();
		const decision: TerminalDecision = { ...pending, disposition, decidedAt };
		return { type: "consume-terminal", pending, decision };
	}

	// A disposition with no consumable pending gate is a protocol error — never consumed.
	if (disposition !== undefined) {
		if (!isAuditEscalationDisposition(disposition)) {
			return {
				type: "blocked",
				reason: "invalid-disposition",
				// audit-1 RF-20(b): escaped echo — same no-raw-payload rule as the pending branch above.
				message: `escalation_disposition ${JSON.stringify(disposition)} is not one of the canonical labels ${AUDIT_ESCALATION_DISPOSITIONS.join(" / ")}.`,
			};
		}
		return {
			type: "blocked",
			reason: "no-pending-escalation",
			message: `escalation_disposition "${disposition}" arrived with no open escalation gate (candidate ${candidateCycle} is not a due cycle) — a 선제 disposition is never consumed; re-call lsc_audit_begin without it.`,
		};
	}

	// History-derived schedule: an already-begun cycle replays idempotently; a candidate at or
	// past the next due cycle opens the gate (an overdue legacy state binds to the CURRENT
	// candidate); anything below it proceeds.
	if (persistedAuditCycle !== undefined && candidateCycle === persistedAuditCycle) {
		return { type: "replay" };
	}
	if (candidateCycle >= ledger.nextDue) {
		const pending: AuditEscalationPending = {
			feature,
			dueCycle: candidateCycle,
			scheduledCycle: ledger.nextDue,
			intervalCycles: ledger.interval,
			createdAt: now.toISOString(),
		};
		return { type: "escalation-required", pending, question: composeAuditEscalationQuestion(feature, pending.dueCycle, pending.intervalCycles) };
	}
	return { type: "proceed" };
}
