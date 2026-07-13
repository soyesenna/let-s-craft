import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { performCraftRelease } from "../src/craft/release";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";

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
	const dir = mkdtempSync(join(tmpdir(), "lsc-release-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, testsPassed: false, aborted: false };
}

describe("performCraftRelease", () => {
	it("clears the active craft in state.ts and reports the outcome", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		const result = performCraftRelease("user approved a fix to the protected test/ canon via lsc_confirm");

		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({
			type: "text",
			text: 'lets-craft: craft "my-feature" released for approved canon modification — user approved a fix to the protected test/ canon via lsc_confirm',
		});
		expect(result.details).toEqual({
			feature: "my-feature",
			reason: "user approved a fix to the protected test/ canon via lsc_confirm",
		});

		// unlike abort (which sets `aborted: true` but keeps the craft active), release clears
		// the active-craft singleton entirely — the same "no active craft" state a fresh
		// session starts in, so hash-protection/enforcement no longer targets this feature
		// until a subsequent lsc_craft_init re-registers it (RK8).
		expect(getActiveCraft()).toBeUndefined();
	});

	it("errors clearly when there is no active craft to release", () => {
		const result = performCraftRelease("no craft running");

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/no active craft to release/);
		expect(getActiveCraft()).toBeUndefined();
	});

	it("does not leak an active craft into a later test (singleton isolation)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot, "leaky-feature"));

		performCraftRelease("approved");

		expect(getActiveCraft()).toBeUndefined();

		// A second, unrelated craft registered afterward must not observe any trace of the
		// released one — the singleton is fully clear, not just re-pointed.
		setActiveCraft(freshState(projectRoot, "next-feature"));
		expect(getActiveCraft()?.feature).toBe("next-feature");
	});
});
