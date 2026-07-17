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
	hasOpenRelease,
	loadActiveCraft,
	markCraftAborted,
	type OpenReleaseEvidence,
	readPersistedCraftState,
	recordAuditCycleBegin,
	recordAuditValidated,
	recordOpenRelease,
	recordReleaseApproval,
	recordTestResult,
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

describe("recordAuditCycleBegin (B-1, cycle-freshness marker)", () => {
	it("throws when no persisted craft state exists at the given root/feature — nothing to begin a cycle against", () => {
		const projectRoot = tmpProject();
		expect(() => recordAuditCycleBegin(projectRoot, "never-crafted", 0, 0)).toThrow();
	});

	it("persists auditCycle/runLogAtCycleStart onto the existing persisted state without touching other fields", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });

		const next = recordAuditCycleBegin(projectRoot, "my-feature", 1, 3);

		expect(next.auditCycle).toBe(1);
		expect(next.runLogAtCycleStart).toBe(3);
		expect(next.testsPassed).toBe(true); // untouched
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
		setActiveCraft({ ...freshState(projectRoot), testsPassed: true });

		const next = recordAuditValidated(projectRoot, "my-feature", 2, "APPROVE-WITH-COMMENT", "2026-07-17T10:00:00.000Z");

		expect(next.auditValidated).toEqual({ cycle: 2, verdict: "APPROVE-WITH-COMMENT", at: "2026-07-17T10:00:00.000Z" });
		expect(next.testsPassed).toBe(true); // untouched
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

// ===========================================================================
// release-gate feature extensions — AC6 backward-compat + the new durable
// evidence ledger (releaseApproval / openRelease) and its readers.
//
// PRE-CRAFT RED (test-first): the symbols below do not exist in state.ts yet —
// craft (plan Step 2) adds `findPersistedCraftState`, `readPersistedCraftState`,
// `hasOpenRelease`, `openReleaseGuidance`, `recordReleaseApproval`,
// `recordOpenRelease`, the `ReleaseApprovalEvidence`/`OpenReleaseEvidence` types,
// the `releaseApproval?`/`openRelease?` CraftState fields, and the
// loadActiveCraft "unclosed open-release is not promoted" rule. Until then, a
// named import of a missing export resolves to `undefined` at runtime (verified:
// esbuild does NOT throw at import; it throws "is not a function" at the CALL
// site), so every test that CALLS a new function is RED with a TypeError, and the
// single test asserting the not-yet-implemented non-promotion rule is RED on its
// assertion. Both are the correct expected RED — NOT typos. The suites ABOVE this
// banner stay green throughout (they touch no new symbol): that green is the AC7
// no-regression baseline for craft-state itself. A clean pass of THIS section
// before craft would be the red flag.
// ===========================================================================

const APPROVAL_EVIDENCE: ReleaseApprovalEvidence = {
	nonce: "nonce-1111-2222-3333",
	tag: "[Canon Amendment]",
	question: "[Canon Amendment] Protected test canon needs an approved, intentional modification. Proceed?",
	response: "yes",
	issuedAt: "2026-07-17T10:00:00.000Z",
};

function openEvidence(overrides: Partial<OpenReleaseEvidence> = {}): OpenReleaseEvidence {
	return {
		nonce: "nonce-1111-2222-3333",
		tag: "[Canon Amendment]",
		question: "[Canon Amendment] Protected test canon needs an approved, intentional modification. Proceed?",
		response: "yes",
		reason: "fix the off-by-one in the boundary assertion",
		openedAt: "2026-07-17T10:01:00.000Z",
		...overrides,
	};
}

// Write an arbitrary state shape straight to a feature's .craft-state.json, bypassing the
// mutators, so a reader/loader can be exercised against exactly that on-disk shape (older
// shapes, hand-forged open/closed evidence). Mirrors state.ts persist(): worktreeRoot ??
// projectRoot resolution is the caller's to encode via the `root` argument.
function writePersistedState(root: string, feature: string, state: object): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

describe("AC6 — legacy .craft-state.json (no release/open-release fields) parses tolerantly", () => {
	// The exact pre-release-gate CraftState shape: no releaseApproval / openRelease keys.
	const legacy = (projectRoot: string) => ({ feature: "my-feature", projectRoot, testsPassed: false, aborted: false });

	it("loadActiveCraft reads a legacy state file without throwing and leaves the new fields undefined", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored?.feature).toBe("my-feature");
		expect(restored?.releaseApproval).toBeUndefined();
		expect(restored?.openRelease).toBeUndefined();
	});

	it("readPersistedCraftState (exact-root reader) reads a legacy state file without throwing", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const read = readPersistedCraftState(projectRoot, "my-feature");

		expect(read?.feature).toBe("my-feature");
		expect(read?.releaseApproval).toBeUndefined();
		expect(read?.openRelease).toBeUndefined();
	});

	it("findPersistedCraftState (inactive-lookup reader) reads a legacy state file without throwing", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const found = findPersistedCraftState(projectRoot, "my-feature");

		expect(found?.feature).toBe("my-feature");
		expect(found?.openRelease).toBeUndefined();
	});

	it("hasOpenRelease is false for a legacy state that has no openRelease field", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", legacy(projectRoot));

		const found = findPersistedCraftState(projectRoot, "my-feature");

		expect(hasOpenRelease(found)).toBe(false);
	});
});

describe("release-gate evidence ledger — new optional fields round-trip through persist", () => {
	it("recordReleaseApproval persists releaseApproval and re-reads it field-for-field", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));

		recordReleaseApproval(APPROVAL_EVIDENCE);

		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.releaseApproval).toEqual(APPROVAL_EVIDENCE);
		expect(getActiveCraft()?.releaseApproval).toEqual(APPROVAL_EVIDENCE);
	});

	it("recordOpenRelease persists openRelease unclosed and stamps consumedAt on the prior approval (single ledger)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		recordReleaseApproval(APPROVAL_EVIDENCE);

		const open = openEvidence({ manifestFingerprint: "sha256-abc123" });
		recordOpenRelease(open);

		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.openRelease).toEqual(open);
		expect(persisted.openRelease.closedAt).toBeUndefined();
		// The single approval slot is stamped consumed at the moment the release opened.
		expect(persisted.releaseApproval.consumedAt).toBe(open.openedAt);
	});

	it("leaves the open-release evidence on disk after clearActiveCraft so inactive-lookup readers still see it (state.ts:138 contract)", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		recordReleaseApproval(APPROVAL_EVIDENCE);
		recordOpenRelease(openEvidence()); // unclosed — mirrors performCraftRelease just before clearActiveCraft

		clearActiveCraft();

		expect(getActiveCraft()).toBeUndefined();
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(hasOpenRelease(persisted)).toBe(true);

		const recovered = readPersistedCraftState(projectRoot, "my-feature");
		expect(hasOpenRelease(recovered)).toBe(true);
		expect(getActiveCraft()).toBeUndefined(); // the reader did not re-activate the singleton
	});
});

describe("loadActiveCraft promotion vs inactive-lookup readers (active-open invariant)", () => {
	it("promotes a persisted craft whose openRelease is already closed", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", {
			...freshState(projectRoot),
			openRelease: openEvidence({ closedAt: "2026-07-17T10:05:00.000Z" }),
		});

		const restored = loadActiveCraft(projectRoot, "my-feature");

		expect(restored).toBeDefined();
		expect(getActiveCraft()).toBeDefined(); // a closed open-release does not block promotion
		expect(getActiveCraft()?.openRelease?.closedAt).toBe("2026-07-17T10:05:00.000Z");
	});

	it("returns the record but does NOT promote a persisted craft whose openRelease is unclosed", () => {
		const projectRoot = tmpProject();
		writePersistedState(projectRoot, "my-feature", {
			...freshState(projectRoot),
			openRelease: openEvidence(), // no closedAt = still open
		});

		const returned = loadActiveCraft(projectRoot, "my-feature");

		expect(returned?.openRelease).toBeDefined(); // caller still gets the record to inspect
		// ...but it is NOT installed as the active singleton — run_tests' `!craft` guard must stay
		// fail-closed over an open-release window (plan Step 2 active-open invariant).
		expect(getActiveCraft()).toBeUndefined();
	});

	it("refuses to publish a craft carrying an unclosed open-release directly (active-open invariant)", () => {
		const root = tmpProject();
		expect(() => setActiveCraft({ ...freshState(root), openRelease: openEvidence() })).toThrow();
		expect(getActiveCraft()).toBeUndefined();
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

	it("findPersistedCraftState prefers an unclosed-open candidate over a stale closed one (R5/CS4 — stale closed cannot hide open)", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		// cwd candidate: a stale CLOSED open-release.
		writePersistedState(cwd, feature, {
			...freshState(cwd),
			openRelease: openEvidence({ closedAt: "2026-07-17T09:00:00.000Z" }),
		});
		// worktree candidate: an OPEN (unclosed) open-release.
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, {
			...freshState(cwd),
			worktreeRoot: wt,
			openRelease: openEvidence(),
		});

		const found = findPersistedCraftState(cwd, feature);

		// The open worktree candidate wins — the stale closed cwd candidate cannot mask it.
		expect(hasOpenRelease(found)).toBe(true);
	});

	it("prefers an open cwd candidate over a stale closed worktree candidate", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, { ...freshState(cwd), openRelease: openEvidence() });
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, {
			...freshState(cwd),
			worktreeRoot: wt,
			openRelease: openEvidence({ closedAt: "2026-07-17T09:00:00.000Z" }),
		});

		const found = findPersistedCraftState(cwd, feature);

		// The open cwd candidate wins — a stale closed worktree record cannot mask it.
		expect(hasOpenRelease(found)).toBe(true);
		expect(found?.worktreeRoot).toBeUndefined();
	});

	it("prefers the worktree candidate when neither candidate is open", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, { ...freshState(cwd), openRelease: openEvidence({ closedAt: "C1" }) });
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, {
			...freshState(cwd),
			worktreeRoot: wt,
			openRelease: openEvidence({ closedAt: "C2" }),
		});

		// Neither candidate is open → the worktree file is the tie-breaker.
		expect(findPersistedCraftState(cwd, feature)?.worktreeRoot).toBe(wt);
	});
});
