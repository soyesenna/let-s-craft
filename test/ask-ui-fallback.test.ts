// I4 + I5 — Fallback/Failure contract (appendix-test-plan §Integration; AC4.1/4.2, AC2.3).
//
// Mirrors plan §PR2 Fallback/Failure canon + local://ask-ui-wiring-contract-v2.md §4/§5.
//   I4 (pure reducer, port output faked as events — no live completion, no fake driver): a side turn's
//       provider terminal error / abort is absorbed into an in-panel error state; the question
//       survives and can be RETRIED via `r` on the frozen session (v2 §5 retryTurn: no re-createSession,
//       monotonic turn id, byte-equal prompt resend — N2); a stale (superseded) turn's delta is
//       ignored; a failed/aborted/retried side turn NEVER emits `done` (only the final answer/cancel
//       does); the decision result is never polluted. Timestamps arrive on the events (session/key
//       detail|enter|retry carry `at`; settle carries `at` = endedAt) — the reducer only records them
//       (v2 §5; TesterUnitR2). Redaction is the driver's job UPSTREAM: the live CompletionPort
//       redacts a provider terminal error (B2) and normalizeSideError redacts a throw (completion-core
//       / U4) BEFORE the settle event fires, so every terminal SideChatResult this suite feeds the
//       reducer is ALREADY redacted — no raw secret ever reaches the I4 path — and the reducer merely
//       records that already-safe error text verbatim, never re-implementing catch→normalize→settle.
//   I5 (performX 4th-arg wiring, N7 matrix): headless stays HEADLESS_ERROR; `runtime` undefined =
//       legacy; runtime present but ctx.ui.custom ABSENT = legacy (buildX never attempted); a custom()
//       that resolves `undefined` (factory never started) falls back to legacy select/editor for
//       select/ask/confirm alike; a custom() that resolves an AskUiResult is used verbatim; a custom()
//       that REJECTS (factory started, then errored) is NOT hidden by a legacy fallback (counts.select
//       ===0) and maps to an error/cancel result; the legacy editor keeps 1-stage Esc.
//
// STATUS: whole-file RED until PR2/PR3 create src/ask-ui/state.ts + completion-core.ts (I4 value-imports
// them). I5's current-behavior pins (headless, no-runtime legacy) turn GREEN once those modules resolve;
// the custom-path assertions stay RED until performX routes through runtime.buildX + ctx.ui.custom.
import { describe, expect, it } from "vitest";
import { SELECTED_LINE_PREFIX, type SelectUI, performAsk, performConfirm, performSelect, resolveAskChannel } from "../src/ask";
import { createInitialState, reduce } from "../src/ask-ui/state";
import { createSideChatSession } from "../src/ask-ui/completion-core";
import type { AskUiEffect, AskUiState, ReduceResult } from "../src/ask-ui/state";
import type { AskUiResult, AskUiView } from "../src/ask-ui/types";
import type { SideChatMessage, SideChatRequest } from "../src/ask-ui/completion-core";

const SELECT_QUESTION = "How should the feature branch land?";
const OPTIONS = [
	{ label: "Alpha", description: "Use the alpha path." },
	{ label: "Beta", description: "Use the beta path." },
	{ label: "Merge", description: "Create a merge commit joining both branches." },
];
const SYSTEM_PROMPT = "You are assisting a user answering a question. You have NO tools; answer directly.";
const HISTORY: SideChatMessage[] = [{ role: "user", content: "Earlier we picked a release cadence." }];

interface SideChatSessionSeed {
	mainSessionId: string;
	nonce: string;
	model: string;
	systemPrompt: string;
	getBranch: () => readonly SideChatMessage[];
}

function selectView(multi: boolean, recommended?: number): AskUiView {
	return { tool: "select", question: SELECT_QUESTION, options: OPTIONS, multi, recommended };
}

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
	return { mainSessionId: "main-sess-9", nonce, model: "anthropic/claude-opus-4", systemPrompt: SYSTEM_PROMPT, getBranch };
}

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
		throw new Error("expected the first tool-result content item to be text");
	}
	return first.text;
}

// A deterministic ISO clock: successive `at()` calls yield distinct, strictly-ordered ISO-8601 strings
// so injected startedAt/endedAt are reproducible (v2 §5 — the reducer only copies these, never reads a
// wall clock). Stateful seam, threaded through the turn helpers.
function clock(): { at: () => string } {
	let n = 0;
	return {
		at: () => {
			const secs = String(n++).padStart(2, "0");
			return `2026-07-20T00:00:${secs}.000Z`;
		},
	};
}

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
// start timestamp (v2 §5: the session landing auto-fires a pending one-button turn, startedAt=session.at).
function feedSession(r: ReduceResult, s: SideChatSessionSeed, at: string): ReduceResult {
	if (!r.effects.some(e => e.type === "createSession")) return r;
	return reduce(r.state, { type: "session", session: createSideChatSession(s), at });
}

function escToList(state: AskUiState): AskUiState {
	let s = state;
	for (let i = 0; i < 3 && s.mode !== "browse"; i++) s = reduce(s, { type: "key", key: "esc" }).state;
	return s;
}

// Open the first one-button detail turn on the current focus: `detail` creates the session, whose
// landing (with `at`) auto-fires the turn. Returns the opened state + the turn id (v2 §5).
function openOneButton(state: AskUiState, s: SideChatSessionSeed, clk: { at: () => string }): { state: AskUiState; turnId: number } {
	const opened = feedSession(reduce(state, { type: "key", key: "detail" }), s, clk.at());
	const turn = startTurnEffect(opened.effects);
	return { state: opened.state, turnId: turn.turnId };
}

// ── I4 — side-turn failure/abort/retry absorption (pure reducer, no fake driver) ─────────────
describe("I4 — side-turn failure is absorbed; the question survives; done only on final answer/cancel (AC4.1/4.2)", () => {
	it("a provider terminal error (already redacted upstream) settles the turn into an in-panel error state; no done; question survives; recorded verbatim", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 0));
		const { state: opened, turnId } = openOneButton(s0, seed("n1", branchSpy().getBranch), clk);
		const streamed = reduce(opened, { type: "delta", turnId, text: "partial" }).state;
		// A provider terminal error resolves to {status:"error"} (v2 §4). The DRIVER redacts it UPSTREAM —
		// the live CompletionPort for this resolved path (B2), normalizeSideError for a throw (U4) — BEFORE
		// emitting settle, so the terminal result the reducer sees is ALREADY redacted: the raw credential
		// is gone, the diagnostic context survives. The reducer only records this already-safe text
		// verbatim; it never re-redacts, and the raw secret is never fed on the I4 path.
		const rawSecret = "sk-ant-api03-LEAK0011223344556677"; // the credential the provider error ORIGINALLY carried
		const redactedError = "401 Unauthorized — Authorization: Bearer [redacted] — insufficient scope"; // the driver's post-redaction output (the exact marker is U4's, not pinned here)
		const settled = reduce(streamed, { type: "settle", turnId, result: { text: "", status: "error", error: redactedError }, at: clk.at() });
		const s = settled.state;
		expect(s.mode).toBe("chat"); // error is an in-panel state, not a teardown
		expect(s.turns).toHaveLength(1);
		expect(s.turns[0].status).toBe("error");
		expect(s.turns[0].error).toBe(redactedError); // recorded verbatim — the reducer copies, never re-redacts
		expect(s.turns[0].error).not.toContain(rawSecret); // the raw credential never reaches the panel state (redaction is upstream — v2 §4)
		expect(s.view.question).toBe(SELECT_QUESTION);
		expect(settled.effects.some(e => e.type === "done")).toBe(false);
	});

	it("Esc during a streaming turn aborts it (abortTurn effect), keeps the question, and does not commit", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 0));
		const { state: opened, turnId } = openOneButton(s0, seed("n1", branchSpy().getBranch), clk);
		const streaming = reduce(opened, { type: "delta", turnId, text: "partial ans" }).state;
		const escaped = reduce(streaming, { type: "key", key: "esc" });
		expect(escaped.effects.some(e => e.type === "abortTurn")).toBe(true);
		expect(escaped.effects.some(e => e.type === "done")).toBe(false);
		expect(escaped.state.view.question).toBe(SELECT_QUESTION);
	});

	it("a delta for a superseded turn id is ignored (stale-delta guard)", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 0));
		const opened = feedSession(reduce(s0, { type: "key", key: "chat" }), seed("n1", branchSpy().getBranch), clk.at());
		let s = opened.state;
		s = reduce(s, { type: "char", text: "q1" }).state;
		const send1 = reduce(s, { type: "key", key: "enter", at: clk.at() });
		s = send1.state;
		const t1 = startTurnEffect(send1.effects);
		s = reduce(s, { type: "delta", turnId: t1.turnId, text: "answer-one" }).state;
		s = reduce(s, { type: "settle", turnId: t1.turnId, result: { text: "answer-one", status: "complete" }, at: clk.at() }).state;
		s = reduce(s, { type: "char", text: "q2" }).state;
		const send2 = reduce(s, { type: "key", key: "enter", at: clk.at() });
		s = send2.state;
		startTurnEffect(send2.effects); // turn 2 is now the active turn
		const beforeLive = s.liveTurn?.response ?? "";
		const after = reduce(s, { type: "delta", turnId: t1.turnId, text: "LATE-STALE" }).state; // stale id
		expect(after.liveTurn?.response ?? "").toBe(beforeLive); // active turn untouched
		expect(after.turns[0].response).toBe("answer-one"); // finalized turn 1 untouched
	});

	it("after an error, `r` retries the SAME prompt on the frozen session (no re-createSession, monotonic id); done only on the final commit (N2)", () => {
		const clk = clock();
		const branch = branchSpy();
		const s0 = createInitialState(selectView(false, 0));
		// Turn 1 (one-button on the focused option) fails.
		const start = feedSession(reduce(s0, { type: "key", key: "detail" }), seed("n1", branch.getBranch), clk.at());
		const turn1 = startTurnEffect(start.effects);
		const errored = reduce(start.state, { type: "settle", turnId: turn1.turnId, result: { text: "", status: "error", error: "429 rate limited" }, at: clk.at() });
		let s = errored.state;
		expect(errored.effects.some(e => e.type === "done")).toBe(false);
		expect(s.turns[0].status).toBe("error");
		expect(s.mode).toBe("chat"); // panel survives → retry possible

		// `r` retries: same prompt, frozen session reused, monotonic turn id (v2 §5).
		const retried = reduce(s, { type: "key", key: "retry", at: clk.at() });
		s = retried.state;
		expect(retried.effects.some(e => e.type === "createSession")).toBe(false); // frozen session reused
		const turn2 = startTurnEffect(retried.effects);
		expect(turn2.turnId).toBeGreaterThan(turn1.turnId); // monotonic
		expect(s.liveTurn?.prompt).toBe(errored.state.turns[0].prompt); // byte-equal prompt resend on the frozen session (turn records, effect-independent — TesterUnitR2)
		expect(branch.calls()).toBe(1); // getBranch never re-invoked across the retry

		// The retried turn completes.
		const done2 = reduce(s, { type: "settle", turnId: turn2.turnId, result: { text: "here is the explanation", status: "complete" }, at: clk.at() });
		s = done2.state;
		expect(done2.effects.some(e => e.type === "done")).toBe(false); // completing a side turn is not a commit
		expect(s.turns.some(t => t.status === "complete")).toBe(true); // retry succeeded

		const commit = reduce(escToList(s), { type: "key", key: "enter" });
		expect(commit.effects.some(e => e.type === "done")).toBe(true); // only the final decision commits
	});

	it("a failed side turn does not pollute the final selection decision", () => {
		const clk = clock();
		const s0 = createInitialState(selectView(false, 2)); // cursor on Merge
		const { state: opened, turnId } = openOneButton(s0, seed("n1", branchSpy().getBranch), clk);
		const settled = reduce(opened, { type: "settle", turnId, result: { text: "", status: "error", error: "boom" }, at: clk.at() });
		const done = doneResult(reduce(escToList(settled.state), { type: "key", key: "enter" }).effects);
		expect(done.kind).toBe("answer");
		if (done.kind === "answer") {
			expect(done.selections).toEqual(["Merge"]); // clean decision — no error text bleeds in
			expect(done.sideChat?.[0]?.status).toBe("error"); // the failure lives only in the side-chat record
		}
	});
});

// ── I5 — fallback discrimination (performX 4th-arg wiring, N7 matrix) ─────────
interface I5Harness {
	ui: SelectUI & { custom?(factory: unknown, opts: { overlay?: boolean }): Promise<unknown> };
	runtime: { buildSelect(p: unknown): unknown; buildConfirm(p: unknown): unknown; buildAsk(p: unknown): unknown };
	counts: { buildSelect: number; buildConfirm: number; buildAsk: number; custom: number; select: number; editor: number };
}

function i5Harness(opts: {
	custom: "absent" | { resolves: AskUiResult | undefined } | { rejects: unknown };
	select?: Array<string | undefined>;
	editor?: Array<string | undefined>;
}): I5Harness {
	const counts = { buildSelect: 0, buildConfirm: 0, buildAsk: 0, custom: 0, select: 0, editor: 0 };
	const selectQ = [...(opts.select ?? [])];
	const editorQ = [...(opts.editor ?? [])];
	const base: SelectUI = {
		async select() {
			counts.select += 1;
			return selectQ.shift();
		},
		async editor() {
			counts.editor += 1;
			return editorQ.shift();
		},
	};
	const customMode = opts.custom;
	const ui =
		customMode === "absent"
			? base
			: {
					...base,
					async custom(_factory: unknown, _opts: { overlay?: boolean }): Promise<unknown> {
						counts.custom += 1;
						if ("rejects" in customMode) throw customMode.rejects;
						return customMode.resolves;
					},
				};
	const dummyFactory = (): { render: () => unknown[] } => ({ render: () => [] });
	const runtime = {
		buildSelect(_p: unknown) {
			counts.buildSelect += 1;
			return dummyFactory;
		},
		buildConfirm(_p: unknown) {
			counts.buildConfirm += 1;
			return dummyFactory;
		},
		buildAsk(_p: unknown) {
			counts.buildAsk += 1;
			return dummyFactory;
		},
	};
	return { ui, runtime, counts };
}

describe("I5 — fallback discrimination: headless / legacy / custom-absent / custom-undefined / custom-used / custom-reject (AC2.3)", () => {
	it("headless (unavailable channel, no fixture) stays the HEADLESS_ERROR hard error and never touches the runtime", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { resolves: undefined } });
		const result = await performSelect(resolveAskChannel(undefined, false), ui, { question: SELECT_QUESTION, options: OPTIONS }, runtime);
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/interactive UI is not available|headless/i);
		expect(counts.buildSelect).toBe(0);
		expect(counts.custom).toBe(0);
	});

	it("no runtime injected → the legacy ctx.ui.select path (GREEN current behavior)", async () => {
		const { ui, counts } = i5Harness({ custom: "absent", select: ["Beta"] });
		const result = await performSelect({ kind: "ui" }, ui, { question: SELECT_QUESTION, options: OPTIONS });
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(counts.select).toBe(1);
	});

	it("runtime present but ctx.ui.custom ABSENT → legacy select; the runtime is never attempted (N7)", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: "absent", select: ["Beta"] });
		const result = await performSelect({ kind: "ui" }, ui, { question: SELECT_QUESTION, options: OPTIONS }, runtime);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(counts.custom).toBe(0); // no custom method to mount into
		expect(counts.buildSelect).toBe(0); // so the runtime factory is never built
		expect(counts.select).toBe(1); // straight to the legacy selector
	});

	it("custom resolves undefined (factory never started) → legacy select fallback", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { resolves: undefined }, select: ["Beta"] });
		const result = await performSelect({ kind: "ui" }, ui, { question: SELECT_QUESTION, options: OPTIONS }, runtime);
		expect(counts.buildSelect).toBe(1); // the runtime was attempted
		expect(counts.custom).toBe(1); // custom mounted and resolved undefined
		expect(counts.select).toBe(1); // then fell back to the legacy selector
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
	});

	it("ask: custom resolves undefined → legacy ctx.ui.editor fallback (N7)", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { resolves: undefined }, editor: ["the fix is a null guard"] });
		const result = await performAsk({ kind: "ui" }, ui, { question: "Describe the fix" }, runtime);
		expect(counts.buildAsk).toBe(1);
		expect(counts.custom).toBe(1);
		expect(counts.editor).toBe(1); // fell back to the legacy editor
		expect(textOf(result)).toBe("the fix is a null guard");
	});

	it("confirm: custom resolves undefined → legacy Yes/No/Other loop fallback (N7)", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { resolves: undefined }, select: ["Yes"] });
		const result = await performConfirm({ kind: "ui" }, ui, { question: "Proceed?" }, runtime);
		expect(counts.buildConfirm).toBe(1);
		expect(counts.custom).toBe(1);
		expect(counts.select).toBe(1); // fell back to the legacy Yes/No/Other selector
		expect(textOf(result)).toBe("yes");
	});

	it("custom resolves an AskUiResult → the component result is used and legacy select is NOT consulted", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { resolves: { kind: "answer", selections: ["Beta"] } }, select: ["SHOULD-NOT-BE-USED"] });
		const result = await performSelect({ kind: "ui" }, ui, { question: SELECT_QUESTION, options: OPTIONS }, runtime);
		expect(counts.buildSelect).toBe(1);
		expect(counts.custom).toBe(1);
		expect(counts.select).toBe(0); // the component answered; the legacy path is never reached
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
	});

	it("custom REJECTS (factory started, then errored) → NOT hidden by a legacy fallback; maps to an error/cancel result (N7)", async () => {
		const { ui, runtime, counts } = i5Harness({ custom: { rejects: new Error("side-chat component render blew up") }, select: ["SHOULD-NOT-BE-USED"] });
		const result = await performSelect({ kind: "ui" }, ui, { question: SELECT_QUESTION, options: OPTIONS }, runtime);
		expect(counts.buildSelect).toBe(1); // the factory WAS started
		expect(counts.custom).toBe(1);
		expect(counts.select).toBe(0); // a started-then-failed factory is NOT masked by the legacy selector (plan §PR2)
		expect(result.isError).toBe(true); // surfaced as an error/cancel, not a silent success
	});

	it("the legacy fallback editor keeps the current 1-stage Esc (an undefined editor cancels immediately)", async () => {
		const { ui, counts } = i5Harness({ custom: "absent", editor: [undefined] });
		const result = await performAsk({ kind: "ui" }, ui, { question: "Describe the fix" });
		expect(result.isError).toBe(true); // a single Esc (editor → undefined) cancels — no 2-stage header hop in the fallback
		expect(counts.editor).toBe(1);
	});
});
