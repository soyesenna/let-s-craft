import type { AccountVM, CellVM, ProviderColumnVM, UsageViewModel } from "./view-model.js";

// ---------------------------------------------------------------------------
// PURE render layer. Imports NO omp values at all (VM types only, `import
// type` from ./view-model.js), so it loads under vitest-on-Node.
//
// Collapsed layout — providers side by side as COLUMNS, accounts stacked as
// ROWS inside each column, windows aligned into fixed sub-columns:
//
//   Anthropic                                  │ OpenAI Codex
//              5h          7d         Fable 7d │            7d
//   soyesenna  ███▏░  62%  ██░░░ 38%  ░░░░░ 2% │ senna      █▏░░░ 12%
//   work       ████▊  94%  ██░░░ 31%  ░░░░░ 0% │
//
// Rows are STYLED SEGMENT lists (the registrar maps each segment style to a
// theme color), so a single row can mix an ok-green bar, a warning percent and
// a dim track. Width degradation ladder: drop reset countdowns → shrink bars →
// drop bars (percent only) → stack providers vertically → single-row strips.
// ---------------------------------------------------------------------------

/** Below-editor row-budget reserve so the prompt is never pushed off-screen. */
export const RESERVE_ROWS = 8;
/** Never shrink the collapsed budget below this while a bar still renders. */
export const MIN_BAR_ROWS = 1;
/** Cap the collapsed budget for very tall terminals. */
export const MAX_BAR_ROWS = 12;
/** Meter width in cells at full detail (collapsed). */
export const BAR_CELLS = 5;
/** Meter width in cells in the expanded overlay. */
export const BAR_CELLS_EXPANDED = 10;
/** Longest account label shown in the collapsed table before ellipsis. */
export const LABEL_MAX = 14;

const BAR_FULL = "█";
const BAR_EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"] as const;
const BAR_TRACK = "░";
const ELLIPSIS = "…";
const NO_DATA = "–";
const COLUMN_SEP = " │ ";
const STALE_MARK = " (stale)";

/** Inner left/right padding between the box frame and the table. */
export const BOX_PAD = 2;
// Rounded frame matching the prompt editor's box (pi-tui unicode preset).
const BOX_TL = "╭";
const BOX_TR = "╮";
const BOX_BL = "╰";
const BOX_BR = "╯";
const BOX_H = "─";
const BOX_V = "│";

export type SegmentStyle =
	| "title"
	| "header"
	| "label"
	| "stale"
	| "border"
	| "bar-ok"
	| "bar-warn"
	| "bar-crit"
	| "track"
	| "pct-ok"
	| "pct-warn"
	| "pct-crit"
	| "reset"
	| "na"
	| "note"
	| "sep"
	| "more";

export interface RowSegment {
	text: string;
	style: SegmentStyle;
}

export interface RenderRow {
	segments: RowSegment[];
}

export interface RenderOptions {
	width: number;
	maxRows: number;
	expanded: boolean;
	now: number;
}

/** Plain text of a row (segment concatenation) — also the row's visual width. */
export function rowText(row: RenderRow): string {
	return row.segments.map((s) => s.text).join("");
}

/**
 * Sub-cell meter: fraction quantized to eighth-blocks over `cells` columns.
 * Returns the filled part (full blocks + at most one partial glyph) and the
 * `░` track remainder; `fill.length + track.length === cells`. Never throws.
 */
export function meterBar(raw: number, cells: number): { fill: string; track: string } {
	const safe = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
	const units = Math.round(safe * cells * 8);
	const full = Math.floor(units / 8);
	const rem = units % 8;
	const fill = BAR_FULL.repeat(full) + (rem > 0 ? BAR_EIGHTHS[rem - 1] : "");
	return { fill, track: BAR_TRACK.repeat(cells - fill.length) };
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

/** Collapsed row budget from terminal height: clamp(H - RESERVE, MIN, MAX); 0 at H<=1. */
export function deriveMaxRows(height: number): number {
	return height <= 1 ? 0 : Math.min(MAX_BAR_ROWS, Math.max(MIN_BAR_ROWS, height - RESERVE_ROWS));
}

// ---------------------------------------------------------------------------
// Segment helpers
// ---------------------------------------------------------------------------

function seg(text: string, style: SegmentStyle): RowSegment {
	return { text, style };
}

function pad(n: number): string {
	return " ".repeat(Math.max(0, n));
}

/** Hard-truncate plain text to `width`, appending the ellipsis when clipped. */
function clipText(text: string, width: number): string {
	if (text.length <= width) return text;
	if (width <= 1) return ELLIPSIS.slice(0, Math.max(0, width));
	return text.slice(0, width - 1) + ELLIPSIS;
}

/** Clip a segment row to `width` plain characters, ellipsis on the cut. */
function clipRow(row: RenderRow, width: number): RenderRow {
	if (width <= 0) return { segments: [] };
	let total = 0;
	for (const s of row.segments) total += s.text.length;
	if (total <= width) return row;
	const out: RowSegment[] = [];
	let used = 0;
	for (const s of row.segments) {
		if (used >= width - 1) break;
		const room = width - 1 - used;
		const text = s.text.length <= room ? s.text : s.text.slice(0, room);
		out.push(seg(text, s.style));
		used += text.length;
	}
	out.push(seg(ELLIPSIS, "na"));
	return { segments: out };
}

// ---------------------------------------------------------------------------
// Collapsed cell / row construction
// ---------------------------------------------------------------------------

/** A width variant of the collapsed table (degradation ladder step). */
interface Variant {
	bar: number;
	countdown: boolean;
}

const VARIANTS: readonly Variant[] = [
	{ bar: BAR_CELLS, countdown: true },
	{ bar: BAR_CELLS, countdown: false },
	{ bar: 3, countdown: false },
	{ bar: 0, countdown: false },
];

interface CellRender {
	segments: RowSegment[];
	width: number;
}

/** One table cell: `<bar> <pct>` (+ ` <countdown>` on warn/crit), or `–`. */
function renderCell(cell: CellVM, variant: Variant, now: number): CellRender {
	if (cell.fraction === undefined) {
		return { segments: [seg(NO_DATA, "na")], width: NO_DATA.length };
	}
	const segments: RowSegment[] = [];
	let width = 0;
	if (variant.bar > 0) {
		const { fill, track } = meterBar(cell.fraction, variant.bar);
		if (fill.length > 0) segments.push(seg(fill, `bar-${cell.level}`));
		if (track.length > 0) segments.push(seg(track, "track"));
		segments.push(seg(" ", "track"));
		width += variant.bar + 1;
	}
	const pct = `${usedPercent(cell.fraction)}%`.padStart(4);
	segments.push(seg(pct, `pct-${cell.level}`));
	width += pct.length;
	if (variant.countdown && cell.level !== "ok" && cell.resetsAt !== undefined) {
		const cd = ` ${formatCountdown(cell.resetsAt - now)}`;
		segments.push(seg(cd, "reset"));
		width += cd.length;
	}
	return { segments, width };
}

/** Collapsed account label: clipped label + optional stale marker. */
function labelSegments(a: AccountVM): { segments: RowSegment[]; width: number } {
	const text = clipText(a.label, LABEL_MAX);
	const segments: RowSegment[] = [seg(text, "label")];
	let width = text.length;
	if (a.freshness === "stale") {
		segments.push(seg(STALE_MARK, "stale"));
		width += STALE_MARK.length;
	}
	return { segments, width };
}

/** A provider column laid out for one variant: independent rows of equal width. */
interface LaidOutColumn {
	rows: RenderRow[];
	width: number;
}

const CELL_GAP = 2;

/**
 * Lay out one provider as a table: title row, header row, then one row per
 * visible account. `visible` accounts render; the title carries a dim `+N`
 * when the row budget hid any.
 */
function layoutProvider(column: ProviderColumnVM, visible: number, variant: Variant, now: number): LaidOutColumn {
	const shown = column.accounts.slice(0, Math.max(1, visible));
	const hidden = column.accounts.length - shown.length;

	const labels = shown.map((a) => labelSegments(a));
	const labelW = Math.max(...labels.map((l) => l.width), 1);

	const cellRows = shown.map((a) => (a.isSubscription ? a.cells.map((c) => renderCell(c, variant, now)) : []));
	const slotW = column.slots.map((slot, j) => {
		let w = slot.header.length;
		for (const cells of cellRows) if (cells[j] !== undefined) w = Math.max(w, cells[j].width);
		return w;
	});
	const cellsRegionW = slotW.reduce((sum, w) => sum + w, 0) + CELL_GAP * Math.max(0, slotW.length - 1);

	const rows: RenderRow[] = [];

	// Title row: provider name + dim overflow count when accounts were hidden.
	const title: RowSegment[] = [seg(column.title, "title")];
	if (hidden > 0) title.push(seg(` +${hidden}`, "more"));
	rows.push({ segments: title });

	// Header row: blank label gutter, then each slot header over its sub-column.
	const header: RowSegment[] = [seg(pad(labelW + CELL_GAP), "header")];
	column.slots.forEach((slot, j) => {
		const gap = j < column.slots.length - 1 ? CELL_GAP : 0;
		header.push(seg(slot.header + pad(slotW[j] - slot.header.length + gap), "header"));
	});
	rows.push({ segments: header });

	// Account rows.
	shown.forEach((a, i) => {
		const segments: RowSegment[] = [...labels[i].segments, seg(pad(labelW - labels[i].width + CELL_GAP), "label")];
		if (!a.isSubscription) {
			segments.push(seg(clipText(a.note ?? "no usage", Math.max(cellsRegionW, 24)), "note"));
		} else {
			a.cells.forEach((_, j) => {
				const cell = cellRows[i][j];
				const gap = j < a.cells.length - 1 ? CELL_GAP : 0;
				segments.push(...cell.segments);
				segments.push(seg(pad(slotW[j] - cell.width + gap), "track"));
			});
		}
		rows.push({ segments });
	});

	// Uniform column width so side-by-side joining stays aligned.
	const width = Math.max(...rows.map((r) => rowText(r).length));
	for (const row of rows) {
		const short = width - rowText(row).length;
		if (short > 0) row.segments.push(seg(pad(short), "sep"));
	}
	return { rows, width };
}

/** Join laid-out provider columns side by side with a vertical rule. */
function joinColumns(columns: LaidOutColumn[]): RenderRow[] {
	const height = Math.max(...columns.map((c) => c.rows.length));
	const rows: RenderRow[] = [];
	for (let r = 0; r < height; r++) {
		const segments: RowSegment[] = [];
		columns.forEach((col, i) => {
			if (i > 0) segments.push(seg(COLUMN_SEP, "sep"));
			const row = col.rows[r];
			if (row !== undefined) segments.push(...row.segments);
			else segments.push(seg(pad(col.width), "sep"));
		});
		rows.push({ segments });
	}
	return rows;
}

// ---------------------------------------------------------------------------
// Tiny-budget strips (maxRows 1–2): one compact row per provider.
// ---------------------------------------------------------------------------

/** The account whose worst cell has the highest fraction (undefined counts as -1). */
function worstAccount(column: ProviderColumnVM): { account: AccountVM; cell: CellVM | undefined } {
	let best: { account: AccountVM; cell: CellVM | undefined; score: number } | undefined;
	for (const account of column.accounts) {
		let cell: CellVM | undefined;
		let score = -1;
		for (const c of account.cells) {
			const s = c.fraction ?? -1;
			if (s > score) {
				score = s;
				cell = c;
			}
		}
		if (best === undefined || score > best.score) best = { account, cell, score };
	}
	const chosen = best ?? { account: column.accounts[0], cell: undefined, score: -1 };
	return { account: chosen.account, cell: chosen.cell };
}

/** One strip: `Title label 5h 94% 1h12m +2` — the provider's highest-risk cell. */
function stripSegments(column: ProviderColumnVM, now: number): RowSegment[] {
	const { account, cell } = worstAccount(column);
	const segments: RowSegment[] = [seg(column.title, "title")];
	segments.push(seg(` ${clipText(account.label, LABEL_MAX)}`, "label"));
	if (account.freshness === "stale") segments.push(seg(STALE_MARK, "stale"));
	if (!account.isSubscription) {
		segments.push(seg(` ${account.note ?? "no usage"}`, "note"));
	} else if (cell?.fraction === undefined) {
		segments.push(seg(` ${NO_DATA}`, "na"));
	} else {
		const slot = column.slots.find((s) => s.key === cell.slotKey);
		if (slot !== undefined) segments.push(seg(` ${slot.header}`, "header"));
		segments.push(seg(` ${usedPercent(cell.fraction)}%`, `pct-${cell.level}`));
		if (cell.level !== "ok" && cell.resetsAt !== undefined) {
			segments.push(seg(` ${formatCountdown(cell.resetsAt - now)}`, "reset"));
		}
	}
	const rest = column.accounts.length - 1;
	if (rest > 0) segments.push(seg(` +${rest}`, "more"));
	return segments;
}

function renderStrips(columns: ProviderColumnVM[], opts: RenderOptions): RenderRow[] {
	if (opts.maxRows >= columns.length) {
		return columns.map((c) => clipRow({ segments: stripSegments(c, opts.now) }, opts.width));
	}
	// One row for everything: join provider strips on a single line.
	const segments: RowSegment[] = [];
	columns.forEach((c, i) => {
		if (i > 0) segments.push(seg(COLUMN_SEP, "sep"));
		segments.push(...stripSegments(c, opts.now));
	});
	return [clipRow({ segments }, opts.width)];
}

// ---------------------------------------------------------------------------
// Collapsed top-level: side-by-side → stacked → strips.
// ---------------------------------------------------------------------------

function renderCollapsed(columns: ProviderColumnVM[], opts: RenderOptions): RenderRow[] {
	if (opts.maxRows <= 2) return renderStrips(columns, opts);

	// Side-by-side: every provider gets (maxRows - 2) account rows.
	const visible = opts.maxRows - 2;
	for (const variant of VARIANTS) {
		const laid = columns.map((c) => layoutProvider(c, visible, variant, opts.now));
		const total = laid.reduce((sum, c) => sum + c.width, 0) + COLUMN_SEP.length * (laid.length - 1);
		if (total <= opts.width) return joinColumns(laid);
	}

	// Stacked: providers vertically, each at full width with its own best variant.
	const minRows = 3 * columns.length;
	if (opts.maxRows >= minRows) {
		// Distribute the row budget: 3 rows each, remainder in column order.
		const visibles = columns.map(() => 1);
		let leftover = opts.maxRows - minRows;
		columns.forEach((c, i) => {
			const want = c.accounts.length - 1;
			const take = Math.min(want, leftover);
			visibles[i] += take;
			leftover -= take;
		});
		const rows: RenderRow[] = [];
		columns.forEach((column, i) => {
			const variant =
				VARIANTS.find((v) => layoutProvider(column, visibles[i], v, opts.now).width <= opts.width) ??
				VARIANTS[VARIANTS.length - 1];
			for (const row of layoutProvider(column, visibles[i], variant, opts.now).rows) {
				rows.push(clipRow(row, opts.width));
			}
		});
		return rows;
	}

	return renderStrips(columns, opts);
}

// ---------------------------------------------------------------------------
// Expanded overlay: full detail, vertical, no elision.
// ---------------------------------------------------------------------------

function expandedAccountRows(column: ProviderColumnVM, a: AccountVM, opts: RenderOptions): RenderRow[] {
	const rows: RenderRow[] = [];
	const labelSegs: RowSegment[] = [seg(`  ${a.label}`, "label")];
	if (a.freshness === "stale") labelSegs.push(seg(STALE_MARK, "stale"));
	rows.push({ segments: labelSegs });

	if (!a.isSubscription) {
		rows.push({ segments: [seg(`    ${a.note ?? "no usage"}`, "note")] });
		return rows;
	}
	if (a.freshness === "unavailable" || a.cells.length === 0) {
		rows.push({ segments: [seg("    no usage data", "na")] });
		return rows;
	}

	const slotLabelW = Math.max(...column.slots.map((s) => s.label.length));
	a.cells.forEach((cell, j) => {
		const slot = column.slots[j];
		const segments: RowSegment[] = [seg(`    ${slot.label}${pad(slotLabelW - slot.label.length)}  `, "header")];
		if (cell.fraction === undefined) {
			segments.push(seg(NO_DATA, "na"));
		} else {
			const { fill, track } = meterBar(cell.fraction, BAR_CELLS_EXPANDED);
			if (fill.length > 0) segments.push(seg(fill, `bar-${cell.level}`));
			if (track.length > 0) segments.push(seg(track, "track"));
			segments.push(seg(`${usedPercent(cell.fraction)}%`.padStart(6), `pct-${cell.level}`));
			if (cell.resetsAt !== undefined) {
				segments.push(seg(`  resets ${formatCountdown(cell.resetsAt - opts.now)}`, "reset"));
			}
		}
		rows.push({ segments });
	});
	return rows;
}

/** Expanded render: every column, account, and slot on its own line — no elision. */
function renderExpanded(columns: ProviderColumnVM[], opts: RenderOptions): RenderRow[] {
	const rows: RenderRow[] = [];
	columns.forEach((column, i) => {
		if (column.accounts.length === 0) return;
		if (i > 0 && rows.length > 0) rows.push({ segments: [seg("", "sep")] });
		rows.push({ segments: [seg(column.title, "title")] });
		for (const a of column.accounts) rows.push(...expandedAccountRows(column, a, opts));
	});
	return rows.map((r) => clipRow(r, opts.width));
}

/** Wrap content rows in the rounded full-width frame (side padding included). */
function frame(content: RenderRow[], width: number): RenderRow[] {
	const inner = width - 2 - 2 * BOX_PAD;
	const rows: RenderRow[] = [{ segments: [seg(BOX_TL + BOX_H.repeat(width - 2) + BOX_TR, "border")] }];
	for (const row of content) {
		rows.push({
			segments: [
				seg(BOX_V + pad(BOX_PAD), "border"),
				...row.segments,
				seg(pad(inner - rowText(row).length + BOX_PAD), "border"),
				seg(BOX_V, "border"),
			],
		});
	}
	rows.push({ segments: [seg(BOX_BL + BOX_H.repeat(width - 2) + BOX_BR, "border")] });
	return rows;
}

/** Render the view model to styled segment rows for the collapsed or expanded surface. */
export function renderRows(vm: UsageViewModel, opts: RenderOptions): RenderRow[] {
	const columns = vm.columns.filter((c) => c.accounts.length > 0);
	if (columns.length === 0) return [];
	if (opts.expanded) return renderExpanded(columns, opts);
	if (opts.maxRows <= 0) return [];
	// Preferred shape: one blank spacer row for breathing room under the prompt
	// editor, then the table inside a rounded frame like the editor's own box.
	// The spacer and both frame rows are spent from the row budget, so the
	// prompt-safety bound (rows <= maxRows) always holds. The frame costs 3 of
	// the budget's rows, so it only engages once a real table (title + header +
	// account) still fits inside; tighter budgets degrade to the bare table,
	// and at 1–2 rows every row goes to content.
	const boxed = opts.maxRows >= 6 && opts.width >= 24;
	if (boxed) {
		const inner = opts.width - 2 - 2 * BOX_PAD;
		const content = renderCollapsed(columns, { ...opts, width: inner, maxRows: opts.maxRows - 3 }).map((r) =>
			clipRow(r, inner),
		);
		return [{ segments: [] }, ...frame(content, opts.width)];
	}
	const spacer = opts.maxRows >= 3;
	const budget = spacer ? opts.maxRows - 1 : opts.maxRows;
	const rows = renderCollapsed(columns, { ...opts, maxRows: budget }).map((r) => clipRow(r, opts.width));
	return spacer ? [{ segments: [] }, ...rows] : rows;
}
