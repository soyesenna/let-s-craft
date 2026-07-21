// E1 / E2 — ask-readability-option-chat, driven against the REAL omp (Bun) runtime.
//
// Two acceptance stories live here, both gated behind LSC_E2E=1 (self-skips otherwise —
// the sibling e2e files' convention: statusbar-e2e.test.ts, enforcement-rules.test.ts,
// e2e-full-cycle.test.ts). `npm test` (vitest run) never pays for them; `npm run e2e` /
// the PR1 hard gate does.
//
//   E1 (AC2.1 + AC2.4) — the PR1 hard-gate "real plugin boot / loadMode exposure" smoke:
//     boot THIS worktree's built dist/main.js inside the npm-published omp 17.0.5 runtime
//     and prove (a) the 17.0.5 lockstep bump does not break extension load (AC2.1's
//     "loads without crash" half), and (b) EACH of the three ask tools is exposed
//     **essential** (top-level, called directly) while a representative batch tool is
//     **discoverable** (`xd://` device) — AC2.4. Each ask tool is driven ONCE from a
//     kind-tagged fixture script (confirm / select / free-text) behind its OWN positive
//     guard (`execs.some(toolName === X)`) so the essential assertion for a tool can never
//     pass vacuously when an uncooperative model skipped it (N3); up to two resumes coax a
//     cheap model into calling all four tools.
//
//     AC2.1's *other* half — "전 모듈 tsc 컴파일 + 기존 vitest 전 스위트 green after the
//     bump" — is NOT (and cannot honestly be) re-run from inside one vitest file: it is the
//     job of the PR1 hard gate / run_test.sh (a clean `npm ci` build + the full `vitest run`).
//     This file proves only the parts observable in isolation: the built artifact exists
//     (a proxy for "tsc built"), the plugin boots clean, and the loadMode split is real.
//
//   E2 (AC2.2) — fixture-mode pipeline stays unattended and never exposes a chat affordance:
//     an `-p` run with LSC_FIXTURE configured answers every question from the script, the
//     side-chat completion factory is never invoked (fixture branch bypasses the custom<T>
//     mount entirely — plan §Guardrails "fixture/unavailable branch는 factory를 호출하지 않음"),
//     and no `xd://`-side-chat / completion artifact appears in the transcript.
//
// loadMode DISCRIMINATOR (grounded, not invented). In the omp runtime a **discoverable**
// extension tool is mounted under the `xd://` virtual device and the model reaches it by a
// `write` to `xd://<tool>`; an **essential** tool is a top-level tool the model calls by name
// directly (no `xd://` indirection). This repo already encodes exactly that convention and
// unit-tests it: src/craft/latency-report.ts's `HUMAN_GATE_PATH_PREFIXES` /
// `isHumanGateToolStart` treat a `write` to `xd://lsc_{select,confirm,ask}` as the human-input
// gate (test/latency-report.test.ts:178-189). TODAY (loadMode unset ⇒ runtime-discoverable,
// plan §OQ1) the ask tools appear under `xd://…`; PR1 flips the ask trio to `essential`, so the
// `xd://lsc_{ask,select,confirm}` marker must DISAPPEAR for them while it stays present for the
// batch tools. The discriminator here scans the union of the `-p --mode=json` stdout AND every
// persisted session `*.jsonl` (where tool_execution_start entries carry `args.path` verbatim —
// the shape latency-report.ts parses) for that marker, so it is robust to which stream omp
// records the raw invocation in.
//
// NOTE ON EXPECTED STATE (pre-craft): the feature is unimplemented, so a live E1 run today
// FAILS the essential half (ask tools are still discoverable → `xd://lsc_*` present) — that
// is the correct RED for an unbuilt feature. In normal collection (LSC_E2E unset) the whole
// describe is skipped, which is this file's reported pre-craft state.
//
// FAIL-CLOSED GATE (P4 / v2 §7). run_test.sh runs the live smoke with `LSC_E2E=1
// LSC_E2E_STRICT=1`. Under LSC_E2E_STRICT a missing prerequisite (no omp / wrong version /
// no dist) is a HARD FAIL, not a skip (`prereqGate` below) — the acceptance profile must
// never report green without the live proof. Bare `LSC_E2E=1` (a dev exploring locally
// without STRICT) still soft-skips on a missing prerequisite.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { E2E_MAIN_MODEL, REPO_ROOT, type OmpRunResult, debugSummary, runOmpPrint, toolExecutions } from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

// Safety-net per-invocation kill timeout; every run exits far sooner via `earlyExit` once the
// DONE marker lands. Sized like the sibling e2e files for cold-start / provider contention.
const PER_RUN_TIMEOUT_MS = 300_000;
// Three omp invocations worst case (initial + two resumes, N3); earlyExit settles each far
// sooner once its DONE marker lands, so real runs are well under this cap.
const TEST_TIMEOUT_MS = 720_000;

// The npm-published channel this smoke pins (Constraint 1/2: 17.0.5 lockstep, and 17.0.0's
// registerTool demotion bug is why it is exactly 17.0.5, not any 17.x).
const REQUIRED_OMP_VERSION = "17.0.5";

// The built plugin entry omp loads (package.json omp.extensions). REPO_ROOT is the worktree
// root (e2e-helpers computes it two levels up from itself), so this is the WORKTREE's own build.
const DIST_ENTRY = join(REPO_ROOT, "dist", "main.js");

// The three ask tools PR1 marks `loadMode: "essential"` (plan §OQ1 table).
const ASK_TOOLS = ["lsc_ask", "lsc_select", "lsc_confirm"] as const;
// A representative `loadMode: "discoverable"` batch tool — read-only diagnostic, safe + input-free
// to invoke in a throwaway project (no fixture needed, no side effects). One of the 13 batch tools.
const BATCH_PROBE_TOOL = "lsc_doctor";

const DONE_MARKER = "E1-LOADMODE-DONE";
const E2_DONE_MARKER = "E2-FIXTURE-DONE";

// LSC_E2E_STRICT (set by run_test.sh alongside LSC_E2E=1 for the acceptance gate, per critic
// P4 / v2 §7): flips a missing prerequisite from a soft ctx.skip() to a hard expect.fail().
const RUN_E2E_STRICT = process.env.LSC_E2E_STRICT === "1";

// A missing prerequisite is fail-closed under the explicit gate and soft-skip otherwise. Both
// branches abort the test (expect.fail / ctx.skip throw), so callers treat this as `never`.
function prereqGate(ctx: { skip: (reason: string) => void }, ok: boolean, reason: string): void {
	if (ok) return;
	if (RUN_E2E_STRICT) expect.fail(`[LSC_E2E_STRICT] ${reason}`);
	ctx.skip(reason);
}

// E1 fixture script — each ask tool is answered by exactly one kind-tagged rule, matched on the
// tool's question text. The prompt tells the model the exact wording + the two select labels so
// the `selection` rule resolves. The default is a confirmation (never free-text — a free-text
// default is rejected by the fixture loader and would trap unmatched questions in a re-ask loop).
const E1_CONFIRM_Q = "Proceed with the loadmode smoke?";
const E1_SELECT_Q = "Pick a smoke-test color?";
const E1_SELECT_LABELS = ["Amber", "Blue"] as const;
const E1_ASK_Q = "Give a one-word free-text codename for this smoke run.";
const E1_ASK_ANSWER = "loadmode-smoke-ok";

type JsonObject = Record<string, unknown>;
function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map(part => (isJsonObject(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

/** `omp --version` (`omp/17.0.5`) → the semver, or undefined when the binary is absent. */
function ompVersion(): string | undefined {
	try {
		const out = execFileSync("omp", ["--version"], { encoding: "utf8" });
		return /(\d+\.\d+\.\d+)/.exec(out)?.[1];
	} catch {
		return undefined;
	}
}

/** earlyExit predicate: a COMPLETED assistant message (`message_end`, not a partial delta) carrying `marker`. */
function finishedAssistantWith(marker: string): (stdout: string) => boolean {
	return stdout => {
		for (const line of stdout.split("\n")) {
			if (!line.trim()) continue;
			try {
				const event: unknown = JSON.parse(line);
				if (!isJsonObject(event) || event.type !== "message_end" || !isJsonObject(event.message)) continue;
				if (event.message.role === "assistant" && textContent(event.message.content).includes(marker)) return true;
			} catch {
				// Incomplete trailing line while streaming — ignore.
			}
		}
		return false;
	};
}

/**
 * Best-effort scan for an extension-load failure attributable to THIS feature's new runtime
 * surface — the 17.0.5 bump (pi-ai/pi-tui/pi-coding-agent value imports) or the new src/ask-ui/
 * Bun leaves and their custom<T>/resolver/completeSimple wiring. Mirrors statusbar-e2e.test.ts's
 * idiom: a hard module/extension-load error counts anywhere; a feature symbol only counts as a
 * failure when paired with an error word, and the model's own reply text is never mined.
 */
function pluginLoadFailure(result: OmpRunResult): string | undefined {
	const hard = /cannot find (?:module|package)|err_module_not_found|failed to (?:load|resolve|import)|(?:error|failure) loading (?:extension|plugin)|failed to load (?:extension|plugin)/i;
	const symbol = /@oh-my-pi\/pi-(?:ai|tui|coding-agent)|ask-ui|createAskRuntimeFactory|completeSimple|\bresolver\b|ctx\.ui\.custom/i;
	const errword = /is not a function|is not defined|is undefined|referenceerror|typeerror|\bthrow\b|\bthrew\b|\berror\b|\bfailed\b|\bcannot\b/i;

	for (const raw of `${result.stdout}\n${result.stderr}`.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		if (hard.test(line)) return line;
		if (symbol.test(line) && errword.test(line)) return line;
	}
	for (const event of result.events) {
		if (isJsonObject(event.message) && event.message.role === "assistant") continue;
		const serialized = JSON.stringify(event);
		if (hard.test(serialized)) return serialized;
	}
	return undefined;
}

/** Concatenate every persisted session transcript under `sessionDir` — the `*.jsonl` files carry
 * tool_execution_start entries whose `args.path` records the raw `xd://…` invocation verbatim. */
function sessionTranscripts(sessionDir: string): string {
	if (!existsSync(sessionDir)) return "";
	const acc: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				try {
					acc.push(readFileSync(full, "utf8"));
				} catch {
					// A file racing with the killed child — best-effort.
				}
			}
		}
	};
	walk(sessionDir);
	return acc.join("\n");
}

/** True iff the tool `name` was reached via the `xd://` discoverable-device path anywhere in the transcripts. */
function invokedViaXd(transcript: string, name: string): boolean {
	return transcript.includes(`xd://${name}`);
}

/** A minimal throwaway git project + a fixture answers.json kept OUTSIDE the repo (so it never
 * pollutes what the plugin/git see), scripting a kind-tagged answer for each of the three ask
 * tools (confirm=yes, select=a labeled option, ask=free text) so E1 can drive all three
 * deterministically in headless mode without hanging on interactive input. */
function setupLoadModeProject(): { base: string; projectDir: string; sessionDir: string; answersPath: string } {
	const base = mkdtempSync(join(tmpdir(), "lsc-e2e-loadmode-"));
	const projectDir = join(base, "project");
	const fixtureDir = join(base, "fixture");
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(fixtureDir, { recursive: true });
	writeFileSync(join(projectDir, "README.md"), "# loadMode boot smoke fixture\n");
	const answersPath = join(fixtureDir, "answers.json");
	writeFileSync(
		answersPath,
		JSON.stringify(
			{
				version: 2,
				answers: [
					{ match: "loadmode|proceed", kind: "confirmation", confirm: true },
					{ match: "pick|colou?r|smoke-test color", kind: "selection", selections: [E1_SELECT_LABELS[0]] },
					{ match: "codename|free.?text|one-word", kind: "free-text", freeText: E1_ASK_ANSWER },
				],
				// Confirmation (never free-text — the loader rejects a free-text default): an
				// unmatched question fails fast rather than trapping the run in a re-ask loop.
				default: { kind: "confirmation", confirm: true },
			},
			null,
			2,
		),
	);
	execFileSync("git", ["init", "-q"], { cwd: projectDir });
	execFileSync("git", ["config", "user.email", "lsc-e2e@example.com"], { cwd: projectDir });
	execFileSync("git", ["config", "user.name", "lsc-e2e"], { cwd: projectDir });
	execFileSync("git", ["add", "-A"], { cwd: projectDir });
	execFileSync("git", ["commit", "-q", "-m", "chore: seed loadMode smoke fixture"], { cwd: projectDir });
	return { base, projectDir, sessionDir: join(base, "omp-sessions"), answersPath };
}

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe.skipIf(!RUN_E2E)("ask-ui real-omp smoke (E1 loadMode boot, E2 fixture unattended)", () => {
	// ─────────────────────────────────────────────────────────────────────────────────────────
	// E1 — AC2.1 (clean boot after the 17.0.5 bump) + AC2.4 (ask essential / batch discoverable).
	// ─────────────────────────────────────────────────────────────────────────────────────────
	it(
		"E1 — the built plugin boots in npm-published omp 17.0.5 and exposes EACH of ask 3종 essential (direct) while a batch tool is discoverable (xd://)",
		async ctx => {
			// Fail-closed under the explicit gate (P4 / v2 §7): a missing prerequisite is a hard
			// FAIL when LSC_E2E_STRICT=1 (run_test.sh sets it), a soft skip under bare LSC_E2E=1.
			const version = ompVersion();
			prereqGate(ctx, version !== undefined, "`omp` binary is not on PATH — the npm-published 17.0.5 omp runtime is required for the loadMode boot smoke");
			prereqGate(ctx, version === REQUIRED_OMP_VERSION, `omp ${version} is on PATH, but this smoke pins the npm-published ${REQUIRED_OMP_VERSION} channel (Constraint 1/2; 17.0.0 registerTool demotion bug)`);
			prereqGate(ctx, existsSync(DIST_ENTRY), `built plugin missing at ${DIST_ENTRY} — run \`npm run build\` (the PR1 hard gate builds first, from a clean \`npm ci\`) before the loadMode boot smoke`);

			const { base, projectDir, sessionDir, answersPath } = setupLoadModeProject();
			cleanupDirs.push(base);

			// Drive all THREE ask tools (confirm / select / free-text ask) each ONCE, plus the batch
			// probe — each ask tool has its own fixture rule (setupLoadModeProject) matched on its
			// question. The select labels are dictated so the `selection` fixture rule resolves.
			const selectOptionsLine = E1_SELECT_LABELS.map(l => `label "${l}" (description "smoke option ${l}")`).join(" and ");
			const initialPrompt = [
				"You are inside an automated tool-exposure smoke test. Do EXACTLY these four steps in order,",
				"calling each tool exactly once, then stop:",
				`1) Call lsc_confirm with question "${E1_CONFIRM_Q}".`,
				`2) Call lsc_select with question "${E1_SELECT_Q}" and exactly two options: ${selectOptionsLine}.`,
				`3) Call lsc_ask with question "${E1_ASK_Q}".`,
				`4) Run the ${BATCH_PROBE_TOOL} diagnostic tool (it needs no arguments).`,
				`Then reply with exactly the single token ${DONE_MARKER} and nothing else. Do not call any other tools.`,
			].join("\n");

			const runArgs = (prompt: string, resume: boolean) => ({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				env: { LSC_FIXTURE: answersPath },
				// Hermetic: load THIS worktree's built plugin explicitly and disable global
				// `omp plugin link` discovery, so the smoke observes the worktree's own dist/main.js
				// loadMode split — not whatever checkout the global symlink points at.
				extraArgs: [...(resume ? ["--continue"] : []), "--no-extensions", "--extension", DIST_ENTRY],
				prompt,
				earlyExit: finishedAssistantWith(DONE_MARKER),
			});

			const attempts: OmpRunResult[] = [await runOmpPrint(runArgs(initialPrompt, false))];
			const ranTool = (name: string) => attempts.flatMap(toolExecutions).some(e => e.toolName === name);
			const batchSeen = () => ranTool(BATCH_PROBE_TOOL) || invokedViaXd(sessionTranscripts(sessionDir), BATCH_PROBE_TOOL);
			// Up to TWO resumes (N3): a cheap model sometimes stops after the first tool or two.
			const MAX_RESUMES = 2;
			for (let r = 0; r < MAX_RESUMES && !(ASK_TOOLS.every(t => ranTool(t)) && batchSeen()); r++) {
				if (attempts[attempts.length - 1].timedOut) break;
				const missing = [...ASK_TOOLS.filter(t => !ranTool(t)), ...(batchSeen() ? [] : [BATCH_PROBE_TOOL])];
				attempts.push(
					await runOmpPrint(
						runArgs(
							`Continue the smoke: you still have not called: ${missing.join(", ")}. Call each of those exactly once (reuse the same question wording as instructed before), then reply ${DONE_MARKER}.`,
							true,
						),
					),
				);
			}
			const last = attempts[attempts.length - 1];
			const execs = attempts.flatMap(toolExecutions);
			const transcript = [...attempts.map(a => a.stdout), sessionTranscripts(sessionDir)].join("\n");

			// (1) Liveness + clean boot: omp + the plugin ran end-to-end, and the 17.0.5 bump did not
			//     break the extension load (AC2.1 "loads without crash").
			expect(last.timedOut, debugSummary(last)).toBe(false);
			const loadFailure = attempts.map(pluginLoadFailure).find(f => f !== undefined);
			expect(loadFailure, `unexpected plugin-load failure after the 17.0.5 bump:\n${loadFailure}\n\n${debugSummary(last)}`).toBeUndefined();

			// (2) Per-tool positive guard (N3): EACH ask tool actually executed, and so did the batch
			//     probe. An uncooperative model that skipped a tool fails HERE — so no essential
			//     assertion below can pass vacuously for a tool that never ran.
			for (const tool of ASK_TOOLS) {
				expect(
					execs.some(e => e.toolName === tool),
					`ask tool ${tool} never executed across ${attempts.length} attempt(s) — cannot judge its loadMode (N3 positive guard).\n${debugSummary(last)}`,
				).toBe(true);
			}
			expect(batchSeen(), `batch probe ${BATCH_PROBE_TOOL} never executed — cannot judge the discoverable half.\n${debugSummary(last)}`).toBe(true);

			// (3) AC2.4 essential: EACH ask tool is called DIRECTLY (top-level), never via the xd://
			//     discoverable device. PRE-CRAFT: this is the half that legitimately RED's until PR1
			//     flips the ask trio from the runtime-default discoverable to essential.
			for (const tool of ASK_TOOLS) {
				expect(
					invokedViaXd(transcript, tool),
					`ask tool ${tool} was reached via xd:// (discoverable) — PR1 must expose it essential (top-level).\n${debugSummary(last)}`,
				).toBe(false);
			}

			// (4) AC2.4 discoverable: the representative batch tool IS mounted under xd://.
			expect(
				invokedViaXd(transcript, BATCH_PROBE_TOOL),
				`batch tool ${BATCH_PROBE_TOOL} was not observed under xd:// — a discoverable batch tool must mount there.\n${debugSummary(last)}`,
			).toBe(true);
		},
		TEST_TIMEOUT_MS,
	);

	// ─────────────────────────────────────────────────────────────────────────────────────────
	// E2 — AC2.2: fixture mode runs unattended, never exposes a chat affordance, never invokes the
	// side-chat completion factory (fixture branch bypasses the custom<T> mount entirely).
	// ─────────────────────────────────────────────────────────────────────────────────────────
	it(
		"E2 — LSC_FIXTURE mode answers from the script with no chat affordance and no completion/side-chat artifact",
		async ctx => {
			// Same fail-closed gate as E1 (P4 / v2 §7).
			const version = ompVersion();
			prereqGate(ctx, version !== undefined, "`omp` binary is not on PATH — required for the fixture-mode E2 smoke");
			prereqGate(ctx, version === REQUIRED_OMP_VERSION, `omp ${version} on PATH, this smoke pins ${REQUIRED_OMP_VERSION}`);
			prereqGate(ctx, existsSync(DIST_ENTRY), `built plugin missing at ${DIST_ENTRY} — build before the fixture-mode E2 smoke`);

			const { base, projectDir, sessionDir, answersPath } = setupLoadModeProject();
			cleanupDirs.push(base);

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				env: { LSC_FIXTURE: answersPath },
				extraArgs: ["--no-extensions", "--extension", DIST_ENTRY],
				prompt: [
					`Call the lsc_confirm tool exactly once with question "${E1_CONFIRM_Q}",`,
					`report the single-word result it returns, then reply with exactly ${E2_DONE_MARKER}. Do not call any other tools.`,
				].join("\n"),
				earlyExit: finishedAssistantWith(E2_DONE_MARKER),
			});

			expect(result.timedOut, debugSummary(result)).toBe(false);
			expect(pluginLoadFailure(result), debugSummary(result)).toBeUndefined();

			// Scripted answer is delivered verbatim (the confirm returns `yes` from the fixture).
			const confirm = toolExecutions(result).find(e => e.toolName === "lsc_confirm");
			expect(confirm, `lsc_confirm never executed under fixture mode.\n${debugSummary(result)}`).toBeDefined();
			expect(confirm?.isError, debugSummary(result)).toBe(false);
			expect(confirm?.text.trim().toLowerCase(), debugSummary(result)).toBe("yes");

			// The fixture branch bypasses the custom<T> mount and the completion factory entirely:
			// no side-chat details and no side sessionId ever appear in the run.
			//
			// N4: the effective negative signal is `"sideChat"` (the details.sideChat key) and
			// `:side:` (the side sessionId `{main}:side:{nonce}`) ONLY. The former snake_case prongs
			// (cache_read_input_tokens / cache_creation_input_tokens) were DEAD — pi-ai's domain
			// usage is camelCase (`usage.cacheRead` / `cacheWrite`, pi-catalog types.ts), so those
			// wire-format strings never appear in omp stdout/jsonl. A bare `cacheRead` is
			// deliberately NOT added: the MAIN model's own usage carries it and would false-fail.
			const transcript = [result.stdout, sessionTranscripts(sessionDir)].join("\n");
			expect(/"sideChat"|:side:/i.test(transcript), debugSummary(result)).toBe(false);
		},
		TEST_TIMEOUT_MS,
	);
});
