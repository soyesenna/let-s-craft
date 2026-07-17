import { describe, expect, it } from "vitest";
import { AUDIT_VERDICTS, CRITIC_VERDICTS, isPassingRunLog, parseAuditVerdict, parseCriticVerdict, parseVerdictLine, validateAuditFreshness } from "../src/craft/verdict";

// ---------------------------------------------------------------------------
// B-1: verdict literal parser (shared generic implementation) + cycle-freshness.
// parseAuditVerdict's own basic parsing behavior (exact-match/reject-similar/missing-line) is
// already covered exhaustively by test/statusbar-craft-progress.test.ts (this module is now that
// test's import target via the QW7 re-export) — this file focuses on what's NEW: the generic
// parseVerdictLine primitive, the critic vocabulary it also covers, and validateAuditFreshness.
// ---------------------------------------------------------------------------

describe("parseVerdictLine (generic, shared by both vocabularies)", () => {
	it("parses each AUDIT_VERDICTS value under the 'AUDIT VERDICT' prefix", () => {
		for (const verdict of AUDIT_VERDICTS) {
			expect(parseVerdictLine(`**AUDIT VERDICT: ${verdict}**`, "AUDIT VERDICT", AUDIT_VERDICTS)).toBe(verdict);
		}
	});

	it("rejects near-miss/similar values (plural, lowercase, unrecognized) as undefined, never fuzzy-matched", () => {
		expect(parseVerdictLine("**AUDIT VERDICT: APPROVED**", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
		expect(parseVerdictLine("**AUDIT VERDICT: APPROVE-WITH-COMMENTS**", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
		expect(parseVerdictLine("**audit verdict: approve**", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
		expect(parseVerdictLine("**AUDIT VERDICT: MAYBE-LATER**", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
	});

	it("returns undefined when the line is absent entirely", () => {
		expect(parseVerdictLine("# doc\n\nno verdict line here", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
	});

	it("never throws on empty or garbage input", () => {
		expect(() => parseVerdictLine("", "AUDIT VERDICT", AUDIT_VERDICTS)).not.toThrow();
		expect(parseVerdictLine("", "AUDIT VERDICT", AUDIT_VERDICTS)).toBeUndefined();
	});

	it("two distinct prefixes never collide even in the same document (post-craft quotes lsc-critic verbatim, §4.1 point 7)", () => {
		const markdown = ["**AUDIT VERDICT: APPROVE-WITH-COMMENT**", "", "> quoting lsc-critic:", "**VERDICT: REVISE**"].join("\n");
		expect(parseVerdictLine(markdown, "AUDIT VERDICT", AUDIT_VERDICTS)).toBe("APPROVE-WITH-COMMENT");
		expect(parseVerdictLine(markdown, "VERDICT", CRITIC_VERDICTS)).toBe("REVISE");
	});
});

describe("parseAuditVerdict (canonical home, re-exported by statusbar/craft-progress.ts)", () => {
	it.each(AUDIT_VERDICTS)("parses %s by exact literal match", verdict => {
		expect(parseAuditVerdict(`**AUDIT VERDICT: ${verdict}**`)).toBe(verdict);
	});

	it("falls back to undefined on an unrecognized verdict value", () => {
		expect(parseAuditVerdict("**AUDIT VERDICT: MAYBE-LATER**")).toBeUndefined();
	});
});

describe("parseCriticVerdict (agents/lsc-critic.md's independent 5-value scale)", () => {
	it.each(CRITIC_VERDICTS)("parses %s by exact literal match", verdict => {
		expect(parseCriticVerdict(`**VERDICT: ${verdict}**`)).toBe(verdict);
	});

	it("rejects a near-miss critic value (e.g. 'ACCEPTED') as undefined", () => {
		expect(parseCriticVerdict("**VERDICT: ACCEPTED**")).toBeUndefined();
	});

	it("does not pick up post-craft's own AUDIT VERDICT line (distinct prefix)", () => {
		expect(parseCriticVerdict("**AUDIT VERDICT: REJECT**")).toBeUndefined();
	});

	it("returns undefined when the line is absent", () => {
		expect(parseCriticVerdict("no verdict line here")).toBeUndefined();
	});
});

describe("isPassingRunLog", () => {
	it("recognizes a clean 'exit 0' transcript as passing", () => {
		expect(isPassingRunLog(["$ bash run_test.sh", "--- stdout ---", "3 passed", "--- exit 0 ---"].join("\n"))).toBe(true);
	});

	it("treats a non-zero exit as failing", () => {
		expect(isPassingRunLog(["--- stdout ---", "1 failed", "--- exit 1 ---"].join("\n"))).toBe(false);
	});

	it("treats an 'exit 0 (killed)' transcript as failing (killed overrides the exit code)", () => {
		expect(isPassingRunLog("--- exit 0 (killed) ---")).toBe(false);
	});

	it("returns false on empty/garbage content without throwing", () => {
		expect(() => isPassingRunLog("")).not.toThrow();
		expect(isPassingRunLog("")).toBe(false);
	});
});

describe("validateAuditFreshness (B-1's core value: cycle-freshness)", () => {
	it("ok when a passing run-N.log exists after the cycle start", () => {
		const result = validateAuditFreshness("APPROVE", 2, [
			{ number: 1, passed: true },
			{ number: 2, passed: false },
			{ number: 3, passed: true },
		]);
		expect(result).toEqual({ ok: true });
	});

	it("violation when every run-N.log is at or before the cycle start (stale-log)", () => {
		const result = validateAuditFreshness("APPROVE", 3, [
			{ number: 1, passed: true },
			{ number: 2, passed: true },
			{ number: 3, passed: true },
		]);
		expect(result).toEqual({ ok: false, reason: "stale-log" });
	});

	it("violation when fresh run-N.log(s) exist but none of them passed (no-passing-log)", () => {
		const result = validateAuditFreshness("APPROVE-WITH-COMMENT", 2, [
			{ number: 1, passed: true },
			{ number: 3, passed: false },
			{ number: 4, passed: false },
		]);
		expect(result).toEqual({ ok: false, reason: "no-passing-log" });
	});

	it("tolerant (ok) when runLogAtCycleStart is undefined — a legacy craft state that never called lsc_audit_begin", () => {
		const result = validateAuditFreshness("APPROVE", undefined, [{ number: 1, passed: false }]);
		expect(result).toEqual({ ok: true });
	});

	it("never gates REJECT — always ok regardless of logs", () => {
		expect(validateAuditFreshness("REJECT", 5, [])).toEqual({ ok: true });
	});

	it("never gates APPROVE-WITH-CHANGE — never land-eligible on its own, so freshness would be noise", () => {
		expect(validateAuditFreshness("APPROVE-WITH-CHANGE", 5, [{ number: 6, passed: false }])).toEqual({ ok: true });
	});

	it("no logs at all after a tracked cycle start is a stale-log violation, not a crash", () => {
		expect(validateAuditFreshness("APPROVE", 0, [])).toEqual({ ok: false, reason: "stale-log" });
	});
});
