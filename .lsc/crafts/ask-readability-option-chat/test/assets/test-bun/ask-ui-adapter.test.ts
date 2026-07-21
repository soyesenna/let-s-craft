// B1-B3 + U7 physical-key dispatch + production-assembly discriminator — src/ask-ui/ Bun-leaf
// smokes, run under `bun test` (NOT vitest).
//
// WHY A SEPARATE BUN SUITE. src/ask-ui/{component,index}.ts value-import pi-tui /
// pi-coding-agent, and src/ask-ui/completion.ts value-imports pi-ai. Those packages ship
// source-TypeScript entry points (package.json main → ./src/index.ts) that only the Bun runtime
// can import (vitest-on-Node throws ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, [C12], the statusbar
// precedent). So the ONLY place these leaves can be imported-and-exercised as real values is a
// Bun test; that import succeeding here is itself the primary boundary smoke. Detailed pure-core
// behavior (reducers, request builder, redactor, palette) is covered by the Node/vitest U/I
// suites — these are the Bun-runtime boundary the Node suites structurally cannot reach.
//
// GATING. test-bun/ is outside vitest's default test/ glob, so `vitest run` never collects it.
// Instead run_test.sh runs it via `bun test test-bun` as the runner's DEFAULT deterministic stage
// whenever a `bun` binary is present (wiring canon v2 §7; LSC_BUN=1 forces it / surfaces a skip
// reason when bun is absent) — NOT a gated live stage like E1/O1. In pre-craft this stage is an
// intended nonzero RED (src/ask-ui/ not built yet), the same deterministic RED the whole suite reports.
//
// EXPECTED STATE (pre-craft): src/ask-ui/{index,completion}.ts do NOT exist yet, so the dynamic
// imports below reject and every test that mounts a leaf FAILS at import — the correct RED for an
// unbuilt feature. The production-assembly test imports the (existing) src/main and RED's on its
// binder discriminator (main still calls registerAskTools(pi) with no binder). The two U7
// positive-control tests import ONLY the real pi-tui and stay GREEN — the standalone tripwire
// proving this file's raw key vocabulary is genuine.
//
// ── WIRING CANON — v2 (local://ask-ui-wiring-contract-v2.md). §1 binder: createAskRuntimeFactory(pi)
//    → AskRuntimeBinder = (ctx: AskExecutionContext) => AskRuntime{buildSelect/buildConfirm/buildAsk};
//    registerAskTools(pi, binder?) binds ctx ONLY on the UI channel and passes the bound runtime as
//    performX's 4th arg (fixture/unavailable never call the binder). §4 CompletionPort:
//    run(req, {signal, onDelta?}) → SideChatResult{text,status,error?,usage?}; systemPrompt is a
//    string, NO tools field (no-tools = the adapter passes none to pi-ai). §2 result unions below.
//    §3 cursor domain (Main ruling): -1 header, 0..n-1 options, n Other, n+1 Done(multi&&checked>0);
//    multi option Enter = toggle, Done Enter = commit.
//
// ── HOW THE CRITIC'S UNIVERSAL-PROXY / STUB-STREAM CONCERN IS CLOSED. The COMPLETION contract is
//    now verified with a TYPED ctx fake (createFakeCtx: real models/modelRegistry/sessionManager
//    surface) + CAPTURED pi-ai stream args (streamCalls) — see B2. The only remaining permissive
//    double is `renderSurface()`, the host-opaque pi-tui TUI/Theme the custom<T> factory renders
//    against; it carries NO completion contract, so it hides no adapter misuse (contrast the removed
//    self-returning Proxy that stubbed pi-ai stream/resolver and let signal/cache/no-tools vanish).
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
// Value import: the REAL pi-ai, captured before the mock so the stream doubles can build a genuine
// AssistantMessageEventStream and spread every non-network export back into the mock.
import * as actualPiAi from "@oh-my-pi/pi-ai";
import type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream, StopReason, Usage } from "@oh-my-pi/pi-ai";
// Value import: the REAL pi-tui key matcher + Kitty-protocol toggle — the U7 positive control.
import { isKittyProtocolActive, matchesKey, setKittyProtocolActive } from "@oh-my-pi/pi-tui";
import type { KeyId } from "@oh-my-pi/pi-tui";
import * as zod from "zod/v4";
// Node-safe pure core + tool registration (no pi-ai/pi-tui value import) — safe to import statically.
import { performSelect, registerAskTools } from "../src/ask";
// Type-only import: erased by Bun's transpiler, so this file still COLLECTS before src/ask-ui/ exists.
import type { SideChatTurn } from "../src/ask-ui/types";

// ── Contract types — mirror of the v2 canon (local://ask-ui-wiring-contract-v2.md). Local interfaces
//    avoid `any`; the shapes here ARE the contract the leaves must satisfy. ────────────────────────
interface SideChatMessage {
	role: string;
	content: string;
}
interface SideChatRequest {
	systemPrompt: string; // non-blank no-tools reminder; NO tools field — adapter passes none to pi-ai
	messages: SideChatMessage[];
	model: string;
	sessionId: string;
	promptCacheKey: string;
	cacheRetention: "none" | "short" | "long"; // v2 §4: the pi-ai CacheRetention union (v1's string/"5m" is dead)
}
interface SideChatUsage {
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
}
interface SideChatResult {
	text: string;
	status: "complete" | "aborted" | "error";
	error?: string;
	usage?: SideChatUsage;
}
interface CompletionPort {
	run(request: SideChatRequest, opts: { signal: AbortSignal; onDelta?: (chunk: string) => void }): Promise<SideChatResult>;
}
// v2 §2 result unions (N13 SSOT): free text rides `freeText` for select/confirm, `response` for ask.
type SelectResult = { kind: "answer"; selections: string[]; freeText?: string; sideChat?: SideChatTurn[] } | { kind: "cancel" };
type ConfirmResult = { kind: "answer"; confirmed: boolean | null; freeText?: string; sideChat?: SideChatTurn[] } | { kind: "cancel" };
type AskResult = { kind: "answer"; response: string; sideChat?: SideChatTurn[] } | { kind: "cancel" };
interface ExtensionUiComponent {
	render(): unknown;
	handleInput?(data: string): void;
	dispose?(): void;
}
// The SDK-pinned custom<T> factory signature (extensions/types.ts:271-279).
type CustomFactoryFn<T> = (tui: unknown, theme: unknown, keybindings: unknown, done: (result: T) => void) => ExtensionUiComponent | Promise<ExtensionUiComponent>;
type SelectParams = { question: string; options: { label: string; description: string }[]; multi?: boolean; recommended?: number };
type ConfirmParams = { question: string };
type AskParams = { question: string; prefill?: string };
interface AskRuntime {
	buildSelect(params: SelectParams): CustomFactoryFn<SelectResult>;
	buildConfirm(params: ConfirmParams): CustomFactoryFn<ConfirmResult>;
	buildAsk(params: AskParams): CustomFactoryFn<AskResult>;
}
type AskRuntimeBinder = (ctx: unknown) => AskRuntime;
interface AskUiIndexModule {
	createAskRuntimeFactory(pi: unknown): AskRuntimeBinder;
}
interface CompletionModule {
	createCompletionPort(ctx: unknown): CompletionPort;
}
interface CapturedTool {
	name: string;
	execute: (toolCallId: string, params: unknown, signal: AbortSignal, onUpdate: unknown, ctx: unknown) => Promise<{ isError: boolean; content: readonly { text?: string }[] }>;
}
// The pi-ai Context / StreamOptions the adapter builds, as captured by the mock. Named so B2 reads
// through a typed value (not an inline cast-into-access); the cast lives once, on the capture.
interface CapturedContext {
	systemPrompt?: unknown;
	messages?: { role: string; content: unknown }[];
	tools?: unknown;
}
interface CapturedOptions {
	apiKey?: unknown;
	signal?: unknown;
	sessionId?: unknown;
	promptCacheKey?: unknown;
	cacheRetention?: unknown;
}

const SAMPLE_SELECT: SelectParams = {
	question: "Which option?",
	options: [
		{ label: "Alpha", description: "the first choice" },
		{ label: "Beta", description: "the second choice" },
	],
};

// ── Raw terminal key sequences, VERIFIED against the real pi-tui matchesKey (probed live during
//    authoring). Legacy = the universal escape codes; Kitty = the CSI-u forms that DIFFER from legacy
//    and match under kitty protocol (arrows/PgUp/PgDn keep legacy CSI even under kitty, so only these
//    six have a distinct CSI-u encoding). Keys are pi-tui KeyId values. ───────────────────────────
const LEGACY: Record<string, string> = {
	escape: "\x1b",
	enter: "\r",
	up: "\x1b[A",
	down: "\x1b[B",
	pageUp: "\x1b[5~",
	pageDown: "\x1b[6~",
	space: " ",
	"?": "?",
	t: "t",
	"/": "/",
};
const KITTY: Record<string, string> = {
	escape: "\x1b[27u",
	enter: "\x1b[13u",
	space: "\x1b[32u",
	"?": "\x1b[63u",
	t: "\x1b[116u",
	"/": "\x1b[47u",
};

// ── pi-ai NETWORK MOCK. Mock ONLY the two network entry points (`stream` + `completeSimple`) at
//    module scope, BEFORE any dynamic import of the leaves, capturing every call's (model, context,
//    options) so B2 can assert what the adapter forwards, and resolving `completionStarted` so the
//    ?/t routing tests await the REAL "a side completion was issued" signal (never a timer). Every
//    other export (incl. AssistantMessageEventStream) stays the real value, so the [C12] "pi-ai loads
//    under Bun" boundary is genuinely exercised. There is deliberately NO `resolver` override: the
//    side-chat api key comes from ctx.modelRegistry.resolver (the typed ctx fake), NOT a pi-ai
//    top-level export — the old mock's pi-ai `resolver` was itself API-misuse the universal Proxy hid.
interface AiCall {
	model: unknown;
	context: unknown;
	options: unknown;
}
const streamCalls: AiCall[] = [];
const completeSimpleCalls: AiCall[] = [];
const completionCalls = (): number => streamCalls.length + completeSimpleCalls.length;
const B2_DELTAS = ["Hel", "lo, ", "wor", "ld"];
const B2_TEXT = B2_DELTAS.join("");

function finalMessageWith(opts: { text?: string; stopReason?: StopReason; errorMessage?: string; usage?: Partial<Usage> }): AssistantMessage {
	const usage = {
		input: 10,
		output: 5,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 15,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...(opts.usage ?? {}),
	};
	// Boundary cast: a minimal terminal message; the adapter reads text/usage/stopReason/errorMessage.
	return {
		role: "assistant",
		content: opts.text === "" ? [] : [{ type: "text", text: opts.text ?? B2_TEXT }],
		api: "anthropic",
		provider: "acme",
		model: "acme/side-model",
		usage,
		stopReason: opts.stopReason ?? "stop",
		errorMessage: opts.errorMessage,
		timestamp: Date.now(),
	} as unknown as AssistantMessage;
}

// A completed stream: streams `deltas` then a terminal `done` event carrying `final` (real pi-ai
// emits `done`; result() also settles). The adapter may read the terminal via either path.
function doneStream(final: AssistantMessage, deltas: string[] = B2_DELTAS): AssistantMessageEventStream {
	const s = new actualPiAi.AssistantMessageEventStream();
	for (const delta of deltas) s.push({ type: "text_delta", contentIndex: 0, delta, partial: final } as AssistantMessageEvent);
	s.push({ type: "done", reason: final.stopReason, message: final } as AssistantMessageEvent);
	return s;
}
// A provider terminal error: pi-ai emits an `error` event carrying an AssistantMessage whose
// stopReason is "error" (resolved, NOT thrown — v2 §4 error dualism, provider side).
function errorStream(message: string): AssistantMessageEventStream {
	const s = new actualPiAi.AssistantMessageEventStream();
	s.push({ type: "error", error: finalMessageWith({ stopReason: "error", errorMessage: message, text: "" }) } as AssistantMessageEvent);
	return s;
}
// A stream that throws mid-iteration (resolver reject / iterator throw — the run() should reject).
function throwingStream(err: unknown): AssistantMessageEventStream {
	const s = new actualPiAi.AssistantMessageEventStream();
	s.push({ type: "text_delta", contentIndex: 0, delta: "par", partial: finalMessageWith({}) } as AssistantMessageEvent);
	s.fail(err);
	return s;
}

// Per-test stream behavior (default: the happy scripted deltas). B2 error/aborted/throw tests
// reassign this in their body; beforeEach resets it. `completionStarted` resolves the first time
// the adapter issues a side completion — the deterministic signal the ?/t routing tests await.
let nextStream: () => AssistantMessageEventStream = () => doneStream(finalMessageWith({}));
let completionStarted = Promise.withResolvers<void>();

mock.module("@oh-my-pi/pi-ai", () => {
	return {
		...actualPiAi,
		// O1 regression trap (audit-1 RF4): raw `stream` never resolves an ApiKeyResolver — the exact
		// live crash class the O1 spike proved. The adapter MUST stay on the resolver-aware
		// `streamSimple`; any regression back to raw `stream` now fails the suite loudly instead of
		// staying green through a shared capture array (the hollow-pin defect audit-1 Major 1 flagged).
		stream: () => {
			throw new TypeError("key.includes is not a function (simulated — O1 ①: raw stream never resolves an ApiKeyResolver)");
		},
		completeSimple: async (model: unknown, context: unknown, options: unknown) => {
			completeSimpleCalls.push({ model, context, options });
			completionStarted.resolve();
			return await nextStream().result();
		},
		// O1 live evidence (audit-0 RF3, appendix-live-spike.md): raw `stream` never resolves an
		// ApiKeyResolver — the resolver-aware entry point is streamSimple, so the adapter MUST use it
		// and the mock intercepts it as the third network entry (same capture array: every existing
		// B2 forwarding assertion applies unchanged at the streamSimple boundary, where forwarding the
		// resolver BY IDENTITY is the correct contract).
		streamSimple: (model: unknown, context: unknown, options: unknown) => {
			streamCalls.push({ model, context, options });
			completionStarted.resolve();
			return nextStream();
		},
		// Boundary cast: a test double for pi-ai's three network entry points; all else is real.
	} as unknown as typeof actualPiAi;
});

// ── TYPED host / execution fakes (NOT a Proxy) ───────────────────────────────────────────────────
const SIDE_KEY_SENTINEL = "SIDE-CHAT-API-KEY";
// A stable ApiKeyResolver so B2 can assert the adapter forwarded THIS resolver as apiKey by identity.
const SIDE_KEY_RESOLVER = () => SIDE_KEY_SENTINEL;
const SIDE_MODEL = { provider: "acme", baseUrl: undefined, id: "acme/side-model" };

interface CtxCaps {
	resolverCalls: { model: unknown; sessionId: string | undefined }[];
	branchCalls: number;
	systemPromptCalls: number;
}

// The invocation-bound execution context surface the side completion needs (v2 §1 AskExecutionContext
// members) plus `ui` for the tool-wrapper path. Every field is the real shape core exposes at ctx —
// models query facade, modelRegistry.resolver, read-only sessionManager, getSystemPrompt.
function createFakeCtx(ui: unknown): { ctx: unknown; model: typeof SIDE_MODEL; caps: CtxCaps } {
	const caps: CtxCaps = { resolverCalls: [], branchCalls: 0, systemPromptCalls: 0 };
	const ctx = {
		hasUI: true,
		cwd: "/tmp/lsc-adapter-fake",
		ui,
		model: SIDE_MODEL,
		models: {
			list: () => [SIDE_MODEL],
			current: () => SIDE_MODEL,
			resolve: (_spec: string) => SIDE_MODEL,
			family: () => "acme-family",
		},
		modelRegistry: {
			resolver: (model: unknown, sessionId?: string) => {
				caps.resolverCalls.push({ model, sessionId });
				return SIDE_KEY_RESOLVER;
			},
		},
		sessionManager: {
			getSessionId: () => "main-session-1",
			getBranch: () => {
				caps.branchCalls += 1;
				return [];
			},
		},
		getSystemPrompt: () => {
			caps.systemPromptCalls += 1;
			return ["main system prompt line"];
		},
	};
	return { ctx, model: SIDE_MODEL, caps };
}

// A minimal registration-time ExtensionAPI: real zod (tool schemas build against it) + the surface
// main.ts's registrations touch at registration time. `onTool` captures registered tools (the
// production-assembly discriminator). Not a Proxy — an explicit, bounded harness.
function makeFakePi(onTool?: (def: CapturedTool) => void): unknown {
	return {
		zod,
		getFlag: () => undefined,
		registerFlag: () => {},
		registerTool: (def: CapturedTool) => {
			onTool?.(def);
		},
		registerCommand: () => {},
		registerShortcut: () => {},
		on: () => {},
		setModel: () => {},
		setThinkingLevel: () => {},
		sendUserMessage: () => {},
		exec: () => {},
		pi: { settings: {} },
	};
}

// Host-opaque render surface (pi-tui TUI + Theme + KeybindingsManager) the custom<T> factory
// receives. See the header note: this carries NO completion contract (that is typed + captured),
// so a permissive double here hides no adapter misuse. `then` stays undefined so awaiting never
// hangs; `isLight` is a boolean because Theme.isLight is a property.
function renderSurface(): unknown {
	return new Proxy(
		function renderStub(...args: unknown[]): unknown {
			return typeof args[0] === "string" ? args[0] : "";
		},
		{
			get(_target, prop) {
				if (prop === "then") return undefined;
				if (prop === "isLight") return false;
				return renderSurface();
			},
		},
	);
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let out = "";
	for (const part of content) {
		// Narrow (no cast): after `"text" in part` TypeScript infers `part.text: unknown`, then the
		// typeof guard proves the string before we read it.
		if (part && typeof part === "object" && "text" in part && typeof part.text === "string") out += part.text;
	}
	return out;
}

// Mount a select component from a bound runtime and expose a done()-settled result + a key feeder.
interface Mounted {
	component: ExtensionUiComponent;
	result: Promise<SelectResult>;
	doneCount: () => number;
	feed: (seq: string) => void;
}
async function mountSelect(runtime: AskRuntime, params: SelectParams): Promise<Mounted> {
	const { promise, resolve } = Promise.withResolvers<SelectResult>();
	let doneCount = 0;
	const done = (result: SelectResult) => {
		doneCount += 1;
		resolve(result);
	};
	const component = await runtime.buildSelect(params)(renderSurface(), renderSurface(), renderSurface(), done);
	component.render();
	return { component, result: promise, doneCount: () => doneCount, feed: seq => component.handleInput?.(seq) };
}
async function freshRuntime(): Promise<{ runtime: AskRuntime; caps: CtxCaps }> {
	// Dynamic import (module-loading-boundary exception): the Bun-only leaf does not exist at author
	// time (pre-craft RED) and must not be static-imported before the module-scope pi-ai mock installs.
	const indexMod = (await import("../src/ask-ui/index")) as unknown as AskUiIndexModule;
	expect(typeof indexMod.createAskRuntimeFactory).toBe("function");
	const binder = indexMod.createAskRuntimeFactory(makeFakePi());
	expect(typeof binder).toBe("function");
	const { ctx, caps } = createFakeCtx(undefined);
	return { runtime: binder(ctx), caps };
}

let savedFixtureEnv: string | undefined;
beforeEach(() => {
	streamCalls.length = 0;
	completeSimpleCalls.length = 0;
	nextStream = () => doneStream(finalMessageWith({}));
	completionStarted = Promise.withResolvers<void>();
	// N9: block an ambient LSC_FIXTURE from routing the registered execute onto the fixture channel.
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
});
afterEach(() => {
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	setKittyProtocolActive(false);
});
afterAll(() => {
	mock.restore();
});

describe("ask-ui Bun adapter (B1-B3 + U7 + production assembly)", () => {
	// ── B1 — index.ts: real import → binder(ctx) → AskRuntime → custom<T> factory → mount → done ──
	it("B1 — createAskRuntimeFactory loads under Bun, its binder builds an AskRuntime, and a mounted select reaches done() on a terminal Esc", async () => {
		const { runtime } = await freshRuntime();
		expect(typeof runtime.buildSelect).toBe("function");
		expect(typeof runtime.buildConfirm).toBe("function");
		expect(typeof runtime.buildAsk).toBe("function");

		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		expect(() => mounted.component.render()).not.toThrow();
		expect(typeof mounted.component.handleInput).toBe("function");
		// A browse-mode Esc drives the mount to its terminal cancel; await the real done signal.
		mounted.feed(LEGACY.escape);
		const result = await mounted.result;
		expect(mounted.doneCount()).toBe(1);
		expect(result).toEqual({ kind: "cancel" });
	});

	// ── U7 — physical key dispatch. Positive control (real pi-tui, GREEN NOW) proves the raw byte
	//    vocabulary; the routing tests (RED until the leaf exists) prove the component wires those raw
	//    bytes to intents. ─────────────────────────────────────────────────────────────────────────
	it("U7 positive-control (legacy): every raw legacy sequence matches its KeyId via the real pi-tui matchesKey", () => {
		for (const [keyId, seq] of Object.entries(LEGACY)) {
			expect(matchesKey(seq, keyId as KeyId), `legacy ${JSON.stringify(seq)} should match KeyId ${keyId}`).toBe(true);
		}
		// Disambiguation: the browse command keys are NOT special keys (the component must route them
		// as printables, not as enter/up), so the browse submode is unambiguous.
		expect(matchesKey(LEGACY["?"], "enter" as KeyId)).toBe(false);
		expect(matchesKey(LEGACY.t, "up" as KeyId)).toBe(false);
		expect(matchesKey(LEGACY["/"], "down" as KeyId)).toBe(false);
	});

	it("U7 positive-control (Kitty): every raw CSI-u sequence matches its KeyId under kitty protocol, and differs from legacy", () => {
		setKittyProtocolActive(true);
		try {
			expect(isKittyProtocolActive()).toBe(true);
			for (const [keyId, seq] of Object.entries(KITTY)) {
				expect(matchesKey(seq, keyId as KeyId), `kitty ${JSON.stringify(seq)} should match KeyId ${keyId}`).toBe(true);
				expect(seq, `kitty encoding for ${keyId} must differ from legacy`).not.toBe(LEGACY[keyId]);
			}
		} finally {
			setKittyProtocolActive(false);
		}
	});

	it("U7 routing (legacy): Enter commits the focused option, Down moves focus, Esc cancels", async () => {
		const { runtime } = await freshRuntime();

		// Baseline: initial focus is option 0 (recommended ?? 0), Enter commits it.
		const base = await mountSelect(runtime, SAMPLE_SELECT);
		base.feed(LEGACY.enter);
		expect(await base.result).toEqual({ kind: "answer", selections: ["Alpha"] });

		// Down moves focus to option 1, THEN Enter commits the moved-to option — proving `down` routed.
		const moved = await mountSelect(runtime, SAMPLE_SELECT);
		moved.feed(LEGACY.down);
		moved.feed(LEGACY.enter);
		expect(await moved.result).toEqual({ kind: "answer", selections: ["Beta"] });

		// Esc from browse cancels.
		const cancelled = await mountSelect(runtime, SAMPLE_SELECT);
		cancelled.feed(LEGACY.escape);
		expect(await cancelled.result).toEqual({ kind: "cancel" });
	});

	it("U7 routing (legacy): ? opens a one-button side completion (mocked pi-ai stream invoked)", async () => {
		const { runtime, caps } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		expect(completionCalls()).toBe(0);
		mounted.feed(LEGACY["?"]);
		// Await the REAL "side completion issued" signal (resolved by the mocked stream), not a timer.
		await completionStarted.promise;
		expect(completionCalls()).toBeGreaterThan(0);
		// The one-button detail issued the completion through the bound ctx: the resolver was consulted
		// and getBranch snapshotted history exactly once (cache-lifetime canon, plan §PR3).
		expect(caps.resolverCalls.length).toBeGreaterThan(0);
		expect(caps.branchCalls).toBe(1);
	});

	it("U7 routing (legacy): t enters free-prompt chat and a sent prompt drives a side completion", async () => {
		const { runtime } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		mounted.feed(LEGACY.t); // enter chat editor
		for (const ch of "why") mounted.feed(ch); // type a free prompt
		mounted.feed(LEGACY.enter); // send it
		await completionStarted.promise;
		expect(completionCalls()).toBeGreaterThan(0);
	});

	it("U7 routing (legacy): / enters fuzzy search and commits the filtered option by original index", async () => {
		const { runtime } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		mounted.feed(LEGACY["/"]); // enter search submode
		for (const ch of "Be") mounted.feed(ch); // filter down to "Beta"
		mounted.feed(LEGACY.enter); // commit the sole filtered match
		expect(await mounted.result).toEqual({ kind: "answer", selections: ["Beta"] });
	});

	it("U7 routing (legacy, multi): Space toggles a check, committed via the Done control row (cursor domain n+1)", async () => {
		const { runtime } = await freshRuntime();
		// cursor domain (v2 §3, Main ruling): -1 header, 0..1 options, 2 Other, 3 Done (checked>0).
		const mounted = await mountSelect(runtime, { ...SAMPLE_SELECT, multi: true });
		mounted.feed(LEGACY.space); // toggle-check option 0 (Alpha); Done row now exists at cursor 3
		// multi option Enter = toggle (NOT commit) — commit is Done Enter only, so navigate to Done:
		mounted.feed(LEGACY.down); // → Beta (1)
		mounted.feed(LEGACY.down); // → Other (2)
		mounted.feed(LEGACY.down); // → Done (3)
		mounted.feed(LEGACY.enter); // Done Enter = commit the checked set
		expect(await mounted.result).toEqual({ kind: "answer", selections: ["Alpha"] });
	});

	it("U7 routing (legacy): PgUp/PgDn are consumed as non-terminal scroll keys (a later Enter still commits)", async () => {
		const { runtime } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		mounted.feed(LEGACY.pageDown);
		mounted.feed(LEGACY.pageUp);
		// Scroll keys must NOT terminate the mount (no premature done)…
		expect(mounted.doneCount()).toBe(0);
		// …and a subsequent Enter still commits the focused option.
		mounted.feed(LEGACY.enter);
		expect(await mounted.result).toEqual({ kind: "answer", selections: ["Alpha"] });
	});

	it("U7 routing (Kitty): CSI-u terminal + command keys drive the same intents (Esc→cancel, Enter→commit, ?→completion)", async () => {
		const { runtime } = await freshRuntime();
		setKittyProtocolActive(true);
		try {
			const cancelled = await mountSelect(runtime, SAMPLE_SELECT);
			cancelled.feed(KITTY.escape);
			expect(await cancelled.result).toEqual({ kind: "cancel" });

			const committed = await mountSelect(runtime, SAMPLE_SELECT);
			committed.feed(KITTY.enter);
			expect(await committed.result).toEqual({ kind: "answer", selections: ["Alpha"] });

			const detailed = await mountSelect(runtime, SAMPLE_SELECT);
			detailed.feed(KITTY["?"]);
			await completionStarted.promise;
			expect(completionCalls()).toBeGreaterThan(0);
		} finally {
			setKittyProtocolActive(false);
		}
	});

	// ── B2 — completion.ts: TYPED fake + call-arg capture verify createCompletionPort forwards the
	//    real request shape to pi-ai and maps the terminal state + usage. ────────────────────────────
	it("B2 — createCompletionPort streams text_delta and forwards model/{systemPrompt:[...]}/messages/no-tools/resolver/signal/sessionId/promptCacheKey/cacheRetention to pi-ai streamSimple (resolver-aware — O1: raw stream never resolves an ApiKeyResolver)", async () => {
		// Dynamic import (module-loading-boundary exception): Bun-only leaf, absent at author time,
		// and must load AFTER the pi-ai mock is installed.
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule;
		expect(typeof completionMod.createCompletionPort).toBe("function");
		const { ctx, model, caps } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);

		const request: SideChatRequest = {
			systemPrompt: "You have NO tools. Explain directly.",
			messages: [{ role: "user", content: "Explain option Alpha." }],
			model: "acme/side-model",
			sessionId: "main-session-1:side:nonce-1",
			promptCacheKey: "main-session-1",
			cacheRetention: "short",
		};
		const signal = new AbortController().signal;
		const chunks: string[] = [];
		const result = await port.run(request, { signal, onDelta: chunk => chunks.push(chunk) });

		// Streaming path + terminal state.
		expect(chunks.join("")).toBe(B2_TEXT);
		expect(result.text).toBe(B2_TEXT);
		expect(result.status).toBe("complete");

		// Exactly one pi-ai stream call, with the forwarded arguments.
		expect(streamCalls.length).toBe(1);
		expect(streamCalls[0].model).toBe(model); // the resolved Model object, not the raw string
		// Reason: the mock captured the pi-ai Context/StreamOptions the adapter constructed.
		const context = streamCalls[0].context as CapturedContext;
		const options = streamCalls[0].options as CapturedOptions;
		// {systemPrompt:[...]} array form, carrying the request's non-blank prompt.
		expect(Array.isArray(context.systemPrompt) && context.systemPrompt.join("\n").includes(request.systemPrompt)).toBe(true);
		// converted messages: role + text preserved.
		expect(context.messages?.length).toBe(request.messages.length);
		expect(context.messages?.[0].role).toBe("user");
		expect(textOf(context.messages?.[0].content)).toContain("Explain option Alpha.");
		// no-tools: the adapter passes no tools to the pi-ai stream.
		expect(context.tools).toBeUndefined();
		// apiKey is the value ctx.modelRegistry.resolver(model, sessionId) returned, forwarded BY
		// IDENTITY (not eagerly called) so the SDK can re-invoke it for credential rotation.
		expect(options.apiKey).toBe(SIDE_KEY_RESOLVER);
		expect(options.signal).toBe(signal);
		expect(options.sessionId).toBe(request.sessionId);
		expect(options.promptCacheKey).toBe(request.promptCacheKey);
		expect(options.cacheRetention).toBe("short");

		// resolver consulted once with (resolved model, side sessionId).
		expect(caps.resolverCalls.length).toBe(1);
		expect(caps.resolverCalls[0].model).toBe(model);
		expect(caps.resolverCalls[0].sessionId).toBe(request.sessionId);
	});

	it("B2 — cacheRetention:'long' is forwarded verbatim", async () => {
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule; // module-loading-boundary exception
		const { ctx } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);
		await port.run(
			{ systemPrompt: "no tools", messages: [{ role: "user", content: "q" }], model: "acme/side-model", sessionId: "main-session-1:side:n2", promptCacheKey: "main-session-1", cacheRetention: "long" },
			{ signal: new AbortController().signal },
		);
		expect(streamCalls.length).toBe(1);
		const options = streamCalls[0].options as CapturedOptions;
		expect(options.cacheRetention).toBe("long");
	});

	it("B2 — provider usage (cacheRead/cacheWrite) maps to SideChatResult.usage (cacheReadInputTokens/cacheCreationInputTokens)", async () => {
		nextStream = () => doneStream(finalMessageWith({ usage: { cacheRead: 42, cacheWrite: 7 } }));
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule; // module-loading-boundary exception
		const { ctx } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);
		const result = await port.run(
			{ systemPrompt: "no tools", messages: [{ role: "user", content: "q" }], model: "acme/side-model", sessionId: "main-session-1:side:n3", promptCacheKey: "main-session-1", cacheRetention: "short" },
			{ signal: new AbortController().signal },
		);
		expect(result.status).toBe("complete");
		expect(result.usage?.cacheReadInputTokens).toBe(42);
		expect(result.usage?.cacheCreationInputTokens).toBe(7);
	});

	it("B2 — a provider terminal error resolves to {status:'error'} (not a throw) with secrets redacted from the stored error, aborted maps to {status:'aborted'}", async () => {
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule; // module-loading-boundary exception
		const { ctx } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);
		const req: SideChatRequest = { systemPrompt: "no tools", messages: [{ role: "user", content: "q" }], model: "acme/side-model", sessionId: "main-session-1:side:n4", promptCacheKey: "main-session-1", cacheRetention: "short" };

		// Inject a provider error carrying real secret shapes (a Bearer token + an sk- key) alongside
		// non-secret diagnostic context — pins v2 §4: the error is stored only AFTER redactSecrets.
		const bearerSecret = "abcdef1234567890ABCDEF";
		const skSecret = "sk-ant-api03-SECRETKEYVALUE0987654321";
		nextStream = () => errorStream(`provider returned HTTP 500 upstream auth rejected — Authorization: Bearer ${bearerSecret}; token ${skSecret}`);
		const errored = await port.run(req, { signal: new AbortController().signal });
		expect(errored.status).toBe("error");
		expect(typeof errored.error).toBe("string");
		// v2 §4: stored only after redactSecrets — the injected Bearer token and sk- key must be absent.
		expect(errored.error).not.toContain(bearerSecret);
		expect(errored.error).not.toContain(skSecret);
		// ...while the non-secret diagnostic context survives so the error stays actionable.
		expect(errored.error).toContain("HTTP 500");
		expect(errored.error).toContain("upstream auth rejected");

		nextStream = () => doneStream(finalMessageWith({ stopReason: "aborted", text: "par" }), ["par"]);
		const aborted = await port.run(req, { signal: new AbortController().signal });
		expect(aborted.status).toBe("aborted");
	});

	it("B2 — an iterator throw (resolver reject class) rejects run() (terminal state via normalizeSideError downstream)", async () => {
		nextStream = () => throwingStream(new Error("stream blew up"));
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule; // module-loading-boundary exception
		const { ctx } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);
		await expect(
			port.run(
				{ systemPrompt: "no tools", messages: [{ role: "user", content: "q" }], model: "acme/side-model", sessionId: "main-session-1:side:n5", promptCacheKey: "main-session-1", cacheRetention: "short" },
				{ signal: new AbortController().signal },
			),
		).rejects.toThrow();
	});

	it("B2 — assistant history is forwarded as a CONTENT-BLOCK array (O1 live evidence: pi-ai redaction requires assistant blocks; a bare string crashes content.map)", async () => {
		const completionMod = (await import("../src/ask-ui/completion")) as unknown as CompletionModule; // module-loading-boundary exception
		const { ctx } = createFakeCtx(undefined);
		const port = completionMod.createCompletionPort(ctx);
		await port.run(
			{
				systemPrompt: "no tools",
				messages: [
					{ role: "user", content: "Explain option Alpha." },
					{ role: "assistant", content: "Alpha means the first choice." },
					{ role: "user", content: "And versus Beta?" },
				],
				model: "acme/side-model",
				sessionId: "main-session-1:side:n6",
				promptCacheKey: "main-session-1",
				cacheRetention: "short",
			},
			{ signal: new AbortController().signal },
		);
		expect(streamCalls.length).toBe(1);
		const context = streamCalls[0].context as CapturedContext;
		const assistant = context.messages?.[1];
		expect(assistant?.role).toBe("assistant");
		// The assistant arm MUST be a block array — pi-ai's unconditional redaction pass has no string
		// guard for assistant content (transform-messages), so a bare string crashes live.
		expect(Array.isArray(assistant?.content)).toBe(true);
		const blocks = assistant?.content as Array<{ type?: string; text?: string }>;
		expect(blocks.some(b => b.type === "text" && (b.text ?? "").includes("Alpha means the first choice."))).toBe(true);
		// User text still reaches the provider intact (string or blocks — the carrier is free).
		expect(textOf(context.messages?.[0].content)).toContain("Explain option Alpha.");
	});

	// ── PRODUCTION ASSEMBLY DISCRIMINATOR (critic bar ②) — the ONE test that catches "main.ts forgot
	//    to inject the binder". Register the ACTUAL plugin default export, capture lsc_select, drive its
	//    execute on the UI channel, and observe binder(ctx) → custom → raw ? → mocked pi-ai → panel
	//    close → final answer. If main only calls registerAskTools(pi) (no binder), the UI path falls to
	//    legacy ctx.ui.select and customCalls stays 0 → this fails. ────────────────────────────────────
	it("production assembly — main default wires the binder so lsc_select's UI-channel execute reaches custom → ? → completion → Enter → final answer", async () => {
		// Dynamic import (module-loading-boundary exception): src/main must load AFTER the module-scope
		// pi-ai mock installs; a hoisted static import would bind the real network module via the leaf.
		const mainModule = await import("../src/main");
		// The plugin entry accepts an ExtensionAPI; we drive it with a typed registration fake.
		const plugin = mainModule.default as (pi: unknown) => void;
		const capturedTools = new Map<string, CapturedTool>();
		plugin(makeFakePi(def => capturedTools.set(def.name, def)));
		const selectTool = capturedTools.get("lsc_select");
		expect(selectTool, "main default must register an lsc_select tool").toBeDefined();
		if (!selectTool) return;

		let customCalls = 0;
		let selectCalls = 0;
		const ui = {
			// The UI channel mounts the custom<T> factory. Drive: ? (one-button detail) → await the
			// completion signal (delta render) → Esc (panel close) → Enter (commit focused option), then
			// resolve the custom promise with the component's done value.
			custom: async (factory: CustomFactoryFn<SelectResult>) => {
				customCalls += 1;
				const { promise, resolve } = Promise.withResolvers<SelectResult>();
				const component = await factory(renderSurface(), renderSurface(), renderSurface(), resolve);
				component.render();
				component.handleInput?.(LEGACY["?"]);
				await completionStarted.promise;
				component.handleInput?.(LEGACY.escape); // close the detail panel back to the list
				component.handleInput?.(LEGACY.enter); // commit the focused option
				return promise;
			},
			select: async () => {
				selectCalls += 1;
				return "Alpha";
			},
			editor: async () => undefined,
		};
		const { ctx } = createFakeCtx(ui);
		const result = await selectTool.execute("call-assembly", SAMPLE_SELECT, new AbortController().signal, () => {}, ctx);

		// The binder path was taken (custom reached), NOT the legacy select fallback.
		expect(customCalls, "UI-channel execute must reach ctx.ui.custom via the injected binder — main.ts must pass createAskRuntimeFactory(pi) to registerAskTools").toBe(1);
		expect(selectCalls, "legacy ctx.ui.select must NOT run on the UI channel when the binder is wired").toBe(0);
		// The raw ? drove a real (mocked) side completion end-to-end.
		expect(completionCalls(), "raw ? must issue a side completion through the bound ctx").toBeGreaterThan(0);
		// The final answer surfaced through the standard envelope.
		expect(result.isError).toBe(false);
		expect(textOf(result.content)).toContain("User selected: Alpha");
	});

	// ── B3 — fallback: a UI host whose ctx.ui.custom EXISTS but resolves undefined (factory never
	//    started) is the ONE condition plan §PR2 allows to fall back to the legacy select path. Driven
	//    through the v2 binder (binder(ctx) → runtime → performX 4th arg). ─────────────────────────────
	it("B3 — a custom() that resolves undefined falls back to the legacy select path (v2 binder wiring)", async () => {
		// Dynamic import (module-loading-boundary exception): Bun-only leaf, absent at author time.
		const indexMod = (await import("../src/ask-ui/index")) as unknown as AskUiIndexModule;
		expect(typeof indexMod.createAskRuntimeFactory).toBe("function");
		const binder = indexMod.createAskRuntimeFactory(makeFakePi());

		let customCalls = 0;
		let selectCalls = 0;
		const ui = {
			custom: async () => {
				customCalls += 1;
				return undefined; // factory never started → the sole fallback-eligible condition
			},
			select: async () => {
				selectCalls += 1;
				return "Alpha";
			},
			editor: async () => undefined,
		};
		const { ctx } = createFakeCtx(ui);
		const runtime = binder(ctx);

		// performX's 4th arg is the bound runtime (v2 §1). The variadic cast bridges performSelect's
		// still-3-arg pre-PR2 type to the confirmed 4-arg shape (an evolving-signature seam, not input).
		const callPerformSelect = performSelect as unknown as (channel: unknown, ui: unknown, params: unknown, runtime?: unknown) => Promise<{ isError: boolean; content: readonly { text?: string }[] }>;
		const result = await callPerformSelect({ kind: "ui" }, ui, SAMPLE_SELECT, runtime);

		expect(customCalls).toBe(1); // custom was attempted first
		expect(selectCalls).toBe(1); // then the legacy select ran (fallback)
		expect(result.isError).toBe(false);
		expect(textOf(result.content)).toContain("User selected: Alpha");
	});
});

// ── audit-0 RF1/RF2 canon amendment (cycle 0, [Canon Amendment]-approved, append-only): input echo
//    and search projection END-TO-END through the REAL component (state → view-model → render).
//    Closes the gap audit-0 M1/M2 identified: reducers accumulated askDraft/chatDraft/searchQuery
//    but no rendered surface carried them, and search rendered the unfiltered list so the highlight
//    could diverge from the Enter commit target. Also exercises a real buildAsk mount (a coverage
//    hole the audit's explore pass flagged: the B-suite only typeof-checked buildAsk). ────────────
describe("ask-ui input echo & search projection (audit-0 RF1/RF2)", () => {
	const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
	const rendered = (component: ExtensionUiComponent): string => strip(((component.render() as string[]) ?? []).join("\n"));

	it("RF1 — a mounted ask component echoes typed draft text and Enter commits it", async () => {
		const { runtime } = await freshRuntime();
		const { promise, resolve } = Promise.withResolvers<AskResult>();
		const component = await runtime.buildAsk({ question: "Describe the blocker" })(renderSurface(), renderSurface(), renderSurface(), resolve);
		component.render();
		for (const ch of "hotfix") component.handleInput?.(ch);
		expect(rendered(component)).toContain("hotfix"); // the draft is visible BEFORE submit
		component.handleInput?.(LEGACY.enter);
		const result = await promise;
		expect(result).toEqual({ kind: "answer", response: "hotfix" });
	});

	it("RF2 — search echoes the query and the highlighted row is exactly the commit target", async () => {
		const { runtime } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		mounted.feed(LEGACY["/"]);
		for (const ch of "bet") mounted.feed(ch);
		const out = rendered(mounted.component);
		expect(out).toContain("bet"); // the active query is visible ("Beta" alone cannot satisfy lowercase "bet")
		expect(out).not.toContain("Alpha"); // the projection excludes non-matches
		const focusLine = ((mounted.component.render() as string[]) ?? []).map(strip).find(l => l.startsWith("\u276f")) ?? "";
		expect(focusLine).toContain("Beta"); // highlight row === the filtered focus target
		mounted.feed(LEGACY.enter); // Enter commits exactly the highlighted (filtered) option
		const result = await mounted.result;
		expect(result).toEqual({ kind: "answer", selections: ["Beta"] });
	});

	it("RF1 — the chat panel echoes the free-prompt draft being typed; closing it never settles the mount", async () => {
		const { runtime } = await freshRuntime();
		const mounted = await mountSelect(runtime, SAMPLE_SELECT);
		mounted.feed(LEGACY.t); // open free-prompt chat on the focused option (editor focused, no auto turn)
		for (const ch of "why") mounted.feed(ch);
		expect(rendered(mounted.component)).toContain("why");
		mounted.feed(LEGACY.escape); // blur the chat editor
		mounted.feed(LEGACY.escape); // close the panel back to the list — the question survives
		expect(mounted.doneCount()).toBe(0);
	});
});
