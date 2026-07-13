import { describe, expect, it } from "vitest";
import {
	applySessionDefaultModel,
	entryTypeHistogram,
	isFreshMainSession,
	type SessionModelApi,
} from "../src/preset/session-default.js";
import { splitEffort } from "../src/preset/validate.js";

class FakeSessionApi implements SessionModelApi<{ spec: string }> {
	constructor(
		public resolvable: Set<string>,
		public setModelResult = true,
	) {}

	calls: Array<{ fn: "setModel" | "setThinkingLevel"; arg: string }> = [];
	resolveSpecs: string[] = [];

	resolve(spec: string) {
		this.resolveSpecs.push(spec);
		const { base } = splitEffort(spec);
		return this.resolvable.has(base) ? { spec: base } : undefined;
	}

	async setModel(model: { spec: string }) {
		this.calls.push({ fn: "setModel", arg: model.spec });
		return this.setModelResult;
	}

	setThinkingLevel(level: string) {
		this.calls.push({ fn: "setThinkingLevel", arg: level });
	}
}

describe("isFreshMainSession", () => {
	it("rejects a resumed session containing a message entry", () => {
		expect(
			isFreshMainSession([
				{ type: "model_change" },
				{ type: "thinking_level_change" },
				{ type: "service_tier_change" },
				{ type: "message" },
			]),
		).toBe(false);
	});

	it('rejects a model change carrying role "default"', () => {
		expect(isFreshMainSession([{ type: "model_change", role: "default" }])).toBe(false);
	});

	it("accepts one boot stamp of each type", () => {
		expect(
			isFreshMainSession([
				{ type: "model_change" },
				{ type: "thinking_level_change" },
				{ type: "service_tier_change" },
			]),
		).toBe(true);
	});

	it("accepts an empty entry list", () => {
		expect(isFreshMainSession([])).toBe(true);
	});

	it("rejects a subagent session containing session_init", () => {
		expect(isFreshMainSession([{ type: "session_init" }])).toBe(false);
	});

	it("rejects two roleless model changes", () => {
		expect(isFreshMainSession([{ type: "model_change" }, { type: "model_change" }])).toBe(false);
	});

	it("rejects two thinking-level changes", () => {
		expect(isFreshMainSession([{ type: "thinking_level_change" }, { type: "thinking_level_change" }])).toBe(false);
	});

	it("accepts a single roleless model change", () => {
		expect(isFreshMainSession([{ type: "model_change" }])).toBe(true);
	});

	it("treats an explicit null model-change role like an absent role", () => {
		expect([
			isFreshMainSession([{ type: "model_change", role: null }]),
			isFreshMainSession([{ type: "model_change" }]),
		]).toEqual([true, true]);
	});

	it("rejects an unknown entry type", () => {
		expect(isFreshMainSession([{ type: "custom" }])).toBe(false);
	});
});

describe("entryTypeHistogram", () => {
	it("counts each type in a mixed entry list", () => {
		expect(
			entryTypeHistogram([
				{ type: "model_change" },
				{ type: "message" },
				{ type: "thinking_level_change" },
				{ type: "message" },
				{ type: "thinking_level_change" },
			]),
		).toEqual({ model_change: 1, message: 2, thinking_level_change: 2 });
	});

	it("returns an empty histogram for an empty entry list", () => {
		expect(entryTypeHistogram([])).toEqual({});
	});
});

describe("applySessionDefaultModel", () => {
	it("returns none without making API calls when the spec is null", async () => {
		const api = new FakeSessionApi(new Set(["anthropic/claude-opus-4-8"]));

		await expect(applySessionDefaultModel(null, api)).resolves.toEqual({ status: "none" });
		expect(api.resolveSpecs).toEqual([]);
		expect(api.calls).toEqual([]);
	});

	it("returns unresolved without setting a model when the base cannot resolve", async () => {
		const api = new FakeSessionApi(new Set());

		await expect(applySessionDefaultModel("zzz/missing:high", api)).resolves.toEqual({
			status: "unresolved",
			base: "zzz/missing",
		});
		expect(api.resolveSpecs).toEqual(["zzz/missing"]);
		expect(api.calls).toEqual([]);
	});

	it("returns no-key without setting a thinking level when setModel returns false", async () => {
		const api = new FakeSessionApi(new Set(["anthropic/claude-opus-4-8"]), false);

		await expect(applySessionDefaultModel("anthropic/claude-opus-4-8:high", api)).resolves.toEqual({
			status: "no-key",
			base: "anthropic/claude-opus-4-8",
		});
		expect(api.calls).toEqual([{ fn: "setModel", arg: "anthropic/claude-opus-4-8" }]);
	});

	it("sets the model before its explicit thinking level", async () => {
		const api = new FakeSessionApi(new Set(["anthropic/claude-opus-4-8"]));

		await expect(applySessionDefaultModel("anthropic/claude-opus-4-8:high", api)).resolves.toEqual({
			status: "applied",
			base: "anthropic/claude-opus-4-8",
			effort: "high",
		});
		expect(api.calls).toEqual([
			{ fn: "setModel", arg: "anthropic/claude-opus-4-8" },
			{ fn: "setThinkingLevel", arg: "high" },
		]);
	});

	it("preserves the current thinking level when the spec has no effort", async () => {
		const api = new FakeSessionApi(new Set(["zai/glm-4.5-flash"]));

		await expect(applySessionDefaultModel("zai/glm-4.5-flash", api)).resolves.toEqual({
			status: "applied",
			base: "zai/glm-4.5-flash",
			effort: null,
		});
		expect(api.calls).toEqual([{ fn: "setModel", arg: "zai/glm-4.5-flash" }]);
	});

	it("passes the effort-stripped base spec to resolve", async () => {
		const api = new FakeSessionApi(new Set(["anthropic/claude-opus-4-8"]));

		await applySessionDefaultModel("anthropic/claude-opus-4-8:xhigh", api);

		expect(api.resolveSpecs).toEqual(["anthropic/claude-opus-4-8"]);
	});
});
