import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureWorktreesGitignored } from "../src/artifacts/gitignore";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpProject(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-gitignore-"));
	tempDirs.push(dir);
	return dir;
}

describe("ensureWorktreesGitignored", () => {
	it("creates .gitignore with the worktrees entry when none exists", () => {
		const cwd = tmpProject();
		const result = ensureWorktreesGitignored(cwd);
		expect(result.added).toBe(true);
		expect(readFileSync(result.path, "utf8")).toContain(".lsc/worktrees/");
	});

	it("appends to an existing .gitignore that lacks the entry", () => {
		const cwd = tmpProject();
		writeFileSync(join(cwd, ".gitignore"), "node_modules/\n");
		const result = ensureWorktreesGitignored(cwd);
		expect(result.added).toBe(true);
		const content = readFileSync(result.path, "utf8");
		expect(content).toContain("node_modules/");
		expect(content).toContain(".lsc/worktrees/");
	});

	it("is idempotent — a second call does not duplicate the entry", () => {
		const cwd = tmpProject();
		ensureWorktreesGitignored(cwd);
		const second = ensureWorktreesGitignored(cwd);
		expect(second.added).toBe(false);
		const content = readFileSync(join(cwd, ".gitignore"), "utf8");
		const occurrences = content.split("\n").filter(line => line.trim() === ".lsc/worktrees/").length;
		expect(occurrences).toBe(1);
	});

	it("recognizes an equivalent entry already present (leading slash, no trailing slash)", () => {
		const cwd = tmpProject();
		writeFileSync(join(cwd, ".gitignore"), "/.lsc/worktrees\n");
		const result = ensureWorktreesGitignored(cwd);
		expect(result.added).toBe(false);
	});

	it("appends without a leading blank line when the file already ends with a newline", () => {
		const cwd = tmpProject();
		writeFileSync(join(cwd, ".gitignore"), "dist/\n");
		ensureWorktreesGitignored(cwd);
		const content = readFileSync(join(cwd, ".gitignore"), "utf8");
		expect(content).toBe("dist/\n.lsc/worktrees/\n");
	});
});
