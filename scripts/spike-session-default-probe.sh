#!/usr/bin/env bash
# Runtime probe for the model-preset session-default seam.
#
# This script uses an isolated omp profile and isolated session directories. It
# records the session_start entry shape and the resolve -> setModel ->
# setThinkingLevel behavior for the five scenarios in the implementation plan.
# It spends real tokens. Override the default models when needed:
#
#   LSC_PROBE_MODEL=zai/glm-4.5-flash:low \
#   LSC_PROBE_ALT_MODEL=zai/glm-4.6:low \
#   LSC_PROBE_API_KEY=... ./scripts/spike-session-default-probe.sh
#
# LSC_PROBE_LOG_DIR controls where the timestamped log is retained. The default
# is scripts/probe-logs so the probe never writes to normal omp state or the
# hash-protected craft test tree.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCRATCH="$(mktemp -d)"
PROFILE="lsc-session-default-probe-$$-$(date +%s)"
LOG_DIR="${LSC_PROBE_LOG_DIR:-$SCRIPT_DIR/probe-logs}"
LOG_FILE="$LOG_DIR/probe-$(date +%Y%m%d-%H%M%S).log"
MODEL="${LSC_PROBE_MODEL:-zai/glm-4.5-flash:low}"
ALT_MODEL="${LSC_PROBE_ALT_MODEL:-zai/glm-4.6:low}"
BASE_MODEL="${MODEL%:*}"
MODEL_EFFORT="${MODEL##*:}"
if [ "$MODEL_EFFORT" = "$MODEL" ]; then MODEL_EFFORT="low"; fi
EXTENSION="$SCRATCH/session-default-probe.mjs"
FAILURES=0

mkdir -p "$LOG_DIR"
cleanup() {
	rm -rf "$SCRATCH"
	rm -rf "$HOME/.omp/profiles/$PROFILE" 2>/dev/null || true
}
trap cleanup EXIT

cat > "$EXTENSION" <<'PROBE'
const BOOT_TYPES = new Set(["model_change", "thinking_level_change", "service_tier_change"]);

function histogram(entries) {
	const counts = {};
	for (const entry of entries) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
	return counts;
}

function isFreshMainSession(entries) {
	const counts = {};
	for (const entry of entries) {
		if (!BOOT_TYPES.has(entry.type)) return false;
		if (entry.type === "model_change" && entry.role === "default") return false;
		counts[entry.type] = (counts[entry.type] ?? 0) + 1;
		if (counts[entry.type] > 1) return false;
	}
	return true;
}

function splitEffort(spec) {
	const slash = spec.indexOf("/");
	const colon = spec.lastIndexOf(":");
	return slash >= 0 && colon > slash
		? { base: spec.slice(0, colon), effort: spec.slice(colon + 1) }
		: { base: spec, effort: null };
}

function emit(value) {
	process.stderr.write(`[lsc-session-default-probe] ${JSON.stringify(value)}\n`);
}

export default function probe(pi) {
	pi.on("session_start", async (_event, ctx) => {
		const scenario = process.env.LSC_PROBE_SCENARIO ?? "unknown";
		const entries = ctx.sessionManager.getEntries().map(entry => ({ type: entry.type, role: entry.role ?? null }));
		const fresh = isFreshMainSession(entries);
		emit({ scenario, phase: "entries", entries, histogram: histogram(entries), fresh });

		if (scenario === "cycle") return;
		if (!fresh) {
			emit({ scenario, phase: "apply", status: "gated" });
			return;
		}

		const spec = process.env.LSC_PROBE_TARGET ?? "";
		const { base, effort } = splitEffort(spec);
		const model = ctx.models.resolve(base);
		if (!model) {
			emit({ scenario, phase: "apply", status: "unresolved", base });
			return;
		}
		const set = await pi.setModel(model);
		if (!set) {
			emit({ scenario, phase: "apply", status: "no-key", base });
			return;
		}
		if (effort) pi.setThinkingLevel(effort);
		emit({ scenario, phase: "apply", status: "applied", base, effort });

		if (scenario === "no-key") {
			const direct = { ...model, provider: "lsc-probe-no-key", id: "missing-api-key" };
			const directResult = await pi.setModel(direct);
			emit({ scenario, phase: "direct-model", status: directResult ? "unexpectedly-applied" : "no-key" });
		}
	});
}
PROBE

API_KEY_ARGS=()
if [ -n "${LSC_PROBE_API_KEY:-}" ]; then API_KEY_ARGS=(--api-key "$LSC_PROBE_API_KEY"); fi
COMMON=(--profile "$PROFILE" --extension "$EXTENSION" --no-extensions --no-skills --no-rules --no-title --max-time 90 "${API_KEY_ARGS[@]}")

record() {
	printf '\n=== %s ===\n' "$1" | tee -a "$LOG_FILE"
}

run_scenario() {
	local label="$1"
	shift
	record "$label"
	if "$@" >>"$LOG_FILE" 2>&1; then
		printf 'exit: 0\n' | tee -a "$LOG_FILE"
	else
		local status=$?
		printf 'exit: %s\n' "$status" | tee -a "$LOG_FILE"
		FAILURES=$((FAILURES + 1))
	fi
}

printf 'profile=%s\nmodel=%s\nalt_model=%s\nextension=%s\n' "$PROFILE" "$MODEL" "$ALT_MODEL" "$EXTENSION" >"$LOG_FILE"

SESSION_12="$SCRATCH/sessions-new-resume"
mkdir -p "$SESSION_12"
run_scenario "1. fresh headless session: turn one uses the switched model" \
	env LSC_PROBE_SCENARIO=fresh LSC_PROBE_TARGET="$MODEL" \
	omp "${COMMON[@]}" --session-dir "$SESSION_12" --model "$MODEL" --no-tools -p --mode=json "Reply with PROBE-FRESH only."

run_scenario "2. --continue resume: message entries gate the default off" \
	env LSC_PROBE_SCENARIO=resume LSC_PROBE_TARGET="$MODEL" \
	omp "${COMMON[@]}" --session-dir "$SESSION_12" --model "$MODEL" --no-tools --continue -p --mode=json "Reply with PROBE-RESUME only."

SESSION_TASK="$SCRATCH/sessions-subagent"
mkdir -p "$SESSION_TASK"
run_scenario "3. task subagent: session_init gates the child session off" \
	env LSC_PROBE_SCENARIO=subagent LSC_PROBE_TARGET="$MODEL" \
	omp "${COMMON[@]}" --session-dir "$SESSION_TASK" --model "$MODEL" --tools task --auto-approve -p --mode=json \
	"Use the task tool exactly once to ask the explore agent to reply SUBAGENT-PROBE, then reply DONE."

SESSION_NO_KEY="$SCRATCH/sessions-no-key"
mkdir -p "$SESSION_NO_KEY"
run_scenario "4. explicit effort pairs after setModel; direct unauthenticated Model returns false" \
	env LSC_PROBE_SCENARIO=no-key LSC_PROBE_TARGET="$BASE_MODEL:$MODEL_EFFORT" \
	omp "${COMMON[@]}" --session-dir "$SESSION_NO_KEY" --model "$MODEL" --no-tools -p --mode=json "Reply with PROBE-NO-KEY only."

SESSION_CYCLE="$SCRATCH/sessions-cycle"
mkdir -p "$SESSION_CYCLE"
record "5a. interactive model cycle with zero assistant turns"
if command -v expect >/dev/null 2>&1; then
	if env PROFILE="$PROFILE" EXTENSION="$EXTENSION" SESSION_CYCLE="$SESSION_CYCLE" MODEL="$MODEL" ALT_MODEL="$ALT_MODEL" \
		LSC_PROBE_SCENARIO=cycle LSC_PROBE_TARGET="$MODEL" expect <<'EXPECT' >>"$LOG_FILE" 2>&1
set timeout 20
spawn omp --profile $env(PROFILE) --extension $env(EXTENSION) --no-extensions --no-skills --no-rules --no-title --session-dir $env(SESSION_CYCLE) --model $env(MODEL) --models "$env(MODEL),$env(ALT_MODEL)"
after 5000
send "\020"
after 2500
catch {send "\003"}
after 1000
catch {send "\003"}
catch {expect eof}
EXPECT
	then
		printf 'exit: 0\n' | tee -a "$LOG_FILE"
	else
		status=$?
		printf 'exit: %s\n' "$status" | tee -a "$LOG_FILE"
		FAILURES=$((FAILURES + 1))
	fi
else
	printf 'SKIP: expect is required for the interactive Ctrl+P model-cycle scenario\n' | tee -a "$LOG_FILE"
	FAILURES=$((FAILURES + 1))
fi

run_scenario "5b. cycle-then-zero-turn --continue: duplicate model_change gates the default off" \
	env LSC_PROBE_SCENARIO=cycle LSC_PROBE_TARGET="$MODEL" \
	omp "${COMMON[@]}" --session-dir "$SESSION_CYCLE" --model "$MODEL" --no-tools --continue -p --mode=json "Reply with PROBE-CYCLE-RESUME only."

printf '\nProbe log: %s\n' "$LOG_FILE" | tee -a "$LOG_FILE"
if [ "$FAILURES" -ne 0 ]; then
	printf 'Probe completed with %s failed or skipped scenario(s). Inspect the retained log; credentials/model availability are the usual cause.\n' "$FAILURES" | tee -a "$LOG_FILE"
	exit 1
fi
printf 'Probe completed: all five scenarios exited successfully. Compare [lsc-session-default-probe] entries with the gate contract.\n' | tee -a "$LOG_FILE"
