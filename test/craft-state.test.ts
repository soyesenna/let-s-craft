import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath, worktreePath } from "../src/artifacts/paths";
import {
	CRAFT_STATE_VERSION,
	applyAuditBeginOutcome,
	clearActiveCraft,
	type CraftState,
	findPersistedCraftState,
	getActiveCraft,
	loadActiveCraft,
	markCraftAborted,
	markCraftAbortedAt,
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

	it("persists auditCycle/checkLogAtCycleStart onto the existing persisted state without touching other fields", () => {
		const projectRoot = tmpProject();
		setActiveCraft({ ...freshState(projectRoot), aborted: true });

		const next = recordAuditCycleBegin(projectRoot, "my-feature", 1, 3);

		expect(next.auditCycle).toBe(1);
		expect(next.checkLogAtCycleStart).toBe(3);
		expect(next.aborted).toBe(true); // untouched
		const persisted = JSON.parse(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8"));
		expect(persisted.auditCycle).toBe(1);
		expect(persisted.checkLogAtCycleStart).toBe(3);
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
		expect(getActiveCraft()?.checkLogAtCycleStart).toBe(5);
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

// ===========================================================================
// postcraft-14cycle-approval-failure PR-1 — the escalation ledger's exact-root
// atomic writers (applyAuditBeginOutcome): pending/Continue/terminal round-trips,
// the next-due mirror, evidence preservation across writes, and the
// setActiveCraft re-registration preservation of every escalation field.
// ===========================================================================

describe("applyAuditBeginOutcome (PR-1 escalation ledger writers)", () => {
	const FIXED_AT = "2026-08-25T00:00:00.000Z";

	it("persists an exact pending gate in one atomic write and keeps every other field", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const releaseApproval = { nonce: "n", tag: "[Land]", question: "q", response: "yes", issuedAt: FIXED_AT };
		writePersistedState(root, feature, { ...freshState(root, feature), auditCycle: 2, releaseApproval });

		const stamped = applyAuditBeginOutcome(root, feature, {
			kind: "escalation-pending",
			pending: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT },
		});

		expect(stamped.auditEscalationPending).toEqual({ feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT });
		expect(stamped.auditCycle).toBe(2); // cycle/threshold untouched by the gate itself
		expect(stamped.releaseApproval).toEqual(releaseApproval); // existing evidence preserved
		expect(JSON.parse(readFileSync(craftStatePath(root, feature), "utf8")).auditEscalationPending).toEqual(stamped.auditEscalationPending);
	});

	it("Continue moves the pending into history + validated next-due mirror + the cycle marker in ONE write, clearing auditValidated", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 2,
			checkLogAtCycleStart: 1,
			auditValidated: { cycle: 2, verdict: "REJECT", at: FIXED_AT },
			auditEscalationPending: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT },
		});

		const stamped = applyAuditBeginOutcome(root, feature, {
			kind: "escalation-continue",
			decision: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT, disposition: "Continue auditing", decidedAt: FIXED_AT, nextDueCycle: 6 },
			auditCycle: 3,
			checkLogAtCycleStart: 4,
		});

		expect(stamped.auditEscalationPending).toBeUndefined();
		expect(stamped.auditEscalations).toHaveLength(1);
		expect(stamped.auditEscalations?.[0]).toMatchObject({ dueCycle: 3, disposition: "Continue auditing", nextDueCycle: 6, intervalCycles: 3 });
		expect(stamped.nextAuditEscalationCycle).toBe(6);
		expect(stamped.auditCycle).toBe(3);
		expect(stamped.checkLogAtCycleStart).toBe(4);
		expect(stamped.auditValidated).toBeUndefined();
	});

	it("Abort/Preserve terminal writes the decision + exact top-level mirror and issues NO cycle", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 2,
			auditEscalationPending: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT },
		});

		const decision = { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT, disposition: "Abort this craft" as const, decidedAt: FIXED_AT };
		const stamped = applyAuditBeginOutcome(root, feature, { kind: "escalation-terminal", decision });

		expect(stamped.auditCycle).toBe(2); // no cycle issued
		expect(stamped.auditEscalationPending).toBeUndefined();
		expect(stamped.auditEscalations).toEqual([decision]);
		expect(stamped.auditTerminalDisposition).toEqual(decision);
	});

	it("fails closed (throws) when no persisted state exists at the exact root", () => {
		const root = tmpProject();
		expect(() => applyAuditBeginOutcome(root, "never-crafted", { kind: "audit-cycle", auditCycle: 0, checkLogAtCycleStart: 0 })).toThrow(/no persisted craft state/);
	});

	it("setActiveCraft re-registration preserves every escalation field the caller did not provide", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const decision = { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: FIXED_AT, disposition: "Continue auditing" as const, decidedAt: FIXED_AT, nextDueCycle: 6 };
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 5,
			auditEscalations: [decision],
			nextAuditEscalationCycle: 6,
		});

		setActiveCraft(freshState(root, feature)); // a bare re-registration carrying none of the fields

		expect(getActiveCraft()?.auditEscalations).toEqual([decision]);
		expect(getActiveCraft()?.nextAuditEscalationCycle).toBe(6);
		expect(getActiveCraft()?.auditCycle).toBe(5);
	});
});

// ===========================================================================
// audit-0 RF-15③⑤ — the two uncovered state.ts branches: markCraftAbortedAt's singleton-sync
// (state.ts:313-315) and applyAuditBeginOutcome's auditBaseSnapshot CLEAR branches (the
// escalation-continue :418 and audit-cycle :430 writes drop the key entirely when the new cycle
// carries no observation — JSON.stringify omits undefined, so no stale base evidence survives).
// ===========================================================================

describe("RF-15③ — markCraftAbortedAt keeps the in-memory singleton in sync when it is this exact craft", () => {
	it("an active singleton for the same feature+root is updated to the aborted stamped state", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, { ...freshState(root, feature), auditCycle: 2 });
		loadActiveCraft(root, feature); // singleton now IS this exact craft (feature + projectRoot match)
		expect(getActiveCraft()?.aborted).toBeFalsy();

		const stamped = markCraftAbortedAt(root, feature);

		expect(stamped.aborted).toBe(true);
		expect(getActiveCraft()).toEqual(stamped); // the singleton reflects the SAME stamped object
		expect(getActiveCraft()?.aborted).toBe(true);
		expect(JSON.parse(readFileSync(craftStatePath(root, feature), "utf8")).aborted).toBe(true);
	});

	it("a singleton for a DIFFERENT root is left untouched (no cross-craft resurrection)", () => {
		const root = tmpProject();
		const other = tmpProject();
		writePersistedState(root, "my-feature", { ...freshState(root, "my-feature") });
		setActiveCraft({ ...freshState(other, "my-feature"), worktreeRoot: undefined });

		markCraftAbortedAt(root, "my-feature");

		expect(getActiveCraft()?.aborted).toBeFalsy(); // different projectRoot — not our craft
	});
});

describe("RF-15⑤ — applyAuditBeginOutcome clears a prior cycle's auditBaseSnapshot when the new cycle records none", () => {
	const STALE_SNAPSHOT = { baseBranch: "main", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 1, status: "ok", authority: "explicit-base", observedAt: "2026-08-25T00:00:00.000Z" };

	it("an audit-cycle outcome without baseSnapshot drops the key from the persisted JSON", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, { ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: STALE_SNAPSHOT });

		const stamped = applyAuditBeginOutcome(root, feature, { kind: "audit-cycle", auditCycle: 1, checkLogAtCycleStart: 0 });

		expect(stamped.auditBaseSnapshot).toBeUndefined();
		const onDisk = JSON.parse(readFileSync(craftStatePath(root, feature), "utf8"));
		expect("auditBaseSnapshot" in onDisk).toBe(false); // the key is GONE, not null
	});

	it("an escalation-continue outcome without baseSnapshot also clears the prior snapshot (same atomic write)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 2,
			auditEscalationPending: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: "2026-08-25T00:00:00.000Z" },
			auditBaseSnapshot: STALE_SNAPSHOT,
		});

		const stamped = applyAuditBeginOutcome(root, feature, {
			kind: "escalation-continue",
			decision: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: "2026-08-25T00:00:00.000Z", disposition: "Continue auditing", decidedAt: "2026-08-25T00:00:00.000Z", nextDueCycle: 6 },
			auditCycle: 3,
			checkLogAtCycleStart: 0,
		});

		expect(stamped.auditBaseSnapshot).toBeUndefined();
		expect("auditBaseSnapshot" in JSON.parse(readFileSync(craftStatePath(root, feature), "utf8"))).toBe(false);
	});
});

// ===========================================================================
// audit-1 RF-19 — an undecodable persisted craft state (malformed JSON, or a stateVersion
// newer than this build supports) is durable evidence setActiveCraft must never overwrite:
// strict durability propagates the decode error BEFORE persist/publish; best-effort SKIPS the
// disk write entirely (bytes untouched) while still publishing the in-memory slot.
// ===========================================================================

describe("RF-19 — an undecodable persisted state is never overwritten", () => {
	const SEEDS: Array<[string, string]> = [
		["malformed JSON", "{ not json"],
		["a future stateVersion", JSON.stringify({ stateVersion: CRAFT_STATE_VERSION + 1, feature: "my-feature", projectRoot: "/nowhere", aborted: false })],
	];

	for (const [label, bytes] of SEEDS) {
		it(`strict setActiveCraft propagates the decode error for ${label} — bytes unchanged, nothing published`, () => {
			const projectRoot = tmpProject();
			const path = craftStatePath(projectRoot, "my-feature");
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, bytes);

			expect(() => setActiveCraft(freshState(projectRoot), { durability: "strict" })).toThrow();
			expect(readFileSync(path, "utf8")).toBe(bytes);
			expect(getActiveCraft()).toBeUndefined();
		});

		it(`best-effort setActiveCraft skips the disk write for ${label} — bytes unchanged, memory-only activation`, () => {
			const projectRoot = tmpProject();
			const path = craftStatePath(projectRoot, "my-feature");
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, bytes);

			expect(() => setActiveCraft(freshState(projectRoot))).not.toThrow();
			expect(readFileSync(path, "utf8")).toBe(bytes);
			expect(getActiveCraft()?.feature).toBe("my-feature");
			expect(getActiveCraft()?.stateVersion).toBe(CRAFT_STATE_VERSION); // in-memory stamp convention holds
		});
	}
});
