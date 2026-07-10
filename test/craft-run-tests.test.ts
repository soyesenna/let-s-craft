import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractFailureLines, failureSummaryFor, nextLogNumber, runFeatureTests } from "../src/craft/run-tests";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

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
