#!/usr/bin/env bash
# run_test.sh — model-preset-session-default (pre-craft, C18)
#
# Single delegating entry point. lsc_run_tests execs this with cwd = the feature's
# source root (the worktree .lsc/worktrees/model-preset-session-default/, since this
# feature uses --worktree). It:
#   1. bootstraps node_modules in the source root if missing (npm ci),
#   2. syncs the CANONICAL, hash-protected test assets (assets/test/*.ts) into the
#      source root's test/ dir — the repo's conventional vitest location. This makes
#      every run self-healing against accidental edits of the synced copies; the
#      canonical files live under the C20 hash manifest and cannot drift,
#   3. runs `npm run build` as a hard type gate — vitest/esbuild NEVER typechecks, so
#      this is what enforces Step 3's compile-time seam proof (SessionApiSatisfiesHost)
#      and every PresetEntry type ripple (plan Verification 3),
#   4. runs the feature-scoped unit suite (vitest, repo convention),
#   5. runs the LSC_E2E-gated e2e ONLY when LSC_E2E=1 (spends real tokens; the craft
#      loop must not pay that per iteration). PLUGIN-LINK TOPOLOGY (review B1): the
#      omp binary loads this plugin from ~/.omp/plugins/node_modules/lets-craft ->
#      normally a symlink to the MAIN checkout, NOT this worktree. An e2e run only
#      exercises the code under test if that link resolves INTO this source root, so
#      the e2e branch verifies the link and fails loudly (no silent wrong-code pass)
#      when it points elsewhere. Remediation is printed.
#   6. prints a combined per-suite summary and exits with the real combined status.
#
# No -e: we want the full suite to run and a summary to print even on failure, then
# propagate the real exit code ourselves (fixture reference shape).
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_ROOT="$(pwd)"

if [ ! -f "$SRC_ROOT/package.json" ] || [ ! -d "$SRC_ROOT/src/preset" ]; then
	echo "ERROR: cwd does not look like the lets-craft source root: $SRC_ROOT" >&2
	echo "       (expected package.json + src/preset/; lsc_run_tests should exec this in the worktree)" >&2
	exit 2
fi

if [ ! -d "$SRC_ROOT/node_modules" ]; then
	echo "=== bootstrap: node_modules missing — npm ci ==="
	npm ci --no-audit --no-fund || { echo "ERROR: npm ci failed" >&2; exit 2; }
fi

echo "=== sync: canonical test assets -> $SRC_ROOT/test/ ==="
cp "$SCRIPT_DIR"/assets/test/*.ts "$SRC_ROOT/test/" || { echo "ERROR: asset sync failed" >&2; exit 2; }

echo
echo "=== type gate: npm run build (tsc — enforces the compile-time seam proof) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above; unit run continues for signal"
fi

echo
echo "=== unit suite (feature-scoped vitest) ==="
npx vitest run \
	test/preset-models.test.ts \
	test/preset-validate.test.ts \
	test/preset-session-default.test.ts \
	test/preset-inject.test.ts \
	test/preset-command.test.ts \
	test/preset-injection-spike.test.ts
unit_status=$?

e2e_status=0
e2e_ran=0
if [ "${LSC_E2E:-}" = "1" ]; then
	echo
	echo "=== gated e2e (LSC_E2E=1): AC1+AC2 ==="
	if [ -z "${HOME:-}" ]; then
		echo "e2e ERROR: HOME is unset — cannot locate the omp plugin link (~/.omp/plugins/node_modules/lets-craft)." >&2
		e2e_status=2
		e2e_ran=1
		plugin_target=""
		src_physical="$(cd "$SRC_ROOT" && pwd -P)"
	else
	plugin_path="$HOME/.omp/plugins/node_modules/lets-craft"
	plugin_target="$(cd "$plugin_path" 2>/dev/null && pwd -P || true)"
	src_physical="$(cd "$SRC_ROOT" && pwd -P)"
	if [ "$plugin_target" != "$src_physical" ]; then
		echo "e2e ERROR: omp loads the plugin from $plugin_path" >&2
		echo "           which resolves to: ${plugin_target:-<missing>}" >&2
		echo "           but the code under test is: $src_physical" >&2
		echo "           An e2e run now would exercise the WRONG checkout (false red/green)." >&2
		echo "           Remediation (already-linked host): ln -sfn \"$src_physical\" \"$plugin_path\"  (restore afterwards)" >&2
		echo "           Remediation (fresh host, canonical): omp plugin link \"$src_physical\"" >&2
		e2e_status=2
		e2e_ran=1
	elif [ "$build_status" -ne 0 ]; then
		echo "e2e ERROR: skipping e2e — build failed, dist/main.js would be stale/absent." >&2
		e2e_status=2
		e2e_ran=1
	else
		npx vitest run test/e2e-preset-default.test.ts \
			--no-file-parallelism --testTimeout=10200000 --hookTimeout=120000
		e2e_status=$?
		e2e_ran=1
	fi
	fi
else
	echo
	echo "=== gated e2e: SKIPPED (set LSC_E2E=1 to run — spends real tokens; AC1/AC2 final acceptance) ==="
fi

echo
echo "=== SUMMARY: model-preset-session-default ==="
if [ "$build_status" -eq 0 ]; then
	echo "build : PASS"
else
	echo "build : FAIL (tsc exit $build_status)"
fi
if [ "$unit_status" -eq 0 ]; then
	echo "unit  : PASS"
else
	echo "unit  : FAIL (vitest exit $unit_status) — see per-test failures above"
fi
if [ "$e2e_ran" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then
		echo "e2e   : PASS"
	else
		echo "e2e   : FAIL (exit $e2e_status) — see errors above"
	fi
else
	echo "e2e   : skipped (LSC_E2E unset)"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$unit_status" -ne 0 ] && status=1
[ "$e2e_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all executed suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED ==="
fi
exit "$status"
