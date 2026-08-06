import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { performCraftAbort } from "../src/craft/abort";
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
	const dir = mkdtempSync(join(tmpdir(), "lsc-abort-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

describe("performCraftAbort", () => {
	it("marks the active craft aborted in state.ts and reports the outcome", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		const result = performCraftAbort("user declined the hash-violation restore prompt");

		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({
			type: "text",
			text: 'lets-craft: craft "my-feature" marked aborted — user declined the hash-violation restore prompt',
		});
		expect(result.details).toEqual({ feature: "my-feature", reason: "user declined the hash-violation restore prompt" });

		// reflected in state.ts — watchdog.ts's explicit-stop check (craft?.aborted) and
		// destructive-approval invalidation both key off this field directly.
		expect(getActiveCraft()?.aborted).toBe(true);
	});

	it("does not clobber other durable evidence (e.g. releaseApproval) — only sets aborted", () => {
		const projectRoot = tmpProject();
		const releaseApproval = { nonce: "n", tag: "[Land]", question: "q", response: "yes", issuedAt: "2026-01-01T00:00:00.000Z" };
		setActiveCraft({ ...freshState(projectRoot), releaseApproval });

		performCraftAbort("run_check.sh is unrunnable and the user declined to continue");

		const craft = getActiveCraft();
		expect(craft?.aborted).toBe(true);
		expect(craft?.releaseApproval).toEqual(releaseApproval);
	});

	it("errors clearly when there is no active craft to abort", () => {
		const result = performCraftAbort("no craft running");

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/no active craft to abort/);
		expect(getActiveCraft()).toBeUndefined();
	});
});
