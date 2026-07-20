import { describe, expect, it } from "vitest";
import { type Claim, type ClaimStatus, evaluateLedger } from "../src/research/ledger";

// ===========================================================================
// deferred-pool F (리서치 claim 원장) — AC11 (unit part). plan Step 5a, ported
// from gajae-code/.../research-plan/ledger.ts:108-177 (주석 취지 보존 이식, N4).
// evaluateLedger is PURE (fs 무접촉 — every input below is an in-memory object)
// and TRANSITION-aware:
//   evaluateLedger(claims, previousDecisions) -> { claim, status, reasons }[]
//     Claim            = { claim, dropCondition, evidence, decision? }
//     evidence entry   = { source, verdict: "support" | "contradict" | "uncertain" }
//     status           = "accepted" | "rejected" | "uncertain" | "invalid"
//     previousDecisions = Record<claim, status> (built from the on-disk per-claim
//                         decision.status BEFORE re-evaluation)
// The decision field itself is the lsc_claims tool's SOLE property (it stamps
// decision.evaluatedAt on write) — evaluateLedger returns only {claim,status,reasons},
// so this file asserts only those (boundary agreed with the claims-tool tester).
//
// Ladder (gajae port):
//   • dropCondition missing/blank            -> invalid
//   • no evidence for the claim              -> uncertain
//   • a contradiction with NO surviving support -> rejected UNCONDITIONALLY (closes
//     the hallucination-survival path a purely-contradicted claim would otherwise
//     escape through as "uncertain" — gajae :145-148)
//   • dropCondition prose matched by a contradictory source -> rejected even when
//     support survives (matchesDropCondition, gajae :84-95)
//   • surviving support, no drop reason      -> accepted
// Tombstone monotonicity (CALM, N4): a previous status of rejected/invalid is a
// tombstone — fresh support can NEVER revive it. Death is still reachable (a
// previously accepted claim can newly reject); revival is not.
//
// PRE-CRAFT RED (test-first): src/research/ledger.ts does NOT exist yet, so this
// whole file is import-shaped RED — module resolution fails at load and every test
// errors until craft (plan Step 5a) writes the module. That is the correct,
// expected test-first outcome (release-gate import-RED precedent).
// ===========================================================================

/** Build a claim with a benign default dropCondition + no evidence; each test overrides only what
 * it exercises. Defaulting dropCondition keeps the "missing dropCondition -> invalid" case the
 * ONLY one that omits it, so the invalid path is never triggered incidentally. */
function mkClaim(over: Partial<Claim> & { claim: string }): Claim {
	return { dropCondition: "drop this claim if the observed behavior never occurs", evidence: [], ...over };
}

describe("evaluateLedger — decision ladder (pure)", () => {
	it("marks a claim with a missing dropCondition as invalid", () => {
		const claims: Claim[] = [{ claim: "C1", evidence: [{ source: "docs", verdict: "support" }] } as Claim];

		const [decision] = evaluateLedger(claims, {});

		expect(decision.claim).toBe("C1");
		expect(decision.status).toBe("invalid");
	});

	it("marks a claim with a blank dropCondition as invalid", () => {
		const claims = [mkClaim({ claim: "C1", dropCondition: "   ", evidence: [{ source: "docs", verdict: "support" }] })];

		expect(evaluateLedger(claims, {})[0].status).toBe("invalid");
	});

	it("marks a claim with no collected evidence as uncertain", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [] })];

		expect(evaluateLedger(claims, {})[0].status).toBe("uncertain");
	});

	it("accepts a claim with surviving support and no contradiction", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [{ source: "spec.md", verdict: "support" }] })];

		expect(evaluateLedger(claims, {})[0].status).toBe("accepted");
	});

	it("rejects a claim that is contradicted with no surviving support, citing the refuting source", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [{ source: "adversary-probe", verdict: "contradict" }] })];

		const [decision] = evaluateLedger(claims, {});

		expect(decision.status).toBe("rejected");
		expect(decision.reasons.join(" ")).toContain("adversary-probe");
	});

	it("rejects a mixed support/contradiction claim when the dropCondition prose matches the counterexample", () => {
		const claims = [
			mkClaim({
				claim: "C1",
				dropCondition: "drop this claim if any counterexample source is found",
				evidence: [
					{ source: "s-support", verdict: "support" },
					{ source: "s-counter", verdict: "contradict" },
				],
			}),
		];

		const [decision] = evaluateLedger(claims, {});

		expect(decision.status).toBe("rejected");
		expect(decision.reasons.join(" ")).toContain("s-counter");
	});
});

describe("evaluateLedger — tombstone monotonicity (transition-aware)", () => {
	it("does NOT revive a previously rejected claim even when fresh support is added", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [{ source: "new-doc", verdict: "support" }] })];
		const previous: Record<string, ClaimStatus> = { C1: "rejected" };

		const [decision] = evaluateLedger(claims, previous);

		expect(decision.status).not.toBe("accepted");
		expect(["rejected", "invalid"]).toContain(decision.status);
	});

	it("does NOT revive a previously invalid claim even when it is now well-formed with support", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [{ source: "new-doc", verdict: "support" }] })];
		const previous: Record<string, ClaimStatus> = { C1: "invalid" };

		const [decision] = evaluateLedger(claims, previous);

		expect(decision.status).not.toBe("accepted");
		expect(["rejected", "invalid"]).toContain(decision.status);
	});

	it("still lets a previously accepted claim newly reject — the tombstone blocks revival, not death", () => {
		const claims = [mkClaim({ claim: "C1", evidence: [{ source: "adversary-probe", verdict: "contradict" }] })];
		const previous: Record<string, ClaimStatus> = { C1: "accepted" };

		expect(evaluateLedger(claims, previous)[0].status).toBe("rejected");
	});
});
