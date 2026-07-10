#!/usr/bin/env bash
# Reference run_test.sh for the sample-ts-cli fixture (plan §Phase 4, C18: "단일
# 진입점 run_test.sh" — runs every test the project has and returns a combined
# result + per-failure reason). This is what pre-craft authors for a real feature and
# what lsc_run_tests (src/craft/run-tests.ts) execs via a trusted exec, never the
# LLM's own bash tool.
#
# No -e: we want to run the full suite and print a summary even when it fails, then
# propagate the real exit code ourselves.
set -uo pipefail
cd "$(dirname "$0")"

echo "=== sample-ts-cli: node --test ==="
node --test
status=$?

echo
if [ "$status" -eq 0 ]; then
	echo "=== RESULT: all tests passed ==="
else
	echo "=== RESULT: FAILURES DETECTED (node --test exit $status) ==="
fi

exit "$status"
