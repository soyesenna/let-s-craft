import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerScaffoldTool } from "./artifacts/scaffold.js";
import { registerAskTools } from "./ask.js";
import { registerCraftAbortTool } from "./craft/abort.js";
import { registerCompactionDirective } from "./craft/compact-directive.js";
import { registerCraftEnforcement } from "./craft/enforcement.js";
import { registerHashManifestTools } from "./craft/hash-manifest.js";
import { registerLatencyReportTool } from "./craft/latency-report.js";
import { registerLandTool } from "./craft/land.js";
import { registerCraftReleaseTool } from "./craft/release.js";
import { registerRunTestsTool } from "./craft/run-tests.js";
import { registerAuditValidateTools } from "./craft/verdict.js";
import { registerWatchdog } from "./craft/watchdog.js";
import { LSC_FIXTURE_FLAG } from "./fixtures.js";
import { BUILD_INFO } from "./generated/version.js";
import { registerPresetCommand } from "./preset/command.js";
import { applyActivePreset } from "./preset/inject.js";
import { applySessionDefaultModel, entryTypeHistogram, isFreshMainSession } from "./preset/session-default.js";
import { registerClaimsTool } from "./research/claims-tool.js";
import { registerUsageStatusBar } from "./statusbar/index.js";
import { driftWarning, hashSrcDir, resolvePluginSrcDir } from "./utils/src-hash.js";

export default function (pi: ExtensionAPI): void {
	// Bonus alias for LSC_FIXTURE (fixtures.ts) — the env var is the primary signal
	// (works for any headless invocation without flag wiring); this flag exists for
	// interactive `omp --lsc-fixtures=<path>` invocations.
	pi.registerFlag(LSC_FIXTURE_FLAG, { type: "string", description: "Path to a lets-craft fixture answers.json (bonus alias for LSC_FIXTURE)." });

	registerPresetCommand(pi);
	registerHashManifestTools(pi);
	registerRunTestsTool(pi);
	registerCraftEnforcement(pi);
	registerCompactionDirective(pi);
	registerAskTools(pi);
	registerCraftAbortTool(pi);
	registerCraftReleaseTool(pi);
	registerAuditValidateTools(pi);
	registerLandTool(pi);
	registerScaffoldTool(pi);
	registerClaimsTool(pi);
	registerUsageStatusBar(pi);
	registerWatchdog(pi);
	registerLatencyReportTool(pi);

	// Guards the dist↔src drift banner below to a single warning per process — session_start
	// only fires once per real session in practice, but this is cheap insurance against a
	// duplicate notify if the host ever re-fires it (e.g. a future retry path).
	let driftChecked = false;

	// Re-apply the active model preset on every session start: self-healing from
	// models.yaml into the live session (runtime override, seen by the next task
	// spawn). Never let a malformed models.yaml abort session start.
	pi.on("session_start", async (_event, ctx) => {
		try {
			const result = applyActivePreset({ settings: pi.pi.settings, models: ctx.models, cwd: ctx.cwd });
			const count = Object.keys(result.applied).length;
			if (result.preset && count > 0) {
				ctx.ui.notify(
					`lets-craft: preset "${result.preset}" active (${count} agent override(s), source: ${result.presetSource ?? "unknown"}).`,
					"info",
				);
			}
			for (const warning of result.warnings) ctx.ui.notify(`lets-craft preset: ${warning}`, "warning");

			const entries = ctx.sessionManager.getEntries();
			if (result.defaultSpec !== null && isFreshMainSession(entries)) {
				const outcome = await applySessionDefaultModel(result.defaultSpec, {
					resolve: spec => ctx.models.resolve(spec),
					setModel: model => pi.setModel(model),
					setThinkingLevel: level =>
						pi.setThinkingLevel(level as Parameters<ExtensionAPI["setThinkingLevel"]>[0]),
				});
				if (outcome.status === "applied") {
					const spec = `${outcome.base}${outcome.effort ? `:${outcome.effort}` : ""}`;
					ctx.ui.notify(`lets-craft: session model -> ${spec} (preset "${result.preset}").`, "info");
				} else if (outcome.status !== "none") {
					const reason = outcome.status === "no-key" ? "no API key" : "not resolvable";
					console.warn(`lets-craft preset: session default "${outcome.base}" skipped (${reason}).`);
				}
			} else if (result.defaultSpec !== null && process.env.LSC_DEBUG) {
				console.error(
					`lets-craft: session default gated off — ${JSON.stringify(entryTypeHistogram(entries))}`,
				);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`lets-craft: could not apply model preset — ${message}`, "warning");
		}

		// dist↔src drift banner (QW6): the PLUGIN's own src/ tree present but hashing
		// differently from the dist/ build's recorded fingerprint means a TS edit landed
		// without a rebuild — warn once, never block session start. A missing src/
		// (non-dev install shipping only dist/) skips the check entirely. Anchored to the
		// plugin module's location, never ctx.cwd — a user project's own src/ must not
		// be hashed against BUILD_INFO (that produced bogus stale warnings).
		if (!driftChecked) {
			driftChecked = true;
			try {
				const srcDir = resolvePluginSrcDir();
				if (existsSync(srcDir)) {
					const warning = driftWarning(BUILD_INFO.srcHash, hashSrcDir(srcDir));
					if (warning) ctx.ui.notify(warning, "warning");
				}
			} catch (driftError) {
				if (process.env.LSC_DEBUG) {
					const message = driftError instanceof Error ? driftError.message : String(driftError);
					console.error(`lets-craft: dist/src drift check failed — ${message}`);
				}
			}
		}
	});
}
