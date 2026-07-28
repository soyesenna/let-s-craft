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

	it("pre-craft SKILL's Stage 4 (test/ loop) inherits the same lsc-critic-recheck AWC path", () => {
		expect(preCraft).toContain("same AWC path with its single `lsc-critic-recheck` diff-only re-check");
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
