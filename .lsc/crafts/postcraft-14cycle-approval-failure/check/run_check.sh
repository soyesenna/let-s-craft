#!/usr/bin/env bash
# Single check entrypoint for postcraft-14cycle-approval-failure.
#
# lsc_run_check executes this with cwd = the feature worktree root
# (`bash check/run_check.sh`). ROOT is still resolved from this script's
# path so an accidental invocation from another directory hits the same tree.
# Layout: .lsc/crafts/{feature}/check/run_check.sh → four levels up is the worktree root.
#
# Manifest (package.json) scripts:
#   build      — present; run below (also typechecks: `tsc` is inside `npm run build`)
#   test       — present; run below (`vitest run`). E2E files are describe.skipIf(!LSC_E2E)
#                here, so this step is NOT AC-8 evidence (audit-0 RF-10).
#   test:bun   — present; run below (`bun test test-bun`)
#   e2e        — present; run below. package.json `e2e` itself re-runs `npm run build` and
#                sets LSC_E2E=1; this script only invokes that script as-is (RF-10).
#   lint       — omitted: package.json has no "lint" script
#   typecheck  — omitted as a separate step: no dedicated script; `npm run build` already runs `tsc`
#
# Expected wall-clock (for §3.1 timeout_ms; that knob is the main session's, not this script's;
# audit-4 RF-40 corrected sizing note): `npm run e2e` runs 4 files with --no-file-parallelism,
# and the sizing AUTHORITY for these files is each file's own per-`it` TEST_TIMEOUT_MS local
# override (e.g. test/e2e-full-cycle.test.ts passes it as the vitest `it(..., timeout)` third
# argument — 19,020,000ms at the RF-40 re-derivation). package.json's `--testTimeout=10200000`
# NEVER overrides a per-it local timeout; it only bounds files whose `it` calls carry no local
# override. Worst-case budget is therefore the SUM of the per-file local overrides (sequential,
# --no-file-parallelism) plus hookTimeout=120000 per file — not 4 × --testTimeout, and not
# `npm test` (E2E files skip there).
#
# Commands go through `npm run` so the package.json scripts stay the SSOT
# (tokens `npm` satisfy evaluateCheckScriptShape's package.json runner check).
set -uo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT"

status=0
echo "==> build (includes tsc typecheck)"
npm run build || status=1
echo "==> test (vitest run; e2e files skip without LSC_E2E — not AC-8 evidence)"
npm test || status=1
echo "==> test:bun (bun test test-bun)"
npm run test:bun || status=1
echo "==> e2e (package.json e2e: rebuild + LSC_E2E=1, 4 files, no-file-parallelism, testTimeout=10200000ms)"
npm run e2e || status=1
echo "==> summary status=${status}"
exit "$status"
