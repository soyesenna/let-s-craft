// U9 (state-transition-table reducer) + U10 (host-parity reducer) + U8 (state preservation).
//
// Scope: the Node-safe pure reducer `src/ask-ui/state.ts` ONLY — semantic intents in, {state,
// effects} out. Raw-key -> intent classification (matchesKey) and live completion belong to the Bun
// leaf and its adapter suite; render layout belongs to R-series. Canon: plan §PR2 state-transition
// canon + Fallback/Failure canon; appendix-palette §2 keymap; ask-ui-wiring-contract-v2 §3 (focus
// domain) + §5 (event vocabulary with injected timestamps + retry).
//
// FOCUS DOMAIN (v2 §3, Main-ratified 2026-07-20): canonicalCursor is an integer over
//   -1 = question header | 0..n-1 = options | n = Other | n+1 = Done (multi && checked>0 only).
// The control rows ARE reachable and actionable — there is no "deliberately not pinned" escape hatch:
//   * option-row Enter  -> commit (single/confirm)  OR  toggle (multi, Space-equivalent);
//   * Other-row  Enter  -> open the free-text editor (Other -> editor chain);
//   * Done-row   Enter  -> commit the checked set (multi only).
//
// TIME + RETRY (v2 §5): the reducer is pure — it NEVER reads a clock. Turn timestamps are injected on
// the event that creates/ends a turn: the turn-starting event (a `session` auto-fire, or a
// detail/enter/retry `key`) carries `at` -> startedAt; the `settle` event carries `at` -> endedAt.
// Retry (`r` from an error turn) reuses the frozen session (no createSession), bumps turnId
// monotonically, and re-sends the failed turn's prompt byte-for-byte.
//
// Contract surface (ask-ui-wiring-contract-v2 §2 result union, §5 events):
//   - reduce(state, event) -> { state, effects }; pure (never mutates input).
//   - terminal signal = { type: "done", result: AskUiResult } where, per v2 §2,
//       select : { kind:"answer"; selections:string[]; freeText? } | { kind:"cancel" }
//       confirm: { kind:"answer"; confirmed:boolean|null; freeText? } | { kind:"cancel" }
//       ask    : { kind:"answer"; response:string } | { kind:"cancel" }
//     plus an optional sideChat: SideChatTurn[] on answer arm only (recorded turns; details channel only).
//   - settle carries SideChatResult{ text, status, error? } + `at`; the reducer maps result.text ->
//     turn.response and `at` -> turn.endedAt (appendix §4 schema).
//
// EXPECTED STATE: RED — `../src/ask-ui/state` does not exist until PR2 implements it. The import
// failure is the correct pre-craft signal, not a defect in this file.
import { describe, expect, it } from "vitest";
import { DONE_OPTION, OTHER_OPTION } from "../src/ask";
import {
	controlRows,
	createInitialState,
	markableCount,
	reduce,
	searchOptions,
	selectionMarker,
	type AskUiEvent,
	type AskUiKey,
	type AskUiState,
	type AskUiView,
	type ReduceResult,
} from "../src/ask-ui/state";
import type { SideChatRequest, SideChatResult, SideChatSession } from "../src/ask-ui/completion-core";
import type { AskUiOption } from "../src/ask-ui/types";

// ---------------------------------------------------------------------------
// Fixtures + drivers
// ---------------------------------------------------------------------------

function selectView(over: Partial<AskUiView> = {}): AskUiView {
	return {
		tool: "select",
		question: "Choose an integration strategy",
		options: [
			{ label: "Alpha", description: "Alpha line one.\nAlpha line two.\nAlpha line three.\nAlpha line four." },
			{ label: "Beta", description: "Beta description." },
			{ label: "Gamma", description: "Gamma description." },
		],
		multi: false,
		...over,
	};
}
function multiView(over: Partial<AskUiView> = {}): AskUiView {
	return selectView({ multi: true, ...over });
}
function confirmView(): AskUiView {
	return {
		tool: "confirm",
		question: "Proceed with the merge?",
		options: [
			{ label: "Yes", description: "Proceed." },
			{ label: "No", description: "Stop." },
		],
		multi: false,
	};
}
function askView(over: Partial<AskUiView> = {}): AskUiView {
	return { tool: "ask", question: "Describe the desired behavior", options: [], multi: false, prefill: "", ...over };
}

const SEARCH_OPTIONS: readonly AskUiOption[] = [
	{ label: "Rebase", description: "Replay commits linearly." },
	{ label: "Merge", description: "Create a joining commit." },
	{ label: "Squash", description: "Collapse into one commit." },
];
// A select view over SEARCH_OPTIONS, for the reducer-level search navigation tests.
const searchableView = (over: Partial<AskUiView> = {}): AskUiView => selectView({ options: [...SEARCH_OPTIONS], ...over });

const FAKE_SESSION: SideChatSession = Object.freeze({
	nonce: "n1",
	sessionId: "main:side:n1",
	promptCacheKey: "main",
	model: "anthropic/claude-sonnet",
	systemPrompt: "You have NO tools.",
	historySnapshot: Object.freeze([]),
});

// Deterministic injected timestamps (ISO-8601). The reducer copies these verbatim — it never reads a
// wall clock — so identical event streams must yield byte-identical turn timestamps.
const T_START1 = "2026-07-20T00:00:00.000Z";
const T_END1 = "2026-07-20T00:00:03.000Z";
const T_START2 = "2026-07-20T00:00:05.000Z";
const T_END2 = "2026-07-20T00:00:08.000Z";
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const K = (key: AskUiKey): AskUiEvent => ({ type: "key", key });
// A turn-starting key carries the wall-clock `at` the driver read; the reducer stamps startedAt from it.
const KT = (key: AskUiKey, at: string): AskUiEvent => ({ type: "key", key, at });
const CH = (text: string): AskUiEvent => ({ type: "char", text });
const BS: AskUiEvent = { type: "backspace" };
const SUBMIT_ASK: AskUiEvent = { type: "submitAsk" };
// `at` is present when the landing session auto-fires a pending one-button turn (startedAt source).
const sessionEvt = (session: SideChatSession, at?: string): AskUiEvent =>
	at === undefined ? { type: "session", session } : { type: "session", session, at };
const delta = (turnId: number, text: string): AskUiEvent => ({ type: "delta", turnId, text });
const settle = (turnId: number, result: SideChatResult, at: string): AskUiEvent => ({ type: "settle", turnId, result, at });

function drive(view: AskUiView, events: AskUiEvent[]): AskUiState {
	let state = createInitialState(view);
	for (const event of events) state = reduce(state, event).state;
	return state;
}

type AnyEffect = { type: string; [k: string]: unknown };
const has = (r: ReduceResult, type: string): boolean => r.effects.some(e => e.type === type);
const pick = (r: ReduceResult, type: string): AnyEffect | undefined =>
	(r.effects as unknown as AnyEffect[]).find(e => e.type === type);
// The terminal answer/cancel payload the driver forwards to custom done() (never set for side turns).
const doneResult = (r: ReduceResult): unknown => pick(r, "done")?.result;
// The reducer builds the provider-ready request (via completion-core buildSideRequest) and hands it to
// the driver on the startTurn effect, so the driver only has to execute it — and so the reducer can
// record the exact prompt it sent (needed for byte-equal retry).
const startTurnRequest = (r: ReduceResult): SideChatRequest | undefined =>
	pick(r, "startTurn")?.request as SideChatRequest | undefined;
const lastUser = (req: SideChatRequest): string => req.messages[req.messages.length - 1].content;

// ---------------------------------------------------------------------------
// U9 — mount focus (recommended ?? 0 option row; ask starts in the editor)
// ---------------------------------------------------------------------------

describe("createInitialState — mount focus (U9, AC1.1)", () => {
	it("focuses the first option row (not the question header) for a select with no recommendation", () => {
		const s = createInitialState(selectView());
		expect(s.mode).toBe("browse");
		expect(s.canonicalCursor).toBe(0);
		expect(s.canonicalCursor).not.toBe(-1); // must NOT default to the question header
	});

	it("focuses the recommended option row at mount", () => {
		expect(createInitialState(selectView({ recommended: 2 })).canonicalCursor).toBe(2);
	});

	it("starts an ask tool in the editor with the header as its escape target", () => {
		const s = createInitialState(askView({ prefill: "seed text" }));
		expect(s.mode).toBe("editor");
		expect(s.canonicalCursor).toBe(-1);
		expect(s.askDraft).toBe("seed text");
	});

	it("initializes durable state clean (no checks, no scroll, no session, no turns)", () => {
		const s = createInitialState(selectView());
		expect(s.checkedIndices).toEqual([]);
		expect(s.optionScroll).toBe(0);
		expect(s.searchQuery).toBe("");
		expect(s.activeTurnId).toBe(0);
		expect(s.turns).toEqual([]);
		expect(s.sideSession).toBeUndefined();
	});

	it("is a pure reducer — dispatching never mutates the input state", () => {
		const s = createInitialState(selectView());
		const cursorBefore = s.canonicalCursor;
		reduce(s, K("down"));
		expect(s.canonicalCursor).toBe(cursorBefore);
	});
});

// ---------------------------------------------------------------------------
// U9 — browse navigation + question-header focus target (canonicalCursor = -1)
// ---------------------------------------------------------------------------

describe("browse navigation + question header (U9, AC1.1)", () => {
	it("moves focus up into the question header from the first option", () => {
		expect(drive(selectView(), [K("up")]).canonicalCursor).toBe(-1);
	});

	it("moves focus down from the question header to the first option", () => {
		expect(drive(selectView(), [K("up"), K("down")]).canonicalCursor).toBe(0);
	});

	it("does not move above the question header", () => {
		expect(drive(selectView(), [K("up"), K("up")]).canonicalCursor).toBe(-1);
	});

	it("treats Enter and Space on the question header as no-ops", () => {
		const header = drive(selectView(), [K("up")]);
		const afterEnter = reduce(header, K("enter"));
		expect(afterEnter.state.canonicalCursor).toBe(-1);
		expect(has(afterEnter, "done")).toBe(false); // header Enter must NOT finish the question
		const afterSpace = reduce(header, K("space"));
		expect(afterSpace.state.checkedIndices).toEqual([]);
		expect(has(afterSpace, "done")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// U9 — single-select + confirm commit / cancel  (+ confirm Other free text)
// ---------------------------------------------------------------------------

describe("single-select and confirm commit + cancel (U9, AC1.1)", () => {
	it("commits the focused option on Enter and asks the driver to finish", () => {
		const r = reduce(drive(selectView(), [K("down")]), K("enter"));
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", selections: ["Beta"] });
	});

	it("cancels the whole select question on Esc from browse", () => {
		const r = reduce(createInitialState(selectView()), K("esc"));
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "cancel" });
	});

	it("maps confirm Yes/No option rows onto the boolean answer", () => {
		expect(doneResult(reduce(createInitialState(confirmView()), K("enter")))).toMatchObject({
			kind: "answer",
			confirmed: true,
		});
		expect(doneResult(reduce(drive(confirmView(), [K("down")]), K("enter")))).toMatchObject({
			kind: "answer",
			confirmed: false,
		});
	});

	it("cancels a confirm question on Esc", () => {
		expect(doneResult(reduce(createInitialState(confirmView()), K("esc")))).toMatchObject({ kind: "cancel" });
	});

	it("opens a free-text editor from the confirm Other row and commits confirmed:null + freeText", () => {
		// confirm rows: Yes(0), No(1), Other(2=n). Reach Other, Enter -> editor, type, submit.
		const inEditor = drive(confirmView(), [K("down"), K("down"), K("enter"), CH("m"), CH("a"), CH("y"), CH("b"), CH("e")]);
		expect(inEditor.mode).toBe("editor");
		const r = reduce(inEditor, SUBMIT_ASK);
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", confirmed: null, freeText: "maybe" });
	});
});

// ---------------------------------------------------------------------------
// U10 — host parity: markers, checked state, markable count
// ---------------------------------------------------------------------------

describe("host parity — selection markers + markable count (U10, AC3.2)", () => {
	it("derives a radio marker for single-select and a checkbox marker for multi-select", () => {
		expect(selectionMarker(selectView())).toBe("radio");
		expect(selectionMarker(multiView())).toBe("checkbox");
	});

	it("reports the canonical option count as markable (control rows excluded)", () => {
		expect(markableCount(selectView())).toBe(3);
		expect(markableCount(confirmView())).toBe(2);
	});
});

describe("host parity — multi-select checked state (U10, AC1.3/AC3.2)", () => {
	it("toggles the focused option on Space", () => {
		expect(drive(multiView(), [K("space")]).checkedIndices).toEqual([0]);
		expect(drive(multiView(), [K("space"), K("space")]).checkedIndices).toEqual([]);
	});

	it("accumulates checked indices in sorted order across cursor moves", () => {
		expect(drive(multiView(), [K("space"), K("down"), K("down"), K("space")]).checkedIndices).toEqual([0, 2]);
	});

	it("never toggles for a single-select tool", () => {
		expect(drive(selectView(), [K("space")]).checkedIndices).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// U10 — multi option Enter = toggle (Space-equivalent); commit is Done-only
// ---------------------------------------------------------------------------

describe("multi-select option Enter toggles; single/confirm option Enter commits (U10, v2 §3)", () => {
	it("toggles the focused option on Enter for a multi-select and does NOT commit", () => {
		const r = reduce(createInitialState(multiView()), K("enter"));
		expect(r.state.checkedIndices).toEqual([0]); // toggled on
		expect(has(r, "done")).toBe(false); // a multi option Enter never finishes the question
	});

	it("makes Enter and Space equivalent toggles on a multi-select option", () => {
		expect(drive(multiView(), [K("enter")]).checkedIndices).toEqual(drive(multiView(), [K("space")]).checkedIndices);
		expect(drive(multiView(), [K("enter"), K("enter")]).checkedIndices).toEqual([]); // Enter toggles back off
	});

	it("commits immediately on Enter for a single-select option (unchanged)", () => {
		const r = reduce(createInitialState(selectView()), K("enter"));
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", selections: ["Alpha"] });
	});
});

// ---------------------------------------------------------------------------
// U9/U10 — control rows are reachable AND actionable (v2 §3 focus domain)
// ---------------------------------------------------------------------------

describe("host parity — control rows present: Other always, Done only when marked (U10, v2 §3)", () => {
	// controlRows are returned in cursor order (Other at n, Done at n+1) — matching the focus domain.
	it("offers only Other for a single-select", () => {
		expect(controlRows(createInitialState(selectView()))).toEqual([OTHER_OPTION]);
	});

	it("offers only Other for a confirm", () => {
		expect(controlRows(createInitialState(confirmView()))).toEqual([OTHER_OPTION]);
	});

	it("offers only Other for a multi-select with nothing checked", () => {
		expect(controlRows(createInitialState(multiView()))).toEqual([OTHER_OPTION]);
	});

	it("adds Done after Other (cursor order n=Other, n+1=Done) once a multi-select has a checked option", () => {
		expect(controlRows(drive(multiView(), [K("space")]))).toEqual([OTHER_OPTION, DONE_OPTION]);
	});
});

describe("control rows are reachable by keyboard and actionable (U9/U10, v2 §3)", () => {
	const N = selectView().options.length; // 3

	it("reaches Other at canonicalCursor n by moving Down past the last option", () => {
		expect(drive(selectView(), [K("down"), K("down"), K("down")]).canonicalCursor).toBe(N);
	});

	it("clamps at Other for a single-select — there is no Done row to reach", () => {
		expect(drive(selectView(), [K("down"), K("down"), K("down"), K("down")]).canonicalCursor).toBe(N);
	});

	it("clamps at Other for a multi-select with nothing checked", () => {
		expect(drive(multiView(), [K("down"), K("down"), K("down"), K("down")]).canonicalCursor).toBe(N);
	});

	it("reaches Done at n+1 only once a multi-select has a checked option", () => {
		// check Alpha(0), then Down: Beta(1) -> Gamma(2) -> Other(n=3) -> Done(n+1=4)
		expect(drive(multiView(), [K("space"), K("down"), K("down"), K("down"), K("down")]).canonicalCursor).toBe(N + 1);
	});

	it("opens the free-text editor when Enter is pressed on Other (Other -> editor chain), never committing", () => {
		const onOther = drive(selectView(), [K("down"), K("down"), K("down")]);
		const r = reduce(onOther, K("enter"));
		expect(r.state.mode).toBe("editor");
		expect(r.state.askDraft).toBe(""); // fresh free-text draft
		expect(has(r, "done")).toBe(false); // Other Enter does NOT finish the question
	});

	it("commits a single-select free-text answer from the Other editor via submitAsk", () => {
		const inEditor = drive(selectView(), [K("down"), K("down"), K("down"), K("enter"), CH("m"), CH("y"), CH("o")]);
		const r = reduce(inEditor, SUBMIT_ASK);
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", selections: [], freeText: "myo" });
	});

	it("carries the checked set alongside the free text when Other is used on a multi-select", () => {
		// check Alpha(0) + Gamma(2), reach Other, edit, submit -> selections + freeText together
		const inEditor = drive(multiView(), [
			K("space"),
			K("down"),
			K("down"),
			K("space"), // checked [0,2]
			K("down"), // Other (n)
			K("enter"), // -> editor
			CH("h"),
			CH("i"),
		]);
		const r = reduce(inEditor, SUBMIT_ASK);
		expect(doneResult(r)).toMatchObject({ kind: "answer", selections: ["Alpha", "Gamma"], freeText: "hi" });
	});

	it("returns from the Other editor to the Other row on Esc, preserving the draft, then re-enters", () => {
		const inEditor = drive(selectView(), [K("down"), K("down"), K("down"), K("enter"), CH("x")]);
		const back = reduce(inEditor, K("esc")).state;
		expect(back.mode).toBe("browse");
		expect(back.canonicalCursor).toBe(N); // still on Other
		expect(back.askDraft).toBe("x"); // draft survives the Esc
		expect(reduce(back, K("enter")).state.mode).toBe("editor"); // re-entry re-opens the editor
	});

	it("commits the checked set when Enter is pressed on Done (multi)", () => {
		// check Alpha(0) + Gamma(2); Down to Other(n) then Done(n+1); Enter commits.
		const onDone = drive(multiView(), [K("space"), K("down"), K("down"), K("space"), K("down"), K("down")]);
		expect(onDone.canonicalCursor).toBe(N + 1); // Done
		const r = reduce(onDone, K("enter"));
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", selections: ["Alpha", "Gamma"] });
	});
});

// ---------------------------------------------------------------------------
// U10 — fuzzy search: pure filter (label+description, original-index mapping)
// ---------------------------------------------------------------------------

describe("host parity — fuzzy search filter (U10, AC3.2)", () => {
	it("returns every option with its original index for an empty query", () => {
		expect(searchOptions(SEARCH_OPTIONS, "").map(h => h.index)).toEqual([0, 1, 2]);
	});

	it("matches against the label", () => {
		const hits = searchOptions(SEARCH_OPTIONS, "Merge");
		expect(hits.map(h => h.index)).toEqual([1]);
		expect(hits[0].option.label).toBe("Merge");
	});

	it("matches against the description too, not just the label", () => {
		expect(searchOptions(SEARCH_OPTIONS, "linearly").map(h => h.index)).toEqual([0]);
	});

	it("is case-insensitive", () => {
		expect(searchOptions(SEARCH_OPTIONS, "squash").map(h => h.index)).toEqual([2]);
	});

	it("preserves the ORIGINAL canonical index of each surviving option", () => {
		// "commit" appears in every description; the mapping must keep 0/1/2, not renumber the filtered subset.
		expect(searchOptions(SEARCH_OPTIONS, "commit").map(h => h.index)).toEqual([0, 1, 2]);
		const only = searchOptions(SEARCH_OPTIONS, "Squash");
		expect(only[0].index).toBe(2);
		expect(SEARCH_OPTIONS[only[0].index].label).toBe("Squash");
	});

	it("returns an empty result when nothing matches", () => {
		expect(searchOptions(SEARCH_OPTIONS, "zzzzz")).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// U10 — search submode transitions + filtered navigation / commit / empty / ?/t
// ---------------------------------------------------------------------------

describe("search submode transitions (U10)", () => {
	it("enters the search submode on '/'", () => {
		expect(reduce(createInitialState(selectView()), K("search")).state.mode).toBe("search");
	});

	it("edits the query with printable chars and backspace", () => {
		const typed = drive(selectView(), [K("search"), CH("B"), CH("e")]);
		expect(typed.searchQuery).toBe("Be");
		expect(reduce(typed, BS).state.searchQuery).toBe("B");
	});

	it("returns to browse on Esc (Esc-to-browse)", () => {
		const back = reduce(drive(selectView(), [K("search"), CH("x")]), K("esc")).state;
		expect(back.mode).toBe("browse");
		expect(back.searchQuery).toBe("");
	});

	it("preserves checked state while searching", () => {
		expect(drive(multiView(), [K("space"), K("search"), CH("m")]).checkedIndices).toEqual([0]);
	});
});

describe("search: filtered navigation commits the ORIGINAL option index (U10)", () => {
	it("navigates within the filtered subset and commits the original canonical index, not the filtered position", () => {
		// filter "s" keeps Rebase(0) + Squash(2); Merge(1) is filtered out.
		expect(searchOptions(SEARCH_OPTIONS, "s").map(h => h.index)).toEqual([0, 2]);
		const onSquash = reduce(drive(searchableView(), [K("search"), CH("s")]), K("down")).state; // 1st filtered -> 2nd filtered
		const committed = reduce(onSquash, K("enter"));
		expect(has(committed, "done")).toBe(true);
		expect(doneResult(committed)).toMatchObject({ kind: "answer", selections: ["Squash"] }); // original index 2
	});

	it("keeps navigation safe on an empty result and never commits a non-existent option", () => {
		const empty = drive(searchableView(), [K("search"), CH("z"), CH("z")]);
		expect(searchOptions(SEARCH_OPTIONS, "zz")).toEqual([]);
		expect(() => reduce(empty, K("down"))).not.toThrow();
		expect(() => reduce(empty, K("up"))).not.toThrow();
		expect(has(reduce(empty, K("enter")), "done")).toBe(false); // nothing to select -> question survives
	});

	it("treats ? and t as query input (not chat triggers) while searching", () => {
		const typed = drive(searchableView(), [K("search"), CH("?"), CH("t")]);
		expect(typed.searchQuery).toBe("?t"); // printable query input
		expect(typed.mode).toBe("search");
		// a stray detail/chat key is inert in the search submode — no side chat opens
		const dt = reduce(typed, K("detail"));
		expect(has(dt, "createSession")).toBe(false);
		expect(dt.state.mode).toBe("search");
		const ct = reduce(typed, K("chat"));
		expect(has(ct, "createSession")).toBe(false);
		expect(ct.state.mode).toBe("search");
	});
});

// ---------------------------------------------------------------------------
// U10 — scroll axis is PRECISE: option focus scrolls the DESCRIPTION; header focus scrolls the LIST
// (exact windowing/geometry is R-series' structural SSOT; the reducer owns only the offset fields)
// ---------------------------------------------------------------------------

describe("scroll axis is precise — description vs list (U10, AC3.1/AC3.2)", () => {
	it("scrolls the focused option's DESCRIPTION on PgDn and leaves the list scroll at the floor", () => {
		// Alpha (option 0) has a 4-line description and starts focused.
		const down = reduce(createInitialState(selectView()), K("pageDown")).state;
		expect(Object.values(down.descriptionScrollByTarget).some(v => v > 0)).toBe(true); // description axis moved
		expect(down.optionScroll).toBe(0); // the LIST axis did NOT move
	});

	it("reverses the description scroll on PgUp and clamps it at the floor (never negative)", () => {
		const down = reduce(createInitialState(selectView()), K("pageDown")).state;
		const up = reduce(down, K("pageUp")).state;
		expect(Object.values(up.descriptionScrollByTarget).every(v => v >= 0)).toBe(true);
		expect(Object.values(up.descriptionScrollByTarget).every(v => v === 0)).toBe(true); // back at rest
	});

	it("scrolls the LIST (not any description) on PgDn when the question header is focused", () => {
		const onHeader = drive(selectView(), [K("up")]); // canonicalCursor -1
		const down = reduce(onHeader, K("pageDown")).state;
		expect(down.optionScroll).toBeGreaterThan(0); // list axis moved
		expect(Object.values(down.descriptionScrollByTarget).every(v => v === 0)).toBe(true); // no description scroll
	});

	it("cannot scroll the list above the top (PgUp on the header clamps optionScroll at 0)", () => {
		const onHeader = drive(selectView(), [K("up")]);
		expect(reduce(onHeader, K("pageUp")).state.optionScroll).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// U9 — ask tool: editor input (incl. ?/t), two-stage Esc, header side chat, return to editor
// ---------------------------------------------------------------------------

describe("ask tool editor + two-stage Esc (U9, AC1.1)", () => {
	it("feeds printable chars — including ? and t — into the editor draft and advances the cursor", () => {
		const s = drive(askView(), [CH("h"), CH("i")]);
		expect(s.askDraft).toBe("hi");
		expect(s.askCursor).toBe(2);
		expect(drive(askView(), [CH("?"), CH("t")]).askDraft).toBe("?t"); // ?/t are editor input in the editor
	});

	it("moves editor->header on the first Esc, preserving the draft, and does NOT finish", () => {
		const r1 = reduce(drive(askView(), [CH("h"), CH("i")]), K("esc"));
		expect(r1.state.mode).toBe("browse");
		expect(r1.state.canonicalCursor).toBe(-1);
		expect(r1.state.askDraft).toBe("hi"); // draft survives the escape
		expect(has(r1, "done")).toBe(false); // first Esc is not a cancel
	});

	it("returns header->editor on Enter or Down", () => {
		const header = drive(askView(), [CH("x"), K("esc")]);
		expect(reduce(header, K("enter")).state.mode).toBe("editor");
		expect(reduce(header, K("down")).state.mode).toBe("editor");
	});

	it("cancels the ask question only on the SECOND Esc (from the header)", () => {
		const r = reduce(drive(askView(), [CH("x"), K("esc")]), K("esc"));
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "cancel" });
	});

	it("opens a side chat on the question from the ask header via ?/t", () => {
		const header = drive(askView(), [CH("x"), K("esc")]);
		const r = reduce(header, K("detail"));
		expect(r.state.mode).toBe("chat");
		expect(has(r, "createSession")).toBe(true);
		expect(r.state.pendingTurn?.target).toEqual({ kind: "question" });
	});

	it("submits the ask draft as the free-text answer", () => {
		const r = reduce(drive(askView(), [CH("h"), CH("i")]), SUBMIT_ASK);
		expect(has(r, "done")).toBe(true);
		expect(doneResult(r)).toMatchObject({ kind: "answer", response: "hi" });
	});
});

// ---------------------------------------------------------------------------
// U9 — side chat lifecycle: one-shot session, autofire, monotonic turns, stale-delta guard,
//       injected startedAt/endedAt (N1)
// ---------------------------------------------------------------------------

describe("side chat one-button lifecycle (U9, AC1.1/AC6.1)", () => {
	it("requests a session and defers the turn on the first '?'", () => {
		const r = reduce(drive(selectView(), []), K("detail"));
		expect(has(r, "createSession")).toBe(true);
		expect(r.state.mode).toBe("chat");
		expect(r.state.returnMode).toBe("browse");
		expect(r.state.pendingTurn).toEqual({ target: { kind: "option", label: "Alpha" }, mode: "one-button", autoFire: true });
		expect(r.state.activeTurnId).toBe(0); // no turn until the session lands
		expect(r.state.sideSession).toBeUndefined();
	});

	it("freezes the session, auto-fires the pending one-button turn, and stamps startedAt from the event's at", () => {
		const opened = reduce(drive(selectView(), []), K("detail")).state;
		const r = reduce(opened, sessionEvt(FAKE_SESSION, T_START1));
		expect(r.state.sideSession).toBe(FAKE_SESSION);
		expect(r.state.pendingTurn).toBeUndefined();
		expect(r.state.activeTurnId).toBe(1);
		expect(pick(r, "startTurn")?.turnId).toBe(1);
		expect(r.state.liveTurn?.startedAt).toBe(T_START1); // injected, not clock-read
		// the reducer builds the provider-ready request for the driver to execute
		expect(startTurnRequest(r)?.sessionId).toBe(FAKE_SESSION.sessionId);
	});

	it("accumulates streaming deltas for the active turn only", () => {
		const started = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1)]);
		const streamed = reduce(reduce(started, delta(1, "Re")).state, delta(1, "base")).state;
		expect(streamed.liveTurn?.response).toBe("Rebase");
		// a stale delta (turnId != activeTurnId) is ignored
		expect(reduce(streamed, delta(0, "STALE")).state.liveTurn?.response).toBe("Rebase");
	});

	it("finalizes a completed turn into the details record with the injected timestamps", () => {
		const started = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1)]);
		const r = reduce(started, settle(1, { text: "Rebase keeps history linear.", status: "complete" }, T_END1));
		expect(r.state.turns).toHaveLength(1);
		expect(r.state.turns[0]).toMatchObject({
			target: { kind: "option", label: "Alpha" },
			mode: "one-button",
			response: "Rebase keeps history linear.", // result.text mapped onto the details schema's response field
			status: "complete",
			startedAt: T_START1,
			endedAt: T_END1,
		});
		expect(r.state.turns[0].model).toBe(FAKE_SESSION.model); // completed to the full details schema
		expect("error" in r.state.turns[0]).toBe(false); // no error field on a completed turn
		expect(has(r, "done")).toBe(false); // a side turn NEVER finishes the question
	});

	it("ignores a stale settle for a superseded turn", () => {
		const settled = drive(selectView(), [
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "answer", status: "complete" }, T_END1),
		]);
		expect(reduce(settled, settle(0, { text: "stale", status: "complete" }, T_END2)).state.turns).toHaveLength(1);
	});

	it("reuses the frozen session on a later '?' — no second createSession", () => {
		const afterFirst = drive(selectView(), [
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "answer one", status: "complete" }, T_END1),
		]);
		const r = reduce(afterFirst, KT("detail", T_START2)); // a later detail starts turn 2 -> carries at
		expect(has(r, "createSession")).toBe(false); // getBranch/session created exactly once per question
		expect(pick(r, "startTurn")?.turnId).toBe(2);
		expect(r.state.activeTurnId).toBe(2);
		expect(r.state.liveTurn?.startedAt).toBe(T_START2);
	});

	it("aborts an in-flight turn when a new turn starts", () => {
		const streaming = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1), delta(1, "partial")]);
		const r = reduce(streaming, KT("detail", T_START2));
		expect(pick(r, "abortTurn")?.turnId).toBe(1);
		expect(r.state.activeTurnId).toBe(2);
	});
});

describe("turn timestamps are injected, ISO-8601, and deterministic (U9/N1, AC1.4)", () => {
	const stream = (): AskUiEvent[] => [
		K("detail"),
		sessionEvt(FAKE_SESSION, T_START1),
		settle(1, { text: "answer", status: "complete" }, T_END1),
	];

	it("copies the trigger event's at to startedAt and the settle event's at to endedAt", () => {
		const t = drive(selectView(), stream()).turns[0];
		expect(t.startedAt).toBe(T_START1);
		expect(t.endedAt).toBe(T_END1);
	});

	it("stamps ISO-8601 strings, never a Date object or an epoch number", () => {
		const t = drive(selectView(), stream()).turns[0];
		expect(t.startedAt).toMatch(ISO_8601);
		expect(t.endedAt).toMatch(ISO_8601);
	});

	it("is deterministic — the same event stream yields byte-identical turns (the reducer never reads a clock)", () => {
		expect(drive(selectView(), stream()).turns[0]).toEqual(drive(selectView(), stream()).turns[0]);
	});

	it("stamps a subsequent one-button turn from the detail key's at", () => {
		const after = drive(selectView(), [
			...stream(),
			KT("detail", T_START2),
			settle(2, { text: "answer two", status: "complete" }, T_END2),
		]);
		expect(after.turns[1].startedAt).toBe(T_START2);
		expect(after.turns[1].endedAt).toBe(T_END2);
	});
});

// ---------------------------------------------------------------------------
// U9 — error/abort side state: absorbed, no done, question survives (AC4.1/AC4.2) + retry (N2)
// ---------------------------------------------------------------------------

describe("side failure/abort is absorbed as side state (U9, AC4.1/AC4.2)", () => {
	it("records a provider error turn (redacted) without finishing the tool", () => {
		const started = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1)]);
		const r = reduce(started, settle(1, { text: "", status: "error", error: "429 rate_limit_exceeded" }, T_END1));
		expect(r.state.turns.at(-1)).toMatchObject({ status: "error", error: "429 rate_limit_exceeded" });
		expect(has(r, "done")).toBe(false);
		expect(r.state.mode).toBe("chat"); // panel stays open to show the error + offer retry
	});

	it("records an aborted turn with any partial text and does not finish the tool", () => {
		const started = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1), delta(1, "partial ")]);
		const r = reduce(started, settle(1, { text: "partial ", status: "aborted" }, T_END1));
		expect(r.state.turns.at(-1)).toMatchObject({ status: "aborted" });
		expect(has(r, "done")).toBe(false);
	});

	it("recovers to the underlying question on Esc after an error — the question survives", () => {
		const errored = drive(selectView(), [
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "", status: "error", error: "500 upstream" }, T_END1),
		]);
		const r = reduce(errored, K("esc"));
		expect(r.state.mode).toBe("browse"); // back to the list (returnMode)
		expect(has(r, "done")).toBe(false); // still no answer emitted — question alive
	});
});

describe("retry re-sends the failed prompt in the same session (U9/N2, AC6.1)", () => {
	it("on `r` after an error: no new session, monotonic turnId, byte-equal prompt, injected startedAt", () => {
		const opened = reduce(drive(selectView(), []), K("detail"));
		const started = reduce(opened.state, sessionEvt(FAKE_SESSION, T_START1));
		const request1 = startTurnRequest(started)!;
		const prompt1 = lastUser(request1);
		const errored = reduce(started.state, settle(1, { text: "", status: "error", error: "429" }, T_END1)).state;
		expect(errored.turns[0].prompt).toBe(prompt1); // the failed turn records the exact prompt it sent

		const retried = reduce(errored, KT("retry", T_START2));
		expect(has(retried, "createSession")).toBe(false); // frozen session reused — no getBranch re-call
		expect(retried.state.sideSession).toBe(FAKE_SESSION); // same session identity
		expect(pick(retried, "startTurn")?.turnId).toBe(2); // monotonic turnId
		expect(lastUser(startTurnRequest(retried)!)).toBe(prompt1); // byte-equal prompt re-sent
		expect(retried.state.liveTurn?.startedAt).toBe(T_START2); // fresh injected start time
	});

	it("does not retry (no-op) unless the active turn is in the error state", () => {
		const streaming = drive(selectView(), [K("detail"), sessionEvt(FAKE_SESSION, T_START1), delta(1, "partial")]);
		const r = reduce(streaming, KT("retry", T_START2));
		expect(has(r, "startTurn")).toBe(false); // nothing to retry mid-stream
		expect(r.state.activeTurnId).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// U9 — free-prompt chat: multiturn + stepwise Esc (editor -> panel -> list)
// ---------------------------------------------------------------------------

describe("free-prompt chat multiturn + stepwise Esc (U9, AC1.2)", () => {
	it("opens a free-prompt editor on 't' without auto-firing a turn", () => {
		const r = reduce(drive(selectView(), []), K("chat"));
		expect(r.state.mode).toBe("chat");
		expect(r.state.chatEditorFocused).toBe(true);
		expect(r.state.pendingTurn).toMatchObject({ mode: "free-prompt", autoFire: false });
	});

	it("sends a free-prompt turn on Enter, clears the draft, and stamps startedAt from the Enter key's at", () => {
		const typed = drive(selectView(), [K("chat"), sessionEvt(FAKE_SESSION), CH("w"), CH("h"), CH("y")]);
		expect(typed.chatDraft).toBe("why");
		const r = reduce(typed, KT("enter", T_START1));
		expect(has(r, "startTurn")).toBe(true);
		expect(r.state.chatDraft).toBe("");
		expect(r.state.activeTurnId).toBeGreaterThan(0);
		expect(r.state.liveTurn?.startedAt).toBe(T_START1);
	});

	it("steps Esc from editor -> panel blur -> close-to-list", () => {
		const inEditor = drive(selectView(), [K("chat"), sessionEvt(FAKE_SESSION)]);
		expect(inEditor.chatEditorFocused).toBe(true);
		const blurred = reduce(inEditor, K("esc")).state; // stage 1: blur editor
		expect(blurred.mode).toBe("chat");
		expect(blurred.chatEditorFocused).toBe(false);
		const closed = reduce(blurred, K("esc")); // stage 2: close panel -> list
		expect(closed.state.mode).toBe("browse");
		expect(has(closed, "done")).toBe(false); // question survives the chat
	});
});

// ---------------------------------------------------------------------------
// U8 — state preservation across a chat round-trip (checked / cursor / draft / scroll / session)
// ---------------------------------------------------------------------------

describe("state preservation across a chat round-trip (U8, AC1.3)", () => {
	it("keeps multi-select checks and cursor after opening and closing a side chat", () => {
		const after = drive(multiView(), [
			K("space"), // check Alpha(0)
			K("down"),
			K("down"), // cursor -> Gamma(2)
			K("space"), // check Gamma(2) -> checked [0,2]
			K("detail"), // open one-button on Gamma
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "explanation", status: "complete" }, T_END1),
			K("esc"), // close panel -> back to list
		]);
		expect(after.mode).toBe("browse");
		expect(after.checkedIndices).toEqual([0, 2]);
		expect(after.canonicalCursor).toBe(2);
	});

	it("keeps the ask draft AND cursor across a header side chat", () => {
		const after = drive(askView(), [
			CH("d"),
			CH("r"),
			CH("a"),
			CH("f"),
			CH("t"), // askDraft = "draft", askCursor = 5
			K("esc"), // editor -> header (draft/cursor preserved)
			K("detail"), // open side chat on the question
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "explanation", status: "complete" }, T_END1),
			K("esc"), // close panel -> back to header
		]);
		expect(after.askDraft).toBe("draft");
		expect(after.askCursor).toBe(5);
	});

	it("preserves both scroll axes (list + focused description) across a chat round trip", () => {
		const after = drive(selectView(), [
			K("pageDown"), // scroll Alpha's description (description axis)
			K("up"), // focus the header
			K("pageDown"), // scroll the list (list axis)
			K("down"), // back to Alpha(0)
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "x", status: "complete" }, T_END1),
			K("esc"), // close panel
		]);
		expect(after.optionScroll).toBeGreaterThan(0); // list scroll survives
		expect(Object.values(after.descriptionScrollByTarget).some(v => v > 0)).toBe(true); // description scroll survives
	});

	it("reuses the same frozen sideSession across close and reopen — no second createSession", () => {
		const afterFirst = drive(selectView(), [
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "a", status: "complete" }, T_END1),
			K("esc"), // close panel -> browse
		]);
		expect(afterFirst.sideSession).toBe(FAKE_SESSION); // session survives close
		const reopened = reduce(afterFirst, KT("detail", T_START2));
		expect(has(reopened, "createSession")).toBe(false); // NO second session on reopen
		expect(reopened.state.sideSession).toBe(FAKE_SESSION); // same identity
		expect(pick(reopened, "startTurn")?.turnId).toBe(2);
	});

	it("keeps the same frozen sideSession across a retry", () => {
		const errored = drive(selectView(), [
			K("detail"),
			sessionEvt(FAKE_SESSION, T_START1),
			settle(1, { text: "", status: "error", error: "boom" }, T_END1),
		]);
		const retried = reduce(errored, KT("retry", T_START2));
		expect(retried.state.sideSession).toBe(FAKE_SESSION);
		expect(has(retried, "createSession")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// U9 — view switches never recreate the owner (config identity is stable)
// ---------------------------------------------------------------------------

describe("view switches preserve the outer owner (U9)", () => {
	it("never rebuilds the immutable view config across mode transitions", () => {
		const s = createInitialState(selectView());
		expect(reduce(s, K("down")).state.view).toBe(s.view);
		expect(reduce(s, K("detail")).state.view).toBe(s.view);
		expect(reduce(s, K("search")).state.view).toBe(s.view);
	});
});
