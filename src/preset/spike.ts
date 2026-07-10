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
//   4. `Settings.set()` is clobber-safe WITHIN a single process: the debounced
//      `#saveNow` re-reads config.yml under a file lock and re-applies only the
//      paths it modified, preserving concurrent external edits (settings.ts:1336-1349).
//      Precise single-process timeline (scripts/spike-clover-race.ts, isolated,
//      zero-cost, rerunnable): a raw external write made AFTER a session already
//      loaded settings is invisible to that session until ANY unrelated `.set()`
//      fires — at that point `#saveNow`'s read-modify-write pulls the raw write into
//      memory too (PULL-IN), and the file retains BOTH values (no data loss). This
//      refutes the plan's original "#saveNow overwrites #global wholesale" model.
//   5. Multi-process contention is a REAL, separate risk from (4): two independent
//      `omp` processes racing on the SAME real `~/.omp/agent/config.yml` — each with
//      its own in-memory `#global` and its own debounced `#saveNow` — can revert
//      each other's raw writes depending on flush ordering. This was observed live
//      during this spike (a key written by one headless `omp` invocation vanished
//      after a second one flushed). This is the concrete reason to prefer
//      `settings.override()` (in-memory only, never persisted, so it cannot race a
//      concurrent process's file write) over any raw config.yml write for `/lsc-preset`.
//   6. Write-location matrix (scripts/spike-e2e-verify.sh Part A, isolated `--profile`,
//      zero-cost): both the global config.yml layer and the project layer
//      (`<cwd>/.omp/settings.json`) are read correctly by a fresh `omp` process, and
//      merge per-key — a project-layer key wins over a conflicting global key while a
//      global-only key survives (not a whole-record replace). Superseded by finding 5
//      for Phase 2's actual design (no raw writes at all), but documents why a
//      project-layer *fallback* would have been clobber-safe by construction had one
//      been needed (the Settings class never writes back to the project layer files).
//   7. Verification methodology correction (the most operationally important finding
//      of this spike): a spawned subagent's OWN API calls do NOT appear in the parent
//      session's `--mode=json` stdout — they are written to a separate
//      `<parent-session-dir>/<agentId>.jsonl` file (executor.ts:1897). Checking only
//      the parent's stdout for the override model gives a FALSE NEGATIVE (this spike
//      initially concluded, incorrectly, that overrides were not applying, purely from
//      this measurement error). Phase 7's E2E harness must resolve and inspect the
//      per-agent session file — see scripts/spike-e2e-verify.sh Part B for the
//      reusable resolution procedure (locate the session dir from the parent's
//      session id, then the first `*.jsonl` inside it).
//
// These helpers are the primitive that Phase 2 (`preset/inject.ts`) builds on. Given
// finding 5, Phase 2's actual design uses `applySessionAgentModelOverrides` (live,
// `settings.override()`) re-applied from models.yaml at `session_start` and on
// `/lsc-preset` switch — `applyAgentModelOverrides`/`setAgentModelOverride` (the
// persisted `settings.set()` path) remain available but are not the primary path,
// since avoiding config.yml writes entirely sidesteps finding 5's multi-process risk.

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
