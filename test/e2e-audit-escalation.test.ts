// PR-5 (postcraft-14cycle-approval-failure) — AC1/AC2/AC8: the fixture-interval
// [Audit Escalation] gate, driven through a REAL post-craft subprocess per
// disposition. Each case seeds a complete already-crafted feature (two REJECT
// audit docs → candidate 2 — the fixture interval's first due cycle) and lets
// the actual skill hit `lsc_audit_begin`'s fail-closed gate, answer it through
// the fixture-scripted `lsc_select`, and consume it through the real tool.
//
// Continue ends EARLY, at the existing earlyExit seam, the moment plan.md:411's
// exact predicate holds — `total lsc_audit_begin executions = 2 ∧ ordered
// [isError, success] ∧ last.isError = false` (audit-0 RF-7 fixed the ordered
// tuple via auditBeginOutcomes) — so the gate trace (pending → select →
// decision → next-due mirror) is observed without waiting for any of §3's
// audit work. Abort/Preserve observe the durable terminal record and assert
// the absence set: no new audit cycle, no land, no cleanup, branch+worktree
// preserved. Abort additionally WAITS for the lsc_craft_abort delegation's
// result marker as a mandatory condition (RF-7) and asserts aborted=true
// unconditionally; a run that never reaches the delegation times out and
// fails. `aborted: true` is still reported as ORCHESTRATION compliance
// evidence (the skill delegating to lsc_craft_abort), not as the safety
// property itself — the terminal disposition's begin/land refusal is already
// proven fail-closed by the PR-1/PR-2 unit suites.
//
// Gated behind LSC_E2E=1 — spends real tokens; `npm run e2e` runs this file.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AUDIT_BEGIN_ANY_MARKER,
	AUDIT_CYCLE_BEGUN_MARKER,
	AUDIT_ESCALATION_CONSUMED_MARKER,
	AUDIT_ESCALATION_REQUIRED_MARKER,
	AUDIT_TERMINAL_MARKER,
	CRAFT_ABORTED_MARKER,
	E2E_MAIN_MODEL,
	type AuditEscalationLabel,
	type OmpRunResult,
	auditBeginOutcomes,
	debugSummary,
	readCraftStateFile,
	runOmpPrint,
	seedCraftedFeature,
	setupFixtureProject,
	lastToolResultWith,
	streamMarkerCount,
	streamTextEarlyExit,
	writeEscalationAnswersVariant,
} from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

const FIXTURE_NOTE =
	"Every question you would ask a human must go through lsc_ask/lsc_select/lsc_confirm as usual — LSC_FIXTURE is " +
	"already configured with scripted answers, so just call those tools normally and use whatever they return; do not " +
	"address me directly and do not wait for a reply outside those tools.";

// The gate fires at §2.4, before any §3 work, so these runs are short — the kill
// budget only has to cover skill loading, §2's checks, and the gate roundtrip.
const GATE_RUN_TIMEOUT_MS = 15 * 60_000;
const TEST_TIMEOUT_MS = 20 * 60_000;

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

interface TerminalDecisionRecord {
	disposition: string;
	dueCycle: number;
	scheduledCycle: number;
	intervalCycles: number;
}

/** Shared per-disposition driver: seed → pre-state assert → run post-craft → hand back observations. */
async function runEscalationBranch(
	disposition: AuditEscalationLabel,
	earlyExit: (stdout: string) => boolean,
): Promise<{
	projectDir: string;
	worktreeRoot: string;
	feature: string;
	result: OmpRunResult;
}> {
	const { base, projectDir, fixtureDir, sessionDir } = setupFixtureProject();
	cleanupDirs.push(base);
	const feature = "escalation-gate";
	const { worktreeRoot } = seedCraftedFeature(projectDir, feature, { seededAudits: 2 });
	const answersPath = writeEscalationAnswersVariant(fixtureDir, disposition === "Continue auditing" ? "continue" : disposition === "Abort this craft" ? "abort" : "preserve", disposition);

	// Pre-state: the seeded (cap-unconsumed) state is at cycle 1 with NO escalation evidence —
	// candidate 2 is what the fixture interval gates.
	const before = readCraftStateFile(worktreeRoot, feature);
	expect(before?.auditCycle).toBe(1);
	expect(before?.auditEscalationPending).toBeUndefined();

	const result = await runOmpPrint({
		cwd: projectDir,
		sessionDir,
		model: E2E_MAIN_MODEL,
		env: { LSC_FIXTURE: answersPath },
		timeoutMs: GATE_RUN_TIMEOUT_MS,
		earlyExit,
		prompt: `/skill:post-craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
	});
	return { projectDir, worktreeRoot, feature, result };
}

describe.skipIf(!RUN_E2E)("PR-5 E2E — fixture cap-2 [Audit Escalation] dispositions (real post-craft subprocess)", () => {
	it(
		"Continue auditing: the second lsc_audit_begin call succeeds (2 total, first isError) and the durable Continue/next-due state is observable",
		async () => {
			// plan.md:411's predicate as an ORDERED tuple over COMPLETED executions (RF-7):
			// exit only when exactly 2 lsc_audit_begin executions exist, ordered
			// [isError (the gate refusal), success (the consume)]. Not the consumed-marker
			// substring — that could fire before the count/order was knowable, and the old
			// final assertion tolerated isError re-issues with a >= 2 count check.
			const earlyExit = (stdout: string) => {
				const outcomes = auditBeginOutcomes(stdout);
				return outcomes.length === 2 && outcomes[0] === true && outcomes[1] === false;
			};
			const { worktreeRoot, feature, result } = await runEscalationBranch("Continue auditing", earlyExit);
			expect(result.timedOut, `escalation-Continue run timed out.\n${debugSummary(result)}`).toBe(false);

			// lsc plugin tools stream under a generic toolName (see e2e-helpers' marker note), so
			// the execution evidence comes from the TS-authored result-text markers in the raw
			// stream. The contract shape is plan.md:411's EXACT predicate: total completed begin
			// executions === 2, ordered [isError, success] — the first call is the gate refusal,
			// the second (and LAST) is the consume success. An isError re-issue, a third
			// execution, or a success-first ordering all fail here (audit-0 RF-7).
			const outcomes = auditBeginOutcomes(result);
			expect(
				outcomes,
				`expected exactly 2 lsc_audit_begin executions ordered [isError, success], saw [${outcomes.map(String).join(", ")}].\n${debugSummary(result)}`,
			).toEqual([true, false]);
			expect(streamMarkerCount(result, AUDIT_ESCALATION_REQUIRED_MARKER), "the ONE gate-opening begin call must be the isError escalation-required result").toBe(1);
			expect(streamMarkerCount(result, AUDIT_CYCLE_BEGUN_MARKER(2)), "the consuming begin call must succeed exactly once with cycle 2").toBe(1);
			expect(streamMarkerCount(result, AUDIT_ESCALATION_CONSUMED_MARKER), "exactly one successful consume-continue execution").toBe(1);
			expect(
				lastToolResultWith(result, AUDIT_BEGIN_ANY_MARKER)?.includes(AUDIT_CYCLE_BEGUN_MARKER(2)),
				"the LAST lsc_audit_begin execution must be the success (no error re-issue after the consume)",
			).toBe(true);

			const state = readCraftStateFile(worktreeRoot, feature);
			const decisions = (state?.auditEscalations ?? []) as Array<{ disposition?: string; dueCycle?: number; nextDueCycle?: number; intervalCycles?: number }>;
			expect(state?.auditCycle, "the consumed gate must have issued audit cycle 2").toBe(2);
			expect(state?.auditEscalationPending, "no pending may survive the consumed gate").toBeUndefined();
			expect(decisions.length).toBeGreaterThanOrEqual(1);
			expect(decisions[decisions.length - 1]?.disposition).toBe("Continue auditing");
			expect(state?.nextAuditEscalationCycle, "fixture interval 2: Continue at due 2 schedules the next gate at cycle 4").toBe(4);
			// Early exit preserved the gate trace: no audit work started.
			expect(existsSync(join(worktreeRoot, ".lsc", "crafts", feature, "audit", "audit-2.md")), "audit-2.md must not exist yet (killed at the consume)").toBe(false);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"Abort this craft: the terminal disposition is durable, no audit/land/cleanup runs, and the branch+worktree survive",
		async () => {
			// audit-0 RF-7: the lsc_craft_abort delegation is a MANDATORY wait condition —
			// kill only once BOTH the terminal record and the delegation's result text have
			// streamed back. A run that never reaches the delegation hits the harness timeout
			// and fails the timedOut assertion below: no grace window, no soft pass.
			const earlyExit = (stdout: string) => stdout.includes(AUDIT_TERMINAL_MARKER()) && stdout.includes(CRAFT_ABORTED_MARKER);
			const { projectDir, worktreeRoot, feature, result } = await runEscalationBranch("Abort this craft", earlyExit);
			expect(result.timedOut, `escalation-Abort run timed out.\n${debugSummary(result)}`).toBe(false);

			const state = readCraftStateFile(worktreeRoot, feature);
			const terminal = state?.auditTerminalDisposition as TerminalDecisionRecord | undefined;
			expect(terminal?.disposition, "the durable terminal record must name the exact disposition").toBe("Abort this craft");
			expect(state?.auditCycle, "a terminal disposition must NOT issue a cycle (marker stays at 1)").toBe(1);
			expect(state?.auditEscalationPending).toBeUndefined();
			expect(existsSync(join(worktreeRoot, ".lsc", "crafts", feature, "audit", "audit-2.md")), "no audit-2.md may appear after a terminal disposition").toBe(false);

			// Absence set: no land, no cleanup — branch and worktree survive.
			expect(existsSync(worktreeRoot), "the worktree must survive an Abort disposition").toBe(true);
			const branchList = execFileSync("git", ["branch", "--list", `lets-craft/${feature}`], { cwd: projectDir, encoding: "utf8" });
			expect(branchList.includes(`lets-craft/${feature}`), "the implementation branch must survive an Abort disposition").toBe(true);
			// lsc_land's every result starts "lsc_land: " — its absence in the stream means no land
			// call ran (a merge would additionally move the base branch, asserted via the files).
			expect(result.stdout.includes("lsc_land: "), "no lsc_land call may run after a terminal disposition").toBe(false);

			// aborted=true is ORCHESTRATION compliance evidence (the skill delegated to the abort
			// tool), deliberately reported separately from the safety property itself — the
			// terminal-disposition refusal of begin/land is proven by the PR-1/PR-2 unit suites.
			// Both facts are now UNCONDITIONAL (audit-0 RF-7): the delegation marker must have
			// been observed before the kill, and it must have left aborted=true.
			expect(
				result.stdout.includes(CRAFT_ABORTED_MARKER),
				"the skill must delegate to lsc_craft_abort after a terminal Abort disposition — a run killed without the delegation fails here",
			).toBe(true);
			expect(state?.aborted, "the observed lsc_craft_abort delegation must leave aborted=true").toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"Preserve branch and stop: the terminal disposition is durable, nothing is aborted/merged/cleaned, branch+worktree survive",
		async () => {
			const { projectDir, worktreeRoot, feature, result } = await runEscalationBranch(
				"Preserve branch and stop",
				streamTextEarlyExit(AUDIT_TERMINAL_MARKER()),
			);
			expect(result.timedOut, `escalation-Preserve run timed out.\n${debugSummary(result)}`).toBe(false);

			const state = readCraftStateFile(worktreeRoot, feature);
			const terminal = state?.auditTerminalDisposition as TerminalDecisionRecord | undefined;
			expect(terminal?.disposition).toBe("Preserve branch and stop");
			expect(state?.auditCycle, "Preserve issues no cycle").toBe(1);
			expect(state?.aborted, "Preserve must NOT mark the craft aborted — it preserves, it does not abort").not.toBe(true);
			expect(existsSync(join(worktreeRoot, ".lsc", "crafts", feature, "audit", "audit-2.md"))).toBe(false);
			expect(existsSync(worktreeRoot), "the worktree must survive a Preserve disposition").toBe(true);
			const branchList = execFileSync("git", ["branch", "--list", `lets-craft/${feature}`], { cwd: projectDir, encoding: "utf8" });
			expect(branchList.includes(`lets-craft/${feature}`), "the implementation branch must survive a Preserve disposition").toBe(true);
			expect(result.stdout.includes("lsc_land: "), "no lsc_land call may run").toBe(false);
		},
		TEST_TIMEOUT_MS,
	);
});
