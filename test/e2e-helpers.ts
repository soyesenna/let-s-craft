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
// Boundedness (plan §Phase 7 (b)(c)): every spawn is wrapped in a hard kill timeout so a
// hung/looping model can never stall `npm run e2e` indefinitely. Both the main-session model and
// the lsc-* subagent model (applied via the .lsc/models.yaml preset setupFixtureProject() seeds)
// were raised a tier from the original cheapest pick (`zai/glm-4.5-flash:low`), each from
// separate real-run evidence: the main session struggled to reliably follow pre-craft/craft/
// post-craft's long SKILL.md instructions (repeating the same lsc_ask question 3 times,
// misreading a subagent's JSON result and attempting to `read` a file that was never written,
// several `lsc_select` fixture-matching failures). The subagent tier struggled specifically as
// `lsc-executor`: a first attempt failed outright after ~26 minutes on a small, well-specified
// bug fix, and a second attempt modified a protected test file instead of fixing the
// implementation (the real trigger for the hash-violation deadlock Fix 1 above addresses) rather
// than admit it couldn't solve the task. Both E2E_MAIN_MODEL and E2E_SUBAGENT_MODEL are now
// `zai/glm-5.2` (same authenticated provider, same low-cost intent, confirmed via `omp models
// list`) — same model for both roles per explicit user direction, still on the `:low` effort tier
// (glm-5.2 supports minimal/low/medium/high/xhigh).
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

// `task` spawns run as background jobs by default (`async.enabled = true`, confirmed via
// `omp config list`): the orchestrating model gets a job handle back immediately and has to
// poll a separate `job` tool ("## Still Running (1)" / "Spawned agent ... result delivered
// when it yields") until the subagent finishes, rather than the `task` call itself blocking
// until the result is ready. Under a cheap/fast model this polling burns real wall-clock time
// for no benefit in a headless, single-threaded E2E harness that has nothing else to do while
// waiting — found to be the actual reason full-cycle pre-craft ran out of its stage budget
// mid-consensus-loop despite otherwise making valid progress. `--config <overlay>` (repeatable,
// documented in `omp --help`) loads an extra config.yml-style layer for the run; empirically
// confirmed (before/after smoke comparison during harness development) that `async: {enabled:
// false}` makes every `task` call block synchronously — zero `job` tool calls, zero "Still
// Running" text, vs. 2 job-poll calls / 10 "Still Running"/"Spawned agent" occurrences for the
// same single-subagent prompt with the default. Written once per process (content is static,
// no per-test isolation needed) and reused by every runOmpPrint call below.
let cachedSyncModeConfigPath: string | undefined;
function syncModeConfigPath(): string {
	if (!cachedSyncModeConfigPath) {
		const dir = mkdtempSync(join(tmpdir(), "lsc-e2e-config-"));
		const path = join(dir, "sync-mode.yml");
		writeFileSync(path, "async:\n  enabled: false\n");
		cachedSyncModeConfigPath = path;
	}
	return cachedSyncModeConfigPath;
}

/** Authenticated zai-provider model (see module header for why both main and subagent moved off the very cheapest tier) — confirmed via `omp models list` (zai/glm-5.2, 1M context, effort levels minimal/low/medium/high/xhigh, so `:low` is supported). Overridable for local runs against a different provider. */
export const E2E_MAIN_MODEL = process.env.LSC_E2E_MAIN_MODEL ?? "zai/glm-5.2:low";
export const E2E_SUBAGENT_MODEL = process.env.LSC_E2E_SUBAGENT_MODEL ?? "zai/glm-5.2:low";

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

// 32MB rolling-tail cap for accumulated stdout/stderr text. Discovered necessary from an actual
// ~51-minute worktree E2E run: every test assertion had already passed, but the harness itself
// crashed afterward with `RangeError: Invalid string length` at the `stdout += chunk.toString()`
// line — the raw `--mode=json` transcript of a run that long, with several subagent spawns each
// echoing their own JSON event stream, grew past V8's max string length. Both earlyExit matching
// and debugSummary only ever need the most recent tail of output (the behavior being asserted on,
// or the last few messages/tool calls before a failure), never the full multi-hour transcript, so
// truncating the head is safe. Exported (with an explicit `maxBytes` parameter, not hardcoded) so
// the truncation behavior itself can be unit tested with a small cap instead of megabytes of data.
export const MAX_BUFFERED_OUTPUT_BYTES = 32 * 1024 * 1024;

// Grace window after an `earlyExit` match before the child is actually killed and the promise
// settles. Found necessary from a real enforcement-rules.test.ts failure: the blocked write's own
// error text ("hash protection") legitimately appeared in the accumulated stdout (the enforcement
// worked), but `earlyExit` fired and killed the child mid-chunk, before the NDJSON line carrying
// that `tool_execution_end` event had been terminated by its trailing newline — `parseNdjson`
// splits on "\n" and silently drops an unterminated trailing line, so `toolExecutions(result)`
// came back without the very `write` call the test was asserting on. 1200ms is comfortably inside
// a single `write()` syscall's flush latency on a local pipe (typically sub-millisecond to a few
// ms) while staying negligible against the multi-second-per-turn real-model runs these tests
// already budget for.
export const EARLY_EXIT_DRAIN_MS = 1200;

/** Append `chunk` to `current`, keeping only the trailing `maxBytes` characters if the result would exceed it. See MAX_BUFFERED_OUTPUT_BYTES for why this exists. */
export function appendBounded(current: string, chunk: string, maxBytes: number): string {
	const next = current + chunk;
	return next.length > maxBytes ? next.slice(next.length - maxBytes) : next;
}

/** A minimal Node-`EventEmitter`-shaped stream — just the two methods `attachOmpRunHandlers` actually calls. Satisfied by a real `ChildProcess`'s `stdout`/`stderr` (a `Readable`, which is an `EventEmitter`) or, in tests, a plain `node:events` `EventEmitter` double. */
export interface DataEmitter {
	on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
	removeListener(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

/**
 * The minimal shape `attachOmpRunHandlers` needs from a child process — satisfied by a real
 * `ChildProcess` (from `spawn`) or, in tests, a plain `EventEmitter`-based double. Kept separate
 * from `node:child_process`'s own types so tests never need to construct or mock a real
 * `ChildProcess`.
 */
export interface RunnableChild {
	stdout: DataEmitter | null;
	stderr: DataEmitter | null;
	on(event: "close", listener: () => void): unknown;
	kill(signal?: string): unknown;
	readonly killed: boolean;
	readonly exitCode: number | null;
}

/**
 * Wires stdout/stderr accumulation, the timeout kill, `earlyExit`, and settle-once resolution for
 * a spawned `omp` process. Extracted out of `runOmpPrint` so this — the part that actually had the
 * bug — is directly unit-testable against a fake `RunnableChild` double, without needing to spawn
 * a real process. **On settle** (natural close, timeout, or `earlyExit` after its drain grace —
 * see EARLY_EXIT_DRAIN_MS), the stdout/stderr `data` listeners are removed via `removeListener` —
 * the actual fix for the crash: the previous version kept `stdout += chunk.toString()` running
 * forever after the promise had already resolved, since `finish()` only guarded the early-exit
 * *check*, never the append itself or the listener that triggered it. A SIGKILL child can still
 * emit buffered trailing chunks for a while as OS pipes drain; without listener removal, those
 * chunks kept accumulating into an already-resolved (and therefore never read again) string,
 * purely wasting memory until it crashed the process.
 */
export function attachOmpRunHandlers(
	child: RunnableChild,
	args: {
		timeoutMs: number;
		earlyExit?: (accumulatedStdout: string) => boolean;
		maxBufferedBytes?: number;
		earlyExitDrainMs?: number;
	},
	resolve: (result: OmpRunResult) => void,
): void {
	const maxBytes = args.maxBufferedBytes ?? MAX_BUFFERED_OUTPUT_BYTES;
	const drainMs = args.earlyExitDrainMs ?? EARLY_EXIT_DRAIN_MS;
	let stdout = "";
	let stderr = "";
	let settled = false;
	// Set the instant `earlyExit` first matches — from then on we're just waiting out the drain
	// grace (or a natural close, whichever comes first), not re-checking earlyExit every chunk.
	let draining = false;
	let drainTimer: ReturnType<typeof setTimeout> | undefined;

	const onStdoutData = (chunk: Buffer | string) => {
		stdout = appendBounded(stdout, chunk.toString(), maxBytes);
		if (!settled && !draining && args.earlyExit?.(stdout)) {
			draining = true;
			drainTimer = setTimeout(() => finish(false), drainMs);
		}
	};
	const onStderrData = (chunk: Buffer | string) => {
		stderr = appendBounded(stderr, chunk.toString(), maxBytes);
	};

	const finish = (timedOut: boolean) => {
		if (settled) return;
		settled = true;
		clearTimeout(killTimer);
		clearTimeout(drainTimer);
		child.stdout?.removeListener("data", onStdoutData);
		child.stderr?.removeListener("data", onStderrData);
		resolve({ exitCode: child.exitCode, timedOut, stdout, stderr, events: parseNdjson(stdout) });
		if (!child.killed) child.kill("SIGKILL");
	};

	const killTimer = setTimeout(() => finish(true), args.timeoutMs);

	child.stdout?.on("data", onStdoutData);
	child.stderr?.on("data", onStderrData);
	child.on("close", () => finish(false));
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
			"--config",
			syncModeConfigPath(),
			...(args.extraArgs ?? []),
			args.prompt,
		];

		const child: ChildProcess = spawn("omp", ompArgs, {
			cwd: args.cwd,
			env: { ...process.env, ...args.env },
		});

		attachOmpRunHandlers(child as unknown as RunnableChild, args, resolve);
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

/**
 * Debug context attached to a failed assertion: last assistant text + tool execution summary, so
 * a failing E2E run is diagnosable from vitest output alone without re-running it. Called
 * unconditionally from every `expect(..., debugSummary(result))` call site (JS evaluates it
 * eagerly regardless of pass/fail) — it must never throw on malformed/partial events, which is
 * exactly what an early-killed (SIGKILL) process can leave behind mid-stream.
 *
 * Error tool executions get their FULL text, not the same 150-char cap as everything else — a
 * prior version truncated `lsc_select (ERROR)` results so aggressively that the actual scripted
 * response / offered options (exactly what's needed to fix a fixture-matching failure) were cut
 * off, and the only way to see them was to go find and re-read the raw log by hand.
 */
export function debugSummary(result: OmpRunResult): string {
	const lastTexts = result.events
		.filter(e => e.type === "message_end")
		.map(e => e.message as { role?: string; content?: unknown } | undefined)
		.filter((m): m is { role?: string; content?: unknown } => m !== undefined)
		.slice(-4)
		.map(m => `[${m.role}] ${extractMessageText(m.content).slice(0, 400)}`);
	const executions = toolExecutions(result);
	const tools = executions.slice(-15).map(t => `${t.toolName}${t.isError ? " (ERROR)" : ""}: ${t.isError ? t.text : t.text.slice(0, 150)}`);
	const errors = executions.filter(t => t.isError).map(t => `${t.toolName}: ${t.text}`);
	return [
		`exitCode=${result.exitCode} timedOut=${result.timedOut}`,
		`stderr(tail): ${result.stderr.slice(-500)}`,
		`all tool errors (full text, ${errors.length} total):\n${errors.join("\n---\n")}`,
		`last tool executions:\n${tools.join("\n")}`,
		`last messages:\n${lastTexts.join("\n")}`,
	].join("\n\n");
}
