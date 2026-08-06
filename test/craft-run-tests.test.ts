import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { craftRunTestScriptPath, craftTestDir } from "../src/artifacts/paths";
import { extractFailureLines, failureSummaryFor, nextLogNumber, performRunTests, resolveRunTestsTarget, runFeatureTests } from "../src/craft/run-tests";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-runtests-project-"));
	tempDirs.push(dir);
	return dir;
}

function tmpLogsDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-runtests-"));
	tempDirs.push(dir);
	return dir;
}

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

describe("nextLogNumber", () => {
	it("starts at 1 when the logs dir does not exist", () => {
		expect(nextLogNumber(join(tmpdir(), "lsc-does-not-exist-xyz"))).toBe(1);
	});

	it("increments past the highest existing run-N.log", async () => {
		const logsDir = tmpLogsDir();
		await runFeatureTests({
			feature: "f",
			scriptPath: "/fake/run_test.sh",
			execCwd: "/fake",
			logsDir,
			exec: async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }),
		});
		await runFeatureTests({
			feature: "f",
			scriptPath: "/fake/run_test.sh",
			execCwd: "/fake",
			logsDir,
			exec: async () => ({ stdout: "ok", stderr: "", code: 0, killed: false }),
		});
		const logs = readdirSync(logsDir).sort();
		expect(logs).toEqual(["run-1.log", "run-2.log"]);
	});
});

describe("runFeatureTests", () => {
	it("writes the full transcript to run-N.log and reports pass on exit 0", async () => {
		const logsDir = tmpLogsDir();
		const { details, text } = await runFeatureTests({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/test/run_test.sh",
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
	});

	it("reports failure + extracted failure lines on a non-zero exit", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureTests({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/test/run_test.sh",
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
		const { details } = await runFeatureTests({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/test/run_test.sh",
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "", stderr: "", code: 2, killed: false }),
		});

		expect(details.failureLines).toEqual([]);
		expect(failureSummaryFor(details)).toContain("exited 2");
	});

	it("treats a killed process as a failure even with exit code 0", async () => {
		const logsDir = tmpLogsDir();
		const { details } = await runFeatureTests({
			feature: "my-feature",
			scriptPath: "/repo/.lsc/crafts/my-feature/test/run_test.sh",
			execCwd: "/repo",
			logsDir,
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: true }),
		});

		expect(details.passed).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// B-1 review NEEDS-FIX HIGH: lsc_run_tests must not be gated on an exact active-craft match in the
// common post-craft path (post-craft never calls lsc_craft_init, skills/post-craft/SKILL.md §1.5) —
// otherwise a fresh test/logs/run-N.log can never exist after an audit cycle begins, and
// validateAuditFreshness (verdict.ts) always rejects an APPROVE-family verdict as stale.
// ---------------------------------------------------------------------------

function freshCraftState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

describe("resolveRunTestsTarget (B-1)", () => {
	it("prefers an exact active-craft match, regardless of any persisted state", () => {
		const active = freshCraftState("/active-root", "my-feature");
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunTestsTarget("my-feature", active, persisted)).toEqual({ mode: "run", root: "/active-root", auditEvidenceOnly: false });
	});

	it("uses the active craft's worktreeRoot over projectRoot when both are set", () => {
		const active: CraftState = { ...freshCraftState("/project-root"), worktreeRoot: "/worktree-root" };
		expect(resolveRunTestsTarget("my-feature", active, undefined)).toEqual({ mode: "run", root: "/worktree-root", auditEvidenceOnly: false });
	});

	it("falls back to audit-evidence-only when no active craft matches but persisted state exists (no open-release)", () => {
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunTestsTarget("my-feature", undefined, persisted)).toEqual({ mode: "run", root: "/persisted-root", auditEvidenceOnly: true });
	});

	it("falls back to audit-evidence-only when an active craft exists for a DIFFERENT feature (never contaminates it)", () => {
		const active = freshCraftState("/active-root", "other-feature");
		const persisted = freshCraftState("/persisted-root", "my-feature");
		expect(resolveRunTestsTarget("my-feature", active, persisted)).toEqual({ mode: "run", root: "/persisted-root", auditEvidenceOnly: true });
	});

	it("refuses with the open-release re-baseline guidance when persisted state carries an unclosed open-release", () => {
		const persisted: CraftState = {
			...freshCraftState("/persisted-root", "my-feature"),
			openRelease: { nonce: "n", tag: "[Canon Amendment]", question: "q", response: "yes", reason: "r", openedAt: "2026-01-01T00:00:00.000Z" },
		};
		const result = resolveRunTestsTarget("my-feature", undefined, persisted);
		expect(result.mode).toBe("refuse");
		expect(result.mode === "refuse" && result.text).toContain("OPEN release window");
	});

	it("refuses with the legacy no-active-craft message when there is no persisted state at all", () => {
		expect(resolveRunTestsTarget("my-feature", undefined, undefined)).toEqual({
			mode: "refuse",
			text: 'lets-craft: no active craft for "my-feature". Call lsc_craft_init first.',
		});
	});
});

describe("performRunTests (B-1, tool-execute-level)", () => {
	function seedScript(root: string, feature: string, script = "#!/bin/sh\necho ok\n"): void {
		mkdirSync(craftTestDir(root, feature), { recursive: true });
		writeFileSync(craftRunTestScriptPath(root, feature), script);
	}

	const passExec = async () => ({ stdout: "3 passed", stderr: "", code: 0, killed: false });

	afterEach(() => clearActiveCraft());

	it("an exact active-craft match: runs the script and never mentions audit-evidence mode", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		setActiveCraft(freshCraftState(root, feature));

		const result = await performRunTests({ feature, activeCraft: getActiveCraft(), persisted: undefined, exec: passExec });

		expect(result.isError).toBeFalsy();
		expect((result.content[0] as { text: string }).text).not.toContain("[Audit Evidence Mode]");
		expect((result.content[0] as { text: string }).text).toContain("passed");
	});

	it("audit-evidence-only: runs the script and writes run-N.log without creating an active craft", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		seedScript(root, feature);
		const persisted = freshCraftState(root, feature);

		const result = await performRunTests({ feature, activeCraft: undefined, persisted, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("[Audit Evidence Mode]");
		expect(getActiveCraft()).toBeUndefined(); // no active craft to mutate, and none was created
		const logNames = readdirSync(join(craftTestDir(root, feature), "logs"));
		expect(logNames).toContain("run-1.log"); // the log run-tests.ts's own numbering owns was still written
	});

	it("audit-evidence-only never contaminates a DIFFERENT feature's active craft", async () => {
		const root = tmpProject();
		seedScript(root, "my-feature");
		const otherActive = freshCraftState(root, "other-feature");
		setActiveCraft(otherActive);
		const persisted = freshCraftState(root, "my-feature");

		const result = await performRunTests({ feature: "my-feature", activeCraft: getActiveCraft(), persisted, exec: passExec });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe("other-feature"); // untouched by my-feature's audit-evidence run
	});

	it("'refuse' mode never calls exec at all (e.g. no persisted state)", async () => {
		const exec = async (): Promise<never> => {
			throw new Error("exec must not be called when refusing");
		};
		const result = await performRunTests({ feature: "my-feature", activeCraft: undefined, persisted: undefined, exec });
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("no active craft");
	});
});
