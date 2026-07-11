// The single seam pipeline skills (pre-craft/craft/post-craft) use for every
// user-facing question (Principle 4, §2.1 of the plan): lsc_ask (free text),
// lsc_select (multiple choice), lsc_confirm (yes/no). Normal mode delegates to
// ctx.ui.input/select/confirm; fixture mode (fixtures.ts, LSC_FIXTURE) returns a
// scripted response instead, so AC7's full pipeline can run unattended in CI. A
// headless session (print/RPC, ctx.hasUI === false) with no fixture configured is a
// hard error — there is no way to ask a question, and silently guessing would defeat
// the whole point of an interactive seam.
//
// Split into pure `performX` core functions (channel + a minimal ui-method-subset in,
// AgentToolResult out) plus a thin `registerAskTools(pi)` wrapper, matching the
// hash-manifest.ts/run-tests.ts pattern: vitest on Node cannot import omp SDK values
// (Phase 1.5 finding), so the testable logic never touches `pi.zod`/`pi.registerTool`
// directly — only the wrapper does, and it is exercised by the real omp runtime
// instead of vitest.
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { detectFixturePath, type FixtureAnswerSet, getFixtureAnswerSet } from "./fixtures.js";

const HEADLESS_ERROR =
	"lets-craft: interactive UI is not available (headless print/RPC mode) and no fixture is configured — set " +
	"LSC_FIXTURE=<answers.json path> (or the --lsc-fixtures flag) to run this pipeline unattended.";

export type AskChannel = { kind: "fixture"; answers: FixtureAnswerSet } | { kind: "ui" } | { kind: "unavailable" };

/** Decide fixture vs. ctx.ui vs. hard-fail, given a possibly-detected fixture path and whether interactive UI is available. */
export function resolveAskChannel(fixturePath: string | undefined, hasUI: boolean): AskChannel {
	if (fixturePath) return { kind: "fixture", answers: getFixtureAnswerSet(fixturePath) };
	if (!hasUI) return { kind: "unavailable" };
	return { kind: "ui" };
}

function fixtureErrorResult<T>(error: unknown): AgentToolResult<T> {
	return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
}

// ============================================================================
// lsc_ask — free-text question
// ============================================================================

export interface AskResultDetails {
	question: string;
	response: string;
	source: "fixture" | "ui";
}

export interface AskUI {
	input(title: string, placeholder?: string): Promise<string | undefined>;
}

export async function performAsk(
	channel: AskChannel,
	ui: AskUI,
	params: { question: string; placeholder?: string },
): Promise<AgentToolResult<AskResultDetails>> {
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	if (channel.kind === "fixture") {
		let response: string;
		try {
			response = channel.answers.match(params.question).response;
		} catch (error) {
			return fixtureErrorResult(error);
		}
		return { content: [{ type: "text", text: response }], details: { question: params.question, response, source: "fixture" } };
	}

	const response = await ui.input(params.question, params.placeholder);
	if (response === undefined) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_ask prompt." }] };
	}
	return { content: [{ type: "text", text: response }], details: { question: params.question, response, source: "ui" } };
}

// ============================================================================
// lsc_select — multiple choice
// ============================================================================

export interface SelectResultDetails {
	question: string;
	response: string;
	source: "fixture" | "ui";
}

export interface SelectUI {
	select(title: string, options: string[]): Promise<string | undefined>;
}

/** Escape a string for literal use inside a RegExp source. */
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True iff `needle` appears in `haystack` as a whole-word/whole-phrase match (bounded by non-word characters or string edges), case-insensitive. Deliberately stricter than a raw substring check — see resolveSelectOption's tier 3 for why. */
function containsAsWord(haystack: string, needle: string): boolean {
	if (needle.length === 0) return false;
	return new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i").test(haystack);
}

/**
 * Multi-tier fixture-mode option resolution for `lsc_select`, exported for direct unit testing.
 * Interview-stage questions are LLM-generated and choose `lsc_select` vs `lsc_ask` on their own
 * judgment (pre-craft's SKILL.md: "lsc_select ... preferred when the answer space is
 * enumerable") — a fixture answer authored as a free-text dimension answer (`[Goal]`,
 * `[Constraints]`, ...) can land against a select whose option labels are the model's own short
 * paraphrase, which a strict equality check can never match. Tiers, in order, first hit wins:
 *
 *   1. Exact match.
 *   2. Case-insensitive exact match.
 *   3. Unique whole-word/whole-phrase containment (either direction) — only when exactly one
 *      offered option qualifies; an ambiguous (2+) match is treated as no match rather than
 *      guessing, since a wrong pick here silently steers the interview down the wrong branch.
 *      Whole-word bounded (not a raw substring check) on purpose: a long free-text answer like
 *      "...non-alphanumeric separators..." contains "no" as a raw substring, which would
 *      false-positive against a plain ["yes","no"] option pair if checked naively.
 *   4. `optionIndex`, if the rule set one and it is a valid index into `options` — a fixture
 *      author's explicit escape hatch when no text-based tier can be trusted to be unique.
 *
 * Returns undefined (not an error) when nothing resolves — the caller decides how to report that.
 */
export function resolveSelectOption(scripted: { response: string; optionIndex?: number }, options: string[]): string | undefined {
	const { response, optionIndex } = scripted;
	if (options.includes(response)) return response;

	const lowerResponse = response.toLowerCase();
	const caseInsensitive = options.find(o => o.toLowerCase() === lowerResponse);
	if (caseInsensitive !== undefined) return caseInsensitive;

	const containment = options.filter(o => o.length > 0 && (containsAsWord(response, o) || containsAsWord(o, response)));
	if (containment.length === 1) return containment[0];

	if (optionIndex !== undefined && optionIndex >= 0 && optionIndex < options.length) return options[optionIndex];

	return undefined;
}

export async function performSelect(
	channel: AskChannel,
	ui: SelectUI,
	params: { question: string; options: string[] },
): Promise<AgentToolResult<SelectResultDetails>> {
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	if (channel.kind === "fixture") {
		let scripted: { response: string; optionIndex?: number };
		try {
			scripted = channel.answers.match(params.question);
		} catch (error) {
			return fixtureErrorResult(error);
		}
		const resolved = resolveSelectOption(scripted, params.options);
		if (resolved === undefined) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text:
							`lets-craft fixture: scripted response ${JSON.stringify(scripted.response)} for question ${JSON.stringify(params.question)} ` +
							"does not match any offered option via exact/case-insensitive/whole-word-containment matching, and no (valid) " +
							`"optionIndex" was set (options: ${params.options.join(", ")}). Fix the fixture's response text to match an option ` +
							'label, or add an "optionIndex" to that rule.',
					},
				],
			};
		}
		return { content: [{ type: "text", text: resolved }], details: { question: params.question, response: resolved, source: "fixture" } };
	}

	const response = await ui.select(params.question, params.options);
	if (response === undefined) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_select prompt." }] };
	}
	return { content: [{ type: "text", text: response }], details: { question: params.question, response, source: "ui" } };
}

// ============================================================================
// lsc_confirm — yes/no
// ============================================================================

export interface ConfirmResultDetails {
	question: string;
	confirmed: boolean;
	source: "fixture" | "ui";
}

export interface ConfirmUI {
	confirm(title: string, message: string): Promise<boolean>;
}

/** Parse a fixture's scripted yes/no answer. Undefined means the text isn't recognizable as either. */
export function parseYesNo(text: string): boolean | undefined {
	const normalized = text.trim().toLowerCase();
	if (normalized === "yes" || normalized === "y" || normalized === "true") return true;
	if (normalized === "no" || normalized === "n" || normalized === "false") return false;
	return undefined;
}

export async function performConfirm(
	channel: AskChannel,
	ui: ConfirmUI,
	params: { question: string },
): Promise<AgentToolResult<ConfirmResultDetails>> {
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	if (channel.kind === "fixture") {
		let response: string;
		try {
			response = channel.answers.match(params.question).response;
		} catch (error) {
			return fixtureErrorResult(error);
		}
		const confirmed = parseYesNo(response);
		if (confirmed === undefined) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `lets-craft fixture: scripted response ${JSON.stringify(response)} for question ${JSON.stringify(params.question)} is not a recognizable yes/no answer.`,
					},
				],
			};
		}
		return { content: [{ type: "text", text: confirmed ? "yes" : "no" }], details: { question: params.question, confirmed, source: "fixture" } };
	}

	const confirmed = await ui.confirm("lets-craft", params.question);
	return { content: [{ type: "text", text: confirmed ? "yes" : "no" }], details: { question: params.question, confirmed, source: "ui" } };
}

// ============================================================================
// Registration
// ============================================================================

function channelFor(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "hasUI">): AskChannel {
	// Wrapped in a closure, not passed as a bare `pi.getFlag` reference: the SDK's
	// real getFlag relies on internal `this` state, and detaching it from `pi` throws
	// ("this.extension" is undefined) instead of returning undefined — verified via a
	// live headless `omp -p` smoke test.
	return resolveAskChannel(detectFixturePath(name => pi.getFlag(name)), ctx.hasUI);
}

/** Register lsc_ask, lsc_select, lsc_confirm. */
export function registerAskTools(pi: ExtensionAPI): void {
	const z = pi.zod;

	// Explicit type arguments (`typeof parameters`, not left to inference) avoid TS2589
	// "excessively deep" instantiation against this SDK's TSchema union — see
	// hash-manifest.ts. Every registerTool call in this plugin follows this pattern.
	const askParameters = z.object({
		question: z.string().describe("The question to ask the user."),
		placeholder: z.string().optional().describe("Optional placeholder text shown in the input box."),
	});
	pi.registerTool<typeof askParameters, AskResultDetails>({
		name: "lsc_ask",
		label: "lets-craft: ask (free text)",
		description:
			"Ask the user a free-text question. The single seam pipeline skills (pre-craft/craft/post-craft) use for every " +
			"user-facing question — normal mode shows an interactive input box (ctx.ui.input); fixture mode (LSC_FIXTURE) " +
			"returns a scripted response so the whole pipeline can run unattended. Fails with a clear error in headless " +
			"mode without a fixture configured.",
		approval: "read",
		parameters: askParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AskResultDetails>> {
			return performAsk(channelFor(pi, ctx), ctx.ui, params);
		},
	});

	const selectParameters = z.object({
		question: z.string().describe("The question to ask the user."),
		options: z.array(z.string()).min(2).describe("Option labels to present. The response (fixture or user) will be exactly one of these."),
	});
	pi.registerTool<typeof selectParameters, SelectResultDetails>({
		name: "lsc_select",
		label: "lets-craft: ask (select)",
		description:
			"Ask the user to choose one of several options. Normal mode shows an interactive selector (ctx.ui.select); " +
			"fixture mode (LSC_FIXTURE) returns a scripted response, which must match one of the given option labels " +
			"exactly (a mismatch is a hard error, not a silent guess).",
		approval: "read",
		parameters: selectParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<SelectResultDetails>> {
			return performSelect(channelFor(pi, ctx), ctx.ui, params);
		},
	});

	const confirmParameters = z.object({
		question: z.string().describe("The yes/no question to ask the user."),
	});
	pi.registerTool<typeof confirmParameters, ConfirmResultDetails>({
		name: "lsc_confirm",
		label: "lets-craft: ask (confirm)",
		description:
			"Ask the user a yes/no question. Normal mode shows an interactive confirmation dialog (ctx.ui.confirm); " +
			'fixture mode (LSC_FIXTURE) parses a scripted "yes"/"no" response (also accepts y/n/true/false).',
		approval: "read",
		parameters: confirmParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ConfirmResultDetails>> {
			return performConfirm(channelFor(pi, ctx), ctx.ui, params);
		},
	});
}
