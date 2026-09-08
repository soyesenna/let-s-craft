import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as zod from "zod/v4";
import type * as GitModule from "../src/utils/git";
import { runGitText } from "../src/utils/git";
import { craftAuditDir, craftCheckLogsDir, craftStatePath, worktreePath } from "../src/artifacts/paths";
import { FIXTURE_AUDIT_ESCALATION_INTERVAL } from "../src/craft/audit-policy";
import { type CraftState, clearActiveCraft, readPersistedCraftState, setActiveCraft } from "../src/craft/state";
import {
	AUDIT_VERDICTS,
	CRITIC_VERDICTS,
	isPassingCheckLog,
	observeAuditBase,
	parseAuditVerdict,
	parseCriticVerdict,
	parseVerdictLine,
	registerAuditValidateTools,
	performAuditBegin,
	performAuditValidate,
	validateAuditFreshness,
} from "../src/craft/verdict";

// audit-0 RF-15①: the git runner is wrapped in a spy that delegates to the REAL implementation
// by default, so exactly one test (anchorBaseSnapshot's non-integer count degradation — a branch
// real git cannot produce, `rev-list --count` always prints an integer) can script the runner's
// return value without affecting any other test in this file.
vi.mock("../src/utils/git", async importOriginal => {
	const actual = await importOriginal<typeof GitModule>();
	return { ...actual, runGitText: vi.fn(actual.runGitText) };
});

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

	it("live Continue at 3 lets candidates 4 and 5 proceed and re-fires the gate at candidate 6", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT");
		performAuditBegin(feature, root);
		const consumed = performAuditBegin(feature, root, { escalationDisposition: "Continue auditing" });
		expect(consumed.isError).toBeFalsy();
		expect(consumed.details?.auditCycle).toBe(3);

		writeAuditDoc(root, feature, 3, "REJECT");
		const at4 = performAuditBegin(feature, root);
		expect(at4.isError).toBeFalsy();
		expect(at4.details?.auditCycle).toBe(4);
		expect(at4.details?.escalation).toBeUndefined();

		writeAuditDoc(root, feature, 4, "REJECT");
		const at5 = performAuditBegin(feature, root);
		expect(at5.isError).toBeFalsy();
		expect(at5.details?.auditCycle).toBe(5);
		expect(at5.details?.escalation).toBeUndefined();

		writeAuditDoc(root, feature, 5, "REJECT");
		const at6 = performAuditBegin(feature, root);
		expect(at6.isError).toBe(true);
		expect(at6.details?.escalation).toMatchObject({
			status: "escalation-required",
			dueCycle: 6,
			scheduledCycle: 6,
			intervalCycles: 3,
		});
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditCycle).toBe(5);
		expect(persisted?.auditEscalationPending).toMatchObject({ dueCycle: 6, scheduledCycle: 6, intervalCycles: 3 });
		expect(persisted?.auditEscalations).toHaveLength(1);
		expect(persisted?.auditEscalations?.[0]).toMatchObject({ dueCycle: 3, disposition: "Continue auditing" });
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


	it("PR-3: the wrapper observes the explicit base_branch over real git and persists the snapshot with the begun cycle", async () => {
		const { root, worktreeRoot, feature, mainTip } = tmpDriftProject();
		persistOnly({ ...freshState(root, feature), worktreeRoot });
		const execute = captureBeginExecute();

		const result = await execute("t", { feature_dir: feature, base_branch: "main" }, undefined, undefined, { cwd: root });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		// The wrapper resolved the PASSED ref (main), not the checkout's HEAD ("third") — the same
		// discriminator as observeAuditBase's own suite, observed through the production execute.
		expect(readPersistedCraftState(worktreeRoot, feature)?.auditBaseSnapshot).toMatchObject({
			baseBranch: "main",
			baseTip: mainTip,
			behindCount: 1,
			status: "ok",
			authority: "explicit-base",
		});
		// ...and this describe's own afterEach only restores env — clean the git fixture up inline.
		rmSync(root, { recursive: true, force: true });
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

// ---------------------------------------------------------------------------
// PR-3 — audit-time base observation. `observeAuditBase` is the registration wrapper's one
// read-only git seam; `performAuditBegin` persists the injected snapshot atomically with the
// begun cycle. Real git fixtures prove: the authority is the PASSED ref (a project root parked
// on a third branch can never masquerade as the base), explicit resolution is strict (no
// fallback, even for option-looking refs), the legacy fallback is attached-current-branch only,
// and drift/unknown are non-blocking WARN evidence — never a cycle refusal.
// ---------------------------------------------------------------------------

function gitIn(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

const tempGitDirs: string[] = [];

/**
 * main (seed + exactly 1 base-ahead commit), a `lets-craft/{feature}` worktree branched at the
 * seed with its own feature commit, and the project root parked on a THIRD branch carrying 3
 * commits — so measuring the passed base (`main`) yields behind 1 while measuring HEAD (`third`)
 * would yield 3: the assertions can tell exactly which ref was measured.
 */
function tmpDriftProject(opts: { advanceBase?: boolean } = {}): { root: string; worktreeRoot: string; feature: string; mainTip: string; seedTip: string } {
	const root = mkdtempSync(join(tmpdir(), "lsc-base-obs-"));
	tempGitDirs.push(root);
	gitIn(root, ["init", "-q", "-b", "main"]);
	gitIn(root, ["config", "user.email", "test@example.com"]);
	gitIn(root, ["config", "user.name", "Test"]);
	writeFileSync(join(root, "seed.txt"), "seed\n");
	gitIn(root, ["add", "-A"]);
	gitIn(root, ["commit", "-q", "-m", "seed"]);
	const seedTip = gitIn(root, ["rev-parse", "HEAD"]);
	const feature = "drift-feat";
	const worktreeRoot = worktreePath(root, feature);
	gitIn(root, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, seedTip]);
	writeFileSync(join(worktreeRoot, "feature.txt"), "feature work\n");
	gitIn(worktreeRoot, ["add", "-A"]);
	gitIn(worktreeRoot, ["commit", "-q", "-m", "feat"]);
	let mainTip = seedTip;
	if (opts.advanceBase !== false) {
		writeFileSync(join(root, "base-side.txt"), "base moved on\n");
		gitIn(root, ["add", "-A"]);
		gitIn(root, ["commit", "-q", "-m", "base ahead"]);
		mainTip = gitIn(root, ["rev-parse", "HEAD"]);
	}
	// Park the project root on a THIRD branch with 3 of its own commits (HEAD ≠ detected base).
	gitIn(root, ["checkout", "-q", "-b", "third", seedTip]);
	for (let i = 0; i < 3; i++) {
		writeFileSync(join(root, `third-${i}.txt`), `${i}\n`);
		gitIn(root, ["add", "-A"]);
		gitIn(root, ["commit", "-q", "-m", `third ${i}`]);
	}
	return { root, worktreeRoot, feature, mainTip, seedTip };
}

describe("observeAuditBase — real git authority/resolution/behind (PR-3)", () => {
	afterEach(() => {
		while (tempGitDirs.length > 0) {
			const dir = tempGitDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("explicit base is measured even when the project root HEAD sits on a THIRD branch — behind counts the PASSED base, not HEAD", async () => {
		const { root, worktreeRoot, mainTip } = tmpDriftProject();
		const featureTip = gitIn(worktreeRoot, ["rev-parse", "HEAD"]);

		const snapshot = await observeAuditBase(root, worktreeRoot, "main");

		expect(snapshot).toMatchObject({ baseBranch: "main", baseTip: mainTip, sourceTip: featureTip, behindCount: 1, status: "ok", authority: "explicit-base" });
		// Discriminator: measuring HEAD ("third", 3 commits past the seed) would have reported 3 —
		// the snapshot must carry the passed base's ref and tip, never the checkout's.
		expect(snapshot.behindCount).not.toBe(3);
		expect(snapshot.baseTip).not.toBe(gitIn(root, ["rev-parse", "HEAD"]));
	});

	it("an explicit unresolvable ref is recorded unknown with NO fallback to any branch", async () => {
		const { root, worktreeRoot } = tmpDriftProject();
		const snapshot = await observeAuditBase(root, worktreeRoot, "no-such-branch");
		expect(snapshot.status).toBe("unknown");
		expect(snapshot.authority).toBe("explicit-base");
		expect(snapshot.baseBranch).toBe("no-such-branch");
		expect(snapshot.baseTip).toBe("");
		expect(snapshot.behindCount).toBe("unknown");
		expect(snapshot.error ?? "").not.toBe("");
	});

	it("an option-looking explicit ref is treated as a rev (--end-of-options argv), never re-parsed as an option", async () => {
		const { root, worktreeRoot } = tmpDriftProject();
		const snapshot = await observeAuditBase(root, worktreeRoot, "--help");
		expect(snapshot).toMatchObject({ status: "unknown", authority: "explicit-base", baseBranch: "--help", baseTip: "", behindCount: "unknown" });
	});

	it("legacy caller (no base_branch) falls back to the attached project-root current branch", async () => {
		const { root, worktreeRoot, mainTip } = tmpDriftProject();
		gitIn(root, ["checkout", "-q", "main"]);
		const snapshot = await observeAuditBase(root, worktreeRoot, undefined);
		expect(snapshot).toMatchObject({ baseBranch: "main", baseTip: mainTip, behindCount: 1, status: "ok", authority: "legacy-current-branch" });
	});

	it("legacy fallback on a detached HEAD is unknown — the base is never guessed", async () => {
		const { root, worktreeRoot, mainTip } = tmpDriftProject();
		gitIn(root, ["checkout", "-q", "--detach", mainTip]);
		const snapshot = await observeAuditBase(root, worktreeRoot, undefined);
		expect(snapshot).toMatchObject({ status: "unknown", authority: "legacy-current-branch", behindCount: "unknown" });
		expect(snapshot.error ?? "").toContain("detached");
	});

	it("legacy fallback on an unborn HEAD is unknown", async () => {
		const root = mkdtempSync(join(tmpdir(), "lsc-base-obs-unborn-"));
		tempGitDirs.push(root);
		gitIn(root, ["init", "-q", "-b", "main"]);
		const snapshot = await observeAuditBase(root, root, undefined);
		expect(snapshot).toMatchObject({ status: "unknown", authority: "legacy-current-branch", behindCount: "unknown" });
		expect(snapshot.error ?? "").not.toBe("");
	});
});

describe("performAuditBegin × baseSnapshot — persisted with the cycle, replay-stable (PR-3)", () => {
	afterEach(() => {
		while (tempGitDirs.length > 0) {
			const dir = tempGitDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
		clearActiveCraft();
	});

	it("persists the injected snapshot atomically with the begun cycle and surfaces a non-blocking drift WARN", async () => {
		const { root, worktreeRoot, feature } = tmpDriftProject();
		persistOnly({ ...freshState(root, feature), worktreeRoot });

		const snapshot = await observeAuditBase(root, worktreeRoot, "main");
		const result = performAuditBegin(feature, root, { baseSnapshot: snapshot });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(result.details?.base).toEqual(snapshot);
		expect(result.details?.auditCycle).toBe(0);
		expect(result.content[0]?.text).toContain("WARN: base drift");
		expect(result.content[0]?.text).toContain('"main"');
		expect(readPersistedCraftState(worktreeRoot, feature)?.auditBaseSnapshot).toEqual(snapshot);
	});

	it("behind 0 carries the in-sync line and no drift WARN", async () => {
		const { root, worktreeRoot, feature } = tmpDriftProject({ advanceBase: false });
		persistOnly({ ...freshState(root, feature), worktreeRoot });

		const snapshot = await observeAuditBase(root, worktreeRoot, "main");
		expect(snapshot).toMatchObject({ behindCount: 0, status: "ok" });
		const result = performAuditBegin(feature, root, { baseSnapshot: snapshot });

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(result.content[0]?.text).toContain("0 behind (in sync)");
		expect(result.content[0]?.text).not.toContain("WARN: base drift");
	});

	it("a same-cycle replay returns the PERSISTED snapshot and rewrites nothing — a freshly injected observation is ignored", async () => {
		const { root, worktreeRoot, feature } = tmpDriftProject();
		persistOnly({ ...freshState(root, feature), worktreeRoot });
		const first = await observeAuditBase(root, worktreeRoot, "main");
		performAuditBegin(feature, root, { baseSnapshot: first });
		const statePath = craftStatePath(worktreeRoot, feature);
		const bytesBefore = readFileSync(statePath, "utf8");

		// Same candidate (audit-0.md still unwritten → candidate 0 === persisted auditCycle) with a
		// DIFFERENT observation injected: replay must not touch the recorded evidence.
		const second = await observeAuditBase(root, worktreeRoot, "third");
		expect(second.baseBranch).not.toBe(first.baseBranch);
		const replay = performAuditBegin(feature, root, { baseSnapshot: second });

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy();
		expect(replay.content[0]?.text).toContain("idempotent replay");
		expect(replay.details?.base).toEqual(first);
		expect(readFileSync(statePath, "utf8")).toBe(bytesBefore);
	});

	it("an escalation-required call begins no cycle and records NO base snapshot", () => {
		const { root, worktreeRoot, feature } = tmpDriftProject();
		persistOnly({ ...freshState(root, feature), worktreeRoot, auditCycle: 1 });
		writeAuditDoc(worktreeRoot, feature, 0, "REJECT");
		writeAuditDoc(worktreeRoot, feature, 1, "REJECT");

		const result = performAuditBegin(feature, root, {
			activeInterval: FIXTURE_AUDIT_ESCALATION_INTERVAL,
			baseSnapshot: { baseBranch: "main", baseTip: "0".repeat(40), sourceTip: "1".repeat(40), behindCount: 7, status: "ok", authority: "explicit-base", observedAt: new Date().toISOString() },
		});

		expect(result.isError).toBe(true);
		expect(result.details?.escalation).toMatchObject({ status: "escalation-required", dueCycle: 2 });
		expect(readPersistedCraftState(worktreeRoot, feature)?.auditBaseSnapshot).toBeUndefined();
	});
});

/** First content block's text via `in`-narrowing — no inline `as { text }` member access. */
function firstText(result: { content?: Array<Record<string, unknown>> }): string {
	const first = result.content?.[0];
	return first !== undefined && "text" in first && typeof first.text === "string" ? first.text : "";
}

// ---------------------------------------------------------------------------
// audit-0 RF-13 — lifecycle tool boundary: the resolved feature name is validated against the
// kebab-slug SSOT (src/artifacts/paths.ts FEATURE_SLUG_RE) BEFORE any fs access, because the
// name is interpolated verbatim into command-shaped tool text (the [Audit Escalation] question)
// and durable state. Newline/traversal/separator payloads must be refused, never echoed.
// ---------------------------------------------------------------------------

describe("RF-13 — kebab-slug boundary guard on the audit lifecycle tools", () => {
	const INJECTIONS = ["bad\nfeature", "weird/../traversal", "Shout Case", "feature;", "tab\tfeature"];

	it("performAuditBegin refuses every non-slug feature before touching the filesystem", () => {
		const root = tmpProject();
		for (const forged of INJECTIONS) {
			const result = performAuditBegin(forged, root);
			expect(result.isError, `feature ${JSON.stringify(forged)} must be refused`).toBe(true);
			expect(firstText(result)).toContain("kebab-case slug");
		}
	});

	it("performAuditValidate refuses every non-slug feature before touching the filesystem", () => {
		const root = tmpProject();
		for (const forged of INJECTIONS) {
			const result = performAuditValidate(forged, root);
			expect(result.isError, `feature ${JSON.stringify(forged)} must be refused`).toBe(true);
			expect(firstText(result)).toContain("kebab-case slug");
		}
	});

	it("audit-3 RF-34: a C1/DEL/separator-carrying feature is echoed ESCAPED in the slug refusal (JSON.stringify's raw axes closed)", () => {
		const root = tmpProject();
		for (const forged of ["bad\u0085feature", "sep\u2028feature", "del\u007ffeature"]) {
			const result = performAuditBegin(forged, root);
			expect(result.isError, `feature ${JSON.stringify(forged)} must be refused`).toBe(true);
			const text = firstText(result);
			expect(text).toContain("kebab-case slug");
			expect(text, "single-line refusal across the serializer's whole repertoire").not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/);
			expect(text).not.toContain(forged); // the raw payload never arrives intact
		}
	});
});

// ---------------------------------------------------------------------------
// audit-0 RF-3 — the equality+pending forgery at the performAuditBegin seam: a persisted
// {auditCycle: 3, pending.dueCycle: 3} plus candidate 3 and a Continue disposition must be
// refused invalid-state with the state file byte-stable (a naturally-opened gate is always
// marker+1; an equality candidate can only ever be an idempotent replay).
// ---------------------------------------------------------------------------

describe("RF-3 — equality candidate + open pending is invalid-state with zero writes (performAuditBegin seam)", () => {
	it("blocks {auditCycle:3, pending.dueCycle:3} + candidate 3 + Continue before any write", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({
			...freshState(root, feature),
			auditCycle: 3,
			checkLogAtCycleStart: 1,
			auditBaseSnapshot: { baseBranch: "main", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 0, status: "ok", authority: "explicit-base", observedAt: "2026-08-25T00:00:00.000Z" },
			auditEscalationPending: { feature, dueCycle: 3, scheduledCycle: 3, intervalCycles: 3, createdAt: "2026-08-25T00:00:00.000Z" },
		});
		for (let n = 0; n < 3; n++) writeAuditDoc(root, feature, n, "REJECT"); // candidate 3 === marker
		const bytes = readFileSync(craftStatePath(root, feature), "utf8");

		const result = performAuditBegin(feature, root, { escalationDisposition: "Continue auditing" });

		expect(result.isError).toBe(true);
		expect(result.details?.escalation?.status).toBe("invalid-state");
		expect(firstText(result)).toContain("auditCycle+1");
		// cycle / checkLogAtCycleStart / base snapshot / every ledger byte — unchanged.
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(bytes);
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditCycle).toBe(3);
		expect(persisted?.checkLogAtCycleStart).toBe(1);
		expect(persisted?.auditEscalations).toBeUndefined();
		expect(persisted?.auditBaseSnapshot?.baseBranch).toBe("main");
	});
});

// ---------------------------------------------------------------------------
// audit-0 RF-5 — re-registration (a bare lsc_craft_init resume) must preserve the persisted
// auditBaseSnapshot and releaseApproval, and a same-cycle replay afterwards must return THAT
// persisted snapshot (not undefined, not a freshly injected observation).
//
// audit-1 RF-19 strengthens the byte-equivalence half: the WHOLE persisted representation —
// not just the two named fields — must survive the re-registration exactly, compared as a
// canonical (key-sorted) serialization of the before/after file bytes so a merge-reordered key
// sequence can never mask a dropped, added, or mutated sibling field.
// ---------------------------------------------------------------------------

/** Deterministic key-sorted serialization — key-insertion-order differences never mask a value change. */
function canonicalJson(text: string): string {
	const sort = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(sort);
		if (typeof value === "object" && value !== null) {
			return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, item]) => [key, sort(item)]));
		}
		return value;
	};
	return JSON.stringify(sort(JSON.parse(text)));
}

describe("RF-5 — re-registration preserves auditBaseSnapshot; same-cycle replay returns the persisted snapshot", () => {
	afterEach(() => clearActiveCraft());

	it("a bare setActiveCraft keeps the whole persisted representation serialized-exact (releaseApproval and auditBaseSnapshot included), and replay serves the persisted base", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const snapshot = { baseBranch: "main", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" };
		const releaseApproval = { nonce: "n1", tag: "[Land]", question: "q", response: "yes", issuedAt: "2026-08-25T00:00:00.000Z" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: snapshot, releaseApproval });
		const bytesBefore = readFileSync(craftStatePath(root, feature), "utf8");

		setActiveCraft(freshState(root, feature)); // a bare re-registration carrying none of the fields

		const bytesAfter = readFileSync(craftStatePath(root, feature), "utf8");
		// audit-1 RF-19: serialized-representation EXACT comparison over the whole file —
		// stronger than the previous per-field .toEqual, which could not see sibling damage.
		expect(canonicalJson(bytesAfter)).toBe(canonicalJson(bytesBefore));
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditBaseSnapshot).toEqual(snapshot);
		expect(persisted?.releaseApproval).toEqual(releaseApproval);
		// audit-2 RF-27: the byte-axis pin — replay rewrites NOTHING, so the raw state bytes read
		// directly before the replay call must come back IDENTICALLY (not merely canonically
		// equal) after it. The canonical whole-file comparison above stays; this pins the
		// no-rewrite contract on the byte level a merge-reordered rewrite could never satisfy.
		const beforeReplayBytes = readFileSync(craftStatePath(root, feature), "utf8");
		const replay = performAuditBegin(feature, root); // candidate 0 === persisted auditCycle → replay
		expect(replay.isError).toBeFalsy();
		expect(replay.details?.auditCycle).toBe(0);
		expect(replay.details?.base).toEqual(snapshot);
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(beforeReplayBytes);
	});
});

// ---------------------------------------------------------------------------
// audit-0 RF-15① — anchorBaseSnapshot's three unknown-degradation branches, each observed
// through the public observeAuditBase seam: (1) an unresolvable SOURCE tip (sourceRoot not a
// git repo), (2) a failing behind-count (the source tip is a FOREIGN repo's OID, so
// `rev-list --count <foreign>..<base>` cannot resolve it in the project root), and (3) a
// non-integer count (scripted via the runGitText spy — real git always prints an integer).
// ---------------------------------------------------------------------------

describe("RF-15① — anchorBaseSnapshot unknown-degradation branches (source tip / rev-list / non-integer count)", () => {
	afterEach(() => {
		while (tempGitDirs.length > 0) {
			const dir = tempGitDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("an unresolvable source tip degrades to unknown with 'source tip unavailable'", async () => {
		const { root } = tmpDriftProject({ advanceBase: false });
		const notARepo = mkdtempSync(join(tmpdir(), "lsc-not-a-repo-"));
		tempGitDirs.push(notARepo);

		const snapshot = await observeAuditBase(root, notARepo, "main");

		expect(snapshot.status).toBe("unknown");
		expect(snapshot.sourceTip).toBe("");
		expect(snapshot.behindCount).toBe("unknown");
		expect(snapshot.error ?? "").toContain("source tip unavailable");
	});

	it("a foreign-repo source tip makes the behind-count unresolvable — 'behind-count unavailable', never a guess", async () => {
		const { root } = tmpDriftProject({ advanceBase: false });
		const foreignSource = mkdtempSync(join(tmpdir(), "lsc-foreign-repo-"));
		tempGitDirs.push(foreignSource);
		gitIn(foreignSource, ["init", "-q", "-b", "main"]);
		gitIn(foreignSource, ["config", "user.email", "t@t"]);
		gitIn(foreignSource, ["config", "user.name", "t"]);
		writeFileSync(join(foreignSource, "foreign.txt"), "x\n");
		gitIn(foreignSource, ["add", "-A"]);
		gitIn(foreignSource, ["commit", "-q", "-m", "foreign"]);
		const foreignTip = gitIn(foreignSource, ["rev-parse", "HEAD"]);

		const snapshot = await observeAuditBase(root, foreignSource, "main");

		expect(snapshot.status).toBe("unknown");
		expect(snapshot.sourceTip).toBe(foreignTip); // the source tip itself resolved...
		expect(snapshot.behindCount).toBe("unknown"); // ...but the count against it cannot
		expect(snapshot.error ?? "").toContain("behind-count unavailable");
	});

	it("a non-integer rev-list count degrades to unknown naming the raw output (runGitText spy)", async () => {
		const root = mkdtempSync(join(tmpdir(), "lsc-base-obs-mock-"));
		tempGitDirs.push(root);
		vi.mocked(runGitText)
			.mockResolvedValueOnce("a".repeat(40)) // base tip resolution
			.mockResolvedValueOnce("b".repeat(40)) // source tip resolution
			.mockResolvedValueOnce("banana"); // git rev-list --count output — not an integer

		const snapshot = await observeAuditBase(root, root, "main");

		expect(snapshot.status).toBe("unknown");
		expect(snapshot.behindCount).toBe("unknown");
		expect(snapshot.error ?? "").toContain('returned non-integer "banana"');
	});
});

// ---------------------------------------------------------------------------
// audit-0 RF-15② — describeAuditBase's unknown-status WARN wording, observed through
// performAuditBegin's success text: 'could not be measured' + the authority and base name.
// ---------------------------------------------------------------------------

describe("RF-15② — an unknown base snapshot surfaces the non-blocking 'could not be measured' WARN", () => {
	it("a below-cap begin with an unknown snapshot carries the WARN line, naming the authority and base", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));

		const result = performAuditBegin(feature, root, {
			baseSnapshot: { baseBranch: "no-such-branch", baseTip: "", sourceTip: "", behindCount: "unknown", status: "unknown", authority: "explicit-base", observedAt: "2026-08-25T00:00:00.000Z", error: "unresolvable ref" },
		});

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		const text = firstText(result);
		expect(text).toContain("WARN: audit base could not be measured");
		expect(text).toContain('explicit-base "no-such-branch"');
		expect(text).toContain("non-blocking");
	});
});

// ---------------------------------------------------------------------------
// audit-1 RF-20(a) — lsc_audit_begin's free-text params (base_branch / escalation_disposition)
// are refused for control characters BEFORE any effect or observation. The refusal must precede
// observeAuditBase (the registration wrapper's first git read), proven here through the
// production execute capture with the runGitText spy recording ZERO calls and no durable state
// written — the fail-closed / 무-effect / 무-raw-payload triple.
// ---------------------------------------------------------------------------

describe("RF-20(a) — lsc_audit_begin refuses control-carrying free-text params before any observation", () => {
	type BeginExecute = (id: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }>; details?: unknown }>;
	let savedFixtureEnv: string | undefined;
	beforeEach(() => {
		savedFixtureEnv = process.env.LSC_FIXTURE;
		delete process.env.LSC_FIXTURE;
	});
	afterEach(() => {
		if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
		else process.env.LSC_FIXTURE = savedFixtureEnv;
		clearActiveCraft();
	});

	function captureBeginExecute(): BeginExecute {
		let execute: BeginExecute | undefined;
		const pi = {
			zod,
			getFlag: (): undefined => undefined,
			registerTool(definition: unknown): void {
				if (typeof definition === "object" && definition !== null && "name" in definition && (definition as { name?: string }).name === "lsc_audit_begin" && "execute" in definition && typeof (definition as { execute?: unknown }).execute === "function") {
					execute = (definition as { execute: BeginExecute }).execute;
				}
			},
		};
		registerAuditValidateTools(pi as unknown as Parameters<typeof registerAuditValidateTools>[0]);
		if (!execute) throw new Error("lsc_audit_begin was not registered");
		return execute;
	}

	it("a control-carrying base_branch: refused, ZERO git observations, ZERO writes, no raw payload", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		const bytes = readFileSync(craftStatePath(root, feature), "utf8");
		const execute = captureBeginExecute();
		vi.mocked(runGitText).mockClear();

		const result = await execute("t", { feature_dir: feature, base_branch: "main\n--upload-pack=evil" }, undefined, undefined, { cwd: root });

		expect(result.isError).toBe(true);
		const text = firstText(result);
		expect(text).toContain("control characters");
		expect(text).toContain("base_branch"); // names the field, never the payload
		expect(text).not.toMatch(/[\u0000-\u001f\u007f]/); // 무-raw-payload: single-line refusal
		expect(vi.mocked(runGitText), "observeAuditBase must not have run (RF-20(a): guard precedes observation)").not.toHaveBeenCalled();
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(bytes); // 무-effect
	});

	it("a control-carrying escalation_disposition: same pre-observation refusal", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		const bytes = readFileSync(craftStatePath(root, feature), "utf8");
		const execute = captureBeginExecute();
		vi.mocked(runGitText).mockClear();

		const result = await execute("t", { feature_dir: feature, escalation_disposition: "Continue auditing\t[ok]" }, undefined, undefined, { cwd: root });

		expect(result.isError).toBe(true);
		const text = firstText(result);
		expect(text).toContain("escalation_disposition");
		expect(text).toContain("control characters");
		expect(vi.mocked(runGitText)).not.toHaveBeenCalled();
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(bytes);
	});

	it("clean single-line values still pass the guard (the validator is not a blanket refusal)", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		const execute = captureBeginExecute();
		vi.mocked(runGitText).mockClear();

		const result = await execute("t", { feature_dir: feature, base_branch: "main" }, undefined, undefined, { cwd: root });

		expect(result.isError, JSON.stringify(result)).toBeFalsy(); // proceeds to begin cycle 1 (replay)
		expect(vi.mocked(runGitText).mock.calls.length).toBeGreaterThan(0); // observation DID run
	});
});

// ---------------------------------------------------------------------------
// audit-2 RF-25 — lsc_audit_begin's registration wrapper: the resolved feature must clear the
// shared slug boundary (FEATURE_SLUG_RE, audit-0 RF-13's SSOT) BEFORE the wrapper's own effects
// — detectFixturePath (env/flag reads), resolveAuditRoot (fs), and observeAuditBase (git argv).
// The core's guard (performAuditBegin:396) is NOT enough: the wrapper observes git and resolves
// roots BEFORE the core ever runs. Proven through the production execute capture with the
// runGitText spy recording ZERO calls and no durable state write.
// ---------------------------------------------------------------------------

describe("RF-25 — lsc_audit_begin refuses a non-slug resolved feature before ANY wrapper observation", () => {
	type BeginExecute = (id: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string }) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }>; details?: unknown }>;
	let savedFixtureEnv: string | undefined;
	beforeEach(() => {
		savedFixtureEnv = process.env.LSC_FIXTURE;
		delete process.env.LSC_FIXTURE;
	});
	afterEach(() => {
		if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
		else process.env.LSC_FIXTURE = savedFixtureEnv;
		clearActiveCraft();
	});

	function captureBeginExecute(): BeginExecute {
		let execute: BeginExecute | undefined;
		const pi = {
			zod,
			getFlag: (): undefined => undefined,
			registerTool(definition: unknown): void {
				if (typeof definition === "object" && definition !== null && "name" in definition && (definition as { name?: string }).name === "lsc_audit_begin" && "execute" in definition && typeof (definition as { execute?: unknown }).execute === "function") {
					execute = (definition as { execute: BeginExecute }).execute;
				}
			},
		};
		registerAuditValidateTools(pi as unknown as Parameters<typeof registerAuditValidateTools>[0]);
		if (!execute) throw new Error("lsc_audit_begin was not registered");
		return execute;
	}

	it("an invalid resolved feature: ZERO git observations, ZERO durable writes, escaped echo only", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		const bytes = readFileSync(craftStatePath(root, feature), "utf8");
		const execute = captureBeginExecute();
		vi.mocked(runGitText).mockClear();

		const result = await execute("t", { feature_dir: "bad\nfeature" }, undefined, undefined, { cwd: root });

		expect(result.isError).toBe(true);
		const text = firstText(result);
		expect(text).toContain("kebab-case slug");
		expect(text).not.toMatch(/[\u0000-\u001f\u007f]/); // escaped echo — never the raw payload
		expect(vi.mocked(runGitText), "observeAuditBase must not have run (RF-25: the slug guard precedes the wrapper's git observation)").not.toHaveBeenCalled();
		expect(readFileSync(craftStatePath(root, feature), "utf8")).toBe(bytes); // 무-effect
	});

	it("a valid slug still reaches the observation and the core (the guard is not a blanket refusal)", async () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 1 });
		writeAuditDoc(root, feature, 0, "REJECT");
		const execute = captureBeginExecute();
		vi.mocked(runGitText).mockClear();

		const result = await execute("t", { feature_dir: feature }, undefined, undefined, { cwd: root });

		expect(result.isError, JSON.stringify(result)).toBeFalsy(); // replay of cycle 1
		expect(vi.mocked(runGitText).mock.calls.length).toBeGreaterThan(0); // observation DID run
	});
});

// ---------------------------------------------------------------------------
// audit-2 RF-26 — a persisted auditBaseSnapshot that fails canonical parsing
// (parseAuditBaseSnapshot) is never interpolated on the same-cycle replay: constant
// invalid-state diagnostic, no raw record in text OR details, state bytes untouched.
// ---------------------------------------------------------------------------

describe("RF-26 — a non-canonical persisted auditBaseSnapshot is never interpolated on replay", () => {
	afterEach(() => clearActiveCraft());

	it("newline-bearing snapshot seed → strict re-registration → same-cycle replay: bytes stable, no raw payload, constant invalid-state line", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const forged = { baseBranch: "main\nlets-craft: forged", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: forged });

		setActiveCraft(freshState(root, feature)); // a bare re-registration (lsc_craft_init resume shape)
		const statePath = craftStatePath(root, feature);
		const bytesBeforeReplay = readFileSync(statePath, "utf8");

		const replay = performAuditBegin(feature, root);

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy(); // replay still succeeds — non-blocking evidence
		const text = firstText(replay);
		expect(text).toContain("idempotent replay");
		expect(text).toContain("invalid-state"); // the constant diagnostic names the class...
		expect(text).not.toContain("forged"); // ...and carries no byte of the raw record
		expect(text).not.toMatch(/[\u0000-\u001f\u007f]/); // 무-raw-payload: single-line result
		expect(replay.details?.base).toBeUndefined(); // the raw record never reaches the payload either
		expect(readFileSync(statePath, "utf8")).toBe(bytesBeforeReplay); // state bytes 불변 across the replay
	});

	// audit-3 RF-32: the ok↔OID coupling — `{status:"ok", baseTip:"", sourceTip:"", behindCount:0}`
	// used to pass canonical parsing and replay as "0 behind (in sync)" evidence without a single
	// OID. The parser now rejects it ("" is the unknown branch's marker only), so the replay
	// serves the constant invalid-state line, suppresses details.base, and rewrites nothing.
	it("an ok snapshot with empty tips is refused by the parser — constant invalid-state, no 'in sync' replay, bytes stable (RF-32)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const forged = { baseBranch: "main", baseTip: "", sourceTip: "", behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: forged });
		const statePath = craftStatePath(root, feature);
		const bytesBeforeReplay = readFileSync(statePath, "utf8");

		const replay = performAuditBegin(feature, root); // candidate 0 === persisted 0 → replay

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy(); // replay still succeeds — non-blocking evidence
		const text = firstText(replay);
		expect(text).toContain("idempotent replay");
		expect(text).toContain("invalid-state"); // the constant diagnostic names the class
		expect(text).not.toContain("in sync"); // the forged "0 behind" evidence is NOT reproduced
		expect(replay.details?.base).toBeUndefined(); // details suppressed
		expect(readFileSync(statePath, "utf8")).toBe(bytesBeforeReplay); // state bytes 불변 across the replay
	});

	it.each([
		["ok with an empty baseTip only (sourceTip measured)", { baseTip: "", sourceTip: "b".repeat(40) }],
		["ok with an empty sourceTip only (baseTip measured)", { baseTip: "a".repeat(40), sourceTip: "" }],
	])("%s — replay constant invalid-state, details suppressed, bytes stable (RF-32 각각)", (_name, tips) => {
		const root = tmpProject();
		const feature = "my-feature";
		const forged = { baseBranch: "main", behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z", ...tips };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: forged });
		const statePath = craftStatePath(root, feature);
		const bytesBeforeReplay = readFileSync(statePath, "utf8");

		const replay = performAuditBegin(feature, root);

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy();
		const text = firstText(replay);
		expect(text).toContain("idempotent replay");
		expect(text).toContain("invalid-state");
		expect(text).not.toContain("in sync");
		expect(replay.details?.base).toBeUndefined();
		expect(readFileSync(statePath, "utf8")).toBe(bytesBeforeReplay);
	});

	// audit-4 RF-36: the two producer-impossible couplings (parseAuditBaseSnapshot's accepted-
	// shape table) must be refused on replay exactly like the RF-32 empty-tip forgeries — the
	// forged drift/unknown prose is NOT reproduced, details.base stays suppressed, state bytes
	// are untouched. Same it.each axis pattern as the RF-32 block above.
	it.each([
		[
			"ok with equal tips and a nonzero behindCount (false drift — rev-list X..X is always 0)",
			{ baseBranch: "main", baseTip: "a".repeat(40), sourceTip: "a".repeat(40), behindCount: 5, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" },
			"base drift",
		],
		[
			"unknown with an empty baseTip but a measured sourceTip (inverse partial — base resolves first)",
			{ baseBranch: "main", baseTip: "", sourceTip: "b".repeat(40), behindCount: "unknown", status: "unknown" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z", error: "behind-count unavailable" },
			"could not be measured",
		],
	])("%s — replay constant invalid-state, details suppressed, bytes stable (RF-36)", (_name, forged, notReproduced) => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: forged });
		const statePath = craftStatePath(root, feature);
		const bytesBeforeReplay = readFileSync(statePath, "utf8");

		const replay = performAuditBegin(feature, root);

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy();
		const text = firstText(replay);
		expect(text).toContain("idempotent replay");
		expect(text).toContain("invalid-state");
		expect(text).not.toContain(notReproduced); // the forged prose is NOT reproduced as canonical evidence
		expect(replay.details?.base).toBeUndefined(); // details suppressed
		expect(readFileSync(statePath, "utf8")).toBe(bytesBeforeReplay); // state bytes 불변 across the replay
	});

	it("a CANONICAL persisted snapshot still describes on replay (the parser is not a blanket suppression)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const snapshot = { baseBranch: "main", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: snapshot });

		const replay = performAuditBegin(feature, root);

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy();
		expect(firstText(replay)).toContain("Base authority: explicit-base");
		expect(replay.details?.base).toEqual(snapshot);
	});
});

// ---------------------------------------------------------------------------
// audit-3 RF-34 — describeAuditBase's baseBranch/error interpolation: parseAuditBaseSnapshot
// guarantees only C0/DEL freedom, so a CANONICAL-parsing snapshot can still carry
// C1/U+2028/U+2029 through to the replay's base line. Those axes must surface ONLY through
// the total escaped serializer — escaped containment, never a raw reshaping character.
// ---------------------------------------------------------------------------

describe("RF-34 — a C1/separator-carrying base snapshot is described ESCAPED on replay (never raw)", () => {
	afterEach(() => clearActiveCraft());

	it("a canonical-parsing ok snapshot with U+2028 in baseBranch replays with the escaped echo only", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const snapshot = { baseBranch: "main\u2028lets-craft: forged", baseTip: "a".repeat(40), sourceTip: "b".repeat(40), behindCount: 0, status: "ok" as const, authority: "explicit-base" as const, observedAt: "2026-08-25T00:00:00.000Z" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: snapshot });

		const replay = performAuditBegin(feature, root); // candidate 0 === persisted 0 → replay

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy(); // the parser ACCEPTS it (C0/DEL-free) — the echo must be safe, not the parse
		const text = firstText(replay);
		expect(text).toContain("0 behind (in sync)");
		expect(text).toContain("\\u2028"); // the payload's only echo is the escaped form
		expect(text).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/);
		expect(replay.details?.base).toEqual(snapshot); // structured details keep the parsed record; the TEXT is the escaped surface
	});

	it("an unknown snapshot's error axis (C1 NEL) is escaped the same way", () => {
		const root = tmpProject();
		const feature = "my-feature";
		const snapshot = { baseBranch: "main", baseTip: "", sourceTip: "", behindCount: "unknown", status: "unknown" as const, authority: "legacy-current-branch" as const, observedAt: "2026-08-25T00:00:00.000Z", error: "behind-count unavailable: rev-list failed\u0085lets-craft: forged" };
		persistOnly({ ...freshState(root, feature), auditCycle: 0, auditBaseSnapshot: snapshot });

		const replay = performAuditBegin(feature, root);

		expect(replay.isError, JSON.stringify(replay)).toBeFalsy();
		const text = firstText(replay);
		expect(text).toContain("could not be measured");
		expect(text).toContain("\\u0085");
		expect(text).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029]/);
	});
});
