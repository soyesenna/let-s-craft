// Render-model view-model -> row MAPPING contracts (the R-series-OUTSIDE aspects).
//
// BOUNDARY (Main ruling A, 2026-07-20): TesterSnapshot's ask-ui-snapshot.test.ts (R1-R6) is the SSOT
// for render STRUCTURE (line-count <= rows, focus full-text no-loss reachability, non-focus first
// line, list scrolling, 24-row small terminal, size-sequence absence) AND for the palette invariants.
// This file deliberately asserts NONE of those. It owns only the non-structural view-model -> row
// mapping that R-series does not vary: recommended marker, checkbox marker, question-header focus
// projection, Other/Done control-row projection AND their focus projection (the v2 §3 focus domain
// extends the cursor to n=Other / n+1=Done — the control rows are now focusable, so the mapping must
// reflect focus on them), empty-list & boundary inputs, and renderChatPanel target/status mapping.
//
// EXPECTED STATE: RED — `../src/ask-ui/render-model` and `../src/ask-ui/types` do not exist until PR2.
import { describe, expect, it } from "vitest";
import { DONE_OPTION, OTHER_OPTION } from "../src/ask";
import {
	renderChatPanel,
	renderSelectView,
	type ChatPanelViewModel,
	type SelectViewModel,
} from "../src/ask-ui/render-model";
import type { AskUiOption, ChatTarget, RenderEnv } from "../src/ask-ui/types";

// RenderEnv.colorMode exact-union pin moved to assets/typecheck/ask-ui-contract.test-d.ts (CS5 — real tsc stage runs it; a dormant in-suite alias was transpiled away, never checked).

const QUESTION = "Choose an integration strategy";
const OPTS: readonly AskUiOption[] = [
	{ label: "Alpha", description: "Alpha description." },
	{ label: "Beta", description: "Beta description." },
	{ label: "Gamma", description: "Gamma description." },
];
// A comfortably tall/wide env so nothing is scrolled off — this file is about mapping, not geometry
// (geometry under tight budgets is R-series' SSOT). colorMode is a canonical mode (truecolor).
const ENV: RenderEnv = { columns: 80, rows: 40, isLight: false, colorMode: "truecolor" };

function selectVm(over: Partial<SelectViewModel> = {}): SelectViewModel {
	return { question: QUESTION, options: OPTS, multi: false, focusIndex: 0, ...over };
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const plain = (lines: string[]): string => stripAnsi(lines.join("\n"));
const rowWith = (lines: string[], label: string): string => lines.find(l => stripAnsi(l).includes(label)) ?? "";

// ---------------------------------------------------------------------------
// Recommended marker projection (R-series fixes recommended=undefined)
// ---------------------------------------------------------------------------

describe("recommended marker projection (render-model)", () => {
	it("marks the recommended option's row distinctly from the same option unmarked", () => {
		const withRec = renderSelectView(selectVm({ recommended: 1 }), ENV);
		const noRec = renderSelectView(selectVm({ recommended: undefined }), ENV);
		expect(rowWith(withRec, "Beta")).not.toBe(rowWith(noRec, "Beta"));
	});
});

// ---------------------------------------------------------------------------
// Checkbox marker projection (R-series fixes multi=false)
// ---------------------------------------------------------------------------

describe("checkbox marker projection (render-model)", () => {
	it("renders a checked option's row differently from when it is unchecked", () => {
		const checked = renderSelectView(selectVm({ multi: true, checkedIndices: [0] }), ENV);
		const unchecked = renderSelectView(selectVm({ multi: true, checkedIndices: [] }), ENV);
		expect(rowWith(checked, "Alpha")).not.toBe(rowWith(unchecked, "Alpha"));
	});
});

// ---------------------------------------------------------------------------
// Question-header focus projection (canonicalCursor = -1)
// ---------------------------------------------------------------------------

describe("question-header focus projection (render-model)", () => {
	it("keeps the question visible and moves the focus indicator onto the header at focusIndex -1", () => {
		const headerFocus = renderSelectView(selectVm({ focusIndex: -1 }), ENV);
		expect(plain(headerFocus)).toContain(QUESTION);
		expect(headerFocus).not.toEqual(renderSelectView(selectVm({ focusIndex: 0 }), ENV));
	});
});

// ---------------------------------------------------------------------------
// Control-row (Other / Done) projection + focus — parity with the v2 §3 cursor domain
// (n = Other, n+1 = Done when multi && checked > 0). The rows are reachable, so a focused
// control row must project distinctly from an unfocused one.
// ---------------------------------------------------------------------------

describe("Other/Done control-row projection (render-model)", () => {
	it("always projects the Other row", () => {
		expect(plain(renderSelectView(selectVm(), ENV))).toContain(OTHER_OPTION);
	});

	it("omits Done for a single-select and for a multi-select with nothing checked", () => {
		expect(plain(renderSelectView(selectVm({ multi: false }), ENV))).not.toContain(DONE_OPTION);
		expect(plain(renderSelectView(selectVm({ multi: true, checkedIndices: [] }), ENV))).not.toContain(DONE_OPTION);
	});

	it("projects Done alongside Other once a multi-select has a checked option", () => {
		const out = plain(renderSelectView(selectVm({ multi: true, checkedIndices: [0] }), ENV));
		expect(out).toContain(DONE_OPTION);
		expect(out).toContain(OTHER_OPTION);
	});

	it("focus-marks the Other row at focusIndex n (right after the last option)", () => {
		const n = OPTS.length;
		const focused = renderSelectView(selectVm({ focusIndex: n }), ENV);
		const unfocused = renderSelectView(selectVm({ focusIndex: 0 }), ENV);
		expect(rowWith(focused, OTHER_OPTION)).not.toBe(rowWith(unfocused, OTHER_OPTION));
	});

	it("focus-marks the Done row at focusIndex n+1 for a multi-select with checks", () => {
		const n = OPTS.length;
		const focused = renderSelectView(selectVm({ multi: true, checkedIndices: [0], focusIndex: n + 1 }), ENV);
		const unfocused = renderSelectView(selectVm({ multi: true, checkedIndices: [0], focusIndex: 0 }), ENV);
		expect(rowWith(focused, DONE_OPTION)).not.toBe(rowWith(unfocused, DONE_OPTION));
	});
});

// ---------------------------------------------------------------------------
// Empty list & boundary inputs — never throw
// ---------------------------------------------------------------------------

describe("empty list & boundary inputs (render-model)", () => {
	it("renders an empty option list without throwing and still shows the question", () => {
		const lines = renderSelectView(selectVm({ options: [], focusIndex: -1 }), ENV);
		expect(Array.isArray(lines)).toBe(true);
		expect(plain(lines)).toContain(QUESTION);
	});

	it("tolerates out-of-range focus / checked / scroll inputs", () => {
		expect(() => renderSelectView(selectVm({ focusIndex: 99 }), ENV)).not.toThrow();
		expect(() => renderSelectView(selectVm({ focusIndex: -5 }), ENV)).not.toThrow();
		expect(() => renderSelectView(selectVm({ multi: true, checkedIndices: [99] }), ENV)).not.toThrow();
		expect(() => renderSelectView(selectVm({ optionScroll: 9999 }), ENV)).not.toThrow();
		expect(() => renderSelectView(selectVm({ descriptionScroll: 9999 }), ENV)).not.toThrow();
	});

	it("renders in the 256color capability mode as well as truecolor without throwing", () => {
		const env256: RenderEnv = { ...ENV, colorMode: "256color" };
		expect(() => renderSelectView(selectVm(), env256)).not.toThrow();
		expect(plain(renderSelectView(selectVm(), env256))).toContain(QUESTION);
	});
});

// ---------------------------------------------------------------------------
// Chat panel target + status content mapping (R6 covers color roles/budget, not this axis)
// ---------------------------------------------------------------------------

describe("chat panel target/status content mapping (render-model)", () => {
	const optionTarget: ChatTarget = { kind: "option", label: "Rebase" };
	const questionTarget: ChatTarget = { kind: "question" };

	it("projects a completed turn's question and answer text into the panel", () => {
		const vm: ChatPanelViewModel = {
			target: optionTarget,
			turns: [
				{ kind: "question", text: "Explain Rebase" },
				{ kind: "answer", text: "Rebase replays commits linearly." },
			],
			status: "complete",
		};
		const out = plain(renderChatPanel(vm, ENV));
		expect(out).toContain("Explain Rebase");
		expect(out).toContain("Rebase replays commits linearly.");
	});

	it("surfaces the error text when status is error", () => {
		const vm: ChatPanelViewModel = {
			target: optionTarget,
			turns: [],
			status: "error",
			error: "429 rate limited (retryable)",
		};
		expect(plain(renderChatPanel(vm, ENV))).toContain("429 rate limited (retryable)");
	});

	it("shows the partial text while streaming", () => {
		const vm: ChatPanelViewModel = {
			target: questionTarget,
			turns: [{ kind: "answer", text: "partial so f" }],
			status: "streaming",
		};
		expect(plain(renderChatPanel(vm, ENV))).toContain("partial so f");
	});

	it("reflects the target: identical turns under different targets render differently", () => {
		const turns = [{ kind: "answer" as const, text: "shared answer text" }];
		const optVm: ChatPanelViewModel = { target: optionTarget, turns, status: "complete" };
		const qVm: ChatPanelViewModel = { target: questionTarget, turns, status: "complete" };
		expect(plain(renderChatPanel(optVm, ENV))).toContain("Rebase"); // the option label identifies its panel
		expect(renderChatPanel(optVm, ENV)).not.toEqual(renderChatPanel(qVm, ENV)); // only the target differs
	});
});
