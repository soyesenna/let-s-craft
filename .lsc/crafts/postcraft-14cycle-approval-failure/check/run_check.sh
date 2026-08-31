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
#   test       — present; run below (`vitest run`)
#   lint       — omitted: package.json has no "lint" script
#   typecheck  — omitted as a separate step: no dedicated script; `npm run build` already runs `tsc`
#   test:bun   — omitted: bun-only extra suite, not the primary `test` command
#   e2e        — omitted: hours-long subprocess suite (`npm run e2e`); not the primary `test` command
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
echo "==> test (vitest run)"
npm test || status=1
echo "==> summary status=${status}"
exit "$status"
