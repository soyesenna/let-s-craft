// PR-3 shared git runner (src/utils/git.ts) — AC-4/AC-9.
// The land overlap suite already proves newline/space paths through the merge gate; these
// tests pin the runner's own observable contract: untrimmed stdout, NUL bytes kept, and
// GitCommandError on failure. A trim/split regression here would silently drop paths
// before the overlap comparator ever saw them.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitCommandError, runGit, runGitText, splitNul } from "../src/utils/git";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpGit(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-git-runner-"));
	tempDirs.push(dir);
	execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-q", "-m", "init"], { cwd: dir });
	return dir;
}

describe("splitNul (NUL-separated git -z payloads)", () => {
	it("returns an empty array for an empty payload", () => {
		expect(splitNul("")).toEqual([]);
	});

	it("drops a trailing NUL so it does not produce an empty path entry", () => {
		expect(splitNul("a.txt\u0000b.txt\u0000")).toEqual(["a.txt", "b.txt"]);
	});

	it("preserves spaces and newlines inside a path — never line-splits or trims", () => {
		expect(splitNul("fi le\nname.txt\u0000")).toEqual(["fi le\nname.txt"]);
	});
});

describe("runGit / runGitText", () => {
	it("returns untrimmed stdout so a trailing newline from git is kept", async () => {
		const dir = tmpGit();
		const { stdout } = await runGit(dir, ["rev-parse", "HEAD"]);
		expect(stdout.endsWith("\n")).toBe(true);
		expect(stdout.trim().length).toBeGreaterThan(0);
	});

	it("runGitText returns the trimmed stdout of a single-value query", async () => {
		const dir = tmpGit();
		const { stdout } = await runGit(dir, ["rev-parse", "HEAD"]);
		const text = await runGitText(dir, ["rev-parse", "HEAD"]);
		expect(text).toBe(stdout.trim());
		expect(text.endsWith("\n")).toBe(false);
	});

	it("preserves NUL bytes in stdout from git -z so splitNul can recover each path", async () => {
		const dir = tmpGit();
		writeFileSync(join(dir, "tracked.txt"), "x\n");
		execFileSync("git", ["add", "--", "tracked.txt"], { cwd: dir });
		const { stdout } = await runGit(dir, ["ls-files", "-z"]);
		expect(stdout.includes("\u0000")).toBe(true);
		expect(splitNul(stdout)).toEqual(["tracked.txt"]);
	});

	it("throws GitCommandError on a nonzero git exit, naming the command and attaching stderr", async () => {
		const dir = tmpGit();
		await expect(runGit(dir, ["rev-parse", "--verify", "refs/heads/no-such-ref"])).rejects.toSatisfy((err: unknown) => {
			expect(err).toBeInstanceOf(GitCommandError);
			const failure = err as GitCommandError;
			expect(failure.message).toContain("rev-parse");
			expect(failure.message).toContain("failed");
			expect(failure.stderr.length).toBeGreaterThan(0);
			return true;
		});
	});
});
