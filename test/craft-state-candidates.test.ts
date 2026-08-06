import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftAuditDir, craftStatePath, worktreePath } from "../src/artifacts/paths";
import { clearActiveCraft, type CraftState, craftStateCandidates, findPersistedCraftState, readPersistedCraftState } from "../src/craft/state";
import { performAuditBegin } from "../src/craft/verdict";

// ===========================================================================
// deferred-pool E (root-해석 seam 공유) — AC10. plan Step 1b + D5. The two root
// consumers share a DESCRIPTOR-ONLY candidate seam:
//   craftStateCandidates(cwd, feature) -> [cwd, worktree] descriptors
//     { root, statePath, rootExists, stateFileExists } — it STATS existence and
//     never reads/parses JSON (lazy). decode is the caller's own call, so a
//     malformed state can never leak into a consumer that never decodes.
//   findPersistedCraftState — worktree-first simple fallback (R9, C2: the former
//     open-release arbitration retired along with openRelease itself).
//   resolveAuditRoot        — directory-existence only (rootExists), decode-independent.
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
	const dir = mkdtempSync(join(tmpdir(), "lsc-state-cand-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

function writePersistedState(root: string, feature: string, state: object): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

/** Write intentionally-corrupt bytes to a feature's .craft-state.json — the descriptor seam must
 * never JSON.parse it, and the directory-existence root policy must never gate on decoding it. */
function writeRawStateFile(root: string, feature: string, raw: string): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, raw);
}

function writeAuditDoc(root: string, feature: string, n: number, verdict: string): void {
	const dir = craftAuditDir(root, feature);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `audit-${n}.md`), `# Audit\n\n**AUDIT VERDICT: ${verdict}**\n`);
}

describe("craftStateCandidates (descriptor-only shared seam)", () => {
	it("returns exactly two descriptors, in [cwd, worktree] order, each with that root's craftStatePath", () => {
		const cwd = tmpProject();
		const feature = "my-feature";

		const candidates = craftStateCandidates(cwd, feature);

		expect(candidates).toHaveLength(2);
		expect(candidates[0].root).toBe(cwd);
		expect(candidates[0].statePath).toBe(craftStatePath(cwd, feature));
		expect(candidates[1].root).toBe(worktreePath(cwd, feature));
		expect(candidates[1].statePath).toBe(craftStatePath(worktreePath(cwd, feature), feature));
	});

	it("rootExists reflects the candidate ROOT DIRECTORY's existence (not the state file's)", () => {
		const cwd = tmpProject();
		const feature = "my-feature";

		// cwd dir exists, worktree dir does not exist yet
		let candidates = craftStateCandidates(cwd, feature);
		expect(candidates[0].rootExists).toBe(true);
		expect(candidates[1].rootExists).toBe(false);

		mkdirSync(worktreePath(cwd, feature), { recursive: true });
		candidates = craftStateCandidates(cwd, feature);
		expect(candidates[1].rootExists).toBe(true);
	});

	it("stateFileExists reflects the .craft-state.json file's existence", () => {
		const cwd = tmpProject();
		const feature = "my-feature";

		expect(craftStateCandidates(cwd, feature)[0].stateFileExists).toBe(false);
		writePersistedState(cwd, feature, freshState(cwd));
		expect(craftStateCandidates(cwd, feature)[0].stateFileExists).toBe(true);
	});

	it("NEVER reads the state file — an unparseable .craft-state.json does not throw (JSON 미독, lazy)", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writeRawStateFile(cwd, feature, "{ this is : not json ]");

		// If the seam decoded eagerly this would throw a SyntaxError; descriptor collection is
		// pure fs-stat, so it stays silent and only reports existence.
		const candidates = craftStateCandidates(cwd, feature);

		expect(candidates[0].rootExists).toBe(true);
		expect(candidates[0].stateFileExists).toBe(true);
	});
});

describe("findPersistedCraftState — both-root fallback (positive edge, decode owner)", () => {
	it("prefers the worktree candidate when BOTH candidates carry persisted state", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, freshState(cwd));
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd), worktreeRoot: wt });

		const found = findPersistedCraftState(cwd, feature);

		expect(found?.worktreeRoot).toBe(wt);
	});
});

describe("resolveAuditRoot — worktree by directory existence only (rootExists, decode-independent)", () => {
	it("performAuditBegin lands the cycle marker on the worktree state when the worktree dir exists", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd), worktreeRoot: wt });
		writeAuditDoc(wt, feature, 0, "APPROVE-WITH-CHANGE");

		const result = performAuditBegin(feature, cwd);

		expect(result.isError).toBeFalsy();
		// the marker landed on the WORKTREE state — resolveAuditRoot chose the worktree:
		expect(readPersistedCraftState(wt, feature)?.auditCycle).toBe(1);
		expect(readPersistedCraftState(cwd, feature)).toBeUndefined();
	});

	it("picks the worktree by directory existence alone — a malformed cwd state never gates the choice", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(cwd, feature);
		// A corrupt state at the CWD candidate: an eager-decode root policy would crash reading it.
		writeRawStateFile(cwd, feature, "{ corrupt ]");
		// Valid state at the worktree so the downstream decode OWNER (recordAuditCycleBegin) succeeds:
		writePersistedState(wt, feature, { ...freshState(cwd), worktreeRoot: wt });

		const result = performAuditBegin(feature, cwd);

		expect(result.isError).toBeFalsy();
		expect(readPersistedCraftState(wt, feature)?.auditCycle).toBe(0);
	});
});
