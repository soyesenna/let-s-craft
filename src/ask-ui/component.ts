// Bun-only leaf: the single-mount custom<T> coordinator. It owns raw-key classification (via the
// pi-tui matchesKey — its sole @oh-my-pi runtime VALUE import), drives the pure reducer (state.ts),
// executes the reducer's effects (createSession / startTurn via the injected CompletionPort /
// abortTurn / done), and paints the current state through the pure render-model. State survives the
// whole mount as this coordinator's fields (AC1.3). Canon: plan §PR2/§PR4 + ask-ui-wiring-contract-v2.
import { matchesKey } from "@oh-my-pi/pi-tui";
import { createSideChatSession, normalizeSideError, type CompletionPort, type SideChatMessage } from "./completion-core.js";
import {
	createInitialState,
	reduce,
	searchOptions,
	type AskUiEffect,
	type AskUiEvent,
	type AskUiState,
} from "./state.js";
import { renderChatPanel, renderSelectView, type ChatPanelViewModel, type ChatTurnView, type SelectViewModel } from "./render-model.js";
import type { AskExecutionContext, AskUiResult, AskUiView, ColorMode, CustomFactoryFn, RenderEnv } from "./types.js";

const SIDE_SYSTEM_PROMPT =
	"You are assisting a user who is answering a multiple-choice question inside the lets-craft " +
	"pipeline. Explain clearly and concisely so they can decide. You have NO tools and cannot run " +
	"commands or call functions — answer directly from the provided context. Be concrete: what it " +
	"means, when to choose it, and its main tradeoff versus the alternatives.";

const DEFAULT_ENV: RenderEnv = { columns: 80, rows: 24, isLight: false, colorMode: "truecolor" };

function finiteNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// A single printable character (never a CSI/escape sequence) becomes editor/search/chat text input.
function printableChar(data: string): string | undefined {
	if (data.length === 0 || data.startsWith("\x1b")) return undefined;
	const code = data.codePointAt(0);
	return code !== undefined && code >= 32 ? data : undefined;
}

// Best-effort canonicalization of a getBranch() entry into a {role, content} side-chat message. The
// snapshot is decoupled by value in createSideChatSession; here we only extract role + text.
function canonicalizeEntry(entry: unknown): SideChatMessage | undefined {
	if (typeof entry !== "object" || entry === null) return undefined;
	const source = "message" in entry && typeof entry.message === "object" && entry.message !== null ? entry.message : entry;
	if (typeof source !== "object" || source === null || !("role" in source)) return undefined;
	const role = source.role;
	if (role !== "user" && role !== "assistant" && role !== "system") return undefined;
	const raw = "content" in source ? source.content : undefined;
	let content = "";
	if (typeof raw === "string") content = raw;
	else if (Array.isArray(raw)) {
		for (const part of raw) {
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") content += part.text;
		}
	}
	return { role, content };
}

/**
 * Build a custom<T> factory for one question view. The returned factory captures the host tui/theme
 * (arg 0 is ctx.ui, which carries requestRender — extension-ui-controller.ts:1022), drives the reducer
 * on every key, and forwards the terminal answer/cancel to the host's done() callback. Typed to the
 * broad AskUiResult; index.ts narrows it to the tool's exact result union (a select view only ever
 * yields a SelectResult).
 */
export function createComponentFactory(ctx: AskExecutionContext, port: CompletionPort, view: AskUiView): CustomFactoryFn<AskUiResult> {
	return (tui, theme, _keybindings, done) => {
		let state = createInitialState(view);
		let settled = false;
		const aborts = new Map<number, AbortController>();

		const now = (): string => new Date().toISOString();

		const requestRender = (): void => {
			try {
				(tui as { requestRender?: () => void } | undefined)?.requestRender?.();
			} catch {
				// A host without a live render loop (or a test double) is a no-op — never fatal.
			}
		};

		const renderEnv = (): RenderEnv => {
			const t = tui as Record<string, unknown> | undefined;
			const th = theme as Record<string, unknown> | undefined;
			const columns = finiteNumber(t?.width ?? t?.columns, DEFAULT_ENV.columns);
			const rows = finiteNumber(t?.height ?? t?.rows, DEFAULT_ENV.rows);
			const isLight = th?.isLight === true;
			let colorMode: ColorMode = "truecolor";
			try {
				const getColorMode = th?.getColorMode;
				if (typeof getColorMode === "function") colorMode = getColorMode.call(th) === "256color" ? "256color" : "truecolor";
			} catch {
				colorMode = "truecolor";
			}
			return { columns, rows, isLight, colorMode };
		};

		const makeSession = () =>
			createSideChatSession({
				mainSessionId: ctx.sessionManager.getSessionId(),
				nonce: Math.random().toString(36).slice(2, 10),
				model: ctx.model?.id ?? "",
				systemPrompt: SIDE_SYSTEM_PROMPT,
				getBranch: () => ctx.sessionManager.getBranch().map(canonicalizeEntry).filter((m): m is SideChatMessage => m !== undefined),
			});

		const runTurn = (turnId: number, request: Parameters<CompletionPort["run"]>[0]): void => {
			const controller = new AbortController();
			aborts.set(turnId, controller);
			port
				.run(request, { signal: controller.signal, onDelta: chunk => apply({ type: "delta", turnId, text: chunk }) })
				.then(result => apply({ type: "settle", turnId, result, at: now() }))
				.catch(error => apply({ type: "settle", turnId, result: normalizeSideError(error), at: now() }))
				.finally(() => aborts.delete(turnId));
		};

		const runEffect = (effect: AskUiEffect): void => {
			switch (effect.type) {
				case "createSession":
					apply({ type: "session", session: makeSession(), at: now() });
					break;
				case "startTurn":
					runTurn(effect.turnId, effect.request);
					break;
				case "abortTurn":
					aborts.get(effect.turnId)?.abort();
					break;
				case "done":
					if (!settled) {
						settled = true;
						done(effect.result);
					}
					break;
			}
		};

		function apply(event: AskUiEvent): void {
			const result = reduce(state, event);
			state = result.state;
			for (const effect of result.effects) runEffect(effect);
			requestRender();
		}

		const toEvent = (data: string): AskUiEvent | undefined => {
			const textEntry = state.mode === "editor" || state.mode === "search" || (state.mode === "chat" && state.chatEditorFocused);
			if (matchesKey(data, "escape")) return { type: "key", key: "esc" };
			if (matchesKey(data, "backspace")) return { type: "backspace" };
			if (matchesKey(data, "up")) return { type: "key", key: "up" };
			if (matchesKey(data, "down")) return { type: "key", key: "down" };
			if (matchesKey(data, "pageUp")) return { type: "key", key: "pageUp" };
			if (matchesKey(data, "pageDown")) return { type: "key", key: "pageDown" };
			if (matchesKey(data, "enter")) return state.mode === "editor" ? { type: "submitAsk" } : { type: "key", key: "enter", at: now() };
			if (textEntry) {
				const ch = printableChar(data);
				return ch !== undefined ? { type: "char", text: ch } : undefined;
			}
			if (matchesKey(data, "space")) return { type: "key", key: "space" };
			if (matchesKey(data, "?")) return { type: "key", key: "detail", at: now() };
			if (matchesKey(data, "t")) return { type: "key", key: "chat", at: now() };
			if (matchesKey(data, "/")) return { type: "key", key: "search" };
			if (matchesKey(data, "r")) return { type: "key", key: "retry", at: now() };
			return undefined;
		};

		const renderView = (): string[] => {
			const env = renderEnv();
			if (state.mode === "chat") return renderChatPanel(chatViewModel(state), env);
			return renderSelectView(selectViewModel(state), env);
		};

		return {
			render: () => renderView(),
			handleInput: (data: string) => {
				if (settled) return;
				const event = toEvent(data);
				if (event) apply(event);
			},
			dispose: () => {
				for (const controller of aborts.values()) controller.abort();
				aborts.clear();
			},
		};
	};
}

function selectViewModel(state: AskUiState): SelectViewModel {
	const cursor = state.canonicalCursor;
	const searching = state.mode === "search";
	const descriptionScroll = !searching && cursor >= 0 && cursor < state.view.options.length ? state.descriptionScrollByTarget[cursor] ?? 0 : 0;
	const vm: SelectViewModel = {
		question: state.view.question,
		options: state.view.options,
		multi: state.view.multi,
		focusIndex: cursor,
		recommended: state.view.recommended,
		checkedIndices: state.checkedIndices,
		optionScroll: state.optionScroll,
		descriptionScroll,
	};
	if (searching) {
		// Reuse the reducer's searchOptions so the rendered projection maps to the SAME original
		// indices the search-mode commit path resolves (highlight === Enter target).
		vm.searchQuery = state.searchQuery;
		vm.filteredIndices = searchOptions(state.view.options, state.searchQuery).map(entry => entry.index);
	}
	if (state.mode === "editor") {
		vm.editorDraft = { text: state.askDraft, cursor: state.askCursor };
	}
	return vm;
}

function chatViewModel(state: AskUiState): ChatPanelViewModel {
	const live = state.liveTurn;
	const turns: ChatTurnView[] = [];
	if (live) {
		turns.push({ kind: "question", text: live.prompt });
		if (live.response.length > 0) turns.push({ kind: "answer", text: live.response });
	}
	const status = live?.status === "streaming" ? "streaming" : live?.status === "error" ? "error" : "complete";
	return {
		target: state.chatTarget ?? { kind: "question" },
		turns,
		status,
		error: live?.status === "error" ? live.error : undefined,
		chatDraft: { text: state.chatDraft, focused: state.chatEditorFocused },
	};
}
