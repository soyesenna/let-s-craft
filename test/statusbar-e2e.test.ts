// provider-usage-status-bar — craft Gate 0 + Gate 1, driven against the REAL omp (Bun) runtime.
//
// Harness/topology (identical to test/e2e-preset-default.test.ts): the lets-craft plugin is loaded
// by omp from package.json's `omp.extensions: ["./dist/main.js"]` via a global `omp plugin link`
// (a filesystem symlink to this repo, established once during harness development — see the header
// of test/e2e-helpers.ts). runOmpPrint() spawns `omp -p --mode=json …` against a throwaway fixture
// project and returns the NDJSON event stream + stdout/stderr. None of this can run under plain
// vitest-on-Node (Phase 1.5 finding: vitest cannot import omp SDK values), and it spends real
// provider tokens — so the ENTIRE suite is gated behind LSC_E2E=1 and self-skips otherwise. The
// default run_test.sh path never pays for it: run_test.sh invokes this file ONLY when LSC_E2E=1,
// and this `describe.skipIf(!RUN_E2E)` is the belt-and-suspenders self-gate (so a direct
// `npx vitest run test/statusbar-e2e.test.ts` without LSC_E2E=1 also spawns nothing).
//
// WHY Gate 0 is automatable here but Gate 1 is NOT:
//   `omp -p --mode=json` is PRINT/RPC mode, where `ctx.hasUI === false` (trace V5). Per the plan
//   (finding #6 / spec AC10) the ENTIRE usage-bar subsystem is hasUI-gated: the session_start/
//   switch/branch/turn_end handlers and the shortcut/command handlers all bail when !hasUI. So,
//   headless:
//     • Gate 0 — the built dist/main.js plus its two NEW runtime VALUE imports (resolveUsedFraction
//       from @oh-my-pi/pi-ai/usage and matchesKey from @oh-my-pi/pi-tui) and the
//       registerShortcut/registerCommand calls in registerUsageStatusBar(pi) LOAD without a crash —
//       IS observable: the extension's `export default function (pi)` runs at load regardless of
//       hasUI, so an unresolved value import or a throwing registration surfaces as an
//       extension-load error, whereas a clean load lets the session run to a finished turn. This is
//       the pre-mortem #5 de-risk, and a clean headless load also demonstrates the hasUI gate (the
//       subsystem loads its registration, then correctly does NO widget/overlay work in print mode).
//     • Gate 1 — the collapsed belowEditor widget rendering, the prompt staying visible, the
//       keybind/command EXPANDING a focused overlay, the overlay closing on the chord/Esc, and the
//       session_switch re-render — is NOT observable: it needs hasUI===true (an interactive Bun omp
//       TTY) and inspects RENDERED TUI frames + live keystrokes, and print mode emits an NDJSON
//       transcript, never rendered frames. Those are the documented `it.skip` manual probes below:
//       a human runs them at Gate 1 in an interactive omp session; each skipped `it` name is the
//       exact contract to eyeball, with repro steps inline. A future PTY-frame harness could promote
//       them, but the precedent harness (this file follows it) has no PTY/frame-capture capability.
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { E2E_MAIN_MODEL, REPO_ROOT, type OmpRunResult, debugSummary, runOmpPrint, setupFixtureProject } from "./e2e-helpers";

const RUN_E2E = process.env.LSC_E2E === "1";

// Gate 0 is a single one-word turn, but size the safety-net kill timeout for a slow cold start /
// provider contention, mirroring the sibling E2E files (they document the wide wall-clock tail).
const PER_RUN_TIMEOUT_MS = 300_000;
const TEST_TIMEOUT_MS = 360_000;

// The built plugin entry omp loads (package.json omp.extensions). `npm run e2e` builds first;
// guard explicitly so a stale/absent build fails with a clear message rather than a confusing
// "plugin did nothing" result.
const DIST_ENTRY = join(REPO_ROOT, "dist", "main.js");

// A distinctive one-token reply we ask the model for, so a finished assistant turn is unambiguous
// and cheap. Deliberately NOT a substring of any plugin/package/symbol name the load-failure scan
// keys on, so the reply itself can never look like a load error.
const GATE0_MARKER = "GATE0-OK";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map(part => (isJsonObject(part) && part.type === "text" && typeof part.text === "string" ? part.text : "")).join("");
}

/**
 * earlyExit predicate: a COMPLETED assistant message (`message_end`, not a partial delta) carrying
 * GATE0_MARKER has appeared in the accumulated stdout — kill the child immediately (a deliberate
 * early stop, not a timeout), rather than waiting out the session_stop continuation cap.
 */
function hasFinishedAssistant(stdout: string): boolean {
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		try {
			const event: unknown = JSON.parse(line);
			if (!isJsonObject(event) || event.type !== "message_end" || !isJsonObject(event.message)) continue;
			if (event.message.role === "assistant" && textContent(event.message.content).includes(GATE0_MARKER)) return true;
		} catch {
			// Incomplete trailing line while the child is still streaming — ignore.
		}
	}
	return false;
}

/**
 * Best-effort scan for an extension-load failure attributable to THIS feature's new runtime surface
 * — the two value imports (@oh-my-pi/pi-ai/usage, @oh-my-pi/pi-tui) or the
 * registerShortcut/registerCommand calls (Gate 0 / pre-mortem #5). Returns the offending line for a
 * useful assertion message, or undefined when the load was clean. Text-scanning matches the repo's
 * established E2E idiom (enforcement-rules.test.ts scans stdout for its own error text). A hard
 * module/extension-load error is caught anywhere in stdout/stderr/non-assistant events; the
 * feature's own symbol/package names only count as a failure when paired with an error word (so a
 * benign mention can't false-positive), and the model's own assistant text is never mined (a real
 * load error surfaces in stderr or a system/error event, not in the model's reply).
 */
function pluginLoadFailure(result: OmpRunResult): string | undefined {
	const hard = /cannot find (?:module|package)|err_module_not_found|failed to (?:load|resolve|import)|(?:error|failure) loading (?:extension|plugin)|failed to load (?:extension|plugin)/i;
	const symbol = /@oh-my-pi\/pi-ai(?:\/usage)?|@oh-my-pi\/pi-tui|resolveUsedFraction|matchesKey|registerShortcut|registerCommand/i;
	const errword = /is not a function|is not defined|is undefined|referenceerror|typeerror|\bthrow\b|\bthrew\b|\berror\b|\bfailed\b|\bcannot\b/i;

	for (const raw of `${result.stdout}\n${result.stderr}`.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		if (hard.test(line)) return line;
		if (symbol.test(line) && errword.test(line)) return line;
	}
	for (const event of result.events) {
		// Skip the model's own reply text — only mine structured/system events for hard failures.
		if (isJsonObject(event.message) && event.message.role === "assistant") continue;
		const serialized = JSON.stringify(event);
		if (hard.test(serialized)) return serialized;
	}
	return undefined;
}

const cleanupDirs: string[] = [];
afterEach(() => {
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe.skipIf(!RUN_E2E)("provider-usage-status-bar E2E (craft Gate 0 + Gate 1)", () => {
	// ─────────────────────────────────────────────────────────────────────────────────────────
	// Gate 0 — AUTOMATABLE: the built plugin loads in a real omp (Bun) session with no load error.
	// ─────────────────────────────────────────────────────────────────────────────────────────
	it(
		"Gate 0 — dist/main.js loads in a real omp (Bun) session with the pi-ai/usage + pi-tui value imports and the shortcut/command registration, with no extension-load error",
		async () => {
			expect(
				existsSync(DIST_ENTRY),
				`built plugin entry missing at ${DIST_ENTRY} — run \`npm run build\` (or \`npm run e2e\`, which builds first) before the e2e suite`,
			).toBe(true);

			const { base, projectDir, sessionDir } = setupFixtureProject();
			cleanupDirs.push(base);

			const result = await runOmpPrint({
				cwd: projectDir,
				sessionDir,
				model: E2E_MAIN_MODEL,
				timeoutMs: PER_RUN_TIMEOUT_MS,
				// Hermetic Gate 0 (review finding M3): load THIS worktree's built plugin EXPLICITLY and
				// disable global `omp plugin link` discovery, so Gate 0 smoke-tests the worktree's own
				// dist/main.js — not whatever checkout the global symlink happens to point at. Flags
				// verified via `omp --help`: `--no-extensions` disables extension discovery (explicit
				// `--extension` paths still load); `--extension <file>` loads exactly this built entry.
				extraArgs: ["--no-extensions", "--extension", DIST_ENTRY],
				prompt: `Do not call any tool. Reply with exactly the single token ${GATE0_MARKER} and nothing else.`,
				earlyExit: hasFinishedAssistant,
			});

			// Liveness: omp + the plugin ran end-to-end and did not hang. A load-time throw in
			// registerUsageStatusBar(pi), or an unresolved @oh-my-pi/pi-ai(/usage)/@oh-my-pi/pi-tui
			// value import, would abort the extension load.
			expect(result.timedOut, debugSummary(result)).toBe(false);
			const sawFinishedAssistant = result.events.some(
				event =>
					event.type === "message_end" &&
					isJsonObject(event.message) &&
					event.message.role === "assistant" &&
					textContent(event.message.content).includes(GATE0_MARKER),
			);
			expect(sawFinishedAssistant, debugSummary(result)).toBe(true);

			// The Gate 0 discriminator: no extension/value-import/registration load failure surfaced.
			// (In print mode ctx.hasUI===false, so the hasUI-gated subsystem also correctly does no
			// widget/overlay work — a clean load here is exactly "loads, then no-ops headless".)
			const failure = pluginLoadFailure(result);
			expect(failure, `unexpected plugin-load failure in the omp output:\n${failure}\n\n${debugSummary(result)}`).toBeUndefined();
		},
		TEST_TIMEOUT_MS,
	);

	// ─────────────────────────────────────────────────────────────────────────────────────────
	// Gate 1 — MANUAL/INTERACTIVE probes (documented skips). Each needs ctx.hasUI===true (an
	// interactive Bun omp TTY) and inspects RENDERED TUI frames + live keystrokes. `omp -p
	// --mode=json` (this harness) is print/RPC mode with hasUI===false and emits an NDJSON
	// transcript, never rendered frames — and the whole usage-bar subsystem is hasUI-gated, so
	// nothing about the bar appears headlessly. They stay `it.skip` manual probes: run `omp`
	// interactively (built dist, ≥1 logged-in provider account) and eyeball each named contract.
	// ─────────────────────────────────────────────────────────────────────────────────────────
	it.skip("Gate 1a — collapsed bar renders belowEditor and the prompt stays visible (rows ≤ deriveMaxRows(terminal.rows)) at a normal height AND a ~10-row terminal with a tall transcript", () => {
		// Manual: open omp interactively in a project with a logged-in account. Expect a compact
		// usage bar directly UNDER the prompt input (never a footer/header/status bar). Then shrink
		// the terminal to ~10 rows with scrollback above: the bar must stay row-bounded and the
		// prompt must remain on-screen (never scrolled off), and the tiny-height ladder (header + one
		// synthesized "<top-risk> · +N more" row at maxRows=2) should read sensibly. Tune
		// RESERVE_ROWS/MAX_BAR_ROWS if it crowds the prompt. (plan §6 Step 5 Gate 1(a), §9)
	});

	it.skip("Gate 1b — the shortcut chord AND the /usage-bar command each EXPAND the overlay, and the chord does not type into the prompt", () => {
		// Manual: with the collapsed bar showing, press the registered TOGGLE_CHORD — the expanded
		// overlay opens and NO chord character is inserted into the prompt (editor custom-key-handler
		// routing, trace V1). Close it, then run `/usage-bar` — the SAME expanded overlay opens. Both
		// transports EXPAND (the slash command is open-only while modal). (plan §6 Step 5 Gate 1(b))
	});

	it.skip("Gate 1c — the focused normal-buffer overlay shows full per-account × per-window detail, scrolls, and closes on the SAME chord OR Esc, restoring the collapsed bar + transcript intact", () => {
		// Manual: in the expanded overlay, confirm every account and every window renders (one window
		// per line, no `+N more`, no elision), that scrolling works for tall content, and that
		// pressing the same chord OR Esc closes it (its own handleInput via matchesKey). On close the
		// persistent collapsed bar is still underneath and the transcript/prompt are intact —
		// normal-buffer restoration, NOT an alt-screen swap. (plan §6 Step 5 Gate 1(c), DR-G, V3/V4)
	});

	it.skip("Gate 1d — the collapsed bar re-renders after session_switch (omp clears extension hook widgets on switch/branch)", () => {
		// Manual: trigger a session_switch (and a session_branch) in the interactive session. omp
		// clears extension hook widgets on switch, so the controller's start() → renderCollapsed must
		// repaint the collapsed bar for the new session. Confirm the bar reappears, correctly
		// attributed to the switched-to session's accounts. (plan §6 Step 5 handlers; AC6/AC10)
	});

	it.skip("Gate 1e — no leftover overlay after session_switch/shutdown, and a stale overlay close never flips a reopened overlay (overlayGeneration guard)", () => {
		// Manual: open the overlay, then session_switch/shutdown — the overlay must tear down (no
		// leaked focus, no render-after-teardown). Then exercise close → reopen quickly: a late
		// settlement of the OLD overlay's done()/onClose must NOT close the newly-reopened overlay
		// (per-open ownDone + overlayGeneration guard, findings #4/#7). (plan §6 Step 1; pre-mortem #7)
	});
});
