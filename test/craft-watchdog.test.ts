import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecFn } from "../src/notify";
import {
	AUTO_RESUME_ENV,
	AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV,
	DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS,
	MAX_AUTO_RESUMES,
	buildResumeMessage,
	classifyRetrySignal,
	clearWatchdogPending,
	decideScheduleResume,
	getAutoResumeMaxRetryAfterMs,
	getWatchdogPending,
	getWatchdogResumeCount,
	isAutoResumeEnabled,
	isWatchdogActive,
	markWatchdogActive,
	parseRetryAfterMs,
	registerWatchdog,
	resetWatchdogState,
	runResumeTimerCallback,
	shouldSetStickyForToolExecution,
	shouldSuppressResumeForCraftBackstop,
} from "../src/craft/watchdog";
import { type CraftState, clearActiveCraft, setActiveCraft } from "../src/craft/state";

// Real (bundle-confirmed literal) finalError shapes — see watchdog.ts's module doc comment for
// the cli.js emit sites these mirror.
const FIXTURE_RATE_LIMIT_429 =
	"Provider requested 4447000ms wait, exceeds retry.maxDelayMs (300000ms). Original error: rate_limit_error: Number of request tokens has exceeded your per-minute rate limit retry-after-ms=4447000";
const FIXTURE_OVERLOADED = "Provider requested 415000ms wait, exceeds retry.maxDelayMs (300000ms). Original error: overloaded_error: Overloaded";
const FIXTURE_NULL_YIELD = "Assistant returned empty stop after retry cap";
const FIXTURE_CANCELLED = "Retry cancelled";
// Real observed value from _docs/429-pattern-analysis.md §3 (Smoody-platform worktree,
// 2026-07-17T01-25-33 session) — 169,716,000ms = 47.14h, well past the CS-8 cutoff.
const FIXTURE_HUGE_RETRY_AFTER =
	"Provider requested 169716000ms wait, exceeds retry.maxDelayMs (300000ms). Original error: rate_limit_error: weekly usage limit retry-after-ms=169716000";

afterEach(() => {
	resetWatchdogState();
	clearActiveCraft();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});
beforeEach(() => {
	resetWatchdogState();
	clearActiveCraft();
});

describe("parseRetryAfterMs", () => {
	it("parses the provider give-up ms from the 429/rate_limit fixture", () => {
		expect(parseRetryAfterMs({ errorMessage: FIXTURE_RATE_LIMIT_429 })).toBe(4447000);
	});

	it("parses the provider give-up ms from the overloaded_error fixture", () => {
		expect(parseRetryAfterMs({ errorMessage: FIXTURE_OVERLOADED })).toBe(415000);
	});

	it("returns undefined for the null-yield fixture (no retry-after anywhere)", () => {
		expect(parseRetryAfterMs({ errorMessage: FIXTURE_NULL_YIELD })).toBeUndefined();
	});

	it("returns undefined for the cancelled fixture", () => {
		expect(parseRetryAfterMs({ errorMessage: FIXTURE_CANCELLED })).toBeUndefined();
	});

	it("parses a bare retry-after-ms=NNN token without the full give-up sentence", () => {
		expect(parseRetryAfterMs({ errorMessage: "some upstream error retry-after-ms=12345" })).toBe(12345);
	});

	it("parses a bare retry-after-ms: NNN token (colon form)", () => {
		expect(parseRetryAfterMs({ errorMessage: "retry-after-ms: 7000" })).toBe(7000);
	});

	it("parses a retry-after-ms header (case-insensitive key)", () => {
		expect(parseRetryAfterMs({ headers: { "Retry-After-Ms": "9000" } })).toBe(9000);
	});

	it("parses a retry-after header as seconds -> ms", () => {
		expect(parseRetryAfterMs({ headers: { "retry-after": "30" } })).toBe(30000);
	});

	it("parses a retry-after HTTP-date header as a delta from now", () => {
		const future = new Date(Date.now() + 60_000).toUTCString();
		const ms = parseRetryAfterMs({ headers: { "retry-after": future } });
		expect(ms).toBeGreaterThan(55_000);
		expect(ms).toBeLessThan(65_000);
	});

	it("prefers the errorMessage give-up sentence over headers when both are present", () => {
		expect(parseRetryAfterMs({ errorMessage: FIXTURE_RATE_LIMIT_429, headers: { "retry-after": "1" } })).toBe(4447000);
	});

	it("returns undefined when neither errorMessage nor headers carry a signal", () => {
		expect(parseRetryAfterMs({ errorMessage: "some unrelated error" })).toBeUndefined();
		expect(parseRetryAfterMs({})).toBeUndefined();
	});
});

describe("classifyRetrySignal", () => {
	it("classifies the 429/rate_limit fixture as provider-wait with its retryAfterMs", () => {
		expect(classifyRetrySignal({ errorMessage: FIXTURE_RATE_LIMIT_429 })).toEqual({ kind: "provider-wait", retryAfterMs: 4447000 });
	});

	it("classifies the overloaded_error fixture as provider-wait with its retryAfterMs", () => {
		expect(classifyRetrySignal({ errorMessage: FIXTURE_OVERLOADED })).toEqual({ kind: "provider-wait", retryAfterMs: 415000 });
	});

	it("classifies the null-yield fixture as null-yield", () => {
		expect(classifyRetrySignal({ errorMessage: FIXTURE_NULL_YIELD })).toEqual({ kind: "null-yield" });
	});

	it("classifies the cancelled fixture as cancelled, even if it happened to also carry a retry-after", () => {
		expect(classifyRetrySignal({ errorMessage: FIXTURE_CANCELLED, headers: { "retry-after": "10" } })).toEqual({ kind: "cancelled" });
	});

	it("classifies an unrelated error message as generic", () => {
		expect(classifyRetrySignal({ errorMessage: "network socket hang up" })).toEqual({ kind: "generic" });
	});

	it("classifies a headers-only retry-after (no errorMessage) as provider-wait", () => {
		expect(classifyRetrySignal({ headers: { "retry-after-ms": "5000" } })).toEqual({ kind: "provider-wait", retryAfterMs: 5000 });
	});
});

describe("shouldSetStickyForToolExecution (DR-2)", () => {
	it("is true for any lsc_ tool", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "lsc_run_tests" })).toBe(true);
		expect(shouldSetStickyForToolExecution({ toolName: "lsc_ask" })).toBe(true);
	});

	it("is true for a task spawn whose agent starts with lsc-", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: { agent: "lsc-architect" } })).toBe(true);
	});

	it("is false for a task spawn with an unrelated agent", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: { agent: "general-purpose" } })).toBe(false);
	});

	it("is false for a task spawn with no agent field (defaults to base 'task')", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: {} })).toBe(false);
		expect(shouldSetStickyForToolExecution({ toolName: "task" })).toBe(false);
	});

	it("is false for unrelated built-in tools", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "bash" })).toBe(false);
		expect(shouldSetStickyForToolExecution({ toolName: "read" })).toBe(false);
	});

	// Pins the flat→batch fall-through: a non-lsc flat `agent` must NOT short-circuit
	// past the tasks[] scan. Today that holds because the flat check is a bare
	// `if (...) return true` with no else — an `else if` refactor would regress it
	// silently, and no other case covers the transition.
	it("is true when a non-lsc flat agent coexists with an lsc- agent in tasks[]", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "task",
				args: { agent: "general-purpose", tasks: [{ agent: "lsc-critic", task: "t" }] },
			}),
		).toBe(true);
	});

	it("is false when args is explicitly null (args is unknown, so null is a legal input)", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: null })).toBe(false);
	});

	it("is true for a batch task spawn with one lsc- prefixed agent", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "task",
				args: { context: "c", tasks: [{ agent: "lsc-architect", task: "t" }] },
			}),
		).toBe(true);
	});

	it("is true for a batch task spawn where only a later task is lsc- prefixed", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "task",
				args: {
					context: "c",
					tasks: [
						{ agent: "general-purpose", task: "t1" },
						{ agent: "general-purpose", task: "t2" },
						{ agent: "lsc-critic", task: "t3" },
					],
				},
			}),
		).toBe(true);
	});

	it("is false for a batch task spawn with no lsc- prefixed agent", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "task",
				args: {
					context: "c",
					tasks: [
						{ agent: "general-purpose", task: "t1" },
						{ agent: "general-purpose", task: "t2" },
					],
				},
			}),
		).toBe(false);
	});

	it("is false for a batch task spawn with an empty tasks array", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: { context: "c", tasks: [] } })).toBe(false);
	});

	it("is false when tasks is present but not an array", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: { context: "c", tasks: "lsc-architect" } })).toBe(false);
		expect(shouldSetStickyForToolExecution({ toolName: "task", args: { context: "c", tasks: { agent: "lsc-architect" } } })).toBe(false);
	});

	it("does not throw and is false for malformed elements within tasks", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "task",
				args: { context: "c", tasks: [null, 42, {}, { agent: 7 }, { task: "no agent field" }] },
			}),
		).toBe(false);
	});

	it("is false for a non-task tool name with a batch-shaped args payload", () => {
		expect(
			shouldSetStickyForToolExecution({
				toolName: "bash",
				args: { context: "c", tasks: [{ agent: "lsc-architect", task: "t" }] },
			}),
		).toBe(false);
	});

	it("short-circuits to true for lsc_ prefixed tool names regardless of args", () => {
		expect(shouldSetStickyForToolExecution({ toolName: "lsc_run_tests", args: { tasks: "not-an-array" } })).toBe(true);
	});
});

describe("isWatchdogActive / markWatchdogActive / resetWatchdogState", () => {
	it("is inactive by default", () => {
		expect(isWatchdogActive()).toBe(false);
	});

	it("becomes active once markWatchdogActive is called (sticky, pre-craft)", () => {
		markWatchdogActive();
		expect(isWatchdogActive()).toBe(true);
	});

	it("is active whenever a durable craft is active, with no sticky flag needed", () => {
		const projectRoot = mkdtempSync(join(tmpdir(), "lsc-watchdog-"));
		setActiveCraft({ feature: "f", projectRoot, testsPassed: false, aborted: false });
		expect(isWatchdogActive()).toBe(true);
		rmSync(projectRoot, { recursive: true, force: true });
	});

	it("resetWatchdogState clears the sticky flag (but not durable craft state, which lives in state.ts)", () => {
		markWatchdogActive();
		resetWatchdogState();
		expect(isWatchdogActive()).toBe(false);
	});
});

describe("decideScheduleResume", () => {
	const CUTOFF = DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS;

	it("schedules when under the cap, under the cutoff, and the auto-resume flag is on", () => {
		expect(decideScheduleResume({ resumeCount: 0, autoResumeEnabled: true, retryAfterMs: 415000, maxRetryAfterMs: CUTOFF })).toEqual({
			action: "schedule",
		});
		expect(
			decideScheduleResume({ resumeCount: MAX_AUTO_RESUMES - 1, autoResumeEnabled: true, retryAfterMs: 415000, maxRetryAfterMs: CUTOFF }),
		).toEqual({ action: "schedule" });
	});

	it("downgrades to flag-off (notify-only) when under the cap/cutoff but the flag is explicitly disabled", () => {
		expect(decideScheduleResume({ resumeCount: 0, autoResumeEnabled: false, retryAfterMs: 415000, maxRetryAfterMs: CUTOFF })).toEqual({
			action: "flag-off",
		});
	});

	it("downgrades to cutoff-exceeded when retryAfterMs exceeds the cutoff — even with the flag on and under the cap (CS-8)", () => {
		expect(decideScheduleResume({ resumeCount: 0, autoResumeEnabled: true, retryAfterMs: CUTOFF + 1, maxRetryAfterMs: CUTOFF })).toEqual({
			action: "cutoff-exceeded",
		});
	});

	it("notifies limit-exceeded once the cap is reached, taking priority over both the cutoff and the flag", () => {
		expect(decideScheduleResume({ resumeCount: MAX_AUTO_RESUMES, autoResumeEnabled: true, retryAfterMs: 415000, maxRetryAfterMs: CUTOFF })).toEqual({
			action: "limit-exceeded",
		});
		expect(
			decideScheduleResume({ resumeCount: MAX_AUTO_RESUMES, autoResumeEnabled: false, retryAfterMs: CUTOFF + 1, maxRetryAfterMs: CUTOFF }),
		).toEqual({ action: "limit-exceeded" });
		expect(decideScheduleResume({ resumeCount: MAX_AUTO_RESUMES + 5, autoResumeEnabled: true, retryAfterMs: 1, maxRetryAfterMs: CUTOFF })).toEqual({
			action: "limit-exceeded",
		});
	});
});

describe("isAutoResumeEnabled (CS-7 gate)", () => {
	it("defaults to true when the env var is unset — P1 judged the stalls a structural repeat, satisfying the plan's CS-7 gate condition", () => {
		expect(isAutoResumeEnabled({})).toBe(true);
	});

	it("is false for '0'/'false'/'off'/'no' (case-insensitive) — explicit opt-out", () => {
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "0" })).toBe(false);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "false" })).toBe(false);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "FALSE" })).toBe(false);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "off" })).toBe(false);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "no" })).toBe(false);
	});

	it("is true for '1'/'true' and any other unrecognized value", () => {
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "1" })).toBe(true);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "true" })).toBe(true);
		expect(isAutoResumeEnabled({ [AUTO_RESUME_ENV]: "anything" })).toBe(true);
	});
});

describe("getAutoResumeMaxRetryAfterMs (CS-8 cutoff)", () => {
	it("defaults to 2h (7,200,000ms) when unset", () => {
		expect(DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS).toBe(7_200_000);
		expect(getAutoResumeMaxRetryAfterMs({})).toBe(7_200_000);
	});

	it("honors a positive numeric override", () => {
		expect(getAutoResumeMaxRetryAfterMs({ [AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV]: "3600000" })).toBe(3_600_000);
	});

	it("falls back to the default for a non-numeric or non-positive override", () => {
		expect(getAutoResumeMaxRetryAfterMs({ [AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV]: "not-a-number" })).toBe(DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS);
		expect(getAutoResumeMaxRetryAfterMs({ [AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV]: "0" })).toBe(DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS);
		expect(getAutoResumeMaxRetryAfterMs({ [AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV]: "-5" })).toBe(DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS);
	});
});

describe("shouldSuppressResumeForCraftBackstop", () => {
	function freshCraft(overrides: Partial<CraftState> = {}): CraftState {
		return { feature: "f", projectRoot: "/repo", testsPassed: false, aborted: false, ...overrides };
	}

	it("is false when there is no craft at all (pre-craft — nothing else would resume it)", () => {
		expect(shouldSuppressResumeForCraftBackstop(undefined)).toBe(false);
	});

	it("is true when a craft is active and its tests have not passed (the backstop forces continuation)", () => {
		expect(shouldSuppressResumeForCraftBackstop(freshCraft())).toBe(true);
	});

	it("is false once the craft's tests have passed (the backstop stops forcing turns)", () => {
		expect(shouldSuppressResumeForCraftBackstop(freshCraft({ testsPassed: true }))).toBe(false);
	});

	it("is false when the craft was aborted (the backstop also stands down — a different, aborted-specific check handles that case in the caller)", () => {
		expect(shouldSuppressResumeForCraftBackstop(freshCraft({ aborted: true }))).toBe(false);
	});
});

describe("buildResumeMessage", () => {
	it("matches the exact contract text (plan U1-2), substituting seconds and attempt", () => {
		expect(buildResumeMessage(415, 1)).toBe(
			"[lsc-watchdog] provider rate-limit(retry-after 415s)으로 정지된 세션을 자동 재개합니다 (1/3회). " +
				"이것은 새 지시가 아닙니다 — 직전 단계의 대기/판정을 그대로 이어서 진행하세요.",
		);
	});

	it("states plainly that this is not a new instruction (misinterpretation guard)", () => {
		expect(buildResumeMessage(60, 2)).toContain("새 지시가 아닙니다");
	});
});

describe("runResumeTimerCallback", () => {
	function baseCtx(overrides: Partial<Parameters<typeof runResumeTimerCallback>[0]> = {}) {
		const sent: string[] = [];
		const resumedAttempts: number[] = [];
		let pending: { retryAfterMs: number; at: number } | undefined = { retryAfterMs: 4447000, at: 1000 };
		let count = 0;
		return {
			ctx: {
				expectedAt: 1000,
				retryAfterMs: 4447000,
				getPending: () => pending,
				getActiveCraftState: () => undefined,
				isIdle: () => true,
				sendUserMessage: (text: string) => sent.push(text),
				notifyAutoResumed: (attempt: number) => resumedAttempts.push(attempt),
				incrementResumeCount: () => ++count,
				clearPending: () => {
					pending = undefined;
				},
				...overrides,
			},
			sent,
			resumedAttempts,
			getPendingLive: () => pending,
		};
	}

	it("sends the resume message and fires the notify callback when pending is fresh, no craft, and idle", () => {
		const { ctx, sent, resumedAttempts, getPendingLive } = baseCtx();
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("provider rate-limit(retry-after 4447s)");
		expect(sent[0]).toContain("1/3회");
		expect(resumedAttempts).toEqual([1]);
		expect(getPendingLive()).toBeUndefined();
	});

	it("does nothing when the pending has been superseded/cleared (stale 'at')", () => {
		const { ctx, sent } = baseCtx({ expectedAt: 999 });
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(0);
	});

	it("does nothing when pending was already cleared (undefined)", () => {
		const { ctx, sent } = baseCtx({ getPending: () => undefined });
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(0);
	});

	it("clears pending but does not resume when the craft was aborted in the interim (CS-3)", () => {
		const { ctx, sent, getPendingLive } = baseCtx({
			getActiveCraftState: () => ({ feature: "f", projectRoot: "/repo", testsPassed: false, aborted: true }),
		});
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(0);
		expect(getPendingLive()).toBeUndefined();
	});

	it("clears pending but does not resume when the craft backstop already owns continuation (single entry point)", () => {
		const { ctx, sent, getPendingLive } = baseCtx({
			getActiveCraftState: () => ({ feature: "f", projectRoot: "/repo", testsPassed: false, aborted: false }),
		});
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(0);
		expect(getPendingLive()).toBeUndefined();
	});

	it("clears pending but does not resume when the session is not idle (already recovered on its own)", () => {
		const { ctx, sent, getPendingLive } = baseCtx({ isIdle: () => false });
		runResumeTimerCallback(ctx);
		expect(sent).toHaveLength(0);
		expect(getPendingLive()).toBeUndefined();
	});

	it("swallows a throw from ctx.isIdle() (stale ctx) instead of propagating, and clears pending (M1)", () => {
		const { ctx, sent, getPendingLive } = baseCtx({
			isIdle: () => {
				throw new Error("stale ctx — session gone");
			},
		});
		expect(() => runResumeTimerCallback(ctx)).not.toThrow();
		expect(sent).toHaveLength(0);
		expect(getPendingLive()).toBeUndefined();
	});

	it("swallows a throw from ctx.sendUserMessage() instead of propagating, and clears pending (M1)", () => {
		const { ctx, getPendingLive } = baseCtx({
			sendUserMessage: () => {
				throw new Error("stale ctx — session gone");
			},
		});
		expect(() => runResumeTimerCallback(ctx)).not.toThrow();
		expect(getPendingLive()).toBeUndefined();
	});

	it("does not throw even if the catch-path clearPending itself throws (best-effort cleanup, M1)", () => {
		const ctx: Parameters<typeof runResumeTimerCallback>[0] = {
			expectedAt: 1000,
			retryAfterMs: 4447000,
			getPending: () => ({ retryAfterMs: 4447000, at: 1000 }),
			getActiveCraftState: () => undefined,
			isIdle: () => {
				throw new Error("boom");
			},
			sendUserMessage: () => {},
			notifyAutoResumed: () => {},
			incrementResumeCount: () => 1,
			clearPending: () => {
				throw new Error("clearPending also throws");
			},
		};
		expect(() => runResumeTimerCallback(ctx)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// registerWatchdog: end-to-end wiring against a fake pi/ctx (mirrors
// craft-compact-directive.test.ts's captureHandler pattern), including the real setTimeout path
// (captured via a spy so the test controls exactly when it "fires", no real waiting required).
// ---------------------------------------------------------------------------

type Handler = (event: unknown, ctx: unknown) => unknown;

function makeFakePi() {
	const handlers: Record<string, Handler[]> = {};
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const sentMessages: string[] = [];
	const exec: ExecFn = async (command, args) => {
		execCalls.push({ command, args });
		return { stdout: "", stderr: "", code: 0, killed: false };
	};
	const fakePi = {
		on(event: string, cb: Handler) {
			(handlers[event] ??= []).push(cb);
		},
		exec,
		sendUserMessage(text: string) {
			sentMessages.push(text);
		},
	};
	return { fakePi, handlers, execCalls, sentMessages };
}

function makeCtx(overrides: Partial<{ hasUI: boolean; isIdle: () => boolean }> = {}) {
	return { hasUI: overrides.hasUI ?? true, isIdle: overrides.isIdle ?? (() => true) };
}

async function fire(handlers: Record<string, Handler[]>, event: string, payload: unknown, ctx: unknown): Promise<void> {
	for (const handler of handlers[event] ?? []) await handler(payload, ctx);
}

describe("registerWatchdog (end-to-end wiring)", () => {
	it("sets the sticky flag from a tool_execution_start observation and stays no-op before that", async () => {
		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);

		expect(isWatchdogActive()).toBe(false);
		await fire(handlers, "tool_execution_start", { toolName: "lsc_run_tests" }, makeCtx());
		expect(isWatchdogActive()).toBe(true);
	});

	it("is a full no-op in print/headless mode (hasUI: false) — no sticky, no notify, no schedule", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);

		await fire(handlers, "tool_execution_start", { toolName: "lsc_run_tests" }, makeCtx({ hasUI: false }));
		expect(isWatchdogActive()).toBe(false);

		markWatchdogActive();
		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_RATE_LIMIT_429 }, makeCtx({ hasUI: false }));
		expect(execCalls).toHaveLength(0);
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("clears pending on auto_retry_end(success:true) — debounce", async () => {
		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		clearWatchdogPending(); // sanity baseline
		await fire(handlers, "auto_retry_end", { success: true, attempt: 2 }, makeCtx());
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("clears pending on turn_start — debounce", async () => {
		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		await fire(handlers, "turn_start", { turnIndex: 1, timestamp: Date.now() }, makeCtx());
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("does not notify or schedule for a cancelled signature — suppress (CS-8)", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_CANCELLED }, makeCtx());
		expect(execCalls).toHaveLength(0);
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("notifies (event ①) but does not schedule a resume for a null-yield signature — notify-only (CS-8)", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_NULL_YIELD }, makeCtx());
		expect(execCalls).toHaveLength(1);
		expect(execCalls[0].args[1]).toContain("provider 오류로 정지");
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("does not act at all when inactive (no craft, no sticky) — DR-2 full no-op", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_RATE_LIMIT_429 }, makeCtx());
		expect(execCalls).toHaveLength(0);
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("does not act at all when the active craft was aborted — craft-scoped explicit stop (CS-3)", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		const projectRoot = mkdtempSync(join(tmpdir(), "lsc-watchdog-abort-"));
		setActiveCraft({ feature: "f", projectRoot, testsPassed: false, aborted: true });

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_RATE_LIMIT_429 }, makeCtx());
		expect(execCalls).toHaveLength(0);
		expect(getWatchdogPending()).toBeUndefined();
		rmSync(projectRoot, { recursive: true, force: true });
	});

	it("notifies but does not schedule its own resume when an active, not-yet-passing craft's backstop already owns continuation (single entry point)", async () => {
		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		const projectRoot = mkdtempSync(join(tmpdir(), "lsc-watchdog-craft-"));
		setActiveCraft({ feature: "f", projectRoot, testsPassed: false, aborted: false });

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_RATE_LIMIT_429 }, makeCtx());
		expect(execCalls).toHaveLength(1); // still visible (C3) ...
		expect(getWatchdogPending()).toBeUndefined(); // ... but no duplicate resume timer
		rmSync(projectRoot, { recursive: true, force: true });
	});

	it("schedules a resume timer for a provider-wait stall in pre-craft (sticky) BY DEFAULT (CS-7 default-on, P1 structural-repeat verdict), and it fires sendUserMessage + notifyAutoResumed", async () => {
		expect(process.env[AUTO_RESUME_ENV]).toBeUndefined(); // ambient assumption: not set in the test env — this is the true default path, no stubbing
		let capturedCallback: (() => void) | undefined;
		vi.spyOn(global, "setTimeout").mockImplementation(((cb: () => void) => {
			capturedCallback = cb;
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout);

		const { fakePi, handlers, execCalls, sentMessages } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_OVERLOADED }, makeCtx({ isIdle: () => true }));
		expect(execCalls).toHaveLength(1); // event ① — main stalled
		expect(getWatchdogPending()).toEqual({ retryAfterMs: 415000, at: expect.any(Number) });
		expect(capturedCallback).toBeDefined();

		capturedCallback?.();
		expect(sentMessages).toHaveLength(1);
		expect(sentMessages[0]).toContain("retry-after 415s");
		expect(execCalls).toHaveLength(2); // event ① + event ② (auto resume)
		expect(getWatchdogResumeCount()).toBe(1);
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("detects and notifies but does NOT schedule when the auto-resume flag is explicitly disabled via config", async () => {
		vi.stubEnv(AUTO_RESUME_ENV, "0");
		const setTimeoutSpy = vi.spyOn(global, "setTimeout");

		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_RATE_LIMIT_429 }, makeCtx());
		expect(execCalls).toHaveLength(1); // still notifies
		expect(setTimeoutSpy).not.toHaveBeenCalled(); // never schedules
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("downgrades to notify-only (with the cutoff-specific message) when retryAfterMs exceeds the CS-8 cutoff, even with auto-resume on by default", async () => {
		expect(process.env[AUTO_RESUME_ENV]).toBeUndefined();
		const setTimeoutSpy = vi.spyOn(global, "setTimeout");

		const { fakePi, handlers, execCalls } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_HUGE_RETRY_AFTER }, makeCtx());
		expect(execCalls).toHaveLength(2); // event ① (main stalled) + cutoff-exceeded notification
		expect(execCalls[1].args[1]).toContain("자동 재개를 보류");
		expect(execCalls[1].args[1]).toContain("47.1시간");
		expect(setTimeoutSpy).not.toHaveBeenCalled(); // never schedules — cutoff wins over the default-on flag
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("notifies resume-limit-exceeded once the 3-resume cap is reached instead of scheduling a 4th", async () => {
		const callbacks: Array<() => void> = [];
		vi.spyOn(global, "setTimeout").mockImplementation(((cb: () => void) => {
			callbacks.push(cb);
			return 0 as unknown as ReturnType<typeof setTimeout>;
		}) as typeof setTimeout);

		const { fakePi, handlers, execCalls, sentMessages } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		// Exhaust the 3-resume cap: 3 full stall -> schedule -> fire cycles.
		for (let i = 0; i < MAX_AUTO_RESUMES; i++) {
			await fire(handlers, "auto_retry_end", { success: false, attempt: i + 1, finalError: FIXTURE_OVERLOADED }, makeCtx());
			callbacks[callbacks.length - 1]?.();
		}
		expect(getWatchdogResumeCount()).toBe(MAX_AUTO_RESUMES);
		expect(sentMessages).toHaveLength(MAX_AUTO_RESUMES);

		const execCallsBefore = execCalls.length;
		const callbacksBefore = callbacks.length;
		// A 4th stall must notify limit-exceeded, not schedule another timer.
		await fire(handlers, "auto_retry_end", { success: false, attempt: 4, finalError: FIXTURE_OVERLOADED }, makeCtx());
		expect(callbacks.length).toBe(callbacksBefore); // no new timer scheduled
		expect(execCalls.length).toBe(execCallsBefore + 2); // event ① (main stalled) + event ③ (limit exceeded)
		expect(execCalls[execCalls.length - 1].args[1]).toContain("한도(3회)를 초과");
	});

	it("resets sticky/pending/count on session_switch (a new session must not inherit stale watchdog state)", async () => {
		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();
		expect(isWatchdogActive()).toBe(true);

		await fire(handlers, "session_switch", { reason: "new", previousSessionFile: undefined }, makeCtx());
		expect(isWatchdogActive()).toBe(false);
		expect(getWatchdogResumeCount()).toBe(0);
	});

	it("unref()s the scheduled timer handle so it never keeps the event loop alive on its own (m1)", async () => {
		const unrefSpy = vi.fn();
		vi.spyOn(global, "setTimeout").mockImplementation((() => ({ unref: unrefSpy })) as unknown as typeof setTimeout);

		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_OVERLOADED }, makeCtx());
		expect(unrefSpy).toHaveBeenCalledTimes(1);
	});

	it("cancels the scheduled timer via clearTimeout when a later debounce (turn_start) clears pending (m1)", async () => {
		const fakeTimerHandle = { unref: vi.fn() };
		vi.spyOn(global, "setTimeout").mockImplementation((() => fakeTimerHandle) as unknown as typeof setTimeout);
		const clearTimeoutSpy = vi.spyOn(global, "clearTimeout").mockImplementation(() => {});

		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_OVERLOADED }, makeCtx());
		expect(getWatchdogPending()).toBeDefined();

		await fire(handlers, "turn_start", { turnIndex: 1, timestamp: Date.now() }, makeCtx());
		expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimerHandle);
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("also cancels the scheduled timer via resetWatchdogState (session_switch) (m1)", async () => {
		const fakeTimerHandle = { unref: vi.fn() };
		vi.spyOn(global, "setTimeout").mockImplementation((() => fakeTimerHandle) as unknown as typeof setTimeout);
		const clearTimeoutSpy = vi.spyOn(global, "clearTimeout").mockImplementation(() => {});

		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_OVERLOADED }, makeCtx());
		await fire(handlers, "session_switch", { reason: "new", previousSessionFile: undefined }, makeCtx());
		expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeTimerHandle);
	});

	it("clears any pending resume when auto_retry_start fires while active — unconditional debounce (m4)", async () => {
		vi.spyOn(global, "setTimeout").mockImplementation((() => ({ unref: vi.fn() })) as unknown as typeof setTimeout);

		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		markWatchdogActive();

		await fire(handlers, "auto_retry_end", { success: false, attempt: 1, finalError: FIXTURE_OVERLOADED }, makeCtx());
		expect(getWatchdogPending()).toBeDefined();

		await fire(handlers, "auto_retry_start", { attempt: 2, maxAttempts: 3, delayMs: 500, errorMessage: "retrying" }, makeCtx());
		expect(getWatchdogPending()).toBeUndefined();
	});

	it("is a safe no-op when auto_retry_start fires while the watchdog is inactive — no isWatchdogActive guard needed (m4)", async () => {
		const { fakePi, handlers } = makeFakePi();
		registerWatchdog(fakePi as unknown as Parameters<typeof registerWatchdog>[0]);
		expect(isWatchdogActive()).toBe(false);

		await expect(
			fire(handlers, "auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 100, errorMessage: "x" }, makeCtx()),
		).resolves.toBeUndefined();
		expect(getWatchdogPending()).toBeUndefined();
	});
});
