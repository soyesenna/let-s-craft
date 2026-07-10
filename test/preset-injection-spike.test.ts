// Phase 1.5 spike test — locks the model-preset injection helper logic.
//
// omp's live-reflection / clobber-safety behaviour was verified out-of-process
// with a throwaway probe extension (`omp -e probe.mjs --config overlay.yml`), the
// only way to exercise the real (Bun-native) runtime: vitest on Node cannot import
// omp SDK values (its `@oh-my-pi/pi-natives` loader requires Bun). These tests
// therefore cover the pure transformations of the injection primitive against a
// fake store that satisfies the same `AgentModelStore` seam the real `Settings`
// singleton does (see src/preset/spike.ts).
//
// The real-runtime, Bun-only verifications (clobber-race timing, global/project
// write-location matrix, and the real subagent spawn check) live in two rerunnable
// scripts instead of here, since they need the actual `Settings` class / `omp`
// binary, not the fake store:
//   - scripts/spike-clover-race.ts   (isolated, zero-cost)
//   - scripts/spike-e2e-verify.sh    (Part A isolated/zero-cost; Part B opt-in,
//                                      spends real tokens — see its header for the
//                                      <agentId>.jsonl methodology this spike's
//                                      earlier, incorrect measurement missed)
import { describe, expect, it } from "vitest";
import {
	AGENT_MODEL_OVERRIDES_KEY,
	type AgentModelOverrides,
	type AgentModelStore,
	applyAgentModelOverrides,
	applySessionAgentModelOverrides,
	clearAgentModelOverride,
	getAgentModelOverrides,
	setAgentModelOverride,
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

describe("agent model override injection primitive", () => {
	it("exposes the exact settings key the builtin task tool reads at spawn", () => {
		expect(AGENT_MODEL_OVERRIDES_KEY).toBe("task.agentModelOverrides");
	});

	it("reads an empty map when nothing is configured", () => {
		expect(getAgentModelOverrides(new FakeStore())).toEqual({});
	});

	it("applies a full override map through the persisted (set) path", () => {
		const store = new FakeStore();
		applyAgentModelOverrides(store, {
			"lsc-executor": "zai/glm-4.5-flash:low",
			"lsc-planner": "anthropic/claude-opus-4-8:high",
		});

		expect(store.lastWrite).toBe("set");
		expect(getAgentModelOverrides(store)).toEqual({
			"lsc-executor": "zai/glm-4.5-flash:low",
			"lsc-planner": "anthropic/claude-opus-4-8:high",
		});
	});

	it("merges a single agent override without dropping the rest", () => {
		const store = new FakeStore({ "lsc-executor": "zai/glm-4.5-flash:low" });

		setAgentModelOverride(store, "lsc-tracer", "anthropic/claude-sonnet-4-5:medium");

		expect(getAgentModelOverrides(store)).toEqual({
			"lsc-executor": "zai/glm-4.5-flash:low",
			"lsc-tracer": "anthropic/claude-sonnet-4-5:medium",
		});
	});

	it("clears a single agent override, preserving the others", () => {
		const store = new FakeStore({
			"lsc-executor": "zai/glm-4.5-flash:low",
			"lsc-planner": "anthropic/claude-opus-4-8:high",
		});

		clearAgentModelOverride(store, "lsc-executor");

		expect(getAgentModelOverrides(store)).toEqual({ "lsc-planner": "anthropic/claude-opus-4-8:high" });
	});

	it("returns a defensive copy so callers cannot mutate the stored map", () => {
		const store = new FakeStore({ "lsc-executor": "zai/glm-4.5-flash:low" });

		const snapshot = getAgentModelOverrides(store);
		snapshot["lsc-executor"] = "tampered/model";

		expect(getAgentModelOverrides(store)).toEqual({ "lsc-executor": "zai/glm-4.5-flash:low" });
	});

	it("routes session-scoped overrides through the runtime (override) path", () => {
		const store = new FakeStore();

		applySessionAgentModelOverrides(store, { "lsc-critic": "anthropic/claude-haiku-4-5:low" });

		expect(store.lastWrite).toBe("override");
		expect(getAgentModelOverrides(store)).toEqual({ "lsc-critic": "anthropic/claude-haiku-4-5:low" });
	});
});
