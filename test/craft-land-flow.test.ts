// W2-a — production-seam integration for lsc_land (deferred-pool AC1/AC2/AC3, plan §6 Step 3a/3b,
// appendix-test-plan W2-a, appendix-security-land T6-T14, appendix-pre-mortem P1/P6/P7/P8).
//
// Unlike the pure/unit layer (craft-state / research-ledger / doctor evaluate, owned by the unit
// testers), this file proves the ACTUALLY-REGISTERED tool execute bodies are wired together: it
// captures the real `lsc_confirm` (ask.ts) and `lsc_land` (land.ts) definitions through an
// SDK-boundary mock `pi` (the one sanctioned double — precedent test/ask-schema.test.ts,
// test/destructive-approval.test.ts captureConfirmExecute) and drives them against a real
// mkdtemp git repo + worktree fixture. The full 2-phase land flow (Phase R preflight → Phase C/P
// consume-or-issue → Phase X effects) runs as shipped, not hand-reassembled (plan §4 driver 1:
// "AC 전부가 production seam에서 기계 검증").
//
// Conventions (trace Lane 5 / appendix header): no business mocks or snapshots; real singletons +
// mkdtempSync(tmpdir()); per-field assertions; invalidatePendingApproval()/invalidatePreparedOperation()/
// clearActiveCraft() reset before and after each test; LSC_FIXTURE neutralized so the captured
// confirm drives its UI channel deterministically (destructive-approval.test.ts:63-82).
//
// PRE-CRAFT / RED EXPECTATION: src/craft/land.ts does not exist yet, and the prepared-operation
// slot (destructive-approval.ts) / recordReleaseApprovalAt (state.ts) are not written — so against
// the current src/ this whole file fails to LOAD (import-shaped RED on `../src/craft/land`). That
// RED is the correct test-first outcome; making it green is craft's job, not this stage's
// (acceptance: "지금은 import-RED 정상"). Every case below encodes the POST-implementation contract
// (plan §6 Step 3b's 18 public reason codes + spec AC1/AC2/AC3).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftAuditDir, craftAuditPath, craftStatePath, craftTestDir, craftTestLogsDir, worktreePath } from "../src/artifacts/paths";
import { OTHER_OPTION, type SelectUI, registerAskTools } from "../src/ask";
import {
	type ApprovalCraftIdentity,
	consumePendingApproval,
	type DestructiveGateTag,
	invalidatePendingApproval,
	// NEW (Step 3a prepared-operation issuance seam) — resolves to undefined until craft adds it.
	invalidatePreparedOperation,
	peekPendingApproval,
	peekPreparedOperation,
} from "../src/craft/destructive-approval";
// NEW MODULE (Step 3b) — the import that makes this file import-RED pre-craft.
import { LAND_REASON_CODES, type LandEffects, registerLandTool } from "../src/craft/land";
import { type CraftState, clearActiveCraft, getActiveCraft, setActiveCraft } from "../src/craft/state";
// NEW (Step 2) — the removal-observation shape the injected LandEffects.inspectRemovalTarget produces.
import type { RemovalObservation } from "../src/artifacts/worktree";

const LAND_TAG: DestructiveGateTag = "[Land]";

// The public reason-code vocabulary land reports in its isError message text so a caller (and the
// post-craft skill's [Land] re-prompt) can distinguish WHY a land failed (appendix observability,
// plan §6 Step 3b — `no-pending-approval` intentionally removed as unreachable under the 2-phase rule).
const EXPECTED_REASON_CODES = [
	"no-audit-evidence",
	"no-audit-cycle",
	"cycle-mismatch",
	"verdict-not-approve",
	"stale-run-log",
	"evidence-tamper",
	"evidence-mismatch",
	"approval-required",
	"scope-mismatch",
	"identity-mismatch",
	"self-merge",
	"not-registered",
	"target-dirty",
	"merge-aborted",
	"merge-recovery-failed",
	"merged-but-not-cleaned",
	"cleaned-but-not-pruned",
	"validation-reject",
] as const;

// ── SDK-boundary doubles (capture the real registered executes) ──────────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}
type ToolExecute = (
	toolCallId: string,
	params: Record<string, unknown>,
	signal: unknown,
	onUpdate: unknown,
	ctx: { cwd: string; hasUI: boolean; ui: SelectUI },
) => Promise<ToolResultLike>;
interface RegisteredTool {
	name: string;
	execute: ToolExecute;
}

function isRegisteredTool(value: unknown): value is RegisteredTool {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"execute" in value &&
		typeof value.execute === "function"
	);
}

/** Register the real ask + land tools through a mock `pi`, capturing each definition by name (production wiring). */
function buildTools(effects?: Partial<LandEffects>): Map<string, RegisteredTool> {
	const tools = new Map<string, RegisteredTool>();
	const pi = {
		zod,
		// channelFor(pi, ctx) consults this; returning undefined keeps the confirm on the UI channel
		// (LSC_FIXTURE is stripped in beforeEach), so makeUI(["Yes"]) answers it.
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (isRegisteredTool(definition)) tools.set(definition.name, definition);
		},
	};
	const api = pi as unknown as Parameters<typeof registerAskTools>[0];
	registerAskTools(api);
	registerLandTool(api, effects);
	return tools;
}

// A scripted SelectUI (destructive-approval.test.ts makeUI shape): select()/editor() drain in order.
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

// land never prompts (it returns approval-required for the skill to prompt), so its ctx.ui must
// never be touched — make any accidental use fail loudly instead of silently returning undefined.
const unreachableUI = new Proxy({} as SelectUI, {
	get() {
		throw new Error("lsc_land must not touch ctx.ui — it returns approval-required for the skill to prompt");
	},
});

function makeCtx(cwd: string, ui: SelectUI = unreachableUI): { cwd: string; hasUI: boolean; ui: SelectUI } {
	return { cwd, hasUI: true, ui };
}

async function callTool(tools: Map<string, RegisteredTool>, name: string, params: Record<string, unknown>, ctx: { cwd: string; hasUI: boolean; ui: SelectUI }): Promise<ToolResultLike> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`tool ${name} was not registered`);
	return tool.execute("test-call", params, undefined, undefined, ctx);
}

function textOf(result: ToolResultLike): string {
	const first = result.content?.[0];
	if (first && typeof first === "object" && "text" in first && typeof first.text === "string") return first.text;
	throw new Error("expected the first tool-result content item to be text");
}

// ── git fixture (real mkdtemp repo — no repo pollution, isolated per test) ────
const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
	invalidatePendingApproval();
	invalidatePreparedOperation();
	clearActiveCraft();
});

afterEach(() => {
	invalidatePendingApproval();
	invalidatePreparedOperation();
	clearActiveCraft();
	if (savedFixtureEnv === undefined) delete process.env.LSC_FIXTURE;
	else process.env.LSC_FIXTURE = savedFixtureEnv;
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tmpGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-land-"));
	tempDirs.push(dir);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "seed\n");
	// Ignore .lsc/ so the runtime evidence (state/audit/logs) written into the worktree stays ignored:
	// verified that ignored files never block `git worktree remove` while untracked/modified ones do,
	// so merge-and-clean's no-force removal only succeeds when the worktree is clean of NON-ignored dirt.
	writeFileSync(join(dir, ".gitignore"), ".lsc/\n");
	git(dir, ["add", "README.md", ".gitignore"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

interface PersistedState {
	feature: string;
	projectRoot: string;
	worktreeRoot: string;
	aborted: boolean;
	stateVersion?: number;
	auditCycle?: number;
	runLogAtCycleStart?: number;
	auditValidated?: { cycle: number; verdict: string; at: string };
}

const PersistedStateSchema = zod.object({
	feature: zod.string(),
	projectRoot: zod.string(),
	worktreeRoot: zod.string().optional(),
	releaseApproval: zod
		.object({ nonce: zod.string(), tag: zod.string(), question: zod.string(), response: zod.string(), issuedAt: zod.string(), consumedAt: zod.string().optional(), operationScope: zod.record(zod.string(), zod.unknown()).optional() })
		.optional(),
});

interface FeatureOpts {
	feature?: string;
	auditNumber?: number | null; // null => write no audit-N.md (no-audit-evidence)
	auditVerdict?: string; // default APPROVE
	auditCycle?: number | null; // null => omit auditCycle from state (no-audit-cycle)
	runLogAtCycleStart?: number | null; // null => omit threshold from state
	freshLogNumber?: number | null; // null => write no fresh passing run-N.log (stale-run-log)
	auditValidated?: { cycle: number; verdict: string } | null; // marker (default absent = WARN pass)
	stateProjectRoot?: string; // override for evidence-mismatch anchor test
	stateWorktreeRoot?: string;
	stateFeature?: string;
	makeDirtyWorktree?: boolean; // add an untracked file so `git worktree remove` (no --force) fails
	freshLogPassing?: boolean; // false => the post-threshold run-N.log is a FAILING transcript (exit 1) → stale-run-log
}

interface LandFixture {
	projectRoot: string;
	worktreeRoot: string;
	feature: string;
	sourceBranch: string;
	sourceOID: string;
	targetOID: string;
	stateFilePath: string;
}

/** A real git repo + registered worktree carrying (by default) fully-valid land evidence, committed
 * so the worktree stays git-clean for a no-force merge-and-clean removal. Options degrade exactly
 * one dimension to drive an AC1 rejection arm. */
function setupLandableFeature(opts: FeatureOpts = {}): LandFixture {
	const projectRoot = tmpGitRepo();
	const feature = opts.feature ?? "demo-feat";
	const sourceBranch = `lets-craft/${feature}`;
	const worktreeRoot = worktreePath(projectRoot, feature);
	git(projectRoot, ["worktree", "add", "-q", "-b", sourceBranch, worktreeRoot, "HEAD"]);

	// A real feature source change so the branch is ahead of main and --no-ff produces a merge commit.
	writeFileSync(join(worktreeRoot, "feature.txt"), "feature work\n");

	// Audit evidence (verdict + fresh passing run log) inside the worktree — land's audit root.
	const auditNumber = opts.auditNumber === undefined ? 1 : opts.auditNumber;
	if (auditNumber !== null) {
		mkdirSync(craftAuditDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(craftAuditPath(worktreeRoot, feature, auditNumber), `# audit-${auditNumber}\n\n**AUDIT VERDICT: ${opts.auditVerdict ?? "APPROVE"}**\n\nverified.\n`);
	}
	const freshLog = opts.freshLogNumber === undefined ? 2 : opts.freshLogNumber;
	if (freshLog !== null) {
		mkdirSync(craftTestLogsDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(join(craftTestLogsDir(worktreeRoot, feature), `run-${freshLog}.log`), `$ bash run_test.sh\ncwd: ${worktreeRoot}\n${opts.freshLogPassing === false ? "FAIL\n--- exit 1 ---" : "ok\n--- exit 0 ---"}\n`);
	}

	// Persisted craft state (anchor evidence + audit cycle markers).
	const state: PersistedState = {
		feature: opts.stateFeature ?? feature,
		projectRoot: opts.stateProjectRoot ?? projectRoot,
		worktreeRoot: opts.stateWorktreeRoot ?? worktreeRoot,
		aborted: false,
		stateVersion: 1,
	};
	const auditCycle = opts.auditCycle === undefined ? 1 : opts.auditCycle;
	if (auditCycle !== null) state.auditCycle = auditCycle;
	const threshold = opts.runLogAtCycleStart === undefined ? 1 : opts.runLogAtCycleStart;
	if (threshold !== null) state.runLogAtCycleStart = threshold;
	if (opts.auditValidated) state.auditValidated = { ...opts.auditValidated, at: new Date().toISOString() };

	mkdirSync(craftTestDir(worktreeRoot, feature), { recursive: true });
	const stateFilePath = craftStatePath(worktreeRoot, feature);
	writeFileSync(stateFilePath, JSON.stringify(state, null, 2));

	// Commit everything so the worktree is clean (no-force removal). Ignored/untracked evidence
	// would otherwise force merge-and-clean into merged-but-not-cleaned in the happy case.
	git(worktreeRoot, ["add", "-A"]);
	git(worktreeRoot, ["commit", "-q", "-m", "feat: work + land evidence"]);
	if (opts.makeDirtyWorktree) writeFileSync(join(worktreeRoot, "uncommitted.txt"), "dirty\n");

	return {
		projectRoot,
		worktreeRoot,
		feature,
		sourceBranch,
		sourceOID: git(worktreeRoot, ["rev-parse", "HEAD"]),
		targetOID: git(projectRoot, ["rev-parse", "HEAD"]),
		stateFilePath,
	};
}

/** Drive Phase R→C/P once with no pending approval, then answer the emitted [Land] question yes so a
 * scoped pending is issued through the REAL confirm execute (fresh-session prepared-operation path). */
async function issueLandApproval(tools: Map<string, RegisteredTool>, fx: LandFixture, mode?: string): Promise<{ approvalQuestion: string }> {
	const first = await callTool(tools, "lsc_land", mode ? { feature: fx.feature, mode } : { feature: fx.feature }, makeCtx(fx.projectRoot));
	expect(first.isError, textOf(first)).toBe(true);
	expect(textOf(first)).toContain("approval-required");
	const prepared = peekPreparedOperation(LAND_TAG);
	expect(prepared, "Phase C/P must install a prepared-operation envelope on a consume miss").not.toBeUndefined();
	const approvalQuestion = prepared?.approvalQuestion ?? "";
	expect(approvalQuestion.startsWith("[Land]"), "approvalQuestion must be a [Land]-tagged prompt").toBe(true);

	const confirm = await callTool(tools, "lsc_confirm", { question: approvalQuestion }, makeCtx(fx.projectRoot, makeUI(["Yes"])));
	expect(confirm.isError, textOf(confirm)).toBeFalsy();
	const pending = peekPendingApproval();
	expect(pending?.tag, "a [Land] pending approval must be live after the yes confirm").toBe("[Land]");
	return { approvalQuestion };
}

function isAncestor(projectRoot: string, oid: string): boolean {
	try {
		execFileSync("git", ["merge-base", "--is-ancestor", oid, "HEAD"], { cwd: projectRoot });
		return true;
	} catch {
		return false;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// AC2 — production issuance → consume → land (fresh session, no active craft)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — AC2 production approval path (real confirm execute + fixture git repo)", () => {
	it("issues a fresh-session [Land] approval then merges the approved sourceOID, removes the worktree, and prunes", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature();
		expect(getActiveCraft(), "AC2 precondition: fresh session, no active craft").toBeUndefined();

		// Seed a STALE prunable worktree admin entry — only `git worktree prune` (never `worktree remove`)
		// clears it, so its post-land absence discriminates a real prune from a bare remove (M1/rec2).
		const stalePrune = worktreePath(fx.projectRoot, "stale-prune");
		git(fx.projectRoot, ["worktree", "add", "-q", "--detach", stalePrune, "HEAD"]);
		const staleAdmin = git(stalePrune, ["rev-parse", "--absolute-git-dir"]);
		rmSync(stalePrune, { recursive: true, force: true });
		expect(existsSync(staleAdmin), "stale prunable metadata exists before land").toBe(true);

		const { approvalQuestion } = await issueLandApproval(tools, fx);
		// persist-before-install: the durable evidence is committed at the prepared envelope's root
		// before the pending goes live (P7).
		expect(PersistedStateSchema.parse(JSON.parse(readFileSync(craftStatePath(fx.worktreeRoot, fx.feature), "utf8"))).releaseApproval?.tag).toBe("[Land]");
		expect(peekPendingApproval()?.question).toBe(approvalQuestion);

		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError, textOf(land)).toBeFalsy();

		// --no-ff merge of the APPROVED sourceOID: a fast-forward would leave HEAD === sourceOID with a
		// single-parent HEAD, so a 2-parent merge commit distinct from sourceOID proves --no-ff (M1/rec2).
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "approved sourceOID must be merged into HEAD").toBe(true);
		const headOID = git(fx.projectRoot, ["rev-parse", "HEAD"]);
		expect(headOID, "a --no-ff merge advances HEAD past the pre-merge target").not.toBe(fx.targetOID);
		expect(headOID, "a --no-ff merge commit is distinct from the source tip (never a fast-forward)").not.toBe(fx.sourceOID);
		const mergeParents = git(fx.projectRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]).split(/\s+/).filter(Boolean);
		expect(mergeParents.length, "--no-ff produces a 2-parent merge commit").toBe(3);
		// ...worktree removed + unregistered, AND the seeded stale metadata pruned (prune actually ran).
		expect(existsSync(fx.worktreeRoot)).toBe(false);
		expect(git(fx.projectRoot, ["worktree", "list", "--porcelain"]).includes(`.lsc/worktrees/${fx.feature}`), "the feature worktree is unregistered").toBe(false);
		expect(existsSync(staleAdmin), "land runs `git worktree prune`, clearing stale metadata").toBe(false);
		// single-use nonce burned by the successful consume.
		expect(peekPendingApproval()).toBeUndefined();
	});

	it("issues via the craft-bound path when a same-identity active craft is present (same-session), then lands", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "same-session" });
		setActiveCraft({ feature: fx.feature, projectRoot: fx.projectRoot, worktreeRoot: fx.worktreeRoot, aborted: false } as CraftState);

		await issueLandApproval(tools, fx);
		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError, textOf(land)).toBeFalsy();
		expect(isAncestor(fx.projectRoot, fx.sourceOID)).toBe(true);
		expect(existsSync(fx.worktreeRoot)).toBe(false);
	});

	it("does not issue when a cross-feature prepare replaced the slot (exact question + prepareId binding, T10)", async () => {
		const tools = buildTools();
		const projectRoot = tmpGitRepo();
		// Two landable features in one repo; each land call installs/replaces the single [Land] slot.
		const fxA = setupLandableFeatureIn(projectRoot, "feat-a");
		const fxB = setupLandableFeatureIn(projectRoot, "feat-b");

		const a = await callTool(tools, "lsc_land", { feature: fxA.feature }, makeCtx(projectRoot));
		expect(a.isError).toBe(true);
		const questionA = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "A";

		const b = await callTool(tools, "lsc_land", { feature: fxB.feature }, makeCtx(projectRoot));
		expect(b.isError).toBe(true);
		const preparedB = peekPreparedOperation(LAND_TAG);
		expect(preparedB?.approvalQuestion, "the second land replaces the prepared envelope").not.toBe(questionA);
		const prepareIdB = preparedB?.prepareId;
		expect(typeof prepareIdB, "B installed its own prepared envelope").toBe("string");

		// Answering A's now-stale question must NOT issue anything (confused-deputy barrier)...
		const confirm = await callTool(tools, "lsc_confirm", { question: questionA }, makeCtx(projectRoot, makeUI(["Yes"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(peekPendingApproval(), "a stale cross-feature question must issue no capability").toBeUndefined();
		// ...and B's live prepared slot must survive intact (same prepareId), not be cleared by A's stale answer.
		expect(peekPreparedOperation(LAND_TAG)?.prepareId, "B's prepared envelope is preserved through a stale A confirm").toBe(prepareIdB);
	});

	it("a prepare that replaces the slot DURING A's confirm await → A issues nothing, B's prepared slot survives (await-race, T10)", async () => {
		const tools = buildTools();
		const projectRoot = tmpGitRepo();
		const fxA = setupLandableFeatureIn(projectRoot, "race-a");
		const fxB = setupLandableFeatureIn(projectRoot, "race-b");

		// A issues its prepared envelope first.
		const a = await callTool(tools, "lsc_land", { feature: fxA.feature }, makeCtx(projectRoot));
		expect(a.isError).toBe(true);
		const questionA = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		expect(questionA.startsWith("[Land]")).toBe(true);

		// A race UI: while A's confirm awaits the answer, B's lsc_land runs and REPLACES the single [Land]
		// slot; only then does A's select() resolve "Yes". A must not consume B's freshly-installed envelope.
		let prepareIdB: string | undefined;
		const raceUI: SelectUI = {
			async select() {
				const b = await callTool(tools, "lsc_land", { feature: fxB.feature }, makeCtx(projectRoot));
				expect(b.isError).toBe(true);
				prepareIdB = peekPreparedOperation(LAND_TAG)?.prepareId;
				return "Yes";
			},
			async editor() {
				return undefined;
			},
		};

		const confirm = await callTool(tools, "lsc_confirm", { question: questionA }, makeCtx(projectRoot, raceUI));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(prepareIdB, "B installed its prepared envelope during A's await").toBeTruthy();
		// A answered a question whose slot was replaced mid-await → no capability issued for the stale question...
		expect(peekPendingApproval(), "a slot replaced mid-await must issue no capability for the stale question").toBeUndefined();
		// ...and B's prepared envelope survives A's stale Yes.
		expect(peekPreparedOperation(LAND_TAG)?.prepareId, "B's prepared envelope survives A's mid-await Yes").toBe(prepareIdB);
	});

	it("does not issue a pending on a `no` to the [Land] question (fresh-session)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "no-answer" });
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const question = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";

		const confirm = await callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI(["No"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(peekPendingApproval(), "a `no` answer must issue no [Land] capability").toBeUndefined();
		expect(peekPreparedOperation(LAND_TAG), "a `no` answer clears the captured prepared entry").toBeUndefined();
	});

	it("installs neither the pending nor durable evidence when the issuance write fails (persist-before-install, P7)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "persist-fail" });
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const question = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";

		// Replace the state file with a DIRECTORY so recordReleaseApprovalAt's read/write throws
		// (EISDIR) — a uid-independent forced write failure (destructive-approval.test.ts breakPersistPath idiom).
		rmSync(fx.stateFilePath, { force: true });
		mkdirSync(fx.stateFilePath, { recursive: true });

		await expect(callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI(["Yes"])))).rejects.toThrow();
		expect(peekPendingApproval(), "no live capability may be installed when the durable write fails").toBeUndefined();
	});
});

/** Same as setupLandableFeature but into an EXISTING projectRoot (for multi-feature cross-talk tests). */
function setupLandableFeatureIn(projectRoot: string, feature: string): LandFixture {
	const sourceBranch = `lets-craft/${feature}`;
	const worktreeRoot = worktreePath(projectRoot, feature);
	git(projectRoot, ["worktree", "add", "-q", "-b", sourceBranch, worktreeRoot, "HEAD"]);
	writeFileSync(join(worktreeRoot, `${feature}.txt`), "work\n");
	mkdirSync(craftAuditDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(craftAuditPath(worktreeRoot, feature, 1), "# audit-1\n\n**AUDIT VERDICT: APPROVE**\n\nverified.\n");
	mkdirSync(craftTestLogsDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(join(craftTestLogsDir(worktreeRoot, feature), "run-2.log"), "$ bash run_test.sh\n--- exit 0 ---\n");
	mkdirSync(craftTestDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(
		craftStatePath(worktreeRoot, feature),
		JSON.stringify({ feature, projectRoot, worktreeRoot, aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }),
	);
	git(worktreeRoot, ["add", "-A"]);
	git(worktreeRoot, ["commit", "-q", "-m", `feat: ${feature}`]);
	return { projectRoot, worktreeRoot, feature, sourceBranch, sourceOID: git(worktreeRoot, ["rev-parse", "HEAD"]), targetOID: git(projectRoot, ["rev-parse", "HEAD"]), stateFilePath: craftStatePath(worktreeRoot, feature) };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC1 — fail-closed rejection matrix (Phase R preflight, nonce not consumed)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — AC1 fail-closed rejection (Phase R, distinct reason codes)", () => {
	async function landOnce(fx: LandFixture): Promise<ToolResultLike> {
		return callTool(buildTools(), "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
	}

	it("valid evidence but no pending approval → approval-required (Phase R passed, Phase C/P consume miss)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "needs-approval" }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("approval-required");
	});

	it.each([
		{ label: "stateFeature", opts: { feature: "anchor-feature", stateFeature: "other-feature" } },
		{ label: "stateProjectRoot", opts: { feature: "anchor-root", stateProjectRoot: "/nonexistent/wrong-root" } },
		{ label: "stateWorktreeRoot", opts: { feature: "anchor-worktree", stateWorktreeRoot: "/nonexistent/wrong-worktree" } },
	])("persisted anchor mismatch on $label → evidence-mismatch", async ({ opts }) => {
		const result = await landOnce(setupLandableFeature(opts));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("evidence-mismatch");
	});

	it("no audit-N.md → no-audit-evidence", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "no-audit", auditNumber: null }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-evidence");
	});

	it("audit present but no auditCycle/threshold in state → no-audit-cycle (missing-threshold fail-open blocked)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "no-cycle", auditCycle: null, runLogAtCycleStart: null }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-cycle");
	});

	it("auditCycle present but threshold (runLogAtCycleStart) absent → no-audit-cycle (threshold-only fail-open blocked)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "no-threshold", auditCycle: 1, runLogAtCycleStart: null }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-cycle");
	});

	it("threshold present but auditCycle absent → no-audit-cycle (cycle-only fail-open blocked)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "no-cycle-only", auditCycle: null, runLogAtCycleStart: 1 }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-cycle");
	});

	it("non-integer auditCycle → no-audit-cycle (a fractional cycle is not a valid integer cycle)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "frac-cycle", auditNumber: 1, auditCycle: 1.5 }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-cycle");
	});

	it.each([
		{ label: "fractional", feature: "frac-threshold", runLogAtCycleStart: 1.5 },
		{ label: "JSON string", feature: "string-threshold", runLogAtCycleStart: "1" as unknown as number },
	])("non-integer runLogAtCycleStart ($label) → no-audit-cycle (a non-integer threshold is not a valid cycle threshold)", async ({ feature, runLogAtCycleStart }) => {
		const result = await landOnce(setupLandableFeature({ feature, auditNumber: 1, auditCycle: 1, runLogAtCycleStart }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("no-audit-cycle");
	});

	it("only passing run log is run-N where N === threshold → stale-run-log (strict `> threshold`, not `>=`)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "boundary-log", runLogAtCycleStart: 2, freshLogNumber: 2 }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("stale-run-log");
	});

	it("a post-threshold run log exists but is FAILING (exit 1) → stale-run-log (no passing log after the cycle)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "failing-log", runLogAtCycleStart: 1, freshLogNumber: 2, freshLogPassing: false }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("stale-run-log");
	});

	it("auditCycle does not match latest audit-N.md → cycle-mismatch", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "cycle-off", auditNumber: 1, auditCycle: 2 }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("cycle-mismatch");
	});

	it("non-APPROVE-family verdict → verdict-not-approve", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "rejected", auditVerdict: "REJECT" }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("verdict-not-approve");
	});

	it("no passing run-N.log after the cycle threshold → stale-run-log", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "stale", runLogAtCycleStart: 5, freshLogNumber: null }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("stale-run-log");
	});

	it("auditValidated marker for the current cycle with a different verdict → evidence-tamper", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "tamper-verdict", auditNumber: 1, auditCycle: 1, auditValidated: { cycle: 1, verdict: "REJECT" } }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("evidence-tamper");
	});

	it("auditValidated marker for a FUTURE cycle → evidence-tamper", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "tamper-future", auditNumber: 1, auditCycle: 1, auditValidated: { cycle: 2, verdict: "APPROVE" } }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("evidence-tamper");
	});

	it("no auditValidated marker at all → WARN, not a block (reaches approval-required)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "marker-absent", auditValidated: null }));
		expect(result.isError).toBe(true);
		expect(textOf(result), "an absent marker is a WARN, so Phase R passes through to approval-required").toContain("approval-required");
		expect(textOf(result)).not.toContain("evidence-tamper");
	});

	it("stale auditValidated marker from a PREVIOUS cycle → WARN, not a block (reaches approval-required)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "marker-prev", auditNumber: 1, auditCycle: 1, auditValidated: { cycle: 0, verdict: "APPROVE" } }));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("approval-required");
		expect(textOf(result)).not.toContain("evidence-tamper");
	});

	it("auditValidated marker for the current cycle with the MATCHING verdict → consistent (reaches approval-required)", async () => {
		const result = await landOnce(setupLandableFeature({ feature: "marker-match", auditNumber: 1, auditCycle: 1, auditVerdict: "APPROVE", auditValidated: { cycle: 1, verdict: "APPROVE" } }));
		expect(result.isError).toBe(true);
		expect(textOf(result), "a current-cycle marker whose verdict matches the audit is consistent, not tamper").toContain("approval-required");
		expect(textOf(result)).not.toContain("evidence-tamper");
	});

	for (const verdict of ["APPROVE", "APPROVE-WITH-COMMENT", "APPROVE-WITH-CHANGE"] as const) {
		it(`accepts an APPROVE-family verdict (${verdict}) → not verdict-not-approve (reaches approval-required)`, async () => {
			const result = await landOnce(setupLandableFeature({ feature: `verdict-${verdict.toLowerCase()}`, auditVerdict: verdict }));
			expect(result.isError).toBe(true);
			expect(textOf(result), `${verdict} is in the APPROVE family`).not.toContain("verdict-not-approve");
			expect(textOf(result)).toContain("approval-required");
		});
	}
});

// ═══════════════════════════════════════════════════════════════════════════
// AC2/AC3 — replay, wrong-target roundtrip, and effect-path failure state machine
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — AC2/AC3 replay & wrong-target roundtrip", () => {
	it("replay after a successful land has no further effect and is rejected", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "replay" });
		await issueLandApproval(tools, fx);
		const first = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(first.isError, textOf(first)).toBeFalsy();
		const headAfterLand = git(fx.projectRoot, ["rev-parse", "HEAD"]);

		const replay = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(replay.isError, "a consumed/cleaned land cannot be replayed").toBe(true);
		expect(textOf(replay)).toMatch(/not-registered|approval-required/);
		expect(git(fx.projectRoot, ["rev-parse", "HEAD"]), "replay must not create a second merge commit (effect 없음)").toBe(headAfterLand);
	});

	it("target HEAD moved after approval → scope-mismatch, envelope replaced, then a fresh re-approval lands (O2 roundtrip)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "wrong-target" });
		const { approvalQuestion: q1 } = await issueLandApproval(tools, fx);

		// Move the target: an unrelated commit on main changes targetOID after the approval was scoped.
		writeFileSync(join(fx.projectRoot, "unrelated.txt"), "moved\n");
		git(fx.projectRoot, ["add", "unrelated.txt"]);
		git(fx.projectRoot, ["commit", "-q", "-m", "advance main"]);

		const drift = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(drift.isError).toBe(true);
		expect(textOf(drift), "a moved target must fail the scope re-observation").toContain("scope-mismatch");
		const q2 = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		expect(q2, "the current operation envelope replaces the prepared slot on a scope miss").not.toBe(q1);

		// Fresh re-approval on the new question → O2 success against the advanced target.
		const reconfirm = await callTool(tools, "lsc_confirm", { question: q2 }, makeCtx(fx.projectRoot, makeUI(["Yes"])));
		expect(reconfirm.isError, textOf(reconfirm)).toBeFalsy();
		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError, textOf(land)).toBeFalsy();
		expect(isAncestor(fx.projectRoot, fx.sourceOID)).toBe(true);
		expect(existsSync(fx.worktreeRoot)).toBe(false);
	});

	it("target branch changed after approval (same OID via `git checkout -q -b alternate-target`) → scope-mismatch, pending preserved, nothing merged", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "alt-target-branch" });
		await issueLandApproval(tools, fx);
		const targetOIDBefore = git(fx.projectRoot, ["rev-parse", "HEAD"]);

		// Same OID, different branch: check out a NEW branch at the approved target tip. targetOID is
		// unchanged, so only the bound scope's targetBranch dimension drifts (a same-OID confused deputy).
		git(fx.projectRoot, ["checkout", "-q", "-b", "alternate-target"]);
		expect(git(fx.projectRoot, ["rev-parse", "HEAD"]), "the alternate branch points at the same OID").toBe(targetOIDBefore);
		expect(git(fx.projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]), "only the branch changed").toBe("alternate-target");

		const drift = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(drift.isError).toBe(true);
		expect(textOf(drift), "a same-OID target-branch drift must fail the scope re-observation").toContain("scope-mismatch");
		// A scope mismatch is a conditional non-burn: the legitimate pending approval is preserved.
		expect(peekPendingApproval()?.tag, "a scope mismatch preserves the live approval (non-burn)").toBe("[Land]");
		// Nothing landed: the approved sourceOID is NOT merged and the worktree is preserved.
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "no merge may occur on a scope mismatch").toBe(false);
		expect(existsSync(fx.worktreeRoot), "a rejected land preserves the worktree").toBe(true);
	});

	it("a mismatched-identity pending approval → identity-mismatch cause in the approval-required rejection", async () => {
		const tools = buildTools();
		const projectRoot = tmpGitRepo();
		const fxA = setupLandableFeatureIn(projectRoot, "id-a");
		const fxB = setupLandableFeatureIn(projectRoot, "id-b");

		// Issue a real pending bound to feature A's identity.
		await callTool(tools, "lsc_land", { feature: fxA.feature }, makeCtx(projectRoot));
		const qA = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		await callTool(tools, "lsc_confirm", { question: qA }, makeCtx(projectRoot, makeUI(["Yes"])));
		expect(peekPendingApproval()?.tag).toBe("[Land]");

		// Land B tries to consume A's approval — the anchor identities differ.
		const b = await callTool(tools, "lsc_land", { feature: fxB.feature }, makeCtx(projectRoot));
		expect(b.isError).toBe(true);
		expect(textOf(b)).toContain("identity-mismatch");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — effect-path failure paths (conflict abort, target-dirty, drift, partial land, mode scope)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — AC3 effect-path failure state machine", () => {
	it("merge conflict → auto `git merge --abort` + post-state verification → merge-aborted (repo restored)", async () => {
		const tools = buildTools();
		const projectRoot = tmpGitRepo();
		const feature = "conflict";
		const worktreeRoot = worktreePath(projectRoot, feature);
		git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
		// Both sides edit README.md differently → a real merge conflict.
		writeFileSync(join(worktreeRoot, "README.md"), "feature edit\n");
		mkdirSync(craftAuditDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(craftAuditPath(worktreeRoot, feature, 1), "**AUDIT VERDICT: APPROVE**\n");
		mkdirSync(craftTestLogsDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(join(craftTestLogsDir(worktreeRoot, feature), "run-2.log"), "--- exit 0 ---\n");
		mkdirSync(craftTestDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(craftStatePath(worktreeRoot, feature), JSON.stringify({ feature, projectRoot, worktreeRoot, aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }));
		git(worktreeRoot, ["add", "-A"]);
		git(worktreeRoot, ["commit", "-q", "-m", "feat: conflicting README"]);
		// Advance main so it conflicts with the feature's README edit.
		writeFileSync(join(projectRoot, "README.md"), "main edit\n");
		git(projectRoot, ["add", "README.md"]);
		git(projectRoot, ["commit", "-q", "-m", "main conflicting edit"]);
		const targetOID = git(projectRoot, ["rev-parse", "HEAD"]);
		const fx: LandFixture = { projectRoot, worktreeRoot, feature, sourceBranch: `lets-craft/${feature}`, sourceOID: git(worktreeRoot, ["rev-parse", "HEAD"]), targetOID, stateFilePath: craftStatePath(worktreeRoot, feature) };

		await issueLandApproval(tools, fx);
		const land = await callTool(tools, "lsc_land", { feature }, makeCtx(projectRoot));
		expect(land.isError).toBe(true);
		expect(textOf(land)).toContain("merge-aborted");
		// post-state verification: branch + OID + clean status all restored.
		expect(git(projectRoot, ["rev-parse", "HEAD"]), "abort must restore the pre-merge target OID").toBe(targetOID);
		expect(git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
		expect(git(projectRoot, ["status", "--porcelain"]), "no conflict markers left behind").toBe("");
		expect(existsSync(worktreeRoot), "a failed merge preserves the worktree").toBe(true);
	});

	it("target has a tracked (non-`??`) change → target-dirty rejected before any merge", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "target-dirty" });
		writeFileSync(join(fx.projectRoot, "README.md"), "locally modified tracked file\n"); // tracked, uncommitted
		const result = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("target-dirty");
	});

	it("target has ONLY untracked (`??`) files → not target-dirty (passes Phase R to approval-required)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "untracked-ok" });
		writeFileSync(join(fx.projectRoot, "scratch.txt"), "untracked only\n"); // `??` — delegated to git merge
		const result = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(result.isError).toBe(true);
		expect(textOf(result), "untracked-only must NOT trip target-dirty").not.toContain("target-dirty");
		expect(textOf(result)).toContain("approval-required");
	});

	it("source ref moved after approval → the APPROVED sourceOID is merged, not the new tip", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "source-drift" });
		const { } = await issueLandApproval(tools, fx);

		// Advance the source branch after approval; the approved OID must still be what lands.
		writeFileSync(join(fx.worktreeRoot, "later.txt"), "post-approval work\n");
		git(fx.worktreeRoot, ["add", "later.txt"]);
		git(fx.worktreeRoot, ["commit", "-q", "-m", "post-approval commit"]);
		const driftedTip = git(fx.worktreeRoot, ["rev-parse", "HEAD"]);
		expect(driftedTip).not.toBe(fx.sourceOID);

		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError, textOf(land)).toBeFalsy();
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "approved OID merged").toBe(true);
		expect(isAncestor(fx.projectRoot, driftedTip), "post-approval drift tip must NOT be merged").toBe(false);
	});

	it("dirty worktree → merged-but-not-cleaned (merge kept, worktree preserved), then force-clean-only re-approval force-removes it", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "partial-land", makeDirtyWorktree: true });

		await issueLandApproval(tools, fx);
		const partial = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(partial.isError).toBe(true);
		expect(textOf(partial)).toContain("merged-but-not-cleaned");
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "the merge itself completed").toBe(true);
		expect(existsSync(fx.worktreeRoot), "a dirty worktree is preserved, not silently force-removed").toBe(true);

		// force-clean-only re-approval: mode-scoped, so it is a distinct [Land] approval (P6).
		await issueLandApproval(tools, fx, "force-clean-only");
		const forced = await callTool(tools, "lsc_land", { feature: fx.feature, mode: "force-clean-only" }, makeCtx(fx.projectRoot));
		expect(forced.isError, textOf(forced)).toBeFalsy();
		expect(existsSync(fx.worktreeRoot), "force-clean-only removes the dirty worktree").toBe(false);
		expect(git(fx.projectRoot, ["worktree", "list", "--porcelain"]).includes(fx.worktreeRoot)).toBe(false);
	});

	it("force-clean-only requested against a merge-and-clean approval → scope-mismatch (mode is bound into the scope)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "mode-scope" });
		await issueLandApproval(tools, fx); // approval scoped to merge-and-clean (default)

		const forced = await callTool(tools, "lsc_land", { feature: fx.feature, mode: "force-clean-only" }, makeCtx(fx.projectRoot));
		expect(forced.isError).toBe(true);
		expect(textOf(forced), "a merge-and-clean nonce cannot be spent on a force-clean-only operation").toContain("scope-mismatch");
	});

	it("projectRoot checked out on the feature branch → self-merge", async () => {
		const tools = buildTools();
		const projectRoot = tmpGitRepo();
		const feature = "self";
		const branch = `lets-craft/${feature}`;
		// projectRoot itself sits on the feature branch (no worktree occupies it), so target === source.
		git(projectRoot, ["checkout", "-q", "-b", branch]);
		mkdirSync(craftAuditDir(projectRoot, feature), { recursive: true });
		writeFileSync(craftAuditPath(projectRoot, feature, 1), "**AUDIT VERDICT: APPROVE**\n");
		mkdirSync(craftTestLogsDir(projectRoot, feature), { recursive: true });
		writeFileSync(join(craftTestLogsDir(projectRoot, feature), "run-2.log"), "--- exit 0 ---\n");
		mkdirSync(craftTestDir(projectRoot, feature), { recursive: true });
		writeFileSync(
			craftStatePath(projectRoot, feature),
			JSON.stringify({ feature, projectRoot, worktreeRoot: worktreePath(projectRoot, feature), aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }),
		);

		const result = await callTool(tools, "lsc_land", { feature }, makeCtx(projectRoot));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("self-merge");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Reason-code vocabulary contract (spec AC1/AC3 — "사유 코드 18종 집합과 일치").
// Pins the full public set. The three defensive branches (merge-recovery-failed / cleaned-but-not-pruned /
// validation-reject) are ALSO exercised behaviorally under the SAME production orchestrator via the injected
// LandEffects port (see "AC3 LandEffects port …" below) — no longer a vocab-only array-equality pin (C3/rec2).
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — public reason-code vocabulary", () => {
	it("exports exactly the 18 documented reason codes", () => {
		expect([...LAND_REASON_CODES].sort()).toEqual([...EXPECTED_REASON_CODES].sort());
		expect(LAND_REASON_CODES.length).toBe(18);
	});

	it("does NOT retain the removed `no-pending-approval` code (unreachable under the 2-phase rule)", () => {
		expect(LAND_REASON_CODES).not.toContain("no-pending-approval");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers for the effect-port + envelope contracts below.
// ═══════════════════════════════════════════════════════════════════════════
function landAnchor(fx: LandFixture): ApprovalCraftIdentity {
	return { feature: fx.feature, projectRoot: fx.projectRoot, worktreeRoot: fx.worktreeRoot };
}

/** Deep key-order reversal — a canonically-equal object with a different physical key order. */
function deepReorderKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(deepReorderKeys);
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).reverse();
		return Object.fromEntries(entries.map(([k, v]) => [k, deepReorderKeys(v)]));
	}
	return value;
}

/** Order-independent canonical JSON (recursively key-sorted) — the equality land's scope compare uses. */
function canonicalize(value: unknown): string {
	const sort = (v: unknown): unknown => {
		if (Array.isArray(v)) return v.map(sort);
		if (v && typeof v === "object") {
			return Object.fromEntries(
				Object.keys(v as Record<string, unknown>)
					.sort()
					.map(k => [k, sort((v as Record<string, unknown>)[k])]),
			);
		}
		return v;
	};
	return JSON.stringify(sort(value));
}

/** A removal observation the pure evaluateRemovalTarget ACCEPTS (safe worktree inside the roots). */
function safeRemovalObs(candidate: string): RemovalObservation {
	return {
		input: candidate,
		exists: true,
		isSymlink: false,
		isDirectory: true,
		resolvedPath: realpathSync(candidate),
		home: "/opt/__lsc_no_such_home__",
		dotGitIsDirectory: false,
	};
}

/** A removal observation the pure evaluateRemovalTarget REJECTS (symlink guard) — a target gone unsafe. */
function rejectableRemovalObs(candidate: string): RemovalObservation {
	return { ...safeRemovalObs(candidate), isSymlink: true };
}

/** A real git repo + registered worktree whose README conflicts with main — so a real merge conflicts. */
function setupConflictingFeature(feature: string): LandFixture {
	const projectRoot = tmpGitRepo();
	const worktreeRoot = worktreePath(projectRoot, feature);
	git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
	writeFileSync(join(worktreeRoot, "README.md"), "feature edit\n");
	mkdirSync(craftAuditDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(craftAuditPath(worktreeRoot, feature, 1), "**AUDIT VERDICT: APPROVE**\n");
	mkdirSync(craftTestLogsDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(join(craftTestLogsDir(worktreeRoot, feature), "run-2.log"), "--- exit 0 ---\n");
	mkdirSync(craftTestDir(worktreeRoot, feature), { recursive: true });
	writeFileSync(craftStatePath(worktreeRoot, feature), JSON.stringify({ feature, projectRoot, worktreeRoot, aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }));
	git(worktreeRoot, ["add", "-A"]);
	git(worktreeRoot, ["commit", "-q", "-m", "feat: conflicting README"]);
	writeFileSync(join(projectRoot, "README.md"), "main edit\n");
	git(projectRoot, ["add", "README.md"]);
	git(projectRoot, ["commit", "-q", "-m", "main conflicting edit"]);
	return { projectRoot, worktreeRoot, feature, sourceBranch: `lets-craft/${feature}`, sourceOID: git(worktreeRoot, ["rev-parse", "HEAD"]), targetOID: git(projectRoot, ["rev-parse", "HEAD"]), stateFilePath: craftStatePath(worktreeRoot, feature) };
}

// ═══════════════════════════════════════════════════════════════════════════
// AC3 — LandEffects port (deterministic rare-failure injection under the SAME production orchestrator).
// happy/real-conflict paths keep real git; only the externally-nondeterministic rare failures are injected
// through the narrow `LandEffects` seam registerLandTool receives (C3/rec2, plan §6 Step 3b).
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — AC3 LandEffects port (injected rare-failure state machine)", () => {
	it("post-abort recovery verification fails → merge-recovery-failed (recovery not guaranteed), worktree preserved", async () => {
		// Real merge conflict → real `git merge --abort`, but the injected post-recovery check reports
		// failure, so land cannot claim the repo was restored (distinct from the real merge-aborted path).
		const tools = buildTools({ verifyPostRecovery: () => false });
		const fx = setupConflictingFeature("recovery-fail");
		await issueLandApproval(tools, fx);
		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError).toBe(true);
		expect(textOf(land)).toContain("merge-recovery-failed");
		expect(existsSync(fx.worktreeRoot), "a failed recovery preserves the worktree").toBe(true);
	});

	it("prune fails after a successful merge+remove → cleaned-but-not-pruned (merge + removal really happened)", async () => {
		const tools = buildTools({
			prune: () => {
				throw new Error("injected `git worktree prune` failure");
			},
		});
		const fx = setupLandableFeature({ feature: "prune-fail" });
		await issueLandApproval(tools, fx);
		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError).toBe(true);
		expect(textOf(land)).toContain("cleaned-but-not-pruned");
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "the merge completed before the prune step").toBe(true);
		expect(existsSync(fx.worktreeRoot), "the worktree was actually removed before prune failed").toBe(false);
	});

	it("a pre-removal re-inspection failure → validation-reject with removeWorktree NEVER called (TOCTOU re-check wired)", async () => {
		let inspectCalls = 0;
		let removeCalled = false;
		// Passes preflight (Phase R ⑤), then REJECTS the pre-removal re-check (Phase X) — proving the
		// re-inspection is actually re-run at removal time, not a define-and-forget dead branch (C3/rec2).
		const tools = buildTools({
			inspectRemovalTarget: (candidate: string) => {
				inspectCalls += 1;
				return inspectCalls >= 2 ? rejectableRemovalObs(candidate) : safeRemovalObs(candidate);
			},
			remove: () => {
				removeCalled = true;
			},
		});
		const fx = setupLandableFeature({ feature: "toctou" });
		await issueLandApproval(tools, fx);
		const land = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(land.isError).toBe(true);
		expect(textOf(land)).toContain("validation-reject");
		expect(removeCalled, "a rejected pre-removal re-inspection must abort BEFORE removeWorktree").toBe(false);
		expect(inspectCalls, "inspectRemovalTarget is re-run at removal time (preflight + pre-removal)").toBeGreaterThanOrEqual(2);
		expect(existsSync(fx.worktreeRoot), "the worktree is preserved when the re-check rejects").toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// AC1/AC3 — standalone real-git rejections (membership / lock / main-repo), no injection.
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — standalone real-git rejections (membership / lock / main-repo)", () => {
	it("valid evidence at an UNREGISTERED worktree path → not-registered (membership gate)", async () => {
		const projectRoot = tmpGitRepo();
		const feature = "unregistered";
		const worktreeRoot = worktreePath(projectRoot, feature);
		// Valid evidence at the worktree path — but never `git worktree add`, so it is not registered.
		mkdirSync(craftAuditDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(craftAuditPath(worktreeRoot, feature, 1), "**AUDIT VERDICT: APPROVE**\n");
		mkdirSync(craftTestLogsDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(join(craftTestLogsDir(worktreeRoot, feature), "run-2.log"), "--- exit 0 ---\n");
		mkdirSync(craftTestDir(worktreeRoot, feature), { recursive: true });
		writeFileSync(craftStatePath(worktreeRoot, feature), JSON.stringify({ feature, projectRoot, worktreeRoot, aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }));
		const result = await callTool(buildTools(), "lsc_land", { feature }, makeCtx(projectRoot));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("not-registered");
	});

	it("a locked worktree resists no-force removal → merged-but-not-cleaned; even one --force cannot remove it", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "locked" });
		git(fx.projectRoot, ["worktree", "lock", fx.worktreeRoot]);
		await issueLandApproval(tools, fx);
		const merged = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(merged.isError).toBe(true);
		expect(textOf(merged)).toContain("merged-but-not-cleaned");
		expect(isAncestor(fx.projectRoot, fx.sourceOID), "the merge itself completed").toBe(true);
		expect(existsSync(fx.worktreeRoot), "a locked worktree survives no-force removal").toBe(true);

		// force-clean-only escalates to a SINGLE `--force`; git needs `--force --force` to override a lock,
		// which land never issues — so the lock stays inviolable (Must-NOT-Have 1, N1).
		await issueLandApproval(tools, fx, "force-clean-only");
		const forced = await callTool(tools, "lsc_land", { feature: fx.feature, mode: "force-clean-only" }, makeCtx(fx.projectRoot));
		expect(forced.isError).toBe(true);
		expect(existsSync(fx.worktreeRoot), "one --force is insufficient for a locked worktree; land never double-forces").toBe(true);
	});

	it("a worktree path that resolves to the MAIN repository (symlink) → validation-reject; the main repo is never removed", async () => {
		const projectRoot = tmpGitRepo();
		const feature = "mainlink";
		const worktreeRoot = worktreePath(projectRoot, feature);
		// Register a real worktree (membership passes), then swap its directory for a symlink to the main
		// repo. Registration persists (git tracks the path), so preflight reads source via the listWorktrees
		// porcelain seam and reaches the removal-target validator, which the REAL inspect/evaluate rejects
		// (symlink / main-repo `.git` directory) → folded to validation-reject.
		git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
		// Evidence at projectRoot/.lsc so it stays readable through the post-swap symlink (→ projectRoot).
		mkdirSync(craftAuditDir(projectRoot, feature), { recursive: true });
		writeFileSync(craftAuditPath(projectRoot, feature, 1), "**AUDIT VERDICT: APPROVE**\n");
		mkdirSync(craftTestLogsDir(projectRoot, feature), { recursive: true });
		writeFileSync(join(craftTestLogsDir(projectRoot, feature), "run-2.log"), "--- exit 0 ---\n");
		mkdirSync(craftTestDir(projectRoot, feature), { recursive: true });
		writeFileSync(craftStatePath(projectRoot, feature), JSON.stringify({ feature, projectRoot, worktreeRoot, aborted: false, stateVersion: 1, auditCycle: 1, runLogAtCycleStart: 1 }));
		rmSync(worktreeRoot, { recursive: true, force: true });
		symlinkSync(projectRoot, worktreeRoot);

		const result = await callTool(buildTools(), "lsc_land", { feature }, makeCtx(projectRoot));
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("validation-reject");
		expect(existsSync(join(projectRoot, ".git")), "land must never remove the main repository").toBe(true);
		expect(git(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]), "the main worktree is untouched").toBe("main");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Approval envelope binding — the SAME operationScope + identity + evidenceRoot flows Prepared → Pending
// → Durable, field by field (spec §envelope, plan §3a; architect rec 3).
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — approval envelope binding (prepared → pending → durable, per-field)", () => {
	it("installs a fully-formed prepared envelope on the consume-miss (all six fields)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "envelope" });
		const first = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(first.isError, textOf(first)).toBe(true);
		expect(textOf(first)).toContain("approval-required");

		const prepared = peekPreparedOperation(LAND_TAG);
		expect(prepared, "a consume-miss must install a prepared-operation envelope").not.toBeUndefined();
		expect(typeof prepared?.prepareId).toBe("string");
		expect((prepared?.prepareId ?? "").length, "prepareId is a non-empty id").toBeGreaterThan(0);
		expect(prepared?.tag).toBe("[Land]");
		expect(prepared?.identity).toEqual(landAnchor(fx));
		expect(prepared?.approvalQuestion.startsWith("[Land]")).toBe(true);
		expect(prepared?.evidenceRoot, "evidence root is the exact-root worktree").toBe(fx.worktreeRoot);
		const scope = prepared?.operationScope as Record<string, unknown>;
		expect(scope.mode).toBe("merge-and-clean");
		expect(scope.sourceOID).toBe(fx.sourceOID);
		expect(scope.targetOID).toBe(fx.targetOID);
		expect(scope.sourceBranch).toBe(fx.sourceBranch);
		expect(scope.targetBranch).toBe("main");
	});

	it("carries the same operationScope prepared → pending → durable, and pins durable identity + evidenceRoot", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "envelope-flow" });
		const first = await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		expect(first.isError).toBe(true);
		const prepared = peekPreparedOperation(LAND_TAG);
		const preparedScope = prepared?.operationScope;
		const question = prepared?.approvalQuestion ?? "";

		const confirm = await callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI(["Yes"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();

		// Pending (the sole volatile consume authority) carries the scope + the exact question.
		const pending = peekPendingApproval();
		expect(pending?.tag).toBe("[Land]");
		expect(pending?.question).toBe(question);
		expect(canonicalize(pending?.operationScope)).toBe(canonicalize(preparedScope));

		// Durable evidence (persist-before-install) records the scope + anchor identity at the evidenceRoot.
		const persisted = PersistedStateSchema.parse(JSON.parse(readFileSync(craftStatePath(fx.worktreeRoot, fx.feature), "utf8")));
		expect(persisted.releaseApproval?.tag).toBe("[Land]");
		expect(canonicalize(persisted.releaseApproval?.operationScope)).toBe(canonicalize(preparedScope));
		expect({ feature: persisted.feature, projectRoot: persisted.projectRoot, worktreeRoot: persisted.worktreeRoot }).toEqual(landAnchor(fx));
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// operationScope canonical JSON equality (the consume authority) — key order independent, value strict,
// value mismatch is a conditional NON-BURN (spec §envelope; plan §3a expectedScope contract).
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — operationScope canonical equality (consume authority, non-burn)", () => {
	it("consumes on a key-reordered but value-equal scope (canonical JSON equality, order-independent)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "scope-equal" });
		await issueLandApproval(tools, fx);
		const scope = peekPendingApproval()?.operationScope;
		const reordered = deepReorderKeys(scope) as typeof scope;
		const result = consumePendingApproval({ acceptedTags: [LAND_TAG], identity: landAnchor(fx), expectedScope: reordered });
		expect(result.ok, "a canonically-equal scope must consume").toBe(true);
		expect(peekPendingApproval(), "a successful consume burns the single-use nonce").toBeUndefined();
	});

	it("rejects a value-mismatched scope with scope-mismatch and PRESERVES the slot (conditional non-burn)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "scope-mismatch" });
		await issueLandApproval(tools, fx);
		const scope = peekPendingApproval()?.operationScope;
		const s = scope as Record<string, unknown>;
		const mismatched = { ...s, mode: s.mode === "merge-and-clean" ? "force-clean-only" : "merge-and-clean" } as typeof scope;
		const result = consumePendingApproval({ acceptedTags: [LAND_TAG], identity: landAnchor(fx), expectedScope: mismatched });
		expect(result.ok, "a value-mismatched scope must not consume").toBe(false);
		expect(result.ok ? undefined : result.reason).toBe("scope-mismatch");
		expect(peekPendingApproval(), "a scope mismatch preserves the legitimate approval (non-burn)").not.toBeUndefined();
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// Prepared-operation issuance eligibility (ask.ts prepared branch) — mismatched active craft, wrong
// question, and free/cancel all issue NOTHING and clear the captured prepared entry (plan §3a).
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_land — prepared-operation issuance eligibility", () => {
	it("does not issue when a DIFFERENT-identity active craft is present (mismatched active craft)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "mismatch-active" });
		setActiveCraft({ feature: "unrelated-feature", projectRoot: "/some/other/root", worktreeRoot: "/some/other/root/wt", aborted: false } as CraftState);
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const question = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		const confirm = await callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI(["Yes"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(peekPendingApproval(), "a [Land] confirm with a mismatched active craft issues no capability").toBeUndefined();
	});

	it("does not issue on a [Land] question that is not the prepared approvalQuestion (exact-question binding)", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "wrong-question" });
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const bogus = "[Land] a question that was never the prepared approvalQuestion";
		const confirm = await callTool(tools, "lsc_confirm", { question: bogus }, makeCtx(fx.projectRoot, makeUI(["Yes"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(peekPendingApproval(), "a non-prepared [Land] question issues nothing").toBeUndefined();
	});

	it("clears the prepared entry after a FREE-TEXT answer to the [Land] question", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "free-answer" });
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const question = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		expect(peekPreparedOperation(LAND_TAG), "prepared entry is live before the answer").not.toBeUndefined();
		const confirm = await callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI([OTHER_OPTION], ["please rebase onto main first"])));
		expect(confirm.isError, textOf(confirm)).toBeFalsy();
		expect(peekPendingApproval(), "a free answer is neither yes nor no — no capability").toBeUndefined();
		expect(peekPreparedOperation(LAND_TAG), "a free answer conditionally invalidates the captured prepared entry").toBeUndefined();
	});

	it("clears the prepared entry after a CANCELLED [Land] confirm", async () => {
		const tools = buildTools();
		const fx = setupLandableFeature({ feature: "cancel-answer" });
		await callTool(tools, "lsc_land", { feature: fx.feature }, makeCtx(fx.projectRoot));
		const question = peekPreparedOperation(LAND_TAG)?.approvalQuestion ?? "";
		const confirm = await callTool(tools, "lsc_confirm", { question }, makeCtx(fx.projectRoot, makeUI([undefined])));
		expect(confirm.isError, "a cancelled confirm is an isError").toBe(true);
		expect(peekPendingApproval()).toBeUndefined();
		expect(peekPreparedOperation(LAND_TAG), "a cancelled [Land] confirm conditionally invalidates the prepared entry").toBeUndefined();
	});
});
