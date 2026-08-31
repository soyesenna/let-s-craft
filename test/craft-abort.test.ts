import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath, worktreePath } from "../src/artifacts/paths";
import { performCraftAbort } from "../src/craft/abort";
import { installPreparedOperation, peekPreparedOperation } from "../src/craft/destructive-approval";
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

// ===========================================================================
// postcraft-14cycle-approval-failure PR-2 — the optional exact-root `feature_dir`
// input: post-craft's [Audit Escalation] "Abort this craft" delegation arrives from a
// fresh process with NO active-craft singleton, so the tool must abort the feature's
// persisted state at its exact root (worktree-first candidate seam). The legacy
// active-craft caller above stays unchanged.
// ===========================================================================

describe("performCraftAbort — optional feature_dir (exact-root, fresh-process path)", () => {
	function writePersistedState(root: string, feature: string, state: object): void {
		const path = craftStatePath(root, feature);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(state, null, 2));
	}

	it("aborts the feature's persisted state with no active singleton, and invalidates pending approvals/prepared operations", () => {
		const projectRoot = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(projectRoot, feature);
		writePersistedState(wt, feature, { feature, projectRoot, worktreeRoot: wt, aborted: false, auditCycle: 2 });
		// A live staged destructive capability that must NOT survive the abort.
		installPreparedOperation({
			prepareId: "prep-1",
			tag: "[Land]",
			identity: { feature, projectRoot, worktreeRoot: wt },
			operationScope: { sourceBranch: "lets-craft/my-feature", sourceOID: "a", targetBranch: "main", targetOID: "b", mode: "merge-and-clean" },
			approvalQuestion: "[Land] Merge? Merge?",
			evidenceRoot: wt,
		});

		const result = performCraftAbort("audit escalation: Abort this craft", `.lsc/crafts/${feature}`, projectRoot);

		expect(result.isError).toBeFalsy();
		expect(result.details).toEqual({ feature, reason: "audit escalation: Abort this craft" });
		expect(JSON.parse(readFileSync(craftStatePath(wt, feature), "utf8")).aborted).toBe(true);
		expect(peekPreparedOperation("[Land]")).toBeUndefined(); // staged operation invalidated
		expect(getActiveCraft()).toBeUndefined(); // never resurrected a singleton
	});

	it("fails closed when no persisted state exists for the resolved feature", () => {
		const projectRoot = tmpProject();
		const result = performCraftAbort("user stop", "never-crafted", projectRoot);
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("no persisted craft state");
	});
});

// ===========================================================================
// audit-0 RF-15④ / RF-13 — the singleton abort path's invalidatePreparedOperation() branch
// (abort.ts:59, previously only the featureDir path and pending approvals were covered), and
// the kebab-slug boundary guard on the resolved feature_dir.
// ===========================================================================

describe("RF-15④ — singleton-path abort invalidates a staged destructive operation", () => {
	it("an active craft + installed prepared operation: performCraftAbort clears the staged op and marks aborted", () => {
		const projectRoot = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(projectRoot, feature);
		setActiveCraft({ feature, projectRoot, worktreeRoot: wt, aborted: false });
		installPreparedOperation({
			prepareId: "prep-singleton",
			tag: "[Land]",
			identity: { feature, projectRoot, worktreeRoot: wt },
			operationScope: { sourceBranch: "lets-craft/my-feature", sourceOID: "a", targetBranch: "main", targetOID: "b", mode: "merge-and-clean" },
			approvalQuestion: "[Land] Merge? Merge?",
			evidenceRoot: wt,
		});
		expect(peekPreparedOperation("[Land]")?.prepareId).toBe("prep-singleton");

		const result = performCraftAbort("user stop");

		expect(result.isError).toBeFalsy();
		expect(result.details).toEqual({ feature, reason: "user stop" });
		expect(getActiveCraft()?.aborted).toBe(true);
		expect(peekPreparedOperation("[Land]")).toBeUndefined(); // nothing staged survives the abort
	});
});

describe("RF-13 — performCraftAbort refuses a non-slug resolved feature_dir before any fs access", () => {
	it("newline/space/semicolon/dot payloads are refused with the kebab-slug message", () => {
		const projectRoot = tmpProject();
		for (const forged of ["bad\nfeature", "Shout Case", "semi;colon", "dot.name"]) {
			const result = performCraftAbort("user stop", forged, projectRoot);
			const first = result.content[0];
			expect(result.isError, `feature_dir ${JSON.stringify(forged)} must be refused`).toBe(true);
			expect(first !== undefined && "text" in first ? first.text : "").toContain("kebab-case slug");
		}
	});
});

// ===========================================================================
// audit-1 RF-20(a) — the free-text `reason` is control-checked BEFORE any effect: no abort
// write, no durable-state mutation, and the refusal names the field, never the payload.
// ===========================================================================

describe("RF-20(a) — performCraftAbort refuses a control-carrying reason before any effect", () => {
	beforeEach(() => clearActiveCraft());

	it("the singleton path refuses newline/tab/ESC/DEL reasons without aborting anything", () => {
		const projectRoot = tmpProject();
		setActiveCraft(freshState(projectRoot));
		const bytes = readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8");
		for (const forged of ["stop\nplease", "stop\ttab", "run\x1b[2away", "del\x7fete"]) {
			const result = performCraftAbort(forged);
			expect(result.isError, JSON.stringify(forged)).toBe(true);
			const first = result.content[0];
			const text = first !== undefined && "text" in first && typeof first.text === "string" ? first.text : "";
			expect(text).toContain("control characters");
			expect(text).toContain("reason");
			expect(text, "무-raw-payload: the refusal is single-line").not.toMatch(/[\u0000-\u001f\u007f]/);
		}
		expect(getActiveCraft()?.aborted, "no abort may be recorded").toBe(false);
		expect(readFileSync(craftStatePath(projectRoot, "my-feature"), "utf8")).toBe(bytes);
	});

	it("the exact-root path (feature_dir) refuses before any fs access too", () => {
		const projectRoot = tmpProject();
		const result = performCraftAbort("bad\nreason", "my-feature", projectRoot);
		expect(result.isError).toBe(true);
		const first = result.content[0];
		expect(first !== undefined && "text" in first ? first.text : "").toContain("control characters");
		// Nothing was created at the would-be worktree state path — the guard fired first.
		expect(existsSync(craftStatePath(worktreePath(projectRoot, "my-feature"), "my-feature"))).toBe(false);
	});
});
