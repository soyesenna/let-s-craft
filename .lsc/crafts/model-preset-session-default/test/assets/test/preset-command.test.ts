import { describe, expect, it } from "vitest";
import { summarize } from "../src/preset/command.js";
import type { ModelsFile } from "../src/preset/models-file.js";

describe("summarize", () => {
	it("renders a session default before agent overrides", () => {
		const file: ModelsFile = {
			active: "balanced",
			presets: {
				balanced: {
					default: "anthropic/claude-opus-4-8:high",
					agents: {
						explore: "zai/glm-5.2:low",
						tracer: "anthropic/claude-sonnet-4-5:medium",
					},
				},
			},
		};

		expect(summarize(file)).toBe(
			[
				"lets-craft presets (active: balanced)",
				"* balanced",
				"    default -> anthropic/claude-opus-4-8:high",
				"    explore -> zai/glm-5.2:low",
				"    tracer -> anthropic/claude-sonnet-4-5:medium",
			].join("\n"),
		);
	});

	it("renders agent overrides without a default line when the preset has no default", () => {
		const file: ModelsFile = {
			active: "agents-only",
			presets: {
				"agents-only": {
					agents: {
						executor: "anthropic/claude-opus-4-8:high",
						planner: "zai/glm-5.2:low",
					},
				},
			},
		};

		expect(summarize(file)).toBe(
			[
				"lets-craft presets (active: agents-only)",
				"* agents-only",
				"    executor -> anthropic/claude-opus-4-8:high",
				"    planner -> zai/glm-5.2:low",
			].join("\n"),
		);
	});
});
