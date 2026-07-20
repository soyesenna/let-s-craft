import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Only the plugin's own tests. The vendored reference trees (oh-my-pi, etc.)
		// carry large Bun-only suites that must never be scanned by this project, and
		// fixtures/sample-ts-cli is a self-contained node:test project with its own
		// intentionally-failing test (Phase 3.5) that must not be picked up as a
		// vitest failure here — its `include` glob already excludes it (it only
		// matches top-level test/**), `exclude` repeats that defensively so a future
		// `include` change can't silently start scanning it.
		include: ["test/**/*.test.ts"],
		exclude: ["node_modules/**", "dist/**", "oh-my-pi/**", "oh-my-claudecode/**", "lazycodex/**", "pi/**", "fixtures/**"],
		// deferred-pool: craft-land-flow drives real `git` fixtures (init + worktree add + merge +
		// remove + prune per case). Standalone each case runs in ~1s, but under a full parallel
		// `npm test` the workers contend for CPU and the FIRST case of a worker (cold git, process
		// spawn storm) can exceed vitest's 5s default — a load-induced flake, not a hang signal.
		// 20s keeps a genuinely hung test failing fast enough while absorbing scheduler contention.
		testTimeout: 20_000,
		// Cap the worker fan-out: with one worker per core, the git-fixture suites spawn hundreds of
		// concurrent child processes and starve the vitest MAIN thread, which surfaces as spurious
		// "[vitest-worker]: Timeout calling onTaskUpdate" unhandled errors (a non-zero exit with every
		// test green). Six workers keeps wall time flat while leaving the main thread schedulable.
		maxWorkers: 6,
	},
});
