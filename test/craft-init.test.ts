// F3 (corrected point-fix) — lsc_craft_init must register its two per-feature gitignore
// sidecars (.craft-state.json, check/logs/) at the ACTUAL craft root (worktreeRoot ?? ctx.cwd),
// never unconditionally at the project root. Always-worktree (C6/R5) means these sidecars are
// created INSIDE the worktree, and a linked worktree only ever reads its OWN working tree's
// .gitignore (the committed content of whatever branch it has checked out) — an uncommitted
// edit to the PROJECT ROOT's .gitignore has zero effect inside a worktree checked out on a
// different branch (team-lead's re-verification probe: root IGNORED / worktree NOT ignored,
// `?? .lsc/` still surfaced). This file pins the wiring in src/craft/init.ts's execute, not just
// the gitignore.ts helper functions themselves (those already have their own root-agnostic unit
// tests in test/artifacts-gitignore.test.ts — this bug lived entirely in which root init.ts
// passed them).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, describe, expect, it } from "vitest";
import { craftDir, worktreePath } from "../src/artifacts/paths";
import { addWorktree } from "../src/artifacts/worktree";
import { registerCraftInitTool } from "../src/craft/init";
import { clearActiveCraft } from "../src/craft/state";

// ── SDK-boundary double (same shape as test/artifacts-scaffold.test.ts's own capture) ──────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}
type ToolExecute = (
	toolCallId: string,
	params: Record<string, unknown>,
	signal: unknown,
	onUpdate: unknown,
	ctx: { cwd: string; hasUI: boolean },
) => Promise<ToolResultLike>;
interface RegisteredTool {
	name: string;
	execute: ToolExecute;
}

function isRegisteredTool(value: unknown): value is RegisteredTool {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"execute" in value &&
		typeof value.execute === "function"
	);
}

function captureCraftInitExecute(): ToolExecute {
	let execute: ToolExecute | undefined;
	const pi = {
		zod,
		registerTool(definition: unknown): void {
			if (isRegisteredTool(definition) && definition.name === "lsc_craft_init") execute = definition.execute;
		},
	};
	registerCraftInitTool(pi as unknown as Parameters<typeof registerCraftInitTool>[0]);
	if (!execute) throw new Error("registerCraftInitTool did not register an lsc_craft_init tool with an execute");
	return execute;
}

function ctxFor(cwd: string): { cwd: string; hasUI: boolean } {
	return { cwd, hasUI: true };
}

// ── git fixture (same shape as artifacts-worktree/artifacts-scaffold's own tmpGitRepo) ─────────
const tempDirs: string[] = [];
afterEach(() => {
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tmpGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-craftinit-"));
	tempDirs.push(dir);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "seed\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

/** pre-craft's three required artifacts, non-blank, directly under craftDir(root, feature). */
function seedPreCraftArtifacts(root: string, feature: string): void {
	const dir = craftDir(root, feature);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "trace.md"), "trace\n");
	writeFileSync(join(dir, "spec.md"), "spec\n");
	writeFileSync(join(dir, "plan.md"), "plan\n");
}

describe("lsc_craft_init — F3 gitignore registration targets the craft root, not unconditionally the project root", () => {
	it("worktree:true — registers both sidecar entries in the WORKTREE's own .gitignore, not the project root's", async () => {
		const cwd = tmpGitRepo();
		const feature = "my-feature";
		await addWorktree(cwd, feature);
		const wt = worktreePath(cwd, feature);
		seedPreCraftArtifacts(wt, feature);

		const execute = captureCraftInitExecute();
		const result = await execute("tc", { feature_dir: feature, worktree: true }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, JSON.stringify(result)).toBeFalsy();

		const wtGitignorePath = join(wt, ".gitignore");
		expect(existsSync(wtGitignorePath), "the worktree's own .gitignore must receive the entries").toBe(true);
		const wtContent = readFileSync(wtGitignorePath, "utf8");
		expect(wtContent).toContain(".lsc/crafts/*/check/logs/");
		expect(wtContent).toContain(".lsc/crafts/*/.craft-state.json");

		// The corrected bug: a worktree craft must NOT write these entries into the project root's
		// .gitignore — that file (if it even exists here) must stay untouched by this call.
		const rootGitignorePath = join(cwd, ".gitignore");
		const rootContent = existsSync(rootGitignorePath) ? readFileSync(rootGitignorePath, "utf8") : "";
		expect(rootContent).not.toContain(".lsc/crafts/*/check/logs/");
		expect(rootContent).not.toContain(".lsc/crafts/*/.craft-state.json");
	});

	it("no worktree (root === ctx.cwd) — registers both sidecar entries in the project root's .gitignore, unchanged from before", async () => {
		const cwd = tmpGitRepo();
		const feature = "plain-feature";
		seedPreCraftArtifacts(cwd, feature);

		const execute = captureCraftInitExecute();
		const result = await execute("tc", { feature_dir: feature }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, JSON.stringify(result)).toBeFalsy();

		const content = readFileSync(join(cwd, ".gitignore"), "utf8");
		expect(content).toContain(".lsc/crafts/*/check/logs/");
		expect(content).toContain(".lsc/crafts/*/.craft-state.json");
	});

	it("regression: `git check-ignore` run FROM INSIDE the worktree recognizes both sidecar paths as ignored — the actual isolation this fix corrects (team-lead's real-repo probe: root IGNORED / worktree NOT ignored before this fix)", async () => {
		const cwd = tmpGitRepo();
		const feature = "regression-feature";
		await addWorktree(cwd, feature);
		const wt = worktreePath(cwd, feature);
		seedPreCraftArtifacts(wt, feature);

		const execute = captureCraftInitExecute();
		const result = await execute("tc", { feature_dir: feature, worktree: true }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, JSON.stringify(result)).toBeFalsy();

		const statePath = join(craftDir(wt, feature), ".craft-state.json");
		const logPath = join(craftDir(wt, feature), "check", "logs", "check-1.log");
		// check-ignore exits 0 (no throw) iff the path IS ignored, from a git invocation rooted at
		// the worktree itself — exactly what an executor running inside {worktreeAbs} would see.
		expect(() => execFileSync("git", ["check-ignore", "-q", statePath], { cwd: wt }), `${statePath} must be ignored from inside the worktree`).not.toThrow();
		expect(() => execFileSync("git", ["check-ignore", "-q", logPath], { cwd: wt }), `${logPath} must be ignored from inside the worktree`).not.toThrow();
	});
});
