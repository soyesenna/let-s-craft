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
			{ executor: "anthropic/claude-opus-4-8:high", planner: "zai/glm-4.5-flash" },
			availabilityOf(["anthropic/claude-opus-4-8", "zai/glm-4.5-flash"]),
		);
		expect(result.warnings).toEqual([]);
		expect(result.valid).toEqual([
			{ agent: "executor", taskAgent: "lsc-executor", spec: "anthropic/claude-opus-4-8:high" },
			{ agent: "planner", taskAgent: "lsc-planner", spec: "zai/glm-4.5-flash" },
		]);
	});

	it("warns and drops an entry with an invalid effort suffix", () => {
		const result = validatePreset({ executor: "anthropic/claude-opus-4-8:ultra" }, availabilityOf(["anthropic/claude-opus-4-8"]));
		expect(result.valid).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/invalid effort ":ultra"/);
	});

	it("warns and drops an entry whose model does not resolve", () => {
		const result = validatePreset({ tracer: "zzz/missing:low" }, availabilityOf([]));
		expect(result.valid).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/not found or not authenticated/);
	});

	it("keeps valid entries while dropping invalid ones", () => {
		const result = validatePreset(
			{ executor: "anthropic/ok:medium", tracer: "zzz/missing" },
			availabilityOf(["anthropic/ok"]),
		);
		expect(result.valid.map(entry => entry.taskAgent)).toEqual(["lsc-executor"]);
		expect(result.warnings).toHaveLength(1);
	});

	it("exposes exactly the five catalog effort levels", () => {
		expect([...EFFORT_LEVELS]).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
	});
});
