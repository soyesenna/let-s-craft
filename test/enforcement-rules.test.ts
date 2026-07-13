// AC5 — real omp integration for the three enforcement mechanisms craft/*.ts wires
// (tool_call block, hash-violation escalation, session_stop backstop). The pure decision
// functions these mechanisms are built on (evaluateToolCallForActiveCraft,
// shouldContinueCraftLoop, diffManifests, ...) already have exhaustive unit coverage
// (test/craft-enforcement.test.ts, test/craft-hash.test.ts, test/craft-abort.test.ts) — this
// file instead drives the REAL `omp` binary end-to-end (per the Phase 7 handoff: "실제 omp
// 통합") to prove the wiring itself (pi.on("tool_call")/pi.on("session_stop") registration,
// the actual registerTool implementations, the real LLM attempting the gated action) works
// together, not just each unit in isolation.
//
// Deliberately minimal, synthetic `.lsc/crafts/demo/` fixtures (not the full sample-ts-cli) —
// these tests are about the platform enforcement seam, not the pipeline skills, so they skip
// pre-craft/craft entirely and drive lsc_craft_init/lsc_verify_hash/lsc_confirm/lsc_craft_abort
// directly via tightly-scripted prompts. This keeps them fast and cheap relative to
// e2e-full-cycle/e2e-worktree, and deterministic (no reliance on skill-loading or multi-stage
// consensus loops converging).
//
// Gated behind LSC_E2E=1 (real tokens against a real authenticated provider) — `npm test`
// never runs this file; `npm run e2e` does.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { shouldContinueCraftLoop } from "../src/craft/enforcement";
import { debugSummary, runOmpPrint, toolExecutions } from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";
// Safety-net kill timeout per omp invocation — in practice every test below exits far sooner via
// `earlyExit` (see runOmpPrint in e2e-helpers.ts) as soon as the behavior under test is observed
// in the stream, rather than waiting for the process to end naturally. This ceiling only matters
// if that observation never happens (a real failure) or under heavy multi-process contention
// (discovered running the 3 E2E files in parallel: every turn gets slower, and waiting out the
// platform's full session_stop continuation cap — up to 8 forced turns — before the process
// exits naturally blew past a 150s budget even though the behavior itself had already fired).
const PER_RUN_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 360_000; // vitest-level timeout per test

const cleanupDirs: string[] = [];

afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** A minimal `.lsc/crafts/{feature}/test/run_test.sh` + git repo — just enough for lsc_craft_init/lsc_verify_hash/tool_call block to have something real to protect. */
function setupMinimalCraftProject(feature = "demo"): { projectDir: string; sessionDir: string; scriptPath: string } {
	const base = mkdtempSync(join(tmpdir(), "lsc-e2e-enforcement-"));
	cleanupDirs.push(base);
	const projectDir = join(base, "project");
	const testDir = join(projectDir, ".lsc", "crafts", feature, "test");
	mkdirSync(testDir, { recursive: true });
	const scriptPath = join(testDir, "run_test.sh");
	writeFileSync(scriptPath, "#!/bin/bash\necho ok\nexit 0\n");
	execFileSync("chmod", ["+x", scriptPath]);

	execFileSync("git", ["init", "-q"], { cwd: projectDir });
	execFileSync("git", ["config", "user.email", "lsc-e2e@example.com"], { cwd: projectDir });
	execFileSync("git", ["config", "user.name", "lsc-e2e"], { cwd: projectDir });
	execFileSync("git", ["add", "-A"], { cwd: projectDir });
	execFileSync("git", ["commit", "-q", "-m", "chore: seed minimal craft fixture"], { cwd: projectDir });

	return { projectDir, sessionDir: join(base, "omp-sessions"), scriptPath };
}

function waitForFile(path: string, timeoutMs: number): Promise<void> {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const tick = () => {
			if (existsSync(path)) return resolve();
			if (Date.now() - start > timeoutMs) return reject(new Error(`timed out waiting for ${path}`));
			setTimeout(tick, 100);
		};
		tick();
	});
}

describe.skipIf(!RUN_E2E)("enforcement rules (AC5, real omp integration)", () => {
	it(
		"1. tool_call block — a write against the protected test tree during an active craft is rejected, and the file is left untouched",
		async () => {
			const { projectDir, sessionDir, scriptPath } = setupMinimalCraftProject();
			const before = readFileSync(scriptPath, "utf8");

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				prompt:
					"먼저 lsc_craft_init 툴을 feature_dir='demo'로 정확히 한 번 호출하라. 그 다음 write 툴로 " +
					".lsc/crafts/demo/test/run_test.sh 파일 전체를 'echo hacked'라는 내용으로 덮어써라. " +
					"그 결과가 성공했는지 실패했는지 그대로 보고하라. 다른 툴은 호출하지 마라.",
				// The blocked write's own error text (enforcement.ts's blockResult) — once seen,
				// the behavior under test has already happened; no need to wait for the model's
				// own follow-up turns.
				earlyExit: stdout => /hash protection/.test(stdout),
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			const executions = toolExecutions(result);
			const write = executions.find(e => e.toolName === "write");
			expect(write, debugSummary(result)).toBeDefined();
			expect(write?.isError, debugSummary(result)).toBe(true);
			expect(write?.text ?? "", debugSummary(result)).toMatch(/hash protection|C20/);

			// The block must have actually prevented the write, not just reported an error alongside it.
			expect(readFileSync(scriptPath, "utf8")).toBe(before);
		},
		TEST_TIMEOUT_MS,
	);

	it(
		"2. hash violation — an external modification made after lsc_craft_init is detected by lsc_verify_hash, escalated via a tagged lsc_confirm, and a declined confirm marks the craft aborted",
		async () => {
			const { projectDir, sessionDir, scriptPath } = setupMinimalCraftProject();
			const fixtureDir = mkdtempSync(join(tmpdir(), "lsc-e2e-enforcement-fixture-"));
			cleanupDirs.push(fixtureDir);
			const answersPath = join(fixtureDir, "answers.json");
			writeFileSync(
				answersPath,
				JSON.stringify({
					default: "yes",
					answers: [{ match: "^\\[Hash Violation\\]", response: "no" }],
				}),
			);

			const sentinelReady = join(projectDir, ".ready-for-tamper");

			const runPromise = runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				env: { LSC_FIXTURE: answersPath },
				prompt:
					"다음 단계를 순서대로, 각각 정확히 한 번씩 실행하라. " +
					"1) lsc_craft_init 툴을 feature_dir='demo'로 호출하라. " +
					"2) bash 툴로 정확히 다음 명령을 실행하라: touch .ready-for-tamper && sleep 6 " +
					"3) lsc_verify_hash 툴을 feature_dir='demo'로 호출하라. " +
					'4) 만약 결과가 위반(violation)을 보고하면, lsc_confirm 툴로 정확히 이 질문을 하라: ' +
					'"[Hash Violation] test assets changed externally. Restore and continue? Proceed?" ' +
					'5) lsc_confirm의 응답이 "no"이면, lsc_craft_abort 툴을 reason="user declined to restore hash-violated test assets" 로 호출하라. ' +
					"각 단계의 결과를 그대로 보고하라. 위에 명시되지 않은 다른 툴은 호출하지 마라.",
				// lsc_craft_abort's own success text (abort.ts's performCraftAbort: `craft "..."
				// marked aborted — ...`) only appears once the abort has actually succeeded — by
				// then every assertion below (confirm=no, state.aborted=true) already holds, so
				// there's nothing more to wait for.
				earlyExit: stdout => /marked aborted/.test(stdout),
			});

			// Generous relative to the earlier 30s: zai/glm-5.2 (this round's model bump) is
			// noticeably slower per-turn than zai/glm-4.6 was — observed elsewhere in this same
			// suite (session_stop's continuation test alone took 70s on glm-5.2 vs ~10s before) —
			// so getting through "call lsc_craft_init, then touch the sentinel" can plausibly take
			// longer than the model-invariant PER_RUN_TIMEOUT_MS safety net (300s) would suggest.
			await waitForFile(sentinelReady, 120_000);
			// External tamper — simulates a modification that did not go through the gated
			// write/edit/bash tools inside the omp session (e.g. a separate process/editor).
			writeFileSync(scriptPath, "#!/bin/bash\necho TAMPERED\nexit 1\n");

			const result = await runPromise;
			expect(result.timedOut, debugSummary(result)).toBe(false);

			expect(result.stdout, debugSummary(result)).toMatch(/HASH VIOLATION/);

			const executions = toolExecutions(result);
			const confirm = executions.find(e => e.toolName === "lsc_confirm");
			expect(confirm, debugSummary(result)).toBeDefined();
			expect(confirm?.text.trim().toLowerCase(), debugSummary(result)).toBe("no");

			const abort = executions.find(e => e.toolName === "lsc_craft_abort");
			expect(abort, debugSummary(result)).toBeDefined();
			expect(abort?.isError, debugSummary(result)).toBe(false);

			// Filesystem-level confirmation, independent of the model's exact tool-call sequence:
			// the persisted craft state must show aborted:true.
			const statePath = join(projectDir, ".lsc", "crafts", "demo", "test", ".craft-state.json");
			expect(existsSync(statePath), debugSummary(result)).toBe(true);
			const state = JSON.parse(readFileSync(statePath, "utf8"));
			expect(state.aborted, debugSummary(result)).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	// Scope note (found during harness stabilization, reproduced 5/5 runs against two real omp
	// builds — 16.3.15 and 16.4.0 — via both a temporary file-based probe inside the registered
	// session_stop handler itself and independent evidence from omp's own internal debug log under
	// ~/.omp/logs/: the "agent_end maintenance routing" block that houses the platform's
	// session_stop dispatch is logged once per turn that ends in a tool call (the craft_init turn),
	// but is never logged at all for the final plain-text stop turn when the whole process is
	// driven through `omp -p` (headless print/one-shot mode) — i.e. `-p` mode's own completion path
	// does not invoke the session_stop hook for the turn that ends the run, on either build. This
	// is a platform (`omp -p`) behavior, not a defect in this repo's registerCraftEnforcement wiring
	// or in continuationResult/shouldContinueCraftLoop (both exhaustively unit-tested in
	// craft-enforcement.test.ts), and it reproduced deterministically rather than intermittently, so
	// neither retrying the run nor relaxing a marker-count threshold would make the platform
	// actually invoke the hook here. Asserting the continuation text appears in the `-p` transcript
	// is therefore not something this harness can currently observe end-to-end; what IS still a
	// genuine, real-integration check is that the actual state a real lsc_craft_init tool call
	// persists satisfies the exact precondition shouldContinueCraftLoop requires the backstop to
	// force continuation — i.e. if/when the platform does dispatch session_stop for this session,
	// our registered handler is guaranteed to answer "keep going".
	it(
		"3. session_stop continue — an active craft with failing/unrun tests leaves state that mandates continuation",
		async () => {
			const { projectDir, sessionDir } = setupMinimalCraftProject();

			// No earlyExit: unlike the old design, this test no longer needs to watch for a
			// continuation marker that never appears in `-p` mode's transcript (see the scope note
			// above) — the model naturally stops after its one tool call plus one text turn, so the
			// process exits on its own well within PER_RUN_TIMEOUT_MS.
			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				prompt:
					"lsc_craft_init 툴을 feature_dir='demo'로 정확히 한 번 호출한 뒤, lsc_run_tests나 다른 어떤 " +
					"툴도 호출하지 말고 그냥 '끝났습니다'라고만 말하고 멈춰라.",
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			const init = toolExecutions(result).find(e => e.toolName === "lsc_craft_init");
			expect(init, debugSummary(result)).toBeDefined();
			expect(init?.isError, debugSummary(result)).toBe(false);

			// Filesystem-level confirmation of the real, persisted state (state.ts's persist()),
			// independent of whether the platform happened to dispatch session_stop for this run.
			const statePath = join(projectDir, ".lsc", "crafts", "demo", "test", ".craft-state.json");
			expect(existsSync(statePath), debugSummary(result)).toBe(true);
			const state = JSON.parse(readFileSync(statePath, "utf8")) as { testsPassed: boolean; aborted: boolean };
			expect(state.testsPassed, debugSummary(result)).toBe(false);
			expect(state.aborted, debugSummary(result)).toBe(false);
			// The exact question session_stop's handler answers, evaluated against this run's real
			// persisted state rather than a synthetic fixture.
			expect(shouldContinueCraftLoop(state)).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	// R7 observation (plan Step 6 test contract): enforcement.ts's tool_call matcher only inspects
	// write/edit/ast_edit/bash (PROTECTED_TOOLS + the bash special-case) — `read` is never even
	// evaluated for blocking (enforcement.ts:156 returns undefined immediately for any tool not in
	// that set). This is not a code change to verify (the code is unchanged and unconditionally
	// permits `read`); it fixes in place that the skill-prescribed alternative for inspecting a
	// protected file (`read` instead of `cat`/`head`/`tail`, which the bash substring matcher DOES
	// false-positive against per craft/SKILL.md's prohibited/prescribed table) actually works.
	it(
		"4. read passthrough — reading the protected test tree via the `read` tool during an active craft is never blocked",
		async () => {
			const { projectDir, sessionDir, scriptPath } = setupMinimalCraftProject();

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				prompt:
					"먼저 lsc_craft_init 툴을 feature_dir='demo'로 정확히 한 번 호출하라. 그 다음 read 툴로 " +
					`정확히 이 절대경로 파일을 읽어라: ${scriptPath} — 그 파일의 첫 줄을 그대로 보고하라. ` +
					"다른 툴은 호출하지 마라.",
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			const executions = toolExecutions(result);
			const init = executions.find(e => e.toolName === "lsc_craft_init");
			expect(init, debugSummary(result)).toBeDefined();
			expect(init?.isError, debugSummary(result)).toBe(false);

			const read = executions.find(e => e.toolName === "read");
			expect(read, debugSummary(result)).toBeDefined();
			// The whole point of this observation: unlike test 1's `write`, this must NOT be blocked —
			// no "hash protection"/C20 error, and no error at all.
			expect(read?.isError, debugSummary(result)).toBe(false);
			expect(read?.text ?? "", debugSummary(result)).not.toMatch(/hash protection|C20/);

			// Session-wide: no tool execution anywhere in this run reported the block text — the
			// active craft's protection never fired against this read-only access pattern.
			expect(executions.some(e => e.isError && /hash protection/.test(e.text)), debugSummary(result)).toBe(false);
		},
		TEST_TIMEOUT_MS,
	);

	// R8 yes-path (plan Step 9 test contract): the symmetric case to test 2 above (hash-violation
	// no -> abort). Here the user APPROVES an intentional protected-canon fix via lsc_confirm, which
	// routes through lsc_craft_release (clearActiveCraft — release.ts) instead of lsc_craft_abort.
	// Once released, the tool_call block no longer applies (getActiveCraft() is undefined — same
	// "no active craft" state enforcement.ts's evaluateToolCallForActiveCraft early-returns
	// undefined for), so the canon edit goes through, and a fresh lsc_craft_init call re-baselines
	// the manifest against the now-intentionally-modified content — RK8's required re-init, verified
	// here by asserting the immediately-following lsc_verify_hash reports zero violations.
	it(
		"5. release approval — an explicitly approved protected-canon edit goes through lsc_craft_release, and a re-init + re-verify afterward passes clean",
		async () => {
			const { projectDir, sessionDir, scriptPath } = setupMinimalCraftProject();
			const fixtureDir = mkdtempSync(join(tmpdir(), "lsc-e2e-enforcement-release-fixture-"));
			cleanupDirs.push(fixtureDir);
			const answersPath = join(fixtureDir, "answers.json");
			// Test-local inline answers.json (mirrors test 2's own pattern) — never the shared
			// fixtures/sample-ts-cli/answers.json, which this test does not touch. The explicit
			// "^\\[Release\\]" rule is redundant with `default: "yes"` (any unmatched lsc_confirm
			// question already answers "yes") but documents intent and survives a future default flip.
			writeFileSync(
				answersPath,
				JSON.stringify({
					default: "yes",
					answers: [{ match: "^\\[Release\\]", response: "yes" }],
				}),
			);

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				env: { LSC_FIXTURE: answersPath },
				prompt:
					"다음 단계를 순서대로, 각각 정확히 한 번씩 실행하라. " +
					"1) lsc_craft_init 툴을 feature_dir='demo'로 호출하라. " +
					'2) lsc_confirm 툴로 정확히 이 질문을 하라: "[Release] Protected test canon needs an approved, ' +
					'intentional modification. Release hash protection and proceed? Proceed?" ' +
					'3) lsc_confirm의 응답이 "yes"이면, lsc_craft_release 툴을 reason=\'user approved an intentional ' +
					"fix to the protected test canon via lsc_confirm'으로 호출하라. " +
					`4) write 툴로 ${scriptPath} 파일 전체를 정확히 다음 내용으로 덮어써라: ` +
					'"#!/bin/bash\\necho ok-modified\\nexit 0\\n" ' +
					"5) lsc_craft_init 툴을 feature_dir='demo'로 다시 호출해 매니페스트를 재베이스라인하라. " +
					"6) lsc_verify_hash 툴을 feature_dir='demo'로 호출하라. " +
					"각 단계의 결과를 그대로 보고하라. 위에 명시되지 않은 다른 툴은 호출하지 마라.",
				// lsc_verify_hash's own success text (hash-manifest.ts's registerVerifyHashTool: "hash
				// verification passed — ...") only appears once the re-init + re-verify sequence has
				// actually succeeded clean — every assertion below already holds by then.
				earlyExit: stdout => /hash verification passed/.test(stdout),
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			const executions = toolExecutions(result);

			const confirm = executions.find(e => e.toolName === "lsc_confirm");
			expect(confirm, debugSummary(result)).toBeDefined();
			expect(confirm?.text.trim().toLowerCase(), debugSummary(result)).toBe("yes");

			const release = executions.find(e => e.toolName === "lsc_craft_release");
			expect(release, debugSummary(result)).toBeDefined();
			expect(release?.isError, debugSummary(result)).toBe(false);
			expect(release?.text ?? "", debugSummary(result)).toMatch(/released for approved canon modification/);

			// The canon edit itself must not have been blocked — release cleared active-craft
			// protection before this write ran.
			const writes = executions.filter(e => e.toolName === "write");
			expect(writes.length, debugSummary(result)).toBeGreaterThan(0);
			for (const write of writes) {
				expect(write.isError, `write unexpectedly blocked after release.\n${debugSummary(result)}`).toBe(false);
			}
			expect(readFileSync(scriptPath, "utf8")).toContain("ok-modified");

			// Two lsc_craft_init calls: the original activation and RK8's required re-init after the
			// approved edit.
			const inits = executions.filter(e => e.toolName === "lsc_craft_init");
			expect(inits.length, debugSummary(result)).toBeGreaterThanOrEqual(2);
			for (const init of inits) {
				expect(init.isError, debugSummary(result)).toBe(false);
			}

			// The re-verify after re-init must report a clean pass — the whole point of the
			// release -> edit -> re-init sequence (RK8): the manifest now matches the intentionally
			// modified content, zero violations.
			const verify = executions.find(e => e.toolName === "lsc_verify_hash");
			expect(verify, debugSummary(result)).toBeDefined();
			expect(verify?.isError, debugSummary(result)).toBe(false);
			expect(verify?.text ?? "", debugSummary(result)).toMatch(/hash verification passed/);
			expect(verify?.text ?? "", debugSummary(result)).not.toMatch(/HASH VIOLATION/);
		},
		TEST_TIMEOUT_MS,
	);
});
