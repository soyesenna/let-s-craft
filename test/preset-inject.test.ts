import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyActivePreset } from "../src/preset/inject";
import { globalModelsPath } from "../src/preset/models-file";
import {
	AGENT_MODEL_OVERRIDES_KEY,
	type AgentModelOverrides,
	type AgentModelStore,
} from "../src/preset/spike";

/** In-memory stand-in for omp's `Settings`, recording which write path was used. */
class FakeStore implements AgentModelStore {
	value: AgentModelOverrides;
	lastWrite: "set" | "override" | null = null;

	constructor(initial: AgentModelOverrides = {}) {
		this.value = { ...initial };
	}

	get(_path: typeof AGENT_MODEL_OVERRIDES_KEY): AgentModelOverrides {
		return this.value;
	}

	set(_path: typeof AGENT_MODEL_OVERRIDES_KEY, value: AgentModelOverrides): void {
		this.value = value;
		this.lastWrite = "set";
	}

	override(_path: typeof AGENT_MODEL_OVERRIDES_KEY, value: AgentModelOverrides): void {
		this.value = value;
		this.lastWrite = "override";
	}
}

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function makeTempDir(scope: string): string {
	const dir = mkdtempSync(join(tmpdir(), `lsc-preset-inject-${scope}-`));
	tempDirs.push(dir);
	return dir;
}

function projectWithModelsYaml(lines: string[]): string {
	const cwd = makeTempDir("project");
	const lscDir = join(cwd, ".lsc");
	mkdirSync(lscDir, { recursive: true });
	writeFileSync(join(lscDir, "models.yaml"), `${lines.join("\n")}\n`);
	return cwd;
}

/** Writes to the global models.yaml location — relies on `process.env.HOME` already being set to this test's temp home (beforeEach runs first). */
function writeGlobalModelsYaml(lines: string[]): void {
	const path = globalModelsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${lines.join("\n")}\n`);
}

function modelsResolving(...authenticated: string[]) {
	const available = new Set(authenticated);
	return {
		resolve: (spec: string) => (available.has(spec) ? ({ spec } as never) : undefined),
	};
}

beforeEach(() => {
	process.env.HOME = makeTempDir("home");
});

afterEach(() => {
	if (originalHome === undefined) delete process.env.HOME;
	else process.env.HOME = originalHome;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("applyActivePreset", () => {
	it("propagates a structural preset default and applies prefixed agent overrides through the runtime path", () => {
		const cwd = projectWithModelsYaml([
			"active: balanced",
			"presets:",
			"  balanced:",
			"    default: anthropic/claude-sonnet-4-5:high",
			"    agents:",
			"      executor: zai/glm-4.6:medium",
			"      tracer: anthropic/claude-haiku-4-5",
		]);
		const store = new FakeStore();

		const result = applyActivePreset({
			settings: store,
			models: modelsResolving("anthropic/claude-sonnet-4-5", "zai/glm-4.6", "anthropic/claude-haiku-4-5"),
			cwd,
		});

		expect(result.defaultSpec).toBe("anthropic/claude-sonnet-4-5:high");
		expect(result.applied).toEqual({
			"lsc-executor": "zai/glm-4.6:medium",
			"lsc-tracer": "anthropic/claude-haiku-4-5",
		});
		expect(store.value).toEqual(result.applied);
		expect(store.lastWrite).toBe("override");
		expect(result.warnings).toEqual([]);
	});

	it("leaves external overrides untouched when no preset is active", () => {
		const cwd = projectWithModelsYaml(["presets: {}"]);
		const store = new FakeStore({ "external-agent": "external/model" });

		const result = applyActivePreset({ settings: store, models: modelsResolving(), cwd });

		expect(result).toEqual({
			preset: null,
			applied: {},
			warnings: [],
			defaultSpec: null,
			presetSource: null,
			defaultSource: null,
		});
		expect(store.value).toEqual({ "external-agent": "external/model" });
		expect(store.lastWrite).toBeNull();
	});

	it("warns without writing when the active preset name is missing", () => {
		const cwd = projectWithModelsYaml(["active: absent", "presets: {}"]);
		const store = new FakeStore();
		const warned: string[] = [];

		const result = applyActivePreset({ settings: store, models: modelsResolving(), cwd });
		warned.push(...result.warnings);

		expect(result.defaultSpec).toBeNull();
		expect(result.applied).toEqual({});
		expect(store.lastWrite).toBeNull();
		expect(warned).toEqual(['active preset "absent" not found in models.yaml']);
	});

	it("keeps a valid default while dropping an invalid agent override", () => {
		const cwd = projectWithModelsYaml([
			"active: partial",
			"presets:",
			"  partial:",
			"    default: anthropic/claude-sonnet-4-5:high",
			"    agents:",
			"      executor: zai/glm-4.6:medium",
			"      tracer: missing/tracer",
		]);
		const store = new FakeStore();
		const warned: string[] = [];

		const result = applyActivePreset({
			settings: store,
			models: modelsResolving("anthropic/claude-sonnet-4-5", "zai/glm-4.6"),
			cwd,
		});
		warned.push(...result.warnings);

		expect(result.defaultSpec).toBe("anthropic/claude-sonnet-4-5:high");
		expect(result.applied).toEqual({ "lsc-executor": "zai/glm-4.6:medium" });
		expect(store.value).toEqual(result.applied);
		expect(store.lastWrite).toBe("override");
		expect(warned).toHaveLength(1);
		expect(warned[0]).toMatch(/tracer: model "missing\/tracer" not found or not authenticated/);
	});

	it("applies valid agent overrides while dropping an invalid default", () => {
		const cwd = projectWithModelsYaml([
			"active: partial",
			"presets:",
			"  partial:",
			"    default: missing/session:high",
			"    agents:",
			"      executor: zai/glm-4.6:medium",
		]);
		const store = new FakeStore();
		const warned: string[] = [];

		const result = applyActivePreset({
			settings: store,
			models: modelsResolving("zai/glm-4.6"),
			cwd,
		});
		warned.push(...result.warnings);

		expect(result.defaultSpec).toBeNull();
		expect(result.applied).toEqual({ "lsc-executor": "zai/glm-4.6:medium" });
		expect(store.value).toEqual(result.applied);
		expect(store.lastWrite).toBe("override");
		expect(warned).toHaveLength(1);
		expect(warned[0]).toMatch(/default: model "missing\/session" not found or not authenticated/);
	});

	it("applies a legacy flat preset without selecting a session default", () => {
		const cwd = projectWithModelsYaml([
			"active: legacy",
			"presets:",
			"  legacy:",
			"    executor: zai/glm-4.6:medium",
		]);
		const store = new FakeStore();

		const result = applyActivePreset({
			settings: store,
			models: modelsResolving("zai/glm-4.6"),
			cwd,
		});

		expect(result.defaultSpec).toBeNull();
		expect(result.applied).toEqual({ "lsc-executor": "zai/glm-4.6:medium" });
		expect(store.value).toEqual(result.applied);
		expect(store.lastWrite).toBe("override");
		expect(result.warnings).toEqual([]);
	});

	// QW5: the active preset's provenance (which models.yaml layer it/its default came from)
	// surfaces all the way through applyActivePreset, not just the raw merge in models-file.ts.
	describe("presetSource / defaultSource", () => {
		it("tags source: project when the active preset is defined in both layers (project wins, C10)", () => {
			writeGlobalModelsYaml([
				"active: balanced",
				"presets:",
				"  balanced:",
				"    default: anthropic/claude-sonnet-4-5:high",
				"    agents:",
				"      executor: g/executor",
			]);
			const cwd = projectWithModelsYaml([
				"presets:",
				"  balanced:",
				"    default: anthropic/claude-sonnet-4-5:high",
				"    agents:",
				"      executor: zai/glm-4.6:medium",
			]);

			const result = applyActivePreset({
				settings: new FakeStore(),
				models: modelsResolving("anthropic/claude-sonnet-4-5", "zai/glm-4.6"),
				cwd,
			});

			expect(result.presetSource).toBe("project");
			expect(result.defaultSource).toBe("project");
		});

		it("tags source: global when the active preset exists only in the global layer", () => {
			writeGlobalModelsYaml([
				"active: balanced",
				"presets:",
				"  balanced:",
				"    default: anthropic/claude-sonnet-4-5:high",
				"    agents:",
				"      executor: zai/glm-4.6:medium",
			]);
			const cwd = projectWithModelsYaml(["presets: {}"]);

			const result = applyActivePreset({
				settings: new FakeStore(),
				models: modelsResolving("anthropic/claude-sonnet-4-5", "zai/glm-4.6"),
				cwd,
			});

			expect(result.presetSource).toBe("global");
			expect(result.defaultSource).toBe("global");
		});

		it("tags defaultSource: global independently of presetSource: project when the project preset overrides agents only", () => {
			writeGlobalModelsYaml([
				"active: balanced",
				"presets:",
				"  balanced:",
				"    default: anthropic/claude-sonnet-4-5:high",
				"    agents:",
				"      executor: g/executor",
			]);
			const cwd = projectWithModelsYaml([
				"presets:",
				"  balanced:",
				"    agents:",
				"      executor: zai/glm-4.6:medium",
			]);

			const result = applyActivePreset({
				settings: new FakeStore(),
				models: modelsResolving("anthropic/claude-sonnet-4-5", "zai/glm-4.6"),
				cwd,
			});

			expect(result.presetSource).toBe("project"); // project's models.yaml does define "balanced" (agents-only)
			expect(result.defaultSource).toBe("global"); // ...but its default still falls through from global
		});

		it("leaves presetSource/defaultSource null when no preset is active", () => {
			const cwd = projectWithModelsYaml(["presets: {}"]);

			const result = applyActivePreset({ settings: new FakeStore(), models: modelsResolving(), cwd });

			expect(result.presetSource).toBeNull();
			expect(result.defaultSource).toBeNull();
		});
	});
});
