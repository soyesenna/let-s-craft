// Fixture-mode answer scripting for the ask seam (ask.ts) — Principle 4 / Phase 3.5.
//
// Every user-facing question the pre-craft/craft/post-craft skills ask goes through
// lsc_ask/lsc_select/lsc_confirm. In normal mode those delegate to ctx.ui; in fixture
// mode (this module) they instead consume a scripted answers.json so the whole
// pipeline can run unattended for AC7's CI E2E — no ctx.ui interception is possible or
// needed, the tools just take a different branch.
//
// Detection priority (per the Phase 3.5 handoff): the `LSC_FIXTURE` env var is the
// primary signal (works for `omp -p`/`--mode=json`/CI headless runs without any flag
// wiring); a registered `--lsc-fixtures` CLI flag is a bonus alias for interactive
// invocations.
import { existsSync, readFileSync } from "node:fs";

export const LSC_FIXTURE_ENV = "LSC_FIXTURE";
export const LSC_FIXTURE_FLAG = "lsc-fixtures";

export interface FixtureAnswerRule {
	/** Substring or regex source tested against the question text (see matchesRule). */
	match: string;
	/** Scripted response returned in place of the user's answer. */
	response: string;
	/** When true, this rule is consumed after its first match and skipped afterward. */
	once?: boolean;
}

export interface FixtureAnswerFile {
	answers: FixtureAnswerRule[];
	/** Response used when no rule matches. Omitting this makes an unmatched question a hard error (no infinite wait). */
	default?: string;
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

/**
 * Pure matching core: find the first non-consumed rule matching `question`, in
 * declaration order. Throws when nothing matches and no `default` is configured —
 * a fixture run must never silently return an empty answer and let the skill hang or
 * mis-parse (deliberate fail-fast per the Phase 3.5 handoff).
 */
export function matchFixtureAnswer(
	file: FixtureAnswerFile,
	question: string,
	consumedOnce: ReadonlySet<number>,
): { response: string; consumeIndex?: number } {
	for (let i = 0; i < file.answers.length; i++) {
		const rule = file.answers[i];
		if (rule.once && consumedOnce.has(i)) continue;
		if (matchesRule(rule.match, question)) {
			return { response: rule.response, consumeIndex: rule.once ? i : undefined };
		}
	}
	if (file.default !== undefined) return { response: file.default };
	throw new Error(
		`lets-craft fixture: no answer rule matched question ${JSON.stringify(question)} and no "default" is configured in the ` +
			`fixture file — refusing to hang indefinitely. Add a matching rule or a "default" answer.`,
	);
}

/** Stateful wrapper around matchFixtureAnswer that tracks which `once` rules have fired, for the lifetime of one fixture run. */
export class FixtureAnswerSet {
	private readonly consumed = new Set<number>();

	constructor(private readonly file: FixtureAnswerFile) {}

	/** Resolve one question to its scripted response, consuming any matched `once` rule. */
	match(question: string): string {
		const { response, consumeIndex } = matchFixtureAnswer(this.file, question, this.consumed);
		if (consumeIndex !== undefined) this.consumed.add(consumeIndex);
		return response;
	}
}

function fail(path: string, detail: string): never {
	throw new Error(`lets-craft fixture: ${path} ${detail}`);
}

/** Parse + structurally validate a raw answers.json payload. Unknown top-level keys (e.g. a "_note" doc comment) are ignored. */
export function parseFixtureAnswerFile(raw: unknown, path: string): FixtureAnswerFile {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail(path, "must be a JSON object with an \"answers\" array.");
	const obj = raw as Record<string, unknown>;

	if (!Array.isArray(obj.answers)) fail(path, "must have an \"answers\" array.");
	const answers: FixtureAnswerRule[] = obj.answers.map((entry, i) => {
		if (typeof entry !== "object" || entry === null) fail(path, `answers[${i}] must be an object.`);
		const e = entry as Record<string, unknown>;
		if (typeof e.match !== "string") fail(path, `answers[${i}].match must be a string.`);
		if (typeof e.response !== "string") fail(path, `answers[${i}].response must be a string.`);
		if (e.once !== undefined && typeof e.once !== "boolean") fail(path, `answers[${i}].once must be a boolean when present.`);
		return { match: e.match, response: e.response, once: e.once as boolean | undefined };
	});

	if (obj.default !== undefined && typeof obj.default !== "string") fail(path, '"default" must be a string when present.');
	return { answers, default: obj.default as string | undefined };
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
