import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { craftCheckDir, craftCheckLogsDir, craftCheckScriptPath } from "../src/artifacts/paths";
import {
	checkScriptRejectText,
	evaluateCheckScriptShape,
	extractExecutionLines,
	extractFailureLines,
	failureSummaryFor,
	isEmptyCheckTranscript,
	nextLogNumber,
	performRunCheck,
	resolveRunCheckTarget,
	runFeatureCheck,
} from "../src/craft/run-check";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";

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
	it("keeps only lines that look like failures", () => {
		const output = ["running suite", "PASS a.test.ts", "FAIL b.test.ts", "  Error: expected 1 to be 2", "done"].join("\n");
		expect(extractFailureLines(output)).toEqual(["FAIL b.test.ts", "  Error: expected 1 to be 2"]);
	});

	it("caps the number of lines returned", () => {
		const output = Array.from({ length: 100 }, (_, i) => `Error: case ${i}`).join("\n");
		expect(extractFailureLines(output, 5)).toHaveLength(5);
	});

	it("returns an empty array when nothing matches", () => {
		expect(extractFailureLines("all good\nPASS everything")).toEqual([]);
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

	it("reports failure + extracted failure lines on a non-zero exit", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureCheck({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/check/run_check.sh",
			scriptText: DEFAULT_SCRIPT,
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "1 passed\nFAIL test/b.test.ts", stderr: "Error: boom", code: 1, killed: false }),
		});

		expect(details.passed).toBe(false);
		expect(details.exitCode).toBe(1);
		expect(details.failureLines).toContain("FAIL test/b.test.ts");
		expect(failureSummaryFor(details)).toContain("FAIL test/b.test.ts");
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
	});
});
