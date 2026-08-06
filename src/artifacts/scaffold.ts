// `lsc_scaffold` — deterministic Stage 0 wiring (deferred-pool B, E-1).
//
// pre-craft's Stage 0 used to replicate addWorktree()/ensureWorktreesGitignored() as hand-run bash
// (SKILL.md:84-96) — functionally equivalent to the TS seams but a measured drift surface (trace
// H3). This tool closes that surface by REUSING the existing TS functions (never re-implementing
// them): `addWorktree` (worktree + branch, C7 reuse semantics), the crafts dir created INSIDE the
// worktree (all-in-worktree, C6/R5 — never at project root), and `ensureWorktreesGitignored`
// against the project root's `.gitignore`. Branch-prefix detection deliberately stays in the
// skill's prose — the detected name arrives here as the `branch` argument (co-evolution contract).
//
// Write capability is EXACTLY two paths (spec AC5): the worktree subtree
// (`.lsc/worktrees/{feature}/**`, including its structural ancestors) and exactly
// `projectRoot/.gitignore`. Everything else is refused BEFORE any write or git effect:
// a non-kebab/traversal feature name, a symlinked `.lsc`/`.lsc/worktrees`/target (double
// realpath containment — S2 port core), and a symlinked `.gitignore` (the capability is the
// exact path, not "wherever a link points"). A re-run is a genuine no-op (resume, C7).
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { ensureWorktreesGitignored } from "./gitignore.js";
import { craftDir, worktreePath, worktreesRootDir } from "./paths.js";
import { addWorktree } from "./worktree.js";

export interface ScaffoldDetails {
	feature: string;
	worktree: string;
	branch: string;
	/** True when an existing worktree/branch was reused (C7 resume). */
	reused: boolean;
	/** True when the `.gitignore` entry was appended by this call (false = already present). */
	gitignoreAdded: boolean;
}

/** kebab-case slug — the only feature-name shape scaffold accepts (traversal/NUL/separator injection is refused before any write). */
const FEATURE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function scaffoldError(text: string): AgentToolResult<ScaffoldDetails> {
	return { isError: true, content: [{ type: "text", text: `lsc_scaffold: ${text}` }] };
}

/**
 * True iff `candidate`, when it exists, realpath-resolves inside `containRoot`'s realpath —
 * and is not itself a symlink. A missing candidate passes (mkdir will create a real one).
 */
function isContainedNonSymlink(candidate: string, containRoot: string): boolean {
	if (!existsSync(candidate)) return true;
	if (lstatSync(candidate).isSymbolicLink()) return false;
	try {
		const real = realpathSync(candidate);
		const rootReal = realpathSync(containRoot);
		return real === rootReal || real.startsWith(`${rootReal}/`);
	} catch {
		return false;
	}
}

/**
 * Core scaffold orchestrator: validate first (zero side effects on any rejection — no branch, no
 * worktree registration, no file), then wire Stage 0 through the existing TS seams.
 *
 * `baseRef` is forwarded to `addWorktree` for a NEWLY created branch only (defaults to `HEAD` when
 * omitted, addWorktree's own default) — reuse semantics own the rest: when the worktree directory
 * or the local branch already exists, `addWorktree` reuses it and `baseRef` is silently ignored
 * (C7 resume). This is intentional (C4 BL3), not a defect — a resumed/re-run scaffold must never
 * rebase an existing lane onto a possibly-different fork point out from under an in-progress craft.
 */
export async function performScaffold(
	feature: string,
	branch: string | undefined,
	cwd: string,
	baseRef?: string,
): Promise<AgentToolResult<ScaffoldDetails>> {
	// ── Validation — before ANY write or git effect ────────────────────────────────────────────────
	if (!FEATURE_SLUG_RE.test(feature) || feature.includes("\0")) {
		return scaffoldError(
			`feature must be a bare kebab-case slug (got ${JSON.stringify(feature)}) — path separators, ` +
				`traversal segments, and special characters are refused before any write.`,
		);
	}

	// Double realpath containment (S2): `.lsc` and `.lsc/worktrees` must be real directories inside
	// the project root — a symlink at either level would redirect "inside the worktree" writes
	// outside the declared capability. The target path itself must not be a symlink either.
	const lscDir = join(cwd, ".lsc");
	const worktreesRoot = worktreesRootDir(cwd);
	const target = worktreePath(cwd, feature);
	if (!isContainedNonSymlink(lscDir, cwd) || !isContainedNonSymlink(worktreesRoot, cwd) || !isContainedNonSymlink(target, cwd)) {
		return scaffoldError(
			`the worktrees path escapes its containment (a symlinked .lsc, .lsc/worktrees, or target directory) — ` +
				`scaffold only ever writes inside ${worktreesRoot} and refuses to follow links out of it.`,
		);
	}

	// The gitignore capability is EXACTLY projectRoot/.gitignore — a symlink would redirect the
	// append outside the project (the capability names the path, not the link target).
	const gitignorePath = join(cwd, ".gitignore");
	if (existsSync(gitignorePath) && lstatSync(gitignorePath).isSymbolicLink()) {
		return scaffoldError(`projectRoot/.gitignore is a symlink — the write capability is exactly that path, so a redirect is refused.`);
	}

	// ── Effects — existing TS seams only (behavioral equivalence, never a re-implementation) ──────
	const gitignore = ensureWorktreesGitignored(cwd);
	const worktree = await addWorktree(cwd, feature, { ...(branch ? { branch } : {}), ...(baseRef ? { baseRef } : {}) });
	// crafts dir INSIDE the worktree (all-in-worktree, C6/R5) — mkdir -p semantics keep a resume
	// re-run a no-op and never clobber hand-authored artifacts already under it. For a parallel
	// executor lane (feature = "{feature}-c{C}-lane-{K}", C6 §3.3), this leaves an EMPTY
	// .lsc/crafts/{lane-slug}/ dir inside the lane worktree — git does not track empty directories,
	// so it has no effect on that lane's cherry-pick or the eventual land onto the feature branch.
	mkdirSync(craftDir(worktree.path, feature), { recursive: true });

	return {
		content: [
			{
				type: "text",
				text:
					`lets-craft: scaffold for "${feature}" ready — worktree ${worktree.path} on branch "${worktree.branch}"` +
					`${worktree.reused ? " (reused — resume)" : " (created)"}, crafts dir wired inside the worktree, ` +
					`.gitignore ${gitignore.added ? "entry appended" : "entry already present"}.`,
			},
		],
		details: { feature, worktree: worktree.path, branch: worktree.branch, reused: worktree.reused, gitignoreAdded: gitignore.added },
	};
}

/** Register `lsc_scaffold` (B). */
export function registerScaffoldTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature: z.string().describe("Feature name — bare kebab-case slug only (traversal/separator names are refused before any write)."),
		branch: z
			.string()
			.optional()
			.describe("Branch to create or reuse for the worktree, as detected by pre-craft's prose (its branch-prefix detection stays in the skill). Omitted → addWorktree's default lets-craft/{feature}."),
		base_ref: z
			.string()
			.optional()
			.describe(
				"Base ref for a NEWLY created branch (e.g. a parallel executor lane's fork point). Omitted → HEAD. " +
					"Ignored when an existing worktree directory or local branch is reused — reuse is intentional resume " +
					"semantics (C7), not a defect, so a resumed lane never gets silently rebased out from under it.",
			),
	});

	pi.registerTool<typeof parameters, ScaffoldDetails>({
		name: "lsc_scaffold",
		loadMode: "discoverable",
		label: "Craft: scaffold a feature worktree (pre-craft Stage 0)",
		description:
			"Deterministic pre-craft Stage 0 wiring through the existing TS seams: git worktree + branch via addWorktree " +
			"(reuse semantics — a re-run after a REJECT reuses, never errors), the feature's crafts dir created INSIDE the " +
			"worktree, and the project root's .gitignore registered via ensureWorktreesGitignored. Write capability is exactly " +
			"two paths (the worktree subtree + projectRoot/.gitignore); traversal names and symlink escapes are refused before " +
			"any write. Re-running is a genuine no-op, so resume is safe.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ScaffoldDetails>> {
			try {
				return await performScaffold(params.feature, params.branch, ctx.cwd, params.base_ref);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: `lsc_scaffold: unexpected failure — ${message}` }] };
			}
		},
	});
}
