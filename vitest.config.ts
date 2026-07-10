import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Only the plugin's own tests. The vendored reference trees (oh-my-pi, etc.)
		// carry large Bun-only suites that must never be scanned by this project.
		include: ["test/**/*.test.ts"],
		exclude: ["node_modules/**", "dist/**", "oh-my-pi/**", "oh-my-claudecode/**", "lazycodex/**", "pi/**"],
	},
});
