// Shared raw git runner (postcraft-14cycle-approval-failure PR-3).
//
// One runner for every git spawn in src/ — worktree.ts's and land.ts's former private
// runners are migrated onto it, and the new base-drift observation / added-path gate use it
// too. Contract:
//
//   • SUCCESS → `{ stdout, stderr }` UNTOUCHED — never trimmed: NUL-separated payloads
//     (`--name-only -z`) and whitespace-carrying paths must survive verbatim, and the
//     trim decision belongs to each caller, not the runner.
//   • FAILURE (non-zero exit / spawn error) → throws `GitCommandError` whose message
//     carries the command and the first stderr line, with `stderr`/`exitCode` attached for
//     callers that need the full diagnostic.
//   • `maxBuffer` defaults far above node's 1MB: a `-z` diff of a large tree can exceed it,
//     and a mid-pipeline ENOBUFS would look like a git failure.
//
// argv-only by construction: every caller passes already-split argv, so a ref like
// `--flag-looking` can never be re-parsed as an option by a shell (there is none).
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** A successful git invocation's raw output — untrimmed, NUL bytes preserved. */
export interface GitResult {
	stdout: string;
	stderr: string;
}

/** A failed git invocation — message names the command and the first stderr line. */
export class GitCommandError extends Error {
	readonly stderr: string;
	readonly exitCode: number | undefined;

	constructor(args: readonly string[], stderr: string, exitCode?: number) {
		const firstStderrLine = stderr.split("\n").find(line => line.trim() !== "") ?? "";
		super(`git ${args.join(" ")} failed${exitCode !== undefined ? ` (exit ${exitCode})` : ""}:${firstStderrLine ? ` ${firstStderrLine.trim()}` : ""}`);
		this.name = "GitCommandError";
		this.stderr = stderr;
		this.exitCode = exitCode;
	}
}

function stderrOf(error: unknown): string {
	if (error && typeof error === "object" && "stderr" in error) {
		const stderr = (error as { stderr?: unknown }).stderr;
		if (typeof stderr === "string" && stderr.length > 0) return stderr;
		if (Buffer.isBuffer(stderr) && stderr.length > 0) return stderr.toString("utf8");
	}
	return error instanceof Error ? error.message : String(error);
}

/** Run `git <args...>` in `cwd`, resolving raw untrimmed `{stdout, stderr}`. Throws GitCommandError on any failure. */
export async function runGit(cwd: string, args: readonly string[], options: { maxBuffer?: number } = {}): Promise<GitResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", [...args], {
			cwd,
			encoding: "utf8",
			maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
		});
		return { stdout, stderr };
	} catch (error) {
		const exitCode = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : undefined;
		throw new GitCommandError(args, stderrOf(error), exitCode);
	}
}

/** Run `git <args...>` and return the TRIMMED stdout (the common convenience for single-value queries like rev-parse). Throws GitCommandError on any failure. */
export async function runGitText(cwd: string, args: readonly string[], options: { maxBuffer?: number } = {}): Promise<string> {
	const { stdout } = await runGit(cwd, args, options);
	return stdout.trim();
}

/** Split a `-z` (NUL-separated) git payload into paths — no path is ever trimmed or dropped, and a trailing NUL produces no empty entry. */
export function splitNul(payload: string): string[] {
	if (payload.length === 0) return [];
	return payload.split("\u0000").filter(path => path !== "");
}
