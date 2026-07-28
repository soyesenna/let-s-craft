// Main-session 429/provider-stall watchdog (C1-a, plan U1). Bounded detection + notification +
// (gated) unattended resume for the failure mode dogfooding actually hit twice: the main loop's
// own retry machinery gives up on a provider-requested wait longer than `retry.maxDelayMs`
// (bundle-confirmed emit site, cli.js: `finalError: "Provider requested ${z}ms wait, exceeds
// retry.maxDelayMs (${V}ms). Original error: ${X}"`) and the session then just sits idle until a
// human happens to notice and types "계속해." — observed once at 415s and once at 4447s of
// silent wait, 114 minutes combined.
//
// Anchor: `auto_retry_end(success:false)` is the ONLY primary detection signal (CS-1). It is a
// real bundle emit site (confirmed by static analysis of the host's own cli.js, not a guess), it
// fires whether or not `after_provider_response` ever does for an error response (that one is
// genuinely optional — "있으면 활용, 없어도 기능 완결" — and is deliberately NOT wired here), and
// it explains both observed stalls exactly (`retry.maxDelayMs` defaults to 300_000ms; both 415s
// and 4447s waits exceed it). `auto_retry_start` is wired for exactly one auxiliary purpose: a
// retry attempt actually in flight means the host is recovering on its own, so any stale pending
// resume from an earlier give-up is moot (same rationale as the turn_start/success:true debounce
// below) — it carries no other behavior.
//
// Axis vs. enforcement.ts's session_stop backstop (enforcement.ts:9-20's canon note): that
// backstop forces "one more turn" whenever a craft is active and its tests haven't passed, for
// ANY reason the session stopped. This watchdog instead reacts to WHY the session stopped
// (provider rate-limit specifically) and is the only thing that can ever nudge a stalled PRE-craft
// session (no craft, no backstop, nothing else watching). Where both would apply — an active,
// not-yet-passing craft hits a provider-wait stall — the backstop already owns "keep going"
// unconditionally, so this module still detects and notifies (visibility, C3) but deliberately
// never schedules its OWN resume action for that case (shouldSuppressResumeForCraftBackstop) —
// a single entry point, not a duplicate one (Risks table: "워치독-백스톱 이중 주입").
//
// DR-2 (activation): craft is durable (state.ts's CraftState); pre-craft has no durable state, so
// activation there is a session-lifetime "sticky" flag set the first time a `lsc_*` tool or an
// `lsc-*`-agent `task` spawn is OBSERVED via `tool_execution_start` (never systemPrompt scanning —
// skill bodies are injected as custom_message, not systemPrompt, per the plan's bundle analysis).
// Once set it stays set for the session (no false-negative on a late stall); inactive sessions are
// full no-ops (detection, notification, AND resume all skipped) — this module must never touch a
// session lets-craft was never invoked in.
//
// CS-7/CS-8 update (P1 follow-up, `_docs/429-pattern-analysis.md`): a full-corpus static scan
// (298 session files, 6 projects, 2026-07-10~18) judged these stalls a "구조적 반복" (structural
// repeat) — 23 error storms across 4/8 active days, the same failure signature (429/overloaded,
// zero host `retryRecovery`) recurring 5+ times across 2 projects and 3 dates. That satisfies the
// plan's own CS-7 gate ("P1이 '구조적 반복' 판정 시 활성화"), so unattended auto-resume now
// defaults ON (isAutoResumeEnabled) rather than the originally-planned off-by-default. The same
// analysis also found retry-after values ranging 5s~48.6h (26% of parseable cases above ~41h) —
// scheduling a real timer for a two-day wait is not useful, so a separate CS-8 cutoff
// (DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS, default 2h) downgrades an excessively long provider-wait
// to notify-only instead of scheduling, independently of the CS-7 flag.
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { notifyAutoResumed, notifyAutoResumeSkippedCutoff, notifyMainStalled, notifyResumeLimitExceeded } from "../notify.js";
import { shouldContinueCraftLoop } from "./enforcement.js";
import { type CraftState, getActiveCraft } from "./state.js";

// ---------------------------------------------------------------------------
// Pure parsing / classification (CS-1) — headers and errorMessage are both accepted inputs
// (auto_retry_end only ever supplies errorMessage/finalError today; the headers path exists for
// after_provider_response or any future signal that supplies them, kept dependency-free).
// ---------------------------------------------------------------------------

export interface RetrySignalInput {
	errorMessage?: string;
	headers?: Record<string, string>;
}

export type RetrySignatureKind = "provider-wait" | "null-yield" | "cancelled" | "generic";

// A real discriminated union (not an optional field on a flat shape) so `signal.kind ===
// "provider-wait"` narrows `retryAfterMs` to a definite `number` at every call site below —
// TypeScript cannot narrow an independently-optional field off a sibling literal check otherwise.
export type RetrySignal = { kind: "provider-wait"; retryAfterMs: number } | { kind: "null-yield" | "cancelled" | "generic" };

// Bundle-confirmed literal (cli.js emit site, see module doc comment above) — the give-up
// message itself carries the exact ms the provider requested.
const PROVIDER_WAIT_GIVEUP_RE = /Provider requested (\d+)ms wait, exceeds retry\.maxDelayMs/i;
// Bundle-confirmed `t30()`'s own normalization tail (`${msg} retry-after-ms=${q}`) and any
// upstream error text that already embeds this token verbatim.
const RETRY_AFTER_MS_TEXT_RE = /retry-after-ms\s*[:=]\s*(\d+)/i;
// Bundle-confirmed literal: `E.warn("Assistant returned empty stop after retry cap", ...)` /
// `finalError:"Assistant returned empty stop after retry cap"`.
const NULL_YIELD_RE = /empty stop after retry cap/i;
// Bundle-confirmed literal: `finalError:"Retry cancelled"`.
const CANCELLED_RE = /Retry cancelled/i;

function retryAfterMsFromHeaders(headers: Record<string, string> | undefined): number | undefined {
	if (!headers) return undefined;
	const lower = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
	const msHeader = lower.get("retry-after-ms");
	if (msHeader !== undefined) {
		const ms = Number(msHeader);
		if (Number.isFinite(ms) && ms >= 0) return ms;
	}
	const header = lower.get("retry-after");
	if (header !== undefined) {
		const seconds = Number(header);
		if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
		const dateMs = Date.parse(header);
		if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
	}
	return undefined;
}

/** Pure parser: retry-after in milliseconds from either an errorMessage string or a headers object (or both — errorMessage wins, mirroring the host's own give-up message being the most authoritative source). Undefined when neither input yields one. */
export function parseRetryAfterMs(input: RetrySignalInput): number | undefined {
	const msg = input.errorMessage ?? "";
	const giveup = PROVIDER_WAIT_GIVEUP_RE.exec(msg);
	if (giveup) return Number(giveup[1]);
	const embedded = RETRY_AFTER_MS_TEXT_RE.exec(msg);
	if (embedded) return Number(embedded[1]);
	return retryAfterMsFromHeaders(input.headers);
}

/** Pure classifier (CS-8): which of the four signatures this auto_retry_end's failure matches. "provider-wait" always carries the parsed retryAfterMs. */
export function classifyRetrySignal(input: RetrySignalInput): RetrySignal {
	const msg = input.errorMessage ?? "";
	if (CANCELLED_RE.test(msg)) return { kind: "cancelled" };
	const retryAfterMs = parseRetryAfterMs(input);
	if (retryAfterMs !== undefined) return { kind: "provider-wait", retryAfterMs };
	if (NULL_YIELD_RE.test(msg)) return { kind: "null-yield" };
	return { kind: "generic" };
}

// ---------------------------------------------------------------------------
// DR-2 activation: sticky pre-craft flag + craft-durable OR.
// ---------------------------------------------------------------------------

export interface StickyToolExecutionInput {
	toolName: string;
	args?: unknown;
}

/** Pure decision: does this tool_execution_start observation prove lets-craft's pipeline is in use this session (DR-2)? Recognizes both the flat single-spawn task form ({agent}) and the batch form ({tasks: [{agent}, ...]}). */
export function shouldSetStickyForToolExecution(event: StickyToolExecutionInput): boolean {
	if (event.toolName.startsWith("lsc_")) return true;
	if (event.toolName === "task") {
		const args = event.args as Record<string, unknown> | undefined;
		const agent = args?.agent;
		if (typeof agent === "string" && agent.startsWith("lsc-")) return true;
		const tasks = args?.tasks;
		if (Array.isArray(tasks)) {
			for (const item of tasks) {
				if (item === null || typeof item !== "object") continue;
				const itemAgent = (item as Record<string, unknown>).agent;
				if (typeof itemAgent === "string" && itemAgent.startsWith("lsc-")) return true;
			}
		}
	}
	return false;
}

let stickyActive = false;

/** Mark this session as lets-craft-active (DR-2) — monotonic for the session's lifetime, cleared only by resetWatchdogState (session transitions). */
export function markWatchdogActive(): void {
	stickyActive = true;
}

/** Whether the watchdog should act at all this session: an active durable craft OR the sticky pre-craft flag. Everything in this module downstream of an inactive result is a full no-op. */
export function isWatchdogActive(): boolean {
	return stickyActive || getActiveCraft() !== undefined;
}

// ---------------------------------------------------------------------------
// Pending-resume state + bounded auto-resume (CS-2, CS-7). Module-scope singleton, same pattern
// as state.ts's activeCraft / destructive-approval.ts's pendingApproval — not persisted (a
// process restart wiping it is acceptable: every resume is notification-backed, plan Risks table).
// ---------------------------------------------------------------------------

export interface PendingResume {
	retryAfterMs: number;
	/** Date.now() at schedule time — the freshness anchor the timer callback re-checks against (CS-2's "at" re-confirmation) so a superseded/cleared pending can never fire late. */
	at: number;
}

/** Per-session cap on unattended auto-resumes (plan §"유계 조건"). Exceeding it stops scheduling new timers but never stops detection/notification. */
export const MAX_AUTO_RESUMES = 3;

/** Env var gate for CS-7's unattended auto-resume action — same "env var is the config entry point" convention as LSC_FIXTURE/LSC_DEBUG (fixtures.ts). Detection + notification are unaffected by this flag; only the timer-based sendUserMessage resume is gated. */
export const AUTO_RESUME_ENV = "LSC_WATCHDOG_AUTO_RESUME";

/**
 * CS-8 additional guard (P1 follow-up, `_docs/429-pattern-analysis.md` §4-2/§5): observed
 * provider-wait `retryAfterMs` values span 5 seconds to 48.6 hours across the analyzed session
 * corpus (a ~3.5-order-of-magnitude range), with values above ~41h occurring in 15/57 (26%) of
 * parseable cases — not a rare tail. Scheduling a real setTimeout for a wait that long would leave
 * the watchdog holding a session "pending resume" for up to two days, which is not a useful
 * unattended action even though the signature is genuinely provider-wait. Above this cutoff,
 * `decideScheduleResume` downgrades to notify-only instead of scheduling (the analysis's own
 * recommended range was "1~2시간"; this module takes the upper end).
 */
export const DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS = 7_200_000; // 2h

/** Env var override for the CS-8 cutoff above — same config-entry-point convention as AUTO_RESUME_ENV. */
export const AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV = "LSC_WATCHDOG_AUTO_RESUME_MAX_RETRY_AFTER_MS";

let watchdogPending: PendingResume | undefined;
let resumeCount = 0;
/** The live setTimeout handle backing `watchdogPending`, if any (m1 review) — tracked so clearWatchdogPending/resetWatchdogState can actually cancel it (clearTimeout) instead of leaving it ticking in the background relying solely on the `at`-freshness check to no-op it away. */
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

export function getWatchdogPending(): PendingResume | undefined {
	return watchdogPending;
}

export function getWatchdogResumeCount(): number {
	return resumeCount;
}

/** Cancel the live timer handle, if any (m1). Safe to call when there is none. */
function clearPendingTimer(): void {
	if (pendingTimer !== undefined) {
		clearTimeout(pendingTimer);
		pendingTimer = undefined;
	}
}

/** Debounce entry point (CS-2): clears any pending resume AND cancels its backing timer (m1). Wired to turn_start, auto_retry_end(success:true), and auto_retry_start (a retry attempt in flight means the host is already recovering on its own). Safe to call when there is no pending — a no-op. */
export function clearWatchdogPending(): void {
	watchdogPending = undefined;
	clearPendingTimer();
}

function setWatchdogPending(pending: PendingResume): void {
	watchdogPending = pending;
}

function incrementWatchdogResumeCount(): number {
	resumeCount += 1;
	return resumeCount;
}

/** Reset all in-memory watchdog state — wired to session_switch/session_branch/session_shutdown (mirrors state.ts's registerCraftStateResets), so a new/forked session never inherits a stale sticky flag, pending resume, resume count, or live timer (m1) from whatever came before it. */
export function resetWatchdogState(): void {
	stickyActive = false;
	watchdogPending = undefined;
	resumeCount = 0;
	clearPendingTimer();
}

/**
 * Read the CS-7 auto-resume gate. Defaults ON: P1 (`_docs/429-pattern-analysis.md` §5) judged the
 * 429/provider-wait stalls this watchdog targets a "구조적 반복" (structural repeat) — 23 storms
 * across 4/8 observed activity days, 5+ recurrences of the exact same signature across 2 projects
 * and 3 dates, all with zero host-side `retryRecovery` — satisfying the plan's own CS-7 gate
 * condition ("P1이 '구조적 반복' 판정 시 활성화") verbatim. Still overridable per-session via
 * LSC_WATCHDOG_AUTO_RESUME (accepts "0"/"false"/"off"/"no", case-insensitive, to opt back out) —
 * detection + notification are never affected by this flag, only the timer-based resume action.
 */
export function isAutoResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	const raw = env[AUTO_RESUME_ENV];
	if (raw === undefined) return true;
	const normalized = raw.trim().toLowerCase();
	return normalized !== "0" && normalized !== "false" && normalized !== "off" && normalized !== "no";
}

/** Read the CS-8 cutoff (see DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS doc comment above). Falls back to the default for an absent, non-numeric, or non-positive override. */
export function getAutoResumeMaxRetryAfterMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[AUTO_RESUME_MAX_RETRY_AFTER_MS_ENV];
	if (raw === undefined) return DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS;
	const parsed = Number(raw);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS;
}

export type ScheduleResumeAction = "schedule" | "limit-exceeded" | "cutoff-exceeded" | "flag-off";

export interface ScheduleResumeDecision {
	action: ScheduleResumeAction;
}

export interface ScheduleResumeInput {
	resumeCount: number;
	autoResumeEnabled: boolean;
	retryAfterMs: number;
	maxRetryAfterMs: number;
}

/**
 * Pure gate for whether a provider-wait auto_retry_end should schedule a resume timer. Check
 * order: (1) the 3-resume cap wins first regardless of anything else below — once it's hit,
 * every subsequent stall is "limit-exceeded" (plan §"유계 조건"); (2) the CS-8 retry-after cutoff
 * — a wait longer than this is downgraded to notify-only even though it IS a provider-wait
 * signature, because scheduling a multi-hour/multi-day timer is not a useful unattended action
 * (P1 follow-up, see DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS); (3) the CS-7 flag — off means
 * notify-only with no further distinction from the cutoff case at the caller.
 */
export function decideScheduleResume(input: ScheduleResumeInput): ScheduleResumeDecision {
	if (input.resumeCount >= MAX_AUTO_RESUMES) return { action: "limit-exceeded" };
	if (input.retryAfterMs > input.maxRetryAfterMs) return { action: "cutoff-exceeded" };
	if (!input.autoResumeEnabled) return { action: "flag-off" };
	return { action: "schedule" };
}

/** Pure "single entry point" gate (see module doc comment): true iff an active craft's OWN session_stop backstop (enforcement.ts) already forces continuation unconditionally, so this module's resume action must stand down to avoid a duplicate turn-injection. Reuses enforcement.ts's own shouldContinueCraftLoop rather than re-deriving the condition. */
export function shouldSuppressResumeForCraftBackstop(craft: CraftState | undefined): boolean {
	return craft !== undefined && shouldContinueCraftLoop(craft);
}

/** The exact CS-2 resume nudge text — deliberately states it is NOT a new instruction, so the resumed turn doesn't misread it as a fresh user request. */
export function buildResumeMessage(retryAfterSeconds: number, attempt: number): string {
	return (
		`[lsc-watchdog] provider rate-limit(retry-after ${retryAfterSeconds}s)으로 정지된 세션을 자동 재개합니다 (${attempt}/${MAX_AUTO_RESUMES}회). ` +
		"이것은 새 지시가 아닙니다 — 직전 단계의 대기/판정을 그대로 이어서 진행하세요."
	);
}

export interface ResumeTimerContext {
	/** The `at` this specific timer instance was scheduled with — the freshness anchor. */
	expectedAt: number;
	retryAfterMs: number;
	getPending: () => PendingResume | undefined;
	getActiveCraftState: () => CraftState | undefined;
	isIdle: () => boolean;
	sendUserMessage: (text: string) => void;
	notifyAutoResumed: (attempt: number) => void;
	incrementResumeCount: () => number;
	clearPending: () => void;
}

/**
 * Pure(-ish, via injected effects) timer-fire core (CS-2) — directly unit-testable with fake
 * functions, no real setTimeout/vi.useFakeTimers required (mirrors run-tests.ts's ExecFn
 * injection). Order of checks: (1) freshness — a superseded/cleared pending means some other
 * debounce already handled this stall, so this stale firing does nothing; (2) craft-side
 * suppression — an aborted craft (explicit user stop, craft-scoped only per CS-3) or one whose
 * own backstop already forces continuation (single entry point, see module doc) both stand down;
 * (3) idle — only ever nudge a session that is actually idle (a live/streaming session already
 * recovered on its own, so the stale pending is cleared and dropped, never queued as a steer).
 *
 * The whole body is wrapped in try/catch (M1 review): this fires minutes-to-hours after it was
 * scheduled, so `ctx.isIdle()`/`ctx.sendUserMessage()` are bound to a session that may no longer
 * be in a state those calls expect (a stale ctx) — a throw there must never crash the timer
 * callback, matching notify.ts's own "swallow, never propagate" contract. `clearPending` itself is
 * called from inside the catch too (best-effort, its own throw is separately guarded) so a failed
 * attempt never leaves a stale pending sitting around forever.
 */
export function runResumeTimerCallback(ctx: ResumeTimerContext): void {
	try {
		const pending = ctx.getPending();
		if (!pending || pending.at !== ctx.expectedAt) return;

		const craft = ctx.getActiveCraftState();
		if (craft?.aborted || shouldSuppressResumeForCraftBackstop(craft)) {
			ctx.clearPending();
			return;
		}

		if (!ctx.isIdle()) {
			ctx.clearPending();
			return;
		}

		const attempt = ctx.incrementResumeCount();
		ctx.clearPending();
		const seconds = Math.round(ctx.retryAfterMs / 1000);
		ctx.sendUserMessage(buildResumeMessage(seconds, attempt));
		ctx.notifyAutoResumed(attempt);
	} catch (error) {
		try {
			ctx.clearPending();
		} catch {
			// best-effort cleanup only — see the doc comment above.
		}
		if (process.env.LSC_DEBUG) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`lets-craft: watchdog resume timer callback failed — ${message}`);
		}
	}
}

/** A few seconds of jitter added to the scheduled delay (CS-2: "retryAfterMs(+지터 수초)") so multiple sessions stalled on the same provider outage don't all retry in perfect lockstep. Not exported/tested directly (non-deterministic by design) — only the pure runResumeTimerCallback above is asserted on in tests. */
function jitterMs(): number {
	return 1000 + Math.floor(Math.random() * 4000);
}

function scheduleResume(pi: ExtensionAPI, isIdle: () => boolean, retryAfterMs: number, at: number): void {
	clearPendingTimer(); // at most one live timer at a time (m1) — a superseding stall cancels the old one outright
	const delay = retryAfterMs + jitterMs();
	const timer = setTimeout(() => {
		pendingTimer = undefined;
		runResumeTimerCallback({
			expectedAt: at,
			retryAfterMs,
			getPending: getWatchdogPending,
			getActiveCraftState: getActiveCraft,
			isIdle,
			sendUserMessage: text => pi.sendUserMessage(text),
			notifyAutoResumed: attempt => {
				void notifyAutoResumed(attempt, MAX_AUTO_RESUMES, pi.exec);
			},
			incrementResumeCount: incrementWatchdogResumeCount,
			clearPending: clearWatchdogPending,
		});
	}, delay);
	// unref() (m1) so a multi-hour cutoff-adjacent wait never keeps the process/event loop alive
	// on its own — Node/Bun-only (absent from some non-Node globals, e.g. under certain test
	// environments), so guard the call rather than assume it exists.
	const unrefable = timer as unknown as { unref?: () => void };
	if (typeof unrefable.unref === "function") unrefable.unref();
	pendingTimer = timer;
}

/** Reset in-memory watchdog state on the same session-transition events state.ts's craft resets use — a new/forked/closed session must never inherit stale sticky/pending/count. */
function registerWatchdogStateResets(pi: ExtensionAPI): void {
	pi.on("session_switch", () => resetWatchdogState());
	pi.on("session_branch", () => resetWatchdogState());
	pi.on("session_shutdown", () => resetWatchdogState());
}

/**
 * Wire the watchdog into the host. TUI-only (`ctx.hasUI`) — print/RPC/fixture-mode sessions are
 * one-shot and headless, so an unattended resume nudge makes no sense there and `session_stop`
 * itself never fires for them anyway (the same existing lesson enforcement.ts's own backstop
 * already lives with, run-tests.ts:168).
 */
export function registerWatchdog(pi: ExtensionAPI): void {
	pi.on("tool_execution_start", (event, ctx) => {
		if (!ctx.hasUI) return;
		if (shouldSetStickyForToolExecution({ toolName: event.toolName, args: event.args })) markWatchdogActive();
	});

	pi.on("turn_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		clearWatchdogPending();
	});

	pi.on("auto_retry_start", (_event, ctx) => {
		if (!ctx.hasUI) return;
		// No isWatchdogActive() guard (m4 review): symmetric with the turn_start handler above —
		// clearWatchdogPending is already a no-op when there is nothing pending (e.g. the watchdog
		// is inactive this session), so the extra check only added an unnecessary asymmetry.
		clearWatchdogPending();
	});

	pi.on("auto_retry_end", async (event, ctx) => {
		if (!ctx.hasUI) return;
		if (event.success) {
			clearWatchdogPending();
			return;
		}
		if (!isWatchdogActive()) return;

		const craft = getActiveCraft();
		// Craft-scoped explicit stop (CS-3) — full watchdog no-op, not just resume suppression.
		// pre-craft has no equivalent explicit-stop signal; that gap is partly covered by the
		// "cancelled" signature below, not by this check.
		if (craft?.aborted) return;

		const signal = classifyRetrySignal({ errorMessage: event.finalError });
		if (signal.kind === "cancelled") {
			// CS-8: "Retry cancelled" is treated as a user-explicit stop — suppress entirely,
			// never resume.
			clearWatchdogPending();
			return;
		}

		await notifyMainStalled(signal.kind === "provider-wait" ? signal.retryAfterMs : undefined, pi.exec);

		if (signal.kind !== "provider-wait") return; // null-yield/generic: notify-only (CS-8)

		if (shouldSuppressResumeForCraftBackstop(craft)) return; // single entry point — the craft backstop already owns continuation

		const decision = decideScheduleResume({
			resumeCount: getWatchdogResumeCount(),
			autoResumeEnabled: isAutoResumeEnabled(),
			retryAfterMs: signal.retryAfterMs,
			maxRetryAfterMs: getAutoResumeMaxRetryAfterMs(),
		});
		if (decision.action === "limit-exceeded") {
			await notifyResumeLimitExceeded(MAX_AUTO_RESUMES, pi.exec);
			return;
		}
		if (decision.action === "cutoff-exceeded") {
			await notifyAutoResumeSkippedCutoff(signal.retryAfterMs, pi.exec);
			return;
		}
		if (decision.action === "flag-off") return; // detection + notification only — CS-7 flag explicitly disabled

		const at = Date.now();
		setWatchdogPending({ retryAfterMs: signal.retryAfterMs, at });
		scheduleResume(pi, () => ctx.isIdle(), signal.retryAfterMs, at);
	});

	registerWatchdogStateResets(pi);
}
