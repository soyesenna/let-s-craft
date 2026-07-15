#!/usr/bin/env bun
/**
 * adapter-probe.mts — deterministic Bun fake-host probe of the REAL usage-bar adapter.
 * ─────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS (closes the fake-self-test gap, review finding C3):
 *   The load-bearing impure `src/statusbar/index.ts` (`registerUsageStatusBar`) wires the pure
 *   controller/gather/view-model/render layers to the real omp host — the hasUI gates, the
 *   `belowEditor` widget, the `ctx.ui.custom({overlay:true})` overlay, the per-open `ownDone`
 *   lifecycle, the `clear`-does-not-close rule, and the dedupe/notify-once reporter. Until now it
 *   had NO SUT-level automated test: `statusbar-controller.test.ts` validly tests controller LOGIC,
 *   but against a hand-written `FakeSink`/local `sessionStart` that ALREADY reimplement the correct
 *   behaviour — so a wrong `index.ts` (missing the hasUI gate, or missing `ownDone`) stays GREEN.
 *   This probe drives the REAL registrar through a fake omp host and OBSERVES the adapter itself.
 *
 * WHY BUN, NOT VITEST-ON-NODE:
 *   `index.ts` VALUE-imports the Bun-only `@oh-my-pi/pi-ai/usage` (resolveUsedFraction) and
 *   `@oh-my-pi/pi-tui` (matchesKey). vitest-on-Node cannot import those SDK values (the Phase-1.5
 *   finding that split the whole suite). Bun IS the omp runtime, so it loads them cleanly. This
 *   file is therefore a Bun script run OUTSIDE the vitest include; run_test.sh invokes it with
 *   `bun` from the source root, guarded on `command -v bun`.
 *
 * DETERMINISM (no real omp / model / network / advancing time):
 *   - the omp `ExtensionAPI` + `ExtensionContext` are hand-built fakes below;
 *   - `authStorage` returns fixtures (or rejects on demand) — never a real fetch;
 *   - `ctx.ui` records `setWidget`/`custom`/`notify` — never a real TUI;
 *   - events are dispatched synchronously; async settles via a bounded microtask `flush()`.
 *   The adapter's own `clock`/`scheduler` are the real `Date.now`/`setInterval` it hard-wires, but
 *   the 5-minute interval never fires inside a seconds-long run; we drive every refresh by hand and
 *   tear the interval down at the end, so the outcome is fully deterministic.
 *
 * GUARDS (the expected pre-craft RED):
 *   - not under Bun            → exit 2 (wrong runtime);
 *   - dist/statusbar/index.js absent → exit 3 (NOT YET BUILT — the correct pre-craft RED);
 *   - export missing           → exit 4;  module load / value-import throws → exit 5.
 *   `LSC_ADAPTER_DIST_ENTRY` overrides the built path (used to verify the probe against a throwaway
 *   reference build without touching the worktree; unset in normal runs).
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type KeyId, matchesKey } from "@oh-my-pi/pi-tui";

// ── Runtime guards ──────────────────────────────────────────────────────────────────────
if (!("Bun" in globalThis)) {
	console.error("adapter-probe: MUST run under Bun — index.ts value-imports the Bun-only");
	console.error("  @oh-my-pi/pi-ai(/usage) + @oh-my-pi/pi-tui runtimes vitest-on-Node cannot load.");
	console.error("  Invoke as:  bun .../assets/test/adapter-probe.mts   (run_test.sh does this).");
	process.exit(2);
}

const DIST_ENTRY = process.env.LSC_ADAPTER_DIST_ENTRY ?? resolve(process.cwd(), "dist", "statusbar", "index.js");
if (!existsSync(DIST_ENTRY)) {
	console.error(`adapter-probe: built adapter entry not found:\n  ${DIST_ENTRY}`);
	console.error("  Build it (npm run build → tsc emits dist/statusbar/index.js from src/statusbar/).");
	console.error("  PRE-CRAFT: src/statusbar/ is not implemented yet, so this MISSING built artifact IS");
	console.error("  the correct, expected RED — the probe is red for exactly one reason (no adapter).");
	process.exit(3);
}

// ── Fake host contract — the exact slice of the omp SDK the adapter touches ───────────────
type ExtEvent = { type: string };
type ExtHandler = (event: ExtEvent, ctx: FakeCtx) => unknown;
type ToggleHandler = (ctx?: FakeCtx) => unknown;

interface OnRecord {
	event: string;
	handler: ExtHandler;
}
interface CommandRecord {
	name: string;
	options: { description?: string; handler: ToggleHandler };
}
interface ShortcutRecord {
	shortcut: KeyId;
	options: { description?: string; handler: ToggleHandler };
}
interface FakeExtensionApi {
	on(event: string, handler: ExtHandler): void;
	registerCommand(name: string, options: { description?: string; handler: ToggleHandler }): void;
	registerShortcut(shortcut: KeyId, options: { description?: string; handler: ToggleHandler }): void;
}

type UiComponent = {
	render?: (width: number) => unknown;
	handleInput?: (data: string) => unknown;
	dispose?: () => void;
};
type CustomFactory = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result?: unknown) => void,
) => UiComponent | Promise<UiComponent>;

interface SetWidgetCall {
	key: string;
	content: unknown;
	options?: { placement?: string };
}
interface CustomCall {
	options?: { overlay?: boolean };
	component?: UiComponent;
	settled: boolean;
	done: (result?: unknown) => void;
}
interface NotifyCall {
	message: string;
	type?: string;
}

// Fixtures produced by the fake authStorage. Kept structurally minimal — only the fields the
// gather → view-model → render pipeline reads. Loose (`unknown`) at the seams the adapter forwards
// verbatim into the SDK's own `UsageReport` shape.
interface StoredCredential {
	id: number;
	provider: string;
	credential: { type: string };
	disabledCause: string | null;
}
interface OAuthAccount {
	position: number;
	credentialId: number;
	accountId?: string;
	email?: string;
	projectId?: string;
}
interface UsageReportLike {
	provider: string;
	fetchedAt: number;
	limits: unknown[];
	metadata?: Record<string, unknown>;
}
type AuthStorageMode = "full" | "empty" | "reject";

const NOW = Date.now();

// A single clean, unambiguous account+report so any DR-F-conformant view-model attributes it
// (matching accountId AND email, no conflict) and yields a non-empty VM → renderCollapsed fires.
function fullReports(): UsageReportLike[] {
	return [
		{
			provider: "anthropic",
			fetchedAt: NOW,
			metadata: { email: "user@example.com", accountId: "acc-1" },
			limits: [
				{
					id: "l-5h",
					label: "5h",
					scope: { provider: "anthropic", accountId: "acc-1" },
					window: { id: "5h", label: "5 Hour", resetsAt: NOW + 3_600_000 },
					amount: { usedFraction: 0.33, unit: "percent" },
				},
			],
		},
	];
}

class FakeAuthStorage {
	mode: AuthStorageMode = "full";
	listStoredCount = 0;
	listOAuthCalls: string[] = [];
	fetchCount = 0;

	listStoredCredentials(_provider?: string): StoredCredential[] {
		this.listStoredCount++;
		if (this.mode === "empty") return [];
		return [{ id: 1, provider: "anthropic", credential: { type: "oauth" }, disabledCause: null }];
	}

	listOAuthAccounts(provider: string): OAuthAccount[] {
		this.listOAuthCalls.push(provider);
		if (this.mode === "empty") return [];
		if (provider !== "anthropic") return [];
		return [{ position: 0, credentialId: 1, accountId: "acc-1", email: "user@example.com" }];
	}

	async fetchUsageReports(_options?: { signal?: AbortSignal }): Promise<UsageReportLike[] | null> {
		this.fetchCount++;
		if (this.mode === "reject") throw new Error("adapter-probe: injected fetchUsageReports failure");
		if (this.mode === "empty") return [];
		return fullReports();
	}
}

class FakeUi {
	setWidgetCalls: SetWidgetCall[] = [];
	customCalls: CustomCall[] = [];
	notifyCalls: NotifyCall[] = [];
	readonly theme: unknown = makeUniversal();

	setWidget(key: string, content: unknown, options?: { placement?: string }): void {
		this.setWidgetCalls.push({ key, content, options });
	}

	custom(factory: CustomFactory, options?: { overlay?: boolean }): Promise<unknown> {
		const call: CustomCall = { options, settled: false, done: () => {} };
		let resolveP: (value?: unknown) => void = () => {};
		const promise = new Promise<unknown>(res => {
			resolveP = res;
		});
		// Faithful to omp: `done` resolves the overlay's promise at MOST once (idempotent).
		const done = (result?: unknown): void => {
			if (call.settled) return;
			call.settled = true;
			resolveP(result);
		};
		call.done = done;
		this.customCalls.push(call);
		const built = factory(makeUniversal(), this.theme, makeUniversal(), done);
		if (built instanceof Promise) {
			void built.then(component => {
				call.component = component;
			});
		} else {
			call.component = built;
		}
		return promise;
	}

	notify(message: string, type?: string): void {
		this.notifyCalls.push({ message, type });
	}

	warningNotifies(): NotifyCall[] {
		return this.notifyCalls.filter(n => n.type === "warning");
	}
}

interface FakeCtx {
	hasUI: boolean;
	cwd: string;
	ui: FakeUi;
	modelRegistry: { authStorage: FakeAuthStorage };
}

/**
 * A self-referential no-op used for the `tui`/`theme`/`keybindings` the adapter forwards into its
 * component factories: any property access returns itself, any call returns itself, and it coerces
 * to "". The probe never renders to a real screen, so a component that reads theme/tui at
 * construction time can't throw — while the assertions below observe adapter WIRING, not rendered
 * pixels (renderRows/styleRow correctness is owned by statusbar-render.test.ts).
 */
function makeUniversal(): unknown {
	const target = (): unknown => handle;
	const handle: unknown = new Proxy(target, {
		get: (_t, prop) => {
			if (prop === Symbol.toPrimitive || prop === "toString" || prop === Symbol.toStringTag) return () => "";
			if (prop === "rows" || prop === "columns") return 40;
			return handle;
		},
		apply: () => handle,
	});
	return handle;
}

// ── Load the REAL adapter ─────────────────────────────────────────────────────────────────
let register: ((pi: FakeExtensionApi) => void) | undefined;
try {
	const mod: Record<string, unknown> = await import(pathToFileURL(DIST_ENTRY).href);
	const exported = mod.registerUsageStatusBar ?? mod.default;
	if (typeof exported === "function") {
		const fn = exported;
		register = (pi: FakeExtensionApi): void => {
			fn(pi);
		};
	}
} catch (err) {
	console.error(`adapter-probe: FAILED to load the built adapter (${DIST_ENTRY}) — value-import / init error:`);
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(5);
}
if (register === undefined) {
	console.error(`adapter-probe: ${DIST_ENTRY} exports no callable registerUsageStatusBar (named) or default.`);
	process.exit(4);
}

// ── One-time registration + dispatch harness ────────────────────────────────────────────────
const onRecords: OnRecord[] = [];
const commandRecords: CommandRecord[] = [];
const shortcutRecords: ShortcutRecord[] = [];

const api: FakeExtensionApi = {
	on(event, handler) {
		onRecords.push({ event, handler });
	},
	registerCommand(name, options) {
		commandRecords.push({ name, options });
	},
	registerShortcut(shortcut, options) {
		shortcutRecords.push({ shortcut, options });
	},
};
register(api);

function handlerFor(event: string): ExtHandler {
	const record = onRecords.find(r => r.event === event);
	assert.ok(record, `adapter did not subscribe to "${event}"`);
	return record.handler;
}
function dispatch(event: string, ctx: FakeCtx): unknown {
	return handlerFor(event)({ type: event }, ctx);
}
function toggleViaShortcut(ctx: FakeCtx): unknown {
	assert.ok(shortcutRecords[0], "no shortcut registered");
	return shortcutRecords[0].options.handler(ctx);
}
function toggleViaCommand(ctx: FakeCtx): unknown {
	assert.ok(commandRecords[0], "no command registered");
	return commandRecords[0].options.handler(ctx);
}

function makeCtx(hasUI: boolean, authStorage: FakeAuthStorage, ui: FakeUi): FakeCtx {
	return { hasUI, cwd: "/tmp/adapter-probe", ui, modelRegistry: { authStorage } };
}

/** Bounded, deterministic microtask + one macrotask drain (no real timers pending but the dormant
 *  5-min interval, which never fires here). Enough to settle load()/gather() awaits and overlay
 *  `.then` continuations. */
async function flush(): Promise<void> {
	for (let i = 0; i < 16; i++) await Promise.resolve();
	await new Promise<void>(res => setTimeout(res, 0));
}

/** Reset the shared module singletons (controller / reporter / module ctx / activeDone) between
 *  scenarios via the adapter's OWN lifecycle: session_shutdown stops the controller, tears the
 *  interval down, closes any overlay, and re-arms the reporter. Fresh fakes per scenario keep the
 *  recorders isolated; the one-time registration above is intentionally shared (it IS the SUT). */
async function resetModule(): Promise<void> {
	dispatch("session_shutdown", makeCtx(true, new FakeAuthStorage(), new FakeUi()));
	await flush();
}

/** Best-effort raw-input bytes for a captured KeyId, verified against the REAL matchesKey (so the
 *  chord-close probe stays agnostic to whichever non-reserved chord craft picks). ctrl+shift+X and
 *  super+X are not representable in legacy bytes without the Kitty protocol (unavailable headless)
 *  → undefined, and the caller falls back to the always-synthesizable Esc close. */
function synthesizeKeyInput(keyId: KeyId): string | undefined {
	const parts = keyId.split("+");
	const base = parts[parts.length - 1] ?? "";
	const mods = parts.slice(0, -1);
	const special: Record<string, string> = {
		escape: "\u001b",
		esc: "\u001b",
		enter: "\r",
		return: "\r",
		tab: "\t",
		space: " ",
		backspace: "\u007f",
	};
	let byte: string | undefined = base in special ? special[base] : base.length === 1 ? base : undefined;
	if (byte === undefined) return undefined;
	const isLetter = base.length === 1 && /[a-z]/i.test(base);
	if (mods.includes("super")) return undefined;
	if (mods.includes("shift")) {
		if (mods.includes("ctrl") || !isLetter) return undefined; // ctrl+shift needs Kitty; only plain shift+letter is legacy-safe
		byte = base.toUpperCase();
	}
	if (mods.includes("ctrl")) {
		if (!isLetter) return undefined;
		byte = String.fromCharCode(base.toLowerCase().charCodeAt(0) - 96);
	}
	if (mods.includes("alt")) byte = `\u001b${byte}`;
	return byte;
}

// ── Check harness ────────────────────────────────────────────────────────────────────────────
interface CheckResult {
	name: string;
	ok: boolean;
	error?: string;
	note?: string;
}
const results: CheckResult[] = [];
let currentNote: string | undefined;

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
	currentNote = undefined;
	try {
		await fn();
		results.push({ name, ok: true, note: currentNote });
		console.log(`  ok   ${name}${currentNote ? `  (note: ${currentNote})` : ""}`);
	} catch (err) {
		const error = err instanceof Error ? (err.message ?? String(err)) : String(err);
		results.push({ name, ok: false, error });
		console.log(`  FAIL ${name}\n         ${error.split("\n").join("\n         ")}`);
	}
}
function note(message: string): void {
	currentNote = message;
}

console.log(`adapter-probe: driving the REAL registerUsageStatusBar from ${DIST_ENTRY}\n`);

// (a) Exact event subscriptions + exactly one shortcut + one command. Registration happens at
//     register() time regardless of hasUI, so this reads directly off the one-time records.
await check("(a) subscribes EXACTLY session_start/switch/branch/shutdown + turn_end", () => {
	const expected = ["session_branch", "session_shutdown", "session_start", "session_switch", "turn_end"];
	const actual = [...onRecords.map(r => r.event)].sort();
	assert.deepEqual(actual, expected, `subscribed events were: ${JSON.stringify(actual)}`);
});
await check("(a) registers exactly one shortcut and one command", () => {
	assert.equal(shortcutRecords.length, 1, `registerShortcut called ${shortcutRecords.length}x`);
	assert.equal(commandRecords.length, 1, `registerCommand called ${commandRecords.length}x`);
	assert.ok(typeof shortcutRecords[0].options.handler === "function", "shortcut handler missing");
	assert.ok(typeof commandRecords[0].options.handler === "function", "command handler missing");
});

// (b) Headless (hasUI=false): the ENTIRE subsystem is inert. Catches WRONG-impl (iv): a missing
//     hasUI gate would start the controller → immediate refresh → fetch + setWidget in print/RPC.
await check("(b) hasUI=false — subsystem fully inert (no fetch, no widget, no overlay, no notify)", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(false, auth, ui);
	dispatch("session_start", ctx);
	await flush();
	toggleViaShortcut(ctx); // shortcut/command are hasUI-guarded → still no overlay
	toggleViaCommand(ctx);
	dispatch("turn_end", ctx); // turn_end is hasUI-guarded → no refresh/fetch
	await flush();
	assert.equal(auth.fetchCount, 0, "headless fetched usage — hasUI gate missing on start/turn_end");
	assert.equal(ui.setWidgetCalls.length, 0, "headless installed a widget — hasUI gate missing");
	assert.equal(ui.customCalls.length, 0, "headless opened an overlay — hasUI gate missing");
	assert.equal(ui.notifyCalls.length, 0, "headless emitted a notification");
});

// (c) hasUI=true session_start renders a belowEditor widget via a component FACTORY (not string[]),
//     fed by the one real data touch (authStorage.fetchUsageReports).
await check("(c) hasUI=true session_start renders a belowEditor widget via a component factory", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);
	dispatch("session_start", ctx);
	await flush();
	assert.ok(auth.fetchCount >= 1, "session_start did not fetch usage via authStorage");
	assert.ok(ui.setWidgetCalls.length >= 1, "session_start installed no widget");
	const widget = ui.setWidgetCalls.find(w => w.content !== undefined);
	assert.ok(widget, "no non-clearing setWidget call (expected a rendered collapsed widget)");
	assert.equal(widget.options?.placement, "belowEditor", `widget placement was ${JSON.stringify(widget.options)}`);
	assert.equal(typeof widget.content, "function", "widget content must be a component factory (not a capped string[])");
	assert.ok(typeof widget.key === "string" && widget.key.length > 0, "widget key must be a stable non-empty string");
});

// (d) Toggle (shortcut) opens ctx.ui.custom({overlay:true}); the overlay closes on Esc via its own
//     handleInput, and the controller returns to collapsed (a fresh toggle opens a NEW overlay).
await check("(d) shortcut toggle opens ctx.ui.custom({overlay:true}); Esc closes it, returns to collapsed", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);
	dispatch("session_start", ctx);
	await flush();

	toggleViaShortcut(ctx);
	await flush();
	assert.equal(ui.customCalls.length, 1, "shortcut toggle did not open an overlay");
	const overlayA = ui.customCalls[0];
	assert.equal(overlayA.options?.overlay, true, "overlay must be opened with { overlay: true }");
	assert.ok(overlayA.component && typeof overlayA.component.handleInput === "function", "overlay has no handleInput");
	assert.equal(overlayA.settled, false, "overlay resolved before any close key");

	overlayA.component.handleInput?.("\u001b"); // Esc
	await flush();
	assert.equal(overlayA.settled, true, "overlay did not close on Esc (handleInput → done())");

	// Back to collapsed: another toggle must OPEN a fresh overlay, proving onClose synced state.
	toggleViaShortcut(ctx);
	await flush();
	assert.equal(ui.customCalls.length, 2, "post-Esc controller was not collapsed (toggle did not reopen)");
	// clean up the second overlay
	ui.customCalls[1].component?.handleInput?.("\u001b");
	await flush();
});

// (d′) Toggle (COMMAND) also opens the overlay; the overlay closes on the toggle chord (its own
//      handleInput via matchesKey). Chord bytes are synthesized from the captured KeyId and verified
//      against the REAL matchesKey; if the craft chord isn't legacy-representable headless we fall
//      back to Esc and record a note (the "closes" contract is still proven).
await check("(d) command toggle opens the overlay; the toggle chord closes it (Esc fallback)", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);
	dispatch("session_start", ctx);
	await flush();

	toggleViaCommand(ctx);
	await flush();
	assert.equal(ui.customCalls.length, 1, "command toggle did not open an overlay");
	const overlay = ui.customCalls[0];
	assert.equal(overlay.options?.overlay, true, "overlay must be opened with { overlay: true }");
	assert.ok(overlay.component && typeof overlay.component.handleInput === "function", "overlay has no handleInput");

	const chord = shortcutRecords[0].shortcut;
	const chordData = synthesizeKeyInput(chord);
	if (chordData !== undefined && matchesKey(chordData, chord)) {
		overlay.component.handleInput?.(chordData);
		await flush();
		assert.equal(overlay.settled, true, `overlay did not close on the toggle chord "${chord}"`);
	} else {
		note(`chord "${chord}" not legacy-synthesizable headless; verified Esc close instead`);
		overlay.component.handleInput?.("\u001b");
		await flush();
		assert.equal(overlay.settled, true, "overlay did not close on Esc");
	}
});

// (e) Empty VM routes through the controller's force-close + clear: the overlay closes AND the
//     below-editor widget is cleared with setWidget(…, undefined) — NOT renderCollapsed. `clear()`
//     itself only touches the widget (finding #4); the overlay close is owned by force-close.
await check("(e) empty VM force-closes the overlay and clears the widget (setWidget undefined), not renderCollapsed", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);
	dispatch("session_start", ctx);
	await flush();
	toggleViaShortcut(ctx);
	await flush();
	const overlay = ui.customCalls[ui.customCalls.length - 1];
	assert.equal(overlay.settled, false, "precondition: overlay open before the empty refresh");

	auth.mode = "empty"; // next refresh yields an empty VM
	const widgetsBefore = ui.setWidgetCalls.length;
	dispatch("turn_end", ctx);
	await flush();

	assert.equal(overlay.settled, true, "empty VM did not force-close the open overlay");
	const clearing = ui.setWidgetCalls.slice(widgetsBefore).filter(w => w.content === undefined);
	assert.ok(clearing.length >= 1, "empty VM did not clear the below-editor widget (setWidget key, undefined)");
	const rendered = ui.setWidgetCalls.slice(widgetsBefore).filter(w => typeof w.content === "function");
	assert.equal(rendered.length, 0, "empty VM wrongly re-rendered a collapsed widget instead of clearing");
});

// (f) Per-open `ownDone` (the crown-jewel discriminator, catches WRONG-impl (iv) missing ownDone):
//     open A → force-close A → open B — WITHOUT flushing between, so A's overlay `.then` is still
//     pending when B is active. A correct adapter clears the module handle only when it is still
//     A's (`activeDone === ownDone`), leaving B's `done` intact; a missing-ownDone adapter clobbers
//     the global handle when A's late `.then` runs, so a later force-close of B calls `undefined?.()`
//     and B NEVER settles (leaked overlay). Assertion: after the reorder, force-closing B settles B.
await check("(f) per-open ownDone: A's late settle does not disturb B; force-close settles B's own done", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);
	dispatch("session_start", ctx);
	await flush();

	toggleViaShortcut(ctx); // open A
	await flush();
	assert.equal(ui.customCalls.length, 1, "A did not open");
	const overlayA = ui.customCalls[0];

	// Reorder window: force-close A then open B synchronously, so A's `.then` fires AFTER B is active.
	toggleViaShortcut(ctx); // force-close A (sync: sink.closeExpanded → done_A(); expanded=false)
	toggleViaShortcut(ctx); // open B          (sync: expanded false → openExpanded → activeDone=done_B)
	await flush(); // now A's pending `.then` runs while B is the active overlay
	assert.equal(ui.customCalls.length, 2, "B did not open after force-closing A");
	const overlayB = ui.customCalls[1];

	// A's late settlement (a duplicate close of the already-closed A) must not disturb B.
	overlayA.component?.handleInput?.("\u001b");
	await flush();
	assert.equal(overlayB.settled, false, "A's late settlement wrongly closed B");

	// Force-close B — must settle B's OWN done. Fails on a missing-ownDone adapter (handle clobbered).
	toggleViaShortcut(ctx);
	await flush();
	assert.equal(overlayB.settled, true, "force-close did not settle B (ownDone/activeDone handle clobbered by A's late .then)");
});

// (g) Reporter: fail-loud-once. A gather/load failure warns once per key (console + ctx.ui.notify
//     "warning"); a repeat with the same key does NOT re-notify (dedupe); after stop the reporter
//     re-arms (reset-on-stop) so the next session warns again.
await check("(g) reporter notify-once per key, deduped across refreshes, re-armed after stop", async () => {
	await resetModule();
	const auth = new FakeAuthStorage();
	auth.mode = "reject";
	const ui = new FakeUi();
	const ctx = makeCtx(true, auth, ui);

	const realWarn = console.warn;
	let warnCount = 0;
	console.warn = (): void => {
		warnCount++;
	};
	try {
		dispatch("session_start", ctx); // start → immediate refresh → gather rejects → report("refresh")
		await flush();
		assert.equal(ui.warningNotifies().length, 1, "first failure did not notify once (warning)");
		assert.ok(warnCount >= 1, "first failure did not console.warn");

		dispatch("turn_end", ctx); // refresh again, SAME failure key → deduped
		await flush();
		assert.equal(ui.warningNotifies().length, 1, "repeat failure re-notified (dedupe-by-key missing)");

		dispatch("session_shutdown", ctx); // stop → reporter.reset()
		await flush();
		const ui2 = new FakeUi();
		const ctx2 = makeCtx(true, auth, ui2);
		dispatch("session_start", ctx2); // fresh session, same failure → must warn again (re-armed)
		await flush();
		assert.equal(ui2.warningNotifies().length, 1, "reporter did not re-arm after stop (reset-on-stop missing)");
	} finally {
		console.warn = realWarn;
	}
});

// ── Teardown + summary ─────────────────────────────────────────────────────────────────────
await resetModule(); // final stop → clears the real 5-min interval so the loop can drain

const failed = results.filter(r => !r.ok);
console.log(`\nadapter-probe summary: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
	console.log("FAILED checks:");
	for (const r of failed) console.log(`  - ${r.name}: ${r.error}`);
}
process.exit(failed.length > 0 ? 1 : 0);
