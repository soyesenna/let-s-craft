// AC4/AC5/AC7 — the "완전 자동 E2E" acceptance criterion, updated for R5's all-in-worktree
// topology and C5-C8's implementation-before-tests → tests-after-implementation redesign. Drives
// the real `omp` binary headlessly through the whole pipeline against the bundled
// `fixtures/sample-ts-cli` sample: pre-craft (fixture-mode research stub, Task A; always creates
// `.lsc/worktrees/{feature}/` — no `[Worktree]` question anymore, and no test-authoring stage
// either, C5) → craft (single-shot executor, C6, implementing against the worktree) → post-craft
// (authors the regression test + `check/run_check.sh` first, C7, then the audit, then a Land
// merge+worktree-removal if the verdict is APPROVE-family). Every human-facing question routes
// through lsc_ask/lsc_select/lsc_confirm, answered by `fixtures/sample-ts-cli/answers.json` via
// LSC_FIXTURE — no interactive UI is touched. `[Parallel Lanes]`/`[Craft Incomplete]` are answered
// confirm:false so this run stays deterministically on craft's single-executor path.
//
// This file used to be split into e2e-full-cycle.test.ts (non-worktree artifact-existence/order/
// verdict) and e2e-worktree.test.ts (--worktree topology + land). R5 unified the pipeline onto a
// single always-worktree topology, so there is no non-worktree mode left to test separately —
// e2e-worktree.test.ts is deleted and every assertion it made is absorbed here, sequenced as
// stages so a pre-craft/craft failure is still distinguishable from a land failure:
//   ① pre-craft: worktree-internal 3 artifacts (trace/spec/plan, no test/ tree anymore) + write
//      order + AC5 base-purity + AC4 step commits.
//   ② craft: worktree-branch implementation commits (single-shot, no test re-run — post-craft owns
//      testing now).
//   ③ post-craft (pre-land): the regression test it authored appears in the diff, `check/
//      run_check.sh` + a passing `check/logs/check-N.log` exist, audit-0.md + its verdict line.
//   ④ land: merge+remove+prune on an APPROVE-family verdict (or worktree preserved otherwise),
//      plus post-land visibility of artifacts/impl/check-entrypoint/audit on the base branch.
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
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
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
// stage (trace's 3 lanes + brownfield explore, interview, one architect/critic consensus loop
// capped at 2 iterations in fixture mode per skills/pre-craft/SKILL.md §1.7). All bounded per plan
// §Phase 7 (b)(c) — see the cheap-model preset setupFixtureProject() seeds and the fixture-mode
// caps documented in the SKILL.md files.
//
// Sized and re-sized across three actual timed-out runs (pre-C5/C6/C7, back when pre-craft still
// had a 4th test-authoring sub-stage and craft still ran a bounded executor loop), each still
// validly progressing (not stuck) at the moment it ran out of budget. C8 lowers the pre-craft
// budget from 90 to 60 minutes to reflect the now-3-sub-stage pipeline (trace → interview → plan,
// C5) — a conservative reduction, not a re-derivation from fresh timing data, since a live E2E run
// is Non-Goal for this refactor.
const PRE_CRAFT_TIMEOUT_MS = 60 * 60_000;
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
// and all three trace/spec/plan artifacts exist inside it — see runToCompletion's own comment in
// e2e-helpers.ts for why this can happen at all under `-p` mode. Explicitly told not to redo
// existing work, since re-running an earlier sub-stage from scratch (e.g. a second trace.md) would
// violate C14's fixed sub-stage order this same test asserts via mtime below.
const PRE_CRAFT_RESUME_PROMPT =
	"이전 pre-craft 세션이 .lsc/worktrees/{feature}/와 그 안의 trace.md/spec.md/plan.md를 모두 만들기 전에 멈췄다. " +
	`이미 존재하는 것은 절대 다시 만들지 말고, 현재 상태를 확인해 아직 없는 부분부터 이어서 pre-craft를 끝까지 진행하라. ${FIXTURE_NOTE}`;

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

describe.skipIf(!RUN_E2E)("full cycle E2E (AC4/AC5/AC7): pre-craft (always-worktree) → craft (single-shot) → post-craft (authors + audits) → land", () => {
	it(
		"produces a worktree with trace.md → spec.md → plan.md in order (no test/ tree), base-branch purity, ≥3 pre-craft step commits, a single-shot craft implementation, post-craft-authored tests + a passing check/run_check.sh, an audit verdict, and merges+removes+prunes the worktree on a Land approval",
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
				`pre-craft never produced the worktree plus all of trace.md/spec.md/plan.md inside it, even after ${preCraftRun.attempts.length - 1} resume(s).\n${debugSummary(preCraftResult)}`,
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

			// Individually, for a precise failure message pinpointing which one — `preCraftRun.completed`
			// above already guarantees all of these exist, so none of these can actually fail on their own.
			expect(existsSync(worktreePath), `worktree not created at ${worktreePath}.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(tracePath), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(specPath), debugSummary(preCraftResult)).toBe(true);
			expect(existsSync(planPath), debugSummary(preCraftResult)).toBe(true);
			// C5: pre-craft no longer authors a test/ tree at all — that is now post-craft's own §3.0
			// stage, and it is never scoped under `.lsc/crafts/{feature}/`.
			expect(existsSync(join(craftDir, "test")), "pre-craft must not create a test/ tree anymore (C5) — that is post-craft's job now").toBe(false);

			const gitignore = readFileSync(join(projectDir, ".gitignore"), "utf8");
			expect(gitignore, `.gitignore does not register .lsc/worktrees/.\n${gitignore}`).toMatch(/^\/?\.lsc\/worktrees\/?$/m);

			// Write order: trace -> spec -> plan (C14's fixed sub-stage order), via mtime — worktree-
			// internal paths, since that's where R5 always writes these now.
			const traceMtime = statSync(tracePath).mtimeMs;
			const specMtime = statSync(specPath).mtimeMs;
			const planMtime = statSync(planPath).mtimeMs;
			expect(traceMtime, "trace.md must be written no later than spec.md").toBeLessThanOrEqual(specMtime);
			expect(specMtime, "spec.md must be written no later than plan.md").toBeLessThanOrEqual(planMtime);

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

			// AC4 step commits: pre-craft must have committed each sub-stage separately on the
			// worktree's feature branch, not as one bulk commit. The three deterministic stages are
			// now trace/spec/plan (C5 removed the 4th test-authoring stage) — research produces no
			// separate commit in fixture mode even when `recorded-research.md` is present, since its
			// content is adopted directly into trace.md's own summary rather than written to a new
			// research/ directory (pre-craft/SKILL.md §3 Stage 1 step 5's "nothing new on disk" branch).
			// So the hard gate for a fixture E2E is >=3 (trace/spec/plan), and the exact per-stage
			// keyword match is a soft, diagnostic-only check (commit wording is LLM-composed prose, not
			// a fixed contract).
			const preCraftLog = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]);
			const preCraftCommitLines = preCraftLog.split("\n").filter(line => line.length > 0);
			expect(
				preCraftCommitLines.length,
				`expected >=3 step commits on the worktree branch after pre-craft (trace/spec/plan — research produces no separate commit in fixture mode, AC4), got ${preCraftCommitLines.length}.\n${preCraftLog}`,
			).toBeGreaterThanOrEqual(3);
			for (const keyword of ["trace", "spec", "plan"]) {
				if (!new RegExp(keyword, "i").test(preCraftLog)) {
					// biome-ignore lint/suspicious/noConsole: intentional soft-check diagnostic, not a test failure.
					console.warn(`lets-craft E2E (soft check, not a failure): no pre-craft commit message matched stage keyword "${keyword}".\n${preCraftLog}`);
				}
			}

			const worktreeCommitsBeforeCraft = preCraftCommitLines.length;
			const worktreeTipShaBeforeCraft = git(worktreePath, ["rev-parse", "HEAD"]);

			// ==================== Stage ② craft (single-shot, C6) ====================
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
			// the feature branch under always-worktree at all). craft is single-shot now (C6) — no
			// test re-run to independently re-verify here; post-craft owns all testing (C7).
			const worktreeCommitsAfterCraft = git(worktreePath, ["log", "--oneline", `${baseBranch}..HEAD`]).split("\n").filter(line => line.length > 0);
			expect(
				worktreeCommitsAfterCraft.length,
				`expected new commits on the worktree branch after craft (before: ${worktreeCommitsBeforeCraft}).\n${debugSummary(craftResult)}`,
			).toBeGreaterThan(worktreeCommitsBeforeCraft);
			const worktreeTipShaAfterCraft = git(worktreePath, ["rev-parse", "HEAD"]);
			expect(worktreeTipShaAfterCraft, "craft must have committed something new on the worktree branch").not.toBe(worktreeTipShaBeforeCraft);

			// ==================== Stage ③ post-craft (authors tests + check/run_check.sh, then audits; land if approved) ====================
			const postCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: POST_CRAFT_TIMEOUT_MS,
				prompt: `/skill:post-craft .lsc/crafts/${feature}/ If the audit reaches an APPROVE-family verdict, land is approved — answer the Land/Merge question "yes". ${FIXTURE_NOTE}`,
			});
			expect(postCraftResult.timedOut, `post-craft timed out.\n${debugSummary(postCraftResult)}`).toBe(false);

			// post-craft's authoring+audit and its §7 land run in the *same* omp invocation: on an
			// APPROVE-family verdict the fixture answers "yes" to the [Land] Merge? gate, so by the
			// time this call returns the worktree has already been merged and pruned. There is no
			// separable "after audit, before land" filesystem moment to observe — read from wherever
			// things landed: the merged base-branch path if land ran (worktree gone), else the worktree.
			const landed = !existsSync(worktreePath);
			const postCraftGitRoot = landed ? projectDir : worktreePath;
			const auditCraftDir = landed ? join(projectDir, ".lsc", "crafts", feature) : craftDir;

			// The regression test(s) post-craft's §3.0 authored must appear in the diff between
			// craft's tip and wherever post-craft's own work ended up (the merge commit if landed,
			// else the worktree branch's new HEAD) — under the fixture's own conventional `test/`
			// location, never under `.lsc/`.
			const postCraftDiffNames = git(postCraftGitRoot, ["log", "--name-only", "--pretty=format:", `${worktreeTipShaAfterCraft}..HEAD`]);
			expect(
				postCraftDiffNames,
				`no file under test/ appeared in the diff after post-craft's test-authoring stage (§3.0).\n${postCraftDiffNames}\n\n${debugSummary(postCraftResult)}`,
			).toMatch(/^test\//m);

			// check/run_check.sh is TRACKED (not gitignored, C7/C8) — it must be visible at
			// auditCraftDir regardless of land status.
			const runCheckPath = join(auditCraftDir, "check", "run_check.sh");
			expect(existsSync(runCheckPath), `check/run_check.sh missing at ${runCheckPath} (landed=${landed}).\n${debugSummary(postCraftResult)}`).toBe(true);

			const auditPath = join(auditCraftDir, "audit", "audit-0.md");
			expect(existsSync(auditPath), `audit/audit-0.md missing (landed=${landed}).\n${debugSummary(postCraftResult)}`).toBe(true);
			const auditContent = readFileSync(auditPath, "utf8");
			// Line-start anchor, per skills/post-craft/SKILL.md §4.1 point 2's explicit flag: this
			// must not match lsc-critic's own embedded "**VERDICT: ...**" sub-line, which appears in
			// pre-craft Stage 3's consensus-loop reports, not in post-craft's own audit document.
			const verdictMatch = auditContent.match(/^\*\*AUDIT VERDICT: (APPROVE|APPROVE-WITH-COMMENT|APPROVE-WITH-CHANGE|REJECT)\*\*/m);
			expect(verdictMatch, `audit-0.md has no line-start "**AUDIT VERDICT:" line.\n---\n${auditContent.slice(0, 2000)}`).not.toBeNull();
			// The Deterministic Check item (§4.1 point 6) requires a log excerpt IN THE AUDIT DOC
			// ITSELF — check/logs/ is gitignored (C7 BL2) and does not survive land, so the excerpt
			// is the only durable trace once the worktree is gone. Check for it regardless of land.
			expect(auditContent, "audit-0.md's Deterministic Check item must reference a check-N.log excerpt (§4.1 point 6)").toMatch(/check-\d+\.log/);

			// While the worktree still exists (not landed, or this cycle's verdict didn't land), the
			// raw check/logs/check-N.log is directly observable — assert its actual pass transcript.
			if (!landed) {
				const checkLogsDir = join(craftDir, "check", "logs");
				expect(existsSync(checkLogsDir), `check/logs/ missing at ${checkLogsDir}.\n${debugSummary(postCraftResult)}`).toBe(true);
				const checkLogs = readdirSync(checkLogsDir).filter(name => /^check-\d+\.log$/.test(name));
				expect(checkLogs.length, `no check-N.log found under ${checkLogsDir}.\n${debugSummary(postCraftResult)}`).toBeGreaterThanOrEqual(1);
				const passingLog = checkLogs.some(name => readFileSync(join(checkLogsDir, name), "utf8").includes("--- exit 0 ---"));
				expect(passingLog, `no check-N.log under ${checkLogsDir} shows a passing (--- exit 0 ---) run.\n${debugSummary(postCraftResult)}`).toBe(true);
			}

			// Order: audit-0.md written no earlier than craft's own tip commit.
			expect(statSync(auditPath).mtimeMs, "audit-0.md must be written after craft's own commits").toBeGreaterThanOrEqual(statSync(runCheckPath).mtimeMs);

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

			// Post-land visibility: the merge must have brought artifacts, implementation, the check
			// entrypoint, and the audit onto the base branch — `.lsc/crafts/{feature}` (empty
			// pre-land per AC5 above) now exists directly under the project root, with the same
			// trace.md/check/run_check.sh/audit-0.md the worktree had. check/logs/ is intentionally
			// NOT asserted here — it is gitignored and does not survive land (see above).
			const postLandFeatures = listCraftFeatures(projectDir);
			expect(
				postLandFeatures,
				`base branch does not see .lsc/crafts/${feature} after land.\n${JSON.stringify(postLandFeatures)}`,
			).toContain(feature);
			const landedCraftDir = join(projectDir, ".lsc", "crafts", feature);
			expect(existsSync(join(landedCraftDir, "trace.md")), "trace.md not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "plan.md")), "plan.md not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "check", "run_check.sh")), "check/run_check.sh not visible on base branch after land").toBe(true);
			expect(existsSync(join(landedCraftDir, "audit", "audit-0.md")), "audit/audit-0.md not visible on base branch after land").toBe(true);
		},
		TEST_TIMEOUT_MS,
	);
});
