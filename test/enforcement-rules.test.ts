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
import { E2E_MAIN_MODEL, type OmpRunResult, debugSummary, runOmpPrint, toolExecutions } from "./e2e-helpers";

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

			await waitForFile(sentinelReady, 30_000);
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

	it(
		"3. session_stop continue — an active craft with failing/unrun tests forces the session to keep going instead of stopping",
		async () => {
			const { projectDir, sessionDir } = setupMinimalCraftProject();

			// Match count, not just presence — kept as a named function (not inline in earlyExit)
			// so the post-hoc assertion below can reuse the exact same counting logic.
			const CONTINUATION_MARKER = /has not passed run_test\.sh yet — continue the craft loop/g;
			const continuationCount = (stdout: string) => (stdout.match(CONTINUATION_MARKER) ?? []).length;

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				prompt:
					"lsc_craft_init 툴을 feature_dir='demo'로 정확히 한 번 호출한 뒤, lsc_run_tests나 다른 어떤 " +
					"툴도 호출하지 말고 그냥 '끝났습니다'라고만 말하고 멈춰라.",
				// Waiting for the process to exit naturally means waiting out the platform's full
				// session_stop continuation cap (up to 8 forced turns, agent-session.ts) — under
				// contention each turn can take tens of seconds, which blew the old fixed timeout
				// even though continuation had already, definitively, fired. 2 occurrences of the
				// exact additionalContext text (src/craft/enforcement.ts's continuationResult())
				// is already unambiguous proof the backstop forced continuation instead of letting
				// the turn end — no need to watch all 8.
				earlyExit: stdout => continuationCount(stdout) >= 2,
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			// Per R1/AC5c, this test asserts continuation FIRED (at least twice, per the earlyExit
			// condition above); the platform (not this extension) owns the cap-8 ceiling, so no
			// assertion is made about exactly how many times it fired in total.
			expect(continuationCount(result.stdout), debugSummary(result)).toBeGreaterThanOrEqual(2);

			const turnStarts = result.events.filter(e => e.type === "turn_start").length;
			expect(turnStarts, debugSummary(result)).toBeGreaterThan(1);
		},
		TEST_TIMEOUT_MS,
	);
});
