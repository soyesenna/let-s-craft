// Regression coverage for the stdout/stderr accumulation bug found from an actual ~51-minute
// worktree E2E run: every test assertion had already passed, but the harness itself crashed
// afterward with `RangeError: Invalid string length` — `stdout += chunk.toString()` kept running
// forever after the promise had already resolved, since nothing ever removed the `data` listener
// or bounded the accumulated string. These tests exercise the fix directly (appendBounded's cap
// logic, attachOmpRunHandlers' settle-then-cleanup behavior) against a fake, `EventEmitter`-based
// child process double — no real `omp` process, no LSC_E2E gate, runs as part of `npm test`.
//
// Also covers runToCompletionWith/preCraftArtifactsComplete (the pre-craft headless-early-stop
// resume logic) — same no-real-process, `npm test`-runs philosophy: the loop control is exercised
// against a fake `spawn` function, never a real `omp` child.
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendBounded,
	attachOmpRunHandlers,
	type OmpRunResult,
	preCraftArtifactsComplete,
	type RunnableChild,
	runToCompletionWith,
} from "./e2e-helpers";

describe("appendBounded", () => {
	it("appends normally when the combined length is under the cap", () => {
		expect(appendBounded("abc", "def", 100)).toBe("abcdef");
	});

	it("truncates from the front, keeping exactly the trailing maxBytes characters", () => {
		const result = appendBounded("x".repeat(10), "y".repeat(10), 15);
		expect(result.length).toBe(15);
		expect(result).toBe(`${"x".repeat(5)}${"y".repeat(10)}`);
	});

	it("never grows past the cap across many repeated appends (simulates a long-running process)", () => {
		let acc = "";
		for (let i = 0; i < 1000; i++) acc = appendBounded(acc, "z".repeat(100), 500);
		expect(acc.length).toBe(500);
		expect(acc).toBe("z".repeat(500));
	});
});

interface FakeChild extends RunnableChild {
	stdout: EventEmitter;
	stderr: EventEmitter;
	emitClose(): void;
	killCalls: Array<string | undefined>;
}

function createFakeChild(): FakeChild {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const closeListeners: Array<() => void> = [];
	let killed = false;
	const killCalls: Array<string | undefined> = [];

	const child: FakeChild = {
		stdout,
		stderr,
		on(event, listener) {
			if (event === "close") closeListeners.push(listener);
			return child;
		},
		kill(signal) {
			killed = true;
			killCalls.push(signal);
			return true;
		},
		get killed() {
			return killed;
		},
		exitCode: null,
		emitClose() {
			for (const listener of closeListeners) listener();
		},
		killCalls,
	};
	return child;
}

function run(child: FakeChild, args: Parameters<typeof attachOmpRunHandlers>[1]): Promise<OmpRunResult> {
	return new Promise(resolve => attachOmpRunHandlers(child, args, resolve));
}

describe("attachOmpRunHandlers", () => {
	it("accumulates stdout/stderr and resolves on close", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000 });
		child.stdout.emit("data", "hello ");
		child.stdout.emit("data", "world");
		child.stderr.emit("data", "warn: x");
		child.emitClose();
		const result = await resultPromise;
		expect(result.stdout).toBe("hello world");
		expect(result.stderr).toBe("warn: x");
		expect(result.timedOut).toBe(false);
	});

	it("removes the data listeners once settled, so post-close chunks are never appended (the actual regression)", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000 });
		child.stdout.emit("data", "hello world");
		child.emitClose();
		const result = await resultPromise;

		// A SIGKILL child can still emit buffered trailing chunks for a while as OS pipes drain —
		// the listener must already be gone, not merely "settled" and silently no-op-ing forever.
		expect(child.stdout.listenerCount("data")).toBe(0);
		expect(child.stderr.listenerCount("data")).toBe(0);

		child.stdout.emit("data", "MORE DATA AFTER SETTLE, REPEATED FOREVER IN THE OLD BUG");
		expect(result.stdout).toBe("hello world");
	});

	it("kills the child and marks the result timed out when timeoutMs elapses before close", async () => {
		const child = createFakeChild();
		const result = await run(child, { timeoutMs: 5 });
		expect(result.timedOut).toBe(true);
		expect(child.killCalls).toContain("SIGKILL");
	});

	it("caps accumulated stdout at maxBufferedBytes, keeping the tail (the fix for the crash)", async () => {
		const child = createFakeChild();
		// cap == the second chunk's own length, so the assertion isn't just "some a's survived
		// alongside the b's" (still correct, but a weaker signal) — it's "the entire first chunk
		// was evicted and only the second, most-recent chunk remains."
		const resultPromise = run(child, { timeoutMs: 60_000, maxBufferedBytes: 15 });
		child.stdout.emit("data", "a".repeat(15));
		child.stdout.emit("data", "b".repeat(15));
		child.emitClose();
		const result = await resultPromise;
		expect(result.stdout).toBe("b".repeat(15));
	});

	it("invokes earlyExit and, after its drain grace, resolves and kills the child without waiting for close", async () => {
		const child = createFakeChild();
		// earlyExitDrainMs: 0 — this test only cares that earlyExit eventually triggers finish, not
		// about the drain window's own timing (covered separately below), so keep it instant.
		const resultPromise = run(child, { timeoutMs: 60_000, earlyExitDrainMs: 0, earlyExit: stdout => stdout.includes("DONE") });
		child.stdout.emit("data", "working...");
		child.stdout.emit("data", "DONE");
		const result = await resultPromise;
		expect(result.timedOut).toBe(false);
		expect(result.stdout).toBe("working...DONE");
		expect(child.killCalls).toContain("SIGKILL");
		expect(child.stdout.listenerCount("data")).toBe(0);
	});

	it("waits out earlyExitDrainMs after an earlyExit match instead of settling immediately, so a chunk still in flight is not lost (the enforcement-rules.test.ts drain-race fix)", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000, earlyExitDrainMs: 20, earlyExit: stdout => stdout.includes("hash protection") });
		child.stdout.emit("data", "...hash protection...");
		// Not settled yet: the drain grace hasn't elapsed, so the child must not be killed and no
		// chunk should be lost even though earlyExit already matched.
		expect(child.killCalls.length).toBe(0);
		// A chunk that arrives mid-drain (simulating the rest of an NDJSON line still flushing)
		// must still be appended, not dropped by an immediate finish().
		child.stdout.emit("data", " rest-of-the-ndjson-line\n");
		const result = await resultPromise;
		expect(result.stdout).toBe("...hash protection... rest-of-the-ndjson-line\n");
		expect(result.timedOut).toBe(false);
		expect(child.killCalls).toContain("SIGKILL");
	});

	it("settles on a natural close that arrives during the drain window, without waiting out the full earlyExitDrainMs", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000, earlyExitDrainMs: 10_000, earlyExit: stdout => stdout.includes("DONE") });
		child.stdout.emit("data", "DONE");
		child.emitClose();
		const result = await resultPromise;
		expect(result.stdout).toBe("DONE");
		expect(result.timedOut).toBe(false);
	});

	it("ignores further earlyExit matches once already draining, so only one drain timer is ever scheduled", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000, earlyExitDrainMs: 15, earlyExit: stdout => stdout.includes("DONE") });
		child.stdout.emit("data", "DONE");
		child.stdout.emit("data", "DONE again");
		const result = await resultPromise;
		expect(result.stdout).toBe("DONEDONE again");
		expect(child.killCalls.length).toBe(1);
	});

	it("never calls resolve more than once even if close fires after a timeout already settled it", async () => {
		const child = createFakeChild();
		let resolveCount = 0;
		await new Promise<void>(done => {
			attachOmpRunHandlers(
				child,
				{ timeoutMs: 5 },
				() => {
					resolveCount++;
					done();
				},
			);
		});
		child.emitClose();
		child.emitClose();
		expect(resolveCount).toBe(1);
	});
});

function fakeResult(overrides: Partial<OmpRunResult> = {}): OmpRunResult {
	return { exitCode: 0, timedOut: false, stdout: "", stderr: "", events: [], ...overrides };
}

describe("runToCompletionWith", () => {
	it("runs once and never resumes when isComplete() is already true after the initial run", async () => {
		const calls: Array<{ prompt: string; extraArgs?: string[] }> = [];
		const spawn = async (args: { prompt: string; extraArgs?: string[] }) => {
			calls.push({ prompt: args.prompt, extraArgs: args.extraArgs });
			return fakeResult();
		};
		const result = await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 1000, prompt: "initial", isComplete: () => true, continuationPrompt: "resume" },
			spawn,
		);
		expect(calls.length).toBe(1);
		expect(calls[0].prompt).toBe("initial");
		expect(result.attempts.length).toBe(1);
		expect(result.completed).toBe(true);
		expect(result.last).toBe(result.attempts[0]);
	});

	it("resumes with --continue and the continuation prompt while incomplete, stopping the instant isComplete() flips true", async () => {
		const calls: Array<{ prompt: string; extraArgs?: string[] }> = [];
		const spawn = async (args: { prompt: string; extraArgs?: string[] }) => {
			calls.push({ prompt: args.prompt, extraArgs: args.extraArgs });
			return fakeResult();
		};
		// Driven by the real side effect (spawn calls made so far), not an invocation counter for
		// isComplete() itself — the loop is free to check isComplete() any number of times per
		// attempt without changing this test's outcome.
		const isComplete = () => calls.length >= 2;
		const result = await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 1000, prompt: "initial", isComplete, continuationPrompt: "resume please" },
			spawn,
		);
		expect(calls.length).toBe(2);
		expect(calls[0].extraArgs).toBeUndefined();
		expect(calls[1].prompt).toBe("resume please");
		expect(calls[1].extraArgs).toEqual(["--continue"]);
		expect(result.completed).toBe(true);
		expect(result.attempts.length).toBe(2);
	});

	it("stops after maxResumes even if isComplete() never becomes true", async () => {
		const spawn = async () => fakeResult();
		const result = await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 1000, prompt: "initial", isComplete: () => false, continuationPrompt: "resume", maxResumes: 2 },
			spawn,
		);
		expect(result.attempts.length).toBe(3); // 1 initial + 2 resumes
		expect(result.completed).toBe(false);
	});

	it("stops resuming the instant an attempt times out, without spending further resume budget on a hang", async () => {
		let calls = 0;
		const spawn = async () => {
			calls++;
			return fakeResult({ timedOut: calls === 2 });
		};
		const result = await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 1000, prompt: "initial", isComplete: () => false, continuationPrompt: "resume", maxResumes: 3 },
			spawn,
		);
		expect(calls).toBe(2);
		expect(result.attempts.length).toBe(2);
		expect(result.last.timedOut).toBe(true);
		expect(result.completed).toBe(false);
	});

	it("uses resumeTimeoutMs for resume attempts when given, independent of the initial timeoutMs", async () => {
		const timeouts: number[] = [];
		const spawn = async (args: { timeoutMs: number }) => {
			timeouts.push(args.timeoutMs);
			return fakeResult();
		};
		await runToCompletionWith(
			{
				cwd: "/x",
				sessionDir: "/y",
				timeoutMs: 1000,
				resumeTimeoutMs: 50,
				prompt: "initial",
				isComplete: () => timeouts.length >= 2,
				continuationPrompt: "resume",
			},
			spawn,
		);
		expect(timeouts).toEqual([1000, 50]);
	});

	it("defaults resumeTimeoutMs to timeoutMs when not given", async () => {
		const timeouts: number[] = [];
		const spawn = async (args: { timeoutMs: number }) => {
			timeouts.push(args.timeoutMs);
			return fakeResult();
		};
		await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 777, prompt: "initial", isComplete: () => timeouts.length >= 2, continuationPrompt: "resume" },
			spawn,
		);
		expect(timeouts).toEqual([777, 777]);
	});
});

describe("preCraftArtifactsComplete", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function tmpProjectDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "lsc-e2e-helpers-precraft-"));
		tempDirs.push(dir);
		return dir;
	}

	function seedCraftDir(projectDir: string, feature: string, files: { trace?: boolean; spec?: boolean; plan?: boolean; runTest?: boolean }): void {
		const craftDir = join(projectDir, ".lsc", "crafts", feature);
		mkdirSync(craftDir, { recursive: true });
		if (files.trace) writeFileSync(join(craftDir, "trace.md"), "");
		if (files.spec) writeFileSync(join(craftDir, "spec.md"), "");
		if (files.plan) writeFileSync(join(craftDir, "plan.md"), "");
		if (files.runTest) {
			const testDir = join(craftDir, "test");
			mkdirSync(testDir, { recursive: true });
			writeFileSync(join(testDir, "run_test.sh"), "");
		}
	}

	it("is false when no .lsc/crafts/{feature} directory exists yet", () => {
		expect(preCraftArtifactsComplete(tmpProjectDir())).toBe(false);
	});

	it("is false when more than one .lsc/crafts/{feature} directory exists (ambiguous, never treated as complete)", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "feature-a", { trace: true, spec: true, plan: true, runTest: true });
		seedCraftDir(projectDir, "feature-b", { trace: true, spec: true, plan: true, runTest: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(false);
	});

	it("is false when the craft dir exists but test/run_test.sh is missing (the actually observed real-run failure)", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "demo", { trace: true, spec: true, plan: true, runTest: false });
		expect(preCraftArtifactsComplete(projectDir)).toBe(false);
	});

	it("is false when any single one of trace.md/spec.md/plan.md is missing, even with run_test.sh present", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "demo", { trace: true, spec: false, plan: true, runTest: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(false);
	});

	it("is true once trace.md, spec.md, plan.md, and test/run_test.sh all exist", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "demo", { trace: true, spec: true, plan: true, runTest: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(true);
	});
});
