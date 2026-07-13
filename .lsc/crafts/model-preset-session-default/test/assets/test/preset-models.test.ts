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
	it("parses a well-formed legacy models.yaml as an agents-only preset", () => {
		const file = parseModelsFile(
			["active: fast-glm", "presets:", "  fast-glm:", "    explore: zai/glm-4.6:medium", ""].join("\n"),
		);
		expect(file).toEqual({
			active: "fast-glm",
			presets: { "fast-glm": { agents: { explore: "zai/glm-4.6:medium" } } },
		});
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

	it("rejects a preset that is neither a string map nor a structural entry", () => {
		expect(() => parseModelsFile("presets:\n  p:\n    explore: 5")).toThrow(/preset "p"/);
	});

	it("parses a structural preset with a session default and agent overrides", () => {
		const file = parseModelsFile(
			[
				"active: balanced",
				"presets:",
				"  balanced:",
				"    default: anthropic/claude-opus-4-8:high",
				"    agents:",
				"      explore: zai/glm-4.6:medium",
				"",
			].join("\n"),
		);

		expect(file.presets.balanced).toEqual({
			default: "anthropic/claude-opus-4-8:high",
			agents: { explore: "zai/glm-4.6:medium" },
		});
	});

	it("parses a structural preset with only a default and supplies empty agents", () => {
		const file = parseModelsFile(["presets:", "  default-only:", '    default: "x"', ""].join("\n"));

		expect(file.presets["default-only"]).toEqual({
			default: "x",
			agents: {},
		});
	});

	it("parses an empty structural preset as agents-only with no overrides", () => {
		const file = parseModelsFile("presets:\n  empty: {}");

		expect(file.presets.empty).toEqual({ agents: {} });
	});

	it("preserves every legacy flat-map key in agents, including default", () => {
		const file = parseModelsFile(
			[
				"presets:",
				"  legacy:",
				"    default: anthropic/claude-opus-4-8:high",
				"    explore: zai/glm-4.6:medium",
				"",
			].join("\n"),
		);

		expect(file.presets.legacy).toEqual({
			agents: {
				default: "anthropic/claude-opus-4-8:high",
				explore: "zai/glm-4.6:medium",
			},
		});
	});

	it("normalizes an omitted structural default to absence", () => {
		const file = parseModelsFile(["presets:", "  agents-only:", "    agents:", "      tracer: zai/glm-4.6:low", ""].join("\n"));

		expect(file.presets["agents-only"]).toEqual({
			agents: { tracer: "zai/glm-4.6:low" },
		});
	});

	it("normalizes an explicit null structural default to absence", () => {
		const file = parseModelsFile(
			["presets:", "  agents-only:", "    default: null", "    agents:", "      tracer: zai/glm-4.6:low", ""].join("\n"),
		);

		expect(file.presets["agents-only"]).toEqual({
			agents: { tracer: "zai/glm-4.6:low" },
		});
	});

	it("parses writeCheapModelPreset flat YAML as an agents-only preset", () => {
		const file = parseModelsFile(
			[
				"active: e2e-cheap",
				"presets:",
				"  e2e-cheap:",
				"    explore: zai/glm-5.2:low",
				"    tracer: zai/glm-5.2:low",
				"    critic: zai/glm-5.2:low",
				"    architect: zai/glm-5.2:low",
				"    executor: zai/glm-5.2:low",
				"    planner: zai/glm-5.2:low",
				"    test-engineer: zai/glm-5.2:low",
				"",
			].join("\n"),
		);

		expect(file.presets["e2e-cheap"]).toEqual({
			agents: {
				explore: "zai/glm-5.2:low",
				tracer: "zai/glm-5.2:low",
				critic: "zai/glm-5.2:low",
				architect: "zai/glm-5.2:low",
				executor: "zai/glm-5.2:low",
				planner: "zai/glm-5.2:low",
				"test-engineer": "zai/glm-5.2:low",
			},
		});
	});
});

describe("mergeModelsFiles", () => {
	it("lets the project layer override same-name defaults and agents while adding presets", () => {
		const global: ModelsFile = {
			active: "a",
			presets: {
				a: { default: "g/default", agents: { explore: "g/explore", tracer: "g/tracer" } },
				shared: { default: "g/shared", agents: { critic: "g/critic" } },
			},
		};
		const project: ModelsFile = {
			active: null,
			presets: {
				a: { default: "p/default", agents: { explore: "p/explore" } },
				extra: { agents: { planner: "p/planner" } },
			},
		};

		const merged = mergeModelsFiles(global, project);

		expect(merged.active).toBe("a"); // project active null -> inherit global
		expect(merged.presets.a).toEqual({
			default: "p/default",
			agents: { explore: "p/explore", tracer: "g/tracer" },
		}); // project wins default and per-agent
		expect(merged.presets.shared).toEqual({ default: "g/shared", agents: { critic: "g/critic" } }); // global-only preset preserved
		expect(merged.presets.extra).toEqual({ agents: { planner: "p/planner" } }); // project-only preset added
	});

	it("inherits a global default when the project preset leaves it unset", () => {
		const merged = mergeModelsFiles(
			{ active: "a", presets: { a: { default: "g/default:high", agents: { explore: "g/explore" } } } },
			{ active: null, presets: { a: { agents: { tracer: "p/tracer" } } } },
		);

		expect(merged.presets.a).toEqual({
			default: "g/default:high",
			agents: { explore: "g/explore", tracer: "p/tracer" },
		});
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
	it("persists and re-reads a structural models file", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-models-"));
		tempDirs.push(dir);
		const path = join(dir, "models.yaml");
		const file: ModelsFile = {
			active: "p",
			presets: {
				p: {
					default: "anthropic/claude-sonnet-4-5:medium",
					agents: { explore: "anthropic/claude-opus-4-8:high" },
				},
			},
		};

		saveModelsFileAt(path, file);
		expect(loadModelsFileAt(path)).toEqual(file);
	});

	it("returns the empty file when the path does not exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-models-"));
		tempDirs.push(dir);
		expect(loadModelsFileAt(join(dir, "missing.yaml"))).toEqual({ active: null, presets: {} });
	});
});
