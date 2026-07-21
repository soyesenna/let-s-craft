// I6 — fixture mode never exposes the side-chat affordance (appendix-test-plan §Integration I6; AC2.2).
//
// Mirrors local://ask-ui-wiring-contract-v2.md §1: registerAskTools(pi, binder?) where
// binder = (ctx: AskExecutionContext) => AskRuntime. The wrapper binds ctx and calls
// performX(channel, ui, params, runtime?) ONLY on the UI channel; on the fixture/unavailable
// channel the binder itself is never called — "fixture 경로에서 binder·custom factory·
// CompletionPort 호출 수 모두 0" (v2 §1 + plan §Guardrails + PR3 destructive/fixture parity).
// The scripted answer is byte-identical to today and carries no details.sideChat.
//
// The seam: a TRIPWIRE runtime whose buildX returns a custom<T> factory fn that (when mounted)
// drives a CompletionPort — every hop bumps a counter — plus a `binder` that returns that runtime
// and counts its own invocation. A positive-control test proves the tripwire is not vacuous; the
// fixture/unavailable tests then assert every counter (binder included) stays 0.
//
// Status:
//   GREEN — the fixture/unavailable branches ignore ctx.ui / the runtime arg entirely today, so
//     parity + the zero-call guards (binder included) pass now and guard the affordance off those
//     branches after the feature lands.
//   RED   — the discriminators ("the UI channel drives the runtime factory" / "the UI channel binds
//     and drives the runtime") fail until PR2/PR3 route the UI path through binder → performX's
//     runtime arg → runtime.buildSelect + ctx.ui.custom.
//
// Env hygiene (critic N9): channelFor → detectFixturePath reads process.env.LSC_FIXTURE BEFORE the
// --lsc-fixtures flag (fixtures.ts:310-311), so an ambient LSC_FIXTURE would hijack the registered
// execute's channel. beforeEach/afterEach save/clear/restore it so channel selection is decided
// solely by the getFlag mock + ctx.hasUI.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	FREE_ANSWER_SENTINEL,
	SELECTED_LINE_PREFIX,
	type AskChannel,
	type SelectUI,
	performAsk,
	performConfirm,
	performSelect,
	registerAskTools,
} from "../src/ask";
import { FixtureAnswerSet, type FixtureAnswerBody, parseFixtureAnswerFile, resetFixtureCache } from "../src/fixtures";
// Type-only imports: erased by esbuild, so the file collects before src/ask-ui/ exists.
import type { CompletionPort, SideChatRequest } from "../src/ask-ui/completion-core";
import type { AskUiResult } from "../src/ask-ui/types";

const OPTIONS = [
	{ label: "Alpha", description: "Use the alpha path." },
	{ label: "Beta", description: "Use the beta path." },
];

const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	// Isolate this suite's channel selection from any ambient LSC_FIXTURE (critic N9).
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
});

afterEach(() => {
	resetFixtureCache();
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpAnswersFile(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-ask-ui-fixture-"));
	tempDirs.push(dir);
	const path = join(dir, "answers.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}

function fixtureChannel(body: FixtureAnswerBody): AskChannel {
	const set = new FixtureAnswerSet(parseFixtureAnswerFile({ version: 2, answers: [{ match: ".*", ...body }] }, "unit-answers.json"));
	return { kind: "fixture", answers: set };
}

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
		throw new Error("expected the first tool-result content item to be text");
	}
	return first.text;
}

// A provider-ready-shaped placeholder for the (dead-in-fixture-mode) CompletionPort linkage.
const DUMMY_REQUEST = {
	systemPrompt: "you are assisting",
	messages: [],
	model: "anthropic/claude-opus-4",
	sessionId: "main:side:nonce",
	promptCacheKey: "main",
	cacheRetention: "short", // pi-ai exact union "none"|"short"|"long" (v2 §4; critic cacheRetention finding — no invented "session")
} as SideChatRequest; // structural placeholder; only ever passed to a call counter, never inspected

interface Counts {
	binder: number;
	buildSelect: number;
	buildConfirm: number;
	buildAsk: number;
	custom: number;
	completion: number;
	select: number;
	editor: number;
}

interface Spies {
	ui: SelectUI & { custom(factory: unknown, opts: { overlay?: boolean }): Promise<unknown> };
	runtime: {
		buildSelect(params: unknown): unknown;
		buildConfirm(params: unknown): unknown;
		buildAsk(params: unknown): unknown;
	};
	// v2 §1: registerAskTools takes a binder (ctx) => AskRuntime. The UI channel binds ctx once and
	// passes the bound runtime as performX's 4th arg; fixture/unavailable channels never call it.
	binder: (ctx: unknown) => Spies["runtime"];
	counts: Counts;
}

// runtime.buildX → a custom<T> factory fn that, on mount, drives the CompletionPort. ctx.ui.custom
// mounts it. Every hop increments a counter, so the fixture-mode zero-call assertions are meaningful
// (the positive-control tests drive all of them non-zero).
function makeSpies(): Spies {
	const counts: Counts = { binder: 0, buildSelect: 0, buildConfirm: 0, buildAsk: 0, custom: 0, completion: 0, select: 0, editor: 0 };
	const port: CompletionPort = {
		async run() {
			counts.completion += 1;
			return { text: "", status: "complete" };
		},
	};
	const customFactory = (_tui: unknown, _theme: unknown, _kb: unknown, done: (r: AskUiResult) => void): { render: () => unknown[] } => {
		// A real component opens a side turn through the port here; dead unless actually mounted.
		void port.run(DUMMY_REQUEST, { signal: new AbortController().signal }).then(() => done({ kind: "cancel" }));
		return { render: () => [] };
	};
	const ui = {
		async custom(factory: unknown, _opts: { overlay?: boolean }): Promise<unknown> {
			counts.custom += 1;
			if (typeof factory === "function") {
				let captured: AskUiResult | undefined;
				await factory(undefined, undefined, undefined, (r: AskUiResult) => {
					captured = r;
				});
				return captured;
			}
			return undefined;
		},
		async select() {
			counts.select += 1;
			return undefined;
		},
		async editor() {
			counts.editor += 1;
			return undefined;
		},
	};
	const runtime = {
		buildSelect(_params: unknown) {
			counts.buildSelect += 1;
			return customFactory;
		},
		buildConfirm(_params: unknown) {
			counts.buildConfirm += 1;
			return customFactory;
		},
		buildAsk(_params: unknown) {
			counts.buildAsk += 1;
			return customFactory;
		},
	};
	const binder = (_ctx: unknown): Spies["runtime"] => {
		counts.binder += 1;
		return runtime;
	};
	return { ui, runtime, binder, counts };
}

// A captured lsc_select execute, threading the (optional) binder registerAskTools(pi, binder?)
// injects. getFlag returns the fixture path only for the --lsc-fixtures flag; ctx.hasUI + the
// (env-cleared) fixture flag decide the channel, and the binder is gated on the UI channel.
type RegisteredExecute = (
	id: string,
	params: unknown,
	signal: unknown,
	onUpdate: unknown,
	ctx: { hasUI: boolean; ui: SelectUI },
) => Promise<{ content: readonly unknown[]; details?: unknown; isError?: boolean }>;

// Capture ANY of the three registered ask executes by name, threading the (optional) binder
// registerAskTools(pi, binder?) injects. getFlag returns the fixture path only for the --lsc-fixtures
// flag; ctx.hasUI + the (env-cleared) fixture flag decide the channel, and the binder is gated on the
// UI channel. Parameterized across lsc_ask/lsc_select/lsc_confirm so the binder-isolation guard covers
// every wrapper — lsc_ask is no longer exempt (architect P1 / CS7).
function captureExecute(toolName: string, opts: { binder?: unknown; fixturePath?: string }): RegisteredExecute {
	let captured: RegisteredExecute | undefined;
	const mockPi = {
		zod,
		getFlag: (name: string) => (name === "lsc-fixtures" ? opts.fixturePath : undefined),
		registerTool(definition: unknown): void {
			if (typeof definition === "object" && definition !== null && "name" in definition && definition.name === toolName && "execute" in definition && typeof definition.execute === "function") {
				captured = definition.execute as RegisteredExecute;
			}
		},
	};
	// registerAskTools(pi, binder?) — the binder is injected here; fixture/unavailable branches must ignore it.
	registerAskTools(mockPi as unknown as Parameters<typeof registerAskTools>[0], opts.binder as unknown as Parameters<typeof registerAskTools>[1]);
	if (!captured) throw new Error(`registerAskTools did not register an ${toolName} execute`);
	return captured;
}

// The three registered ask executes, each with its build-counter key, UI params, a fixture body that
// scripts a canonical answer, and the CONTENT that fixture answer produces. Drives the parameterized
// registered-execute contract below (v2 §1: bind ctx on the UI channel only).
const REGISTERED_TOOLS: ReadonlyArray<{
	tool: string;
	buildKey: "buildSelect" | "buildConfirm" | "buildAsk";
	params: Record<string, unknown>;
	fixtureBody: FixtureAnswerBody;
	fixtureText: string;
}> = [
	{ tool: "lsc_select", buildKey: "buildSelect", params: { question: "Choose", options: OPTIONS }, fixtureBody: { kind: "selection", selections: ["Beta"] }, fixtureText: `${SELECTED_LINE_PREFIX}Beta` },
	{ tool: "lsc_ask", buildKey: "buildAsk", params: { question: "Describe the fix" }, fixtureBody: { kind: "free-text", freeText: "scripted guidance" }, fixtureText: "scripted guidance" },
	{ tool: "lsc_confirm", buildKey: "buildConfirm", params: { question: "Proceed?" }, fixtureBody: { kind: "confirmation", confirm: true }, fixtureText: "yes" },
];

// ── credibility: the tripwire is not vacuous ─────────────────────────────────
describe("I6 tripwire self-check", () => {
	it("driving binder → buildSelect → ctx.ui.custom → mounted factory increments binder, factory, custom, and completion counters", async () => {
		const { ui, binder, counts } = makeSpies();
		const runtime = binder({ hasUI: true }); // binder returns the bound runtime
		const factory = runtime.buildSelect({ question: "Choose", options: OPTIONS });
		await ui.custom(factory, { overlay: true });
		expect(counts.binder).toBe(1);
		expect(counts.buildSelect).toBe(1);
		expect(counts.custom).toBe(1);
		expect(counts.completion).toBeGreaterThanOrEqual(1); // the mounted factory really drives the port
	});
});

// ── GREEN: fixture-mode parity + zero side-chat plumbing ─────────────────────
describe("I6 fixture parity — scripted answers unchanged, no side-chat plumbing touched (AC2.2)", () => {
	it("select: a scripted selection returns the current envelope + details, never touching runtime/custom/completion", async () => {
		const { ui, runtime, counts } = makeSpies();
		const result = await performSelect(fixtureChannel({ kind: "selection", selections: ["Beta"] }), ui, { question: "Choose", options: OPTIONS }, runtime);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details).toEqual({ question: "Choose", selections: ["Beta"], source: "fixture" });
		expect("sideChat" in (result.details ?? {})).toBe(false);
		expect(counts).toEqual({ binder: 0, buildSelect: 0, buildConfirm: 0, buildAsk: 0, custom: 0, completion: 0, select: 0, editor: 0 });
	});

	it("select (multi): scripted selections serialize in offered order, runtime/completion untouched", async () => {
		const { ui, runtime, counts } = makeSpies();
		const result = await performSelect(fixtureChannel({ kind: "selection", selections: ["Beta", "Alpha"] }), ui, { question: "Choose", options: OPTIONS, multi: true }, runtime);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha\n${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details?.selections).toEqual(["Alpha", "Beta"]);
		expect(counts.buildSelect).toBe(0);
		expect(counts.completion).toBe(0);
	});

	it("confirm: a scripted confirmation returns yes/no, runtime/completion untouched", async () => {
		const { ui, runtime, counts } = makeSpies();
		const result = await performConfirm(fixtureChannel({ kind: "confirmation", confirm: true }), ui, { question: "Proceed?" }, runtime);
		expect(textOf(result)).toBe("yes");
		expect(result.details).toEqual({ question: "Proceed?", confirmed: true, source: "fixture" });
		expect("sideChat" in (result.details ?? {})).toBe(false);
		expect(counts).toEqual({ binder: 0, buildSelect: 0, buildConfirm: 0, buildAsk: 0, custom: 0, completion: 0, select: 0, editor: 0 });
	});

	it("ask: a scripted free-text answer returns the response, runtime/completion untouched", async () => {
		const { ui, runtime, counts } = makeSpies();
		const result = await performAsk(fixtureChannel({ kind: "free-text", freeText: "scripted guidance" }), ui, { question: "Describe the fix" }, runtime);
		expect(result.details).toEqual({ question: "Describe the fix", response: "scripted guidance", source: "fixture" });
		expect("sideChat" in (result.details ?? {})).toBe(false);
		expect(counts).toEqual({ binder: 0, buildSelect: 0, buildConfirm: 0, buildAsk: 0, custom: 0, completion: 0, select: 0, editor: 0 });
	});

	it("select: a fixture free-text answer flows through the free channel without any runtime call", async () => {
		const { ui, runtime, counts } = makeSpies();
		const result = await performSelect(fixtureChannel({ kind: "free-text", freeText: "fixture guidance" }), ui, { question: "Choose", options: OPTIONS }, runtime);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} fixture guidance`);
		expect(counts.buildSelect).toBe(0);
		expect(counts.completion).toBe(0);
	});
});

// ── GREEN: registered execute on fixture / unavailable channels never binds the runtime ──────
describe("I6 registered execute — fixture / unavailable routing never invokes the runtime binder (v2 §1)", () => {
	for (const t of REGISTERED_TOOLS) {
		it(`${t.tool} routed to fixture via the --lsc-fixtures flag returns the scripted answer; binder never called`, async () => {
			const answersPath = tmpAnswersFile({ version: 2, answers: [{ match: ".*", ...t.fixtureBody }] });
			const { ui, binder, counts } = makeSpies();
			const execute = captureExecute(t.tool, { binder, fixturePath: answersPath });

			const result = await execute("tc", t.params, undefined, undefined, { hasUI: true, ui });

			expect(textOf(result)).toBe(t.fixtureText);
			expect(counts.binder).toBe(0); // fixture channel never binds ctx (v2 §1)
			expect(counts[t.buildKey]).toBe(0);
			expect(counts.custom).toBe(0);
			expect(counts.completion).toBe(0);
		});

		it(`${t.tool} on a headless (unavailable) channel is the hard error; binder never called`, async () => {
			const { ui, binder, counts } = makeSpies();
			const execute = captureExecute(t.tool, { binder }); // no fixture path; hasUI:false → unavailable

			const result = await execute("tc", t.params, undefined, undefined, { hasUI: false, ui });

			expect(result.isError).toBe(true);
			expect(counts.binder).toBe(0); // unavailable channel never binds ctx either
			expect(counts[t.buildKey]).toBe(0);
		});
	}
});

// ── RED: the UI channel drives the runtime factory (direct performX) ─────────
// Discriminates a real isolation guard from a vacuous one: the same tripwire, on the UI channel,
// MUST reach runtime.buildSelect + ctx.ui.custom. RED today — performSelect's UI path still calls
// the legacy ctx.ui.select and ignores the runtime arg.
describe("I6 discriminator — the UI channel drives the runtime factory (RED until the component path is wired)", () => {
	it("performSelect on the UI channel invokes runtime.buildSelect + ctx.ui.custom, unlike the fixture channel", async () => {
		const uiSide = makeSpies();
		await performSelect({ kind: "ui" }, uiSide.ui, { question: "Choose", options: OPTIONS }, uiSide.runtime);
		expect(uiSide.counts.buildSelect).toBeGreaterThanOrEqual(1);
		expect(uiSide.counts.custom).toBeGreaterThanOrEqual(1);

		const fxSide = makeSpies();
		await performSelect(fixtureChannel({ kind: "selection", selections: ["Beta"] }), fxSide.ui, { question: "Choose", options: OPTIONS }, fxSide.runtime);
		expect(fxSide.counts.buildSelect).toBe(0);
		expect(fxSide.counts.custom).toBe(0);
	});
});

// ── RED: the UI channel through the REGISTERED execute binds + drives the runtime ────────────
// The positive control that makes the fixture/unavailable `binder === 0` non-vacuous: the SAME
// captured execute, on the UI channel (hasUI:true, no fixture), MUST call binder(ctx) → the bound
// runtime → ctx.ui.custom EXACTLY once. RED today — registerAskTools ignores the 2nd arg and the UI
// path still calls the legacy ctx.ui.select/editor.
describe("I6 discriminator (registered execute) — the UI channel binds and drives the runtime (RED until wired)", () => {
	for (const t of REGISTERED_TOOLS) {
		it(`${t.tool} on the UI channel invokes binder(ctx) + runtime.${t.buildKey} + ctx.ui.custom exactly once`, async () => {
			const { ui, binder, counts } = makeSpies();
			const execute = captureExecute(t.tool, { binder }); // no fixture → UI channel (hasUI:true)

			await execute("tc", t.params, undefined, undefined, { hasUI: true, ui });

			expect(counts.binder).toBe(1); // ctx bound exactly once on the UI channel (v2 §1)
			expect(counts[t.buildKey]).toBe(1);
			expect(counts.custom).toBe(1);
		});
	}
});
