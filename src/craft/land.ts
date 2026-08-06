// `lsc_land` — the fail-closed merge + worktree-cleanup gate (deferred-pool A, T-1+A-5).
//
// post-craft's §7.4 used to run the land sequence as hand-typed bash (checkout → merge --no-ff →
// worktree remove → prune) guarded only by prose. This tool promotes that flow to code, 2-phase
// (plan D2/D3):
//
//   Phase R  — read-only preflight. Anchors the identity to ctx.cwd (never the persisted file:
//              persisted 3-field state is EVIDENCE compared against the anchor, plan §4 principle 4),
//              re-validates the audit evidence strictly (validateLandAuditEvidence — undefined-
//              INTOLERANT, unlike lsc_audit_validate's legacy-tolerant check), observes the real git
//              state (target branch/OID, worktree membership via `git worktree list --porcelain`,
//              tracked-dirt), and pre-validates the removal target (inspect/evaluateRemovalTarget).
//              Nothing is consumed and nothing is written.
//   Phase C/P — consume-first. Reconstructs the CURRENT LandOperation envelope from the Phase R
//              observation and tries to consume the single-use [Land] pending approval against it
//              (tag + anchored identity + canonical-JSON operationScope). On a miss it installs/
//              replaces the prepared-operation envelope (destructive-approval.ts) and returns
//              isError "approval-required" carrying the EXACT approvalQuestion the skill must ask —
//              the re-approval roundtrip (O2) is this transition.
//   Phase X  — effects, only after a successful consume. Merges the APPROVED sourceOID (never the
//              branch ref — post-approval source drift lands the approved OID only), verifies the
//              effect boundary, re-checks the removal target (TOCTOU), removes the worktree
//              (single `--force` only in force-clean-only mode; a locked worktree stays inviolable),
//              and prunes. Partial failures are distinct reason codes, never silent.
//
// Rare, externally-nondeterministic failures (post-abort recovery, prune failure, pre-removal
// re-check) are injectable through the narrow `LandEffects` port so tests drive them
// deterministically under this SAME production orchestrator (C3/rec2). There is deliberately no
// override flag: the escape hatch is a human running git by hand, recorded durably by the skill
// (spec constraint 3).
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { worktreePath, worktreesRootDir } from "../artifacts/paths.js";
import {
	type RemovalObservation,
	type WorktreeEntry,
	evaluateRemovalTarget,
	inspectRemovalTarget,
	parseWorktreePorcelain,
} from "../artifacts/worktree.js";
import {
	type ApprovalCraftIdentity,
	type ConsumeApprovalResult,
	type DestructiveGateTag,
	consumePendingApproval,
	installPreparedOperation,
	invalidatePreparedOperation,
} from "./destructive-approval.js";
import { type CraftState, craftStateCandidates, decodeCraftState } from "./state.js";
import { validateLandAuditEvidence } from "./verdict.js";

/** The destructive gate tags lsc_land consumes — owned by the consumer, not the issuance infra (D1, release-gate CS1). */
export const LAND_CONSUMABLE_TAGS: readonly DestructiveGateTag[] = ["[Land]"];

/**
 * The public reason-code vocabulary lsc_land reports in its isError text (spec AC1/AC3 — 18 codes).
 * `no-pending-approval` is deliberately NOT here: under the 2-phase rule a consume miss always folds
 * into `approval-required` (with the mismatch cause when one exists), so that code is unreachable.
 */
export const LAND_REASON_CODES = [
	"no-audit-evidence",
	"no-audit-cycle",
	"cycle-mismatch",
	"verdict-not-approve",
	"stale-check-log",
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

export type LandReasonCode = (typeof LAND_REASON_CODES)[number];

export type LandMode = "merge-and-clean" | "force-clean-only";

/** The concrete operation a [Land] approval is scoped to — canonical-JSON-compared at consume (D2). */
export interface LandOperation {
	sourceBranch: string;
	sourceOID: string;
	targetBranch: string;
	targetOID: string;
	mode: LandMode;
}

/**
 * The narrow effect port Phase X runs through (C3/rec2). Defaults are real git (async — a tool
 * execute must never block the host's event loop on a child-process spawn); tests inject only the
 * externally-nondeterministic failures, sync or async (the orchestrator awaits either).
 * `inspectRemovalTarget` is ALSO the Phase R preflight observer, so the pre-removal re-check is
 * provably re-run at removal time (dead-code false-green barrier — the injected counter sees BOTH calls).
 */
export interface LandEffects {
	/** `git merge --no-ff --no-edit <sourceOID>` — throws on failure/conflict. */
	merge(sourceOID: string): void | Promise<void>;
	/** `git merge --abort` — best-effort; the post-state verification is the judge, not this call's exit. */
	abortMerge(): void | Promise<void>;
	/** Post-abort recovery verification: branch === targetBranch, HEAD === targetOID, clean status. */
	verifyPostRecovery(expected: { targetBranch: string; targetOID: string }): boolean | Promise<boolean>;
	/** Observe the removal candidate (Phase R preflight AND the Phase X pre-removal re-check). */
	inspectRemovalTarget(candidate: string): RemovalObservation | Promise<RemovalObservation>;
	/** `git worktree remove [--force] <path>` — throws on failure. Single --force only; never --force --force. */
	remove(path: string, force: boolean): void | Promise<void>;
	/** `git worktree prune` — throws on failure. */
	prune(): void | Promise<void>;
}

export interface LandDetails {
	feature: string;
	mode: LandMode;
	reason?: LandReasonCode;
	/** Present on approval-required: the EXACT [Land] question the skill must ask via lsc_confirm. */
	approvalQuestion?: string;
	/** Present on a successful merge-and-clean: the merge commit OID. */
	mergeCommit?: string;
}

const execFileAsync = promisify(execFile);

/** Async git runner — never a sync spawn: a blocked event loop starves the host (and, under vitest load, the worker↔main RPC). */
async function gitIn(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
	return stdout.trim();
}

function defaultLandEffects(projectRoot: string): LandEffects {
	return {
		async merge(sourceOID) {
			await gitIn(projectRoot, ["merge", "--no-ff", "--no-edit", sourceOID]);
		},
		async abortMerge() {
			await gitIn(projectRoot, ["merge", "--abort"]);
		},
		async verifyPostRecovery(expected) {
			try {
				return (
					(await gitIn(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"])) === expected.targetBranch &&
					(await gitIn(projectRoot, ["rev-parse", "HEAD"])) === expected.targetOID &&
					(await gitIn(projectRoot, ["status", "--porcelain"])) === ""
				);
			} catch {
				return false;
			}
		},
		inspectRemovalTarget(candidate) {
			return inspectRemovalTarget(candidate);
		},
		async remove(path, force) {
			await gitIn(projectRoot, ["worktree", "remove", ...(force ? ["--force"] : []), path]);
		},
		async prune() {
			await gitIn(projectRoot, ["worktree", "prune"]);
		},
	};
}

/**
 * Find the registered worktree entry for `target`. Git normalizes registered paths (realpath at
 * registration time), so after the literal comparison the fallback normalizes PARENT symlinks only
 * (macOS /var → /private/var) via realpath(dirname) + basename — NEVER a symlink at the target
 * itself, so a symlink swapped in at the registered path cannot redirect the lookup to the main
 * repository's own entry (T13).
 */
function findWorktreeEntry(entries: readonly WorktreeEntry[], target: string): WorktreeEntry | undefined {
	const literal = entries.find(entry => entry.path === target);
	if (literal) return literal;
	let normalized = target;
	try {
		normalized = join(realpathSync(dirname(target)), basename(target));
	} catch {
		// The parent may not exist — the literal comparison above already covered that shape.
	}
	return entries.find(entry => entry.path === normalized);
}

function shortOID(oid: string): string {
	return oid.slice(0, 12);
}

/** The exact [Land] question a given operation envelope requires — scope-distinct operations produce distinct questions. */
function composeLandQuestion(feature: string, op: LandOperation): string {
	if (op.mode === "force-clean-only") {
		return (
			`[Land] Force-remove the worktree at .lsc/worktrees/${feature}/ without merging ` +
			`(source "${op.sourceBranch}" @ ${shortOID(op.sourceOID)}, target "${op.targetBranch}" @ ${shortOID(op.targetOID)}, ` +
			`mode: force-clean-only — uncommitted changes in the worktree will be lost)? Proceed?`
		);
	}
	return (
		`[Land] Merge "${op.sourceBranch}" @ ${shortOID(op.sourceOID)} into "${op.targetBranch}" @ ${shortOID(op.targetOID)} ` +
		`(mode: merge-and-clean) and remove the worktree at .lsc/worktrees/${feature}/? Merge?`
	);
}

function landError(reason: LandReasonCode, feature: string, mode: LandMode, text: string, extra?: Partial<LandDetails>): AgentToolResult<LandDetails> {
	return {
		isError: true,
		content: [{ type: "text", text: `lsc_land: ${reason} — ${text}` }],
		details: { feature, mode, reason, ...extra },
	};
}

/**
 * Core land orchestrator (Phase R → C/P → X). Split from the registerTool wrapper so the fixture
 * tests can drive it through the captured production execute with an injected effect port.
 */
export async function performLand(feature: string, mode: LandMode, cwd: string, effectsOverride?: Partial<LandEffects>): Promise<AgentToolResult<LandDetails>> {
	const projectRoot = cwd;
	const worktreeRoot = worktreePath(projectRoot, feature);
	const anchor: ApprovalCraftIdentity = { feature, projectRoot, worktreeRoot };
	const effects: LandEffects = { ...defaultLandEffects(projectRoot), ...effectsOverride };

	// ── Phase R — read-only preflight (nothing consumed, nothing written) ──────────────────────────
	// ① Observe the target (the main checkout at ctx.cwd — land never checks branches out itself).
	const targetBranch = await gitIn(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const targetOID = await gitIn(projectRoot, ["rev-parse", "HEAD"]);

	// ② Observe the source through the porcelain seam (never by cd-ing into the worktree — a
	//    symlink-swapped worktree must not redirect the observation, T13).
	const entries = parseWorktreePorcelain(await gitIn(projectRoot, ["worktree", "list", "--porcelain"]));
	const entry = findWorktreeEntry(entries, worktreeRoot);
	const sourceBranch = entry?.branch?.replace(/^refs\/heads\//, "") ?? `lets-craft/${feature}`;

	// ③ Self-merge guard: the target checkout sitting on the feature branch has no distinct source.
	if (targetBranch === sourceBranch) {
		return landError("self-merge", feature, mode, `the project root is checked out on the feature branch "${targetBranch}" — check out the base branch first; there is nothing distinct to merge.`);
	}

	// ④ Membership gate (closes removeWorktree's missing-success no-op trap, K4).
	if (!entry || !entry.head) {
		return landError("not-registered", feature, mode, `no git-registered worktree exists at ${worktreeRoot} (git worktree list membership). An already-cleaned land cannot be replayed.`);
	}
	const sourceOID = entry.head;

	// ⑤ Tracked target dirt refuses early (spec C2 보정: `??`-only untracked is delegated to git merge's
	//    own native refusal semantics — it is NOT target-dirty).
	const statusLines = (await gitIn(projectRoot, ["status", "--porcelain"]))
		.split("\n")
		.filter(line => line.trim() !== "");
	if (statusLines.some(line => !line.startsWith("??"))) {
		return landError("target-dirty", feature, mode, `the target checkout has tracked, uncommitted changes — commit or stash them first (untracked files are left to git merge's own refusal semantics).`);
	}

	// ⑥ Persisted evidence: load via the candidate/decoder seam and compare the 3 anchor fields —
	//    the persisted file is EVIDENCE against the ctx.cwd anchor, never the identity authority.
	const candidates = craftStateCandidates(projectRoot, feature);
	const stateCandidate = [...candidates].reverse().find(candidate => candidate.stateFileExists);
	let state: CraftState | undefined;
	try {
		state = stateCandidate ? decodeCraftState(stateCandidate.statePath) : undefined;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return landError("no-audit-evidence", feature, mode, `the persisted craft state could not be decoded: ${message}`);
	}
	if (!stateCandidate || !state) {
		return landError("no-audit-evidence", feature, mode, `no persisted craft state exists for "${feature}" (checked the project root and ${worktreeRoot}) — a craft/post-craft cycle must have run.`);
	}
	const evidenceRoot = stateCandidate.root;
	if (state.feature !== anchor.feature || state.projectRoot !== anchor.projectRoot || state.worktreeRoot !== anchor.worktreeRoot) {
		return landError(
			"evidence-mismatch",
			feature,
			mode,
			`the persisted craft state's identity fields do not match this invocation's anchor ` +
				`(persisted: ${JSON.stringify({ feature: state.feature, projectRoot: state.projectRoot, worktreeRoot: state.worktreeRoot })}, ` +
				`anchor: ${JSON.stringify(anchor)}).`,
		);
	}

	// ⑦ Strict audit re-validation (D4 — undefined-INTOLERANT; the auditValidated marker is
	//    cycle-aware evidence, never authority).
	const audit = validateLandAuditEvidence(evidenceRoot, feature, state);
	if (!audit.ok) {
		// m1: a state file persisted before the C3 rename (runLogAtCycleStart -> checkLogAtCycleStart)
		// has no checkLogAtCycleStart at all, so lsc_audit_validate passes leniently (validateAuditFreshness
		// tolerates the missing threshold) while this undefined-INTOLERANT gate still refuses with
		// no-audit-cycle — that specific combination is the expected symptom, not a new bug.
		const migrationHint =
			audit.reason === "no-audit-cycle"
				? " If lsc_audit_validate reported success for this feature but land refuses here, the persisted state " +
					"predates the checkLogAtCycleStart field (C3) — re-run lsc_audit_begin to record the threshold under the current schema."
				: "";
		return landError(audit.reason, feature, mode, `strict land-time audit re-validation failed (evidence root: ${evidenceRoot}).${migrationHint}`);
	}
	const marker = state.auditValidated;
	const markerWarn =
		marker === undefined
			? "WARN: no auditValidated marker is persisted (best-effort trace absent — the strict re-validation above is the gate)."
			: marker.cycle < audit.auditNumber
				? `WARN: the persisted auditValidated marker is from a previous cycle (${marker.cycle} < ${audit.auditNumber}) — ignored.`
				: "";

	// ⑧ Preflight removal-target validation (through the SAME effects port the Phase X re-check uses).
	//    Containment roots are pre-resolved (evaluateRemovalTarget's contract): the observation's
	//    resolvedPath is a realpath, so a symlinked parent (e.g. macOS /var → /private/var) must be
	//    matchable against the realpath'd root as well as the lexical one.
	const worktreesRoot = worktreesRootDir(projectRoot);
	let worktreesRootReal = worktreesRoot;
	try {
		worktreesRootReal = realpathSync(worktreesRoot);
	} catch {
		// The parent may not exist yet — the lexical root alone still bounds the check.
	}
	const expectedRoots = worktreesRootReal === worktreesRoot ? [worktreesRoot] : [worktreesRoot, worktreesRootReal];
	const preflightEval = evaluateRemovalTarget(await effects.inspectRemovalTarget(worktreeRoot), expectedRoots);
	if (!preflightEval.ok) {
		return landError("validation-reject", feature, mode, `removal-target validation rejected ${worktreeRoot} (${preflightEval.reason}); nothing was merged or removed.`);
	}

	// ── Phase C/P — consume-first, prepare on miss ─────────────────────────────────────────────────
	// The consume envelope's SOURCE dimensions come from the DURABLE issuance evidence when present
	// (spec AC3: post-approval source drift lands the APPROVED sourceOID, never the moved tip); the
	// TARGET dimensions and mode are always the live observation (target drift = scope-mismatch).
	// The pending slot's canonical-JSON equality stays the sole consume authority — the evidence only
	// proposes the candidate envelope, so tampered evidence still folds into a fail-closed mismatch.
	// A consume MISS installs the LIVE observation as the prepared envelope: a fresh approval always
	// binds the operation as it stands now.
	const observedOperation: LandOperation = { sourceBranch, sourceOID, targetBranch, targetOID, mode };
	const approvedScope = state.releaseApproval?.tag === "[Land]" ? state.releaseApproval.operationScope : undefined;
	const approvedSource =
		typeof approvedScope === "object" &&
		approvedScope !== null &&
		typeof (approvedScope as Record<string, unknown>).sourceBranch === "string" &&
		typeof (approvedScope as Record<string, unknown>).sourceOID === "string"
			? { sourceBranch: (approvedScope as Record<string, unknown>).sourceBranch as string, sourceOID: (approvedScope as Record<string, unknown>).sourceOID as string }
			: undefined;
	const operation: LandOperation = approvedSource ? { ...observedOperation, ...approvedSource } : observedOperation;
	const consume: ConsumeApprovalResult = consumePendingApproval({ acceptedTags: LAND_CONSUMABLE_TAGS, identity: anchor, expectedScope: operation });
	if (!consume.ok) {
		const cause: LandReasonCode | undefined =
			consume.reason === "identity-mismatch" ? "identity-mismatch" : consume.reason === "scope-mismatch" ? "scope-mismatch" : undefined;
		const approvalQuestion = composeLandQuestion(feature, observedOperation);
		installPreparedOperation({
			prepareId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
			tag: "[Land]",
			identity: anchor,
			operationScope: observedOperation,
			approvalQuestion,
			evidenceRoot,
		});
		return landError(
			"approval-required",
			feature,
			mode,
			`${cause ? `(cause: ${cause}) ` : ""}no consumable [Land] approval matches this exact operation. ` +
				`${markerWarn ? `${markerWarn} ` : ""}Ask the user the EXACT question below via lsc_confirm; a platform "yes" issues the scoped approval, then re-call lsc_land:\n` +
				`${approvalQuestion}\n` +
				`(operation: source "${sourceBranch}" @ ${shortOID(sourceOID)} → target "${targetBranch}" @ ${shortOID(targetOID)}, mode: ${mode})`,
			{ approvalQuestion },
		);
	}
	invalidatePreparedOperation("[Land]");

	// ── Phase X — effects (the single-use nonce is now consumed) ───────────────────────────────────
	// Effect-boundary re-observation: target drift between consume and effect refuses with the nonce
	// state made explicit (a consumed nonce means a fresh approval is required either way).
	const targetBranchNow = await gitIn(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
	const targetOIDNow = await gitIn(projectRoot, ["rev-parse", "HEAD"]);
	if (targetBranchNow !== operation.targetBranch || targetOIDNow !== operation.targetOID) {
		return landError(
			"scope-mismatch",
			feature,
			mode,
			`the target moved between consume and effect ("${targetBranchNow}" @ ${shortOID(targetOIDNow)} vs approved "${operation.targetBranch}" @ ${shortOID(operation.targetOID)}). ` +
				`The single-use [Land] nonce WAS consumed — nothing was merged; a fresh approval is required.`,
		);
	}

	let mergeCommit: string | undefined;
	if (mode === "merge-and-clean") {
		try {
			await effects.merge(operation.sourceOID);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			try {
				await effects.abortMerge();
			} catch {
				// abort's own exit is not the judge — the post-state verification below is (plan guardrail 8).
			}
			const recovered = await effects.verifyPostRecovery({ targetBranch: operation.targetBranch, targetOID: operation.targetOID });
			if (recovered) {
				return landError(
					"merge-aborted",
					feature,
					mode,
					`merging ${shortOID(operation.sourceOID)} failed (${message.split("\n")[0]}); \`git merge --abort\` ran and the post-state verification ` +
						`confirmed the repository was restored to "${operation.targetBranch}" @ ${shortOID(operation.targetOID)} (원복). ` +
						`The single-use [Land] nonce was consumed — resolve the conflict source and re-approve to retry.`,
				);
			}
			return landError(
				"merge-recovery-failed",
				feature,
				mode,
				`merging ${shortOID(operation.sourceOID)} failed AND the post-abort verification could NOT confirm restoration (원복 미보장) — ` +
					`the repository may be mid-merge; inspect \`git status\` manually. The [Land] nonce was consumed.`,
			);
		}
		mergeCommit = await gitIn(projectRoot, ["rev-parse", "HEAD"]);
	}

	// Pre-removal re-check (TOCTOU mitigation): membership + a FRESH inspect/evaluate through the
	// effects port. A rejection here must abort BEFORE any removal call.
	const entriesNow = parseWorktreePorcelain(await gitIn(projectRoot, ["worktree", "list", "--porcelain"]));
	const entryNow = findWorktreeEntry(entriesNow, worktreeRoot);
	const recheck = entryNow ? evaluateRemovalTarget(await effects.inspectRemovalTarget(worktreeRoot), expectedRoots) : undefined;
	if (!entryNow || !recheck || !recheck.ok) {
		const why = !entryNow ? "the worktree is no longer git-registered" : `re-inspection rejected the target (${recheck && !recheck.ok ? recheck.reason : "unknown"})`;
		return landError(
			"validation-reject",
			feature,
			mode,
			`the pre-removal re-check failed: ${why}. removeWorktree was NOT called; the worktree directory is preserved.` +
				(mergeCommit ? ` The merge itself completed (${shortOID(mergeCommit)}).` : ""),
		);
	}

	try {
		await effects.remove(worktreeRoot, mode === "force-clean-only");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (mode === "force-clean-only") {
			return landError(
				"merged-but-not-cleaned",
				feature,
				mode,
				`worktree force-removal failed: ${message.split("\n")[0]}. A locked worktree resists a single --force and land never ` +
					`double-forces (git owns lock semantics) — unlock it manually (\`git worktree unlock\`) and re-approve.`,
			);
		}
		return landError(
			"merged-but-not-cleaned",
			feature,
			mode,
			`the merge completed (${mergeCommit ? shortOID(mergeCommit) : "n/a"}) but no-force worktree removal failed: ${message.split("\n")[0]}. ` +
				`The worktree is preserved (uncommitted/untracked content is never silently discarded). To force-remove it, obtain a FRESH [Land] ` +
				`approval scoped to mode "force-clean-only" and re-call lsc_land with mode: "force-clean-only".`,
			{ mergeCommit },
		);
	}

	try {
		await effects.prune();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return landError(
			"cleaned-but-not-pruned",
			feature,
			mode,
			`the merge and worktree removal completed${mergeCommit ? ` (${shortOID(mergeCommit)})` : ""} but \`git worktree prune\` failed: ` +
				`${message.split("\n")[0]}. Run \`git worktree prune\` manually to reclaim the stale metadata.`,
			{ mergeCommit },
		);
	}

	const summary =
		mode === "force-clean-only"
			? `lets-craft: force-clean-only land for "${feature}" complete — the worktree at ${worktreeRoot} was force-removed and pruned (no merge).`
			: `lets-craft: landed "${feature}" — merged approved ${shortOID(operation.sourceOID)} ("${operation.sourceBranch}") into "${operation.targetBranch}" ` +
				`as ${shortOID(mergeCommit ?? "")} (--no-ff), removed the worktree at ${worktreeRoot}, and pruned stale metadata.` +
				(markerWarn ? `\n${markerWarn}` : "");
	return { content: [{ type: "text", text: summary }], details: { feature, mode, mergeCommit } };
}

/** Register `lsc_land` (A). `effects` lets tests inject deterministic rare failures (C3/rec2). */
export function registerLandTool(pi: ExtensionAPI, effects?: Partial<LandEffects>): void {
	const z = pi.zod;
	const parameters = z.object({
		feature: z.string().describe("Feature name (kebab-case slug) whose worktree should be landed."),
		mode: z
			.enum(["merge-and-clean", "force-clean-only"])
			.optional()
			.describe('Land mode. Default "merge-and-clean" (merge the approved sourceOID --no-ff, then remove+prune). "force-clean-only" skips the merge and force-removes a dirty worktree — it requires its own mode-scoped [Land] approval.'),
	});

	pi.registerTool<typeof parameters, LandDetails>({
		name: "lsc_land",
		loadMode: "discoverable",
		label: "Craft: land an approved feature (merge + worktree cleanup)",
		description:
			"Fail-closed merge + worktree cleanup for a post-craft-approved feature (2-phase). Phase R re-validates the audit " +
			"evidence strictly (fresh APPROVE-family verdict + passing post-cycle run log), anchors the identity to ctx.cwd, and " +
			"validates the removal target. Phase C/P consumes the single-use [Land] approval scoped to the EXACT observed " +
			"operation (source/target branch+OID, mode); on a miss it returns isError 'approval-required' with the exact " +
			"question to ask via lsc_confirm. Phase X merges the APPROVED sourceOID (--no-ff), removes the worktree, and prunes " +
			"— partial failures report distinct reason codes. There is no override flag; the escape hatch is manual git, " +
			"recorded durably per skills/post-craft/SKILL.md.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<LandDetails>> {
			const feature = params.feature;
			const mode: LandMode = params.mode ?? "merge-and-clean";
			try {
				return await performLand(feature, mode, ctx.cwd, effects);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: `lsc_land: unexpected failure — ${message}` }], details: { feature, mode } };
			}
		},
	});
}
