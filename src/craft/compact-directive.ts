// C-3: compaction canon re-read directive. A long craft loop's skill contract (test-tree
// invariants, hash-verification discipline, the loop's only exits, question tagging) lives
// entirely in craft/SKILL.md plus this feature's own spec.md/plan.md — none of it is
// reconstructible from a compaction summary alone. Without an explicit nudge at the exact
// moment compaction happens, a resumed turn can silently treat the summary as the whole truth
// and let the loop's real contract quietly lapse. This module is the pure "what to say" half —
// same resume-discipline tone and "don't trust memory, re-read the durable files" shape as
// enforcement.ts's continuationResult, but for the session.compacting seam instead of
// session_stop. registerCompactionDirective below is the thin "when/how" registration wrapper.
//
// Channel choice — session.compacting, `context` field (not `prompt`): verified against
// node_modules/@oh-my-pi/pi-coding-agent's shared-events.d.ts (SessionCompactingResult =
// { context?: string[]; prompt?: string; preserveData?: ... }) and, more importantly, against
// pi-agent-core's actual consumer (compaction.ts's generateSummary): `context` items are
// formatted by formatAdditionalContext into an `<additional-context>` block and concatenated
// directly ahead of the UNCHANGED default summarization prompt
// (`promptText += formatAdditionalContext(options?.extraContext); promptText += basePrompt;`).
// The default prompt (compaction-summary.md) already instructs the summarizer to produce a
// "Critical Context"/"Next Steps" structured summary, so our directive — sitting right next to
// that instruction as part of the same message — is very likely to be carried into the produced
// summary. `prompt` (promptOverride) instead REPLACES that entire base prompt wholesale
// (compaction.ts: `if (options?.promptOverride) basePrompt = options.promptOverride;`) — using it
// would mean reconstructing the platform's whole structured-summary template ourselves (section
// format, "preserve exact file paths" rules, unanswered-question handling) just to add one
// directive, a much larger and more fragile footprint for the same goal, and one this plugin
// would then have to keep in sync with upstream's own prompt by hand. `context` is the narrower,
// evidence-backed choice.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftPlanPath, craftSpecPath } from "../artifacts/paths.js";
import { type CraftState, getActiveCraft } from "./state.js";

/**
 * Build the canon re-read directive for the active craft, or null when there is none — no
 * active craft means nothing to enforce and nothing worth warning about losing.
 */
export function buildCompactionDirective(craft: CraftState | undefined): string | null {
	if (!craft) return null;
	const root = craft.worktreeRoot ?? craft.projectRoot;
	const specPath = craftSpecPath(root, craft.feature);
	const planPath = craftPlanPath(root, craft.feature);
	return (
		`lets-craft: craft "${craft.feature}" is compacting. Do not trust the compaction summary as memory of this craft's ` +
		"contract or progress — re-read the actual files below before acting on anything past this point. " +
		"1) read skill://craft (skills/craft/SKILL.md) again in full; its loop contract is not safely summarizable. " +
		`2) Read ${specPath} and ${planPath} — the real acceptance criteria and plan for this feature, not a paraphrase of them. ` +
		"3) Re-confirm the invariants this loop enforces: the protected test/ tree (run_test.sh and test assets) must never " +
		"be modified while this craft is active (C20); a pass is only real when backed by an actual lsc_verify_hash/" +
		"lsc_run_tests result, never assumed from a summary; the loop's only two valid exits are run_test.sh passing or an " +
		"explicit lsc_craft_abort — never a silent stop; and any question that needs a human goes through lsc_ask/" +
		"lsc_select/lsc_confirm, never a bare prose question."
	);
}

/**
 * Register the `session.compacting` handler: inject the canon re-read directive as additional
 * summarization context (see the channel-choice note above) when a craft is active, otherwise
 * return nothing so no other handler/default behavior is disturbed. Wrapped so a failure here
 * can never fail compaction itself — errors are swallowed and only surfaced under LSC_DEBUG.
 */
export function registerCompactionDirective(pi: ExtensionAPI): void {
	pi.on("session.compacting", () => {
		try {
			const directive = buildCompactionDirective(getActiveCraft());
			if (!directive) return undefined;
			return { context: [directive] };
		} catch (error) {
			if (process.env.LSC_DEBUG) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`lets-craft: compaction directive failed — ${message}`);
			}
			return undefined;
		}
	});
}
