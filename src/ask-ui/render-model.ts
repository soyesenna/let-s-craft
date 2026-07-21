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

// Word-wrap into lines no wider than `width` (whitespace-collapsing; a word longer than width overflows
// onto its own line rather than being split). Deterministic: identical input -> identical lines.
function wrapText(text: string, width: number): string[] {
	const words = text.split(/\s+/).filter(w => w.length > 0);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		if (current === "") current = word;
		else if (current.length + 1 + word.length <= width) current = `${current} ${word}`;
		else {
			lines.push(current);
			current = word;
		}
	}
	if (current !== "") lines.push(current);
	return lines.length > 0 ? lines : [""];
}

// Render an editable single-line draft with the cursor visualised as a reverse-video block (the
// focusLabel role carries the reverse attribute). The cursor styling is ANSI-only, so the VISIBLE
// text stays exactly the draft — the render-model contract pins text visibility, cursor glyph free.
function renderEditorDraft(palette: Palette, text: string, cursor: number): string {
	const c = Math.max(0, Math.min(cursor, text.length));
	const before = text.slice(0, c);
	const at = c < text.length ? text[c] : " ";
	const after = c < text.length ? text.slice(c + 1) : "";
	let line = "\u203a "; // ›
	if (before.length > 0) line += palette.paint("optionLabel", before);
	line += palette.paint("focusLabel", at); // reverse-video cursor block
	if (after.length > 0) line += palette.paint("optionLabel", after);
	return line;
}

export function renderSelectView(vm: SelectViewModel, env: RenderEnv): string[] {
	const palette = resolvePalette(env);
	const checked = vm.checkedIndices ?? [];
	const wrapWidth = Math.max(8, env.columns - 4);
	const searching = vm.filteredIndices !== undefined;
	const editing = vm.editorDraft !== undefined;

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
	// header lines (a search echo and/or an editor draft) are reserved alongside question + footer so
	// the view stays <= rows (AC3).
	const extraHeaderLines = (searching ? 1 : 0) + (editing ? 1 : 0);
	const reserved = 2 + extraHeaderLines;
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
		const label = orig === vm.recommended ? opt.label + RECOMMENDED_SUFFIX : opt.label;
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
		const painted = isFocus ? palette.paint("focusLabel", label) : palette.paint("optionLabel", label);
		body.push((isFocus ? FOCUS_PREFIX : BLUR_PREFIX) + painted);
	});

	// Window the body by the list-scroll axis (the header-focus scroll); the focused option's own
	// description window (above) is the option-focus scroll axis.
	const maxScroll = Math.max(0, body.length - bodyBudget);
	const start = Math.min(Math.max(0, vm.optionScroll ?? 0), maxScroll);
	const windowed = body.slice(start, start + bodyBudget);

	const headerPrefix = vm.focusIndex === -1 ? FOCUS_PREFIX : BLUR_PREFIX;
	const header: string[] = [headerPrefix + palette.paint("questionTitle", vm.question)];
	// Echo the active search query so an empty projection still shows why the list is empty (RF2).
	if (searching) header.push(palette.paint("footer", `/ ${vm.searchQuery ?? ""}`));
	// Echo the free-text editor draft with a visible cursor (RF1).
	if (editing && vm.editorDraft) header.push(renderEditorDraft(palette, vm.editorDraft.text, vm.editorDraft.cursor));
	const footerLine = palette.paint("footer", vm.footerHint ?? DEFAULT_SELECT_FOOTER);
	return [...header, ...windowed, footerLine];
}

export function renderChatPanel(vm: ChatPanelViewModel, env: RenderEnv): string[] {
	const palette = resolvePalette(env);
	const width = Math.max(8, env.columns);
	const wrapWidth = Math.max(8, width - 4);
	const targetDesc = vm.target.kind === "option" ? vm.target.label : "the question";

	const lines: string[] = [];
	lines.push(palette.paint("border", "\u2500".repeat(Math.min(width, 60))));
	lines.push(`  Side chat \u2014 ${targetDesc}`);
	for (const turn of vm.turns) {
		const role = turn.kind === "question" ? "chatQuestion" : "chatAnswer";
		for (const line of wrapText(turn.text, wrapWidth)) lines.push(`  ${palette.paint(role, line)}`);
	}
	if (vm.status === "error" && vm.error !== undefined) {
		for (const line of wrapText(vm.error, wrapWidth)) lines.push(`  ${palette.paint("error", line)}`);
	}
	// The free-prompt input draft, echoed above the footer so the user sees what they are typing (RF1).
	if (vm.chatDraft !== undefined && (vm.chatDraft.focused || vm.chatDraft.text.length > 0)) {
		const cursor = vm.chatDraft.focused ? palette.paint("focusLabel", " ") : "";
		lines.push(`  ${palette.paint("chatQuestion", `\u203a ${vm.chatDraft.text}`)}${cursor}`);
	}
	lines.push(palette.paint("border", "\u2500".repeat(Math.min(width, 60))));
	const defaultFooter = vm.status === "error" ? "r \uc7ac\uc2dc\ub3c4 \u00b7 Esc \ub4a4\ub85c" : "Enter \uc804\uc1a1 \u00b7 Esc \ub4a4\ub85c";
	lines.push(palette.paint("footer", vm.footerHint ?? defaultFooter));

	// Height budget: keep the panel within the terminal rows (borders + footer are anchors).
	if (lines.length <= env.rows) return lines;
	const keepTail = 2; // bottom border + footer
	const head = lines.slice(0, env.rows - keepTail);
	return [...head, lines[lines.length - 2], lines[lines.length - 1]];
}
