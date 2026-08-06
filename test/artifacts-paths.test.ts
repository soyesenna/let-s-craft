import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as paths from "../src/artifacts/paths";
import {
	craftAuditPath,
	craftCheckDir,
	craftCheckLogsDir,
	craftCheckScriptPath,
	craftDir,
	craftStatePath,
	globalLscDir,
	projectLscDir,
	resolveFeatureName,
	worktreePath,
} from "../src/artifacts/paths";

const CWD = "/repo";

describe("path composition", () => {
	it("nests crafts/{feature} under the project .lsc/", () => {
		expect(projectLscDir(CWD)).toBe(join(CWD, ".lsc"));
		expect(craftDir(CWD, "my-feature")).toBe(join(CWD, ".lsc", "crafts", "my-feature"));
	});

	it("derives check/, logs/, and state paths from craftDir (C3: .craft-state.json moved out of test/)", () => {
		expect(craftCheckDir(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "check"));
		expect(craftCheckLogsDir(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "check", "logs"));
		expect(craftCheckScriptPath(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "check", "run_check.sh"));
		expect(craftStatePath(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", ".craft-state.json"));
	});

	it("numbers audit reports from 0", () => {
		expect(craftAuditPath(CWD, "f", 0)).toBe(join(CWD, ".lsc", "crafts", "f", "audit", "audit-0.md"));
		expect(craftAuditPath(CWD, "f", 3)).toBe(join(CWD, ".lsc", "crafts", "f", "audit", "audit-3.md"));
	});

	it("places worktrees under .lsc/worktrees/{feature}", () => {
		expect(worktreePath(CWD, "f")).toBe(join(CWD, ".lsc", "worktrees", "f"));
	});

	it("anchors the global root at ~/.omp/.lsc", () => {
		expect(globalLscDir().endsWith(join(".omp", ".lsc"))).toBe(true);
	});

	it("no longer exports the retired test-tree/hash-protection helpers (AC8 — C2 hash protection removal + C3 test/ tree retirement)", () => {
		const removed = ["craftTestDir", "craftRunTestScriptPath", "craftTestLogsDir", "craftHashManifestPath", "craftSnapshotDir"];
		for (const name of removed) {
			expect(name in paths, `${name} must not be exported from artifacts/paths.ts`).toBe(false);
		}
	});
});

describe("resolveFeatureName", () => {
	it("returns a bare kebab-case name unchanged", () => {
		expect(resolveFeatureName("my-feature")).toBe("my-feature");
	});

	it("strips a trailing slash from a bare name", () => {
		expect(resolveFeatureName("my-feature/")).toBe("my-feature");
	});

	it("extracts the feature from a pre-craft directory path", () => {
		expect(resolveFeatureName(".lsc/crafts/my-feature")).toBe("my-feature");
		expect(resolveFeatureName("/repo/.lsc/crafts/my-feature")).toBe("my-feature");
	});

	it("extracts the feature from a deeper path (plan.md, audit-N.md)", () => {
		expect(resolveFeatureName(".lsc/crafts/my-feature/plan.md")).toBe("my-feature");
		expect(resolveFeatureName("/repo/.lsc/crafts/my-feature/audit/audit-2.md")).toBe("my-feature");
	});

	it("throws when no feature name can be resolved", () => {
		expect(() => resolveFeatureName("")).toThrow();
		expect(() => resolveFeatureName(".lsc/crafts/")).toThrow();
	});

	it("does not mistake an ancestor directory that merely contains 'crafts' as a substring (e.g. 'aircrafts') for the real marker segment", () => {
		expect(resolveFeatureName("/repo/aircrafts/foo/.lsc/crafts/my-feature")).toBe("my-feature");
		expect(resolveFeatureName("aircrafts/foo/.lsc/crafts/my-feature/plan.md")).toBe("my-feature");
	});
});
