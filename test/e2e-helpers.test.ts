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
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	REPO_ROOT,
	appendBounded,
	attachOmpRunHandlers,
	auditBeginOutcomes,
	durableProbeThrottle,
	durableStageObservation,
	findSessionFileByPrompt,
	lastSessionFileByPrompt,
	type OmpRunResult,
	pinLetsCraftPluginToRepo,
	presetParentPreconditions,
	sessionEntryDigests,
	sessionTaskSpawns,
	sessionToolResultTexts,
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

	it("audit-4 RF-40 — reports one wall-clock duration per attempt, index-aligned with attempts", async () => {
		const spawn = async () => fakeResult();
		const result = await runToCompletionWith(
			{ cwd: "/x", sessionDir: "/y", timeoutMs: 1000, prompt: "initial", isComplete: () => false, continuationPrompt: "resume", maxResumes: 2 },
			spawn,
		);
		// One duration per attempt (initial + both resumes), each a non-negative wall-clock
		// measurement — the stage-durations evidence artifact reads exactly this array.
		expect(result.attemptDurationsMs).toHaveLength(result.attempts.length);
		expect(result.attempts.length).toBe(3);
		for (const duration of result.attemptDurationsMs) expect(duration).toBeGreaterThanOrEqual(0);
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
// audit-0 RF-7 — stream-predicate helpers the escalation/red-cycle E2E suites
// early-exit on. Same no-real-process, `npm test`-runs philosophy as above: the
// ordered-tuple parse (RF-7) is exercised against synthetic NDJSON streams,
// never a real `omp` child. (audit-4 RF-39 removed the RF-8 completed-task
// probe together with its earlyExit arm — durable records replaced it.)
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

	/**
	 * audit-3 RF-31 — an existence/content snapshot of a plugins dir's three write surfaces
	 * (`node_modules/lets-craft` slot, `omp-plugins.lock.json`, `package.json` — everything
	 * `omp plugin link` touches). Missing paths snapshot as `<absent>`; files as their bytes;
	 * a symlink slot as its target — so a before/after `toEqual` catches ANY real-user-area
	 * write the pinned-env child might have made.
	 */
	function snapshotPluginsDir(pluginsDir: string): string[] {
		const snapshotOne = (path: string): string => {
			try {
				const stat = lstatSync(path);
				if (stat.isSymbolicLink()) return `symlink -> ${readlinkSync(path)}`;
				if (stat.isFile()) return `file ${readFileSync(path, "utf8")}`;
				return "other";
			} catch {
				return "<absent>";
			}
		};
		return [join(pluginsDir, "node_modules", "lets-craft"), join(pluginsDir, "omp-plugins.lock.json"), join(pluginsDir, "package.json")].map(snapshotOne);
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

	it("a NON-symlink occupying the slot (EINVAL from readlinkSync) is not pinned → the helper normalizes it, then re-points (audit-2 RF-22)", () => {
		const { repoRoot, head } = tmpPluginRepo();
		writeVersionJs(repoRoot, head);
		const slotDir = tmpDir("lsc-pin-slot-");
		const linkPath = join(slotDir, "lets-craft");
		writeFileSync(linkPath, "a regular file, not a symlink\n");
		let linkCalls = 0;
		const linkPlugin = (root: string): void => {
			// audit-2 RF-22: the fake mimics PRODUCTION omp exactly — it does NOT clear a regular
			// file itself. With the helper's normalization removed, symlinkSync below hits EEXIST
			// and this test goes red; the helper must do the normalizing.
			linkCalls += 1;
			symlinkSync(root, linkPath);
		};

		expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin })).not.toThrow();
		expect(linkCalls).toBe(1);
		expect(readlinkSync(linkPath)).toBe(repoRoot);
	});

	it("audit-3 RF-31 (hermetic, real omp): every omp state root is pinned into the temp tree — the REAL link resolves through the pinned XDG root, and the user's actual plugin slot/lockfile are identical before/after", () => {
		// Exercises the actual production boundary this RF exists for: installed omp 18.0.11's
		// link only unlinks symlink/directory slots, so a regular file makes its `symlink` call
		// EEXIST and the CLI exit 1 (verified live on this machine). Runs during the deterministic
		// check's test stage — after `npm run build`, which the hash preflight below requires.
		//
		// audit-3 RF-31: the previous child env was `{...process.env, HOME: home}` — installed
		// omp's DirResolver (pi-utils/src/dirs.ts:339-364) prefers an EXISTING `$XDG_DATA_HOME/omp`
		// over HOME, so on an XDG-configured machine the real link re-pointed the USER's plugin
		// slot and rewrote their omp-plugins.lock.json (env-conditional: this machine has XDG
		// unset, which is why check-6 stayed green). The child env is now an ALLOWLIST: every
		// root the resolver consults (HOME, XDG_DATA_HOME, XDG_STATE_HOME, XDG_CACHE_HOME) is
		// pinned into the temp tree and no redirect knob (OMP_PROFILE / PI_PROFILE /
		// PI_CONFIG_DIR / PI_CODING_AGENT_DIR / ...) can be inherited at all. Pre-creating
		// `<xdgData>/omp/plugins/node_modules` makes the pinned XDG root EXIST, so the resolver
		// makes it authoritative over HOME — reproducing exactly the XDG-configured machine
		// class the old env leaked into, now confined to the temp tree.
		const home = tmpDir("lsc-pin-hermetic-home-");
		const xdgData = tmpDir("lsc-pin-hermetic-xdg-data-");
		const xdgState = tmpDir("lsc-pin-hermetic-xdg-state-");
		const xdgCache = tmpDir("lsc-pin-hermetic-xdg-cache-");
		mkdirSync(join(xdgData, "omp", "plugins", "node_modules"), { recursive: true });
		const slot = join(xdgData, "omp", "plugins", "node_modules", "lets-craft");
		writeFileSync(slot, "regular file residue\n"); // the shape production omp cannot unlink

		// The user's REAL plugin area on BOTH resolution axes (configRoot `~/.omp`, and
		// `$XDG_DATA_HOME/omp` when the developer exports one), snapshotted before the child
		// runs: slot, lockfile, and package.json — everything `omp plugin link` writes.
		const realPluginsDirs = [join(homedir(), ".omp", "plugins")];
		if (process.env.XDG_DATA_HOME) realPluginsDirs.push(join(process.env.XDG_DATA_HOME, "omp", "plugins"));
		const before = realPluginsDirs.map(snapshotPluginsDir);

		pinLetsCraftPluginToRepo({
			linkPath: slot,
			repoRoot: REPO_ROOT,
			linkPlugin: root => {
				execFileSync("omp", ["plugin", "link", root], {
					stdio: "pipe",
					env: {
						PATH: process.env.PATH,
						HOME: home,
						XDG_DATA_HOME: xdgData,
						XDG_STATE_HOME: xdgState,
						XDG_CACHE_HOME: xdgCache,
					},
				});
			},
		});

		expect(readlinkSync(slot), "the REAL omp must have linked through the PINNED XDG root").toBe(REPO_ROOT);
		expect(
			realPluginsDirs.map(snapshotPluginsDir),
			"the user's real plugin slot/lockfile/package.json must be identical before/after on both resolution axes (audit-3 RF-31)",
		).toEqual(before);
	});

	it("audit-3 rec ① (RF-22 잔여): a read-only slot DIRECTORY lets lstat succeed but the regular-file removal fail — the rmSync errno (EACCES/EPERM) rethrows and the omp re-point never runs", () => {
		// e2e-helpers.ts:100-106's normalization arm: only the benign TOCTOU ENOENT is
		// swallowed; a removal PERMISSION failure must propagate BEFORE `omp plugin link` ever
		// runs (the explore lane's trigger: chmod the slot dir r-x so lstat(linkPath) succeeds
		// while unlink needs the write bit). Same root-user caveat as the 0o000 test below.
		const { repoRoot } = tmpPluginRepo();
		const slotDir = tmpDir("lsc-pin-rm-eacces-");
		const linkPath = join(slotDir, "lets-craft");
		writeFileSync(linkPath, "regular file, not a symlink\n");
		let linkCalls = 0;
		chmodSync(slotDir, 0o555); // r-x: lstat OK, rmSync EACCES
		try {
			expect(() =>
				pinLetsCraftPluginToRepo({
					linkPath,
					repoRoot,
					linkPlugin: () => {
						linkCalls += 1;
					},
				}),
			).toThrow(/EACCES|EPERM/);
		} finally {
			chmodSync(slotDir, 0o700); // restore for the afterEach cleanup
		}
		expect(linkCalls, "the removal error must propagate BEFORE the omp re-point").toBe(0);
	});

	it("audit-2 rec ① (RF-22 병행): an unexpected errno from the slot read rethrows — EACCES propagates, never treated as not-pinned", () => {
		const { repoRoot } = tmpPluginRepo();
		const slotDir = tmpDir("lsc-pin-eacces-");
		const linkPath = join(slotDir, "lets-craft");
		symlinkSync(repoRoot, linkPath);
		chmodSync(slotDir, 0o000); // readlinkSync now fails EACCES — neither ENOENT nor EINVAL
		try {
			expect(() => pinLetsCraftPluginToRepo({ linkPath, repoRoot, linkPlugin: () => {} })).toThrow();
		} finally {
			chmodSync(slotDir, 0o700); // restore for the afterEach cleanup
		}
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

// ---------------------------------------------------------------------------
// audit-3 RF-33/RF-35 — the durable parent-session JSONL readers (e2e-helpers.ts' new
// seam). Same no-real-process, `npm test`-runs philosophy: exercised against synthetic
// session files shaped exactly like the host's persisted entries (message/toolCall/
// toolResult), never a real `omp` child. These are the parsers the routing-source
// precondition (RF-33) and the exact-spawn/stall evidence (RF-35) stand on, so their
// argument-shape normalization and completion linkage are pinned here.
// ---------------------------------------------------------------------------

describe("sessionTaskSpawns / findSessionFileByPrompt / sessionEntryDigests (RF-33/RF-35)", () => {
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

	/** A session file carrying the host's persisted entry shape: assistant message with a toolCall block, and a toolResult message pairing by toolCallId. */
	function writeSessionFile(path: string, entries: Array<Record<string, unknown>>): string {
		writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
		return path;
	}

	const entryBase = { id: "e1", parentId: null, timestamp: "2026-09-01T00:00:00.000Z" };

	it("sessionTaskSpawns normalizes the FLAT {agent, task} shape and pairs the delivered toolResult", () => {
		const dir = tmpDir("lsc-session-flat-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests for feature X at HEAD" } }] } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "spawn finished" }], isError: false } },
		]);

		const spawns = sessionTaskSpawns(path);
		expect(spawns).toHaveLength(1);
		expect(spawns[0].agent).toBe("lsc-test-engineer");
		expect(spawns[0].taskText).toContain("feature X");
		expect(spawns[0].resultDelivered).toBe(true);
		expect(spawns[0].resultIsError).toBe(false);
		expect(spawns[0].resultText).toBe("spawn finished");
	});

	it("sessionTaskSpawns normalizes the BATCH {tasks: [...]} shape, tolerates JSON-string arguments, and reports an un-resulted call as not delivered", () => {
		const dir = tmpDir("lsc-session-batch-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "assistant", content: [
				{ type: "toolCall", id: "call_1", name: "task", arguments: JSON.stringify({ tasks: [{ agent: "lsc-tracer", task: "TRACER-PING ack" }, { agent: "lsc-explore", task: "EXPLORE-PING ack" }] }) },
			] } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "both done" }], isError: false } },
			{ type: "message", ...entryBase, id: "e3", message: { role: "assistant", content: [{ type: "toolCall", id: "call_2", name: "task", arguments: { agent: "lsc-test-engineer", task: "second spawn" } }] } },
		]);

		const spawns = sessionTaskSpawns(path);
		expect(spawns.map(s => s.agent)).toEqual(["lsc-tracer", "lsc-explore", "lsc-test-engineer"]);
		expect(spawns[0].resultDelivered).toBe(true); // the batch call's single result covers both items
		expect(spawns[1].resultDelivered).toBe(true);
		expect(spawns[2].resultDelivered).toBe(false); // no toolResult for call_2 — in-flight, not completed
		expect(spawns[2].resultText).toBeUndefined();
	});

	it("sessionTaskSpawns throws on a corrupt line instead of fabricating a no-spawn verdict", () => {
		const dir = tmpDir("lsc-session-corrupt-");
		const path = join(dir, "run.jsonl");
		writeFileSync(path, '{"type":"message"\n'); // unterminated JSON

		expect(() => sessionTaskSpawns(path)).toThrow(/run\.jsonl:1/);
	});

	it("findSessionFileByPrompt matches the process whose user message carries the needle, ignoring nested subagent files", () => {
		const dir = tmpDir("lsc-session-finder-");
		writeSessionFile(join(dir, "craft-run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:craft .lsc/crafts/red-cycle/ go" } },
		]);
		const postCraftPath = writeSessionFile(join(dir, "postcraft-run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: [{ type: "text", text: "/skill:post-craft .lsc/crafts/red-cycle/ continue" }] } },
		]);
		mkdirSync(join(dir, "postcraft-run"), { recursive: true });
		writeSessionFile(join(dir, "postcraft-run", "Subagent.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "quoted /skill:post-craft text must not match from a nested file" } },
		]);

		const found = findSessionFileByPrompt(dir, "/skill:post-craft");
		expect(found?.path).toBe(postCraftPath);
		expect(found?.matchedUserText).toContain("red-cycle");
		expect(findSessionFileByPrompt(dir, "/skill:pre-craft")).toBeUndefined();
	});

	it("sessionEntryDigests carries timestamps, roles, and toolNames for the stall-attribution tail", () => {
		const dir = tmpDir("lsc-session-digest-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "prompt" } },
			{ type: "message", ...entryBase, id: "e2", timestamp: "2026-09-01T00:05:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "thinking aloud" }] } },
			{ type: "message", id: "e3", parentId: "e2", timestamp: "2026-09-01T00:09:00.000Z", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "result text" }] } },
		]);

		const digests = sessionEntryDigests(path);
		expect(digests.map(d => d.type)).toEqual(["message", "message", "message"]);
		expect(digests[1]).toMatchObject({ role: "assistant", snippet: "thinking aloud", timestamp: "2026-09-01T00:05:00.000Z" });
		expect(digests[2]).toMatchObject({ role: "toolResult", toolName: "task", snippet: "result text" });
	});

	it("sessionTaskSpawns skips the host's title-slot + session-header prefix (omp 18 JSONL physical layout) and pairs a mixed text+toolCall assistant block", () => {
		const dir = tmpDir("lsc-session-prefix-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "title", v: 1, title: "post-craft", source: "auto", updatedAt: "2026-09-01T00:00:00.000Z", pad: "" },
			{ type: "session", version: 3, id: "sess-1", timestamp: "2026-09-01T00:00:00.000Z", cwd: "/tmp/fixture" },
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:post-craft .lsc/crafts/red-cycle/ go" } },
			{
				type: "message",
				...entryBase,
				id: "e2",
				message: {
					role: "assistant",
					content: [
						{ type: "text", text: "spawning the §3.0 engineer" },
						{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests for red-cycle at abcdef0" } },
					],
				},
			},
			{ type: "message", ...entryBase, id: "e3", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "done" }], isError: false } },
		]);

		const spawns = sessionTaskSpawns(path);
		expect(spawns).toHaveLength(1);
		expect(spawns[0].agent).toBe("lsc-test-engineer");
		expect(spawns[0].resultDelivered).toBe(true);
		expect(findSessionFileByPrompt(dir, "/skill:post-craft")?.path).toBe(path);
	});

	it("sessionTaskSpawns does not pair a toolResult whose toolCallId is on the ENTRY rather than the message (host schema is message.toolCallId)", () => {
		const dir = tmpDir("lsc-session-entry-id-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests" } }] } },
			{ type: "message", ...entryBase, id: "call_1", message: { role: "toolResult", toolName: "task", content: [{ type: "text", text: "done" }], isError: false } },
		]);

		const spawns = sessionTaskSpawns(path);
		expect(spawns).toHaveLength(1);
		expect(spawns[0].callId).toBe("call_1");
		expect(spawns[0].resultDelivered).toBe(false);
	});

	it("sessionTaskSpawns still pairs when toolResult.content is a plain string (runtime variance vs TextContent[])", () => {
		const dir = tmpDir("lsc-session-string-result-");
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests" } }] } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: "spawn finished", isError: false } },
		]);

		const spawns = sessionTaskSpawns(path);
		expect(spawns[0].resultDelivered).toBe(true);
		expect(spawns[0].resultIsError).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// audit-4 RF-39/RF-41 — the durable stage-observation seam: last-wins toolResult pairing,
// the throttle that keeps per-chunk earlyExit predicates off the filesystem, the last-match
// session finder, session toolResult texts, durableStageObservation's tolerant reads, and
// the RF-37 preset precondition function. Same no-real-process, `npm test`-runs philosophy:
// synthetic session/state/log files shaped exactly like the host's persisted records.
// ---------------------------------------------------------------------------

describe("sessionTaskSpawns multi-toolResult last-wins (RF-39)", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function writeSessionFile(path: string, entries: Array<Record<string, unknown>>): string {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
		return path;
	}

	const entryBase = { id: "e1", parentId: null, timestamp: "2026-09-01T00:00:00.000Z" };
	const taskCall = (callId: string) => ({
		type: "message",
		...entryBase,
		message: { role: "assistant", content: [{ type: "toolCall", id: callId, name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests for red-cycle" } }] },
	});
	const toolResult = (callId: string, isError: boolean) => ({
		type: "message",
		...entryBase,
		id: `r-${callId}-${isError}`,
		message: { role: "toolResult", toolCallId: callId, toolName: "task", content: [{ type: "text", text: isError ? "spawn failed" : "spawn ok" }], isError },
	});

	it("a call with toolResults isError:false then isError:true resolves LAST-WINS to resultIsError===true", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-lastwins-a-"));
		tempDirs.push(dir);
		const path = writeSessionFile(join(dir, "run.jsonl"), [taskCall("call_1"), toolResult("call_1", false), toolResult("call_1", true)]);
		const spawns = sessionTaskSpawns(path);
		expect(spawns).toHaveLength(1);
		expect(spawns[0].resultDelivered).toBe(true);
		expect(spawns[0].resultIsError).toBe(true);
		expect(spawns[0].resultText).toBe("spawn failed");
	});

	it("the reverse order (isError:true then isError:false) resolves to resultIsError===false — the LAST result is the durable one", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-lastwins-b-"));
		tempDirs.push(dir);
		const path = writeSessionFile(join(dir, "run.jsonl"), [taskCall("call_1"), toolResult("call_1", true), toolResult("call_1", false)]);
		const spawns = sessionTaskSpawns(path);
		expect(spawns).toHaveLength(1);
		expect(spawns[0].resultDelivered).toBe(true);
		expect(spawns[0].resultIsError).toBe(false);
		expect(spawns[0].resultText).toBe("spawn ok");
	});
});

describe("durableProbeThrottle / lastSessionFileByPrompt / sessionToolResultTexts (RF-41(b))", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function writeSessionFile(path: string, entries: Array<Record<string, unknown>>): string {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
		return path;
	}

	const entryBase = { id: "e1", parentId: null, timestamp: "2026-09-01T00:00:00.000Z" };

	it("durableProbeThrottle allows the first probe, gates probes inside the interval, and re-allows past it", () => {
		const due = durableProbeThrottle(60_000);
		expect(due()).toBe(true); // first probe is always allowed — no read has happened yet
		expect(due()).toBe(false); // inside the interval → gated
		expect(due()).toBe(false);
		const fresh = durableProbeThrottle(0);
		expect(fresh()).toBe(true);
		expect(fresh()).toBe(true); // zero interval never gates
	});

	it("lastSessionFileByPrompt returns the MOST RECENT matching file, not the first (resumes add later files)", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-lastfinder-"));
		tempDirs.push(dir);
		const first = writeSessionFile(join(dir, "20260901T0000_aaaa.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:pre-craft do it" } },
		]);
		const second = writeSessionFile(join(dir, "20260901T0500_bbbb.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:pre-craft resume it" } },
		]);
		// readdirSync order is name-alphabetical here (timestamps), so first<second; pin the
		// LAST-match rule regardless of which the finder visits first.
		expect(first < second).toBe(true);
		expect(lastSessionFileByPrompt(dir, "/skill:pre-craft")?.path).toBe(second);
		expect(lastSessionFileByPrompt(dir, "/skill:craft")).toBeUndefined();
	});

	it("sessionToolResultTexts carries every toolResult's isError and text, tolerating plain-string content", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-toolresults-"));
		tempDirs.push(dir);
		const path = writeSessionFile(join(dir, "run.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "prompt" } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "toolResult", toolCallId: "c1", toolName: "write", content: [{ type: "text", text: "lets-craft: run_check.sh passed (exit 0). Log: /x/check-1.log." }], isError: false } },
			{ type: "message", ...entryBase, id: "e3", message: { role: "toolResult", toolCallId: "c2", toolName: "write", content: "plain-string result", isError: true } },
			{ type: "message", ...entryBase, id: "e4", message: { role: "assistant", content: [{ type: "text", text: "assistant text is not a toolResult" }] } },
		]);
		expect(sessionToolResultTexts(path)).toEqual([
			{ isError: false, text: "lets-craft: run_check.sh passed (exit 0). Log: /x/check-1.log." },
			{ isError: true, text: "plain-string result" },
		]);
	});
});

describe("durableStageObservation (RF-41(b))", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	function writeSessionFile(path: string, entries: Array<Record<string, unknown>>): string {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
		return path;
	}

	const entryBase = { id: "e1", parentId: null, timestamp: "2026-09-01T00:00:00.000Z" };

	/** A seeded feature root: worktree/.lsc/crafts/{feature}/ with optional state/logs/sessionDir contents. */
	function seedFeature(feature: string): { worktreeRoot: string; sessionDir: string } {
		const base = mkdtempSync(join(tmpdir(), "lsc-durable-obs-"));
		tempDirs.push(base);
		const worktreeRoot = join(base, "wt");
		const sessionDir = join(base, "sessions");
		mkdirSync(join(worktreeRoot, ".lsc", "crafts", feature), { recursive: true });
		mkdirSync(sessionDir, { recursive: true });
		return { worktreeRoot, sessionDir };
	}

	it("tolerates total absence: no state file, no check logs, no session file → undefined / 0 / [] and no throw", () => {
		const { worktreeRoot, sessionDir } = seedFeature("ghost");
		const observation = durableStageObservation({ worktreeRoot, feature: "ghost", sessionDir, promptNeedle: "/skill:post-craft" });
		expect(observation.auditCycle).toBeUndefined();
		expect(observation.checkLogIndex).toBe(0);
		expect(observation.runCheckResults).toEqual([]);
		expect(observation.engineerSpawn).toBeUndefined();
		expect(observation.sessionFile).toBeUndefined();
	});

	it("reads auditCycle from .craft-state.json, the MAX check-N.log index, run-check results and the engineer spawn from the session file", () => {
		const feature = "red-cycle";
		const { worktreeRoot, sessionDir } = seedFeature(feature);
		writeFileSync(join(worktreeRoot, ".lsc", "crafts", feature, ".craft-state.json"), JSON.stringify({ stateVersion: 2, feature, auditCycle: 1 }));
		const logsDir = join(worktreeRoot, ".lsc", "crafts", feature, "check", "logs");
		mkdirSync(logsDir, { recursive: true });
		for (const name of ["check-1.log", "check-3.log", "check-10.log", "not-a-log.txt", "check-2.log.bak"]) writeFileSync(join(logsDir, name), "x");
		writeSessionFile(join(sessionDir, "20260901T0000_aaaa.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:post-craft .lsc/crafts/red-cycle/ go" } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests at /wt/.lsc/worktrees/red-cycle" } }] } },
			{ type: "message", ...entryBase, id: "e3", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "tests authored" }], isError: false } },
			{ type: "message", ...entryBase, id: "e4", message: { role: "toolResult", toolCallId: "c9", toolName: "write", content: [{ type: "text", text: "lets-craft: run_check.sh passed (exit 0). Log: /wt/check-4.log." }], isError: false } },
			{ type: "message", ...entryBase, id: "e5", message: { role: "toolResult", toolCallId: "c10", toolName: "write", content: [{ type: "text", text: "lets-craft: run_check.sh FAILED (exit 1). Full log: /wt/check-5.log." }], isError: true } },
			{ type: "message", ...entryBase, id: "e6", message: { role: "toolResult", toolCallId: "c11", toolName: "write", content: [{ type: "text", text: "an unrelated tool result" }], isError: false } },
		]);

		const observation = durableStageObservation({ worktreeRoot, feature, sessionDir, promptNeedle: "/skill:post-craft" });
		expect(observation.auditCycle).toBe(1);
		expect(observation.checkLogIndex).toBe(10); // max N — not the count, not the latest mtime
		expect(observation.runCheckResults.map(r => r.passed)).toEqual([true, false]);
		expect(observation.engineerSpawn?.agent).toBe("lsc-test-engineer");
		expect(observation.engineerSpawn?.resultDelivered).toBe(true);
		expect(observation.engineerSpawn?.resultIsError).toBe(false);
	});

	it("treats a CORRUPT .craft-state.json as auditCycle undefined instead of throwing (polling-predicate tolerance)", () => {
		const { worktreeRoot, sessionDir } = seedFeature("corrupt");
		writeFileSync(join(worktreeRoot, ".lsc", "crafts", "corrupt", ".craft-state.json"), "{not json");
		const observation = durableStageObservation({ worktreeRoot, feature: "corrupt", sessionDir });
		expect(observation.auditCycle).toBeUndefined();
		expect(observation.checkLogIndex).toBe(0);
	});

	it("does not match an engineer spawn for a DIFFERENT feature (the assignment must carry this feature's slug)", () => {
		const { worktreeRoot, sessionDir } = seedFeature("alpha");
		writeSessionFile(join(sessionDir, "20260901T0000_aaaa.jsonl"), [
			{ type: "message", ...entryBase, message: { role: "user", content: "/skill:post-craft .lsc/crafts/alpha/ go" } },
			{ type: "message", ...entryBase, id: "e2", message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "task", arguments: { agent: "lsc-test-engineer", task: "author tests at /wt/.lsc/worktrees/beta" } }] } },
			{ type: "message", ...entryBase, id: "e3", message: { role: "toolResult", toolCallId: "call_1", toolName: "task", content: [{ type: "text", text: "done" }], isError: false } },
		]);
		const observation = durableStageObservation({ worktreeRoot, feature: "alpha", sessionDir, promptNeedle: "/skill:post-craft" });
		expect(observation.engineerSpawn).toBeUndefined();
	});
});

describe("presetParentPreconditions (RF-37)", () => {
	const entryBase = { id: "e1", parentId: null, timestamp: "2026-09-01T00:00:00.000Z" };
	const taskCallEntry = (callId: string, agent: string, taskText: string) => ({
		type: "message",
		...entryBase,
		id: callId,
		message: { role: "assistant", content: [{ type: "toolCall", id: callId, name: "task", arguments: { agent, task: taskText } }] },
	});
	const spawnsFor = (entries: Array<Record<string, unknown>>) =>
		entries
			.filter(entry => entry.type === "message")
			.flatMap(entry => {
				const message = entry.message as { content?: Array<{ type?: string; id?: string; name?: string; arguments?: { agent?: string; task?: string } }> };
				return (message.content ?? []).filter(block => block.type === "toolCall" && block.name === "task").map(block => ({
					callId: block.id ?? "",
					agent: block.arguments?.agent,
					taskText: block.arguments?.task ?? "",
					resultDelivered: false,
					resultIsError: undefined,
					resultText: undefined,
				}));
			});

	it("ok when the parent records the preset model_change and both marker-bound calls requested the exact agents", () => {
		const entries = [
			taskCallEntry("c1", "lsc-tracer", "TRACER-PING ack"),
			taskCallEntry("c2", "lsc-explore", "EXPLORE-PING ack"),
			{ type: "model_change", model: "zai/glm-4.5-flash" },
		];
		const result = presetParentPreconditions({
			parentEntries: entries,
			parentSpawns: spawnsFor(entries),
			defaultBareModel: "glm-4.5-flash",
			tracerMarker: "TRACER-PING",
			exploreMarker: "EXPLORE-PING",
			tracerAgent: "lsc-tracer",
			exploreAgent: "lsc-explore",
		});
		expect(result.ok).toBe(true);
		expect(result.failures).toEqual([]);
		expect(result.tracerAgent).toBe("lsc-tracer");
		expect(result.exploreAgent).toBe("lsc-explore");
	});

	it("reader-level regression: a synthetic parent JSONL seeded with the WRONG requested agent (lsc-scout instead of lsc-explore) fails the precondition — BEFORE any child model assertion could attribute an override miss", () => {
		const entries = [
			taskCallEntry("c1", "lsc-tracer", "TRACER-PING ack"),
			taskCallEntry("c2", "lsc-scout", "EXPLORE-PING ack"),
			{ type: "model_change", model: "zai/glm-4.5-flash" },
		];
		const result = presetParentPreconditions({
			parentEntries: entries,
			parentSpawns: spawnsFor(entries),
			defaultBareModel: "glm-4.5-flash",
			tracerMarker: "TRACER-PING",
			exploreMarker: "EXPLORE-PING",
			tracerAgent: "lsc-tracer",
			exploreAgent: "lsc-explore",
		});
		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain("lsc-scout");
		expect(result.failures[0]).toContain("lsc-explore");
		expect(result.exploreAgent).toBe("lsc-scout");
	});

	it("fails when the preset's model_change is absent even with correct agents — and reports every failed axis in evaluation order", () => {
		const entries = [
			taskCallEntry("c1", "lsc-tracer", "TRACER-PING ack"),
			taskCallEntry("c2", "lsc-explore", "EXPLORE-PING ack"),
			{ type: "model_change", model: "zai/some-other-model" },
		];
		const result = presetParentPreconditions({
			parentEntries: entries,
			parentSpawns: spawnsFor(entries),
			defaultBareModel: "glm-4.5-flash",
			tracerMarker: "TRACER-PING",
			exploreMarker: "EXPLORE-PING",
			tracerAgent: "lsc-tracer",
			exploreAgent: "lsc-explore",
		});
		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain("model_change");
	});
});
