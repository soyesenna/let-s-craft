import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	composeRunTestsResultText,
	computeFailureSignature,
	extractFailureLines,
	failureSummaryFor,
	nextLogNumber,
	noProgressEscalationText,
	runFeatureTests,
} from "../src/craft/run-tests";
import { clearActiveCraft, recordTestResult, setActiveCraft } from "../src/craft/state";

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

describe("computeFailureSignature (C-1)", () => {
	it("collapses two failure summaries that differ only in volatile tokens (absolute paths, line:col, durations)", () => {
		const a = "FAIL test/slugify.test.ts\n  at /Users/alice/repo/src/slugify.ts:12:34\n  Error: expected 1 to be 2 (123ms)";
		const b = "FAIL test/slugify.test.ts\n  at /Users/bob/other/repo/src/slugify.ts:45:1\n  Error: expected 1 to be 2 (456ms)";
		expect(computeFailureSignature(a)).toBe(computeFailureSignature(b));
	});

	it("strips ANSI color escapes and hex addresses", () => {
		const a = "FAIL test/x.test.ts\n\x1b[31mError: null pointer at 0x1a2b3c\x1b[0m";
		const b = "FAIL test/x.test.ts\nError: null pointer at 0x4d5e6f";
		expect(computeFailureSignature(a)).toBe(computeFailureSignature(b));
	});

	it("produces a different signature when the failing test name differs", () => {
		const a = "FAIL test/slugify.test.ts\nError: boom";
		const b = "FAIL test/other.test.ts\nError: boom";
		expect(computeFailureSignature(a)).not.toBe(computeFailureSignature(b));
	});

	it("produces a different signature when the error message differs", () => {
		const a = "FAIL test/slugify.test.ts\nError: expected foo";
		const b = "FAIL test/slugify.test.ts\nError: expected bar";
		expect(computeFailureSignature(a)).not.toBe(computeFailureSignature(b));
	});

	it("is order-independent over which failing tests were named (sorted set)", () => {
		const a = "FAIL test/b.test.ts\nFAIL test/a.test.ts\nError: boom";
		const b = "FAIL test/a.test.ts\nFAIL test/b.test.ts\nError: boom";
		expect(computeFailureSignature(a)).toBe(computeFailureSignature(b));
	});
});

describe("noProgressEscalationText / composeRunTestsResultText (C-1)", () => {
	it("includes the [No Progress] marker and the consecutive-failure count", () => {
		expect(noProgressEscalationText(3)).toContain("[No Progress]");
		expect(noProgressEscalationText(3)).toContain("3");
	});

	it("composeRunTestsResultText leaves the base text untouched when noProgress is false", () => {
		const text = composeRunTestsResultText("lets-craft: run_test.sh FAILED (exit 1).", { noProgress: false, consecutiveFailures: 1 });
		expect(text).toBe("lets-craft: run_test.sh FAILED (exit 1).");
	});

	it("composeRunTestsResultText appends the [No Progress] notice when noProgress is true", () => {
		const text = composeRunTestsResultText("lets-craft: run_test.sh FAILED (exit 1).", { noProgress: true, consecutiveFailures: 3 });
		expect(text).toContain("lets-craft: run_test.sh FAILED (exit 1).");
		expect(text).toContain("[No Progress]");
	});
});

describe("no-progress integration: recordTestResult -> composeRunTestsResultText (C-1)", () => {
	afterEach(() => clearActiveCraft());

	it("the 3rd consecutive matching-signature failure makes recordTestResult return noProgress:true, and the assembled tool-result text carries the [No Progress] marker", () => {
		setActiveCraft({ feature: "f", projectRoot: tmpProject(), testsPassed: false, aborted: false });

		recordTestResult(false, "run 1", computeFailureSignature("FAIL test/b.test.ts\nError: boom"));
		recordTestResult(false, "run 2", computeFailureSignature("FAIL test/b.test.ts\nError: boom"));
		const record = recordTestResult(false, "run 3", computeFailureSignature("FAIL test/b.test.ts\nError: boom"));

		expect(record).toEqual({ consecutiveFailures: 3, noProgress: true });
		const text = composeRunTestsResultText("lets-craft: run_test.sh FAILED (exit 1).", record);
		expect(text).toContain("[No Progress]");
	});

	it("a genuinely different failure on the 3rd run resets progress and produces no notice", () => {
		setActiveCraft({ feature: "f", projectRoot: tmpProject(), testsPassed: false, aborted: false });

		recordTestResult(false, "run 1", computeFailureSignature("FAIL test/b.test.ts\nError: boom"));
		recordTestResult(false, "run 2", computeFailureSignature("FAIL test/b.test.ts\nError: boom"));
		const record = recordTestResult(false, "run 3", computeFailureSignature("FAIL test/c.test.ts\nError: kaboom"));

		expect(record).toEqual({ consecutiveFailures: 1, noProgress: false });
		const text = composeRunTestsResultText("lets-craft: run_test.sh FAILED (exit 1).", record);
		expect(text).not.toContain("[No Progress]");
	});
});
