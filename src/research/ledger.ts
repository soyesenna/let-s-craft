// Research claim-ledger evaluator (deferred-pool F, D-2) — the decision ladder ported from
// gajae-code's research-plan ledger (ledger.ts:110-178, N4 — 취지 보존 이식). PURE and fs-untouched:
// every input below is an in-memory object. The fs half (path capability, read/validate, the single
// atomic write, decision stamping) lives in claims-tool.ts (pure boundary — a pure module never
// hosts a tool execute, C4/rec6).
//
// Framing (N4): this ladder is a DETERMINISTIC LOWER BOUND for non-adversarial, careless cases —
// a hallucinated claim cannot survive an explicit contradiction, and a dead claim cannot silently
// revive. A deliberately mislabeled source (support that is actually a refutation) still evades it;
// that adversarial hole is out of scope by design (오라벨 우회 한계).

export type ClaimVerdict = "support" | "contradict" | "uncertain";

export type ClaimStatus = "accepted" | "rejected" | "uncertain" | "invalid";

export interface ClaimEvidence {
	/** Where the evidence came from (e.g. `wave-1/probe.md`) — cited verbatim in rejection reasons. */
	source: string;
	verdict: ClaimVerdict;
}

/** The tool-owned per-claim CURRENT decision — no history array; history is git's job (F). */
export interface ClaimDecision {
	status: ClaimStatus;
	reasons: string[];
	/** Stamped fresh by lsc_claims at write time — never copied forward from input. */
	evaluatedAt: string;
}

export interface Claim {
	claim: string;
	/**
	 * REQUIRED pre-registered falsifier prose (사전등록): the condition under which this claim must be
	 * dropped. Optional in the TYPE only so an on-disk file missing it still parses — evaluateLedger
	 * marks such a claim `invalid` (never a throw), and lsc_claims then refuses the whole write.
	 */
	dropCondition?: string;
	evidence: ClaimEvidence[];
	/** Present once lsc_claims has stamped a decision — read back as `previousDecisions` next wave. */
	decision?: ClaimDecision;
}

export interface LedgerEvaluation {
	claim: string;
	status: ClaimStatus;
	reasons: string[];
}

/** Lowercase alphanumeric tokens (length ≥ 4) — the fuzzy unit dropCondition matching compares on. */
function proseTokens(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9가-힣]+/)
		.filter(token => token.length >= 4);
}

/**
 * True when the dropCondition prose "names" one of the contradicting sources (gajae :84-95): any
 * dropCondition token and source token where one is a prefix of the other (stem-tolerant — a
 * dropCondition anticipating a "counterexample" matches a `s-counter` source). Deliberately fuzzy:
 * this only ever ESCALATES an already-contradicted claim from accepted to rejected.
 */
function matchesDropCondition(dropCondition: string, sources: readonly string[]): boolean {
	const conditionTokens = proseTokens(dropCondition);
	const sourceTokens = sources.flatMap(proseTokens);
	return conditionTokens.some(ct => sourceTokens.some(st => ct.startsWith(st) || st.startsWith(ct)));
}

/**
 * Transition-aware decision ladder (checked in order — gajae port):
 *   1. missing/blank dropCondition            → invalid (well-formedness precedes everything)
 *   2. previous status rejected/invalid       → TOMBSTONE: kept verbatim — fresh support never
 *      revives a dead claim (CALM monotonicity, N4). Death stays reachable below; revival is not.
 *   3. contradicted with NO surviving support → rejected UNCONDITIONALLY, citing the refuting
 *      source(s) — closes the hallucination-survival path a purely-contradicted claim would
 *      otherwise escape through as "uncertain" (gajae :145-148 취지).
 *   4. contradicted AND dropCondition matched → rejected even when support survives.
 *   5. no evidence at all                     → uncertain.
 *   6. surviving support                      → accepted (a non-matching contradiction is noted).
 *   7. uncertain-only evidence                → uncertain.
 *
 * `previousDecisions` is built by the caller from each on-disk claim's CURRENT decision.status
 * BEFORE re-evaluation — that transition input is what makes the no-revival rule verifiable (D7).
 */
export function evaluateLedger(claims: readonly Claim[], previousDecisions: Record<string, ClaimStatus>): LedgerEvaluation[] {
	return claims.map(entry => {
		if (!entry.dropCondition || entry.dropCondition.trim().length === 0) {
			return {
				claim: entry.claim,
				status: "invalid" as const,
				reasons: ["dropCondition missing or blank — every claim must pre-register its own falsifier (사전등록)"],
			};
		}

		const previous = previousDecisions[entry.claim];
		if (previous === "rejected" || previous === "invalid") {
			return {
				claim: entry.claim,
				status: previous,
				reasons: [`tombstone: previously ${previous} — fresh support cannot revive a dead claim (부활 금지, CALM)`],
			};
		}

		const support = entry.evidence.filter(item => item.verdict === "support");
		const contradictions = entry.evidence.filter(item => item.verdict === "contradict");

		if (contradictions.length > 0 && support.length === 0) {
			return {
				claim: entry.claim,
				status: "rejected" as const,
				reasons: [`contradicted with no surviving support: ${contradictions.map(item => item.source).join(", ")}`],
			};
		}

		if (
			contradictions.length > 0 &&
			matchesDropCondition(
				entry.dropCondition,
				contradictions.map(item => item.source),
			)
		) {
			return {
				claim: entry.claim,
				status: "rejected" as const,
				reasons: [`dropCondition met by contradicting source(s): ${contradictions.map(item => item.source).join(", ")}`],
			};
		}

		if (entry.evidence.length === 0) {
			return { claim: entry.claim, status: "uncertain" as const, reasons: ["no evidence collected yet"] };
		}

		if (support.length > 0) {
			const note = contradictions.length > 0 ? ` (a contradiction exists but did not meet the dropCondition: ${contradictions.map(item => item.source).join(", ")})` : "";
			return {
				claim: entry.claim,
				status: "accepted" as const,
				reasons: [`surviving support: ${support.map(item => item.source).join(", ")}${note}`],
			};
		}

		return { claim: entry.claim, status: "uncertain" as const, reasons: ["only uncertain evidence collected"] };
	});
}
