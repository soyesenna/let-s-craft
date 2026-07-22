// Regression suite for the ask-ui width-wrapping fix (2026-07-22): the question header WRAPS to
// the terminal width instead of truncating on the right, display-width aware (wide Hangul/CJK
// glyphs count 2 cells), and the free-answer / chat-draft echoes wrap the same way. Fixed
// single-line elements (footer hints, labels) are display-width clipped. Nothing the user typed
// or was asked becomes unreachable because of the terminal width.
//
// Node-safe: imports only the pure modules (render-model, types), like the other ask-ui suites.
import { describe, expect, it } from "vitest";
import { displayWidth, renderChatPanel, renderSelectView, type ChatPanelViewModel, type SelectViewModel } from "../src/ask-ui/render-model";
import type { AskUiOption, RenderEnv } from "../src/ask-ui/types";

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
const plain = (lines: string[]): string => stripAnsi(lines.join("\n"));

const SMALL: RenderEnv = { columns: 40, rows: 24, isLight: false, colorMode: "truecolor" };

const OPTS: readonly AskUiOption[] = [
	{ label: "Alpha", description: "Alpha description." },
	{ label: "Beta", description: "Beta description." },
];

function selectVm(over: Partial<SelectViewModel> = {}): SelectViewModel {
	return { question: "Q", options: OPTS, multi: false, focusIndex: 0, ...over };
}

describe("a long question wraps to the terminal width instead of truncating", () => {
	const LONG_EN =
		"Which integration strategy should the pipeline adopt for the incoming feature branch given the review constraints we discussed earlier today?";
	// Wide Hangul: every syllable is 2 display cells, so char-count wrapping would overflow 2x.
	const LONG_KO =
		"이번 기능 브랜치를 통합할 때 어떤 전략을 사용할지 결정해 주세요 리뷰 제약과 일정 그리고 되돌리기 비용까지 함께 고려해서 신중하게 선택해야 합니다";

	for (const [name, question] of [
		["english", LONG_EN],
		["korean (wide glyphs)", LONG_KO],
	] as const) {
		it(`[${name}] every rendered line fits the terminal width and no question text is lost`, () => {
			const lines = renderSelectView(selectVm({ question }), SMALL);
			for (const line of lines.map(stripAnsi)) {
				expect(displayWidth(line), `overflowing line: ${JSON.stringify(line)}`).toBeLessThanOrEqual(SMALL.columns);
			}
			// Wrapping breaks only at spaces here, so rejoining the visible text restores every word.
			const visible = plain(lines).replace(/\s+/g, " ");
			for (const word of question.split(/\s+/)) expect(visible).toContain(word);
			expect(lines.length).toBeLessThanOrEqual(SMALL.rows);
		});
	}

	it("keeps the height budget even when the question alone would exceed the terminal rows", () => {
		const enormous = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
		const lines = renderSelectView(selectVm({ question: enormous }), SMALL);
		expect(lines.length).toBeLessThanOrEqual(SMALL.rows);
	});
});

describe("the free-answer draft echo wraps and keeps the cursor visible", () => {
	it("wraps a long draft across lines with no line wider than the terminal", () => {
		const text = "가나다라마바사아자차카타파하".repeat(6); // 168 display cells, no spaces
		const lines = renderSelectView(selectVm({ options: [], editorDraft: { text, cursor: 0 } }), SMALL);
		for (const line of lines.map(stripAnsi)) {
			expect(displayWidth(line)).toBeLessThanOrEqual(SMALL.columns);
		}
		// Hard-wrap splits without inserting characters: concatenating the visible draft rows
		// (every line between the question and the footer) must restore the full draft.
		const joined = plain(lines).replace(/[\s\u203a\u276f]/g, "");
		expect(joined).toContain(text);
	});

	it("windows the draft around the cursor when the draft has more rows than fit", () => {
		const tail = "끝단어";
		const text = `${"x".repeat(2000)} ${tail}`;
		const lines = renderSelectView(selectVm({ options: [], editorDraft: { text, cursor: text.length } }), SMALL);
		expect(lines.length).toBeLessThanOrEqual(SMALL.rows);
		expect(plain(lines)).toContain(tail); // the cursor row (draft end) stays visible
	});
});

describe("chat panel answer and draft wrap to the terminal width", () => {
	it("wraps a wide Hangul answer and a wide draft; no visible line overflows", () => {
		const vm: ChatPanelViewModel = {
			target: { kind: "question" },
			turns: [{ kind: "answer", text: "리베이스는 커밋을 선형으로 재적용하기 때문에 이력이 깔끔해지지만 공유 브랜치에서는 위험합니다 ".repeat(3) }],
			status: "complete",
			chatDraft: { text: "그러면 이미 푸시된 브랜치에서는 어떤 전략이 더 안전한지 자세히 설명해 주세요", focused: true },
		};
		const lines = renderChatPanel(vm, SMALL);
		for (const line of lines.map(stripAnsi)) {
			expect(displayWidth(line)).toBeLessThanOrEqual(SMALL.columns);
		}
		expect(lines.length).toBeLessThanOrEqual(SMALL.rows);
	});
});
