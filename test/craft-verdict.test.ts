import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { craftAuditDir, craftStatePath, craftTestLogsDir } from "../src/artifacts/paths";
import { type CraftState, clearActiveCraft, readPersistedCraftState, setActiveCraft } from "../src/craft/state";
import {
	AUDIT_VERDICTS,
	CRITIC_VERDICTS,
	isPassingRunLog,
	parseAuditVerdict,
	parseCriticVerdict,
	parseVerdictLine,
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

// ---------------------------------------------------------------------------
// B-1 review NEEDS-FIX MEDIUM: tool-execute-level integration coverage for performAuditBegin /
// performAuditValidate against real temp directories — no ExtensionAPI/pi.zod mocking needed
// since both are the extracted "performX" cores the registerTool wrappers call directly (mirrors
// run-tests.ts's own tool-level test pattern added alongside this fix).
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
	return ["$ bash run_test.sh", "--- stdout ---", "ok", "--- stderr ---", "", "--- exit 0 ---"].join("\n");
}

function failingLog(code = 1): string {
	return ["$ bash run_test.sh", "--- stdout ---", "", "--- stderr ---", "boom", `--- exit ${code} ---`].join("\n");
}

function writeRunLog(root: string, feature: string, n: number, content: string): void {
	const dir = craftTestLogsDir(root, feature);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `run-${n}.log`), content);
}

describe("performAuditBegin (tool-execute-level)", () => {
	it("fails closed (isError) when no persisted craft state exists at all", () => {
		const root = tmpProject();
		const result = performAuditBegin("never-crafted", root);
		expect(result.isError).toBe(true);
	});

	it("records auditCycle (audit dir max+1) and runLogAtCycleStart (logs dir max) onto the persisted state", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeRunLog(root, feature, 1, passingLog());
		writeRunLog(root, feature, 2, failingLog());
		writeAuditDoc(root, feature, 0, "APPROVE-WITH-CHANGE");

		const result = performAuditBegin(feature, root);

		expect(result.isError).toBeFalsy();
		expect(result.details).toEqual({ feature, auditCycle: 1, runLogAtCycleStart: 2 });
		expect(readPersistedCraftState(root, feature)?.auditCycle).toBe(1);
		expect(readPersistedCraftState(root, feature)?.runLogAtCycleStart).toBe(2);
	});

	it("uses auditCycle 0 and runLogAtCycleStart 0 when neither an audit doc nor a run log exists yet", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));

		const result = performAuditBegin(feature, root);

		expect(result.details).toEqual({ feature, auditCycle: 0, runLogAtCycleStart: 0 });
	});
});

describe("performAuditValidate (tool-execute-level, 4 branches + mismatch guard)", () => {
	it("succeeds for an APPROVE-family verdict backed by a fresh passing run-N.log, and records the auditValidated marker", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeRunLog(root, feature, 1, passingLog()); // pre-cycle (stale)
		performAuditBegin(feature, root); // auditCycle=0, runLogAtCycleStart=1
		writeRunLog(root, feature, 2, passingLog()); // fresh, after the cycle start
		writeAuditDoc(root, feature, 0, "APPROVE");

		const result = performAuditValidate(feature, root);

		expect(result.isError, JSON.stringify(result)).toBeFalsy();
		expect(result.details).toEqual({ feature, auditNumber: 0, verdict: "APPROVE", freshness: { ok: true } });
		const persisted = readPersistedCraftState(root, feature);
		expect(persisted?.auditValidated).toEqual({ cycle: 0, verdict: "APPROVE", at: expect.any(String) });
	});

	it("fails closed with 'stale-log' when no run-N.log exists after the cycle's freshness threshold", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		writeRunLog(root, feature, 1, passingLog());
		performAuditBegin(feature, root); // runLogAtCycleStart=1 — nothing fresher gets written below
		writeAuditDoc(root, feature, 0, "APPROVE");

		const result = performAuditValidate(feature, root);

		expect(result.isError).toBe(true);
		expect((result.content[0] as { text: string }).text).toContain("cannot be backed by a fresh run");
	});

	it("fails closed with 'no-passing-log' when fresh run-N.log(s) exist but none passed", () => {
		const root = tmpProject();
		const feature = "my-feature";
		persistOnly(freshState(root, feature));
		performAuditBegin(feature, root); // runLogAtCycleStart=0
		writeRunLog(root, feature, 1, failingLog());
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
		writeRunLog(root, feature, 1, passingLog());
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
