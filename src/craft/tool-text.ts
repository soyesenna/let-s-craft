// audit-1 RF-20(a) — the shared control-char-free validator for free-text tool parameters.
//
// `base_branch` / `escalation_disposition` (lsc_audit_begin) and `reason` (lsc_craft_abort) are
// free-text strings the model supplies. They reach result text, the persisted craft state, and
// git argv verbatim — a raw control character (newline, tab, ESC, DEL) can reshape
// command-shaped output and forge multi-line tool prose. This module is the ONE definition (the
// FEATURE_SLUG_RE SSOT precedent, src/artifacts/paths.ts): every consumer imports it here
// instead of growing a per-file regex.
//
// Pure module: no fs, no env — importable anywhere, unit-testable under vitest-on-Node.

/** C0 control characters (U+0000–U+001F) plus DEL (U+007F) — the characters that reshape command-shaped text. */
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

/** True iff `value` carries no control characters (C0 + DEL) — the minimum every free-text tool parameter must pass before any effect, observation, or result text. */
export function isControlFreeText(value: string): boolean {
	return !CONTROL_CHARS_RE.test(value);
}

/**
 * The shared refusal text for a control-carrying parameter: names the FIELD only, never the raw
 * payload (the same no-raw-echo rule as audit-1 RF-20(b)), and is returned by the caller BEFORE
 * any effect or observation. Undefined when every given field is control-free (absent fields
 * included).
 */
export function controlCharRefusalText(fields: Record<string, string | undefined>): string | undefined {
	for (const [field, value] of Object.entries(fields)) {
		if (value !== undefined && !isControlFreeText(value)) {
			return `lets-craft: ${field} must be free of control characters (C0/DEL) — refused before any effect or observation. Re-call with a plain single-line value (audit-1 RF-20).`;
		}
	}
	return undefined;
}

/**
 * audit-2 RF-23 — the safe echo of an untrusted value inside a diagnostic: JSON.stringify's own
 * escaping PLUS the one control character it leaves raw — DEL (U+007F). JSON only mandates
 * escapes for U+0000-U+001F, so a DEL-carrying forged field echoed through bare JSON.stringify
 * still reshapes command-shaped text (proven live by the RF-23 regression: a DEL-carrying
 * nextDueCycle leaked the raw control character into the refusal line). Every diagnostic that
 * names an untrusted persisted field echoes through THIS, never bare JSON.stringify/String.
 */
export function controlSafeEcho(value: unknown): string {
	const serialized = JSON.stringify(value);
	return serialized === undefined ? "undefined" : serialized.replace(/\u007f/g, "\\u007f");
}
