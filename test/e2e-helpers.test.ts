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
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendBounded,
	attachOmpRunHandlers,
	auditBeginOutcomes,
	completedTaskSpawnSeen,
	type OmpRunResult,
	pinLetsCraftPluginToRepo,
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

	// R5 always-worktree: pre-craft writes every artifact inside `.lsc/worktrees/{feature}/.lsc/crafts/{feature}/`,
	// never directly under the project root's `.lsc/crafts/` (that stays empty until land — AC5 base-purity).
	// No `test/` seeding anymore (C5/C8) — pre-craft's three artifacts are trace/spec/plan only.
	function seedCraftDir(projectDir: string, feature: string, files: { trace?: boolean; spec?: boolean; plan?: boolean }): void {
		const craftDir = join(projectDir, ".lsc", "worktrees", feature, ".lsc", "crafts", feature);
		mkdirSync(craftDir, { recursive: true });
		if (files.trace) writeFileSync(join(craftDir, "trace.md"), "");
		if (files.spec) writeFileSync(join(craftDir, "spec.md"), "");
		if (files.plan) writeFileSync(join(craftDir, "plan.md"), "");
	}

	it("is false when no .lsc/worktrees/{feature} directory exists yet", () => {
		expect(preCraftArtifactsComplete(tmpProjectDir())).toBe(false);
	});

	it("is false when more than one .lsc/worktrees/{feature} directory exists (ambiguous, never treated as complete)", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "feature-a", { trace: true, spec: true, plan: true });
		seedCraftDir(projectDir, "feature-b", { trace: true, spec: true, plan: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(false);
	});

	it("is false when any single one of trace.md/spec.md/plan.md is missing", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "demo", { trace: true, spec: false, plan: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(false);
	});

	it("is true once trace.md, spec.md, and plan.md all exist", () => {
		const projectDir = tmpProjectDir();
		seedCraftDir(projectDir, "demo", { trace: true, spec: true, plan: true });
		expect(preCraftArtifactsComplete(projectDir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// audit-0 RF-7/RF-8 — stream-predicate helpers the escalation/red-cycle E2E suites
// early-exit on. Same no-real-process, `npm test`-runs philosophy as above: the
// ordered-tuple parse (RF-7) and the completed-task probe (RF-8) are exercised
// against synthetic NDJSON streams, never a real `omp` child.
// ---------------------------------------------------------------------------

describe("auditBeginOutcomes (RF-7)", () => {
	/** A synthetic `tool_execution_end` NDJSON line carrying the given begin result text. */
	function beginEndLine(text: string, isError: boolean): string {
		return JSON.stringify({ type: "tool_execution_end", toolName: "write", isError, result: { content: [{ type: "text", text }] } });
	}

	it("returns the isError flags of completed begin executions in ORDER — the exact [isError, success] tuple the plan's Continue predicate fixes", () => {
		const stdout = [
			beginEndLine("lets-craft: audit escalation required for demo at cycle 2 — ask the disposition question", true),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "lets-craft: audit (a model message quoting a result — never an execution)" }] } }),
			beginEndLine("lets-craft: audit cycle 2 begun for demo — escalation consumed: Continue auditing", false),
		].join("\n");
		expect(auditBeginOutcomes(stdout)).toEqual([true, false]);
	});

	it("ignores non-begin tool results and unterminated trailing NDJSON lines", () => {
		const stdout = [
			beginEndLine("an unrelated write result text", false),
			beginEndLine("lets-craft: audit escalation required for demo", true),
			'{"type":"tool_execution_end","toolName":"write","isError":false,"result":{"content":[{"type":"text","text":"lets-craft: audit cycle 2 begun',
		].join("\n");
		expect(auditBeginOutcomes(stdout)).toEqual([true]);
	});
});

describe("completedTaskSpawnSeen (RF-8)", () => {
	it("is FALSE for a task execution START event alone — the raw toolName substring this replaces fired on exactly this line, before the spawn's result existed", () => {
		const stdout = JSON.stringify({ type: "tool_execution_start", toolName: "task", args: { agent: "lsc-test-engineer" } });
		// Reproduce the retired arm's false fire first, so the regression pins the actual difference.
		expect(stdout.includes('"toolName":"task"')).toBe(true);
		expect(completedTaskSpawnSeen(stdout)).toBe(false);
	});

	it("is TRUE once a task execution END event has streamed back", () => {
		const stdout = [
			JSON.stringify({ type: "tool_execution_start", toolName: "task", args: { agent: "lsc-test-engineer" } }),
			JSON.stringify({ type: "tool_execution_end", toolName: "task", isError: false, result: { content: [{ type: "text", text: "spawn delivered" }] } }),
		].join("\n");
		expect(completedTaskSpawnSeen(stdout)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// audit-1 RF-18 — pinLetsCraftPluginToRepo's link-slot boundary shapes. The seams
// (linkPath/repoRoot/linkPlugin) let these run against a temp git repo and a temp link slot
// with a FAKE `omp plugin link` (a symlink writer), so the three boundaries (missing → created
// / wrong-target → re-pointed / correct → no-op) and every fail-closed refusal branch are
// covered without the real global slot, the omp binary, or LSC_E2E — same `npm test`-runs
// philosophy as the rest of this file.
// ---------------------------------------------------------------------------

describe("pinLetsCraftPluginToRepo (RF-18 — link-slot boundaries)", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function tmpDir(prefix: string): string {
		const dir = mkdtempSync(join(tmpdir(), prefix));
		tempDirs.push(dir);
		return dir;
	}

	function gitIn(cwd: string, args: string[]): string {
		return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	}

	/** A real git repo with one commit — the repo under test whose HEAD the build hash must match. */
	function tmpPluginRepo(): { repoRoot: string; head: string } {
		const repoRoot = tmpDir("lsc-pin-repo-");
		gitIn(repoRoot, ["init", "-q", "-b", "main"]);
		gitIn(repoRoot, ["config", "user.email", "t@t"]);
		gitIn(repoRoot, ["config", "user.name", "t"]);
		writeFileSync(join(repoRoot, "seed.txt"), "x\n");
		gitIn(repoRoot, ["add", "-A"]);
		gitIn(repoRoot, ["commit", "-q", "-m", "seed"]);
		return { repoRoot, head: gitIn(repoRoot, ["rev-parse", "--short", "HEAD"]) };
	}

	/** Write a dist/generated/version.js carrying (or omitting) BUILD_INFO.gitHash. */
	function writeVersionJs(repoRoot: string, gitHash?: string): void {
		mkdirSync(join(repoRoot, "dist", "generated"), { recursive: true });
		writeFileSync(
			join(repoRoot, "dist", "generated", "version.js"),
			gitHash === undefined ? "export const BUILD_INFO = { builtBy: 'not-a-hash' };\n" : `export const BUILD_INFO = { gitHash: "${gitHash}" };\n`,
		);
	}

	it("missing link slot (ENOENT) → takes the omp re-point, then the link resolves to the repo (missing → created)", () => {
		const { repoRoot, head } = tmpPluginRepo();
		writeVersionJs(repoRoot, head);
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		let linkCalls = 0;
		const linkPlugin = (root: string): void => {
			linkCalls += 1;
			symlinkSync(root, linkPath);
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).not.toThrow();
		expect(linkCalls).toBe(1);
		expect(readlinkSync(linkPath)).toBe(repoRoot);
	});

	it("a symlink pointing at ANOTHER target is not pinned → re-pointed to the repo (wrong-target → 재지정)", () => {
		const { repoRoot, head } = tmpPluginRepo();
		writeVersionJs(repoRoot, head);
		const slotDir = tmpDir("lsc-pin-slot-");
		const linkPath = join(slotDir, "lets-craft");
		symlinkSync(tmpDir("lsc-pin-other-"), linkPath); // a dangling-elsewhere or foreign-target link
		let linkCalls = 0;
		const linkPlugin = (root: string): void => {
			linkCalls += 1;
			rmSync(linkPath, { force: true });
			symlinkSync(root, linkPath);
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).not.toThrow();
		expect(linkCalls).toBe(1);
		expect(readlinkSync(linkPath)).toBe(repoRoot);
	});

	it("a NON-symlink occupying the slot (EINVAL from readlinkSync) is not pinned → re-pointed the same way", () => {
		const { repoRoot, head } = tmpPluginRepo();
		writeVersionJs(repoRoot, head);
		const slotDir = tmpDir("lsc-pin-slot-");
		const linkPath = join(slotDir, "lets-craft");
		writeFileSync(linkPath, "a regular file, not a symlink\n");
		let linkCalls = 0;
		const linkPlugin = (root: string): void => {
			linkCalls += 1;
			rmSync(linkPath, { force: true });
			symlinkSync(root, linkPath);
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).not.toThrow();
		expect(linkCalls).toBe(1);
		expect(readlinkSync(linkPath)).toBe(repoRoot);
	});

	it("an already-correct link is a no-op — the omp re-point never runs (correct → no-op)", () => {
		const { repoRoot, head } = tmpPluginRepo();
		writeVersionJs(repoRoot, head);
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		symlinkSync(repoRoot, linkPath);
		const linkPlugin = (): void => {
			throw new Error("omp plugin link must not run when the slot already resolves to the repo");
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).not.toThrow();
		expect(readlinkSync(linkPath)).toBe(repoRoot);
	});

	it("a re-point that leaves the link unresolved fails closed — the descriptive refusal, never a raw ENOENT leak", () => {
		const { repoRoot } = tmpPluginRepo();
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		const linkPlugin = (): void => {
			// simulates `omp plugin link` failing without creating the slot
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).toThrow("does not resolve to this repo");
	});

	it("no built dist/generated/version.js fails closed before any spawn (dist 부재 throw)", () => {
		const { repoRoot } = tmpPluginRepo();
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		symlinkSync(repoRoot, linkPath);

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin: () => {} })).toThrow("no built plugin");
	});

	it("a BUILD_INFO.gitHash that is not the repo HEAD fails closed (해시 불일치 throw)", () => {
		const { repoRoot } = tmpPluginRepo();
		writeVersionJs(repoRoot, "deadbee");
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		symlinkSync(repoRoot, linkPath);

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin: () => {} })).toThrow("plugin-build/HEAD mismatch");
	});

	it("a version.js whose hash the regex cannot parse is reported as (unparsed), never as a pass (unparsed arm)", () => {
		const { repoRoot } = tmpPluginRepo();
		writeVersionJs(repoRoot); // BUILD_INFO without a gitHash field
		const linkPath = join(tmpDir("lsc-pin-slot-"), "lets-craft");
		symlinkSync(repoRoot, linkPath);

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin: () => {} })).toThrow("(unparsed)");
	});
});
