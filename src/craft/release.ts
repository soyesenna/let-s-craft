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
import { craftHashManifestPath } from "../artifacts/paths.js";
import { type ConsumeApprovalResult, type DestructiveGateTag, consumePendingApproval } from "./destructive-approval.js";
import { fingerprintManifestFile } from "./hash-manifest.js";
import { clearActiveCraft, getActiveCraft, recordOpenRelease } from "./state.js";

export interface CraftReleaseDetails {
	feature: string;
	reason: string;
}

/** The destructive gate tags lsc_craft_release consumes — owned by the consumer, not the issuance infra (CS1). */
export const RELEASE_CONSUMABLE_TAGS: readonly DestructiveGateTag[] = ["[Canon Amendment]"];

/** Fail-closed rejection text for a failed approval consume — always names the fresh-approval requirement and the consumable tag(s). */
function releaseRejectionText(failure: Extract<ConsumeApprovalResult, { ok: false }>): string {
	const consumable = RELEASE_CONSUMABLE_TAGS.join(", ");
	if (failure.reason === "tag-mismatch") {
		return (
			`lets-craft: lsc_craft_release requires a fresh user approval on a ${consumable} gate — the pending destructive ` +
			`approval carries the ${failure.pendingTag} tag, which release does not consume. Obtain a fresh ${consumable} ` +
			"confirm (a platform yes) for this canon modification before releasing."
		);
	}
	if (failure.reason === "identity-mismatch") {
		return (
			`lets-craft: lsc_craft_release requires a fresh user approval on a ${consumable} gate — the pending ${failure.pendingTag} ` +
			`approval belongs to a different craft identity. Obtain a fresh ${consumable} confirm for THIS craft before releasing.`
		);
	}
	return (
		`lets-craft: lsc_craft_release requires a fresh user approval for this canon modification: run lsc_confirm with a ` +
		`${consumable} prompt, get a platform "yes", then call lsc_craft_release. No pending approval is in flight.`
	);
}

/**
 * Pure-ish core: consume the tag-bound single-use approval nonce, pre-record the open-release
 * evidence, then clear the active craft's hash-protection and report the outcome. Fail-closed — a
 * missing/consumed/mismatched approval is rejected (isError) without clearing protection (CS1).
 * Split out from the registerTool wrapper (like abort.ts) so it's unit-testable without pi.zod.
 */
export function performCraftRelease(reason: string): AgentToolResult<CraftReleaseDetails> {
	const craft = getActiveCraft();
	if (!craft) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: no active craft to release." }] };
	}
	// Fail-closed approval gate: consume the tag-bound single-use nonce before clearing protection.
	const consumed = consumePendingApproval({
		acceptedTags: RELEASE_CONSUMABLE_TAGS,
		identity: { feature: craft.feature, projectRoot: craft.projectRoot, worktreeRoot: craft.worktreeRoot },
	});
	if (!consumed.ok) {
		return { isError: true, content: [{ type: "text", text: releaseRejectionText(consumed) }] };
	}
	// Pre-record the open-release evidence (persist-before-publish) BEFORE clearing the craft — a
	// persist throw propagates with the craft still active and the consumed nonce NOT restored (CS5).
	recordOpenRelease({
		nonce: consumed.approval.nonce,
		tag: consumed.approval.tag,
		question: consumed.approval.question,
		response: consumed.approval.response,
		reason,
		openedAt: new Date().toISOString(),
		manifestFingerprint: fingerprintManifestFile(craftHashManifestPath(craft.worktreeRoot ?? craft.projectRoot, craft.feature)),
	});
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
