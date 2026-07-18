import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MAX_SUB_SESSION_FILE_BYTES,
	type RawEntry,
	aggregateAssistantTurns,
	aggregateToolWait,
	buildLatencyReportFromEntries,
	buildLatencyReportFromFiles,
	computeStallGaps,
	computeWallClock,
	discoverSubSessionFiles,
	isHumanGateToolStart,
	parseSessionJsonl,
	parseSubSessionFiles,
	performLatencyReport,
} from "../src/craft/latency-report";

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

function iso(ms: number): string {
	return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// parseSessionJsonl — defensive parsing (broken lines mixed with good ones)
// ---------------------------------------------------------------------------

describe("parseSessionJsonl", () => {
	it("parses valid lines and skips malformed ones without throwing", () => {
		const content = [
			JSON.stringify({ type: "session", id: "s1" }),
			JSON.stringify({ type: "message", id: "e1", timestamp: iso(0), message: { role: "assistant", duration: 100 } }),
			"{not valid json",
			"42", // valid JSON, but not an object
			JSON.stringify({ type: "message", id: "e2", timestamp: iso(1000), message: { role: "assistant", duration: 200 } }),
			"",
			"   ",
		].join("\n");

		const result = parseSessionJsonl(content, "test-file");
		expect(result.entries).toHaveLength(3); // session header + e1 + e2 (42 excluded, broken line excluded)
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[0]).toContain("test-file");
		expect(result.warnings.some(w => w.includes("failed to parse"))).toBe(true);
		expect(result.warnings.some(w => w.includes("non-object"))).toBe(true);
	});

	it("returns no warnings for a fully well-formed file", () => {
		const content = [JSON.stringify({ type: "message", message: { role: "assistant", duration: 10 } })].join("\n");
		const result = parseSessionJsonl(content, "clean");
		expect(result.entries).toHaveLength(1);
		expect(result.warnings).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// discoverSubSessionFiles / parseSubSessionFiles — real temp dirs (file-path input mode)
// ---------------------------------------------------------------------------

describe("discoverSubSessionFiles", () => {
	it("finds sibling *.jsonl files (excluding the main file) plus one level of nested subdirectories", () => {
		const dir = tmpDir("lsc-latency-session-");
		writeFileSync(join(dir, "main.jsonl"), JSON.stringify({ type: "session" }));
		writeFileSync(join(dir, "Sub1.jsonl"), JSON.stringify({ type: "message" }));
		writeFileSync(join(dir, "notes.txt"), "not a session file");
		mkdirSync(join(dir, "nested"));
		writeFileSync(join(dir, "nested", "Sub2.jsonl"), JSON.stringify({ type: "message" }));

		const found = discoverSubSessionFiles(dir, join(dir, "main.jsonl"));
		const labels = found.files.map(f => f.label).sort();
		expect(labels).toEqual(["Sub1", "nested/Sub2"]);
		expect(found.warnings).toEqual([]);
	});

	it("returns an empty list for a nonexistent session dir instead of throwing", () => {
		const found = discoverSubSessionFiles(join(tmpdir(), "lsc-does-not-exist-xyz"), undefined);
		expect(found.files).toEqual([]);
		expect(found.warnings).toEqual([]);
	});

	it("(L2) skips a sub-session file over the 50MB size cap, with a warning, while keeping one exactly at the cap", () => {
		const dir = tmpDir("lsc-latency-bigfile-");
		writeFileSync(join(dir, "AtLimit.jsonl"), Buffer.alloc(MAX_SUB_SESSION_FILE_BYTES));
		writeFileSync(join(dir, "OverLimit.jsonl"), Buffer.alloc(MAX_SUB_SESSION_FILE_BYTES + 1));

		const found = discoverSubSessionFiles(dir, undefined);
		expect(found.files.map(f => f.label).sort()).toEqual(["AtLimit"]);
		expect(found.warnings.some(w => w.includes("OverLimit") && w.includes("50MB"))).toBe(true);
	}, 20_000);

	it("(L2) applies the same size cap to nested (one-level-deep) subdirectory files", () => {
		const dir = tmpDir("lsc-latency-bigfile-nested-");
		mkdirSync(join(dir, "nested"));
		writeFileSync(join(dir, "nested", "TooBig.jsonl"), Buffer.alloc(MAX_SUB_SESSION_FILE_BYTES + 1));

		const found = discoverSubSessionFiles(dir, undefined);
		expect(found.files).toEqual([]);
		expect(found.warnings.some(w => w.includes("TooBig") && w.includes("50MB"))).toBe(true);
	}, 20_000);
});

describe("parseSubSessionFiles", () => {
	it("reads and parses every discovered file, tolerating one that vanishes before read", () => {
		const dir = tmpDir("lsc-latency-subs-");
		const subPath = join(dir, "Sub1.jsonl");
		writeFileSync(subPath, JSON.stringify({ type: "message", message: { role: "assistant", duration: 500 } }));

		const result = parseSubSessionFiles([
			{ label: "Sub1", path: subPath },
			{ label: "Missing", path: join(dir, "does-not-exist.jsonl") },
		]);

		expect(result.subs).toHaveLength(1);
		expect(result.subs[0].label).toBe("Sub1");
		expect(result.subs[0].entries).toHaveLength(1);
		expect(result.warnings.some(w => w.includes("Missing") && w.includes("could not read"))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Pure aggregators
// ---------------------------------------------------------------------------

describe("aggregateAssistantTurns", () => {
	it("splits non-error and error assistant durations, and tallies errorStatus", () => {
		const entries: RawEntry[] = [
			{ type: "message", message: { role: "assistant", duration: 1000, stopReason: "stop" } },
			{ type: "message", message: { role: "assistant", duration: 2000, stopReason: "error", errorStatus: 429 } },
			{ type: "message", message: { role: "user" } }, // ignored — not an assistant turn
			{ type: "message", message: { role: "assistant", stopReason: "stop" } }, // missing duration
		];
		const agg = aggregateAssistantTurns(entries);
		expect(agg.nonErrorDurationMs).toBe(1000);
		expect(agg.errorDurationMs).toBe(2000);
		expect(agg.errorCount).toBe(1);
		expect(agg.errorStatusHistogram).toEqual({ "429": 1 });
		expect(agg.missingDurationCount).toBe(1);
	});
});

describe("computeStallGaps", () => {
	it("measures the gap from an error assistant turn to the next entry, sorted descending", () => {
		const entries: RawEntry[] = [
			{ type: "message", id: "a", timestamp: iso(0), message: { role: "assistant", duration: 100, stopReason: "error" } },
			{ type: "message", id: "b", timestamp: iso(60_000), message: { role: "user" } }, // 60s gap
			{ type: "message", id: "c", timestamp: iso(60_000), message: { role: "assistant", duration: 100, stopReason: "error" } },
			{ type: "message", id: "d", timestamp: iso(660_000), message: { role: "user" } }, // 600s gap
			{ type: "message", id: "e", timestamp: iso(660_000), message: { role: "assistant", duration: 100, stopReason: "error" } }, // trailing — no next entry
		];
		const gaps = computeStallGaps(entries);
		expect(gaps).toHaveLength(2);
		expect(gaps[0].gapMs).toBe(600_000);
		expect(gaps[0].entryId).toBe("c");
		expect(gaps[1].gapMs).toBe(60_000);
	});

	it("returns an empty list when there are no error turns", () => {
		const entries: RawEntry[] = [{ type: "message", timestamp: iso(0), message: { role: "assistant", duration: 100, stopReason: "stop" } }];
		expect(computeStallGaps(entries)).toEqual([]);
	});
});

describe("isHumanGateToolStart", () => {
	it("recognizes a write to an xd://lsc_* virtual path", () => {
		expect(isHumanGateToolStart("write", { path: "xd://lsc_confirm" })).toBe(true);
		expect(isHumanGateToolStart("write", { path: "xd://lsc_select" })).toBe(true);
		expect(isHumanGateToolStart("write", { path: "xd://lsc_ask" })).toBe(true);
	});

	it("rejects a non-write tool or a non-gate path", () => {
		expect(isHumanGateToolStart("read", { path: "xd://lsc_confirm" })).toBe(false);
		expect(isHumanGateToolStart("write", { path: "/tmp/plan.md" })).toBe(false);
		expect(isHumanGateToolStart("write", undefined)).toBe(false);
	});
});

describe("aggregateToolWait", () => {
	it("matches tool_execution_start to toolResult by toolCallId, splitting human-gate from ordinary wait", () => {
		const entries: RawEntry[] = [
			{ type: "custom", customType: "tool_execution_start", timestamp: iso(0), data: { toolCallId: "tc1", toolName: "read", startedAt: iso(0) } },
			{ type: "message", timestamp: iso(2_000), message: { role: "toolResult", toolCallId: "tc1" } }, // 2s ordinary wait
			{
				type: "custom",
				customType: "tool_execution_start",
				timestamp: iso(2_000),
				data: { toolCallId: "tc2", toolName: "write", startedAt: iso(2_000), args: { path: "xd://lsc_confirm" } },
			},
			{ type: "message", timestamp: iso(182_000), message: { role: "toolResult", toolCallId: "tc2" } }, // 180s human gate wait
		];
		const agg = aggregateToolWait(entries);
		expect(agg.toolWaitMs).toBe(2_000);
		expect(agg.humanGateMs).toBe(180_000);
		expect(agg.matchedCount).toBe(2);
		expect(agg.unmatchedResultCount).toBe(0);
		expect(agg.danglingStartCount).toBe(0);
	});

	it("falls back to FIFO pairing when a toolResult carries no recognizable toolCallId", () => {
		const entries: RawEntry[] = [
			{ type: "custom", customType: "tool_execution_start", timestamp: iso(0), data: { toolName: "read", startedAt: iso(0) } },
			{ type: "message", timestamp: iso(1_000), message: { role: "toolResult" } }, // no toolCallId anywhere — FIFO fallback
		];
		const agg = aggregateToolWait(entries);
		expect(agg.toolWaitMs).toBe(1_000);
		expect(agg.matchedCount).toBe(1);
	});

	it("counts dangling starts and unmatched results without throwing", () => {
		const entries: RawEntry[] = [
			{ type: "custom", customType: "tool_execution_start", timestamp: iso(0), data: { toolCallId: "never-resolved", startedAt: iso(0) } },
			{ type: "message", timestamp: iso(1_000), message: { role: "toolResult", toolCallId: "no-matching-start" } },
		];
		const agg = aggregateToolWait(entries);
		expect(agg.danglingStartCount).toBe(1);
		expect(agg.unmatchedResultCount).toBe(1);
		expect(agg.toolWaitMs).toBe(0);
	});
});

describe("computeWallClock", () => {
	it("spans the earliest to latest parseable timestamp", () => {
		const entries: RawEntry[] = [{ timestamp: iso(5_000) }, { timestamp: iso(0) }, { timestamp: iso(10_000) }, { timestamp: "not-a-date" }];
		expect(computeWallClock(entries)).toEqual({ startMs: 0, endMs: 10_000, durationMs: 10_000 });
	});

	it("returns an empty object when no entry has a parseable timestamp", () => {
		expect(computeWallClock([{ timestamp: "garbage" }, {}])).toEqual({});
	});
});

// ---------------------------------------------------------------------------
// buildLatencyReportFromEntries — full aggregation + ratio summation (entry-array input mode)
// ---------------------------------------------------------------------------

describe("buildLatencyReportFromEntries", () => {
	function scenario() {
		const mainEntries: RawEntry[] = [
			{ type: "model_change", timestamp: iso(0) }, // ignored by every aggregator — just anchors wallClock start at 0
			{ type: "message", id: "gen1", timestamp: iso(5_000), message: { role: "assistant", duration: 5_000, stopReason: "stop" } },
			{ type: "custom", customType: "tool_execution_start", timestamp: iso(5_000), data: { toolCallId: "tc1", toolName: "read", startedAt: iso(5_000) } },
			{ type: "message", timestamp: iso(7_000), message: { role: "toolResult", toolCallId: "tc1" } }, // 2s ordinary tool wait
			{
				type: "custom",
				customType: "tool_execution_start",
				timestamp: iso(7_000),
				data: { toolCallId: "tc2", toolName: "write", startedAt: iso(7_000), args: { path: "xd://lsc_confirm" } },
			},
			{ type: "message", timestamp: iso(187_000), message: { role: "toolResult", toolCallId: "tc2" } }, // 180s human gate
			{ type: "message", id: "err1", timestamp: iso(188_000), message: { role: "assistant", duration: 1_000, stopReason: "error", errorStatus: 429 } },
			{ type: "message", timestamp: iso(788_000), message: { role: "user" } }, // 600s stall gap after err1
			{ type: "message", id: "gen2", timestamp: iso(791_000), message: { role: "assistant", duration: 3_000, stopReason: "stop" } },
		];
		const subs = [
			{
				label: "SubAgent1",
				entries: [
					{ type: "message", message: { role: "assistant", duration: 50_000, stopReason: "stop" } },
					{ type: "message", message: { role: "assistant", duration: 2_000, stopReason: "error", errorStatus: "overloaded" } },
				] as RawEntry[],
			},
		];
		return { mainEntries, subs };
	}

	it("partitions wall-clock time into the six documented buckets with correct sums", () => {
		const { mainEntries, subs } = scenario();
		const report = buildLatencyReportFromEntries(mainEntries, subs);

		expect(report.wallClockMs).toBe(791_000);
		expect(report.mainGenerationMs).toBe(8_000); // gen1 5000 + gen2 3000
		expect(report.actualWorkMs).toBe(50_000); // sub's non-error assistant duration
		expect(report.errorRetryMs).toBe(3_000); // main err1 1000 + sub error 2000
		expect(report.errorTurnCount).toBe(2);
		expect(report.errorStatusHistogram).toEqual({ "429": 1, overloaded: 1 });
		expect(report.stallMs).toBe(600_000);
		expect(report.humanGateMs).toBe(180_000);
		expect(report.toolWaitMs).toBe(2_000); // supplementary, not one of the six rows
		expect(report.subSessionsAnalyzed).toBe(1);
	});

	it("never lets ratios exceed a sane bound and always sums sections against the same wall clock", () => {
		const { mainEntries, subs } = scenario();
		const report = buildLatencyReportFromEntries(mainEntries, subs);

		expect(report.sections).toHaveLength(6);
		for (const section of report.sections) {
			expect(section.ratio).toBeGreaterThanOrEqual(0);
			// ratio is ms / wallClockMs by construction — sanity-check the arithmetic itself.
			expect(section.ratio).toBeCloseTo(section.ms / (report.wallClockMs ?? 1), 6);
		}
		// otherMs is a clamped residual (accounted can exceed wall clock when subagent work overlaps
		// the main session's own wait windows) — it must never go negative.
		expect(report.otherMs).toBeGreaterThanOrEqual(0);
	});

	it("renders a six-row markdown table plus the wall-clock total row", () => {
		const { mainEntries, subs } = scenario();
		const report = buildLatencyReportFromEntries(mainEntries, subs);

		expect(report.markdown).toContain("| 구간 | 시간 | 비율 |");
		expect(report.markdown).toContain("실작업");
		expect(report.markdown).toContain("에러·재시도");
		expect(report.markdown).toContain("스톨");
		expect(report.markdown).toContain("인간 게이트");
		expect(report.markdown).toContain("메인 생성");
		expect(report.markdown).toContain("기타");
		expect(report.markdown).toContain("벽시계 합계");
		expect(report.markdown).toContain("상위 메인 스톨 갭");
	});

	it("(m6) notes that section sums can exceed 100% due to overlap (e.g. parallel subagent work)", () => {
		const { mainEntries, subs } = scenario();
		const report = buildLatencyReportFromEntries(mainEntries, subs);
		expect(report.markdown).toContain("100%를 넘을 수 있음");
	});

	it("surfaces the top stall gaps in minutes", () => {
		const { mainEntries, subs } = scenario();
		const report = buildLatencyReportFromEntries(mainEntries, subs);
		expect(report.stallGapsTopMinutes).toHaveLength(1);
		expect(report.stallGapsTopMinutes[0].gapMinutes).toBeCloseTo(10, 5);
		expect(report.stallGapsTopMinutes[0].entryId).toBe("err1");
	});

	it("degrades to warnings + partial data instead of throwing on entirely empty input", () => {
		const report = buildLatencyReportFromEntries([], []);
		expect(report.wallClockMs).toBeUndefined();
		expect(report.warnings.some(w => w.includes("timestamp"))).toBe(true);
		expect(report.mainGenerationMs).toBe(0);
		expect(report.sections.every(s => s.ratio === undefined)).toBe(true);
		expect(report.markdown).toContain("미상");
	});

	it("warns (without throwing) when an assistant turn is missing its duration field", () => {
		const entries: RawEntry[] = [
			{ type: "message", timestamp: iso(0), message: { role: "assistant", stopReason: "stop" } },
			{ type: "message", timestamp: iso(1_000), message: { role: "assistant", duration: 500, stopReason: "stop" } },
		];
		const report = buildLatencyReportFromEntries(entries, []);
		expect(report.mainGenerationMs).toBe(500);
		expect(report.warnings.some(w => w.includes("duration"))).toBe(true);
	});

	it("propagates extraWarnings (e.g. from a failed sub-session read) into the final report", () => {
		const report = buildLatencyReportFromEntries([], [], ["custom warning from caller"]);
		expect(report.warnings).toContain("custom warning from caller");
		expect(report.markdown).toContain("custom warning from caller");
	});
});

describe("buildLatencyReportFromFiles", () => {
	it("reads sub-session files from disk and merges their entries into the report", () => {
		const dir = tmpDir("lsc-latency-files-");
		const subPath = join(dir, "SubAgent1.jsonl");
		writeFileSync(subPath, JSON.stringify({ type: "message", message: { role: "assistant", duration: 10_000, stopReason: "stop" } }));

		const mainEntries: RawEntry[] = [{ type: "message", timestamp: iso(0), message: { role: "assistant", duration: 1_000, stopReason: "stop" } }];
		const report = buildLatencyReportFromFiles(mainEntries, [{ label: "SubAgent1", path: subPath }]);

		expect(report.actualWorkMs).toBe(10_000);
		expect(report.subSessionsAnalyzed).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// performLatencyReport — the tool-level entry point, fake session-access object + real temp dirs
// ---------------------------------------------------------------------------

describe("performLatencyReport", () => {
	it("builds a full report from a live getEntries() plus discovered sub-session files", () => {
		const dir = tmpDir("lsc-latency-perform-");
		writeFileSync(join(dir, "main.jsonl"), JSON.stringify({ type: "session" }));
		writeFileSync(join(dir, "SubAgent1.jsonl"), JSON.stringify({ type: "message", message: { role: "assistant", duration: 4_000, stopReason: "stop" } }));

		const mainEntries: RawEntry[] = [{ type: "message", timestamp: iso(0), message: { role: "assistant", duration: 1_000, stopReason: "stop" } }];
		const result = performLatencyReport({
			getEntries: () => mainEntries,
			getSessionDir: () => dir,
			getSessionFile: () => join(dir, "main.jsonl"),
		});

		expect(result.isError).toBeUndefined();
		expect(result.details?.actualWorkMs).toBe(4_000);
		expect(result.details?.subSessionsAnalyzed).toBe(1);
		const first = result.content[0];
		expect(first.type === "text" ? first.text : "").toContain("구간");
	});

	it("falls back to the session_dir override when getSessionDir() throws", () => {
		const dir = tmpDir("lsc-latency-override-");
		writeFileSync(join(dir, "SubAgent1.jsonl"), JSON.stringify({ type: "message", message: { role: "assistant", duration: 7_000, stopReason: "stop" } }));

		const result = performLatencyReport(
			{
				getEntries: () => [],
				getSessionDir: () => {
					throw new Error("no session dir in this host");
				},
				getSessionFile: () => join(dir, "main.jsonl"), // resolved — isolates this test from the m2 guard below
			},
			dir,
		);

		expect(result.isError).toBeUndefined();
		expect(result.details?.actualWorkMs).toBe(7_000);
		expect(result.details?.warnings.some(w => w.includes("session_dir"))).toBe(true);
	});

	it("(m2) skips sub-discovery entirely when getSessionFile() is unresolved, to avoid double-counting the main session's own flushed jsonl as a sub", () => {
		const dir = tmpDir("lsc-latency-m2-");
		// The main session's own file, sitting right there in the session dir alongside a real sub —
		// without a resolved mainSessionFile to exclude it by name, this must NOT be picked up as a
		// "sub" session (that would double-count the main session's entries).
		writeFileSync(join(dir, "main.jsonl"), JSON.stringify({ type: "message", message: { role: "assistant", duration: 999_000, stopReason: "stop" } }));
		writeFileSync(join(dir, "SubAgent1.jsonl"), JSON.stringify({ type: "message", message: { role: "assistant", duration: 4_000, stopReason: "stop" } }));

		const mainEntries: RawEntry[] = [{ type: "message", timestamp: iso(0), message: { role: "assistant", duration: 1_000, stopReason: "stop" } }];
		const result = performLatencyReport({
			getEntries: () => mainEntries,
			getSessionDir: () => dir,
			getSessionFile: () => undefined, // unresolved — e.g. an in-memory/not-yet-flushed session
		});

		expect(result.isError).toBeUndefined();
		expect(result.details?.subSessionsAnalyzed).toBe(0);
		expect(result.details?.actualWorkMs).toBe(0);
		expect(result.details?.warnings.some(w => w.includes("메인 세션 파일 미확인"))).toBe(true);
	});

	it("degrades to a main-only report (never isError) when getSessionDir() fails with no override", () => {
		const mainEntries: RawEntry[] = [{ type: "message", timestamp: iso(0), message: { role: "assistant", duration: 1_000, stopReason: "stop" } }];
		const result = performLatencyReport({
			getEntries: () => mainEntries,
			getSessionDir: () => {
				throw new Error("boom");
			},
		});

		expect(result.isError).toBeUndefined();
		expect(result.details?.subSessionsAnalyzed).toBe(0);
		expect(result.details?.warnings.some(w => w.includes("메인 세션만 집계"))).toBe(true);
	});

	it("returns isError when even getEntries() itself fails", () => {
		const result = performLatencyReport({
			getEntries: () => {
				throw new Error("session unreadable");
			},
			getSessionDir: () => tmpdir(),
		});
		expect(result.isError).toBe(true);
		const first = result.content[0];
		expect(first.type === "text" ? first.text : "").toContain("session unreadable");
	});
});
