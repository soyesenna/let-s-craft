// AC4/AC5/AC7 — the "완전 자동 E2E" acceptance criterion, updated for R5's all-in-worktree
// topology. Drives the real `omp` binary headlessly through the whole pipeline against the
// bundled `fixtures/sample-ts-cli` sample: pre-craft (fixture-mode research stub, Task A;
// always creates `.lsc/worktrees/{feature}/` — no `[Worktree]` question anymore) → craft (bounded
// executor loop, Task B, implementing against the worktree) → post-craft (audit, then a Land
// merge+worktree-removal if the verdict is APPROVE-family). Every human-facing question routes
// through lsc_ask/lsc_select/lsc_confirm, answered by `fixtures/sample-ts-cli/answers.json` via
// LSC_FIXTURE — no interactive UI is touched.
//
// This file used to be split into e2e-full-cycle.test.ts (non-worktree artifact-existence/order/
// verdict) and e2e-worktree.test.ts (--worktree topology + land). R5 unified the pipeline onto a
// single always-worktree topology, so there is no non-worktree mode left to test separately —
// e2e-worktree.test.ts is deleted and every assertion it made is absorbed here, sequenced as
// stages so a pre-craft/craft failure is still distinguishable from a land failure:
//   ① pre-craft: worktree-internal artifacts + write order + AC5 base-purity + AC4 step commits.
//   ② craft: worktree-branch implementation commits + a passing run_test.sh.
//   ③ post-craft (pre-land): audit-0.md + its verdict line, inside the worktree.
//   ④ land: merge+remove+prune on an APPROVE-family verdict (or worktree preserved otherwise),
//      plus post-land visibility of artifacts/impl/audit on the base branch.
//
// Per the plan's §2.4 caveat (also restated in each pipeline SKILL.md and the spec's AC3a-3d
// rows): this test asserts artifact EXISTENCE, WRITE ORDER, COMMIT TOPOLOGY, and the literal
// post-craft VERDICT LINE — never semantic quality (whether the trace's reasoning is good,
// whether the spec's ambiguity is genuinely <5%, whether the audit's judgment is correct). That is
// intentional, not an oversight: those properties are non-deterministic LLM judgment calls that a
// fixture run against a cheap, fast model cannot and should not be expected to guarantee.
//
// Gated behind LSC_E2E=1 — spends real tokens against a real authenticated provider. `npm test`
// never runs this file; `npm run e2e` does.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	E2E_MAIN_MODEL,
	debugSummary,
	listCraftFeatures,
	listWorktreeFeatures,
	preCraftArtifactsComplete,
	runOmpPrint,
	runToCompletion,
	setupFixtureProject,
} from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

// Generous, independent per-stage kill timeouts (harness-level) — pre-craft is the heaviest
// stage (trace's 3 lanes + brownfield explore, interview, two architect/critic consensus
// loops capped at 2 iterations each in fixture mode per skills/pre-craft/SKILL.md §1.7, 4+
// test-engineer spawns). All bounded per plan §Phase 7 (b)(c) — see the cheap-model preset
// setupFixtureProject() seeds and the fixture-mode caps documented in the SKILL.md files.
//
// Sized and re-sized across three actual timed-out runs, each still validly progressing (not
// stuck) at the moment it ran out of budget: (1) pre-craft was writing Stage 4's 4 tester assets
// at 25 minutes; (2) after bumping to 40 minutes and fixing 3-way file-level contention
// (`--no-file-parallelism`, package.json), pre-craft reached Stage 3's consensus loop (planner →
// architect x3 reviews + 2 revisions) before running out; (3) after fixing `task` spawns to run
// synchronously (async.enabled=false, this file's `syncModeConfigPath()`) and upgrading the main
// orchestrator model (E2E_MAIN_MODEL, e2e-helpers.ts), each stage should need meaningfully less
// wall-clock than before — these numbers stay generous rather than tight to that expectation.
// (The former e2e-worktree.test.ts used these identical values for its own pre/craft/post
// budgets — the additional land step at the end of post-craft did not need a separate budget.)
const PRE_CRAFT_TIMEOUT_MS = 90 * 60_000;
const CRAFT_TIMEOUT_MS = 40 * 60_000;
const POST_CRAFT_TIMEOUT_MS = 25 * 60_000;
// A resume only has to finish whatever pre-craft's initial attempt left undone (see
// runToCompletion in e2e-helpers.ts), never the whole heavy stage from scratch — sized like
// POST_CRAFT_TIMEOUT_MS, not PRE_CRAFT_TIMEOUT_MS, on that basis.
const PRE_CRAFT_RESUME_TIMEOUT_MS = 20 * 60_000;
const PRE_CRAFT_MAX_RESUMES = 3;
// Worst case (every stage maxes its budget, plus all PRE_CRAFT_MAX_RESUMES resumes each also
// maxing PRE_CRAFT_RESUME_TIMEOUT_MS) plus the pre-existing 15-minute slack.
const TEST_TIMEOUT_MS = PRE_CRAFT_TIMEOUT_MS + PRE_CRAFT_MAX_RESUMES * PRE_CRAFT_RESUME_TIMEOUT_MS + CRAFT_TIMEOUT_MS + POST_CRAFT_TIMEOUT_MS + 15 * 60_000;

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

const FEATURE_DESCRIPTION =
	"Fix slugify so it collapses consecutive non-alphanumeric separators into a single hyphen and trims leading/trailing " +
	"hyphens, matching the behavior already documented in src/slugify.ts's bug note.";

const FIXTURE_NOTE =
	"Every question you would ask a human must go through lsc_ask/lsc_select/lsc_confirm as usual — LSC_FIXTURE is " +
	"already configured with scripted answers, so just call those tools normally and use whatever they return; do not " +
	"address me directly and do not wait for a reply outside those tools.";

// Sent (via --continue, runToCompletion) if pre-craft's initial attempt stops before the worktree
// and all four Stage 1-4 artifacts exist inside it — see runToCompletion's own comment in
// e2e-helpers.ts for why this can happen at all under `-p` mode. Explicitly told not to redo
// existing work, since re-running an earlier sub-stage from scratch (e.g. a second trace.md) would
// violate C14's fixed sub-stage order this same test asserts via mtime below.
const PRE_CRAFT_RESUME_PROMPT =
	"이전 pre-craft 세션이 .lsc/worktrees/{feature}/와 그 안의 trace.md/spec.md/plan.md/test/run_test.sh를 " +
	"모두 만들기 전에 멈췄다. 이미 존재하는 것은 절대 다시 만들지 말고, 현재 상태를 확인해 아직 없는 부분부터 " +
	`이어서 pre-craft를 끝까지 진행하라. ${FIXTURE_NOTE}`;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe.skipIf(!RUN_E2E)("full cycle E2E (AC4/AC5/AC7): pre-craft (always-worktree) → craft → post-craft → land", () => {
	it(
		"produces a worktree with trace.md → spec.md → plan.md → test/ in order, base-branch purity, ≥5 pre-craft step commits, a passing run_test.sh after craft, an audit verdict after post-craft, and merges+removes+prunes the worktree on a Land approval",
		async () => {
			const { base, projectDir, answersPath, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);
			const fixtureEnv = { LSC_FIXTURE: answersPath };

			const baseBranch = git(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]);

			// ==================== Stage ① pre-craft ====================
			const preCraftRun = await runToCompletion({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: PRE_CRAFT_TIMEOUT_MS,
				prompt: `/skill:pre-craft ${FEATURE_DESCRIPTION} ${FIXTURE_NOTE}`,
				isComplete: () => preCraftArtifactsComplete(projectDir),
				continuationPrompt: PRE_CRAFT_RESUME_PROMPT,
				resumeTimeoutMs: PRE_CRAFT_RESUME_TIMEOUT_MS,
				maxResumes: PRE_CRAFT_MAX_RESUMES,
			});
			const preCraftResult = preCraftRun.last;
			expect(preCraftResult.timedOut, `pre-craft timed out (attempt ${preCraftRun.attempts.length}).\n${debugSummary(preCraftResult)}`).toBe(false);
			expect(
				preCraftRun.completed,
				`pre-craft never produced the worktree plus all of trace.md/spec.md/plan.md/test/run_test.sh inside it, even after ${preCraftRun.attempts.length - 1} resume(s).\n${debugSummary(preCraftResult)}`,
			).toBe(true);

			const features = listWorktreeFeatures(projectDir);
			expect(
				features.length,
				`expected exactly one .lsc/worktrees/{feature} dir, found ${JSON.stringify(features)}.\n${debugSummary(preCraftResult)}`,
			).toBe(1);
			const feature = features[0];
			const worktreePath = join(projectDir, ".lsc", "worktrees", feature);
			const craftDir = join(worktreePath, ".lsc", "crafts", feature);

			const tracePath = join(craftDir, "trace.md");
			const specPath = join(craftDir, "spec.md");
			const planPath = join(craftDir, "plan.md");
			const testDir = join(craftDir, "test");
			const runTestPath = join(testDir, "run_test.sh");

			// Individually, for a precise failure message pinpointing which one — `preCraftRun.completed`
			// above already guarantees all of these exist, so none of these can actually fail on their own.
			expect(existsSync(worktreePath), `worktree not created at ${worktreePath}.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(tracePath), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(specPath), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(planPath), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(runTestPath), debugSummary(preCraftResult)).toBe(true);

			const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
			expect(gitignore, `.gitignore does not register .lsc/worktrees/.\n${gitignore}`).toMatch(/^\/?\.lsc\/worktrees\/?$/m);

			// Write order: trace -> spec -> plan -> test (C14's fixed sub-stage order), via mtime —
			// worktree-internal paths, since that's where R5 always writes these now.
			const traceMtime = statSync(tracePath).mtimeMs;
			const specMtime = statSync(specPath).mtimeMs;
			const planMtime = statSync(planPath).mtimeMs;
			const testMtime = statSync(runTestPath).mtimeMs;
			expect(traceMtime, "trace.md must be written no later than spec.md").toBeLessThanOrEqual(specMtime);
			expect(specMtime, "spec.md must be written no later than plan.md").toBeLessThanOrEqual(planMtime);
			expect(planMtime, "plan.md must be written no later than test/run_test.sh").toBeLessThanOrEqual(testMtime);

			// AC5 base-purity: the base branch (the main checkout's own HEAD, never touched by
			// pre-craft/craft/post-craft under always-worktree) must show zero commits touching
			// .lsc/crafts/{feature} — a non-empty log here would mean a skill leaked a write onto the
			// original branch instead of the worktree (split-brain regression R5 exists to prevent).
			const basePurityLog = git(projectDir, ["log", baseBranch, "--", `.lsc/crafts/${feature}`]);
			expect(
				basePurityLog,
				`base branch "${baseBranch}" has commit(s) touching .lsc/crafts/${feature} — split-brain leak (AC5).\n${basePurityLog}`,
			).toBe("");

			const worktreeBranch = git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
			expect(worktreeBranch, "worktree checkout must not be on the base branch").not.toBe(baseBranch);

			// AC4 step commits: pre-craft must have committed each Stage 1-4 sub-stage separately
			// (research/trace/spec/plan/test) on the worktree's feature branch, not as one bulk
			// commit — at least 5 commits since the branch diverged from base. The exact per-stage
			// keyword match is a soft, diagnostic-only check (commit message wording is LLM-composed
			// prose, not a fixed contract) — the hard gate is the commit COUNT.
			const preCraftLog = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]);
			const preCraftCommitLines = preCraftLog.split("\n").filter(line => line.length > 0);
			expect(
				preCraftCommitLines.length,
				`expected >=5 step commits on the worktree branch after pre-craft (research/trace/spec/plan/test, AC4), got ${preCraftCommitLines.length}.\n${preCraftLog}`,
			).toBeGreaterThanOrEqual(5);
			for (const keyword of ["research", "trace", "spec", "plan", "test"]) {
				if (!new RegExp(keyword, "i").test(preCraftLog)) {
					// biome-ignore lint/suspicious/noConsole: intentional soft-check diagnostic, not a test failure.
					console.warn(`lets-craft E2E (soft check, not a failure): no pre-craft commit message matched stage keyword "${keyword}".\n${preCraftLog}`);
				}
			}

			const worktreeCommitsBeforeCraft = preCraftCommitLines.length;
			const worktreeTipShaBeforeCraft = git(worktreePath, ["rev-parse", "HEAD"]);

			// ==================== Stage ② craft ====================
			const craftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: CRAFT_TIMEOUT_MS,
				prompt: `/skill:craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
			});
			expect(craftResult.timedOut, `craft timed out.\n${debugSummary(craftResult)}`).toBe(false);

			// Indirect assert (per the Phase 7 handoff): the implementation commit(s) landed on
			// the WORKTREE's branch, not the project root's working tree (which never checked out
			// the feature branch under always-worktree at all).
			const worktreeCommitsAfterCraft = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]).split("\n").filter(line => line.length > 0);
			expect(
				worktreeCommitsAfterCraft.length,
				`expected new commits on the worktree branch after craft (before: ${worktreeCommitsBeforeCraft}).\n${debugSummary(craftResult)}`,
			).toBeGreaterThan(worktreeCommitsBeforeCraft);
			const worktreeTipShaAfterCraft = git(worktreePath, ["rev-parse", "HEAD"]);
			expect(worktreeTipShaAfterCraft, "craft must have committed something new on the worktree branch").not.toBe(worktreeTipShaBeforeCraft);

			// Independent re-verification, not trust in the LLM's self-report (mirrors post-craft's
			// own §3.4 "never trust .craft-state.json alone" philosophy) — actually execute
			// run_test.sh ourselves, inside the worktree, and check its real exit code.
			execFileSync("chmod", ["+x", runTestPath]);
			const rerun = spawnSync("bash", [runTestPath], { cwd: worktreePath, encoding: "utf8" });
			expect(
				rerun.status,
				`run_test.sh did not exit 0 in the worktree after craft (status=${rerun.status}).\nstdout:\n${rerun.stdout}\nstderr:\n${rerun.stderr}\n\n${debugSummary(craftResult)}`,
			).toBe(0);

			// ==================== Stage ③ post-craft (audit, and land if approved) ====================
			const postCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: POST_CRAFT_TIMEOUT_MS,
				prompt: `/skill:post-craft .lsc/crafts/${feature}/ If the audit reaches an APPROVE-family verdict, land is approved — answer the Land/Merge question "yes". ${FIXTURE_NOTE}`,
			});
			expect(postCraftResult.timedOut, `post-craft timed out.\n${debugSummary(postCraftResult)}`).toBe(false);

			// post-craft's audit and its §7 land run in the *same* omp invocation: on an APPROVE-family
			// verdict the fixture answers "yes" to the [Land] Merge? gate, so by the time this call
			// returns the worktree has already been merged and pruned. There is no separable
			// "after audit, before land" filesystem moment to observe — read audit-0.md from wherever
			// it landed: the merged base-branch path if land ran (worktree gone), else the worktree.
			const landed = !existsSync(worktreePath);
			const auditCraftDir = landed ? join(projectDir, ".lsc", "crafts", feature) : craftDir;
			const auditPath = join(auditCraftDir, "audit", "audit-0.md");
			expect(existsSync(auditPath), `audit/audit-0.md missing (landed=${landed}).\n${debugSummary(postCraftResult)}`).toBe(true);
			const auditContent = readFileSync(auditPath, "utf8");
			// Line-start anchor, per skills/post-craft/SKILL.md §4.1 point 2's explicit flag: this
			// must not match lsc-critic's own embedded "**VERDICT: ...**" sub-line quoted later in
			// the same document.
			const verdictMatch = auditContent.match(/^\*\*AUDIT VERDICT: (APPROVE|APPROVE-WITH-COMMENT|APPROVE-WITH-CHANGE|REJECT)\*\*/m);
			expect(verdictMatch, `audit-0.md has no line-start "**AUDIT VERDICT:" line.\n---\n${auditContent.slice(0, 2000)}`).not.toBeNull();
			// Order: audit-0.md written no earlier than the (already-passing) test/run_test.sh from craft.
			expect(statSync(auditPath).mtimeMs, "audit-0.md must be written after craft's test/ output").toBeGreaterThanOrEqual(testMtime);

			// ==================== Stage ④ land ====================
			const verdict = verdictMatch?.[1];
			const landEligible = verdict === "APPROVE" || verdict === "APPROVE-WITH-COMMENT";

			if (!landEligible) {
				// §7.1: APPROVE-WITH-CHANGE/REJECT are not land-eligible this cycle — the worktree
				// must be left exactly in place, not merged/removed. This is still a meaningful,
				// asserted outcome (land correctly did NOT run), just not the merge+prune path.
				expect(
					existsSync(worktreePath),
					`verdict was ${verdict} (not land-eligible) but the worktree was removed anyway.\n${debugSummary(postCraftResult)}`,
				).toBe(true);
				return;
			}

			expect(
				existsSync(worktreePath),
				`verdict was ${verdict} (land-eligible) but the worktree was not removed.\n${debugSummary(postCraftResult)}`,
			).toBe(false);

			const worktreeList = git(projectDir, ["worktree", "list"]);
			expect(worktreeList, `git worktree list still references the pruned worktree.\n${worktreeList}`).not.toContain(feature);

			// Merge landed: craft's final worktree-branch commit is now an ancestor of the base
			// branch's HEAD. `--is-ancestor` exits non-zero (execFileSync throws) when it is not,
			// so a clean call is the assertion — robust to whatever exact commit-message text
			// post-craft's land step (§7.4) composed, unlike grepping for the branch name.
			expect(() => execFileSync("git", ["merge-base", "--is-ancestor", worktreeTipShaAfterCraft, "HEAD"], { cwd: projectDir })).not.toThrow();

			// Post-land visibility: the merge must have brought artifacts, implementation, and the
			// audit onto the base branch — `.lsc/crafts/{feature}` (empty pre-land per AC5 above) now
			// exists directly under the project root, with the same trace.md/audit-0.md the worktree had.
			const postLandFeatures = listCraftFeatures(projectDir);
			expect(
				postLandFeatures,
				`base branch does not see .lsc/crafts/${feature} after land.\n${JSON.stringify(postLandFeatures)}`,
			).toContain(feature);
			const landedCraftDir = join(projectDir, ".lsc", "crafts", feature);
			expect(existsSync(join(landedCraftDir, "trace.md")), "trace.md not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "plan.md")), "plan.md not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "test", "run_test.sh")), "test/run_test.sh not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "audit", "audit-0.md")), "audit/audit-0.md not visible on base branch after land").toBe(true);
		},
		TEST_TIMEOUT_MS,
	);
});
