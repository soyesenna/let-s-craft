// Generic destructive-approval authority for the craft loop's most dangerous gates
// ([Canon Amendment] / [Land] / [Hash Violation]). This module owns TWO things and nothing
// else: the gate-tag SSOT, and the single in-process "pending approval" slot that is the sole
// source of consume-ability (the 권위, spec CORE). It has ZERO repo-internal runtime imports
// (only node:crypto for the nonce) — no state.ts, no fs — so the휘발성 권위 can never be
// accidentally serialized into the durable CraftState: that boundary is physical, not just a
// convention (plan Option A / CS1). The durable evidence ledger (releaseApproval / openRelease)
// lives in state.ts; consumer-specific tag allowlists (RELEASE_CONSUMABLE_TAGS) live in the
// consumer module (release.ts) — the issuance infrastructure does not know its consumers.
//
// Layering (CS8): matchDestructiveGateTag / sameCraftIdentity / createPendingApproval are pure;
// the slot mutators (install / consume / invalidate) are the SDK-independent effectful core
// (their persist-order and rollback ARE the test surface). Neither touches pi.zod/pi.registerTool.
import { randomUUID } from "node:crypto";

/**
 * The three destructive gate tags, in canonical order — the single source of truth (C10). A
 * question is "tagged" iff it starts with exactly one of these bracketed prefixes; the tagging
 * convention itself (skills/craft/SKILL.md) is unchanged, this module only recognizes it (C11).
 * Aliases are forbidden: the legacy `[Release]` prefix is deliberately absent.
 */
export const DESTRUCTIVE_GATE_TAGS = ["[Canon Amendment]", "[Land]", "[Hash Violation]"] as const;

export type DestructiveGateTag = (typeof DESTRUCTIVE_GATE_TAGS)[number];

/**
 * The craft a pending approval is bound to. Compared by FIELD equality (sameCraftIdentity),
 * never by reference: recordTestResult/recordReleaseApproval spread-replace the active-craft
 * object, so a reference captured at prompt time is not trustworthy across an await (F-12).
 */
export interface ApprovalCraftIdentity {
	feature: string;
	projectRoot: string;
	worktreeRoot?: string;
}

/** A live, consumable destructive-gate approval — the in-memory slot's content. */
export interface PendingDestructiveApproval {
	/** crypto.randomUUID() — a fresh nonce per issuance. */
	nonce: string;
	tag: DestructiveGateTag;
	/** The confirm question verbatim. */
	question: string;
	/** Always the platform-produced affirmative (confirmResult, ask.ts). */
	response: "yes";
	/** ISO 8601 issuance timestamp. */
	issuedAt: string;
	/** The active craft this approval is bound to at issuance time. */
	identity: ApprovalCraftIdentity;
}

/**
 * The outcome of a consume attempt. Success surfaces the approval and burns the slot; a
 * tag/identity mismatch is a fail-closed rejection that PRESERVES the slot (conditional
 * non-burn, CS11) and surfaces the pending tag so the caller can explain the rejection; an
 * empty slot is `no-pending-approval`.
 */
export type ConsumeApprovalResult =
	| { ok: true; approval: PendingDestructiveApproval }
	| { ok: false; reason: "no-pending-approval" }
	| { ok: false; reason: "tag-mismatch" | "identity-mismatch"; pendingTag: DestructiveGateTag };

/**
 * The single in-process pending-approval slot (the 권위). Module-private, exactly like
 * state.ts's `activeCraft` singleton — the only way to set it is installPendingApproval, and the
 * only way to observe it non-destructively is peekPendingApproval. It is deliberately NOT
 * persisted anywhere: a process restart wipes it, which is the intended fail-closed behavior.
 */
let pendingApproval: PendingDestructiveApproval | undefined;

/**
 * Recognize a destructive gate tag as an exact question PREFIX (pure). A tag must be the literal
 * start of the question — a bare word stripped of brackets, a tag appearing mid-question, and an
 * unknown/legacy prefix all return undefined.
 */
export function matchDestructiveGateTag(question: string): DestructiveGateTag | undefined {
	for (const tag of DESTRUCTIVE_GATE_TAGS) {
		if (question.startsWith(tag)) return tag;
	}
	return undefined;
}

/**
 * Field-equality identity comparison (pure, F-12). Reference equality is unusable because the
 * active-craft object is spread-replaced by other mutators, so a spread copy with identical
 * fields IS the same identity. Fail-closed: undefined on either side is never equal.
 */
export function sameCraftIdentity(a: ApprovalCraftIdentity | undefined, b: ApprovalCraftIdentity | undefined): boolean {
	if (!a || !b) return false;
	return a.feature === b.feature && a.projectRoot === b.projectRoot && a.worktreeRoot === b.worktreeRoot;
}

/**
 * Build a pending-approval record WITHOUT touching the slot (prepare != install, CS2). The
 * issuance transaction (ask.ts) commits durable evidence from this record first, and only then
 * calls installPendingApproval — so a persist failure leaves no live capability.
 */
export function createPendingApproval(input: {
	tag: DestructiveGateTag;
	question: string;
	identity: ApprovalCraftIdentity;
}): PendingDestructiveApproval {
	return {
		nonce: randomUUID(),
		tag: input.tag,
		question: input.question,
		response: "yes",
		issuedAt: new Date().toISOString(),
		identity: input.identity,
	};
}

/** Publish a prepared record into the slot — the ONLY place the slot is set. The latest install wins. */
export function installPendingApproval(record: PendingDestructiveApproval): void {
	pendingApproval = record;
}

/**
 * Single-use consume. On a matching tag+identity: burn the slot and return the approval. On a
 * tag or identity mismatch: PRESERVE the slot and return the pending tag (conditional non-burn,
 * CS11 — one mis-targeted consumer must not destroy another gate's legitimate approval; the tags
 * are public constants, so a mismatch is not a secret-probing oracle either). Empty slot:
 * no-pending-approval. Tag is checked before identity.
 */
export function consumePendingApproval(input: {
	acceptedTags: readonly DestructiveGateTag[];
	identity: ApprovalCraftIdentity;
}): ConsumeApprovalResult {
	const pending = pendingApproval;
	if (!pending) return { ok: false, reason: "no-pending-approval" };
	if (!input.acceptedTags.includes(pending.tag)) return { ok: false, reason: "tag-mismatch", pendingTag: pending.tag };
	if (!sameCraftIdentity(pending.identity, input.identity)) return { ok: false, reason: "identity-mismatch", pendingTag: pending.tag };
	pendingApproval = undefined;
	return { ok: true, approval: pending };
}

/** Revoke the slot. Wired into every security-relevant state transition (state.ts) and into the tagged-prompt entry of the issuance wrapper (ask.ts). Idempotent. */
export function invalidatePendingApproval(): void {
	pendingApproval = undefined;
}

/** Non-destructive observation of the slot — for tests and the issuance transaction's checks, never the consume path. */
export function peekPendingApproval(): PendingDestructiveApproval | undefined {
	return pendingApproval;
}
