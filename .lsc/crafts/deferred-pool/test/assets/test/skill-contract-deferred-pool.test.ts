import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// deferred-pool: contract-conformance assertions for the skill-prose changes
// this feature lands (spec R5: prose items — B co-evolution, F SKILL section, G
// D-3 exception — are verified as skill-contract *string* checks, not fixture
// E2E). Companion to the existing test/skill-contract.test.ts; a separate file so
// parallel pre-craft testers never collide on one file. Every asserted phrase is
// quoted from a confirmed decision, never invented:
//   - spec.md  AC6 / AC11, components A / B / F / G, Constraints 2/3/6/11/12
//   - plan.md  Step 3b (post-craft land co-evolution), Step 4 (scaffold
//              co-evolution), Step 5a (F research contract, claims-tool.ts),
//              Step 5b (G §0 exception + Stage 4 D-3 probe)
//   - plan/appendix-test-plan.md §계층 3 (skill-contract) — the verbatim spec
//              Stage 4 test authors execute.
//
// SECTION-SCOPED, NOT GLOBAL-TOKEN SMOKE (critic C5 CRITICAL + architect rec 5).
// Iteration 1 asserted `.toContain` over the *whole* preCraft/postCraft strings,
// so a glossary word-list appended anywhere, or the old hand-run bash left in
// place under different quoting, could pass green (and `postCraft.toContain
// ("lsc_land")` was already a false pass — §7.1's line-210 scope note mentions
// it). The fix: `sectionOf()` slices each document to the single heading-bounded
// section that must carry a clause, and every clause is asserted positive+negative
// against that slice, 1:1 with appendix `:47-53`. A glossary elsewhere cannot
// satisfy a section-scoped positive, and a re-quoted bash block cannot evade a
// section-scoped semantic-token negative.
//
// IMMUTABLE-RED AVOIDANCE (positive framing preferred). Two appendix clauses read
// as `.not.toContain` but the *correct* revised prose contains the very phrase, in
// a negating clause — so a literal `.not.toContain` would be RED forever, un-
// satisfiable by any correct craft revision (fatal once these assets are hash-
// protected):
//   - spec G §0: `"일회성 임시 변이 + 즉시 원자 복구"(구현 작성 허용이 아님)` — the
//     correct §0 CONTAINS "구현 작성 허용". Verified instead by the positive
//     exception phrases + §0's own "never writes implementation code" invariant.
//   - spec G Stage 4: 문구는 `"테스트 스위트 변별력 검증"이 아니라 "변이 seam 한정
//     tautology 스모크"` — the correct probe CONTAINS "변별력 검증". Verified
//     instead by the positive `tautology` / mutation-seam framing.
//   - post-craft §7.4 keeps the base checkout instruction (SKILL.md:228) and the
//     manual escape hatch keeps a manual `git merge` on purpose (spec Constraint
//     3), so `git checkout`/`switch` and a BARE `git merge` are NOT asserted absent;
//     the merge co-evolution is verified positively (lsc_land does the merge). Only
//     the exact commands lsc_land subsumes — `git merge --no-ff` and `git worktree
//     remove|prune` — are asserted absent, scoped to §7.4 alone (not the whole Land
//     section) so the base-checkout + escape hatch never make the canon immutable-RED.
//
// PRE-CRAFT STATE — RED IS EXPECTED. The skills/*.md files are NOT yet revised
// (that is the craft stage's body of work, spec A/B/F/G). Every feature-addition
// assertion below is RED by design; a clean pass BEFORE craft would be the red
// flag (skills already revised). The only green-now block is the final "tagging
// convention unchanged" pair — regression/invariant guards (Constraint 11: this
// feature must NOT touch the tagging convention) that must STAY green.
// ---------------------------------------------------------------------------

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const preCraft = readFileSync(join(repoRoot, "skills/pre-craft/SKILL.md"), "utf8");
const postCraft = readFileSync(join(repoRoot, "skills/post-craft/SKILL.md"), "utf8");

// Slice a markdown document to one heading-bounded section: from the first heading
// line matching `anchor` down to (but excluding) the next heading of the same-or-
// higher level (a level-2 `##` section ends at the next `##`/`#`; a level-3 `###`
// subsection ends at the next `###`/`##`/`#`). Fence-aware so a `#`-prefixed line
// inside a ``` code block is never mistaken for a heading boundary. Returns "" when
// the anchor is absent, so a positive `.toContain` on the slice fails as a clean
// RED rather than throwing. This single helper is the whole C5/rec-5 mechanism:
// scoping every prose assertion to the section that must carry it.
function sectionOf(doc: string, anchor: RegExp): string {
	const lines = doc.split("\n");
	let start = -1;
	let level = 0;
	let fenced = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			continue;
		}
		if (fenced) continue;
		const heading = /^(#{1,6})\s/.exec(line);
		if (!heading) continue;
		if (start === -1) {
			if (anchor.test(line)) {
				start = i;
				level = heading[1].length;
			}
			continue;
		}
		if (heading[1].length <= level) return lines.slice(start, i).join("\n");
	}
	return start === -1 ? "" : lines.slice(start).join("\n");
}

// pre-craft sections (heading numbers are stable pipeline-stage names).
const preRole = sectionOf(preCraft, /^#{2,3}\s.*Role in the pipeline/);
const preStage0 = sectionOf(preCraft, /^#{2,3}\s+\d+\.\s+Stage 0\b/);
const preTrace = sectionOf(preCraft, /^#{2,3}\s+\d+\.\s+Stage 1\b/); // research lives here
const preStage4 = sectionOf(preCraft, /^#{2,3}\s+\d+\.\s+Stage 4\b/);

// post-craft land sections.
const postLand = sectionOf(postCraft, /^##\s+7\.\s+Land\b/); // §7.1–§7.4 + any escape subsection
const postEligibility = sectionOf(postCraft, /^###\s+7\.1\b/);
const postLandApply = sectionOf(postCraft, /^###\s+7\.4\b/);

describe("deferred-pool AC6[B] — pre-craft Stage 0 lsc_scaffold co-evolution (section-scoped)", () => {
	// spec.md B (§Goal + line 46: "bash 재현(SKILL.md:84-96)을 도구 호출로 대체하되
	// branch-prefix 탐지는 산문이 유지하고 결과를 branch 인자로 전달"), AC6, plan.md Step 4,
	// appendix §계층3 line 50 ("Stage 0: :84-96 bash 재현 부재 + lsc_scaffold 지시 존재").
	it("Stage 0 instructs lsc_scaffold and feeds it the detected branch", () => {
		// spec B: branch-prefix detection stays in prose and its result is passed to
		// lsc_scaffold as the branch argument — assert the two are RELATED within one
		// clause (≤240 chars), not asserted independently (critic B4.1).
		expect(preStage0).toMatch(/lsc_scaffold[\s\S]{0,240}branch|branch[\s\S]{0,240}lsc_scaffold/i);
		expect(preStage0).toContain("lets-craft/"); // default branch prefix (spec B)
	});

	it("Stage 0 no longer hand-runs the worktree-add / gitignore-append bash sequence", () => {
		// Semantic command-forms of the removed :84-96 replication, each LINE-scoped ([^\n]) so a re-quoted
		// variant (`git -C "$ROOT" worktree add`, `tee -a "$ROOT/.gitignore"`, `grep -Eq ... .lsc/worktrees`)
		// cannot evade by changing flags/quoting, while the retained branch-prefix grep (which greps for the
		// branch, not `.lsc/worktrees`) is not falsely flagged. None reappears in a correct "lsc_scaffold
		// reuses addWorktree" sentence (that names the TS function `addWorktree`, not `git ... worktree add`).
		expect(preStage0).not.toMatch(/git[^\n]*worktree add/); // addWorktree replication (:86-87), any -C/quoting
		expect(preStage0).not.toMatch(/(?:>>|tee -a)[^\n]*\.gitignore/); // gitignore append (:93-94), redirect or tee
		expect(preStage0).not.toMatch(/grep[^\n]*\.lsc\/worktrees/); // gitignore idempotency grep (:92) — not the branch grep
	});
});

describe("deferred-pool AC11[F] — pre-craft research canon/projection contract (section-scoped)", () => {
	// spec.md F (line 50: "claims.json=정본, SYNTHESIS.md=파생 뷰, 역방향 편집 금지 ·
	// wave별 lsc_claims 호출 · 프레이밍 '비적대·부주의 케이스의 결정론적 하한'"), plan.md Step
	// 5a (line 182), appendix §계층3 line 51.
	it("research section declares claims.json the canon and SYNTHESIS.md its projection, banning reverse edits", () => {
		expect(preTrace).toContain("claims.json");
		expect(preTrace).toContain("SYNTHESIS.md"); // present today; stays as the projection view
		expect(preTrace).toContain("projection");
		expect(preTrace).toMatch(/역방향|reverse/i); // reverse-edit ban
	});

	it("instructs an lsc_claims call at each research wave under a non-adversarial/careless lower-bound framing", () => {
		// spec F: an lsc_claims call is instructed AT EACH wave — assert the wave phrase and lsc_claims
		// sit in ONE clause (≤160 chars), not merely both-somewhere-in-the-section (critic B4.2).
		expect(preTrace).toMatch(/(?:각 wave|wave별|each wave)[\s\S]{0,160}lsc_claims|lsc_claims[\s\S]{0,160}(?:각 wave|wave별|each wave)/i);
		expect(preTrace).toMatch(/비적대.{0,3}부주의|non-adversarial.{0,20}careless/i);
	});
});

describe("deferred-pool AC6[G] — §0 D-3 exception + Stage 4 mutation-proof probe (section-scoped)", () => {
	// spec.md G (line 51), Constraint 12 (line 66), plan.md Step 5b, appendix
	// §계층3 lines 52-53.
	it("§0 carves the one-time-mutation / immediate-atomic-revert exception into the never-writes-implementation invariant", () => {
		// The "(구현 작성 허용이 아님)" contrast is embodied by §0's own invariant, NOT
		// a `.not.toContain("구현 작성 허용")` (which the correct §0 prose contains).
		expect(preRole).toContain("never writes implementation code");
		expect(preRole).toContain("일회성 임시 변이");
		expect(preRole).toContain("즉시 원자 복구");
	});

	it("Stage 4 carries a D-3 probe scoped to a baseline-green differential (brownfield-only, single mutation)", () => {
		expect(preStage4).toContain("D-3");
		expect(preStage4).toContain("baseline-green");
		expect(preStage4).toContain("failure delta");
		expect(preStage4).toMatch(/brownfield|브라운필드/i);
		expect(preStage4).toMatch(/단일 변이|single[ -]?mutation/i);
	});

	it("frames the probe as a mutation-seam tautology smoke, not a full-suite discriminator, avoiding oracle-mirroring subsets", () => {
		// The "테스트 스위트 변별력 검증이 아니라 …" contrast is embodied by the positive
		// tautology framing, NOT a `.not.toContain("변별력 검증")` (which the correct
		// N5-locked 문구 contains verbatim).
		expect(preStage4).toContain("tautology");
		expect(preStage4).toContain("oracle-mirroring");
		expect(preStage4).toMatch(/변이 seam|mutation.{0,4}seam/i);
		// plan.md:186 — the differential is a baseline-green failure delta; a FULL-RUN RED must never be
		// the discriminator (full-run-RED-ban), so no oracle-mirroring subset is passed off as coverage.
		expect(preStage4).toMatch(/(?:full[- ]?run|전체\s*실행|full[- ]?suite)[\s\S]{0,60}RED[\s\S]{0,40}(?:금지|판정하지\s*않|삼지\s*않|아니|not\b)/i);
	});

	it("requires an atomic revert verified by a clean git diff, with greenfield/inseparable recorded as D-3: N/A", () => {
		expect(preStage4).toContain("git diff");
		expect(preStage4).toContain("D-3: N/A");
	});

	it("confines the D-3 mutation to a non-committed, orchestrator-owned probe that stops + hands off on recovery failure (Constraint 12)", () => {
		expect(preStage4).toMatch(/변이|mutation/i);
		expect(preStage4).toMatch(/복구\s*실패|recovery[^.\n]{0,25}fail|revert[^.\n]{0,25}fail/i);
		expect(preStage4).toMatch(/비승인|non-approval|handoff/i);
		expect(preStage4).toMatch(/오케스트레이터|orchestrator/i);
		// plan.md:187 — the D-3 mutation must NEVER be committed (mutation-commit-ban).
		expect(preStage4).toMatch(/(?:변이|mutation)[\s\S]{0,60}(?:커밋 금지|커밋하지\s*않|커밋 않|never\s*commit|not\s*commit|no[- ]?commit)|(?:never\s*commit|커밋 금지|non-?committed)[\s\S]{0,60}(?:변이|mutation)/i);
	});
});

describe("deferred-pool A — post-craft §7 land co-evolution to lsc_land (section-scoped)", () => {
	// spec.md A (line 44: 2-phase R→C/P→X, approval-required + exact approvalQuestion;
	// "§7.1 프로즈 계약('검증된 판정 없으면 merge 금지')의 코드 격상"), Constraints 2/3,
	// plan.md Step 3b (line 123 "post-craft SKILL co-evolution"), appendix §계층3 line 49.
	it("§7.4 lands via the 2-phase lsc_land flow (approval-required re-call), not the hand-run merge/worktree bash", () => {
		// Positive, scoped to §7.4 — lsc_land is currently only in §7.1's scope note
		// (line 210), so a whole-doc `toContain("lsc_land")` is a false pass; §7.4 has
		// no lsc_land today (pure manual bash), so this is a genuine RED.
		expect(postLandApply).toContain("lsc_land");
		expect(postLandApply).toContain("approval-required");
		// Negative, scoped to §7.4 ONLY (postLandApply), NOT the whole Land section: the exact old commands
		// lsc_land now subsumes — `git merge --no-ff` and `git worktree remove|prune` — must be gone from
		// §7.4. `git checkout`/`switch` and a BARE `git merge` are deliberately NOT asserted absent (§7.4
		// keeps the base-checkout instruction SKILL.md:228 and the escape hatch keeps a manual merge, spec
		// Constraint 3) — scoping the absence to §7.4 avoids an immutable-RED (critic CF1).
		expect(postLandApply).not.toMatch(/git[^\n]*merge --no-ff/);
		expect(postLandApply).not.toMatch(/git[^\n]*worktree\s+(remove|prune)/);
	});

	it("documents the tool-defect escape hatch with a durable audit/land-manual-escape.md record", () => {
		// spec.md Constraint 3, plan.md Step 3b line 61: exception reason recorded to
		// `.lsc/crafts/{feature}/audit/land-manual-escape.md`.
		expect(postLand).toContain("land-manual-escape.md");
	});

	it("§7.1 escalates the merge-block to the realized lsc_land fail-closed gate, keeping the validated-verdict precondition", () => {
		// The machine merge-block ("검증된 판정 없으면 merge 금지") already exists via
		// lsc_audit_validate and must stay; the escalation adds lsc_land as its
		// realized fail-closed code gate ("fail-closed" is absent from post-craft
		// today — the load-bearing RED signal).
		expect(postEligibility).toContain("lsc_audit_validate");
		expect(postLand).toMatch(/fail-closed|fail\s*closed/i);
	});
});

describe("deferred-pool invariant — question tagging convention unchanged (Constraint 11)", () => {
	// spec.md Constraint 11 ("질문 태깅 규약·해시 보호·파이프라인 불변식 불변"),
	// plan.md Success Criteria 5. GREEN now; deferred-pool reuses the existing tags
	// (notably post-craft's [Land] ... Merge? gate) without altering the convention,
	// so these guards must STAY green. Kept whole-document on purpose: they assert
	// the convention exists and its category tags are present, an invariant, not a
	// section-placement contract.
	it("pre-craft keeps its load-bearing tagging convention and category tags", () => {
		expect(preCraft).toContain("Question tagging convention");
		expect(preCraft).toContain("[Feature Name]");
		expect(preCraft).toContain("[Consensus Escalation]");
		expect(preCraft).toContain("[Pre-craft Complete]");
	});

	it("post-craft keeps its tagging convention and the reused [Land] ... Merge? gate", () => {
		expect(postCraft).toContain("Question tagging convention");
		expect(postCraft).toContain("[Precondition]");
		expect(postCraft).toContain("[Audit]");
		expect(postCraft).toContain("[Land]");
		expect(postCraft).toContain("Merge?");
	});
});
