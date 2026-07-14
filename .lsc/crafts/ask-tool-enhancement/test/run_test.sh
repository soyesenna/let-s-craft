#!/usr/bin/env bash
# run_test.sh — ask-tool-enhancement (pre-craft, C18)
#
# Single delegating entry point. lsc_run_tests executes this with cwd set to the
# feature source root. Each run:
#   1. bootstraps node_modules when absent,
#   2. overwrites conventional test/fixture copies from the canonical,
#      hash-protected assets beside this script,
#   3. runs the TypeScript build gate,
#   4. runs the complete Vitest suite with LSC_E2E cleared so E2E files collect
#      and self-skip while every unit/regression file runs,
#   5. runs the repository's three-file E2E suite only when LSC_E2E=1, after
#      proving omp's plugin link resolves to this source root,
#   6. prints a combined summary and propagates failures.
#
# No -e: build, unit, and gated E2E statuses must all reach the summary.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(pwd)"

if [ ! -f "$SRC_ROOT/package.json" ] || [ ! -f "$SRC_ROOT/src/ask.ts" ]; then
	echo "ERROR: cwd does not look like the lets-craft source root: $SRC_ROOT" >&2
	echo "       (expected package.json + src/ask.ts; lsc_run_tests should exec this in the feature worktree)" >&2
	exit 2
fi

if [ ! -d "$SRC_ROOT/node_modules" ]; then
	echo "=== bootstrap: node_modules missing — npm ci ==="
	npm ci --no-audit --no-fund || { echo "ERROR: npm ci failed" >&2; exit 2; }
fi

echo "=== sync: canonical test assets -> $SRC_ROOT/test/ ==="
mkdir -p "$SRC_ROOT/test" || { echo "ERROR: could not create test sync target" >&2; exit 2; }
cp "$SCRIPT_DIR"/assets/test/*.ts "$SRC_ROOT/test/" || { echo "ERROR: test asset sync failed" >&2; exit 2; }

echo "=== sync: canonical fixture -> $SRC_ROOT/fixtures/sample-ts-cli/answers.json ==="
mkdir -p "$SRC_ROOT/fixtures/sample-ts-cli" || { echo "ERROR: could not create fixture sync target" >&2; exit 2; }
cp "$SCRIPT_DIR/assets/fixtures/sample-ts-cli/answers.json" \
	"$SRC_ROOT/fixtures/sample-ts-cli/answers.json" || { echo "ERROR: fixture asset sync failed" >&2; exit 2; }

echo
echo "=== type gate: npm run build (tsc) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above; unit run continues for signal"
fi

echo
echo "=== unit + regression suite (complete Vitest run; E2E files self-skip) ==="
echo "expected-red before craft: ask.test.ts, fixtures.test.ts, ask-schema.test.ts, ask-adversarial.test.ts"
echo "must-remain-green: all other non-E2E suites (including preset-* and craft-*)"
LSC_E2E= npx vitest run
unit_status=$?

e2e_status=0
e2e_ran=0
if [ "${LSC_E2E:-}" = "1" ]; then
	echo
	echo "=== gated e2e (LSC_E2E=1): repository three-file suite ==="
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
			npm run e2e
			e2e_status=$?
			e2e_ran=1
		fi
	fi
else
	echo
	echo "=== gated e2e: SKIPPED (set LSC_E2E=1 to run; real model/token use) ==="
fi

echo
echo "=== SUMMARY: ask-tool-enhancement ==="
if [ "$build_status" -eq 0 ]; then
	echo "build      : PASS"
else
	echo "build      : FAIL (tsc exit $build_status)"
fi
if [ "$unit_status" -eq 0 ]; then
	echo "unit+regress: PASS (complete Vitest suite; E2E self-skipped)"
else
	echo "unit+regress: FAIL (vitest exit $unit_status) — see per-file failures above"
fi
echo "expected-red: ask.test.ts, fixtures.test.ts, ask-schema.test.ts, ask-adversarial.test.ts (normal only before craft implements v2)"
echo "regression  : every other non-E2E suite must stay green; unrelated failures are never expected"
if [ "$e2e_ran" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then
		echo "e2e        : PASS"
	else
		echo "e2e        : FAIL (exit $e2e_status) — see errors above"
	fi
else
	echo "e2e        : skipped (LSC_E2E unset)"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$unit_status" -ne 0 ] && status=1
[ "$e2e_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all executed suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (feature-only RED is expected before craft; exit remains nonzero) ==="
fi
exit "$status"
