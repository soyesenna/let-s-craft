import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// U10-4: contract-conformance assertions for the ralplan-pre-craft-latency-round2
// text changes (U2/U3/U4/U6). These are `.toContain` checks over the actual
// skills/*.md and agents/*.md prose — not a re-implementation of the earlier
// craft-verdict/src-hash suites (those verify TS parsing logic; this file
// verifies the contract *text* itself exists and cross-references correctly).
// Covers AC2 (lightweight recheck agent + reference points), AC3 (timeout
// unification / respawn template / duplicate-read extension), AC5 (progress
// visibility), AC7 (no-progress 15-minute procedure + §1.8 trigger expansion),
// AC12 (plan core/appendix split reference points).
// ---------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relPath: string): string {
	return readFileSync(join(repoRoot, relPath), "utf8");
}

const preCraft = read("skills/pre-craft/SKILL.md");
const craft = read("skills/craft/SKILL.md");
const postCraft = read("skills/post-craft/SKILL.md");
const lscPlanner = read("agents/lsc-planner.md");
const lscArchitect = read("agents/lsc-architect.md");
const lscCritic = read("agents/lsc-critic.md");
const lscCriticRecheck = read("agents/lsc-critic-recheck.md");
const readme = read("README.md");

describe("U3 — lightweight lsc-critic-recheck agent", () => {
	it("agents/lsc-critic-recheck.md exists", () => {
		expect(existsSync(join(repoRoot, "agents/lsc-critic-recheck.md"))).toBe(true);
	});

	it("frontmatter declares name: lsc-critic-recheck and thinkingLevel: medium", () => {
		const content = read("agents/lsc-critic-recheck.md");
		expect(content).toContain("name: lsc-critic-recheck");
		expect(content).toContain("thinkingLevel: medium");
	});

	it("defines the RECHECK: PASS/FAIL output contract, not the VERDICT vocabulary", () => {
		const content = read("agents/lsc-critic-recheck.md");
		expect(content).toContain("RECHECK: [PASS / FAIL]");
		expect(content).not.toContain("VERDICT: [REJECT");
	});

	it("scopes to the three mechanical checks only, excluding the full investigation protocol", () => {
		const content = read("agents/lsc-critic-recheck.md");
		expect(content).toContain("Item-by-item diff↔fix reconciliation");
		expect(content).toContain("file:line re-verification");
		expect(content).toContain("Related-AC cross-check");
		expect(content).toContain("no pre-commitment predictions, no multi-perspective review");
	});

	it("pre-craft SKILL's Stage 3 AWC diff-only re-check spawns lsc-critic-recheck, not lsc-critic", () => {
		expect(preCraft).toContain("Spawn exactly one `lsc-critic-recheck`");
		expect(preCraft).toContain("agents/lsc-critic-recheck.md");
	});

	it("the unresponsive-spawn non-approval rule covers lsc-critic-recheck's RECHECK: line, not just VERDICT:", () => {
		expect(preCraft).toContain("`lsc-critic-recheck` spawn ends in death, error, timeout, or a `**RECHECK:**` line that fails to parse");
	});

	it("corrects the invalid per-spawn thinkingLevel instruction — effort is fixed by the agent definition, not the task call", () => {
		expect(preCraft).toContain("The `task` spawn schema has no per-spawn `thinkingLevel`/model parameter at all");
		expect(preCraft).toContain("runs at a lower effort — fixed by that lightweight agent's own frontmatter");
	});
});

describe("U2 — waiting/retry/early-detection contract, common to pre-craft/craft/post-craft", () => {
	const skills = { "pre-craft": preCraft, craft, "post-craft": postCraft };

	for (const [name, content] of Object.entries(skills)) {
		it(`${name}/SKILL.md expands the backoff trigger to 5xx/overloaded, not literal 429 alone`, () => {
			expect(content).toContain("429/5xx/overloaded backoff");
			expect(content).toContain("overloaded_error");
			expect(content).toContain('do not gate this rule on the literal string "429"');
		});

		it(`${name}/SKILL.md documents the no-progress 15-minute early-detection procedure`, () => {
			expect(content).toContain("No-progress early detection");
			expect(content).toContain("15 minutes");
			expect(content).toContain("이미 수행한 조사를 이어서 지금 답장으로 렌더하라");
			expect(content).toContain("이전 시도가 provider 장애로 유실되어 재시도한다");
		});

		it(`${name}/SKILL.md unifies wait timeoutMs to the 3,000,000ms (50-minute) class`, () => {
			expect(content).toContain("3,000,000ms");
			expect(content).toContain("50-minute");
		});

		it(`${name}/SKILL.md's no-duplicate-read discipline is extended to an agent's own turn`, () => {
			expect(content.toLowerCase()).toContain("own turn");
		});
	}
});

describe("U4 — plan core/appendix split (C9 revision)", () => {
	it("pre-craft SKILL defines the core section list, including the ADR summary as a required core element", () => {
		expect(preCraft).toContain("Plan document shape — core vs. appendix");
		expect(preCraft).toContain("**Core sections**");
		expect(preCraft).toContain("ADR summary");
		expect(preCraft).toContain("Task Flow");
		expect(preCraft).toContain("AC Coverage Matrix");
	});

	it("pre-craft SKILL defines the appendix contract as a structural move, not compression", () => {
		expect(preCraft).toContain("plan/appendix-{topic}.md");
		expect(preCraft).toContain("This is a structural move, not compression");
	});

	it("pre-craft SKILL's review-assignment rule is iteration-1-full vs iteration-2-plus-diff", () => {
		expect(preCraft).toContain("Iteration 1's architect/critic review assignments must include the full core");
		expect(preCraft).toContain("From iteration 2 onward, review assignments are core-plus-diff");
	});

	it("the ADR requirement (item 9) is synced to the core/appendix split", () => {
		expect(preCraft).toContain("must include an ADR **summary** in its core");
	});

	it("agents/lsc-planner.md's output spec is synced to the core/appendix split", () => {
		expect(lscPlanner).toContain("plan/appendix-{topic}.md");
		expect(lscPlanner).toContain("core sections only");
		expect(lscPlanner).toContain("≤~30KB");
	});

	it("craft/SKILL.md and post-craft/SKILL.md carry the appendix location pointer alongside the existing plan-N.md guidance", () => {
		for (const content of [craft, postCraft]) {
			expect(content).toContain("plan/plan-{N}.md");
			expect(content).toContain("plan/appendix-{topic}.md");
		}
	});
});

// ---------------------------------------------------------------------------
// C5 — pre-craft's Stage 4 (test authoring + D-3 mutation-proof probe) is
// removed: implementation-before-tests is the goal this refactor exists to
// undo (spec Goal, trace H3), and Stage 4 previously consumed a measured
// 32-36% of pre-craft's own wall-clock. pre-craft now runs exactly three
// sub-stages (trace → interview → plan) and its consensus loop ("The loop")
// runs once, over plan.md, never a second time over a test/ tree.
// ---------------------------------------------------------------------------
describe("pre-craft — 3단계 계약", () => {
	it("declares the 3-stage trace → interview → plan pipeline, not a 4-stage one", () => {
		expect(preCraft).toContain("trace → interview → plan");
		expect(preCraft).toContain("three sub-stages");
	});

	it("The loop runs once in pre-craft, over plan.md — never a second time over test/", () => {
		expect(preCraft).toContain("This loop runs once in pre-craft");
	});

	it("carries none of the removed Stage 4 / test-authoring / D-3 vocabulary", () => {
		for (const literal of ["Stage 4", "D-3", "appendix-test-plan", "expanded test plan", "lsc-test-engineer"]) {
			expect(preCraft, `preCraft must no longer contain "${literal}"`).not.toContain(literal);
		}
	});
});

// ---------------------------------------------------------------------------
// U11 — architect/critic conditional-parallel review lanes.
//
// A prose lint, deliberately: `_docs/reference-insights.md` records the
// "architect→critic 순서 백스톱" as explicitly rejected for runtime code
// (`src/craft/enforcement.ts:9-20` — caps/counters are the platform's, duplicate
// tracking risks desync), so the contract lives in the skill/agent text and the
// text is what we assert. Two arrays: the new contract MUST appear, and the
// superseded sequential contract MUST NOT survive anywhere.
//
// The must-not list is scoped to literals unique to the OLD contract. Note the
// deliberate omission of "after architect completes": the sequential fallback is
// by definition a pass that runs after architect completes, so banning that
// phrase would collide with the new contract's own most natural wording.
// ---------------------------------------------------------------------------

describe("U11 — conditional-parallel review lanes", () => {
	const PARALLEL_CONTRACT_LITERALS = [
		"plan-only lane",
		"sequential fallback",
		"review join gate",
		"two review lanes",
		"sha256",
	] as const;

	const SUPERSEDED_SEQUENTIAL_LITERALS = [
		"never in parallel",
		"must complete before critic starts",
		"must include architect's review in full as input context",
	] as const;

	describe("pre-craft SKILL.md carries the new contract and none of the old", () => {
		for (const literal of PARALLEL_CONTRACT_LITERALS) {
			it(`states "${literal}"`, () => {
				expect(preCraft).toContain(literal);
			});
		}

		for (const literal of SUPERSEDED_SEQUENTIAL_LITERALS) {
			it(`no longer states "${literal}"`, () => {
				expect(preCraft).not.toContain(literal);
			});
		}
	});

	describe("agents/lsc-planner.md is synced — it restated the sequential mandate verbatim and no other test covers it", () => {
		for (const literal of PARALLEL_CONTRACT_LITERALS.filter((l) => l !== "sha256")) {
			it(`states "${literal}"`, () => {
				expect(lscPlanner).toContain(literal);
			});
		}

		for (const literal of SUPERSEDED_SEQUENTIAL_LITERALS) {
			it(`no longer states "${literal}"`, () => {
				expect(lscPlanner).not.toContain(literal);
			});
		}

		it("no longer reports verdicts lsc-critic cannot emit (APPROVE / ITERATE)", () => {
			expect(lscPlanner).not.toContain("ITERATE");
			// Negative lookahead: APPROVE-WITH-CHANGE *is* one of critic's five, so
			// "returns APPROVE-WITH-CHANGE" must stay legal. Only bare APPROVE is wrong.
			expect(lscPlanner).not.toMatch(/returns APPROVE(?!-WITH-CHANGE)/);
		});
	});

	it("README.md's Stage 3 overview describes the parallel model in the canonical Korean terms", () => {
		for (const literal of ["plan-only 레인", "순차 fallback", "리뷰 join gate"]) {
			expect(readme).toContain(literal);
		}
		expect(readme).not.toContain("순서의 합의 루프");
		expect(readme).not.toContain("리뷰 전문을 입력으로");
	});

	it("the sequential fallback does not consume an iteration", () => {
		expect(preCraft).toContain("does **not** consume a new one against the cap");
	});

	// The fallback is the one architect-facing check with measured yield, so the
	// wiring around it gets its own assertions: gating it on the verdict token
	// instead of the Change Spec's presence would let `NOT-BLOCKING` + Change Spec
	// (an explicit AWC-path entry condition) hand an unaudited Change Spec to the
	// author, and that is precisely what the fallback exists to prevent.
	it("the fallback triggers on the Change Spec's presence, not on the verdict token", () => {
		expect(preCraft).toContain("The trigger is the Change Spec's presence, not the token");
		expect(preCraft).toContain("Wherever a Change Spec is present, it gets audited");
	});

	it("the fallback's own verdict is not the iteration's — the plan-only lane's is", () => {
		expect(preCraft).toContain("Its `**VERDICT:**` line is NOT this iteration's critic verdict");
		expect(preCraft).toContain("the **`plan-only` lane's** critic rendered REVISE or REJECT");
	});

	it("the AWC path consumes the audit before the author applies anything", () => {
		expect(preCraft).toContain("the author never receives an unaudited Change Spec");
		expect(preCraft).toContain("the item is dropped from the fix set");
	});

	it("lsc-critic-recheck checks the post-audit fix set, so an applied amendment is not scope creep", () => {
		expect(preCraft).toContain("as they stand after item 5.0's audit");
		expect(lscCriticRecheck).toContain("Applying an amended item in its amended form is not scope creep");
	});

	it("each lane echoes the digest it actually computed, so the join gate compares three values", () => {
		expect(preCraft).toContain("a three-way comparison, not a two-way one");
		for (const content of [lscArchitect, lscCritic]) {
			expect(content).toContain("Reviewed: {absolute path} @ sha256");
			expect(content).toContain("Compute that digest rather than copying the assignment's");
		}
	});

	it("the join gate refuses to finalize from a single lane", () => {
		expect(preCraft).toContain("Never finalize, pass, or escalate from a single lane");
	});

	it("the critic veto stays unconditional in the plan-only lane", () => {
		expect(preCraft).toContain("This holds identically for a `plan-only` critic lane");
	});

	// The load-bearing assertion of this whole block. Everything else here survives
	// a hand re-serialization ("compute the anchor, spawn architect, then spawn
	// critic against the same sha256") — the must-not literals only catch a verbatim
	// revert of the old contract, and the echo/join-gate rules read perfectly well
	// under a sequential order. Pin the mechanism, not just its vocabulary.
	it("the two lanes are spawned in ONE batch — the mechanism, not just the vocabulary", () => {
		expect(preCraft).toContain("spawn **both reviewers in a single `task` batch call**");
		expect(lscPlanner).toContain("launch together as two review lanes in a single spawn batch");
	});

	it("both review agents carry the Parallel_Lane_Protocol block with their own N/A literal", () => {
		for (const content of [lscArchitect, lscCritic]) {
			expect(content).toContain("<Parallel_Lane_Protocol>");
		}
		// Exact literals per agent — a bare `toContain("N/A — ")` would pass on any
		// stray "N/A — anything" left elsewhere in the file.
		expect(lscArchitect).toContain("N/A — parallel lane");
		expect(lscCritic).toContain("N/A — plan-only lane");
	});

	it("the anchor's computation is pinned, not just its verification", () => {
		expect(preCraft).toContain("shasum -a 256");
		expect(preCraft).toContain("both lanes must be re-spawned against the new anchor");
	});

	it("lsc-architect emits a literal three-value verdict token so a degraded review can fail to parse", () => {
		expect(lscArchitect).toContain("**ARCHITECT VERDICT: [NOT-BLOCKING / AWC-EQUIVALENT / BLOCKING-REDESIGN]**");
		expect(preCraft).toContain("`**ARCHITECT VERDICT:**` line that fails to parse");
	});

	it("lsc-architect's Change Spec requires propagation targets, not just the edit site", () => {
		expect(lscArchitect).toContain("Propagation targets");
	});

	it("lsc-critic's architect cross-check row is conditional but never absent", () => {
		expect(lscCritic).toContain("N/A — plan-only lane");
		expect(lscCritic).toContain("Emit this row in both lane modes");
	});

	it("lsc-critic's Change Spec audit — the one architect-facing check with measured yield — is anchored in the prompt", () => {
		expect(lscCritic).toContain("Change Spec audit");
	});

	it("the two lanes have non-overlapping mandates so parallel reviews stay complementary", () => {
		expect(lscArchitect).toContain("you own the DECISION");
		expect(lscCritic).toContain("you own the ARTIFACT");
	});
});

describe("U6 — progress visibility contract", () => {
	it("pre-craft SKILL's Stage 3/4 loop mandates a visible progress line at every stage/iteration boundary", () => {
		expect(preCraft).toContain("Progress visibility");
		expect(preCraft).toContain(
			"both review lanes spawned, architect lane complete, critic lane complete, the review join gate passed, a sequential-fallback pass issued, a revision started, an AWC edit applied, `lsc-critic-recheck` passed",
		);
	});

	it("cites the measured evidence for the requirement (13-hour run, 2 lines of progress, 114-minute stall)", () => {
		expect(preCraft).toContain("13-hour run surfaced only 2 lines of visible progress text");
		expect(preCraft).toContain("114 minutes");
	});
});
