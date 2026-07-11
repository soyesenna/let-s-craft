// AC7 — the "완전 자동 E2E" acceptance criterion. Drives the real `omp` binary headlessly
// through the whole pipeline against the bundled `fixtures/sample-ts-cli` sample: pre-craft
// (fixture-mode research stub, Task A) → craft (bounded executor loop, Task B) → post-craft.
// Every human-facing question routes through lsc_ask/lsc_select/lsc_confirm, answered by
// `fixtures/sample-ts-cli/answers.json` via LSC_FIXTURE — no interactive UI is touched.
//
// Per the plan's §2.4 caveat (also restated in each pipeline SKILL.md and the spec's AC3a-3d
// rows): this test asserts artifact EXISTENCE, WRITE ORDER, and the literal post-craft VERDICT
// LINE — never semantic quality (whether the trace's reasoning is good, whether the spec's
// ambiguity is genuinely <5%, whether the audit's judgment is correct). That is intentional,
// not an oversight: those properties are non-deterministic LLM judgment calls that a fixture
// run against a cheap, fast model cannot and should not be expected to guarantee.
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
	runOmpPrint,
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
const PRE_CRAFT_TIMEOUT_MS = 90 * 60_000;
const CRAFT_TIMEOUT_MS = 40 * 60_000;
const POST_CRAFT_TIMEOUT_MS = 25 * 60_000;
const TEST_TIMEOUT_MS = 170 * 60_000;

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

describe.skipIf(!RUN_E2E)("full cycle E2E (AC7): pre-craft → craft → post-craft", () => {
	it(
		"produces trace.md → spec.md → plan.md → test/ in order, a passing run_test.sh after craft, and audit-0.md with a verdict line after post-craft",
		async () => {
			const { base, projectDir, answersPath, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);
			const fixtureEnv = { LSC_FIXTURE: answersPath };

			// ---- Stage 1: pre-craft ----
			const preCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: PRE_CRAFT_TIMEOUT_MS,
				prompt: `/skill:pre-craft ${FEATURE_DESCRIPTION} Do not use a worktree. ${FIXTURE_NOTE}`,
			});
			expect(preCraftResult.timedOut, `pre-craft timed out.\n${debugSummary(preCraftResult)}`).toBe(false);

			const features = listCraftFeatures(projectDir);
			expect(features.length, `expected exactly one .lsc/crafts/{feature} dir, found ${JSON.stringify(features)}.\n${debugSummary(preCraftResult)}`).toBe(1);
			const feature = features[0];
			const craftDir = join(projectDir, ".lsc", "crafts", feature);

			const tracePath = join(craftDir, "trace.md");
			const specPath = join(craftDir, "spec.md");
			const planPath = join(craftDir, "plan.md");
			const testDir = join(craftDir, "test");
			const runTestPath = join(testDir, "run_test.sh");

			expect(existsSync(tracePath), `trace.md missing.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(specPath), `spec.md missing.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(planPath), `plan.md missing.\n${debugSummary(preCraftResult)}`).toBe(true);
			expect(existsSync(runTestPath), `test/run_test.sh missing.\n${debugSummary(preCraftResult)}`).toBe(true);

			// Write order: trace -> spec -> plan -> test (C14's fixed sub-stage order), via mtime.
			const traceMtime = statSync(tracePath).mtimeMs;
			const specMtime = statSync(specPath).mtimeMs;
			const planMtime = statSync(planPath).mtimeMs;
			const testMtime = statSync(runTestPath).mtimeMs;
			expect(traceMtime, "trace.md must be written no later than spec.md").toBeLessThanOrEqual(specMtime);
			expect(specMtime, "spec.md must be written no later than plan.md").toBeLessThanOrEqual(planMtime);
			expect(planMtime, "plan.md must be written no later than test/run_test.sh").toBeLessThanOrEqual(testMtime);

			// ---- Stage 2: craft ----
			const craftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: CRAFT_TIMEOUT_MS,
				prompt: `/skill:craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
			});
			expect(craftResult.timedOut, `craft timed out.\n${debugSummary(craftResult)}`).toBe(false);

			// Independent re-verification, not trust in the LLM's self-report (mirrors post-craft's
			// own §3.4 "never trust .craft-state.json alone" philosophy) — actually execute
			// run_test.sh ourselves and check its real exit code.
			execFileSync("chmod", ["+x", runTestPath]);
			const rerun = spawnSync("bash", [runTestPath], { cwd: projectDir, encoding: "utf8" });
			expect(
				rerun.status,
				`run_test.sh did not exit 0 after craft (status=${rerun.status}).\nstdout:\n${rerun.stdout}\nstderr:\n${rerun.stderr}\n\n${debugSummary(craftResult)}`,
			).toBe(0);

			// ---- Stage 3: post-craft ----
			const postCraftResult = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				env: fixtureEnv,
				timeoutMs: POST_CRAFT_TIMEOUT_MS,
				prompt: `/skill:post-craft .lsc/crafts/${feature}/ ${FIXTURE_NOTE}`,
			});
			expect(postCraftResult.timedOut, `post-craft timed out.\n${debugSummary(postCraftResult)}`).toBe(false);

			const auditPath = join(craftDir, "audit", "audit-0.md");
			expect(existsSync(auditPath), `audit/audit-0.md missing.\n${debugSummary(postCraftResult)}`).toBe(true);
			const auditContent = readFileSync(auditPath, "utf8");
			// Line-start anchor, per skills/post-craft/SKILL.md §4.1 point 2's explicit flag: this
			// must not match lsc-critic's own embedded "**VERDICT: ...**" sub-line quoted later in
			// the same document.
			expect(
				auditContent,
				`audit-0.md has no line-start "**AUDIT VERDICT:" line.\n---\n${auditContent.slice(0, 2000)}`,
			).toMatch(/^\*\*AUDIT VERDICT: (APPROVE|APPROVE-WITH-COMMENT|APPROVE-WITH-CHANGE|REJECT)\*\*/m);

			// Order: audit-0.md written no earlier than the (already-passing) test/run_test.sh from craft.
			expect(statSync(auditPath).mtimeMs, "audit-0.md must be written after craft's test/ output").toBeGreaterThanOrEqual(testMtime);
		},
		TEST_TIMEOUT_MS,
	);
});
