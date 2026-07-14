// `lsc_craft_release` — the approved-modification exit for the craft loop's hash
// protection (R8/RK8). Unlike lsc_craft_abort (which ends the loop outright), this
// tool exists so a legitimately approved canon (test/) fix can proceed without the
// enforcement/hash-manifest machinery treating it as an unauthorized write. Before
// this tool, the only paths that cleared the active-craft singleton were
// session_switch/session_branch/session_shutdown (state.ts:98-101) — none of them
// fit "the user approved a canon edit mid-loop." Calling this tool clears
// hash-protection, so the calling skill's contract requires an explicit lsc_confirm
// user approval beforehand, and an lsc_craft_init re-call afterward to re-baseline
// the manifest and re-register active-craft protection (RK8 — skipping the re-init
// leaves the loop running with no hash-violation protection at all).
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { clearActiveCraft, getActiveCraft } from "./state.js";

export interface CraftReleaseDetails {
	feature: string;
	reason: string;
}

/**
 * Pure core: clear the active craft's hash-protection and report the outcome. Split out from the
 * registerTool wrapper (like abort.ts's performCraftAbort) so it's unit-testable without
 * pi.zod/pi.registerTool — vitest on Node cannot import omp SDK values (Phase 1.5 finding).
 */
export function performCraftRelease(reason: string): AgentToolResult<CraftReleaseDetails> {
	const craft = getActiveCraft();
	if (!craft) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: no active craft to release." }] };
	}
	clearActiveCraft();
	return {
		content: [
			{
				type: "text",
				text: `lets-craft: craft "${craft.feature}" released for approved canon modification — ${reason}`,
			},
		],
		details: { feature: craft.feature, reason },
	};
}

/** Register `lsc_craft_release`. */
export function registerCraftReleaseTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments avoid TS2589 (see hash-manifest.ts).
	const parameters = z.object({
		reason: z
			.string()
			.describe(
				"Why the protected canon (test/) is being released for modification — must follow an explicit user " +
					"approval via lsc_confirm. Never call this on the skill's own initiative.",
			),
	});

	pi.registerTool<typeof parameters, CraftReleaseDetails>({
		name: "lsc_craft_release",
		label: "Craft: release protected canon for approved modification",
		description:
			"Clear the active craft's hash-protection so its test/ canon can be intentionally modified — the 4th " +
			"unblock path for active-craft state, alongside session_switch/session_branch/session_shutdown " +
			"(state.ts). This is an approved-modification escape hatch, not a normal craft-loop step: the calling " +
			"skill's contract requires an explicit lsc_confirm user approval before this tool is ever called. After " +
			"the canon edit is made, lsc_craft_init MUST be called again to re-baseline the hash manifest and " +
			"re-register active-craft protection — without that re-call, the loop proceeds with no hash-violation " +
			"protection at all. In lsc_confirm terms that approval is the Yes selection (content exactly `yes`); a free " +
			"answer (content starting `User provided free answer:`) is neither approve nor reject — reflect it as an " +
			"instruction and re-ask, never release on it.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params): Promise<AgentToolResult<CraftReleaseDetails>> {
			return performCraftRelease(params.reason);
		},
	});
}
