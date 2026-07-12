// Regression coverage for the stdout/stderr accumulation bug found from an actual ~51-minute
// worktree E2E run: every test assertion had already passed, but the harness itself crashed
// afterward with `RangeError: Invalid string length` — `stdout += chunk.toString()` kept running
// forever after the promise had already resolved, since nothing ever removed the `data` listener
// or bounded the accumulated string. These tests exercise the fix directly (appendBounded's cap
// logic, attachOmpRunHandlers' settle-then-cleanup behavior) against a fake, `EventEmitter`-based
// child process double — no real `omp` process, no LSC_E2E gate, runs as part of `npm test`.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { appendBounded, attachOmpRunHandlers, type OmpRunResult, type RunnableChild } from "./e2e-helpers";

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

	it("invokes earlyExit and resolves immediately once it returns true, killing the child without waiting for close", async () => {
		const child = createFakeChild();
		const resultPromise = run(child, { timeoutMs: 60_000, earlyExit: stdout => stdout.includes("DONE") });
		child.stdout.emit("data", "working...");
		child.stdout.emit("data", "DONE");
		const result = await resultPromise;
		expect(result.timedOut).toBe(false);
		expect(result.stdout).toBe("working...DONE");
		expect(child.killCalls).toContain("SIGKILL");
		expect(child.stdout.listenerCount("data")).toBe(0);
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
