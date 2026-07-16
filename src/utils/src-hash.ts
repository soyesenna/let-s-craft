// Runtime-side src/ fingerprint (QW6). Duplicates scripts/gen-version.mjs's hash
// algorithm rather than importing it: that script runs before `tsc` produces
// anything under dist/, so there is no compiled module for it to share with the
// runtime side. test/src-hash.test.ts asserts both implementations agree on the
// same input, so the duplication itself can't silently drift apart.
//
// Consumed by main.ts's session_start handler to warn when a loaded dist/ is
// stale relative to the current src/ tree (dist↔src drift banner).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface SrcFileEntry {
	relPath: string;
	content: string;
}

// `src/generated/` is gen-version.mjs's own output — excluded from the hash it
// itself feeds into, so the fingerprint never becomes self-referential.
const EXCLUDED_TOP_LEVEL_DIRS = new Set(["generated"]);

/** Recursively list every `.ts` file under `srcDir`, excluding `src/generated/`. */
function walkSrcTsFiles(srcDir: string): string[] {
	const out: string[] = [];
	const stack: string[] = [srcDir];
	while (stack.length > 0) {
		const dir = stack.pop();
		if (!dir || !existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory() && dir === srcDir && EXCLUDED_TOP_LEVEL_DIRS.has(entry.name)) continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) stack.push(full);
			else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
		}
	}
	return out;
}

function toPosixRelative(root: string, file: string): string {
	return relative(root, file).split(sep).join("/");
}

/** Read every `.ts` source file under `srcDir` into path+content entries (order not guaranteed). */
export function readSrcEntries(srcDir: string): SrcFileEntry[] {
	return walkSrcTsFiles(srcDir).map(file => ({ relPath: toPosixRelative(srcDir, file), content: readFileSync(file, "utf8") }));
}

/**
 * Deterministic short hash (first 12 hex chars of a SHA-256) over a set of source file
 * entries — sorted by relPath first, so filesystem enumeration order never affects the
 * result. Byte-for-byte mirrored in scripts/gen-version.mjs's `computeSrcHash` (a plain
 * Node script that runs before `tsc` exists, so it cannot import this compiled module).
 */
export function computeSrcHash(entries: readonly SrcFileEntry[]): string {
	const sorted = [...entries].sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
	const hash = createHash("sha256");
	for (const entry of sorted) {
		hash.update(entry.relPath);
		hash.update("\0");
		hash.update(entry.content);
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 12);
}

/** Hash all current `.ts` sources under `srcDir`. Caller gates existence (non-dev installs ship no src/). */
export function hashSrcDir(srcDir: string): string {
	return computeSrcHash(readSrcEntries(srcDir));
}

/**
 * The PLUGIN's own `src/` directory, anchored to this module's compiled location
 * (`dist/utils/src-hash.js` → `../../src`), never the session cwd. Anchoring to
 * `ctx.cwd` was a real bug: any *user project* that happened to have a `src/`
 * directory got hashed against the plugin's BUILD_INFO and produced a bogus
 * "dist is stale" warning on every session start (and, in fixture E2E runs,
 * polluted every driven session's context with that banner).
 */
export function resolvePluginSrcDir(moduleUrl: string = import.meta.url): string {
	const moduleDir = dirname(fileURLToPath(moduleUrl));
	return join(moduleDir, "..", "..", "src");
}

/** Null when the runtime src hash matches the build-time one; else the stale-dist warning text. */
export function driftWarning(buildSrcHash: string, currentSrcHash: string): string | null {
	if (buildSrcHash === currentSrcHash) return null;
	return "lets-craft: dist is stale (src has changed since last build) — run 'npm run build'";
}
