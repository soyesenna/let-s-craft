// `/lsc-preset` — interactive management of lets-craft model presets.
//
// Runs in a command context (Principle 4: uses ctx.ui directly, not the fixture
// seam). Reads authenticated models from ctx.models, persists presets to
// models.yaml (global by default, `--project` targets `<cwd>/.lsc/models.yaml`),
// and re-injects the active preset live on switch via pi.pi.settings.
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { applyActivePreset } from "./inject.js";
import {
	LSC_AGENT_NAMES,
	loadEffectiveModelsFile,
	loadModelsFileAt,
	type ModelsFile,
	globalModelsPath,
	projectModelsPath,
	saveModelsFileAt,
	toTaskAgentName,
} from "./models-file.js";
import { EFFORT_LEVELS } from "./validate.js";

const SKIP_LABEL = "(skip — inherit session model)";
const DEFAULT_EFFORT_LABEL = "(default effort)";

type Scope = "global" | "project";

function scopePath(scope: Scope, cwd: string): string {
	return scope === "project" ? projectModelsPath(cwd) : globalModelsPath();
}

/** Build a human-readable summary of the effective preset config. */
function summarize(file: ModelsFile): string {
	const names = Object.keys(file.presets);
	if (names.length === 0) return "lets-craft: no presets defined. Create one with `/lsc-preset create`.";
	const lines = [`lets-craft presets (active: ${file.active ?? "none"})`];
	for (const name of names) {
		const marker = name === file.active ? "*" : " ";
		lines.push(`${marker} ${name}`);
		for (const [agent, spec] of Object.entries(file.presets[name])) {
			lines.push(`    ${agent} -> ${spec}`);
		}
	}
	return lines.join("\n");
}

/** Prompt for one agent's model choice; returns the spec, or null when skipped/cancelled. */
async function pickModelForAgent(
	ctx: ExtensionCommandContext,
	agent: string,
	modelLabels: string[],
): Promise<string | null> {
	const chosen = await ctx.ui.select(`Model for ${agent} (${toTaskAgentName(agent)})`, [SKIP_LABEL, ...modelLabels]);
	if (chosen === undefined || chosen === SKIP_LABEL) return null;
	const effort = await ctx.ui.select(`Effort for ${agent}`, [DEFAULT_EFFORT_LABEL, ...EFFORT_LEVELS]);
	if (effort === undefined || effort === DEFAULT_EFFORT_LABEL) return chosen;
	return `${chosen}:${effort}`;
}

/** Walk the seven agents, building a preset from interactive selections. */
async function buildPreset(
	ctx: ExtensionCommandContext,
	base: Record<string, string>,
): Promise<Record<string, string> | null> {
	const models = ctx.models.list();
	if (models.length === 0) {
		ctx.ui.notify("No authenticated models available. Log in to a provider first.", "error");
		return null;
	}
	const modelLabels = models.map(model => `${model.provider}/${model.id}`).sort();
	const preset: Record<string, string> = {};
	for (const agent of LSC_AGENT_NAMES) {
		const current = base[agent];
		const hint = current ? ` [current: ${current}]` : "";
		const spec = await pickModelForAgent(ctx, `${agent}${hint}`, modelLabels);
		if (spec !== null) preset[agent] = spec;
	}
	return preset;
}

/**
 * Re-resolve the effective active preset (global+project) and re-inject it live.
 * Called after every mutation (switch/create/edit/delete) so the running session
 * never drifts from what models.yaml now says — matching AC2d-live's "no restart
 * needed" contract for more than just the `switch` subcommand.
 */
async function reinject(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const result = applyActivePreset({ settings: pi.pi.settings, models: ctx.models, cwd: ctx.cwd });
	const appliedCount = Object.keys(result.applied).length;
	if (result.preset) {
		ctx.ui.notify(`lets-craft: preset "${result.preset}" active (${appliedCount} agent override(s)).`, "info");
	}
	for (const warning of result.warnings) ctx.ui.notify(warning, "warning");
}

async function runSwitch(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string | undefined, scope: Scope): Promise<void> {
	const effective = loadEffectiveModelsFile(ctx.cwd);
	const names = Object.keys(effective.presets);
	if (names.length === 0) {
		ctx.ui.notify("No presets to switch to. Create one with `/lsc-preset create`.", "warning");
		return;
	}
	const target = name ?? (ctx.hasUI ? await ctx.ui.select("Switch to preset", names) : undefined);
	if (target === undefined) return;
	if (!effective.presets[target]) {
		ctx.ui.notify(`Preset "${target}" does not exist.`, "error");
		return;
	}

	const path = scopePath(scope, ctx.cwd);
	const file = loadModelsFileAt(path);
	file.active = target;
	saveModelsFileAt(path, file);
	ctx.ui.notify(`Switched to preset "${target}" (${scope}).`, "info");
	await reinject(pi, ctx);
}

async function runCreate(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string | undefined, scope: Scope): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("`/lsc-preset create` requires interactive mode.", "error");
		return;
	}
	const presetName = name ?? (await ctx.ui.input("New preset name"));
	if (!presetName) return;
	const preset = await buildPreset(ctx, {});
	if (preset === null) return;

	const path = scopePath(scope, ctx.cwd);
	const file = loadModelsFileAt(path);
	file.presets[presetName] = preset;
	if (!file.active) file.active = presetName;
	saveModelsFileAt(path, file);
	ctx.ui.notify(`Saved preset "${presetName}" (${scope}) with ${Object.keys(preset).length} agent override(s).`, "info");
	await reinject(pi, ctx);
}

async function runEdit(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string | undefined, scope: Scope): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("`/lsc-preset edit` requires interactive mode.", "error");
		return;
	}
	const path = scopePath(scope, ctx.cwd);
	const file = loadModelsFileAt(path);
	const names = Object.keys(file.presets);
	if (names.length === 0) {
		ctx.ui.notify(`No presets to edit in ${scope} models.yaml.`, "warning");
		return;
	}
	const target = name ?? (await ctx.ui.select("Edit preset", names));
	if (target === undefined || !file.presets[target]) return;
	const preset = await buildPreset(ctx, file.presets[target]);
	if (preset === null) return;
	file.presets[target] = preset;
	saveModelsFileAt(path, file);
	ctx.ui.notify(`Updated preset "${target}" (${scope}).`, "info");
	await reinject(pi, ctx);
}

async function runDelete(pi: ExtensionAPI, ctx: ExtensionCommandContext, name: string | undefined, scope: Scope): Promise<void> {
	const path = scopePath(scope, ctx.cwd);
	const file = loadModelsFileAt(path);
	const names = Object.keys(file.presets);
	if (names.length === 0) {
		ctx.ui.notify(`No presets in ${scope} models.yaml.`, "warning");
		return;
	}
	const target = name ?? (ctx.hasUI ? await ctx.ui.select("Delete preset", names) : undefined);
	if (target === undefined || !file.presets[target]) return;
	if (ctx.hasUI && !(await ctx.ui.confirm("Delete preset", `Delete "${target}" from ${scope} models.yaml?`))) return;
	delete file.presets[target];
	const wasActive = file.active === target;
	if (wasActive) file.active = null;
	saveModelsFileAt(path, file);
	ctx.ui.notify(`Deleted preset "${target}" (${scope}).`, "info");
	if (wasActive) await reinject(pi, ctx);
}

/** Register the `/lsc-preset` command. */
export function registerPresetCommand(pi: ExtensionAPI): void {
	pi.registerCommand("lsc-preset", {
		description: "Manage lets-craft model presets (list | switch | create | edit | delete [name] [--project])",
		handler: async (args, ctx) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const scope: Scope = tokens.includes("--project") ? "project" : "global";
			const positional = tokens.filter(token => token !== "--project");
			const sub = positional[0] ?? "list";
			const name = positional[1];

			switch (sub) {
				case "list":
					ctx.ui.notify(summarize(loadEffectiveModelsFile(ctx.cwd)), "info");
					return;
				case "switch":
				case "use":
					await runSwitch(pi, ctx, name, scope);
					return;
				case "create":
				case "new":
					await runCreate(pi, ctx, name, scope);
					return;
				case "edit":
					await runEdit(pi, ctx, name, scope);
					return;
				case "delete":
				case "rm":
					await runDelete(pi, ctx, name, scope);
					return;
				default:
					ctx.ui.notify(`Unknown subcommand "${sub}". Use list | switch | create | edit | delete.`, "error");
			}
		},
	});
}
