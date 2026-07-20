#!/usr/bin/env bash
# run_test.sh — deferred-pool (pre-craft, C18)
#
# Single delegating entry point for the deferred-pool feature test suite. lsc_run_tests
# (src/craft/run-tests.ts) execs this via a trusted exec — never the LLM's own bash tool —
# with cwd = the feature's SOURCE ROOT. deferred-pool uses --worktree, so that root is the
# worktree .lsc/worktrees/deferred-pool/ (package.json + src/main.ts live there). It:
#   1. sanity-guards the source root, then bootstraps node_modules if missing (npm ci),
#   2. SYNCS the canonical, hash-protected test assets (assets/test/*.ts) into the source
#      root's test/ dir — the repo's conventional vitest location — so every run is
#      self-healing against accidental edits of the synced copies. The canonical files
#      live under the C20 hash manifest once the craft loop starts and cannot drift.
#      RESILIENT: during the pre-craft authoring window four testers author these files in
#      parallel, so the sync copies WHATEVER *.ts is present and never dies on an absent
#      one (fixtures reference the repo's existing test/e2e-helpers.ts, which is NOT an
#      asset — it already lives in test/ — so synced fixtures resolve post-sync).
#   3. runs `npm run build` (gen-version + tsc) as a hard TYPE GATE. tsconfig scopes tsc to
#      src/ only (rootDir:src, include:["src/**/*.ts"]) — it NEVER typechecks test/ — so it
#      typechecks the plan's compile-time seams in the NEW source once craft writes them
#      (src/craft/land.ts, destructive-approval operationScope, state.ts stateVersion +
#      craftStateCandidates, verdict.ts read-only core, src/doctor.ts, src/artifacts/
#      scaffold.ts, src/research/ledger.ts, paths.ts craftClaimsPath, main.ts registrars).
#   4. runs the FEATURE-SCOPED vitest suite — the four testers' 11 files (unit +
#      integration + skill-contract). RESILIENT: only the files that actually exist
#      post-sync are handed to vitest; a not-yet-authored file is reported missing, never
#      fatal (the hardcoded list never kills the run on a gap).
#   5. runs the FULL suite via `npm test` (= `vitest run`) as the AC12 no-regression gate —
#      ALL test/**/*.test.ts (the existing suite + the synced deferred-pool additions).
#      Forced with LSC_E2E unset so the four e2e files (e2e-full-cycle / enforcement-rules /
#      e2e-preset-default / statusbar-e2e — each `describe.skipIf(!RUN_E2E)`) self-skip and
#      never spend real tokens, even if the caller exported LSC_E2E=1. There is NO
#      LSC_E2E-gated e2e branch here: e2e is a non-goal for this feature (appendix test
#      plan) — `npm run e2e`, not this harness, owns those files at final land.
#   6. prints a combined per-suite summary and exits with the real combined status.
#
# PRE-CRAFT NOTE (release-gate precedent): none of the feature source exists/changed yet,
# so `npm run build` PASSES on the current (unchanged) src/ (tsc never sees test/) while
# the feature vitest files FAIL — they reference not-yet-existing exports (import-shaped
# RED: module resolution / "is not a function") and not-yet-implemented behaviors
# (assertion failures). The full regression is therefore ALSO RED pre-craft because it
# includes the synced-but-unimplemented feature files; the EXISTING suite must stay green.
# That RED state is the correct, expected test-first outcome — a clean pass of the feature
# suites BEFORE craft would be the red flag (it would mean the feature was already built).
# (Transient authoring-window exception: with zero assets synced yet, the feature suite is
# reported SKIPPED and the regression is the existing green suite — the harness stays
# exercisable; steady pre-craft state is assets-present + feature/regression RED.)
#
# Feature file -> AC / tester map (the 11 canonical assets):
#   land-removal-target.test.ts        AC4        (removal verify matrix — pure)
#   craft-state-version.test.ts        AC9        (stateVersion, 2 readers)
#   craft-state-candidates.test.ts     AC10       (craftStateCandidates seam, named policy)
#   research-ledger.test.ts            AC11       (evaluateLedger pure matrix + tombstone)
#   doctor-evaluate.test.ts            AC8        (doctor per-check evaluate + hang/timeout)
#   craft-land-flow.test.ts            AC1/2/3    (lsc_land issue/consume/fail, fixture repo)
#   artifacts-scaffold.test.ts         AC5        (lsc_scaffold determinism, fixture repo)
#   claims-tool.test.ts                AC11       (lsc_claims registrar capture + write gate)
#   doctor-adapters.test.ts            AC7        (doctor table/exit + adapter capture)
#   skill-contract-deferred-pool.test.ts AC6/11p  (pre/post-craft SKILL.md prose strings)
#   deferred-pool-regression.test.ts  AC10/12    (cross-seam regression guards, decode-independent)
#
# No -e: we want the full suite to run and a summary to print even on failure, then
# propagate the real exit code ourselves (fixtures/sample-ts-cli/run_test.sh reference shape).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_ROOT="$(pwd)"

# 1. Source-root sanity guard ------------------------------------------------------------
if [ ! -f "$SRC_ROOT/package.json" ] || [ ! -f "$SRC_ROOT/src/main.ts" ]; then
	echo "ERROR: run from the feature source root (expected package.json + src/main.ts in \$PWD=$SRC_ROOT)" >&2
	echo "       lsc_run_tests should exec this in the worktree .lsc/worktrees/deferred-pool/." >&2
	exit 2
fi

# 2. Bootstrap node_modules if the worktree has none -------------------------------------
if [ ! -d "$SRC_ROOT/node_modules" ]; then
	echo "=== bootstrap: npm ci (worktree has no node_modules) ==="
	npm ci --no-audit --no-fund || { echo "ERROR: npm ci failed" >&2; exit 2; }
fi

# 3. Sync canonical, hash-protected test assets into the repo test/ dir (resilient) ------
ASSET_DIR="$SCRIPT_DIR/assets/test"
echo "=== sync: canonical test assets -> $SRC_ROOT/test/ ==="
synced=0
if [ -d "$ASSET_DIR" ]; then
	shopt -s nullglob
	for asset in "$ASSET_DIR"/*.ts; do
		cp "$asset" "$SRC_ROOT/test/" || { echo "ERROR: asset sync failed for $asset" >&2; exit 2; }
		echo "  synced $(basename "$asset")"
		synced=$((synced + 1))
	done
	shopt -u nullglob
fi
if [ "$synced" -eq 0 ]; then
	echo "  NOTE: no *.ts assets in $ASSET_DIR yet (parallel pre-craft testers still authoring);"
	echo "        build + full regression still run so the harness stays exercisable."
else
	echo "  synced $synced asset file(s) total"
fi

# 4. Type gate — npm run build (gen-version + tsc, src/ only) ----------------------------
echo
echo "=== type gate: npm run build (gen-version + tsc — typechecks src/ only) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above; vitest still runs for signal"
fi

# 5. Feature-scoped vitest — the 4 testers' 11 files (resilient to not-yet-authored) -----
FEATURE_FILES=(
	land-removal-target
	craft-state-version
	craft-state-candidates
	research-ledger
	doctor-evaluate
	craft-land-flow
	artifacts-scaffold
	claims-tool
	doctor-adapters
	skill-contract-deferred-pool
	deferred-pool-regression
)
present=()
missing=()
for name in "${FEATURE_FILES[@]}"; do
	if [ -f "$SRC_ROOT/test/$name.test.ts" ]; then
		present+=("test/$name.test.ts")
	else
		missing+=("$name.test.ts")
	fi
done
if [ "${#missing[@]}" -gt 0 ]; then missing_disp="${missing[*]}"; else missing_disp="none"; fi

echo
echo "=== feature suite (deferred-pool unit + integration + skill-contract, feature-scoped vitest) ==="
echo "  present ${#present[@]}/${#FEATURE_FILES[@]} | missing: $missing_disp"
feature_status=0
feature_ran=0
if [ "${#present[@]}" -gt 0 ]; then
	feature_ran=1
	LSC_E2E= npx vitest run "${present[@]}"
	feature_status=$?
fi

# 6. Full regression — npm test (all test/**/*.test.ts; e2e files self-skip) -------------
echo
echo "=== AC12 full regression: npm test (all test/**/*.test.ts; LSC_E2E-unset -> e2e self-skip) ==="
LSC_E2E= npm test
regression_status=$?

# 7. Combined summary + real combined exit status ----------------------------------------
echo
echo "=== SUMMARY: deferred-pool ==="
if [ "$build_status" -eq 0 ]; then
	echo "build (tsc type gate, src/)     : PASS"
else
	echo "build (tsc type gate, src/)     : FAIL (exit $build_status)"
fi
if [ "$feature_ran" -eq 1 ]; then
	if [ "$feature_status" -eq 0 ]; then
		echo "feature suite (${#present[@]}/${#FEATURE_FILES[@]} files)      : PASS"
	else
		echo "feature suite (${#present[@]}/${#FEATURE_FILES[@]} files)      : FAIL (exit $feature_status) — see per-test failures above"
	fi
else
	echo "feature suite (0/${#FEATURE_FILES[@]} files)      : SKIPPED (no assets synced yet; authoring window)"
fi
if [ "$regression_status" -eq 0 ]; then
	echo "AC12 full regression (npm test) : PASS"
else
	echo "AC12 full regression (npm test) : FAIL (exit $regression_status) — see failures above"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$feature_ran" -eq 1 ] && [ "$feature_status" -ne 0 ] && status=1
[ "$regression_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all executed suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (see per-suite status above) ==="
fi
exit "$status"
