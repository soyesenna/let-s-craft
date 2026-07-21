// I7 — destructive production-seam parity (appendix-test-plan §Integration I7; AC1.4, AC4.1).
//
// The release-gate authority (src/ask.ts:630-681) is a "수정 금지 영역" (CS5): its
// capture-before-await → stale-yes revoke → identity/scope check → persist-before-install flow must
// NOT change when the side-chat feature lands, apart from the details TYPE extension (details.sideChat).
// This suite pins that approval issuance stays a pure function of the FINAL `result.details.confirmed
// === true` and is ORTHOGONAL to any side-chat activity — even a side chat whose literal text is "yes"
// must never leak into the approval decision.
//
// Exercised through the ACTUALLY-registered lsc_confirm execute (production wiring, precedent
// test/destructive-approval.test.ts:147-163). The side chat is driven per local://ask-ui-wiring-contract-v2.md
// §1: registerAskTools(pi, binder?) → on the UI channel the wrapper calls binder(ctx) to bind the
// runtime, then performConfirm(channel, ctx.ui, params, runtime) → ctx.ui.custom(runtime.buildConfirm(
// params), {overlay}) → done(AskUiResult) → mapped to ConfirmResultDetails{confirmed, sideChat}.
//
//   GREEN baseline (legacy path, binder undefined — passes today AND after craft): no binder, so
//     performConfirm uses the Yes/No/Other loop; approval issues iff the final answer is Yes.
//   RED side-chat (binder + custom path — RED until PR3/PR4 route performConfirm through the bound
//     runtime): a scripted binder → runtime.buildConfirm → done({kind:"answer",confirmed,sideChat})
//     injects a literal-"yes" side chat with a distinct final decision. The RED tests assert the
//     binder WAS invoked (exactly once, on the UI channel) and runtime.buildConfirm WAS invoked and
//     details.sideChat was recorded, so they fail specifically because the current code never routes
//     through the binder to the runtime.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath } from "../src/artifacts/paths";
import { OTHER_OPTION, type SelectUI, registerAskTools } from "../src/ask";
import {
	type ApprovalCraftIdentity,
	createPendingApproval,
	installPendingApproval,
	invalidatePendingApproval,
	peekPendingApproval,
} from "../src/craft/destructive-approval";
import { type CraftState, clearActiveCraft, setActiveCraft } from "../src/craft/state";
// Type-only import: erased by esbuild, so this file still COLLECTS before src/ask-ui/ exists.
import type { AskUiResult, SideChatTurn } from "../src/ask-ui/types";

const CANON_QUESTION =
	"[Canon Amendment] Protected test canon needs an approved, intentional modification. Release hash protection and proceed? Proceed?";
const UNTAGGED_QUESTION = "Routine confirmation without a destructive tag. Proceed?";

const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
	invalidatePendingApproval();
	clearActiveCraft();
});

afterEach(() => {
	invalidatePendingApproval();
	clearActiveCraft();
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-ask-ui-parity-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "gated-feature"): CraftState {
	return { feature, projectRoot, testsPassed: false, aborted: false };
}

function identityOf(state: CraftState): ApprovalCraftIdentity {
	return { feature: state.feature, projectRoot: state.projectRoot, worktreeRoot: state.worktreeRoot };
}

// ── captured lsc_confirm execute (SDK-boundary mock pi) ──────────────────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: { question: string; confirmed?: boolean | null; freeText?: string; sideChat?: { turns: SideChatTurn[] } };
}
type ConfirmExecute = (
	toolCallId: string,
	params: { question: string },
	signal: unknown,
	onUpdate: unknown,
	ctx: { hasUI: boolean; ui: SelectUI },
) => Promise<ToolResultLike>;

function isCapturedConfirmTool(value: unknown): value is { name: string; execute: ConfirmExecute } {
	if (typeof value !== "object" || value === null) return false;
	if (!("name" in value) || value.name !== "lsc_confirm") return false;
	return "execute" in value && typeof value.execute === "function";
}

// Capture the tool execute as it actually registers, threading the (optional) binder the wiring
// contract injects via registerAskTools(pi, binder?). getFlag → undefined AND process.env.LSC_FIXTURE
// cleared (beforeEach) so channelFor selects the UI channel; the binder + component path is gated on
// the UI channel + ctx.ui.custom below.
function captureConfirmExecute(binder?: unknown): ConfirmExecute {
	let confirmExecute: ConfirmExecute | undefined;
	const mockPi = {
		zod,
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (isCapturedConfirmTool(definition)) confirmExecute = definition.execute;
		},
	};
	registerAskTools(mockPi as unknown as Parameters<typeof registerAskTools>[0], binder as unknown as Parameters<typeof registerAskTools>[1]);
	if (!confirmExecute) throw new Error("registerAskTools did not register an lsc_confirm tool with an execute");
	return confirmExecute;
}

// ── UI fakes ─────────────────────────────────────────────────────────────────
// Legacy fake: drains scripted select()/editor() queues (no `custom`), so performConfirm falls back
// to the Yes/No/Other loop.
function makeLegacyUI(selectResponses: Array<string | undefined>, editorResponses: Array<string | undefined> = []): SelectUI {
	return {
		async select() {
			return selectResponses.shift();
		},
		async editor() {
			return editorResponses.shift();
		},
	};
}

// custom<T>-capable fake: `custom` mounts the factory fn and returns whatever it passes to done().
// select/editor resolve undefined so, against pre-craft code that never routes to the runtime, the
// confirm degrades to a cancel and the RED assertions (binder + buildConfirm invoked + sideChat
// recorded) fail for the right reason.
function makeCustomUI(): SelectUI & { custom(factory: unknown, opts: { overlay?: boolean }): Promise<unknown> } {
	return {
		async custom(factory: unknown, _opts: { overlay?: boolean }): Promise<unknown> {
			if (typeof factory !== "function") return undefined;
			let captured: AskUiResult | undefined;
			await factory(undefined, undefined, undefined, (r: AskUiResult) => {
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
}

// A runtime binder (v2 §1) whose bound runtime's buildConfirm mounts a component that immediately
// resolves `result` via done. binderCalls counts binder(ctx) invocations (must be exactly 1, on the
// UI channel); buildConfirmCalls counts the routed factory build.
function makeConfirmFactory(result: AskUiResult): {
	binder: (ctx: unknown) => { buildSelect(p: unknown): unknown; buildConfirm(p: unknown): unknown; buildAsk(p: unknown): unknown };
	buildConfirmCalls: () => number;
	binderCalls: () => number;
} {
	let confirmN = 0;
	let binderN = 0;
	const stub = (): { render: () => unknown[] } => ({ render: () => [] });
	const runtime = {
		buildSelect: (_p: unknown) => stub,
		buildConfirm: (_p: unknown) => {
			confirmN += 1;
			return (_tui: unknown, _theme: unknown, _kb: unknown, done: (r: AskUiResult) => void): { render: () => unknown[] } => {
				done(result);
				return { render: () => [] };
			};
		},
		buildAsk: (_p: unknown) => stub,
	};
	const binder = (_ctx: unknown) => {
		binderN += 1;
		return runtime;
	};
	return { binder, buildConfirmCalls: () => confirmN, binderCalls: () => binderN };
}

// A side-chat turn whose response literally contains "yes" — the adversarial content that must never
// be mistaken for an approval decision.
function yesSideTurn(overrides: Partial<SideChatTurn> = {}): SideChatTurn {
	return {
		target: { kind: "option", label: "Yes" },
		mode: "one-button",
		prompt: 'Explain the option "Yes".',
		response: "Choosing yes releases the protected canon so the intentional edit can proceed.",
		model: "anthropic/claude-opus-4",
		startedAt: "2026-07-20T00:00:00.000Z",
		endedAt: "2026-07-20T00:00:05.000Z",
		status: "complete",
		...overrides,
	};
}

// ── GREEN baseline: approval keys off final details.confirmed only (legacy path) ─────────────
describe("I7 baseline — approval issuance is a pure function of the final confirm (legacy fallback, no side chat)", () => {
	it("(c) a tagged Yes issues exactly one pending approval and durable evidence", async () => {
		const root = tmpProject();
		const state = freshState(root);
		setActiveCraft(state);

		const result = await captureConfirmExecute()("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeLegacyUI(["Yes"]) });

		expect(result.isError).toBeFalsy();
		expect(result.details?.confirmed).toBe(true);
		const pending = peekPendingApproval();
		expect(pending?.tag).toBe("[Canon Amendment]");
		expect(pending?.response).toBe("yes");
		expect(pending?.identity).toEqual(identityOf(state));
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
		expect(persisted.releaseApproval?.nonce).toBe(pending?.nonce);
	});

	for (const [label, ui] of [
		["No", () => makeLegacyUI(["No"])],
		["a free answer via Other", () => makeLegacyUI([OTHER_OPTION], ["please hold off"])],
		["a cancel", () => makeLegacyUI([undefined])],
	] as const) {
		it(`(a) a tagged confirm answered ${label} issues no approval`, async () => {
			const root = tmpProject();
			setActiveCraft(freshState(root));

			const result = await captureConfirmExecute()("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: ui() });

			expect(result.details?.confirmed).not.toBe(true);
			expect(peekPendingApproval()).toBeUndefined();
			expect(existsSync(craftStatePath(root, "gated-feature"))).toBe(true); // setActiveCraft wrote it
			const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
			expect(persisted.releaseApproval).toBeUndefined(); // but no durable approval evidence
		});
	}

	it("(a) a fresh same-tag confirm answered No revokes a prior yes (stale-yes barrier)", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root));
		const execute = captureConfirmExecute();

		await execute("tc1", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeLegacyUI(["Yes"]) });
		expect(peekPendingApproval()).not.toBeUndefined();

		await execute("tc2", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeLegacyUI(["No"]) });
		expect(peekPendingApproval()).toBeUndefined();
	});
});

// ── RED side-chat dimension: a literal-"yes" side chat is orthogonal to approval ─────────────
describe("I7 side-chat parity — a side-chat 'yes' never leaks into the approval decision (RED: binder path unimplemented)", () => {
	it("(a) side response literal 'yes' with a final No issues no approval, yet records the side chat", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root));
		const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: false, sideChat: [yesSideTurn()] });

		const result = await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1); // the UI channel bound ctx exactly once (v2 §1)
		expect(buildConfirmCalls()).toBe(1); // performConfirm routed to the bound runtime
		expect(result.details?.confirmed).toBe(false);
		expect(result.details?.sideChat?.turns?.[0]?.response).toContain("yes");
		expect(peekPendingApproval()).toBeUndefined(); // the side "yes" must not issue a capability
	});

	it("(a) side 'yes' with a final free answer issues no approval (confirmed=null)", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root));
		const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: null, freeText: "let me think about it", sideChat: [yesSideTurn()] });

		const result = await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1);
		expect(buildConfirmCalls()).toBe(1);
		expect(result.details?.confirmed).toBeNull();
		expect(peekPendingApproval()).toBeUndefined();
	});

	it("(a) a final cancel issues no approval", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root));
		const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "cancel" });

		await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1);
		expect(buildConfirmCalls()).toBe(1);
		expect(peekPendingApproval()).toBeUndefined();
	});

	for (const failStatus of ["error", "aborted"] as const) {
		it(`(b) a side-chat ${failStatus} with a final No issues no approval`, async () => {
			const root = tmpProject();
			setActiveCraft(freshState(root));
			const turn = yesSideTurn({ status: failStatus, response: failStatus === "aborted" ? "yes, it me" : "", ...(failStatus === "error" ? { error: "provider 500", response: "" } : {}) });
			const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: false, sideChat: [turn] });

			const result = await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

			expect(binderCalls()).toBe(1);
			expect(buildConfirmCalls()).toBe(1);
			expect(result.details?.sideChat?.turns?.[0]?.status).toBe(failStatus);
			expect(result.details?.confirmed).not.toBe(true);
			expect(peekPendingApproval()).toBeUndefined();
		});
	}

	it("(c) side 'yes' with a final Yes issues exactly one approval and records the side chat", async () => {
		const root = tmpProject();
		const state = freshState(root);
		setActiveCraft(state);
		const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: true, sideChat: [yesSideTurn()] });

		const result = await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1);
		expect(buildConfirmCalls()).toBe(1);
		expect(result.details?.confirmed).toBe(true);
		expect(result.details?.sideChat?.turns).toHaveLength(1);
		const pending = peekPendingApproval();
		expect(pending?.tag).toBe("[Canon Amendment]");
		expect(pending?.response).toBe("yes");
		expect(pending?.identity).toEqual(identityOf(state));
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
		expect(persisted.releaseApproval?.nonce).toBe(pending?.nonce);
	});

	it("(c) a same-identity prior approval is revoked-then-reissued (single live capability), not doubled", async () => {
		const root = tmpProject();
		const state = freshState(root);
		setActiveCraft(state);
		installPendingApproval(createPendingApproval({ tag: "[Canon Amendment]", question: CANON_QUESTION, identity: identityOf(state) })); // a prior capability the fresh tagged prompt revokes on entry
		const first = peekPendingApproval()?.nonce;
		const { binder, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: true, sideChat: [yesSideTurn()] });

		await captureConfirmExecute(binder)("tc", { question: CANON_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1);
		const pending = peekPendingApproval();
		expect(pending).not.toBeUndefined();
		expect(pending?.nonce).not.toBe(first); // reissued fresh, not stacked
	});

	it("an untagged confirm never issues, even with a final Yes and a side 'yes' (side chat adds no tag)", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root));
		const { binder, buildConfirmCalls, binderCalls } = makeConfirmFactory({ kind: "answer", confirmed: true, sideChat: [yesSideTurn()] });

		const result = await captureConfirmExecute(binder)("tc", { question: UNTAGGED_QUESTION }, undefined, undefined, { hasUI: true, ui: makeCustomUI() });

		expect(binderCalls()).toBe(1);
		expect(buildConfirmCalls()).toBe(1);
		expect(result.details?.confirmed).toBe(true);
		expect(peekPendingApproval()).toBeUndefined();
	});
});
