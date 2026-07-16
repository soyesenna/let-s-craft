import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeManifest, diffManifests, loadManifest, restoreFromSnapshots, saveManifest, validateCraftArtifacts, writeSnapshots } from "../src/craft/hash-manifest";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** A test/ dir with run_test.sh + a nested test file, plus logs/ and bookkeeping files that must be excluded. */
function tmpTestDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-hash-"));
	tempDirs.push(dir);
	writeFileSync(join(dir, "run_test.sh"), "#!/bin/sh\necho ok\n");
	mkdirSync(join(dir, "unit"), { recursive: true });
	writeFileSync(join(dir, "unit", "a.test.ts"), "test content\n");
	mkdirSync(join(dir, "logs"), { recursive: true });
	writeFileSync(join(dir, "logs", "run-1.log"), "stale log\n");
	writeFileSync(join(dir, ".hash-manifest.json"), "{}");
	writeFileSync(join(dir, ".craft-state.json"), "{}");
	return dir;
}

describe("computeManifest", () => {
	it("fingerprints run_test.sh and nested test files with POSIX-relative keys", () => {
		const testDir = tmpTestDir();
		const manifest = computeManifest("my-feature", testDir);
		expect(Object.keys(manifest.files).sort()).toEqual(["run_test.sh", "unit/a.test.ts"]);
		expect(manifest.files["run_test.sh"]).toMatch(/^[0-9a-f]{64}$/);
	});

	it("excludes logs/, the manifest file, and the craft-state file", () => {
		const testDir = tmpTestDir();
		const manifest = computeManifest("my-feature", testDir);
		expect(Object.keys(manifest.files)).not.toContain("logs/run-1.log");
		expect(Object.keys(manifest.files)).not.toContain(".hash-manifest.json");
		expect(Object.keys(manifest.files)).not.toContain(".craft-state.json");
	});

	it("produces the same hash for unchanged content and a different hash after an edit", () => {
		const testDir = tmpTestDir();
		const before = computeManifest("f", testDir);
		writeFileSync(join(testDir, "unit", "a.test.ts"), "changed content\n");
		const after = computeManifest("f", testDir);
		expect(after.files["unit/a.test.ts"]).not.toBe(before.files["unit/a.test.ts"]);
		expect(after.files["run_test.sh"]).toBe(before.files["run_test.sh"]);
	});
});

describe("diffManifests", () => {
	it("reports no violations when nothing changed", () => {
		const testDir = tmpTestDir();
		const manifest = computeManifest("f", testDir);
		expect(diffManifests(manifest, manifest)).toEqual([]);
	});

	it("detects a modified file", () => {
		const testDir = tmpTestDir();
		const recorded = computeManifest("f", testDir);
		writeFileSync(join(testDir, "unit", "a.test.ts"), "tampered\n");
		const current = computeManifest("f", testDir);
		expect(diffManifests(recorded, current)).toEqual([{ path: "unit/a.test.ts", kind: "modified" }]);
	});

	it("detects a removed file", () => {
		const testDir = tmpTestDir();
		const recorded = computeManifest("f", testDir);
		rmSync(join(testDir, "unit", "a.test.ts"));
		const current = computeManifest("f", testDir);
		expect(diffManifests(recorded, current)).toEqual([{ path: "unit/a.test.ts", kind: "removed" }]);
	});

	it("detects an added file", () => {
		const testDir = tmpTestDir();
		const recorded = computeManifest("f", testDir);
		writeFileSync(join(testDir, "unit", "b.test.ts"), "new file\n");
		const current = computeManifest("f", testDir);
		expect(diffManifests(recorded, current)).toEqual([{ path: "unit/b.test.ts", kind: "added" }]);
	});
});

describe("save/load manifest round-trip", () => {
	it("persists and re-reads a manifest, creating parent directories", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-hash-io-"));
		tempDirs.push(dir);
		const manifestPath = join(dir, "test", ".hash-manifest.json");
		const manifest = computeManifest("f", tmpTestDir());

		saveManifest(manifestPath, manifest);
		expect(loadManifest(manifestPath)).toEqual(manifest);
	});

	it("returns undefined when no manifest has been recorded", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-hash-io-"));
		tempDirs.push(dir);
		expect(loadManifest(join(dir, "missing.json"))).toBeUndefined();
	});
});

// A bash-based restore against the protected test tree deadlocks against the tool_call block
// it's trying to work around (discovered from a real craft-loop run: the approved-restore
// branch of C23b tried `git checkout`, which the block correctly refused, forever). These lock
// the fix: an internal fs-only restore path (never through write/edit/bash, so tool_call never
// sees it) that lsc_restore_tests (hash-manifest.ts's registerRestoreTestsTool) wraps.
describe("writeSnapshots / restoreFromSnapshots", () => {
	function tmpSnapshotDir(testDir: string): string {
		const dir = join(testDir, ".snapshots");
		return dir;
	}

	it("writeSnapshots copies every manifested file into snapshotDir, preserving relative structure", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const manifest = computeManifest("f", testDir);

		writeSnapshots(testDir, snapshotDir, manifest);

		expect(readFileSync(join(snapshotDir, "run_test.sh"), "utf8")).toBe(readFileSync(join(testDir, "run_test.sh"), "utf8"));
		expect(readFileSync(join(snapshotDir, "unit", "a.test.ts"), "utf8")).toBe(readFileSync(join(testDir, "unit", "a.test.ts"), "utf8"));
	});

	it("writeSnapshots clears a stale snapshot from a prior craft run before writing the new one", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		writeSnapshots(testDir, snapshotDir, computeManifest("f", testDir));
		expect(existsSync(join(snapshotDir, "unit", "a.test.ts"))).toBe(true);

		// A second craft run over a test/ dir that no longer has unit/a.test.ts (e.g. pre-craft
		// re-authored the suite) must not leave the old snapshot file behind.
		rmSync(join(testDir, "unit", "a.test.ts"));
		writeFileSync(join(testDir, "unit", "b.test.ts"), "replacement\n");
		writeSnapshots(testDir, snapshotDir, computeManifest("f", testDir));

		expect(existsSync(join(snapshotDir, "unit", "a.test.ts"))).toBe(false);
		expect(existsSync(join(snapshotDir, "unit", "b.test.ts"))).toBe(true);
	});

	it("restores a modified file to its exact original content and reports it in restoredPaths", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const recorded = computeManifest("f", testDir);
		writeSnapshots(testDir, snapshotDir, recorded);

		writeFileSync(join(testDir, "unit", "a.test.ts"), "tampered content\n");
		const result = restoreFromSnapshots("f", testDir, snapshotDir, recorded);

		expect(readFileSync(join(testDir, "unit", "a.test.ts"), "utf8")).toBe("test content\n");
		expect(result.restoredPaths).toContain("unit/a.test.ts");
		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it("restores a deleted file from its snapshot", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const recorded = computeManifest("f", testDir);
		writeSnapshots(testDir, snapshotDir, recorded);

		rmSync(join(testDir, "unit", "a.test.ts"));
		const result = restoreFromSnapshots("f", testDir, snapshotDir, recorded);

		expect(existsSync(join(testDir, "unit", "a.test.ts"))).toBe(true);
		expect(readFileSync(join(testDir, "unit", "a.test.ts"), "utf8")).toBe("test content\n");
		expect(result.passed).toBe(true);
	});

	it("removes a file that was added after lsc_craft_init and reports it in removedPaths", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const recorded = computeManifest("f", testDir);
		writeSnapshots(testDir, snapshotDir, recorded);

		writeFileSync(join(testDir, "unit", "sneaked-in.test.ts"), "not part of the original suite\n");
		const result = restoreFromSnapshots("f", testDir, snapshotDir, recorded);

		expect(existsSync(join(testDir, "unit", "sneaked-in.test.ts"))).toBe(false);
		expect(result.removedPaths).toContain("unit/sneaked-in.test.ts");
		expect(result.passed).toBe(true);
	});

	it("handles modified + added + removed violations together in a single call", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const recorded = computeManifest("f", testDir);
		writeSnapshots(testDir, snapshotDir, recorded);

		writeFileSync(join(testDir, "run_test.sh"), "#!/bin/sh\necho hacked\n"); // modified
		rmSync(join(testDir, "unit", "a.test.ts")); // removed
		writeFileSync(join(testDir, "unit", "extra.test.ts"), "sneaked in\n"); // added

		const result = restoreFromSnapshots("f", testDir, snapshotDir, recorded);

		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
		expect(readFileSync(join(testDir, "run_test.sh"), "utf8")).toBe("#!/bin/sh\necho ok\n");
		expect(existsSync(join(testDir, "unit", "a.test.ts"))).toBe(true);
		expect(existsSync(join(testDir, "unit", "extra.test.ts"))).toBe(false);
	});

	it("skips (does not throw) when a recorded file's snapshot is unexpectedly missing", () => {
		const testDir = tmpTestDir();
		const snapshotDir = tmpSnapshotDir(testDir);
		const recorded = computeManifest("f", testDir);
		// Deliberately never call writeSnapshots — simulates a missing/corrupted snapshot dir.
		expect(() => restoreFromSnapshots("f", testDir, snapshotDir, recorded)).not.toThrow();
	});
});

// A-3 축소형: pre-craft의 trace.md/spec.md/plan.md 없이는 craft가 시작되지 않아야 한다
// (lsc_craft_init이 이 함수를 test/ 실존 검사 직후 호출한다 — hash-manifest.ts).
describe("validateCraftArtifacts", () => {
	function tmpFeatureDir(): string {
		const dir = mkdtempSync(join(tmpdir(), "lsc-hash-artifacts-"));
		tempDirs.push(dir);
		return dir;
	}

	it("returns no violations when trace/spec/plan all exist with non-blank content", () => {
		const dir = tmpFeatureDir();
		writeFileSync(join(dir, "trace.md"), "trace content\n");
		writeFileSync(join(dir, "spec.md"), "spec content\n");
		writeFileSync(join(dir, "plan.md"), "plan content\n");

		expect(validateCraftArtifacts(dir)).toEqual([]);
	});

	it("reports a violation when trace.md is missing", () => {
		const dir = tmpFeatureDir();
		writeFileSync(join(dir, "spec.md"), "spec content\n");
		writeFileSync(join(dir, "plan.md"), "plan content\n");

		const violations = validateCraftArtifacts(dir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatch(/trace\.md/);
	});

	it("reports a violation when spec.md is whitespace-only", () => {
		const dir = tmpFeatureDir();
		writeFileSync(join(dir, "trace.md"), "trace content\n");
		writeFileSync(join(dir, "spec.md"), "   \n\t\n");
		writeFileSync(join(dir, "plan.md"), "plan content\n");

		const violations = validateCraftArtifacts(dir);
		expect(violations).toHaveLength(1);
		expect(violations[0]).toMatch(/spec\.md/);
	});

	it("reports 3 violations when all three files are missing", () => {
		const dir = tmpFeatureDir();
		expect(validateCraftArtifacts(dir)).toHaveLength(3);
	});
});
