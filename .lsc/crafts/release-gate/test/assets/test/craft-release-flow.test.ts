// W2 — production-wiring integration for the release-gate package (CS7). Unlike the
// unit suite (destructive-approval.test.ts / craft-release.test.ts), which exercises the
// pure reducers and slot mutators directly, this file proves the *registered tool
// execute* bodies are wired together correctly: it captures the real `lsc_confirm`,
// `lsc_verify_hash`, `lsc_run_tests`, and `lsc_craft_init` definitions through a mock `pi`
// (SDK-boundary double — the one sanctioned mock, per test/ask-schema.test.ts:1-42) and
// calls the captured `execute`s against a real tmpdir project — now INCLUDING the registered
// `lsc_craft_release` execute, so release consumption is verified through the actual tool boundary
// in the default Vitest layer, not a direct performCraftRelease call. A hand-assembled helper
// sequence would NOT count as wiring verification (plan §4 / CS7).
//
// The fixture channel is driven exactly the way the craft loop drives it — the LSC_FIXTURE
// env var (src/fixtures.ts) pointing at a scripted answers.json — so `lsc_confirm` yes/free
// answers flow through the identical performConfirm path a real omp run would (Constraint 6).
//
// PRE-CRAFT / RED EXPECTATION: the release-gate implementation does not exist yet. Every case
// below is written for the *post*-implementation contract (plan Steps 1-5), so against the
// current src/ they fail as INTENTED ASSERTION failures — e.g. the confirm wrapper issues no
// durable evidence, verify has no open-release gate, and performCraftRelease succeeds with no
// nonce. That RED is the correct test-first outcome; making it green is craft's job, not this
// stage's. (This file imports no not-yet-existing module, so the RED is assertion-shaped, not
// import-shaped.)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { registerAskTools } from "../src/ask";
import { craftDir, craftHashManifestPath, craftStatePath, craftTestDir } from "../src/artifacts/paths";
import { registerHashManifestTools } from "../src/craft/hash-manifest";
import { registerCraftReleaseTool } from "../src/craft/release";
import { registerRunTestsTool } from "../src/craft/run-tests";
import { clearActiveCraft, getActiveCraft } from "../src/craft/state";
import { LSC_FIXTURE_ENV, resetFixtureCache } from "../src/fixtures";

// ---------------------------------------------------------------------------
// Persisted-state schema (external JSON boundary → validated read, never an inline cast).
// A local mirror of plan §2's ReleaseApprovalEvidence/OpenReleaseEvidence so the test parses
// the durable ledger without importing CraftState (whose current shape lacks these fields —
// this file must compile before craft adds them). Unknown keys (projectRoot, testsPassed, …)
// are stripped by zod's default object behavior, so an old-shape file (no evidence) parses too.
// ---------------------------------------------------------------------------
const DiffSummarySchema = zod.object({
	added: zod.array(zod.string()),
	removed: zod.array(zod.string()),
	modified: zod.array(zod.string()),
});
const ReleaseApprovalSchema = zod.object({
	nonce: zod.string(),
	tag: zod.string(),
	question: zod.string(),
	response: zod.string(),
	issuedAt: zod.string(),
	consumedAt: zod.string().optional(),
});
const OpenReleaseSchema = zod.object({
	nonce: zod.string(),
	tag: zod.string(),
	question: zod.string(),
	response: zod.string(),
	reason: zod.string(),
	manifestFingerprint: zod.string().optional(),
	openedAt: zod.string(),
	closedAt: zod.string().optional(),
	rebaselineDiff: DiffSummarySchema.optional(),
});
const PersistedStateSchema = zod.object({
	feature: zod.string(),
	releaseApproval: ReleaseApprovalSchema.optional(),
	openRelease: OpenReleaseSchema.optional(),
});

// ---------------------------------------------------------------------------
// SDK-boundary test doubles
// ---------------------------------------------------------------------------
type ToolResult = AgentToolResult<unknown>;
interface RegisteredTool {
	name: string;
	execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: ExtensionContext,
	): Promise<ToolResult>;
}

type FixtureBody = { kind: "confirmation"; confirm: boolean } | { kind: "free-text"; freeText: string };

// The [Canon Amendment] gate question: bracketed tag prefix (the destructive-approval issue
// condition) + a "Proceed?" suffix (the tagging convention, C11). matchDestructiveGateTag keys
// off the tag prefix; the fixture rule below keys off the same prefix.
const GATE_QUESTION = "[Canon Amendment] Release hash protection to apply an approved test/ canon fix. Proceed?";
const GATE_MATCH = "^\\[Canon Amendment\\]";
const CANON_TAG = "[Canon Amendment]";

const cleanupDirs: string[] = [];
let savedFixtureEnv: string | undefined;

// ctx.ui is never reached in fixture mode; make any accidental use fail loudly rather than
// silently return undefined.
const unreachableUI = new Proxy(
	{},
	{
		get() {
			throw new Error("ctx.ui must not be reached — these cases drive the LSC_FIXTURE channel");
		},
	},
);

beforeEach(() => {
	// clearActiveCraft also invalidates the in-process pending-approval slot post-implementation
	// (state.ts transition wiring), so each case starts with no active craft and an empty slot.
	clearActiveCraft();
	resetFixtureCache();
	// Save + strip any ambient LSC_FIXTURE so this file is hermetic, restoring it in afterEach
	// (W1 parity, CS8) — a stray value would silently reroute channelFor to the fixture path.
	savedFixtureEnv = process.env[LSC_FIXTURE_ENV];
	delete process.env[LSC_FIXTURE_ENV];
});

afterEach(() => {
	clearActiveCraft();
	resetFixtureCache();
	if (savedFixtureEnv === undefined) delete process.env[LSC_FIXTURE_ENV];
	else process.env[LSC_FIXTURE_ENV] = savedFixtureEnv;
	while (cleanupDirs.length > 0) {
		const dir = cleanupDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

/** Register the real ask / hash-manifest / run-tests tools through a mock `pi`, capturing each definition by name. */
function buildTools(): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const pi = {
		zod,
		registerTool(def: RegisteredTool): void {
			tools.set(def.name, def);
		},
		// channelFor(pi, ctx) calls this; LSC_FIXTURE (env) takes priority so it returns undefined.
		getFlag(_name: string): string | undefined {
			return undefined;
		},
		// run-tests reads pi.exec only after its active-craft guard passes — never in the
		// open-release / no-active-craft cases below, so a throw here doubles as a guard.
		exec(): never {
			throw new Error("pi.exec must not run in an open-release / no-active-craft integration case");
		},
	};
	// Registration-time ExtensionAPI test double (zod + registerTool + getFlag + exec). Same
	// `as unknown as` shape the schema-capture precedent uses (test/ask-schema.test.ts:42).
	const api = pi as unknown as ExtensionAPI;
	registerAskTools(api);
	registerHashManifestTools(api);
	registerCraftReleaseTool(api);
	registerRunTestsTool(api);
	return tools;
}

/** Minimal ExtensionContext double: the tools read only ctx.cwd (init/verify/run-tests) and ctx.hasUI (ask channel). */
function makeCtx(root: string): ExtensionContext {
	const ctx = { cwd: root, hasUI: true, ui: unreachableUI };
	return ctx as unknown as ExtensionContext;
}

/** A tmpdir project with the pre-craft artifacts + a two-file protected test/ tree lsc_craft_init needs. */
function setupProject(feature: string): { root: string; testDir: string } {
	const root = mkdtempSync(join(tmpdir(), "lsc-release-flow-"));
	cleanupDirs.push(root);
	const featureDir = craftDir(root, feature);
	const testDir = craftTestDir(root, feature);
	mkdirSync(testDir, { recursive: true });
	writeFileSync(join(featureDir, "trace.md"), "seed trace\n");
	writeFileSync(join(featureDir, "spec.md"), "seed spec\n");
	writeFileSync(join(featureDir, "plan.md"), "seed plan\n");
	writeFileSync(join(testDir, "run_test.sh"), "#!/bin/sh\necho ok\n");
	writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 1\n");
	return { root, testDir };
}

/** Point LSC_FIXTURE at a scripted answers.json whose only rule answers the [Canon Amendment] gate. */
function writeFixture(root: string, body: FixtureBody): void {
	const path = join(root, "answers.json");
	writeFileSync(path, JSON.stringify({ version: 2, answers: [{ match: GATE_MATCH, ...body }] }));
	process.env[LSC_FIXTURE_ENV] = path;
	resetFixtureCache();
}

async function callTool(
	tools: Map<string, RegisteredTool>,
	name: string,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
): Promise<ToolResult> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`tool ${name} was not registered`);
	return tool.execute("test-call", params, undefined, undefined, ctx);
}

/** First text content block — checked `in`/typeof narrow (no reliance on the SDK content-union discriminant). */
function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (first && typeof first === "object" && "text" in first && typeof first.text === "string") return first.text;
	throw new Error("expected the first tool-result content item to be text");
}

/** The confirm result's `confirmed` field, read via a checked `in`/typeof narrow. */
function confirmedOf(result: ToolResult): unknown {
	const details = result.details;
	if (details && typeof details === "object" && "confirmed" in details) return details.confirmed;
	return undefined;
}

/** Re-read + validate the durable evidence ledger from disk (파일 재독, 필드별 단언). */
function readState(root: string, feature: string) {
	return PersistedStateSchema.parse(JSON.parse(readFileSync(craftStatePath(root, feature), "utf8")));
}

/**
 * Drive the full happy chain — actual init → actual confirm(yes) → performCraftRelease — leaving
 * the project in the open-release window (active craft cleared, .craft-state.json holds an
 * unclosed openRelease). The precondition for the AC3/AC4/AC5/CS4/CS5 cases below.
 */
async function armOpenRelease(
	feature: string,
	reason: string,
): Promise<{ root: string; testDir: string; tools: Map<string, RegisteredTool>; ctx: ExtensionContext }> {
	const { root, testDir } = setupProject(feature);
	const tools = buildTools();
	const ctx = makeCtx(root);

	const init = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
	expect(init.isError, textOf(init)).toBeFalsy();

	writeFixture(root, { kind: "confirmation", confirm: true });
	const confirm = await callTool(tools, "lsc_confirm", { question: GATE_QUESTION }, ctx);
	expect(confirm.isError, textOf(confirm)).toBeFalsy();

	const release = await callTool(tools, "lsc_craft_release", { reason }, ctx);
	expect(release.isError, textOf(release)).toBeFalsy();
	return { root, testDir, tools, ctx };
}

describe("release-gate production wiring (actual registered tool execution)", () => {
	// AC1 —무승인 거부: an active craft, but no confirm ever issued a nonce → release fail-closed.
	it("rejects performCraftRelease fail-closed when no confirm approval was issued (AC1)", async () => {
		const feature = "release-flow-noapproval";
		const { root } = setupProject(feature);
		const tools = buildTools();
		const ctx = makeCtx(root);

		const init = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(init.isError, textOf(init)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe(feature);

		const release = await callTool(tools, "lsc_craft_release", { reason: "attempt to release without any prior approval" }, ctx);
		expect(release.isError, "release with no issued approval must be rejected").toBe(true);
		// a rejected release must NOT clear hash-protection
		expect(getActiveCraft()?.feature).toBe(feature);
	});

	// AC2 — 승인 직후 성공: actual confirm(yes) commits durable issuance evidence, then release consumes it.
	it("commits durable issuance evidence on an actual confirm yes, then performCraftRelease succeeds (AC2)", async () => {
		const feature = "release-flow-happy";
		const { root } = setupProject(feature);
		const tools = buildTools();
		const ctx = makeCtx(root);

		const init = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(init.isError, textOf(init)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe(feature);

		writeFixture(root, { kind: "confirmation", confirm: true });
		const confirm = await callTool(tools, "lsc_confirm", { question: GATE_QUESTION }, ctx);
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(confirmedOf(confirm)).toBe(true);

		// durable issuance evidence committed (파일 재독) — field-by-field
		const approval = readState(root, feature).releaseApproval;
		expect(approval, "confirm yes must persist releaseApproval evidence").toBeDefined();
		expect(approval?.tag).toBe(CANON_TAG);
		expect(approval?.question).toBe(GATE_QUESTION);
		expect(approval?.response).toBe("yes");
		expect(approval?.nonce.length ?? 0).toBeGreaterThan(0);
		expect(typeof approval?.issuedAt).toBe("string");
		expect(approval?.consumedAt).toBeUndefined();

		// consume: performCraftRelease direct call (the registered lsc_craft_release execute body)
		const reason = "user approved the sample.test.ts canon fix via lsc_confirm";
		const release = await callTool(tools, "lsc_craft_release", { reason }, ctx);
		expect(release.isError, textOf(release)).toBeFalsy();
		expect(release.details).toEqual({ feature, reason });
		expect(getActiveCraft()).toBeUndefined();

		// open-release evidence pre-recorded + consumedAt stamped (파일 재독)
		const after = readState(root, feature);
		expect(after.releaseApproval?.consumedAt, "release must stamp consumedAt on the approval").toBeDefined();
		const open = after.openRelease;
		expect(open, "release must pre-record open-release evidence").toBeDefined();
		expect(open?.nonce).toBe(approval?.nonce); // same tag-bound nonce
		expect(open?.tag).toBe(CANON_TAG);
		expect(open?.question).toBe(GATE_QUESTION);
		expect(open?.response).toBe("yes");
		expect(open?.reason).toBe(reason);
		expect(typeof open?.openedAt).toBe("string");
		expect(open?.closedAt).toBeUndefined(); // open until re-init closes it
		expect(typeof open?.manifestFingerprint).toBe("string"); // fingerprint captured (manifest existed)
	});

	// AC3 — 일회용: the consumed nonce cannot be reused. Re-init makes a craft active again, but
	// without a fresh confirm the slot is empty, so the second release is rejected.
	it("treats the nonce as single-use: re-init then release with no fresh confirm is rejected (AC3)", async () => {
		const feature = "release-flow-singleuse";
		const { root, testDir, tools, ctx } = await armOpenRelease(feature, "first approved fix");
		expect(getActiveCraft()).toBeUndefined(); // first release consumed the nonce + cleared the craft

		writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 2\n");
		const reinit = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(reinit.isError, textOf(reinit)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe(feature);

		const second = await callTool(tools, "lsc_craft_release", { reason: "attempt to reuse the already-consumed approval" }, ctx);
		expect(second.isError, "release with an already-consumed nonce must be rejected").toBe(true);
		expect(getActiveCraft()?.feature).toBe(feature); // craft stays protected
	});

	// AC4 — open-release 봉쇄: the actual verify gate rejects during the open window, and run-tests
	// upgrades its guard to the same re-baseline guidance. This is the required AC4 defense (CS7).
	it("rejects actual verify_hash and run_tests while the open-release is unclosed, with re-baseline guidance (AC4)", async () => {
		const feature = "release-flow-openwindow";
		const { tools, ctx } = await armOpenRelease(feature, "approved fix, window open");

		const verify = await callTool(tools, "lsc_verify_hash", { feature_dir: feature }, ctx);
		const run = await callTool(tools, "lsc_run_tests", { feature_dir: feature }, ctx);

		// the NEW verify gate must reject (current verify never sets isError here)
		expect(verify.isError, "verify must reject while the open-release is unclosed").toBe(true);
		expect(textOf(verify)).toContain("lsc_craft_init");
		// run-tests must also reject with re-baseline guidance
		expect(run.isError, "run_tests must reject while the open-release is unclosed").toBe(true);
		expect(textOf(run)).toContain("lsc_craft_init");
		// both surfaces emit the one shared openReleaseGuidance string (current: verify=success /
		// run_tests="no active craft" differ; post: byte-identical guidance)
		expect(textOf(verify)).toBe(textOf(run));
	});

	// AC5 — 재베이스라인 복귀 (close + diff): the actual init path (not a manual closeOpenRelease) reads
	// the old manifest first and records the real changed files, then closes the window.
	it("closes the open-release and records the real changed files in rebaselineDiff via actual init (AC5)", async () => {
		const feature = "release-flow-reinit";
		const { root, testDir, tools, ctx } = await armOpenRelease(feature, "approved slugify canon fix");

		// the approved canon edit: modify one protected file, add another
		writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 2 — approved edit\n");
		writeFileSync(join(testDir, "added-case.test.ts"), "// brand new approved case\n");

		const reinit = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(reinit.isError, textOf(reinit)).toBeFalsy();
		expect(getActiveCraft()?.feature).toBe(feature);

		const open = readState(root, feature).openRelease;
		expect(open, "re-init must retain the (now closed) open-release evidence").toBeDefined();
		expect(typeof open?.closedAt).toBe("string"); // closed
		expect(open?.rebaselineDiff, "re-init must record the old→new manifest diff").toBeDefined();
		expect(open?.rebaselineDiff?.modified).toContain("sample.test.ts"); // the real changed file
		expect(open?.rebaselineDiff?.added).toContain("added-case.test.ts"); // the real added file
	});

	// AC5 — 판정 해제: once init has re-baselined and re-activated the craft, the gate must not
	// over-fire — verify returns to success.
	it("returns lsc_verify_hash to success once init has re-baselined and closed the open-release (AC5)", async () => {
		const feature = "release-flow-return";
		const { testDir, tools, ctx } = await armOpenRelease(feature, "approved fix, will re-init");

		writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 2\n");
		const reinit = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(reinit.isError, textOf(reinit)).toBeFalsy();

		const verify = await callTool(tools, "lsc_verify_hash", { feature_dir: feature }, ctx);
		expect(verify.isError, textOf(verify)).toBeFalsy();
		expect(textOf(verify)).toContain("hash verification passed");

		clearActiveCraft();
		const inactiveVerify = await callTool(tools, "lsc_verify_hash", { feature_dir: feature }, ctx);
		expect(inactiveVerify.isError, textOf(inactiveVerify)).toBeFalsy();
		expect(textOf(inactiveVerify)).toContain("hash verification passed");

		const inactiveRun = await callTool(tools, "lsc_run_tests", { feature_dir: feature }, ctx);
		expect(inactiveRun.isError).toBe(true);
		expect(textOf(inactiveRun)).toBe(
			`lets-craft: no active craft for "${feature}". Call lsc_craft_init first.`,
		);
	});

	// CS7 — legacy actual guard: a legacy .craft-state.json (no open-release) with no active craft
	// must make the ACTUAL registered lsc_run_tests execute return the pre-existing no-active-craft
	// string verbatim — the legacy branch verified through the real tool, not a re-typed ternary.
	it("run_tests returns the exact legacy no-active-craft guard for a legacy state with no open-release (AC6, CS7)", async () => {
		const feature = "release-flow-legacy";
		const { root } = setupProject(feature);
		const tools = buildTools();
		const ctx = makeCtx(root);

		// A legacy state file: no releaseApproval / openRelease keys, and no active craft in memory.
		writeFileSync(
			craftStatePath(root, feature),
			JSON.stringify({ feature, projectRoot: root, testsPassed: false, aborted: false }),
		);

		const run = await callTool(tools, "lsc_run_tests", { feature_dir: feature }, ctx);
		expect(run.isError).toBe(true);
		expect(textOf(run)).toBe(`lets-craft: no active craft for "${feature}". Call lsc_craft_init first.`);
	});

	// CS4 — 증거 보존: a second re-init must not erase the audit trail; the consumed approval and
	// the closed open-release (with its original diff) survive.
	it("preserves the consumed approval and closed open-release evidence across a second actual init (CS4)", async () => {
		const feature = "release-flow-retention";
		const { root, testDir, tools, ctx } = await armOpenRelease(feature, "approved fix for retention");

		writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 2\n");
		const reinit1 = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(reinit1.isError, textOf(reinit1)).toBeFalsy();
		const afterFirst = readState(root, feature);
		expect(afterFirst.openRelease?.closedAt, "first re-init must close the open-release").toBeDefined();
		expect(afterFirst.openRelease?.rebaselineDiff?.modified).toContain("sample.test.ts");

		// second re-init, no further canon change — must keep the audit evidence, not reset it
		const reinit2 = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(reinit2.isError, textOf(reinit2)).toBeFalsy();

		const afterSecond = readState(root, feature);
		expect(afterSecond.releaseApproval?.consumedAt, "consumed approval must survive a 2nd init").toBeDefined();
		expect(afterSecond.releaseApproval?.tag).toBe(CANON_TAG);
		expect(afterSecond.openRelease?.closedAt, "closed open-release must survive a 2nd init").toBeDefined();
		// the ORIGINAL diff is carried forward, not recomputed to empty by the no-op 2nd re-baseline
		expect(afterSecond.openRelease?.rebaselineDiff?.modified).toContain("sample.test.ts");
	});

	// CS5 — fail-closed at the state-persist commit point: re-init's manifest atomic-save completes,
	// but the craft-state atomic write fails, so the craft must stay unpublished and the open-release
	// must remain open (verify keeps rejecting). The failure is induced deterministically by pinning
	// Date.now and pre-creating a DIRECTORY at the state writer's `{basename}.{pid}.{Date.now()}.tmp`
	// path (atomic-write.ts), so only the state temp collides — not the earlier manifest write. This
	// reaches the exact persist-before-publish commit point a chmod-the-whole-dir probe cannot.
	it("leaves the craft unpublished and the open-release still gating when a re-init state write fails (CS5)", async () => {
		const feature = "release-flow-failclosed";
		const { root, testDir, tools, ctx } = await armOpenRelease(feature, "approved fix, state write will fail");
		const manifestPath = craftHashManifestPath(root, feature);
		const manifestBefore = readFileSync(manifestPath, "utf8");
		writeFileSync(join(testDir, "sample.test.ts"), "// canon revision 2\n");

		const fixedNow = 1_700_000_000_000;
		const stateTmpCollision = `${craftStatePath(root, feature)}.${process.pid}.${fixedNow}.tmp`;
		mkdirSync(stateTmpCollision); // directory: only the state atomic temp path collides
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
		let reinitFailed = false;
		try {
			const reinit = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
			reinitFailed = reinit.isError === true;
		} catch {
			reinitFailed = true;
		} finally {
			nowSpy.mockRestore();
		}

		expect(reinitFailed).toBe(true);
		expect(readFileSync(manifestPath, "utf8")).not.toBe(manifestBefore); // manifest stage completed
		expect(getActiveCraft()).toBeUndefined();
		const state = readState(root, feature);
		expect(state.openRelease).toBeDefined();
		expect(state.openRelease?.closedAt).toBeUndefined();
		const verify = await callTool(tools, "lsc_verify_hash", { feature_dir: feature }, ctx);
		expect(verify.isError).toBe(true);
		expect(textOf(verify)).toContain("lsc_craft_init");
	});

	// C6 — fixture 동일 경로: a free-text answer on the same gate (a re-run through the identical
	// LSC_FIXTURE channel) is not a platform yes, so nothing is issued and release is rejected.
	it("issues nothing on a free-answer confirm through the fixture channel, so release is rejected (C6)", async () => {
		const feature = "release-flow-freeanswer";
		const { root } = setupProject(feature);
		const tools = buildTools();
		const ctx = makeCtx(root);

		const init = await callTool(tools, "lsc_craft_init", { feature_dir: feature }, ctx);
		expect(init.isError, textOf(init)).toBeFalsy();

		// same channel, but a free-text answer on the gate — not a platform yes
		writeFixture(root, { kind: "free-text", freeText: "clarify the exact scope before releasing" });
		const confirm = await callTool(tools, "lsc_confirm", { question: GATE_QUESTION }, ctx);
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(confirmedOf(confirm)).toBeNull(); // free answer, not a yes

		// no durable issuance evidence committed
		expect(readState(root, feature).releaseApproval).toBeUndefined();

		// and no nonce in the slot → release is rejected fail-closed, craft stays protected
		const release = await callTool(tools, "lsc_craft_release", { reason: "release attempted after a free-answer, not a yes" }, ctx);
		expect(release.isError, "release after a free-answer confirm must be rejected").toBe(true);
		expect(getActiveCraft()?.feature).toBe(feature);
	});
});
