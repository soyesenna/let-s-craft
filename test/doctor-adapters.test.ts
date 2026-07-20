// W2-c — production-seam integration for /lsc-doctor + lsc_doctor (deferred-pool AC7 + AC8's
// adapter/isolation/timeout half, plan §6 Step 6, appendix-test-plan W2-c, appendix-pre-mortem P3).
//
// The pure per-check judgment (evaluateFindings + computeExit against crafted observations) is the
// unit tester's domain (W1-d). THIS file owns the shared runner `runDoctor(ports)` and the two thin
// adapters: it captures the ACTUALLY-registered `lsc_doctor` tool + `lsc-doctor` command through an
// SDK-boundary mock `pi` and asserts (a) runDoctor composes observe→evaluate→exit into a
// DoctorReport, (b) a single check throwing or hanging never aborts the rest (per-check try/catch +
// AbortSignal/injected-timer timeout → UNKNOWN, "전체는 완주"), (c) the tool maps FAIL≥1 to isError
// while the command renders a table view, and (d) a diagnosis writes nothing (read-only — the
// DoctorPorts surface has no write function; P3).
//
// PRE-CRAFT / RED EXPECTATION: src/doctor.ts does not exist yet, so this file fails to LOAD
// (import-shaped RED on `../src/doctor`). That RED is the correct test-first outcome
// ("지금은 import-RED 정상"); making it green is craft's job.
//
// DoctorPorts contract (owned here per the test-team split — read-only surface {readFile, exists,
// readdir, exec(cmd,{signal}), now, scheduleTimeout}; no write member by construction, P3):
//   readFile/exists/readdir return plain values (await-compatible either way); exec is async and
//   honors options.signal; scheduleTimeout/now are the injectable per-check deadline seam.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
// NEW MODULE (Step 6) — the import that makes this file import-RED pre-craft.
import { registerDoctorCommand, registerDoctorTool, runDoctor } from "../src/doctor";

// ── DoctorReport boundary schema (validated read, never an inline cast) ───────
const FindingSchema = zod.object({
	id: zod.string(),
	status: zod.enum(["PASS", "WARN", "FAIL", "UNKNOWN"]),
	evidence: zod.string(),
	remediation: zod.string().optional(),
});
const DoctorReportSchema = zod.object({
	findings: zod.array(FindingSchema),
	exitCode: zod.number(),
});

// ── DoctorPorts doubles ──────────────────────────────────────────────────────
interface DoctorPorts {
	readFile(path: string): string;
	exists(path: string): boolean;
	readdir(path: string): string[];
	exec(command: string, options: { signal: AbortSignal }): Promise<{ stdout: string; stderr: string }>;
	now(): number;
	scheduleTimeout(callback: () => void, ms: number): unknown;
}

// ── genuinely-healthy fixture (resolves critic C2 / architect rec 4) ──────────
// The old benignPorts returned empty/absent for every observation. Fed through observe→evaluate that
// is NOT benign: an empty .gitignore → worktreesIgnored:false → gitignore-registration FAIL, and no
// agent frontmatter → agents-frontmatter FAIL (doctor-evaluate.test.ts pins both). Asserting "no FAIL +
// exit 0" on that input directly contradicted the pure layer. healthyPorts() instead returns a genuinely
// healthy repo shape — the same one doctor-evaluate.test.ts's healthy() models — so a no-FAIL / exit-0
// outcome is LEGITIMATELY earned and the two layers agree on the same observation.
//
// dist-drift is deliberately NOT modelled here: the doctor derives it from the real plugin build
// (hashSrcDir(resolvePluginSrcDir()) vs BUILD_INFO — src/utils/src-hash.ts), never the injected ports.
// So the runner tests below assert dist-drift only through the exit-consistency rule, never a fixed value.

/** The 8 canonical check ids (physical SSOT — plan Step 6 / doctor-evaluate.test.ts). Both doctor test
 * files pin this exact set, so a dropped, renamed, or extra check is caught in either layer. */
const CHECK_IDS = [
	"dist-drift",
	"plugin-link",
	"agents-frontmatter",
	"models-yaml",
	"orphan-worktree",
	"stale-craft-state",
	"gitignore-registration",
	"skill-path-drift",
] as const;

function statusById(report: { findings: Array<{ id: string; status: string }> }): Map<string, string> {
	return new Map(report.findings.map(finding => [finding.id, finding.status]));
}

const HEALTHY_GITIGNORE = "node_modules\ndist\n.lsc/worktrees/\n"; // registered → worktreesIgnored:true → PASS
const HEALTHY_MODELS = "active: null\npresets: {}\n"; // parseModelsFile-valid (models-file.ts) → models-yaml PASS
const HEALTHY_SKILL = "# pre-craft\n\nworktree root is `.lsc/worktrees/{feature}` (paths.ts SSOT).\n"; // literal matches → skill-path-drift PASS

// Clean `git worktree list --porcelain`: a main + one feature worktree, no `prunable` line → no orphan.
const HEALTHY_WORKTREE_PORCELAIN = [
	"worktree /srv/proj",
	"HEAD 1111111111111111111111111111111111111111",
	"branch refs/heads/main",
	"",
	"worktree /srv/proj/.lsc/worktrees/live",
	"HEAD 2222222222222222222222222222222222222222",
	"branch refs/heads/lets-craft/live",
	"",
].join("\n");

/** Minimal valid agent frontmatter — name + description required (SSOT); optional block appended verbatim. */
function agentFrontmatter(name: string, description: string, optional: string | null): string {
	const lines = ["---", `name: ${name}`, `description: ${description}`];
	if (optional) lines.push(optional);
	lines.push("---", "");
	return lines.join("\n");
}

// The physical 9-agent SSOT (spec §C 제약 5) — a mix carry optional tools/spawns/thinkingLevel, a mix none.
const AGENT_FRONTMATTER: Record<string, string> = {
	"lsc-explore.md": agentFrontmatter("lsc-explore", "read-only search specialist", "tools: read, grep, glob, bash, lsp"),
	"lsc-executor.md": agentFrontmatter("lsc-executor", "focused task executor", "spawns: lsc-explore, lsc-architect"),
	"lsc-critic.md": agentFrontmatter("lsc-critic", "reviews a plan/diff for flaws", "tools: read, grep, glob, bash, lsp"),
	"lsc-critic-recheck.md": agentFrontmatter("lsc-critic-recheck", "diff-only AWC re-check", "tools: read, grep, glob\nthinkingLevel: medium"),
	"lsc-architect.md": agentFrontmatter("lsc-architect", "architecture + debugging advisor", "tools: read, grep, glob\nspawns: lsc-critic"),
	"lsc-planner.md": agentFrontmatter("lsc-planner", "spec into an actionable plan", "tools: read, write, edit\nspawns: lsc-explore"),
	"lsc-librarian.md": agentFrontmatter("lsc-librarian", "external library/API research", "tools: read, grep, glob, web_search"),
	"lsc-tracer.md": agentFrontmatter("lsc-tracer", "causal why-tracer", null),
	"lsc-test-engineer.md": agentFrontmatter("lsc-test-engineer", "test strategy + TDD enforcement", null),
};
const AGENT_FILENAMES = Object.keys(AGENT_FRONTMATTER);

/** A README agent table documenting exactly the given agent files (name = filename sans .md). The
 * doctor's observe layer READS README.md and derives readmeDocumentedCount from it; a table missing a
 * row is the observe-wiring discriminator (a synthesized readmeDocumentedCount = files.length ignores it). */
function agentReadmeTable(filenames: string[]): string {
	const rows = filenames.map(file => `| \`${file.replace(/\.md$/, "")}\` | \`${file}\` | documented |`);
	return ["# Agents", "", "| Agent | File | Status |", "| --- | --- | --- |", ...rows, ""].join("\n");
}

function healthyReadFile(path: string): string {
	if (path.endsWith(".gitignore")) return HEALTHY_GITIGNORE;
	if (path.endsWith("models.yaml")) return HEALTHY_MODELS;
	if (path.endsWith("SKILL.md")) return HEALTHY_SKILL;
	if (path.endsWith("README.md")) return agentReadmeTable(AGENT_FILENAMES); // 9-agent doc table → readmeDocumentedCount 9
	const base = path.split("/").pop() ?? "";
	return AGENT_FRONTMATTER[base] ?? "";
}

/** Genuinely-healthy ports: every observation resolves to a healthy repo shape (registered gitignore, 9
 * valid agents, valid models.yaml, matching skill literal, clean worktree list, no stale craft-state,
 * linked plugin). `overrides` degrade exactly one port — usually scoped to a single path or command — to
 * drive an isolation/timeout case while leaving every other check healthy. scheduleTimeout never fires by
 * default, so no check ever times out unless a test opts in. */
function healthyPorts(overrides: Partial<DoctorPorts> = {}): DoctorPorts {
	return {
		readFile: healthyReadFile,
		exists: () => true,
		readdir: (path: string) => (/(^|\/)agents\/?$/.test(path) ? [...AGENT_FILENAMES] : []),
		exec: (command: string) => Promise.resolve(/worktree\s+list/.test(command) ? { stdout: HEALTHY_WORKTREE_PORCELAIN, stderr: "" } : { stdout: "", stderr: "" }),
		now: () => 0,
		scheduleTimeout: () => 0,
		...overrides,
	};
}

// ── SDK-boundary registrar doubles ───────────────────────────────────────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}
type ToolExecute = (toolCallId: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<ToolResultLike>;
type CommandHandler = (args: string, ctx: CommandCtx) => Promise<void>;
interface Notification {
	text: string;
	level: string;
}
interface CommandCtx {
	cwd: string;
	ui: { notify(text: string, level: string): void };
}

function hasStringName(value: unknown): value is { name: string } {
	return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}
function hasExecute(value: unknown): value is { execute: ToolExecute } {
	return typeof value === "object" && value !== null && "execute" in value && typeof value.execute === "function";
}
function hasHandler(value: unknown): value is { handler: CommandHandler } {
	return typeof value === "object" && value !== null && "handler" in value && typeof value.handler === "function";
}

interface Adapters {
	tool: ToolExecute;
	command: CommandHandler;
}

/** Register both doctor adapters through a mock `pi`, capturing the tool execute + command handler. */
function captureAdapters(): Adapters {
	let tool: ToolExecute | undefined;
	let command: CommandHandler | undefined;
	const pi = {
		zod,
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (hasStringName(definition) && definition.name === "lsc_doctor" && hasExecute(definition)) tool = definition.execute;
		},
		registerCommand(name: string, definition: unknown): void {
			if (name === "lsc-doctor" && hasHandler(definition)) command = definition.handler;
		},
	};
	const api = pi as unknown as Parameters<typeof registerDoctorTool>[0];
	registerDoctorTool(api);
	registerDoctorCommand(api as unknown as Parameters<typeof registerDoctorCommand>[0]);
	if (!tool) throw new Error("registerDoctorTool did not register an lsc_doctor tool with an execute");
	if (!command) throw new Error("registerDoctorCommand did not register an lsc-doctor command with a handler");
	return { tool, command };
}

function textOf(result: ToolResultLike): string {
	const first = result.content?.[0];
	if (first && typeof first === "object" && "text" in first && typeof first.text === "string") return first.text;
	throw new Error("expected the first tool-result content item to be text");
}

// ── read-only fixture + content hash ─────────────────────────────────────────
const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
});

afterEach(() => {
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-doctor-"));
	tempDirs.push(dir);
	return dir;
}

/** Deterministic content+structure hash of a directory tree — the read-only "no diagnosis writes" oracle. */
function hashDir(dir: string): string {
	const h = createHash("sha256");
	const walk = (current: string): void => {
		for (const name of readdirSync(current).sort()) {
			const entry = join(current, name);
			const stat = lstatSync(entry);
			h.update(`${name}:${stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : "f"}`);
			if (stat.isDirectory()) walk(entry);
			else if (stat.isSymbolicLink()) h.update(readlinkSync(entry));
			else h.update(readFileSync(entry));
		}
	};
	walk(dir);
	return h.digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════
// runDoctor(ports) — shared runner: observe/evaluate composition, isolation, timeout
// ═══════════════════════════════════════════════════════════════════════════
describe("runDoctor — shared runner (observe/evaluate split + isolation + timeout)", () => {
	it("composes a DoctorReport over the exact 8-check SSOT with a numeric logical exitCode", async () => {
		const report = DoctorReportSchema.parse(await runDoctor(healthyPorts()));

		// Exact check-id SET (not a count): a dropped, renamed, or extra check is caught here and in
		// doctor-evaluate.test.ts — both layers pin the same physical SSOT.
		expect([...statusById(report).keys()].sort()).toEqual([...CHECK_IDS].sort());
		for (const finding of report.findings) {
			expect(finding.evidence.length, "each finding cites its judgment evidence (AC7 표 증거 인용)").toBeGreaterThan(0);
		}

		// A genuinely-healthy repo shape earns no FAIL on the ports-observable checks — legitimately (C2),
		// not because the fixture was empty. Same judgment doctor-evaluate.test.ts's healthy() makes.
		const status = statusById(report);
		expect(status.get("gitignore-registration"), "a registered .gitignore PASSes (C2 core)").toBe("PASS");
		expect(status.get("models-yaml"), "a parseable models.yaml PASSes").toBe("PASS");
		expect(status.get("skill-path-drift"), "a matching skill literal PASSes").toBe("PASS");
		expect(status.get("orphan-worktree"), "a clean worktree list (no prunable) PASSes").toBe("PASS");
		expect(status.get("stale-craft-state"), "no craft states → nothing stale → PASS").toBe("PASS");
		expect(status.get("agents-frontmatter"), "9 valid agents all documented in the README → PASS (observe reads the README)").toBe("PASS");
		expect(status.get("plugin-link"), "a linked plugin → never FAIL").not.toBe("FAIL");

		// Logical exit mirrors FAIL presence (N2) — the composition contract, robust to dist-drift's real
		// (build-derived) value, which the fixture deliberately does not force.
		expect(report.exitCode).toBe(report.findings.some(finding => finding.status === "FAIL") ? 1 : 0);
	});

	it("isolates a single throwing check: only its finding degrades, the other 7 keep their status", async () => {
		const baseline = statusById(DoctorReportSchema.parse(await runDoctor(healthyPorts())));
		// Fault ONE path (models.yaml): its read throws, every other check is untouched.
		const faulted = statusById(
			DoctorReportSchema.parse(
				await runDoctor(
					healthyPorts({
						readFile: (path: string) => {
							if (path.endsWith("models.yaml")) throw new Error("simulated read explosion in the models check");
							return healthyReadFile(path);
						},
					}),
				),
			),
		);

		// The run still produces every check — no sibling dropped because one threw.
		expect([...faulted.keys()].sort()).toEqual([...CHECK_IDS].sort());
		// The faulted check degrades (a thrown observation → UNKNOWN/FAIL, never a silent PASS)...
		expect(["UNKNOWN", "FAIL"]).toContain(faulted.get("models-yaml"));
		expect(faulted.get("models-yaml"), "the faulted check must change from its healthy status").not.toBe(baseline.get("models-yaml"));
		// ...and every OTHER check keeps its EXACT baseline status (compared by id, never by array length).
		for (const id of CHECK_IDS) {
			if (id === "models-yaml") continue;
			expect(faulted.get(id), `${id} must be unchanged when a sibling check throws`).toBe(baseline.get(id));
		}
	});

	it("times out a hung check → UNKNOWN, the run completes, and the other 7 keep their status", { timeout: 5000 }, async () => {
		const baseline = statusById(DoctorReportSchema.parse(await runDoctor(healthyPorts())));
		const timedOut = statusById(
			DoctorReportSchema.parse(
				await runDoctor(
					healthyPorts({
						// Only the `git worktree list` exec (orphan-worktree, the sole exec-based check) hangs — it
						// settles only when the injected deadline aborts its signal (handling an already-aborted signal
						// so it can never dangle).
						exec: (command: string, options: { signal: AbortSignal }) => {
							if (!/worktree\s+list/.test(command)) return Promise.resolve({ stdout: "", stderr: "" });
							const { promise, reject } = Promise.withResolvers<{ stdout: string; stderr: string }>();
							if (options.signal.aborted) reject(new Error("aborted by per-check deadline"));
							else options.signal.addEventListener("abort", () => reject(new Error("aborted by per-check deadline")));
							return promise;
						},
						// The per-check deadline elapses immediately and deterministically (the injected timer seam — no
						// wall-clock timer): the hung exec is aborted → UNKNOWN, while every synchronous check has already
						// produced its finding and is unaffected by the abort of its own (unawaited) signal.
						scheduleTimeout: (callback: () => void) => {
							callback();
							return 0;
						},
					}),
				),
			),
		);

		expect([...timedOut.keys()].sort()).toEqual([...CHECK_IDS].sort());
		expect(timedOut.get("orphan-worktree"), "a hung check must degrade to UNKNOWN, never hang the run").toBe("UNKNOWN");
		for (const id of CHECK_IDS) {
			if (id === "orphan-worktree") continue;
			expect(timedOut.get(id), `${id} must be unchanged when a sibling check times out`).toBe(baseline.get(id));
		}
	});

	it("an 8-row README (one agent left undocumented) → agents-frontmatter WARN (observe reads the README, not a synthesized count)", async () => {
		// Drop ONE agent's row from the README table while all 9 agent files stay valid on disk. A correct
		// observe layer READS README.md and counts 8 documented vs 9 present → WARN. An impl that synthesizes
		// readmeDocumentedCount = files.length would wrongly report PASS — this case is the observe-wiring oracle.
		const eightRowReadme = agentReadmeTable(AGENT_FILENAMES.slice(0, 8));
		const report = DoctorReportSchema.parse(
			await runDoctor(
				healthyPorts({
					readFile: (path: string) => (path.endsWith("README.md") ? eightRowReadme : healthyReadFile(path)),
				}),
			),
		);
		const status = statusById(report);
		expect(status.get("agents-frontmatter"), "8/9 agents documented in the README → WARN, not PASS").toBe("WARN");
		// A documentation shortfall is a WARN, never a hard FAIL, and never aborts the rest of the run.
		expect([...status.keys()].sort()).toEqual([...CHECK_IDS].sort());
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Adapters — lsc_doctor tool (FAIL≥1 → isError) + lsc-doctor command (UI table view)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_doctor / lsc-doctor — thin adapters over runDoctor", () => {
	it("registers both a lsc_doctor tool and a lsc-doctor command", () => {
		const adapters = captureAdapters();
		expect(typeof adapters.tool).toBe("function");
		expect(typeof adapters.command).toBe("function");
	});

	it("lsc_doctor maps FAIL≥1 to isError exactly (relational invariant over any project state)", async () => {
		const adapters = captureAdapters();
		const result = await adapters.tool("tc", {}, undefined, undefined, { cwd: tmpProject(), hasUI: true });
		const report = DoctorReportSchema.parse(result.details);
		const anyFail = report.findings.some(finding => finding.status === "FAIL");
		// The tool's isError tracks FAIL presence, and the logical exitCode mirrors it (D6/N2).
		expect(Boolean(result.isError)).toBe(anyFail);
		expect(report.exitCode).toBe(anyFail ? 1 : 0);
	});

	it("lsc_doctor sets isError when a real project has a FAIL (an unregistered .gitignore)", async () => {
		const adapters = captureAdapters();
		const project = tmpProject();
		// A real .gitignore missing the `.lsc/worktrees/` entry → gitignore-registration FAIL (read at cwd).
		writeFileSync(join(project, ".gitignore"), "node_modules\n");

		const result = await adapters.tool("tc", {}, undefined, undefined, { cwd: project, hasUI: true });
		const report = DoctorReportSchema.parse(result.details);

		expect(report.findings.some(finding => finding.id === "gitignore-registration" && finding.status === "FAIL"), "an unregistered .gitignore must FAIL").toBe(true);
		expect(Boolean(result.isError), "any FAIL → isError").toBe(true);
		expect(report.exitCode).toBe(1);
	});

	it("lsc-doctor command renders a per-check table (id + status + evidence) and the logical exit code", async () => {
		const adapters = captureAdapters();
		const project = tmpProject();

		// The tool's `details` is the authoritative DoctorReport for this project; the command renders the
		// SAME findings (both run runDoctor over the same read-only cwd → identical observations).
		const toolResult = await adapters.tool("tc", {}, undefined, undefined, { cwd: project, hasUI: true });
		const report = DoctorReportSchema.parse(toolResult.details);

		const notifications: Notification[] = [];
		const ctx: CommandCtx = { cwd: project, ui: { notify: (text, level) => notifications.push({ text, level }) } };
		await expect(adapters.command("", ctx)).resolves.toBeUndefined();
		expect(notifications.length, "the command view must emit output").toBeGreaterThan(0);
		const rendered = notifications.map(entry => entry.text).join("\n");

		// Every check contributes a row citing its id, status token, and evidence (spec:89 검사별 id/status/증거).
		expect(report.findings.length, "the command must render all 8 checks").toBe(CHECK_IDS.length);
		for (const finding of report.findings) {
			expect(rendered, `table must show a row for ${finding.id}`).toContain(finding.id);
			expect(rendered, `${finding.id} row must show its status`).toContain(finding.status);
			expect(finding.evidence.length, `${finding.id} must carry evidence`).toBeGreaterThan(0);
			expect(rendered, `${finding.id} row must cite its evidence`).toContain(finding.evidence.split("\n")[0]);
		}

		// The view annotates the CORRECT logical exit code (D6 — FAIL⇒1 / else 0); the exit VALUE itself is
		// authoritatively covered by runDoctor(...).exitCode in the runner suite above.
		expect(report.exitCode).toBe(report.findings.some(finding => finding.status === "FAIL") ? 1 : 0);
		expect(rendered, "the slash command view must display the logical exit code (AC7 논리 exitCode 표기)").toMatch(new RegExp(`exit\\s*(code)?\\W*${report.exitCode}\\b`, "i"));
	});

	it("is read-only: a diagnosis leaves the project tree byte-for-byte unchanged (AC7)", async () => {
		const adapters = captureAdapters();
		const project = tmpProject();
		// Seed a few files the checks would inspect; none must change.
		mkdirSync(join(project, ".lsc"), { recursive: true });
		writeFileSync(join(project, ".gitignore"), "node_modules\n");
		writeFileSync(join(project, ".lsc", "models.yaml"), "presets: []\n");

		const before = hashDir(project);
		await adapters.tool("tc", {}, undefined, undefined, { cwd: project, hasUI: true });
		expect(hashDir(project), "doctor must never write during a diagnosis (read-only checker, no ensure* calls)").toBe(before);
	});
});
