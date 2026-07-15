#!/usr/bin/env bash
# run_test.sh — provider-usage-status-bar (pre-craft, C18)
#
# Single delegating entry point. lsc_run_tests execs this with cwd = the feature's
# source root (the worktree .lsc/worktrees/provider-usage-status-bar/, since this
# feature uses --worktree). It:
#   1. validates the source root + bootstraps node_modules if missing (npm ci),
#   2. syncs the CANONICAL, hash-protected test assets (assets/test/*.ts) into the
#      source root's test/ dir — the repo's conventional vitest location. The canonical
#      files live under the C20 hash manifest and cannot drift; the sync is self-healing
#      against accidental edits of the synced copies.
#   3. runs `npm run build` (tsc) as a hard TYPE GATE — vitest/esbuild NEVER typecheck,
#      so this is what enforces the plan's compile-time seams (the structural
#      AuthStoragePort Assert, the pure/`import type`-only boundary, the main.ts wiring)
#      once craft implements src/statusbar/*.
#      PRE-CRAFT NOTE: src/statusbar/ does not exist yet and main.ts is unchanged, so
#      `npm run build` passes on the current src/ while the vitest suite fails on the
#      missing module — that RED state is the correct, expected test-first outcome. A
#      clean pass here before craft would be the red flag (it would mean the feature was
#      already implemented).
#   4. runs the feature-scoped unit + integration + regression suite (vitest, repo
#      convention — an explicit file list, not the config-wide include),
#   5. runs the LSC_E2E-gated e2e ONLY when LSC_E2E=1 (needs a built dist + a real omp
#      (Bun) session and spends real tokens; the craft loop must not pay that per
#      iteration — the e2e file itself also self-skips unless LSC_E2E=1),
#   6. prints a combined per-suite summary and exits with the real combined status.
#
# No -e: we want the full suite to run and a summary to print even on failure, then
# propagate the real exit code ourselves (fixture reference shape).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_ROOT="$(pwd)"

if [ ! -f "$SRC_ROOT/package.json" ] || [ ! -f "$SRC_ROOT/src/main.ts" ]; then
	echo "ERROR: run from the feature source root (expected package.json + src/main.ts in \$PWD=$SRC_ROOT)" >&2
	exit 2
fi

if [ ! -d "$SRC_ROOT/node_modules" ]; then
	echo "=== bootstrap: npm ci (worktree has no node_modules) ==="
	npm ci || { echo "ERROR: npm ci failed" >&2; exit 2; }
fi

echo "=== sync: canonical test assets -> $SRC_ROOT/test/ ==="
cp "$SCRIPT_DIR"/assets/test/*.ts "$SRC_ROOT/test/" || { echo "ERROR: asset sync failed" >&2; exit 2; }

echo
echo "=== type gate: npm run build (tsc — enforces the plan's compile-time seams) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above; vitest run continues for signal"
fi

echo
echo "=== unit + integration + regression suite (feature-scoped vitest) ==="
npx vitest run \
	test/statusbar-view-model.test.ts \
	test/statusbar-render.test.ts \
	test/statusbar-controller.test.ts \
	test/statusbar-gather.test.ts \
	test/statusbar-pipeline.test.ts \
	test/statusbar-regression.test.ts
unit_status=$?

echo
echo "=== adapter probe (Bun fake-host test of the REAL registerUsageStatusBar adapter) ==="
# The impure src/statusbar/index.ts value-imports Bun-only omp SDK runtimes (@oh-my-pi/pi-ai/usage,
# @oh-my-pi/pi-tui), so its SUT-level test is a Bun SCRIPT — not a Node/vitest file (deliberately kept
# out of the vitest include above). It is deterministic (hand-built fake ExtensionAPI/host; no real
# omp / model / network / advancing time), so it runs every craft iteration. It resolves the built
# dist/statusbar/index.js from the source root ($PWD); PRE-CRAFT it is RED (exit 3) until that artifact
# is built — the correct test-first state, alongside the vitest suite's missing-module RED.
probe_status=0
probe_ran=0
if command -v bun >/dev/null 2>&1; then
	probe_ran=1
	bun "$SCRIPT_DIR/assets/test/adapter-probe.mts"
	probe_status=$?
else
	echo "adapter probe : SKIPPED (bun not on PATH; the Bun-only omp SDK value imports cannot load under Node)"
fi

e2e_status=0
e2e_ran=0
if [ "${LSC_E2E:-}" = "1" ]; then
	echo
	echo "=== e2e suite (LSC_E2E=1; needs a built dist + a real omp session) ==="
	e2e_ran=1
	npx vitest run test/statusbar-e2e.test.ts
	e2e_status=$?
fi

echo
echo "=== SUMMARY: provider-usage-status-bar ==="
if [ "$build_status" -eq 0 ]; then echo "build                          : PASS"; else echo "build                          : FAIL (exit $build_status)"; fi
if [ "$unit_status" -eq 0 ]; then echo "unit+integration+regression    : PASS"; else echo "unit+integration+regression    : FAIL (exit $unit_status)"; fi
if [ "$probe_ran" -eq 1 ]; then
	if [ "$probe_status" -eq 0 ]; then echo "adapter probe (bun · index.ts) : PASS"; else echo "adapter probe (bun · index.ts) : FAIL (exit $probe_status)"; fi
else
	echo "adapter probe (bun · index.ts) : SKIPPED (bun not found)"
fi
# Split the e2e verdict: the e2e file has ONE automated Gate 0 test + FIVE it.skip Gate 1 manual
# probes. A green vitest e2e run means Gate 0 passed and Gate 1 was skipped (manual) — reporting a
# bare "e2e: PASS" would wrongly imply the blocking interactive Gate 1 was exercised.
if [ "$e2e_ran" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then echo "e2e Gate 0 (automated)         : PASS"; else echo "e2e Gate 0 (automated)         : FAIL (exit $e2e_status)"; fi
	echo "e2e Gate 1 (interactive/manual): SKIPPED (it.skip manual probes — run omp interactively; see statusbar-e2e.test.ts)"
else
	echo "e2e Gate 0 (automated)         : SKIPPED (set LSC_E2E=1 to run; needs built dist + real omp)"
	echo "e2e Gate 1 (interactive/manual): SKIPPED (manual/interactive; never automated in the craft loop)"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$unit_status" -ne 0 ] && status=1
[ "$probe_ran" -eq 1 ] && [ "$probe_status" -ne 0 ] && status=1
[ "$e2e_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all run suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (see per-suite status above) ==="
fi
exit "$status"
