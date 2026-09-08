// AC1 + AC2 — real omp integration for a structural preset's session-default model. The parent
// session starts with a deliberately different --model, then session_start must replace it before
// turn 1. A tracer without an explicit entry inherits the same default, while an explicit explore
// entry keeps precedence. Gated behind LSC_E2E=1 because it spends real provider tokens.
//
// audit-2 RF-29 → audit-3 RF-33 — the check-4 failure (same OID as check-3's pass): the
// explore session ran on the preset DEFAULT ('glm-4.5-flash', expected the explicit
// 'glm-5.1' entry) while the parent's own model HAD been replaced to that default — which
// proves the plugin's session_start handler completed, and `applySessionAgentModelOverrides`
// runs synchronously BEFORE `applySessionDefaultModel` in that handler (src/main.ts:56-78),
// so the plugin-side application is not the variable. The two remaining host-side candidates
// are (a) the task spawn targeted an agent name other than the override's exact key
// "lsc-explore" (the marker-identified session would then legitimately inherit the default),
// or (b) omp's task routing missed the runtime #overrides entry.
//
// audit-3 RF-33: RF-29's first precondition authority — the child's own session_init.agent —
// is an OPTIONAL host field (installed session-entries.ts:210-221 `agent?: string`) and was
// deterministically ABSENT in check-5/check-6 (red at :235 twice), so it can never establish
// the precondition on this host. The authority is now the PARENT session file's own recorded
// `task` tool calls (sessionTaskSpawns): the call whose assignment text carries the marker
// must have requested the override-keyed agent — the persisted toolCall block is host schema,
// always written. The parent file must also record the preset's model_change (config-load
// completion). Only on top of BOTH does the override-vs-inheritance model assertion run; a
// failure with the preconditions green IS host-routing-defect evidence, and the failure
// diagnostics preserve the children's raw session_init shapes (bounded) plus the parent task
// call inventory so schema absence and routing defects stay distinguishable.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	E2E_DEFAULT_MODEL,
	E2E_MAIN_MODEL,
	E2E_SUBAGENT_MODEL,
	debugSummary,
	type OmpRunResult,
	presetParentPreconditions,
	runOmpPrint,
	sessionTaskSpawns,
	setupFixtureProject,
	writePresetWithSessionDefault,
} from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";
// This single run spawns two subagents (explore + tracer) sequentially under sync-mode
// (async.enabled=false, blocking spawns) on the cheap E2E model, so its wall-clock has a wide tail:
// observed anywhere from ~100s to past 300s across runs on identical inputs. The budget is sized
// for the slow tail so a merely-slow (not hung) run does not spuriously time out.
const PER_RUN_TIMEOUT_MS = 600_000;
const TEST_TIMEOUT_MS = 660_000;

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

interface ModelIdentity {
	base: string;
	provider: string;
	model: string;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function modelIdentity(spec: string): ModelIdentity {
	const base = spec.split(":", 1)[0];
	const separator = base.indexOf("/");
	if (separator <= 0 || separator === base.length - 1) {
		throw new Error(`E2E model spec must have provider/model[:effort] form, received ${JSON.stringify(spec)}`);
	}
	return { base, provider: base.slice(0, separator), model: base.slice(separator + 1) };
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(part => {
			if (!isJsonObject(part) || part.type !== "text" || typeof part.text !== "string") return "";
			return part.text;
		})
		.join("");
}

function hasFinishedAssistant(stdout: string): boolean {
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event: unknown = JSON.parse(line);
			if (!isJsonObject(event) || event.type !== "message_end" || !isJsonObject(event.message)) continue;
			if (event.message.role === "assistant" && textContent(event.message.content).includes("FINISHED")) return true;
		} catch {
			// Ignore an incomplete trailing line while the child is still streaming.
		}
	}
	return false;
}

function firstAssistantMessage(entries: JsonObject[]): JsonObject | undefined {
	for (const entry of entries) {
		if (entry.type !== "message" || !isJsonObject(entry.message) || entry.message.role !== "assistant") continue;
		return entry.message;
	}
	return undefined;
}

function firstAssistantEventMessage(result: OmpRunResult): JsonObject | undefined {
	for (const event of result.events) {
		if (event.type !== "message_end" || !isJsonObject(event.message) || event.message.role !== "assistant") continue;
		return event.message;
	}
	return undefined;
}

function readJsonl(path: string): JsonObject[] {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map((line, index) => {
			const value: unknown = JSON.parse(line);
			if (!isJsonObject(value)) throw new Error(`${path}:${index + 1} is not a JSON object`);
			return value;
		});
}

function jsonlFilesUnder(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...jsonlFilesUnder(path));
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
	}
	return files;
}

function sessionTask(entries: JsonObject[]): string | undefined {
	const init = entries.find(entry => entry.type === "session_init");
	return init && typeof init.task === "string" ? init.task : undefined;
}

/**
 * audit-3 RF-33 — a bounded, shape-preserving view of a session's RAW session_init entry for
 * failure diagnostics: every field except the huge systemPrompt/tools (summarized by length),
 * strings capped at 200 chars. Preserved in the override assertion's message so a missing
 * optional field (schema absence — session_init.agent is `agent?: string`) stays
 * distinguishable from a genuine host-routing defect when the precondition is green.
 *
 * audit-4 RF-37 ④ — the bound is now TOTAL: non-string fields are JSON-serialized and capped
 * too (a host field carrying an unexpectedly huge object must not flood the failure message).
 */
function sessionInitDiagnostic(entries: JsonObject[], sessionPath: string): string {
	const init = entries.find(entry => entry.type === "session_init");
	if (!init) return `${sessionPath}: <no session_init entry>`;
	const bounded: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(init)) {
		if (key === "systemPrompt" || key === "tools") {
			bounded[key] = `<${typeof value === "string" || Array.isArray(value) ? value.length : "?"} chars omitted>`;
		} else if (typeof value === "string") {
			bounded[key] = value.slice(0, 200);
		} else {
			const serialized = JSON.stringify(value) ?? String(value);
			bounded[key] = serialized.length > 200 ? `${serialized.slice(0, 200)}…(+${serialized.length - 200} chars)` : serialized;
		}
	}
	return `${sessionPath}: ${JSON.stringify(bounded)}`;
}

/**
 * audit-4 RF-37 ④ — cap a diagnostic inventory's ITEM COUNT (default 20) so a runaway
 * session/task list cannot flood a failure message; the elided tail is counted
 * (`…(+N more)`), never dropped silently.
 */
function capInventory(lines: string[], cap = 20): string {
	return lines.length <= cap ? lines.join("\n") : `${lines.slice(0, cap).join("\n")}\n…(+${lines.length - cap} more)`;
}

describe.skipIf(!RUN_E2E)("preset session default E2E (AC1 + AC2)", () => {
	it(
		"applies the preset default to the fresh main session and an unspecified tracer while preserving the explore override",
		async () => {
			const defaultModel = modelIdentity(E2E_DEFAULT_MODEL);
			const mainModel = modelIdentity(E2E_MAIN_MODEL);
			const exploreModel = modelIdentity(E2E_SUBAGENT_MODEL);
			expect(
				defaultModel.base,
				"LSC_E2E_DEFAULT_MODEL base must differ from LSC_E2E_MAIN_MODEL base so AC1 can distinguish the preset default from --model",
			).not.toBe(mainModel.base);
			expect(
				exploreModel.base,
				"LSC_E2E_SUBAGENT_MODEL base must differ from LSC_E2E_DEFAULT_MODEL base so AC2 can distinguish an explicit explore override from inheritance",
			).not.toBe(defaultModel.base);

			const { base, projectDir, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);
			writePresetWithSessionDefault(projectDir, {
				default: E2E_DEFAULT_MODEL,
				agents: { explore: E2E_SUBAGENT_MODEL },
			});

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				prompt:
					"Call the task tool exactly twice, sequentially, with one tasks[] item per call. " +
					"First spawn agent lsc-tracer with task text containing the exact marker TRACER-PING and ask it to return a short acknowledgement. " +
					"Wait for that call to finish. Then spawn agent lsc-explore with task text containing the exact marker EXPLORE-PING and ask it to return a short acknowledgement. " +
					'Wait for that call to finish. After both calls complete, respond with exactly "FINISHED" and do not print FINISHED earlier.',
				earlyExit: hasFinishedAssistant,
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);

			const parentAssistant = firstAssistantEventMessage(result);
			expect(parentAssistant, debugSummary(result)).toBeDefined();
			expect(parentAssistant?.provider, debugSummary(result)).toBe(defaultModel.provider);
			expect(parentAssistant?.model, debugSummary(result)).toBe(defaultModel.model);

			const parentFiles = readdirSync(sessionDir, { withFileTypes: true })
				.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl"))
				.map(entry => join(sessionDir, entry.name));
			expect(parentFiles, `expected one parent session JSONL under ${sessionDir}`).toHaveLength(1);

			const agentDir = parentFiles[0].slice(0, -".jsonl".length);
			expect(existsSync(agentDir), `expected per-agent artifact directory ${agentDir}`).toBe(true);
			const agentSessions = jsonlFilesUnder(agentDir).map(path => ({ path, entries: readJsonl(path) }));
			const tracerSessions = agentSessions.filter(session => sessionTask(session.entries)?.includes("TRACER-PING"));
			const exploreSessions = agentSessions.filter(session => sessionTask(session.entries)?.includes("EXPLORE-PING"));
			const sessionInventory = capInventory(agentSessions.map(session => `${session.path}: ${sessionTask(session.entries) ?? "<no session_init task>"}`));
			expect(tracerSessions, `expected one tracer session marked TRACER-PING\n${sessionInventory}`).toHaveLength(1);
			expect(exploreSessions, `expected one explore session marked EXPLORE-PING\n${sessionInventory}`).toHaveLength(1);

			// audit-2 RF-29 / audit-3 RF-33 / audit-4 RF-37 — the parent-JSONL PRECONDITIONS
			// come FIRST, before EVERY child provider/model assertion below (the tracer
			// inherit pair included): (1) config-load completion observed durably in the parent
			// session file (the model_change the preset's session-default application writes);
			// (2)+(3) routing-source verification — the PARENT session's own recorded `task`
			// calls (the durable, always-written toolCall blocks — sessionTaskSpawns) must show
			// BOTH marker-bound spawns requested the EXACT agents the preset keys its
			// override/inheritance expectations to. The child's session_init.agent is
			// deliberately NOT an authority anymore (optional host field, deterministically
			// absent in check-5/6). A child observed on the preset default is only
			// host-routing-defect evidence once these hold — check-4's explore-on-default red
			// was indistinguishable from a spawn-naming artifact until this ordering, which is
			// why the pure function (e2e-helpers' presetParentPreconditions) carries its own
			// reader-level unit regression with a wrongly-seeded synthetic parent JSONL.
			const parentEntries = readJsonl(parentFiles[0]);
			const parentTaskSpawns = sessionTaskSpawns(parentFiles[0]);
			const parentCallInventory = capInventory(
				parentTaskSpawns.map((spawn, index) => `#${index}: agent=${spawn.agent ?? "<none requested>"} delivered=${spawn.resultDelivered} task=${JSON.stringify(spawn.taskText.slice(0, 160))}`),
			);
			const preconditions = presetParentPreconditions({
				parentEntries,
				parentSpawns: parentTaskSpawns,
				defaultBareModel: defaultModel.model,
				tracerMarker: "TRACER-PING",
				exploreMarker: "EXPLORE-PING",
				tracerAgent: "lsc-tracer",
				exploreAgent: "lsc-explore",
			});
			expect(
				preconditions.ok,
				`parent-session preconditions FAILED — every child provider/model assertion below is unprovable until these hold (audit-4 RF-37 ordering):\n- ${preconditions.failures.join("\n- ")}\n\nparent task calls:\n${parentCallInventory || "<none>"}\n\nagent sessions:\n${sessionInventory}`,
			).toBe(true);

			const tracerAssistant = firstAssistantMessage(tracerSessions[0].entries);
			expect(tracerAssistant, `tracer session has no assistant message\n${sessionInventory}`).toBeDefined();
			expect(
				tracerAssistant?.provider,
				`tracer must inherit preset default provider (preconditions held: config-load model_change observed; parent requested tracer=${preconditions.tracerAgent} explore=${preconditions.exploreAgent})\n${sessionInventory}`,
			).toBe(defaultModel.provider);
			expect(
				tracerAssistant?.model,
				`tracer must inherit preset default bare model id (preconditions held: config-load model_change observed; parent requested tracer=${preconditions.tracerAgent} explore=${preconditions.exploreAgent})\n${sessionInventory}`,
			).toBe(defaultModel.model);

			const exploreAssistant = firstAssistantMessage(exploreSessions[0].entries);
			expect(exploreAssistant, `explore session has no assistant message\n${sessionInventory}`).toBeDefined();
			// The raw session_init shapes of BOTH marker-identified children ride in the failure
			// message (bounded by sessionInitDiagnostic) so a schema absence stays separable from
			// a host-routing defect when this fires with the preconditions green.
			expect(
				exploreAssistant?.model,
				`explicit explore entry must beat preset default (preconditions held: config-load model_change observed; parent task calls requested tracer=${preconditions.tracerAgent} explore=${preconditions.exploreAgent}) — a failure here with the preconditions green is host-side task-routing evidence (runtime #overrides entry missed), NOT a spawn-naming artifact\nraw session_init shapes:\n${sessionInitDiagnostic(tracerSessions[0].entries, tracerSessions[0].path)}\n${sessionInitDiagnostic(exploreSessions[0].entries, exploreSessions[0].path)}\nparent task calls:\n${parentCallInventory}`,
			).toBe(exploreModel.model);
		},
		TEST_TIMEOUT_MS,
	);
});
