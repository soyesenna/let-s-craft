// Regression suite for the free-answer editor cursor fix (2026-07-22): the editor honors
// left/right/home/end cursor movement (code-point safe across surrogate pairs), so a typo in the
// middle of a draft can be repaired without retyping the tail. Before the fix the arrow keys were
// not part of the AskUiKey vocabulary and were silently dropped by the printable-char filter.
//
// Node-safe: imports only the pure reducer (state), like the other ask-ui suites.
import { describe, expect, it } from "vitest";
import { createInitialState, reduce, type AskUiEvent, type AskUiKey, type AskUiState, type AskUiView } from "../src/ask-ui/state";
import type { AskUiOption } from "../src/ask-ui/types";

const OPTS: readonly AskUiOption[] = [
	{ label: "Alpha", description: "Alpha description." },
	{ label: "Beta", description: "Beta description." },
];

const K = (key: AskUiKey): AskUiEvent => ({ type: "key", key });
const CH = (text: string): AskUiEvent => ({ type: "char", text });

function askState(prefill: string): AskUiState {
	const view: AskUiView = { tool: "ask", question: "Describe the fix", options: [], multi: false, prefill };
	return createInitialState(view); // ask tool starts in editor mode, cursor at draft end
}

function drive(state: AskUiState, events: AskUiEvent[]): AskUiState {
	let s = state;
	for (const e of events) s = reduce(s, e).state;
	return s;
}

describe("left/right/home/end move the free-answer cursor", () => {
	it("left moves the cursor back and a typed char lands at the cursor (mid-draft repair)", () => {
		const s0 = askState("abd");
		const s = drive(s0, [K("left"), CH("c")]); // ab|d -> abc|d
		expect(s.askDraft).toBe("abcd");
		expect(s.askCursor).toBe(3);
	});

	it("right/home/end clamp to the draft bounds", () => {
		const s0 = askState("한글답변");
		expect(drive(s0, [K("right")]).askCursor).toBe(4); // already at end — stays
		expect(drive(s0, [K("home")]).askCursor).toBe(0);
		expect(drive(s0, [K("home"), K("left")]).askCursor).toBe(0);
		expect(drive(s0, [K("home"), K("end")]).askCursor).toBe(4);
	});

	it("left/right step over an astral code point without splitting the surrogate pair", () => {
		const s0 = askState("a\u{1f600}b"); // a😀b — 😀 is 2 UTF-16 units
		const afterLeft = drive(s0, [K("left"), K("left")]); // b, then the whole emoji
		expect(afterLeft.askCursor).toBe(1);
		const afterRight = drive(afterLeft, [K("right")]);
		expect(afterRight.askCursor).toBe(3); // back across the emoji in one step
		// Inserting at the moved cursor keeps the draft well-formed.
		const repaired = drive(afterLeft, [CH("한")]);
		expect(repaired.askDraft).toBe("a한\u{1f600}b");
	});

	it("cursor keys leave browse/search modes untouched (no accidental commits)", () => {
		const view: AskUiView = { tool: "select", question: "Q", options: [...OPTS], multi: false };
		const browse = createInitialState(view);
		for (const key of ["left", "right", "home", "end"] as const) {
			const r = reduce(browse, K(key));
			expect(r.effects).toEqual([]);
			expect(r.state.canonicalCursor).toBe(browse.canonicalCursor);
		}
	});
});
