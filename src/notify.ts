// OS notifications for the watchdog's visibility contract (C3-a, plan U5). macOS-only via
// `pi.exec("osascript", ...)` — no webhook/cross-platform channel (DR-4, R5 interview explicitly
// declined it). Every call is fire-and-forget from the caller's perspective: a missing osascript
// binary, a non-macOS host, or any exec failure is swallowed here so a notification glitch can
// never block or fail the pipeline it is reporting on (plan U5.2 "실패는 삼켜서 파이프라인에 영향
// 없음"). This module owns ONLY the four event-shaped helpers + the low-level primitive; it has
// no opinion on WHEN to notify — that policy lives in watchdog.ts (main stall/auto-resume/limit)
// and, for pre-craft completion, whatever future caller wires it (exported here, not invoked by
// the watchdog itself — out of its scope per the team-lead handoff).
import type { ExecOptions, ExecResult } from "@oh-my-pi/pi-coding-agent";

/** Same shape as run-tests.ts's ExecFn — `pi.exec` in production, a mock in tests. */
export type ExecFn = (command: string, args: string[], options?: ExecOptions) => Promise<ExecResult>;

/** Escape a string for safe interpolation inside an AppleScript double-quoted literal. */
function escapeAppleScriptString(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Fire a macOS notification via `osascript -e 'display notification ...'`. No-op on any
 * non-darwin platform (checked BEFORE calling exec, so tests never need a real osascript
 * binary); any exec rejection (binary missing, sandboxed, etc.) is caught and swallowed —
 * this function never throws and never rejects.
 */
export async function notify(title: string, message: string, exec: ExecFn, platform: NodeJS.Platform = process.platform): Promise<void> {
	if (platform !== "darwin") return;
	try {
		const script = `display notification "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}"`;
		await exec("osascript", ["-e", script]);
	} catch {
		// Swallowed by design (plan U5.2) — a notification failure must never surface to the
		// pipeline it is merely reporting on.
	}
}

/** Event ① — the main session stalled on a provider error (watchdog.ts's auto_retry_end anchor). `retryAfterMs` is included when the provider-wait signature parsed one (undefined for null-yield/generic causes). */
export function notifyMainStalled(retryAfterMs: number | undefined, exec: ExecFn, platform?: NodeJS.Platform): Promise<void> {
	const message =
		retryAfterMs !== undefined
			? `lets-craft: 세션이 provider rate-limit(retry-after ${Math.round(retryAfterMs / 1000)}s)으로 정지되었습니다.`
			: "lets-craft: 세션이 provider 오류로 정지되었습니다.";
	return notify("lets-craft: 세션 정지", message, exec, platform);
}

/** Event ② — the watchdog auto-resumed the session (fires alongside the sendUserMessage resume nudge, never on its own). */
export function notifyAutoResumed(attempt: number, exec: ExecFn, platform?: NodeJS.Platform): Promise<void> {
	return notify("lets-craft: 자동 재개", `lets-craft: 세션을 자동 재개했습니다 (${attempt}/${3}회).`, exec, platform);
}

/** Event ③ — the per-session auto-resume cap (3) was already reached; no further unattended resume will happen. */
export function notifyResumeLimitExceeded(exec: ExecFn, platform?: NodeJS.Platform): Promise<void> {
	return notify("lets-craft: 재개 한도 초과", "lets-craft: 자동 재개 한도(3회)를 초과했습니다 — 수동 확인이 필요합니다.", exec, platform);
}

/** Event ④ — pre-craft finished. Exported for whichever pre-craft completion hook wants it (out of the watchdog's own scope, plan U5.1). */
export function notifyPreCraftComplete(feature: string, exec: ExecFn, platform?: NodeJS.Platform): Promise<void> {
	return notify("lets-craft: pre-craft 완료", `lets-craft: "${feature}" pre-craft가 완료되었습니다.`, exec, platform);
}

/**
 * CS-8 cutoff notification (P1 follow-up, `_docs/429-pattern-analysis.md`) — fires alongside
 * notifyMainStalled when a provider-wait retryAfterMs exceeds the auto-resume cutoff
 * (watchdog.ts's DEFAULT_AUTO_RESUME_MAX_RETRY_AFTER_MS): the session is deliberately NOT
 * auto-resumed for this particular stall (an unattended multi-hour/multi-day timer is not useful)
 * and needs a manual nudge instead.
 */
export function notifyAutoResumeSkippedCutoff(retryAfterMs: number, exec: ExecFn, platform?: NodeJS.Platform): Promise<void> {
	const hours = (retryAfterMs / 3_600_000).toFixed(1);
	return notify("lets-craft: 자동 재개 보류", `lets-craft: retry-after가 ${hours}시간이라 자동 재개를 보류합니다 — 수동 재개 필요.`, exec, platform);
}
