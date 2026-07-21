// `lsc_latency_report` — post-craft's sole visibility tool into where a lets-craft session's
// wall-clock actually went (C3-c, plan U7/DR-3/CS-6, AC6). Built from the round-2 investigation's
// real-world jsonl schema (this repo's dogfooding sessions, not a guess):
//   - the session directory (`ctx.sessionManager.getSessionDir()`) holds the main session's own
//     jsonl as one file, plus sibling `<AgentLabel>.jsonl` subagent sessions (spawned via `task`),
//     plus one level of subdirectories holding nested re-spawns' own jsonl files.
//   - each line is an entry: `{type:"message", timestamp, message:{role, duration, ttft,
//     stopReason, errorStatus, errorMessage, usage, content:[...]}}` or
//     `{type:"custom", customType:"tool_execution_start", data:{toolCallId, toolName, startedAt,
//     args, intent}}` (plus other entry types this module ignores: model_change,
//     thinking_level_change, compaction, branch_summary, custom_message, label, ...).
//
// Main-session entries come from the LIVE `ctx.sessionManager.getEntries()` (DR-3: always
// available, always current even if the file hasn't been flushed yet — no file I/O needed or
// wanted for the one session this extension already has a live handle to). Subagent sessions have
// no live handle available to this extension, so those ARE read from disk via
// `getSessionDir()` (falling back to a caller-supplied `session_dir` override when unavailable,
// per DR-3's contract).
//
// The six-row markdown table (실작업/에러·재시도/스톨/인간 게이트/메인 생성/기타) is a DELIBERATE
// mutually-exclusive partition of wall-clock time, not a raw dump of every measurable quantity —
// see the big comment on `buildLatencyReportFromEntries` below for exactly how each bucket is
// computed and why "기타" is a residual, not a directly-measured value. Every aggregation step is
// defensive: unparseable jsonl lines, missing fields, and unreadable sub-files are recorded as
// warnings and skipped, never thrown (a partial report beats no report, and this tool must never
// be the thing that fails a wrap-up flow).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

// ---------------------------------------------------------------------------
// Loose entry shapes — deliberately NOT the SDK's own SessionEntry/AgentMessage types. This
// module parses raw JSON off disk (and off getEntries(), which returns the SDK's real types, but
// duck-typed access below is identical either way) and must tolerate any future field
// additions/removals without a compile-time coupling to the SDK's schema — the whole point of the
// "방어적 파싱" contract (never throw on a format change, degrade to "미상"/warnings instead).
// ---------------------------------------------------------------------------

export interface RawContentItem {
	type?: string;
	toolCallId?: string;
	name?: string;
	[key: string]: unknown;
}

export interface RawMessage {
	role?: string;
	duration?: number;
	ttft?: number;
	stopReason?: string;
	errorStatus?: string | number;
	errorMessage?: string;
	toolCallId?: string;
	content?: RawContentItem[];
	[key: string]: unknown;
}

export interface RawEntry {
	type?: string;
	id?: string;
	timestamp?: string;
	message?: RawMessage;
	customType?: string;
	data?: Record<string, unknown>;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// jsonl parsing (file-path input mode) — one malformed line never sinks the rest of the file.
// ---------------------------------------------------------------------------

export interface ParsedSessionFile {
	entries: RawEntry[];
	warnings: string[];
}

/** Parse a session jsonl's raw text into entries, skipping (and warning on) any line that isn't valid JSON or isn't an object — the session header line (`{"type":"session",...}`) parses fine here and is simply ignored downstream by every aggregator (none of them match on `type:"session"`). */
export function parseSessionJsonl(content: string, sourceLabel: string): ParsedSessionFile {
	const entries: RawEntry[] = [];
	const warnings: string[] = [];
	const lines = content.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line.length === 0) continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (parsed && typeof parsed === "object") entries.push(parsed as RawEntry);
			else warnings.push(`${sourceLabel}: line ${i + 1} parsed to a non-object value — skipped.`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${sourceLabel}: line ${i + 1} failed to parse as JSON — ${message}. Skipped.`);
		}
	}
	return { entries, warnings };
}

export interface DiscoveredSubSession {
	label: string;
	path: string;
}

export interface DiscoverSubSessionsResult {
	files: DiscoveredSubSession[];
	warnings: string[];
}

/** (L2) Sub-session files larger than this are skipped rather than handed to a later `readFileSync` — a runaway/pathological jsonl file must not turn a latency report into a multi-hundred-MB memory spike. */
export const MAX_SUB_SESSION_FILE_BYTES = 50 * 1024 * 1024; // 50MB

function oversizeWarning(label: string, sizeBytes: number): string {
	return `${label}: 파일 크기 ${(sizeBytes / (1024 * 1024)).toFixed(1)}MB가 50MB 상한을 초과해 건너뜁니다(메모리 보호).`;
}

/**
 * Discover subagent jsonl files under a session directory (CS-6: real shape confirmed against
 * this repo's own dogfooding sessions) — every `*.jsonl` directly in `sessionDir` except the main
 * session's own file, plus one level of subdirectories' own `*.jsonl` files (nested re-spawns).
 * Never throws: an unreadable `sessionDir` or subdirectory yields an empty/partial list, not an
 * exception (mirrors verdict.ts's TOCTOU tolerance for readdirSync/statSync races). A file over
 * `MAX_SUB_SESSION_FILE_BYTES` (L2) is skipped with a warning rather than queued for a later
 * `readFileSync`.
 */
export function discoverSubSessionFiles(sessionDir: string, mainSessionFile: string | undefined): DiscoverSubSessionsResult {
	const files: DiscoveredSubSession[] = [];
	const warnings: string[] = [];
	if (!existsSync(sessionDir)) return { files, warnings };
	const mainBase = mainSessionFile ? basename(mainSessionFile) : undefined;

	let names: string[];
	try {
		names = readdirSync(sessionDir);
	} catch {
		return { files, warnings };
	}

	for (const name of names) {
		const full = join(sessionDir, name);
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(full);
		} catch {
			continue; // TOCTOU: vanished between readdir and stat — drop, not fatal.
		}
		if (stat.isFile()) {
			if (name.endsWith(".jsonl") && name !== mainBase) {
				if (stat.size > MAX_SUB_SESSION_FILE_BYTES) {
					warnings.push(oversizeWarning(name, stat.size));
					continue;
				}
				files.push({ label: name.replace(/\.jsonl$/, ""), path: full });
			}
		} else if (stat.isDirectory()) {
			let nestedNames: string[];
			try {
				nestedNames = readdirSync(full);
			} catch {
				continue;
			}
			for (const nested of nestedNames) {
				if (!nested.endsWith(".jsonl")) continue;
				const nestedFull = join(full, nested);
				let nestedStat: ReturnType<typeof statSync>;
				try {
					nestedStat = statSync(nestedFull);
				} catch {
					continue; // TOCTOU: vanished between readdir and stat — drop, not fatal.
				}
				const label = `${name}/${nested.replace(/\.jsonl$/, "")}`;
				if (nestedStat.size > MAX_SUB_SESSION_FILE_BYTES) {
					warnings.push(oversizeWarning(label, nestedStat.size));
					continue;
				}
				files.push({ label, path: nestedFull });
			}
		}
	}
	return { files, warnings };
}

export interface ParsedSubSessions {
	subs: Array<{ label: string; entries: RawEntry[] }>;
	warnings: string[];
}

/** Read + parse every discovered sub-session file. A file that vanishes/becomes unreadable between discovery and read (TOCTOU) is dropped with a warning, not fatal to the rest. */
export function parseSubSessionFiles(files: readonly DiscoveredSubSession[]): ParsedSubSessions {
	const subs: Array<{ label: string; entries: RawEntry[] }> = [];
	const warnings: string[] = [];
	for (const file of files) {
		let content: string;
		try {
			content = readFileSync(file.path, "utf8");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`${file.label}: could not read ${file.path} — ${message}. Skipped.`);
			continue;
		}
		const parsed = parseSessionJsonl(content, file.label);
		subs.push({ label: file.label, entries: parsed.entries });
		warnings.push(...parsed.warnings);
	}
	return { subs, warnings };
}

// ---------------------------------------------------------------------------
// Pure aggregators — each operates on a single entries array (main or one sub), so the same
// function serves both without duplication.
// ---------------------------------------------------------------------------

function toEpochMs(timestamp: string | undefined): number | undefined {
	if (!timestamp) return undefined;
	const ms = Date.parse(timestamp);
	return Number.isNaN(ms) ? undefined : ms;
}

export interface WallClock {
	startMs?: number;
	endMs?: number;
	durationMs?: number;
}

/** First-to-last timestamp span across an entries array. Undefined fields when no entry carries a parseable timestamp (empty/entirely-malformed input) — callers must treat that as "미상", never divide by it. */
export function computeWallClock(entries: readonly RawEntry[]): WallClock {
	let start: number | undefined;
	let end: number | undefined;
	for (const entry of entries) {
		const ms = toEpochMs(entry.timestamp);
		if (ms === undefined) continue;
		if (start === undefined || ms < start) start = ms;
		if (end === undefined || ms > end) end = ms;
	}
	if (start === undefined || end === undefined) return {};
	return { startMs: start, endMs: end, durationMs: Math.max(0, end - start) };
}

export interface AssistantTurnAgg {
	errorCount: number;
	errorDurationMs: number;
	nonErrorDurationMs: number;
	errorStatusHistogram: Record<string, number>;
	missingDurationCount: number;
}

/** Sum assistant-turn durations, split by whether the turn's stopReason was "error" — the shared half of both "메인 생성" (main, non-error) and "에러·재시도" (main+sub, error) below. A turn with a non-numeric/negative duration is counted as `missingDurationCount` (surfaced as a warning by the caller) rather than silently treated as 0, so a systematically-missing field is visible instead of just quietly deflating the totals. */
export function aggregateAssistantTurns(entries: readonly RawEntry[]): AssistantTurnAgg {
	const agg: AssistantTurnAgg = { errorCount: 0, errorDurationMs: 0, nonErrorDurationMs: 0, errorStatusHistogram: {}, missingDurationCount: 0 };
	for (const entry of entries) {
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
		const rawDuration = entry.message.duration;
		const duration = typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : undefined;
		const isError = entry.message.stopReason === "error";
		if (isError) {
			agg.errorCount += 1;
			const status = entry.message.errorStatus !== undefined ? String(entry.message.errorStatus) : "unknown";
			agg.errorStatusHistogram[status] = (agg.errorStatusHistogram[status] ?? 0) + 1;
		}
		if (duration === undefined) {
			agg.missingDurationCount += 1;
			continue;
		}
		if (isError) agg.errorDurationMs += duration;
		else agg.nonErrorDurationMs += duration;
	}
	return agg;
}

export interface StallGap {
	entryId?: string;
	timestamp?: string;
	gapMs: number;
}

/**
 * Main-session stall gaps (plan: "메인 스톨 갭... 오류 후 무기록 구간"): for every assistant turn
 * whose stopReason is "error", the gap to the NEXT entry in the file (chronological, since jsonl
 * is append-only) — the wall-clock the session sat idle after an error before anything else was
 * recorded. The trailing entry (no "next") is skipped: there is no bounded gap to measure without
 * assuming an arbitrary end time. Returned sorted descending (largest stall first), unsliced —
 * callers take a top-N slice for display and sum the full list for the stall-time total.
 */
export function computeStallGaps(entries: readonly RawEntry[]): StallGap[] {
	const gaps: StallGap[] = [];
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.type !== "message" || entry.message?.role !== "assistant" || entry.message.stopReason !== "error") continue;
		const next = entries[i + 1];
		if (!next) continue;
		const thisMs = toEpochMs(entry.timestamp);
		const nextMs = toEpochMs(next.timestamp);
		if (thisMs === undefined || nextMs === undefined) continue;
		const gapMs = nextMs - thisMs;
		if (gapMs <= 0) continue;
		gaps.push({ entryId: entry.id, timestamp: entry.timestamp, gapMs });
	}
	return gaps.sort((a, b) => b.gapMs - a.gapMs);
}

const HUMAN_GATE_PATH_PREFIXES = ["xd://lsc_select", "xd://lsc_confirm", "xd://lsc_ask"];

/** A tool_execution_start is a human gate iff it's a `write` to one of the `xd://lsc_*` virtual paths (lsc_select/lsc_confirm/lsc_ask) — the platform's human-input channel (plan: "인간 게이트"). */
export function isHumanGateToolStart(toolName: string | undefined, args: unknown): boolean {
	if (toolName !== "write") return false;
	const path = (args as Record<string, unknown> | undefined)?.path;
	return typeof path === "string" && HUMAN_GATE_PATH_PREFIXES.some(prefix => path.startsWith(prefix));
}

function extractToolResultCallId(entry: RawEntry): string | undefined {
	if (typeof entry.message?.toolCallId === "string") return entry.message.toolCallId;
	const content = entry.message?.content;
	if (Array.isArray(content)) {
		const withId = content.find(item => typeof item?.toolCallId === "string");
		if (withId) return withId.toolCallId;
	}
	if (typeof entry.toolCallId === "string") return entry.toolCallId as string;
	return undefined;
}

export interface ToolWaitAgg {
	/** Non-human-gate tool_execution_start -> toolResult wait time (supplementary data, NOT one of the six partition rows — see buildLatencyReportFromEntries doc comment for why). */
	toolWaitMs: number;
	humanGateMs: number;
	matchedCount: number;
	unmatchedResultCount: number;
	danglingStartCount: number;
}

/**
 * Match each `tool_execution_start` custom entry to its corresponding `toolResult` message entry
 * and sum the elapsed wait, split into human-gate vs. ordinary tool wait. Matching prefers an
 * exact `toolCallId` (the expected linking field); when a toolResult carries no recognizable
 * `toolCallId` at all (format uncertainty this module must tolerate), falls back to FIFO pairing
 * against the oldest still-pending start — an approximation for out-of-schema results, not exact
 * for genuinely concurrent tool calls, but strictly better than dropping the data. Dangling starts
 * (never matched by end of the entries array) and unmatched results are counted, never thrown.
 */
export function aggregateToolWait(entries: readonly RawEntry[]): ToolWaitAgg {
	interface Pending {
		startedAtMs: number;
		isHumanGate: boolean;
	}
	const byCallId = new Map<string, Pending>();
	const fifo: Pending[] = [];
	let toolWaitMs = 0;
	let humanGateMs = 0;
	let matchedCount = 0;
	let unmatchedResultCount = 0;

	for (const entry of entries) {
		if (entry.type === "custom" && entry.customType === "tool_execution_start") {
			const data = entry.data as { toolCallId?: string; toolName?: string; startedAt?: string; args?: unknown } | undefined;
			const startedAtMs = toEpochMs(data?.startedAt) ?? toEpochMs(entry.timestamp);
			if (startedAtMs === undefined) continue; // no start time to bound a wait against — skip, not fatal.
			const pending: Pending = { startedAtMs, isHumanGate: isHumanGateToolStart(data?.toolName, data?.args) };
			if (typeof data?.toolCallId === "string") byCallId.set(data.toolCallId, pending);
			else fifo.push(pending);
			continue;
		}
		if (entry.type === "message" && entry.message?.role === "toolResult") {
			const callId = extractToolResultCallId(entry);
			let pending = callId !== undefined ? byCallId.get(callId) : undefined;
			if (pending && callId !== undefined) byCallId.delete(callId);
			if (!pending) pending = fifo.shift();
			if (!pending) {
				unmatchedResultCount += 1;
				continue;
			}
			const endMs = toEpochMs(entry.timestamp);
			if (endMs === undefined) continue;
			const waitMs = Math.max(0, endMs - pending.startedAtMs);
			if (pending.isHumanGate) humanGateMs += waitMs;
			else toolWaitMs += waitMs;
			matchedCount += 1;
		}
	}
	return { toolWaitMs, humanGateMs, matchedCount, unmatchedResultCount, danglingStartCount: byCallId.size + fifo.length };
}

function mergeHistograms(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
	const merged: Record<string, number> = { ...a };
	for (const [key, count] of Object.entries(b)) merged[key] = (merged[key] ?? 0) + count;
	return merged;
}

// ---------------------------------------------------------------------------
// Report assembly (pure, entry-array input — directly unit-testable with fixtures, no FS).
// ---------------------------------------------------------------------------

export interface LatencyReportSection {
	label: string;
	ms: number;
	ratio: number | undefined;
}

export interface LatencyReport {
	wallClockMs: number | undefined;
	wallClockStart: string | undefined;
	wallClockEnd: string | undefined;
	mainGenerationMs: number;
	actualWorkMs: number;
	errorRetryMs: number;
	errorTurnCount: number;
	errorStatusHistogram: Record<string, number>;
	stallMs: number;
	stallGapsTopMinutes: Array<{ entryId?: string; timestamp?: string; gapMinutes: number }>;
	humanGateMs: number;
	toolWaitMs: number;
	otherMs: number;
	sections: LatencyReportSection[];
	subSessionsAnalyzed: number;
	warnings: string[];
	markdown: string;
}

const MAX_STALL_GAPS_DISPLAYED = 10;

function formatMs(ms: number | undefined): string {
	if (ms === undefined || !Number.isFinite(ms)) return "미상";
	const totalSeconds = Math.round(Math.max(0, ms) / 1000);
	const h = Math.floor(totalSeconds / 3600);
	const m = Math.floor((totalSeconds % 3600) / 60);
	const s = totalSeconds % 60;
	const parts: string[] = [];
	if (h > 0) parts.push(`${h}h`);
	if (h > 0 || m > 0) parts.push(`${m}m`);
	parts.push(`${s}s`);
	return parts.join(" ");
}

function formatRatio(ratio: number | undefined): string {
	return ratio === undefined ? "미상" : `${(ratio * 100).toFixed(1)}%`;
}

function buildMarkdown(report: Omit<LatencyReport, "markdown">): string {
	const rows = report.sections.map(section => `| ${section.label} | ${formatMs(section.ms)} | ${formatRatio(section.ratio)} |`);
	const lines = [
		"| 구간 | 시간 | 비율 |",
		"|---|---|---|",
		...rows,
		`| **벽시계 합계** | ${formatMs(report.wallClockMs)} | 100.0% |`,
	];
	const partitionNote = ["", "> 구간 합은 중첩(서브 병렬 작업 등)으로 100%를 넘을 수 있음."];
	const supplement = [
		"",
		`- 도구 대기(비-게이트, 참고용 — 위 파티션에는 포함되지 않음): ${formatMs(report.toolWaitMs)}`,
		`- 에러 턴: ${report.errorTurnCount}건, 상태 분포: ${
			Object.keys(report.errorStatusHistogram).length > 0
				? Object.entries(report.errorStatusHistogram)
						.map(([status, count]) => `${status}=${count}`)
						.join(", ")
				: "미상"
		}`,
		`- 서브 세션 분석: ${report.subSessionsAnalyzed}개`,
	];
	const stallLines =
		report.stallGapsTopMinutes.length > 0
			? [
					"",
					"상위 메인 스톨 갭:",
					...report.stallGapsTopMinutes.map(gap => `- ${gap.timestamp ?? "미상"} 이후 ${gap.gapMinutes.toFixed(1)}분 (entry ${gap.entryId ?? "미상"})`),
				]
			: [];
	const warningLines = report.warnings.length > 0 ? ["", `경고 ${report.warnings.length}건:`, ...report.warnings.map(w => `- ${w}`)] : [];
	return [...lines, ...partitionNote, ...supplement, ...stallLines, ...warningLines].join("\n");
}

/**
 * Pure core: build a full latency report from already-parsed entry arrays — main session first,
 * then every discovered subagent session. No FS access here (the "엔트리 배열" half of the
 * contract's "입력: 엔트리 배열 또는 파일 경로들"); `buildLatencyReportFromFiles`/`performLatencyReport`
 * below do the file reads and then call this.
 *
 * The six-row table is a DELIBERATE mutually-exclusive partition of wall-clock time, each
 * millisecond counted in at most one bucket, so the percentages are meaningful next to each other:
 *   - **메인 생성**: main session's own non-error assistant-turn durations (orchestrator thinking/
 *     planning/tool-call generation time).
 *   - **실작업**: every subagent session's non-error assistant-turn durations SUMMED across all
 *     subs (spec: "가능하면 서브에이전트 합산") — the actual delegated compute this pipeline exists
 *     to produce, distinct from the orchestrator's own "메인 생성" time above.
 *   - **에러·재시도**: error-turn durations, main AND sub sessions combined (spec: "서브 jsonl의
 *     에러 턴 duration 합").
 *   - **스톨**: main-session stall-gap time (computeStallGaps' full sum, not just the displayed
 *     top-N) — idle wall-clock after an error with nothing recorded until the next entry.
 *   - **인간 게이트**: main-session tool_execution_start->toolResult wait time for the `xd://lsc_*`
 *     human-input gates specifically.
 *   - **기타**: the residual — `wallClock - (메인생성+실작업+에러재시도+스톨+인간게이트)`, floored at
 *     0. This absorbs everything NOT captured above: non-gate tool-exec wait for tool calls with no
 *     corresponding subagent session (a plain Read/Bash/Grep), thinking-only spans with no
 *     recorded `duration`, and any other unaccounted overhead. `toolWaitMs` (ordinary,
 *     non-human-gate tool wait) is reported separately as supplementary data rather than as a
 *     seventh partition row — subagent tool calls' wait time already overlaps with that subagent's
 *     own "실작업" contribution (the wait IS the subagent working), so adding it as its own row
 *     would double-count wall-clock time already counted once via 실작업.
 */
export function buildLatencyReportFromEntries(
	mainEntries: readonly RawEntry[],
	subs: readonly { label: string; entries: readonly RawEntry[] }[],
	extraWarnings: readonly string[] = [],
): LatencyReport {
	const warnings: string[] = [...extraWarnings];

	const wallClock = computeWallClock(mainEntries);
	if (wallClock.durationMs === undefined) warnings.push("메인 세션에서 유효한 timestamp를 가진 엔트리를 찾지 못했습니다 — 벽시계·비율이 미상입니다.");

	const mainAgg = aggregateAssistantTurns(mainEntries);
	if (mainAgg.missingDurationCount > 0) warnings.push(`메인 세션의 assistant 턴 ${mainAgg.missingDurationCount}건에 duration 필드가 없어 집계에서 제외했습니다.`);

	let actualWorkMs = 0;
	let subErrorDurationMs = 0;
	let errorCount = mainAgg.errorCount;
	let errorStatusHistogram = mainAgg.errorStatusHistogram;
	for (const sub of subs) {
		const subAgg = aggregateAssistantTurns(sub.entries);
		actualWorkMs += subAgg.nonErrorDurationMs;
		subErrorDurationMs += subAgg.errorDurationMs;
		errorCount += subAgg.errorCount;
		errorStatusHistogram = mergeHistograms(errorStatusHistogram, subAgg.errorStatusHistogram);
		if (subAgg.missingDurationCount > 0) warnings.push(`서브 세션 "${sub.label}"의 assistant 턴 ${subAgg.missingDurationCount}건에 duration 필드가 없어 집계에서 제외했습니다.`);
	}

	const stallGaps = computeStallGaps(mainEntries);
	const stallMs = stallGaps.reduce((sum, gap) => sum + gap.gapMs, 0);
	const stallGapsTopMinutes = stallGaps.slice(0, MAX_STALL_GAPS_DISPLAYED).map(gap => ({ entryId: gap.entryId, timestamp: gap.timestamp, gapMinutes: gap.gapMs / 60_000 }));

	const toolWait = aggregateToolWait(mainEntries);
	if (toolWait.unmatchedResultCount > 0) warnings.push(`메인 세션에서 매칭되지 않은 toolResult ${toolWait.unmatchedResultCount}건을 도구 대기 집계에서 제외했습니다.`);
	if (toolWait.danglingStartCount > 0) warnings.push(`메인 세션에서 응답이 관측되지 않은 tool_execution_start ${toolWait.danglingStartCount}건이 있습니다(집계에서 제외).`);

	const mainGenerationMs = mainAgg.nonErrorDurationMs;
	const errorRetryMs = mainAgg.errorDurationMs + subErrorDurationMs;
	const humanGateMs = toolWait.humanGateMs;
	const accountedMs = mainGenerationMs + actualWorkMs + errorRetryMs + stallMs + humanGateMs;
	const otherMs = wallClock.durationMs !== undefined ? Math.max(0, wallClock.durationMs - accountedMs) : 0;

	const ratioOf = (ms: number) => (wallClock.durationMs !== undefined && wallClock.durationMs > 0 ? ms / wallClock.durationMs : undefined);
	const sections: LatencyReportSection[] = [
		{ label: "실작업", ms: actualWorkMs, ratio: ratioOf(actualWorkMs) },
		{ label: "에러·재시도", ms: errorRetryMs, ratio: ratioOf(errorRetryMs) },
		{ label: "스톨", ms: stallMs, ratio: ratioOf(stallMs) },
		{ label: "인간 게이트", ms: humanGateMs, ratio: ratioOf(humanGateMs) },
		{ label: "메인 생성", ms: mainGenerationMs, ratio: ratioOf(mainGenerationMs) },
		{ label: "기타", ms: otherMs, ratio: ratioOf(otherMs) },
	];

	const base: Omit<LatencyReport, "markdown"> = {
		wallClockMs: wallClock.durationMs,
		wallClockStart: wallClock.startMs !== undefined ? new Date(wallClock.startMs).toISOString() : undefined,
		wallClockEnd: wallClock.endMs !== undefined ? new Date(wallClock.endMs).toISOString() : undefined,
		mainGenerationMs,
		actualWorkMs,
		errorRetryMs,
		errorTurnCount: errorCount,
		errorStatusHistogram,
		stallMs,
		stallGapsTopMinutes,
		humanGateMs,
		toolWaitMs: toolWait.toolWaitMs,
		otherMs,
		sections,
		subSessionsAnalyzed: subs.length,
		warnings,
	};
	return { ...base, markdown: buildMarkdown(base) };
}

/** File-path input mode (the other half of the contract): main entries are still supplied directly (the live caller already has them via getEntries()), only the sub-session files are read from disk here. */
export function buildLatencyReportFromFiles(mainEntries: readonly RawEntry[], subFiles: readonly DiscoveredSubSession[], extraWarnings: readonly string[] = []): LatencyReport {
	const { subs, warnings } = parseSubSessionFiles(subFiles);
	return buildLatencyReportFromEntries(mainEntries, subs, [...extraWarnings, ...warnings]);
}

// ---------------------------------------------------------------------------
// Tool wrapper (DR-3: getSessionDir() preferred, session_dir param fallback on failure).
// ---------------------------------------------------------------------------

export interface LatencyReportSessionAccess {
	getEntries: () => unknown[];
	getSessionDir: () => string;
	getSessionFile?: () => string | undefined;
}

/** Best-effort session-dir resolution: prefer the live sessionManager, fall back to a caller-supplied override on failure or an empty result — never throws, always returns a warning explaining a degraded (sub-less) report when neither source works. */
function resolveSessionDir(session: LatencyReportSessionAccess, overrideDir: string | undefined): { dir: string | undefined; warning?: string } {
	try {
		const dir = session.getSessionDir();
		if (dir) return { dir };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (overrideDir) return { dir: overrideDir, warning: `getSessionDir()가 실패했습니다(${message}) — 제공된 session_dir로 대체합니다.` };
		return { dir: undefined, warning: `getSessionDir()가 실패했습니다(${message}) — session_dir 인자도 없어 서브 세션을 찾지 못했습니다. 메인 세션만 집계합니다.` };
	}
	if (overrideDir) return { dir: overrideDir };
	return { dir: undefined, warning: "getSessionDir()가 빈 경로를 반환했고 session_dir 인자도 없어 서브 세션을 찾지 못했습니다. 메인 세션만 집계합니다." };
}

/**
 * Core `lsc_latency_report` logic, extracted from the registerTool wrapper (mirrors abort.ts/
 * release.ts/run-tests.ts's performX pattern) so it's unit-testable with a fake session-access
 * object — no ExtensionAPI/pi.zod mocking, real temp dirs for the sub-session file reads.
 */
export function performLatencyReport(session: LatencyReportSessionAccess, overrideSessionDir?: string): AgentToolResult<LatencyReport> {
	let mainEntries: unknown[];
	try {
		mainEntries = session.getEntries();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { isError: true, content: [{ type: "text", text: `lets-craft: could not read the current session's entries — ${message}.` }] };
	}

	const { dir, warning: dirWarning } = resolveSessionDir(session, overrideSessionDir);
	let mainSessionFile: string | undefined;
	if (dir && session.getSessionFile) {
		try {
			mainSessionFile = session.getSessionFile();
		} catch {
			mainSessionFile = undefined; // non-fatal — the m2 guard below treats this the same as "unresolved".
		}
	}

	const extraWarnings: string[] = dirWarning ? [dirWarning] : [];
	let subFiles: DiscoveredSubSession[] = [];
	if (dir) {
		// (m2) Without a resolved main-session file path, discoverSubSessionFiles cannot exclude the
		// main session's OWN jsonl by name — if it has already been flushed to disk, it would be
		// mistaken for a sub-session and its entries double-counted (once via the live getEntries()
		// above, once again via this file scan). Skip sub-discovery entirely rather than risk that;
		// a degraded (sub-less) report is safer than a silently inflated one.
		if (mainSessionFile) {
			const discovered = discoverSubSessionFiles(dir, mainSessionFile);
			subFiles = discovered.files;
			extraWarnings.push(...discovered.warnings);
		} else {
			extraWarnings.push("메인 세션 파일 미확인 — 서브 집계 생략(이중 집계 방지).");
		}
	}

	const report = buildLatencyReportFromFiles(mainEntries as RawEntry[], subFiles, extraWarnings);

	return { content: [{ type: "text", text: report.markdown }], details: report };
}

/** Register `lsc_latency_report`. */
export function registerLatencyReportTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	// Explicit type arguments (not left to inference) avoid TS2589 — see hash-manifest.ts.
	const parameters = z.object({
		session_dir: z
			.string()
			.optional()
			.describe("Override session directory used to locate subagent *.jsonl files, only needed when ctx.sessionManager.getSessionDir() is unavailable (DR-3 fallback)."),
	});

	pi.registerTool<typeof parameters, LatencyReport>({
		name: "lsc_latency_report",
		loadMode: "discoverable",
		label: "Craft: post-hoc session latency breakdown",
		description:
			"Decompose this session's wall-clock time into 실작업(subagent work)/에러·재시도/스톨/인간 게이트/메인 생성/기타 " +
			"(C3-c, plan U7): reads the current session's live entries plus every discovered subagent " +
			"<AgentLabel>.jsonl under the session directory, aggregates error turns, main-session stall gaps after an " +
			"error, and xd://lsc_* human-gate wait time, and renders a markdown summary table. Defensive throughout — " +
			"an unparseable line, missing field, or unreadable sub-session file degrades to a warning and a partial " +
			"result, never a thrown error. Intended to run once at the end of a pre-craft/craft/post-craft stage to " +
			"see where the session's time actually went.",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<LatencyReport>> {
			return performLatencyReport(ctx.sessionManager, params.session_dir);
		},
	});
}
