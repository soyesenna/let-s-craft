// `lsc_craft_init` — register a pre-craft feature as the active craft for its craft loop.
// Slimmed from the former hash-manifest-backed version (C2): with tests authored post-craft
// rather than fixed before craft, there is no protected test/ canon left to fingerprint or
// snapshot at init time — this tool's only remaining job is verifying pre-craft's three
// artifacts exist and registering the active-craft singleton.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftDir, resolveFeatureName, worktreePath } from "../artifacts/paths.js";
import { readPersistedCraftState, setActiveCraft } from "./state.js";

export interface CraftInitDetails {
	feature: string;
	worktreeRoot: string | undefined;
}

const REQUIRED_PRECRAFT_ARTIFACTS = ["trace.md", "spec.md", "plan.md"];

/**
 * Verify that pre-craft's three artifacts (trace.md/spec.md/plan.md) exist directly under
 * `featureDir` (`.lsc/crafts/{feature}/`) and are non-blank. Codifies the invariant that
 * pre-craft's output is craft's only input (design contract A-3): without this check,
 * lsc_craft_init would happily start a craft loop against a missing or empty trace/spec/plan,
 * silently discarding pre-craft's role. Pure — returns a list of "{file}: {reason}" violations,
 * empty when all three pass.
 */
export function validateCraftArtifacts(featureDir: string): string[] {
	const violations: string[] = [];
	for (const name of REQUIRED_PRECRAFT_ARTIFACTS) {
		const path = join(featureDir, name);
		if (!existsSync(path)) {
			violations.push(`${name}: missing`);
			continue;
		}
		if (readFileSync(path, "utf8").trim().length === 0) {
			violations.push(`${name}: empty`);
		}
	}
	return violations;
}

/** Register `lsc_craft_init`. */
export function registerCraftInitTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name (kebab-case) or a path under .lsc/crafts/{feature}/ (pre-craft dir or audit-N.md)."),
		worktree: z.boolean().optional().describe("True if this feature uses a .lsc/worktrees/{feature} worktree (must already exist)."),
	});

	// Explicit type arguments (not left to inference) avoid a TS2589 "excessively deep" type
	// instantiation against this SDK's TSchema union — see run-check.ts for the same note.
	pi.registerTool<typeof parameters, CraftInitDetails>({
		name: "lsc_craft_init",
		loadMode: "discoverable",
		label: "Craft: init active craft",
		description:
			"Start a craft loop for a pre-craft feature: verify trace.md/spec.md/plan.md exist and are non-blank " +
			"under .lsc/crafts/{feature}/, then register it as the active craft. Call once at the start of the " +
			"craft skill, before spawning the executor.",
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
							{ type: "text", text: `lets-craft: worktree=true but no worktree found at ${candidate}. Create it via lsc_scaffold first.` },
						],
					};
				}
				worktreeRoot = candidate;
			}

			const root = worktreeRoot ?? ctx.cwd;
			const artifactViolations = validateCraftArtifacts(craftDir(root, feature));
			if (artifactViolations.length > 0) {
				return {
					isError: true,
					content: [
						{
							type: "text",
							text:
								`lets-craft: missing or empty pre-craft artifact(s) under ${craftDir(root, feature)}: ` +
								`${artifactViolations.join(", ")}. Run (or re-run) pre-craft to produce trace.md/spec.md/plan.md before craft.`,
						},
					],
				};
			}

			const previousState = readPersistedCraftState(root, feature);
			setActiveCraft(
				{ feature, projectRoot: ctx.cwd, worktreeRoot, aborted: false, releaseApproval: previousState?.releaseApproval },
				{ durability: "strict" },
			);

			return {
				content: [{ type: "text", text: `lets-craft: craft "${feature}" active.` }],
				details: { feature, worktreeRoot },
			};
		},
	});
}
