import { describe, expect, it, vi } from "vitest";
import type { ExecFn } from "../src/notify";
import { notify, notifyAutoResumed, notifyAutoResumeSkippedCutoff, notifyMainStalled, notifyPreCraftComplete, notifyResumeLimitExceeded } from "../src/notify";

function fakeExec(): { exec: ExecFn; calls: Array<{ command: string; args: string[] }> } {
	const calls: Array<{ command: string; args: string[] }> = [];
	const exec: ExecFn = async (command, args) => {
		calls.push({ command, args });
		return { stdout: "", stderr: "", code: 0, killed: false };
	};
	return { exec, calls };
}

describe("notify", () => {
	it("calls osascript with a display notification script on darwin", async () => {
		const { exec, calls } = fakeExec();
		await notify("Title", "Message", exec, "darwin");
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe("osascript");
		expect(calls[0].args[0]).toBe("-e");
		expect(calls[0].args[1]).toContain('display notification "Message" with title "Title"');
	});

	it("escapes double quotes and backslashes in title/message", async () => {
		const { exec, calls } = fakeExec();
		await notify('a "quoted" title', "back\\slash", exec, "darwin");
		expect(calls[0].args[1]).toContain('a \\"quoted\\" title');
		expect(calls[0].args[1]).toContain("back\\\\slash");
	});

	it("is a no-op on non-darwin platforms — exec is never called", async () => {
		const { exec, calls } = fakeExec();
		await notify("Title", "Message", exec, "linux");
		await notify("Title", "Message", exec, "win32");
		expect(calls).toHaveLength(0);
	});

	it("swallows an exec rejection instead of throwing", async () => {
		const exec: ExecFn = async () => {
			throw new Error("osascript: command not found");
		};
		await expect(notify("Title", "Message", exec, "darwin")).resolves.toBeUndefined();
	});

	it("never rejects even when exec never resolves cleanly (defensive)", async () => {
		const exec: ExecFn = vi.fn().mockRejectedValue(new Error("boom"));
		await expect(notify("t", "m", exec, "darwin")).resolves.toBeUndefined();
	});
});

describe("notifyMainStalled (event ① — main stall)", () => {
	it("includes the retry-after seconds when a retryAfterMs is known", async () => {
		const { exec, calls } = fakeExec();
		await notifyMainStalled(4447000, exec, "darwin");
		expect(calls[0].args[1]).toContain("retry-after 4447s");
	});

	it("falls back to a generic message when retryAfterMs is undefined (null-yield/generic causes)", async () => {
		const { exec, calls } = fakeExec();
		await notifyMainStalled(undefined, exec, "darwin");
		expect(calls[0].args[1]).not.toContain("retry-after");
		expect(calls[0].args[1]).toContain("정지");
	});
});

describe("notifyAutoResumed (event ② — auto resume)", () => {
	it("includes the attempt count out of the 3-cap", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumed(2, exec, "darwin");
		expect(calls[0].args[1]).toContain("2/3");
	});
});

describe("notifyResumeLimitExceeded (event ③ — cap exceeded)", () => {
	it("mentions the 3-resume cap", async () => {
		const { exec, calls } = fakeExec();
		await notifyResumeLimitExceeded(exec, "darwin");
		expect(calls[0].args[1]).toContain("3회");
	});
});

describe("notifyPreCraftComplete (event ④ — pre-craft done)", () => {
	it("names the feature", async () => {
		const { exec, calls } = fakeExec();
		await notifyPreCraftComplete("my-feature", exec, "darwin");
		expect(calls[0].args[1]).toContain("my-feature");
	});
});

describe("notifyAutoResumeSkippedCutoff (CS-8 cutoff — P1 follow-up)", () => {
	it("reports the retry-after in hours (one decimal place) and states auto-resume is being withheld", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumeSkippedCutoff(169_716_000, exec, "darwin"); // real observed value, _docs/429-pattern-analysis.md §3
		expect(calls[0].args[1]).toContain("47.1시간");
		expect(calls[0].args[1]).toContain("자동 재개를 보류");
		expect(calls[0].args[1]).toContain("수동 재개 필요");
	});

	it("is a no-op on non-darwin platforms, same as every other notify helper", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumeSkippedCutoff(10_000_000, exec, "linux");
		expect(calls).toHaveLength(0);
	});
});
