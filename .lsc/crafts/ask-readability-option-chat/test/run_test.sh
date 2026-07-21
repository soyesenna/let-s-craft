#!/usr/bin/env bash
# run_test.sh — ask-readability-option-chat (pre-craft)
#
# Single delegating entry point. lsc_run_tests executes this with cwd set to the feature source
# root (the worktree). Every run is FAIL-CLOSED (v2 §7 — an unmet prerequisite is never a silent
# success):
#   1. deps: run `npm ci` when node_modules is absent/incomplete OR when package-lock.json changed
#      since the last successful install (a lock-hash stamp under node_modules). The lock hash is a
#      Node crypto SHA-256 with NO fallback — a missing lock or a hash failure is exit 2 (CS6). A
#      stale node_modules (e.g. still 16.4.0 after craft bumps the lock to 17.0.5) can never be reused.
#   2. inventory: BEFORE any sync, verify the exact feature-namespace canon — 11 Vitest
#      (assets/test/ask-ui-*.test.ts) + 1 type-check (assets/typecheck/ask-ui-*.test-d.ts) + 1 Bun
#      (assets/test-bun/ask-ui-*.test.ts). A missing OR extra namespace asset is exit 2 (N-B).
#   3. sync: EXACT feature-namespace sync — first purge any stale feature copies
#      (test/ask-ui-*.test.ts, test/ask-ui-*.test-d.ts, test-bun/ask-ui-*.test.ts) with GUARDED rm so
#      a canon rename/delete leaves no ghost (a purge failure is exit 2, CS6), then copy
#      assets/test/*.ts + assets/typecheck/*.test-d.ts -> test/ (vitest suites + the type-check asset,
#      the latter OUTSIDE vitest's *.test.ts glob) and assets/test-bun/*.ts -> test-bun/ (Bun, kept
#      OUT of vitest's default test/ glob), then mark the copies read-only so editing a synced shadow
#      instead of the hash-protected canon fails loudly (N11).
#   4. build: the TypeScript type gate for src/** (npm run build also generates src/generated/version.ts).
#   5. type-check: a DEDICATED `tsc --noEmit` over test/ask-ui-contract.test-d.ts, using the SAME
#      NodeNext resolution as the root build (N-C), so the Assert<Equal<...>> contract pins
#      (AskExecutionContext / cacheRetention / colorMode / the three result unions) are actually
#      enforced. RED (module-not-found) until PR2 creates src/ask-ui/*; type_status reaches the
#      summary AND the final exit code (CS5).
#   6. unit: the complete Vitest suite with LSC_E2E= AND LSC_FIXTURE= cleared, so E2E files
#      self-skip and no ambient fixture path pollutes unit/integration isolation (N9/N10).
#   7. Bun: the deterministic adapter suite (B1-B3) runs by DEFAULT whenever `bun` is present
#      (network-free). With the canon inventory guaranteeing the Bun asset, `bun` present + asset
#      absent is now ALWAYS a hard failure (no LSC_BUN-gated skip, CS6); `bun` absent stays a
#      skip-with-reason UNLESS LSC_BUN=1 makes it a hard failure.
#   8. e2e: the gated live suite runs only when LSC_E2E=1 (after proving the omp plugin link).
#      Under that explicit gate an unmet prerequisite is a HARD failure; LSC_E2E_STRICT=1 tells the
#      ask-ui-e2e suite to turn its internal ctx.skip() (missing omp/version/dist) into a failure.
#   9. summary: print a combined status and propagate the real exit code.
#
# No -e: build, type-check, unit, Bun, and gated e2e statuses must ALL reach the summary. A nonzero
# exit BEFORE craft is EXPECTED — the new feature suites are RED until src/ask-ui/* exists; that is a
# test verdict, not a script error. AFTER craft implements src/ask-ui/*, every stage must pass.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_ROOT="$(pwd)"

if [ ! -f "$SRC_ROOT/package.json" ] || [ ! -f "$SRC_ROOT/src/ask.ts" ]; then
	echo "ERROR: cwd does not look like the lets-craft source root: $SRC_ROOT" >&2
	echo "       (expected package.json + src/ask.ts; lsc_run_tests should exec this in the feature worktree)" >&2
	exit 2
fi

# ── deps: reinstall on absent/incomplete node_modules OR a changed package-lock (P4 fail-closed) ──
# We stamp the package-lock hash into node_modules after a successful `npm ci`; a mismatch (or a
# missing stamp) forces a fresh install so the build/Bun/e2e stages can never exercise a stale SDK.
LOCK_FILE="$SRC_ROOT/package-lock.json"
LOCK_STAMP="$SRC_ROOT/node_modules/.lsc-lock-stamp"

lock_hash() {
	# SHA-256 of package-lock.json via Node crypto — always available (the runner already requires
	# node/npm), so there is NO size/byte-count fallback that could mask a same-size lock change (CS6).
	# A missing lock or a hashing failure is a HARD, fail-closed error (exit 2), never a soft marker.
	if [ ! -f "$LOCK_FILE" ]; then
		echo "ERROR: package-lock.json is absent — cannot prove SDK-pin freshness or run npm ci (fail-closed)." >&2
		exit 2
	fi
	node -e 'const fs=require("node:fs"),c=require("node:crypto");process.stdout.write(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$LOCK_FILE" \
		|| { echo "ERROR: could not hash package-lock.json with Node crypto (fail-closed)." >&2; exit 2; }
}

# Compute the lock hash exactly ONCE. An `exit 2` fired inside the lock_hash subshell surfaces as the
# command-substitution's exit status, so the `|| exit 2` guard propagates it (an unguarded $(...)
# inside a `[ ]` test would otherwise swallow the failure and continue with an empty hash).
LOCK_HASH="$(lock_hash)" || exit 2
[ -n "$LOCK_HASH" ] || { echo "ERROR: computed an empty package-lock hash (fail-closed)." >&2; exit 2; }

need_ci=0
if [ ! -d "$SRC_ROOT/node_modules" ] || [ ! -e "$SRC_ROOT/node_modules/.bin/vitest" ]; then
	echo "=== deps: node_modules missing/incomplete — npm ci ==="
	need_ci=1
elif [ ! -f "$LOCK_STAMP" ]; then
	echo "=== deps: no lock-hash stamp (install freshness unproven) — npm ci ==="
	need_ci=1
elif [ "$LOCK_HASH" != "$(cat "$LOCK_STAMP" 2>/dev/null)" ]; then
	echo "=== deps: package-lock.json changed since last install — npm ci (SDK pin drift guard) ==="
	need_ci=1
fi
if [ "$need_ci" -eq 1 ]; then
	npm ci --no-audit --no-fund || { echo "ERROR: npm ci failed" >&2; exit 2; }
	printf '%s' "$LOCK_HASH" > "$LOCK_STAMP" 2>/dev/null || true
fi

# ── inventory: the EXACT feature-namespace canon MUST be present before any sync (N-B, fail-closed) ──
# 11 Vitest (assets/test/ask-ui-*.test.ts) + 1 type-check (assets/typecheck/ask-ui-*.test-d.ts)
# + 1 Bun adapter (assets/test-bun/ask-ui-*.test.ts). A missing OR extra namespace asset (a canon
# file silently added or deleted) is exit 2 — it must never reach the sync/type-check/Bun stages.
inventory_count() { compgen -G "$1" 2>/dev/null | wc -l | tr -d ' '; }
n_vitest="$(inventory_count "$SCRIPT_DIR/assets/test/ask-ui-*.test.ts")"
n_typed="$(inventory_count "$SCRIPT_DIR/assets/typecheck/ask-ui-*.test-d.ts")"
n_bun="$(inventory_count "$SCRIPT_DIR/assets/test-bun/ask-ui-*.test.ts")"
if [ "$n_vitest" -ne 11 ] || [ "$n_typed" -ne 1 ] || [ "$n_bun" -ne 1 ]; then
	echo "ERROR: canon inventory mismatch (fail-closed) — expected 11 Vitest + 1 test-d + 1 Bun asset:" >&2
	echo "       assets/test/ask-ui-*.test.ts        : $n_vitest (expected 11)" >&2
	echo "       assets/typecheck/ask-ui-*.test-d.ts  : $n_typed (expected 1)" >&2
	echo "       assets/test-bun/ask-ui-*.test.ts     : $n_bun (expected 1)" >&2
	exit 2
fi
echo "=== canon inventory OK: 11 Vitest + 1 type-check + 1 Bun feature assets present ==="

# ── sync: EXACT feature-namespace sync (purge stale copies, then copy canon, then lock read-only) ──
echo
echo "=== sync: canonical vitest + type-check assets -> $SRC_ROOT/test/ (exact) ==="
mkdir -p "$SRC_ROOT/test" || { echo "ERROR: could not create test sync target" >&2; exit 2; }
# Purge stale feature copies FIRST (a canon rename/delete must leave no ghost that a later stage —
# vitest OR the type-check — keeps exercising). Each rm is GUARDED: a purge failure is fail-closed
# (CS6), never a silent continue. The namespace spans *.test.ts (vitest) AND *.test-d.ts (N-B).
rm -f "$SRC_ROOT"/test/ask-ui-*.test.ts   || { echo "ERROR: could not purge stale test/ask-ui-*.test.ts shadows" >&2; exit 2; }
rm -f "$SRC_ROOT"/test/ask-ui-*.test-d.ts || { echo "ERROR: could not purge stale test/ask-ui-*.test-d.ts shadows" >&2; exit 2; }
cp "$SCRIPT_DIR"/assets/test/*.ts "$SRC_ROOT/test/" || { echo "ERROR: test asset sync failed" >&2; exit 2; }
# The type-check asset lands in test/ too, so its `../src/...` imports resolve like the vitest suites.
# It is NOT in vitest's *.test.ts glob (test/**/*.test.ts), so `vitest run` never collects it — only
# the dedicated `tsc --noEmit` type gate below reads it.
cp "$SCRIPT_DIR"/assets/typecheck/*.test-d.ts "$SRC_ROOT/test/" || { echo "ERROR: type-check asset sync failed" >&2; exit 2; }

bun_assets=0
if compgen -G "$SCRIPT_DIR/assets/test-bun/*.ts" >/dev/null 2>&1; then
	echo "=== sync: canonical Bun-adapter assets -> $SRC_ROOT/test-bun/ (exact) ==="
	mkdir -p "$SRC_ROOT/test-bun" || { echo "ERROR: could not create test-bun sync target" >&2; exit 2; }
	rm -f "$SRC_ROOT"/test-bun/ask-ui-*.test.ts || { echo "ERROR: could not purge stale test-bun/ask-ui-*.test.ts shadows" >&2; exit 2; }
	cp "$SCRIPT_DIR"/assets/test-bun/*.ts "$SRC_ROOT/test-bun/" || { echo "ERROR: test-bun asset sync failed" >&2; exit 2; }
	bun_assets=1
fi

# The synced copies are throwaway shadows of the hash-protected canon under assets/. Mark them
# read-only so editing the shadow (instead of the canon) fails loudly rather than being silently
# discarded on the next sync (N11). The next run's guarded `rm -f` above still clears them — removal
# needs only directory write permission, so the read-only bit never blocks it.
chmod a-w "$SRC_ROOT"/test/ask-ui-*.test.ts 2>/dev/null || true
chmod a-w "$SRC_ROOT"/test/ask-ui-*.test-d.ts 2>/dev/null || true
[ "$bun_assets" -eq 1 ] && chmod a-w "$SRC_ROOT"/test-bun/ask-ui-*.test.ts 2>/dev/null || true
echo "NOTICE: test/ask-ui-*.test.ts, test/ask-ui-*.test-d.ts and test-bun/ask-ui-*.test.ts are READ-ONLY"
echo "        synced shadows of the hash-protected canon under $SCRIPT_DIR/assets/ — edit the canon, never the shadow."

echo
echo "=== type gate: npm run build (gen-version + tsc) ==="
npm run build
build_status=$?
if [ "$build_status" -ne 0 ]; then
	echo "build : FAIL (exit $build_status) — type errors above."
	echo "        EXPECTED ONLY before craft (src/ask-ui/* not created yet); the unit run continues for"
	echo "        signal. Once craft implements src/ask-ui/*, a build FAIL is a REAL error, not expected."
fi

echo
echo "=== type-check gate: ask-ui type contract (tsc --noEmit on test/ask-ui-contract.test-d.ts) ==="
echo "expected-red before craft: src/ask-ui/{types,completion-core}.ts do not exist yet, so the .test-d.ts"
echo "  imports are module-not-found (TS2307) — RED until PR2 creates them; a type verdict, not a script error."
type_status=0
if [ -f "$SRC_ROOT/test/ask-ui-contract.test-d.ts" ]; then
	# Same NodeNext resolution as the root build (tsconfig.json: module/moduleResolution=NodeNext,
	# target ES2022, strict, skipLibCheck) so the SDK's source-TS entry points resolve identically —
	# no Bundler-vs-NodeNext divergence (N-C). Passing the file explicitly makes tsc ignore tsconfig
	# and type-check ONLY the contract pins (Assert<Equal<...>>); a widened type (e.g. cacheRetention
	# broadened to string, or a 7th ExtensionContext member) fails this gate.
	npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext "$SRC_ROOT/test/ask-ui-contract.test-d.ts"
	type_status=$?
	if [ "$type_status" -ne 0 ]; then
		echo "type-check : FAIL (tsc exit $type_status) — EXPECTED RED before craft creates src/ask-ui/*; a REAL error after PR2."
	fi
else
	echo "type-check ERROR: test/ask-ui-contract.test-d.ts absent after sync — the type-contract asset is missing (fail-closed)." >&2
	type_status=2
fi

echo
echo "=== unit/integration/snapshot/regression suite (complete Vitest run; E2E files self-skip) ==="
echo "expected-red before craft: the new feature suites test/ask-ui-*.test.ts (src/ask-ui/* not implemented yet)"
echo "  NOTE: ask-ui-contract-regression.test.ts = baseline pins (GREEN, must stay GREEN) + two future-contract"
echo "        blocks RED until PR1: U5 loadMode (16) + SDK exact-pin (@oh-my-pi/pi-{coding-agent,ai,tui}=17.0.5, 9)."
echo "must-remain-green: every pre-existing suite (ask.test.ts, fixtures.test.ts, ask-schema.test.ts, statusbar-regression.test.ts, preset-*, craft-*, ...)"
LSC_E2E= LSC_FIXTURE= npx vitest run
unit_status=$?

e2e_status=0
e2e_ran=0
if [ "${LSC_E2E:-}" = "1" ]; then
	echo
	echo "=== gated e2e (LSC_E2E=1): pipeline regression + ask-ui live smoke (fail-closed) ==="
	if [ -z "${HOME:-}" ]; then
		echo "e2e ERROR: HOME is unset — cannot locate the omp plugin link (~/.omp/plugins/node_modules/lets-craft)." >&2
		e2e_status=2
		e2e_ran=1
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
			e2e_pipeline=$?
			echo
			echo "--- ask-ui live smoke: test/ask-ui-e2e.test.ts (LSC_E2E=1 LSC_E2E_STRICT=1; E1+E2) ---"
			if [ -f "$SRC_ROOT/test/ask-ui-e2e.test.ts" ]; then
				# LSC_E2E_STRICT=1: under the explicit gate the suite MUST turn a missing omp/version/dist
				# prerequisite into expect.fail() (not ctx.skip()), so an "all skipped, exit 0" is impossible.
				LSC_E2E=1 LSC_E2E_STRICT=1 npx vitest run test/ask-ui-e2e.test.ts --testTimeout=720000 --hookTimeout=120000
				e2e_askui=$?
			else
				echo "e2e ERROR: LSC_E2E=1 but test/ask-ui-e2e.test.ts is absent — feature suite missing under an explicit gate (fail-closed)." >&2
				e2e_askui=2
			fi
			e2e_status=0
			[ "$e2e_pipeline" -ne 0 ] && e2e_status=1
			[ "$e2e_askui" -ne 0 ] && e2e_status=1
			e2e_ran=1
		fi
	fi
else
	echo
	echo "=== gated e2e: SKIPPED (set LSC_E2E=1 to run; real model/token use — runs at PR1 gate / post-implementation) ==="
fi

# ── Bun adapter suite (B1-B3): deterministic + network-free → runs by DEFAULT when bun present ──
bun_status=0
bun_ran=0
if command -v bun >/dev/null 2>&1; then
	if [ "$bun_assets" -eq 1 ]; then
		echo
		echo "=== Bun adapter suite (bun present): bun test test-bun ==="
		( cd "$SRC_ROOT" && bun test test-bun )
		bun_status=$?
		bun_ran=1
	else
		# `bun` is present but the Bun canon did not sync. The inventory gate above already guarantees
		# the Bun asset exists, so reaching here means the sync itself failed — ALWAYS a hard, fail-closed
		# error now (the former "asset absent + LSC_BUN unset → skip" branch is gone, CS6).
		echo
		echo "bun ERROR: 'bun' is present but no test-bun/ask-ui-*.test.ts synced — prerequisite missing (fail-closed)." >&2
		bun_status=2
		bun_ran=1
	fi
elif [ "${LSC_BUN:-}" = "1" ]; then
	echo
	echo "bun ERROR: LSC_BUN=1 but 'bun' is not on PATH — prerequisite missing (fail-closed)." >&2
	bun_status=2
	bun_ran=1
else
	echo
	echo "=== Bun adapter: SKIPPED (bun not on PATH; install bun to run B1-B3, or set LSC_BUN=1 to make its absence a hard failure) ==="
fi

echo
echo "=== SUMMARY: ask-readability-option-chat ==="
if [ "$build_status" -eq 0 ]; then
	echo "build        : PASS"
else
	echo "build        : FAIL (tsc exit $build_status) — EXPECTED RED before craft creates src/ask-ui/*; a REAL error after"
fi
if [ "$type_status" -eq 0 ]; then
	echo "type-check   : PASS (ask-ui contract pins hold: AskExecutionContext / cacheRetention / colorMode / 3 result unions)"
else
	echo "type-check   : FAIL (tsc exit $type_status) — EXPECTED RED before craft creates src/ask-ui/*; a REAL error after PR2"
fi
if [ "$unit_status" -eq 0 ]; then
	echo "unit+regress : PASS (complete Vitest suite; E2E self-skipped)"
else
	echo "unit+regress : FAIL (vitest exit $unit_status) — see per-file failures above"
fi
echo "expected-red : pre-craft the new feature suites test/ask-ui-*.test.ts are RED (src/ask-ui/* unimplemented),"
echo "               the type-check gate (test/ask-ui-contract.test-d.ts) is RED for the same reason,"
echo "               and test-bun/ask-ui-adapter.test.ts (Bun) is RED for the same reason."
echo "               ask-ui-contract-regression.test.ts is the ONE mixed file: its BASELINE PINS stay GREEN, while"
echo "               its FUTURE-CONTRACT blocks are RED until PR1 — U5 loadMode (16) + SDK exact-pin 17.0.5 (9)."
echo "must-green   : every pre-existing suite (envelope/fixture/schema/adversarial/statusbar-regression/preset-*/craft-*) — unrelated failures are never expected"
if [ "$e2e_ran" -eq 1 ]; then
	if [ "$e2e_status" -eq 0 ]; then
		echo "e2e          : PASS"
	else
		echo "e2e          : FAIL (exit $e2e_status) — the explicit LSC_E2E=1 gate is fail-closed on unmet prerequisites (see errors above)"
	fi
else
	echo "e2e          : skipped (LSC_E2E unset; live smoke runs post-implementation / at the PR1 gate)"
fi
if [ "$bun_ran" -eq 1 ]; then
	if [ "$bun_status" -eq 0 ]; then
		echo "bun-adapter  : PASS (deterministic B1-B3)"
	else
		echo "bun-adapter  : FAIL (exit $bun_status) — EXPECTED RED before craft (src/ask-ui/* unimplemented); a REAL error after"
	fi
else
	echo "bun-adapter  : skipped (bun not on PATH; set LSC_BUN=1 to make its absence a hard failure)"
fi

status=0
[ "$build_status" -ne 0 ] && status=1
[ "$type_status" -ne 0 ] && status=1
[ "$unit_status" -ne 0 ] && status=1
[ "$e2e_status" -ne 0 ] && status=1
[ "$bun_status" -ne 0 ] && status=1
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all executed suites passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (feature-only RED is expected before craft; exit remains nonzero) ==="
fi
exit "$status"
