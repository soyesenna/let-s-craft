# Wave 3 — Expansion wave 2 (final)

2 workers, both reported. Reports: `agent://W3SessionResume`, `agent://W3Contamination`.

## Key results

### W3SessionResume (pinned 16.4.0 contract closure)
- **Q1 fresh-vs-resume**: `SessionStartEvent` payload is EMPTY (shared-events.ts:27-30). NO resume/isResume flag anywhere. session_start fires once per process boot (interactive/rpc/print/acp) + once per subagent task executor — NOT on /new, switch, or branch (dedicated session_switch/session_branch/session_tree events exist; /new has no session event). Only discriminator: `ctx.sessionManager.getEntries().length` (0 = fresh; >0 = resumed) — fragile under subagent spawn/compaction; exact semantics per emit site = implementation-time probe.
- **Q2 resolveAgentModelPatterns (16.4.0, model-resolver.ts:1006-1028)**: settingsOverride (task.agentModelOverrides) is EXCLUSIVE — immediate return, no fallthrough even on downstream resolution failure. Chain: settingsOverride → frontmatter agentModel (unless session-inherited sentinel) → activeModelPattern (parent LIVE) → fallbackModelPattern → modelRoles.default (FINAL fallback).
- **Q3 override-masking (settings.ts:383-408, 1366-1372)**: layer order global→project→configOverlay→overrides; override() masks any later set() until clearOverride; override() never calls #queueSave. setModelRole is override-aware (updates override layer when masked). lets-craft's session-lifetime override behavior confirmed by design.
- **Q4 omp profiles**: NOT a settings concept — pi-utils directory-resolution (`--profile`/`OMP_PROFILE` → separate ~/.omp root incl. own config.yml/modelRoles). Process-global at launch, not session-scoped, not mid-session switchable. **Build-vs-reuse settled: profiles cannot host preset persistence; runtime override + pi.setModel remains the correct primitive.** (docs/config-usage.md absent from the pinned package; code grep was exhaustive — settings.ts has zero 'profile' matches.)

### W3Contamination (prior-art closure)
- **pi-subagents #266**: last-writer-wins contamination — child processes read the shared global settings default that any concurrent session's TUI switch rewrites. Fix (0.29.0): pin the parent's IN-MEMORY model as an explicit arg; never consult the ambient global after the session exists. Lesson for lets-craft's global `active:` pointer: session-local preset effect must not be re-derived from the global pointer on resume paths; global writes only as explicit user action.
- **PR #4689 NOT merged** (modelRoles.compaction absent from all releases). Cache policy from #4520 thread: auto model reroutes must not convert warm cacheRead traffic into cold full-price prefill on metered wires; explicit user config bypasses the gate ("explicit = informed consent"). Session_start apply is cache-safe (nothing cached yet).
- **Upstream #3273 / PR #3272 (merged)**: preset restore-on-clear bug — snapshot must be taken ONLY at the no-preset→preset boundary; restore must cover EVERY mutated axis (model+thinking+tools); in-memory snapshot dies with the process (clear-after-resume misbehaves — residual gap upstream never fixed). Upstream's chosen semantics: clear restores PRE-preset state, discarding manual tweaks made while active — a design decision to surface, not silently inherit.

## EXPAND triage → CONVERGENCE

Adopted: none — every remaining lead is either a design decision owned by spec/plan (re-apply gating policy, clearOverride-vs-hold, precedence of preset default vs frontmatter, restore semantics), an implementation-time probe (entry-count semantics per emit site; pi.setModel-at-session_start execution probe already specified in trace.md), or supplementary color (#209, #339, #5326, #5290, #5317, #1379, #3217 — watch items, not decision-gating).

## Convergence declaration

- Expansion waves run: 2 (waves 2, 3) ✓ (saturation wave 1 excluded per protocol)
- Unconfirmed load-bearing leads remaining: 0 ✓ (all tails reclassified as design decisions / probes / watch items, logged above and in claim-graph.md)
- **CONVERGED after 3 waves total.**
