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
	},
});
