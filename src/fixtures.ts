// Fixture-mode answer scripting for the ask seam (ask.ts) — Principle 4 / Phase 3.5.
//
// Every user-facing question the pre-craft/craft/post-craft skills ask goes through
// lsc_ask/lsc_select/lsc_confirm. In normal mode those delegate to ctx.ui; in fixture
// mode (this module) they instead consume a scripted answers.json so the whole
// pipeline can run unattended for AC7's CI E2E — no ctx.ui interception is possible or
// needed, the tools just take a different branch.
//
// v2 schema (clean cut, no v1 back-compat): each rule/default carries a response-semantic
// tagged body (`kind`), so contradictory gate states (approve + a dissenting free answer in
// one body) are impossible at parse time rather than resolved by a silent field-priority rule.
//
// Detection priority (per the Phase 3.5 handoff): the `LSC_FIXTURE` env var is the
// primary signal (works for `omp -p`/`--mode=json`/CI headless runs without any flag
// wiring); a registered `--lsc-fixtures` CLI flag is a bonus alias for interactive
// invocations.
import { existsSync, readFileSync } from "node:fs";

export const LSC_FIXTURE_ENV = "LSC_FIXTURE";
export const LSC_FIXTURE_FLAG = "lsc-fixtures";

/**
 * A response-semantic answer body. Shared by all three ask tools, but only `free-text`
 * is tool-agnostic — interview-stage questions choose lsc_select vs lsc_ask on the model's
 * own judgment, so a free-text answer must be consumable by whichever tool the question
 * actually became. The other kinds are consumed only by the tool that matches their meaning
 * (selection/selection-index → lsc_select, confirmation → lsc_confirm); a mismatch is a
 * loud parse/consume error, never a silent reinterpretation.
 */
export type FixtureAnswerBody =
	| { kind: "free-text"; freeText: string }
	| { kind: "selection"; selections: string[]; freeText?: string }
	| { kind: "selection-index"; optionIndex: number }
	| { kind: "confirmation"; confirm: boolean };

/** A matching rule: a `match` pattern (+ optional one-shot `once`) plus its response body. */
export type FixtureAnswerRule = { match: string; once?: boolean } & FixtureAnswerBody;

export interface FixtureAnswerFile {
	version: 2;
	answers: FixtureAnswerRule[];
	/** Body used when no rule matches. Omitting it makes an unmatched question a hard error (no infinite wait). A free-text default is rejected: it would trap every destructive gate in a re-ask loop. */
	default?: FixtureAnswerBody;
}

/** What matching a question against the fixture resolves to: the full response body. */
export type FixtureMatch = FixtureAnswerBody;

/**
 * Normalize free-text line breaks to a canonical `\n`. This is the single owner of the
 * mandatory-break domain (ask.ts imports it). Every UAX #14 mandatory-break code point
 * (Line_Break ∈ BK∪CR∪LF∪NL) folds to one LF: LF, VT (U+000B), FF (U+000C), CR (U+000D),
 * NEL (U+0085), LS (U+2028), PS (U+2029). CRLF is folded to a single LF first so a `\r\n`
 * pair yields one break, then the remaining bare breaks each become one LF. Idempotent:
 * canonicalizeFreeText(canonicalizeFreeText(x)) === canonicalizeFreeText(x).
 */
export function canonicalizeFreeText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/[\r\u000B\u000C\u0085\u2028\u2029]/g, "\n");
}

/**
 * Test a rule's `match` against a question. Tried as a case-insensitive regex first
 * (so wildcard patterns like `"feature.?name"` work); falls back to a plain
 * case-insensitive substring check when the pattern isn't valid regex syntax. Plain
 * literal text behaves identically under both interpretations, so a single field can
 * serve as "substring or regex" (per the answers.json schema) without the author
 * having to declare which one they mean. Case-insensitive because the pipeline's
 * actual question wording (interview/plan/audit prompts) is LLM-generated and its
 * exact capitalization is not something a hand-written fixture should have to predict.
 */
export function matchesRule(pattern: string, question: string): boolean {
	try {
		return new RegExp(pattern, "i").test(question);
	} catch {
		return question.toLowerCase().includes(pattern.toLowerCase());
	}
}

/** Extract the pure response body (kind + variant fields) from a rule, dropping match/once. */
function bodyOf(rule: FixtureAnswerRule): FixtureAnswerBody {
	switch (rule.kind) {
		case "free-text":
			return { kind: "free-text", freeText: rule.freeText };
		case "selection":
			return rule.freeText !== undefined
				? { kind: "selection", selections: rule.selections, freeText: rule.freeText }
				: { kind: "selection", selections: rule.selections };
		case "selection-index":
			return { kind: "selection-index", optionIndex: rule.optionIndex };
		case "confirmation":
			return { kind: "confirmation", confirm: rule.confirm };
	}
}

/**
 * Pure matching core: find the first non-consumed rule matching `question`, in
 * declaration order. Throws when nothing matches and no `default` is configured —
 * a fixture run must never silently return an empty answer and let the skill hang or
 * mis-parse (deliberate fail-fast per the Phase 3.5 handoff). The returned body carries
 * a `consumeIndex` hint when a `once` rule fired, which FixtureAnswerSet strips.
 */
export function matchFixtureAnswer(
	file: FixtureAnswerFile,
	question: string,
	consumedOnce: ReadonlySet<number>,
): FixtureAnswerBody & { consumeIndex?: number } {
	for (let i = 0; i < file.answers.length; i++) {
		const rule = file.answers[i];
		if (rule.once && consumedOnce.has(i)) continue;
		if (matchesRule(rule.match, question)) {
			return rule.once ? { ...bodyOf(rule), consumeIndex: i } : bodyOf(rule);
		}
	}
	if (file.default !== undefined) return file.default;
	throw new Error(
		`lets-craft fixture: no answer rule matched question ${JSON.stringify(question)} and no "default" is configured in the ` +
			`fixture file — refusing to hang indefinitely. Add a matching rule or a "default" answer.`,
	);
}

/** Stateful wrapper around matchFixtureAnswer that tracks which `once` rules have fired, for the lifetime of one fixture run. */
export class FixtureAnswerSet {
	private readonly consumed = new Set<number>();

	constructor(private readonly file: FixtureAnswerFile) {}

	/** Resolve one question to its scripted response body, consuming any matched `once` rule. */
	match(question: string): FixtureAnswerBody {
		const result = matchFixtureAnswer(this.file, question, this.consumed);
		if (result.consumeIndex !== undefined) this.consumed.add(result.consumeIndex);
		const body: Record<string, unknown> = { ...result };
		delete body.consumeIndex;
		return body as unknown as FixtureAnswerBody;
	}
}

function fail(path: string, detail: string): never {
	throw new Error(`lets-craft fixture: ${path} ${detail}`);
}

const ALLOWED_KINDS = ["free-text", "selection", "selection-index", "confirmation"] as const;
const ALLOWED_KIND_LIST = "free-text, selection, selection-index, confirmation";
const V1_KIND_GUIDANCE =
	"kind: 'selection' (pick options) / 'free-text' (free answer) / 'confirmation' (yes/no) / 'selection-index' (positional)";
const V1_MIGRATION_MESSAGE =
	`v1 format detected: 'response' was replaced in v2 by kind-tagged bodies — ${V1_KIND_GUIDANCE}. ` +
	'Set "version": 2 and migrate each rule — see the README \'LSC_FIXTURE\' section.';

/** Variant (kind-specific) keys allowed for each body kind. */
const VARIANT_KEYS: Record<(typeof ALLOWED_KINDS)[number], string[]> = {
	"free-text": ["freeText"],
	selection: ["selections", "freeText"],
	"selection-index": ["optionIndex"],
	confirmation: ["confirm"],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject any key on a body object that is not part of its kind's exact allowlist. */
function checkAllowedKeys(
	e: Record<string, unknown>,
	kind: (typeof ALLOWED_KINDS)[number],
	path: string,
	pathPrefix: string,
	isDefault: boolean,
): void {
	const allowed = ["kind", ...VARIANT_KEYS[kind], ...(isDefault ? [] : ["match", "once"])];
	const allowedList = allowed.join(", ");
	for (const key of Object.keys(e)) {
		if (allowed.includes(key)) continue;
		if (key === "response") {
			fail(
				path,
				`${pathPrefix} has an unexpected key "response" — 'response' was replaced in v2 by kind-tagged bodies (${V1_KIND_GUIDANCE}); ` +
					`this ${kind} rule must use its own kind fields instead. See the README 'LSC_FIXTURE' migration note.`,
			);
		}
		if (isDefault) {
			fail(
				path,
				`${pathPrefix} has an unexpected key ${JSON.stringify(key)} for a ${kind} body — a default may only contain body fields (allowed keys: ${allowedList}).`,
			);
		}
		fail(path, `${pathPrefix} has an unexpected key ${JSON.stringify(key)} for a ${kind} rule — allowed keys: ${allowedList}.`);
	}
}

/** Validate + canonicalize a free-text value; reject when blank after canonicalize-then-trim. */
function parseFreeText(value: unknown, path: string, pathPrefix: string): string {
	if (typeof value !== "string") fail(path, `${pathPrefix}.freeText must be a string.`);
	const canonical = canonicalizeFreeText(value);
	if (canonical.trim() === "") {
		fail(path, `${pathPrefix}.freeText must not be blank (it is empty after canonicalizing line breaks and trimming whitespace).`);
	}
	return canonical;
}

/** Parse + validate one response body (a rule body when isDefault=false, else a default body). */
function parseBody(e: Record<string, unknown>, path: string, pathPrefix: string, isDefault: boolean): FixtureAnswerBody {
	const kind = e.kind;
	if (typeof kind !== "string" || !(ALLOWED_KINDS as readonly string[]).includes(kind)) {
		if (kind === undefined) fail(path, `${pathPrefix}.kind is required — it must be one of: ${ALLOWED_KIND_LIST}.`);
		fail(path, `${pathPrefix}.kind must be one of: ${ALLOWED_KIND_LIST} (got ${JSON.stringify(kind)}).`);
	}
	const k = kind as (typeof ALLOWED_KINDS)[number];

	if (isDefault && k === "free-text") {
		fail(
			path,
			`${pathPrefix} must not use kind "free-text" — a free-text default would trap every unmatched question in a re-ask loop; use an explicit match rule with once:true instead.`,
		);
	}

	switch (k) {
		case "free-text": {
			const freeText = parseFreeText(e.freeText, path, pathPrefix);
			checkAllowedKeys(e, k, path, pathPrefix, isDefault);
			return { kind: "free-text", freeText };
		}
		case "selection": {
			if (!Array.isArray(e.selections) || e.selections.length === 0) {
				fail(path, `${pathPrefix}.selections must be a non-empty array of strings.`);
			}
			(e.selections as unknown[]).forEach((member, j) => {
				if (typeof member !== "string") fail(path, `${pathPrefix}.selections[${j}] must be a string.`);
			});
			let freeText: string | undefined;
			if (e.freeText !== undefined) freeText = parseFreeText(e.freeText, path, pathPrefix);
			checkAllowedKeys(e, k, path, pathPrefix, isDefault);
			const selections = [...(e.selections as string[])];
			return freeText !== undefined ? { kind: "selection", selections, freeText } : { kind: "selection", selections };
		}
		case "selection-index": {
			if (typeof e.optionIndex !== "number" || !Number.isInteger(e.optionIndex) || e.optionIndex < 0) {
				fail(path, `${pathPrefix}.optionIndex must be a non-negative integer.`);
			}
			checkAllowedKeys(e, k, path, pathPrefix, isDefault);
			return { kind: "selection-index", optionIndex: e.optionIndex as number };
		}
		case "confirmation": {
			if (typeof e.confirm !== "boolean") fail(path, `${pathPrefix}.confirm must be a boolean.`);
			checkAllowedKeys(e, k, path, pathPrefix, isDefault);
			return { kind: "confirmation", confirm: e.confirm as boolean };
		}
	}
}

/** Parse + structurally validate a raw answers.json payload (v2 only). */
export function parseFixtureAnswerFile(raw: unknown, path: string): FixtureAnswerFile {
	if (!isPlainObject(raw)) fail(path, 'must be a JSON object with a "version" of 2 and an "answers" array.');
	const obj = raw;

	if (obj.version !== 2) {
		const hasStringResponse =
			Array.isArray(obj.answers) && obj.answers.some(e => isPlainObject(e) && typeof (e as Record<string, unknown>).response === "string");
		const hasStringDefault = typeof obj.default === "string";
		if (hasStringResponse || hasStringDefault) fail(path, V1_MIGRATION_MESSAGE);
		fail(path, `"version" must be 2 (got ${JSON.stringify(obj.version)}).`);
	}

	for (const key of Object.keys(obj)) {
		if (key === "version" || key === "answers" || key === "default" || key.startsWith("_")) continue;
		fail(
			path,
			`unknown top-level key ${JSON.stringify(key)} — allowed top-level keys are "version", "answers", and "default" (plus any "_"-prefixed metadata key).`,
		);
	}

	if (!Array.isArray(obj.answers)) fail(path, 'must have an "answers" array.');
	const answers: FixtureAnswerRule[] = obj.answers.map((entry, i) => {
		if (!isPlainObject(entry)) fail(path, `answers[${i}] must be an object.`);
		const e = entry;
		if (typeof e.match !== "string") fail(path, `answers[${i}].match must be a string.`);
		if (e.once !== undefined && typeof e.once !== "boolean") fail(path, `answers[${i}].once must be a boolean when present.`);
		const body = parseBody(e, path, `answers[${i}]`, false);
		const rule: FixtureAnswerRule = { match: e.match, ...body };
		if (e.once !== undefined) rule.once = e.once;
		return rule;
	});

	let defaultBody: FixtureAnswerBody | undefined;
	if (obj.default !== undefined) {
		if (!isPlainObject(obj.default)) fail(path, '"default" must be a body object with a "kind" (a bare string default is the v1 format).');
		defaultBody = parseBody(obj.default, path, "default", true);
	}

	return { version: 2, answers, default: defaultBody };
}

/** Load and validate an answers.json file from disk. */
export function loadFixtureAnswerFile(path: string): FixtureAnswerFile {
	if (!existsSync(path)) fail(path, "does not exist.");
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(path, `is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
	}
	return parseFixtureAnswerFile(raw, path);
}

/**
 * Detect fixture mode: `LSC_FIXTURE=<path>` env var first, then the `--lsc-fixtures`
 * CLI flag (registered in main.ts) as a bonus alias. Returns undefined when neither is
 * set, meaning the ask seam should fall back to normal ctx.ui behavior.
 */
export function detectFixturePath(getFlag: (name: string) => boolean | string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const envPath = env[LSC_FIXTURE_ENV];
	if (envPath && envPath.length > 0) return envPath;
	const flag = getFlag(LSC_FIXTURE_FLAG);
	return typeof flag === "string" && flag.length > 0 ? flag : undefined;
}

let cache: { path: string; set: FixtureAnswerSet } | undefined;

/** Load (and cache, keyed by path) the FixtureAnswerSet for a fixture run. `once` consumption state persists across calls for the same path. */
export function getFixtureAnswerSet(path: string): FixtureAnswerSet {
	if (!cache || cache.path !== path) cache = { path, set: new FixtureAnswerSet(loadFixtureAnswerFile(path)) };
	return cache.set;
}

/** Test-only: drop the cached fixture set so the next getFixtureAnswerSet call reloads from disk. */
export function resetFixtureCache(): void {
	cache = undefined;
}
