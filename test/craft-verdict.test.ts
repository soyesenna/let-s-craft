import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as zod from "zod/v4";
import { craftAuditDir, craftCheckLogsDir, craftStatePath } from "../src/artifacts/paths";
import { type CraftState, clearActiveCraft, readPersistedCraftState, setActiveCraft } from "../src/craft/state";
import {
	AUDIT_VERDICTS,
	CRITIC_VERDICTS,
	isPassingCheckLog,
	parseAuditVerdict,
	parseCriticVerdict,
	parseVerdictLine,
	registerAuditValidateTools,
	performAuditBegin,
	performAuditValidate,
	validateAuditFreshness,
} from "../src/craft/verdict";

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

	it("two distinct prefixes never collide even in the same document (pre-craft Stage 3 합의 루프의 critic 리포트 파싱)", () => {
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

// ---------------------------------------------------------------------------
// U1: multi-auditor rework anchor probes. Each auditor writes its own
// `**AUDITOR VERDICT: X**` line into its report; the final gate reads ONLY the main session's
// `**AUDIT VERDICT: X**` line (first-match, see parseVerdictLine's regex). These two probes pin
// that boundary as a regression, plus (in a later describe block) the fail-open it leaves open.
// ---------------------------------------------------------------------------
describe("parseAuditVerdict vs. per-auditor '**AUDITOR VERDICT: ...**' lines (U1 regression anchor)", () => {
	it("returns undefined when only a line-start '**AUDITOR VERDICT: REJECT**' line exists and no '**AUDIT VERDICT:**' line is present — an individual auditor's own verdict line is never mistaken for the gate's line", () => {
		const markdown = "# Audit\n\n**AUDITOR VERDICT: REJECT**\n";
		expect(parseAuditVerdict(markdown)).toBeUndefined();
	});

	it("reads only '**AUDIT VERDICT: APPROVE**' when a '**AUDITOR VERDICT: REJECT**' line sits ABOVE it in the same document — the two prefixes never collide (AUDIT VERDICT requires a space right after 'AUDIT', which 'AUDITOR' structurally cannot satisfy), so this is not a near-miss, it is a fixed structural distinction", () => {
		// Auditor line FIRST, deliberately: parseVerdictLine takes the first line-anchored
		// match, so this is the order that actually falsifies a loosened prefix. Were the
		// regex ever relaxed to a plain `AUDIT VERDICT` prefix (dropping the required space
		// after 'AUDIT'), this document would resolve to the LANE's REJECT instead of the
		// main session's APPROVE. With the audit line on top the assertion holds either way.
		const markdown = ["# Audit", "", "**AUDITOR VERDICT: REJECT**", "", "**AUDIT VERDICT: APPROVE**", ""].join("\n");
		expect(parseAuditVerdict(markdown)).toBe("APPROVE");
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

describe("isPassingCheckLog", () => {
	it("recognizes a clean 'exit 0' transcript as passing", () => {
		expect(isPassingCheckLog(["$ bash run_check.sh", "--- stdout ---", "3 passed", "--- exit 0 ---"].join("\n"))).toBe(true);
	});

	it("treats a non-zero exit as failing", () => {
		expect(isPassingCheckLog(["--- stdout ---", "1 failed", "--- exit 1 ---"].join("\n"))).toBe(false);
	});

	it("treats an 'exit 0 (killed)' transcript as failing (killed overrides the exit code)", () => {
		expect(isPassingCheckLog("--- exit 0 (killed) ---")).toBe(false);
	});

	it("returns false on empty/garbage content without throwing", () => {
		expect(() => isPassingCheckLog("")).not.toThrow();
		expect(isPassingCheckLog("")).toBe(false);
	});
});

describe("validateAuditFreshness (B-1's core value: cycle-freshness)", () => {
	it("ok when a passing check-N.log exists after the cycle start", () => {
		const result = validateAuditFreshness("APPROVE", 2, [
			{ number: 1, passed: true },
			{ number: 2, passed: false },
			{ number: 3, passed: true },
		]);
		expect(result).toEqual({ ok: true });
	});

	it("violation when every check-N.log is at or before the cycle start (stale-log)", () => {
		const result = validateAuditFreshness("APPROVE", 3, [
			{ number: 1, passed: true },
			{ number: 2, passed: true },
			{ number: 3, passed: true },
		]);
		expect(result).toEqual({ ok: false, reason: "stale-log" });
	});

	it("violation when fresh check-N.log(s) exist but none of them passed (no-passing-log)", () => {
		const result = validateAuditFreshness("APPROVE-WITH-COMMENT", 2, [
			{ number: 1, passed: true },
			{ number: 3, passed: false },
			{ number: 4, passed: false },
		]);
		expect(result).toEqual({ ok: false, reason: "no-passing-log" });
	});

	it("tolerant (ok) when checkLogAtCycleStart is undefined — a legacy craft state that never called lsc_audit_begin", () => {
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

// ---------------------------------------------------------------------------
// B-1 review NEEDS-FIX MEDIUM: tool-execute-level integration coverage for performAuditBegin /
// performAuditValidate against real temp directories — no ExtensionAPI/pi.zod mocking needed
// since both are the extracted "performX" cores the registerTool wrappers call directly (mirrors
// run-check.ts's own tool-level test pattern added alongside this fix).
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];
afterEach(() => {
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-verdict-tool-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

/** Persist a craft state to disk with no active-craft singleton left set — mirrors post-craft's real scenario (craft ran in an earlier/different session). */
function persistOnly(state: CraftState): void {
	setActiveCraft(state);
	clearActiveCraft();
}

function writeAuditDoc(root: string, feature: string, n: number, verdict: string): void {
	const dir = craftAuditDir(root, feature);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `audit-${n}.md`), `# Audit\n\n**AUDIT VERDICT: ${verdict}**\n`);
}

function passingLog(): string {
	return ["$ bash run_check.sh", "--- stdout ---", "ok", "--- stderr ---", "", "--- exit 0 ---"].join("\n");
}

function failingLog(code = 1): string {
	return ["$ bash run_check.sh", "--- stdout ---", "", "--- stderr ---", "boom", `--- exit ${code} ---`].join("\n");
}

function writeCheckLog(root: string, feature: string, n: number, content: string): void {
	const dir = craftCheckLogsDir(root, feature);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `check-${n}.log`), content);
}

describe("performAuditBegin (tool-execute-level)", () => {
	it("fails closed (isError) when no persisted craft state exists at all", () => {
		const root = tmpProject();
		const result = performAuditBegin("never-crafted", root);
		expect(result.isError).toBe(true);
	});

	it("records auditCycle (audit dir max+1) and checkLogAtCycleStart (logs dir max) onto the persisted state", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeCheckLog(root, feature, 1, passingLog());
		writeCheckLog(root, feature, 2, failingLog());
		writeAuditDoc(root, feature, 0, "APPROVE-WITH-CHANGE");

		const result = performAuditBegin(feature, root);

		expect(result.isError).toBeFalsy();
		expect(result.details).toEqual({ feature, auditCycle: 1, checkLogAtCycleStart: 2 });
		expect(readPersistedCraftState(root, feature)?.auditCycle).toBe(1);
		expect(readPersistedCraftState(root, feature)?.checkLogAtCycleStart).toBe(2);
	});

	it("uses auditCycle 0 and checkLogAtCycleStart 0 when neither an audit doc nor a check log exists yet", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));

		const result = performAuditBegin(feature, root);

		expect(result.details).toEqual({ feature, auditCycle: 0, checkLogAtCycleStart: 0 });
	});

	// -------------------------------------------------------------------------
	// PR-2: the fail-open cycle≥3 WARN is REPLACED by the fail-closed escalation gate.
	// -------------------------------------------------------------------------

	it("live candidate 3 refuses with escalation-required, persists the exact pending, and leaves the cycle marker untouched", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT"); // 3 prior cycles (0,1,2) -> next begin is cycle 3

		const result = performAuditBegin(feature, root);

		expect(result.isError).toBe(true);
		expect(result.details?.escalation?.status).toBe("escalation-required");
		expect(result.details?.escalation?.dueCycle).toBe(3);
		expect(result.details?.question?.startsWith("[Audit Escalation] ")).toBe(true);
		expect(result.details?.question?.endsWith("continue?")).toBe(true);
		expect(result.details?.options).toEqual(["Continue auditing", "Abort this craft", "Preserve branch and stop"]);
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditEscalationPending).toMatchObject({ feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3 });
		// Cycle-invariant: the gate consumed NO cycle — marker/threshold stay absent for this legacy state.
		expect(persisted?.auditCycle).toBeUndefined();
		expect(persisted?.checkLogAtCycleStart).toBeUndefined();
	});

	it("an unconsumed re-call at the same due cycle is idempotent — the same question, no state change", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT");
		performAuditBegin(feature, root);
		const before = readFileSync(craftStatePath(root, feature), "utf8");

		const retry = performAuditBegin(feature, root);

		expect(retry.isError).toBe(true);
		expect(retry.details?.escalation?.status).toBe("escalation-required");
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(before); // byte-stable retry
	});

	it("\"Continue auditing\" consumes the pending, records cycle 3 exactly once, and mirrors the next due cycle 6", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT");
		writeCheckLog(root, feature, 2, passingLog());
		performAuditBegin(feature, root); // open the gate

		const consumed = performAuditBegin(feature, root, { escalationDisposition: "Continue auditing" });

		expect(consumed.isError).toBeFalsy();
		expect(consumed.details).toMatchObject({ feature, auditCycle: 3, checkLogAtCycleStart: 2 });
		expect(consumed.details?.escalation).toMatchObject({ status: "continued", nextDueCycle: 6 });
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditCycle).toBe(3);
		expect(persisted?.checkLogAtCycleStart).toBe(2);
		expect(persisted?.auditEscalationPending).toBeUndefined();
		expect(persisted?.nextAuditEscalationCycle).toBe(6);
		expect(persisted?.auditEscalations).toHaveLength(1);
		// audit-3.md does not exist yet, so a crash-retry replays idempotently at cycle 3 (byte-stable).
		const bytes = readFileSync(craftStatePath(root, feature), "utf8");
		const replay = performAuditBegin(feature, root);
		expect(replay.isError).toBeFalsy();
		expect(replay.details?.auditCycle).toBe(3);
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(bytes);
	});

	it("a terminal disposition (Abort/Preserve) consumes the gate WITHOUT issuing a cycle; later begins are refused", () => {
		for (const disposition of ["Abort this craft", "Preserve branch and stop"] as const) {
			const root = tmpProject();
			const feature = "my-feature";
			persistOnly({ ...freshState(root, feature), auditCycle: 2 });
			for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT");

			const opening = performAuditBegin(feature, root);
			expect(opening.isError).toBe(true);
			const consumed = performAuditBegin(feature, root, { escalationDisposition: disposition });

			expect(consumed.isError).toBeFalsy();
			expect(consumed.details?.escalation).toMatchObject({ status: "terminal", disposition });
			const persisted = readPersistedCraftState(root, feature);
			expect(persisted?.auditCycle).toBe(2); // NO cycle issued
			expect(persisted?.auditTerminalDisposition).toMatchObject({ disposition, dueCycle: 3 });

			const later = performAuditBegin(feature, root);
			expect(later.isError).toBe(true);
			expect(later.details?.escalation?.status).toBe("terminal");
		}
	});

	it("below-cap begins carry no escalation evidence and no WARN", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeAuditDoc(root, feature, 0, "REJECT"); // 1 prior cycle -> next begin is cycle 1

		const result = performAuditBegin(feature, root);

		expect(result.isError).toBeFalsy();
		expect(result.details?.escalation).toBeUndefined();
		expect((result.content[0] as { text: string }).text).not.toContain("감사 사이클");
	});

	it("fixture interval 2 gates at candidate 2 (injected via options) and Continue re-arms at 4", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		writeAuditDoc(root, feature, 1, "REJECT");

		const gate = performAuditBegin(feature, root, { activeInterval: 2 });
		expect(gate.isError).toBe(true);
		expect(gate.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 2, intervalCycles: 2 });

		const consumed = performAuditBegin(feature, root, { activeInterval: 2, escalationDisposition: "Continue auditing" });
		expect(consumed.isError).toBeFalsy();
		expect(consumed.details?.auditCycle).toBe(2);
		expect(readPersistedCraftState(root, feature)?.nextAuditEscalationCycle).toBe(4);
	});

	it("a persisted fixture ledger read under the live interval is refused invalid-state with no write", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({
			...freshState(root, feature),
			auditCycle: 1,
			auditEscalationPending: { feature, dueCycle: 2, scheduledCycle: 2, intervalCycles: 2, createdAt: "2026-08-25T00:00:00.000Z" },
		});
		writeAuditDoc(root, feature, 0, "REJECT");
		writeAuditDoc(root, feature, 1, "REJECT");

		const result = performAuditBegin(feature, root); // live interval 3 by default

		expect(result.isError).toBe(true);
		expect(result.details?.escalation?.status).toBe("invalid-state");
	});

	it("legacy overdue: field-less cycle-14 state gates candidate 15 once; Continue re-arms at 18", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 14 });
		for (let n = 0; n < 15; n++) writeAuditDoc(root, feature, n, "REJECT");

		const gate = performAuditBegin(feature, root);
		expect(gate.isError).toBe(true);
		expect(gate.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 15, scheduledCycle: 3, intervalCycles: 3 });

		const consumed = performAuditBegin(feature, root, { escalationDisposition: "Continue auditing" });
		expect(consumed.isError).toBeFalsy();
		expect(consumed.details?.auditCycle).toBe(15);
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.nextAuditEscalationCycle).toBe(18);
		expect(persisted?.auditEscalations?.[0]).toMatchObject({ dueCycle: 15, scheduledCycle: 3, nextDueCycle: 18 });
	});

	it("candidate backward/forward gaps around the persisted marker are refused before any write", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 5 });
		// Only cycles 0..3 exist on disk (TWO+ completed artifacts removed) — candidate 4 < marker 5.
		for (let n = 0; n < 4; n++) writeAuditDoc(root, feature, n, "REJECT");
		const backward = performAuditBegin(feature, root);
		expect(backward.isError).toBe(true);
		expect(backward.details?.escalation?.status).toBe("invalid-state");

		// Forward gap: marker 5 but audits jump to 7 → candidate 7 > marker+1.
		const root2 = tmpProject();
		persistOnly({ ...freshState(root2, feature), auditCycle: 5 });
		for (let n = 0; n < 8; n++) writeAuditDoc(root2, feature, n, "REJECT");
		const forward = performAuditBegin(feature, root2);
		expect(forward.isError).toBe(true);
		expect(forward.details?.escalation?.status).toBe("invalid-state");
	});
});

describe("performAuditValidate (tool-execute-level, 4 branches + mismatch guard)", () => {
	it("succeeds for an APPROVE-family verdict backed by a fresh passing check-N.log, and records the auditValidated marker", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeCheckLog(root, feature, 1, passingLog()); // pre-cycle (stale)
		performAuditBegin(feature, root); // auditCycle=0, checkLogAtCycleStart=1
		writeCheckLog(root, feature, 2, passingLog()); // fresh, after the cycle start
		writeAuditDoc(root, feature, 0, "APPROVE");

		const result = performAuditValidate(feature, root);

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(result.details).toEqual({ feature, auditNumber: 0, verdict: "APPROVE", freshness: { ok: true } });
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditValidated).toEqual({ cycle: 0, verdict: "APPROVE", at: expect.any(String) });
	});

	it("fails closed with 'stale-log' when no check-N.log exists after the cycle's freshness threshold", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeCheckLog(root, feature, 1, passingLog());
		performAuditBegin(feature, root); // checkLogAtCycleStart=1 — nothing fresher gets written below
		writeAuditDoc(root, feature, 0, "APPROVE");

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("cannot be backed by a fresh run");
	});

	it("fails closed with 'no-passing-log' when fresh check-N.log(s) exist but none passed", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		performAuditBegin(feature, root); // checkLogAtCycleStart=0
		writeCheckLog(root, feature, 1, failingLog());
		writeAuditDoc(root, feature, 0, "APPROVE-WITH-COMMENT");

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("not backed by fresh passing evidence");
	});

	it("fails closed when the latest audit-N.md has no parseable AUDIT VERDICT line", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		const dir = craftAuditDir(root, feature);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "audit-0.md"), "# Audit\n\nno verdict line here\n");

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("could not parse");
	});

	it("fails closed when no audit-N.md exists under the audit dir at all", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("Run post-craft's audit stage first");
	});

	it("fails closed on an auditCycle/audit-N.md mismatch for an APPROVE-family verdict (review LOW-3 functionalization)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		performAuditBegin(feature, root); // auditCycle=0 recorded
		writeCheckLog(root, feature, 1, passingLog());
		// A second audit doc is written WITHOUT calling lsc_audit_begin again for it — the persisted
		// auditCycle (0) no longer matches the actual latest audit doc (1).
		writeAuditDoc(root, feature, 1, "APPROVE");

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("audit cycle marker mismatch");
	});

	it("does NOT enforce the mismatch guard for a non-APPROVE-family verdict (freshness never gated it anyway)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		performAuditBegin(feature, root); // auditCycle=0
		writeAuditDoc(root, feature, 1, "REJECT"); // mismatched auditCycle, but REJECT is exempt

		const result = performAuditValidate(feature, root);

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("Not land-eligible");
	});

	it("a REJECT verdict succeeds unconditionally (no freshness/log requirement) with a 'not land-eligible' text, never 'cycle-freshness confirmed'", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeAuditDoc(root, feature, 0, "REJECT");

		const result = performAuditValidate(feature, root);

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		const text = (result.content[0] as { text: string }).text;
		expect(text).toContain("Not land-eligible");
		expect(text).not.toContain("cycle-freshness confirmed");
	});

	it("an APPROVE-WITH-CHANGE verdict succeeds unconditionally too (never land-eligible on its own, per skills/post-craft/SKILL.md §7.1)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeAuditDoc(root, feature, 0, "APPROVE-WITH-CHANGE");

		const result = performAuditValidate(feature, root);

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect((result.content[0] as { text: string }).text).toContain("Not land-eligible");
	});
});

// ---------------------------------------------------------------------------
// U1 (b): the real risk path — first-match fail-open. If a sub-agent auditor drifts off its own
// `**AUDITOR VERDICT: X**` vocabulary and instead emits a genuine `**AUDIT VERDICT: X**` line, AND
// that line is quoted verbatim into audit-N.md ABOVE the main session's own synthesized
// `**AUDIT VERDICT: ...**` line, parseAuditVerdict's first-match semantics read the WRONG verdict.
// This test pins that as an OBSERVED FACT of the current implementation, not a desired behavior.
// ---------------------------------------------------------------------------
describe("multi-auditor first-match fail-open (U1 load-bearing FACT-LOCK, CN-2 residual risk)", () => {
	it(
		"FACT-LOCK: a sub-agent auditor report quoted verbatim into audit-N.md, whose drifted " +
			"'**AUDIT VERDICT: APPROVE**' line sits ABOVE the main session's synthesized " +
			"'**AUDIT VERDICT: REJECT**' line, makes performAuditValidate read + durably record APPROVE " +
			"instead of the intended REJECT. This fail-open is suppressed ONLY by isolating each " +
			"auditor's report into its own audit/auditor-{N}-{lens}.md file rather than quoting it " +
			"verbatim inside audit-N.md — parseAuditVerdict uniqueness hardening was deliberately NOT " +
			"adopted for this (CN-2); it remains a live residual risk this test locks down as fact.",
		() => {
			const root = tmpProject();
			const feature = "my-feature";
			persistOnly(freshState(root, feature));
			performAuditBegin(feature, root); // auditCycle=0, checkLogAtCycleStart=0
			writeCheckLog(root, feature, 1, passingLog()); // fresh, after the cycle start

			// A sub-agent auditor's report is quoted verbatim into audit-0.md ABOVE the main session's
			// own synthesized verdict. The sub-agent drifted off its own "**AUDITOR VERDICT: ...**"
			// vocabulary (skills/post-craft's per-auditor contract) and emitted the CANONICAL
			// "**AUDIT VERDICT: ...**" line instead — a genuine, well-formed line the gate's parser
			// cannot distinguish from the main session's own.
			const auditDir = craftAuditDir(root, feature);
			mkdirSync(auditDir, { recursive: true });
			const auditMarkdown = [
				"# Audit",
				"",
				"> quoting auditor-0-correctness verbatim:",
				"**AUDIT VERDICT: APPROVE**",
				"",
				"## Main session synthesis",
				"**AUDIT VERDICT: REJECT**",
				"",
			].join("\n");
			writeFileSync(join(auditDir, "audit-0.md"), auditMarkdown);

			const result = performAuditValidate(feature, root);

			// FACT (not desired behavior): the first-match parser reads APPROVE — the WRONG verdict,
			// backed by a fresh passing log — and succeeds (isError falsy) rather than failing closed.
			expect(result.isError, JSON.stringify(result)).toBeFalsy();
			expect(result.details?.verdict).toBe("APPROVE");
			// The wrong verdict is durably recorded too — a downstream lsc_land re-derivation
			// (validateLandAuditEvidence) that trusts this marker as consistency evidence would see APPROVE.
			expect(readPersistedCraftState(root, feature)?.auditValidated?.verdict).toBe("APPROVE");
		},
	);
});

// ---------------------------------------------------------------------------
// PR-2 registration wrapper: `registerAuditBeginTool` is the ONLY interval owner — it reads
// detectFixturePath(name => pi.getFlag(name)) (env-first LSC_FIXTURE + the interactive
// --lsc-fixtures alias) and injects the active interval into the pure policy. performAuditBegin
// itself never reads env/flags, so the seam is observable exactly here.
// ---------------------------------------------------------------------------

describe("registerAuditBeginTool — fixture-mode interval injection (production registration capture)", () => {
	type BeginExecute = (id: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }>; details?: { escalation?: { status?: string; dueCycle?: number } } }>;
	let beginExecute: BeginExecute | undefined;
	let flagValue: string | undefined;
	let savedFixtureEnv: string | undefined;

	beforeEach(() => {
		savedFixtureEnv = process.env.LSC_FIXTURE;
		delete process.env.LSC_FIXTURE;
		beginExecute = undefined;
		flagValue = undefined;
	});
	afterEach(() => {
		if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
		else process.env.LSC_FIXTURE = savedFixtureEnv;
	});

	function captureBeginExecute(): BeginExecute {
		const pi = {
			zod,
			getFlag: (name: string) => (name === "lsc-fixtures" ? flagValue : undefined),
			registerTool(definition: unknown): void {
				if (typeof definition === "object" && definition !== null && "name" in definition && (definition as { name?: string }).name === "lsc_audit_begin" && "execute" in definition && typeof (definition as { execute?: unknown }).execute === "function") {
					beginExecute = (definition as { execute: BeginExecute }).execute;
				}
			},
		};
		registerAuditValidateTools(pi as unknown as Parameters<typeof registerAuditValidateTools>[0]);
		if (!beginExecute) throw new Error("lsc_audit_begin was not registered");
		return beginExecute;
	}

	/** Two prior cycles (audit-0/1) → candidate 2: gates under the FIXTURE interval, proceeds under live. */
	function seedCandidateTwo(root: string): void {
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		writeAuditDoc(root, feature, 1, "REJECT");
	}

	it("env-only LSC_FIXTURE (no flag) injects the fixture interval — candidate 2 gates", async () => {
		const root = tmpProject();
		seedCandidateTwo(root);
		process.env.LSC_FIXTURE = "/tmp/does-not-need-to-exist-answers.json";
		const execute = captureBeginExecute();

		const result = await execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });

		expect(result.isError).toBe(true);
		expect(result.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 2 });
	});

	it("flag-only --lsc-fixtures (env unset) also injects the fixture interval", async () => {
		const root = tmpProject();
		seedCandidateTwo(root);
		flagValue = "/tmp/flag-only-answers.json";
		const execute = captureBeginExecute();

		const result = await execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });

		expect(result.isError).toBe(true);
		expect(result.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 2 });
	});

	it("neither env nor flag leaves the LIVE interval — candidate 2 proceeds, candidate 3 gates", async () => {
		const root = tmpProject();
		seedCandidateTwo(root);
		const execute = captureBeginExecute();

		const underCap = await execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });
		expect(underCap.isError).toBeFalsy();
		expect(underCap.details?.escalation).toBeUndefined();

		// Advance to candidate 3 (cycle 2 begun, audit-2.md not yet written → replay window; write it to move on).
		writeAuditDoc(root, "my-feature", 2, "REJECT");
		const atCap = await execute("t", { feature_dir: "my-feature" }, undefined, undefined, { cwd: root });
		expect(atCap.isError).toBe(true);
		expect(atCap.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 3 });
	});
});
