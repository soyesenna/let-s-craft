import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	craftAuditPath,
	craftDir,
	craftHashManifestPath,
	craftRunTestScriptPath,
	craftStatePath,
	craftTestDir,
	craftTestLogsDir,
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

	it("derives test/, logs/, manifest, and state paths from craftDir", () => {
		expect(craftTestDir(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "test"));
		expect(craftTestLogsDir(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "test", "logs"));
		expect(craftRunTestScriptPath(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "test", "run_test.sh"));
		expect(craftHashManifestPath(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "test", ".hash-manifest.json"));
		expect(craftStatePath(CWD, "f")).toBe(join(CWD, ".lsc", "crafts", "f", "test", ".craft-state.json"));
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
