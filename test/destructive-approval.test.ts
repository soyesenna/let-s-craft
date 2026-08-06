// Unit canon for the release-gate feature's authority core (plan §4 W1). Three layers:
//   1. destructive-approval.ts — the in-memory single-use approval slot (권위), the gate-tag
//      SSOT, and craft-identity binding (field equality, F-12);
//   2. state.ts — the durable evidence ledger it feeds (recordReleaseApproval/recordOpenRelease,
//      CS3 persist-before-publish) plus the pure reducers (hasOpenRelease/openReleaseGuidance);
//   3. the lsc_confirm issuance transaction (ask.ts execute wrapper) that installs the slot,
//      exercised through the ACTUALLY-registered execute (CS6/CS7), not a hand-driven performConfirm.
//
// Conventions (trace Lane 5 / plan §4): no business mocks or snapshots — the sole sanctioned
// exception is the SDK-boundary mock `pi` that captures the registered tool execute (precedent
// test/ask-schema.test.ts:1-42). Real singletons + mkdtempSync(tmpdir()), per-field assertions,
// clearActiveCraft()/invalidatePendingApproval() reset before and after every test.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftStatePath } from "../src/artifacts/paths";
import { OTHER_OPTION, type SelectUI, registerAskTools } from "../src/ask";
import { performCraftAbort } from "../src/craft/abort";
import {
	DESTRUCTIVE_GATE_TAGS,
	type ApprovalCraftIdentity,
	type DestructiveGateTag,
	consumePendingApproval,
	createPendingApproval,
	installPendingApproval,
	invalidatePendingApproval,
	matchDestructiveGateTag,
	peekPendingApproval,
	sameCraftIdentity,
} from "../src/craft/destructive-approval";
import { type HashManifest, closeOpenRelease, fingerprintManifestFile } from "../src/craft/hash-manifest";
import { RELEASE_CONSUMABLE_TAGS } from "../src/craft/release";
import {
	type CraftState,
	type OpenReleaseEvidence,
	type ReleaseApprovalEvidence,
	clearActiveCraft,
	getActiveCraft,
	hasOpenRelease,
	loadActiveCraft,
	markCraftAborted,
	openReleaseGuidance,
	recordOpenRelease,
	recordReleaseApproval,
	registerCraftStateResets,
	setActiveCraft,
} from "../src/craft/state";

// A representative tagged confirm question: the [Canon Amendment] prompt release consumes.
const CANON_QUESTION =
	"[Canon Amendment] Protected test canon needs an approved, intentional modification. Release hash protection and proceed? Proceed?";
// A [Land] prompt — issuable infrastructure, but NOT in RELEASE_CONSUMABLE_TAGS.
const LAND_QUESTION = "[Land] Merge this approved feature into the main branch? land?";

// ── shared fixtures / helpers ───────────────────────────────────────────────
const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	// The issuance tests drive the captured lsc_confirm execute through the UI channel. A stray
	// LSC_FIXTURE in the ambient env would silently reroute channelFor to the fixture path, so
	// neutralize it per-test and restore it afterwards — the file must be hermetic either way.
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
	const dir = mkdtempSync(join(tmpdir(), "lsc-approval-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

function identityOf(state: CraftState): ApprovalCraftIdentity {
	return { feature: state.feature, projectRoot: state.projectRoot, worktreeRoot: state.worktreeRoot };
}

function installFor(identity: ApprovalCraftIdentity, tag: DestructiveGateTag = "[Canon Amendment]", question = CANON_QUESTION): void {
	installPendingApproval(createPendingApproval({ tag, question, identity }));
}

// A scripted SelectUI: select()/editor() drain their queues in order (matches ask.test.ts's
// makeSelectUI shape). Used to answer the confirm the captured execute delegates to.
function makeUI(selectResponses: Array<string | undefined>, editorResponses: Array<string | undefined> = []): SelectUI {
	return {
		async select() {
			return selectResponses.shift();
		},
		async editor() {
			return editorResponses.shift();
		},
	};
}

function uiCtx(ui: SelectUI): { hasUI: boolean; ui: SelectUI } {
	return { hasUI: true, ui };
}

// ── captured lsc_confirm execute (SDK-boundary mock pi — CS6/CS7) ────────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}
type ConfirmExecute = (
	toolCallId: string,
	params: { question: string },
	signal: unknown,
	onUpdate: unknown,
	ctx: { hasUI: boolean; ui: SelectUI },
) => Promise<ToolResultLike>;

interface CapturedConfirmTool {
	name: string;
	execute: ConfirmExecute;
}

// Structural type guard (not an inline cast): checks name+execute presence before trusting the
// captured callback — same pattern as ask-schema.test.ts's isCapturedToolDefinition.
function isCapturedConfirmTool(value: unknown): value is CapturedConfirmTool {
	if (typeof value !== "object" || value === null) return false;
	if (!("name" in value) || typeof value.name !== "string") return false;
	if (!("execute" in value) || typeof value.execute !== "function") return false;
	return true;
}

// Capture the tool execute as it actually registers (production wiring — CS7), so the full
// issuance transaction (revoke → confirm → identity re-check → durable persist → install) runs
// as shipped rather than being re-assembled by hand. getFlag returns undefined so channelFor
// selects the UI channel (LSC_FIXTURE is stripped in beforeEach).
function captureConfirmExecute(): ConfirmExecute {
	let confirmExecute: ConfirmExecute | undefined;
	const mockPi = {
		zod,
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (isCapturedConfirmTool(definition) && definition.name === "lsc_confirm") confirmExecute = definition.execute;
		},
	};
	registerAskTools(mockPi as unknown as Parameters<typeof registerAskTools>[0]);
	if (!confirmExecute) throw new Error("registerAskTools did not register an lsc_confirm tool with an execute");
	return confirmExecute;
}

// Capture the session-reset callbacks registerCraftStateResets wires via pi.on (real wiring, CS6).
function captureStateResetHandlers(): Record<"session_switch" | "session_branch" | "session_shutdown", () => void> {
	const handlers: Record<string, () => void> = {};
	const fakePi = {
		on(event: string, callback: () => void): void {
			handlers[event] = callback;
		},
	};
	registerCraftStateResets(fakePi as unknown as Parameters<typeof registerCraftStateResets>[0]);
	const pick = (event: string): (() => void) => {
		const handler = handlers[event];
		if (!handler) throw new Error(`registerCraftStateResets did not register a ${event} handler`);
		return handler;
	};
	return {
		session_switch: pick("session_switch"),
		session_branch: pick("session_branch"),
		session_shutdown: pick("session_shutdown"),
	};
}

// Replace <root>/.lsc with a regular FILE so the next persist()'s mkdirSync(recursive) fails
// with ENOTDIR — a uid-independent way to force a durable-write failure (unlike chmod, which
// root bypasses). setActiveCraft must have run first (it needs a writable path).
function breakPersistPath(root: string): void {
	rmSync(join(root, ".lsc"), { recursive: true, force: true });
	writeFileSync(join(root, ".lsc"), "");
}

// ── gate-tag SSOT & identity ────────────────────────────────────────────────
describe("matchDestructiveGateTag — gate-tag SSOT (C10/C11)", () => {
	it("exposes exactly the three destructive gate tags as the SSOT", () => {
		expect(DESTRUCTIVE_GATE_TAGS).toEqual(["[Canon Amendment]", "[Land]", "[Hash Violation]"]);
	});

	it("release consumes exactly the Canon Amendment tag", () => {
		expect(RELEASE_CONSUMABLE_TAGS).toEqual(["[Canon Amendment]"]);
	});

	it("matches each destructive gate tag as an exact question prefix", () => {
		for (const tag of DESTRUCTIVE_GATE_TAGS) {
			expect(matchDestructiveGateTag(`${tag} do the thing. Proceed?`)).toBe(tag);
		}
	});

	it("does not match a bare tag word stripped of its brackets", () => {
		expect(matchDestructiveGateTag("Canon Amendment needs approval. Proceed?")).toBeUndefined();
	});

	it("does not match a tag that appears mid-question rather than as a prefix", () => {
		expect(matchDestructiveGateTag("Please review the [Canon Amendment] change. Proceed?")).toBeUndefined();
	});

	it("does not match an unknown or legacy tag prefix", () => {
		expect(matchDestructiveGateTag("[Release] proceed with the fix. Proceed?")).toBeUndefined();
	});
});

describe("sameCraftIdentity — field equality, not reference (F-12)", () => {
	it("treats a spread copy with identical fields as the same identity", () => {
		const a: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p", worktreeRoot: "/w" };
		const b: ApprovalCraftIdentity = { ...a };
		expect(a).not.toBe(b); // sanity: a distinct object reference
		expect(sameCraftIdentity(a, b)).toBe(true); // ...yet the same identity
	});

	it("treats two identities with no worktreeRoot as equal", () => {
		expect(sameCraftIdentity({ feature: "f", projectRoot: "/p" }, { feature: "f", projectRoot: "/p" })).toBe(true);
	});

	it("distinguishes a differing feature", () => {
		expect(sameCraftIdentity({ feature: "f", projectRoot: "/p" }, { feature: "g", projectRoot: "/p" })).toBe(false);
	});

	it("distinguishes a differing projectRoot", () => {
		expect(sameCraftIdentity({ feature: "f", projectRoot: "/p" }, { feature: "f", projectRoot: "/q" })).toBe(false);
	});

	it("distinguishes a differing worktreeRoot (including present vs absent)", () => {
		expect(
			sameCraftIdentity({ feature: "f", projectRoot: "/p", worktreeRoot: "/w" }, { feature: "f", projectRoot: "/p", worktreeRoot: "/x" }),
		).toBe(false);
		expect(sameCraftIdentity({ feature: "f", projectRoot: "/p", worktreeRoot: "/w" }, { feature: "f", projectRoot: "/p" })).toBe(false);
	});

	it("is false when either side is undefined (fail-closed for the await-boundary re-check)", () => {
		const a: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		expect(sameCraftIdentity(a, undefined)).toBe(false);
		expect(sameCraftIdentity(undefined, a)).toBe(false);
	});
});

// ── pending approval slot core ──────────────────────────────────────────────
describe("pending approval slot — install / consume / single-use / conditional non-burn", () => {
	it("createPendingApproval builds a record without touching the slot (prepare != install, CS2)", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		const record = createPendingApproval({ tag: "[Canon Amendment]", question: CANON_QUESTION, identity });
		expect(peekPendingApproval()).toBeUndefined(); // prepare must not publish
		expect(record.tag).toBe("[Canon Amendment]");
		expect(record.question).toBe(CANON_QUESTION);
		expect(record.response).toBe("yes");
		expect(record.identity).toEqual(identity);
		expect(record.nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
		expect(new Date(record.issuedAt).toISOString()).toBe(record.issuedAt);
	});

	it("installPendingApproval publishes the record so peek returns it", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		const record = createPendingApproval({ tag: "[Canon Amendment]", question: CANON_QUESTION, identity });
		installPendingApproval(record);
		expect(peekPendingApproval()).toEqual(record);
	});

	it("re-installing replaces the slot — the latest issuance wins", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		const first = createPendingApproval({ tag: "[Canon Amendment]", question: "q1", identity });
		const second = createPendingApproval({ tag: "[Land]", question: "q2", identity });
		expect(first.nonce).not.toBe(second.nonce); // each prepare mints a fresh nonce
		installPendingApproval(first);
		installPendingApproval(second);
		expect(peekPendingApproval()?.nonce).toBe(second.nonce);
		expect(peekPendingApproval()?.tag).toBe("[Land]");
	});

	it("consume succeeds for a matching tag+identity and clears the slot", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		installFor(identity);
		const result = consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity });
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected a successful consume");
		expect(result.approval.tag).toBe("[Canon Amendment]");
		expect(result.approval.identity).toEqual(identity);
		expect(peekPendingApproval()).toBeUndefined(); // burned on success
	});

	it("a second consume after success reports no-pending-approval (single-use)", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		installFor(identity);
		consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity });
		expect(consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity })).toEqual({
			ok: false,
			reason: "no-pending-approval",
		});
	});

	it("consume on an empty slot reports no-pending-approval", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		expect(consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity })).toEqual({
			ok: false,
			reason: "no-pending-approval",
		});
	});

	it("consume with a non-accepted tag reports tag-mismatch and preserves the slot (CS11 non-burn)", () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		installFor(identity, "[Land]", LAND_QUESTION);
		const result = consumePendingApproval({ acceptedTags: RELEASE_CONSUMABLE_TAGS, identity });
		expect(result).toEqual({ ok: false, reason: "tag-mismatch", pendingTag: "[Land]" });
		expect(peekPendingApproval()?.tag).toBe("[Land]"); // the legit [Land] consumer's approval survives
	});

	it("a mismatch preserves the slot, but the next same-tag confirm revokes it (CS11 continuity)", async () => {
		const identity: ApprovalCraftIdentity = { feature: "f", projectRoot: "/p" };
		installFor(identity); // a legit [Canon Amendment] approval
		const wrong = consumePendingApproval({ acceptedTags: ["[Land]"], identity }); // a mis-targeted consumer
		expect(wrong).toEqual({ ok: false, reason: "tag-mismatch", pendingTag: "[Canon Amendment]" });
		expect(peekPendingApproval()).not.toBeUndefined(); // survived the mismatch (availability)
		// A fresh same-tag prompt — even answered "no" — must revoke the surviving approval (no stale yes, P8).
		const execute = captureConfirmExecute();
		await execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(makeUI(["No"])));
		expect(peekPendingApproval()).toBeUndefined(); // revoked on the next tagged prompt (security)
	});

	it("consume with a mismatched identity reports identity-mismatch and preserves the slot", () => {
		installFor({ feature: "installed-feature", projectRoot: "/p" });
		const other: ApprovalCraftIdentity = { feature: "other-feature", projectRoot: "/q" };
		const result = consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity: other });
		expect(result).toEqual({ ok: false, reason: "identity-mismatch", pendingTag: "[Canon Amendment]" });
		expect(peekPendingApproval()).not.toBeUndefined(); // preserved (conditional non-burn)
	});

	it("invalidatePendingApproval clears the slot", () => {
		installFor({ feature: "f", projectRoot: "/p" });
		expect(peekPendingApproval()).not.toBeUndefined();
		invalidatePendingApproval();
		expect(peekPendingApproval()).toBeUndefined();
	});
});

// ── lifecycle invalidation — direct state helpers ───────────────────────────
describe("lifecycle invalidation — direct state helpers (P8 defense)", () => {
	it("setActiveCraft invalidates a pending approval carried from the prior context", () => {
		const state = freshState(tmpProject(), "feat-1");
		setActiveCraft(state);
		installFor(identityOf(state));
		expect(peekPendingApproval()).not.toBeUndefined();
		setActiveCraft(freshState(tmpProject(), "feat-2")); // a new activation
		expect(peekPendingApproval()).toBeUndefined();
		expect(consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity: identityOf(state) })).toEqual({
			ok: false,
			reason: "no-pending-approval",
		});
	});

	it("re-activating the same identity with a fresh object still invalidates a pending approval", () => {
		const state = freshState(tmpProject(), "feat-1");
		setActiveCraft(state);
		installFor(identityOf(state));
		expect(peekPendingApproval()).not.toBeUndefined();
		setActiveCraft({ ...state }); // a re-init: same feature/projectRoot/worktreeRoot, new object
		expect(peekPendingApproval()).toBeUndefined();
	});

	it("clearActiveCraft invalidates a pending approval", () => {
		const state = freshState(tmpProject());
		setActiveCraft(state);
		installFor(identityOf(state));
		clearActiveCraft();
		expect(peekPendingApproval()).toBeUndefined();
		expect(consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity: identityOf(state) })).toEqual({
			ok: false,
			reason: "no-pending-approval",
		});
	});

	it("markCraftAborted invalidates a pending approval", () => {
		const state = freshState(tmpProject());
		setActiveCraft(state);
		installFor(identityOf(state));
		markCraftAborted();
		expect(peekPendingApproval()).toBeUndefined();
	});

	it("loadActiveCraft invalidates a pending approval", () => {
		const root = tmpProject();
		const state = freshState(root);
		setActiveCraft(state); // persists the state file
		installFor(identityOf(state));
		loadActiveCraft(root, "my-feature"); // re-loading from disk invalidates the slot
		expect(peekPendingApproval()).toBeUndefined();
	});
});

// ── lifecycle invalidation — real event / tool wiring (CS6 d/e/f) ───────────
describe("lifecycle invalidation — real event/tool wiring (CS6)", () => {
	for (const event of ["session_switch", "session_branch", "session_shutdown"] as const) {
		it(`the ${event} reset callback invalidates a pending approval (d)`, () => {
			const handlers = captureStateResetHandlers();
			const state = freshState(tmpProject());
			setActiveCraft(state);
			installFor(identityOf(state));
			expect(peekPendingApproval()).not.toBeUndefined();
			handlers[event]();
			expect(peekPendingApproval()).toBeUndefined();
			expect(getActiveCraft()).toBeUndefined();
		});
	}

	it("performCraftAbort invalidates a pending approval (e)", () => {
		const state = freshState(tmpProject());
		setActiveCraft(state);
		installFor(identityOf(state));
		const result = performCraftAbort("user declined to continue");
		expect(result.isError).toBeFalsy();
		expect(peekPendingApproval()).toBeUndefined();
		expect(consumePendingApproval({ acceptedTags: ["[Canon Amendment]"], identity: identityOf(state) })).toEqual({
			ok: false,
			reason: "no-pending-approval",
		});
	});

	it("loading a persisted unclosed open-release returns the record but does not promote it to the active singleton (f)", () => {
		const root = tmpProject();
		const feature = "reopened-feature";
		const open: OpenReleaseEvidence = {
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			reason: "fix the canon",
			openedAt: "2026-03-03T00:00:00.000Z",
			// no closedAt → unclosed
		};
		const persisted: CraftState = { feature, projectRoot: root, aborted: false, openRelease: open };
		const path = craftStatePath(root, feature);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(persisted, null, 2));

		const record = loadActiveCraft(root, feature);

		expect(record?.openRelease?.nonce).toBe("n1"); // record surfaced for inspection
		expect(getActiveCraft()).toBeUndefined(); // but NOT promoted — run_tests' !craft guard stays fail-closed
	});
});

// ── issuance transaction — captured lsc_confirm execute (CS2/CS6) ────────────
describe("issuance transaction — captured lsc_confirm execute (CS2/CS6)", () => {
	it("(a) issues a pending approval and durable evidence on a tagged yes confirm", async () => {
		const root = tmpProject();
		const state = freshState(root, "gated-feature");
		setActiveCraft(state);
		const execute = captureConfirmExecute();

		const result = await execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(makeUI(["Yes"])));

		expect(result.isError).toBeFalsy();
		const pending = peekPendingApproval();
		expect(pending).not.toBeUndefined();
		expect(pending?.tag).toBe("[Canon Amendment]");
		expect(pending?.response).toBe("yes");
		expect(pending?.question).toBe(CANON_QUESTION);
		expect(pending?.identity).toEqual(identityOf(state));
		expect(typeof pending?.nonce).toBe("string");
		// Durable evidence is committed before the slot goes live (persist-before-install, P7).
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
		expect(persisted.releaseApproval?.nonce).toBe(pending?.nonce);
		expect(persisted.releaseApproval?.tag).toBe("[Canon Amendment]");
	});

	for (const [label, makeSecondUI] of [
		["no", () => makeUI(["No"])],
		["a free answer", () => makeUI([OTHER_OPTION], ["please hold off"])],
		["a cancel", () => makeUI([undefined])],
	] as const) {
		it(`(a) a subsequent same-tag confirm answered ${label} revokes the prior yes (stale-yes barrier)`, async () => {
			const root = tmpProject();
			setActiveCraft(freshState(root, "gated-feature"));
			const execute = captureConfirmExecute();

			await execute("tc1", { question: CANON_QUESTION }, undefined, undefined, uiCtx(makeUI(["Yes"])));
			expect(peekPendingApproval()).not.toBeUndefined(); // issued

			await execute("tc2", { question: CANON_QUESTION }, undefined, undefined, uiCtx(makeSecondUI()));
			expect(peekPendingApproval()).toBeUndefined(); // revoked by the fresh tagged prompt
		});
	}

	it("(b) does not issue when the active craft is cleared during the confirm await", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "gated-feature"));
		const execute = captureConfirmExecute();
		let releaseSelect: (value: string) => void = () => {};
		const gate = new Promise<string>(resolve => {
			releaseSelect = resolve;
		});
		const ui: SelectUI = { select: () => gate, editor: async () => undefined };

		const pending = execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(ui));
		clearActiveCraft(); // the craft context vanishes mid-await...
		releaseSelect("Yes"); // ...then the user answers yes
		const result = await pending;

		expect(result.isError).toBeFalsy(); // the confirm itself still succeeded
		expect(peekPendingApproval()).toBeUndefined(); // but no capability was issued (identity re-check fails)
	});

	it("(b) does not issue when the active craft changes during the confirm await", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "gated-feature"));
		const execute = captureConfirmExecute();
		let releaseSelect: (value: string) => void = () => {};
		const gate = new Promise<string>(resolve => {
			releaseSelect = resolve;
		});
		const ui: SelectUI = { select: () => gate, editor: async () => undefined };

		const pending = execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(ui));
		setActiveCraft(freshState(tmpProject(), "different-feature")); // craft transition mid-await
		releaseSelect("Yes");
		await pending;

		expect(peekPendingApproval()).toBeUndefined(); // identity changed → no issuance for either craft
	});

	it("(c) installs neither the slot nor durable evidence when the issuance write fails", async () => {
		const root = tmpProject();
		const state = freshState(root, "gated-feature");
		setActiveCraft(state); // succeeds — writes the state file
		installFor(identityOf(state)); // a prior approval the failing prompt must revoke on entry
		breakPersistPath(root); // the next persist (the issuance's recordReleaseApproval) will throw
		const execute = captureConfirmExecute();

		await expect(execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(makeUI(["Yes"])))).rejects.toThrow();

		expect(peekPendingApproval()).toBeUndefined(); // capability not installed
		expect(getActiveCraft()?.releaseApproval).toBeUndefined(); // in-memory evidence not set (CS3)
		expect(existsSync(craftStatePath(root, "gated-feature"))).toBe(false); // durable evidence not committed
	});

	it("does not issue on an untagged yes even with an active craft", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "gated-feature"));
		const result = await captureConfirmExecute()(
			"tc",
			{ question: "Routine confirmation without a destructive tag. Proceed?" },
			undefined,
			undefined,
			uiCtx(makeUI(["Yes"])),
		);
		expect(result.isError).toBeFalsy();
		expect(peekPendingApproval()).toBeUndefined();
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
		expect(persisted.releaseApproval).toBeUndefined();
	});

	it("does not issue a tagged yes without an active craft", async () => {
		const result = await captureConfirmExecute()(
			"tc",
			{ question: CANON_QUESTION },
			undefined,
			undefined,
			uiCtx(makeUI(["Yes"])),
		);
		expect(result.isError).toBeFalsy();
		expect(peekPendingApproval()).toBeUndefined();
	});

	it("issues Land as Land through the registered confirm wrapper", async () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "gated-feature"));
		await captureConfirmExecute()(
			"tc",
			{ question: LAND_QUESTION },
			undefined,
			undefined,
			uiCtx(makeUI(["Yes"])),
		);
		expect(peekPendingApproval()?.tag).toBe("[Land]");
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "gated-feature"), "utf8"));
		expect(persisted.releaseApproval.tag).toBe("[Land]");
	});

	it("(b) still issues when a same-identity active object is spread-replaced during the confirm await (sameCraftIdentity, not reference)", async () => {
		const root = tmpProject();
		const state = freshState(root, "gated-feature");
		setActiveCraft(state);
		const execute = captureConfirmExecute();
		let releaseSelect: (value: string) => void = () => {};
		const gate = new Promise<string>(resolve => {
			releaseSelect = resolve;
		});
		const ui: SelectUI = { select: () => gate, editor: async () => undefined };

		const pending = execute("tc", { question: CANON_QUESTION }, undefined, undefined, uiCtx(ui));
		// recordReleaseApproval spreads a NEW active object with the SAME identity, and (unlike
		// setActiveCraft/markCraftAborted) never calls invalidatePendingApproval itself.
		recordReleaseApproval({ nonce: "n-identity", tag: "[Land]", question: "q", response: "yes", issuedAt: "2026-01-01T00:00:00.000Z" });
		releaseSelect("Yes");
		await pending;

		const issued = peekPendingApproval();
		expect(issued).not.toBeUndefined(); // reference changed, identity did not → still issued
		expect(issued?.identity).toEqual(identityOf(state));
	});
});

// ── durable evidence ledger — recordReleaseApproval / recordOpenRelease ─────
describe("durable evidence ledger (CS3 / F-14)", () => {
	it("recordReleaseApproval round-trips the evidence to the persisted file and to memory", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		const evidence: ReleaseApprovalEvidence = {
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			issuedAt: "2026-04-04T00:00:00.000Z",
		};
		recordReleaseApproval(evidence);
		expect(getActiveCraft()?.releaseApproval).toEqual(evidence);
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "feat"), "utf8"));
		expect(persisted.releaseApproval).toEqual(evidence);
	});

	it("recordReleaseApproval is a no-op when there is no active craft", () => {
		recordReleaseApproval({ nonce: "n", tag: "[Canon Amendment]", question: CANON_QUESTION, response: "yes", issuedAt: "t" });
		expect(getActiveCraft()).toBeUndefined();
	});

	it("a second recordReleaseApproval overwrites the single evidence slot — last issuance wins (F-14)", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		recordReleaseApproval({ nonce: "n1", tag: "[Canon Amendment]", question: "q1", response: "yes", issuedAt: "t1", consumedAt: "old-consumption" });
		const second: ReleaseApprovalEvidence = { nonce: "n2", tag: "[Canon Amendment]", question: "q2", response: "yes", issuedAt: "t2" };
		recordReleaseApproval(second);
		// replacement, not merge: the stale consumedAt must not survive into the new issuance.
		expect(getActiveCraft()?.releaseApproval).toEqual(second);
		expect(getActiveCraft()?.releaseApproval?.consumedAt).toBeUndefined();
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "feat"), "utf8"));
		expect(persisted.releaseApproval).toEqual(second);
		expect(persisted.releaseApproval.consumedAt).toBeUndefined();
	});

	it("recordReleaseApproval does not mutate in-memory state when the persist write fails (CS3)", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		breakPersistPath(root);
		const evidence: ReleaseApprovalEvidence = { nonce: "n", tag: "[Canon Amendment]", question: "q", response: "yes", issuedAt: "t" };
		expect(() => recordReleaseApproval(evidence)).toThrow();
		expect(getActiveCraft()?.releaseApproval).toBeUndefined(); // publish-after-persist: nothing published
	});

	it("recordOpenRelease stores the open evidence and stamps consumedAt onto the release approval", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		recordReleaseApproval({
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			issuedAt: "2026-05-05T00:00:00.000Z",
		});
		const open: OpenReleaseEvidence = {
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			reason: "fix the canon",
			openedAt: "2026-06-06T00:00:00.000Z",
		};
		recordOpenRelease(open);
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "feat"), "utf8"));
		expect(persisted.openRelease).toEqual(open);
		expect(persisted.releaseApproval.consumedAt).toBe("2026-06-06T00:00:00.000Z"); // stamped with openedAt
	});

	it("recordOpenRelease round-trips a manifestFingerprint when present", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		const open: OpenReleaseEvidence = {
			nonce: "n",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			reason: "r",
			openedAt: "t",
			manifestFingerprint: "deadbeefcafe",
		};
		recordOpenRelease(open);
		const persisted = JSON.parse(readFileSync(craftStatePath(root, "feat"), "utf8"));
		expect(persisted.openRelease.manifestFingerprint).toBe("deadbeefcafe");
	});

	it("does not mutate in-memory state and leaves the approval unstamped when the open-release persist write fails (CS4)", () => {
		const root = tmpProject();
		setActiveCraft(freshState(root, "feat"));
		recordReleaseApproval({
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			issuedAt: "2026-05-05T00:00:00.000Z",
		});
		breakPersistPath(root);
		const open: OpenReleaseEvidence = {
			nonce: "n1",
			tag: "[Canon Amendment]",
			question: CANON_QUESTION,
			response: "yes",
			reason: "fix the canon",
			openedAt: "2026-06-06T00:00:00.000Z",
		};
		expect(() => recordOpenRelease(open)).toThrow();
		expect(getActiveCraft()?.openRelease).toBeUndefined(); // publish-after-persist: nothing published
		expect(getActiveCraft()?.releaseApproval?.consumedAt).toBeUndefined(); // approval not stamped consumed
	});
});

// ── pure reducers ───────────────────────────────────────────────────────────
describe("pure reducers — hasOpenRelease / closeOpenRelease / openReleaseGuidance / fingerprintManifestFile", () => {
	const openEvidence: OpenReleaseEvidence = {
		nonce: "n",
		tag: "[Canon Amendment]",
		question: CANON_QUESTION,
		response: "yes",
		reason: "r",
		openedAt: "2026-07-07T00:00:00.000Z",
	};

	it("hasOpenRelease is true only for an unclosed open-release", () => {
		const base: CraftState = { feature: "f", projectRoot: "/p", aborted: false };
		expect(hasOpenRelease(undefined)).toBe(false);
		expect(hasOpenRelease(base)).toBe(false);
		expect(hasOpenRelease({ ...base, openRelease: openEvidence })).toBe(true);
		expect(hasOpenRelease({ ...base, openRelease: { ...openEvidence, closedAt: "2026-07-08T00:00:00.000Z" } })).toBe(false);
	});

	it("openReleaseGuidance includes the lsc_craft_init rebaseline instruction (AC4)", () => {
		expect(openReleaseGuidance("feat", openEvidence)).toContain("lsc_craft_init");
	});

	it("closeOpenRelease returns undefined when there is no open-release", () => {
		const newManifest: HashManifest = { feature: "f", recordedAt: "t", files: { "a.ts": "h" } };
		expect(closeOpenRelease(undefined, undefined, newManifest, "T")).toBeUndefined();
	});

	it("closeOpenRelease returns an already-closed evidence unchanged (CS4 succession)", () => {
		const newManifest: HashManifest = { feature: "f", recordedAt: "t", files: { "a.ts": "h" } };
		const closed: OpenReleaseEvidence = {
			...openEvidence,
			closedAt: "2026-07-09T00:00:00.000Z",
			rebaselineDiff: { added: [], removed: [], modified: ["x.ts"] },
		};
		expect(closeOpenRelease(closed, undefined, newManifest, "LATER")).toEqual(closed);
	});

	it("closeOpenRelease stamps closedAt and a kind-grouped rebaselineDiff when an old manifest exists", () => {
		const oldManifest: HashManifest = { feature: "f", recordedAt: "t0", files: { "keep.ts": "h1", "mod.ts": "h2", "gone.ts": "h3" } };
		const newManifest: HashManifest = { feature: "f", recordedAt: "t1", files: { "keep.ts": "h1", "mod.ts": "h2b", "new.ts": "h4" } };
		const result = closeOpenRelease(openEvidence, oldManifest, newManifest, "CLOSED-AT");
		expect(result?.closedAt).toBe("CLOSED-AT");
		expect(result?.rebaselineDiff).toEqual({ added: ["new.ts"], removed: ["gone.ts"], modified: ["mod.ts"] });
		expect(result?.nonce).toBe(openEvidence.nonce); // original fields carried through
		expect(result?.reason).toBe(openEvidence.reason);
	});

	it("closeOpenRelease stamps closedAt but omits rebaselineDiff when no old manifest exists", () => {
		const newManifest: HashManifest = { feature: "f", recordedAt: "t1", files: { "a.ts": "h" } };
		const result = closeOpenRelease(openEvidence, undefined, newManifest, "CLOSED-AT");
		expect(result?.closedAt).toBe("CLOSED-AT");
		expect(result?.rebaselineDiff).toBeUndefined();
	});

	it("fingerprintManifestFile returns the sha256 hex of the raw file bytes", () => {
		const root = tmpProject();
		const path = join(root, ".hash-manifest.json");
		writeFileSync(path, '{"feature":"f","recordedAt":"t","files":{"a.ts":"abc"}}');
		const expected = createHash("sha256").update(readFileSync(path)).digest("hex");
		expect(fingerprintManifestFile(path)).toBe(expected);
	});

	it("fingerprintManifestFile returns undefined for a missing file", () => {
		const root = tmpProject();
		expect(fingerprintManifestFile(join(root, "nonexistent.json"))).toBeUndefined();
	});
});
