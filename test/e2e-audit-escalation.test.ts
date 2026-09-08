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
// audit-4 RF-41(b): every earlyExit predicate here is now DURABLE-first — the
// kill condition reads `.craft-state.json` (auditCycle/pending/terminal
// record/aborted) behind a cheap stream precondition plus a ≥1s
// durableProbeThrottle; the exact Continue execution count/order remains the
// one stream-only axis (the state proves the net effect but cannot count
// executions — see each predicate's comment for which axis stayed and why).
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
	CRAFT_ABORTED_MARKER,
	E2E_MAIN_MODEL,
	type AuditEscalationLabel,
	type OmpRunResult,
	auditBeginOutcomes,
	debugSummary,
	durableProbeThrottle,
	readCraftStateFile,
	runOmpPrint,
	seedCraftedFeature,
	setupFixtureProject,
	lastToolResultWith,
	streamMarkerCount,
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

/** Shared per-disposition driver: seed → pre-state assert → run post-craft → hand back observations. `buildEarlyExit` receives the seeded roots so its predicate can read DURABLE state (audit-4 RF-41(b)) — the seeding happens inside, so a plain `(stdout) => boolean` cannot see them. */
async function runEscalationBranch(
	disposition: AuditEscalationLabel,
	buildEarlyExit: (roots: { worktreeRoot: string; feature: string; sessionDir: string }) => (stdout: string) => boolean,
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
		earlyExit: buildEarlyExit({ worktreeRoot, feature, sessionDir }),
		prompt: `/skill:post-craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
	});
	return { projectDir, worktreeRoot, feature, result };
}
describe.skipIf(!RUN_E2E)("PR-5 E2E — fixture cap-2 [Audit Escalation] dispositions (real post-craft subprocess)", () => {
	it(
		"Continue auditing: the second lsc_audit_begin call succeeds (2 total, first isError) and the durable Continue/next-due state is observable",
		async () => {
			// audit-4 RF-41(b) — DURABLE-first kill predicate. The authority is the persisted
			// `.craft-state.json`: auditCycle===2 ∧ no pending gate is the net effect of the
			// whole Continue roundtrip (interval gate fired → refusal left pending → fixture
			// select recorded the Continue decision → the second begin CONSUMED it and issued
			// cycle 2 — cycle 2 is unreachable through this gate any other way). The cheap
			// stream precondition (a begin result streamed) plus the ≥1s throttle keep the fs
			// reads off the per-chunk path. ONE axis stays on the stream, deliberately:
			// the EXACT execution count/order (exactly 2, ordered [isError, success]) —
			// the durable state proves the net effect but cannot COUNT executions, and a
			// third call or an isError re-issue after the consume is only observable there.
			const buildEarlyExit = ({ worktreeRoot, feature }: { worktreeRoot: string; feature: string; sessionDir: string }) => {
				const due = durableProbeThrottle(1000);
				return (stdout: string) => {
					if (!stdout.includes(AUDIT_BEGIN_ANY_MARKER)) return false;
					if (!due()) return false;
					const state = readCraftStateFile(worktreeRoot, feature);
					if (state?.auditCycle !== 2 || state.auditEscalationPending !== undefined) return false;
					const outcomes = auditBeginOutcomes(stdout);
					return outcomes.length === 2 && outcomes[0] === true && outcomes[1] === false;
				};
			};
			const { worktreeRoot, feature, result } = await runEscalationBranch("Continue auditing", buildEarlyExit);
			expect(result.timedOut, `escalation-Continue run timed out.\n${debugSummary(result)}`).toBe(false);

			// DURABLE authority first (audit-4 RF-41(b)): the consumed-gate state IS the
			// contract's observable — cycle 2 issued, no pending, the Continue decision and
			// next-due schedule recorded, and no audit-2.md work started before the kill.
			const state = readCraftStateFile(worktreeRoot, feature);
			const decisions = (state?.auditEscalations ?? []) as Array<{ disposition?: string; dueCycle?: number; nextDueCycle?: number; intervalCycles?: number }>;
			expect(state?.auditCycle, "the consumed gate must have issued audit cycle 2 (durable authority)").toBe(2);
			expect(state?.auditEscalationPending, "no pending may survive the consumed gate (durable authority)").toBeUndefined();
			expect(decisions.length).toBeGreaterThanOrEqual(1);
			expect(decisions[decisions.length - 1]?.disposition).toBe("Continue auditing");
			expect(state?.nextAuditEscalationCycle, "fixture interval 2: Continue at due 2 schedules the next gate at cycle 4 (durable authority)").toBe(4);
			// Early exit preserved the gate trace: no audit work started.
			expect(existsSync(join(worktreeRoot, ".lsc", "crafts", feature, "audit", "audit-2.md")), "audit-2.md must not exist yet (killed at the consume)").toBe(false);

			// Stream axis, CORROBORATIVE (kept: exact count/order is not expressible in the
			// durable state — see the earlyExit comment). lsc plugin tools stream under a
			// generic toolName (see e2e-helpers' marker note), so the execution evidence here
			// comes from the TS-authored result-text markers. The contract shape is
			// plan.md:411's EXACT predicate: total completed begin executions === 2, ordered
			// [isError, success] — the first call is the gate refusal, the second (and LAST)
			// is the consume success. An isError re-issue, a third execution, or a
			// success-first ordering all fail here (audit-0 RF-7).
			const outcomes = auditBeginOutcomes(result);
			expect(
				outcomes,
				`expected exactly 2 lsc_audit_begin executions ordered [isError, success], saw [${outcomes.map(String).join(", ")}] (corroborative to the durable state above).\n${debugSummary(result)}`,
			).toEqual([true, false]);
			expect(streamMarkerCount(result, AUDIT_ESCALATION_REQUIRED_MARKER), "the ONE gate-opening begin call must be the isError escalation-required result (corroborative)").toBe(1);
			expect(streamMarkerCount(result, AUDIT_CYCLE_BEGUN_MARKER(2)), "the consuming begin call must succeed exactly once with cycle 2 (corroborative)").toBe(1);
			expect(streamMarkerCount(result, AUDIT_ESCALATION_CONSUMED_MARKER), "exactly one successful consume-continue execution (corroborative)").toBe(1);
			expect(
				lastToolResultWith(result, AUDIT_BEGIN_ANY_MARKER)?.includes(AUDIT_CYCLE_BEGUN_MARKER(2)),
				"the LAST lsc_audit_begin execution must be the success (no error re-issue after the consume) (corroborative)",
			).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);


	it(
		"Abort this craft: the terminal disposition is durable, no audit/land/cleanup runs, and the branch+worktree survive",
		async () => {
			// audit-0 RF-7 / audit-4 RF-41(b): the lsc_craft_abort delegation is a MANDATORY
			// wait condition, now observed DURABLY — kill only once the terminal record names
			// Abort AND the delegation has left aborted=true in the same persisted state (a
			// strictly stronger observation than the retired stream-marker conjunction: the
			// same tool writes both, and a file cannot be truncated out of the buffer). A run
			// that never reaches the delegation hits the harness timeout and fails the timedOut
			// assertion below: no grace window, no soft pass.
			const buildEarlyExit = ({ worktreeRoot, feature }: { worktreeRoot: string; feature: string; sessionDir: string }) => {
				const due = durableProbeThrottle(1000);
				return (stdout: string) => {
					if (!stdout.includes(AUDIT_BEGIN_ANY_MARKER)) return false;
					if (!due()) return false;
					const state = readCraftStateFile(worktreeRoot, feature);
					const terminal = state?.auditTerminalDisposition as { disposition?: string } | undefined;
					return terminal?.disposition === "Abort this craft" && state?.aborted === true;
				};
			};
			const { projectDir, worktreeRoot, feature, result } = await runEscalationBranch("Abort this craft", buildEarlyExit);
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
			// lsc_land's every result starts "lsc_land: " — its absence in the stream means no
			// land call ran; the DURABLE corroboration is the surviving worktree/branch and the
			// untouched cycle marker above (stream absence on the bounded tail is heuristic —
			// kept because a land would also have moved the files asserted above).
			expect(result.stdout.includes("lsc_land: "), "no lsc_land call may run after a terminal disposition").toBe(false);

			// aborted=true is ORCHESTRATION compliance evidence (the skill delegated to the abort
			// tool), deliberately reported separately from the safety property itself — the
			// terminal-disposition refusal of begin/land is proven by the PR-1/PR-2 unit suites.
			// The DURABLE authority is state.aborted===true (now also a pre-kill condition, see
			// the earlyExit above); the stream marker below is kept as the RF-7 corroborative —
			// the delegation's own result text observed in the kill window (these 15-minute gate
			// runs never approach the 32MB tail cap, so the marker's presence is safe to require).
			expect(state?.aborted, "the observed lsc_craft_abort delegation must leave aborted=true (durable authority, required before the kill)").toBe(true);
			expect(
				result.stdout.includes(CRAFT_ABORTED_MARKER),
				"the skill must delegate to lsc_craft_abort after a terminal Abort disposition — the delegation's result text in the stream (corroborative to durable aborted=true)",
			).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"Preserve branch and stop: the terminal disposition is durable, nothing is aborted/merged/cleaned, branch+worktree survive",
		async () => {
			// audit-4 RF-41(b) — durable-first: the kill condition is the persisted terminal
			// record naming Preserve (the same begin call that would have streamed the terminal
			// result text writes this record; the file cannot be lost to the rolling tail).
			// The lsc_land stream-absence below stays corroborative — durable no-land evidence
			// is the surviving worktree/branch + the untouched cycle marker.
			const buildEarlyExit = ({ worktreeRoot, feature }: { worktreeRoot: string; feature: string; sessionDir: string }) => {
				const due = durableProbeThrottle(1000);
				return (stdout: string) => {
					if (!stdout.includes(AUDIT_BEGIN_ANY_MARKER)) return false;
					if (!due()) return false;
					const state = readCraftStateFile(worktreeRoot, feature);
					const terminal = state?.auditTerminalDisposition as { disposition?: string } | undefined;
					return terminal?.disposition === "Preserve branch and stop";
				};
			};
			const { projectDir, worktreeRoot, feature, result } = await runEscalationBranch("Preserve branch and stop", buildEarlyExit);
			expect(result.timedOut, `escalation-Preserve run timed out.\n${debugSummary(result)}`).toBe(false);

			const state = readCraftStateFile(worktreeRoot, feature);
			const terminal = state?.auditTerminalDisposition as TerminalDecisionRecord | undefined;
			expect(terminal?.disposition).toBe("Preserve branch and stop");
			expect(state?.auditCycle, "Preserve issues no cycle").toBe(1);
			expect(state?.aborted, "Preserve must NOT mark the craft aborted — it preserves, it does not abort").not.toBe(true);
			expect(existsSync(join(worktreeRoot, ".lsc", "crafts", feature, "audit", "audit-2.md")), "no audit-2.md may appear after a terminal disposition").toBe(false);
			expect(existsSync(worktreeRoot), "the worktree must survive a Preserve disposition").toBe(true);
			const branchList = execFileSync("git", ["branch", "--list", `lets-craft/${feature}`], { cwd: projectDir, encoding: "utf8" });
			expect(branchList.includes(`lets-craft/${feature}`), "the implementation branch must survive a Preserve disposition").toBe(true);
			expect(result.stdout.includes("lsc_land: "), "no lsc_land call may run (stream-absence, corroborative to the surviving worktree/branch)").toBe(false);
		},
		TEST_TIMEOUT_MS,
	);
});
