import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerPresetCommand } from "./preset/command.js";
import { applyActivePreset } from "./preset/inject.js";

export default function (pi: ExtensionAPI): void {
	registerPresetCommand(pi);

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
