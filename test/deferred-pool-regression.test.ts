// Regression canon for the deferred-pool feature (AC10 · AC12 boundary). This file guards the
// SEAMS that deferred-pool refactors touch, from angles the repo's existing suites do NOT already
// cover — it re-confirms load-bearing invariants THROUGH the new API surface rather than
// re-running the incumbent tests.
//
// R9 (C2): §1 (open-release arbitration reconstructed via the craftStateCandidates +
// decodeCraftState seam) is retired along with the openRelease state machine itself —
// findPersistedCraftState is now a plain worktree-first fallback with no arbitration to
// reconstruct, and craft-state-candidates.test.ts already owns the descriptor-seam's own
// mechanics (never-decodes, existence-only) directly against the real consumer. §2 is re-tagged
// from the retired `[Canon Amendment]`/release.ts example to `[Land]`, the sole surviving gate —
// the scope-comparison logic it pins (both-undefined-match / one-sided-mismatch /
// canonical-JSON-equality) is unchanged.
//
// GREEN regression guards (must stay green): §2's unscoped-consume preservation, §3's
// directory-existence audit-root policy under a malformed state, and §5's ensure* gitignore
// helper surviving the doctor read-only-checker split. If any of these flips to RED, a refactor
// broke a consumer it promised to preserve (spec constraint 8, plan Guardrail 6).
//
// Conventions (trace Lane 5 / plan §4): no business mocks or snapshots, real singletons +
// mkdtempSync(tmpdir()) fixtures, per-field assertions, invalidatePendingApproval() +
// clearActiveCraft() reset before and after every test.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureWorktreesGitignored } from "../src/artifacts/gitignore";
import { craftAuditDir, craftStatePath, worktreePath } from "../src/artifacts/paths";
import {
	type ApprovalCraftIdentity,
	type DestructiveGateTag,
	consumePendingApproval,
	createPendingApproval,
	installPendingApproval,
	invalidatePendingApproval,
	peekPendingApproval,
} from "../src/craft/destructive-approval";
import { type CraftState, clearActiveCraft, recordAuditCycleBegin, recordAuditValidated } from "../src/craft/state";
import { performAuditValidate } from "../src/craft/verdict";

// ── shared fixtures / helpers ───────────────────────────────────────────────
const tempDirs: string[] = [];

beforeEach(() => {
	invalidatePendingApproval();
	clearActiveCraft();
});
afterEach(() => {
	invalidatePendingApproval();
	clearActiveCraft();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-dp-regress-"));
	tempDirs.push(dir);
	return dir;
}

function freshState(projectRoot: string, feature = "my-feature"): CraftState {
	return { feature, projectRoot, aborted: false };
}

/** Write an exact on-disk .craft-state.json shape via JSON.stringify (bypasses the mutators), mirroring craft-state.test.ts's writePersistedState. */
function writePersistedState(root: string, feature: string, state: object): void {
	const path = craftStatePath(root, feature);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state, null, 2));
}

/** Write arbitrary raw bytes to a path (for deliberately UNPARSEABLE state files). */
function writeRaw(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

// ============================================================================
// §2 — Issuance-slot consumers unharmed by the operationScope extension (AC12 boundary).
//
// consumePendingApproval's `expectedScope`: both sides absent = match (an unscoped confirm's
// path); exactly one side present = scope-mismatch; both present = canonical-JSON equality. This
// section pins that the unscoped `[Land]` path still matches (R9: re-tagged from the retired
// `[Canon Amendment]`/release.ts example — the scope-comparison logic itself is unchanged), and
// that a one-sided scope is a mismatch that PRESERVES the slot (CS11 conditional non-burn — a
// mis-targeted consumer must not destroy a legitimate approval).
// ============================================================================

const LAND_QUESTION = "[Land] Merge this approved feature into the main branch? Proceed?";
const LAND_TAG = "[Land]" as const satisfies DestructiveGateTag;

function landIdentity(): ApprovalCraftIdentity {
	return { feature: "gated-feature", projectRoot: "/tmp/deferred-pool-proj" };
}

/** Install a live [Land] approval, optionally scope-bound (operationScope is craft Step 3a's field). */
function installLandApproval(identity: ApprovalCraftIdentity, operationScope?: Record<string, unknown>): void {
	const record = createPendingApproval({ tag: LAND_TAG, question: LAND_QUESTION, identity });
	installPendingApproval(operationScope === undefined ? record : { ...record, operationScope });
}

describe("§2 operationScope extension preserves the existing unscoped consumers ([Land])", () => {
	it("preserves an unscoped consume path: an unscoped approval consumed with no expectedScope matches (both sides absent = match)", () => {
		const identity = landIdentity();
		installLandApproval(identity);

		const result = consumePendingApproval({ acceptedTags: [LAND_TAG], identity });

		expect(result.ok).toBe(true);
		expect(peekPendingApproval()).toBeUndefined(); // single-use burn, unchanged
	});

	it("a one-sided scope (expectedScope supplied against an unscoped approval) is a scope-mismatch that preserves the slot", () => {
		const identity = landIdentity();
		installLandApproval(identity); // no operationScope

		const result = consumePendingApproval({ acceptedTags: [LAND_TAG], identity, expectedScope: { mode: "merge-and-clean" } });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("scope-mismatch");
		// Conditional non-burn (CS11): a scope mismatch must not destroy the legitimate approval.
		expect(peekPendingApproval()).not.toBeUndefined();
	});

	it("the reverse one-sided case (a scope-bound approval consumed with no expectedScope) is also a scope-mismatch that preserves the slot", () => {
		const identity = landIdentity();
		installLandApproval(identity, { mode: "force-clean-only" }); // scope-bound

		const result = consumePendingApproval({ acceptedTags: [LAND_TAG], identity });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("scope-mismatch");
		expect(peekPendingApproval()).not.toBeUndefined();
	});

	it("both scopes present but with keys in a DIFFERENT order still match (canonical-JSON equality is key-order-independent, not naive JSON.stringify)", () => {
		const identity = landIdentity();
		// A multi-key scope installed in one key order …
		installLandApproval(identity, { mode: "merge-and-clean", sourceOID: "0f1e2d3c", targetBranch: "main" });

		// … consumed with the SAME content but the keys serialized in a DIFFERENT order.
		const result = consumePendingApproval({
			acceptedTags: [LAND_TAG],
			identity,
			expectedScope: { targetBranch: "main", sourceOID: "0f1e2d3c", mode: "merge-and-clean" },
		});

		// Canonical equality sorts keys before comparing, so order alone is NOT a mismatch. A naive
		// JSON.stringify(a) === JSON.stringify(b) would (wrongly) see these two as different and refuse —
		// this pins the order-independent equality the operationScope contract requires (M6/m4 · plan Step 3a).
		expect(result.ok).toBe(true);
		expect(peekPendingApproval()).toBeUndefined(); // matched → single-use burn
	});
});

// ============================================================================
// §3 — E (AC10): resolveAuditRoot keeps its directory-existence policy, decode-independent.
//
// resolveAuditRoot (verdict.ts, private) now shares craftStateCandidates but must decide the root
// from a candidate's rootExists ALONE — never by decoding its state (that would let a malformed
// worktree state divert audit resolution back to the project root). Observed through the public
// performAuditValidate core: with no audit dir anywhere, it returns early NAMING the resolved
// root's audit dir, before it ever reads the (malformed) craft state.
// ============================================================================

describe("§3 resolveAuditRoot preserves the directory-existence policy under a malformed worktree state (E — AC10)", () => {
	it("resolves to the worktree even when the worktree .craft-state.json is unparseable — the directory exists, so decode is never consulted", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		const wt = worktreePath(cwd, feature);
		// The worktree DIR now exists (writing the state file created its parents) but its state is unparseable.
		writeRaw(craftStatePath(wt, feature), "{ this is not valid json ]");

		// No audit dir anywhere → performAuditValidate returns early (before any state decode),
		// naming the audit dir under the resolved root.
		const result = performAuditValidate(feature, cwd);

		expect(result.isError).toBe(true);
		const text = (result.content as Array<{ text?: string }>).map(c => c.text ?? "").join("\n");
		expect(text).toContain(craftAuditDir(wt, feature)); // resolved to the worktree
		expect(text).not.toContain(craftAuditDir(cwd, feature)); // NOT diverted to the project root
	});
});

// ============================================================================
// §4 — recordAuditCycleBegin's new prior-marker clear leaves the existing audit flow intact (D4).
//
// D4 makes recordAuditCycleBegin atomically clear a prior cycle's auditValidated (so a stale marker
// can't remain available across cycles). This must NOT disturb the rest of the flow: the new-cycle
// fields still persist, and a subsequent recordAuditValidated re-establishes a fresh marker.
// ============================================================================

describe("§4 recordAuditCycleBegin clears a prior auditValidated, and the begin→validate flow still round-trips (D4)", () => {
	it("clears a prior cycle's auditValidated marker when a new cycle begins", () => {
		const root = tmpProject();
		const feature = "my-feature";
		// A state left over from a previous, already-validated cycle 0.
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 0,
			checkLogAtCycleStart: 1,
			auditValidated: { cycle: 0, verdict: "APPROVE", at: "2026-07-17T09:00:00.000Z" },
		});

		const begun = recordAuditCycleBegin(root, feature, 1, 5);

		// New contract: the stale cycle-0 marker is gone (cannot be re-cited in cycle 1).
		expect(begun.auditValidated).toBeUndefined();
		const persisted = JSON.parse(readFileSync(craftStatePath(root, feature), "utf8"));
		expect(persisted.auditValidated).toBeUndefined();
	});

	it("still records the new cycle's fields and lets a subsequent recordAuditValidated re-establish a fresh marker (existing flow intact)", () => {
		const root = tmpProject();
		const feature = "my-feature";
		writePersistedState(root, feature, {
			...freshState(root, feature),
			auditCycle: 0,
			auditValidated: { cycle: 0, verdict: "APPROVE", at: "2026-07-17T09:00:00.000Z" },
		});

		const begun = recordAuditCycleBegin(root, feature, 1, 5);
		// The begin mechanics are unchanged — the new cycle is recorded exactly.
		expect(begun.auditCycle).toBe(1);
		expect(begun.checkLogAtCycleStart).toBe(5);

		// Re-validating the new cycle re-establishes a fresh marker (round-trip preserved).
		const revalidated = recordAuditValidated(root, feature, 1, "APPROVE-WITH-COMMENT", "2026-07-17T11:00:00.000Z");
		expect(revalidated.auditValidated).toEqual({ cycle: 1, verdict: "APPROVE-WITH-COMMENT", at: "2026-07-17T11:00:00.000Z" });
		const persisted = JSON.parse(readFileSync(craftStatePath(root, feature), "utf8"));
		expect(persisted.auditValidated).toEqual({ cycle: 1, verdict: "APPROVE-WITH-COMMENT", at: "2026-07-17T11:00:00.000Z" });
	});
});

// ============================================================================
// §5 — gitignore ensure* helpers survive the doctor read-only-checker split (C — spec constraint 4).
//
// Step 6 extracts a read-only presence checker out of ensureGitignored (so doctor can inspect
// .gitignore without writing), and Step 4 swaps its writer to writeFileAtomicSync. Both are
// behavior-preserving for the ensure* helpers: they must STILL write the entry when absent and
// no-op when present.
// ============================================================================

describe("§5 ensure* gitignore helpers still write-then-no-op after the read-only checker split (C)", () => {
	it("ensureWorktreesGitignored still appends the worktrees entry on first call and no-ops idempotently", () => {
		const cwd = tmpProject();

		const first = ensureWorktreesGitignored(cwd);
		expect(first.added).toBe(true);
		expect(readFileSync(first.path, "utf8")).toContain(".lsc/worktrees/");

		// Presence detection still short-circuits the write (not turned read-only by the split).
		const second = ensureWorktreesGitignored(cwd);
		expect(second.added).toBe(false);
	});
});
