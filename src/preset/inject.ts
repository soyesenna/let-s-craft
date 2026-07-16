// Resolve the active preset and inject its per-agent model overrides into the
// live session (runtime `#overrides` layer via `applySessionAgentModelOverrides`):
// seen by the next `task` spawn, not persisted to config.yml. Re-run on
// session_start (self-healing from models.yaml) and on `/lsc-preset` switch.
import type { ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import { loadEffectiveModelsFile, type PresetSourceLayer } from "./models-file.js";
import { type AgentModelOverrides, type AgentModelStore, applySessionAgentModelOverrides } from "./spike.js";
import { validatePreset } from "./validate.js";

export interface InjectResult {
	/** Active preset name, or null when none is selected. */
	preset: string | null;
	/** The overrides actually applied (task-agent name -> model spec). */
	applied: AgentModelOverrides;
	/** Validation warnings surfaced to the user. */
	warnings: string[];
	/** Validated session-default model spec, or null when absent or dropped. */
	defaultSpec: string | null;
	/** Which models.yaml layer the active preset's own entry came from — null when no preset is active or it was not found. */
	presetSource: PresetSourceLayer | null;
	/** Which layer supplied `defaultSpec` specifically — null when there is no default. */
	defaultSource: PresetSourceLayer | null;
}

/**
 * Load models.yaml (global+project), resolve the active preset, validate it, and
 * apply the resulting overrides to the current session. When no preset is active,
 * leaves existing overrides untouched (respects any external project config).
 */
export function applyActivePreset(args: {
	settings: AgentModelStore;
	models: Pick<ExtensionModelQuery, "resolve">;
	cwd: string;
}): InjectResult {
	const file = loadEffectiveModelsFile(args.cwd);
	if (!file.active) return { preset: null, applied: {}, warnings: [], defaultSpec: null, presetSource: null, defaultSource: null };

	const preset = file.presets[file.active];
	if (!preset) {
		return {
			preset: file.active,
			applied: {},
			warnings: [`active preset "${file.active}" not found in models.yaml`],
			defaultSpec: null,
			presetSource: null,
			defaultSource: null,
		};
	}

	const { valid, warnings, defaultSpec } = validatePreset(preset, spec => args.models.resolve(spec) !== undefined);
	const applied: AgentModelOverrides = {};
	for (const entry of valid) applied[entry.taskAgent] = entry.spec;
	applySessionAgentModelOverrides(args.settings, applied);
	return {
		preset: file.active,
		applied,
		warnings,
		defaultSpec,
		presetSource: file.presetSource[file.active] ?? null,
		defaultSource: defaultSpec !== null ? (file.defaultSource[file.active] ?? null) : null,
	};
}
