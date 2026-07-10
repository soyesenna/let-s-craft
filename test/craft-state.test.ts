import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
