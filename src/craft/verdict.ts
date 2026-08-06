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
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftAuditDir, craftAuditPath, craftCheckLogsDir, resolveFeatureName } from "../artifacts/paths.js";
import { type CraftState, craftStateCandidates, readPersistedCraftState, recordAuditCycleBegin, recordAuditValidated } from "./state.js";

// ---------------------------------------------------------------------------
// Verdict vocabularies + generic literal-only parser
// ---------------------------------------------------------------------------

/** post-craft's own four-level audit judgment (skills/post-craft/SKILL.md §4.1 point 2, C25). */
export const AUDIT_VERDICTS = ["APPROVE", "APPROVE-WITH-COMMENT", "APPROVE-WITH-CHANGE", "REJECT"] as const;
export type AuditVerdict = (typeof AUDIT_VERDICTS)[number];

/**
 * lsc-critic's own independent five-level scale (agents/lsc-critic.md Output_Format) — a
 * DIFFERENT, agent-scoped vocabulary that merely shares two token spellings
 * ("APPROVE-WITH-CHANGE", "REJECT") with AUDIT_VERDICTS (skills/post-craft/SKILL.md §1.7's own
 * "do not conflate them" warning). Parsed by the same generic `parseVerdictLine` below under a
 * distinct line prefix, so the two never collide even when both lines appear in the same document
 * (post-craft's audit doc quotes lsc-critic's report verbatim, §4.1 point 7).
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
 * SKILL.md §2.3), else the project root as the pre-R5/escape-hatch fallback. Named policy:
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
}

/**
 * Core `lsc_audit_begin` logic, extracted from the registerTool wrapper so it's directly
 * unit-testable with real temp directories (no ExtensionAPI/pi.zod mocking — mirrors abort.ts/
 * release.ts's performX pattern, review MEDIUM tool-level test request).
 */
export function performAuditBegin(feature: string, cwd: string): AgentToolResult<AuditBeginDetails> {
	const root = resolveAuditRoot(cwd, feature);

	const logsDir = craftCheckLogsDir(root, feature);
	const checkLogAtCycleStart = latestCheckNumber(existsSync(logsDir) ? readdirSync(logsDir) : []);

	const auditDir = craftAuditDir(root, feature);
	const auditCycle = (latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []) ?? -1) + 1;

	try {
		recordAuditCycleBegin(root, feature, auditCycle, checkLogAtCycleStart);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { isError: true, content: [{ type: "text", text: message }] };
	}

	// S3: a minimal, informational restoration of the retired contract's no-progress observation
	// at the cycle level — never gates the result (판정 무영향), just flags a feature that keeps
	// re-entering audit (REJECT/AWC accumulating).
	const cycleWarn =
		auditCycle >= 3
			? `\n\n[WARN] 이 feature는 감사 사이클 ${auditCycle}회차다 (3회 이상) — 반복 REJECT/AWC가 누적되고 있는지 검토하라.`
			: "";

	return {
		content: [
			{
				type: "text",
				text:
					`lets-craft: audit cycle ${auditCycle} begun for "${feature}" — freshness threshold set at check-${checkLogAtCycleStart}.log ` +
					`(a passing check-${checkLogAtCycleStart + 1}.log or later is required to back an APPROVE-family verdict).${cycleWarn}`,
			},
		],
		details: { feature, auditCycle, checkLogAtCycleStart },
	};
}

function registerAuditBeginTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments (not left to inference) avoid TS2589 — see run-check.ts's module doc comment.
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, AuditBeginDetails>({
		name: "lsc_audit_begin",
		loadMode: "discoverable",
		label: "Craft: begin a post-craft audit cycle",
		description:
			"Record the current max check/logs/check-N.log index as this feature's new post-craft audit cycle's freshness " +
			"threshold (B-1, cycle-freshness). Call this once per audit cycle, right after determining the cycle number N " +
			"(skills/post-craft/SKILL.md §2.2) — before rendering the audit-N.md verdict. lsc_audit_validate later refuses " +
			"an APPROVE-family verdict unless a passing check-N.log exists with N strictly greater than this threshold, so a " +
			"stale green log from before this cycle can never back a fresh approval.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AuditBeginDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			return performAuditBegin(feature, ctx.cwd);
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
	// audit-N.md was written without calling lsc_audit_begin again — a skipped §2.2 step).
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
