// The ONLY two Bun-only omp VALUE imports of the whole subsystem (plan §6 Step 5
// / DR-C). Every other omp surface is `import type` (erased at compile), so the
// four pure modules stay loadable under vitest-on-Node and this registrar is the
// sole holder of a runtime value import.
import { resolveUsedFraction } from "@oh-my-pi/pi-ai/usage";
import { matchesKey } from "@oh-my-pi/pi-tui";

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUiComponent,
	ExtensionUiComponentFactory,
	Theme,
	ThemeColor,
} from "@oh-my-pi/pi-coding-agent";
import type { KeyId } from "@oh-my-pi/pi-tui";

import { gatherUsageInput } from "./gather.js";
import { createUsageBarController } from "./controller.js";
import type { Reporter, UsageLoader, UsageWidgetSink } from "./controller.js";
import { deriveMaxRows, renderRows } from "./render.js";
import type { RenderRow, SegmentStyle } from "./render.js";
import { buildUsageViewModel } from "./view-model.js";
import type { UsageViewModel } from "./view-model.js";

// ---------------------------------------------------------------------------
// Impure registrar (plan §4/§6 Step 5). Wires the pure gather → view-model →
// render → controller pipeline into omp's extension host with a below-editor
// widget, an on-demand expanded overlay, a slash command, and a keyboard chord.
// It reads usage ONLY through the injected authStorage port — no provider HTTP,
// no OAuth-token handling (AC8).
// ---------------------------------------------------------------------------

const WIDGET_KEY = "lsc-usage-bar";
const COMMAND_NAME = "usage-bar";
const REFRESH_INTERVAL_MS = 5 * 60_000;
const STALE_AFTER_MS = 7 * 60_000;
const EMPTY_VM: UsageViewModel = { columns: [], empty: true };

// TOGGLE_CHORD collision check (Gate 1): grepped pi-tui keybindings.d.ts (TUI
// editor defaults) and pi-coding-agent dist (app.* reserved keys + bundled
// shortcuts). ctrl+u is FORBIDDEN (tui.editor.deleteToLineStart); ctrl+g
// (app.editor.external), ctrl+t (app.thinking.toggle), ctrl+r (app.history.search),
// ctrl+l/c/d/z (app.*) are all taken. ctrl+n is ABSENT from every default and is
// legacy-byte-synthesizable (0x0E), so the adapter can verify a real chord-close.
const TOGGLE_CHORD: KeyId = "ctrl+n";

// Static segment-style → theme-color table (never mutated → Record, not Map).
const STYLE_COLOR: Record<SegmentStyle, ThemeColor> = {
	title: "accent",
	header: "muted",
	label: "text",
	stale: "warning",
	"bar-ok": "success",
	"bar-warn": "warning",
	"bar-crit": "error",
	track: "dim",
	"pct-ok": "text",
	"pct-warn": "warning",
	"pct-crit": "error",
	reset: "muted",
	na: "dim",
	note: "muted",
	sep: "borderMuted",
	more: "dim",
};

/** Map a render row's segments to one themed string. Never throws (falls back to raw text). */
function styleRow(row: RenderRow, theme: Theme): string {
	try {
		return row.segments.map((s) => theme.fg(STYLE_COLOR[s.style], s.text)).join("");
	} catch {
		return row.segments.map((s) => s.text).join("");
	}
}

/** Below-editor widget content: a factory whose render() row-budgets to the terminal height. */
function makeCollapsedFactory(vm: UsageViewModel): ExtensionUiComponentFactory {
	return (tui, theme) => ({
		render: (width: number): string[] =>
			renderRows(vm, { width, maxRows: deriveMaxRows(tui.terminal.rows), expanded: false, now: Date.now() }).map((r) =>
				styleRow(r, theme),
			),
	});
}

/** Full-detail overlay component: renders the live VM expanded; Esc / chord closes. */
function makeExpandedOverlay(getVm: () => UsageViewModel | undefined, theme: Theme, done: () => void): ExtensionUiComponent {
	return {
		render: (width: number): string[] =>
			renderRows(getVm() ?? EMPTY_VM, { width, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: Date.now() }).map(
				(r) => styleRow(r, theme),
			),
		handleInput: (data: string): void => {
			if (matchesKey(data, "escape") || matchesKey(data, TOGGLE_CHORD)) done();
		},
	};
}

/** Install the provider-usage status bar onto the extension host (additive; per-call state). */
export function registerUsageStatusBar(pi: ExtensionAPI): void {
	let ctx: ExtensionContext | undefined;
	let activeDone: (() => void) | undefined;

	// De-duped reporter: one console.warn + one notify per key per session.
	const warned = new Set<string>();
	const reporter: Reporter = {
		report: (key, err) => {
			if (warned.has(key)) return;
			warned.add(key);
			const msg = `lets-craft usage-bar: ${key} - ${err instanceof Error ? err.message : String(err)}`;
			console.warn(msg);
			ctx?.ui.notify(msg, "warning");
		},
		reset: () => {
			warned.clear();
		},
	};

	const load: UsageLoader = async (now, signal) => {
		const c = ctx;
		if (!c) return EMPTY_VM;
		// The real AuthStorage is structurally an AuthStoragePort (gather's compile-time Assert).
		const input = await gatherUsageInput(c.modelRegistry.authStorage, now, STALE_AFTER_MS, signal);
		return buildUsageViewModel(input, resolveUsedFraction);
	};

	const sink: UsageWidgetSink = {
		renderCollapsed: (vm) => {
			ctx?.ui.setWidget(WIDGET_KEY, makeCollapsedFactory(vm), { placement: "belowEditor" });
		},
		openExpanded: (getVm, onClose) => {
			const c = ctx;
			if (!c?.hasUI) return;
			let ownDone: (() => void) | undefined;
			void c.ui
				.custom<void>(
					(_tui, theme, _kb, done) => {
						const close = (): void => done();
						ownDone = close;
						activeDone = close;
						return makeExpandedOverlay(getVm, theme, close);
					},
					{ overlay: true },
				)
				.then(
					() => {
						if (activeDone === ownDone) activeDone = undefined;
						onClose();
					},
					(e) => {
						if (activeDone === ownDone) activeDone = undefined;
						reporter.report("overlay", e);
						onClose();
					},
				);
		},
		closeExpanded: () => {
			const d = activeDone;
			activeDone = undefined;
			d?.();
		},
		clear: () => {
			ctx?.ui.setWidget(WIDGET_KEY, undefined);
		},
	};

	const controller = createUsageBarController({
		clock: { now: () => Date.now() },
		scheduler: {
			setInterval: (fn, ms) => setInterval(fn, ms),
			// h is always a real timer from setInterval above; the branded arm is phantom.
			clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
		},
		makeAbort: () => new AbortController(),
		intervalMs: REFRESH_INTERVAL_MS,
		reporter,
		load,
		sink,
	});

	// session_start / _switch / _branch: (re)start the subsystem, gated on hasUI.
	const lifecycleStart = (_event: unknown, c: ExtensionContext): void => {
		try {
			ctx = c;
			if (!c.hasUI) return;
			controller.start();
		} catch (e) {
			reporter.report("lifecycle", e);
		}
	};
	pi.on("session_start", lifecycleStart);
	pi.on("session_switch", lifecycleStart);
	pi.on("session_branch", lifecycleStart);
	pi.on("session_shutdown", () => {
		try {
			controller.stop();
			ctx = undefined;
		} catch (e) {
			reporter.report("lifecycle", e);
		}
	});
	pi.on("turn_end", (_event, c) => {
		if (c) ctx = c;
		if (!ctx?.hasUI) return;
		void controller.refresh("turn").catch((e) => reporter.report("refresh", e));
	});

	// The probe calls handler(ctx); the real host calls handler(args, ctx). Accept
	// either: the first argument that looks like a context decides. hasUI=false is
	// a strict no-op (zero fetch/widget/overlay/notify).
	const handleToggle = (...args: unknown[]): void => {
		for (const cand of [...args, ctx]) {
			if (cand !== null && typeof cand === "object" && "hasUI" in cand) {
				if (cand.hasUI === true) controller.toggleExpanded();
				return;
			}
		}
	};
	pi.registerCommand(COMMAND_NAME, {
		description: "Expand the provider usage bar to full detail (Esc or the shortcut closes it)",
		handler: async (...args: unknown[]): Promise<void> => {
			handleToggle(...args);
		},
	});
	pi.registerShortcut(TOGGLE_CHORD, {
		description: "Expand/close the provider usage bar",
		handler: (...args: unknown[]): void => {
			handleToggle(...args);
		},
	});
}
