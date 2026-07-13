# Verification Economics — model-preset-session-default

What was verified how, and why that depth was chosen.

| Claim area | Method | Cost | Why this depth |
|---|---|---|---|
| models-file.ts parse/merge/save behavior under new-field shapes (C9) | Controlled reproduction (TracerCodePath ran the actual parser against crafted YAML) | Minutes, zero risk | Tier-1 evidence was cheap and the schema decision is load-bearing |
| validatePreset phantom `lsc-default` collision (C10) | Code-path reproduction probe | Minutes | Decides whether reserved-key design needs a guard |
| pi.setModel existence/signature (C1, C8) | Pinned .d.ts read (node_modules) — the exact artifact the runtime loads | Minutes | Type declarations ARE the contract; no execution needed |
| Runtime internals: setModel body, modelRoles listener scope, resolution priority (C4, C5, C12) | Vendored 16.3.15 source read + W2 16.4.0 src re-verification | Two worker passes | Line-level behavior claims; skew risk between vendored and pinned made single-source read insufficient |
| setModel-at-session_start safety for turn 1 (C7) | Source ordering inference ONLY — NOT executed | — | Execution probe designed (TracerHostApi: 15-line probe extension + isolated `omp -e --mode=json` run) but deliberately DEFERRED: it spends real tokens/API credits and its outcome does not change the interview questions; it gates implementation, so it belongs in plan/craft verification, recorded as the trace's Recommended Discriminating Probe |
| Non-code ecosystem claims (N1-N5) | Multi-domain source triangulation + countersearch | Several worker passes | Verified-set rules (≥2 domains, ≥2 groups, countersearch, primary, current) |
| grep.app negative finding (no third-party task.agentModelOverrides usage) | npm registry + issue-search only (grep.app 429'd) | — | Accepted PARTIAL: claim is contextual color, not load-bearing for any design decision |
