import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath } from "../src/artifacts/paths";
import {
	clearActiveCraft,
	type CraftState,
	getActiveCraft,
	loadActiveCraft,
	markCraftAborted,
	recordTestResult,
	setActiveCraft,
} from "../src/craft/state";

const tempDirs: string[] = [];
afterEach(() => {
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});
beforeEach(() => clearActiveCraft());

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-state-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, testsPassed: false, aborted: false };
}

describe("setActiveCraft / getActiveCraft", () => {
	it("registers the craft in memory and persists it to test/.craft-state.json", () => {
		const projectRoot = tmpProject();
		const state = freshState(projectRoot);
		setActiveCraft(state);

		expect(getActiveCraft()).toEqual(state);
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted).toEqual(state);
	});

	// Worktree topology (R5): persist() now targets worktreeRoot ?? projectRoot, not projectRoot
	// unconditionally — see state.ts's persist().
	it("persists to the worktree root's .craft-state.json when worktreeRoot is set, not the project root", () => {
		const projectRoot = tmpProject();
		const worktreeRoot = tmpProject(); // separate temp dir standing in for a worktree checkout
		const state: CraftState = { ...freshState(projectRoot), worktreeRoot };
		setActiveCraft(state);

		expect(getActiveCraft()).toEqual(state);
		const persisted = JSON.parse(readFileSync(craftStatePath(worktreeRoot, "my-feature"), "utf8"));
		expect(persisted).toEqual(state);
		expect(existsSync(craftStatePath(projectRoot, "my-feature"))).toBe(false);
	});
});

describe("recordTestResult", () => {
	it("updates testsPassed and clears the failure summary on pass", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), lastFailureSummary: "old failure" });

		recordTestResult(true);

		expect(getActiveCraft()?.testsPassed).toBe(true);
		expect(getActiveCraft()?.lastFailureSummary).toBeUndefined();
	});

	it("records the failure summary on fail", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordTestResult(false, "2 tests failed");

		expect(getActiveCraft()?.testsPassed).toBe(false);
		expect(getActiveCraft()?.lastFailureSummary).toBe("2 tests failed");
	});

	it("is a no-op when there is no active craft", () => {
		recordTestResult(true);
		expect(getActiveCraft()).toBeUndefined();
	});
});

describe("recordTestResult — no-progress detection (C-1)", () => {
	it("returns noProgress:true on the 3rd consecutive matching-signature failure", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		expect(recordTestResult(false, "run 1", "sig-a")).toEqual({ consecutiveFailures: 1, noProgress: false });
		expect(recordTestResult(false, "run 2", "sig-a")).toEqual({ consecutiveFailures: 2, noProgress: false });
		expect(recordTestResult(false, "run 3", "sig-a")).toEqual({ consecutiveFailures: 3, noProgress: true });
		expect(getActiveCraft()?.consecutiveFailures).toBe(3);
		expect(getActiveCraft()?.failureSignature).toBe("sig-a");
	});

	it("resets the counter to 1 when the failure signature changes — progress happened even though the suite still fails", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordTestResult(false, "run 1", "sig-a");
		recordTestResult(false, "run 2", "sig-a");
		const outcome = recordTestResult(false, "run 3", "sig-b");

		expect(outcome).toEqual({ consecutiveFailures: 1, noProgress: false });
		expect(getActiveCraft()?.failureSignature).toBe("sig-b");
	});

	it("clears failureSignature and consecutiveFailures on a pass", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordTestResult(false, "run 1", "sig-a");
		recordTestResult(true);

		expect(getActiveCraft()?.failureSignature).toBeUndefined();
		expect(getActiveCraft()?.consecutiveFailures).toBeUndefined();
	});

	it("treats a missing failureSignature as always-progressed (never accumulates toward no-progress)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordTestResult(false, "run 1");
		recordTestResult(false, "run 2");
		const outcome = recordTestResult(false, "run 3");

		expect(outcome).toEqual({ consecutiveFailures: 1, noProgress: false });
	});

	it("loads a legacy state file with no failureSignature/consecutiveFailures fields without throwing, and treats it as a clean slate", () => {
		const projectRoot = tmpProject();
		const path = craftStatePath(projectRoot, "my-feature");
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify({ feature: "my-feature", projectRoot, testsPassed: false, aborted: false }));

		const restored = loadActiveCraft(projectRoot, "my-feature");
		expect(restored?.failureSignature).toBeUndefined();
		expect(restored?.consecutiveFailures).toBeUndefined();

		expect(recordTestResult(false, "new failure", "sig-x")).toEqual({ consecutiveFailures: 1, noProgress: false });
	});
});

describe("markCraftAborted", () => {
	it("sets aborted on the active craft and persists it", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		markCraftAborted();

		expect(getActiveCraft()?.aborted).toBe(true);
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.aborted).toBe(true);
	});
});

describe("clearActiveCraft / loadActiveCraft", () => {
	it("clears the in-memory craft without touching the persisted file", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		clearActiveCraft();

		expect(getActiveCraft()).toBeUndefined();
		expect(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8")).toBeTruthy();
	});

	it("restores a persisted craft after a simulated restart", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });
		clearActiveCraft();

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored?.testsPassed).toBe(true);
		expect(getActiveCraft()?.testsPassed).toBe(true);
	});

	it("returns undefined when no state was ever persisted for that feature", () => {
		const projectRoot = tmpProject();
		expect(loadActiveCraft(projectRoot, "never-started")).toBeUndefined();
	});
});
