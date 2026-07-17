#!/usr/bin/env bash
# run_test.sh — release-gate (pre-craft, C18)
#
# Single delegating entry point. lsc_run_tests execs this with cwd = the feature's
# source root (the worktree .lsc/worktrees/release-gate/, since this feature uses
# --worktree). It:
#   1. validates the source root + bootstraps node_modules if missing (npm ci),
#   2. syncs the CANONICAL, hash-protected test assets (assets/test/*.ts) into the
#      source root's test/ dir — the repo's conventional vitest location. The canonical
#      files live under the C20 hash manifest and cannot drift; the sync is self-healing
#      against accidental edits of the synced copies. This OVERWRITES the repo's
#      craft-state / craft-release / enforcement-rules tests with their release-gate
#      revisions and ADDS destructive-approval + craft-release-flow. (e2e-helpers.ts is
#      NOT an asset — it already lives in the repo test/ dir, so the synced
#      enforcement-rules.test.ts's `./e2e-helpers` import resolves post-sync.)
#   3. runs `npm run build` (tsc) as a hard TYPE GATE. tsconfig scopes tsc to src/ only
#      (rootDir:src, include:["src/**/*.ts"]) — it never typechecks test/ — so this
#      typechecks the plan's compile-time seams in the NEW source once craft writes them:
#      src/craft/destructive-approval.ts (tag SSOT + in-memory approval slot), the
#      state.ts evidence ledger + readers, the release.ts consume gate, and the
#      hash-manifest.ts / run-tests.ts / ask.ts wiring.
#      PRE-CRAFT NOTE: none of that source exists/changed yet, so `npm run build` PASSES
#      on the current (unchanged) src/ while the vitest suites below FAIL — the feature
#      test files reference not-yet-existing exports (they resolve to undefined and throw
#      "is not a function") and not-yet-implemented behaviors (assertion failures). That
#      RED state is the correct, expected test-first outcome. A clean pass of the feature
#      suites here BEFORE craft would be the red flag (it would mean the feature was
#      already implemented).
#   4. runs the feature-scoped unit + integration + regression suite (vitest, repo
#      convention — an explicit file list, not the config-wide include): the four non-e2e
#      release-gate files. Fast, attributable signal for exactly this feature's tests.
#   5. runs the FULL suite via `npm test` (= `vitest run`) as the AC7 no-regression gate —
#      ALL test/**/*.test.ts (the 33 existing files + the synced release-gate additions).
#      Deliberately NOT scoped down: AC7 requires every existing unit test to stay green.
#      The e2e files (enforcement-rules / e2e-full-cycle / e2e-preset-default /
#      statusbar-e2e) self-skip without LSC_E2E (describe.skipIf(!RUN_E2E)), so this stays
#      a fast, no-real-LLM run. It is FORCED to run with LSC_E2E unset so this regression
#      gate can never balloon into the real-token e2e files even under `LSC_E2E=1`.
#   6. runs the LSC_E2E-gated scenario-5 e2e (enforcement-rules.test.ts) ONLY when
#      LSC_E2E=1 (needs a built dist + a real omp session and spends real tokens; the
#      craft loop must not pay that per iteration — the e2e file itself also self-skips
#      unless LSC_E2E=1). e2e-full-cycle / e2e-preset-default never call lsc_craft_release
#      (grep-confirmed) and are NOT this feature's concern — they run at final land via
#      `npm run e2e`, not here.
#   7. prints a combined per-suite summary and exits with the real combined status.
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
echo "=== type gate: npm run build (tsc — enforces the plan's compile-time seams in src/) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above; vitest run continues for signal"
fi

echo
echo "=== feature suite (release-gate unit + integration + regression, feature-scoped vitest) ==="
npx vitest run \
	test/destructive-approval.test.ts \
	test/craft-release.test.ts \
	test/craft-release-flow.test.ts \
	test/craft-state.test.ts
feature_status=$?

echo
echo "=== AC7 no-regression gate: full npm test (all test/**/*.test.ts; e2e files self-skip) ==="
# Forced LSC_E2E-unset: the AC7 regression gate is always the fast unit layer (AC "실 LLM
# 불요") and must never trigger the real-token e2e files, even if the caller exported LSC_E2E=1.
LSC_E2E= npm test
regression_status=$?

e2e_status=0
e2e_ran=0
if [ "${LSC_E2E:-}" = "1" ]; then
	echo
	echo "=== scenario-5 e2e (LSC_E2E=1; needs a built dist + a real omp session) ==="
	e2e_ran=1
	npx vitest run test/enforcement-rules.test.ts --testTimeout=10200000 --hookTimeout=120000
	e2e_status=$?
fi

echo
echo "=== SUMMARY: release-gate ==="
if [ "$build_status" -eq 0 ]; then echo "build (tsc type gate, src/)     : PASS"; else echo "build (tsc type gate, src/)     : FAIL (exit $build_status)"; fi
if [ "$feature_status" -eq 0 ]; then echo "feature suite (4 files)         : PASS"; else echo "feature suite (4 files)         : FAIL (exit $feature_status)"; fi
if [ "$regression_status" -eq 0 ]; then echo "AC7 full regression (npm test)  : PASS"; else echo "AC7 full regression (npm test)  : FAIL (exit $regression_status)"; fi
if [ "$e2e_ran" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then echo "scenario-5 e2e (LSC_E2E)        : PASS"; else echo "scenario-5 e2e (LSC_E2E)        : FAIL (exit $e2e_status)"; fi
else
	echo "scenario-5 e2e (LSC_E2E)        : SKIPPED (set LSC_E2E=1 to run; needs built dist + real omp)"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$feature_status" -ne 0 ] && status=1
[ "$regression_status" -ne 0 ] && status=1
[ "$e2e_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all run suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (see per-suite status above) ==="
fi
exit "$status"
