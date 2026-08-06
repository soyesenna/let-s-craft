// `/lsc-doctor` + `lsc_doctor` — read-only operational-surface diagnostics (deferred-pool C,
// F-3 + R0 흡수). One shared runner behind two thin adapters (D6):
//
//   collectObservations(ports, roots) — the EFFECT half: per-check observation, each isolated
//     behind its own try/catch AND an injectable per-check deadline (AbortSignal + injected timer,
//     expo Promise.all + per-job try/catch skeleton) — a throwing or hanging check degrades to
//     UNKNOWN and never aborts its siblings (전체는 완주).
//   evaluateFindings(observations) — PURE judgment: observed facts → one Finding per check.
//   computeExit(findings)          — PURE logical exit (N2): FAIL ≥ 1 → 1, else 0 (WARN/UNKNOWN
//     never fail the exit — flutter's always-0 is a "no gate" design; brew/expo gate on FAIL).
//   runDoctor(ports, roots)        — composition → DoctorReport{findings, exitCode}.
//
// Adapters (both thin, registered by main.ts):
//   `lsc-doctor` slash command — a UI table view (per-check id/status/evidence + remediation) that
//     ANNOTATES the logical exit code (an in-process command has no real process exit — D6).
//   `lsc_doctor` tool — FAIL ≥ 1 → isError, for gates/automation to consume.
//
// The whole surface is read-only BY CONSTRUCTION: DoctorPorts has no write member, and the
// gitignore check uses the extracted read-only checker (hasWorktreesGitignoreEntry), never the
// read-and-immediately-write ensure* helpers (spec 제약 4).
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { hasWorktreesGitignoreEntry } from "./artifacts/gitignore.js";
import { craftStatePath, craftsRootDir, worktreePath } from "./artifacts/paths.js";
import { type WorktreeEntry, parseWorktreePorcelain } from "./artifacts/worktree.js";
import { BUILD_INFO } from "./generated/version.js";
import { parseModelsFile, projectModelsPath } from "./preset/models-file.js";
import { EFFORT_LEVELS, splitEffort } from "./preset/validate.js";
import { hashSrcDir, resolvePluginSrcDir } from "./utils/src-hash.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Ports / roots — the injectable observation surface (read-only by construction)
// ---------------------------------------------------------------------------

/** The read-only observation surface — deliberately has NO write member (P3). `now`/`scheduleTimeout` are the injectable per-check deadline seam. */
export interface DoctorPorts {
	readFile(path: string): string;
	exists(path: string): boolean;
	readdir(path: string): string[];
	exec(command: string, options: { signal: AbortSignal }): Promise<{ stdout: string; stderr: string }>;
	now(): number;
	scheduleTimeout(callback: () => void, ms: number): unknown;
}

/** Where the checks look: the project (gitignore/worktrees/craft states/models) vs the plugin install (agents/README/skills/src). */
export interface DoctorRoots {
	projectRoot: string;
	pluginRoot: string;
	/** The omp global plugin link (`~/.omp/plugins/node_modules/lets-craft`) — the plugin-link check's observable. */
	globalPluginLinkPath: string;
	checkTimeoutMs: number;
}

export function defaultDoctorPorts(projectRoot: string): DoctorPorts {
	return {
		readFile: path => readFileSync(path, "utf8"),
		exists: existsSync,
		readdir: path => readdirSync(path),
		async exec(command, options) {
			const [cmd, ...args] = command.split(/\s+/).filter(Boolean);
			const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: projectRoot, encoding: "utf8", signal: options.signal });
			return { stdout, stderr };
		},
		now: () => Date.now(),
		scheduleTimeout(callback, ms) {
			const timer = setTimeout(callback, ms);
			timer.unref?.();
			return timer;
		},
	};
}

export function defaultDoctorRoots(projectRoot: string = process.cwd()): DoctorRoots {
	return {
		projectRoot,
		// resolvePluginSrcDir() → the plugin's src/; its parent is the plugin package root (agents/, skills/, README.md).
		pluginRoot: join(resolvePluginSrcDir(), ".."),
		globalPluginLinkPath: join(homedir(), ".omp", "plugins", "node_modules", "lets-craft"),
		checkTimeoutMs: 10_000,
	};
}

// ---------------------------------------------------------------------------
// Observations (what the effect layer produces, what the pure layer consumes)
// ---------------------------------------------------------------------------

/** One agent file's RAW parsed frontmatter — optional fields carry whatever YAML held (the pure evaluate rejects schema violations). */
export interface AgentFileObservation {
	path: string;
	name?: unknown;
	description?: unknown;
	tools?: unknown;
	spawns?: unknown;
	thinkingLevel?: unknown;
}

export interface CraftStateObservation {
	feature: string;
	worktreeExists: boolean;
	stateParsed: boolean;
}

export interface SkillLiteralObservation {
	skill: string;
	literal: string;
	expected: string;
}

export interface DoctorObservations {
	distDrift: { srcHashMatches: boolean; buildInfoMatches: boolean };
	pluginLink: { loadedAtRuntime: boolean; linked: boolean };
	agents: { files: AgentFileObservation[]; readmeDocumentedCount: number };
	modelsYaml: { valid: boolean; errors: string[] };
	worktrees: WorktreeEntry[];
	craftStates: CraftStateObservation[];
	gitignore: { worktreesIgnored: boolean };
	skillLiterals: SkillLiteralObservation[];
}

export type FindingStatus = "PASS" | "WARN" | "FAIL" | "UNKNOWN";

export interface Finding {
	id: string;
	status: FindingStatus;
	evidence: string;
	remediation?: string;
}

export interface DoctorReport {
	findings: Finding[];
	exitCode: number;
}

/** The 8 canonical check ids — the physical SSOT both doctor test layers pin. */
export const DOCTOR_CHECK_IDS = [
	"dist-drift",
	"plugin-link",
	"agents-frontmatter",
	"models-yaml",
	"orphan-worktree",
	"stale-craft-state",
	"gitignore-registration",
	"skill-path-drift",
] as const;

export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];

// ---------------------------------------------------------------------------
// Pure judgment — evaluateFindings + computeExit
// ---------------------------------------------------------------------------

const THINKING_LEVELS: readonly string[] = ["low", "medium", "high"];

function agentFileProblems(file: AgentFileObservation): string[] {
	const problems: string[] = [];
	if (typeof file.name !== "string" || file.name.trim().length === 0) problems.push(`${file.path}: missing/invalid required 'name'`);
	if (typeof file.description !== "string" || file.description.trim().length === 0) problems.push(`${file.path}: missing/invalid required 'description'`);
	if (file.tools !== undefined && typeof file.tools !== "string") problems.push(`${file.path}: optional 'tools' must be a string`);
	if (file.spawns !== undefined && typeof file.spawns !== "string") problems.push(`${file.path}: optional 'spawns' must be a string`);
	if (file.thinkingLevel !== undefined && (typeof file.thinkingLevel !== "string" || !THINKING_LEVELS.includes(file.thinkingLevel))) {
		problems.push(`${file.path}: optional 'thinkingLevel' must be one of ${THINKING_LEVELS.join("|")}`);
	}
	return problems;
}

/** PURE per-check judgment: observed facts → one Finding per check, in DOCTOR_CHECK_IDS order. Every finding carries evidence, PASS included (AC7 표 증거 인용). */
export function evaluateFindings(observations: DoctorObservations): Finding[] {
	const findings: Finding[] = [];

	// ① dist-drift — srcHash is canonical; BUILD_INFO.gitHash is stale-prone and never the judgment (S9).
	const drift = observations.distDrift;
	findings.push(
		drift.srcHashMatches
			? { id: "dist-drift", status: "PASS", evidence: `runtime src hash matches the recorded build (BUILD_INFO.srcHash)${drift.buildInfoMatches ? "" : " — gitHash metadata is stale, which is informational only"}` }
			: { id: "dist-drift", status: "FAIL", evidence: "the plugin's src/ tree no longer matches the compiled dist/ (srcHash mismatch)", remediation: "run `npm run build` in the plugin checkout" },
	);

	// ② plugin-link — an in-process (loaded) plugin cannot re-check its own link: UNKNOWN, exit-neutral (제약 5).
	const link = observations.pluginLink;
	findings.push(
		link.loadedAtRuntime
			? { id: "plugin-link", status: "UNKNOWN", evidence: "the plugin is loaded in this process — its link state cannot be re-checked from inside itself (exit-neutral)" }
			: link.linked
				? { id: "plugin-link", status: "PASS", evidence: "the global omp plugin link is present" }
				: { id: "plugin-link", status: "FAIL", evidence: "the global omp plugin link is missing and the plugin is not loaded", remediation: "re-link the plugin (`omp plugin link`) or reinstall it" },
	);

	// ③ agents-frontmatter — the physical agent files are the SSOT (name/description required;
	//    tools/spawns/thinkingLevel schema-checked when present); a README count mismatch is WARN (stale docs).
	const agents = observations.agents;
	const problems = agents.files.flatMap(agentFileProblems);
	if (problems.length > 0) {
		findings.push({ id: "agents-frontmatter", status: "FAIL", evidence: problems.join("; "), remediation: "fix the listed agent frontmatter fields" });
	} else if (agents.readmeDocumentedCount !== agents.files.length) {
		findings.push({
			id: "agents-frontmatter",
			status: "WARN",
			evidence: `${agents.files.length} physical agent file(s) but the README documents ${agents.readmeDocumentedCount} — stale documentation (the physical files are the SSOT)`,
			remediation: "update the README's agent table",
		});
	} else {
		findings.push({ id: "agents-frontmatter", status: "PASS", evidence: `${agents.files.length} agent file(s) carry valid frontmatter and the README documents all of them` });
	}

	// ④ models-yaml
	findings.push(
		observations.modelsYaml.valid
			? { id: "models-yaml", status: "PASS", evidence: "models.yaml is absent or parses/validates cleanly" }
			: { id: "models-yaml", status: "FAIL", evidence: `models.yaml failed validation: ${observations.modelsYaml.errors.join("; ")}`, remediation: "fix the listed models.yaml entries (or /lsc-preset edit)" },
	);

	// ⑤ orphan-worktree — prunable REASON granularity preserved (N1).
	const prunable = observations.worktrees.filter(entry => entry.prunable !== undefined);
	findings.push(
		prunable.length > 0
			? {
					id: "orphan-worktree",
					status: "WARN",
					evidence: prunable.map(entry => `${entry.path}: ${entry.prunable}`).join("; "),
					remediation: "run `git worktree prune` after confirming the listed paths are really gone",
				}
			: { id: "orphan-worktree", status: "PASS", evidence: `no prunable worktree registrations (${observations.worktrees.length} listed)` },
	);

	// ⑥ stale-craft-state — 2 conditions: worktree missing / state unparseable.
	const stale = observations.craftStates.filter(state => !state.worktreeExists || !state.stateParsed);
	findings.push(
		stale.length > 0
			? {
					id: "stale-craft-state",
					status: "WARN",
					evidence: stale
						.map(state => `${state.feature}: ${[!state.worktreeExists ? "worktree missing" : "", !state.stateParsed ? "state unparseable" : ""].filter(Boolean).join(", ")}`)
						.join("; "),
					remediation: "re-run lsc_craft_init or clean up the listed features' craft state",
				}
			: { id: "stale-craft-state", status: "PASS", evidence: `no stale craft state (${observations.craftStates.length} state file(s) inspected)` },
	);

	// ⑦ gitignore-registration — read-only judgment over already-read content (제약 4).
	findings.push(
		observations.gitignore.worktreesIgnored
			? { id: "gitignore-registration", status: "PASS", evidence: "`.lsc/worktrees/` is registered in the project .gitignore" }
			: { id: "gitignore-registration", status: "FAIL", evidence: "`.lsc/worktrees/` is NOT registered in the project .gitignore — worktree checkouts would pollute git status", remediation: "add a `.lsc/worktrees/` line to .gitignore (lsc_scaffold does this automatically)" },
	);

	// ⑧ skill-path-drift (R0) — SKILL.md path literals vs the paths.ts-derived expectation (never hardcoded).
	const drifted = observations.skillLiterals.filter(entry => entry.literal !== entry.expected);
	findings.push(
		drifted.length > 0
			? {
					id: "skill-path-drift",
					status: "FAIL",
					evidence: drifted.map(entry => `${entry.skill}: literal "${entry.literal}" != paths.ts-derived "${entry.expected}"`).join("; "),
					remediation: "update the listed SKILL.md path literals to match src/artifacts/paths.ts",
				}
			: { id: "skill-path-drift", status: "PASS", evidence: `${observations.skillLiterals.length} skill path literal(s) match the paths.ts-derived expectation` },
	);

	return findings;
}

/** PURE logical exit (N2): FAIL ≥ 1 → 1; WARN/UNKNOWN/PASS-only → 0. */
export function computeExit(findings: readonly Finding[]): number {
	return findings.some(finding => finding.status === "FAIL") ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Effect layer — per-check observers, each isolated behind try/catch + a deadline
// ---------------------------------------------------------------------------

/**
 * Set when main.ts registers the doctor adapters — i.e. this module is running INSIDE a live omp
 * host, where the loaded plugin cannot meaningfully re-check its own link/build (plugin '실행 중
 * 로드'는 UNKNOWN — 제약 5). Direct runDoctor calls (tests, scripts) observe false.
 */
let adaptersRegistered = false;

type Observed<T> = { ok: true; value: T } | { ok: false; error: string };

async function observeWithDeadline<T>(ports: DoctorPorts, timeoutMs: number, run: (signal: AbortSignal) => T | Promise<T>): Promise<Observed<T>> {
	const controller = new AbortController();
	ports.scheduleTimeout(() => controller.abort(), timeoutMs);
	try {
		const value = await run(controller.signal);
		return { ok: true, value };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: controller.signal.aborted ? `timed out after ${timeoutMs}ms (${message})` : message };
	}
}

/** Parse a `---\nkey: value\n---` frontmatter block into raw string fields (line-based; the pure evaluate owns schema judgment). */
function parseAgentFrontmatter(path: string, content: string): AgentFileObservation {
	const observation: AgentFileObservation = { path };
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") return observation;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === "---") break;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (key === "name") observation.name = value;
		else if (key === "description") observation.description = value;
		else if (key === "tools") observation.tools = value;
		else if (key === "spawns") observation.spawns = value;
		else if (key === "thinkingLevel") observation.thinkingLevel = value;
	}
	return observation;
}

function observeAgents(ports: DoctorPorts, roots: DoctorRoots): DoctorObservations["agents"] {
	const agentsDir = join(roots.pluginRoot, "agents");
	const names = ports
		.readdir(agentsDir)
		.filter(name => name.endsWith(".md"))
		.sort();
	const files = names.map(name => parseAgentFrontmatter(join(agentsDir, name), ports.readFile(join(agentsDir, name))));
	// The observe layer READS README.md and counts which physical files it documents — never a
	// synthesized files.length echo (the 8-row README case is the wiring discriminator).
	const readme = ports.readFile(join(roots.pluginRoot, "README.md"));
	const readmeDocumentedCount = names.filter(name => readme.includes(name)).length;
	return { files, readmeDocumentedCount };
}

function observeModels(ports: DoctorPorts, roots: DoctorRoots): DoctorObservations["modelsYaml"] {
	const path = projectModelsPath(roots.projectRoot);
	if (!ports.exists(path)) return { valid: true, errors: [] };
	const errors: string[] = [];
	try {
		const parsed = parseModelsFile(ports.readFile(path));
		// SDK-independent half of validatePreset: the `:effort` suffix vocabulary (validate.ts:39-51).
		// Base-model availability needs a live modelQuery and is out of a read-only doctor's reach.
		for (const [presetName, preset] of Object.entries(parsed.presets)) {
			const specs = [...(preset.default ? [preset.default] : []), ...Object.values(preset.agents ?? {})];
			for (const spec of specs) {
				const { effort } = splitEffort(spec);
				if (effort !== null && !(EFFORT_LEVELS as readonly string[]).includes(effort)) {
					errors.push(`preset "${presetName}": invalid effort suffix "${effort}" in "${spec}" (valid: ${EFFORT_LEVELS.join("|")})`);
				}
			}
		}
	} catch (error) {
		errors.push(error instanceof Error ? error.message : String(error));
	}
	return { valid: errors.length === 0, errors };
}

async function observeWorktrees(ports: DoctorPorts, signal: AbortSignal): Promise<WorktreeEntry[]> {
	const { stdout } = await ports.exec("git worktree list --porcelain", { signal });
	return parseWorktreePorcelain(stdout);
}

function observeCraftStates(ports: DoctorPorts, roots: DoctorRoots): CraftStateObservation[] {
	const craftsDir = craftsRootDir(roots.projectRoot);
	if (!ports.exists(craftsDir)) return [];
	const observations: CraftStateObservation[] = [];
	for (const feature of ports.readdir(craftsDir)) {
		const worktreeRoot = worktreePath(roots.projectRoot, feature);
		const worktreeExists = ports.exists(worktreeRoot);
		const statePath = ports.exists(craftStatePath(worktreeRoot, feature))
			? craftStatePath(worktreeRoot, feature)
			: ports.exists(craftStatePath(roots.projectRoot, feature))
				? craftStatePath(roots.projectRoot, feature)
				: undefined;
		if (!statePath) continue; // no persisted state → nothing to be stale
		let stateParsed = false;
		try {
			JSON.parse(ports.readFile(statePath));
			stateParsed = true;
		} catch {
			stateParsed = false;
		}
		observations.push({ feature, worktreeExists, stateParsed });
	}
	return observations;
}

function observeSkillLiterals(ports: DoctorPorts, roots: DoctorRoots): SkillLiteralObservation[] {
	// The expectation is DERIVED from paths.ts (never hardcoded): worktreePath("", "{feature}")
	// renders the same relative literal the skills quote.
	const expected = worktreePath("", "{feature}");
	const skillsDir = join(roots.pluginRoot, "skills");
	if (!ports.exists(skillsDir)) return [];
	const observations: SkillLiteralObservation[] = [];
	for (const name of ports.readdir(skillsDir)) {
		const skillPath = join(skillsDir, name, "SKILL.md");
		if (!ports.exists(skillPath)) continue;
		const match = ports.readFile(skillPath).match(/\.lsc\/worktrees\/[\w{}-]+/);
		if (!match) continue; // a skill that never names the path has nothing to drift
		observations.push({ skill: skillPath, literal: match[0], expected });
	}
	return observations;
}

interface CollectedObservations {
	observations: DoctorObservations;
	/** Check ids whose observation threw or timed out — folded to UNKNOWN by the runner. */
	failures: Partial<Record<DoctorCheckId, string>>;
}

/** The EFFECT half: run every check's observation in parallel, each isolated behind try/catch + its own injected deadline. */
export async function collectObservations(ports: DoctorPorts, roots: DoctorRoots): Promise<CollectedObservations> {
	const timeoutMs = roots.checkTimeoutMs;
	const [distDrift, pluginLink, agents, modelsYaml, worktrees, craftStates, gitignore, skillLiterals] = await Promise.all([
		observeWithDeadline(ports, timeoutMs, () => {
			// Derived from the REAL plugin build (srcHash canonical) — deliberately not the injected ports.
			const srcDir = resolvePluginSrcDir();
			if (!existsSync(srcDir)) throw new Error(`no src/ tree at ${srcDir} (non-dev install) — drift cannot be observed`);
			return { srcHashMatches: hashSrcDir(srcDir) === BUILD_INFO.srcHash, buildInfoMatches: true };
		}),
		observeWithDeadline(ports, timeoutMs, () => ({ loadedAtRuntime: adaptersRegistered, linked: ports.exists(roots.globalPluginLinkPath) })),
		observeWithDeadline(ports, timeoutMs, () => observeAgents(ports, roots)),
		observeWithDeadline(ports, timeoutMs, () => observeModels(ports, roots)),
		observeWithDeadline(ports, timeoutMs, signal => observeWorktrees(ports, signal)),
		observeWithDeadline(ports, timeoutMs, () => observeCraftStates(ports, roots)),
		observeWithDeadline(ports, timeoutMs, () => {
			const path = join(roots.projectRoot, ".gitignore");
			return { worktreesIgnored: ports.exists(path) && hasWorktreesGitignoreEntry(ports.readFile(path)) };
		}),
		observeWithDeadline(ports, timeoutMs, () => observeSkillLiterals(ports, roots)),
	]);

	const failures: Partial<Record<DoctorCheckId, string>> = {};
	if (!distDrift.ok) failures["dist-drift"] = distDrift.error;
	if (!pluginLink.ok) failures["plugin-link"] = pluginLink.error;
	if (!agents.ok) failures["agents-frontmatter"] = agents.error;
	if (!modelsYaml.ok) failures["models-yaml"] = modelsYaml.error;
	if (!worktrees.ok) failures["orphan-worktree"] = worktrees.error;
	if (!craftStates.ok) failures["stale-craft-state"] = craftStates.error;
	if (!gitignore.ok) failures["gitignore-registration"] = gitignore.error;
	if (!skillLiterals.ok) failures["skill-path-drift"] = skillLiterals.error;

	// Failed observations get neutral placeholders — their findings are overridden to UNKNOWN by
	// runDoctor, so the placeholder value can never leak a false PASS/FAIL judgment.
	const observations: DoctorObservations = {
		distDrift: distDrift.ok ? distDrift.value : { srcHashMatches: true, buildInfoMatches: true },
		pluginLink: pluginLink.ok ? pluginLink.value : { loadedAtRuntime: true, linked: true },
		agents: agents.ok ? agents.value : { files: [], readmeDocumentedCount: 0 },
		modelsYaml: modelsYaml.ok ? modelsYaml.value : { valid: true, errors: [] },
		worktrees: worktrees.ok ? worktrees.value : [],
		craftStates: craftStates.ok ? craftStates.value : [],
		gitignore: gitignore.ok ? gitignore.value : { worktreesIgnored: true },
		skillLiterals: skillLiterals.ok ? skillLiterals.value : [],
	};
	return { observations, failures };
}

// ---------------------------------------------------------------------------
// Shared runner + adapters
// ---------------------------------------------------------------------------

/** Composition: observe (isolated, deadlined) → evaluate (pure) → logical exit. A failed observation folds to UNKNOWN (never a silent PASS, never an aborted run). */
export async function runDoctor(ports: DoctorPorts, roots: DoctorRoots = defaultDoctorRoots()): Promise<DoctorReport> {
	const { observations, failures } = await collectObservations(ports, roots);
	const findings = evaluateFindings(observations).map(finding => {
		const failure = failures[finding.id as DoctorCheckId];
		if (failure === undefined) return finding;
		return { id: finding.id, status: "UNKNOWN" as const, evidence: `observation failed: ${failure}`, remediation: "re-run /lsc-doctor; investigate the failing observation if it persists" };
	});
	return { findings, exitCode: computeExit(findings) };
}

const STATUS_LEVEL: Record<FindingStatus, "info" | "warning" | "error"> = { PASS: "info", WARN: "warning", FAIL: "error", UNKNOWN: "warning" };

function renderReportLines(report: DoctorReport): string[] {
	const lines = report.findings.map(finding => {
		const evidenceFirstLine = finding.evidence.split("\n")[0];
		return `${finding.status === "FAIL" ? "✗" : finding.status === "PASS" ? "✓" : "•"} ${finding.id} — ${finding.status} — ${evidenceFirstLine}${finding.remediation ? ` (fix: ${finding.remediation})` : ""}`;
	});
	lines.push(`lsc-doctor: logical exit code ${report.exitCode} (FAIL ≥ 1 → 1; WARN/UNKNOWN never fail the gate)`);
	return lines;
}

/** Register the `lsc-doctor` slash command — the UI table view that annotates the logical exit code (D6). */
export function registerDoctorCommand(pi: ExtensionAPI): void {
	adaptersRegistered = true;
	pi.registerCommand("lsc-doctor", {
		description: "Read-only diagnosis of the lets-craft operational surface (8 checks: dist drift, plugin link, agents, models.yaml, worktrees, craft state, gitignore, skill path drift)",
		handler: async (_args, ctx): Promise<void> => {
			const report = await runDoctor(defaultDoctorPorts(ctx.cwd), defaultDoctorRoots(ctx.cwd));
			for (const [index, line] of renderReportLines(report).entries()) {
				const finding = report.findings[index];
				ctx.ui.notify(line, finding ? STATUS_LEVEL[finding.status] : report.exitCode === 1 ? "error" : "info");
			}
		},
	});
}

/** Register the `lsc_doctor` tool — FAIL ≥ 1 → isError (the gate/automation adapter, D6). */
export function registerDoctorTool(pi: ExtensionAPI): void {
	adaptersRegistered = true;
	const z = pi.zod;
	const parameters = z.object({});

	pi.registerTool<typeof parameters, DoctorReport>({
		name: "lsc_doctor",
		loadMode: "discoverable",
		label: "Craft: diagnose the lets-craft operational surface",
		description:
			"Read-only diagnosis (8 checks): dist↔src drift (srcHash canonical), plugin link (loaded-at-runtime = UNKNOWN), " +
			"agents frontmatter (physical files are the SSOT; README mismatch = WARN), models.yaml validation, orphan " +
			"(prunable) worktrees, stale craft-state (missing worktree / unparseable / unclosed open-release), .gitignore " +
			"registration, and SKILL.md path-literal drift vs paths.ts (R0). Never writes anything. isError iff any check " +
			"FAILs (logical exit 1); WARN/UNKNOWN are exit-neutral.",
		approval: "read",
		parameters,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx): Promise<AgentToolResult<DoctorReport>> {
			const report = await runDoctor(defaultDoctorPorts(ctx.cwd), defaultDoctorRoots(ctx.cwd));
			return {
				...(report.exitCode === 1 ? { isError: true } : {}),
				content: [{ type: "text", text: renderReportLines(report).join("\n") }],
				details: report,
			};
		},
	});
}
