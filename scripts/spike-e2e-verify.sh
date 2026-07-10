#!/usr/bin/env bash
# Phase 1.5 spike script — two independent, reusable verifications that require the
# real `omp` binary (not reproducible via vitest/Node, see test file header).
#
# PART A (default, safe, no tokens spent): write-location matrix.
#   Uses `omp config get/set --profile <isolated>` so it NEVER touches the caller's
#   real `~/.omp/agent/config.yml`. Proves:
#     - a raw fs write to the global config.yml is read correctly by a fresh `omp`
#       process (`omp config get`).
#     - a raw fs write to the PROJECT layer (`<cwd>/.omp/settings.json`) is read
#       correctly too, and wins over a conflicting global key while a global-only
#       key is preserved (per-key deep merge, not whole-record replace).
#
# PART B (opt-in, spends real tokens against your authenticated providers): real
# subagent spawn verification. This is the methodology correction this spike found
# the hard way: the spawned subagent's OWN API calls are NOT present in the parent
# session's `--mode=json` stdout stream — they live in a separate
# `<parent-session-dir>/<agentId>.jsonl` file (executor.ts:1897,
# `subtaskSessionFile = path.join(artifactsDir, \`${id}.jsonl\`)`). Grepping the
# parent's stdout for the override model gives a false negative. Any Phase 7 E2E
# assertion that checks "did the override actually apply to the spawn" MUST resolve
# and inspect that per-agent session file, not the parent transcript.
#
# Usage:
#   ./scripts/spike-e2e-verify.sh                 # Part A only (safe default)
#   LSC_SPIKE_RUN_SPAWN=1 ./scripts/spike-e2e-verify.sh   # Part A + Part B (real API calls)
#
# Part B model choice: override LSC_SPIKE_MAIN_MODEL / LSC_SPIKE_OVERRIDE_MODEL env
# vars to use models you have credentials for. Defaults assume a "zai" account like
# the one this spike was run against — adjust for your own setup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

PROFILE="lsc-spike-$(date +%s)"
pass() { echo "PASS — $1"; }
fail() { echo "FAIL — $1"; exit 1; }

echo "=== Part A: write-location matrix (isolated profile: $PROFILE, no real config touched) ==="

# A1: global layer raw write, read back by a fresh process.
# NOTE: --profile is a top-level omp flag and must precede the subcommand.
omp --profile "$PROFILE" config set task.agentModelOverrides '{"lsc-executor":"zai/glm-4.5-flash:low"}' >/dev/null
GLOBAL_GET="$(omp --profile "$PROFILE" config get task.agentModelOverrides --json)"
echo "$GLOBAL_GET" | grep -q '"lsc-executor": "zai/glm-4.5-flash:low"' \
	&& pass "global config.yml write is read back by a fresh process" \
	|| fail "global config.yml write did not round-trip: $GLOBAL_GET"

# A2: project layer raw write (a DIFFERENT project dir), wins over the global key,
# and preserves a global-only key.
PROJECT_DIR="$SCRATCH/project"
mkdir -p "$PROJECT_DIR/.omp"
cat > "$PROJECT_DIR/.omp/settings.json" <<'EOF'
{
  "task": {
    "agentModelOverrides": {
      "lsc-executor": "zai/glm-4.6:low",
      "lsc-tracer": "zai/glm-4.5-flash:low"
    }
  }
}
EOF
# Add a global-only key so we can confirm it survives the merge.
omp --profile "$PROFILE" config set task.agentModelOverrides '{"lsc-executor":"zai/glm-4.5-flash:low","lsc-planner":"zai/glm-5.2:medium"}' >/dev/null

PROJECT_GET="$(cd "$PROJECT_DIR" && omp --profile "$PROFILE" config get task.agentModelOverrides --json)"
echo "$PROJECT_GET" | grep -q '"lsc-executor": "zai/glm-4.6:low"' \
	&& pass "project layer wins over global on a conflicting key" \
	|| fail "project layer did not win: $PROJECT_GET"
echo "$PROJECT_GET" | grep -q '"lsc-tracer": "zai/glm-4.5-flash:low"' \
	&& pass "project-only key present in the merge" \
	|| fail "project-only key missing: $PROJECT_GET"
echo "$PROJECT_GET" | grep -q '"lsc-planner": "zai/glm-5.2:medium"' \
	&& pass "global-only key survives the merge (per-key deep merge, not replace)" \
	|| fail "global-only key dropped: $PROJECT_GET"

rm -rf "$HOME/.omp/profiles/$PROFILE" 2>/dev/null || true
echo ""
echo "Part A complete. Isolated profile cleaned up; real ~/.omp/agent/config.yml untouched."

if [ "${LSC_SPIKE_RUN_SPAWN:-0}" != "1" ]; then
	echo ""
	echo "Part B skipped (set LSC_SPIKE_RUN_SPAWN=1 to run it — spends real tokens)."
	exit 0
fi

echo ""
echo "=== Part B: real subagent spawn verification (spends tokens on your default profile) ==="

MAIN_MODEL="${LSC_SPIKE_MAIN_MODEL:-zai/glm-4.6:low}"
OVERRIDE_MODEL="${LSC_SPIKE_OVERRIDE_MODEL:-zai/glm-4.5-flash:low}"
BACKUP="$HOME/.omp/agent/config.yml.bak-spike-e2e-$(date +%s)"
cp "$HOME/.omp/agent/config.yml" "$BACKUP" 2>/dev/null || touch "$BACKUP"
cleanup_config() { \cp -f "$BACKUP" "$HOME/.omp/agent/config.yml" 2>/dev/null || true; rm -f "$BACKUP"; }
trap 'cleanup_config; rm -rf "$SCRATCH"' EXIT

printf '\ntask:\n  agentModelOverrides:\n    lsc-executor: %s\n' "$OVERRIDE_MODEL" >> "$HOME/.omp/agent/config.yml"

cd "$REPO_ROOT"
OUT="$SCRATCH/e2e-spawn.json"
omp -p --model "$MAIN_MODEL" --mode=json --no-title \
	"task 툴로 lsc-executor 에이전트에게 '9+9는 무엇인가?'에 답하라는 assignment를 위임(delegate)하라. task 툴을 정확히 한 번만 호출하고, 결과가 오면 그대로 요약해서 답하라." \
	> "$OUT" 2>&1

SESSION_ID="$(head -1 "$OUT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)"
SESSION_FILE="$(grep -rl "\"id\":\"$SESSION_ID\"" "$HOME/.omp/agent/sessions" 2>/dev/null | head -1)"
SESSION_DIR="${SESSION_FILE%.jsonl}"

if [ -z "$SESSION_DIR" ] || [ ! -d "$SESSION_DIR" ]; then
	fail "could not locate the spawned subagent's artifact directory ($SESSION_DIR)"
fi

SUBAGENT_FILE="$(find "$SESSION_DIR" -name '*.jsonl' | head -1)"
if [ -z "$SUBAGENT_FILE" ]; then
	fail "no subagent session file found under $SESSION_DIR — this is the exact trap this script exists to catch"
fi

OVERRIDE_BARE="${OVERRIDE_MODEL%%:*}"
OVERRIDE_BARE="${OVERRIDE_BARE##*/}"
if grep -q "\"model\":\"$OVERRIDE_BARE\"" "$SUBAGENT_FILE"; then
	pass "subagent's OWN session file ($SUBAGENT_FILE) shows the override model ($OVERRIDE_BARE) — AC2d confirmed at the real spawn level"
else
	fail "subagent session file does not show the override model — see $SUBAGENT_FILE"
fi

echo ""
echo "Part B complete. Real config.yml restored from $BACKUP and removed."
