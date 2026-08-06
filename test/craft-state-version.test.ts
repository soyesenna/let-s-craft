import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath } from "../src/artifacts/paths";
import {
	CRAFT_STATE_VERSION,
	clearActiveCraft,
	type CraftState,
	decodeCraftState,
	getActiveCraft,
	loadActiveCraft,
	readPersistedCraftState,
	recordAuditCycleBegin,
	recordAuditValidated,
	recordReleaseApprovalAt,
	setActiveCraft,
} from "../src/craft/state";

// ===========================================================================
// deferred-pool D (stateVersion) — AC9. plan Step 1a: a single `decodeCraftState`
// decoder that BOTH readers (loadActiveCraft, readPersistedCraftState) route
// through, so version handling can never be bypassed by one reader's own
// JSON.parse. Contract (spec §제약 7, N6 — Cargo first-class-error precedent):
//   • WRITE stamps `stateVersion: CRAFT_STATE_VERSION` (const = 1) via every
//     writeFileAtomicSync path (setActiveCraft/persist).
//   • an UNKNOWN NEWER version (`> CRAFT_STATE_VERSION`) is an EXPLICIT throw —
//     never a silent mis-read/active-promotion. The message names the file path,
//     the found version, and the supported ceiling (appendix observability §3).
//   • an ABSENT field (an older, pre-version file) is read TOLERANTLY — the
//     existing optional-field docstring convention (state.ts:38-48).
//
// PRE-CRAFT RED (test-first, release-gate precedent): `CRAFT_STATE_VERSION` and
// `decodeCraftState` do not exist in state.ts yet, and neither reader validates
// a version. A named import of a missing export resolves to `undefined` at
// runtime (esbuild does NOT throw at import; a CALL throws "is not a function"),
// so: the stamping tests are RED on `typeof CRAFT_STATE_VERSION === "number"`,
// the unknown-version tests are RED because the reader does NOT throw yet
// (`expect(err).toBeInstanceOf(Error)` fails on the absent throw — deliberately
// NOT `.toThrow()`, which a TypeError from calling `undefined` would falsely
// satisfy), and the direct-decoder tests are RED at the call site. The
// legacy-tolerance tests are GREEN now (existing JSON.parse already tolerates an
// absent field) and MUST stay green — they lock the no-regression contract that
// the new decoder keeps tolerating older files. HashManifest/ModelsFile are
// explicitly NOT touched (spec §Non-Goals — E-3 좁힘).
// ===========================================================================

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
	const dir = mkdtempSync(join(tmpdir(), "lsc-state-ver-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

/** Write an arbitrary on-disk shape straight to a feature's .craft-state.json, bypassing the
 * mutators, so a reader can be exercised against exactly that shape (older shapes, a hand-forged
 * future version). Mirrors state.ts persist() root resolution: the caller encodes it via `root`. */
function writePersistedState(root: string, feature: string, state: object): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

/** The stateVersion a file one generation NEWER than this build would carry. Falls back to 2 so
 * the fixture is well-formed even while CRAFT_STATE_VERSION is still `undefined` (pre-craft RED). */
function futureVersion(): number {
	return (CRAFT_STATE_VERSION ?? 1) + 1;
}

describe("CRAFT_STATE_VERSION (the on-disk schema version constant — M6)", () => {
	it("is pinned to 2 (C3: runLogAtCycleStart renamed to checkLogAtCycleStart, and .craft-state.json moved out of test/)", () => {
		// A hard pin: bumping the on-disk schema is a deliberate, reviewed act (it changes what
		// `> CRAFT_STATE_VERSION` rejects and what every write stamps), never accidental drift.
		expect(CRAFT_STATE_VERSION).toBe(2);
	});
});

describe("decodeCraftState (the single decoder both readers route through)", () => {
	it("returns undefined when the state file is absent", () => {
		const root = tmpProject();
		expect(decodeCraftState(craftStatePath(root, "my-feature"))).toBeUndefined();
	});

	it("throws with the file path, the found version, and the supported ceiling on an unknown NEWER version", () => {
		const root = tmpProject();
		const found = futureVersion();
		writePersistedState(root, "my-feature", { ...freshState(root), stateVersion: found });

		let err: unknown;
		try {
			decodeCraftState(craftStatePath(root, "my-feature"));
		} catch (e) {
			err = e;
		}

		expect(err).toBeInstanceOf(Error);
		const msg = err instanceof Error ? err.message : "";
		expect(msg.toLowerCase()).toContain("version");
		expect(msg).toContain(String(found)); // the found (unsupported) version
		expect(msg).toContain(String(CRAFT_STATE_VERSION)); // the supported ceiling
		expect(msg).toContain(craftStatePath(root, "my-feature")); // the offending file path
	});

	it("tolerates a legacy file with no stateVersion field (returns it, stateVersion undefined)", () => {
		const root = tmpProject();
		writePersistedState(root, "my-feature", { feature: "my-feature", projectRoot: root, testsPassed: false, aborted: false });

		const decoded = decodeCraftState(craftStatePath(root, "my-feature"));

		expect(decoded?.feature).toBe("my-feature");
		expect(decoded?.stateVersion).toBeUndefined();
	});

	it("decodes a current-version file", () => {
		const root = tmpProject();
		writePersistedState(root, "my-feature", { ...freshState(root), stateVersion: CRAFT_STATE_VERSION });

		expect(decodeCraftState(craftStatePath(root, "my-feature"))?.stateVersion).toBe(CRAFT_STATE_VERSION);
	});
});

describe("loadActiveCraft — stateVersion (reader 1, promotes to the in-memory singleton)", () => {
	it("stamps stateVersion on write and reads it back on the next load", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root)); // persists via writeFileAtomicSync — must stamp
		clearActiveCraft();

		const restored = loadActiveCraft(root, "my-feature");

		expect(typeof CRAFT_STATE_VERSION).toBe("number");
		expect(restored?.stateVersion).toBe(CRAFT_STATE_VERSION);
	});

	it("throws on an unknown NEWER version instead of silently promoting it to active", () => {
		const root = tmpProject();
		const found = futureVersion();
		writePersistedState(root, "my-feature", { ...freshState(root), stateVersion: found });

		let err: unknown;
		try {
			loadActiveCraft(root, "my-feature");
		} catch (e) {
			err = e;
		}

		expect(err).toBeInstanceOf(Error);
		const msg = err instanceof Error ? err.message : "";
		expect(msg).toContain(String(found));
		expect(msg).toContain(String(CRAFT_STATE_VERSION));
		expect(msg).toContain(craftStatePath(root, "my-feature"));
		// the silent-active-promotion path is the actual hazard this closes:
		expect(getActiveCraft()).toBeUndefined();
	});

	it("reads a legacy file with no stateVersion field tolerantly (no throw, field undefined)", () => {
		const root = tmpProject();
		writePersistedState(root, "my-feature", { feature: "my-feature", projectRoot: root, testsPassed: false, aborted: false });

		const restored = loadActiveCraft(root, "my-feature");

		expect(restored?.feature).toBe("my-feature");
		expect(restored?.stateVersion).toBeUndefined();
	});
});

describe("readPersistedCraftState — stateVersion (reader 2, exact-root, never touches the singleton)", () => {
	it("stamps stateVersion on write and reads it back at the exact root", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root)); // persists+stamps
		clearActiveCraft();

		const read = readPersistedCraftState(root, "my-feature");

		expect(typeof CRAFT_STATE_VERSION).toBe("number");
		expect(read?.stateVersion).toBe(CRAFT_STATE_VERSION);
	});

	it("throws on an unknown NEWER version rather than returning a mis-read state", () => {
		const root = tmpProject();
		const found = futureVersion();
		writePersistedState(root, "my-feature", { ...freshState(root), stateVersion: found });

		let err: unknown;
		try {
			readPersistedCraftState(root, "my-feature");
		} catch (e) {
			err = e;
		}

		expect(err).toBeInstanceOf(Error);
		const msg = err instanceof Error ? err.message : "";
		expect(msg).toContain(String(found));
		expect(msg).toContain(String(CRAFT_STATE_VERSION));
		expect(msg).toContain(craftStatePath(root, "my-feature"));
		// reader 2 never touches the active singleton, before or after the throw:
		expect(getActiveCraft()).toBeUndefined();
	});

	it("reads a legacy file with no stateVersion field tolerantly (no throw, field undefined)", () => {
		const root = tmpProject();
		writePersistedState(root, "my-feature", { feature: "my-feature", projectRoot: root, testsPassed: false, aborted: false });

		const read = readPersistedCraftState(root, "my-feature");

		expect(read?.feature).toBe("my-feature");
		expect(read?.stateVersion).toBeUndefined();
	});
});

describe("every durable mutator stamps stateVersion when it rewrites a legacy (unversioned) file (M6 — not just setActiveCraft)", () => {
	// plan Step 1a requires stamping on EVERY writeFileAtomicSync path, not only setActiveCraft: a
	// mutator that rewrites an older, unversioned file but forgets to stamp would silently persist a
	// file the version gate can never protect. Each case seeds a LEGACY file (no stateVersion), drives
	// one durable mutator, then re-reads the raw bytes and asserts the rewrite now carries the current
	// version. Because the seed explicitly lacks the field, a mutator that only PRESERVES an existing
	// version (never ADDING one) is caught too.
	const feature = "my-feature";

	function seedLegacy(root: string, extra: object = {}): void {
		writePersistedState(root, feature, { feature, projectRoot: root, testsPassed: false, aborted: false, ...extra });
		// Guard the guard: the seed really is unversioned, so the assertion below proves the mutator ADDED the stamp.
		expect(JSON.parse(readFileSync(craftStatePath(root, feature), "utf8")).stateVersion).toBeUndefined();
	}

	function expectStampedToCurrent(root: string): void {
		// RED-guard (mirrors the readers above): pre-craft CRAFT_STATE_VERSION is undefined, so without
		// this the version-equality below would falsely pass as undefined === undefined.
		expect(typeof CRAFT_STATE_VERSION).toBe("number");
		const persisted = JSON.parse(readFileSync(craftStatePath(root, feature), "utf8"));
		expect(persisted.stateVersion).toBe(CRAFT_STATE_VERSION);
	}

	it("recordAuditCycleBegin stamps the file it rewrites", () => {
		const root = tmpProject();
		seedLegacy(root);
		recordAuditCycleBegin(root, feature, 1, 5);
		expectStampedToCurrent(root);
	});

	it("recordAuditValidated stamps the file it rewrites", () => {
		const root = tmpProject();
		seedLegacy(root, { auditCycle: 1, checkLogAtCycleStart: 5 });
		recordAuditValidated(root, feature, 1, "APPROVE", "2026-07-18T10:00:00.000Z");
		expectStampedToCurrent(root);
	});

	it("recordReleaseApprovalAt (the new exact-root writer) stamps the file it rewrites", () => {
		const root = tmpProject();
		// The exact-root writer verifies feature/projectRoot/worktreeRoot match the identity before it
		// writes, so the seeded legacy file must carry the matching identity fields (here: no worktreeRoot).
		seedLegacy(root);
		const identity = { feature, projectRoot: root };
		const evidence = {
			nonce: "nonce-land-0001",
			tag: "[Land]",
			question: "[Land] Land the approved worktree? Proceed?",
			response: "yes",
			issuedAt: "2026-07-18T10:00:00.000Z",
		};

		recordReleaseApprovalAt(root, identity, evidence);

		expectStampedToCurrent(root);
		// …and it actually wrote the evidence (not a silent no-op that would trivially "not regress" the version).
		expect(JSON.parse(readFileSync(craftStatePath(root, feature), "utf8")).releaseApproval?.tag).toBe("[Land]");
	});
});
