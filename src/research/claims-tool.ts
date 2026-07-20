// `lsc_claims` — the fs half of the research claim ledger (deferred-pool F, D-2). ledger.ts stays a
// pure, fs-untouched evaluator; THIS wrapper owns everything effectful (C4/rec6 pure boundary): the
// path capability (root FIXED to `worktreePath(ctx.cwd, feature)` — all-in-worktree, so a same-named
// project-root artifact is never read or written), the registered-worktree gate, the target/parent
// symlink + realpath containment refusals (all BEFORE any write), the read/validate/evaluate pass,
// and the SINGLE atomic write that stamps each claim's `decision` — the decision field is this
// tool's sole property (canon/projection contract: claims.json is the 정본, SYNTHESIS.md a
// projection). All-or-nothing: one invalid claim ⇒ zero bytes change.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentToolResult, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { craftClaimsPath, worktreePath } from "../artifacts/paths.js";
import { isRegisteredWorktree } from "../artifacts/worktree.js";
import { writeFileAtomicSync } from "../utils/atomic-write.js";
import { type Claim, type ClaimStatus, evaluateLedger } from "./ledger.js";

/** Injectable effect seam (M5/rec6): `writeFile` defaults to writeFileAtomicSync — tests inject a recording pass-through to assert exactly-once. */
export interface ClaimsToolDeps {
	writeFile?: (filePath: string, data: string) => void;
}

export interface ClaimsDetails {
	feature: string;
	claimsPath: string;
	evaluated: number;
	accepted: number;
	rejected: number;
	uncertain: number;
}

/** kebab-case slug — the only feature shape accepted (`.`/`..`/NUL/separator injection refused before any fs access). */
const FEATURE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CLAIM_VERDICTS: readonly string[] = ["support", "contradict", "uncertain"];

function claimsError(text: string): AgentToolResult<ClaimsDetails> {
	return { isError: true, content: [{ type: "text", text: `lsc_claims: ${text}` }] };
}

/** Validate the parsed claims.json shape ({ claims: Claim[] }) without throwing — a missing dropCondition is NOT a shape error (evaluateLedger owns that as `invalid`). */
function decodeClaimsFile(raw: unknown): Claim[] | undefined {
	if (typeof raw !== "object" || raw === null || !("claims" in raw)) return undefined;
	const claims = raw.claims;
	if (!Array.isArray(claims)) return undefined;
	const decoded: Claim[] = [];
	for (const item of claims) {
		if (typeof item !== "object" || item === null || !("claim" in item) || !("evidence" in item)) return undefined;
		if (typeof item.claim !== "string" || !Array.isArray(item.evidence)) return undefined;
		for (const entry of item.evidence) {
			if (typeof entry !== "object" || entry === null || !("source" in entry) || !("verdict" in entry)) return undefined;
			if (typeof entry.source !== "string" || typeof entry.verdict !== "string" || !CLAIM_VERDICTS.includes(entry.verdict)) return undefined;
		}
		// Load-bearing fields (claim, evidence[].source/verdict) are runtime-verified above; dropCondition/
		// decision stay deliberately tolerant (evaluateLedger owns their handling), and unknown extra keys
		// must survive the round-trip — hence one named, reasoned cast instead of a lossy reconstruction.
		const verified = item as Claim;
		decoded.push(verified);
	}
	return decoded;
}

/**
 * Core lsc_claims orchestrator. Validation (slug → registered worktree → symlink/containment →
 * parse/shape → full evaluation) happens entirely BEFORE the single write; any failure leaves the
 * ledger byte-identical.
 */
export async function performClaims(featureDir: string, cwd: string, deps: ClaimsToolDeps = {}): Promise<AgentToolResult<ClaimsDetails>> {
	// ① Slug gate — before touching the filesystem at all.
	if (!FEATURE_SLUG_RE.test(featureDir) || featureDir.includes("\0")) {
		return claimsError(`feature_dir must be a bare kebab-case slug (got ${JSON.stringify(featureDir)}) — path separators, traversal segments, and special characters are refused before any filesystem access.`);
	}
	const feature = featureDir;

	// ② Root is FIXED to the worktree (all-in-worktree): the main session's cwd is the project root,
	//    and a project-root claims.json must never be read or written — even on the success path.
	const worktreeRoot = worktreePath(cwd, feature);
	if (!(await isRegisteredWorktree(cwd, worktreeRoot))) {
		return claimsError(`no git-registered worktree exists at ${worktreeRoot} — lsc_claims only ever operates on the feature worktree's ledger (root is fixed to worktreePath, never the project root).`);
	}

	// ③ Capability: the target must not be a symlink, and its PARENT must realpath-resolve inside
	//    the worktree — a link pointing out of containment is refused before any write.
	const claimsPath = craftClaimsPath(worktreeRoot, feature);
	if (!existsSync(claimsPath)) {
		return claimsError(`no claims.json at ${claimsPath} — the research stage must create the ledger before lsc_claims can evaluate it.`);
	}
	if (lstatSync(claimsPath).isSymbolicLink()) {
		return claimsError(`${claimsPath} is a symlink — the write capability is the exact worktree ledger path, so a redirect is refused.`);
	}
	try {
		const parentReal = realpathSync(dirname(claimsPath));
		const rootReal = realpathSync(worktreeRoot);
		if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}/`)) {
			return claimsError(`the claims.json parent directory escapes the worktree (realpath containment: ${parentReal} is outside ${rootReal}) — refused before any write.`);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return claimsError(`could not resolve the claims path for containment checking: ${message}`);
	}

	// ④ Parse + validate the WHOLE file first (all-or-nothing).
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(claimsPath, "utf8"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return claimsError(`claims.json is not valid JSON (${message}) — zero bytes changed.`);
	}
	const claims = decodeClaimsFile(parsed);
	if (!claims) {
		return claimsError(`claims.json does not match the ledger shape { claims: [{ claim, dropCondition, evidence: [{source, verdict}] }] } — zero bytes changed.`);
	}

	// ⑤ Transition input: each claim's CURRENT on-disk decision.status, read BEFORE re-evaluation —
	//    this is what makes tombstone monotonicity (no revival) enforceable.
	const previousDecisions: Record<string, ClaimStatus> = {};
	for (const entry of claims) {
		if (entry.decision?.status) previousDecisions[entry.claim] = entry.decision.status;
	}

	// ⑥ Evaluate everything; ONE invalid claim fails the whole call with zero bytes changed.
	const evaluations = evaluateLedger(claims, previousDecisions);
	const invalid = evaluations.filter(evaluation => evaluation.status === "invalid");
	if (invalid.length > 0) {
		return claimsError(
			`${invalid.length} claim(s) are invalid — nothing was written (all-or-nothing): ` +
				invalid.map(evaluation => `"${evaluation.claim}" (${evaluation.reasons.join("; ")})`).join(", "),
		);
	}

	// ⑦ Stamp decisions (the tool's sole property — evaluatedAt is fresh, never copied forward) and
	//    persist via EXACTLY ONE write through the injectable atomic port.
	const evaluatedAt = new Date().toISOString();
	const decisionByClaim = new Map(evaluations.map(evaluation => [evaluation.claim, evaluation]));
	const stamped = claims.map(entry => {
		const evaluation = decisionByClaim.get(entry.claim);
		if (!evaluation) return entry;
		return { ...entry, decision: { status: evaluation.status, reasons: evaluation.reasons, evaluatedAt } };
	});
	const writeFile = deps.writeFile ?? writeFileAtomicSync;
	writeFile(claimsPath, JSON.stringify({ claims: stamped }, null, 2));

	const count = (status: ClaimStatus): number => evaluations.filter(evaluation => evaluation.status === status).length;
	return {
		content: [
			{
				type: "text",
				text:
					`lets-craft: claim ledger for "${feature}" re-evaluated — ${evaluations.length} claim(s): ` +
					`${count("accepted")} accepted, ${count("rejected")} rejected, ${count("uncertain")} uncertain. ` +
					`Decisions stamped at ${evaluatedAt} (claims.json is the canon; regenerate SYNTHESIS.md from it, never the reverse).`,
			},
		],
		details: { feature, claimsPath, evaluated: evaluations.length, accepted: count("accepted"), rejected: count("rejected"), uncertain: count("uncertain") },
	};
}

/** Register `lsc_claims` (F). `deps` lets tests inject a recording atomic-write port (M5). */
export function registerClaimsTool(pi: ExtensionAPI, deps?: ClaimsToolDeps): void {
	const z = pi.zod;
	const parameters = z.object({
		feature_dir: z.string().describe("Feature name — bare kebab-case slug only (never a path; traversal/separator input is refused before any filesystem access)."),
	});

	pi.registerTool<typeof parameters, ClaimsDetails>({
		name: "lsc_claims",
		loadMode: "discoverable",
		label: "Craft: re-evaluate the research claim ledger",
		description:
			"Re-evaluate the feature worktree's research/claims.json through the pure decision ladder (dropCondition required; " +
			"a contradiction with no surviving support rejects unconditionally; a rejected/invalid claim is a tombstone that " +
			"fresh support never revives) and stamp each claim's decision {status, reasons, evaluatedAt} in EXACTLY ONE atomic " +
			"write. Root is fixed to the registered worktree (never the project root); symlink/containment escapes and any " +
			"invalid claim refuse the whole call with zero bytes changed. claims.json is the canonical ledger — SYNTHESIS.md " +
			"is a projection derived from it, never edited backward.",
		approval: "read",
		parameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ClaimsDetails>> {
			try {
				return await performClaims(params.feature_dir, ctx.cwd, deps);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { isError: true, content: [{ type: "text", text: `lsc_claims: unexpected failure — ${message}` }] };
			}
		},
	});
}
