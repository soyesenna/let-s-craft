// I1/I2/I3 — round trips + state preservation (reducer) + U2 details.sideChat/CONTENT invariance
// (performX) — appendix-test-plan §Integration + §Unit; AC1.1/1.2/1.3/1.4.
//
// Mirrors local://ask-ui-wiring-contract-v2.md §1-§5. Integration here means: drive the Node-safe pure
// reducer (state.ts) with key/char/session/delta/settle/submitAsk events and a scripted SideChatSession
// (completion-core createSideChatSession), NO live completion — the "pure reducer + 포트 페이크" layer the
// appendix prescribes. Timestamps ride on the events (v2 §5, TesterUnitR2): the session event and the
// turn-starting keys (detail / enter / retry) carry `at` = startedAt; settle carries `at` = endedAt; the
// reducer only records them. Cursor domain (Main-ratified, v2 §3): canonicalCursor ∈ {-1 header,
// 0..n-1 options, n Other, n+1 Done (multi && checked>0 only)} — control rows are focusable AND
// actionable: a multi option Enter = toggle (Space-equivalent), Done Enter = commit, Other Enter →
// free-text editor → submitAsk commits. The Bun component (custom<T>) + live CompletionPort are
// exercised in the Bun adapter suite (B1-B3), not here.
//
// U2 note (TesterRegressionR2 + appendix Unit layer): the details.sideChat schema is validated here as a
// `U2` describe via the performX round trip (it needs performX's result mapping, and the
// contract-regression file must stay free of src/ask-ui/*). Turn PRODUCTION + ISO determinism is
// state.test's (U8/U9/N1); this suite pins that performX THREADS the component result faithfully.
//
// STATUS: whole-file RED until PR2/PR3 create src/ask-ui/state.ts + completion-core.ts — the value
// imports below cannot resolve yet (expected: "Cannot find module"). This is the correct pre-craft state.
import { describe, expect, it } from "vitest";
import { createInitialState, reduce } from "../src/ask-ui/state";
import { createSideChatSession } from "../src/ask-ui/completion-core";
import type { AskUiEffect, AskUiState, ReduceResult } from "../src/ask-ui/state";
import type { AskUiResult, AskUiView, SideChatTurn } from "../src/ask-ui/types";
import type { SideChatMessage, SideChatRequest } from "../src/ask-ui/completion-core";
import { FREE_ANSWER_SENTINEL, SELECTED_LINE_PREFIX, type AskChannel, type SelectUI, performAsk, performConfirm, performSelect } from "../src/ask";
import { FixtureAnswerSet, type FixtureAnswerBody, parseFixtureAnswerFile } from "../src/fixtures";

// ── fixtures ─────────────────────────────────────────────────────────────────
const SELECT_QUESTION = "How should the feature branch land?";
const SELECT_OPTIONS = [
	{ label: "Rebase", description: "Replay the branch commits onto the target tip." },
	{ label: "Merge", description: "Create a merge commit joining both branches." },
	{ label: "Squash", description: "Collapse the branch into a single commit." },
];
const CONFIRM_VIEW: AskUiView = {
	tool: "confirm",
	question: "Deploy to production now?",
	options: [
		{ label: "Yes", description: "Deploy immediately." },
		{ label: "No", description: "Hold off for now." },
	],
	multi: false,
};
const ASK_VIEW: AskUiView = { tool: "ask", question: "Describe the regression you observed.", options: [], multi: false };
const HISTORY: SideChatMessage[] = [{ role: "user", content: "Earlier in the session we chose a trunk-based flow." }];
const SYSTEM_PROMPT = "You are assisting a user answering a question. You have NO tools; answer directly.";

// Local view of createSideChatSession's seed (structural; craft owns the concrete type in completion-core).
interface SideChatSessionSeed {
	mainSessionId: string;
	nonce: string;
	model: string;
	systemPrompt: string;
	getBranch: () => readonly SideChatMessage[];
}

function selectView(multi: boolean, recommended?: number): AskUiView {
	return { tool: "select", question: SELECT_QUESTION, options: SELECT_OPTIONS, multi, recommended };
}

// A getBranch spy: createSideChatSession must call it exactly once for the whole panel (cache prefix).
function branchSpy(): { getBranch: () => readonly SideChatMessage[]; calls: () => number } {
	let n = 0;
	return {
		getBranch: () => {
			n += 1;
			return HISTORY;
		},
		calls: () => n,
	};
}

function seed(nonce: string, getBranch: () => readonly SideChatMessage[]): SideChatSessionSeed {
	return { mainSessionId: "main-sess-42", nonce, model: "anthropic/claude-opus-4", systemPrompt: SYSTEM_PROMPT, getBranch };
}

// A deterministic ISO clock: successive at() calls yield distinct, strictly-ordered ISO-8601 strings so
// injected startedAt/endedAt are reproducible (v2 §5 — the reducer only copies these, never reads a wall
// clock). Stateful seam, threaded through the turn helpers.
function clock(): { at: () => string } {
	let n = 0;
	return {
		at: () => {
			const secs = String(n++).padStart(2, "0");
			return `2026-07-20T00:00:${secs}.000Z`;
		},
	};
}

// Extract the single startTurn effect (narrows the union — no cast). The effect name is unchanged under
// v2; only the events that trigger it now carry `at` (TesterUnitR2).
function startTurnEffect(effects: readonly AskUiEffect[]): { turnId: number; request: SideChatRequest } {
	const e = effects.find(x => x.type === "startTurn");
	if (!e || e.type !== "startTurn") throw new Error("expected a startTurn effect");
	return e;
}

function doneResult(effects: readonly AskUiEffect[]): AskUiResult {
	const e = effects.find(x => x.type === "done");
	if (!e || e.type !== "done") throw new Error("expected a done effect");
	return e.result;
}

// If the last reduce requested a session, create it (getBranch once) and feed it back with the turn's
// start timestamp; the session landing auto-fires a pending one-button turn (startedAt=session.at, v2 §5).
function feedSession(r: ReduceResult, s: SideChatSessionSeed, at: string): ReduceResult {
	if (!r.effects.some(e => e.type === "createSession")) return r;
	return reduce(r.state, { type: "session", session: createSideChatSession(s), at });
}

// Open the first one-button detail on the current focus, stream `answer`, settle complete. Returns the
// chat-panel state with the completed turn recorded.
function runOneButtonDetail(state: AskUiState, s: SideChatSessionSeed, answer: string, clk: { at: () => string }): AskUiState {
	const opened = feedSession(reduce(state, { type: "key", key: "detail" }), s, clk.at());
	const turn = startTurnEffect(opened.effects);
	const streamed = reduce(opened.state, { type: "delta", turnId: turn.turnId, text: answer });
	return reduce(streamed.state, { type: "settle", turnId: turn.turnId, result: { text: answer, status: "complete" }, at: clk.at() }).state;
}

// Press Esc until back on the list (staged Esc closes the chat panel in ≤2 steps; never cancels).
function escToList(state: AskUiState): AskUiState {
	let s = state;
	for (let i = 0; i < 3 && s.mode !== "browse"; i++) s = reduce(s, { type: "key", key: "esc" }).state;
	return s;
}

// ── I1 — one-button detail round trip on all three tools + question target ───
describe("I1 — one-button detail round trip: option/question → answer → return to the list (AC1.1)", () => {
	it("select(single): detail on the focused option streams an answer, then Esc returns with the selection intact", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 1));
		expect(s0.mode).toBe("browse");
		expect(s0.canonicalCursor).toBe(1); // mounts on recommended, not the header
		const branch = branchSpy();
		const chatting = runOneButtonDetail(s0, seed("n1", branch.getBranch), "Merge preserves branch topology with an explicit merge commit.", clk);

		expect(chatting.mode).toBe("chat");
		expect(chatting.turns).toHaveLength(1);
		expect(chatting.turns[0].target).toEqual({ kind: "option", label: "Merge" });
		expect(chatting.turns[0].mode).toBe("one-button");
		expect(chatting.turns[0].status).toBe("complete");
		expect(chatting.turns[0].response).toContain("merge commit");
		expect(branch.calls()).toBe(1); // session created exactly once

		const back = escToList(chatting);
		expect(back.mode).toBe("browse");
		expect(back.canonicalCursor).toBe(1); // cursor preserved
		expect(back.view.question).toBe(SELECT_QUESTION); // question survives
		expect(back.turns).toHaveLength(1); // Q&A retained for details.sideChat

		const done = doneResult(reduce(back, { type: "key", key: "enter" }).effects);
		expect(done.kind).toBe("answer");
		if (done.kind === "answer") {
			expect(done.selections).toEqual(["Merge"]);
			expect(done.sideChat).toEqual(back.turns);
		}
	});

	it("select: detail on the question header targets the question itself", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 0));
		const header = reduce(s0, { type: "key", key: "up" }).state; // first option Up → header (-1)
		expect(header.canonicalCursor).toBe(-1);
		const chatting = runOneButtonDetail(header, seed("n1", branchSpy().getBranch), "This decides how the commits are integrated.", clk);
		expect(chatting.turns[0].target).toEqual({ kind: "question" });
		expect(chatting.turns[0].mode).toBe("one-button");
	});

	it("confirm: detail on the focused Yes option streams an answer, then Esc returns with the cursor intact", () => {
		const clk = clock();
		const s0 = createInitialState(CONFIRM_VIEW);
		expect(s0.mode).toBe("browse");
		expect(s0.canonicalCursor).toBe(0); // Yes
		const chatting = runOneButtonDetail(s0, seed("n1", branchSpy().getBranch), "Yes triggers an immediate production deploy.", clk);
		expect(chatting.turns[0].target).toEqual({ kind: "option", label: "Yes" });
		expect(chatting.turns[0].status).toBe("complete");
		const back = escToList(chatting);
		expect(back.mode).toBe("browse");
		expect(back.canonicalCursor).toBe(0);
	});

	it("ask: Esc to the header, then detail chats about the question and returns", () => {
		const clk = clock();
		const s0 = createInitialState(ASK_VIEW);
		expect(s0.mode).toBe("editor");
		const header = reduce(s0, { type: "key", key: "esc" }).state; // editor → header, draft preserved
		expect(header.mode).toBe("browse");
		expect(header.canonicalCursor).toBe(-1);
		const chatting = runOneButtonDetail(header, seed("n1", branchSpy().getBranch), "The regression is a null deref on empty input.", clk);
		expect(chatting.turns[0].target).toEqual({ kind: "question" });
		expect(escToList(chatting).mode).toBe("browse");
	});
});

// ── I2 — free-prompt multi-turn + same-session mixed turns + close/reopen reuse ──────────────
describe("I2 — free-prompt multi-turn chat; same-session mixed turns; staged Esc returns to the list (AC1.2)", () => {
	it("sustains two turns on one reused session, then Esc blurs the editor and Esc closes the panel", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 0));
		const branch = branchSpy();
		const opened = feedSession(reduce(s0, { type: "key", key: "chat" }), seed("n1", branch.getBranch), clk.at());
		let s = opened.state;
		expect(s.mode).toBe("chat");
		expect(s.chatEditorFocused).toBe(true);

		// turn 1
		s = reduce(s, { type: "char", text: "What does rebase do?" }).state;
		const send1 = reduce(s, { type: "key", key: "enter", at: clk.at() });
		s = send1.state;
		const t1 = startTurnEffect(send1.effects);
		expect(s.liveTurn?.mode).toBe("free-prompt"); // the started turn is a free-prompt turn (turn record, not the effect)
		s = reduce(s, { type: "delta", turnId: t1.turnId, text: "Rebase replays commits onto the tip." }).state;
		s = reduce(s, { type: "settle", turnId: t1.turnId, result: { text: "Rebase replays commits onto the tip.", status: "complete" }, at: clk.at() }).state;
		expect(s.turns).toHaveLength(1);
		expect(s.chatEditorFocused).toBe(true); // ready for the next prompt

		// turn 2 — same panel, session reused (no new createSession)
		s = reduce(s, { type: "char", text: "And merge?" }).state;
		const send2 = reduce(s, { type: "key", key: "enter", at: clk.at() });
		s = send2.state;
		expect(send2.effects.some(e => e.type === "createSession")).toBe(false);
		const t2 = startTurnEffect(send2.effects);
		expect(t2.turnId).toBeGreaterThan(t1.turnId); // monotonic turn ids
		s = reduce(s, { type: "delta", turnId: t2.turnId, text: "Merge joins the branches with a merge commit." }).state;
		s = reduce(s, { type: "settle", turnId: t2.turnId, result: { text: "Merge joins the branches with a merge commit.", status: "complete" }, at: clk.at() }).state;
		expect(s.turns).toHaveLength(2);
		expect(branch.calls()).toBe(1); // one session for the whole panel — cacheable prefix stays stable

		// staged Esc: ① editor → blur, ② panel → close + return to the list
		const blur = reduce(s, { type: "key", key: "esc" });
		expect(blur.state.mode).toBe("chat");
		expect(blur.state.chatEditorFocused).toBe(false);
		expect(blur.effects.some(e => e.type === "done")).toBe(false);
		const closed = reduce(blur.state, { type: "key", key: "esc" });
		expect(closed.state.mode).toBe("browse");
		expect(closed.state.view.question).toBe(SELECT_QUESTION); // question survives the chat
		expect(closed.state.turns).toHaveLength(2); // both turns retained for details.sideChat
		expect(closed.effects.some(e => e.type === "done")).toBe(false); // closing the panel is not a commit
	});

	it("a one-button turn then a free-prompt (`t`) follow-up reuse the SAME frozen session; the follow-up request extends the prior cacheable prefix (O2 §4 mixed turn)", () => {
		const clk = clock();
		const branch = branchSpy();
		const s0 = createInitialState(selectView(false, 1)); // cursor on Merge (recommended)
		// Turn 1 — one-button detail (`?`).
		const opened = feedSession(reduce(s0, { type: "key", key: "detail" }), seed("n1", branch.getBranch), clk.at());
		const t1 = startTurnEffect(opened.effects);
		let s = reduce(opened.state, { type: "delta", turnId: t1.turnId, text: "Merge creates an explicit merge commit." }).state;
		s = reduce(s, { type: "settle", turnId: t1.turnId, result: { text: "Merge creates an explicit merge commit.", status: "complete" }, at: clk.at() }).state;
		expect(s.turns).toHaveLength(1);
		expect(s.turns[0].mode).toBe("one-button");

		// Turn 2 — free-prompt follow-up (`t`) in the SAME open panel: starts a free-prompt turn on the
		// frozen session (O2 §4; `t` is a panel affordance, not a literal char).
		s = reduce(s, { type: "key", key: "chat" }).state;
		s = reduce(s, { type: "char", text: "And how does that differ from rebase?" }).state;
		const send2 = reduce(s, { type: "key", key: "enter", at: clk.at() });
		s = send2.state;
		expect(send2.effects.some(e => e.type === "createSession")).toBe(false); // frozen session reused
		const t2 = startTurnEffect(send2.effects);
		expect(s.liveTurn?.mode).toBe("free-prompt"); // the follow-up is a free-prompt turn (live turn record)
		expect(t2.turnId).toBeGreaterThan(t1.turnId);
		expect(branch.calls()).toBe(1); // getBranch called once for the whole panel

		// The follow-up request extends the prior cacheable prefix (cache lifetime canon / O2 §2).
		expect(t2.request.sessionId).toBe(t1.request.sessionId);
		expect(t2.request.promptCacheKey).toBe(t1.request.promptCacheKey);
		expect(t2.request.systemPrompt).toBe(t1.request.systemPrompt); // mode-invariant system prefix
		expect(t2.request.messages.slice(0, t1.request.messages.length)).toEqual(t1.request.messages);
	});

	it("closing the panel (Esc) and reopening it (`?`) reuse the frozen session — no re-createSession, getBranch still called once", () => {
		const clk = clock();
		const branch = branchSpy();
		const s0 = createInitialState(selectView(false, 0));
		// Open + complete a one-button turn.
		const opened = feedSession(reduce(s0, { type: "key", key: "detail" }), seed("n1", branch.getBranch), clk.at());
		const t1 = startTurnEffect(opened.effects);
		const s = reduce(opened.state, { type: "settle", turnId: t1.turnId, result: { text: "an answer", status: "complete" }, at: clk.at() }).state;
		expect(s.mode).toBe("chat");

		// Close back to the list, then reopen with `?` (a subsequent one-button turn — `detail` carries `at`).
		const back = escToList(s);
		expect(back.mode).toBe("browse");
		const reopened = reduce(back, { type: "key", key: "detail", at: clk.at() });
		expect(reopened.effects.some(e => e.type === "createSession")).toBe(false); // frozen session reused
		const t2 = startTurnEffect(reopened.effects);
		expect(t2.request.sessionId).toBe(t1.request.sessionId); // same frozen session id
		expect(t2.turnId).toBeGreaterThan(t1.turnId);
		expect(branch.calls()).toBe(1); // getBranch NEVER re-invoked across close/reopen
	});
});

// ── I3 — multi-select state preservation + control-row reachability/activation (AC1.3, D2) ────
// Renamed to I3 (appendix: I3 = 체크/커서 보존). The details.sideChat/CONTENT validation that used to
// live under this ID moved to the `U2` describe below (TesterRegressionR2 + appendix Unit layer).
describe("I3 — multi-select checks and cursor survive a round trip; control rows commit via Done/Other (AC1.3, D2)", () => {
	it("preserves checkedIndices + cursor after a detail round trip, then commits the checked set via the Done row (n+1)", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(true, 0));
		let s = reduce(s0, { type: "key", key: "space" }).state; // check index 0 (Rebase)
		s = reduce(s, { type: "key", key: "down" }).state; // cursor → 1
		s = reduce(s, { type: "key", key: "down" }).state; // cursor → 2
		s = reduce(s, { type: "key", key: "space" }).state; // check index 2 (Squash)
		expect([...s.checkedIndices].sort((a, b) => a - b)).toEqual([0, 2]);
		expect(s.canonicalCursor).toBe(2);

		const chatting = runOneButtonDetail(s, seed("n1", branchSpy().getBranch), "Squash collapses the branch into a single commit.", clk);
		expect(chatting.turns).toHaveLength(1);

		const back = escToList(chatting);
		expect(back.mode).toBe("browse");
		expect([...back.checkedIndices].sort((a, b) => a - b)).toEqual([0, 2]); // checks preserved
		expect(back.canonicalCursor).toBe(2); // cursor preserved

		// Commit is Done-only (D2): an option Enter toggles, so navigate to the Done row (n+1 = 4) to submit.
		const toOther = reduce(back, { type: "key", key: "down" }); // 2 → 3 (Other)
		expect(toOther.state.canonicalCursor).toBe(3);
		const toDone = reduce(toOther.state, { type: "key", key: "down" }); // 3 → 4 (Done — exists: multi && checked>0)
		expect(toDone.state.canonicalCursor).toBe(4);
		const done = doneResult(reduce(toDone.state, { type: "key", key: "enter" }).effects); // Done Enter = commit
		expect(done.kind).toBe("answer");
		if (done.kind === "answer") expect(done.selections).toEqual(["Rebase", "Squash"]); // canonical option order
	});

	it("a multi option Enter toggles the check (Space-equivalent) and never commits (D2)", () => {
		const s0 = createInitialState(selectView(true, 0));
		expect(s0.canonicalCursor).toBe(0);
		const on = reduce(s0, { type: "key", key: "enter" }); // Enter on a multi option = toggle
		expect(on.state.checkedIndices).toContain(0); // checked, NOT committed
		expect(on.effects.some(e => e.type === "done")).toBe(false); // an option Enter never commits (multi)
		const off = reduce(on.state, { type: "key", key: "enter" }); // Enter again = uncheck
		expect(off.state.checkedIndices).not.toContain(0);
		expect(off.effects.some(e => e.type === "done")).toBe(false);
	});

	it("Space toggles a check off again (no phantom retention)", () => {
		const s0 = createInitialState(selectView(true, 0));
		let s = reduce(s0, { type: "key", key: "space" }).state; // check 0
		expect(s.checkedIndices).toContain(0);
		s = reduce(s, { type: "key", key: "space" }).state; // uncheck 0
		expect(s.checkedIndices).not.toContain(0);
	});

	it("the Other row (n) opens the free-text editor; Esc cancels back to browse (draft preserved), re-entry restores it, and submitAsk commits the free answer alongside the checks", () => {
		const s0 = createInitialState(selectView(true, 0));
		let s = reduce(s0, { type: "key", key: "space" }).state; // check 0 (Rebase)
		// Navigate to the Other row (n = 3): 0 → 1 → 2 → 3.
		s = reduce(s, { type: "key", key: "down" }).state;
		s = reduce(s, { type: "key", key: "down" }).state;
		s = reduce(s, { type: "key", key: "down" }).state;
		expect(s.canonicalCursor).toBe(3); // Other

		// Other Enter → free-text editor with an empty draft (v2 §3, TesterUnitR2).
		const editing = reduce(s, { type: "key", key: "enter" }).state;
		expect(editing.mode).toBe("editor");
		expect(editing.askDraft).toBe("");
		const typed = reduce(editing, { type: "char", text: "actually squash onto main" }).state;
		expect(typed.askDraft).toBe("actually squash onto main");

		// Esc cancels the editor back to browse; Other stays focused; the draft is PRESERVED (1-stage, unlike ask).
		const cancelled = reduce(typed, { type: "key", key: "esc" });
		expect(cancelled.state.mode).toBe("browse");
		expect(cancelled.state.canonicalCursor).toBe(3); // Other still focused
		expect(cancelled.state.askDraft).toBe("actually squash onto main"); // preserved
		expect(cancelled.effects.some(e => e.type === "done")).toBe(false); // cancelling the editor is not a commit

		// Re-enter the editor with the preserved draft, then submitAsk commits the free answer + the checks.
		const reEditing = reduce(cancelled.state, { type: "key", key: "enter" }).state;
		expect(reEditing.mode).toBe("editor");
		expect(reEditing.askDraft).toBe("actually squash onto main"); // restored
		const done = doneResult(reduce(reEditing, { type: "submitAsk" }).effects);
		expect(done.kind).toBe("answer");
		if (done.kind === "answer") {
			expect(done.selections).toEqual(["Rebase"]); // the pre-existing check survives
			expect(done.freeText).toBe("actually squash onto main"); // Other's free answer (select Other → selections + freeText)
		}
	});
});

// ── U2 — details.sideChat schema + CONTENT envelope invariance (performX round trip) (AC1.4) ────
// Moved here from the old integration "I3 details" block (TesterRegressionR2 + appendix Unit layer).
// A chat round trip yields the SAME model-facing CONTENT as an unchatted answer (the chat NEVER appears
// in the envelope) while details.sideChat carries the Q&A (appendix §4 schema), threaded faithfully from
// the component's AskUiResult.sideChat → details.sideChat.turns. RED until PR3 routes performX through
// the runtime; the no-chat fixture baselines are the current-behavior pin. Turn PRODUCTION + ISO
// determinism is state.test's (N1); this pins the performX mapping.
function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
		throw new Error("expected the first tool-result content item to be text");
	}
	return first.text;
}

function fixtureChannel(body: FixtureAnswerBody): AskChannel {
	const set = new FixtureAnswerSet(parseFixtureAnswerFile({ version: 2, answers: [{ match: ".*", ...body }] }, "unit-answers.json"));
	return { kind: "fixture", answers: set };
}

// A ui + runtime that mounts a component resolving `result` (the chat path); ctx.ui.custom returns
// whatever the factory passes to done(). performX's 4th arg is the bound AskRuntime (v2 §1).
function withRuntime(result: AskUiResult): {
	ui: SelectUI & { custom(f: unknown, o: { overlay?: boolean }): Promise<unknown> };
	runtime: { buildSelect(p: unknown): unknown; buildConfirm(p: unknown): unknown; buildAsk(p: unknown): unknown };
} {
	const factoryFn = (_t: unknown, _th: unknown, _k: unknown, done: (r: AskUiResult) => void): { render: () => unknown[] } => {
		done(result);
		return { render: () => [] };
	};
	const runtime = { buildSelect: (_p: unknown) => factoryFn, buildConfirm: (_p: unknown) => factoryFn, buildAsk: (_p: unknown) => factoryFn };
	const ui = {
		async custom(f: unknown, _o: { overlay?: boolean }): Promise<unknown> {
			if (typeof f !== "function") return undefined;
			let captured: AskUiResult | undefined;
			await f(undefined, undefined, undefined, (r: AskUiResult) => {
				captured = r;
			});
			return captured;
		},
		async select() {
			return undefined;
		},
		async editor() {
			return undefined;
		},
	};
	return { ui, runtime };
}

const MERGE_TURN: SideChatTurn = {
	target: { kind: "option", label: "Merge" },
	mode: "one-button",
	prompt: 'Explain the option "Merge".',
	response: "Merge creates an explicit merge commit preserving both histories.",
	model: "anthropic/claude-opus-4",
	startedAt: "2026-07-20T00:00:00.000Z",
	endedAt: "2026-07-20T00:00:04.000Z",
	status: "complete",
};

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe("U2 — details.sideChat records the Q&A while the CONTENT envelope stays invariant (AC1.4)", () => {
	it("select: a chat round trip has the SAME CONTENT as an unchatted answer, plus a schema-conformant details.sideChat", async () => {
		const params = { question: SELECT_QUESTION, options: SELECT_OPTIONS };
		const { ui, runtime } = withRuntime({ kind: "answer", selections: ["Merge"], sideChat: [MERGE_TURN] });
		const chat = await performSelect({ kind: "ui" }, ui, params, runtime);
		const plain = await performSelect(fixtureChannel({ kind: "selection", selections: ["Merge"] }), ui, params);

		expect(textOf(chat)).toBe(textOf(plain)); // CONTENT identical regardless of chat
		expect(textOf(chat)).toBe(`${SELECTED_LINE_PREFIX}Merge`);
		expect(chat.details?.sideChat?.turns).toEqual([MERGE_TURN]); // Q&A recorded (appendix §4)
		expect("sideChat" in (plain.details ?? {})).toBe(false); // absent when no chat occurred
	});

	it("select: a free answer alongside a chat keeps the free-answer envelope grammar; the chat stays out of CONTENT", async () => {
		const params = { question: SELECT_QUESTION, options: SELECT_OPTIONS };
		const { ui, runtime } = withRuntime({ kind: "answer", selections: [], freeText: "actually rebase onto main", sideChat: [MERGE_TURN] });
		const chat = await performSelect({ kind: "ui" }, ui, params, runtime);
		expect(textOf(chat)).toBe(`${FREE_ANSWER_SENTINEL} actually rebase onto main`); // envelope grammar unchanged
		expect(textOf(chat)).not.toContain("merge commit"); // the side-chat answer never leaks into CONTENT
		expect(chat.details?.sideChat?.turns).toHaveLength(1);
	});

	it("confirm: a chat round trip has the SAME `yes` CONTENT as an unchatted confirm, plus details.sideChat", async () => {
		const yesTurn: SideChatTurn = { ...MERGE_TURN, target: { kind: "option", label: "Yes" } };
		const { ui, runtime } = withRuntime({ kind: "answer", confirmed: true, sideChat: [yesTurn] });
		const chat = await performConfirm({ kind: "ui" }, ui, { question: "Proceed?" }, runtime);
		const plain = await performConfirm(fixtureChannel({ kind: "confirmation", confirm: true }), ui, { question: "Proceed?" });
		expect(textOf(chat)).toBe(textOf(plain));
		expect(textOf(chat)).toBe("yes");
		expect(chat.details?.sideChat?.turns).toEqual([yesTurn]);
		expect("sideChat" in (plain.details ?? {})).toBe(false);
	});

	it("ask: a chat round trip returns the free-text response as CONTENT, plus details.sideChat", async () => {
		const askTurn: SideChatTurn = { ...MERGE_TURN, target: { kind: "question" }, mode: "free-prompt", prompt: "why does this happen?", response: "It is a null deref on empty input." };
		const { ui, runtime } = withRuntime({ kind: "answer", response: "null deref on empty input", sideChat: [askTurn] });
		const chat = await performAsk({ kind: "ui" }, ui, { question: ASK_VIEW.question }, runtime);
		const plain = await performAsk(fixtureChannel({ kind: "free-text", freeText: "null deref on empty input" }), ui, { question: ASK_VIEW.question });
		expect(textOf(chat)).toBe(textOf(plain)); // CONTENT identical regardless of chat
		expect(textOf(chat)).toBe("null deref on empty input");
		expect(chat.details?.sideChat?.turns).toEqual([askTurn]);
		expect("sideChat" in (plain.details ?? {})).toBe(false); // absent when no chat occurred
	});

	it("records a schema-conformant turn for each status (complete / error / aborted); error present only when status==='error'; ISO-8601 timestamps preserved", async () => {
		const params = { question: SELECT_QUESTION, options: SELECT_OPTIONS };
		const errorTurn: SideChatTurn = { ...MERGE_TURN, status: "error", response: "", error: "provider 500" };
		const abortedTurn: SideChatTurn = { ...MERGE_TURN, status: "aborted", response: "partial answer before abort" };
		const { ui, runtime } = withRuntime({ kind: "answer", selections: ["Merge"], sideChat: [MERGE_TURN, errorTurn, abortedTurn] });
		const result = await performSelect({ kind: "ui" }, ui, params, runtime);
		const turns = result.details?.sideChat?.turns ?? [];
		expect(turns).toHaveLength(3);

		// complete turn: every field present, no error field.
		expect(turns[0]).toMatchObject({
			target: { kind: "option", label: "Merge" },
			mode: "one-button",
			prompt: MERGE_TURN.prompt,
			response: MERGE_TURN.response,
			model: "anthropic/claude-opus-4",
			status: "complete",
		});
		expect(turns[0].error).toBeUndefined(); // error absent unless status==="error"

		// error turn: error field present.
		expect(turns[1].status).toBe("error");
		expect(turns[1].error).toBe("provider 500");

		// aborted turn: no error field (aborted ≠ error).
		expect(turns[2].status).toBe("aborted");
		expect(turns[2].error).toBeUndefined();

		// startedAt/endedAt survive the performX mapping as ISO-8601 (generation determinism is state.test's, N1).
		for (const t of turns) {
			expect(t.startedAt).toMatch(ISO_8601);
			expect(t.endedAt).toMatch(ISO_8601);
		}
	});
});
