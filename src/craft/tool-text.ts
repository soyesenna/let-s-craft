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
 * audit-2 RF-23 / audit-3 RF-34 — the ONE total escaped serializer for echoing an untrusted
 * value inside model-facing text: JSON.stringify's own escaping PLUS every text-reshaping
 * character JSON leaves raw — DEL (U+007F), C1 (U+0080–U+009F), and the Unicode line/paragraph
 * separators (U+2028/U+2029). JSON only mandates escapes for U+0000–U+001F, so a forged field
 * carrying any of these still reshapes command-shaped text through bare JSON.stringify (the
 * RF-23 regression's live DEL leak, extended to the C1/separator axes by RF-34). Total
 * function: the throw JSON.stringify itself can produce (circular structure, BigInt) and its
 * undefined return (undefined, symbol, function) both land on constant fallbacks, so NO input
 * can make a diagnostic throw. Every diagnostic that names an untrusted value echoes through
 * THIS, never bare JSON.stringify/String — this module's own contract, enforced by the
 * RF-30/RF-34 regressions.
 */
const RAW_TEXT_RESHAPE_RE = /[\u007f\u0080-\u009f\u2028\u2029]/g;

export function controlSafeEcho(value: unknown): string {
	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(value);
	} catch {
		return "<unserializable value>";
	}
	if (serialized === undefined) return "undefined";
	return serialized.replace(RAW_TEXT_RESHAPE_RE, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
