import type { AccountVM, ProviderGroup, UsageViewModel, WindowVM } from "./view-model.js";

// ---------------------------------------------------------------------------
// PURE render layer (plan §4/§6 Step 4). Imports NO omp values at all (VM types
// only, `import type` from ./view-model.js), so it loads under vitest-on-Node.
// Turns a `UsageViewModel` into styled physical rows for either the collapsed
// below-editor widget (row-budgeted) or the expanded overlay (complete). All
// glyphs are the DR-E normative set: fill U+2593 "▓", empty U+2591 "░", the
// packed-cell separator U+00B7 "·", and the ellipsis U+2026 "…".
// ---------------------------------------------------------------------------

/** Below-editor row-budget reserve so the prompt is never pushed off-screen. */
export const RESERVE_ROWS = 8;
/** Never shrink the collapsed budget below this while a bar still renders. */
export const MIN_BAR_ROWS = 1;
/** Cap the collapsed budget for very tall terminals. */
export const MAX_BAR_ROWS = 12;
/** Mini-bar width in cells at full detail. */
export const BAR_CELLS = 5;

const FILL = "\u2593"; // ▓
const EMPTY = "\u2591"; // ░
const SEP = " \u00b7 "; // · packed-cell separator
const ELLIPSIS = "\u2026"; // …

export type RowStyle =
	| "provider-header"
	| "account-strong"
	| "account-dim"
	| "window"
	| "window-stale"
	| "window-na"
	| "note"
	| "more";

export interface RenderRow {
	text: string;
	style: RowStyle;
}

export interface RenderOptions {
	width: number;
	maxRows: number;
	expanded: boolean;
	now: number;
}

/** Quantized mini-bar: round(clamp01(raw)*cells) filled cells; never throws. */
export function miniBar(raw: number, cells: number): string {
	const safe = Number.isFinite(raw) ? raw : 0;
	const clamped = Math.min(1, Math.max(0, safe));
	const filled = Math.min(cells, Math.max(0, Math.round(clamped * cells)));
	return FILL.repeat(filled) + EMPTY.repeat(cells - filled);
}

/** Raw percent used; overage passes through, negatives floor at 0. */
export function usedPercent(raw: number): number {
	return Math.max(0, Math.round(raw * 100));
}

/** Compact reset countdown; sub-minute → "now", else Nd/Nh/Nm truncated to two units. */
export function formatCountdown(ms: number): string {
	if (ms < 60_000) return "now";
	const totalMin = Math.floor(ms / 60_000);
	const d = Math.floor(totalMin / 1440);
	const h = Math.floor((totalMin % 1440) / 60);
	const m = totalMin % 60;
	if (d > 0) return `${d}d${h > 0 ? `${h}h` : ""}`;
	if (h > 0) return `${h}h${m > 0 ? `${m}m` : ""}`;
	return `${m}m`;
}

/** Email local part (before @). */
export function localPart(email: string): string {
	return email.split("@")[0];
}

/** Collapsed row budget from terminal height: clamp(H - RESERVE, MIN, MAX); 0 at H<=1. */
export function deriveMaxRows(height: number): number {
	return height <= 1 ? 0 : Math.min(MAX_BAR_ROWS, Math.max(MIN_BAR_ROWS, height - RESERVE_ROWS));
}

/** Hard-truncate to `width`, appending the ellipsis so the result length is exactly `width`. */
function clip(text: string, width: number): string {
	if (text.length <= width) return text;
	if (width <= 1) return ELLIPSIS.slice(0, Math.max(0, width));
	return text.slice(0, width - 1) + ELLIPSIS;
}

/** Near-limit windows first (stable), then the rest in original order. */
function orderWindows(windows: WindowVM[]): WindowVM[] {
	const near = windows.filter((w) => w.nearLimit);
	const rest = windows.filter((w) => !w.nearLimit);
	return [...near, ...rest];
}

interface CellOptions {
	cells: number;
	bar: boolean;
	countdown: boolean;
}

/** One packed window cell: `label [bar] pct%` (+ countdown), or `label n/a`. */
function cellText(w: WindowVM, opts: CellOptions, now: number): string {
	if (w.fraction === undefined) return `${w.label} n/a`;
	const parts = [w.label];
	if (opts.bar) parts.push(miniBar(w.fraction, opts.cells));
	parts.push(`${usedPercent(w.fraction)}%`);
	let s = parts.join(" ");
	if (opts.countdown && w.resetsAt !== undefined) s += ` ${formatCountdown(w.resetsAt - now)}`;
	return s;
}

/** Pack a subscription account's windows onto one row, shedding detail to fit `width`. */
function packSubscriptionRow(label: string, windows: WindowVM[], now: number, width: number): string {
	const ordered = orderWindows(windows);
	const near = ordered.filter((w) => w.nearLimit);
	const nonNear = ordered.filter((w) => !w.nearLimit);
	const join = (cells: string[]): string => (cells.length > 0 ? `${label} ${cells.join(SEP)}` : label);

	// 0: full — 5-cell bars, countdown on near windows only.
	const c0 = join(ordered.map((w) => cellText(w, { cells: 5, bar: true, countdown: w.nearLimit }, now)));
	if (c0.length <= width) return c0;
	// 1: all bars shrink to 3 cells.
	const c1 = join(ordered.map((w) => cellText(w, { cells: 3, bar: true, countdown: w.nearLimit }, now)));
	if (c1.length <= width) return c1;
	// 2: non-near windows lose the bar (keep `label pct%`); near keep bar + countdown.
	const c2 = join(ordered.map((w) => cellText(w, { cells: 3, bar: w.nearLimit, countdown: w.nearLimit }, now)));
	if (c2.length <= width) return c2;
	// 3: drop non-near windows entirely; near-only + trailing ellipsis if any were dropped.
	const nearCells = near.map((w) => cellText(w, { cells: 3, bar: true, countdown: true }, now));
	const c3base = join(nearCells);
	const c3 = nonNear.length > 0 ? `${c3base} ${ELLIPSIS}` : c3base;
	if (c3.length <= width) return c3;
	// 4: near-only, truncate the account label to fit.
	if (near.length > 0) {
		const joined = nearCells.join(SEP);
		const budget = width - (1 + joined.length);
		if (budget >= 1) {
			const c4 = `${clip(label, budget)} ${joined}`;
			if (c4.length <= width) return c4;
		}
	}
	// 5: last resort — hard-truncate the fullest row.
	return clip(c0, width);
}

/** Collapsed packed text for any account (no style). */
function packAccountText(a: AccountVM, now: number, width: number): string {
	if (!a.isSubscription) return clip(`${a.label} (${a.note ?? "no usage"})`, width);
	if (a.freshness === "unavailable" || a.windows.length === 0) return clip(`${a.label} - n/a`, width);
	const stale = a.freshness === "stale" ? " (stale)" : "";
	return packSubscriptionRow(`${a.label}${stale}`, a.windows, now, width);
}

function accountStyle(a: AccountVM): RowStyle {
	return a.isSubscription ? "account-strong" : "account-dim";
}

/** A flattened account with its owning group index/provider, in VM order. */
interface FlatAccount {
	group: number;
	provider: string;
	account: AccountVM;
}

function flatten(groups: ProviderGroup[]): FlatAccount[] {
	const flat: FlatAccount[] = [];
	groups.forEach((g, group) => {
		for (const account of g.accounts) flat.push({ group, provider: g.provider, account });
	});
	return flat;
}

/** Priority order for retention: near-limit accounts first (stable), then the rest. */
function byRisk(flat: FlatAccount[]): FlatAccount[] {
	const isNear = (a: AccountVM): boolean => a.windows.some((w) => w.nearLimit);
	return [...flat.filter((f) => isNear(f.account)), ...flat.filter((f) => !isNear(f.account))];
}

/** Collapsed render at maxRows >= 3: greedy near-first retention grouped by provider. */
function renderCollapsedBudget(groups: ProviderGroup[], flat: FlatAccount[], opts: RenderOptions): RenderRow[] {
	const priority = byRisk(flat);
	const selected: FlatAccount[] = [];
	for (const f of priority) {
		const candidate = [...selected, f];
		const distinctProviders = new Set(candidate.map((c) => c.group)).size;
		const hidden = flat.length - candidate.length;
		const rowsNeeded = distinctProviders + candidate.length + (hidden > 0 ? 1 : 0);
		if (rowsNeeded <= opts.maxRows) selected.push(f);
	}
	const chosen = new Set(selected.map((s) => s.account));
	const hidden = flat.length - selected.length;

	const rows: RenderRow[] = [];
	for (const g of groups) {
		const groupChosen = g.accounts.filter((a) => chosen.has(a));
		if (groupChosen.length === 0) continue;
		rows.push({ text: clip(g.provider, opts.width), style: "provider-header" });
		for (const a of groupChosen) {
			rows.push({ text: packAccountText(a, opts.now, opts.width), style: accountStyle(a) });
		}
	}
	if (hidden > 0) rows.push({ text: clip(`+${hidden} more`, opts.width), style: "more" });
	return rows;
}

/** Collapsed render at maxRows 1 or 2: one synthesized top-risk row (+ optional header). */
function renderTiny(flat: FlatAccount[], opts: RenderOptions): RenderRow[] {
	const priority = byRisk(flat);
	const top = priority[0];
	const n = flat.length - 1;
	const suffix = n > 0 ? `${SEP}+${n} more` : "";
	const text = packAccountText(top.account, opts.now, Math.max(0, opts.width - suffix.length)) + suffix;
	const synth: RenderRow = { text, style: accountStyle(top.account) };
	if (opts.maxRows === 1) return [synth];
	return [{ text: clip(top.provider, opts.width), style: "provider-header" }, synth];
}

/** One expanded window row. */
function expandedWindowRow(a: AccountVM, w: WindowVM, opts: RenderOptions): RenderRow {
	const style: RowStyle = w.fraction === undefined ? "window-na" : a.freshness === "stale" ? "window-stale" : "window";
	let text: string;
	if (w.fraction === undefined) {
		text = `${w.label} - n/a`;
	} else {
		text = `${w.label} ${miniBar(w.fraction, BAR_CELLS)} ${usedPercent(w.fraction)}%`;
		if (w.resetsAt !== undefined) text += ` ${formatCountdown(w.resetsAt - opts.now)}`;
	}
	return { text: clip(text, opts.width), style };
}

/** Expanded render: every group, account, and window on its own line — no elision. */
function renderExpanded(groups: ProviderGroup[], opts: RenderOptions): RenderRow[] {
	const rows: RenderRow[] = [];
	for (const g of groups) {
		if (g.accounts.length === 0) continue;
		rows.push({ text: clip(g.provider, opts.width), style: "provider-header" });
		for (const a of g.accounts) {
			const stale = a.freshness === "stale" ? " (stale)" : "";
			rows.push({ text: clip(`${a.label}${stale}`, opts.width), style: accountStyle(a) });
			if (!a.isSubscription) {
				rows.push({ text: clip(a.note ?? "no usage", opts.width), style: "note" });
			} else if (a.freshness === "unavailable" || a.windows.length === 0) {
				rows.push({ text: clip(`- n/a`, opts.width), style: "window-na" });
			} else {
				for (const w of a.windows) rows.push(expandedWindowRow(a, w, opts));
			}
		}
	}
	return rows;
}

/** Render the view model to styled rows for the collapsed or expanded surface. */
export function renderRows(vm: UsageViewModel, opts: RenderOptions): RenderRow[] {
	if (opts.expanded) return renderExpanded(vm.groups, opts);
	if (opts.maxRows <= 0) return [];
	const flat = flatten(vm.groups);
	if (flat.length === 0) return [];
	if (opts.maxRows === 1 || opts.maxRows === 2) return renderTiny(flat, opts);
	return renderCollapsedBudget(vm.groups, flat, opts);
}
