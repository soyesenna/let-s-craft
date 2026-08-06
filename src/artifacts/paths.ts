// lets-craft artifact path conventions (_docs/spec.md:4-5's 산출물 경로 규칙; project .lsc/,
// global ~/.omp/.lsc/). Single source of truth for where every artifact lives — craft/*,
// preset/*, and any future skill wiring should derive paths from here rather than
// joining path segments locally.
import { homedir } from "node:os";
import { join, sep } from "node:path";

/** Global lets-craft root: `~/.omp/.lsc/` (_docs/spec.md:4-5). */
export function globalLscDir(): string {
	return join(homedir(), ".omp", ".lsc");
}

/** Project lets-craft root: `<cwd>/.lsc/`. */
export function projectLscDir(cwd: string): string {
	return join(cwd, ".lsc");
}

// ============================================================================
// crafts/{feature}/ — trace.md, spec.md, plan.md, .craft-state.json, check/, audit/ (C8, C3)
// ============================================================================

/** `.lsc/crafts/` — parent of every feature's craft directory. */
export function craftsRootDir(cwd: string): string {
	return join(projectLscDir(cwd), "crafts");
}

/** `.lsc/crafts/{feature}/` — one feature's pre-craft/craft/post-craft artifacts. */
export function craftDir(cwd: string, feature: string): string {
	return join(craftsRootDir(cwd), feature);
}

export function craftTracePath(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "trace.md");
}

export function craftSpecPath(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "spec.md");
}

export function craftPlanPath(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "plan.md");
}

/** `.lsc/crafts/{feature}/.craft-state.json` — restart-durable active-craft state (C3: moved out of test/, which is no longer a pipeline-owned tree). */
export function craftStatePath(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), ".craft-state.json");
}

/** `.lsc/crafts/{feature}/check/` — post-craft's deterministic check entrypoint + its logs (C3). */
export function craftCheckDir(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "check");
}

/** `.lsc/crafts/{feature}/check/run_check.sh` — the single trusted, post-craft-authored check entrypoint (build/lint/typecheck/test, C3). Tracked (a committed deliverable), unlike its logs. */
export function craftCheckScriptPath(cwd: string, feature: string): string {
	return join(craftCheckDir(cwd, feature), "run_check.sh");
}

/** `.lsc/crafts/{feature}/check/logs/` — run_check.sh transcripts. */
export function craftCheckLogsDir(cwd: string, feature: string): string {
	return join(craftCheckDir(cwd, feature), "logs");
}

/** `.lsc/crafts/{feature}/audit/` — post-craft adversarial audit reports (C8). */
export function craftAuditDir(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "audit");
}

/** `.lsc/crafts/{feature}/audit/audit-{n}.md` — one post-craft audit cycle (N from 0). */
export function craftAuditPath(cwd: string, feature: string, n: number): string {
	return join(craftAuditDir(cwd, feature), `audit-${n}.md`);
}

/** `.lsc/crafts/{feature}/research/claims.json` — the canonical research claim ledger (F/D-2; SYNTHESIS.md is its projection). `lsc_claims` (src/research/claims-tool.ts) is the sole writer of each claim's `decision`. */
export function craftClaimsPath(cwd: string, feature: string): string {
	return join(craftDir(cwd, feature), "research", "claims.json");
}

// ============================================================================
// worktrees/{feature}/ — gitignored, REJECT-reused, pruned on land (C6, C7)
// ============================================================================

/** `.lsc/worktrees/` — parent of every feature's worktree checkout. */
export function worktreesRootDir(cwd: string): string {
	return join(projectLscDir(cwd), "worktrees");
}

/** `.lsc/worktrees/{feature}/` — a feature's `--worktree` source checkout. */
export function worktreePath(cwd: string, feature: string): string {
	return join(worktreesRootDir(cwd), feature);
}

// ============================================================================
// Feature-name resolution (C22)
// ============================================================================

/**
 * Resolve a feature name from either a bare kebab-case name ("my-feature") or a
 * path that includes `.lsc/crafts/{feature}/...` — the pre-craft directory itself,
 * or a deeper path like a post-craft `audit/audit-2.md` (C22: craft's input is
 * "pre-craft 산출물 디렉터리 경로 또는 post-craft audit 문서 경로").
 *
 * Matches `crafts` as a whole path segment (via a split array's exact-equality
 * `indexOf`, not a raw substring search) so an ancestor directory that merely
 * contains "crafts" as a substring — e.g. `.../aircrafts/foo/.lsc/crafts/my-feature`
 * — can never be mistaken for the real marker segment and yield the wrong feature
 * name (`foo` instead of `my-feature`).
 */
export function resolveFeatureName(input: string): string {
	const normalized = input.split(sep).join("/");
	const segments = normalized.split("/").filter(Boolean);
	const markerIndex = segments.indexOf("crafts");
	if (markerIndex !== -1) {
		const feature = segments[markerIndex + 1];
		if (!feature) throw new Error(`lets-craft: could not resolve a feature name from "${input}"`);
		return feature;
	}
	const last = segments[segments.length - 1];
	if (!last) throw new Error(`lets-craft: could not resolve a feature name from "${input}"`);
	return last;
}
