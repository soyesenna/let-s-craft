// Validate a preset's model strings against the authenticated model set.
//
// omp's `resolve()` strips the thinking suffix and resolves the base model, so we
// validate the `:effort` suffix locally against the five catalog levels and never
// silently ignore a bad one (C13).
import { type PresetModels, toTaskAgentName } from "./models-file.js";

/** Valid thinking-effort suffixes (catalog/effort.ts). */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export interface ResolvedOverride {
	/** Short agent name from the preset (e.g. "executor"). */
	agent: string;
	/** Registered task-agent name (e.g. "lsc-executor"). */
	taskAgent: string;
	/** Full model pattern string, effort suffix included (fed to task.agentModelOverrides). */
	spec: string;
}

export interface PresetValidation {
	/** Overrides whose base model resolves and whose effort (if present) is valid. */
	valid: ResolvedOverride[];
	/** Warnings for entries that were dropped — those agents fall back to the session model. */
	warnings: string[];
}

function isEffort(value: string): value is EffortLevel {
	return (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Split `provider/model-id[:effort]` into its base spec and optional effort suffix.
 * The effort is the segment after the last colon that follows the provider slash;
 * a bare id without a `/` is returned unchanged.
 */
export function splitEffort(spec: string): { base: string; effort: string | null } {
	const slash = spec.indexOf("/");
	const colon = spec.lastIndexOf(":");
	if (slash >= 0 && colon > slash) return { base: spec.slice(0, colon), effort: spec.slice(colon + 1) };
	return { base: spec, effort: null };
}

/**
 * Validate each preset entry. `isModelAvailable` reports whether a base model
 * (thinking suffix stripped) resolves to an authenticated model — pass
 * `spec => modelQuery.resolve(spec) !== undefined`.
 */
export function validatePreset(preset: PresetModels, isModelAvailable: (base: string) => boolean): PresetValidation {
	const valid: ResolvedOverride[] = [];
	const warnings: string[] = [];
	for (const [agent, spec] of Object.entries(preset)) {
		const { base, effort } = splitEffort(spec);
		if (effort !== null && !isEffort(effort)) {
			warnings.push(`${agent}: invalid effort ":${effort}" (expected ${EFFORT_LEVELS.join("|")}) — using session model`);
			continue;
		}
		if (!isModelAvailable(base)) {
			warnings.push(`${agent}: model "${base}" not found or not authenticated — using session model`);
			continue;
		}
		valid.push({ agent, taskAgent: toTaskAgentName(agent), spec });
	}
	return { valid, warnings };
}
