// Phase 1.5 spike — model-preset injection path for lets-craft.
//
// Empirically verified against omp 16.4.0 (bundled Bun binary) with a throwaway
// probe extension (`omp -e probe.mjs --config overlay.yml`). Findings:
//
//   1. The builtin `task` tool resolves a sub-agent's model at SPAWN time from
//      `session.settings.get("task.agentModelOverrides")[agentName]` — the
//      highest-priority override (task/index.ts:1138-1149).
//   2. `session.settings` is the process-global `Settings` singleton. The omp
//      binary injects that same instance into extensions as `pi.pi.settings`
//      (index.ts re-exports the `settings` singleton). A write through it is
//      seen LIVE by the next `task` spawn — no restart required (AC2d-live).
//   3. A bare `import { settings } from "@oh-my-pi/pi-coding-agent"` inside a
//      loaded extension resolves to the extension's OWN node_modules copy, whose
//      `globalInstance` is null ("Settings not initialized"). Because omp is a
//      bundled single-file binary, module identity is only shared through the
//      injected `pi.pi` SDK — NOT through bare imports. So all injection MUST go
//      through `pi.pi.settings` (ExtensionContext exposes no settings setter).
//   4. `Settings.set()` is clobber-safe: the debounced `#saveNow` re-reads
//      config.yml under a file lock and re-applies only the paths it modified,
//      preserving concurrent external edits (settings.ts:1336-1349). For a
//      purely session-scoped injection that must not touch global config.yml,
//      prefer `settings.override()` (runtime `#overrides` layer, live-reflected,
//      never persisted) and re-inject on `session_start` from models.yaml.
//
// These helpers are the primitive that Phase 2 (`preset/inject.ts`) builds on.

import type { Settings } from "@oh-my-pi/pi-coding-agent";

/** Settings key the builtin `task` tool reads at spawn to override a sub-agent's model. */
export const AGENT_MODEL_OVERRIDES_KEY = "task.agentModelOverrides" as const;

/**
 * Per-agent model overrides: task-agent name -> model pattern string.
 * Pattern form is `provider/model-id[:effort]` (e.g. `zai/glm-4.5-flash:low`).
 */
export type AgentModelOverrides = Record<string, string>;

/**
 * Minimal structural view of omp's `Settings` used for model-override injection.
 * The concrete `Settings` singleton (reached in an extension via `pi.pi.settings`)
 * satisfies this shape. Depending on the seam rather than the class keeps the
 * primitive unit-testable without booting the Bun-native omp runtime — vitest on
 * Node cannot import omp SDK values (its native loader requires Bun).
 */
export interface AgentModelStore {
	/** Merged read of the override map (global + project + runtime overrides). */
	get(path: typeof AGENT_MODEL_OVERRIDES_KEY): AgentModelOverrides;
	/** Persisted write (config.yml, clobber-safe) — seen live by the next task spawn. */
	set(path: typeof AGENT_MODEL_OVERRIDES_KEY, value: AgentModelOverrides): void;
	/** Runtime-only write (`#overrides` layer) — live-reflected, never persisted. */
	override(path: typeof AGENT_MODEL_OVERRIDES_KEY, value: AgentModelOverrides): void;
}

// Compile-time proof that the real omp `Settings` satisfies the injection seam.
// `Assert` fails to compile if the condition is not exactly `true`.
type Assert<T extends true> = T;
export type SettingsSatisfiesStore = Assert<Settings extends AgentModelStore ? true : false>;

/** Read a defensive copy of the current per-agent model override map. */
export function getAgentModelOverrides(settings: AgentModelStore): AgentModelOverrides {
	return { ...settings.get(AGENT_MODEL_OVERRIDES_KEY) };
}

/**
 * Set a single agent's model override, preserving every other entry.
 * Persists to config.yml (clobber-safe) and is seen live by the next task spawn.
 */
export function setAgentModelOverride(settings: AgentModelStore, agentName: string, modelPattern: string): void {
	settings.set(AGENT_MODEL_OVERRIDES_KEY, { ...getAgentModelOverrides(settings), [agentName]: modelPattern });
}

/** Replace the entire per-agent override map (used when switching presets). Persists. */
export function applyAgentModelOverrides(settings: AgentModelStore, overrides: AgentModelOverrides): void {
	settings.set(AGENT_MODEL_OVERRIDES_KEY, { ...overrides });
}

/**
 * Replace the override map for the current session only (runtime `#overrides`
 * layer): live-reflected by the next task spawn but never written to config.yml.
 */
export function applySessionAgentModelOverrides(settings: AgentModelStore, overrides: AgentModelOverrides): void {
	settings.override(AGENT_MODEL_OVERRIDES_KEY, { ...overrides });
}

/** Remove one agent's override, preserving the rest. Persists to config.yml. */
export function clearAgentModelOverride(settings: AgentModelStore, agentName: string): void {
	const next = getAgentModelOverrides(settings);
	delete next[agentName];
	settings.set(AGENT_MODEL_OVERRIDES_KEY, next);
}
