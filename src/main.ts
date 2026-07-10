import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerAskTools } from "./ask.js";
import { registerCraftAbortTool } from "./craft/abort.js";
import { registerCraftEnforcement } from "./craft/enforcement.js";
import { registerHashManifestTools } from "./craft/hash-manifest.js";
import { registerRunTestsTool } from "./craft/run-tests.js";
import { LSC_FIXTURE_FLAG } from "./fixtures.js";
import { registerPresetCommand } from "./preset/command.js";
import { applyActivePreset } from "./preset/inject.js";

export default function (pi: ExtensionAPI): void {
	// Bonus alias for LSC_FIXTURE (fixtures.ts) — the env var is the primary signal
	// (works for any headless invocation without flag wiring); this flag exists for
	// interactive `omp --lsc-fixtures=<path>` invocations.
	pi.registerFlag(LSC_FIXTURE_FLAG, { type: "string", description: "Path to a lets-craft fixture answers.json (bonus alias for LSC_FIXTURE)." });

	registerPresetCommand(pi);
	registerHashManifestTools(pi);
	registerRunTestsTool(pi);
	registerCraftEnforcement(pi);
	registerAskTools(pi);
	registerCraftAbortTool(pi);

	// Re-apply the active model preset on every session start: self-healing from
	// models.yaml into the live session (runtime override, seen by the next task
	// spawn). Never let a malformed models.yaml abort session start.
	pi.on("session_start", async (_event, ctx) => {
		try {
			const result = applyActivePreset({ settings: pi.pi.settings, models: ctx.models, cwd: ctx.cwd });
			const count = Object.keys(result.applied).length;
			if (result.preset && count > 0) {
				ctx.ui.notify(`lets-craft: preset "${result.preset}" active (${count} agent override(s)).`, "info");
			}
			for (const warning of result.warnings) ctx.ui.notify(`lets-craft preset: ${warning}`, "warning");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`lets-craft: could not apply model preset — ${message}`, "warning");
		}
	});
}
