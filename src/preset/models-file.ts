// models.yaml: named model presets for the lets-craft agents.
//
// Layout (spec §Agent 별 모델 할당):
//   active: fast-glm
//   presets:
//     fast-glm:
//       default: zai/glm-4.6:medium
//       agents:
//         explore: zai/glm-4.6:medium
//         tracer:  zai/glm-5.2:xhigh
// Loaded from the global file (`~/.omp/.lsc/models.yaml`) overlaid by the project
// file (`<cwd>/.lsc/models.yaml`); the project layer wins (C10).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import { globalLscDir, projectLscDir } from "../artifacts/paths.js";

/** A preset's per-agent model patterns (`provider/model-id[:effort]`). */
export type PresetModels = Record<string, string>;

export interface PresetEntry {
	/** Optional session-default model `provider/model-id[:effort]` — switches the omp session main model. */
	default?: string;
	/** Per-agent overrides (agent short name -> model pattern). */
	agents: PresetModels;
}

export interface ModelsFile {
	/** Name of the active preset, or null when none is selected. */
	active: string | null;
	/** Named presets. */
	presets: Record<string, PresetEntry>;
}

/** Which models.yaml layer a merged preset's value actually came from (project always wins, C10). */
export type PresetSourceLayer = "project" | "global";

/**
 * `mergeModelsFiles`' return type: the merged file (unchanged shape, `ModelsFile`-compatible)
 * plus provenance the merge itself already knows but previously discarded — which layer each
 * preset entry and each preset's `default` came from. Kept as a strict superset of `ModelsFile`
 * (not a change to that interface) so every existing caller that only reads `.active`/`.presets`
 * keeps working unmodified.
 */
export interface MergedModelsFile extends ModelsFile {
	/** Per-preset name -> the layer that supplied its entry ("project" whenever the project file defines that preset at all, even a partial agents-only override — mirrors mergeModelsFiles' own per-name precedence). */
	presetSource: Record<string, PresetSourceLayer>;
	/** Per-preset name -> the layer that supplied its `default` field specifically. Tracked independently of `presetSource`: a project preset can override only `agents` while its `default` still falls through from the global preset of the same name. Absent for a preset with no `default` in either layer. */
	defaultSource: Record<string, PresetSourceLayer>;
}

/** The eight lets-craft agents, by short name (as written in models.yaml presets). */
export const LSC_AGENT_NAMES = [
	"explore",
	"tracer",
	"critic",
	"architect",
	"executor",
	"planner",
	"test-engineer",
	"librarian",
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

function isPresetEntryShape(value: unknown): value is { default?: string | null; agents?: PresetModels } {
	if (typeof value !== "object" || value === null) return false;
	const entry = value as Record<string, unknown>;
	if (!Object.keys(entry).every(key => key === "default" || key === "agents")) return false;
	if (entry.default !== undefined && entry.default !== null && typeof entry.default !== "string") return false;
	return entry.agents === undefined || isPresetModels(entry.agents);
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
	const presets: Record<string, PresetEntry> = {};
	for (const [name, value] of Object.entries(presetsRaw as Record<string, unknown>)) {
		if (isPresetEntryShape(value)) {
			presets[name] = {
				...(typeof value.default === "string" ? { default: value.default } : {}),
				agents: { ...(value.agents ?? {}) },
			};
			continue;
		}
		if (isPresetModels(value)) {
			presets[name] = { agents: { ...value } };
			continue;
		}
		throw new Error(`models.yaml: preset "${name}" must be an agent->model map or { default?, agents }`);
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
 * override value unless it is null. Also returns provenance (`presetSource`/
 * `defaultSource`) for which layer each preset/default actually came from —
 * see `MergedModelsFile`.
 */
export function mergeModelsFiles(base: ModelsFile, override: ModelsFile): MergedModelsFile {
	const presets: Record<string, PresetEntry> = {};
	const presetSource: Record<string, PresetSourceLayer> = {};
	const defaultSource: Record<string, PresetSourceLayer> = {};
	for (const name of new Set([...Object.keys(base.presets), ...Object.keys(override.presets)])) {
		const overrideEntry = override.presets[name];
		const baseEntry = base.presets[name];
		const mergedDefault = overrideEntry?.default ?? baseEntry?.default;
		presets[name] = {
			...(mergedDefault !== undefined ? { default: mergedDefault } : {}),
			agents: { ...baseEntry?.agents, ...overrideEntry?.agents },
		};
		presetSource[name] = overrideEntry !== undefined ? "project" : "global";
		if (mergedDefault !== undefined) {
			defaultSource[name] = overrideEntry?.default !== undefined ? "project" : "global";
		}
	}
	return { active: override.active ?? base.active, presets, presetSource, defaultSource };
}

/** Effective config: global overlaid by project (project wins, C10). */
export function loadEffectiveModelsFile(cwd: string): MergedModelsFile {
	return mergeModelsFiles(loadModelsFileAt(globalModelsPath()), loadModelsFileAt(projectModelsPath(cwd)));
}

/** Serialize + write a models.yaml, creating parent directories. */
export function saveModelsFileAt(path: string, file: ModelsFile): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringify(file));
}
