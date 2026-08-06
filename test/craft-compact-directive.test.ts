import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { craftPlanPath, craftSpecPath } from "../src/artifacts/paths";
import { buildCompactionDirective, registerCompactionDirective } from "../src/craft/compact-directive";
import * as stateModule from "../src/craft/state";
import { clearActiveCraft, type CraftState, setActiveCraft } from "../src/craft/state";

const CRAFT: CraftState = { projectRoot: "/repo", feature: "my-feature", aborted: false };
const WORKTREE_ROOT = "/repo/.lsc/worktrees/my-feature";
const CRAFT_WORKTREE: CraftState = { ...CRAFT, worktreeRoot: WORKTREE_ROOT };

// C-3: the directive is the pure "what to say" half of the compaction hook — exhaustively
// unit-tested here, mirroring enforcement.ts's continuationResult tests in craft-enforcement.test.ts.
describe("buildCompactionDirective", () => {
	it("returns null when there is no active craft", () => {
		expect(buildCompactionDirective(undefined)).toBeNull();
	});

	it("names the active craft's feature", () => {
		expect(buildCompactionDirective(CRAFT)).toContain('"my-feature"');
	});

	it("instructs re-reading skill://craft by name", () => {
		const directive = buildCompactionDirective(CRAFT) ?? "";
		expect(directive).toContain("skill://craft");
		expect(directive).toContain("skills/craft/SKILL.md");
	});

	it("instructs re-reading the absolute spec.md and plan.md paths (project root, no worktree)", () => {
		const directive = buildCompactionDirective(CRAFT) ?? "";
		expect(directive).toContain(craftSpecPath("/repo", "my-feature"));
		expect(directive).toContain(craftPlanPath("/repo", "my-feature"));
	});

	it("resolves spec.md/plan.md against the worktree root when one is active, not the project root", () => {
		const directive = buildCompactionDirective(CRAFT_WORKTREE) ?? "";
		expect(directive).toContain(craftSpecPath(WORKTREE_ROOT, "my-feature"));
		expect(directive).toContain(craftPlanPath(WORKTREE_ROOT, "my-feature"));
		expect(directive).not.toContain(craftSpecPath("/repo", "my-feature"));
		expect(directive).not.toContain(craftPlanPath("/repo", "my-feature"));
	});

	it("warns against trusting the compaction summary as memory of the craft's contract", () => {
		expect(buildCompactionDirective(CRAFT)).toMatch(/do not trust.*compaction summary.*memory/i);
	});

	it("restates that craft is single-shot — its only valid exits are completion or an explicit lsc_craft_abort", () => {
		const directive = buildCompactionDirective(CRAFT) ?? "";
		expect(directive).toMatch(/single-shot/i);
		expect(directive).toContain("lsc_craft_abort");
		expect(directive).toMatch(/never an automatic repeat/i);
	});

	it("restates the forkPoint recovery rule for a parallel-lane run whose forkPoint didn't survive compaction", () => {
		const directive = buildCompactionDirective(CRAFT) ?? "";
		expect(directive).toContain("forkPoint");
		expect(directive).toMatch(/do not restore it from memory|substitute the feature branch/i);
		expect(directive).toMatch(/merge-base/i);
	});

	it("restates that human-facing questions must go through lsc_ask/lsc_select/lsc_confirm", () => {
		const directive = buildCompactionDirective(CRAFT) ?? "";
		expect(directive).toContain("lsc_ask");
		expect(directive).toContain("lsc_select");
		expect(directive).toContain("lsc_confirm");
	});
});

// The registration wrapper: captures the handler registerCompactionDirective wires via pi.on
// (real wiring, same pattern destructive-approval.test.ts uses for registerCraftStateResets),
// then exercises it directly — no real session/host needed.
describe("registerCompactionDirective", () => {
	type CompactingHandler = () => { context: string[] } | undefined;

	function captureHandler(): CompactingHandler {
		let handler: CompactingHandler | undefined;
		const fakePi = {
			on(event: string, callback: CompactingHandler): void {
				if (event === "session.compacting") handler = callback;
			},
		};
		registerCompactionDirective(fakePi as unknown as Parameters<typeof registerCompactionDirective>[0]);
		if (!handler) throw new Error("registerCompactionDirective did not register a session.compacting handler");
		return handler;
	}

	const tempDirs: string[] = [];
	afterEach(() => {
		clearActiveCraft();
		vi.restoreAllMocks();
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});
	beforeEach(() => clearActiveCraft());

	function tmpProject(): string {
		const dir = mkdtempSync(join(tmpdir(), "lsc-compact-"));
		tempDirs.push(dir);
		return dir;
	}

	it("returns nothing when there is no active craft", () => {
		const handler = captureHandler();
		expect(handler()).toBeUndefined();
	});

	it("returns { context: [directive] } matching buildCompactionDirective when a craft is active", () => {
		const projectRoot = tmpProject();
		const craft: CraftState = { projectRoot, feature: "my-feature", aborted: false };
		setActiveCraft(craft);

		const handler = captureHandler();
		const result = handler();
		expect(result).toEqual({ context: [buildCompactionDirective(craft)] });
	});

	it("never throws even if reading the active craft fails — swallowed, not surfaced", () => {
		vi.spyOn(stateModule, "getActiveCraft").mockImplementation(() => {
			throw new Error("boom");
		});
		const handler = captureHandler();
		expect(() => handler()).not.toThrow();
		expect(handler()).toBeUndefined();
	});
});
