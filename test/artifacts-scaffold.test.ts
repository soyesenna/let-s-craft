// W2-b — production-seam integration for lsc_scaffold (deferred-pool AC5, plan §6 Step 4,
// appendix-test-plan W2-b, appendix-pre-mortem P3 sibling: capability containment).
//
// lsc_scaffold replaces pre-craft Stage 0's hand-run bash (worktree add + branch + crafts dir +
// gitignore wiring, SKILL.md:84-96) with a deterministic tool. This file captures the ACTUALLY-
// registered `lsc_scaffold` execute through an SDK-boundary mock `pi` and drives it against a real
// mkdtemp git repo, asserting (a) it wires Stage 0 THROUGH the existing TS functions (addWorktree
// etc. — behavioral equivalence, not a reimplementation), with the crafts dir created INSIDE the
// worktree (craftDir(worktreePath(cwd,f),f)) and NEVER at project root; (b) a re-run is a genuine
// no-op verified by CONTENT comparison (never mtime — fs resolution is coarse); and (c) the two-
// capability write boundary (worktree subtree + exactly projectRoot/.gitignore) holds — a whole-tree
// before/after delta shows nothing outside those two capabilities changed (git's own .git
// bookkeeping excluded, as scaffold delegates worktree creation to the real `git worktree add`
// seam), and both a symlink redirect (S2 double realpath-containment) and a traversal feature name
// are rejected before any write escapes it.
//
// PRE-CRAFT / RED EXPECTATION: src/artifacts/scaffold.ts does not exist yet, so this file fails to
// LOAD (import-shaped RED on `../src/artifacts/scaffold`). That RED is the correct test-first
// outcome ("지금은 import-RED 정상"); making it green is craft's job.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftDir, worktreePath } from "../src/artifacts/paths";
import { addWorktree } from "../src/artifacts/worktree";
// NEW MODULE (Step 4) — the import that makes this file import-RED pre-craft.
import { registerScaffoldTool } from "../src/artifacts/scaffold";

// ── SDK-boundary doubles (capture the real registered execute) ───────────────
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

function captureScaffoldExecute(): ToolExecute {
	let execute: ToolExecute | undefined;
	const pi = {
		zod,
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (isRegisteredTool(definition) && definition.name === "lsc_scaffold") execute = definition.execute;
		},
	};
	registerScaffoldTool(pi as unknown as Parameters<typeof registerScaffoldTool>[0]);
	if (!execute) throw new Error("registerScaffoldTool did not register an lsc_scaffold tool with an execute");
	return execute;
}

function textOf(result: ToolResultLike): string {
	const first = result.content?.[0];
	if (first && typeof first === "object" && "text" in first && typeof first.text === "string") return first.text;
	throw new Error("expected the first tool-result content item to be text");
}

// ── git fixture ──────────────────────────────────────────────────────────────
const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
});

afterEach(() => {
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tmpGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-scaffold-"));
	tempDirs.push(dir);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "seed\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

function outsideDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-outside-"));
	tempDirs.push(dir);
	return dir;
}

function ctxFor(cwd: string): { cwd: string; hasUI: boolean } {
	return { cwd, hasUI: true };
}

function gitignoreLineCount(cwd: string, entry: string): number {
	const path = join(cwd, ".gitignore");
	if (!existsSync(path)) return 0;
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter(line => line.trim() === entry).length;
}

// Whole-tree fingerprint (relPath → content hash / dir / symlink target) so a before/after diff
// reveals EVERY fs mutation. The main-repo `.git` is skipped: scaffold delegates worktree creation
// to `git worktree add` through addWorktree, and git managing its own refs/worktrees bookkeeping is
// an intrinsic effect of that real seam — not one of scaffold's declared write capabilities.
function snapshotTree(root: string): Map<string, string> {
	const out = new Map<string, string>();
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (rel === "" && entry.name === ".git") continue;
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`;
			const abs = join(dir, entry.name);
			if (entry.isSymbolicLink()) out.set(relPath, `symlink:${readlinkSync(abs)}`);
			else if (entry.isDirectory()) {
				out.set(relPath, "dir");
				walk(abs, relPath);
			} else if (entry.isFile()) out.set(relPath, `file:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
			else out.set(relPath, "other");
		}
	};
	walk(root, "");
	return out;
}

// Paths whose fingerprint was added/removed/changed between two snapshots (sorted).
function treeDelta(before: Map<string, string>, after: Map<string, string>): string[] {
	const changed = new Set<string>();
	for (const [k, v] of after) if (before.get(k) !== v) changed.add(k);
	for (const k of before.keys()) if (!after.has(k)) changed.add(k);
	return [...changed].sort();
}

// The git control-plane (refs + registered worktrees) — a rejected scaffold must leave BOTH byte-
// identical. snapshotTree deliberately skips the main-repo .git, so a late-validating impl that creates
// a branch/ref and registers a worktree before cleaning only the worktree DIRECTORY would pass the tree
// delta yet leak here (M2/MF7). Comparing this before/after execute pins the .git control-plane too.
function gitControlState(cwd: string): string {
	return JSON.stringify({
		refs: git(cwd, ["for-each-ref", "--format=%(refname) %(objectname)"]),
		worktrees: git(cwd, ["worktree", "list", "--porcelain"]),
	});
}

// A relPath is inside the declared 2-capability write boundary iff it is (1) the worktree subtree
// worktreePath(cwd,feature)/** (incl. the structural ancestors .lsc + .lsc/worktrees that must exist
// to host it) or (2) EXACTLY projectRoot/.gitignore. Anything else (e.g. projectRoot/.lsc/crafts) is
// a forbidden 3rd capability.
function withinCapability(relPath: string, feature: string): boolean {
	if (relPath === ".gitignore") return true;
	if (relPath === ".lsc" || relPath === ".lsc/worktrees") return true;
	const wtRel = `.lsc/worktrees/${feature}`;
	return relPath === wtRel || relPath.startsWith(`${wtRel}/`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AC5 — deterministic Stage 0 wiring through the existing TS functions
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_scaffold — AC5 deterministic Stage 0 wiring", () => {
	it("creates the worktree, default branch, crafts dir, and gitignore entry via the existing TS seams", async () => {
		const cwd = tmpGitRepo();
		const execute = captureScaffoldExecute();

		const before = snapshotTree(cwd);
		const result = await execute("tc", { feature: "my-feature" }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, textOf(result)).toBeFalsy();

		// Tree delta: everything scaffold touched must fall inside the 2-capability boundary
		// (worktree subtree OR exactly projectRoot/.gitignore) — a project-root crafts write or any
		// other escape surfaces here as a violation.
		const violations = treeDelta(before, snapshotTree(cwd)).filter(p => !withinCapability(p, "my-feature"));
		expect(violations, `scaffold wrote outside its 2-capability boundary: ${violations.join(", ")}`).toEqual([]);

		// worktree created + registered (git worktree add went through, not a bare mkdir)...
		const wt = worktreePath(cwd, "my-feature");
		expect(existsSync(wt)).toBe(true);
		expect(git(cwd, ["worktree", "list", "--porcelain"]).includes(wt)).toBe(true);
		// ...on the addWorktree default branch name...
		expect(git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("lets-craft/my-feature");
		// ...crafts dir wired INSIDE the worktree (canon: crafts live under the worktree, never at
		// project root — the 2-capability write boundary, plan.md:170-171)...
		expect(existsSync(craftDir(wt, "my-feature"))).toBe(true);
		// ...and absent at project root (projectRoot/.lsc/crafts would be a forbidden 3rd capability).
		expect(existsSync(craftDir(cwd, "my-feature")), "crafts must live inside the worktree, never at project root").toBe(false);
		// ...gitignore entry appended (exactly one).
		expect(gitignoreLineCount(cwd, ".lsc/worktrees/")).toBe(1);

		// Behavioral equivalence with addWorktree: a subsequent addWorktree recognizes the worktree
		// scaffold created as a reuse (C7), proving scaffold went THROUGH addWorktree's semantics.
		const reAdd = await addWorktree(cwd, "my-feature");
		expect(reAdd.reused).toBe(true);
	});

	it("passes the branch argument through to addWorktree (co-evolution: prose-detected prefix)", async () => {
		const cwd = tmpGitRepo();
		const execute = captureScaffoldExecute();

		const result = await execute("tc", { feature: "custom", branch: "release/custom" }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, textOf(result)).toBeFalsy();

		const wt = worktreePath(cwd, "custom");
		expect(git(wt, ["rev-parse", "--abbrev-ref", "HEAD"]), "the branch arg must reach addWorktree options.branch").toBe("release/custom");
	});

	// C4: base_ref exposes addWorktree's existing baseRef (worktree.ts:47, 76) through
	// performScaffold/lsc_scaffold — needed so a parallel executor lane (C6 §3.3) can fork from the
	// feature branch's forkPoint rather than whatever HEAD happens to be at scaffold time.
	it("base_ref: a newly created branch forks from the explicit ref, not from current HEAD", async () => {
		const cwd = tmpGitRepo();
		const forkPoint = git(cwd, ["rev-parse", "HEAD"]);
		// Advance main PAST the fork point so "current HEAD" and "base_ref" are provably different.
		writeFileSync(join(cwd, "later.txt"), "later\n");
		git(cwd, ["add", "later.txt"]);
		git(cwd, ["commit", "-q", "-m", "later commit"]);
		expect(git(cwd, ["rev-parse", "HEAD"])).not.toBe(forkPoint);

		const execute = captureScaffoldExecute();
		const result = await execute("tc", { feature: "lane-a", base_ref: forkPoint }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, textOf(result)).toBeFalsy();

		const wt = worktreePath(cwd, "lane-a");
		expect(git(wt, ["rev-parse", "HEAD"]), "an explicit base_ref must be honored for a newly created branch").toBe(forkPoint);
	});

	it("base_ref omitted: a newly created branch forks from current HEAD (addWorktree's own default)", async () => {
		const cwd = tmpGitRepo();
		const currentHead = git(cwd, ["rev-parse", "HEAD"]);

		const execute = captureScaffoldExecute();
		const result = await execute("tc", { feature: "lane-b" }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, textOf(result)).toBeFalsy();

		const wt = worktreePath(cwd, "lane-b");
		expect(git(wt, ["rev-parse", "HEAD"]), "an omitted base_ref must default to HEAD").toBe(currentHead);
	});

	// C4/BL3: reuse is an intentional contract, not a defect merely captured as expected behavior —
	// an existing worktree/branch is reused as-is on a re-run, and a DIFFERENT base_ref passed on
	// that re-run must be silently ignored rather than silently rebasing an in-progress lane.
	it("contract: reusing an existing worktree/branch ignores base_ref (C7 resume, not a defect) — content unchanged, no duplicate gitignore line, hand-added artifacts preserved, branch tip stays put", async () => {
		const cwd = tmpGitRepo();
		const execute = captureScaffoldExecute();
		await execute("tc1", { feature: "resume" }, undefined, undefined, ctxFor(cwd));

		// A human/earlier-stage artifact under the crafts dir must survive a resume re-run.
		const handArtifact = join(craftDir(worktreePath(cwd, "resume"), "resume"), "trace.md");
		writeFileSync(handArtifact, "hand-authored trace\n");
		const gitignoreBefore = readFileSync(join(cwd, ".gitignore"), "utf8");
		const wt = worktreePath(cwd, "resume");
		const tipBefore = git(wt, ["rev-parse", "HEAD"]);

		// Advance main past the original fork point AFTER the first scaffold call, so passing it as
		// base_ref on the re-run would be a DETECTABLE (and wrong) rebase if it were ever honored.
		writeFileSync(join(cwd, "extra.txt"), "more\n");
		git(cwd, ["add", "extra.txt"]);
		git(cwd, ["commit", "-q", "-m", "extra"]);
		expect(git(cwd, ["rev-parse", "main"])).not.toBe(tipBefore);

		const second = await execute("tc2", { feature: "resume", base_ref: "main" }, undefined, undefined, ctxFor(cwd));
		expect(second.isError, textOf(second)).toBeFalsy();
		expect((second.details as { reused?: boolean } | undefined)?.reused).toBe(true);

		// Content comparison (NOT mtime — appendix W2-b): every observable is byte-identical.
		expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toBe(gitignoreBefore);
		expect(gitignoreLineCount(cwd, ".lsc/worktrees/")).toBe(1);
		expect(readFileSync(handArtifact, "utf8"), "a resume re-run must not clobber existing artifacts").toBe("hand-authored trace\n");
		expect(existsSync(wt)).toBe(true);
		// The contract itself: base_ref="main" was passed but must be ignored — the branch tip is
		// exactly what it was before, never rebased onto the newly-advanced main.
		expect(git(wt, ["rev-parse", "HEAD"]), "base_ref must be ignored when an existing worktree/branch is reused").toBe(tipBefore);
	});

	// Traversal feature names must be rejected before ANY write escapes the capability boundary
	// (canon: kebab slug only, "write 전 거부" — parallels lsc_claims, appendix W2-d). A name with a
	// parent-ref or a path separator would resolve worktreePath/craftDir outside their roots.
	it.each([
		["parent traversal", "../escape"],
		["path separator", "nested/feature"],
	])("rejects a traversal feature name (%s) before any write", async (_label, feature) => {
		const cwd = tmpGitRepo();
		const execute = captureScaffoldExecute();
		const before = snapshotTree(cwd);
		const gitBefore = gitControlState(cwd);

		const result = await execute("tc", { feature }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, `a traversal feature name (${feature}) must be rejected`).toBe(true);
		// Rejected before any side effect: the tree (outside git bookkeeping) is byte-identical.
		expect(treeDelta(before, snapshotTree(cwd)), "a rejected scaffold must not leave any fs write behind").toEqual([]);
		// ...and the git control-plane (refs + worktree registrations) is likewise untouched — a late-
		// validating impl that made a branch/registered the worktree before cleanup would leak here (MF7).
		expect(gitControlState(cwd), "a rejected traversal name must create no branch/ref and register no worktree").toBe(gitBefore);
	});

	it("rejects when the worktrees path is redirected outside its capability by a symlink (containment)", async () => {
		const cwd = tmpGitRepo();
		const escape = outsideDir();
		// .lsc/worktrees → outside the project: writing "inside the worktree" would land outside projectRoot.
		mkdirSync(join(cwd, ".lsc"), { recursive: true });
		symlinkSync(escape, join(cwd, ".lsc", "worktrees"));
		const execute = captureScaffoldExecute();
		const gitBefore = gitControlState(cwd);

		const result = await execute("tc", { feature: "evil" }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, "a symlinked worktrees dir escaping containment must be rejected").toBe(true);
		// nothing was created through the escaping symlink.
		expect(existsSync(join(escape, "evil"))).toBe(false);
		// the git control-plane is unchanged: no lets-craft/evil branch, no worktree registration leaked.
		expect(gitControlState(cwd), "a rejected symlink-escape must create no branch/ref and register no worktree").toBe(gitBefore);
	});

	it("rejects when projectRoot/.gitignore is a symlink (capability is exactly projectRoot/.gitignore)", async () => {
		const cwd = tmpGitRepo();
		const escape = outsideDir();
		const decoy = join(escape, "stolen-gitignore");
		writeFileSync(decoy, "# not the project gitignore\n");
		rmSync(join(cwd, ".gitignore"), { force: true });
		symlinkSync(decoy, join(cwd, ".gitignore"));
		const execute = captureScaffoldExecute();
		const gitBefore = gitControlState(cwd);

		const result = await execute("tc", { feature: "gi-escape" }, undefined, undefined, ctxFor(cwd));
		expect(result.isError, "a symlinked .gitignore escaping the exact-path capability must be rejected").toBe(true);
		// the decoy target outside the project was not written through.
		expect(readFileSync(decoy, "utf8")).toBe("# not the project gitignore\n");
		// the git control-plane is unchanged: the pre-write .gitignore rejection leaked no branch/registration.
		expect(gitControlState(cwd), "a rejected .gitignore-symlink must create no branch/ref and register no worktree").toBe(gitBefore);
	});
});
