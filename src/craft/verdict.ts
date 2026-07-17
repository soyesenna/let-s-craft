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
import { craftAuditDir, craftAuditPath, craftTestLogsDir, resolveFeatureName, worktreePath } from "../artifacts/paths.js";
import { readPersistedCraftState, recordAuditCycleBegin } from "./state.js";

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
// run-N.log / audit-N.md filename numbering (promoted from statusbar/craft-progress.ts, QW7)
// ---------------------------------------------------------------------------

/** Highest `run-N.log` index among the given filenames; 0 when none match (no test run yet). */
export function latestRunNumber(fileNames: readonly string[]): number {
	const numbers = fileNames
		.map(name => /^run-(\d+)\.log$/.exec(name)?.[1])
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

/** True iff a run-N.log transcript (src/craft/run-tests.ts's `runFeatureTests` format) records a clean pass — a bare `--- exit 0 ---` line, never the `(killed)` variant. */
export function isPassingRunLog(logContent: string): boolean {
	return /^--- exit 0 ---$/m.test(logContent);
}

export interface RunLogSummary {
	/** The run-N.log's numeric suffix. */
	number: number;
	/** Whether that specific run recorded a clean pass (isPassingRunLog). */
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
 * §7.1) must be backed by a passing run-N.log whose number is STRICTLY GREATER than
 * `runLogAtCycleStart` (the freshness threshold `lsc_audit_begin` records at cycle start) —
 * never a stale green log left over from before this audit cycle began. This closes exactly the
 * gap an AWC fix-verification cycle could otherwise exploit: citing an old passing run instead of
 * actually re-running tests against the fix.
 *
 * REJECT and APPROVE-WITH-CHANGE are exempt (`{ ok: true }` unconditionally) — neither is ever
 * land-eligible on its own (APPROVE-WITH-CHANGE always requires a further fix-verification cycle
 * first, §7.1), so a freshness violation on either would never actually gate a merge; checking
 * them would just be noise.
 *
 * `runLogAtCycleStart === undefined` (a craft state persisted before this field existed, or a
 * craft whose post-craft cycle never called `lsc_audit_begin`) is ALSO treated tolerantly — `{
 * ok: true }` — rather than fail-closed: there is no recorded threshold to check freshness
 * against, and refusing every such craft's audit outright would be a hard regression for state
 * predating this feature. This is a deliberate, documented scope cut, not an oversight — the
 * merge-block wiring this validates for (skills/post-craft/SKILL.md §7.1) still requires
 * `lsc_audit_begin` to have actually been called for the freshness half of the guarantee to
 * apply; without it, `lsc_audit_validate` still enforces exact-literal verdict parsing, just not
 * cycle-freshness.
 */
export function validateAuditFreshness(verdict: AuditVerdict, runLogAtCycleStart: number | undefined, logs: readonly RunLogSummary[]): AuditFreshnessCheck {
	if (!APPROVE_FAMILY_VERDICTS.includes(verdict)) return { ok: true };
	if (runLogAtCycleStart === undefined) return { ok: true };
	const fresh = logs.filter(log => log.number > runLogAtCycleStart);
	if (fresh.length === 0) return { ok: false, reason: "stale-log" };
	return fresh.some(log => log.passed) ? { ok: true } : { ok: false, reason: "no-passing-log" };
}

// ---------------------------------------------------------------------------
// Tool wrappers — `lsc_audit_begin` / `lsc_audit_validate` (thin, per this project's registerTool
// convention: pure logic above, FS reads + registerTool glue below).
// ---------------------------------------------------------------------------

/**
 * Resolve the root to read/write a feature's audit artifacts against: the worktree when one
 * exists (C6/R5's "always worktree" convention — post-craft's own artifact root, SKILL.md §2.3),
 * else the project root as the pre-R5/escape-hatch fallback. Both tools below share this
 * resolution — post-craft never holds an active craft (SKILL.md §1.5, it deliberately never
 * calls lsc_craft_init), so unlike lsc_verify_hash/lsc_run_tests there is no active-craft
 * worktreeRoot available to consult here.
 */
function resolveAuditRoot(cwd: string, feature: string): string {
	const wt = worktreePath(cwd, feature);
	return existsSync(wt) ? wt : cwd;
}

function readRunLogSummaries(logsDir: string): RunLogSummary[] {
	if (!existsSync(logsDir)) return [];
	return readdirSync(logsDir)
		.map(name => /^run-(\d+)\.log$/.exec(name)?.[1])
		.filter((n): n is string => n !== undefined)
		.map(numberStr => {
			const number = Number(numberStr);
			const content = readFileSync(join(logsDir, `run-${number}.log`), "utf8");
			return { number, passed: isPassingRunLog(content) };
		});
}

export interface AuditBeginDetails {
	feature: string;
	auditCycle: number;
	runLogAtCycleStart: number;
}

function registerAuditBeginTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments (not left to inference) avoid TS2589 — see hash-manifest.ts.
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, AuditBeginDetails>({
		name: "lsc_audit_begin",
		label: "Craft: begin a post-craft audit cycle",
		description:
			"Record the current max test/logs/run-N.log index as this feature's new post-craft audit cycle's freshness " +
			"threshold (B-1, cycle-freshness). Call this once per audit cycle, right after determining the cycle number N " +
			"(skills/post-craft/SKILL.md §2.2) — before rendering the audit-N.md verdict. lsc_audit_validate later refuses " +
			"an APPROVE-family verdict unless a passing run-N.log exists with N strictly greater than this threshold, so a " +
			"stale green log from before this cycle can never back a fresh approval.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AuditBeginDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const root = resolveAuditRoot(ctx.cwd, feature);

			const logsDir = craftTestLogsDir(root, feature);
			const runLogAtCycleStart = latestRunNumber(existsSync(logsDir) ? readdirSync(logsDir) : []);

			const auditDir = craftAuditDir(root, feature);
			const auditCycle = (latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []) ?? -1) + 1;

			try {
				recordAuditCycleBegin(root, feature, auditCycle, runLogAtCycleStart);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: message }] };
			}

			return {
				content: [
					{
						type: "text",
						text:
							`lets-craft: audit cycle ${auditCycle} begun for "${feature}" — freshness threshold set at run-${runLogAtCycleStart}.log ` +
							`(a passing run-${runLogAtCycleStart + 1}.log or later is required to back an APPROVE-family verdict).`,
					},
				],
				details: { feature, auditCycle, runLogAtCycleStart },
			};
		},
	});
}

export interface AuditValidateDetails {
	feature: string;
	auditNumber: number;
	verdict: AuditVerdict | undefined;
	freshness: AuditFreshnessCheck | undefined;
}

function registerAuditValidateTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, AuditValidateDetails>({
		name: "lsc_audit_validate",
		label: "Craft: validate the latest audit verdict",
		description:
			"Machine-verify the latest .lsc/crafts/{feature}/audit/audit-N.md before land: parse its **AUDIT VERDICT: " +
			"...** line by exact literal match (B-1) and — for an APPROVE-family verdict (APPROVE / APPROVE-WITH-COMMENT) " +
			"— confirm a passing test/logs/run-N.log exists from AFTER this audit cycle's lsc_audit_begin threshold " +
			"(cycle-freshness), so a stale green log can never back a fresh approval. Fails closed (isError) when the " +
			"verdict line doesn't parse or the freshness check fails; skills/post-craft/SKILL.md's land gate must not " +
			"proceed to git merge on an isError result.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AuditValidateDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const root = resolveAuditRoot(ctx.cwd, feature);

			const auditDir = craftAuditDir(root, feature);
			const auditNumber = latestAuditNumber(existsSync(auditDir) ? readdirSync(auditDir) : []);
			if (auditNumber === undefined) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: no audit-N.md found under ${auditDir}. Run post-craft's audit stage first.` }],
				};
			}

			const auditPath = craftAuditPath(root, feature, auditNumber);
			const verdict = parseAuditVerdict(readFileSync(auditPath, "utf8"));
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
			const logs = readRunLogSummaries(craftTestLogsDir(root, feature));
			const freshness = validateAuditFreshness(verdict, state?.runLogAtCycleStart, logs);
			if (!freshness.ok) {
				const reasonText =
					freshness.reason === "stale-log"
						? `no test/logs/run-N.log exists after this audit cycle's freshness threshold (run-${state?.runLogAtCycleStart}.log) — ` +
							`the ${verdict} verdict cannot be backed by a fresh run. Call lsc_run_tests (or re-run run_test.sh) before re-validating.`
						: `test/logs/ has run-N.log(s) after this audit cycle's threshold, but none record a passing run (exit 0) — the ` +
							`${verdict} verdict is not backed by fresh passing evidence.`;
				return {
					isError: true,
					content: [
						{ type: "text", text: `lets-craft: audit freshness violation for "${feature}" (audit-${auditNumber}.md, verdict ${verdict}) — ${reasonText}` },
					],
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `lets-craft: audit-${auditNumber}.md verdict validated — ${verdict} (cycle-freshness confirmed).`,
					},
				],
				details: { feature, auditNumber, verdict, freshness },
			};
		},
	});
}

/** Register `lsc_audit_begin` and `lsc_audit_validate` (B-1). */
export function registerAuditValidateTools(pi: ExtensionAPI): void {
	registerAuditBeginTool(pi);
	registerAuditValidateTool(pi);
}
