// `lsc_craft_abort` — the escalation exit for the craft loop (C23). The craft skill
// calls this once the user has explicitly declined to continue past a hash-violation
// restore prompt (C23b) or a run_test.sh-unrunnable escalation (C23c) — both surfaced
// through lsc_confirm (ask.ts). Marking the craft aborted flips
// shouldContinueCraftLoop() to false (enforcement.ts), so the session_stop backstop
// stops forcing "one more turn" once the user has, in fact, asked to stop (R1's
// "don't fight a user who already asked to stop").
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
	// Explicit type arguments avoid TS2589 (see hash-manifest.ts).
	const parameters = z.object({
		reason: z
			.string()
			.describe(
				"Why the craft loop is being aborted — must follow an explicit user decline via lsc_confirm (a hash-violation " +
					"restore prompt, C23b, or a run_test.sh-unrunnable escalation, C23c). Never call this on the skill's own initiative.",
			),
	});

	pi.registerTool<typeof parameters, CraftAbortDetails>({
		name: "lsc_craft_abort",
		label: "Craft: abort loop",
		description:
			"Mark the active craft as user-aborted so the session_stop backstop stops forcing continuation (C23). Only call " +
			"this after the user has explicitly declined to continue via lsc_confirm — a hash-violation restore prompt " +
			"(C23b) or a run_test.sh-unrunnable escalation (C23c).",
		approval: "read",
		parameters,
		async execute(_toolCallId, params): Promise<AgentToolResult<CraftAbortDetails>> {
			return performCraftAbort(params.reason);
		},
	});
}
