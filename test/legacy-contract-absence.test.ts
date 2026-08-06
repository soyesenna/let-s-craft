// AC4 — legacy-contract-absence: a project-wide lint asserting that the 28 forbidden literals of
// the old implementation-before-tests pipeline contract (hash protection, the pre-craft test/
// tree, the craft loop, Canon Amendment/Hash Violation) never reappear anywhere this refactor
// (C1-C9) touches. Scoped file × literal whitelist exceptions only — see ALLOWED below for every
// exception and why it is NOT a remnant of the removed contract.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively collect every file under `absDir`, optionally filtered by extension (`null` = every file, for fixtures/**'s unrestricted scan). Missing directories yield an empty list rather than throwing. */
function walkFiles(absDir: string, extensions: readonly string[] | null): string[] {
	const out: string[] = [];
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(absDir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const entry of entries) {
		const full = join(absDir, entry.name);
		if (entry.isDirectory()) out.push(...walkFiles(full, extensions));
		else if (entry.isFile() && (!extensions || extensions.some(ext => entry.name.endsWith(ext)))) out.push(full);
	}
	return out;
}

/** Scan range (AC4-범위): skills/**\/*.md · agents/**\/*.md · rules/**\/*.md · _docs/**\/*.md · fixtures/** (unrestricted, any extension) · README.md · src/**\/*.ts · test/**\/*.ts. */
function scanFiles(): string[] {
	const absFiles: string[] = [
		...walkFiles(join(repoRoot, "skills"), [".md"]),
		...walkFiles(join(repoRoot, "agents"), [".md"]),
		...walkFiles(join(repoRoot, "rules"), [".md"]),
		...walkFiles(join(repoRoot, "_docs"), [".md"]),
		...walkFiles(join(repoRoot, "fixtures"), null),
		...walkFiles(join(repoRoot, "src"), [".ts"]),
		...walkFiles(join(repoRoot, "test"), [".ts"]),
		join(repoRoot, "README.md"),
	];
	return absFiles.map(f => relative(repoRoot, f));
}

/**
 * File × literal whitelist (AC4-예외 목록). `"*"` exempts the whole file from every literal; a
 * string array exempts only those specific literals for that file (everything else in that file
 * still must not carry ANY forbidden literal). Matching is CASE-SENSITIVE (AC4-범위). Every entry
 * below carries its own reason — none are blanket "this file is old, skip it" passes.
 */
const ALLOWED: ReadonlyMap<string, readonly string[] | "*"> = new Map<string, readonly string[] | "*">([
	// This file's own literal set (LITERALS below) — it must hold every forbidden string as data
	// to search for it elsewhere. Self-referential; the same reason applies to every entry that
	// follows this one for the same underlying reason (holding a forbidden string as TEST DATA,
	// not as a live claim that the old contract still exists).
	["test/legacy-contract-absence.test.ts", "*"],
	// Legacy-schema fixture proving an old-shaped `.craft-state.json` (with `testsPassed`, a field
	// removed pre-C1) still parses tolerantly under the no-migration policy — deleting this
	// literal here would delete that assertion's own subject matter.
	["test/craft-state-version.test.ts", ["testsPassed"]],
	// Historical record (research/insight documents): each accurately describes the OLD contract
	// AS IT WAS at the time it was written — a timestamped investigation log, not a remnant to be
	// rewritten to match the new contract.
	["_docs/reference-insights.md", "*"],
	["_docs/deferred-pool.md", "*"],
	["_docs/probe-split-parallel-warm-reuse.md", "*"],
	// This file's own C5/C6/C7 "carries none of the removed vocabulary" describe blocks assert the
	// ABSENCE of exactly these forbidden literals inside the pipeline SKILL.md files — the same
	// self-referential reason the lint file itself is exempt: it must hold the literal strings as
	// its own test data (arguments to `.not.toContain(...)`) to check for their absence elsewhere.
	["test/skill-contract.test.ts", "*"],
	// R9/C2 historical retirement documentation — `[Canon Amendment]`/`[Hash Violation]` and
	// hash-manifest.ts were retired well before this ralplan even started; these comments/titles
	// explain what happened and why (a real, permanent design note), not a remnant of the
	// test-authoring contract THIS refactor removes.
	["test/destructive-approval.test.ts", ["Canon Amendment", "Hash Violation", "hash-manifest"]],
	["test/deferred-pool-regression.test.ts", ["Canon Amendment"]],
	// Factual historical citation: a specific past audit cycle (cycle 0, a different feature) that
	// really was approved under the (since-retired) `[Canon Amendment]` tag at the time it ran —
	// changing the citation would misrepresent what actually happened.
	["test/ask-ui-render-model.test.ts", ["Canon Amendment"]],
	// "appendix-test-plan" collides with an unrelated, already-shipped feature's own plan-appendix
	// naming convention (the ask-readability-option-chat / deferred-pool features' own
	// plan/appendix-test-plan.md, outside this scan's range) — these are provenance citations to
	// THAT feature's planning trail, not remnants of THIS refactor's pre-craft test-authoring
	// appendix (which never actually used this exact literal anywhere real — see C5's own
	// investigation).
	["test/artifacts-scaffold.test.ts", ["appendix-test-plan"]],
	["test/ask-ui-destructive-parity.test.ts", ["appendix-test-plan"]],
	["test/ask-ui-fallback.test.ts", ["appendix-test-plan"]],
	["test/ask-ui-fixture-isolation.test.ts", ["appendix-test-plan"]],
	["test/ask-ui-integration.test.ts", ["appendix-test-plan"]],
	["test/ask-ui-snapshot.test.ts", ["appendix-test-plan"]],
	["test/claims-tool.test.ts", ["appendix-test-plan"]],
	["test/craft-land-flow.test.ts", ["appendix-test-plan"]],
	["test/doctor-adapters.test.ts", ["appendix-test-plan"]],
	// Carries both the unrelated "appendix-test-plan" citation above AND its own R9/C2 retirement
	// note (hash-manifest/lsc_verify_hash/lsc_restore_tests/lsc_craft_release) AND a "run_test.sh"
	// reference to an unrelated ask-ui-specific CI lock-hash guard concept (v2 §7) — none are
	// remnants of this pipeline's own now-removed fixture script or hash-protection layer.
	["test/ask-ui-contract-regression.test.ts", ["appendix-test-plan", "hash-manifest", "lsc_craft_release", "lsc_restore_tests", "lsc_verify_hash", "run_test.sh"]],
	// "run_test.sh" here cites an unrelated ask-ui acceptance/CI-gate concept (a hard prerequisite
	// gate script), never this pipeline's own removed fixture script.
	["test/ask-ui-contract.test-d.ts", ["run_test.sh"]],
	["test/ask-ui-e2e.test.ts", ["run_test.sh"]],
	["test/statusbar-e2e.test.ts", ["run_test.sh"]],
]);

/** AC4-리터럴: the 28 forbidden literals. C-number literals need a word-boundary match (below) so "C18" never matches inside an unrelated longer token; the rest are plain case-sensitive substrings. */
const LITERALS: readonly string[] = [
	"Stage 4",
	"D-3",
	"appendix-test-plan",
	"expanded test plan",
	"plan/test consensus loop",
	"testsPassed",
	"shouldContinueCraftLoop",
	"hash-manifest",
	".hash-manifest.json",
	"lsc_verify_hash",
	"lsc_restore_tests",
	"lsc_craft_release",
	"Canon Amendment",
	"Hash Violation",
	".snapshots",
	"run_test.sh",
	"lsc_run_tests",
	"run-N.log",
	"NO_PROGRESS_THRESHOLD",
	"No Progress",
	"C18",
	"C19",
	"C20",
	"C21",
	"C23b",
	"C23c",
	"C-1",
	"C-2",
];

const WORD_BOUNDARY_LITERALS = new Set(["C18", "C19", "C20", "C21", "C-1", "C-2"]);

/** True iff `line` contains `literal` as a forbidden occurrence — word-boundary regex for the C-number set (AC4-리터럴), plain case-sensitive substring otherwise. */
function lineViolates(line: string, literal: string): boolean {
	if (WORD_BOUNDARY_LITERALS.has(literal)) {
		const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`\\b${escaped}\\b`).test(line);
	}
	return line.includes(literal);
}

function isAllowed(relPath: string, literal: string): boolean {
	const entry = ALLOWED.get(relPath);
	if (entry === "*") return true;
	if (entry === undefined) return false;
	return entry.includes(literal);
}

describe("legacy-contract-absence (AC4) — 구 계약(구현-전 테스트 고정) 리터럴 0건", () => {
	const files = scanFiles();

	// One it() per literal (AC4) — every violation across the whole scan range is collected and
	// reported together, not one file at a time, so fixing this never becomes a fix-one/re-run/
	// fix-next round trip.
	it.each(LITERALS)('carries zero un-whitelisted occurrences of "%s"', literal => {
		const violations: string[] = [];
		for (const relPath of files) {
			if (isAllowed(relPath, literal)) continue;
			const content = readFileSync(join(repoRoot, relPath), "utf8");
			const lines = content.split("\n");
			for (let i = 0; i < lines.length; i++) {
				if (lineViolates(lines[i], literal)) violations.push(`${relPath}:${i + 1}:${lines[i].trim().slice(0, 150)}`);
			}
		}
		expect(violations, `forbidden literal "${literal}" found outside the whitelist:\n${violations.join("\n")}`).toEqual([]);
	});

	it("scans a non-trivial number of files (sanity check against an empty/misconfigured scan range)", () => {
		expect(files.length).toBeGreaterThan(50);
	});
});
