// Revised craft-release canon for the release-gate feature (plan §4 W1). The current suite's
// three behaviours are preserved verbatim except that each now installs a fresh [Canon Amendment]
// approval AFTER setActiveCraft (which itself invalidates the slot) — release is gated on a
// consumed nonce, so a bare setActiveCraft no longer suffices. Four new rejection arms cover the
// fail-closed gate: no approval (AC1), already-consumed / single-use (AC3), non-consumable tag,
// and a mismatched craft identity. Conventions: real singletons + mkdtempSync(tmpdir()), per-field
// assertions, no mocks/snapshots; clearActiveCraft()/invalidatePendingApproval() reset each test.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DestructiveGateTag, createPendingApproval, installPendingApproval, invalidatePendingApproval, peekPendingApproval } from "../src/craft/destructive-approval";
import { performCraftRelease } from "../src/craft/release";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";

const CANON_QUESTION =
	"[Canon Amendment] Protected test canon needs an approved, intentional modification. Release hash protection and proceed? Proceed?";

const tempDirs: string[] = [];
afterEach(() => {
	invalidatePendingApproval();
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});
beforeEach(() => {
	invalidatePendingApproval();
	clearActiveCraft();
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-release-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

// Install a pending approval bound to the given craft's identity. Call AFTER setActiveCraft:
// setActiveCraft invalidates the slot on activation, so installing first would be undone.
function installApprovalFor(state: CraftState, tag: DestructiveGateTag = "[Canon Amendment]"): void {
	installPendingApproval(
		createPendingApproval({
			tag,
			question: CANON_QUESTION,
			identity: { feature: state.feature, projectRoot: state.projectRoot, worktreeRoot: state.worktreeRoot },
		}),
	);
}

// Replace <root>/.lsc with a regular FILE so the next persist()'s mkdirSync(recursive) fails
// with ENOTDIR — a uid-independent way to force a durable-write failure (unlike chmod, which
// root bypasses). setActiveCraft must have run first (it needs a writable path).
function breakPersistPath(root: string): void {
	rmSync(join(root, ".lsc"), { recursive: true, force: true });
	writeFileSync(join(root, ".lsc"), "");
}

describe("performCraftRelease", () => {
	it("clears the active craft in state.ts and reports the outcome", () => {
		const projectRoot = tmpProject();
		const state = freshState(projectRoot);
		setActiveCraft(state);
		installApprovalFor(state); // a fresh [Canon Amendment] approval must be consumed for release to proceed

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
		const state = freshState(projectRoot, "leaky-feature");
		setActiveCraft(state);
		installApprovalFor(state);

		performCraftRelease("approved");

		expect(getActiveCraft()).toBeUndefined();

		// A second, unrelated craft registered afterward must not observe any trace of the
		// released one — the singleton is fully clear, not just re-pointed.
		setActiveCraft(freshState(projectRoot, "next-feature"));
		expect(getActiveCraft()?.feature).toBe("next-feature");
	});
});

describe("performCraftRelease — approval gate (fail-closed)", () => {
	it("rejects release when no approval has been issued (AC1)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		// no installApprovalFor — the nonce slot is empty

		const result = performCraftRelease("attempting release without a fresh approval");

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/requires a fresh user approval/);
		expect(result.content[0].text).toContain("[Canon Amendment]"); // the release-consumable tag is named in the guidance
		// The craft is refused, not cleared — a fresh confirm can still be obtained.
		expect(getActiveCraft()?.feature).toBe("my-feature");
	});

	it("rejects a second release after the approval was already consumed (single-use, AC3)", () => {
		const projectRoot = tmpProject();
		const state = freshState(projectRoot);
		setActiveCraft(state);
		installApprovalFor(state);

		const first = performCraftRelease("first approved release");
		expect(first.isError).toBeFalsy(); // consumes the single-use approval and clears the craft

		// Re-register the craft (what a follow-up lsc_craft_init does), but WITHOUT a fresh approval.
		setActiveCraft(state);
		const second = performCraftRelease("reuse the already-consumed approval");

		expect(second.isError).toBe(true);
		expect(second.content[0].text).toMatch(/requires a fresh user approval/);
	});

	it("rejects release when the pending approval carries a non-consumable tag (tag-mismatch)", () => {
		const projectRoot = tmpProject();
		const state = freshState(projectRoot);
		setActiveCraft(state);
		installApprovalFor(state, "[Land]"); // [Land] is issuable, but not in RELEASE_CONSUMABLE_TAGS

		const result = performCraftRelease("approved for a different destructive gate");

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/requires a fresh user approval/);
		expect(result.content[0].text).toContain("[Land]"); // the pending tag is surfaced
		// Conditional non-burn (CS11): the mis-targeted approval survives, and the craft stays active.
		expect(peekPendingApproval()?.tag).toBe("[Land]");
		expect(getActiveCraft()?.feature).toBe("my-feature");
	});

	it("rejects release when the pending approval belongs to a different craft identity (identity-mismatch)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		// An approval bound to a DIFFERENT craft identity than the active one.
		installPendingApproval(
			createPendingApproval({
				tag: "[Canon Amendment]",
				question: CANON_QUESTION,
				identity: { feature: "other-feature", projectRoot: "/somewhere/else" },
			}),
		);

		const result = performCraftRelease("approved for another craft");

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/requires a fresh user approval/);
		expect(result.content[0].text).toContain("[Canon Amendment]"); // the release-consumable tag is named in the guidance
		// The other craft's approval survives (conditional non-burn), and this craft stays active.
		expect(peekPendingApproval()).not.toBeUndefined();
		expect(getActiveCraft()?.feature).toBe("my-feature");
	});

	it("fails closed when open-release evidence cannot be persisted", () => {
		const root = tmpProject();
		const state = freshState(root);
		setActiveCraft(state);
		installApprovalFor(state);
		breakPersistPath(root);

		expect(() => performCraftRelease("approved but durable write fails")).toThrow();
		expect(getActiveCraft()?.feature).toBe("my-feature");
		expect(getActiveCraft()?.openRelease).toBeUndefined();
		expect(peekPendingApproval()).toBeUndefined(); // consumed approval is not restored
	});
});
