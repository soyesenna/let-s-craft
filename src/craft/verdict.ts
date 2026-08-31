// B-1: machine verification for post-craft's audit verdict vocabulary. Until now the four-value
// `**AUDIT VERDICT: ...**` vocabulary (skills/post-craft/SKILL.md §4.1 point 2) existed only in a
// test-only regex (test/e2e-full-cycle.test.ts) and the statusbar's own best-effort parser
// (src/statusbar/craft-progress.ts) — nothing in the runtime actually VALIDATES a verdict before
// land. This module is that validation: exact-literal verdict parsing (shared, generically, with
// lsc-critic's own independent 5-value scale — agents/lsc-critic.md), plus the cycle-freshness
// check that is this feature's actual highest-value piece: an APPROVE-family verdict must be
// backed by a passing test run from AFTER the current audit cycle began, so a stale green log
// left over from before an AWC fix-verification cycle can never be re-cited to fake a fresh pass.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runGitText } from "../utils/git.js";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { FEATURE_SLUG_RE, craftAuditDir, craftAuditPath, craftCheckLogsDir, craftStatePath, resolveFeatureName } from "../artifacts/paths.js";
import { detectFixturePath } from "../fixtures.js";
import {
	AUDIT_ESCALATION_DISPOSITIONS,
	type AuditEscalationInterval,
	LIVE_AUDIT_ESCALATION_INTERVAL,
	auditEscalationInterval,
	evaluateAuditBeginGate,
} from "./audit-policy.js";
import { invalidatePendingApproval, invalidatePreparedOperation } from "./destructive-approval.js";
import { type AuditBaseSnapshot, type CraftState, applyAuditBeginOutcome, craftStateCandidates, readPersistedCraftState, recordAuditValidated } from "./state.js";
import { controlCharRefusalText } from "./tool-text.js";

// ---------------------------------------------------------------------------
// Verdict vocabularies + generic literal-only parser
// ---------------------------------------------------------------------------

/** post-craft's own four-level audit judgment (skills/post-craft/SKILL.md §4.1 point 2, C25). */
export const AUDIT_VERDICTS = ["APPROVE", "APPROVE-WITH-COMMENT", "APPROVE-WITH-CHANGE", "REJECT"] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

/**
 * lsc-critic's own independent five-level scale (agents/lsc-critic.md Output_Format) — a
 * DIFFERENT, agent-scoped vocabulary that merely shares two token spellings
 * ("APPROVE-WITH-CHANGE", "REJECT") with AUDIT_VERDICTS. lsc-critic renders this scale in
 * pre-craft Stage 3's plan-review consensus loop (skills/pre-craft/SKILL.md), a wholly separate
 * document from post-craft's own `**AUDIT VERDICT:` line. Parsed by the same generic
 * `parseVerdictLine` below under a distinct line prefix, so the two never collide even when both
 * lines happen to appear in the same document.
 */
export const CRITIC_VERDICTS = ["REJECT", "REVISE", "APPROVE-WITH-CHANGE", "ACCEPT-WITH-RESERVATIONS", "ACCEPT"] as const;
export type CriticVerdict = (typeof CRITIC_VERDICTS)[number];

/** Verdicts that are land-eligible per skills/post-craft/SKILL.md §7.1 — the only two this module's freshness check ever gates. */
const APPROVE_FAMILY_VERDICTS: readonly AuditVerdict[] = ["APPROVE", "APPROVE-WITH-COMMENT"];

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse a `**{prefix}: X**` line-start bold marker, matching X against `allowedValues` by EXACT
 * literal equality only — a near-miss (a plural, a lowercase variant, any other unrecognized
 * word) or a missing line both fall back to undefined, never a throw and never a fuzzy match.
 * Generic over the allowed vocabulary (and the line prefix) so both AUDIT_VERDICTS and
 * CRITIC_VERDICTS share this one implementation rather than two near-duplicate regexes.
 */
export function parseVerdictLine<T extends string>(markdown: string, prefix: string, allowedValues: readonly T[]): T | undefined {
	const pattern = new RegExp(`^\\*\\*${escapeRegExp(prefix)}:\\s*([A-Z-]+)\\*\\*`, "m");
	const raw = pattern.exec(markdown)?.[1];
	return allowedValues.find(value => value === raw);
}

/**
 * Parse post-craft's own `**AUDIT VERDICT: ...**` line (skills/post-craft/SKILL.md §4.1 point 2).
 * This is the CANONICAL implementation — src/statusbar/craft-progress.ts re-exports this same
 * function rather than keeping its own duplicate (that duplicate predates this module, QW7).
 */
export function parseAuditVerdict(markdown: string): AuditVerdict | undefined {
	return parseVerdictLine(markdown, "AUDIT VERDICT", AUDIT_VERDICTS);
}

/**
 * Parse lsc-critic's own `**VERDICT: ...**` line (agents/lsc-critic.md Output_Format). Not
 * currently consumed by any runtime tool (lsc-critic's report is read by the main session as
 * prose, not by TypeScript) — provided so the shared generic parser actually covers both
 * vocabularies it was designed for, and so that coverage is directly testable.
 */
export function parseCriticVerdict(markdown: string): CriticVerdict | undefined {
	return parseVerdictLine(markdown, "VERDICT", CRITIC_VERDICTS);
}

// ---------------------------------------------------------------------------
// check-N.log / audit-N.md filename numbering (promoted from statusbar/craft-progress.ts, QW7)
// ---------------------------------------------------------------------------

/** Highest `check-N.log` index among the given filenames; 0 when none match (no check run yet). */
export function latestCheckNumber(fileNames: readonly string[]): number {
	const numbers = fileNames
		.map(name => /^check-(\d+)\.log$/.exec(name)?.[1])
		.filter((n): n is string => n !== undefined)
		.map(Number);
	return numbers.length === 0 ? 0 : Math.max(...numbers);
}

/** Highest `audit-N.md` index among the given filenames, or undefined when none match. */
export function latestAuditNumber(fileNames: readonly string[]): number | undefined {
	const numbers = fileNames
		.map(name => /^audit-(\d+)\.md$/.exec(name)?.[1])
		.filter((n): n is string => n !== undefined)
		.map(Number);
	return numbers.length === 0 ? undefined : Math.max(...numbers);
}

// ---------------------------------------------------------------------------
// Cycle-freshness (this feature's core value)
// ---------------------------------------------------------------------------

/** True iff a check-N.log transcript (src/craft/run-check.ts's `runFeatureCheck` format) records a clean pass — a bare `--- exit 0 ---` line, never the `(killed)` variant. */
export function isPassingCheckLog(logContent: string): boolean {
	return /^--- exit 0 ---$/m.test(logContent);
}

export interface CheckLogSummary {
	/** The check-N.log's numeric suffix. */
	number: number;
	/** Whether that specific run recorded a clean pass (isPassingCheckLog). */
	passed: boolean;
}

export interface AuditFreshnessCheck {
	ok: boolean;
	/** Present only when ok is false — a stable machine-readable reason, distinct from the human-facing tool message. */
	reason?: "stale-log" | "no-passing-log";
}

/**
 * Cycle-freshness check (B-1's core value): an APPROVE-family verdict (APPROVE /
 * APPROVE-WITH-COMMENT — the only two verdicts land-eligible per skills/post-craft/SKILL.md
 * §7.1) must be backed by a passing check-N.log whose number is STRICTLY GREATER than
 * `checkLogAtCycleStart` (the freshness threshold `lsc_audit_begin` records at cycle start) —
 * never a stale green log left over from before this audit cycle began. This closes exactly the
 * gap an AWC fix-verification cycle could otherwise exploit: citing an old passing run instead of
 * actually re-running tests against the fix.
 *
 * REJECT and APPROVE-WITH-CHANGE are exempt (`{ ok: true }` unconditionally) — neither is ever
 * land-eligible on its own (APPROVE-WITH-CHANGE always requires a further fix-verification cycle
 * first, §7.1), so a freshness violation on either would never actually gate a merge; checking
 * them would just be noise.
 *
 * `checkLogAtCycleStart === undefined` (a craft state persisted before this field existed, or a
 * craft whose post-craft cycle never called `lsc_audit_begin`) is ALSO treated tolerantly — `{
 * ok: true }` — rather than fail-closed: there is no recorded threshold to check freshness
 * against, and refusing every such craft's audit outright would be a hard regression for state
 * predating this feature. This is a deliberate, documented scope cut, not an oversight — the
 * merge-block wiring this validates for (skills/post-craft/SKILL.md §7.1) still requires
 * `lsc_audit_begin` to have actually been called for the freshness half of the guarantee to
 * apply; without it, `lsc_audit_validate` still enforces exact-literal verdict parsing, just not
 * cycle-freshness.
 */
export function validateAuditFreshness(verdict: AuditVerdict, checkLogAtCycleStart: number | undefined, logs: readonly CheckLogSummary[]): AuditFreshnessCheck {
	if (!APPROVE_FAMILY_VERDICTS.includes(verdict)) return { ok: true };
	if (checkLogAtCycleStart === undefined) return { ok: true };
	const fresh = logs.filter(log => log.number > checkLogAtCycleStart);
	if (fresh.length === 0) return { ok: false, reason: "stale-log" };
	return fresh.some(log => log.passed) ? { ok: true } : { ok: false, reason: "no-passing-log" };
}

// ---------------------------------------------------------------------------
// Tool wrappers — `lsc_audit_begin` / `lsc_audit_validate` (thin, per this project's registerTool
// convention: pure logic above, FS reads + registerTool glue below).
// ---------------------------------------------------------------------------

/**
 * Resolve the root to read/write a feature's audit artifacts against: the worktree when its
 * DIRECTORY exists (C6/R5's "always worktree" convention — post-craft's own artifact root,
 * SKILL.md §2.2), else the project root as the pre-R5/escape-hatch fallback. Named policy:
 * DIRECTORY-EXISTENCE only — it keys off the worktree candidate's `rootExists` and NEVER decodes a
 * state file, so a malformed `.craft-state.json` can never divert audit resolution (a DIFFERENT
 * authority than findPersistedCraftState's open-release arbitration, which is the decode owner).
 * Both consumers share only the descriptor seam (craftStateCandidates); the selection policy is
 * each consumer's own. post-craft never holds an active craft (SKILL.md §1.5, it deliberately never
 * calls lsc_craft_init), so unlike lsc_run_check there is no active-craft worktreeRoot available
 * to consult here.
 */
function resolveAuditRoot(cwd: string, feature: string): string {
	const [, worktreeCandidate] = craftStateCandidates(cwd, feature);
	return worktreeCandidate.rootExists ? worktreeCandidate.root : cwd;
}

/**
 * List every check-N.log's pass/fail summary under `logsDir`. Each individual read is wrapped in
 * try/catch (review LOW-1, TOCTOU): a file `readdirSync` just listed can still vanish (or become
 * unreadable) before this loop gets to it — that log is simply dropped from the result (unusable
 * evidence) rather than crashing the whole `lsc_audit_validate` call with an uncaught exception.
 */
function readCheckLogSummaries(logsDir: string): CheckLogSummary[] {
	if (!existsSync(logsDir)) return [];
	const summaries: CheckLogSummary[] = [];
	for (const name of readdirSync(logsDir)) {
		const numberStr = /^check-(\d+)\.log$/.exec(name)?.[1];
		if (numberStr === undefined) continue;
		try {
			const content = readFileSync(join(logsDir, name), "utf8");
			summaries.push({ number: Number(numberStr), passed: isPassingCheckLog(content) });
		} catch {
			// TOCTOU: dropped, not fatal — see doc comment above.
		}
	}
	return summaries;
}

// ---------------------------------------------------------------------------
// Land-time strict audit re-validation (A — read-only extraction, D4). Unlike validateAuditFreshness
// (which is undefined-TOLERANT — a missing threshold degrades to a pass so pre-B-1 state still
// audits), this is undefined-INTOLERANT by design: land is the highest-value gate, so a missing
// cycle/threshold/fresh-pass is a HARD refusal (missing-threshold fail-open is exactly the hole land
// closes). The persisted auditValidated marker is treated as best-effort EVIDENCE (cycle-aware), not
// authority — land re-derives the verdict + freshness from disk on every call.
// ---------------------------------------------------------------------------

export type LandAuditReason = "no-audit-evidence" | "no-audit-cycle" | "cycle-mismatch" | "verdict-not-approve" | "stale-check-log" | "evidence-tamper";

export type LandAuditResult = { ok: true; verdict: AuditVerdict; auditNumber: number } | { ok: false; reason: LandAuditReason };

/** Verdicts land's strict evidence check accepts — every APPROVE-prefixed verdict; only REJECT is verdict-not-approve. */
const LAND_ACCEPTED_VERDICTS: readonly AuditVerdict[] = ["APPROVE", "APPROVE-WITH-COMMENT", "APPROVE-WITH-CHANGE"];

/**
 * Strict, read-only land-time audit re-validation (spec AC1). Reads the latest audit-N.md verdict +
 * the persisted cycle markers + the check-N.log freshness under `root`, and folds any failure to a
 * distinct reason code (checked in order): no-audit-evidence → no-audit-cycle (missing/non-integer
 * cycle OR threshold) → cycle-mismatch (auditCycle !== latest audit N) → verdict-not-approve (REJECT
 * or unparseable) → stale-check-log (no passing check-N.log with N strictly > threshold) → evidence-tamper
 * (auditValidated marker for the current cycle with a DIFFERENT verdict, or for a FUTURE cycle). An
 * absent or previous-cycle marker is a WARN (pass) — never a block.
 */
export function validateLandAuditEvidence(root: string, feature: string, state: CraftState): LandAuditResult {
	const auditDir = craftAuditDir(root, feature);
	const auditNumber = latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []);
	if (auditNumber === undefined) return { ok: false, reason: "no-audit-evidence" };

	if (!Number.isInteger(state.auditCycle) || !Number.isInteger(state.checkLogAtCycleStart)) return { ok: false, reason: "no-audit-cycle" };
	const auditCycle = state.auditCycle as number;
	const threshold = state.checkLogAtCycleStart as number;
	if (auditCycle !== auditNumber) return { ok: false, reason: "cycle-mismatch" };

	let verdict: AuditVerdict | undefined;
	try {
		verdict = parseAuditVerdict(readFileSync(craftAuditPath(root, feature, auditNumber), "utf8"));
	} catch {
		verdict = undefined;
	}
	if (verdict === undefined || !LAND_ACCEPTED_VERDICTS.includes(verdict)) return { ok: false, reason: "verdict-not-approve" };

	const fresh = readCheckLogSummaries(craftCheckLogsDir(root, feature)).filter(log => log.number > threshold);
	if (fresh.length === 0 || !fresh.some(log => log.passed)) return { ok: false, reason: "stale-check-log" };

	const marker = state.auditValidated;
	if (marker && (marker.cycle > auditCycle || (marker.cycle === auditCycle && marker.verdict !== verdict))) {
		return { ok: false, reason: "evidence-tamper" };
	}

	return { ok: true, verdict, auditNumber };
}

export interface AuditBeginDetails {
	feature: string;
	auditCycle: number;
	checkLogAtCycleStart: number;
	/** Additive escalation evidence (postcraft-14cycle-approval-failure PR-2) — present only when this call touched the escalation ledger. */
	escalation?: {
		status: "escalation-required" | "continued" | "terminal" | AuditBeginBlockedReasonText;
		dueCycle?: number;
		scheduledCycle?: number;
		intervalCycles?: AuditEscalationInterval;
		disposition?: string;
		nextDueCycle?: number;
	};
	/** Present on escalation-required: the EXACT [Audit Escalation] question the skill must ask via lsc_select. */
	question?: string;
	/** Present on escalation-required: the three canonical disposition labels, in canonical order. */
	options?: readonly string[];
	/** Additive base-drift evidence (postcraft-14cycle-approval-failure PR-3) — the audit-time base observation bound to the cycle this call began; a same-cycle replay returns the persisted snapshot unchanged. */
	base?: AuditBaseSnapshot;
}

type AuditBeginBlockedReasonText = "invalid-state" | "terminal" | "stale-pending" | "no-pending-escalation" | "invalid-disposition";

export interface AuditBeginOptions {
	/** The run's active interval, injected by the registration wrapper (env-first LSC_FIXTURE + the interactive --lsc-fixtures alias). performAuditBegin itself never reads env/flags. */
	activeInterval?: AuditEscalationInterval;
	/** The user's disposition label when answering an open escalation gate. */
	escalationDisposition?: string;
	/**
	 * The audit-time base observation (PR-3), computed by the registration wrapper via
	 * `observeAuditBase` and injected here — the sync core never spawns git itself (a sync spawn
	 * blocks the host event loop; see land.ts's runner note). Persisted atomically WITH the cycle
	 * record when this call begins a cycle; a same-cycle replay never rewrites it, and a blocked /
	 * escalation-required / terminal call records none.
	 */
	baseSnapshot?: AuditBaseSnapshot;
}

// ---------------------------------------------------------------------------
// Audit-time base observation (postcraft-14cycle-approval-failure PR-3) — the audit's
// non-blocking WARN evidence about WHERE the feature stands relative to its real land target.
// The base AUTHORITY is the ref post-craft detected before calling begin (passed as
// `base_branch`); only a legacy direct caller that omitted it falls back to the attached
// project-root current branch. Land's own fail-closed gates are a SEPARATE boundary — an
// unknown snapshot here never refuses an audit cycle.
// ---------------------------------------------------------------------------

function gitErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function unknownBaseSnapshot(baseBranch: string, authority: AuditBaseSnapshot["authority"], observedAt: string, error: string): AuditBaseSnapshot {
	return { baseBranch, baseTip: "", sourceTip: "", behindCount: "unknown", status: "unknown", authority, observedAt, error };
}

/** Anchor both tips and count how far the base has moved past the source (`git rev-list --count <source>..<base>`). Any measurement failure degrades to a non-blocking unknown — never a guess. */
async function anchorBaseSnapshot(projectRoot: string, sourceRoot: string, baseBranch: string, baseTip: string, authority: AuditBaseSnapshot["authority"], observedAt: string): Promise<AuditBaseSnapshot> {
	let sourceTip: string;
	try {
		sourceTip = await runGitText(sourceRoot, ["rev-parse", "HEAD"]);
	} catch (error) {
		return { baseBranch, baseTip, sourceTip: "", behindCount: "unknown", status: "unknown", authority, observedAt, error: `source tip unavailable: ${gitErrorMessage(error)}` };
	}
	try {
		const count = await runGitText(projectRoot, ["rev-list", "--count", `${sourceTip}..${baseTip}`]);
		const behind = Number(count);
		if (!Number.isSafeInteger(behind) || behind < 0) {
			return { baseBranch, baseTip, sourceTip, behindCount: "unknown", status: "unknown", authority, observedAt, error: `git rev-list --count returned non-integer "${count}"` };
		}
		return { baseBranch, baseTip, sourceTip, behindCount: behind, status: "ok", authority, observedAt };
	} catch (error) {
		return { baseBranch, baseTip, sourceTip, behindCount: "unknown", status: "unknown", authority, observedAt, error: `behind-count unavailable: ${gitErrorMessage(error)}` };
	}
}

/**
 * Observe the audit-time base (PR-3). `baseBranch` is the land-target ref post-craft detected
 * BEFORE calling begin — when present it is resolved STRICTLY via argv
 * `git rev-parse --verify --end-of-options <expr>^{commit}` (leading `-` can never re-parse as
 * an option), and an unresolvable explicit ref NEVER falls back: it is recorded unknown with
 * authority "explicit-base". Only a legacy direct caller that omitted the ref falls back to the
 * attached project-root current branch; a detached/unborn/unresolvable HEAD there is recorded
 * unknown with authority "legacy-current-branch" — the base is never guessed. Never throws.
 */
export async function observeAuditBase(projectRoot: string, sourceRoot: string, baseBranch: string | undefined): Promise<AuditBaseSnapshot> {
	const observedAt = new Date().toISOString();
	if (baseBranch !== undefined) {
		try {
			const baseTip = await runGitText(projectRoot, ["rev-parse", "--verify", "--end-of-options", `${baseBranch}^{commit}`]);
			return await anchorBaseSnapshot(projectRoot, sourceRoot, baseBranch, baseTip, "explicit-base", observedAt);
		} catch (error) {
			return unknownBaseSnapshot(baseBranch, "explicit-base", observedAt, gitErrorMessage(error));
		}
	}
	let currentBranch: string;
	try {
		currentBranch = await runGitText(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
	} catch (error) {
		return unknownBaseSnapshot("", "legacy-current-branch", observedAt, gitErrorMessage(error));
	}
	if (currentBranch === "HEAD" || currentBranch === "") {
		return unknownBaseSnapshot(currentBranch, "legacy-current-branch", observedAt, "detached HEAD — the attached project root has no current branch to measure");
	}
	try {
		const baseTip = await runGitText(projectRoot, ["rev-parse", "--verify", "--end-of-options", `${currentBranch}^{commit}`]);
		return await anchorBaseSnapshot(projectRoot, sourceRoot, currentBranch, baseTip, "legacy-current-branch", observedAt);
	} catch (error) {
		return unknownBaseSnapshot(currentBranch, "legacy-current-branch", observedAt, gitErrorMessage(error));
	}
}

/** The non-blocking base line a begun cycle's success text carries — a WARN only when the base actually drifted or could not be measured. */
function describeAuditBase(snapshot: AuditBaseSnapshot): string {
	if (snapshot.status === "unknown") {
		return `WARN: audit base could not be measured (${snapshot.authority} "${snapshot.baseBranch}"): ${snapshot.error} — non-blocking for the audit; land's own gates stay fail-closed.`;
	}
	if (snapshot.behindCount === 0) {
		return `Base authority: ${snapshot.authority} "${snapshot.baseBranch}" @ ${snapshot.baseTip.slice(0, 12)} — source @ ${snapshot.sourceTip.slice(0, 12)}, 0 behind (in sync).`;
	}
	return `WARN: base drift — ${snapshot.authority} "${snapshot.baseBranch}" @ ${snapshot.baseTip.slice(0, 12)} is ${snapshot.behindCount} commit(s) ahead of the source @ ${snapshot.sourceTip.slice(0, 12)}. The audit proceeds (non-blocking); resolve the drift before land.`;
}

/**
 * Core `lsc_audit_begin` logic, extracted from the registerTool wrapper so it's directly
 * unit-testable with real temp directories (no ExtensionAPI/pi.zod mocking — mirrors abort.ts/
 * release.ts's performX pattern, review MEDIUM tool-level test request).
 *
 * PR-2: the escalation gate runs AFTER the candidate is computed and BEFORE any cycle/threshold
 * write — the old fail-open cycleWarn is gone. Every refusal (invalid-state / terminal /
 * stale-pending / no-pending-escalation / invalid-disposition) and the first cap call (pending
 * persist → isError) leaves the cycle marker untouched; only a Continue consumption or an
 * under-cap proceed records the cycle, in ONE atomic write each (applyAuditBeginOutcome).
 */
export function performAuditBegin(feature: string, cwd: string, options: AuditBeginOptions = {}): AgentToolResult<AuditBeginDetails> {
	// audit-0 RF-13: the feature is interpolated verbatim into the [Audit Escalation] question and
	// every result text — refuse a non-slug (newline/control chars) before ANY fs access.
	if (!FEATURE_SLUG_RE.test(feature)) {
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: feature_dir must resolve to a bare kebab-case slug (got ${JSON.stringify(feature)}) — path separators, traversal segments, and special characters are refused.` }],
		};
	}
	const root = resolveAuditRoot(cwd, feature);

	const logsDir = craftCheckLogsDir(root, feature);
	const checkLogAtCycleStart = latestCheckNumber(existsSync(logsDir) ? readdirSync(logsDir) : []);

	const auditDir = craftAuditDir(root, feature);
	const candidateCycle = (latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []) ?? -1) + 1;

	let state: CraftState | undefined;
	try {
		state = readPersistedCraftState(root, feature);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { isError: true, content: [{ type: "text", text: message }], details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, escalation: { status: "invalid-state" } } };
	}
	if (!state) {
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: no persisted craft state at ${craftStatePath(root, feature)} — run craft before starting a post-craft audit cycle.` }],
			details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart },
		};
	}

	const activeInterval = options.activeInterval ?? LIVE_AUDIT_ESCALATION_INTERVAL;
	const gate = evaluateAuditBeginGate({
		feature,
		candidateCycle,
		activeInterval,
		persisted: state,
		disposition: options.escalationDisposition,
	});

	switch (gate.type) {
		case "blocked": {
			return {
				isError: true,
				content: [{ type: "text", text: `lets-craft: audit cycle ${candidateCycle} for "${feature}" refused (${gate.reason}) — ${gate.message}` }],
				details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, escalation: { status: gate.reason } },
			};
		}
		case "escalation-required": {
			// First cap call: publish the exact pending BEFORE returning isError (crash-durable),
			// then keep asking the same question until a canonical disposition consumes it.
			if (!state.auditEscalationPending) {
				try {
					applyAuditBeginOutcome(root, feature, { kind: "escalation-pending", pending: gate.pending });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return { isError: true, content: [{ type: "text", text: message }], details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, escalation: { status: "invalid-state" } } };
				}
			}
			const options_ = AUDIT_ESCALATION_DISPOSITIONS;
			return {
				isError: true,
				content: [
					{
						type: "text",
						text:
							`lets-craft: audit escalation required for "${feature}" at cycle ${gate.pending.dueCycle} (schedule ${gate.pending.scheduledCycle}, interval ${gate.pending.intervalCycles}) — ` +
							`no audit cycle may begin until a disposition consumes this gate.\n\n` +
							`Ask the user this EXACT question via lsc_select (options: ${options_.join(" / ")}):\n${gate.question}\n` +
							`Then re-call lsc_audit_begin with escalation_disposition set to the selected label (CONTENT exactly "User selected: <label>").`,
					},
				],
				details: {
					feature,
					auditCycle: candidateCycle,
					checkLogAtCycleStart,
					escalation: { status: "escalation-required", dueCycle: gate.pending.dueCycle, scheduledCycle: gate.pending.scheduledCycle, intervalCycles: gate.pending.intervalCycles },
					question: gate.question,
					options: options_,
				},
			};
		}
		case "consume-continue": {
			try {
				applyAuditBeginOutcome(root, feature, {
					kind: "escalation-continue",
					decision: gate.decision,
					auditCycle: gate.pending.dueCycle,
					checkLogAtCycleStart,
					baseSnapshot: options.baseSnapshot,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: message }], details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, escalation: { status: "invalid-state" } } };
			}
			return {
				content: [
					{
						type: "text",
						text:
							`lets-craft: audit cycle ${gate.pending.dueCycle} begun for "${feature}" (escalation consumed: Continue auditing) — freshness threshold set at check-${checkLogAtCycleStart}.log ` +
							`(a passing check-${checkLogAtCycleStart + 1}.log or later is required to back an APPROVE-family verdict). ` +
							`The escalation gate re-fires at cycle ${gate.decision.nextDueCycle}.` +
							(options.baseSnapshot ? ` ${describeAuditBase(options.baseSnapshot)}` : ""),
					},
				],
				details: {
					feature,
					auditCycle: gate.pending.dueCycle,
					checkLogAtCycleStart,
					escalation: { status: "continued", dueCycle: gate.pending.dueCycle, disposition: "Continue auditing", intervalCycles: gate.pending.intervalCycles, nextDueCycle: gate.decision.nextDueCycle },
					base: options.baseSnapshot,
				},
			};
		}
		case "consume-terminal": {
			try {
				applyAuditBeginOutcome(root, feature, { kind: "escalation-terminal", decision: gate.decision });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: message }], details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, escalation: { status: "invalid-state" } } };
			}
			// A terminal disposition invalidates any pending approval/prepared operation — it ended
			// the loop; no live destructive capability may survive it.
			invalidatePendingApproval();
			invalidatePreparedOperation();
			const nextStep =
				gate.decision.disposition === "Abort this craft"
					? 'Delegate the abort to lsc_craft_abort({reason: "audit escalation: Abort this craft", feature_dir}) — it owns the aborted transition.'
					: "Preserve branch and stop: leave the worktree and branch exactly as they are; this feature's audit loop is over.";
			return {
				content: [
					{
						type: "text",
						text:
							`lets-craft: escalation disposition "${gate.decision.disposition}" recorded for "${feature}" at cycle ${gate.decision.dueCycle} — NO audit cycle was begun (cycle marker untouched at ${state.auditCycle ?? candidateCycle - 1}). ` +
							`Subsequent lsc_audit_begin and lsc_land calls are refused for this feature. ${nextStep}`,
					},
				],
				details: {
					feature,
					auditCycle: state.auditCycle ?? candidateCycle - 1,
					checkLogAtCycleStart: state.checkLogAtCycleStart ?? checkLogAtCycleStart,
					escalation: { status: "terminal", dueCycle: gate.decision.dueCycle, disposition: gate.decision.disposition, intervalCycles: gate.decision.intervalCycles },
				},
			};
		}
		case "replay": {
			// Idempotent same-cycle replay: the persisted auditCycle / checkLogAtCycleStart / base
			// snapshot bytes are NOT rewritten — the caller gets the recorded result back (any
			// freshly observed snapshot injected this call is deliberately ignored in favor of the
			// persisted one, so replay can never drift the recorded evidence).
			const auditCycle = state.auditCycle ?? candidateCycle;
			const threshold = state.checkLogAtCycleStart ?? checkLogAtCycleStart;
			const base = state.auditBaseSnapshot;
			return {
				content: [
					{
						type: "text",
						text:
							`lets-craft: audit cycle ${auditCycle} for "${feature}" was already begun (idempotent replay — threshold stays at check-${threshold}.log; nothing was rewritten). ` +
							`A passing check-${threshold + 1}.log or later is required to back an APPROVE-family verdict.` +
							(base ? ` ${describeAuditBase(base)}` : ""),
					},
				],
				details: { feature, auditCycle, checkLogAtCycleStart: threshold, base },
			};
		}
		case "proceed": {
			try {
				applyAuditBeginOutcome(root, feature, { kind: "audit-cycle", auditCycle: candidateCycle, checkLogAtCycleStart, baseSnapshot: options.baseSnapshot });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: message }], details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart } };
			}
			return {
				content: [
					{
						type: "text",
						text:
							`lets-craft: audit cycle ${candidateCycle} begun for "${feature}" — freshness threshold set at check-${checkLogAtCycleStart}.log ` +
							`(a passing check-${checkLogAtCycleStart + 1}.log or later is required to back an APPROVE-family verdict).` +
							(options.baseSnapshot ? ` ${describeAuditBase(options.baseSnapshot)}` : ""),
					},
				],
				details: { feature, auditCycle: candidateCycle, checkLogAtCycleStart, base: options.baseSnapshot },
			};
		}
	}
}

function registerAuditBeginTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments (not left to inference) avoid TS2589 — see run-check.ts's module doc comment.
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
		base_branch: z
			.string()
			.optional()
			.describe(
				"The land-target base ref post-craft detected BEFORE calling this tool (skills/post-craft/SKILL.md §2.3) — the audit-time canonical base authority. " +
					"Resolved strictly via `git rev-parse --verify --end-of-options <ref>^{commit}`; an unresolvable ref is recorded as an unknown observation with NO fallback. " +
					"Omit only for legacy direct calls, which fall back to the attached project-root current branch (detached/unborn/unresolvable there is recorded unknown).",
			),
		escalation_disposition: z
			.string()
			.optional()
			.describe(
				`The user's [Audit Escalation] disposition, ONLY when answering an open gate (the prior call returned escalation-required). ` +
					`Must be exactly one of: ${AUDIT_ESCALATION_DISPOSITIONS.join(" / ")}. Any other value (including a free answer) is refused without consuming the gate.`,
			),
	});

	pi.registerTool<typeof parameters, AuditBeginDetails>({
		name: "lsc_audit_begin",
		loadMode: "discoverable",
		label: "Craft: begin a post-craft audit cycle",
		description:
			"Record the current max check/logs/check-N.log index as this feature's new post-craft audit cycle's freshness " +
			"threshold (B-1, cycle-freshness). Call this once per audit cycle, right after determining the cycle number N " +
			"(skills/post-craft/SKILL.md §2.4) — before rendering the audit-N.md verdict. lsc_audit_validate later refuses " +
			"an APPROVE-family verdict unless a passing check-N.log exists with N strictly greater than this threshold, so a " +
			"stale green log from before this cycle can never back a fresh approval. " +
			"Pass the detected base ref as base_branch — the observed {baseBranch,baseTip,sourceTip,behindCount} snapshot is persisted with the cycle as non-blocking drift evidence. " +
			"At the escalation interval's due cycle (live 3 / fixture 2, periodic) the call instead returns isError " +
			"escalation-required with the exact [Audit Escalation] question; re-call with escalation_disposition to consume it — " +
			"only \"Continue auditing\" begins the cycle.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AuditBeginDetails>> {
			// audit-1 RF-20(a): the free-text params are validated BEFORE any effect or observation
			// (observeAuditBase below is this tool's first observation) — a control-carrying
			// base_branch or escalation_disposition must never reach git argv or result text.
			const controlChars = controlCharRefusalText({ base_branch: params.base_branch, escalation_disposition: params.escalation_disposition });
			if (controlChars) {
				return { isError: true, content: [{ type: "text", text: controlChars }] };
			}
			const feature = resolveFeatureName(params.feature_dir);
			// The wrapper is the ONLY interval owner: detectFixturePath reads the env-first LSC_FIXTURE
			// plus the interactive --lsc-fixtures alias and injects the active interval into the pure
			// policy. performAuditBegin itself never reads env/CLI flags.
			const fixturePath = detectFixturePath(name => pi.getFlag(name));
			// PR-3 base observation: read-only and async HERE (the sync core never spawns git — a
			// blocked event loop starves the host); the resulting snapshot is injected like the
			// interval. An explicit base_branch resolves strictly; omitting it is the legacy
			// attached-current-branch fallback. Never throws — unknown is a non-blocking WARN.
			const sourceRoot = resolveAuditRoot(ctx.cwd, feature);
			const baseSnapshot = await observeAuditBase(ctx.cwd, sourceRoot, params.base_branch);
			return performAuditBegin(feature, ctx.cwd, {
				activeInterval: auditEscalationInterval(fixturePath !== undefined),
				escalationDisposition: params.escalation_disposition,
				baseSnapshot,
			});
		},
	});
}

export interface AuditValidateDetails {
	feature: string;
	auditNumber: number;
	verdict: AuditVerdict | undefined;
	freshness: AuditFreshnessCheck | undefined;
}

/**
 * Core `lsc_audit_validate` logic, extracted from the registerTool wrapper so it's directly
 * unit-testable with real temp directories (no ExtensionAPI/pi.zod mocking — review MEDIUM
 * tool-level test request, mirrors abort.ts/release.ts's performX pattern).
 */
export function performAuditValidate(feature: string, cwd: string): AgentToolResult<AuditValidateDetails> {
	// audit-0 RF-13 — same boundary guard as performAuditBegin (the name reaches result text verbatim).
	if (!FEATURE_SLUG_RE.test(feature)) {
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: feature_dir must resolve to a bare kebab-case slug (got ${JSON.stringify(feature)}) — path separators, traversal segments, and special characters are refused.` }],
		};
	}
	const root = resolveAuditRoot(cwd, feature);

	const auditDir = craftAuditDir(root, feature);
	const auditNumber = latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []);
	if (auditNumber === undefined) {
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: no audit-N.md found under ${auditDir}. Run post-craft's audit stage first.` }],
		};
	}

	// TOCTOU (review LOW-1): the file existsSync/latestAuditNumber just confirmed can still vanish
	// (or become unreadable) before this read — normalize to a clean isError rather than an
	// uncaught exception.
	const auditPath = craftAuditPath(root, feature, auditNumber);
	let auditMarkdown: string;
	try {
		auditMarkdown = readFileSync(auditPath, "utf8");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { isError: true, content: [{ type: "text", text: `lets-craft: could not read ${auditPath} — ${message}.` }] };
	}

	const verdict = parseAuditVerdict(auditMarkdown);
	if (verdict === undefined) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text:
						`lets-craft: could not parse a line-start "**AUDIT VERDICT: ...**" line from ${auditPath}. Merge is not ` +
						"authorized without a validated verdict — re-check the audit doc's format.",
				},
			],
		};
	}

	const state = readPersistedCraftState(root, feature);
	const isApproveFamily = APPROVE_FAMILY_VERDICTS.includes(verdict);

	// auditCycle mismatch (review LOW-3, functionalizing the field): a recorded auditCycle that
	// doesn't match the audit-N.md actually being validated means the persisted
	// checkLogAtCycleStart threshold was captured for a DIFFERENT cycle (most likely: a newer
	// audit-N.md was written without calling lsc_audit_begin again — a skipped §2.4 step).
	// Trusting that threshold here would validate freshness against the wrong baseline, so this
	// refuses (fail-closed) rather than silently degrading to "no threshold" — degrading would be
	// fail-OPEN and reopen exactly the stale-evidence gap B-1 exists to close. Irrelevant for
	// non-APPROVE-family verdicts, since freshness never gates them anyway (see
	// validateAuditFreshness).
	if (isApproveFamily && state?.auditCycle !== undefined && state.auditCycle !== auditNumber) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text:
						`lets-craft: audit cycle marker mismatch for "${feature}" — the persisted auditCycle (${state.auditCycle}) does not ` +
						`match audit-${auditNumber}.md, so its recorded freshness threshold cannot be trusted for this ${verdict} verdict. ` +
						"Call lsc_audit_begin again for this cycle, then re-validate.",
				},
			],
		};
	}

	const logs = readCheckLogSummaries(craftCheckLogsDir(root, feature));
	const freshness = validateAuditFreshness(verdict, state?.checkLogAtCycleStart, logs);
	if (!freshness.ok) {
		const reasonText =
			freshness.reason === "stale-log"
				? `no check/logs/check-N.log exists after this audit cycle's freshness threshold (check-${state?.checkLogAtCycleStart}.log) — ` +
					`the ${verdict} verdict cannot be backed by a fresh run. Call lsc_run_check (or re-run run_check.sh) before re-validating.`
				: `check/logs/ has check-N.log(s) after this audit cycle's threshold, but none record a passing run (exit 0) — the ` +
					`${verdict} verdict is not backed by fresh passing evidence.`;
		return {
			isError: true,
			content: [
				{ type: "text", text: `lets-craft: audit freshness violation for "${feature}" (audit-${auditNumber}.md, verdict ${verdict}) — ${reasonText}` },
			],
		};
	}

	// Durable machine trace (review MEDIUM): backs the prose merge-block contract
	// (skills/post-craft/SKILL.md §7.1) with a persisted marker. NON-AUTHORITATIVE trace (A/D4):
	// lsc_land never gates on this marker — it re-derives the verdict + cycle-freshness from disk
	// independently (validateLandAuditEvidence) and treats the marker only as cycle-aware
	// consistency evidence. Best-effort: a failure to record this marker must not hide an
	// otherwise-successful validation from the caller.
	let markerNote = "";
	try {
		recordAuditValidated(root, feature, auditNumber, verdict, new Date().toISOString());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		markerNote = ` (warning: could not record the durable auditValidated marker — ${message})`;
	}

	// Review LOW-2: a non-APPROVE-family verdict (REJECT / APPROVE-WITH-CHANGE) reaches this point
	// unconditionally (freshness never gates it), so the success text must never say
	// "cycle-freshness confirmed" for it — that phrase would misleadingly imply land-readiness.
	const text = isApproveFamily
		? `lets-craft: audit-${auditNumber}.md verdict validated — ${verdict} (cycle-freshness confirmed).${markerNote}`
		: `lets-craft: audit-${auditNumber}.md verdict parsed — ${verdict}. Not land-eligible — verdict is ${verdict} ` +
			`(skills/post-craft/SKILL.md §7.1); cycle-freshness does not apply.${markerNote}`;

	return {
		content: [{ type: "text", text }],
		details: { feature, auditNumber, verdict, freshness },
	};
}

function registerAuditValidateTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, AuditValidateDetails>({
		name: "lsc_audit_validate",
		loadMode: "discoverable",
		label: "Craft: validate the latest audit verdict",
		description:
			"Machine-verify the latest .lsc/crafts/{feature}/audit/audit-N.md before land: parse its **AUDIT VERDICT: " +
			"...** line by exact literal match (B-1) and — for an APPROVE-family verdict (APPROVE / APPROVE-WITH-COMMENT) " +
			"— confirm a passing check/logs/check-N.log exists from AFTER this audit cycle's lsc_audit_begin threshold " +
			"(cycle-freshness), so a stale green log can never back a fresh approval. Fails closed (isError) when the " +
			"verdict line doesn't parse, the audit cycle marker doesn't match this audit doc, or the freshness check " +
			"fails; skills/post-craft/SKILL.md's land gate must not proceed to git merge on an isError result. On success, " +
			"records a durable auditValidated marker on the feature's persisted craft state.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AuditValidateDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			return performAuditValidate(feature, ctx.cwd);
		},
	});
}

/** Register `lsc_audit_begin` and `lsc_audit_validate` (B-1). */
export function registerAuditValidateTools(pi: ExtensionAPI): void {
	registerAuditBeginTool(pi);
	registerAuditValidateTool(pi);
}
