// W2-d (claims slice) — production-seam integration for lsc_claims (deferred-pool AC11 tool half,
// plan §6 Step 5a, appendix-test-plan W2-d, appendix-security: worktree-fixed root + containment).
//
// The pure evaluator (evaluateLedger's ladder + tombstone monotonicity) is the unit tester's domain
// (W1-c, research-ledger.test.ts). THIS file captures the ACTUALLY-registered `lsc_claims` execute
// through an SDK-boundary mock `pi` and drives it against a real mkdtemp git repo + registered
// worktree, asserting the TOOL's contract: kebab-case-only slug, worktree-fixed root (never a
// project-root artifact, even on the success path), realpath containment + target/parent symlink
// refusal, "one invalid claim ⇒ byte-0 change", and — via an INJECTED atomic-write port — exactly one
// write to craftClaimsPath on full success (call count · path · payload), with the tool the sole owner
// of each claim's `decision:{status,reasons,evaluatedAt}` (evaluatedAt stamped fresh at run time, not
// copied from input; C4/rec6 wrapper split + M5 exactly-once/parent-symlink/evaluatedAt).
//
// PRE-CRAFT / RED EXPECTATION: src/research/claims-tool.ts (the SDK-independent thin wrapper that hosts
// registerClaimsTool) does not exist yet, so this file fails to LOAD (import-shaped RED on
// `../src/research/claims-tool`). ledger.ts stays a pure, fs-untouched evaluator — this file never
// imports it (pure boundary, C4). That RED is the correct test-first outcome; making it green is craft's job.
//
// Contract with the unit tester (confirmed): claims.json = { claims: Claim[] } (no version field);
// Claim = { claim, dropCondition, evidence: {source, verdict:"support"|"contradict"|"uncertain"}[],
// decision? }. A missing dropCondition is NOT a throw — evaluateLedger returns status "invalid", and
// the tool's byte-0 gate reads that and refuses.
import { execFileSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import * as zod from "zod/v4";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { craftClaimsPath, worktreePath } from "../src/artifacts/paths";
// NEW MODULE (Step 5a) — the import that makes this file import-RED pre-craft.
import { registerClaimsTool } from "../src/research/claims-tool";

// ── claims.json boundary schema (validated read-back, never an inline cast) ───
const DecisionSchema = zod.object({
	status: zod.enum(["accepted", "rejected", "uncertain", "invalid"]),
	reasons: zod.array(zod.string()),
	evaluatedAt: zod.string(),
});
const ClaimSchema = zod.object({
	claim: zod.string(),
	dropCondition: zod.string().optional(), // optional in the SCHEMA so a deliberately-invalid fixture parses
	evidence: zod.array(zod.object({ source: zod.string(), verdict: zod.enum(["support", "contradict", "uncertain"]) })),
	decision: DecisionSchema.optional(),
});
const ClaimsFileSchema = zod.object({ claims: zod.array(ClaimSchema) });

// ── SDK-boundary double (capture the real registered execute) ────────────────
interface ToolResultLike {
	isError?: boolean;
	content: Array<{ type: string; text: string }>;
	details?: unknown;
}
type ToolExecute = (toolCallId: string, params: Record<string, unknown>, signal: unknown, onUpdate: unknown, ctx: { cwd: string; hasUI: boolean }) => Promise<ToolResultLike>;

function isNamedExecutable(value: unknown): value is { name: string; execute: ToolExecute } {
	return (
		typeof value === "object" &&
		value !== null &&
		"name" in value &&
		typeof value.name === "string" &&
		"execute" in value &&
		typeof value.execute === "function"
	);
}

// ── injectable atomic-write port (M5 exactly-once oracle) ─────────────────────
// registerClaimsTool(pi, deps?) mirrors registerLandTool(pi, effects?): a 2nd optional deps arg whose
// members override real defaults (writeFile defaults to writeFileAtomicSync). The test injects a
// recording pass-through so a successful write is observable as {path,data} AND still lands on disk.
type WriteFilePort = (filePath: string, data: string) => void;
interface ClaimsDeps {
	writeFile?: WriteFilePort;
}
interface WriteCall {
	path: string;
	data: string;
}
interface RecordingWriter extends ClaimsDeps {
	writeFile: WriteFilePort;
	calls: WriteCall[];
}

/** A writeFile port double that records every (path,data) call and still persists it (pass-through),
 * so exactly-once can be asserted on `calls` while read-back on disk stays observable. */
function recordingWriter(): RecordingWriter {
	const calls: WriteCall[] = [];
	return {
		calls,
		writeFile(filePath, data) {
			calls.push({ path: filePath, data });
			writeFileSync(filePath, data);
		},
	};
}

function captureClaimsExecute(deps?: ClaimsDeps): ToolExecute {
	let execute: ToolExecute | undefined;
	const pi = {
		zod,
		getFlag: () => undefined,
		registerTool(definition: unknown): void {
			if (isNamedExecutable(definition) && definition.name === "lsc_claims") execute = definition.execute;
		},
	};
	registerClaimsTool(pi as unknown as Parameters<typeof registerClaimsTool>[0], deps as unknown as Parameters<typeof registerClaimsTool>[1]);
	if (!execute) throw new Error("registerClaimsTool did not register an lsc_claims tool with an execute");
	return execute;
}

function textOf(result: ToolResultLike): string {
	const first = result.content?.[0];
	if (first && typeof first === "object" && "text" in first && typeof first.text === "string") return first.text;
	throw new Error("expected the first tool-result content item to be text");
}

// ── git fixture ──────────────────────────────────────────────────────────────
const tempDirs: string[] = [];
let savedFixtureEnv: string | undefined;

beforeEach(() => {
	savedFixtureEnv = process.env.LSC_FIXTURE;
	delete process.env.LSC_FIXTURE;
});

afterEach(() => {
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
	const dir = mkdtempSync(join(tmpdir(), "lsc-claims-"));
	tempDirs.push(dir);
	git(dir, ["init", "-q", "-b", "main"]);
	git(dir, ["config", "user.email", "test@example.com"]);
	git(dir, ["config", "user.name", "Test"]);
	writeFileSync(join(dir, "README.md"), "seed\n");
	git(dir, ["add", "README.md"]);
	git(dir, ["commit", "-q", "-m", "init"]);
	return dir;
}

function outsideDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-claims-out-"));
	tempDirs.push(dir);
	return dir;
}

interface ClaimsFixture {
	projectRoot: string;
	worktreeRoot: string;
	claimsPath: string;
}

/** A git repo with a registered worktree and a seeded claims.json at craftClaimsPath(worktreeRoot). */
function setupClaimsWorktree(feature: string, claims: unknown): ClaimsFixture {
	const projectRoot = tmpGitRepo();
	const worktreeRoot = worktreePath(projectRoot, feature);
	git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
	const claimsPath = craftClaimsPath(worktreeRoot, feature);
	mkdirSync(dirname(claimsPath), { recursive: true });
	writeFileSync(claimsPath, JSON.stringify({ claims }, null, 2));
	return { projectRoot, worktreeRoot, claimsPath };
}

const supportEvidence = [{ source: "wave-1/probe.md", verdict: "support" }];
const contradictEvidence = [{ source: "wave-2/counter.md", verdict: "contradict" }];

// ═══════════════════════════════════════════════════════════════════════════
// AC11 — input & capability rejection (write-before rejection, byte-0 side effects)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_claims — AC11 input & capability rejection", () => {
	for (const [label, featureDir] of [
		["a non-kebab slug", "Feature_Name"],
		["an uppercased slug", "MyFeature"],
		["a whitespace slug", "not kebab"],
		["a parent-traversal slug", "../escape"],
		["a path-separator slug", "nested/feature"],
		["a NUL-injected slug", "feat\u0000ure"],
	] as const) {
		it(`rejects ${label} before touching the filesystem`, async () => {
			const cwd = tmpGitRepo();
			const writer = recordingWriter();
			const result = await captureClaimsExecute(writer)("tc", { feature_dir: featureDir }, undefined, undefined, { cwd, hasUI: true });
			expect(result.isError, `feature_dir "${featureDir}" must be rejected`).toBe(true);
			expect(writer.calls.length, "an invalid slug is rejected before any filesystem write").toBe(0);
		});
	}

	it("fixes root to the worktree: an unregistered worktree is rejected and the project-root artifact is left untouched", async () => {
		const cwd = tmpGitRepo();
		const feature = "orphan-feat";
		// A decoy claims.json at the PROJECT root — the tool must never read or write it (root is worktreePath).
		const projectArtifact = craftClaimsPath(cwd, feature);
		mkdirSync(dirname(projectArtifact), { recursive: true });
		const projectBytes = JSON.stringify({ claims: [{ claim: "decoy", dropCondition: "n/a", evidence: [] }] });
		writeFileSync(projectArtifact, projectBytes);

		const writer = recordingWriter();
		const result = await captureClaimsExecute(writer)("tc", { feature_dir: feature }, undefined, undefined, { cwd, hasUI: true });
		expect(result.isError, "no registered worktree ⇒ reject").toBe(true);
		expect(writer.calls.length, "an unregistered worktree is rejected before any write").toBe(0);
		expect(readFileSync(projectArtifact, "utf8"), "the project-root artifact must not be read/written (worktree-fixed root)").toBe(projectBytes);
	});

	it("refuses a symlinked claims.json (target-symlink capability guard) and leaves the link target untouched", async () => {
		const feature = "symlinked";
		const projectRoot = tmpGitRepo();
		const worktreeRoot = worktreePath(projectRoot, feature);
		git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
		const claimsPath = craftClaimsPath(worktreeRoot, feature);
		mkdirSync(dirname(claimsPath), { recursive: true });
		// claims.json → a decoy outside the worktree: a follow-through write would escape containment.
		const decoy = join(outsideDir(), "decoy-claims.json");
		const decoyBytes = JSON.stringify({ claims: [{ claim: "c", dropCondition: "d", evidence: supportEvidence }] });
		writeFileSync(decoy, decoyBytes);
		symlinkSync(decoy, claimsPath);

		const writer = recordingWriter();
		const result = await captureClaimsExecute(writer)("tc", { feature_dir: feature }, undefined, undefined, { cwd: projectRoot, hasUI: true });
		expect(result.isError, "a symlinked claims.json (target symlink) must be rejected").toBe(true);
		expect(writer.calls.length, "a symlink target is rejected before any write").toBe(0);
		expect(readFileSync(decoy, "utf8"), "the symlink target outside the worktree must not be written through").toBe(decoyBytes);
	});

	it("refuses a claims.json whose PARENT dir is a symlink escaping the worktree (parent realpath containment) and leaves the decoy untouched", async () => {
		const feature = "parent-symlinked";
		const projectRoot = tmpGitRepo();
		const worktreeRoot = worktreePath(projectRoot, feature);
		git(projectRoot, ["worktree", "add", "-q", "-b", `lets-craft/${feature}`, worktreeRoot, "HEAD"]);
		const claimsPath = craftClaimsPath(worktreeRoot, feature);
		const claimsDir = dirname(claimsPath);
		// A decoy claims dir OUTSIDE the worktree, holding the real bytes a follow-through write would clobber.
		const decoyDir = outsideDir();
		const decoyClaims = join(decoyDir, basename(claimsPath));
		const decoyBytes = JSON.stringify({ claims: [{ claim: "c", dropCondition: "d", evidence: supportEvidence }] });
		writeFileSync(decoyClaims, decoyBytes);
		// Point the claims PARENT dir at the decoy so realpath(claimsPath) escapes worktree containment.
		mkdirSync(dirname(claimsDir), { recursive: true });
		symlinkSync(decoyDir, claimsDir);

		const writer = recordingWriter();
		const result = await captureClaimsExecute(writer)("tc", { feature_dir: feature }, undefined, undefined, { cwd: projectRoot, hasUI: true });
		expect(result.isError, "a parent-symlinked claims dir must be rejected (realpath containment)").toBe(true);
		expect(writer.calls.length, "a parent-symlink escape is rejected before any write").toBe(0);
		expect(readFileSync(decoyClaims, "utf8"), "the decoy outside the worktree must not be written through the parent symlink").toBe(decoyBytes);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// AC11 — evaluation write-back (atomic, decision-owning, tombstone-preserving)
// ═══════════════════════════════════════════════════════════════════════════
describe("lsc_claims — AC11 evaluation write-back", () => {
	it("writes each claim's decision {status,reasons,evaluatedAt} through the injected atomic-write port exactly once", async () => {
		const fx = setupClaimsWorktree("write-back", [
			{ claim: "supported claim", dropCondition: "a direct refutation surfaces", evidence: supportEvidence },
			{ claim: "refuted claim", dropCondition: "any support survives", evidence: contradictEvidence },
			{ claim: "unevidenced claim", dropCondition: "evidence arrives", evidence: [] },
		]);
		const writer = recordingWriter();
		const before = Date.now();

		const result = await captureClaimsExecute(writer)("tc", { feature_dir: "write-back" }, undefined, undefined, { cwd: fx.projectRoot, hasUI: true });
		expect(result.isError, textOf(result)).toBeFalsy();

		// Exactly-once atomic write — the INJECTED port is the oracle (replaces the false readdir-sibling
		// oracle, which a direct-write / multi-overwrite / temp-then-delete impl would all have passed — M5).
		expect(writer.calls.length, "the tool must persist via a single atomic write").toBe(1);
		expect(writer.calls[0]?.path, "the single write must target craftClaimsPath under the worktree root").toBe(fx.claimsPath);

		// Payload is asserted from the captured write, then cross-checked against what actually landed on disk.
		const payload = ClaimsFileSchema.parse(JSON.parse(writer.calls[0]?.data ?? ""));
		expect(ClaimsFileSchema.parse(JSON.parse(readFileSync(fx.claimsPath, "utf8"))), "on-disk bytes equal the single captured write").toEqual(payload);

		// All THREE ladder outcomes are tool-stamped — not just the rejected one (M5 write-back status coverage).
		const statusOf = (name: string) => payload.claims.find(claim => claim.claim === name)?.decision?.status;
		expect(statusOf("supported claim"), "surviving support ⇒ accepted").toBe("accepted");
		expect(statusOf("unevidenced claim"), "no evidence ⇒ uncertain").toBe("uncertain");
		expect(statusOf("refuted claim"), "contradiction, no surviving support ⇒ rejected").toBe("rejected");

		for (const claim of payload.claims) {
			expect(Array.isArray(claim.decision?.reasons), `${claim.claim} carries reasons[]`).toBe(true);
			const stamped = Date.parse(claim.decision?.evaluatedAt ?? "");
			expect(Number.isNaN(stamped), "evaluatedAt is a parseable ISO timestamp").toBe(false);
			// Stamped fresh at execution time (>= before the call) — Date.parse alone would pass a copied stale value.
			expect(stamped, "evaluatedAt must be tool-stamped at run time, not copied from input").toBeGreaterThanOrEqual(before);
		}
	});

	it("changes zero bytes when any one claim is invalid (missing dropCondition ⇒ the atomic-write port is never reached)", async () => {
		const fx = setupClaimsWorktree("one-invalid", [
			{ claim: "valid claim", dropCondition: "a refutation surfaces", evidence: supportEvidence },
			{ claim: "malformed claim", evidence: supportEvidence }, // dropCondition omitted → invalid
		]);
		const before = readFileSync(fx.claimsPath, "utf8");
		const writer = recordingWriter();

		const result = await captureClaimsExecute(writer)("tc", { feature_dir: "one-invalid" }, undefined, undefined, { cwd: fx.projectRoot, hasUI: true });
		expect(result.isError, "one invalid claim must fail the whole call").toBe(true);
		expect(writer.calls.length, "a rejected call must never reach the atomic-write port (all-or-nothing)").toBe(0);
		expect(readFileSync(fx.claimsPath, "utf8"), "a rejected call must change zero bytes").toBe(before);
	});

	it("preserves a tombstone and re-stamps it: a previously-rejected claim is not revived by new support, and evaluatedAt is refreshed", async () => {
		const fx = setupClaimsWorktree("tombstone", [
			{
				claim: "resurrected claim",
				dropCondition: "a refutation surfaces",
				// New support that WOULD read as accepted from scratch...
				evidence: supportEvidence,
				// ...but the current decision is already a rejection tombstone with a stale 2020 timestamp.
				decision: { status: "rejected", reasons: ["contradicted in a prior wave"], evaluatedAt: "2020-01-01T00:00:00.000Z" },
			},
		]);
		const writer = recordingWriter();
		const before = Date.now();

		const result = await captureClaimsExecute(writer)("tc", { feature_dir: "tombstone" }, undefined, undefined, { cwd: fx.projectRoot, hasUI: true });
		expect(result.isError, textOf(result)).toBeFalsy();

		expect(writer.calls.length, "a successful evaluation persists via one atomic write").toBe(1);
		const decision = ClaimsFileSchema.parse(JSON.parse(writer.calls[0]?.data ?? "")).claims[0]?.decision;
		expect(decision?.status, "a rejected/invalid tombstone must never be revived (monotonic transition)").toBe("rejected");
		// The tool OWNS decision.evaluatedAt: it re-stamps on write rather than copying the 2020 input forward.
		expect(Date.parse(decision?.evaluatedAt ?? ""), "evaluatedAt must be re-stamped fresh, not the stale 2020 input").toBeGreaterThanOrEqual(before);
	});

	it("keeps the root fixed to the worktree: a same-named project-root claims.json is untouched on the success path", async () => {
		const feature = "root-fixed";
		const fx = setupClaimsWorktree(feature, [
			{ claim: "supported claim", dropCondition: "a refutation surfaces", evidence: supportEvidence },
		]);
		// A decoy claims.json at the PROJECT root (cwd) — root is worktreePath, so even a SUCCESSFUL call
		// must leave this byte-identical (registered-worktree analog of the unregistered-worktree decoy guard).
		const projectArtifact = craftClaimsPath(fx.projectRoot, feature);
		mkdirSync(dirname(projectArtifact), { recursive: true });
		const projectBytes = JSON.stringify({ claims: [{ claim: "decoy", dropCondition: "n/a", evidence: [] }] });
		writeFileSync(projectArtifact, projectBytes);
		const writer = recordingWriter();

		const result = await captureClaimsExecute(writer)("tc", { feature_dir: feature }, undefined, undefined, { cwd: fx.projectRoot, hasUI: true });
		expect(result.isError, textOf(result)).toBeFalsy();
		// The single write targets the WORKTREE claims.json, never the project-root decoy.
		expect(writer.calls.length).toBe(1);
		expect(writer.calls[0]?.path, "the write is fixed to the worktree craftClaimsPath").toBe(fx.claimsPath);
		expect(readFileSync(projectArtifact, "utf8"), "the project-root decoy must stay byte-identical (root fixed to worktreePath)").toBe(projectBytes);
	});

	it("defaults to an atomic rename writer when no deps are injected (a hard-link alias keeps the original bytes; the rename swaps the inode)", async () => {
		const fx = setupClaimsWorktree("default-atomic", [
			{ claim: "supported claim", dropCondition: "a refutation surfaces", evidence: supportEvidence },
		]);
		// A hard link to the ORIGINAL inode. writeFileAtomicSync writes a temp file then renames it over
		// craftClaimsPath, so the target's directory entry ends up pointing at a NEW inode while this alias
		// still names the original inode. A non-atomic in-place writeFileSync would instead mutate the
		// shared inode, changing the alias's bytes too — so the alias is the discriminator (M5 default wiring).
		const alias = join(dirname(fx.claimsPath), "claims-before.link");
		linkSync(fx.claimsPath, alias);
		const originalBytes = readFileSync(fx.claimsPath, "utf8");

		// No deps injected → the tool's DEFAULT writer (writeFileAtomicSync) must run for real.
		const result = await captureClaimsExecute()("tc", { feature_dir: "default-atomic" }, undefined, undefined, { cwd: fx.projectRoot, hasUI: true });
		expect(result.isError, textOf(result)).toBeFalsy();

		expect(readFileSync(alias, "utf8"), "the hard-link alias keeps the pre-write bytes ⇒ the default writer renamed a fresh inode over the target (atomic)").toBe(originalBytes);
		const afterBytes = readFileSync(fx.claimsPath, "utf8");
		expect(afterBytes, "the target claims.json received the freshly-stamped decisions").not.toBe(originalBytes);
		expect(ClaimsFileSchema.parse(JSON.parse(afterBytes)).claims[0]?.decision?.status, "the default-writer success path still stamps decisions").toBe("accepted");
	});
});
