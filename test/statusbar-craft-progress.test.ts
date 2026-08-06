import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftAuditDir, worktreesRootDir } from "../src/artifacts/paths.js";
import { clearActiveCraft, setActiveCraft, type CraftState } from "../src/craft/state.js";
import { rowText } from "../src/statusbar/render.js";
import {
	gatherCraftProgress,
	latestAuditNumber,
	latestCheckNumber,
	parseAuditVerdict,
	renderCraftProgressRow,
	type CraftProgressInput,
} from "../src/statusbar/craft-progress.js";

// ---------------------------------------------------------------------------
// QW7: craft-progress statusbar card. Covers the pure derivations (check-N /
// audit-N max, VERDICT-line parsing, one-line render) plus the thin gather's
// active/inactive/lane-count behavior against real temp directories (mirrors
// test/craft-state.test.ts's setActiveCraft/clearActiveCraft usage). The
// progress axis is executor lanes, not test status (C1) — see craft-progress.ts's
// own gatherCraftProgress doc comment for why.
// ---------------------------------------------------------------------------

describe("latestCheckNumber", () => {
	it("returns 0 for an empty directory listing", () => {
		expect(latestCheckNumber([])).toBe(0);
	});

	it("returns the highest check-N.log index, ignoring unrelated filenames", () => {
		expect(latestCheckNumber(["check-1.log", "check-3.log", "check-2.log", "notes.txt", ".craft-state.json"])).toBe(3);
	});

	it("ignores irregular / non-numeric filenames that merely resemble the pattern", () => {
		expect(latestCheckNumber(["check-abc.log", "check-.log", "check-1x.log", "check-2.log"])).toBe(2);
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

	it("renders parallel lanes with a parsed audit verdict", () => {
		expect(text({ feature: "demo", laneCount: 3, aborted: false, auditVerdict: "APPROVE" })).toBe("⚒ craft demo · lanes 3 · audit APPROVE");
	});

	it("renders a single-executor run before any audit exists", () => {
		expect(text({ feature: "demo", laneCount: 0, aborted: false, auditVerdict: undefined })).toBe("⚒ craft demo · single executor · audit —");
	});

	it("renders the aborted state", () => {
		expect(text({ feature: "demo", laneCount: 0, aborted: true, auditVerdict: undefined })).toBe(
			"⚒ craft demo · single executor · aborted · audit —",
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
	return { feature, projectRoot, aborted: false };
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

	it("returns a single-executor card for a freshly-initialized craft with no lanes/audit yet", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		expect(gatherCraftProgress()).toEqual({
			feature: "demo",
			laneCount: 0,
			aborted: false,
			auditVerdict: undefined,
		});
	});

	it("counts sibling lane worktree directories matching {feature}-c*-lane-*, ignoring other features", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		const worktreesRoot = worktreesRootDir(projectRoot);
		mkdirSync(join(worktreesRoot, "demo-c0-lane-1"), { recursive: true });
		mkdirSync(join(worktreesRoot, "demo-c0-lane-2"), { recursive: true });
		mkdirSync(join(worktreesRoot, "other-feature-c0-lane-1"), { recursive: true }); // different feature — not counted

		expect(gatherCraftProgress()?.laneCount).toBe(2);
	});

	it("reports aborted true once marked, independent of lane count", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), aborted: true });

		const progress = gatherCraftProgress();
		expect(progress?.aborted).toBe(true);
		expect(progress?.laneCount).toBe(0);
	});

	it("attaches the latest audit's verdict when parseable", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		const auditDir = craftAuditDir(projectRoot, "demo");
		mkdirSync(auditDir, { recursive: true });
		writeFileSync(join(auditDir, "audit-0.md"), "**AUDIT VERDICT: APPROVE-WITH-CHANGE**\n");
		writeFileSync(join(auditDir, "audit-1.md"), "**AUDIT VERDICT: APPROVE**\n");

		expect(gatherCraftProgress()?.auditVerdict).toBe("APPROVE");
	});

	it("omits the audit verdict (fallback) when the latest audit doc doesn't parse", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		const auditDir = craftAuditDir(projectRoot, "demo");
		mkdirSync(auditDir, { recursive: true });
		writeFileSync(join(auditDir, "audit-0.md"), "# no verdict line in this doc\n");

		expect(gatherCraftProgress()?.auditVerdict).toBeUndefined();
	});

	it("resolves the audit dir under worktreeRoot, not projectRoot, when a worktree is active", () => {
		const projectRoot = tmpProject();
		const worktreeRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), worktreeRoot });
		const auditDir = craftAuditDir(worktreeRoot, "demo");
		mkdirSync(auditDir, { recursive: true });
		writeFileSync(join(auditDir, "audit-0.md"), "**AUDIT VERDICT: APPROVE**\n");

		expect(gatherCraftProgress()?.auditVerdict).toBe("APPROVE");
	});

	it("resolves lane worktree directories under the MAIN checkout's .lsc/worktrees, never the worktree root", () => {
		const projectRoot = tmpProject();
		const worktreeRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), worktreeRoot });
		mkdirSync(join(worktreesRootDir(projectRoot), "demo-c0-lane-1"), { recursive: true });
		// A lane directory sitting under the (wrong) worktree root must not be counted.
		mkdirSync(join(worktreesRootDir(worktreeRoot), "demo-c0-lane-2"), { recursive: true });

		expect(gatherCraftProgress()?.laneCount).toBe(1);
	});
});
