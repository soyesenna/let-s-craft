import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	loadModelsFileAt,
	mergeModelsFiles,
	type ModelsFile,
	parseModelsFile,
	saveModelsFileAt,
	toTaskAgentName,
} from "../src/preset/models-file";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("parseModelsFile", () => {
	it("parses a well-formed models.yaml", () => {
		const file = parseModelsFile(
			["active: codex-glm", "presets:", "  codex-glm:", "    explore: openai-codex/gpt-5.6-luna:medium", ""].join("\n"),
		);
		expect(file).toEqual({ active: "codex-glm", presets: { "codex-glm": { explore: "openai-codex/gpt-5.6-luna:medium" } } });
	});

	it("treats empty/null content as no presets", () => {
		expect(parseModelsFile("")).toEqual({ active: null, presets: {} });
	});

	it("defaults active to null when omitted", () => {
		expect(parseModelsFile("presets:\n  p:\n    explore: a/b").active).toBeNull();
	});

	it("rejects a non-string active", () => {
		expect(() => parseModelsFile("active: 3\npresets: {}")).toThrow(/`active`/);
	});

	it("rejects a preset that is not a string map", () => {
		expect(() => parseModelsFile("presets:\n  p:\n    explore: 5")).toThrow(/preset "p"/);
	});
});

describe("mergeModelsFiles", () => {
	it("lets the project layer override global per-agent and add presets", () => {
		const global: ModelsFile = {
			active: "a",
			presets: { a: { explore: "g/explore", tracer: "g/tracer" }, shared: { critic: "g/critic" } },
		};
		const project: ModelsFile = { active: null, presets: { a: { explore: "p/explore" }, extra: { planner: "p/planner" } } };

		const merged = mergeModelsFiles(global, project);

		expect(merged.active).toBe("a"); // project active null -> inherit global
		expect(merged.presets.a).toEqual({ explore: "p/explore", tracer: "g/tracer" }); // project wins per-agent
		expect(merged.presets.shared).toEqual({ critic: "g/critic" }); // global-only preset preserved
		expect(merged.presets.extra).toEqual({ planner: "p/planner" }); // project-only preset added
	});

	it("prefers the project active when set", () => {
		const merged = mergeModelsFiles({ active: "a", presets: {} }, { active: "b", presets: {} });
		expect(merged.active).toBe("b");
	});
});

describe("toTaskAgentName", () => {
	it("prefixes short agent names", () => {
		expect(toTaskAgentName("executor")).toBe("lsc-executor");
		expect(toTaskAgentName("test-engineer")).toBe("lsc-test-engineer");
	});
	it("leaves already-prefixed names unchanged", () => {
		expect(toTaskAgentName("lsc-planner")).toBe("lsc-planner");
	});
});

describe("save/load round-trip", () => {
	it("persists and re-reads a models file", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-models-"));
		tempDirs.push(dir);
		const path = join(dir, "models.yaml");
		const file: ModelsFile = { active: "p", presets: { p: { explore: "anthropic/claude-opus-4-8:high" } } };

		saveModelsFileAt(path, file);
		expect(loadModelsFileAt(path)).toEqual(file);
	});

	it("returns the empty file when the path does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-models-"));
		tempDirs.push(dir);
		expect(loadModelsFileAt(join(dir, "missing.yaml"))).toEqual({ active: null, presets: {} });
	});
});
