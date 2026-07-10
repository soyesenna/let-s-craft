#!/usr/bin/env bun
// Phase 1.5 spike script — precise timing reproduction of the "clobber race"
// around omp's debounced `#saveNow` (settings.ts:1328-1360).
//
// Runs entirely against scratch directories (os.tmpdir()) via `Settings.loadIsolated`
// / `Settings.isolated` — never touches the real `~/.omp/agent/config.yml`. Safe to
// run repeatedly: `cd lets-craft && bun run scripts/spike-clover-race.ts`.
//
// Requires Bun (omp's SDK ships Bun-native modules `@oh-my-pi/pi-natives`) — this is
// why the equivalent assertions cannot live in the vitest suite (see
// test/preset-injection-spike.test.ts header).
//
// What this proves, step by step:
//   1. A session that already loaded settings (in-memory `#global` snapshot) does
//      NOT see a concurrent raw file write to config.yml — no watcher, no live push.
//   2. If that same session later calls `.set()` on an UNRELATED path (e.g. any
//      settings.set() the platform performs — a `/model` switch, a `/lsc-preset`
//      write elsewhere, anything), the debounced `#saveNow` re-reads config.yml from
//      disk before writing, so it picks up the earlier raw write and pulls it into
//      the in-memory `#global` too ("PULL-IN").
//   3. The final file on disk carries BOTH the raw-written key and the newly-`.set()`
//      key — no data loss. This refutes the plan's original R5 "#saveNow overwrites
//      #global wholesale" model: `#saveNow` is read-modify-write, not blind overwrite.
//
// Caveat this script does NOT cover (see scripts/spike-e2e-verify.sh instead): this
// is a single-process, single-Settings-instance reproduction. Real multi-process
// contention (two separate `omp` processes racing on the SAME real ~/.omp/agent/config.yml,
// each with its own `#saveNow` debounce) was independently observed during this spike
// as a genuine, real config.yml corruption source — see spike.ts finding 6.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent";

const agentDir = mkdtempSync(join(tmpdir(), "lsc-clover-race-"));
let failed = false;

function report(label: string, pass: boolean, detail: string) {
	console.log(`${pass ? "PASS" : "FAIL"} — ${label}: ${detail}`);
	if (!pass) failed = true;
}

async function main() {
	console.log(`Isolated agentDir: ${agentDir}\n`);

	// STEP 1: a session loads settings (T0 snapshot).
	const settings = await Settings.loadIsolated({ agentDir });
	const t0 = settings.get("task.agentModelOverrides");
	report("T0 snapshot is empty", Object.keys(t0).length === 0, JSON.stringify(t0));

	// STEP 2: raw external write to config.yml WHILE the session is already alive
	// (simulates the extension's own fs write, or a second omp process).
	const configPath = join(agentDir, "config.yml");
	const before = await Bun.file(configPath).text().catch(() => "");
	await Bun.write(configPath, `${before}\ntask:\n  agentModelOverrides:\n    lsc-executor: zai/glm-4.5-flash:low\n`);

	// STEP 3: same session, immediate re-read — must still be stale (no watcher).
	const stale = settings.get("task.agentModelOverrides");
	report("raw write is NOT live without a trigger (STALE)", Object.keys(stale).length === 0, JSON.stringify(stale));

	// STEP 4: an unrelated `.set()` in the same session queues `#saveNow`.
	settings.set("task.disabledAgents", ["dummy-unrelated-agent"]);
	await settings.flush(); // forces #saveNow synchronously instead of waiting out the 100ms debounce

	// STEP 5: PULL-IN — the re-read-before-write inside #saveNow absorbed the raw write.
	const pulledIn = settings.get("task.agentModelOverrides");
	report(
		"unrelated set() + flush() pulls the raw write into memory (PULL-IN)",
		Object.keys(pulledIn).length > 0 && pulledIn["lsc-executor"] === "zai/glm-4.5-flash:low",
		JSON.stringify(pulledIn),
	);

	// STEP 6: disk carries BOTH values — no clobber.
	const finalDisk = await Bun.file(configPath).text();
	const keptRawWrite = finalDisk.includes("lsc-executor");
	const keptUnrelatedSet = finalDisk.includes("dummy-unrelated-agent");
	report("disk retains the raw-written key after #saveNow (no clobber)", keptRawWrite, finalDisk.trim());
	report("disk also retains the newly set() key", keptUnrelatedSet, finalDisk.trim());

	rmSync(agentDir, { recursive: true, force: true });
	console.log(`\nCleaned up ${agentDir}`);
	if (failed) {
		console.error("\nOne or more assertions failed.");
		process.exit(1);
	}
	console.log("\nAll clover-race assertions passed.");
}

main().catch(err => {
	rmSync(agentDir, { recursive: true, force: true });
	console.error("Script failed:", err);
	process.exit(1);
});
