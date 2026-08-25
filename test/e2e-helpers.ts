// Shared harness for Phase 7's real-omp-integration E2E tests (test/e2e-full-cycle.test.ts,
// test/enforcement-rules.test.ts). Spawns the actual `omp` binary
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
//
// The overlay also pins `modelRoles.task: "default"`. A developer's own
// `~/.omp/agent/config.yml` may set `modelRoles.task` to a real model (e.g. a codex tier); for a
// task-spawned subagent that host role otherwise takes precedence over parent-live inheritance,
// which makes preset-inheritance assertions (a tracer without an explicit preset entry should
// inherit the session default, not the developer's host task role) environment-dependent. The
// `"default"` sentinel means "session-inherited", so the overlay makes every task spawn hermetic
// against whatever the host config happens to carry — per-agent `agentModelOverrides` (e.g. the
// cheap-preset seeds) still win over it, so this only pins the fallback, not the overrides.
let cachedSyncModeConfigPath: string | undefined;
function syncModeConfigPath(): string {
	if (!cachedSyncModeConfigPath) {
		const dir = mkdtempSync(join(tmpdir(), "lsc-e2e-config-"));
		const path = join(dir, "sync-mode.yml");
		writeFileSync(path, 'async:\n  enabled: false\nmodelRoles:\n  task: "default"\n');
		cachedSyncModeConfigPath = path;
	}
	return cachedSyncModeConfigPath;
}

/** Authenticated zai-provider model (see module header for why both main and subagent moved off the very cheapest tier) — confirmed via `omp models list` (zai/glm-5.2, 1M context, effort levels minimal/low/medium/high/xhigh, so `:low` is supported). Overridable for local runs against a different provider. */
// 2026-07-16: zai's catalog dropped `low` from glm-5.2's supported efforts (now high,max only),
// so `zai/glm-5.2:low` stopped resolving mid-day — validatePreset dropped the explore override and
// the preset E2E failed on default-fallback. glm-5.1 still supports the full effort ladder and
// keeps the invariant these tests need (MAIN/SUBAGENT base ≠ DEFAULT base) at the same price class.
export const E2E_MAIN_MODEL = process.env.LSC_E2E_MAIN_MODEL ?? "zai/glm-5.1:low";
export const E2E_SUBAGENT_MODEL = process.env.LSC_E2E_SUBAGENT_MODEL ?? "zai/glm-5.1:low";
export const E2E_DEFAULT_MODEL = process.env.LSC_E2E_DEFAULT_MODEL ?? "zai/glm-4.5-flash:low";

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
	let drainTimer: NodeJS.Timeout | undefined;

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
 * `result.details` is preserved verbatim when present: cursor.ts emits it inside the
 * `tool_execution_end.result` payload, and select-gate E2E assertions need both that structured
 * observation and the model-facing content envelope from the same NDJSON event.
 */
export interface OmpToolExecution {
	toolName: string;
	isError: boolean;
	text: string;
	details?: unknown;
}

export function toolExecutions(result: OmpRunResult): OmpToolExecution[] {
	return result.events
		.filter(e => e.type === "tool_execution_end")
		.map(e => {
			const r = e.result as { content?: Array<{ type: string; text?: string }>; details?: unknown } | undefined;
			const text = (r?.content ?? [])
				.map(c => c.text ?? "")
				.join("\n");
			return {
				toolName: String(e.toolName ?? ""),
				isError: e.isError === true,
				text,
				...(r && "details" in r ? { details: r.details } : {}),
			};
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

/** Task B: `.lsc/models.yaml` preset mapping all 9 lsc-* agents to the cheap E2E subagent model, so `session_start` (src/main.ts's `applyActivePreset`) injects it live into every `task` spawn for the run. */
export function writeCheapModelPreset(projectDir: string, model: string = E2E_SUBAGENT_MODEL): void {
	const presetName = "e2e-cheap";
	const preset: Record<string, string> = {};
	for (const agent of LSC_AGENT_NAMES) preset[agent] = model;
	const path = join(projectDir, ".lsc", "models.yaml");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringify({ active: presetName, presets: { [presetName]: preset } }));
}

/** Write a structural preset with a session-default model and optional per-agent overrides. */
export function writePresetWithSessionDefault(
	projectDir: string,
	args: { name?: string; default: string; agents?: Record<string, string> },
): void {
	const presetName = args.name ?? "e2e-session-default";
	const path = join(projectDir, ".lsc", "models.yaml");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, stringify({ active: presetName, presets: { [presetName]: { default: args.default, agents: args.agents ?? {} } } }));
}

/**
 * `.lsc/crafts/*` directory names directly under the main project checkout — used to discover the
 * LLM-derived feature slug rather than hardcoding it (Stage 0 kebab-case derivation is not
 * literally predictable). Under R5's always-worktree topology this is empty for the whole
 * pre-craft/craft/post-craft run (AC5 base-purity: the base branch must never see
 * `.lsc/crafts/{feature}` until land merges it in) — use `listWorktreeFeatures` to discover the
 * feature slug while a craft is in flight. This function is for post-land visibility assertions
 * (the merge brings `.lsc/crafts/{feature}` onto the base branch) and any other base-checkout use.
 */
export function listCraftFeatures(projectDir: string): string[] {
	const craftsDir = join(projectDir, ".lsc", "crafts");
	if (!existsSync(craftsDir)) return [];
	return readdirSync(craftsDir, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => e.name);
}

/**
 * `.lsc/worktrees/*` directory names under a project — the always-worktree topology's (R5) way to
 * discover the LLM-derived feature slug while a craft is in flight, since every pre-craft run now
 * creates its worktree (and, inside it, `.lsc/crafts/{feature}/`) rather than writing directly
 * under the main checkout's `.lsc/crafts/` (see `listCraftFeatures`, which stays empty on the base
 * branch until land).
 */
export function listWorktreeFeatures(projectDir: string): string[] {
	const worktreesDir = join(projectDir, ".lsc", "worktrees");
	if (!existsSync(worktreesDir)) return [];
	return readdirSync(worktreesDir, { withFileTypes: true })
		.filter(e => e.isDirectory())
		.map(e => e.name);
}

/**
 * Generic driver for a headless `-p` stage that must reach some filesystem-observable completion
 * state before the next pipeline stage can run — tolerates the same platform limitation
 * enforcement-rules.test.ts's session_stop test documents: `omp -p` never invokes the
 * `session_stop` backstop for the turn that ends a headless run, so nothing stops the model from
 * stopping itself early (a plain text turn, `exitCode: 0`, no timeout) partway through a
 * multi-stage skill. Observed for real on pre-craft in a worktree E2E run: the session ended
 * cleanly after producing trace.md but before spec.md and plan.md existed — not a
 * hang, not a crash, just an ordinary `-p` stop with work left undone. `isComplete` is checked
 * after the initial run and after every resume; each resume re-invokes the SAME session via
 * `--continue` (verified empirically against a real run: paired with the same `--session-dir`,
 * `--continue` resumes exactly the one session this call created and the model correctly recalls
 * context from the prior turn) so the model can see its own prior progress and pick up from
 * wherever it actually stopped, instead of restarting the whole stage from scratch. Resuming stops
 * as soon as `isComplete()` is true, after `maxResumes` attempts, or the moment any attempt itself
 * times out (a real timeout is a different failure mode than a premature clean stop, and burning
 * more of the budget retrying it is not this helper's job).
 */
export interface RunToCompletionArgs {
	cwd: string;
	sessionDir: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	prompt: string;
	/** Checked after the initial run and after each resume; once true, no further resumes run. */
	isComplete: () => boolean;
	/** Sent via `--continue` on each resume attempt — must tell the model not to redo what's already there (it can also just inspect the filesystem itself to see what's missing). */
	continuationPrompt: string;
	/** Per-resume-attempt kill timeout; defaults to `timeoutMs`. */
	resumeTimeoutMs?: number;
	/** Max resume attempts after the initial run. Default 3. */
	maxResumes?: number;
}

export interface RunToCompletionResult {
	/** Every runOmpPrint result in order — index 0 is the initial run, the rest are resumes. */
	attempts: OmpRunResult[];
	/** `isComplete()` evaluated after the final attempt. */
	completed: boolean;
	/** The final attempt's result — same shape single-call sites already assert `timedOut` against and pass to `debugSummary`. */
	last: OmpRunResult;
}

/** The one piece of `runOmpPrint`'s signature `runToCompletionWith` actually calls — narrowed so tests can inject a fake without spawning a real `omp` process. */
type OmpPrintFn = (args: {
	cwd: string;
	prompt: string;
	sessionDir: string;
	model?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs: number;
	extraArgs?: string[];
}) => Promise<OmpRunResult>;

/**
 * The loop control extracted out of `runToCompletion` so it — the part with actual branching logic
 * (when to resume, when to stop, what flag to resume with) — is directly unit-testable against a
 * fake `spawn` function, the same reasoning `attachOmpRunHandlers` was split out of `runOmpPrint`
 * for. `runToCompletion` below is just this bound to the real `runOmpPrint`.
 */
export async function runToCompletionWith(args: RunToCompletionArgs, spawn: OmpPrintFn): Promise<RunToCompletionResult> {
	const maxResumes = args.maxResumes ?? 3;
	const attempts: OmpRunResult[] = [
		await spawn({ cwd: args.cwd, sessionDir: args.sessionDir, model: args.model, env: args.env, timeoutMs: args.timeoutMs, prompt: args.prompt }),
	];

	let resumes = 0;
	while (!attempts[attempts.length - 1].timedOut && !args.isComplete() && resumes < maxResumes) {
		resumes++;
		attempts.push(
			await spawn({
				cwd: args.cwd,
				sessionDir: args.sessionDir,
				model: args.model,
				env: args.env,
				timeoutMs: args.resumeTimeoutMs ?? args.timeoutMs,
				prompt: args.continuationPrompt,
				// Resumes the exact session the initial (or a prior resume) call in this same
				// sessionDir just produced — never a fresh session, and never the wrong one, since
				// this whole sessionDir is exclusive to a single test run (setupFixtureProject's own
				// fresh mkdtemp per call).
				extraArgs: ["--continue"],
			}),
		);
	}

	return { attempts, completed: args.isComplete(), last: attempts[attempts.length - 1] };
}

export function runToCompletion(args: RunToCompletionArgs): Promise<RunToCompletionResult> {
	return runToCompletionWith(args, runOmpPrint);
}

/**
 * Whether pre-craft's three Stage 1-3 artifacts all exist under the (LLM-derived) single
 * `.lsc/worktrees/{feature}/.lsc/crafts/{feature}/` directory — the `isComplete` predicate
 * `runToCompletion` callers use for the pre-craft stage. Worktree-internal per R5's always-worktree
 * topology (pre-craft always creates `.lsc/worktrees/{feature}/` and writes every artifact inside
 * it — see `listWorktreeFeatures`). False (never a throw) when no worktree exists yet, or when more
 * than one does (ambiguous — not "complete" either way, mirroring the pre-existing
 * `listWorktreeFeatures` length-1 assertions in e2e-full-cycle.test.ts). No `test/` check anymore
 * (C5/C8) — pre-craft no longer authors tests; that is now post-craft's own §3.0 stage.
 */
export function preCraftArtifactsComplete(projectDir: string): boolean {
	const features = listWorktreeFeatures(projectDir);
	if (features.length !== 1) return false;
	const worktreeDir = join(projectDir, ".lsc", "worktrees", features[0]);
	const craftDir = join(worktreeDir, ".lsc", "crafts", features[0]);
	return existsSync(join(craftDir, "trace.md")) && existsSync(join(craftDir, "spec.md")) && existsSync(join(craftDir, "plan.md"));
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

// ---------------------------------------------------------------------------
// PR-5 (postcraft-14cycle-approval-failure) — escalation / red-cycle E2E helpers.
//
// The escalation suite drives ONLY a post-craft subprocess against a seeded,
// already-crafted feature (running pre-craft+craft for real three more times
// would add hours of model time to assert a gate that fires before any of that
// work). The seed reproduces exactly the on-disk shape a real prior cycle
// leaves behind: worktree on a slug-carrying branch, tracked trace/spec/plan,
// audit-N.md docs in the OLD format (no Expected State/Base Drift sections —
// begin's candidate numbering only reads the numeric suffixes), and a v2
// .craft-state.json with no escalation fields (the legacy bootstrap PR-1
// allows). Branch-specific answers are written OUTSIDE the repo, next to the
// base fixture file.
// ---------------------------------------------------------------------------

/** The three canonical [Audit Escalation] dispositions — verbatim from src/craft/audit-policy.ts's AUDIT_ESCALATION_DISPOSITIONS (load-bearing exact labels; never reword). */
export const AUDIT_ESCALATION_LABELS = ["Continue auditing", "Abort this craft", "Preserve branch and stop"] as const;
export type AuditEscalationLabel = (typeof AUDIT_ESCALATION_LABELS)[number];

/**
 * Write a branch-specific answers file next to the base fixture: the anchored
 * `[Audit Escalation]` rule's selection is rewritten to `disposition`, everything
 * else (including the generic confirmation default) is inherited verbatim from
 * the canonical sample. Returns the new file's absolute path.
 */
export function writeEscalationAnswersVariant(fixtureDir: string, name: string, disposition: AuditEscalationLabel): string {
	const base = JSON.parse(readFileSync(join(fixtureDir, "answers.json"), "utf8")) as {
		answers: Array<Record<string, unknown>>;
		default?: unknown;
	};
	const idx = base.answers.findIndex(rule => typeof rule.match === "string" && rule.match.includes("Audit Escalation"));
	if (idx === -1) throw new Error("base answers.json carries no [Audit Escalation] rule — PR-5 requires it");
	base.answers[idx] = { ...base.answers[idx], kind: "selection", selections: [disposition] };
	const variantPath = join(fixtureDir, `${name}.answers.json`);
	writeFileSync(variantPath, `${JSON.stringify(base, null, 2)}\n`);
	return variantPath;
}

/** A feature's persisted craft state (plain JSON — no active-craft singleton involvement), or undefined when absent. */
export function readCraftStateFile(worktreeRoot: string, feature: string): Record<string, unknown> | undefined {
	const path = join(worktreeRoot, ".lsc", "crafts", feature, ".craft-state.json");
	return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : undefined;
}

/**
 * Seed a complete, already-crafted feature so a post-craft subprocess starts at the
 * NEXT audit candidate. `seededAudits` REJECT verdict docs are written (old format —
 * candidate numbering only reads suffixes), the state pins `auditCycle` to the latest
 * seeded doc, and everything is committed on a slug-carrying implementation branch so
 * §2's worktree/base/sanity checks pass without asking anything. `redCheckScript`,
 * when given, is written as the feature's `check/run_check.sh` (the red-cycle suite's
 * deterministic multi-command red).
 */
export function seedCraftedFeature(
	projectDir: string,
	feature: string,
	opts: { seededAudits: number; redCheckScript?: string } = { seededAudits: 2 },
): { worktreeRoot: string; craftDir: string; statePath: string; seedTip: string } {
	const worktreeRoot = join(projectDir, ".lsc", "worktrees", feature);
	execFileSync("git", ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"], { cwd: projectDir });

	// Same ignore rule lsc_scaffold registers, so the seeded worktree matches the real topology.
	const gitignorePath = join(projectDir, ".gitignore");
	const gitignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
	if (!/^\/?\.lsc\/worktrees\/?$/m.test(gitignore)) {
		writeFileSync(gitignorePath, `${gitignore}${gitignore.endsWith("\n") || gitignore === "" ? "" : "\n"}.lsc/worktrees/\n`);
		execFileSync("git", ["add", ".gitignore"], { cwd: projectDir });
		execFileSync("git", ["commit", "-q", "-m", "chore: ignore .lsc/worktrees"], { cwd: projectDir });
	}

	const craftDir = join(worktreeRoot, ".lsc", "crafts", feature);
	mkdirSync(join(craftDir, "audit"), { recursive: true });
	writeFileSync(join(craftDir, "trace.md"), `# trace — ${feature}\n\nSeeded trace for the PR-5 escalation/red-cycle E2E. The slugify bug note in src/slugify.ts is the observed ground truth.\n`);
	writeFileSync(join(craftDir, "spec.md"), `# spec — ${feature}\n\n## Goal\n\nFix slugify: collapse consecutive non-alphanumeric separators into one hyphen and trim leading/trailing hyphens.\n\n## Acceptance Criteria\n\n- AC1 (결정적): slugify("Hello   World!!!") === "hello-world" via node --test.\n\n## Constraints\n\n- Dependency-free (node --test only); public signatures unchanged.\n`);
	writeFileSync(join(craftDir, "plan.md"), `# plan — ${feature}\n\n1. src/slugify.ts: collapse separator runs and trim. 2. Verify with node --test.\n`);
	for (let n = 0; n < opts.seededAudits; n++) {
		writeFileSync(join(craftDir, "audit", `audit-${n}.md`), `# Audit ${n}\n\n**AUDIT VERDICT: REJECT**\n\nSeeded REJECT (old-format audit doc — the PR-5 suites only need the candidate numbering).\n`);
	}
	if (opts.redCheckScript !== undefined) {
		mkdirSync(join(craftDir, "check"), { recursive: true });
		writeFileSync(join(craftDir, "check", "run_check.sh"), opts.redCheckScript);
	}
	const statePath = join(craftDir, ".craft-state.json");
	const state = {
		stateVersion: 2,
		feature,
		projectRoot: projectDir,
		worktreeRoot,
		aborted: false,
		auditCycle: opts.seededAudits - 1,
		checkLogAtCycleStart: 0,
	};
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

	execFileSync("git", ["add", "-A"], { cwd: worktreeRoot });
	execFileSync("git", ["commit", "-q", "-m", `feat: seeded implementation + ${opts.seededAudits} prior audit(s)`], { cwd: worktreeRoot });
	return { worktreeRoot, craftDir, statePath, seedTip: execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeRoot, encoding: "utf8" }).trim() };
}

/** Flattened `{isError, text}` summaries of every `tool_execution_end` for one tool name — the escalation suites assert on lsc_audit_begin/lsc_craft_abort/lsc_run_check through this. */
export function toolCallSummaries(result: OmpRunResult, toolName: string): Array<{ isError: boolean; text: string }> {
	return toolExecutions(result).filter(call => call.toolName === toolName).map(call => ({ isError: call.isError, text: call.text }));
}

// lsc plugin tools stream their tool_execution_end under a GENERIC omp tool name (observed:
// an lsc_audit_validate call surfaced as toolName "write" — discoverable tools dispatch
// through a proxy), so PR-5's stream predicates match on the TS-authored RESULT TEXT markers
// instead of toolName. Every marker below is a literal from src/ production output.
// Every marker MUST be free of double quotes: the raw NDJSON stream JSON-escapes them (`\"`),
// so a quoted literal can never match raw stdout (observed in a real run — the escaped form
// broke the first marker generation; these are the corrected, quote-free forms).
export const AUDIT_BEGIN_ANY_MARKER = "lets-craft: audit "; // every lsc_audit_begin result (required/begun/refused/replay) starts here
export const AUDIT_ESCALATION_REQUIRED_MARKER = "audit escalation required for";
export const AUDIT_CYCLE_BEGUN_MARKER = (cycle: number) => `audit cycle ${cycle} begun for`; // (the feature name follows in quotes — deliberately excluded)
export const AUDIT_ESCALATION_CONSUMED_MARKER = "escalation consumed: Continue auditing";
export const AUDIT_TERMINAL_MARKER = () => "NO audit cycle was begun"; // unique to the consume-terminal success text
export const CRAFT_ABORTED_MARKER = `marked aborted — `;
export const RUN_CHECK_MARKER = "script sha256: "; // lsc_run_check's transcript header — only that tool emits it

/** earlyExit predicate: the marker text has streamed back in the raw NDJSON (toolName-independent). */
export function streamTextEarlyExit(marker: string): (accumulatedStdout: string) => boolean {
	return (stdout: string) => stdout.includes(marker);
}

/** Count tool_execution_end RESULT TEXTS containing `marker` — the toolName-independent execution count. Raw-substring counting over-counts (partial/update events and the model quoting a result each repeat the text), so only completed tool results count. */
export function streamMarkerCount(result: OmpRunResult | string, marker: string): number {
	const stdout = typeof result === "string" ? result : result.stdout;
	let count = 0;
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const event = JSON.parse(trimmed) as { type?: string; result?: { content?: Array<{ text?: string }> } };
			if (event.type !== "tool_execution_end") continue;
			const text = (event.result?.content ?? []).map(block => block.text ?? "").join("\n");
			if (text.includes(marker)) count++;
		} catch {
			// unterminated NDJSON line
		}
	}
	return count;
}

/** The result text of the LAST tool_execution_end whose text contains `marker`, or undefined. */
export function lastToolResultWith(result: OmpRunResult, marker: string): string | undefined {
	let last: string | undefined;
	for (const line of result.stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const event = JSON.parse(trimmed) as { type?: string; result?: { content?: Array<{ text?: string }> } };
			if (event.type !== "tool_execution_end") continue;
			const text = (event.result?.content ?? []).map(block => block.text ?? "").join("\n");
			if (text.includes(marker)) last = text;
		} catch {
			// unterminated NDJSON line
		}
	}
	return last;
}

/** Count a prompt-stage spawn's `task` tool executions (e.g. the §3.0 lsc-test-engineer spawn of a red-cycle continuation). */
export function taskSpawnCount(result: OmpRunResult): number {
	return toolExecutions(result).filter(call => call.toolName === "task").length;
}

function parseToolEnds(stdout: string, toolName: string): Array<{ isError: boolean; text: string }> {
	const calls: Array<{ isError: boolean; text: string }> = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const event = JSON.parse(trimmed) as { type?: string; toolName?: string; isError?: boolean; result?: { content?: Array<{ type?: string; text?: string }> } };
			if (event.type !== "tool_execution_end" || event.toolName !== toolName) continue;
			const text = (event.result?.content ?? []).map(block => block.text ?? "").join("\n");
			calls.push({ isError: event.isError === true, text });
		} catch {
			// Partial/unterminated NDJSON line — not counted yet.
		}
	}
	return calls;
}
