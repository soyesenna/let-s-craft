// Node-safe pure reducer for the ask-ui component (U8/U9/U10). Semantic intents in, {state, effects}
// out; NEVER reads a clock (timestamps ride on the events) and NEVER mutates its input. Canon: plan
// §PR2 state-transition canon + Fallback/Failure canon; appendix-palette §2 keymap; ask-ui-wiring-
// contract-v2 §3 (focus domain) + §5 (event vocabulary + retry). Raw-key -> intent classification
// (matchesKey) and the live CompletionPort belong to the Bun leaf component.ts.
import { DONE_OPTION, OTHER_OPTION } from "../ask.js";
import {
	buildSideRequest,
	type SideChatRequest,
	type SideChatResult,
	type SideChatSession,
	type SideChatTurnSpec,
} from "./completion-core.js";
import type { AskUiOption, AskUiResult, AskUiView, ChatTarget, SideChatMode, SideChatTurn } from "./types.js";

export type { AskUiView } from "./types.js";

// Semantic keys (matchesKey classifies raw bytes into these in the Bun leaf).
export type AskUiKey =
	| "up"
	| "down"
	| "pageUp"
	| "pageDown"
	| "enter"
	| "space"
	| "esc"
	| "detail"
	| "chat"
	| "search"
	| "retry";

export type AskUiEvent =
	| { type: "key"; key: AskUiKey; at?: string }
	| { type: "char"; text: string }
	| { type: "backspace" }
	| { type: "submitAsk" }
	| { type: "session"; session: SideChatSession; at?: string }
	| { type: "delta"; turnId: number; text: string }
	| { type: "settle"; turnId: number; result: SideChatResult; at: string };

export type AskUiEffect =
	| { type: "done"; result: AskUiResult }
	| { type: "createSession" }
	| { type: "startTurn"; turnId: number; request: SideChatRequest }
	| { type: "abortTurn"; turnId: number };

// The in-flight (or latest-settled) side turn's live view. `turns` is the append-only finalized log.
interface LiveTurn {
	turnId: number;
	target: ChatTarget;
	mode: SideChatMode;
	prompt: string;
	response: string;
	model: string;
	startedAt: string;
	status: "streaming" | "complete" | "aborted" | "error";
	error?: string;
}

interface PendingTurn {
	target: ChatTarget;
	mode: SideChatMode;
	autoFire: boolean;
}

export interface AskUiState {
	view: AskUiView;
	mode: "browse" | "editor" | "chat" | "search";
	returnMode: "browse" | "editor";
	canonicalCursor: number; // -1 header | 0..n-1 options | n Other | n+1 Done (in search: filtered pos)
	checkedIndices: number[];
	optionScroll: number;
	descriptionScrollByTarget: Record<number, number>;
	searchQuery: string;
	askDraft: string;
	askCursor: number;
	chatDraft: string;
	chatEditorFocused: boolean;
	chatTarget?: ChatTarget;
	sideSession?: SideChatSession;
	activeTurnId: number;
	turns: SideChatTurn[];
	liveTurn?: LiveTurn;
	pendingTurn?: PendingTurn;
}

export interface ReduceResult {
	state: AskUiState;
	effects: AskUiEffect[];
}

const PAGE_STEP = 5;

// ── Pure host-parity helpers (exported test seams / stable domain concepts) ────────────────────────

export function selectionMarker(view: AskUiView): "radio" | "checkbox" {
	return view.multi ? "checkbox" : "radio";
}

export function markableCount(view: AskUiView): number {
	return view.options.length;
}

export function controlRows(state: AskUiState): string[] {
	if (state.view.tool === "ask") return [];
	const rows = [OTHER_OPTION];
	if (state.view.multi && state.checkedIndices.length > 0) rows.push(DONE_OPTION);
	return rows;
}

export function searchOptions(
	options: readonly AskUiOption[],
	query: string,
): Array<{ index: number; option: AskUiOption }> {
	const all = options.map((option, index) => ({ index, option }));
	const q = query.trim().toLowerCase();
	if (q === "") return all;
	return all.filter(
		({ option }) => option.label.toLowerCase().includes(q) || option.description.toLowerCase().includes(q),
	);
}

// ── Internal helpers ───────────────────────────────────────────────────────────────────────────────

function initialState(view: AskUiView): AskUiState {
	const isAsk = view.tool === "ask";
	const draft = isAsk ? view.prefill ?? "" : "";
	return {
		view,
		mode: isAsk ? "editor" : "browse",
		returnMode: "browse",
		canonicalCursor: isAsk ? -1 : view.recommended ?? 0,
		checkedIndices: [],
		optionScroll: 0,
		descriptionScrollByTarget: {},
		searchQuery: "",
		askDraft: draft,
		askCursor: draft.length,
		chatDraft: "",
		chatEditorFocused: false,
		chatTarget: undefined,
		sideSession: undefined,
		activeTurnId: 0,
		turns: [],
		liveTurn: undefined,
		pendingTurn: undefined,
	};
}

export function createInitialState(view: AskUiView): AskUiState {
	return initialState(view);
}

function targetForCursor(state: AskUiState): ChatTarget {
	const c = state.canonicalCursor;
	if (c >= 0 && c < state.view.options.length) return { kind: "option", label: state.view.options[c].label };
	return { kind: "question" };
}

function completedTurns(turns: readonly SideChatTurn[]): SideChatTurn[] {
	return turns.filter(t => t.status === "complete");
}

function withSideChat<T extends { kind: "answer" }>(answer: T, turns: readonly SideChatTurn[]): T {
	return turns.length > 0 ? { ...answer, sideChat: [...turns] } : answer;
}

// Build the answer the driver forwards to custom done() for the current tool + committed set.
function answerFor(state: AskUiState, selectedLabels: string[], freeText: string | undefined): AskUiResult {
	if (state.view.tool === "ask") return withSideChat({ kind: "answer" as const, response: freeText ?? "" }, state.turns);
	if (state.view.tool === "confirm") {
		const confirmed = freeText !== undefined ? null : selectedLabels[0] === "Yes";
		const answer =
			freeText !== undefined
				? { kind: "answer" as const, confirmed, freeText }
				: { kind: "answer" as const, confirmed };
		return withSideChat(answer, state.turns);
	}
	const answer =
		freeText !== undefined
			? { kind: "answer" as const, selections: selectedLabels, freeText }
			: { kind: "answer" as const, selections: selectedLabels };
	return withSideChat(answer, state.turns);
}

function toggleChecked(checked: readonly number[], index: number): number[] {
	const set = new Set(checked);
	if (set.has(index)) set.delete(index);
	else set.add(index);
	return [...set].sort((a, b) => a - b);
}

// Start a side turn on the frozen session: abort any in-flight turn, build the provider-ready request,
// record the live turn (startedAt injected from `at`), and hand the request to the driver.
function startTurn(state: AskUiState, session: SideChatSession, spec: SideChatTurnSpec, at: string): ReduceResult {
	const turnId = state.activeTurnId + 1;
	const request = buildSideRequest(session, completedTurns(state.turns), spec);
	const prompt = request.messages[request.messages.length - 1].content;
	const effects: AskUiEffect[] = [];
	if (state.liveTurn && state.liveTurn.status === "streaming") effects.push({ type: "abortTurn", turnId: state.activeTurnId });
	effects.push({ type: "startTurn", turnId, request });
	const liveTurn: LiveTurn = {
		turnId,
		target: spec.target,
		mode: spec.mode,
		prompt,
		response: "",
		model: session.model,
		startedAt: at,
		status: "streaming",
	};
	return {
		state: {
			...state,
			mode: "chat",
			activeTurnId: turnId,
			liveTurn,
			pendingTurn: undefined,
			chatDraft: spec.mode === "free-prompt" ? "" : state.chatDraft,
		},
		effects,
	};
}

function specFor(state: AskUiState, target: ChatTarget, mode: SideChatMode, freePrompt?: string): SideChatTurnSpec {
	return { target, mode, question: state.view.question, options: state.view.options, freePrompt };
}

function openSideChat(state: AskUiState, mode: SideChatMode, at: string | undefined): ReduceResult {
	const target = targetForCursor(state);
	const returnMode = state.mode === "chat" ? state.returnMode : "browse";
	const chatEditorFocused = mode === "free-prompt";
	if (!state.sideSession) {
		return {
			state: {
				...state,
				mode: "chat",
				returnMode,
				chatEditorFocused,
				chatTarget: target,
				chatDraft: mode === "free-prompt" ? "" : state.chatDraft,
				pendingTurn: { target, mode, autoFire: mode === "one-button" },
			},
			effects: [{ type: "createSession" }],
		};
	}
	if (mode === "one-button") {
		const opened: AskUiState = { ...state, mode: "chat", returnMode, chatEditorFocused: false, chatTarget: target };
		return startTurn(opened, state.sideSession, specFor(state, target, "one-button"), at ?? "");
	}
	return {
		state: { ...state, mode: "chat", returnMode, chatEditorFocused: true, chatTarget: target },
		effects: [],
	};
}

const noop = (state: AskUiState): ReduceResult => ({ state, effects: [] });

// ── The reducer ────────────────────────────────────────────────────────────────────────────────────

export function reduce(state: AskUiState, event: AskUiEvent): ReduceResult {
	switch (event.type) {
		case "char":
			return reduceChar(state, event.text);
		case "backspace":
			return reduceBackspace(state);
		case "submitAsk":
			return reduceSubmitAsk(state);
		case "session":
			return reduceSession(state, event.session, event.at);
		case "delta":
			return reduceDelta(state, event.turnId, event.text);
		case "settle":
			return reduceSettle(state, event.turnId, event.result, event.at);
		case "key":
			return reduceKey(state, event.key, event.at);
	}
}

function reduceChar(state: AskUiState, text: string): ReduceResult {
	if (state.mode === "editor") {
		const askDraft = state.askDraft.slice(0, state.askCursor) + text + state.askDraft.slice(state.askCursor);
		return noop({ ...state, askDraft, askCursor: state.askCursor + text.length });
	}
	if (state.mode === "search") {
		const searchQuery = state.searchQuery + text;
		const filtered = searchOptions(state.view.options, searchQuery);
		return noop({ ...state, searchQuery, canonicalCursor: Math.min(state.canonicalCursor, Math.max(0, filtered.length - 1)) });
	}
	if (state.mode === "chat" && state.chatEditorFocused) return noop({ ...state, chatDraft: state.chatDraft + text });
	return noop(state);
}

function reduceBackspace(state: AskUiState): ReduceResult {
	if (state.mode === "editor") {
		if (state.askCursor === 0) return noop(state);
		const askDraft = state.askDraft.slice(0, state.askCursor - 1) + state.askDraft.slice(state.askCursor);
		return noop({ ...state, askDraft, askCursor: state.askCursor - 1 });
	}
	if (state.mode === "search") {
		const searchQuery = state.searchQuery.slice(0, -1);
		const filtered = searchOptions(state.view.options, searchQuery);
		return noop({ ...state, searchQuery, canonicalCursor: Math.min(state.canonicalCursor, Math.max(0, filtered.length - 1)) });
	}
	if (state.mode === "chat" && state.chatEditorFocused) return noop({ ...state, chatDraft: state.chatDraft.slice(0, -1) });
	return noop(state);
}

function reduceSubmitAsk(state: AskUiState): ReduceResult {
	if (state.mode !== "editor") return noop(state);
	const checkedLabels = state.view.options.filter((_, i) => state.checkedIndices.includes(i)).map(o => o.label);
	const result = answerFor(state, checkedLabels, state.askDraft);
	return { state, effects: [{ type: "done", result }] };
}

function reduceSession(state: AskUiState, session: SideChatSession, at: string | undefined): ReduceResult {
	const pending = state.pendingTurn;
	const withSession: AskUiState = { ...state, sideSession: session, pendingTurn: undefined };
	if (pending && pending.autoFire) {
		return startTurn(withSession, session, specFor(state, pending.target, pending.mode), at ?? "");
	}
	return noop(withSession);
}

function reduceDelta(state: AskUiState, turnId: number, text: string): ReduceResult {
	if (!state.liveTurn || turnId !== state.activeTurnId) return noop(state);
	return noop({ ...state, liveTurn: { ...state.liveTurn, response: state.liveTurn.response + text } });
}

function reduceSettle(state: AskUiState, turnId: number, result: SideChatResult, at: string): ReduceResult {
	if (!state.liveTurn || turnId !== state.activeTurnId) return noop(state);
	const finalized: SideChatTurn = {
		target: state.liveTurn.target,
		mode: state.liveTurn.mode,
		prompt: state.liveTurn.prompt,
		response: result.text,
		model: state.liveTurn.model,
		startedAt: state.liveTurn.startedAt,
		endedAt: at,
		status: result.status,
	};
	if (result.status === "error") finalized.error = result.error ?? "";
	const liveTurn: LiveTurn = {
		...state.liveTurn,
		response: result.text,
		status: result.status,
		error: result.status === "error" ? result.error : undefined,
	};
	return noop({ ...state, turns: [...state.turns, finalized], liveTurn });
}

function reduceKey(state: AskUiState, key: AskUiKey, at: string | undefined): ReduceResult {
	switch (state.mode) {
		case "editor":
			return reduceEditorKey(state, key);
		case "search":
			return reduceSearchKey(state, key);
		case "chat":
			return reduceChatKey(state, key, at);
		case "browse":
			return reduceBrowseKey(state, key, at);
	}
}

function reduceEditorKey(state: AskUiState, key: AskUiKey): ReduceResult {
	// The ask/Other free-text editor. Esc returns to browse preserving the draft (ask -> header at -1;
	// Other -> the Other row at n — both are just "keep canonicalCursor, drop editor mode").
	if (key === "esc") return noop({ ...state, mode: "browse" });
	return noop(state);
}

function reduceSearchKey(state: AskUiState, key: AskUiKey): ReduceResult {
	const filtered = searchOptions(state.view.options, state.searchQuery);
	const maxPos = Math.max(0, filtered.length - 1);
	switch (key) {
		case "esc":
			return noop({ ...state, mode: "browse", searchQuery: "", canonicalCursor: 0 });
		case "down":
			return noop({ ...state, canonicalCursor: Math.min(state.canonicalCursor + 1, maxPos) });
		case "up":
			return noop({ ...state, canonicalCursor: Math.max(0, state.canonicalCursor - 1) });
		case "enter": {
			if (filtered.length === 0) return noop(state);
			const idx = filtered[Math.min(state.canonicalCursor, maxPos)].index;
			if (state.view.multi) return noop({ ...state, checkedIndices: toggleChecked(state.checkedIndices, idx) });
			return { state, effects: [{ type: "done", result: answerFor(state, [state.view.options[idx].label], undefined) }] };
		}
		case "space": {
			if (filtered.length === 0 || !state.view.multi) return noop(state);
			const idx = filtered[Math.min(state.canonicalCursor, maxPos)].index;
			return noop({ ...state, checkedIndices: toggleChecked(state.checkedIndices, idx) });
		}
		default:
			// detail / chat / retry / paging are inert while searching (printables are query input).
			return noop(state);
	}
}

function reduceChatKey(state: AskUiState, key: AskUiKey, at: string | undefined): ReduceResult {
	switch (key) {
		case "detail":
			return openSideChat(state, "one-button", at);
		case "chat":
			return openSideChat(state, "free-prompt", at);
		case "enter": {
			if (!state.chatEditorFocused || state.chatDraft.length === 0 || !state.sideSession) return noop(state);
			const target = state.chatTarget ?? targetForCursor(state);
			return startTurn(state, state.sideSession, specFor(state, target, "free-prompt", state.chatDraft), at ?? "");
		}
		case "retry": {
			if (!state.sideSession || state.liveTurn?.status !== "error") return noop(state);
			const live = state.liveTurn;
			const freePrompt = live.mode === "free-prompt" ? live.prompt : undefined;
			return startTurn(state, state.sideSession, specFor(state, live.target, live.mode, freePrompt), at ?? "");
		}
		case "esc": {
			if (state.chatEditorFocused) return noop({ ...state, chatEditorFocused: false });
			const effects: AskUiEffect[] = [];
			if (state.liveTurn && state.liveTurn.status === "streaming") effects.push({ type: "abortTurn", turnId: state.activeTurnId });
			return { state: { ...state, mode: state.returnMode }, effects };
		}
		default:
			return noop(state);
	}
}

function reduceBrowseKey(state: AskUiState, key: AskUiKey, at: string | undefined): ReduceResult {
	const view = state.view;
	const n = view.options.length;
	const c = state.canonicalCursor;

	// The ask tool's browse mode is just the question header; Down/Enter return to the editor.
	if (view.tool === "ask") {
		switch (key) {
			case "esc":
				return { state, effects: [{ type: "done", result: { kind: "cancel" } }] };
			case "down":
			case "enter":
				return noop({ ...state, mode: "editor", askCursor: state.askDraft.length });
			case "detail":
			case "chat":
				return openSideChat(state, key === "detail" ? "one-button" : "free-prompt", at);
			default:
				return noop(state);
		}
	}

	const hasDone = view.multi && state.checkedIndices.length > 0;
	const maxCursor = n + (hasDone ? 1 : 0);

	switch (key) {
		case "esc":
			return { state, effects: [{ type: "done", result: { kind: "cancel" } }] };
		case "up":
			return noop({ ...state, canonicalCursor: Math.max(-1, c - 1) });
		case "down":
			return noop({ ...state, canonicalCursor: c === -1 ? 0 : Math.min(maxCursor, c + 1) });
		case "search":
			return noop({ ...state, mode: "search", canonicalCursor: 0 });
		case "detail":
			return openSideChat(state, "one-button", at);
		case "chat":
			return openSideChat(state, "free-prompt", at);
		case "pageDown":
			if (c >= 0 && c < n) {
				return noop({ ...state, descriptionScrollByTarget: { ...state.descriptionScrollByTarget, [c]: (state.descriptionScrollByTarget[c] ?? 0) + PAGE_STEP } });
			}
			return noop({ ...state, optionScroll: state.optionScroll + PAGE_STEP });
		case "pageUp":
			if (c >= 0 && c < n) {
				return noop({ ...state, descriptionScrollByTarget: { ...state.descriptionScrollByTarget, [c]: Math.max(0, (state.descriptionScrollByTarget[c] ?? 0) - PAGE_STEP) } });
			}
			return noop({ ...state, optionScroll: Math.max(0, state.optionScroll - PAGE_STEP) });
		case "space":
			if (c >= 0 && c < n && view.multi) return noop({ ...state, checkedIndices: toggleChecked(state.checkedIndices, c) });
			return noop(state);
		case "enter":
			return reduceBrowseEnter(state, c, n);
		case "retry":
			return noop(state);
	}
}

function reduceBrowseEnter(state: AskUiState, c: number, n: number): ReduceResult {
	const view = state.view;
	if (c === -1) return noop(state); // header Enter is a no-op for select/confirm
	if (c >= 0 && c < n) {
		if (view.multi) return noop({ ...state, checkedIndices: toggleChecked(state.checkedIndices, c) });
		return { state, effects: [{ type: "done", result: answerFor(state, [view.options[c].label], undefined) }] };
	}
	if (c === n) return noop({ ...state, mode: "editor", askDraft: state.askDraft, askCursor: state.askDraft.length }); // Other -> editor
	// Done row (n+1): commit the checked set.
	const checkedLabels = view.options.filter((_, i) => state.checkedIndices.includes(i)).map(o => o.label);
	return { state, effects: [{ type: "done", result: answerFor(state, checkedLabels, undefined) }] };
}
