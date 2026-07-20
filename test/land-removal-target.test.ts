import { describe, expect, it } from "vitest";
import {
	evaluateRemovalTarget,
	parseWorktreePorcelain,
	type RemovalObservation,
	type WorktreeEntry,
} from "../src/artifacts/worktree";

// ===========================================================================
// deferred-pool A (removal 검증) — AC4. plan Step 2, ported from
// oh-my-claudecode/src/lib/worktree-cleanup-safety.ts (N1, 검사 순서 원천 보존).
// The effectful validator is split into two seams:
//   • inspectRemovalTarget(candidate, ports)  — SDK-independent EFFECT (lstat /
//     realpath / existence). This pure file does NOT exercise it. Its land-TIME WIRING is
//     proven in craft-land-flow.test.ts: (a) the injected-LandEffects "TOCTOU re-check" case
//     drives a pre-removal re-inspection that rejects → `validation-reject` with removeWorktree
//     NEVER called (dead-code false-green barrier), and (b) the real-git "main-repo (symlink)"
//     case runs the REAL inspect over a real fs to the same fold.
//   • evaluateRemovalTarget(observation, expectedRoots) — the PURE judgment this
//     file exercises with injected observation fixtures. Returns a discriminated
//     result — { ok: true, resolvedPath, matchedRoot } | { ok: false, reason } —
//     so the land tool can fold a rejection into its own `validation-reject` code.
//
// Rejection reasons (the exhaustive matrix, spec AC4 categories), evaluated in the
// OMC-preserved order sanity -> symlink -> root/home boundary -> containment -> main-repo:
//   "empty" | "nul" | "suspicious"(. .. ~) | "symlink" |
//   "filesystem-root" | "home-directory" | "outside-roots" | "main-repo".
// The순증분 boundary (spec §제약 1, N1) is path safety ONLY — dirty / locked /
// submodule are DELIBERATELY not observed and never gate (git `--force` owns them);
// the negative-confirmation test below defends that with teeth.
//
// RemovalObservation (the shape inspectRemovalTarget produces and evaluate consumes):
//   { input: string;            // raw candidate (sanity checks run on this)
//     exists: boolean; isSymlink: boolean; isDirectory: boolean;
//     resolvedPath: string;     // realpath (or lexical resolve fallback)
//     home: string;             // resolved home dir (for the home boundary)
//     dotGitIsDirectory: boolean } // join(resolvedPath, ".git") exists AND is a dir
// expectedRoots are pre-resolved absolute containment roots (paths.ts:94 worktreesRootDir/worktreePath).
//
// parseWorktreePorcelain(text) is the pure `git worktree list --porcelain` parser
// seam listWorktrees() runs the git call through — WorktreeEntry keeps the prunable
// REASON (doctor's orphan-worktree check needs the granularity, N1).
//
// PRE-CRAFT RED (test-first): none of these exports exist in worktree.ts yet.
// A missing named export resolves to `undefined`, so every `it` is RED at the CALL
// site ("is not a function"). Assertions are on the RETURN VALUE — never `.toThrow()`
// — precisely so a TypeError from calling `undefined` cannot falsely satisfy them.
// ===========================================================================

const ROOTS = ["/srv/proj/.lsc/worktrees"] as const;

/** A concrete, safe worktree target inside ROOTS — the baseline that must evaluate ok. Each
 * rejection case overrides exactly one facet so it triggers exactly one reason (and proves that
 * every earlier check in the order passed). */
function obs(overrides: Partial<RemovalObservation> = {}): RemovalObservation {
	return {
		input: "/srv/proj/.lsc/worktrees/my-feature",
		exists: true,
		isSymlink: false,
		isDirectory: true,
		resolvedPath: "/srv/proj/.lsc/worktrees/my-feature",
		home: "/home/dev",
		dotGitIsDirectory: false,
		...overrides,
	};
}

const rejections: Array<{ name: string; observation: RemovalObservation; reason: string }> = [
	{ name: "an empty string", observation: obs({ input: "" }), reason: "empty" },
	{ name: "a whitespace-only string", observation: obs({ input: "   " }), reason: "empty" },
	{ name: "a NUL byte in the path", observation: obs({ input: "/srv/proj/.lsc/worktrees/a\0b" }), reason: "nul" },
	{ name: "'.'", observation: obs({ input: "." }), reason: "suspicious" },
	{ name: "'..'", observation: obs({ input: ".." }), reason: "suspicious" },
	{ name: "'~'", observation: obs({ input: "~" }), reason: "suspicious" },
	{ name: "a symlink candidate", observation: obs({ isSymlink: true }), reason: "symlink" },
	{ name: "the filesystem root", observation: obs({ resolvedPath: "/" }), reason: "filesystem-root" },
	{
		name: "the home directory",
		observation: obs({ resolvedPath: "/home/dev", home: "/home/dev" }),
		reason: "home-directory",
	},
	{
		name: "an absolute path outside the expected roots",
		observation: obs({ input: "/etc/passwd", resolvedPath: "/etc/passwd" }),
		reason: "outside-roots",
	},
	{
		name: "a '..' separator-injection path that resolves outside containment",
		observation: obs({ input: "/srv/proj/.lsc/worktrees/../../../../etc", resolvedPath: "/etc" }),
		reason: "outside-roots",
	},
	{
		name: "a main repository (its .git is a directory)",
		observation: obs({ dotGitIsDirectory: true }),
		reason: "main-repo",
	},
];

describe("evaluateRemovalTarget — rejection matrix (pure, observation-injected)", () => {
	it.each(rejections)("rejects $name with reason '$reason'", ({ observation, reason }) => {
		const result = evaluateRemovalTarget(observation, ROOTS);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe(reason);
		}
	});
});

describe("evaluateRemovalTarget — acceptance + the no-git-state negative confirmation", () => {
	it("accepts a concrete worktree directory contained by an expected root", () => {
		const result = evaluateRemovalTarget(obs(), ROOTS);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.resolvedPath).toBe("/srv/proj/.lsc/worktrees/my-feature");
			expect(result.matchedRoot).toBe("/srv/proj/.lsc/worktrees");
		}
	});

	it("does NOT check dirty / locked / submodule state — a would-be dirty+locked worktree still passes", () => {
		// The observation carries spurious git-state facets on purpose: evaluate must ignore them
		// entirely (git `--force` owns dirty=1st refusal, locked=2nd — spec §제약 1). If evaluate
		// ever gated on such a field, this valid path would be rejected and the test would go red.
		const dirtyLockedSubmodule = { ...obs(), dirty: true, locked: true, hasSubmodule: true } as RemovalObservation;

		expect(evaluateRemovalTarget(dirtyLockedSubmodule, ROOTS).ok).toBe(true);
	});
});

describe("parseWorktreePorcelain — pure `git worktree list --porcelain` parser", () => {
	it("parses a normal multi-worktree list into path / HEAD / branch entries", () => {
		const porcelain = [
			"worktree /srv/proj",
			"HEAD 1111111111111111111111111111111111111111",
			"branch refs/heads/main",
			"",
			"worktree /srv/proj/.lsc/worktrees/my-feature",
			"HEAD 2222222222222222222222222222222222222222",
			"branch refs/heads/lets-craft/my-feature",
			"",
		].join("\n");

		const entries: WorktreeEntry[] = parseWorktreePorcelain(porcelain);

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({ path: "/srv/proj", head: "1111111111111111111111111111111111111111", branch: "refs/heads/main" });
		expect(entries[1]).toMatchObject({ path: "/srv/proj/.lsc/worktrees/my-feature", branch: "refs/heads/lets-craft/my-feature" });
	});

	it("preserves the prunable REASON on a stale entry and leaves live entries un-prunable", () => {
		const porcelain = [
			"worktree /srv/proj",
			"HEAD 1111111111111111111111111111111111111111",
			"branch refs/heads/main",
			"",
			"worktree /srv/proj/.lsc/worktrees/gone",
			"HEAD 3333333333333333333333333333333333333333",
			"branch refs/heads/lets-craft/gone",
			"prunable gitdir file points to non-existent location",
			"",
		].join("\n");

		const entries = parseWorktreePorcelain(porcelain);

		expect(entries[0].prunable).toBeUndefined();
		expect(entries[1].prunable).toBe("gitdir file points to non-existent location");
	});

	it("captures bare / detached flags and the locked reason", () => {
		const porcelain = [
			"worktree /srv/proj",
			"bare",
			"",
			"worktree /srv/proj/.lsc/worktrees/detached-one",
			"HEAD 4444444444444444444444444444444444444444",
			"detached",
			"",
			"worktree /srv/proj/.lsc/worktrees/locked-one",
			"HEAD 5555555555555555555555555555555555555555",
			"branch refs/heads/lets-craft/locked-one",
			"locked contains uncommitted work",
			"",
		].join("\n");

		const entries = parseWorktreePorcelain(porcelain);

		expect(entries[0].bare).toBe(true);
		expect(entries[1].detached).toBe(true);
		expect(entries[2].locked).toBe("contains uncommitted work");
	});

	it("parses an empty porcelain string to an empty list", () => {
		expect(parseWorktreePorcelain("")).toEqual([]);
	});
});
