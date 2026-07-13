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
import { getActiveCraft, recordTestResult } from "./state.js";

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
 * result (the tool wrapper below calls recordTestResult).
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
		label: "Craft: run run_test.sh",
		description:
			"Run the feature's run_test.sh in the correct source root (the worktree, if --worktree was used, else " +
			"the project root) via a trusted exec — never the LLM's own bash tool. Saves the full transcript to " +
			"test/logs/run-N.log and returns a pass/fail verdict plus a best-effort structured failure summary (C21).",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx): Promise<AgentToolResult<RunTestsDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const craft = getActiveCraft();
			if (!craft || craft.feature !== feature) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: no active craft for "${feature}". Call lsc_craft_init first.` }],
				};
			}

			const root = craft.worktreeRoot ?? craft.projectRoot;
			const scriptPath = craftRunTestScriptPath(root, feature);
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
					feature,
					scriptPath,
					execCwd: root,
					logsDir: craftTestLogsDir(root, feature),
					timeoutMs: params.timeout_ms,
					exec: pi.exec,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: run_test.sh failed to execute — ${message}. Escalate to the user (C23c).` }],
				};
			}

			recordTestResult(outcome.details.passed, failureSummaryFor(outcome.details));
			return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
		},
	});
}
