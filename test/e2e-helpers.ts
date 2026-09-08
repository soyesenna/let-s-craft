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
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";
import { LSC_AGENT_NAMES } from "../src/preset/models-file";

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** omp's global plugin-link slot for lets-craft — the ONE load path its plugin/skill discovery uses (`skill://post-craft` text included; probed: `--plugin-dir` does NOT pin skills). */
const GLOBAL_PLUGIN_LINK = join(homedir(), ".omp", "plugins", "node_modules", "lets-craft");

/**
 * audit-0 RF-4 — pin the lets-craft plugin every E2E child process loads to THIS repo, then
 * fail fast BEFORE the first model turn if the exposed build is not the repo's current HEAD.
 *
 * (a) Per-run link re-set: `omp plugin link {REPO_ROOT}` re-points the global slot at the repo
 *     under test (idempotent when already pointing here). The implicit dependency on whatever
 *     the developer's link happened to target is gone — during the audit it pointed at the BASE
 *     checkout, so every "worktree" E2E child was actually validating the base build.
 * (b) Preflight: the child resolves the plugin through the link, so the build identity it will
 *     load is exactly `{REPO_ROOT}/dist/generated/version.js`'s BUILD_INFO.gitHash — it must
 *     equal `git -C REPO_ROOT rev-parse --short HEAD`, else THROW (suite abort; `npm run e2e`
 *     runs `npm run build` first, so a mismatch means a stale or foreign build).
 *
 * audit-1 RF-18: a missing / dangling / non-symlink link slot is simply "not pinned" — the old
 * unguarded `readlinkSync` died with ENOENT on a clean machine BEFORE the link command could
 * ever run, killing all four E2E files at setup. Every not-pinned shape now takes the same
 * `omp plugin link` re-point, and the fail-closed re-verification below decides. The optional
 * seams exist so the three boundaries (missing → created / wrong-target → re-pointed /
 * correct → no-op) and every refusal branch are unit-testable without the real global slot or
 * the `omp` binary.
 *
 * audit-2 RF-22: production `omp plugin link` (observed on 18.0.11; 18.1.14 installed at
 * audit-4 — the normalization below stays unconditional either way) fails with `symlink`
 * EEXIST when a REGULAR FILE occupies the slot — its unlink step only clears symlink/directory
 * shapes — so the helper normalizes that shape itself BEFORE entering the real link: the
 * regular file is removed by explicit policy, EACCES/EPERM (and every other removal error)
 * propagates, and directories are left to omp's own handling. Empirically pinned on this
 * machine: regular-file slot → `omp plugin link` exit 1, slot untouched.
 */
export interface PluginPinSeams {
	/** omp's global plugin-link slot to inspect/re-point (default: GLOBAL_PLUGIN_LINK). */
	linkPath: string;
	/** The repo under test whose build the children must load (default: REPO_ROOT). */
	repoRoot: string;
	/** `omp plugin link <repoRoot>` — injectable so unit tests never shell out to omp. */
	linkPlugin: (repoRoot: string) => void;
}

export function pinLetsCraftPluginToRepo(seams: Partial<PluginPinSeams> = {}): void {
	const linkPath = seams.linkPath ?? GLOBAL_PLUGIN_LINK;
	const repoRoot = seams.repoRoot ?? REPO_ROOT;
	const linkPlugin =
		seams.linkPlugin ??
		(root => {
			execFileSync("omp", ["plugin", "link", root], { stdio: "pipe" });
		});
	let pinned = false;
	try {
		pinned = readlinkSync(linkPath) === repoRoot;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// ENOENT: the slot does not exist yet (a clean machine). EINVAL: something other than a
		// symlink occupies the slot. Both are "not pinned" — anything else is a real error.
		if (code !== "ENOENT" && code !== "EINVAL") throw error;
	}
	if (!pinned) {
		// audit-2 RF-22: normalize a regular-file slot before the real `omp plugin link` —
		// production only unlinks symlink/directory shapes, so a regular file would make the
		// link's own `symlink` call EEXIST and kill the CLI (exit 1) before the fail-closed
		// post-verification below could ever run. Removal is the explicit policy for regular
		// files only; every other errno from rmSync (EACCES/EPERM/...) propagates untouched,
		// and only the benign TOCTOU ENOENT (slot vanished between lstat and rm) is swallowed.
		try {
			if (lstatSync(linkPath).isFile()) {
				rmSync(linkPath);
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		linkPlugin(repoRoot);
	}
	// Fail-closed re-verification for EVERY branch (created / re-pointed / already correct):
	// if the link still does not resolve to this repo after the re-point, never spawn children.
	let linkReal: string;
	try {
		linkReal = realpathSync(linkPath);
	} catch {
		linkReal = "";
	}
	if (linkReal !== realpathSync(repoRoot)) {
		throw new Error(`lets-craft E2E harness: omp's plugin link (${linkPath}) does not resolve to this repo (${repoRoot}) even after \`omp plugin link\` — refusing to spawn children against an unknown plugin build (audit-0 RF-4, audit-1 RF-18).`);
	}
	const versionJs = join(repoRoot, "dist", "generated", "version.js");
	if (!existsSync(versionJs)) {
		throw new Error(`lets-craft E2E harness: no built plugin at ${versionJs} — run \`npm run build\` in ${repoRoot} first (audit-0 RF-4 preflight).`);
	}
	const builtHash = /gitHash:\s*"([0-9a-f]+)"/.exec(readFileSync(versionJs, "utf8"))?.[1];
	const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
	if (builtHash !== head) {
		throw new Error(
			`lets-craft E2E harness: plugin-build/HEAD mismatch — the children would load BUILD_INFO.gitHash=${builtHash ?? "(unparsed)"} but ${repoRoot} HEAD is ${head}. ` +
				`Re-run \`npm run build\` (the e2e script does this first) so the linked build is the code under test (audit-0 RF-4 preflight).`,
		);
	}
}
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
	const { promise, resolve } = Promise.withResolvers<OmpRunResult>();
	// audit-0 RF-4: pin + preflight BEFORE the child spawns (fail fast, never mid-model-turn).
	pinLetsCraftPluginToRepo();
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
	return promise;
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
	/**
	 * audit-4 RF-40 — wall-clock duration of each attempt in ms, index-aligned with `attempts`
	 * (index 0 = the initial run, the rest = resumes). Measured around each spawn call so a
	 * green full-cycle run can pin its per-stage ACTUALS against the budget constants in the
	 * stage-durations evidence artifact — the budgets are derived from sanctioned worst paths,
	 * and only recorded actuals can tell the next sizing cycle whether the gap is real.
	 */
	attemptDurationsMs: number[];
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
	const attempts: OmpRunResult[] = [];
	const attemptDurationsMs: number[] = [];
	const timed = async (call: Parameters<OmpPrintFn>[0]): Promise<OmpRunResult> => {
		const startedAt = Date.now();
		const result = await spawn(call);
		attemptDurationsMs.push(Date.now() - startedAt);
		return result;
	};
	attempts.push(
		await timed({ cwd: args.cwd, sessionDir: args.sessionDir, model: args.model, env: args.env, timeoutMs: args.timeoutMs, prompt: args.prompt }),
	);

	let resumes = 0;
	while (!attempts[attempts.length - 1].timedOut && !args.isComplete() && resumes < maxResumes) {
		resumes++;
		attempts.push(
			await timed({
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

	return { attempts, completed: args.isComplete(), last: attempts[attempts.length - 1], attemptDurationsMs };
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

	// audit-0 RF-9: the FEATURE WORKTREE's own .gitignore must ignore the two runtime sidecars
	// (.craft-state.json, check/logs/) — same globs as src/artifacts/gitignore.ts — and it must
	// be committed BEFORE the state file exists: a linked worktree reads only its OWN working
	// tree's .gitignore, so without this the seed's `git add -A` below tracked the sidecar onto
	// the feature branch (audit-0 lens ③ probe: the seeded worktree branch carried it).
	const worktreeGitignorePath = join(worktreeRoot, ".gitignore");
	const worktreeGitignore = existsSync(worktreeGitignorePath) ? readFileSync(worktreeGitignorePath, "utf8") : "";
	const sidecarEntries = [".lsc/crafts/*/.craft-state.json", ".lsc/crafts/*/check/logs/"].filter(
		entry => !worktreeGitignore.split(/\r?\n/).some(line => line.trim() === entry || line.trim() === `/${entry}`),
	);
	if (sidecarEntries.length > 0) {
		writeFileSync(worktreeGitignorePath, `${worktreeGitignore}${worktreeGitignore.endsWith("\n") || worktreeGitignore === "" ? "" : "\n"}${sidecarEntries.join("\n")}\n`);
		execFileSync("git", ["add", ".gitignore"], { cwd: worktreeRoot });
		execFileSync("git", ["commit", "-q", "-m", "chore: ignore craft-state and check-log sidecars"], { cwd: worktreeRoot });
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
	// audit-0 RF-9: prove the sidecar is untracked AND matched by an ignore rule — the seeded
	// branch must never carry .craft-state.json (a later lsc_craft_init/audit run rewrites it,
	// which would leave the worktree dirty against its own committed evidence).
	const trackedSidecar = execFileSync("git", ["ls-files", "--", statePath], { cwd: worktreeRoot, encoding: "utf8" }).trim();
	if (trackedSidecar !== "") throw new Error(`lets-craft E2E seed: ${statePath} was TRACKED by the seeded worktree branch — the sidecar gitignore entries did not take effect.`);
	// audit-1 RF-17: `git check-ignore -q` accepts exactly ONE path (a multi-path `-q` call is a
	// git fatal), so each sidecar's ignore invariant is asserted in its own invocation —
	// execFileSync throws on the non-zero exit a "not ignored" path would produce.
	for (const sidecarPath of [statePath, join(craftDir, "check", "logs", "check-0.log")]) {
		execFileSync("git", ["check-ignore", "-q", "--", sidecarPath], { cwd: worktreeRoot });
	}
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
//
// audit-4 RF-41(b) producer/consumer audit (explore probe: every stream marker constant MUST
// have a producer in the production RESULT TEXT — the `text` an lsc_* tool call resolves
// with, not a line only the persisted transcript writer emits). Producers verified against
// src/ at the audit-4 implementation HEAD:
//   AUDIT_BEGIN_ANY_MARKER           ← verdict.ts begin-tool result texts: :451 (refused),
//                                      :473 (escalation required), :507 (consume-begun),
//                                      :542 (consume-terminal), :575 (idempotent replay),
//                                      :595 (plain begun)
//   AUDIT_ESCALATION_REQUIRED_MARKER ← verdict.ts:473
//   AUDIT_CYCLE_BEGUN_MARKER(n)      ← verdict.ts:595 (plain begin) and :507 (escalation consume)
//   AUDIT_ESCALATION_CONSUMED_MARKER ← verdict.ts:507
//   AUDIT_TERMINAL_MARKER()          ← verdict.ts:542
//   CRAFT_ABORTED_MARKER             ← abort.ts:64 and :76
//   RUN_CHECK_RESULT_MARKER          ← run-check.ts:278 (passed), :279 (FAILED), :438 (failed
//                                      to execute), :449 (empty transcript) — every
//                                      lsc_run_check result text starts with this prefix.
// The REPLACED `RUN_CHECK_MARKER = "script sha256: "` was a DEAD stream marker: run-check.ts:248
// writes that line only into the persisted check/logs transcript file, which the result text
// never echoes — no result-text producer existed (audit-4 RF-41(b) removed it).
export const AUDIT_BEGIN_ANY_MARKER = "lets-craft: audit "; // every lsc_audit_begin result (required/begun/refused/replay) starts here
export const AUDIT_ESCALATION_REQUIRED_MARKER = "audit escalation required for";
export const AUDIT_CYCLE_BEGUN_MARKER = (cycle: number) => `audit cycle ${cycle} begun for`; // (the feature name follows in quotes — deliberately excluded)
export const AUDIT_ESCALATION_CONSUMED_MARKER = "escalation consumed: Continue auditing";
export const AUDIT_TERMINAL_MARKER = () => "NO audit cycle was begun"; // unique to the consume-terminal success text
export const CRAFT_ABORTED_MARKER = `marked aborted — `;
export const RUN_CHECK_RESULT_MARKER = "lets-craft: run_check.sh "; // every lsc_run_check RESULT TEXT starts here (passed/FAILED/failed-to-execute/empty-transcript)

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

/**
 * audit-0 RF-7 — the ORDERED outcome tuple of every COMPLETED `lsc_audit_begin` execution in
 * the raw NDJSON stream: one `isError` flag per `tool_execution_end` whose result text carries
 * the begin marker, in execution order. plan.md:411's Continue predicate (`total executions = 2
 * ∧ last.isError = false`, i.e. the exact ordered tuple [isError, success]) is fixed against
 * THIS — per-marker counts cannot express order, and order is the contract (the first call must
 * be the gate refusal, the second and last the consume success).
 */
export function auditBeginOutcomes(result: OmpRunResult | string): boolean[] {
	const stdout = typeof result === "string" ? result : result.stdout;
	const outcomes: boolean[] = [];
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const event = JSON.parse(trimmed) as { type?: string; isError?: boolean; result?: { content?: Array<{ text?: string }> } };
			if (event.type !== "tool_execution_end") continue;
			const text = (event.result?.content ?? []).map(block => block.text ?? "").join("\n");
			if (!text.includes(AUDIT_BEGIN_ANY_MARKER)) continue;
			outcomes.push(event.isError === true);
		} catch {
			// unterminated NDJSON line — not a completed execution yet
		}
	}
	return outcomes;
}

/** Count a prompt-stage spawn's `task` tool executions (e.g. the §3.0 lsc-test-engineer spawn of a red-cycle continuation). */
export function taskSpawnCount(result: OmpRunResult): number {
	return toolExecutions(result).filter(call => call.toolName === "task").length;
}


// ---------------------------------------------------------------------------
// audit-3 RF-33/RF-35 — durable parent-session JSONL readers.
//
// The bounded stdout buffer (MAX_BUFFERED_OUTPUT_BYTES' 32MB rolling tail) can lose
// early-stream lines on long runs, and the stream's toolName for plugin tools is generic,
// so RF-35(a)'s exact-spawn evidence and RF-33's routing-source precondition are re-founded
// on the session FILES the host itself persists under --session-dir: omp writes one
// top-level `<sessionDir>/<timestamp>_<uuid>.jsonl` per process (confirmed against a real
// --session-dir layout; subagent sessions live in the sibling DIRECTORY of the same stem),
// recording every assistant `toolCall` block with its PARSED arguments, every `toolResult`
// message, and a timestamp per entry — the stdout-independent record these readers expose.
// ---------------------------------------------------------------------------

/** The harness's one canonical JSON-object guard (exported so call sites never recreate it) — narrows to `Record<string, unknown>`; fields stay `unknown` and are checked at each use. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a persisted session JSONL as objects. Deliberately THROWS on an unparseable or
 * non-object line (with `path:line` context): these readers exist to be a durable authority,
 * so a corrupt file must surface as its own loud failure — never silently degrade into
 * "no task calls found", which would fabricate an orchestration-defect verdict.
 */
export function readSessionJsonl(path: string): Array<Record<string, unknown>> {
	return readFileSync(path, "utf8")
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map((line, index) => {
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch (error) {
				throw new Error(`${path}:${index + 1} is not parseable JSON: ${(error as Error).message}`);
			}
			if (!isJsonObject(value)) throw new Error(`${path}:${index + 1} is not a JSON object`);
			return value;
		});
}

/**
 * audit-3 RF-35 — locate the durable session FILE of the process whose prompt carries
 * `promptNeedle` (e.g. "/skill:post-craft"). omp persists one top-level `.jsonl` per process
 * directly under `sessionDir`, and each process's own `-p` prompt is its first user message —
 * so the needle identifies that process's record even when several runs share the dir (the
 * pre-craft/craft processes' prompts cannot contain another skill's invocation). Subagent
 * sessions live one level down (in the sibling directory of the same stem) and are never
 * matched here. Returns undefined when no process's user message carries the needle.
 */
export function findSessionFileByPrompt(sessionDir: string, promptNeedle: string): { path: string; matchedUserText: string } | undefined {
	for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		const path = join(sessionDir, entry.name);
		try {
			const entries = readSessionJsonl(path);
			for (const e of entries) {
				if (e.type !== "message" || !isJsonObject(e.message) || e.message.role !== "user") continue;
				const text = extractMessageText(e.message.content);
				if (text.includes(promptNeedle)) return { path, matchedUserText: text };
			}
		} catch {
			// A file that fails to parse while SCANNING is skipped, not fatal: the finder's job is
			// needle matching, and another process's corrupt file must not mask a healthy match.
			// (Reads of the MATCHED file go through readSessionJsonl, which does throw.)
		}
	}
	return undefined;
}

/** One `task` tool call a session file records, with its durable completion state. See `sessionTaskSpawns`. */
export interface SessionTaskSpawn {
	/** The toolCall block id — pairs the call with its toolResult message. */
	callId: string;
	/** The requested agent from the call's arguments: the flat `agent` field, or a `tasks[]` batch item's `agent`. Undefined when the model omitted it. */
	agent: string | undefined;
	/** The assignment text: the flat `task` field, or the batch item's `task`. Empty string when absent. */
	taskText: string;
	/** True once a toolResult message for `callId` exists in the same file — the durable, stdout-independent completion observation. */
	resultDelivered: boolean;
	resultIsError: boolean | undefined;
	resultText: string | undefined;
}

/**
 * audit-3 RF-35(a)/RF-33 — every `task` tool call a session FILE records, in order, with its
 * durable completion state. The persisted assistant block is the host's own schema
 * (pi-ai's `ToolCall`: `{type:"toolCall", id, name, arguments: Record<string,unknown>}`),
 * always written when the model makes the call — unlike the child's `session_init.agent`, an
 * OPTIONAL host field — so "which agent did the orchestrator request, and did that spawn
 * complete" is answerable from this record alone, immune to stdout-buffer truncation. Both
 * argument shapes the tool accepts are normalized (task/index.ts): the flat
 * `{agent, task}` form and the batch `{tasks: [{agent, task}]}` form.
 */
export function sessionTaskSpawns(sessionJsonlPath: string): SessionTaskSpawn[] {
	const entries = readSessionJsonl(sessionJsonlPath);
	const spawns: SessionTaskSpawn[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || !isJsonObject(entry.message) || entry.message.role !== "assistant") continue;
		const content = entry.message.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (!isJsonObject(block) || block.type !== "toolCall" || block.name !== "task") continue;
			// `arguments` is a parsed object per the ToolCall schema; tolerate a JSON string
			// (provider variance) rather than dropping the call on the floor.
			let args: Record<string, unknown> | undefined = isJsonObject(block.arguments)
				? block.arguments
				: typeof block.arguments === "string"
					? (() => {
							try {
								const parsed: unknown = JSON.parse(block.arguments);
								return isJsonObject(parsed) ? parsed : undefined;
							} catch {
								return undefined;
							}
						})()
					: undefined;
			const items: unknown[] = Array.isArray(args?.tasks) && args.tasks.length > 0 ? args.tasks : [args ?? {}];
			for (const item of items) {
				if (!isJsonObject(item)) continue;
				const agent = typeof item.agent === "string" && item.agent.trim().length > 0 ? item.agent.trim() : undefined;
				spawns.push({
					callId: typeof block.id === "string" ? block.id : "",
					agent,
					taskText: typeof item.task === "string" ? item.task : "",
					resultDelivered: false,
					resultIsError: undefined,
					resultText: undefined,
				});
			}
		}
	}
	// A batch call's items share ONE toolCall id, so a delivered result completes EVERY item
	// of that call — per-item results do not exist for the batch shape.
	const deliveredByCallId = new Map<string, { isError: boolean; text: string }>();
	for (const entry of entries) {
		if (entry.type !== "message" || !isJsonObject(entry.message) || entry.message.role !== "toolResult") continue;
		const message = entry.message;
		if (typeof message.toolCallId !== "string") continue;
		const content = message.content;
		deliveredByCallId.set(message.toolCallId, {
			isError: message.isError === true,
			text: Array.isArray(content) ? content.map(block => (isJsonObject(block) && typeof block.text === "string" ? block.text : "")).join("\n") : "",
		});
	}
	for (const spawn of spawns) {
		const delivered = deliveredByCallId.get(spawn.callId);
		if (!delivered) continue;
		spawn.resultDelivered = true;
		spawn.resultIsError = delivered.isError;
		spawn.resultText = delivered.text;
	}
	return spawns;
}

/** One timestamped entry digest — the attribution tail a stall diagnostic needs. See `sessionEntryDigests`. */
export interface SessionEntryDigest {
	timestamp: string | number | undefined;
	type: string;
	/** Present for message entries: "assistant"/"user"/"toolResult". */
	role: string | undefined;
	/** Present for toolResult messages: the tool's own name. */
	toolName: string | undefined;
	/** Bounded text: the assistant/user text or the tool result text (capped). */
	snippet: string;
}

/**
 * audit-3 RF-35(b) — the ordered entry digests of a session file (timestamp, type, role,
 * toolName, bounded text) so a post-craft timeout can attribute its stall: the timestamp of
 * the LAST durable activity (and the gap to the kill) separates a provider stall (long tail
 * silence) from budget exhaustion (dense activity right up to the kill) from an
 * orchestration hang (a task call whose result never arrives).
 */
export function sessionEntryDigests(sessionJsonlPath: string): SessionEntryDigest[] {
	return readSessionJsonl(sessionJsonlPath).map(entry => {
		const message = isJsonObject(entry.message) ? entry.message : undefined;
		let role: string | undefined;
		let toolName: string | undefined;
		let snippet = "";
		if (message && typeof message.role === "string") {
			role = message.role;
			if (role === "toolResult" && typeof message.toolName === "string") toolName = message.toolName;
			const content = message.content;
			snippet = role === "toolResult" && Array.isArray(content)
				? content.map(block => (isJsonObject(block) && typeof block.text === "string" ? block.text : "")).join(" ")
				: extractMessageText(content);
		}
		return {
			timestamp: typeof entry.timestamp === "string" || typeof entry.timestamp === "number" ? entry.timestamp : message && typeof message.timestamp === "number" ? message.timestamp : undefined,
			type: typeof entry.type === "string" ? entry.type : "<unknown>",
			role,
			toolName,
			snippet: snippet.slice(0, 200),
		};
	});
}

// ---------------------------------------------------------------------------
// audit-4 RF-39/RF-41 — durable stage observation. The 32MB rolling tail that earlyExit
// predicates and post-hoc stream assertions read is a LOSSY view of a long run (early lines
// are gone), and the retired `RUN_CHECK_MARKER` showed a stream marker can even be entirely
// producer-less. These readers make the on-disk record — `.craft-state.json`,
// check/logs/check-N.log, and the session JSONL's toolResult texts — the AUTHORITY the
// long-run predicates and assertions evaluate first; stream counts survive only as
// corroborative evidence quoted next to the durable numbers.
// ---------------------------------------------------------------------------

/**
 * audit-4 RF-41(b) — a ≥`minIntervalMs` gate for durable fs reads inside per-chunk earlyExit
 * predicates. The cheap stream precondition runs on EVERY stdout chunk (substring scan, no
 * fs); the durable read it gates costs a directory scan plus JSONL parse, so it runs at most
 * once per interval — per-chunk fs thrash is the failure mode this avoids. A gated-out chunk
 * simply returns false; the next chunk past the interval re-reads, so throttling can delay an
 * early exit but never skip the observation (the natural-exit path still asserts everything).
 */
export function durableProbeThrottle(minIntervalMs = 1000): () => boolean {
	let lastAllowedAt = 0;
	return () => {
		const now = Date.now();
		if (now - lastAllowedAt < minIntervalMs) return false;
		lastAllowedAt = now;
		return true;
	};
}

/**
 * audit-4 RF-41(b) — the LAST (most recent) top-level session file whose user message carries
 * `promptNeedle`, or undefined. `findSessionFileByPrompt` returns the FIRST match, which is the
 * right process for "the stage's own record" — but a stall must be attributed to the process
 * that was alive at the kill, i.e. the LAST matching file when resumes added later ones.
 */
export function lastSessionFileByPrompt(sessionDir: string, promptNeedle: string): { path: string; matchedUserText: string } | undefined {
	let last: { path: string; matchedUserText: string } | undefined;
	for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
		const path = join(sessionDir, entry.name);
		try {
			for (const e of readSessionJsonl(path)) {
				if (e.type !== "message" || !isJsonObject(e.message) || e.message.role !== "user") continue;
				const text = extractMessageText(e.message.content);
				if (text.includes(promptNeedle)) {
					last = { path, matchedUserText: text };
					break; // one match per file is enough — files, not messages, are the unit
				}
			}
		} catch {
			// Same skip-not-fatal rule as findSessionFileByPrompt: another process's corrupt
			// file must not mask a healthy later match.
		}
	}
	return last;
}

/** One completed tool result as the session file records it — the durable counterpart of a streamed `tool_execution_end`. */
export interface SessionToolResult {
	isError: boolean;
	text: string;
}

/**
 * audit-4 RF-41(b) — every `toolResult` message in a session file, in file (= chronological)
 * order, as `{isError, text}`. Unlike the stdout parsers, this is immune to rolling-tail
 * truncation and carries results of tools whose streamed toolName is generic.
 */
export function sessionToolResultTexts(sessionJsonlPath: string): SessionToolResult[] {
	const results: SessionToolResult[] = [];
	for (const entry of readSessionJsonl(sessionJsonlPath)) {
		if (entry.type !== "message" || !isJsonObject(entry.message) || entry.message.role !== "toolResult") continue;
		const message = entry.message;
		const content = message.content;
		const text = Array.isArray(content)
			? content.map(block => (isJsonObject(block) && typeof block.text === "string" ? block.text : "")).join("\n")
			: typeof content === "string"
				? content
				: "";
		results.push({ isError: message.isError === true, text });
	}
	return results;
}

/** One durable lsc_run_check execution, from the session JSONL's own toolResult text. */
export interface DurableRunCheckResult {
	passed: boolean;
	text: string;
}

/** The durable, stdout-independent observation of one pipeline stage's on-disk progress. */
export interface DurableStageObservation {
	/** `.craft-state.json`'s `auditCycle`, or undefined when the state file is absent/corrupt/not yet created. */
	auditCycle: number | undefined;
	/** The highest `check/logs/check-N.log` index (0 when no log exists yet) — the fresh-execution counter. */
	checkLogIndex: number;
	/** Every lsc_run_check result text the session file records, in order — the durable run-check execution record. */
	runCheckResults: DurableRunCheckResult[];
	/** The §3.0 lsc-test-engineer spawn for `feature` (agent + assignment + durable completion state), or undefined. */
	engineerSpawn: SessionTaskSpawn | undefined;
	/** The session file the session-derived fields were read from, or undefined when not found. */
	sessionFile: string | undefined;
}

/**
 * audit-4 RF-41(b) — read one stage's durable progress record. Sync and DELIBERATELY
 * TOLERANT: this runs inside polling earlyExit predicates, so absent files (a stage that has
 * not created them yet) and mid-write corruption resolve to undefined/0/[] instead of
 * throwing — a throw here would kill a healthy run's predicate loop. Only a MATCHED session
 * file's parse surfaces through the readers that document themselves as strict
 * (readSessionJsonl); even that is caught here because a foreign corrupt file can share the
 * sessionDir.
 */
export function durableStageObservation(args: {
	worktreeRoot: string;
	feature?: string;
	sessionDir?: string;
	promptNeedle?: string;
}): DurableStageObservation {
	const feature = args.feature;
	let auditCycle: number | undefined;
	let checkLogIndex = 0;
	if (feature) {
		try {
			const state = readCraftStateFile(args.worktreeRoot, feature);
			if (typeof state?.auditCycle === "number") auditCycle = state.auditCycle;
		} catch {
			// Corrupt/unparseable state mid-poll — tolerated, see the function comment.
		}
		try {
			const logsDir = join(args.worktreeRoot, ".lsc", "crafts", feature, "check", "logs");
			if (existsSync(logsDir)) {
				for (const name of readdirSync(logsDir)) {
					const index = /^check-(\d+)\.log$/.exec(name)?.[1];
					if (index) checkLogIndex = Math.max(checkLogIndex, Number(index));
				}
			}
		} catch {
			// Unreadable logs dir mid-poll — tolerated.
		}
	}
	const runCheckResults: DurableRunCheckResult[] = [];
	let engineerSpawn: SessionTaskSpawn | undefined;
	let sessionFile: string | undefined;
	if (args.sessionDir) {
		const found = lastSessionFileByPrompt(args.sessionDir, args.promptNeedle ?? "/skill:post-craft");
		if (found) {
			sessionFile = found.path;
			try {
				for (const result of sessionToolResultTexts(found.path)) {
					if (result.text.includes(RUN_CHECK_RESULT_MARKER)) {
						runCheckResults.push({ passed: result.text.includes("passed (exit 0)"), text: result.text });
					}
				}
				if (feature) {
					engineerSpawn = sessionTaskSpawns(found.path).find(spawn => spawn.agent === "lsc-test-engineer" && spawn.taskText.includes(feature));
				}
			} catch {
				// A corrupt matched file mid-poll — tolerated (the strict readers still throw
				// when the POST-HOC assertions read the same path, so corruption is not silent).
			}
		}
	}
	return { auditCycle, checkLogIndex, runCheckResults, engineerSpawn, sessionFile };
}

/** audit-4 RF-37 — the parent-JSONL preconditions every child provider/model assertion stands on. See `presetParentPreconditions`. */
export interface PresetParentPreconditions {
	ok: boolean;
	/** One human-readable line per FAILED precondition, in evaluation order — empty when ok. */
	failures: string[];
	/** The requested agent of the marker-bound tracer/explore calls (undefined when the call itself is missing) — for composing richer child-assertion messages. */
	tracerAgent: string | undefined;
	exploreAgent: string | undefined;
}

/**
 * audit-4 RF-37 — the parent-session preconditions that MUST hold before any CHILD
 * provider/model assertion can mean anything: (1) the parent file records the preset's
 * model_change (config-load completion — without it the child ran under whatever the host had,
 * and an override miss is unprovable), and (2)+(3) the parent's own task calls requested the
 * EXACT agents the preset keys its override/inheritance expectations to (a spawn that
 * requested anything else legitimately inherits the default — check-4's explore-on-default
 * red was indistinguishable from a routing defect until these were checked FIRST). Pure:
 * no expect(), returns failures so the caller asserts and the reader-level unit regression
 * (synthetic wrong-agent parent JSONL) can pin that the precondition fires BEFORE the model
 * assertions it guards.
 */
export function presetParentPreconditions(args: {
	parentEntries: Array<Record<string, unknown>>;
	parentSpawns: SessionTaskSpawn[];
	defaultBareModel: string;
	tracerMarker: string;
	exploreMarker: string;
	tracerAgent: string;
	exploreAgent: string;
}): PresetParentPreconditions {
	const failures: string[] = [];
	const sawModelChange = args.parentEntries.some(entry => {
		if (entry.type !== "model_change" || typeof entry.model !== "string") return false;
		return (entry.model.split("/").pop() ?? entry.model) === args.defaultBareModel;
	});
	if (!sawModelChange) {
		failures.push(`config-load completion observation missing: the parent session file records no model_change to the preset default ${args.defaultBareModel}`);
	}
	const tracerCall = args.parentSpawns.find(spawn => spawn.taskText.includes(args.tracerMarker));
	if (!tracerCall) {
		failures.push(`the parent session file records no marker-bound tracer spawn (a task call whose assignment carries ${args.tracerMarker})`);
	} else if (tracerCall.agent !== args.tracerAgent) {
		failures.push(`the marker-bound tracer spawn requested agent ${tracerCall.agent ?? "<none>"} — anything other than ${args.tracerAgent} legitimately inherits the preset default`);
	}
	const exploreCall = args.parentSpawns.find(spawn => spawn.taskText.includes(args.exploreMarker));
	if (!exploreCall) {
		failures.push(`the parent session file records no marker-bound explore spawn (a task call whose assignment carries ${args.exploreMarker}) — the preset's override is keyed to the exact task-agent name`);
	} else if (exploreCall.agent !== args.exploreAgent) {
		failures.push(`the marker-bound explore spawn requested agent ${exploreCall.agent ?? "<none>"} — anything other than ${args.exploreAgent} legitimately inherits the default`);
	}
	return { ok: failures.length === 0, failures, tracerAgent: tracerCall?.agent, exploreAgent: exploreCall?.agent };
}
