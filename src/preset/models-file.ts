// models.yaml: named model presets for the lets-craft agents.
//
// Layout (spec §Agent 별 모델 할당):
//   active: codex-glm
//   presets:
//     codex-glm:
//       explore: openai-codex/gpt-5.6-luna:medium
//       tracer:  zai-coding/glm-5.2:xhigh
//
// Loaded from the global file (`~/.omp/.lsc/models.yaml`) overlaid by the project
// file (`<cwd>/.lsc/models.yaml`); the project layer wins (C10).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { globalLscDir, projectLscDir } from "../artifacts/paths.js";

/** A preset maps an agent name to a model pattern `provider/model-id[:effort]`. */
export type PresetModels = Record<string, string>;

export interface ModelsFile {
	/** Name of the active preset, or null when none is selected. */
	active: string | null;
	/** Named presets. */
	presets: Record<string, PresetModels>;
}

/** The seven lets-craft agents, by short name (as written in models.yaml presets). */
export const LSC_AGENT_NAMES = [
	"explore",
	"tracer",
	"critic",
	"architect",
	"executor",
	"planner",
	"test-engineer",
] as const;
export type LscAgentName = (typeof LSC_AGENT_NAMES)[number];

/** Map a preset agent key to the registered task-agent name (`explore` -> `lsc-explore`). */
export function toTaskAgentName(agentKey: string): string {
	return agentKey.startsWith("lsc-") ? agentKey : `lsc-${agentKey}`;
}

export function globalModelsPath(): string {
	return join(globalLscDir(), "models.yaml");
}

export function projectModelsPath(cwd: string): string {
	return join(projectLscDir(cwd), "models.yaml");
}

function isPresetModels(value: unknown): value is PresetModels {
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value).every(entry => typeof entry === "string");
}

/** Parse + structurally validate raw models.yaml text. Throws on invalid shape. */
export function parseModelsFile(text: string): ModelsFile {
	const raw: unknown = parse(text);
	if (raw === null || raw === undefined) return { active: null, presets: {} };
	if (typeof raw !== "object") throw new Error("models.yaml: expected a mapping at the top level");
	const record = raw as Record<string, unknown>;

	const active = record.active;
	if (active !== undefined && active !== null && typeof active !== "string") {
		throw new Error("models.yaml: `active` must be a string or null");
	}

	const presetsRaw = record.presets ?? {};
	if (typeof presetsRaw !== "object" || presetsRaw === null) {
		throw new Error("models.yaml: `presets` must be a mapping");
	}
	const presets: Record<string, PresetModels> = {};
	for (const [name, value] of Object.entries(presetsRaw as Record<string, unknown>)) {
		if (!isPresetModels(value)) {
			throw new Error(`models.yaml: preset "${name}" must map agent names to model strings`);
		}
		presets[name] = { ...value };
	}

	return { active: active ?? null, presets };
}

/** Load a single models.yaml, or the empty file when absent. */
export function loadModelsFileAt(path: string): ModelsFile {
	if (!existsSync(path)) return { active: null, presets: {} };
	return parseModelsFile(readFileSync(path, "utf8"));
}

/**
 * Merge two models files, `override` winning. Presets merge by name; within a
 * shared preset, override agent entries replace base ones. `active` prefers the
 * override value unless it is null.
 */
export function mergeModelsFiles(base: ModelsFile, override: ModelsFile): ModelsFile {
	const presets: Record<string, PresetModels> = {};
	for (const name of new Set([...Object.keys(base.presets), ...Object.keys(override.presets)])) {
		presets[name] = { ...base.presets[name], ...override.presets[name] };
	}
	return { active: override.active ?? base.active, presets };
}

/** Effective config: global overlaid by project (project wins, C10). */
export function loadEffectiveModelsFile(cwd: string): ModelsFile {
	return mergeModelsFiles(loadModelsFileAt(globalModelsPath()), loadModelsFileAt(projectModelsPath(cwd)));
}

/** Serialize + write a models.yaml, creating parent directories. */
export function saveModelsFileAt(path: string, file: ModelsFile): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringify(file));
}
