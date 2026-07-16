// Durable writes for the craft loop's restart-durable state (`.craft-state.json`,
// `.hash-manifest.json`): both are read back by a later process (state.ts's
// loadActiveCraft, hash-manifest.ts's loadManifest) that must never observe a
// half-written file from a crash or concurrent read mid-write. A plain
// `writeFileSync` truncates the destination before the new bytes land, so a crash
// between truncate and write leaves an empty/partial file in place. Writing to a
// same-directory tmp file first and `renameSync`-ing it into place avoids that: POSIX
// rename within a single filesystem is atomic, so a reader only ever sees the old or
// the new content, never a partial one.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Atomically write `data` to `filePath`: write to a `{basename}.{pid}.{timestamp}.tmp`
 * file in the same directory, then `renameSync` it over `filePath`. On failure at
 * either step, the tmp file is removed and the error is rethrown. Callers are
 * responsible for ensuring `dirname(filePath)` already exists (same contract as
 * `writeFileSync` — this throws the same way when it doesn't).
 */
export function writeFileAtomicSync(filePath: string, data: string): void {
	const dir = dirname(filePath);
	const tmpPath = join(dir, `${basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(tmpPath, data);
		renameSync(tmpPath, filePath);
	} finally {
		rmSync(tmpPath, { force: true });
	}
}
