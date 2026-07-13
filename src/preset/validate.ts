// Validate a preset's model strings against the authenticated model set.
//
// omp's `resolve()` strips the thinking suffix and resolves the base model, so we
// validate the `:effort` suffix locally against the six catalog levels and never
// silently ignore a bad one (C13).
import { type PresetEntry, toTaskAgentName } from "./models-file.js";

/** Valid thinking-effort suffixes (catalog/effort.ts). */
export const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
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
	/** Validated session-default spec, or null when absent or dropped. */
	defaultSpec: string | null;
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
export function validatePreset(preset: PresetEntry, isModelAvailable: (base: string) => boolean): PresetValidation {
	const valid: ResolvedOverride[] = [];
	const warnings: string[] = [];
	let defaultSpec: string | null = null;

	if (preset.default !== undefined) {
		const { base, effort } = splitEffort(preset.default);
		if (effort !== null && isModelAvailable(preset.default)) {
			// A colon-bearing full spec that itself resolves as a literal model ID — don't
			// split it, mirroring the host's "literal model IDs keep winning" behavior.
			defaultSpec = preset.default;
		} else {
			const slash = base.indexOf("/");
			if (slash <= 0 || slash === base.length - 1) {
				warnings.push(
					`default: invalid model spec "${preset.default}" (expected provider/model[:effort]) — keeping current session model`,
				);
			} else if (effort !== null && !isEffort(effort)) {
				warnings.push(
					`default: invalid effort ":${effort}" (expected ${EFFORT_LEVELS.join("|")}) — keeping current session model`,
				);
			} else if (!isModelAvailable(base)) {
				warnings.push(`default: model "${base}" not found or not authenticated — keeping current session model`);
			} else {
				defaultSpec = preset.default;
			}
		}
	}

	const reservedKeys = ["default", "agents"] as const;
	for (const key of reservedKeys) {
		if (!Object.prototype.hasOwnProperty.call(preset.agents, key)) continue;
		warnings.push(
			key === "default"
				? `"default" is not an agent — to set a session default model, use { default: "...", agents: { ... } }; entry dropped`
				: `"agents" is not an agent — expected a map; use { default?, agents: { ... } }; entry dropped`,
		);
	}

	for (const [agent, spec] of Object.entries(preset.agents)) {
		if (agent === "default" || agent === "agents") continue;
		const { base, effort } = splitEffort(spec);
		if (effort !== null && isModelAvailable(spec)) {
			// A colon-bearing full spec that itself resolves as a literal model ID — don't
			// split it, mirroring the host's "literal model IDs keep winning" behavior.
			valid.push({ agent, taskAgent: toTaskAgentName(agent), spec });
			continue;
		}
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
	return { valid, warnings, defaultSpec };
}
