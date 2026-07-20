// The single seam pipeline skills (pre-craft/craft/post-craft) use for every
// user-facing question (Principle 4, §2.1 of the plan): lsc_ask (free text),
// lsc_select (multiple choice), lsc_confirm (yes/no). Normal mode delegates to
// ctx.ui.editor/select; fixture mode (fixtures.ts, LSC_FIXTURE) returns a scripted
// response instead, so AC7's full pipeline can run unattended in CI. A headless
// session (print/RPC, ctx.hasUI === false) with no fixture configured is a hard error —
// there is no way to ask a question, and silently guessing would defeat the whole point
// of an interactive seam.
//
// v2 contract: every question always exposes a free-text answer channel (an "Other" row
// that chains to ctx.ui.editor); select options are { label, description } (2-4, description
// required, display-only); and each answer comes back on two layers — (i) the model-facing
// CONTENT envelope, the only channel providers forward to the model (a lone `yes`/`no` for
// confirm booleans, one `User selected: <label>` line per selection, and/or a
// `User provided free answer:` block), and (ii) a structured `details` object for tests/UI/events.
//
// Split into pure `performX` core functions (channel + a minimal ui-method-subset in,
// AgentToolResult out) plus a thin `registerAskTools(pi)` wrapper, matching the
// hash-manifest.ts/run-tests.ts pattern: vitest on Node cannot import omp SDK values
// (Phase 1.5 finding), so the testable logic never touches `pi.zod`/`pi.registerTool`
// directly — only the wrapper does, and it is exercised by the real omp runtime instead.
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { canonicalizeFreeText, detectFixturePath, type FixtureAnswerBody, type FixtureAnswerSet, getFixtureAnswerSet } from "./fixtures.js";
import { createPendingApproval, installPendingApproval, invalidatePendingApproval, invalidatePreparedOperation, matchDestructiveGateTag, peekPreparedOperation, sameCraftIdentity } from "./craft/destructive-approval.js";
import { getActiveCraft, recordReleaseApproval, recordReleaseApprovalAt } from "./craft/state.js";

const HEADLESS_ERROR =
	"lets-craft: interactive UI is not available (headless print/RPC mode) and no fixture is configured — set " +
	"LSC_FIXTURE=<answers.json path> (or the --lsc-fixtures flag) to run this pipeline unattended.";

// Envelope + control-row constants. The two control-row labels (OTHER/DONE) are appended by
// the tool and never participate in fixture matching (fixtures route by `kind`); the two
// envelope stems are the canonical decision-channel strings tests and SKILLs quote.
export const OTHER_OPTION = "Other (type your own)";
export const DONE_OPTION = "Done (submit selections)";
export const SELECTED_LINE_PREFIX = "User selected: ";
export const FREE_ANSWER_SENTINEL = "User provided free answer:";
const RECOMMENDED_SUFFIX = " (Recommended)";

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

/** A caller-supplied select option: a short canonical label plus a required display-only description. */
export interface SelectOptionInput {
	label: string;
	description: string;
}

/** A ui port method-subset for the free-text editor, shared by every free-answer chain. */
interface EditorPort {
	editor(title: string, prefill?: string): Promise<string | undefined>;
}

// ============================================================================
// Content envelope serialization (model-facing decision contract)
// ============================================================================

/**
 * Serialize a select/confirm answer into the model-facing CONTENT envelope: one
 * `User selected: <canonical label>` line per selection (in offered-option order), then, when
 * the user also/instead typed a free answer, a `User provided free answer:` block. A single-line
 * free answer sits on the sentinel line itself; a multiline one follows on 2-space-indented
 * lines so its payload (which may itself contain header-looking text) stays opaque.
 */
function serializeEnvelope(selections: string[], freeText?: string): string {
	const lines = selections.map(selection => `${SELECTED_LINE_PREFIX}${selection}`);
	if (freeText !== undefined) {
		lines.push(
			freeText.includes("\n")
				? `${FREE_ANSWER_SENTINEL}\n${freeText.split("\n").map(line => `  ${line}`).join("\n")}`
				: `${FREE_ANSWER_SENTINEL} ${freeText}`,
		);
	}
	return lines.join("\n");
}

function selectResult(
	question: string,
	selections: string[],
	freeText: string | undefined,
	source: "fixture" | "ui",
): AgentToolResult<SelectResultDetails> {
	const details: SelectResultDetails =
		freeText !== undefined ? { question, selections, freeText, source } : { question, selections, source };
	return { content: [{ type: "text", text: serializeEnvelope(selections, freeText) }], details };
}

function confirmResult(
	question: string,
	confirmed: boolean | null,
	freeText: string | undefined,
	source: "fixture" | "ui",
): AgentToolResult<ConfirmResultDetails> {
	const details: ConfirmResultDetails =
		freeText !== undefined ? { question, confirmed, freeText, source } : { question, confirmed, source };
	const text = confirmed === null ? serializeEnvelope([], freeText) : confirmed ? "yes" : "no";
	return { content: [{ type: "text", text }], details };
}

/**
 * Prompt for a free-text answer through the editor and canonicalize the result. Returns
 * undefined for both Esc (raw undefined) and a blank submission (empty after canonicalize +
 * trim) — blank is Esc-equivalent, so a select/confirm chain returns to the selector and an ask
 * treats it as a cancellation, rather than committing an empty, decision-free answer.
 */
async function promptFreeText(ui: EditorPort, question: string, prefill?: string): Promise<string | undefined> {
	const raw = await ui.editor(question, prefill);
	if (raw === undefined) return undefined;
	const canonical = canonicalizeFreeText(raw);
	return canonical.trim() === "" ? undefined : canonical;
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
	editor(title: string, prefill?: string): Promise<string | undefined>;
}

export async function performAsk(
	channel: AskChannel,
	ui: AskUI,
	params: { question: string; prefill?: string },
): Promise<AgentToolResult<AskResultDetails>> {
	const { question, prefill } = params;
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	if (channel.kind === "fixture") {
		let body: FixtureAnswerBody;
		try {
			body = channel.answers.match(question);
		} catch (error) {
			return fixtureErrorResult(error);
		}
		if (body.kind !== "free-text") {
			return { isError: true, content: [{ type: "text", text: `lets-craft fixture: this rule provides no free-text answer (kind: ${body.kind}).` }] };
		}
		return { content: [{ type: "text", text: body.freeText }], details: { question, response: body.freeText, source: "fixture" } };
	}

	const response = await promptFreeText(ui, question, prefill);
	if (response === undefined) {
		return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_ask prompt." }] };
	}
	return { content: [{ type: "text", text: response }], details: { question, response, source: "ui" } };
}

// ============================================================================
// lsc_select — multiple choice
// ============================================================================

export interface SelectResultDetails {
	question: string;
	selections: string[];
	freeText?: string;
	source: "fixture" | "ui";
}

export interface SelectUI {
	select(
		title: string,
		options: Array<{ label: string; description?: string }>,
		dialog?: {
			initialIndex?: number;
			selectionMarker?: "radio" | "checkbox";
			checkedIndices?: readonly number[];
			markableCount?: number;
		},
	): Promise<string | undefined>;
	editor(title: string, prefill?: string): Promise<string | undefined>;
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
 * Multi-tier fixture-mode option resolution for a single scripted selection, exported for
 * direct unit testing. Interview-stage questions are LLM-generated and choose `lsc_select` vs
 * `lsc_ask` on their own judgment, inventing their own option labels — so a fixture selection
 * authored by hand may not equal the model's paraphrase. Tiers, first hit wins:
 *
 *   1. Exact match.
 *   2. Case-insensitive exact match.
 *   3. Unique whole-word/whole-phrase containment (either direction) — only when exactly one
 *      offered option qualifies; an ambiguous (2+) match is treated as no match rather than
 *      guessing, since a wrong pick here silently steers the interview down the wrong branch.
 *      Whole-word bounded (not a raw substring check) on purpose: a long answer like
 *      "...non-alphanumeric separators..." contains "no" as a raw substring, which would
 *      false-positive against a plain ["yes","no"] option pair if checked naively.
 *
 * The v1 optionIndex fallback tier is gone — it is now the explicit `selection-index` fixture
 * kind. Matching is always against canonical labels (descriptions never participate). Returns
 * undefined (not an error) when nothing resolves — the caller decides how to report that.
 */
export function resolveSelectOption(response: string, options: string[]): string | undefined {
	if (options.includes(response)) return response;

	const lowerResponse = response.toLowerCase();
	const caseInsensitive = options.find(option => option.toLowerCase() === lowerResponse);
	if (caseInsensitive !== undefined) return caseInsensitive;

	const containment = options.filter(option => option.length > 0 && (containsAsWord(response, option) || containsAsWord(option, response)));
	if (containment.length === 1) return containment[0];

	return undefined;
}

/**
 * Channel-common semantic preflight for select options, run before either fixture or UI dispatch
 * (so both channels fail identically on invalid options). Returns an error message string, or
 * undefined when the options are valid. Inspection-only — never mutates the caller's data.
 */
export function validateSelectOptions(options: SelectOptionInput[], recommended?: number): string | undefined {
	const selectedStem = SELECTED_LINE_PREFIX.trimEnd().toLowerCase();
	const sentinelStem = FREE_ANSWER_SENTINEL.toLowerCase();

	for (const option of options) {
		const { label, description } = option;
		if (/[\r\n\u000B\u000C\u0085\u2028\u2029]/.test(label)) {
			return `option label must be a single line with no line breaks (mandatory-break characters): ${JSON.stringify(label)}.`;
		}
		if (label === "") return "option label must not be empty.";
		if (label.trim() === "") return `option label must not be blank (whitespace only): ${JSON.stringify(label)}.`;
		if (label !== label.trim()) return `option label must be trimmed, with no leading or trailing whitespace: ${JSON.stringify(label)}.`;

		const lower = label.toLowerCase();
		if (lower === OTHER_OPTION.toLowerCase()) {
			return `option label ${JSON.stringify(label)} is reserved: the free-text entry option is appended automatically — remove it from options.`;
		}
		if (lower === DONE_OPTION.toLowerCase()) {
			return `option label ${JSON.stringify(label)} is reserved: Done is a reserved control-row label — remove it from options.`;
		}
		if (lower.startsWith(selectedStem) || lower.startsWith(sentinelStem)) {
			return `option label ${JSON.stringify(label)} must not start with a reserved envelope prefix ("User selected:" / "User provided free answer:") — those name the decision channel.`;
		}
		if (canonicalizeFreeText(description).trim() === "") {
			return `option description must not be blank — it must contain visible text (label ${JSON.stringify(label)}).`;
		}
	}

	const seenCanonical = new Set<string>();
	for (const option of options) {
		const key = option.label.toLowerCase();
		if (seenCanonical.has(key)) return `duplicate option label ${JSON.stringify(option.label)} — option labels must be unique (case-insensitive).`;
		seenCanonical.add(key);
	}

	if (recommended !== undefined && (!Number.isInteger(recommended) || recommended < 0 || recommended >= options.length)) {
		return `recommended index ${recommended} is out of range — it must be a valid option index (0 to ${options.length - 1}).`;
	}

	const seenDisplay = new Set<string>();
	for (let i = 0; i < options.length; i++) {
		const display = (i === recommended ? options[i].label + RECOMMENDED_SUFFIX : options[i].label).toLowerCase();
		if (seenDisplay.has(display)) {
			return `duplicate display label ${JSON.stringify(display)} — display labels must be unique (case-insensitive) after the Recommended suffix is applied.`;
		}
		seenDisplay.add(display);
	}

	return undefined;
}

/**
 * Build the rows shown to ctx.ui.select and a display->canonical label map. Each option row is
 * `label (+ " (Recommended)" when it is the recommended index)`; the map recovers the canonical
 * label from whatever display string the SDK returns. Trailing control rows: Done (only in multi
 * when at least one option is checked) then Other (always last) — matching the vendor ask loop.
 */
export function buildDisplayRows(
	options: SelectOptionInput[],
	recommended: number | undefined,
	opts: { multi: boolean; checkedIndices: readonly number[] },
): { rows: Array<{ label: string; description?: string }>; displayToCanonical: Map<string, string> } {
	const rows: Array<{ label: string; description?: string }> = [];
	const displayToCanonical = new Map<string, string>();
	options.forEach((option, i) => {
		const label = i === recommended ? option.label + RECOMMENDED_SUFFIX : option.label;
		rows.push({ label, description: option.description });
		displayToCanonical.set(label, option.label);
	});
	if (opts.multi && opts.checkedIndices.length > 0) rows.push({ label: DONE_OPTION });
	rows.push({ label: OTHER_OPTION });
	return { rows, displayToCanonical };
}

function unresolvedSelectionError(question: string, selection: string, canonicalLabels: string[]): AgentToolResult<SelectResultDetails> {
	return {
		isError: true,
		content: [
			{
				type: "text",
				text:
					`lets-craft fixture: scripted selection ${JSON.stringify(selection)} for question ${JSON.stringify(question)} does not match ` +
					`any offered option via exact/case-insensitive/whole-word-containment matching (options: ${canonicalLabels.join(", ")}). ` +
					'Fix the fixture selection to match an option label, or use a "selection-index" rule.',
			},
		],
	};
}

function selectFromFixture(
	answers: FixtureAnswerSet,
	question: string,
	options: SelectOptionInput[],
	multi: boolean,
): AgentToolResult<SelectResultDetails> {
	let body: FixtureAnswerBody;
	try {
		body = answers.match(question);
	} catch (error) {
		return fixtureErrorResult(error);
	}
	const canonicalLabels = options.map(option => option.label);

	switch (body.kind) {
		case "free-text":
			return selectResult(question, [], body.freeText, "fixture");
		case "confirmation":
			return { isError: true, content: [{ type: "text", text: "lets-craft fixture: this rule provides no select answer (kind: confirmation)." }] };
		case "selection-index": {
			if (multi) {
				return {
					isError: true,
					content: [{ type: "text", text: 'lets-craft fixture: a selection-index answer cannot be used for a multi-select question (kind: selection-index) — use kind "selection" with explicit labels.' }],
				};
			}
			if (body.optionIndex >= options.length) {
				return {
					isError: true,
					content: [{ type: "text", text: `lets-craft fixture: optionIndex ${body.optionIndex} is out of range for ${options.length} options (valid range 0 to ${options.length - 1}).` }],
				};
			}
			return selectResult(question, [canonicalLabels[body.optionIndex]], undefined, "fixture");
		}
		case "selection": {
			if (!multi) {
				if (body.selections.length !== 1) {
					return {
						isError: true,
						content: [{ type: "text", text: `lets-craft fixture: a single-select question needs exactly one selection, but the fixture provided ${body.selections.length} (${JSON.stringify(body.selections)}).` }],
					};
				}
				if (body.freeText !== undefined) {
					return {
						isError: true,
						content: [{ type: "text", text: "lets-craft fixture: a single-select selection answer cannot also carry freeText — that is a multi-select-only combination." }],
					};
				}
				const resolved = resolveSelectOption(body.selections[0], canonicalLabels);
				if (resolved === undefined) return unresolvedSelectionError(question, body.selections[0], canonicalLabels);
				return selectResult(question, [resolved], undefined, "fixture");
			}
			const seen = new Set<string>();
			for (const selection of body.selections) {
				const resolved = resolveSelectOption(selection, canonicalLabels);
				if (resolved === undefined) return unresolvedSelectionError(question, selection, canonicalLabels);
				if (seen.has(resolved)) {
					return {
						isError: true,
						content: [{ type: "text", text: `lets-craft fixture: two scripted selections resolve to the same option ${JSON.stringify(resolved)} — duplicate selection.` }],
					};
				}
				seen.add(resolved);
			}
			const ordered = canonicalLabels.filter(label => seen.has(label));
			return selectResult(question, ordered, body.freeText, "fixture");
		}
	}
}

async function selectSingleUI(
	ui: SelectUI,
	question: string,
	options: SelectOptionInput[],
	recommended: number | undefined,
): Promise<AgentToolResult<SelectResultDetails>> {
	let initialIndex = recommended ?? 0;
	while (true) {
		const { rows, displayToCanonical } = buildDisplayRows(options, recommended, { multi: false, checkedIndices: [] });
		const response = await ui.select(question, rows, { selectionMarker: "radio", markableCount: options.length, initialIndex });
		if (response === undefined) return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_select prompt." }] };
		if (response === OTHER_OPTION) {
			const free = await promptFreeText(ui, question);
			if (free === undefined) {
				initialIndex = rows.findIndex(row => row.label === OTHER_OPTION);
				continue;
			}
			return selectResult(question, [], free, "ui");
		}
		const canonical = displayToCanonical.get(response);
		if (canonical === undefined) {
			initialIndex = 0;
			continue;
		}
		return selectResult(question, [canonical], undefined, "ui");
	}
}

async function selectMultiUI(
	ui: SelectUI,
	question: string,
	options: SelectOptionInput[],
	recommended: number | undefined,
): Promise<AgentToolResult<SelectResultDetails>> {
	const checked = new Set<number>();
	let initialIndex = recommended ?? 0;
	while (true) {
		const checkedIndices = [...checked].sort((a, b) => a - b);
		const { rows, displayToCanonical } = buildDisplayRows(options, recommended, { multi: true, checkedIndices });
		const response = await ui.select(question, rows, { selectionMarker: "checkbox", checkedIndices, markableCount: options.length, initialIndex });
		if (response === undefined) return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_select prompt." }] };
		if (response === DONE_OPTION) {
			return selectResult(question, options.filter((_, i) => checked.has(i)).map(option => option.label), undefined, "ui");
		}
		if (response === OTHER_OPTION) {
			const free = await promptFreeText(ui, question);
			if (free === undefined) {
				initialIndex = rows.findIndex(row => row.label === OTHER_OPTION);
				continue;
			}
			return selectResult(question, options.filter((_, i) => checked.has(i)).map(option => option.label), free, "ui");
		}
		const canonical = displayToCanonical.get(response);
		if (canonical === undefined) {
			initialIndex = 0;
			continue;
		}
		const idx = options.findIndex(option => option.label === canonical);
		if (checked.has(idx)) checked.delete(idx);
		else checked.add(idx);
		initialIndex = idx;
	}
}

export async function performSelect(
	channel: AskChannel,
	ui: SelectUI,
	params: { question: string; options: SelectOptionInput[]; multi?: boolean; recommended?: number },
): Promise<AgentToolResult<SelectResultDetails>> {
	const { question, options, multi = false, recommended } = params;
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	const invalid = validateSelectOptions(options, recommended);
	if (invalid !== undefined) return { isError: true, content: [{ type: "text", text: invalid }] };

	if (channel.kind === "fixture") return selectFromFixture(channel.answers, question, options, multi);

	return multi ? selectMultiUI(ui, question, options, recommended) : selectSingleUI(ui, question, options, recommended);
}

// ============================================================================
// lsc_confirm — yes/no (rebuilt on the select primitive: Yes / No / Other)
// ============================================================================

export interface ConfirmResultDetails {
	question: string;
	confirmed: boolean | null;
	freeText?: string;
	source: "fixture" | "ui";
}

export async function performConfirm(
	channel: AskChannel,
	ui: SelectUI,
	params: { question: string },
): Promise<AgentToolResult<ConfirmResultDetails>> {
	const { question } = params;
	if (channel.kind === "unavailable") return { isError: true, content: [{ type: "text", text: HEADLESS_ERROR }] };

	if (channel.kind === "fixture") {
		let body: FixtureAnswerBody;
		try {
			body = channel.answers.match(question);
		} catch (error) {
			return fixtureErrorResult(error);
		}
		if (body.kind === "confirmation") return confirmResult(question, body.confirm, undefined, "fixture");
		if (body.kind === "free-text") return confirmResult(question, null, body.freeText, "fixture");
		return { isError: true, content: [{ type: "text", text: `lets-craft fixture: this rule provides no confirm answer (kind: ${body.kind}).` }] };
	}

	// Yes/No are fixed English system identifiers (like the question tags) — self-evident, so no
	// description; Other is the always-present free-answer channel. markableCount: 2 keeps Other a
	// plain control row.
	const rows = [{ label: "Yes" }, { label: "No" }, { label: OTHER_OPTION }];
	let initialIndex = 0;
	while (true) {
		const response = await ui.select(question, rows, { selectionMarker: "radio", markableCount: 2, initialIndex });
		if (response === undefined) return { isError: true, content: [{ type: "text", text: "lets-craft: the user cancelled the lsc_confirm prompt." }] };
		if (response === "Yes") return confirmResult(question, true, undefined, "ui");
		if (response === "No") return confirmResult(question, false, undefined, "ui");
		if (response === OTHER_OPTION) {
			const free = await promptFreeText(ui, question);
			if (free === undefined) {
				initialIndex = 2;
				continue;
			}
			return confirmResult(question, null, free, "ui");
		}
		initialIndex = 0;
	}
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
		prefill: z.string().optional().describe("Optional initial text pre-filled into the multi-line editor (the user can edit or clear it)."),
	});
	pi.registerTool<typeof askParameters, AskResultDetails>({
		name: "lsc_ask",
		loadMode: "essential",
		label: "lets-craft: ask (free text)",
		description:
			"Ask the user a free-text question in a multi-line editor (ctx.ui.editor); an optional prefill seeds the editor. " +
			"The single seam pipeline skills (pre-craft/craft/post-craft) use this for open-ended answers. Fixture mode " +
			"(LSC_FIXTURE) returns a scripted free-text answer; a headless session with no fixture is a hard error. An empty/" +
			"blank submission or Esc cancels the prompt (isError).",
		approval: "read",
		parameters: askParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<AskResultDetails>> {
			return performAsk(channelFor(pi, ctx), ctx.ui, params);
		},
	});

	const selectOptionSchema = z.object({
		label: z
			.string()
			.describe("Short, self-evident choice label (2-7 words). Matched exactly; the returned answer uses this canonical label with no decoration."),
		description: z
			.string()
			.min(1)
			.describe(
				"Required, display-only rationale (never matched): one sentence on WHAT it is + one sentence on WHY it is " +
					"proposed + labeled pros AND cons in the user's language ('Pros:'/'Cons:' in English, '장점:'/'단점:' in Korean), " +
					"1-2 lines each. Balanced framing (no emotive wording, no implied 'right answer'); active voice with an explicit " +
					"actor; plain language (<=20 words per English sentence / <=50 chars per Korean sentence), jargon defined inline in parentheses.",
			),
	});
	const selectParameters = z.object({
		question: z.string().describe("The question to ask the user."),
		options: z
			.array(selectOptionSchema)
			.min(2)
			.max(4)
			.describe("2-4 options, each { label, description }. A free-text 'Other' entry is appended automatically — never include your own 'Other' option; write options in the user's language with one consistent tone."),
		multi: z
			.boolean()
			.optional()
			.describe("Allow checking multiple options (checkbox mode). A Done row appears once at least one option is checked; the user can still add a free-text answer alongside the checked options."),
		recommended: z
			.number()
			.int()
			.min(0)
			.optional()
			.describe("Zero-based index of the recommended option. Display-only: shown as ' (Recommended)' and used as the initial cursor. Never auto-selected; there is no timeout."),
	});
	pi.registerTool<typeof selectParameters, SelectResultDetails>({
		name: "lsc_select",
		loadMode: "essential",
		label: "lets-craft: ask (select)",
		description:
			"Ask the user to choose among 2-4 { label, description } options; a free-text 'Other' entry is always appended (do " +
			"not add your own). Set multi:true for checkbox multi-select. The model-facing decision is the result CONTENT: one " +
			"`User selected: <label>` line per chosen option (in offered order), and/or a `User provided free answer:` block when " +
			"the user typed free text instead of or alongside options — a free answer is guidance, never a chosen option. Fixture " +
			"mode (LSC_FIXTURE) scripts the answer with a kind-tagged body (selection / selection-index / free-text). Esc cancels (isError).",
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
		loadMode: "essential",
		label: "lets-craft: ask (confirm)",
		description:
			"Ask the user a yes/no question via a Yes / No / Other selector. The result CONTENT is exactly `yes` or `no` for a " +
			"boolean answer, or a `User provided free answer:` block when the user typed free text instead — a free answer is " +
			"neither approval nor rejection: reflect it as an instruction and re-ask, never treat it as yes. Fixture mode " +
			"(LSC_FIXTURE) scripts it with a confirmation (true/false) or free-text body. Esc cancels (isError).",
		approval: "read",
		parameters: confirmParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx): Promise<AgentToolResult<ConfirmResultDetails>> {
			// (a) Classify the prompt and capture BOTH the craft it is bound to AND any prepared-operation
			//     envelope for this tag BEFORE the confirm await (F-12: capture, never trust references).
			const tag = matchDestructiveGateTag(params.question);
			const craftAtPrompt = tag ? getActiveCraft() : undefined;
			const preparedAtPrompt = tag ? peekPreparedOperation(tag) : undefined;
			// (b) A tagged prompt revokes any prior pending approval on entry, whatever the outcome —
			//     the freshest same-tag no/free/cancel must retract a stale yes (P8 stale-yes barrier).
			if (tag) invalidatePendingApproval();
			// (c) The confirm itself is unchanged (craft-agnostic — C9).
			const result = await performConfirm(channelFor(pi, ctx), ctx.ui, params);
			const confirmedYes = !result.isError && result.details?.confirmed === true;
			// (d) Prepared-operation issuance branch (A land) — takes PRIORITY over the craft-bound path,
			//     but only for a prepared envelope captured at prompt time whose approvalQuestion EXACTLY
			//     matches this confirm (confused-deputy barrier). It carries the operationScope a scoped
			//     [Land] pending needs. A [Canon Amendment] confirm has no prepared entry, so it falls
			//     through to the unchanged craft-bound path below.
			if (tag && preparedAtPrompt && params.question === preparedAtPrompt.approvalQuestion) {
				// Still the same prepared entry the confirm was raised for? A slot replaced mid-await (a
				// cross-feature prepare) must neither issue for nor clear the now-current envelope.
				const stillCurrent = peekPreparedOperation(tag)?.prepareId === preparedAtPrompt.prepareId;
				const activeNow = getActiveCraft();
				const identityOk = !activeNow || sameCraftIdentity(preparedAtPrompt.identity, activeNow);
				if (confirmedYes && stillCurrent && identityOk) {
					const record = createPendingApproval({ tag, question: params.question, identity: preparedAtPrompt.identity });
					// persist-before-install (P7): commit durable evidence at the envelope's EXACT root
					//     first — a throw here propagates and leaves the slot empty (no live capability).
					recordReleaseApprovalAt(preparedAtPrompt.evidenceRoot, preparedAtPrompt.identity, {
						nonce: record.nonce,
						tag: record.tag,
						question: record.question,
						response: record.response,
						issuedAt: record.issuedAt,
						operationScope: preparedAtPrompt.operationScope,
					});
					installPendingApproval({ ...record, operationScope: preparedAtPrompt.operationScope });
					invalidatePreparedOperation(tag);
				} else if (stillCurrent) {
					// no / free / cancel / ineligible → clear the captured prepared entry (only if still current).
					invalidatePreparedOperation(tag);
				}
			} else if (tag && craftAtPrompt && confirmedYes && sameCraftIdentity(craftAtPrompt, getActiveCraft())) {
				// Craft-bound issuance path (release-gate [Canon Amendment]) — UNCHANGED.
				const record = createPendingApproval({
					tag,
					question: params.question,
					identity: { feature: craftAtPrompt.feature, projectRoot: craftAtPrompt.projectRoot, worktreeRoot: craftAtPrompt.worktreeRoot },
				});
				// Commit durable evidence FIRST (persist-before-install, P7).
				recordReleaseApproval({ nonce: record.nonce, tag: record.tag, question: record.question, response: record.response, issuedAt: record.issuedAt });
				installPendingApproval(record);
			}
			// (f) Return the original confirm result unchanged in every case.
			return result;
		},
	});
}
