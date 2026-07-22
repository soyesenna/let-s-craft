// Node-safe pure render-model: view-model -> ANSI-painted lines (R1-R7 + render-model mapping).
//
// STRUCTURE contract (Main ruling A): line-count <= rows, focused option's FULL description reachable
// via internal scroll, non-focus label + first line, list windowing, 9-role palette hierarchy, no
// size-escape sequences. exact RGB/256 bytes are NON-contract (D4) — the palette is the SSOT. This
// module holds NO @oh-my-pi runtime value import (Node-safe); the Bun leaf component.ts maps live
// reducer state into these view-models and prints the result.
import { DONE_OPTION, OTHER_OPTION } from "../ask.js";
import { resolvePalette, type Palette } from "./palette.js";
import type { AskUiOption, ChatTarget, RenderEnv } from "./types.js";

export interface SelectViewModel {
	question: string;
	options: readonly AskUiOption[];
	multi: boolean;
	focusIndex: number; // -1 header | 0..n-1 options | n Other | n+1 Done
	recommended?: number;
	checkedIndices?: readonly number[];
	optionScroll?: number;
	descriptionScroll?: number;
	footerHint?: string;
	searchQuery?: string;
	filteredIndices?: readonly number[];
	editorDraft?: { text: string; cursor: number };
}

export interface ChatTurnView {
	kind: "question" | "answer";
	text: string;
}

export interface ChatPanelViewModel {
	target: ChatTarget;
	turns: readonly ChatTurnView[];
	status: "complete" | "error" | "streaming";
	error?: string;
	footerHint?: string;
	chatDraft?: { text: string; focused: boolean };
}

const RECOMMENDED_SUFFIX = " (Recommended)";
const FOCUS_PREFIX = "\u276f "; // ❯
const BLUR_PREFIX = "  ";
const MIN_DESC_WINDOW = 4;
const DEFAULT_SELECT_FOOTER = "\u2191\u2193 \uc774\ub3d9 \u00b7 Enter \uc120\ud0dd \u00b7 ? \uc0c1\uc138 \u00b7 t \ucc44\ud305 \u00b7 / \uac80\uc0c9 \u00b7 Esc \ub4a4\ub85c";

// Approximate terminal display width of a code point: East Asian Wide/Fullwidth ranges (CJK, Hangul,
// kana, fullwidth forms, wide emoji) occupy two cells; zero-width/combining marks occupy none; the
// rest one. Node-safe local heuristic — this module may not import runtime helpers (see header).
function charWidth(cp: number): number {
	if (
		cp === 0x200b || // zero-width space
		(cp >= 0x0300 && cp <= 0x036f) || // combining diacritics
		(cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
		(cp >= 0xfe00 && cp <= 0xfe0f) // variation selectors
	) {
		return 0;
	}
	if (
		(cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
		(cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals .. CJK symbols/punctuation
		(cp >= 0x3041 && cp <= 0x33ff) || // kana .. CJK compatibility
		(cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
		(cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
		(cp >= 0xa000 && cp <= 0xa4cf) || // Yi
		(cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
		(cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
		(cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
		(cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
		(cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
		(cp >= 0x1f300 && cp <= 0x1faff) || // emoji blocks
		(cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B+
	) {
		return 2;
	}
	return 1;
}

/** Display-column width of a string under the charWidth heuristic. */
export function displayWidth(text: string): number {
	let w = 0;
	for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 0);
	return w;
}

// Hard-split one overlong word into display-width-bounded chunks (never returns an empty list).
function splitWord(word: string, width: number): string[] {
	const chunks: string[] = [];
	let chunk = "";
	let w = 0;
	for (const ch of word) {
		const cw = charWidth(ch.codePointAt(0) ?? 0);
		if (w + cw > width && chunk !== "") {
			chunks.push(chunk);
			chunk = "";
			w = 0;
		}
		chunk += ch;
		w += cw;
	}
	if (chunk !== "") chunks.push(chunk);
	return chunks.length > 0 ? chunks : [""];
}

// Hard-clip one line to `width` display cells, marking a clipped tail with an ellipsis. Used for
// the fixed single-line elements (footer hints, labels, search echo) that never wrap — so even on
// a narrow terminal no emitted line is wider than the screen.
function fitCells(text: string, width: number): string {
	if (displayWidth(text) <= width) return text;
	const budget = Math.max(1, width - 1);
	let out = "";
	let w = 0;
	for (const ch of text) {
		const cw = charWidth(ch.codePointAt(0) ?? 0);
		if (w + cw > budget) break;
		out += ch;
		w += cw;
	}
	return `${out}\u2026`;
}

// Word-wrap into lines no wider than `width` DISPLAY columns (whitespace-collapsing; a word wider
// than the whole line is hard-split so nothing can overflow off-screen). Deterministic: identical
// input -> identical lines. Width is measured in terminal cells (wide CJK/Hangul chars count 2),
// so wrapped Korean text fits the terminal instead of truncating on the right.
function wrapText(text: string, width: number): string[] {
	const words = text.split(/\s+/).filter(w => w.length > 0);
	const lines: string[] = [];
	let current = "";
	let currentWidth = 0;
	for (const word of words) {
		const wordWidth = displayWidth(word);
		if (wordWidth > width) {
			if (current !== "") {
				lines.push(current);
				current = "";
				currentWidth = 0;
			}
			const chunks = splitWord(word, width);
			for (const chunk of chunks.slice(0, -1)) lines.push(chunk);
			current = chunks[chunks.length - 1];
			currentWidth = displayWidth(current);
			continue;
		}
		if (current === "") {
			current = word;
			currentWidth = wordWidth;
		} else if (currentWidth + 1 + wordWidth <= width) {
			current = `${current} ${word}`;
			currentWidth += 1 + wordWidth;
		} else {
			lines.push(current);
			current = word;
			currentWidth = wordWidth;
		}
	}
	if (current !== "") lines.push(current);
	return lines.length > 0 ? lines : [""];
}

// Render the editable free-answer draft with the cursor visualised as a reverse-video block (the
// focusLabel role carries the reverse attribute). The draft hard-wraps by display width — never
// whitespace-collapsed, so cursor cells map 1:1 onto draft characters — and the returned window
// always contains the cursor row, so a long answer wraps instead of truncating and the cursor is
// always visible. The cursor styling is ANSI-only, so the VISIBLE text stays exactly the draft.
function renderEditorDraftLines(palette: Palette, text: string, cursor: number, width: number, maxLines: number): string[] {
	const c = Math.max(0, Math.min(cursor, text.length));
	interface Cell {
		ch: string;
		isCursor: boolean;
	}
	const cells: Cell[] = [];
	let unit = 0;
	for (const ch of text) {
		cells.push({ ch, isCursor: unit === c });
		unit += ch.length;
	}
	if (c >= text.length) cells.push({ ch: " ", isCursor: true }); // cursor past the end

	// Hard-wrap cells into rows of at most `width` display columns.
	const rows: Cell[][] = [];
	let row: Cell[] = [];
	let rowWidth = 0;
	for (const cell of cells) {
		const cw = Math.max(1, charWidth(cell.ch.codePointAt(0) ?? 0));
		if (rowWidth + cw > width && row.length > 0) {
			rows.push(row);
			row = [];
			rowWidth = 0;
		}
		row.push(cell);
		rowWidth += cw;
	}
	if (row.length > 0 || rows.length === 0) rows.push(row);

	// Window around the cursor row (cursor lands on the window's last row while scrolled).
	const cursorRow = Math.max(0, rows.findIndex(r => r.some(cell => cell.isCursor)));
	const count = Math.min(rows.length, Math.max(1, maxLines));
	const start = Math.min(Math.max(0, cursorRow - count + 1), rows.length - count);

	return rows.slice(start, start + count).map((rowCells, i) => {
		let line = start + i === 0 ? "\u203a " : "  "; // › on the first draft row
		let run = "";
		const flush = (): void => {
			if (run.length > 0) {
				line += palette.paint("optionLabel", run);
				run = "";
			}
		};
		for (const cell of rowCells) {
			if (cell.isCursor) {
				flush();
				line += palette.paint("focusLabel", cell.ch); // reverse-video cursor block
			} else {
				run += cell.ch;
			}
		}
		flush();
		return line;
	});
}

export function renderSelectView(vm: SelectViewModel, env: RenderEnv): string[] {
	const palette = resolvePalette(env);
	const checked = vm.checkedIndices ?? [];
	const wrapWidth = Math.max(8, env.columns - 4);
	const searching = vm.filteredIndices !== undefined;
	const editing = vm.editorDraft !== undefined;

	// The question header wraps to the terminal width (display-width aware) instead of truncating on
	// the right; it is capped so the footer plus a minimal body window always fit (AC3) — an over-cap
	// question ends in a lone ellipsis line.
	const questionLinesAll = wrapText(vm.question, Math.max(8, env.columns - 2));
	const maxQuestionLines = Math.max(1, env.rows - (MIN_DESC_WINDOW + 3));
	const questionLines =
		questionLinesAll.length > maxQuestionLines ? [...questionLinesAll.slice(0, maxQuestionLines - 1), "\u2026"] : questionLinesAll;

	// The free-text draft echo wraps too, windowed around the cursor so it stays visible (RF1).
	const maxDraftLines = Math.max(1, env.rows - questionLines.length - (searching ? 1 : 0) - MIN_DESC_WINDOW - 2);
	const draftLines =
		editing && vm.editorDraft !== undefined
			? renderEditorDraftLines(palette, vm.editorDraft.text, vm.editorDraft.cursor, wrapWidth, maxDraftLines)
			: [];

	// The option entries actually rendered, each carrying its ORIGINAL index (checkbox marks map
	// through the original index) and whether it holds focus. While searching, focusIndex is a
	// FILTERED position, so the highlighted row is options[filteredIndices[focusIndex]]; otherwise it
	// is the original index (v2 §3 cursor domain).
	const entries: Array<{ orig: number; isFocus: boolean }> = searching
		? (vm.filteredIndices ?? []).map((orig, pos) => ({ orig, isFocus: pos === vm.focusIndex }))
		: vm.options.map((_, i) => ({ orig: i, isFocus: i === vm.focusIndex }));
	const optionCount = entries.length;
	const focusEntry = entries.find(e => e.isFocus);
	const focusIsOption = focusEntry !== undefined;
	const focusOrig = focusEntry?.orig ?? -1;

	// Search hides the Other/Done control rows (the state's commit path does not reference them while
	// searching); a free-text editor likewise owns the surface below the question.
	const controlLabels: string[] = [];
	if (!searching && !editing) {
		controlLabels.push(OTHER_OPTION);
		if (vm.multi && checked.length > 0) controlLabels.push(DONE_OPTION);
	}

	// The focused option's full description, wrapped, then windowed by descriptionScroll.
	const focusDescLines = focusIsOption ? wrapText(vm.options[focusOrig].description, wrapWidth) : [];

	// Size the focused description window so the whole body fits the row budget. Extra non-option
	// header lines (the wrapped question, a search echo, and/or the wrapped editor draft) are
	// reserved alongside the footer so the view stays <= rows (AC3).
	const extraHeaderLines = (searching ? 1 : 0) + draftLines.length;
	const reserved = questionLines.length + 1 + extraHeaderLines;
	const bodyBudget = Math.max(MIN_DESC_WINDOW + 2, env.rows - reserved);
	const nonFocusOptions = focusIsOption ? optionCount - 1 : optionCount;
	const fixedRows = nonFocusOptions * 2 + controlLabels.length + (focusIsOption ? 1 : 0);
	const descWindow = focusIsOption ? Math.min(focusDescLines.length, Math.max(MIN_DESC_WINDOW, bodyBudget - fixedRows)) : 0;
	const maxDescScroll = Math.max(0, focusDescLines.length - descWindow);
	const descScroll = Math.min(Math.max(0, vm.descriptionScroll ?? 0), maxDescScroll);

	const body: string[] = [];
	for (const { orig, isFocus } of entries) {
		const opt = vm.options[orig];
		if (opt === undefined) continue;
		const marker = vm.multi ? (checked.includes(orig) ? "[x] " : "[ ] ") : "";
		const label = fitCells(orig === vm.recommended ? opt.label + RECOMMENDED_SUFFIX : opt.label, Math.max(4, env.columns - 2 - marker.length));
		const painted = isFocus ? palette.paint("focusLabel", marker + label) : palette.paint("optionLabel", marker + label);
		body.push((isFocus ? FOCUS_PREFIX : BLUR_PREFIX) + painted);
		if (isFocus) {
			for (const line of focusDescLines.slice(descScroll, descScroll + descWindow)) {
				body.push(`    ${palette.paint("description", line)}`);
			}
		} else {
			body.push(`    ${palette.paint("description", wrapText(opt.description, wrapWidth)[0])}`);
		}
	}
	controlLabels.forEach((label, idx) => {
		const focusIndexForRow = vm.options.length + idx; // Other=n, Done=n+1
		const isFocus = vm.focusIndex === focusIndexForRow;
		const painted = isFocus ? palette.paint("focusLabel", fitCells(label, Math.max(4, env.columns - 2))) : palette.paint("optionLabel", fitCells(label, Math.max(4, env.columns - 2)));
		body.push((isFocus ? FOCUS_PREFIX : BLUR_PREFIX) + painted);
	});

	// Window the body by the list-scroll axis (the header-focus scroll); the focused option's own
	// description window (above) is the option-focus scroll axis.
	const maxScroll = Math.max(0, body.length - bodyBudget);
	const start = Math.min(Math.max(0, vm.optionScroll ?? 0), maxScroll);
	const windowed = body.slice(start, start + bodyBudget);

	const headerPrefix = vm.focusIndex === -1 ? FOCUS_PREFIX : BLUR_PREFIX;
	const header: string[] = questionLines.map((line, i) => (i === 0 ? headerPrefix : BLUR_PREFIX) + palette.paint("questionTitle", line));
	// Echo the active search query so an empty projection still shows why the list is empty (RF2).
	if (searching) header.push(palette.paint("footer", fitCells(`/ ${vm.searchQuery ?? ""}`, env.columns)));
	// Echo the free-text editor draft with a visible cursor (RF1).
	header.push(...draftLines);
	const footerLine = palette.paint("footer", fitCells(vm.footerHint ?? DEFAULT_SELECT_FOOTER, env.columns));
	const lines = [...header, ...windowed, footerLine];
	// Hard height clamp: whatever the budgeting above produced, never exceed the terminal rows —
	// the footer stays anchored and tail body lines yield first.
	if (lines.length <= env.rows) return lines;
	return [...lines.slice(0, Math.max(0, env.rows - 1)), footerLine];
}

export function renderChatPanel(vm: ChatPanelViewModel, env: RenderEnv): string[] {
	const palette = resolvePalette(env);
	const width = Math.max(8, env.columns);
	const wrapWidth = Math.max(8, width - 4);
	const targetDesc = vm.target.kind === "option" ? vm.target.label : "the question";

	const lines: string[] = [];
	lines.push(palette.paint("border", "\u2500".repeat(Math.min(width, 60))));
	lines.push(fitCells(`  Side chat \u2014 ${targetDesc}`, width));
	for (const turn of vm.turns) {
		const role = turn.kind === "question" ? "chatQuestion" : "chatAnswer";
		for (const line of wrapText(turn.text, wrapWidth)) lines.push(`  ${palette.paint(role, line)}`);
	}
	if (vm.status === "error" && vm.error !== undefined) {
		for (const line of wrapText(vm.error, wrapWidth)) lines.push(`  ${palette.paint("error", line)}`);
	}
	// The free-prompt input draft, echoed above the footer so the user sees what they are typing (RF1).
	// A draft wider than the terminal wraps (the cursor block rides the last line) instead of truncating.
	if (vm.chatDraft !== undefined && (vm.chatDraft.focused || vm.chatDraft.text.length > 0)) {
		const cursor = vm.chatDraft.focused ? palette.paint("focusLabel", " ") : "";
		const raw = `\u203a ${vm.chatDraft.text}`;
		const draftLines = displayWidth(raw) <= wrapWidth ? [raw] : wrapText(raw, wrapWidth);
		draftLines.forEach((line, i) => {
			lines.push(`  ${palette.paint("chatQuestion", line)}${i === draftLines.length - 1 ? cursor : ""}`);
		});
	}
	lines.push(palette.paint("border", "\u2500".repeat(Math.min(width, 60))));
	const defaultFooter = vm.status === "error" ? "r \uc7ac\uc2dc\ub3c4 \u00b7 Esc \ub4a4\ub85c" : "Enter \uc804\uc1a1 \u00b7 Esc \ub4a4\ub85c";
	lines.push(palette.paint("footer", fitCells(vm.footerHint ?? defaultFooter, width)));

	// Height budget: keep the panel within the terminal rows (borders + footer are anchors).
	if (lines.length <= env.rows) return lines;
	const keepTail = 2; // bottom border + footer
	const head = lines.slice(0, env.rows - keepTail);
	return [...head, lines[lines.length - 2], lines[lines.length - 1]];
}
