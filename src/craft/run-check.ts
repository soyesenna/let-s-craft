// `lsc_run_check` — the deterministic check entrypoint's trusted execution primitive (C3,
// generalized from the former single-purpose test-runner tool). Runs post-craft's own
// check/run_check.sh (build/lint/typecheck/test, authored together with the tests it exercises)
// via `pi.exec` — never the LLM's own bash tool — saves the full transcript (with the script's own
// sha256 + full text, for audit) to check/logs/check-N.log, and returns a best-effort structured
// failure summary.
//
// Non-degeneracy gate (E3): since check/run_check.sh is authored by the SAME post-craft actor who
// also authors the tests it runs and later judges the audit (P3's job-separation reduction), two
// PURE function gates — one before exec (evaluateCheckScriptShape, on the script's own text) and
// one after (isEmptyCheckTranscript, on the raw transcript) — stop a formalized/degenerate script
// from ever recording a fake pass. Only the "too short" / "always passes" / "empty transcript"
// rules carry reject authority; a manifest-runner-token mismatch is WARN-only (P2 scope-limited
// exception — a legitimate script can call a test runner directly without going through a package
// manager, as this repo's own fixture does).
//
// The exec call is injected (`ExecFn`) so the core logic (log numbering, transcript formatting,
// pass/fail + failure-line extraction, the non-degeneracy gates) is unit-testable without the omp
// SDK — vitest on Node cannot import omp SDK values (Phase 1.5 finding, spike.ts).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult, ExecOptions, ExecResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftCheckLogsDir, craftCheckScriptPath, resolveFeatureName } from "../artifacts/paths.js";
import { type CraftState, findPersistedCraftState, getActiveCraft } from "./state.js";

// registerTool's execute() needs an explicit Promise<AgentToolResult<T>> return type: without
// it, TSchema/TParams inference from `parameters` and TDetails inference from the body collide
// and TypeScript hits TS2589 (excessively deep type instantiation) against zod/v4's schema
// types. Supplying both type arguments explicitly on registerTool itself (`registerTool<typeof
// parameters, TDetails>({...})`, see below) turns inference into a much cheaper checking pass —
// every registerTool call in this plugin follows both conventions together.

const FAILURE_LINE_RE = /fail|error|✗|✘|not ok/i;
const MAX_FAILURE_LINES = 40;

export type ExecFn = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

/** Best-effort extraction of failure-looking lines from arbitrary run_check.sh output. */
export function extractFailureLines(output: string, max = MAX_FAILURE_LINES): string[] {
	return output
		.split(/\r?\n/)
		.filter(line => FAILURE_LINE_RE.test(line))
		.slice(0, max);
}

/** Next `check-N.log` index for a feature's check/logs/ directory (N starts at 1). */
export function nextLogNumber(logsDir: string): number {
	if (!existsSync(logsDir)) return 1;
	const numbers = readdirSync(logsDir)
		.map(name => /^check-(\d+)\.log$/.exec(name)?.[1])
		.filter((n): n is string => n !== undefined)
		.map(Number);
	return numbers.length === 0 ? 1 : Math.max(...numbers) + 1;
}

export interface RunCheckDetails {
	feature: string;
	passed: boolean;
	exitCode: number;
	killed: boolean;
	logPath: string;
	failureLines: string[];
	/** Raw exec halves (undecorated by the transcript's own headers) — isEmptyCheckTranscript's input. */
	stdout: string;
	stderr: string;
}

// ---------------------------------------------------------------------------
// Non-degeneracy gate (E3) — pure functions, no I/O. Rule numbers follow the AC11 scheme: reject
// authority lives in ①②③, rule ④ is WARN-only (P2 scope-limited exception).
// ---------------------------------------------------------------------------

const SHEBANG_OR_COMMENT_RE = /^\s*#/;
const STANDALONE_SET_RE = /^\s*set\s+[^;&|]*$/;
const STANDALONE_CD_RE = /^\s*cd\s+[^;&|]*$/;
const TRIVIAL_EXECUTION_LINE_RE = /^\s*(echo\b.*|true|:|exit\s+0)\s*$/;

/**
 * Lines that count toward the degeneracy judgment: every line MINUS the shebang, blank lines, `#`
 * comments, and a standalone `set -*` or `cd *` line (none of these represent a check actually
 * running). A shebang line is itself excluded by the `#`-prefix check, so no separate case is
 * needed for it.
 */
export function extractExecutionLines(scriptText: string): string[] {
	return scriptText.split(/\r?\n/).filter(line => {
		if (line.trim().length === 0) return false;
		if (SHEBANG_OR_COMMENT_RE.test(line)) return false;
		if (STANDALONE_SET_RE.test(line)) return false;
		if (STANDALONE_CD_RE.test(line)) return false;
		return true;
	});
}

/** Rules ②③ — the two reject-authority reasons a pre-execution lint can find. */
export type CheckScriptRejectReason = "degenerate-too-short" | "degenerate-always-pass";

export type CheckScriptShape =
	| { verdict: "ok"; warnings: string[] }
	| { verdict: "reject"; reason: CheckScriptRejectReason; warnings: string[] };

/** Manifest file name -> the runner tokens rule ④ expects the script to mention at least one of. */
const MANIFEST_RUNNER_TOKENS: Record<string, readonly string[]> = {
	"package.json": ["npm", "pnpm", "yarn", "bun"],
	"Cargo.toml": ["cargo"],
	"build.gradle": ["gradle"],
	"build.gradle.kts": ["gradle"],
	"pyproject.toml": ["pytest", "python", "uv", "hatch"],
	"go.mod": ["go"],
};

/** The manifest file names evaluateCheckScriptShape's rule ④ recognizes — the caller derives `presentManifests` by checking existence of these against the check's own execution root. */
export const RECOGNIZED_MANIFEST_NAMES = Object.keys(MANIFEST_RUNNER_TOKENS);

/**
 * Pre-execution lint (E3, AC11 rules ②③④) — a purely textual judgment over the check script BEFORE
 * it ever runs, so a degenerate/formalized script never gets the chance to log a fake pass. Pure —
 * `presentManifests` is the caller's own directory listing (this function does no I/O itself).
 *
 * Only rules ②③ carry REJECT authority: ② too few execution lines (< 2) — `degenerate-too-short`;
 * ③ every execution line is an unconditional pass (echo/true/:/exit 0 only) — `degenerate-always-pass`.
 * Rule ④ is WARN-only (P2 scope-limited exception, iter 3 architect BL-N1): a script that calls
 * `node --test` (or any other runner) directly, with zero package-manager tokens, is a completely
 * legitimate script that would be wrongly rejected if ④ carried reject authority. Widening the
 * token list to accommodate it would make the check meaningless, so ④
 * observes rather than judges: a present-but-silent manifest gets one warning line, judgment is
 * left to the human audit (post-craft's Adversarial Class "결정적 체크의 형해화"). No manifests at
 * all skips rule ④ entirely (not even a warning).
 */
export function evaluateCheckScriptShape(scriptText: string, presentManifests: readonly string[]): CheckScriptShape {
	const executionLines = extractExecutionLines(scriptText);
	const warnings: string[] = [];

	if (executionLines.length < 2) {
		return { verdict: "reject", reason: "degenerate-too-short", warnings };
	}
	if (executionLines.every(line => TRIVIAL_EXECUTION_LINE_RE.test(line))) {
		return { verdict: "reject", reason: "degenerate-always-pass", warnings };
	}

	const expectedTokenSets = presentManifests
		.map(name => MANIFEST_RUNNER_TOKENS[name])
		.filter((tokens): tokens is readonly string[] => tokens !== undefined);
	if (expectedTokenSets.length > 0) {
		const anyTokenPresent = expectedTokenSets.some(tokens => tokens.some(token => new RegExp(`\\b${token}\\b`).test(scriptText)));
		if (!anyTokenPresent) {
			const allTokens = [...new Set(expectedTokenSets.flat())].join(", ");
			warnings.push(
				`the project has a manifest whose expected runner token was not found in the script text (checked: ${allTokens}) — ` +
					"verify this is intentional (calling a runner directly without a package manager is a legitimate pattern) " +
					"and note the reason in the script's own comments.",
			);
		}
	}

	return { verdict: "ok", warnings };
}

/** Human-facing rejection text for a `evaluateCheckScriptShape` reject verdict — names the violation and instructs re-authoring, never writes a log (a formalized script must not leave freshness evidence). */
export function checkScriptRejectText(reason: CheckScriptRejectReason): string {
	const detail =
		reason === "degenerate-too-short"
			? "fewer than 2 real execution line(s) (only shebang/comments/blank lines/a bare `set`/`cd` line found)"
			: "every execution line is an unconditional pass (echo/true/:/exit 0 only)";
	return (
		`lets-craft: check/run_check.sh looks degenerate (${reason}) — ${detail}. It cannot back a real check result. ` +
		"Re-author check/run_check.sh to actually run the project's build/lint/typecheck/test commands."
	);
}

/** Post-execution gate (E3, AC11 rule ①): a completely empty transcript (both halves blank) means no real command ever ran, however the exit code reads — `pi.exec`'s `ExecResult` exposes only stdout/stderr/code/killed (no child-process count), so this is the achievable equivalent of "zero child processes". */
export function isEmptyCheckTranscript(stdout: string, stderr: string): boolean {
	return stdout.trim().length === 0 && stderr.trim().length === 0;
}

export interface RunFeatureCheckArgs {
	feature: string;
	scriptPath: string;
	/** The script's own text, read once by the caller (also the pre-lint's input) so the transcript's sha256/full-text block never re-reads a possibly-changed file. */
	scriptText: string;
	/** cwd the script actually runs in: worktree root if `--worktree` was used, else the project root. */
	execCwd: string;
	logsDir: string;
	timeoutMs?: number;
	exec: ExecFn;
}

export interface RunFeatureCheckResult {
	details: RunCheckDetails;
	text: string;
}

/**
 * Core run_check.sh execution: exec the script, persist the transcript (script sha256 + full text,
 * then stdout/stderr/exit — completion 강화책①) to check/logs/check-N.log, and derive a pass/fail
 * verdict + structured failure summary. Pure with respect to craft state — callers decide what to
 * do with the result (the tool wrapper below applies the non-degeneracy gates and composes the
 * final result text).
 */
export async function runFeatureCheck(args: RunFeatureCheckArgs): Promise<RunFeatureCheckResult> {
	const result = await args.exec("bash", [args.scriptPath], { cwd: args.execCwd, timeout: args.timeoutMs });

	mkdirSync(args.logsDir, { recursive: true });
	const logNumber = nextLogNumber(args.logsDir);
	const logPath = join(args.logsDir, `check-${logNumber}.log`);
	const scriptDigest = createHash("sha256").update(args.scriptText).digest("hex");
	const transcript = [
		`$ bash ${args.scriptPath}`,
		`cwd: ${args.execCwd}`,
		`script sha256: ${scriptDigest}`,
		"--- script ---",
		args.scriptText,
		"--- stdout ---",
		result.stdout,
		"--- stderr ---",
		result.stderr,
		`--- exit ${result.code}${result.killed ? " (killed)" : ""} ---`,
	].join("\n");
	writeFileSync(logPath, transcript);

	const passed = result.code === 0 && !result.killed;
	const failureLines = passed ? [] : extractFailureLines(`${result.stdout}\n${result.stderr}`);
	const details: RunCheckDetails = {
		feature: args.feature,
		passed,
		exitCode: result.code,
		killed: result.killed,
		logPath,
		failureLines,
		stdout: result.stdout,
		stderr: result.stderr,
	};

	const text = passed
		? `lets-craft: run_check.sh passed (exit 0). Log: ${logPath}.`
		: `lets-craft: run_check.sh FAILED (exit ${result.code}${result.killed ? ", killed" : ""}).${
				failureLines.length > 0 ? ` ${failureLines.length} failure line(s):\n${failureLines.join("\n")}\n` : " "
			}Full log: ${logPath}.`;

	return { details, text };
}

/** Structured failure summary handed to the next reader. */
export function failureSummaryFor(details: RunCheckDetails): string | undefined {
	if (details.passed) return undefined;
	if (details.failureLines.length > 0) return details.failureLines.join("\n");
	return `run_check.sh exited ${details.exitCode}${details.killed ? " (killed)" : ""} — see ${details.logPath}.`;
}

export type RunCheckTarget =
	| { mode: "run"; root: string; auditEvidenceOnly: boolean }
	| { mode: "refuse"; text: string };

/**
 * Decide how (or whether) `lsc_run_check` should proceed for `feature` (B-1 follow-up, review
 * NEEDS-FIX HIGH). A single `"run"` mode covers both the case this session holds `feature` as
 * its exact active craft, and the case it doesn't but a persisted craft state exists —
 * `auditEvidenceOnly` distinguishes the two only for the result text (see `performRunCheck`),
 * since neither case has any loop bookkeeping left to mutate. In the latter case, `run_check.sh`
 * still executes and `check/logs/check-N.log` is still written — the ONLY producer of that log,
 * and post-craft's sole source of `lsc_audit_validate`'s cycle-freshness evidence (verdict.ts).
 * Before this mode existed, post-craft's own common path (it never calls `lsc_craft_init`,
 * skills/post-craft/SKILL.md §1.5) meant this tool ALWAYS refused here, so no fresh check-N.log
 * could ever exist after an audit cycle began and `validateAuditFreshness` would always reject an
 * APPROVE-family verdict as `"stale-log"` — this mode is what actually makes cycle-freshness
 * reachable in the common case, not just the rare one where post-craft happens to run inside the
 * same session that just finished `craft`.
 *
 * Root-source priority (m2): an exact active-craft match wins — its root is
 * `activeCraft.worktreeRoot ?? activeCraft.projectRoot` — and only when there is none (or it's a
 * DIFFERENT feature's craft) does the persisted state's root (`persisted.worktreeRoot ?? persisted.projectRoot`)
 * apply. This order must never invert: flipping it would make a run right after `craft` finishes
 * in the same session use a stale on-disk root instead of the live in-memory one. No persisted
 * state at all still refuses exactly as before (verbatim message — C8 compatibility).
 *
 * Safety of relaxing the former "must be the active craft" gate: the only thing that gate
 * protected was knowing SOME root to execute against — persisted state supplies the exact same
 * root an active craft would have. It does NOT gate the trusted-exec channel (both cases still
 * run through the same `pi.exec`, never the LLM's own bash tool) — so `auditEvidenceOnly`
 * introduces no new bypass there.
 */
export function resolveRunCheckTarget(feature: string, activeCraft: CraftState | undefined, persisted: CraftState | undefined): RunCheckTarget {
	if (activeCraft && activeCraft.feature === feature) {
		return { mode: "run", root: activeCraft.worktreeRoot ?? activeCraft.projectRoot, auditEvidenceOnly: false };
	}
	if (persisted) {
		return { mode: "run", root: persisted.worktreeRoot ?? persisted.projectRoot, auditEvidenceOnly: true };
	}
	return { mode: "refuse", text: `lets-craft: no active craft for "${feature}". Call lsc_craft_init first.` };
}

export interface PerformRunCheckArgs {
	feature: string;
	activeCraft: CraftState | undefined;
	persisted: CraftState | undefined;
	timeoutMs?: number;
	exec: ExecFn;
}

/**
 * Core `lsc_run_check` logic, extracted from the registerTool wrapper so it is directly
 * unit-testable with a fake `ExecFn` and real temp directories — no ExtensionAPI/pi.zod mocking
 * required (mirrors runFeatureCheck's own split, and abort.ts's performX pattern). Branches on
 * `resolveRunCheckTarget`'s decision, applies the pre-execution non-degeneracy lint BEFORE ever
 * calling `runFeatureCheck` (E3 rules ②③④ — a reject writes no log), then the post-execution
 * empty-transcript gate AFTER it (E3 rule ①).
 */
export async function performRunCheck(args: PerformRunCheckArgs): Promise<AgentToolResult<RunCheckDetails>> {
	const target = resolveRunCheckTarget(args.feature, args.activeCraft, args.persisted);
	if (target.mode === "refuse") {
		return { isError: true, content: [{ type: "text", text: target.text }] };
	}

	const root = target.root;
	const scriptPath = craftCheckScriptPath(root, args.feature);
	if (!existsSync(scriptPath)) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: `lets-craft: check/run_check.sh not found at ${scriptPath}. post-craft's test-authoring step must author check/run_check.sh first.`,
				},
			],
		};
	}

	const scriptText = readFileSync(scriptPath, "utf8");
	const presentManifests = RECOGNIZED_MANIFEST_NAMES.filter(name => existsSync(join(root, name)));
	const shape = evaluateCheckScriptShape(scriptText, presentManifests);
	if (shape.verdict === "reject") {
		return { isError: true, content: [{ type: "text", text: checkScriptRejectText(shape.reason) }] };
	}

	let outcome: RunFeatureCheckResult;
	try {
		outcome = await runFeatureCheck({
			feature: args.feature,
			scriptPath,
			scriptText,
			execCwd: root,
			logsDir: craftCheckLogsDir(root, args.feature),
			timeoutMs: args.timeoutMs,
			exec: args.exec,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			isError: true,
			content: [{ type: "text", text: `lets-craft: run_check.sh failed to execute — ${message}. Escalate to the user.` }],
		};
	}

	if (isEmptyCheckTranscript(outcome.details.stdout, outcome.details.stderr)) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text:
						`lets-craft: run_check.sh produced no output at all (empty-transcript) despite exit ${outcome.details.exitCode} — a ` +
						`script that never ran a real command cannot back a check result. Log: ${outcome.details.logPath}. Re-author check/run_check.sh.`,
				},
			],
		};
	}

	const warningText = shape.warnings.length > 0 ? `\n\n${shape.warnings.map(warning => `[WARN] ${warning}`).join("\n")}` : "";

	if (target.auditEvidenceOnly) {
		const text =
			`${outcome.text}\n\n[Audit Evidence Mode] No active craft matched "${args.feature}" this session — check/logs/check-N.log ` +
			`was still written (post-craft's lsc_audit_validate cycle-freshness evidence).${warningText}`;
		return { content: [{ type: "text", text }], details: outcome.details };
	}

	return { content: [{ type: "text", text: `${outcome.text}${warningText}` }], details: outcome.details };
}

/** Register `lsc_run_check`. */
export function registerRunCheckTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
		timeout_ms: z.number().optional().describe("Optional exec timeout in milliseconds."),
	});

	// Explicit type arguments (not left to inference) avoid a TS2589 "excessively
	// deep" instantiation against this SDK's TSchema union — see the module doc comment above.
	pi.registerTool<typeof parameters, RunCheckDetails>({
		name: "lsc_run_check",
		loadMode: "discoverable",
		label: "Craft: run check/run_check.sh",
		description:
			"Run the feature's post-craft-authored check/run_check.sh (the build/lint/typecheck/test single entrypoint) " +
			"in the correct source root (the worktree, if --worktree was used, else the project root) via a trusted exec " +
			"— never the LLM's own bash tool. Rejects (isError) a degenerate/formalized script before ever running it " +
			"(too few execution lines, or every execution line an unconditional pass), and rejects a completed run whose " +
			"transcript is entirely empty even on exit 0 — neither can back a real check result. Saves the full " +
			"transcript (with the script's own sha256 + full text) to check/logs/check-N.log and returns a pass/fail " +
			"verdict plus a best-effort structured failure summary. Works even without an active craft matching this " +
			"session (\"audit-evidence mode\") as long as a persisted craft state exists — this is post-craft's primary " +
			"source of cycle-freshness evidence for lsc_audit_validate (B-1).",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RunCheckDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			const activeCraft = getActiveCraft();
			const persisted = findPersistedCraftState(ctx.cwd, feature);
			return performRunCheck({ feature, activeCraft, persisted, timeoutMs: params.timeout_ms, exec: pi.exec });
		},
	});
}
