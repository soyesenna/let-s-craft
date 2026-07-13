import { describe, expect, it } from "vitest";
import { EFFORT_LEVELS, splitEffort, validatePreset } from "../src/preset/validate";

/** Presence check stand-in: the given specs are "authenticated". */
function availabilityOf(authed: string[]): (base: string) => boolean {
	const set = new Set(authed);
	return base => set.has(base);
}

describe("splitEffort", () => {
	it("splits a provider/model:effort spec", () => {
		expect(splitEffort("anthropic/claude-opus-4-8:high")).toEqual({ base: "anthropic/claude-opus-4-8", effort: "high" });
	});
	it("returns no effort for a plain provider/model spec", () => {
		expect(splitEffort("zai/glm-4.5-flash")).toEqual({ base: "zai/glm-4.5-flash", effort: null });
	});
	it("returns no effort for a bare id without a provider slash", () => {
		expect(splitEffort("opus")).toEqual({ base: "opus", effort: null });
	});
});

describe("validatePreset", () => {
	it("accepts entries whose base model resolves and effort is valid", () => {
		const result = validatePreset(
			{
				agents: { executor: "anthropic/claude-opus-4-8:high", planner: "zai/glm-4.5-flash" },
			},
			availabilityOf(["anthropic/claude-opus-4-8", "zai/glm-4.5-flash"]),
		);
		expect(result.warnings).toEqual([]);
		expect(result.defaultSpec).toBeNull();
		expect(result.valid).toEqual([
			{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/claude-opus-4-8:high" },
			{ agent: "planner", taskAgent: "lsc-planner", spec: "zai/glm-4.5-flash" },
		]);
	});

	it("warns and drops an entry with an invalid effort suffix", () => {
		const result = validatePreset(
			{ agents: { executor: "anthropic/claude-opus-4-8:ultra" } },
			availabilityOf(["anthropic/claude-opus-4-8"]),
		);
		expect(result.valid).toEqual([]);
		expect(result.warnings).toEqual([
			'executor: invalid effort ":ultra" (expected minimal|low|medium|high|xhigh|max) — using session model',
		]);
	});

	it("warns and drops an entry whose model does not resolve", () => {
		const result = validatePreset({ agents: { tracer: "zzz/missing:low" } }, availabilityOf([]));
		expect(result.valid).toEqual([]);
		expect(result.warnings).toEqual(['tracer: model "zzz/missing" not found or not authenticated — using session model']);
	});

	it("keeps valid entries while dropping invalid ones", () => {
		const result = validatePreset(
			{ agents: { executor: "anthropic/ok:medium", tracer: "zzz/missing" } },
			availabilityOf(["anthropic/ok"]),
		);
		expect(result.valid.map(entry => entry.taskAgent)).toEqual(["lsc-executor"]);
		expect(result.warnings).toHaveLength(1);
	});

	it("exposes exactly the six catalog effort levels", () => {
		expect([...EFFORT_LEVELS]).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
	});

	it("warns and drops a malformed default while retaining valid agent overrides", () => {
		const result = validatePreset(
			{ default: "opus", agents: { executor: "anthropic/ok:medium" } },
			availabilityOf(["opus", "anthropic/ok"]),
		);

		expect(result.defaultSpec).toBeNull();
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/default/i);
		expect(result.valid).toEqual([{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/ok:medium" }]);
	});

	it("warns and drops a default with an invalid effort while retaining valid agent overrides", () => {
		const result = validatePreset(
			{
				default: "anthropic/claude-opus-4-8:ultra",
				agents: { executor: "anthropic/ok:medium" },
			},
			availabilityOf(["anthropic/claude-opus-4-8", "anthropic/ok"]),
		);

		expect(result.defaultSpec).toBeNull();
		expect(result.warnings).toEqual([
			'default: invalid effort ":ultra" (expected minimal|low|medium|high|xhigh|max) — keeping current session model',
		]);
		expect(result.valid).toEqual([{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/ok:medium" }]);
	});

	it("warns and drops an unresolvable default while retaining valid agent overrides", () => {
		const result = validatePreset(
			{ default: "zzz/missing:low", agents: { executor: "anthropic/ok:medium" } },
			availabilityOf(["anthropic/ok"]),
		);

		expect(result.defaultSpec).toBeNull();
		expect(result.warnings).toEqual([
			'default: model "zzz/missing" not found or not authenticated — keeping current session model',
		]);
		expect(result.valid).toEqual([{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/ok:medium" }]);
	});

	it("propagates a valid default spec verbatim", () => {
		const result = validatePreset(
			{ default: "anthropic/claude-opus-4-8:xhigh", agents: {} },
			availabilityOf(["anthropic/claude-opus-4-8"]),
		);

		expect(result.defaultSpec).toBe("anthropic/claude-opus-4-8:xhigh");
		expect(result.warnings).toEqual([]);
	});

	it('warns and drops the reserved "default" agent key without creating lsc-default', () => {
		const result = validatePreset(
			{
				agents: { default: "anthropic/session", executor: "anthropic/ok:medium" },
			},
			availabilityOf(["anthropic/session", "anthropic/ok"]),
		);
		const taskAgents = result.valid.map(entry => entry.taskAgent);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/"default"/);
		expect(result.defaultSpec).toBeNull();
		expect(taskAgents).toEqual(["lsc-executor"]);
	});

	it('warns and drops the reserved "agents" agent key without creating lsc-agents', () => {
		const result = validatePreset(
			{
				agents: { agents: "anthropic/session", executor: "anthropic/ok:medium" },
			},
			availabilityOf(["anthropic/session", "anthropic/ok"]),
		);
		const taskAgents = result.valid.map(entry => entry.taskAgent);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/"agents"/);
		expect(result.defaultSpec).toBeNull();
		expect(taskAgents).toEqual(["lsc-executor"]);
	});

	it("accepts a :max effort suffix on an agent entry", () => {
		const result = validatePreset(
			{ agents: { executor: "anthropic/claude-opus-4-8:max" } },
			availabilityOf(["anthropic/claude-opus-4-8"]),
		);
		expect(result.warnings).toEqual([]);
		expect(result.valid).toEqual([
			{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/claude-opus-4-8:max" },
		]);
	});

	it("accepts a :max effort suffix on the default field", () => {
		const result = validatePreset(
			{ default: "anthropic/claude-opus-4-8:max", agents: {} },
			availabilityOf(["anthropic/claude-opus-4-8"]),
		);
		expect(result.warnings).toEqual([]);
		expect(result.defaultSpec).toBe("anthropic/claude-opus-4-8:max");
	});

	it("treats a full spec that resolves as a literal model ID without splitting the trailing suffix", () => {
		// "prov/model:max" is itself a registered availability entry here (not just its base) —
		// mirrors a real model whose literal ID happens to end in a catalog effort word.
		const result = validatePreset(
			{
				default: "prov/model:max",
				agents: { executor: "prov/model:max" },
			},
			availabilityOf(["prov/model:max"]),
		);
		expect(result.warnings).toEqual([]);
		expect(result.defaultSpec).toBe("prov/model:max");
		expect(result.valid).toEqual([{ agent: "executor", taskAgent: "lsc-executor", spec: "prov/model:max" }]);
	});
});
