// PR-5 (postcraft-14cycle-approval-failure) — AC1/AC3/AC8: the canonical red
// cycle continuation, proven at REAL subprocess boundaries.
//
//   ① Seed: one AWC audit (audit-0.md, old format) whose Required Fix targets
//      production (src/slugify.ts), plus a deterministic multi-command
//      `check/run_check.sh` whose failing step's owner (production output vs
//      check expectation) cannot be attributed from the log.
//   ② Process 1 = audit-driven craft: implements the fix (commit B, B ≠ A),
//      runs the fresh check (§5.0), observes the executed red, and must end
//      with `[Craft Incomplete]` carrying `executed-red` evidence and the exact
//      `reason=red-attribution-unknown` — never `[Craft Complete]`, and never a
//      §3.0-only mode/handoff envelope (none exists in the contract).
//   ③ Process 2 = a NORMAL, fresh post-craft process (LSC_FIXTURE env only):
//      `lsc_audit_begin` issues the NEXT audit cycle, and §3.0 re-establishes
//      evidence at the CURRENT OID — reading B's production snapshot as its
//      input and landing its test/check work as commits on top of B.
//
// "B 관측" is asserted exactly as the plan defines it — NOT as exact-HEAD
// equality, but as §3.0 having read B's production snapshot as input (its work
// lands in the same worktree whose base was B) and having executed at
// subsequent test/check commit OIDs (new commits on top of B touching test/ or
// check/run_check.sh). The prior A-cycle report is never re-attributed to B.
//
// audit-2 RF-28: §3.0 also has a LEGITIMATE no-commit completion shape (this
// real cycle demonstrated it — the spawn completes, the fresh check runs, and
// nothing lands on top of B). Commit existence is therefore asserted only in
// the with-commit branch; the no-commit branch asserts the snapshot-input /
// executed-OID evidence instead: the §3.0 spawn ran while HEAD was still B
// (it consumed B's production snapshot as its input by construction), and a
// check/logs transcript was written beyond process-1's red log — with HEAD
// pinned at B, that execution ran at exactly B's OID.
//
// Gated behind LSC_E2E=1 — spends real tokens; `npm run e2e` runs this file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AUDIT_CYCLE_BEGUN_MARKER,
	E2E_MAIN_MODEL,
	RUN_CHECK_MARKER,
	completedTaskSpawnSeen,
	debugSummary,
	readCraftStateFile,
	runOmpPrint,
	seedCraftedFeature,
	setupFixtureProject,
	streamMarkerCount,
	taskSpawnCount,
} from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

const FIXTURE_NOTE =
	"Every question you would ask a human must go through lsc_ask/lsc_select/lsc_confirm as usual — LSC_FIXTURE is " +
	"already configured with scripted answers, so just call those tools normally and use whatever they return; do not " +
	"address me directly and do not wait for a reply outside those tools.";

const CRAFT_TIMEOUT_MS = 30 * 60_000;
const POST_CRAFT_TIMEOUT_MS = 25 * 60_000;
const TEST_TIMEOUT_MS = CRAFT_TIMEOUT_MS + POST_CRAFT_TIMEOUT_MS + 10 * 60_000;

/** Deterministic multi-command red: two real steps on paths the seeded Required Fix never touched. The failing expectation (truncate's ellipsis NOT counting toward maxLength) is a defensible design reading, so the fresh log names neither the Required Fix's target nor unambiguously the check artifact — the owner is not identifiable from the log alone. */
const RED_CHECK_SCRIPT = [
	"#!/usr/bin/env bash",
	"# Build/lint/typecheck/test entrypoint for this fixture project.",
	"set -uo pipefail",
	"status=0",
	"node --test test/ || status=1",
	'node src/cli.ts truncate 8 "the quick brown fox jumps over" | grep -q "the quic…" || status=1',
	'exit "$status"',
	"",
].join("\n");

/** The seeded prior cycle: an old-format AWC audit doc whose Required Fix targets production. */
const SEEDED_AUDIT_0 = [
	"# Audit 0",
	"",
	"**AUDIT VERDICT: APPROVE-WITH-CHANGE**",
	"",
	"## Required Fix",
	"",
	'- itemId: fix-slugify-separators — **수정 · MAJOR**: src/slugify.ts replaces each non-alphanumeric character individually instead of collapsing consecutive separators, and never trims leading/trailing hyphens. Collapse separator runs into a single hyphen and trim the result so slugify("Hello   World!!!") === "hello-world" (spec.md AC1; fixCompleteness: apply-only).',
	"",
].join("\n");

/** The persisted state's complete legal top-level field set — anything else after process 1 is a forbidden handoff envelope. */
const KNOWN_STATE_FIELDS = [
	"stateVersion",
	"feature",
	"projectRoot",
	"worktreeRoot",
	"aborted",
	"auditCycle",
	"checkLogAtCycleStart",
	"auditValidated",
	"releaseApproval",
	"auditEscalationPending",
	"auditEscalations",
	"nextAuditEscalationCycle",
	"auditTerminalDisposition",
	"auditBaseSnapshot",
];

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** Craft-dir entries outside the known artifact families (an envelope/mode marker would land here). */
function unknownCraftEntries(craftDir: string): string[] {
	const topLevelKnown = ["trace.md", "spec.md", "plan.md", ".craft-state.json", "audit", "check", "research"];
	const unknown = readdirSync(craftDir).filter(name => !topLevelKnown.includes(name));
	if (existsSync(join(craftDir, "audit"))) {
		unknown.push(...readdirSync(join(craftDir, "audit")).filter(name => !/^audit-\d+\.md$|^auditor-\d+-.+\.md$/.test(name)).map(name => `audit/${name}`));
	}
	if (existsSync(join(craftDir, "check"))) {
		unknown.push(...readdirSync(join(craftDir, "check")).filter(name => name !== "run_check.sh" && name !== "logs").map(name => `check/${name}`));
	}
	return unknown;
}



describe.skipIf(!RUN_E2E)("PR-5 E2E — canonical red cycle continuation (audit A → craft commit B → red [Craft Incomplete] → normal post-craft next cycle)", () => {
	it(
		"ends the audit-driven craft at a red-attribution-unknown [Craft Incomplete] at commit B, then a fresh post-craft process issues the next audit cycle and re-establishes evidence on top of B",
		async () => {
			const { base, projectDir, fixtureDir, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);
			const feature = "red-cycle";
			const { worktreeRoot, craftDir } = seedCraftedFeature(projectDir, feature, { seededAudits: 1, redCheckScript: RED_CHECK_SCRIPT });

			// Replace the seeded REJECT audit-0 with the AWC + production Required Fix the cycle needs.
			writeFileSync(join(craftDir, "audit", "audit-0.md"), SEEDED_AUDIT_0);
			execFileSync("git", ["add", "-A"], { cwd: worktreeRoot });
			execFileSync("git", ["commit", "-q", "-m", "docs: audit-0 AWC + Required Fix (seed)"], { cwd: worktreeRoot });
			const auditTipA = git(worktreeRoot, ["rev-parse", "HEAD"]);

			// ==================== Process 1 — audit-driven craft ====================
			const craftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: { LSC_FIXTURE: join(fixtureDir, "answers.json") },
				timeoutMs: CRAFT_TIMEOUT_MS,
				prompt: `/skill:craft .lsc/crafts/${feature}/audit/audit-0.md ${FIXTURE_NOTE}`,
			});
			expect(craftResult.timedOut, `red-cycle craft timed out.\n${debugSummary(craftResult)}`).toBe(false);

			// A → B: the executor committed a distinct, descendant implementation commit.
			const commitB = git(worktreeRoot, ["rev-parse", "HEAD"]);
			expect(commitB, "craft must produce a new commit B").not.toBe(auditTipA);
			expect(() => execFileSync("git", ["merge-base", "--is-ancestor", auditTipA, "HEAD"], { cwd: worktreeRoot }), "B must descend from the audit-A tip").not.toThrow();

			// The fresh check really ran and really observed red. The parent session may run
			// lsc_run_check itself or hand the verification to the executor (its tool events live
			// in the subagent's own session, not this stream) — the durable, orchestration-
			// independent evidence is the check/logs/ transcript the tool writes either way.
			const checkLogsDir = join(craftDir, "check", "logs");
			expect(existsSync(checkLogsDir), "the red observation must leave check/logs/").toBe(true);
			const redLog = readdirSync(checkLogsDir).find(name => {
				const content = readFileSync(join(checkLogsDir, name), "utf8");
				return !content.includes("--- exit 0 ---") && /--- exit (?!0)\d+ ---|\(killed\)/.test(content);
			});
			expect(redLog, "at least one check-N.log must record the executed red (nonzero/killed exit)").toBeDefined();

			// The corrected Goal (C) exit: an [Craft Incomplete] with the exact unknown-attribution
			// reason and executed-red evidence — never a completion declaration.
			expect(craftResult.stdout, `craft must end at [Craft Incomplete], not a completion declaration.\n${debugSummary(craftResult)}`).toContain("[Craft Incomplete]");
			expect(craftResult.stdout, `the multi-command red must close as reason=red-attribution-unknown.\n${debugSummary(craftResult)}`).toContain("red-attribution-unknown");
			expect(craftResult.stdout).toContain("executed-red");
			expect(craftResult.stdout, "the incomplete report must cite the actual red log path").toContain(redLog ?? "");

			// No §3.0-only mode / durable handoff envelope: the crafts dir's surface stays within
			// the known artifact set, and the persisted state gains no unknown top-level fields.
			const unknown = unknownCraftEntries(craftDir);
			expect(unknown, `no handoff envelope/mode marker may exist: ${JSON.stringify(unknown)}`).toEqual([]);
			const stateAfterCraft = readCraftStateFile(worktreeRoot, feature);
			expect(
				Object.keys(stateAfterCraft ?? {}).filter(key => !KNOWN_STATE_FIELDS.includes(key)),
				"the persisted state must carry no handoff-envelope fields",
			).toEqual([]);

			// ==================== Process 2 — normal, fresh post-craft (LSC_FIXTURE env only) ====================
			// audit-2 RF-28: the early-exit observation below polls the WORKTREE, not just the
			// stream — see the comment on the earlyExit arm.
			const continuationCommitLanded = (): boolean => {
				try {
					if (git(worktreeRoot, ["rev-parse", "HEAD"]) === commitB) return false;
					execFileSync("git", ["merge-base", "--is-ancestor", commitB, "HEAD"], { cwd: worktreeRoot, stdio: "pipe" });
					const diff = git(worktreeRoot, ["diff", "--name-only", `${commitB}..HEAD`]);
					return /^test\/|\.lsc\/crafts\/red-cycle\/check\/run_check\.sh$/m.test(diff);
				} catch {
					return false; // not descended from B, or git not ready — keep waiting
				}
			};
			const postCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: { LSC_FIXTURE: join(fixtureDir, "answers.json") },
				timeoutMs: POST_CRAFT_TIMEOUT_MS,
				// §3.0's completion is the observable that evidence is being re-established on top
				// of B: either §3.1's lsc_run_check ran (its TS-authored transcript header), or the
				// §3.0 test-authoring spawn COMPLETED (a parsed `tool_execution_end` event for the
				// builtin `task` tool — one of the few tools whose NDJSON toolName is its own).
				// The raw `"toolName":"task"` substring this replaces also matched the spawn's
				// START event (audit-0 RF-8), killing the run before the result existed — a
				// structural flake. Only a completed execution, or the run-check marker, may
				// ever exit early here.
				//
				// audit-2 RF-28: those arms alone sampled the stream BEFORE §8's finalization
				// commits the very observations asserted below (check-3: the RUN_CHECK_MARKER arm
				// fired before the §3.0 spawn had even run; check-4: the completed-spawn arm fired
				// after the spawn but before any commit). Early exit is now permitted ONLY once
				// the asserted observation itself holds — a new commit on top of B touching test/
				// or check/run_check.sh — or the subprocess ends naturally (the no-commit
				// legitimate-completion path, branch-handled in the assertions below).
				earlyExit: (stdout: string) =>
					stdout.includes(AUDIT_CYCLE_BEGUN_MARKER(1)) && (stdout.includes(RUN_CHECK_MARKER) || completedTaskSpawnSeen(stdout)) && continuationCommitLanded(),
				prompt: `/skill:post-craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
			});
			expect(postCraftResult.timedOut, `red-cycle post-craft timed out.\n${debugSummary(postCraftResult)}`).toBe(false);

			// The next audit cycle was issued by a separate, normal post-craft process.
			expect(
				streamMarkerCount(postCraftResult, AUDIT_CYCLE_BEGUN_MARKER(1)),
				`lsc_audit_begin must issue the next cycle (candidate 1, under the fixture cap).\n${debugSummary(postCraftResult)}`,
			).toBeGreaterThanOrEqual(1);
			expect(readCraftStateFile(worktreeRoot, feature)?.auditCycle, "the persisted marker must advance to the issued cycle").toBe(1);

			// "B 관측": §3.0 read B's production snapshot as input (a real test-authoring spawn ran
			// in this worktree) and executed at subsequent test/check commit OIDs — new commits on
			// top of B touching test/ or check/run_check.sh. Exact-HEAD-B equality is NOT asserted;
			// the A-cycle report is never re-attributed (craft's incomplete record stayed in its
			// own process output, and the state carries no cross-OID report field). Both legitimate
			// completion shapes satisfy this (audit-2 RF-28): commits landed → the with-commit
			// branch below; nothing landed → the no-commit branch's snapshot-input/executed-OID
			// evidence (see the file header).
			expect(taskSpawnCount(postCraftResult), "§3.0's test-authoring spawn must run in the continuation cycle").toBeGreaterThanOrEqual(1);
			const headAfter = git(worktreeRoot, ["rev-parse", "HEAD"]);
			if (headAfter !== commitB) {
				// WITH-COMMIT branch (the observation the strengthened earlyExit waits for):
				// continuation commits exist — assert descent and the test/check artifact surface.
				expect(() => execFileSync("git", ["merge-base", "--is-ancestor", commitB, "HEAD"], { cwd: worktreeRoot }), "the new work must descend from B").not.toThrow();
				const continuationDiff = git(worktreeRoot, ["diff", "--name-only", `${commitB}..HEAD`]);
				expect(
					/^test\/|\.lsc\/crafts\/red-cycle\/check\/run_check\.sh$/m.test(continuationDiff),
					`the new commits on top of B must touch the §3.0 test/check artifacts.\n${continuationDiff}`,
				).toBe(true);
			} else {
				// NO-COMMIT legitimate completion (audit-2 RF-28): §3.0 read B's production snapshot
				// as input — the spawn asserted above ran in this worktree while HEAD was still B —
				// and its verification EXECUTED at B's OID. The durable, orchestration-independent
				// proof is a check/logs transcript written beyond process-1's red log: with HEAD
				// pinned at B, any execution this process performed ran at exactly B's OID.
				const redLogIndex = Number(/^check-(\d+)\.log$/.exec(redLog ?? "")?.[1] ?? 0);
				const logIndices = readdirSync(checkLogsDir)
					.map(name => /^check-(\d+)\.log$/.exec(name)?.[1])
					.filter((n): n is string => n !== undefined)
					.map(Number);
				expect(
					Math.max(0, ...logIndices),
					"the no-commit completion still requires fresh §3.0 execution evidence at B's OID — a check log beyond process-1's red log",
				).toBeGreaterThan(redLogIndex);
			}
		},
		TEST_TIMEOUT_MS,
	);
});
