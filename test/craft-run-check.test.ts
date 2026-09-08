import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as zod from "zod/v4";
import { craftCheckDir, craftCheckLogsDir, craftCheckScriptPath, worktreePath } from "../src/artifacts/paths";
import {
	checkScriptRejectText,
	registerRunCheckTool,
	evaluateCheckScriptShape,
	extractExecutionLines,
	extractFailureLines,
	MAX_FAILURE_LINE_CHARS,
	MAX_FAILURE_SUMMARY_CHARS,
	failureSummaryFor,
	isEmptyCheckTranscript,
	nextLogNumber,
	performRunCheck,
	resolveRunCheckTarget,
	runFeatureCheck,
} from "../src/craft/run-check";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";
import { isPassingCheckLog } from "../src/craft/verdict";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-runcheck-project-"));
	tempDirs.push(dir);
	return dir;
}

function tmpLogsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-runcheck-"));
	tempDirs.push(dir);
	return dir;
}

// A valid, non-degenerate default script: 2+ execution lines, not all trivial
// (echo/true/:/exit 0), so it never trips the AC11 pre-lint on its own.
const DEFAULT_SCRIPT = "#!/bin/sh\necho running\nnpm test\n";

describe("extractFailureLines", () => {
	it("keeps only lines that look like failures, echoed ESCAPED through controlSafeEcho (audit-3 RF-34)", () => {
		const output = ["running suite", "PASS a.test.ts", "FAIL b.test.ts", "  Error: expected 1 to be 2", "done"].join("\n");
		expect(extractFailureLines(output)).toEqual(['"FAIL b.test.ts"', '"  Error: expected 1 to be 2"']);
	});

	it("caps the number of lines returned", () => {
		const output = Array.from({ length: 100 }, (_, i) => `Error: case ${i}`).join("\n");
		expect(extractFailureLines(output, 5)).toHaveLength(5);
	});

	it("returns an empty array when nothing matches", () => {
		expect(extractFailureLines("all good\nPASS everything")).toEqual([]);
	});

	it("RF-34: a control-carrying child failure line (DEL/C1/U+2028/lone-CR) reaches the summary ONLY in escaped form", () => {
		const output = ["FAIL a: DEL\u007fpayload", "FAIL b: NEL\u0085payload", "FAIL c: sep\u2028payload", "FAIL d: lone\rcarriage"].join("\n");
		const lines = extractFailureLines(output);
		expect(lines).toEqual(['"FAIL a: DEL\\u007fpayload"', '"FAIL b: NEL\\u0085payload"', '"FAIL c: sep\\u2028payload"', '"FAIL d: lone\\rcarriage"']);
		expect(lines.every(line => !/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/.test(line)), "no raw control character may reach the model-facing summary").toBe(true);
	});

	// audit-4 RF-38(d): a multi-MB single failure line is byte-bounded with a fixed ASCII
	// truncation suffix; the bound applies to the ESCAPED result string.
	it("RF-38(d): a multi-MB single failure line is cut to MAX_FAILURE_LINE_CHARS with a fixed suffix and no raw control character", () => {
		const line = `FAIL: ${"x".repeat(3 * 1024 * 1024)}\u007f`;
		const lines = extractFailureLines(line);
		expect(lines).toHaveLength(1);
		const [summary] = lines;
		expect(summary.length).toBeLessThanOrEqual(MAX_FAILURE_LINE_CHARS + "[truncated 9999999 chars]".length);
		expect(summary.startsWith('"FAIL: ')).toBe(true);
		expect(summary).toContain("[truncated ");
		expect(summary).toContain(" chars]");
		expect(summary).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/); // no raw control anywhere
	});

	it("RF-38(d): many failure lines are summary-bounded — trailing lines drop with a constant suffix", () => {
		const output = Array.from({ length: 100 }, (_, i) => `Error: case ${i} ${"y".repeat(100)}`).join("\n");
		const lines = extractFailureLines(output);
		const last = lines.at(-1);
		expect(last).toMatch(/^\[\d+ more failure line\(s\) truncated\]$/);
		expect(lines.slice(0, -1).join("\n").length).toBeLessThanOrEqual(MAX_FAILURE_SUMMARY_CHARS);
		expect(lines.join("\n").length).toBeLessThanOrEqual(MAX_FAILURE_SUMMARY_CHARS + (last?.length ?? 0) + 1);
	});
});

describe("extractExecutionLines", () => {
	it("excludes the shebang, blank lines, # comments, a standalone set line, and a standalone cd line", () => {
		const scriptText = ["#!/bin/sh", "# a comment", "set -euo pipefail", 'cd "$(dirname "$0")"', "", "echo one", "npm test"].join("\n");
		expect(extractExecutionLines(scriptText)).toEqual(["echo one", "npm test"]);
	});

	it("does not exclude a cd/set token that merely appears mid-line (only a standalone cd/set line is exempt)", () => {
		const scriptText = ["#!/bin/sh", "npm run cd-check", "some-cmd && cd /tmp"].join("\n");
		expect(extractExecutionLines(scriptText)).toEqual(["npm run cd-check", "some-cmd && cd /tmp"]);
	});
});

describe("nextLogNumber", () => {
	it("starts at 1 when the logs dir does not exist", () => {
		expect(nextLogNumber(join(tmpdir(), "lsc-does-not-exist-xyz"))).toBe(1);
	});

	it("increments past the highest existing check-N.log", async () => {
		const logsDir = tmpLogsDir();
		await runFeatureCheck({
			feature: "f",
			scriptPath: "/fake/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/fake",
			logsDir,
			exec: async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }),
		});
		await runFeatureCheck({
			feature: "f",
			scriptPath: "/fake/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/fake",
			logsDir,
			exec: async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }),
		});
		const logs = readdirSync(logsDir).sort();
		expect(logs).toEqual(["check-1.log", "check-2.log"]);
	});
});

describe("runFeatureCheck", () => {
	it("writes the full transcript (script sha256 + full text, then stdout/stderr/exit) to check-N.log and reports pass on exit 0", async () => {
		const logsDir = tmpLogsDir();
		const { details, text } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "3 passed", stderr: "", code: 0, killed: false }),
		});

		expect(details.passed).toBe(true);
		expect(details.exitCode).toBe(0);
		expect(details.failureLines).toEqual([]);
		expect(text).toContain("passed");

		const logContent = readFileSync(details.logPath, "utf8");
		expect(logContent).toContain("3 passed");
		expect(logContent).toContain("cwd: /repo");
		expect(logContent).toContain("script sha256:");
		expect(logContent).toContain("--- script ---");
		expect(logContent).toContain(DEFAULT_SCRIPT);
	});

	it("reports failure + extracted failure lines on a non-zero exit — the summary is ESCAPED while the durable log preserves the raw child output (RF-34)", async () => {
		const logsDir = tmpLogsDir();
		const { details, text } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "1 passed\nFAIL test/b.test.ts: DEL\u007fmarker", stderr: "Error: boom", code: 1, killed: false }),
		});

		expect(details.passed).toBe(false);
		expect(details.exitCode).toBe(1);
		expect(details.failureLines).toContain('"FAIL test/b.test.ts: DEL\\u007fmarker"');
		expect(failureSummaryFor(details)).toContain("FAIL test/b.test.ts");
		// audit-3 RF-34: the model-facing result text carries ONLY the bounded escaped summary...
		expect(text).toContain("\\u007f");
		expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f\u0080-\u009f\u2028\u2029]/); // \n除外: the summary's own line breaks are structural
		const logContent = readFileSync(details.logPath, "utf8");
		expect(logContent).toContain("FAIL test/b.test.ts: DEL\u007fmarker");
	});

	it("falls back to an exit-code summary when no failure lines were extracted", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "", stderr: "", code: 2, killed: false }),
		});

		expect(details.failureLines).toEqual([]);
		expect(failureSummaryFor(details)).toContain("exited 2");
	});

	it("treats a killed process as a failure even with exit code 0", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: true }),
		});

		expect(details.passed).toBe(false);
	});

	// F2 (ordering defect): an empty-transcript exit-0 run's log line must never read as a genuine
	// pass to isPassingCheckLog's freshness regex, even though this function's own `details.passed`
	// is still true here — the empty-transcript REJECT authority lives one layer up in
	// performRunCheck/isEmptyCheckTranscript, not in runFeatureCheck. The log itself must already
	// carry the tell so a fresh-looking-but-fake pass can never back validateLandAuditEvidence.
	it("decorates the exit line so an empty-transcript exit-0 run is never read as a passing check log, mirroring the (killed) idiom", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		});

		const logContent = readFileSync(details.logPath, "utf8");
		expect(logContent).toContain("--- exit 0 (empty-transcript: rejected) ---");
		expect(logContent).not.toMatch(/^--- exit 0 ---$/m);
		expect(isPassingCheckLog(logContent), "an empty-transcript log must never be read as a genuine passing check log").toBe(false);
	});

	// F5 — post-exec rehash: the pre-lint (evaluateCheckScriptShape) judges the script text read
	// BEFORE exec; these two tests pin that a self-modification during the run is surfaced (both log
	// and result text), and that the ordinary unmodified case says so explicitly too.
	it("F5: flags a script whose on-disk content changed during execution, in both the log and result text", async () => {
		const logsDir = tmpLogsDir();
		const scriptDir = mkdtempSync(join(tmpdir(), "lsc-selfmod-"));
		tempDirs.push(scriptDir);
		const scriptPath = join(scriptDir, "run_check.sh");
		writeFileSync(scriptPath, DEFAULT_SCRIPT);

		const { details, text } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath,
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => {
				// Simulate the script rewriting itself mid-run: the file on disk after exec no longer
				// matches the text the pre-lint actually evaluated.
				writeFileSync(scriptPath, `${DEFAULT_SCRIPT}\necho self-modified\n`);
				return { stdout: "3 passed", stderr: "", code: 0, killed: false };
			},
		});

		expect(details.passed, "self-modification is an audit-trail flag, not a new reject rule").toBe(true);
		expect(text).toContain("[NOTE]");
		expect(text).toContain("changed during execution");
		const logContent = readFileSync(details.logPath, "utf8");
		expect(logContent).toMatch(/post-exec script sha256: [0-9a-f]{64} \(CHANGED from pre-exec [0-9a-f]{64}/);
	});

	it("F5: records 'unchanged' when the script's on-disk content is untouched by execution", async () => {
		const logsDir = tmpLogsDir();
		const scriptDir = mkdtempSync(join(tmpdir(), "lsc-unmod-"));
		tempDirs.push(scriptDir);
		const scriptPath = join(scriptDir, "run_check.sh");
		writeFileSync(scriptPath, DEFAULT_SCRIPT);

		const { details, text } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath,
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "3 passed", stderr: "", code: 0, killed: false }),
		});

		expect(text).not.toContain("[NOTE]");
		const logContent = readFileSync(details.logPath, "utf8");
		expect(logContent).toMatch(/post-exec script sha256: [0-9a-f]{64} \(unchanged\)/);
	});

	// audit-4 RF-38(e): the raw exec halves leave the public details — they live ONLY on
	// RunFeatureCheckResult.transcript and inside the durable check-N.log.
	it("RF-38(e): details carries NO stdout/stderr key; the raw halves ride result.transcript and the durable log", async () => {
		const logsDir = tmpLogsDir();
		const outcome = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "raw\u007fout", stderr: "err\u2028half", code: 1, killed: false }),
		});

		expect(outcome.details, "no raw exec half may ride the public details").not.toHaveProperty("stdout");
		expect(outcome.details).not.toHaveProperty("stderr");
		expect(Object.keys(outcome.details).sort()).toEqual(["exitCode", "failureLines", "feature", "killed", "logPath", "passed"]);
		expect(outcome.transcript).toEqual({ stdout: "raw\u007fout", stderr: "err\u2028half" }); // isEmptyCheckTranscript's input
		expect(readFileSync(outcome.details.logPath, "utf8")).toContain("raw\u007fout"); // the durable log keeps the raw bytes
	});
});

describe("isEmptyCheckTranscript", () => {
	it("is true when both stdout and stderr are blank (whitespace-only counts as blank)", () => {
		expect(isEmptyCheckTranscript("", "")).toBe(true);
		expect(isEmptyCheckTranscript("   \n", "\t")).toBe(true);
	});

	it("is false when either half has real content", () => {
		expect(isEmptyCheckTranscript("something", "")).toBe(false);
		expect(isEmptyCheckTranscript("", "something")).toBe(false);
	});
});

describe("checkScriptRejectText", () => {
	it("names the specific violation for each reject reason and instructs re-authoring run_check.sh", () => {
		expect(checkScriptRejectText("degenerate-too-short")).toMatch(/fewer than 2/);
		expect(checkScriptRejectText("degenerate-too-short")).toMatch(/run_check\.sh/);
		expect(checkScriptRejectText("degenerate-always-pass")).toMatch(/unconditional pass/);
	});
});

// ---------------------------------------------------------------------------
// AC11 — lsc_run_check non-degeneracy gate (E3). Reject authority lives in rules
// ①②③; rule ④ is WARN-only (P2 scope-limited exception, iter 3 architect BL-N1).
// Rule ① (empty transcript) is a post-execution gate owned by isEmptyCheckTranscript
// + performRunCheck (tested further down); ②③④⑤⑥ are the pure pre-lint,
// evaluateCheckScriptShape, tested directly here.
// ---------------------------------------------------------------------------
describe("evaluateCheckScriptShape (AC11 — non-degeneracy pre-lint)", () => {
	it("② rejects a script with fewer than 2 execution lines as degenerate-too-short", () => {
		const scriptText = "#!/bin/sh\necho ok\n"; // shebang + exactly 1 execution line
		expect(evaluateCheckScriptShape(scriptText, [])).toEqual({ verdict: "reject", reason: "degenerate-too-short", warnings: [] });
	});

	it("③ rejects a script whose execution lines are all unconditional passes (echo/true/:/exit 0) as degenerate-always-pass", () => {
		const scriptText = "#!/bin/sh\necho step one\necho step two\ntrue\nexit 0\n";
		expect(evaluateCheckScriptShape(scriptText, [])).toEqual({ verdict: "reject", reason: "degenerate-always-pass", warnings: [] });
	});

	it("④ WARNs (does not reject) when a present manifest's expected runner tokens are entirely absent from the script", () => {
		const scriptText = "#!/bin/sh\necho building\nnode build.js\n";
		const shape = evaluateCheckScriptShape(scriptText, ["package.json"]);
		expect(shape.verdict).toBe("ok");
		expect(shape.warnings).toHaveLength(1);
		expect(shape.warnings[0]).toMatch(/npm/);
	});

	it("④ does not warn when the present manifest's expected token IS found in the script", () => {
		const scriptText = "#!/bin/sh\necho testing\nnpm test\n";
		expect(evaluateCheckScriptShape(scriptText, ["package.json"])).toEqual({ verdict: "ok", warnings: [] });
	});

	it("⑤ skips rule ④ entirely (no warning) when no manifests are present at all", () => {
		const scriptText = "#!/bin/sh\necho building\nnode build.js\n"; // same shape as the ④ WARN case above
		expect(evaluateCheckScriptShape(scriptText, [])).toEqual({ verdict: "ok", warnings: [] });
	});

	it("⑥ regression: a script isomorphic to sample-ts-cli's historical single-entrypoint shape (set -uo pipefail + cd + node --test + status-branch echo + exit \"$status\") passes without rejection", () => {
		const scriptText = [
			"#!/usr/bin/env bash",
			"set -uo pipefail",
			'cd "$(dirname "$0")"',
			"",
			'echo "=== sample-ts-cli: node --test ==="',
			"node --test",
			"status=$?",
			"",
			"echo",
			'if [ "$status" -eq 0 ]; then',
			'\techo "=== RESULT: all tests passed ==="',
			"else",
			'\techo "=== RESULT: FAILURES DETECTED (node --test exit $status) ==="',
			"fi",
			"",
			'exit "$status"',
		].join("\n");

		// This fixture calls `node --test` directly and contains zero npm/pnpm/yarn/bun tokens —
		// the exact case that demoted rule ④ from reject to WARN-only (R12-b / BL-B). A WARN is
		// acceptable when package.json is present; a REJECT never is, regardless of manifests.
		expect(evaluateCheckScriptShape(scriptText, ["package.json"]).verdict).toBe("ok");
		expect(evaluateCheckScriptShape(scriptText, [])).toEqual({ verdict: "ok", warnings: [] });
	});
});

// ---------------------------------------------------------------------------
// B-1 review NEEDS-FIX HIGH: lsc_run_check must not be gated on an exact active-craft match in the
// common post-craft path (post-craft never calls lsc_craft_init, skills/post-craft/SKILL.md §1.5) —
// otherwise a fresh check/logs/check-N.log can never exist after an audit cycle begins, and
// validateAuditFreshness (verdict.ts) always rejects an APPROVE-family verdict as stale.
// ---------------------------------------------------------------------------

function freshCraftState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

describe("resolveRunCheckTarget (B-1)", () => {
	it("prefers an exact active-craft match, regardless of any persisted state", () => {
		const active = freshCraftState("/active-root", "my-feature");
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunCheckTarget("my-feature", active, persisted)).toEqual({ mode: "run", root: "/active-root", auditEvidenceOnly: false });
	});

	it("uses the active craft's worktreeRoot over projectRoot when both are set", () => {
		const active: CraftState = { ...freshCraftState("/project-root"), worktreeRoot: "/worktree-root" };
		expect(resolveRunCheckTarget("my-feature", active, undefined)).toEqual({ mode: "run", root: "/worktree-root", auditEvidenceOnly: false });
	});

	it("falls back to audit-evidence-only when no active craft matches but persisted state exists (no open-release)", () => {
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunCheckTarget("my-feature", undefined, persisted)).toEqual({ mode: "run", root: "/persisted-root", auditEvidenceOnly: true });
	});

	it("falls back to audit-evidence-only when an active craft exists for a DIFFERENT feature (never contaminates it)", () => {
		const active = freshCraftState("/active-root", "other-feature");
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunCheckTarget("my-feature", active, persisted)).toEqual({ mode: "run", root: "/persisted-root", auditEvidenceOnly: true });
	});

	it("refuses with the legacy no-active-craft message when there is no persisted state at all", () => {
		expect(resolveRunCheckTarget("my-feature", undefined, undefined)).toEqual({
			mode: "refuse",
			text: 'lets-craft: no active craft for "my-feature". Call lsc_craft_init first.',
		});
	});
});

describe("performRunCheck (B-1 target resolution + AC11 non-degeneracy gates, tool-execute-level)", () => {
	function seedScript(root: string, feature: string, script = DEFAULT_SCRIPT): void {
		mkdirSync(craftCheckDir(root, feature), { recursive: true });
		writeFileSync(craftCheckScriptPath(root, feature), script);
	}

	const passExec = async () => ({ stdout: "3 passed", stderr: "", code: 0, killed: false });

	afterEach(() => clearActiveCraft());

	it("an exact active-craft match: runs the script and never mentions audit-evidence mode", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		setActiveCraft(freshCraftState(root, feature));

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: passExec });

		expect(result.isError).toBeFalsy();
		expect((result.content[0] as { text: string }).text).not.toContain("[Audit Evidence Mode]");
		expect((result.content[0] as { text: string }).text).toContain("passed");
	});

	it("audit-evidence-only: runs the script and writes check-N.log without creating an active craft", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		const persisted = freshCraftState(root, feature);

		const result = await performRunCheck({ feature, activeCraft: undefined, persisted, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("[Audit Evidence Mode]");
		expect(getActiveCraft()).toBeUndefined(); // no active craft to mutate, and none was created
		const logNames = readdirSync(craftCheckLogsDir(root, feature));
		expect(logNames).toContain("check-1.log"); // the log run-check.ts's own numbering owns was still written
	});

	it("audit-evidence-only never contaminates a DIFFERENT feature's active craft", async () => {
		const root = tmpProject();
		seedScript(root, "my-feature");
		const otherActive = freshCraftState(root, "other-feature");
		setActiveCraft(otherActive);
		const persisted = freshCraftState(root, "my-feature");

		const result = await performRunCheck({ feature: "my-feature", activeCraft: getActiveCraft(), persisted, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe("other-feature"); // untouched by my-feature's audit-evidence run
	});

	it("'refuse' mode never calls exec at all (e.g. no persisted state)", async () => {
		const exec = async (): Promise<never> => {
			throw new Error("exec must not be called when refusing");
		};
		const result = await performRunCheck({ feature: "my-feature", activeCraft: undefined, persisted: undefined, exec });
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("no active craft");
	});

	it("errors clearly (without calling exec) when check/run_check.sh does not exist yet", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		setActiveCraft(freshCraftState(root, feature)); // no seedScript() call — script is absent
		const exec = async (): Promise<never> => {
			throw new Error("exec must not be called when the script is missing");
		};

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec });

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("check/run_check.sh not found");
	});

	it("AC11 ②③: the pre-execution lint rejects a degenerate script BEFORE ever calling exec — no log is written", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature, "#!/bin/sh\necho ok\n"); // 1 execution line → degenerate-too-short
		setActiveCraft(freshCraftState(root, feature));
		const exec = async (): Promise<never> => {
			throw new Error("exec must not be called when the pre-lint rejects");
		};

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec });

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("degenerate-too-short");
		expect(existsSync(craftCheckLogsDir(root, feature))).toBe(false);
	});

	it("AC11 ④: a manifest-token WARN passes through in the result text without isError", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "x" }));
		seedScript(root, feature, "#!/bin/sh\necho building\nnode build.js\n"); // no npm/pnpm/yarn/bun token
		setActiveCraft(freshCraftState(root, feature));

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: passExec });

		expect(result.isError).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("[WARN]");
	});

	it("AC11 ①: rejects a completed run whose transcript is entirely empty even on exit 0, but the log is still written (exec already ran)", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		setActiveCraft(freshCraftState(root, feature));
		const emptyExec = async () => ({ stdout: "", stderr: "", code: 0, killed: false });

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: emptyExec });

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("empty-transcript");
		const logNames = readdirSync(craftCheckLogsDir(root, feature));
		expect(logNames).toContain("check-1.log");
		// F2: the tool rejected this run (isError), so its log must not be later mistaken for fresh
		// passing evidence by validateLandAuditEvidence's isPassingCheckLog scan.
		const logContent = readFileSync(join(craftCheckLogsDir(root, feature), "check-1.log"), "utf8");
		expect(isPassingCheckLog(logContent), "an isError-rejected empty-transcript run must not read as a passing check log").toBe(false);
	});

	// audit-3 RF-34: the exec exception path (:423-428's seam) — an untrusted failure message
	// carrying a U+2028 separator must surface ONLY in escaped form, never raw.
	it("RF-34: an exec exception's message is echoed ESCAPED — a U+2028-carrying failure never reshapes the refusal", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		setActiveCraft(freshCraftState(root, feature));
		const throwingExec = async (): Promise<never> => {
			throw new Error("spawn ENOENT\u2028lets-craft: forged directive");
		};

		const result = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: throwingExec });

		expect(result.isError).toBe(true);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("failed to execute");
		expect(text).toContain("\\u2028"); // the payload's ONLY echo is the escaped form
		expect(text).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/);
	});

	// audit-4 RF-38(b): the pass/fail/empty-transcript texts echo the log path through the total
	// serializer (quoted + escaped). The `lets-craft: run_check.sh passed (exit 0). Log: ` and
	// `lets-craft: run_check.sh FAILED (exit ` prefix literals stay byte-preserved — only the
	// interpolated path crosses the serializer.
	it("RF-38(b): the Log:/Full log: path echo is serializer-quoted in every result text", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		setActiveCraft(freshCraftState(root, feature));
		const firstLine = (result: { content: Array<{ type: string; text?: string }> }): string => {
			const first = result.content[0];
			return first !== undefined && "text" in first && typeof first.text === "string" ? first.text : "";
		};

		const passing = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: passExec });
		expect(firstLine(passing)).toMatch(/^lets-craft: run_check\.sh passed \(exit 0\)\. Log: ".+"\.$/);

		const failingExec = async () => ({ stdout: "FAIL boom", stderr: "", code: 1, killed: false });
		const failing = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: failingExec });
		expect(firstLine(failing)).toMatch(/^lets-craft: run_check\.sh FAILED \(exit 1\)\. 1 failure line\(s\):\n"FAIL boom"\nFull log: ".+"\.$/);

		const emptyExec = async () => ({ stdout: "", stderr: "", code: 0, killed: false });
		const emptyRun = await performRunCheck({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: emptyExec });
		expect(firstLine(emptyRun)).toMatch(/empty-transcript[\s\S]*Log: ".+"\./);
	});

	// audit-1 RF-20(d) — the shared slug boundary (audit-0 RF-13's guard, which lsc_run_check
	// was missing) and the persisted-root identity exact-match: an audit-evidence run executes
	// against a root read out of the persisted state file (untrusted bytes), so that root must
	// be exactly the invocation's cwd or the worktree computed from it.
	it("RF-20(d): a non-slug feature is refused with the shared kebab-slug message before any fs access", async () => {
		// audit-4 RF-38: DEL/C1 axes added so the core slug refusal's (run-check.ts:361)
		// escaped-containment axis is actually discriminated, not just \n/ASCII.
		for (const [forged, escaped] of [
			["bad\nfeature", undefined],
			["Shout Case", undefined],
			["semi;colon", undefined],
			["del\u007ffeature", "\\u007f"],
			["nel\u0085feature", "\\u0085"],
		] as Array<[string, string | undefined]>) {
			const result = await performRunCheck({ feature: forged, activeCraft: undefined, persisted: undefined, exec: passExec });
			expect(result.isError, `feature ${JSON.stringify(forged)} must be refused`).toBe(true);
			const first = result.content[0];
			const text = first !== undefined && "text" in first && typeof first.text === "string" ? first.text : "";
			expect(text).toContain("kebab-case slug");
			expect(text).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/); // escaped echo only
			if (escaped !== undefined) expect(text).toContain(escaped);
		}
	});

	it("RF-20(d): audit-evidence mode refuses a persisted root that is neither cwd nor its computed worktree (foreign root)", async () => {
		const projectRoot = tmpProject();
		const foreignRoot = tmpProject(); // a script exists here, but it is NOT this invocation's root
		const feature = "my-feature";
		seedScript(foreignRoot, feature);
		const persisted = freshCraftState(foreignRoot, feature);

		const result = await performRunCheck({ feature, activeCraft: undefined, persisted, cwd: projectRoot, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBe(true);
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("foreign root");
		// audit-2 RF-24: the refusal now names the claimed IDENTITY (per-field canonical check),
		// not just the projected root — "neither the current directory" is gone.
		expect(text).toContain("not the canonical form for this invocation");
		expect(existsSync(craftCheckLogsDir(foreignRoot, feature)), "무-effect: no check log dir may be created at the foreign root").toBe(false);
	});

	it("RF-20(d): audit-evidence mode accepts the computed worktree root (the real post-craft shape) and runs", async () => {
		const projectRoot = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(projectRoot, feature);
		seedScript(wt, feature);
		const persisted = { ...freshCraftState(projectRoot, feature), worktreeRoot: wt };

		const result = await performRunCheck({ feature, activeCraft: undefined, persisted, cwd: projectRoot, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("[Audit Evidence Mode]");
		expect(readdirSync(craftCheckLogsDir(wt, feature))).toContain("check-1.log");
	});

	it("RF-20(d): audit-evidence mode accepts a persisted root that IS the invocation cwd (legacy non-worktree shape)", async () => {
		const projectRoot = tmpProject();
		const feature = "my-feature";
		seedScript(projectRoot, feature);
		const persisted = freshCraftState(projectRoot, feature);

		const result = await performRunCheck({ feature, activeCraft: undefined, persisted, cwd: projectRoot, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("[Audit Evidence Mode]");
	});
});

// ---------------------------------------------------------------------------
// audit-2 RF-24 — lsc_run_check's registration wrapper: the resolved feature clears the shared
// slug boundary BEFORE findPersistedCraftState (which runs existsSync+decode over the candidate
// state paths — the core's "before ANY fs access" comment was false at the wrapper seam), and
// audit-evidence mode's persisted record must be in the CANONICAL identity form for this
// invocation: feature === requested, projectRoot === ctx.cwd, worktreeRoot absent or exactly
// worktreePath(ctx.cwd, feature). All through the CAPTURED PRODUCTION execute.
// ---------------------------------------------------------------------------

describe("RF-24 — registerRunCheckTool execute: slug guard before any state read + canonical persisted identity", () => {
	afterEach(() => clearActiveCraft());

	type RunCheckExecute = (id: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;

	function captureRunCheckExecute(): { execute: RunCheckExecute; execCalls: number } {
		let execute: RunCheckExecute | undefined;
		const execCounter: { execute?: RunCheckExecute; execCalls: number } = { execCalls: 0 };
		const pi = {
			zod,
			exec: async () => {
				execCounter.execCalls += 1;
				return { stdout: "1 passed", stderr: "", code: 0, killed: false };
			},
			registerTool(definition: unknown): void {
				if (typeof definition === "object" && definition !== null && "name" in definition && (definition as { name?: string }).name === "lsc_run_check" && "execute" in definition && typeof (definition as { execute?: unknown }).execute === "function") {
					execute = (definition as { execute: RunCheckExecute }).execute;
				}
			},
		};
		registerRunCheckTool(pi as unknown as Parameters<typeof registerRunCheckTool>[0]);
		if (!execute) throw new Error("lsc_run_check was not registered");
		execCounter.execute = execute; // the live counter object itself — a spread would freeze execCalls at 0
		return execCounter;
	}

	function firstText(result: { content?: Array<{ type: string; text?: string }> }): string {
		const first = result.content?.[0];
		return first !== undefined && typeof first.text === "string" ? first.text : "";
	}

	/** Persist a state file at the cwd candidate exactly the way findPersistedCraftState reads it. */
	function seedPersistedState(cwd: string, feature: string, state: Record<string, unknown>): string {
		const statePath = join(cwd, ".lsc", "crafts", feature, ".craft-state.json");
		mkdirSync(dirname(statePath), { recursive: true });
		writeFileSync(statePath, JSON.stringify({ stateVersion: 2, feature, projectRoot: cwd, aborted: false, ...state }));
		return statePath;
	}

	it("① an invalid slug is refused at the WRAPPER — the candidate state file is never read (much less decoded), exec never runs, no log is written", async () => {
		const root = tmpProject();
		// A MALFORMED state file sits exactly where the invalid slug's candidate lookup would read:
		// WITHOUT the wrapper guard, findPersistedCraftState decodes it and the execute promise
		// REJECTS (decodeCraftState's JSON.parse throws) — the discriminator that proves the guard.
		// audit-4 RF-38: DEL/C1 axes added so the wrapper refusal's (run-check.ts:502) escaped-
		// containment axis is discriminated at this seam too.
		for (const [forged, escaped] of [
			["bad\nfeature", undefined],
			["del\u007ffeature", "\\u007f"],
			["nel\u0085feature", "\\u0085"],
		] as Array<[string, string | undefined]>) {
			const statePath = join(root, ".lsc", "crafts", forged, ".craft-state.json");
			mkdirSync(dirname(statePath), { recursive: true });
			writeFileSync(statePath, "{ not valid json");
			const runCheck = captureRunCheckExecute();

			const result = await runCheck.execute("t", { feature_dir: forged }, undefined, undefined, { cwd: root });

			expect(result.isError, "the wrapper must return a clean refusal, not a decode throw").toBe(true);
			const text = firstText(result);
			expect(text).toContain("kebab-case slug");
			expect(text).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/); // control-marker 무-raw-payload (escaped echo only)
			if (escaped !== undefined) expect(text).toContain(escaped);
			expect(runCheck.execCalls, "exec must never run").toBe(0);
			expect(existsSync(join(root, ".lsc", "crafts", forged, "check")), "no log dir may be created").toBe(false);
			expect(readFileSync(statePath, "utf8")).toBe("{ not valid json"); // untouched — never read or rewritten
		}
	});

	it.each([
		{
			name: "② persisted.feature !== requested",
			state: (cwd: string) => ({ feature: "other-feature", projectRoot: cwd }),
			escaped: undefined,
		},
		{
			name: "③ persisted.projectRoot is a foreign root carrying a control payload (escaped echo, never raw)",
			state: () => ({ projectRoot: "/tmp/foreign\n--upload-pack=evil\tflag" }),
			escaped: undefined,
		},
		{
			name: "② persisted.worktreeRoot is neither absent nor worktreePath(cwd, feature)",
			state: (cwd: string) => ({ projectRoot: cwd, worktreeRoot: "/tmp/elsewhere-worktree" }),
			escaped: undefined,
		},
		{
			// audit-3 RF-30: the seed gap audit-2 left — the assertion regex already included
			// \u007f but no seed ever carried one, so the JSON.stringify blind spot (raw DEL in
			// the identity echo) was never exercised. DEL on projectRoot fails the canonical check.
			name: "③ persisted.projectRoot carries a raw DEL (U+007F) payload — JSON.stringify's blind spot, escaped through the shared seam (RF-30)",
			state: () => ({ projectRoot: "/tmp/foreign\u007fupload-pack=evil" }),
			escaped: "\\u007f",
		},
		{
			name: "③ persisted.worktreeRoot carries a raw DEL (U+007F) payload — escaped through the shared seam (RF-30)",
			state: (cwd: string) => ({ projectRoot: cwd, worktreeRoot: "/tmp/elsewhere\u007fworktree" }),
			escaped: "\\u007f",
		},
	])("$name", async ({ state, escaped }) => {
		const root = tmpProject();
		seedPersistedState(root, "my-feature", state(root));
		const runCheck = captureRunCheckExecute();

		const result = await runCheck.execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });

		expect(result.isError, JSON.stringify(result)).toBe(true);
		const text = firstText(result);
		expect(text).toContain("foreign root");
		expect(text).toContain("not the canonical form for this invocation");
		// audit-3 RF-30/RF-34: the no-raw class now spans the total serializer's whole repertoire.
		expect(text, "single-line refusal — no raw control character may escape").not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/);
		if (escaped !== undefined) expect(text, "the DEL payload's only echo is the escaped \\u007f form").toContain(escaped);
		if (text.includes("--upload-pack")) expect(text).toContain("\\n"); // the newline-carrying foreign root's echo is escaped
		expect(runCheck.execCalls, "exec must never run against a foreign identity").toBe(0);
		expect(existsSync(craftCheckLogsDir(root, "my-feature")), "no log dir may be created").toBe(false);
	});

	it("a canonical identity still runs through the wrapper (the guard is not a blanket refusal)", async () => {
		const root = tmpProject();
		mkdirSync(craftCheckDir(root, "my-feature"), { recursive: true });
		writeFileSync(craftCheckScriptPath(root, "my-feature"), DEFAULT_SCRIPT);
		seedPersistedState(root, "my-feature", {});
		const runCheck = captureRunCheckExecute();

		const result = await runCheck.execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });

		expect(result.isError, JSON.stringify(result)).toBeFalsy(); // audit-evidence run at the cwd root
		expect(firstText(result)).toContain("[Audit Evidence Mode]");
		expect(runCheck.execCalls).toBe(1);
	});
});
