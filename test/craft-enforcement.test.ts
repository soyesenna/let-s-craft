import { describe, expect, it } from "vitest";
import { evaluateToolCallForActiveCraft, shouldContinueCraftLoop } from "../src/craft/enforcement";

const CRAFT = { projectRoot: "/repo", feature: "my-feature" };
const TEST_DIR = "/repo/.lsc/crafts/my-feature/test";

describe("evaluateToolCallForActiveCraft", () => {
	it("does not block anything when there is no active craft", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "write", input: { path: `${TEST_DIR}/run_test.sh` }, cwd: "/repo" },
			undefined,
		);
		expect(result).toBeUndefined();
	});

	it("does not block a write outside the protected test tree", () => {
		const result = evaluateToolCallForActiveCraft({ toolName: "write", input: { path: "/repo/src/app.ts" }, cwd: "/repo" }, CRAFT);
		expect(result).toBeUndefined();
	});

	it("blocks a write with an absolute path inside the protected test tree", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "write", input: { path: `${TEST_DIR}/run_test.sh` }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain(TEST_DIR);
	});

	it("blocks a write with a cwd-relative path inside the protected test tree", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "write", input: { path: ".lsc/crafts/my-feature/test/unit/a.test.ts" }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("blocks the test dir itself, not just files under it", () => {
		const result = evaluateToolCallForActiveCraft({ toolName: "write", input: { path: TEST_DIR }, cwd: "/repo" }, CRAFT);
		expect(result?.block).toBe(true);
	});

	it("does not block a write to a sibling path with the test dir as a string prefix (not a path-boundary match)", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "write", input: { path: `${TEST_DIR}-other/file.ts` }, cwd: "/repo" },
			CRAFT,
		);
		expect(result).toBeUndefined();
	});

	it("blocks an edit targeting one of multiple hashline paths", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "edit", input: { paths: ["/repo/src/app.ts", `${TEST_DIR}/unit/a.test.ts`] }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("does not block an edit whose paths are all outside the test tree", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "edit", input: { paths: ["/repo/src/app.ts", "/repo/src/lib.ts"] }, cwd: "/repo" },
			CRAFT,
		);
		expect(result).toBeUndefined();
	});

	it("blocks ast_edit when a glob path targets the test tree (fail-closed substring match)", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "ast_edit", input: { paths: [`${TEST_DIR}/**/*.ts`] }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("blocks a bash command that references the protected path (absolute, substring match)", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "bash", input: { command: `rm -f ${TEST_DIR}/run_test.sh` }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("blocks a bash command that references the protected path (cwd-relative, substring match)", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "bash", input: { command: "rm -f .lsc/crafts/my-feature/test/run_test.sh" }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("blocks a bash call whose own cwd option resolves inside the test tree", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "bash", input: { command: "rm run_test.sh", cwd: TEST_DIR }, cwd: "/repo" },
			CRAFT,
		);
		expect(result?.block).toBe(true);
	});

	it("does not block an unrelated bash command", () => {
		const result = evaluateToolCallForActiveCraft({ toolName: "bash", input: { command: "npm test" }, cwd: "/repo" }, CRAFT);
		expect(result).toBeUndefined();
	});

	it("does not gate tools outside the protected set (read, grep, glob, custom tools)", () => {
		const result = evaluateToolCallForActiveCraft(
			{ toolName: "read", input: { path: `${TEST_DIR}/run_test.sh` }, cwd: "/repo" },
			CRAFT,
		);
		expect(result).toBeUndefined();
	});

	// The `edit` tool's default mode ("hashline") has a `{ input: string }`-only schema — no
	// top-level `path`/`paths` field. Confirmed against a real E2E run: a hashline `edit` call
	// against a protected test file went straight through the block undetected before this
	// extraction was added. These cases lock the fix (src/craft/enforcement.ts's
	// extractEditPayloadPaths, scanning `input.input` for `[path#TAG]` header lines /
	// `*** Update File: path` apply_patch markers).
	describe("edit tool — hashline/apply_patch payload path extraction (input.input, no top-level path field)", () => {
		it("blocks a hashline edit call whose header targets the protected test tree", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: `[${TEST_DIR}/run_test.sh#1A2B]\nreplace 5.=7:\n+new content` }, cwd: "/repo" },
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("blocks a hashline edit call whose header has no hash tag (bare [path])", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: `[${TEST_DIR}/run_test.sh]\nreplace 5.=7:\n+new content` }, cwd: "/repo" },
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("blocks a hashline edit call using a cwd-relative header path", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: "[.lsc/crafts/my-feature/test/unit.test.ts#C223]\nreplace 1.=1:\n+x" }, cwd: "/repo" },
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("does not block a hashline edit call targeting a file outside the protected tree", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: "[/repo/src/app.ts#1A2B]\nreplace 5.=7:\n+new content" }, cwd: "/repo" },
				CRAFT,
			);
			expect(result).toBeUndefined();
		});

		it("blocks a multi-file hashline edit when only one of several headers targets the protected tree", () => {
			const result = evaluateToolCallForActiveCraft(
				{
					toolName: "edit",
					input: {
						input: `[/repo/src/app.ts#1A2B]\nreplace 1.=1:\n+x\n\n[${TEST_DIR}/run_test.sh#C223]\nreplace 1.=1:\n+y`,
					},
					cwd: "/repo",
				},
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("blocks an apply_patch-mode edit call (*** Update File: marker) targeting the protected tree", () => {
			const result = evaluateToolCallForActiveCraft(
				{
					toolName: "edit",
					input: { input: `*** Begin Patch\n*** Update File: ${TEST_DIR}/run_test.sh\n@@\n-old\n+new\n*** End Patch` },
					cwd: "/repo",
				},
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("blocks an apply_patch-mode *** Move to: marker targeting the protected tree", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: `*** Update File: /repo/src/app.ts\n*** Move to: ${TEST_DIR}/run_test.sh\n` }, cwd: "/repo" },
				CRAFT,
			);
			expect(result?.block).toBe(true);
		});

		it("does not false-positive on ordinary payload text that merely contains bracketed prose", () => {
			const result = evaluateToolCallForActiveCraft(
				{ toolName: "edit", input: { input: "[/repo/src/app.ts#1A2B]\nreplace 1.=1:\n+see [the docs] for details" }, cwd: "/repo" },
				CRAFT,
			);
			expect(result).toBeUndefined();
		});
	});
});

describe("shouldContinueCraftLoop", () => {
	it("does not continue when there is no active craft", () => {
		expect(shouldContinueCraftLoop(undefined)).toBe(false);
	});

	it("continues when a craft is active and tests have not passed", () => {
		expect(shouldContinueCraftLoop({ testsPassed: false, aborted: false })).toBe(true);
	});

	it("does not continue once tests have passed", () => {
		expect(shouldContinueCraftLoop({ testsPassed: true, aborted: false })).toBe(false);
	});

	it("does not continue once the craft has been marked aborted, even with failing tests", () => {
		expect(shouldContinueCraftLoop({ testsPassed: false, aborted: true })).toBe(false);
	});
});
