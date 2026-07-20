// ask-ui type contract (.test-d.ts) — EXECUTED type-level pins for the v2 wiring SSOT.
//
// WHY THIS FILE EXISTS (architect iter2 blocking #3 / critic CS5). The exact-type contracts the
// feature depends on can only be enforced by an ACTUAL type-check: `npm run build` compiles only
// src/** (tsconfig include) and `vitest run` erases types via esbuild, so a type-level assertion
// living inside a vitest file is transpiled away and never checked — a type widened to `string`
// would pass silently. This file is the SINGLE home for those pins, and run_test.sh runs a
// DEDICATED `tsc --noEmit` over it (the SAME NodeNext resolution as the root build — N-C) so the
// pins are actually enforced and reach the summary + final exit code.
//
// EXPECTED STATE (pre-craft): RED — "RED until PR2". `../src/ask-ui/{types,completion-core}` do not
// exist until PR2 creates them, so every ask-ui import is module-not-found (TS2307). That import
// failure is the correct pre-craft signal, not a defect in this file. Once PR2 exports the exact v2
// types this file goes GREEN; any later drift (a widened union, a 7th ctx member, sideChat on the
// cancel arm, a dropped answer field) turns it RED again.
//
// This is NOT a vitest suite: `.test-d.ts` is outside vitest's `test/**/*.test.ts` glob, so it is
// never collected as a test — only tsc reads it. It emits nothing (--noEmit); every declaration is
// pure type-level.
//
// MODULE HOMES (v2 §1 + plan §Guardrails "Import graph"): the pure result unions and
// AskExecutionContext live in the Node-safe `src/ask-ui/types.ts`, NOT in the Bun-only leaf
// `index.ts` — `src/ask.ts` (registerAskTools/performX, Node-safe) must type the bound runtime
// without importing the Bun leaf (plan: "src/ask.ts와 모든 Node-safe module은 index/component/
// completion을 import하지 않음"), so these types are necessarily Node-safe. SideChatRequest is owned
// by the Node-safe `completion-core.ts`. Imports carry `.js` extensions because the package is ESM
// (`"type": "module"`) under NodeNext resolution, which requires explicit relative extensions.
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type {
	AskExecutionContext,
	AskResult,
	ConfirmResult,
	RenderEnv,
	SelectResult,
	SideChatTurn,
} from "../src/ask-ui/types.js";
import type { SideChatRequest } from "../src/ask-ui/completion-core.js";

// Exact type-equality (Matt Pocock / type-fest style): distinguishes optional vs required, readonly
// vs mutable, and widening (a literal union vs `string`), and is union-order-independent.
// `Assert<T extends true>` turns a failed `Equal` into a compile error (TS2344: type `false` does
// not satisfy the constraint `true`) — that is what makes this file fail-closed under tsc.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

// ── §1 binder ctx: AskExecutionContext is EXACTLY the six-member Pick of the SDK ExtensionContext ──
// (v2 §1: model | models | modelRegistry | sessionManager | getSystemPrompt | hasUI — the Pick target
// is fixed at these six). A 7th member, a dropped member, or a hand-rolled look-alike all fail here.
type _AskExecutionContextIsSixMemberPick = Assert<Equal<
	AskExecutionContext,
	Pick<ExtensionContext, "model" | "models" | "modelRegistry" | "sessionManager" | "getSystemPrompt" | "hasUI">
>>;

// ── §4 CompletionPort: cacheRetention is EXACTLY the pi-ai union, never a pass-through string ───────
// (v2 §4 / D3: v1's `string`/"5m" is dead; default "short").
type _CacheRetentionUnion = Assert<Equal<SideChatRequest["cacheRetention"], "none" | "short" | "long">>;

// ── §6 render env: colorMode is EXACTLY the two capability modes theme.ts getColorMode() reports ────
// (invented modes like "16color"/"nocolor" — N5 — fail here).
type _ColorModePin = Assert<Equal<RenderEnv["colorMode"], "truecolor" | "256color">>;

// ── §2 + §9 result unions: the ANSWER arm carries the optional sideChat?; cancel stays BARE ─────────
// (v2 §2 SSOT + §9: `sideChat?: SideChatTurn[]` on the answer variant ONLY; `{ kind: "cancel" }` has
// no sideChat and no other field). This is the type-level counterpart of the CS4 union fix applied to
// the adapter/state/destructive-parity mirrors — it fails if an implementer puts sideChat on cancel,
// drops it from the answer arm, or widens a free-text field.
type _SelectResult = Assert<Equal<
	SelectResult,
	{ kind: "answer"; selections: string[]; freeText?: string; sideChat?: SideChatTurn[] } | { kind: "cancel" }
>>;
type _ConfirmResult = Assert<Equal<
	ConfirmResult,
	{ kind: "answer"; confirmed: boolean | null; freeText?: string; sideChat?: SideChatTurn[] } | { kind: "cancel" }
>>;
type _AskResult = Assert<Equal<
	AskResult,
	{ kind: "answer"; response: string; sideChat?: SideChatTurn[] } | { kind: "cancel" }
>>;

// Anchor every pin in one exported tuple: the constraint on each `Assert<...>` is already checked at
// its declaration, but referencing them here documents that they are intentional contract anchors
// (not dead code) and keeps them live under any future noUnusedLocals-style setting. Type-only —
// nothing is emitted.
export type AskUiContractPins = [
	_AskExecutionContextIsSixMemberPick,
	_CacheRetentionUnion,
	_ColorModePin,
	_SelectResult,
	_ConfirmResult,
	_AskResult,
];
