// `lsc_craft_abort` — the escalation exit for an in-flight craft run. craft is single-shot now
// (C6): there is no forced continue-until-tests-pass loop left to break out of, and no gate in
// craft's own contract whose decline branch calls this automatically anymore (the hash-violation
// restore prompt and the run-unavailable escalation that used to trigger it were both removed
// along with the loop they guarded). The remaining call sites are an explicit user instruction
// to stop mid-run — and, since postcraft-14cycle-approval-failure PR-2, the [Audit Escalation]
// "Abort this craft" disposition, which post-craft delegates here from a fresh process where
// there is no active-craft singleton at all. That is why the tool now also accepts an optional
// `feature_dir` (exact-root): it resolves the feature the same way every other tool does and
// marks THAT feature's persisted state aborted, singleton or not.
//
// Marking the craft aborted is a durable record (`CraftState.aborted`) that watchdog.ts's own
// explicit-stop check and destructive-approval invalidation both key off directly. A successful
// abort also invalidates every prepared destructive operation — nothing staged may survive a
// user-terminated run.
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { FEATURE_SLUG_RE, resolveFeatureName } from "../artifacts/paths.js";
import { invalidatePreparedOperation } from "./destructive-approval.js";
import { findPersistedCraftState, getActiveCraft, markCraftAborted, markCraftAbortedAt } from "./state.js";

export interface CraftAbortDetails {
	feature: string;
	reason: string;
}

/**
 * Pure core: mark the active craft (or, when `featureDir` is given, the exact-root persisted
 * craft it names) aborted and report the outcome. Split out from the registerTool wrapper (like
 * ask.ts's performX functions) so it's unit-testable without pi.zod/pi.registerTool — vitest on
 * Node cannot import omp SDK values (Phase 1.5 finding).
 *
 * PR-2: `featureDir` is the fresh-post-craft path — resolve it, find the feature's persisted
 * state through the shared candidate seam (worktree-first), and abort THAT state at its exact
 * root even when no active-craft singleton exists in this process. A missing persisted state
 */
export function performCraftAbort(reason: string, featureDir?: string, cwd: string = process.cwd()): AgentToolResult<CraftAbortDetails> {
	if (featureDir !== undefined) {
		const feature = resolveFeatureName(featureDir);
		// audit-0 RF-13: refuse a non-slug resolved feature (traversal/newline/control chars) before
		// ANY fs access — the name reaches the durable state and the result text verbatim.
		if (!FEATURE_SLUG_RE.test(feature)) {
			return {
				isError: true,
				content: [{ type: "text", text: `lets-craft: feature_dir must resolve to a bare kebab-case slug (got ${JSON.stringify(feature)}) — path separators, traversal segments, and special characters are refused.` }],
			};
		}
		const persisted = findPersistedCraftState(cwd, feature);
		if (!persisted) {
			return {
				isError: true,
				content: [{ type: "text", text: `lets-craft: no persisted craft state found for "${feature}" (checked the project root and its worktree) — nothing to abort.` }],
			};
		}
		markCraftAbortedAt(persisted.worktreeRoot ?? persisted.projectRoot, feature);
		invalidatePreparedOperation();
		return {
			content: [{ type: "text", text: `lets-craft: craft "${feature}" marked aborted — ${reason}` }],
			details: { feature, reason },
		};
	}

	const craft = getActiveCraft();
	if (!craft) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: no active craft to abort." }] };
	}
	markCraftAborted();
	invalidatePreparedOperation();
	return {
		content: [{ type: "text", text: `lets-craft: craft "${craft.feature}" marked aborted — ${reason}` }],
		details: { feature: craft.feature, reason },
	};
}

/** Register `lsc_craft_abort`. */
export function registerCraftAbortTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	const parameters = z.object({
		reason: z.string().describe("Why this craft run is being aborted — must follow an explicit user instruction to stop (or the [Audit Escalation] \"Abort this craft\" disposition). Never call this on the skill's own initiative."),
		feature_dir: z.string().optional().describe("Feature name or a path under .lsc/crafts/{feature}/ — the exact-root abort target, for callers (post-craft's escalation exit) that hold no active-craft singleton. Omit to abort the session's active craft."),
	});

	pi.registerTool<typeof parameters, CraftAbortDetails>({
		name: "lsc_craft_abort",
		loadMode: "discoverable",
		label: "Craft: abort run",
		description:
			"Mark a craft aborted (durable). Two callers: the session's active craft (omit feature_dir), or an exact feature root " +
			"(feature_dir) — post-craft's [Audit Escalation] \"Abort this craft\" disposition delegates here from a fresh process. " +
			"Only call after the user has explicitly chosen to stop this craft run.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<CraftAbortDetails>> {
			return performCraftAbort(params.reason, params.feature_dir, ctx.cwd);
		},
	});
}
