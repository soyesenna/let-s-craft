// SHA-256 fingerprint of a craft's `.lsc/crafts/{feature}/test/` tree (run_test.sh +
// test assets) and the two tools that create/verify it. This is the craft loop's
// tamper-evidence layer for C20 ("run_test.sh/테스트 코드 수정 절대 금지"): the
// tool_call block in enforcement.ts stops the LLM's own write/edit/ast_edit/bash
// calls from touching protected paths, and lsc_verify_hash catches anything that
// slips past that (external edits, unrecognized bash patterns, race conditions) so
// the craft loop can escalate rather than silently trust a changed test suite (C23b).
//
// Coverage is deliberately narrower than "everything under test/": `logs/` holds
// lsc_run_tests' own output (new files every iteration, by design — §3.2 step③),
// and the two bookkeeping files below record craft/hash state itself. Including
// either in the fingerprint would make every iteration report a false violation.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftHashManifestPath, craftSnapshotDir, craftTestDir, resolveFeatureName, worktreePath } from "../artifacts/paths.js";
import { ensureSnapshotsGitignored } from "../artifacts/gitignore.js";
import { getActiveCraft, setActiveCraft } from "./state.js";

// `pi.registerTool<TParams, TDetails>({ parameters: z.object({...}), async execute(...) {...} })`
// hits TS2589 ("excessively deep" type instantiation) under this SDK's TSchema
// union (ZodType | ArkType | TJsonSchema) when both TParams (from `parameters`)
// and TDetails (from `execute`'s return) are left for TypeScript to infer
// simultaneously — reproduced here even with a single required string field and
// an explicit execute() return-type annotation. The fix that actually works is
// supplying both type arguments explicitly (`registerTool<typeof parameters,
// TDetails>({...})`), which turns inference into a much cheaper checking pass.
// Every registerTool call in this plugin follows that pattern.

export interface CraftInitDetails {
	feature: string;
	testDir: string;
	fileCount: number;
	worktreeRoot: string | undefined;
}

export interface VerifyHashDetails {
	feature: string;
	passed: boolean;
	violations: HashViolation[];
}

export interface RestoreTestsDetails {
	feature: string;
	/** Paths restored to their lsc_craft_init-recorded content. */
	restoredPaths: string[];
	/** Paths present in test/ that were never in the recorded manifest — deleted as unauthorized additions. */
	removedPaths: string[];
	/** True iff a post-restore re-verify against the recorded manifest found zero violations. */
	passed: boolean;
	violations: HashViolation[];
}

const EXCLUDED_TOP_LEVEL_DIRS = new Set(["logs", ".snapshots"]);
const EXCLUDED_FILES = new Set([".hash-manifest.json", ".craft-state.json"]);

export interface HashManifest {
	feature: string;
	recordedAt: string;
	/** Relative POSIX path (from test/) -> sha256 hex digest. */
	files: Record<string, string>;
}

export interface HashViolation {
	path: string;
	kind: "added" | "removed" | "modified";
}

function walkTestFiles(testDir: string): string[] {
	const out: string[] = [];
	const stack = [testDir];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir || !existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && dir === testDir && EXCLUDED_TOP_LEVEL_DIRS.has(entry.name)) continue;
			if (entry.isFile() && EXCLUDED_FILES.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile()) out.push(full);
		}
	}
	return out;
}

function toPosixRelative(testDir: string, file: string): string {
	return relative(testDir, file).split(sep).join("/");
}

/** Compute the SHA-256 fingerprint of every protected file under `testDir`. */
export function computeManifest(feature: string, testDir: string): HashManifest {
	const files: Record<string, string> = {};
	for (const file of walkTestFiles(testDir)) {
		files[toPosixRelative(testDir, file)] = createHash("sha256").update(readFileSync(file)).digest("hex");
	}
	return { feature, recordedAt: new Date().toISOString(), files };
}

/** Diff two manifests' file maps into an explicit violation list (added/removed/modified). */
export function diffManifests(recorded: HashManifest, current: HashManifest): HashViolation[] {
	const violations: HashViolation[] = [];
	for (const path of Object.keys(recorded.files)) {
		if (!(path in current.files)) violations.push({ path, kind: "removed" });
		else if (current.files[path] !== recorded.files[path]) violations.push({ path, kind: "modified" });
	}
	for (const path of Object.keys(current.files)) {
		if (!(path in recorded.files)) violations.push({ path, kind: "added" });
	}
	return violations;
}

export function loadManifest(manifestPath: string): HashManifest | undefined {
	if (!existsSync(manifestPath)) return undefined;
	return JSON.parse(readFileSync(manifestPath, "utf8")) as HashManifest;
}

export function saveManifest(manifestPath: string, manifest: HashManifest): void {
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Copy every manifested file's current bytes into `snapshotDir`, mirroring test/'s relative
 * tree structure, so lsc_restore_tests can restore exact original content later without going
 * through the LLM's own write/edit/bash tools (which the C20 tool_call block gates against the
 * very same protected tree — a bash-based restore is a structural deadlock, not just a
 * discipline issue). Called once, from lsc_craft_init, right after computeManifest/saveManifest.
 * Clears any stale snapshot from a prior craft run for this feature first.
 */
export function writeSnapshots(testDir: string, snapshotDir: string, manifest: HashManifest): void {
	rmSync(snapshotDir, { recursive: true, force: true });
	for (const relPath of Object.keys(manifest.files)) {
		const segments = relPath.split("/");
		const src = join(testDir, ...segments);
		const dst = join(snapshotDir, ...segments);
		mkdirSync(dirname(dst), { recursive: true });
		copyFileSync(src, dst);
	}
}

/**
 * Restore every file recorded in `recorded` to its snapshotted content, and delete any file
 * currently under `testDir` that was NOT in `recorded` (an "added" violation — introduced after
 * lsc_craft_init, so restoring means removing it, not preserving it). Re-verifies via the same
 * diff logic lsc_verify_hash uses, so the caller doesn't need a separate verify call to confirm
 * success. Pure with respect to craft/tool-registration state — the tool wrapper below is the
 * only thing that touches those.
 */
export function restoreFromSnapshots(feature: string, testDir: string, snapshotDir: string, recorded: HashManifest): RestoreTestsDetails {
	const restoredPaths: string[] = [];
	for (const relPath of Object.keys(recorded.files)) {
		const segments = relPath.split("/");
		const src = join(snapshotDir, ...segments);
		if (!existsSync(src)) continue; // defensive: skip rather than throw mid-restore if a snapshot is somehow missing
		const dst = join(testDir, ...segments);
		mkdirSync(dirname(dst), { recursive: true });
		copyFileSync(src, dst);
		restoredPaths.push(relPath);
	}

	const removedPaths: string[] = [];
	for (const file of walkTestFiles(testDir)) {
		const relPath = toPosixRelative(testDir, file);
		if (!(relPath in recorded.files)) {
			rmSync(file, { force: true });
			removedPaths.push(relPath);
		}
	}

	const current = computeManifest(feature, testDir);
	const violations = diffManifests(recorded, current);
	return { feature, restoredPaths, removedPaths, passed: violations.length === 0, violations };
}

function registerCraftInitTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name (kebab-case) or a path under .lsc/crafts/{feature}/ (pre-craft dir or audit-N.md)."),
		worktree: z.boolean().optional().describe("True if this feature uses a .lsc/worktrees/{feature} worktree (must already exist)."),
	});

	pi.registerTool<typeof parameters, CraftInitDetails>({
		name: "lsc_craft_init",
		label: "Craft: init hash manifest",
		description:
			"Start a craft loop for a pre-craft feature: record a SHA-256 manifest of .lsc/crafts/{feature}/test/ " +
			"(run_test.sh + test assets, excluding logs/) plus a full content snapshot for lsc_restore_tests to " +
			"restore from later, and register it as the active craft. Call once at the start of the craft skill, " +
			"before the first executor iteration — this activates the tool_call block on the protected test tree " +
			"and the session_stop backstop until the craft loop ends.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<CraftInitDetails>> {
			const feature = resolveFeatureName(params.feature_dir);

			let worktreeRoot: string | undefined;
			if (params.worktree) {
				const candidate = worktreePath(ctx.cwd, feature);
				if (!existsSync(candidate)) {
					return {
						isError: true,
						content: [
							{ type: "text", text: `lets-craft: worktree=true but no worktree found at ${candidate}. Create it in pre-craft first (C6).` },
						],
					};
				}
				worktreeRoot = candidate;
			}

			// Resolved before testDir so the manifest/snapshot themselves land under the worktree
			// when one is active — enforcement.ts's testDir (evaluateToolCallForActiveCraft) and
			// run-tests.ts's scriptPath/logsDir mirror this same `worktreeRoot ?? ctx.cwd` root.
			const root = worktreeRoot ?? ctx.cwd;
			const testDir = craftTestDir(root, feature);
			if (!existsSync(testDir)) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: no test/ directory at ${testDir}. Run pre-craft's test stage (C18) before craft.` }],
				};
			}

			const manifest = computeManifest(feature, testDir);
			saveManifest(craftHashManifestPath(root, feature), manifest);
			writeSnapshots(testDir, craftSnapshotDir(root, feature), manifest);
			// ensureSnapshotsGitignored stays anchored at ctx.cwd (the main checkout), not `root`:
			// a worktree .gitignore append would be an uncommitted change that pollutes the merge
			// (R10's committed .gitignore already covers the worktree, since the feature branch
			// forks from a HEAD that already has it).
			ensureSnapshotsGitignored(ctx.cwd);
			setActiveCraft({
				feature,
				projectRoot: ctx.cwd,
				worktreeRoot,
				testsPassed: false,
				lastFailureSummary: undefined,
				aborted: false,
			});

			const fileCount = Object.keys(manifest.files).length;
			return {
				content: [{ type: "text", text: `lets-craft: craft "${feature}" active. Recorded hash manifest for ${fileCount} test asset(s) under ${testDir}.` }],
				details: { feature, testDir, fileCount, worktreeRoot },
			};
		},
	});
}

function registerVerifyHashTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, VerifyHashDetails>({
		name: "lsc_verify_hash",
		label: "Craft: verify hash manifest",
		description:
			"Re-hash .lsc/crafts/{feature}/test/ and compare it against the manifest lsc_craft_init recorded. Call " +
			"after every executor iteration, before lsc_run_tests. Any violation means run_test.sh or a test file " +
			"changed (C20) — stop the craft loop and escalate the diff to the user (C23b); do not auto-restore.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<VerifyHashDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			// Feature-match guard (mirrors run-tests.ts's lsc_run_tests): only trust the active
			// craft's worktreeRoot when it's actually this feature's craft, not some other
			// feature's leftover active-craft state.
			const craft = getActiveCraft();
			const root = craft && craft.feature === feature ? (craft.worktreeRoot ?? ctx.cwd) : ctx.cwd;
			const testDir = craftTestDir(root, feature);
			const manifestPath = craftHashManifestPath(root, feature);
			const recorded = loadManifest(manifestPath);
			if (!recorded) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: no hash manifest at ${manifestPath}. Call lsc_craft_init first.` }],
				};
			}

			const current = computeManifest(feature, testDir);
			const violations = diffManifests(recorded, current);
			const passed = violations.length === 0;
			const text = passed
				? `lets-craft: hash verification passed — ${Object.keys(recorded.files).length} test asset(s) unchanged.`
				: `lets-craft: HASH VIOLATION — ${violations.length} protected test asset(s) changed: ${violations
						.map(v => `${v.kind} ${v.path}`)
						.join(", ")}. Stop the craft loop and confirm with the user before proceeding (C23b).`;

			return { content: [{ type: "text", text }], details: { feature, passed, violations } };
		},
	});
}

function registerRestoreTestsTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name or a path under .lsc/crafts/{feature}/, same as lsc_craft_init."),
	});

	pi.registerTool<typeof parameters, RestoreTestsDetails>({
		name: "lsc_restore_tests",
		label: "Craft: restore protected test assets from snapshot",
		description:
			"Restore .lsc/crafts/{feature}/test/ (run_test.sh + test assets) to the exact content lsc_craft_init " +
			"recorded, undoing a hash violation. This is an internal fs operation — it does not go through the " +
			"LLM's own write/edit/bash tools, so unlike a bash-based restore it is NOT itself subject to the " +
			"tool_call block those trigger against the protected test tree (C20); a bash `git checkout`-style " +
			"restore against that same tree would deadlock against the very block it's trying to work around. " +
			"Call this only after the user has explicitly approved a restore via lsc_confirm on a [Hash Violation] " +
			"prompt (C23b) — never call it unprompted. Re-verifies via the same diff logic as lsc_verify_hash and " +
			"reports the result directly (details.passed / details.violations), so a separate lsc_verify_hash call " +
			"afterward is optional.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<RestoreTestsDetails>> {
			const feature = resolveFeatureName(params.feature_dir);
			// Feature-match guard — same rationale as lsc_verify_hash above.
			const craft = getActiveCraft();
			const root = craft && craft.feature === feature ? (craft.worktreeRoot ?? ctx.cwd) : ctx.cwd;
			const testDir = craftTestDir(root, feature);
			const manifestPath = craftHashManifestPath(root, feature);
			const recorded = loadManifest(manifestPath);
			if (!recorded) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft: no hash manifest at ${manifestPath}. Call lsc_craft_init first.` }],
				};
			}

			const details = restoreFromSnapshots(feature, testDir, craftSnapshotDir(root, feature), recorded);
			const text = details.passed
				? `lets-craft: restored ${details.restoredPaths.length} test asset(s) from snapshot` +
					(details.removedPaths.length > 0 ? ` and removed ${details.removedPaths.length} unauthorized addition(s)` : "") +
					" — hash verification now passes."
				: `lets-craft: restore attempted but ${details.violations.length} violation(s) remain — this should not happen; escalate to the user rather than retrying silently.`;

			return { content: [{ type: "text", text }], details };
		},
	});
}

/** Register `lsc_craft_init`, `lsc_verify_hash`, and `lsc_restore_tests`. */
export function registerHashManifestTools(pi: ExtensionAPI): void {
	registerCraftInitTool(pi);
	registerVerifyHashTool(pi);
	registerRestoreTestsTool(pi);
}
