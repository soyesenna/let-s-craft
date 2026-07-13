// AC1 + AC2 — real omp integration for a structural preset's session-default model. The parent
// session starts with a deliberately different --model, then session_start must replace it before
// turn 1. A tracer without an explicit entry inherits the same default, while an explicit explore
// entry keeps precedence. Gated behind LSC_E2E=1 because it spends real provider tokens.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	E2E_DEFAULT_MODEL,
	E2E_MAIN_MODEL,
	E2E_SUBAGENT_MODEL,
	debugSummary,
	type OmpRunResult,
	runOmpPrint,
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
			const sessionInventory = agentSessions.map(session => `${session.path}: ${sessionTask(session.entries) ?? "<no session_init task>"}`).join("\n");
			expect(tracerSessions, `expected one tracer session marked TRACER-PING\n${sessionInventory}`).toHaveLength(1);
			expect(exploreSessions, `expected one explore session marked EXPLORE-PING\n${sessionInventory}`).toHaveLength(1);

			const tracerAssistant = firstAssistantMessage(tracerSessions[0].entries);
			expect(tracerAssistant, `tracer session has no assistant message\n${sessionInventory}`).toBeDefined();
			expect(tracerAssistant?.provider, `tracer must inherit preset default provider\n${sessionInventory}`).toBe(defaultModel.provider);
			expect(tracerAssistant?.model, `tracer must inherit preset default bare model id\n${sessionInventory}`).toBe(defaultModel.model);

			const exploreAssistant = firstAssistantMessage(exploreSessions[0].entries);
			expect(exploreAssistant, `explore session has no assistant message\n${sessionInventory}`).toBeDefined();
			expect(exploreAssistant?.model, `explicit explore entry must beat preset default\n${sessionInventory}`).toBe(exploreModel.model);
		},
		TEST_TIMEOUT_MS,
	);
});
