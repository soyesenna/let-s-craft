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
	it("includes the attempt count out of the caller-supplied cap (m3 — no hardcoded 3)", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumed(2, 3, exec, "darwin");
		expect(calls[0].args[1]).toContain("2/3");
	});

	it("reflects a different cap verbatim, proving the number isn't hardcoded", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumed(4, 5, exec, "darwin");
		expect(calls[0].args[1]).toContain("4/5");
		expect(calls[0].args[1]).not.toContain("/3");
	});
});

describe("notifyResumeLimitExceeded (event ③ — cap exceeded)", () => {
	it("mentions the caller-supplied resume cap (m3 — no hardcoded 3)", async () => {
		const { exec, calls } = fakeExec();
		await notifyResumeLimitExceeded(3, exec, "darwin");
		expect(calls[0].args[1]).toContain("3회");
	});

	it("reflects a different cap verbatim, proving the number isn't hardcoded", async () => {
		const { exec, calls } = fakeExec();
		await notifyResumeLimitExceeded(7, exec, "darwin");
		expect(calls[0].args[1]).toContain("7회");
		expect(calls[0].args[1]).not.toContain("3회");
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

	it("falls back to a safe '48시간 이상' phrase instead of a literal figure for non-finite input (L3)", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumeSkippedCutoff(Number.POSITIVE_INFINITY, exec, "darwin");
		expect(calls[0].args[1]).toContain("48시간 이상");
		expect(calls[0].args[1]).not.toContain("Infinity");

		const { exec: exec2, calls: calls2 } = fakeExec();
		await notifyAutoResumeSkippedCutoff(Number.NaN, exec2, "darwin");
		expect(calls2[0].args[1]).toContain("48시간 이상");
		expect(calls2[0].args[1]).not.toContain("NaN");
	});

	it("falls back to the safe phrase for an absurdly large (but finite) value, not just non-finite ones (L3)", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumeSkippedCutoff(30 * 24 * 3_600_000, exec, "darwin"); // 30 days
		expect(calls[0].args[1]).toContain("48시간 이상");
	});

	it("still uses the literal figure for a sane value near the observed maximum (48.6h)", async () => {
		const { exec, calls } = fakeExec();
		await notifyAutoResumeSkippedCutoff(174_960_000, exec, "darwin"); // 48.6h
		expect(calls[0].args[1]).toContain("48.6시간");
	});
});
