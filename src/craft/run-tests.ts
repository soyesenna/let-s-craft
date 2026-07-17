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
import { type CraftState, findPersistedCraftState, getActiveCraft, hasOpenRelease, openReleaseGuidance, recordTestResult } from "./state.js";

// See hash-manifest.ts for why registerTool's execute() needs an explicit
// Promise<AgentToolResult<T>> return type: without it, TSchema/TParams inference
// from `parameters` and TDetails inference from the body collide and TypeScript
// hits TS2589 (excessively deep type instantiation) against zod/v4's schema types.

const FAILURE_LINE_RE = /fail|error|✗|✘|not ok/i;
const MAX_FAILURE_LINES = 40;

/** A failure-summary line naming a specific failing test (vs. a bare error/stack line) — the marker prefix is captured off, the rest is the test name. `\b` would never match after the symbol markers (✗/✘ are non-word chars, so `✗ name` has no word boundary before the space), so the boundary is an explicit colon/whitespace/end-of-line. */
const TEST_NAME_LINE_RE = /^(?:FAIL|✗|✘|not ok)(?::|\s|$)\s*(.*)$/i;

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

/**
 * Strip volatile, non-deterministic tokens from a single failure-summary line before it
 * participates in a no-progress signature (C-1): absolute paths collapse to their basename, ANSI
 * color escapes and hex addresses are removed, and any remaining digit run (timestamps, ms/s
 * durations, line:col numbers, ...) becomes `#`. Lowercased throughout so capitalization
 * differences between otherwise-identical runs don't count as a new failure.
 */
function normalizeSignatureLine(line: string): string {
	return line
		.toLowerCase()
		// biome-ignore lint/suspicious/noControlCharactersInRegex: matching literal ANSI escape bytes is the point here.
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/0x[0-9a-f]+/gi, "0x#")
		.replace(/(?:\/[\w.-]+){2,}/g, match => match.slice(match.lastIndexOf("/") + 1))
		.replace(/\d+/g, "#")
		.trim();
}

/**
 * A structured no-progress signature (C-1): the sorted set of normalized failing-test names plus
 * one normalized non-test error line, derived from the same failure-summary text
 * `failureSummaryFor` produces above. Two summaries differing only in volatile tokens (paths,
 * timestamps, durations, color codes, hex addresses, line:col numbers) collapse to the same
 * signature; a genuinely different failing-test set or error message does not. Pure — this is
 * the code-layer half of the no-progress backstop; `recordTestResult` (state.ts) owns comparing
 * consecutive signatures and counting, and craft/SKILL.md §3.5 owns the resulting gate.
 */
export function computeFailureSignature(failureSummary: string): string {
	const lines = failureSummary
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);

	const testNames = new Set<string>();
	const errorLines: string[] = [];
	for (const line of lines) {
		const match = TEST_NAME_LINE_RE.exec(line);
		if (match) {
			const name = normalizeSignatureLine(match[1].length > 0 ? match[1] : line);
			if (name.length > 0) testNames.add(name);
		} else {
			errorLines.push(normalizeSignatureLine(line));
		}
	}

	return JSON.stringify({ tests: [...testNames].sort(), error: errorLines.find(errorLine => errorLine.length > 0) ?? "" });
}

/**
 * The `[No Progress]` escalation notice (C-1), appended to the `lsc_run_tests` result text once
 * `recordTestResult` reports `noProgress: true`. This is the code-layer half of the backstop: the
 * tool result is a live seam that reaches the model on every iteration regardless of whether
 * `session_stop` fires this turn (unlike the session_stop backstop itself, which never fires for
 * a subagent and never fires at all in headless print-mode single-shot runs). The skill-layer
 * half — the actual `[No Progress]` gate this notice points at — is craft/SKILL.md §3.5.
 */
export function noProgressEscalationText(consecutiveFailures: number): string {
	return (
		`\n\n[No Progress] The same failure signature has now repeated for ${consecutiveFailures} consecutive lsc_run_tests ` +
		'runs. Do not start another executor iteration — open the "[No Progress]" gate (craft/SKILL.md §3.5) and ask the ' +
		"user to choose: (1) switch strategy and resume §3.2, (2) spawn lsc-architect for a read-only consult then resume, " +
		"or (3) abort via lsc_craft_abort."
	);
}

/** Compose the final `lsc_run_tests` result text: the base pass/fail text, plus the `[No Progress]` notice above when `record.noProgress` is true. Pure so the composition itself (not just its ingredient parts) is directly unit-testable without the omp SDK. */
export function composeRunTestsResultText(baseText: string, record: { noProgress: boolean; consecutiveFailures: number }): string {
	return record.noProgress ? `${baseText}${noProgressEscalationText(record.consecutiveFailures)}` : baseText;
}

export type RunTestsTarget =
	| { mode: "active"; root: string }
	| { mode: "audit-evidence"; root: string }
	| { mode: "refuse"; text: string };

/**
 * Decide how (or whether) `lsc_run_tests` should proceed for `feature` (B-1 follow-up, review
 * NEEDS-FIX HIGH). An exact active-craft match keeps the original full craft-loop behavior
 * (`"active"` — `recordTestResult` mutates loop bookkeeping downstream, unchanged). Otherwise,
 * when a persisted craft state exists for this exact feature with no unclosed open-release, this
 * is `"audit-evidence"` mode: `run_test.sh` still executes and `test/logs/run-N.log` is still
 * written — the ONLY producer of that log, and post-craft's sole source of `lsc_audit_validate`'s
 * cycle-freshness evidence (verdict.ts). Before this mode existed, post-craft's own common
 * path (it never calls `lsc_craft_init`, skills/post-craft/SKILL.md §1.5) meant `lsc_run_tests`
 * ALWAYS refused here, so no fresh run-N.log could ever exist after an audit cycle began and
 * `validateAuditFreshness` would always reject an APPROVE-family verdict as `"stale-log"` — this
 * mode is what actually makes cycle-freshness reachable in the common case, not just the rare one
 * where post-craft happens to run inside the same session that just finished `craft`.
 *
 * The caller must NOT call `recordTestResult` in `"audit-evidence"` mode — there is either no
 * active craft to mutate, or (the genuinely dangerous case) a DIFFERENT feature's craft happens to
 * be active this session, and this feature's test run must never contaminate that unrelated
 * craft's loop bookkeeping. An unclosed open-release, or no persisted state at all, still refuses
 * exactly as before (verbatim messages — C8 compatibility).
 *
 * Safety of relaxing the former "must be the active craft" gate: the only things that gate
 * protected are (a) knowing SOME root to execute against — persisted state supplies the exact
 * same root an active craft would have; (b) the open-release block — preserved unconditionally
 * below; and (c) not silently mutating an unrelated feature's craft-loop bookkeeping — preserved
 * by `"audit-evidence"` mode never calling `recordTestResult`. It does NOT gate hash-protection
 * (that is `lsc_verify_hash`'s job, entirely unaffected here) or the trusted-exec channel (both
 * modes still run through the same `pi.exec`, never the LLM's own bash tool, and only ever touch
 * `test/logs/`, which is itself excluded from hash protection — hash-manifest.ts's
 * `EXCLUDED_TOP_LEVEL_DIRS`) — so `"audit-evidence"` mode introduces no new bypass of either.
 */
export function resolveRunTestsTarget(feature: string, activeCraft: CraftState | undefined, persisted: CraftState | undefined): RunTestsTarget {
	if (activeCraft && activeCraft.feature === feature) {
		return { mode: "active", root: activeCraft.worktreeRoot ?? activeCraft.projectRoot };
	}
	if (hasOpenRelease(persisted)) {
		return { mode: "refuse", text: openReleaseGuidance(feature, persisted.openRelease) };
	}
	if (persisted) {
		return { mode: "audit-evidence", root: persisted.worktreeRoot ?? persisted.projectRoot };
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
 * Branches on `resolveRunTestsTarget`'s decision; `"audit-evidence"` mode runs the exact same
 * trusted-exec + log-write path as `"active"` mode but skips `recordTestResult` and labels the
 * result text accordingly (see `resolveRunTestsTarget`'s own safety-argument doc comment).
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

	if (target.mode === "audit-evidence") {
		const text =
			`${outcome.text}\n\n[Audit Evidence Mode] No active craft matched "${args.feature}" this session — test/logs/run-N.log ` +
			"was still written (post-craft's lsc_audit_validate cycle-freshness evidence), but active-craft loop bookkeeping " +
			"(testsPassed/failureSignature/consecutiveFailures) was NOT mutated.";
		return { content: [{ type: "text", text }], details: outcome.details };
	}

	const failureSummary = failureSummaryFor(outcome.details);
	const failureSignature = failureSummary !== undefined ? computeFailureSignature(failureSummary) : undefined;
	const record = recordTestResult(outcome.details.passed, failureSummary, failureSignature);
	return { content: [{ type: "text", text: composeRunTestsResultText(outcome.text, record) }], details: outcome.details };
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
			"test/logs/run-N.log and returns a pass/fail verdict plus a best-effort structured failure summary (C21). " +
			"Works even without an active craft matching this session (\"audit-evidence mode\") as long as a persisted " +
			"craft state exists with no unclosed open-release — this is post-craft's primary source of cycle-freshness " +
			"evidence for lsc_audit_validate (B-1); active-craft loop bookkeeping is left untouched in that mode.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RunTestsDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const activeCraft = getActiveCraft();
			const persisted = findPersistedCraftState(ctx.cwd, feature);
			return performRunTests({ feature, activeCraft, persisted, timeoutMs: params.timeout_ms, exec: pi.exec });
		},
	});
}
