// Shared harness for Phase 7's real-omp-integration E2E tests (test/e2e-full-cycle.test.ts,
// test/e2e-worktree.test.ts, test/enforcement-rules.test.ts). Spawns the actual `omp` binary
// headlessly (`-p --mode=json`) against a throwaway project directory, with the plugin already
// loaded via `omp plugin link` (a real filesystem symlink to this repo — see package.json's
// `omp.extensions`, confirmed live during harness development). None of this can run under
// plain vitest/Node the way src/*.ts's own unit tests do (Phase 1.5 finding: vitest on Node
// cannot import omp SDK values) — these tests instead drive the real Bun-native `omp` runtime
// as a child process and assert on its `--mode=json` NDJSON event stream and the filesystem
// state it produces, exactly the technique `scripts/spike-e2e-verify.sh` established.
//
// Boundedness (plan §Phase 7 (b)(c)): every helper here defaults to the cheapest authenticated
// model verified reachable during harness development (`zai/glm-4.5-flash:low` — confirmed via
// `omp models list` and used successfully for both the orchestrating main session and every
// lsc-* subagent override in manual smoke runs), and every spawn is wrapped in a hard kill
// timeout so a hung/looping model can never stall `npm run e2e` indefinitely.
import { execFileSync } from "node:child_process";
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { LSC_AGENT_NAMES } from "../src/preset/models-file";

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_SAMPLE_DIR = join(REPO_ROOT, "fixtures", "sample-ts-cli");

/** Cheapest authenticated model verified during harness development (see module header). Overridable for local runs against a different provider. */
export const E2E_MAIN_MODEL = process.env.LSC_E2E_MAIN_MODEL ?? "zai/glm-4.5-flash:low";
export const E2E_SUBAGENT_MODEL = process.env.LSC_E2E_SUBAGENT_MODEL ?? "zai/glm-4.5-flash:low";

export interface OmpEvent {
	type: string;
	[key: string]: unknown;
}

export interface OmpRunResult {
	exitCode: number | null;
	timedOut: boolean;
	stdout: string;
	stderr: string;
	/** Best-effort parse of each NDJSON line from --mode=json. Unparseable lines are skipped, never thrown. */
	events: OmpEvent[];
}

/**
 * Spawn `omp -p --mode=json` against `cwd` with the given prompt, killing it if it runs past
 * `timeoutMs`. Never throws on a non-zero exit or a timeout kill — callers assert on the
 * returned result instead, since a harness-level throw would produce a much less useful vitest
 * failure message than "here is the actual stdout/stderr/exitCode".
 *
 * `earlyExit`, if given, is checked against the accumulated stdout after every chunk; once it
 * returns true the child is killed and the promise resolves immediately with `timedOut: false`
 * (this is a deliberate early stop, not a timeout). This exists for assertions that only need to
 * observe N occurrences of a marker and would otherwise have to wait out the platform's full
 * session_stop continuation cap (up to 8 forced turns) or a multi-minute craft loop before the
 * process exits naturally — discovered necessary when enforcement-rules.test.ts's session_stop
 * and hash-violation cases timed out under multi-process contention (3 E2E files running
 * concurrently rate-limited every turn) even though the behavior being asserted had already
 * happened and was already visible in the stream.
 */
export function runOmpPrint(args: {
	cwd: string;
	prompt: string;
	sessionDir: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	extraArgs?: string[];
	earlyExit?: (accumulatedStdout: string) => boolean;
}): Promise<OmpRunResult> {
	return new Promise(resolve => {
		const ompArgs = [
			"-p",
			"--model",
			args.model ?? E2E_MAIN_MODEL,
			"--mode=json",
			"--no-title",
			"--auto-approve",
			"--session-dir",
			args.sessionDir,
			...(args.extraArgs ?? []),
			args.prompt,
		];

		const child: ChildProcess = spawn("omp", ompArgs, {
			cwd: args.cwd,
			env: { ...process.env, ...args.env },
		});

		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (timedOut: boolean) => {
			if (settled) return;
			settled = true;
			clearTimeout(killTimer);
			resolve({ exitCode: child.exitCode, timedOut, stdout, stderr, events: parseNdjson(stdout) });
			if (!child.killed) child.kill("SIGKILL");
		};

		const killTimer = setTimeout(() => finish(true), args.timeoutMs);

		child.stdout?.on("data", chunk => {
			stdout += chunk.toString();
			if (!settled && args.earlyExit?.(stdout)) finish(false);
		});
		child.stderr?.on("data", chunk => {
			stderr += chunk.toString();
		});

		child.on("close", () => finish(false));
	});
}

function parseNdjson(text: string): OmpEvent[] {
	const events: OmpEvent[] = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			events.push(JSON.parse(trimmed) as OmpEvent);
		} catch {
			// Non-JSON noise (should not normally happen with --mode=json) — skip rather than fail the whole parse.
		}
	}
	return events;
}

/**
 * All `tool_execution_end` events, flattened to the fields these tests actually assert on.
 * `isError` lives at the top level of the event (a sibling of `result`), NOT inside
 * `result` itself — confirmed against a real `--mode=json` transcript during harness
 * development; an earlier version of this helper read `result.isError` (always undefined)
 * and every block/error assertion silently saw `false`.
 */
export function toolExecutions(result: OmpRunResult): Array<{ toolName: string; isError: boolean; text: string }> {
	return result.events
		.filter(e => e.type === "tool_execution_end")
		.map(e => {
			const r = e.result as { content?: Array<{ type: string; text?: string }> } | undefined;
			const text = (r?.content ?? [])
				.map(c => c.text ?? "")
				.join("\n");
			return { toolName: String(e.toolName ?? ""), isError: e.isError === true, text };
		});
}

/** Setup a throwaway git project seeded from fixtures/sample-ts-cli, with fixture answers kept OUTSIDE the repo (sibling dir) so they don't pollute what lsc-explore/git see — matching a real project's shape. Also seeds the cheap-model preset (Task B) as `.lsc/models.yaml`, picked up live by `session_start` (src/main.ts). */
export function setupFixtureProject(): { base: string; projectDir: string; fixtureDir: string; answersPath: string; sessionDir: string } {
	const base = mkdtempSync(join(tmpdir(), "lsc-e2e-"));
	const projectDir = join(base, "project");
	const fixtureDir = join(base, "fixture");
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(fixtureDir, { recursive: true });

	cpSync(FIXTURE_SAMPLE_DIR, projectDir, { recursive: true });
	renameSync(join(projectDir, "answers.json"), join(fixtureDir, "answers.json"));
	renameSync(join(projectDir, "recorded-research.md"), join(fixtureDir, "recorded-research.md"));

	execFileSync("git", ["init", "-q"], { cwd: projectDir });
	execFileSync("git", ["config", "user.email", "lsc-e2e@example.com"], { cwd: projectDir });
	execFileSync("git", ["config", "user.name", "lsc-e2e"], { cwd: projectDir });
	execFileSync("git", ["add", "-A"], { cwd: projectDir });
	execFileSync("git", ["commit", "-q", "-m", "chore: seed sample-ts-cli fixture"], { cwd: projectDir });

	writeCheapModelPreset(projectDir);

	return { base, projectDir, fixtureDir, answersPath: join(fixtureDir, "answers.json"), sessionDir: join(base, "omp-sessions") };
}

/** Task B: `.lsc/models.yaml` preset mapping all 7 lsc-* agents to the cheap E2E subagent model, so `session_start` (src/main.ts's `applyActivePreset`) injects it live into every `task` spawn for the run. */
export function writeCheapModelPreset(projectDir: string, model: string = E2E_SUBAGENT_MODEL): void {
	const presetName = "e2e-cheap";
	const preset: Record<string, string> = {};
	for (const agent of LSC_AGENT_NAMES) preset[agent] = model;
	const path = join(projectDir, ".lsc", "models.yaml");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringify({ active: presetName, presets: { [presetName]: preset } }));
}

/** `.lsc/crafts/*` directory names under a project — used to discover the LLM-derived feature slug rather than hardcoding it (Stage 0 kebab-case derivation is not literally predictable). */
export function listCraftFeatures(projectDir: string): string[] {
	const craftsDir = join(projectDir, ".lsc", "crafts");
	if (!existsSync(craftsDir)) return [];
	return readdirSync(craftsDir, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => e.name);
}

export function readTextIfExists(path: string): string | undefined {
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** Best-effort text extraction from a message's `content` — usually a content-block array (`[{type,text}]`), but some synthetic messages (e.g. session_stop's injected additionalContext) carry a plain string instead. Never throws on an unexpected shape; that would defeat the entire point of a debug helper called from inside `expect()`'s message argument. */
function extractMessageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text")
			.map(c => c.text ?? "")
			.join(" ");
	}
	return "";
}

/** Debug context attached to a failed assertion: last assistant text + tool execution summary, so a failing E2E run is diagnosable from vitest output alone without re-running it. Called unconditionally from every `expect(..., debugSummary(result))` call site (JS evaluates it eagerly regardless of pass/fail) — it must never throw on malformed/partial events, which is exactly what an early-killed (SIGKILL) process can leave behind mid-stream. */
export function debugSummary(result: OmpRunResult): string {
	const lastTexts = result.events
		.filter(e => e.type === "message_end")
		.map(e => e.message as { role?: string; content?: unknown } | undefined)
		.filter((m): m is { role?: string; content?: unknown } => m !== undefined)
		.slice(-4)
		.map(m => `[${m.role}] ${extractMessageText(m.content).slice(0, 400)}`);
	const tools = toolExecutions(result)
		.slice(-15)
		.map(t => `${t.toolName}${t.isError ? " (ERROR)" : ""}: ${t.text.slice(0, 150)}`);
	return [
		`exitCode=${result.exitCode} timedOut=${result.timedOut}`,
		`stderr(tail): ${result.stderr.slice(-500)}`,
		`last tool executions:\n${tools.join("\n")}`,
		`last messages:\n${lastTexts.join("\n")}`,
	].join("\n\n");
}
