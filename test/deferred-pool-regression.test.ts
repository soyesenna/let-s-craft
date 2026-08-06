// Regression canon for the deferred-pool feature (AC10 · AC12 boundary). This file guards the
// SEAMS that deferred-pool refactors touch, from angles the repo's existing suites do NOT already
// cover — it re-confirms load-bearing invariants THROUGH the new API surface rather than
// re-running the incumbent tests. Split across two kinds of case:
//
//   • test-first RED (correct, expected pre-craft):
//       §1 craftStateCandidates / decodeCraftState — these exports do not exist in state.ts until
//          craft Step 1b (E). A named import of a missing export resolves to `undefined` at
//          runtime (esbuild does NOT throw at import — it throws "is not a function" at the CALL
//          site, verified by the release-gate suites), so every test that CALLS craftStateCandidates
//          is RED with a TypeError until craft lands it. That RED is the point, not a typo.
//       §2 (two one-sided cases) consumePendingApproval's `expectedScope` argument is NEW (craft
//          Step 3a). The current slot core has no scope parameter, so it currently MATCHES
//          (ok:true) where the new rule must return scope-mismatch — a behavioral RED that goes
//          green once the scope comparison lands.
//       §4 (the clear assertion) recordAuditCycleBegin does not yet clear a prior auditValidated
//          marker (craft Step 3b / D4 adds it) — RED until then.
//
//   • GREEN regression guards (must stay green THROUGHOUT — they pin behavior craft must NOT
//     change): §2's unscoped-consume preservation (release.ts's exact call shape), §3's
//     directory-existence audit-root policy under a malformed state, and §5's ensure* gitignore
//     helpers surviving the doctor read-only-checker split. If any of these flips to RED, the
//     refactor broke a consumer it promised to preserve (spec constraint 8, plan Guardrail 6).
//
// Conventions (trace Lane 5 / plan §4): no business mocks or snapshots, real singletons +
// mkdtempSync(tmpdir()) fixtures, per-field assertions, invalidatePendingApproval() +
// clearActiveCraft() reset before and after every test. This file deliberately does NOT re-drive
// findPersistedCraftState (test/craft-state.test.ts:481-533 owns that consumer directly): it
// reconstructs the arbitration from the shared candidate/decode seam so the two together pin the
// refactor — the seam here, the consumer there.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSnapshotsGitignored, ensureWorktreesGitignored } from "../src/artifacts/gitignore";
import { craftAuditDir, craftStatePath, worktreePath } from "../src/artifacts/paths";
import {
	type ApprovalCraftIdentity,
	consumePendingApproval,
	createPendingApproval,
	installPendingApproval,
	invalidatePendingApproval,
	peekPendingApproval,
} from "../src/craft/destructive-approval";
import { RELEASE_CONSUMABLE_TAGS } from "../src/craft/release";
import {
	type CraftState,
	type OpenReleaseEvidence,
	clearActiveCraft,
	// NEW in craft Step 1b (E) — undefined until then, so §1 is import-RED at each call site.
	craftStateCandidates,
	decodeCraftState,
	hasOpenRelease,
	recordAuditCycleBegin,
	recordAuditValidated,
} from "../src/craft/state";
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

function openEvidence(overrides: Partial<OpenReleaseEvidence> = {}): OpenReleaseEvidence {
	return {
		nonce: "nonce-1111-2222-3333",
		tag: "[Canon Amendment]",
		question: "[Canon Amendment] Protected test canon needs an approved, intentional modification. Proceed?",
		response: "yes",
		reason: "fix the off-by-one in the boundary assertion",
		openedAt: "2026-07-17T10:01:00.000Z",
		...overrides,
	};
}

// ============================================================================
// §1 — E (AC10): open-release arbitration preserved through the NEW candidate/decode seam.
//
// findPersistedCraftState now routes its candidate collection through craftStateCandidates
// (descriptor-only — it does NOT read/decode JSON) and decodes only the candidates it needs.
// These cases RECONSTRUCT the incumbent open-release arbitration (test/craft-state.test.ts:481-533)
// purely from craftStateCandidates + decodeCraftState, proving the seam carries enough to preserve
// the invariant without re-driving findPersistedCraftState itself.
// ============================================================================

/** The open-release arbitration policy (state.ts findPersistedCraftState), reconstructed FROM the new seam: first open candidate wins, else the worktree (last) candidate is the tie-break. */
function arbitrateViaSeam(cwd: string, feature: string): CraftState | undefined {
	const [cwdCandidate, worktreeCandidate] = craftStateCandidates(cwd, feature);
	const cwdState = cwdCandidate?.stateFileExists ? decodeCraftState(cwdCandidate.statePath) : undefined;
	const worktreeState = worktreeCandidate?.stateFileExists ? decodeCraftState(worktreeCandidate.statePath) : undefined;
	if (hasOpenRelease(cwdState)) return cwdState;
	if (hasOpenRelease(worktreeState)) return worktreeState;
	return worktreeState ?? cwdState;
}

describe("§1 open-release arbitration is preserved through the craftStateCandidates + decodeCraftState seam (E — AC10)", () => {
	it("craftStateCandidates is descriptor-only — it reports both candidates without reading content, so an unparseable candidate state never makes it throw", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		// Deliberately unparseable JSON at the cwd candidate. If craftStateCandidates decoded, this throws.
		writeRaw(craftStatePath(cwd, feature), "{ this is not valid json ]");

		const candidates = craftStateCandidates(cwd, feature);

		expect(candidates).toHaveLength(2);
		expect(candidates[0].root).toBe(cwd);
		expect(candidates[1].root).toBe(worktreePath(cwd, feature));
		expect(candidates[0].statePath).toBe(craftStatePath(cwd, feature));
		expect(candidates[1].statePath).toBe(craftStatePath(worktreePath(cwd, feature), feature));
		// Existence is detected without decoding — the malformed file "exists", the absent worktree file does not.
		expect(candidates[0].stateFileExists).toBe(true);
		expect(candidates[1].stateFileExists).toBe(false);
		expect(candidates[0].rootExists).toBe(true);
		expect(candidates[1].rootExists).toBe(false);
	});

	it("an unclosed-open worktree candidate is not masked by a stale closed cwd candidate", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, { ...freshState(cwd, feature), openRelease: openEvidence({ closedAt: "2026-07-17T09:00:00.000Z" }) });
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd, feature), worktreeRoot: wt, openRelease: openEvidence() });

		// The open worktree candidate wins — the stale closed cwd candidate cannot mask it.
		expect(hasOpenRelease(arbitrateViaSeam(cwd, feature))).toBe(true);
	});

	it("an unclosed-open cwd candidate is not masked by a stale closed worktree candidate", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, { ...freshState(cwd, feature), openRelease: openEvidence() });
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd, feature), worktreeRoot: wt, openRelease: openEvidence({ closedAt: "2026-07-17T09:00:00.000Z" }) });

		const picked = arbitrateViaSeam(cwd, feature);

		expect(hasOpenRelease(picked)).toBe(true);
		// It is the cwd record (no worktreeRoot), not the stale closed worktree one.
		expect(picked?.worktreeRoot).toBeUndefined();
	});

	it("prefers the worktree candidate when neither candidate is open (tie-break preserved)", () => {
		const cwd = tmpProject();
		const feature = "my-feature";
		writePersistedState(cwd, feature, { ...freshState(cwd, feature), openRelease: openEvidence({ closedAt: "C1" }) });
		const wt = worktreePath(cwd, feature);
		writePersistedState(wt, feature, { ...freshState(cwd, feature), worktreeRoot: wt, openRelease: openEvidence({ closedAt: "C2" }) });

		// Neither candidate is open → the worktree file is the tie-breaker.
		expect(arbitrateViaSeam(cwd, feature)?.worktreeRoot).toBe(wt);
	});
});

// ============================================================================
// §2 — Issuance-slot consumers unharmed by the operationScope extension (AC12 boundary).
//
// consumePendingApproval gains an optional `expectedScope`: both sides absent = match (release.ts's
// unscoped path, unchanged); exactly one side present = scope-mismatch (new); both present =
// canonical-JSON equality. This section pins that the unscoped [Canon Amendment] / release.ts path
// still matches, and that a one-sided scope is a mismatch that PRESERVES the slot (CS11 conditional
// non-burn — a mis-targeted consumer must not destroy a legitimate approval).
// ============================================================================

const CANON_QUESTION = "[Canon Amendment] Protected test canon needs an approved, intentional modification. Proceed?";

function canonIdentity(): ApprovalCraftIdentity {
	return { feature: "gated-feature", projectRoot: "/tmp/deferred-pool-proj" };
}

/** Install a live [Canon Amendment] approval, optionally scope-bound (operationScope is craft Step 3a's new field). */
function installCanonApproval(identity: ApprovalCraftIdentity, operationScope?: Record<string, unknown>): void {
	const record = createPendingApproval({ tag: "[Canon Amendment]", question: CANON_QUESTION, identity });
	installPendingApproval(operationScope === undefined ? record : { ...record, operationScope });
}

describe("§2 operationScope extension preserves the existing unscoped consumers (release.ts / [Canon Amendment])", () => {
	it("preserves release.ts's unscoped consume path: an unscoped approval consumed with no expectedScope matches (both sides absent = match)", () => {
		const identity = canonIdentity();
		installCanonApproval(identity);

		// Exactly release.ts's call shape (acceptedTags: RELEASE_CONSUMABLE_TAGS, no expectedScope).
		const result = consumePendingApproval({ acceptedTags: RELEASE_CONSUMABLE_TAGS, identity });

		expect(result.ok).toBe(true);
		expect(peekPendingApproval()).toBeUndefined(); // single-use burn, unchanged
	});

	it("a one-sided scope (expectedScope supplied against an unscoped approval) is a scope-mismatch that preserves the slot", () => {
		const identity = canonIdentity();
		installCanonApproval(identity); // no operationScope

		const result = consumePendingApproval({ acceptedTags: RELEASE_CONSUMABLE_TAGS, identity, expectedScope: { mode: "merge-and-clean" } });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("scope-mismatch");
		// Conditional non-burn (CS11): a scope mismatch must not destroy the legitimate approval.
		expect(peekPendingApproval()).not.toBeUndefined();
	});

	it("the reverse one-sided case (a scope-bound approval consumed with no expectedScope) is also a scope-mismatch that preserves the slot", () => {
		const identity = canonIdentity();
		installCanonApproval(identity, { mode: "force-clean-only" }); // scope-bound

		const result = consumePendingApproval({ acceptedTags: RELEASE_CONSUMABLE_TAGS, identity });

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("scope-mismatch");
		expect(peekPendingApproval()).not.toBeUndefined();
	});

	it("both scopes present but with keys in a DIFFERENT order still match (canonical-JSON equality is key-order-independent, not naive JSON.stringify)", () => {
		const identity = canonIdentity();
		// A multi-key scope installed in one key order …
		installCanonApproval(identity, { mode: "merge-and-clean", sourceOID: "0f1e2d3c", targetBranch: "main" });

		// … consumed with the SAME content but the keys serialized in a DIFFERENT order.
		const result = consumePendingApproval({
			acceptedTags: RELEASE_CONSUMABLE_TAGS,
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
			runLogAtCycleStart: 1,
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
		expect(begun.runLogAtCycleStart).toBe(5);

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
// no-op when present. (ensureSnapshotsGitignored has no incumbent test — this is its coverage.)
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

	it("ensureSnapshotsGitignored still appends the .snapshots entry on first call and no-ops idempotently", () => {
		const cwd = tmpProject();

		const first = ensureSnapshotsGitignored(cwd);
		expect(first.added).toBe(true);
		expect(readFileSync(first.path, "utf8")).toContain(".lsc/crafts/*/test/.snapshots/");

		const second = ensureSnapshotsGitignored(cwd);
		expect(second.added).toBe(false);
	});
});
