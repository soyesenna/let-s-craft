// `lsc_craft_abort` — the escalation exit for an in-flight craft run. craft is single-shot now
// (C6): there is no forced continue-until-tests-pass loop left to break out of, and no gate in
// craft's own contract whose decline branch calls this automatically anymore (the hash-violation
// restore prompt and the run-unavailable escalation that used to trigger it were both removed
// along with the loop they guarded). The only remaining call site is an explicit user instruction
// to stop mid-run. Marking the craft aborted is a durable record (`CraftState.aborted`) that
// watchdog.ts's own explicit-stop check and destructive-approval invalidation both key off
// directly.
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { getActiveCraft, markCraftAborted } from "./state.js";

export interface CraftAbortDetails {
	feature: string;
	reason: string;
}

/**
 * Pure core: mark the active craft aborted and report the outcome. Split out from the
 * registerTool wrapper (like ask.ts's performX functions) so it's unit-testable
 * without pi.zod/pi.registerTool — vitest on Node cannot import omp SDK values
 * (Phase 1.5 finding).
 */
export function performCraftAbort(reason: string): AgentToolResult<CraftAbortDetails> {
	const craft = getActiveCraft();
	if (!craft) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: no active craft to abort." }] };
	}
	markCraftAborted();
	return {
		content: [{ type: "text", text: `lets-craft: craft "${craft.feature}" marked aborted — ${reason}` }],
		details: { feature: craft.feature, reason },
	};
}

/** Register `lsc_craft_abort`. */
export function registerCraftAbortTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments avoid TS2589 (see run-check.ts).
	const parameters = z.object({
		reason: z.string().describe("Why this craft run is being aborted — must follow an explicit user instruction to stop. Never call this on the skill's own initiative."),
	});

	pi.registerTool<typeof parameters, CraftAbortDetails>({
		name: "lsc_craft_abort",
		loadMode: "discoverable",
		label: "Craft: abort run",
		description:
			"Mark the active craft as user-aborted. Only call this after the user has explicitly asked to stop this craft " +
			"run — craft is single-shot now, so there is no gate in its own contract whose decline branch calls this " +
			"automatically.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params): Promise<AgentToolResult<CraftAbortDetails>> {
			return performCraftAbort(params.reason);
		},
	});
}
