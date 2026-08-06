// `lsc_run_tests` — the craft loop's trusted execution primitive (C19 step②, C21).
// Runs the pre-craft-authored run_test.sh via `pi.exec` (never the LLM's own bash
// tool, so the hash-protected test tree can't be bypassed by "just running the
// script a different way"), saves the full transcript to test/logs/run-N.log, and
// returns a best-effort structured failure summary so the next executor iteration
// doesn't need to re-read the whole log to know what broke.
//
// The exec call is injected (`ExecFn`) so the core logic (log numbering, transcript
// formatting, pass/fail + failure-line extraction) is unit-testable without the omp
// SDK — vitest on Node cannot import omp SDK values (Phase 1.5 finding, spike.ts).
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult, ExecOptions, ExecResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftRunTestScriptPath, craftTestLogsDir, resolveFeatureName } from "../artifacts/paths.js";
import { type CraftState, findPersistedCraftState, getActiveCraft, hasOpenRelease, openReleaseGuidance } from "./state.js";

// See hash-manifest.ts for why registerTool's execute() needs an explicit
// Promise<AgentToolResult<T>> return type: without it, TSchema/TParams inference
// from `parameters` and TDetails inference from the body collide and TypeScript
// hits TS2589 (excessively deep type instantiation) against zod/v4's schema types.

const FAILURE_LINE_RE = /fail|error|✗|✘|not ok/i;
const MAX_FAILURE_LINES = 40;

export type ExecFn = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

/** Best-effort extraction of failure-looking lines from arbitrary run_test.sh output. */
export function extractFailureLines(output: string, max = MAX_FAILURE_LINES): string[] {
	return output
		.split(/\r?\n/)
		.filter(line => FAILURE_LINE_RE.test(line))
		.slice(0, max);
}

/** Next `run-N.log` index for a feature's test/logs/ directory (N starts at 1). */
export function nextLogNumber(logsDir: string): number {
	if (!existsSync(logsDir)) return 1;
	const numbers = readdirSync(logsDir)
		.map(name => /^run-(\d+)\.log$/.exec(name)?.[1])
		.filter((n): n is string => n !== undefined)
		.map(Number);
	return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export interface RunTestsDetails {
	feature: string;
	passed: boolean;
	exitCode: number;
	killed: boolean;
	logPath: string;
	failureLines: string[];
}

export interface RunFeatureTestsArgs {
	feature: string;
	scriptPath: string;
	/** cwd the script actually runs in: worktree root if `--worktree`, else the project root (§3.2 step③, §3.3). */
	execCwd: string;
	logsDir: string;
	timeoutMs?: number;
	exec: ExecFn;
}

export interface RunFeatureTestsResult {
	details: RunTestsDetails;
	text: string;
}

/**
 * Core run_test.sh execution: exec the script, persist the transcript to
 * test/logs/run-N.log, and derive a pass/fail verdict + structured failure
 * summary. Pure with respect to craft state — callers decide what to do with the
 * result (the tool wrapper below composes the final result text).
 */
export async function runFeatureTests(args: RunFeatureTestsArgs): Promise<RunFeatureTestsResult> {
	const result = await args.exec("bash", [args.scriptPath], { cwd: args.execCwd, timeout: args.timeoutMs });

	mkdirSync(args.logsDir, { recursive: true });
	const logNumber = nextLogNumber(args.logsDir);
	const logPath = join(args.logsDir, `run-${logNumber}.log`);
	const transcript = [
		`$ bash ${args.scriptPath}`,
		`cwd: ${args.execCwd}`,
		"--- stdout ---",
		result.stdout,
		"--- stderr ---",
		result.stderr,
		`--- exit ${result.code}${result.killed ? " (killed)" : ""} ---`,
	].join("\n");
	writeFileSync(logPath, transcript);

	const passed = result.code === 0 && !result.killed;
	const failureLines = passed ? [] : extractFailureLines(`${result.stdout}\n${result.stderr}`);
	const details: RunTestsDetails = { feature: args.feature, passed, exitCode: result.code, killed: result.killed, logPath, failureLines };

	const text = passed
		? `lets-craft: run_test.sh passed (exit 0). Log: ${logPath}.`
		: `lets-craft: run_test.sh FAILED (exit ${result.code}${result.killed ? ", killed" : ""}).${
				failureLines.length > 0 ? ` ${failureLines.length} failure line(s):\n${failureLines.join("\n")}\n` : " "
			}Full log: ${logPath}.`;

	return { details, text };
}

/** Structured failure summary handed to the next executor iteration (C21). */
export function failureSummaryFor(details: RunTestsDetails): string | undefined {
	if (details.passed) return undefined;
	if (details.failureLines.length > 0) return details.failureLines.join("\n");
	return `run_test.sh exited ${details.exitCode}${details.killed ? " (killed)" : ""} — see ${details.logPath}.`;
}

export type RunTestsTarget =
	| { mode: "run"; root: string; auditEvidenceOnly: boolean }
	| { mode: "refuse"; text: string };

/**
 * Decide how (or whether) `lsc_run_tests` should proceed for `feature` (B-1 follow-up, review
 * NEEDS-FIX HIGH). A single `"run"` mode covers both the case this session holds `feature` as
 * its exact active craft, and the case it doesn't but a persisted craft state exists with no
 * unclosed open-release — `auditEvidenceOnly` distinguishes the two only for the result text
 * (see `performRunTests`), since neither case has any loop bookkeeping left to mutate. In the
 * latter case, `run_test.sh` still executes and `test/logs/run-N.log` is still written — the ONLY
 * producer of that log, and post-craft's sole source of `lsc_audit_validate`'s cycle-freshness
 * evidence (verdict.ts). Before this mode existed, post-craft's own common path (it never calls
 * `lsc_craft_init`, skills/post-craft/SKILL.md §1.5) meant `lsc_run_tests` ALWAYS refused here, so
 * no fresh run-N.log could ever exist after an audit cycle began and `validateAuditFreshness`
 * would always reject an APPROVE-family verdict as `"stale-log"` — this mode is what actually
 * makes cycle-freshness reachable in the common case, not just the rare one where post-craft
 * happens to run inside the same session that just finished `craft`.
 *
 * Root-source priority (m2): an exact active-craft match wins — its root is
 * `activeCraft.worktreeRoot ?? activeCraft.projectRoot` — and only when there is none (or it's a
 * DIFFERENT feature's craft) does the persisted state's root (`persisted.worktreeRoot ?? persisted.projectRoot`)
 * apply. This order must never invert: flipping it would make a run right after `craft` finishes
 * in the same session use a stale on-disk root instead of the live in-memory one. An unclosed
 * open-release, or no persisted state at all, still refuses exactly as before (verbatim messages
 * — C8 compatibility).
 *
 * Safety of relaxing the former "must be the active craft" gate: the only things that gate
 * protected are (a) knowing SOME root to execute against — persisted state supplies the exact
 * same root an active craft would have; and (b) the open-release block — preserved
 * unconditionally below. It does NOT gate hash-protection (that is `lsc_verify_hash`'s job,
 * entirely unaffected here) or the trusted-exec channel (both cases still run through the same
 * `pi.exec`, never the LLM's own bash tool, and only ever touch `test/logs/`, which is itself
 * excluded from hash protection — hash-manifest.ts's `EXCLUDED_TOP_LEVEL_DIRS`) — so
 * `auditEvidenceOnly` introduces no new bypass of either.
 */
export function resolveRunTestsTarget(feature: string, activeCraft: CraftState | undefined, persisted: CraftState | undefined): RunTestsTarget {
	if (activeCraft && activeCraft.feature === feature) {
		return { mode: "run", root: activeCraft.worktreeRoot ?? activeCraft.projectRoot, auditEvidenceOnly: false };
	}
	if (hasOpenRelease(persisted)) {
		return { mode: "refuse", text: openReleaseGuidance(feature, persisted.openRelease) };
	}
	if (persisted) {
		return { mode: "run", root: persisted.worktreeRoot ?? persisted.projectRoot, auditEvidenceOnly: true };
	}
	return { mode: "refuse", text: `lets-craft: no active craft for "${feature}". Call lsc_craft_init first.` };
}

export interface PerformRunTestsArgs {
	feature: string;
	activeCraft: CraftState | undefined;
	persisted: CraftState | undefined;
	timeoutMs?: number;
	exec: ExecFn;
}

/**
 * Core `lsc_run_tests` logic, extracted from the registerTool wrapper so it is directly
 * unit-testable with a fake `ExecFn` and real temp directories — no ExtensionAPI/pi.zod mocking
 * required (mirrors runFeatureTests' own split, and abort.ts/release.ts's performX pattern).
 * Branches on `resolveRunTestsTarget`'s decision; `auditEvidenceOnly` runs the exact same
 * trusted-exec + log-write path as an exact active-craft match, only labeling the result text
 * differently (see `resolveRunTestsTarget`'s own safety-argument doc comment).
 */
export async function performRunTests(args: PerformRunTestsArgs): Promise<AgentToolResult<RunTestsDetails>> {
	const target = resolveRunTestsTarget(args.feature, args.activeCraft, args.persisted);
	if (target.mode === "refuse") {
		return { isError: true, content: [{ type: "text", text: target.text }] };
	}

	const root = target.root;
	const scriptPath = craftRunTestScriptPath(root, args.feature);
	if (!existsSync(scriptPath)) {
		return {
			isError: true,
			content: [
				{ type: "text", text: `lets-craft: run_test.sh not found at ${scriptPath}. Escalate to the user — craft cannot proceed (C23c).` },
			],
		};
	}

	let outcome: RunFeatureTestsResult;
	try {
		outcome = await runFeatureTests({
			feature: args.feature,
			scriptPath,
			execCwd: root,
			logsDir: craftTestLogsDir(root, args.feature),
			timeoutMs: args.timeoutMs,
			exec: args.exec,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: run_test.sh failed to execute — ${message}. Escalate to the user (C23c).` }],
		};
	}

	if (target.auditEvidenceOnly) {
		const text =
			`${outcome.text}\n\n[Audit Evidence Mode] No active craft matched "${args.feature}" this session — test/logs/run-N.log ` +
			"was still written (post-craft's lsc_audit_validate cycle-freshness evidence).";
		return { content: [{ type: "text", text }], details: outcome.details };
	}

	return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
}

/** Register `lsc_run_tests`. */
export function registerRunTestsTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
		timeout_ms: z.number().optional().describe("Optional exec timeout in milliseconds."),
	});

	// Explicit type arguments (not left to inference) avoid a TS2589 "excessively
	// deep" instantiation against this SDK's TSchema union — see hash-manifest.ts.
	pi.registerTool<typeof parameters, RunTestsDetails>({
		name: "lsc_run_tests",
		loadMode: "discoverable",
		label: "Craft: run run_test.sh",
		description:
			"Run the feature's run_test.sh in the correct source root (the worktree, if --worktree was used, else " +
			"the project root) via a trusted exec — never the LLM's own bash tool. Saves the full transcript to " +
			"test/logs/run-N.log and returns a pass/fail verdict plus a best-effort structured failure summary (C21). " +
			"Works even without an active craft matching this session (\"audit-evidence mode\") as long as a persisted " +
			"craft state exists with no unclosed open-release — this is post-craft's primary source of cycle-freshness " +
			"evidence for lsc_audit_validate (B-1).",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RunTestsDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const activeCraft = getActiveCraft();
			const persisted = findPersistedCraftState(ctx.cwd, feature);
			return performRunTests({ feature, activeCraft, persisted, timeoutMs: params.timeout_ms, exec: pi.exec });
		},
	});
}
