import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeManifest, diffManifests, loadManifest, saveManifest } from "../src/craft/hash-manifest";

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
