import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath, worktreePath } from "../src/artifacts/paths";
import {
	clearActiveCraft,
	type CraftState,
	findPersistedCraftState,
	getActiveCraft,
	loadActiveCraft,
	markCraftAborted,
	readPersistedCraftState,
	recordAuditCycleBegin,
	recordAuditValidated,
	recordReleaseApproval,
	type ReleaseApprovalEvidence,
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
	return { feature, projectRoot, aborted: false };
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

describe("recordAuditCycleBegin (B-1, cycle-freshness marker)", () => {
	it("throws when no persisted craft state exists at the given root/feature — nothing to begin a cycle against", () => {
		const projectRoot = tmpProject();
		expect(() => recordAuditCycleBegin(projectRoot, "never-crafted", 0, 0)).toThrow();
	});

	it("persists auditCycle/runLogAtCycleStart onto the existing persisted state without touching other fields", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), aborted: true });

		const next = recordAuditCycleBegin(projectRoot, "my-feature", 1, 3);

		expect(next.auditCycle).toBe(1);
		expect(next.runLogAtCycleStart).toBe(3);
		expect(next.aborted).toBe(true); // untouched
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.auditCycle).toBe(1);
		expect(persisted.runLogAtCycleStart).toBe(3);
	});

	it("works even when there is no active craft in this session (post-craft never calls lsc_craft_init)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		clearActiveCraft(); // simulate post-craft's own session: craft ran earlier, but nothing is active now
		expect(getActiveCraft()).toBeUndefined();

		const next = recordAuditCycleBegin(projectRoot, "my-feature", 0, 2);

		expect(next.auditCycle).toBe(0);
		expect(getActiveCraft()).toBeUndefined(); // still not promoted — this function never activates a craft
	});

	it("keeps the in-memory singleton in sync when it happens to already be this exact craft", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordAuditCycleBegin(projectRoot, "my-feature", 2, 5);

		expect(getActiveCraft()?.auditCycle).toBe(2);
		expect(getActiveCraft()?.runLogAtCycleStart).toBe(5);
	});
});

describe("recordAuditValidated (B-1 follow-up, review NEEDS-FIX MEDIUM — durable machine trace)", () => {
	it("throws when no persisted craft state exists at the given root/feature", () => {
		const projectRoot = tmpProject();
		expect(() => recordAuditValidated(projectRoot, "never-crafted", 0, "APPROVE", "2026-07-17T00:00:00.000Z")).toThrow();
	});

	it("persists the {cycle, verdict, at} marker onto the existing persisted state without touching other fields", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), aborted: true });

		const next = recordAuditValidated(projectRoot, "my-feature", 2, "APPROVE-WITH-COMMENT", "2026-07-17T10:00:00.000Z");

		expect(next.auditValidated).toEqual({ cycle: 2, verdict: "APPROVE-WITH-COMMENT", at: "2026-07-17T10:00:00.000Z" });
		expect(next.aborted).toBe(true); // untouched
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.auditValidated).toEqual({ cycle: 2, verdict: "APPROVE-WITH-COMMENT", at: "2026-07-17T10:00:00.000Z" });
	});

	it("works even when there is no active craft in this session (post-craft never calls lsc_craft_init)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		clearActiveCraft();

		const next = recordAuditValidated(projectRoot, "my-feature", 0, "APPROVE", "2026-07-17T10:00:00.000Z");

		expect(next.auditValidated?.verdict).toBe("APPROVE");
		expect(getActiveCraft()).toBeUndefined(); // still not promoted
	});

	it("keeps the in-memory singleton in sync when it happens to already be this exact craft", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordAuditValidated(projectRoot, "my-feature", 1, "REJECT", "2026-07-17T10:00:00.000Z");

		expect(getActiveCraft()?.auditValidated).toEqual({ cycle: 1, verdict: "REJECT", at: "2026-07-17T10:00:00.000Z" });
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
		setActiveCraft({ ...freshState(projectRoot), aborted: true });
		clearActiveCraft();

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored?.aborted).toBe(true);
		expect(getActiveCraft()?.aborted).toBe(true);
	});

	it("returns undefined when no state was ever persisted for that feature", () => {
		const projectRoot = tmpProject();
		expect(loadActiveCraft(projectRoot, "never-started")).toBeUndefined();
	});
});

// ===========================================================================
// release-gate feature extensions — AC6 backward-compat + the durable
// evidence ledger (releaseApproval) and its readers.
//
// R9 (C2): the openRelease state machine (hasOpenRelease/openReleaseGuidance/recordOpenRelease/
// OpenReleaseEvidence, the `openRelease?` CraftState field, and the "unclosed open-release is
// not promoted" active-open invariant) is retired along with its sole gate, release.ts — there
// is no protected test/ canon left at craft time for a release to open a window against.
// releaseApproval survives (it is also [Land]'s approval evidence) and is exercised below under
// that tag.
// ===========================================================================

const APPROVAL_EVIDENCE: ReleaseApprovalEvidence = {
	nonce: "nonce-1111-2222-3333",
	tag: "[Land]",
	question: "[Land] Land the approved worktree? Proceed?",
	response: "yes",
	issuedAt: "2026-07-17T10:00:00.000Z",
};

// Write an arbitrary state shape straight to a feature's .craft-state.json, bypassing the
// mutators, so a reader/loader can be exercised against exactly that on-disk shape (older
// shapes, hand-forged evidence). Mirrors state.ts persist(): worktreeRoot ?? projectRoot
// resolution is the caller's to encode via the `root` argument.
function writePersistedState(root: string, feature: string, state: object): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

describe("AC6 — legacy .craft-state.json (no releaseApproval field) parses tolerantly", () => {
	// The exact pre-release-gate CraftState shape: no releaseApproval key.
	const legacy = (projectRoot: string) => ({ feature: "my-feature", projectRoot, aborted: false });

	it("loadActiveCraft reads a legacy state file without throwing and leaves the new field undefined", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored?.feature).toBe("my-feature");
		expect(restored?.releaseApproval).toBeUndefined();
	});

	it("readPersistedCraftState (exact-root reader) reads a legacy state file without throwing", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const read = readPersistedCraftState(projectRoot, "my-feature");

		expect(read?.feature).toBe("my-feature");
		expect(read?.releaseApproval).toBeUndefined();
	});

	it("findPersistedCraftState (inactive-lookup reader) reads a legacy state file without throwing", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const found = findPersistedCraftState(projectRoot, "my-feature");

		expect(found?.feature).toBe("my-feature");
		expect(found?.releaseApproval).toBeUndefined();
	});
});

describe("release-gate evidence ledger — releaseApproval round-trips through persist", () => {
	it("recordReleaseApproval persists releaseApproval and re-reads it field-for-field", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordReleaseApproval(APPROVAL_EVIDENCE);

		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.releaseApproval).toEqual(APPROVAL_EVIDENCE);
		expect(getActiveCraft()?.releaseApproval).toEqual(APPROVAL_EVIDENCE);
	});

	it("leaves the releaseApproval evidence on disk after clearActiveCraft so inactive-lookup readers still see it", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		recordReleaseApproval(APPROVAL_EVIDENCE);

		clearActiveCraft();

		expect(getActiveCraft()).toBeUndefined();
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.releaseApproval).toEqual(APPROVAL_EVIDENCE);

		const recovered = readPersistedCraftState(projectRoot, "my-feature");
		expect(recovered?.releaseApproval).toEqual(APPROVAL_EVIDENCE);
		expect(getActiveCraft()).toBeUndefined(); // the reader did not re-activate the singleton
	});
});

describe("loadActiveCraft / findPersistedCraftState — inactive-lookup readers (R9: active-open invariant retired with openRelease)", () => {
	it("loadActiveCraft always promotes the restored craft to the active singleton", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", freshState(projectRoot));

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored).toBeDefined();
		expect(getActiveCraft()).toBeDefined();
		expect(getActiveCraft()?.feature).toBe("my-feature");
	});

	it("readPersistedCraftState never touches the active-craft singleton", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		clearActiveCraft();
		expect(getActiveCraft()).toBeUndefined();

		const read = readPersistedCraftState(projectRoot, "my-feature");

		expect(read?.feature).toBe("my-feature");
		expect(getActiveCraft()).toBeUndefined();
	});

	it("findPersistedCraftState never touches the active-craft singleton", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		clearActiveCraft();

		const found = findPersistedCraftState(projectRoot, "my-feature");

		expect(found?.feature).toBe("my-feature");
		expect(getActiveCraft()).toBeUndefined();
	});

	it("prefers the worktree candidate over the cwd candidate when both exist (worktree-first simple fallback)", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, freshState(cwd));
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd), worktreeRoot: wt });

		const found = findPersistedCraftState(cwd, feature);

		expect(found?.worktreeRoot).toBe(wt);
	});

	it("falls back to the cwd candidate when no worktree state file exists", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, freshState(cwd));

		const found = findPersistedCraftState(cwd, feature);

		expect(found?.worktreeRoot).toBeUndefined();
	});
});
