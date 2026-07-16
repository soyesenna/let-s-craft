import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftAuditDir, craftTestLogsDir } from "../src/artifacts/paths.js";
import { clearActiveCraft, setActiveCraft, type CraftState } from "../src/craft/state.js";
import { rowText } from "../src/statusbar/render.js";
import {
	gatherCraftProgress,
	latestAuditNumber,
	latestRunNumber,
	parseAuditVerdict,
	renderCraftProgressRow,
	type CraftProgressInput,
} from "../src/statusbar/craft-progress.js";

// ---------------------------------------------------------------------------
// QW7: craft-progress statusbar card. Covers the pure derivations (run-N /
// audit-N max, VERDICT-line parsing, one-line render) plus the thin gather's
// active/inactive/testsPassed-state behavior against real temp directories
// (mirrors test/craft-state.test.ts's setActiveCraft/clearActiveCraft usage).
// ---------------------------------------------------------------------------

describe("latestRunNumber", () => {
	it("returns 0 for an empty directory listing", () => {
		expect(latestRunNumber([])).toBe(0);
	});

	it("returns the highest run-N.log index, ignoring unrelated filenames", () => {
		expect(latestRunNumber(["run-1.log", "run-3.log", "run-2.log", "notes.txt", ".hash-manifest.json"])).toBe(3);
	});

	it("ignores irregular / non-numeric filenames that merely resemble the pattern", () => {
		expect(latestRunNumber(["run-abc.log", "run-.log", "run-1x.log", "run-2.log"])).toBe(2);
	});
});

describe("latestAuditNumber", () => {
	it("returns undefined for an empty directory listing", () => {
		expect(latestAuditNumber([])).toBeUndefined();
	});

	it("returns the highest audit-N.md index, ignoring unrelated filenames", () => {
		expect(latestAuditNumber(["audit-0.md", "audit-2.md", "audit-1.md", "README.md"])).toBe(2);
	});

	it("ignores irregular filenames that merely resemble the pattern", () => {
		expect(latestAuditNumber(["audit-x.md", "audit-.md"])).toBeUndefined();
	});
});

describe("parseAuditVerdict", () => {
	it.each([
		["APPROVE", "**AUDIT VERDICT: APPROVE**\n\nsome body"],
		["APPROVE-WITH-COMMENT", "# Audit\n\n**AUDIT VERDICT: APPROVE-WITH-COMMENT**\n"],
		["APPROVE-WITH-CHANGE", "**AUDIT VERDICT: APPROVE-WITH-CHANGE**"],
		["REJECT", "**AUDIT VERDICT: REJECT**\n"],
	])("parses the %s verdict line", (expected, markdown) => {
		expect(parseAuditVerdict(markdown)).toBe(expected);
	});

	it("does not confuse lsc-critic's own embedded **VERDICT: ...** sub-line for the audit verdict", () => {
		const markdown = ["**AUDIT VERDICT: APPROVE-WITH-COMMENT**", "", "> quoting lsc-critic:", "**VERDICT: REVISE**"].join("\n");
		expect(parseAuditVerdict(markdown)).toBe("APPROVE-WITH-COMMENT");
	});

	it("falls back to undefined when the line is missing", () => {
		expect(parseAuditVerdict("# Audit\n\nno verdict line here")).toBeUndefined();
	});

	it("falls back to undefined on an unrecognized verdict value", () => {
		expect(parseAuditVerdict("**AUDIT VERDICT: MAYBE-LATER**")).toBeUndefined();
	});

	it("never throws on empty or garbage input", () => {
		expect(() => parseAuditVerdict("")).not.toThrow();
		expect(parseAuditVerdict("")).toBeUndefined();
	});
});

describe("renderCraftProgressRow", () => {
	function text(input: CraftProgressInput): string {
		return rowText(renderCraftProgressRow(input));
	}

	it("renders the failing-tests example line", () => {
		expect(text({ feature: "demo", iteration: 3, testsPassed: false, hasFailure: true, auditVerdict: undefined })).toBe(
			"⚒ craft demo · iter 3 · tests failing · audit —",
		);
	});

	it("renders passing tests and a parsed audit verdict", () => {
		expect(text({ feature: "demo", iteration: 5, testsPassed: true, hasFailure: false, auditVerdict: "APPROVE" })).toBe(
			"⚒ craft demo · iter 5 · tests passing · audit APPROVE",
		);
	});

	it("renders a pending state before any test has run", () => {
		expect(text({ feature: "demo", iteration: 0, testsPassed: false, hasFailure: false, auditVerdict: undefined })).toBe(
			"⚒ craft demo · iter 0 · tests pending · audit —",
		);
	});
});

const tempDirs: string[] = [];
function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-craft-progress-"));
	tempDirs.push(dir);
	return dir;
}
function freshState(projectRoot: string, feature = "demo"): CraftState {
	return { feature, projectRoot, testsPassed: false, aborted: false };
}

beforeEach(() => clearActiveCraft());
afterEach(() => {
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("gatherCraftProgress", () => {
	it("returns undefined when there is no active craft", () => {
		expect(gatherCraftProgress()).toBeUndefined();
	});

	it("returns a pending-tests card for a freshly-initialized craft with no logs/audit yet", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		expect(gatherCraftProgress()).toEqual({
			feature: "demo",
			iteration: 0,
			testsPassed: false,
			hasFailure: false,
			auditVerdict: undefined,
		});
	});

	it("derives the iteration from the highest run-N.log and reports a failing state", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: false, lastFailureSummary: "2 tests failed" });
		const logsDir = craftTestLogsDir(projectRoot, "demo");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(join(logsDir, "run-1.log"), "log 1");
		writeFileSync(join(logsDir, "run-2.log"), "log 2");

		const progress = gatherCraftProgress();
		expect(progress?.iteration).toBe(2);
		expect(progress?.hasFailure).toBe(true);
		expect(progress?.testsPassed).toBe(false);
	});

	it("reports testsPassed true once recorded, with no failure", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });

		const progress = gatherCraftProgress();
		expect(progress?.testsPassed).toBe(true);
		expect(progress?.hasFailure).toBe(false);
	});

	it("attaches the latest audit's verdict when parseable", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });
		const auditDir = craftAuditDir(projectRoot, "demo");
		mkdirSync(auditDir, { recursive: true });
		writeFileSync(join(auditDir, "audit-0.md"), "**AUDIT VERDICT: APPROVE-WITH-CHANGE**\n");
		writeFileSync(join(auditDir, "audit-1.md"), "**AUDIT VERDICT: APPROVE**\n");

		expect(gatherCraftProgress()?.auditVerdict).toBe("APPROVE");
	});

	it("omits the audit verdict (fallback) when the latest audit doc doesn't parse", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });
		const auditDir = craftAuditDir(projectRoot, "demo");
		mkdirSync(auditDir, { recursive: true });
		writeFileSync(join(auditDir, "audit-0.md"), "# no verdict line in this doc\n");

		expect(gatherCraftProgress()?.auditVerdict).toBeUndefined();
	});

	it("resolves logs/audit dirs under worktreeRoot, not projectRoot, when a worktree is active", () => {
		const projectRoot = tmpProject();
		const worktreeRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), worktreeRoot, testsPassed: true });
		const logsDir = craftTestLogsDir(worktreeRoot, "demo");
		mkdirSync(logsDir, { recursive: true });
		writeFileSync(join(logsDir, "run-4.log"), "log 4");

		expect(gatherCraftProgress()?.iteration).toBe(4);
	});
});
