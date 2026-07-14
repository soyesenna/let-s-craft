import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DONE_OPTION,
	FREE_ANSWER_SENTINEL,
	OTHER_OPTION,
	SELECTED_LINE_PREFIX,
	type AskChannel,
	type AskUI,
	type SelectUI,
	buildDisplayRows,
	performAsk,
	performConfirm,
	performSelect,
	resolveAskChannel,
	resolveSelectOption,
	validateSelectOptions,
} from "../src/ask";
import {
	FixtureAnswerSet,
	canonicalizeFreeText,
	parseFixtureAnswerFile,
	resetFixtureCache,
	type FixtureAnswerBody,
} from "../src/fixtures";

interface OptionInput {
	label: string;
	description: string;
}

interface DisplayRow {
	label: string;
	description?: string;
}

interface DisplayRowsResult {
	rows: DisplayRow[];
	displayToCanonical: Map<string, string>;
}

interface DialogSnapshot {
	initialIndex?: number;
	selectionMarker?: "radio" | "checkbox";
	checkedIndices?: readonly number[];
	markableCount?: number;
}

interface SelectCall {
	title: string;
	options: DisplayRow[];
	dialog?: DialogSnapshot;
}

interface EditorCall {
	title: string;
	prefill?: string;
}

interface ScriptedSelectUI {
	ui: SelectUI;
	selectCalls: SelectCall[];
	editorCalls: EditorCall[];
}

const BASE_OPTIONS: OptionInput[] = [
	{ label: "Alpha", description: "Use the alpha path." },
	{ label: "Beta", description: "Use the beta path." },
];

const NON_ALPHABETICAL_EXPECTED: readonly OptionInput[] = Object.freeze([
	Object.freeze({ label: "Zeta", description: "Use the zeta path." }),
	Object.freeze({ label: "Alpha", description: "Use the alpha path." }),
	Object.freeze({ label: "Mango", description: "Use the mango path." }),
]);

const MANDATORY_BREAKS = [
	{ name: "LF (U+000A)", value: "\n" },
	{ name: "VT (U+000B)", value: "\u000B" },
	{ name: "FF (U+000C)", value: "\u000C" },
	{ name: "CR (U+000D)", value: "\r" },
	{ name: "NEL (U+0085)", value: "\u0085" },
	{ name: "LS (U+2028)", value: "\u2028" },
	{ name: "PS (U+2029)", value: "\u2029" },
] as const;

const tempDirs: string[] = [];

afterEach(() => {
	resetFixtureCache();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpAnswersFile(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-ask-v2-"));
	tempDirs.push(dir);
	const path = join(dir, "answers.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}

function fixtureSet(body: FixtureAnswerBody): FixtureAnswerSet {
	return new FixtureAnswerSet(
		parseFixtureAnswerFile(
			{
				version: 2,
				answers: [{ match: ".*", ...body }],
			},
			"unit-answers.json",
		),
	);
}

function fixtureChannel(body: FixtureAnswerBody): AskChannel {
	return { kind: "fixture", answers: fixtureSet(body) };
}

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
		throw new Error("expected the first tool-result content item to be text");
	}
	return first.text;
}

function validationMessage(options: OptionInput[], recommended?: number): string | undefined {
	try {
		const outcome: unknown = validateSelectOptions(options, recommended);
		if (outcome === undefined || outcome === null || outcome === false) return undefined;
		if (typeof outcome === "string") return outcome;
		if (outcome instanceof Error) return outcome.message;
		if (typeof outcome === "object" && "message" in outcome && typeof outcome.message === "string") return outcome.message;
		if (typeof outcome === "object" && "error" in outcome && typeof outcome.error === "string") return outcome.error;
		throw new Error(`unexpected validateSelectOptions result: ${String(outcome)}`);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

function isDisplayRowArray(value: unknown): value is DisplayRow[] {
	return (
		Array.isArray(value) &&
		value.every(entry => entry !== null && typeof entry === "object" && "label" in entry && typeof entry.label === "string")
	);
}

function unpackDisplayRows(value: unknown): DisplayRowsResult {
	if (value === null || typeof value !== "object") throw new Error("buildDisplayRows must return rows and a Map");
	const candidates: unknown[] = Array.isArray(value) ? [...value] : Object.values(value);
	const rows = candidates.find(isDisplayRowArray);
	const rawMap = candidates.find(candidate => candidate instanceof Map);
	if (!rows || !(rawMap instanceof Map)) throw new Error("buildDisplayRows must return a row array and Map");

	const displayToCanonical = new Map<string, string>();
	for (const [display, canonical] of rawMap) {
		if (typeof display !== "string" || typeof canonical !== "string") {
			throw new Error("buildDisplayRows Map keys and values must be strings");
		}
		displayToCanonical.set(display, canonical);
	}
	return { rows, displayToCanonical };
}

function makeSelectUI(
	selectResponses: Array<string | undefined>,
	editorResponses: Array<string | undefined> = [],
): ScriptedSelectUI {
	const selectCalls: SelectCall[] = [];
	const editorCalls: EditorCall[] = [];
	const ui: SelectUI = {
		async select(title, options, dialog) {
			selectCalls.push({
				title,
				options: options.map(option => ({ ...option })),
				dialog:
					dialog === undefined
						? undefined
						: {
								initialIndex: dialog.initialIndex,
								selectionMarker: dialog.selectionMarker,
								checkedIndices: dialog.checkedIndices === undefined ? undefined : [...dialog.checkedIndices],
								markableCount: dialog.markableCount,
							},
			});
			return selectResponses.shift();
		},
		async editor(title, prefill) {
			editorCalls.push({ title, prefill });
			return editorResponses.shift();
		},
	};
	return { ui, selectCalls, editorCalls };
}

function unreachableSelectUI(): SelectUI {
	return {
		async select() {
			throw new Error("ui.select must not be called in fixture mode");
		},
		async editor() {
			throw new Error("ui.editor must not be called in fixture mode");
		},
	};
}

function unreachableAskUI(): AskUI {
	return {
		async editor() {
			throw new Error("ui.editor must not be called in fixture mode");
		},
	};
}

async function selectTwoLabels(labels: [string, string]): Promise<string> {
	const options = labels.map(label => ({ label, description: `Description for ${label}` }));
	const scripted = makeSelectUI([labels[0], labels[1], DONE_OPTION]);
	const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose teams", options, multi: true });
	return textOf(result);
}

describe("resolveAskChannel", () => {
	// Plan §1-D/§1-G/§1-H: an explicit fixture remains the highest-priority interaction channel.
	it("picks fixture mode and loads a v2 answers file regardless of UI availability", () => {
		const path = tmpAnswersFile({ version: 2, answers: [], default: { kind: "confirmation", confirm: true } });
		expect(resolveAskChannel(path, true).kind).toBe("fixture");
		expect(resolveAskChannel(path, false).kind).toBe("fixture");
	});

	// Plan §1-D/§1-G/§1-H: interactive UI is used only when no fixture path is present.
	it("picks UI mode when no fixture path exists and UI is available", () => {
		expect(resolveAskChannel(undefined, true)).toEqual({ kind: "ui" });
	});

	// Plan §1-C preflight order; §3 AC1: headless operation without a fixture remains fail-closed.
	it("picks unavailable mode when neither fixture nor UI exists", () => {
		expect(resolveAskChannel(undefined, false)).toEqual({ kind: "unavailable" });
	});
});

describe("canonicalizeFreeText", () => {
	// Plan §1-C P0-J/P0-K; §3 AC3/AC10: every UAX #14 mandatory-break code point canonicalizes to LF.
	it.each(MANDATORY_BREAKS)("canonicalizes $name to LF", ({ value }) => {
		expect(canonicalizeFreeText(`before${value}after`)).toBe("before\nafter");
	});

	// Plan §1-C P0-J: CRLF folding runs before bare-CR replacement, yielding one LF per pair.
	it("folds each CRLF pair to exactly one LF", () => {
		expect(canonicalizeFreeText("a\r\nb\r\n\r\nc")).toBe("a\nb\n\nc");
	});

	// Plan §1-C P0-J; §3 AC3: a mixed sequence of all mandatory breaks has one canonical representation.
	it("canonicalizes a mixed mandatory-break sequence without dropping boundaries", () => {
		const source = "A\r\nB\u000BC\u000CD\rE\u0085F\u2028G\u2029H\nI";
		expect(canonicalizeFreeText(source)).toBe("A\nB\nC\nD\nE\nF\nG\nH\nI");
	});

	// Plan §1-C P0-J/P0-K; §3 AC10: canonicalization is idempotent.
	it("is idempotent for mixed canonical and noncanonical line breaks", () => {
		const source = "A\r\nB\u000BC\u0085D\nE\u2029F";
		const once = canonicalizeFreeText(source);
		expect(canonicalizeFreeText(once)).toBe(once);
	});

	// Plan §1-C P0-K: non-break payload bytes are preserved by the pure canonicalizer.
	it("leaves text without mandatory breaks unchanged", () => {
		expect(canonicalizeFreeText("  keep tabs\tand spaces  ")).toBe("  keep tabs\tand spaces  ");
	});
});

describe("validateSelectOptions", () => {
	// Plan §1-C; §3 AC1: a well-formed option set with an in-range recommendation passes semantic preflight.
	it("accepts visible descriptions, unique labels, and an in-range recommended index", () => {
		expect(validationMessage(BASE_OPTIONS, 1)).toBeUndefined();
	});

	// Plan §1-C label-format guard; §3 AC6: an empty canonical label is invalid.
	it("rejects an empty label", () => {
		expect(validationMessage([{ label: "", description: "Empty label." }, BASE_OPTIONS[1]])).toMatch(/label.*(empty|blank|non-empty)/i);
	});

	// Plan §1-C label-format guard; §3 AC6: whitespace-only labels are invalid.
	it("rejects a whitespace-only label", () => {
		expect(validationMessage([{ label: " \t ", description: "Blank label." }, BASE_OPTIONS[1]])).toMatch(
			/label.*(empty|blank|trim)/i,
		);
	});

	// Plan §1-C label-format guard; §3 AC6: labels must already be trimmed rather than silently transformed.
	it.each([" Alpha", "Alpha "])("rejects the non-trimmed label %j", label => {
		expect(validationMessage([{ label, description: "Non-trimmed label." }, BASE_OPTIONS[1]])).toMatch(/label.*trim/i);
	});

	// Plan §1-C P0-J; §3 AC6: all seven mandatory breaks, including interior VT/FF, are forbidden in labels.
	it.each(MANDATORY_BREAKS)("rejects a label containing $name", ({ value }) => {
		expect(
			validationMessage([{ label: `Alpha${value}Forged`, description: "Split label." }, BASE_OPTIONS[1]]),
		).toMatch(/label.*(single.?line|line.?break|mandatory break)/i);
	});

	// Plan §1-C; §3 AC2: callers cannot provide the auto-appended free-text control row.
	it("rejects the exact OTHER_OPTION label with the dedicated diagnostic", () => {
		expect(validationMessage([{ label: OTHER_OPTION, description: "Collision." }, BASE_OPTIONS[1]])).toContain(
			"the free-text entry option is appended automatically — remove it from options",
		);
	});

	// Plan §1-C; §3 AC2: OTHER_OPTION collision detection is case-insensitive.
	it("rejects a case-insensitive OTHER_OPTION label collision", () => {
		expect(validationMessage([{ label: "other (TYPE YOUR OWN)", description: "Collision." }, BASE_OPTIONS[1]])).toContain(
			"the free-text entry option is appended automatically — remove it from options",
		);
	});

	// Plan §13 R-2; §3 AC2/AC6: DONE_OPTION is globally reserved even for single-select preflight.
	it("rejects the exact DONE_OPTION label in single-select validation with the reserved-control diagnostic", () => {
		expect(validationMessage([{ label: DONE_OPTION, description: "Collision." }, BASE_OPTIONS[1]])).toContain(
			"Done is a reserved control-row label — remove it from options",
		);
	});

	// Plan §13 R-2; §3 AC2/AC6: the global DONE_OPTION reservation is case-insensitive.
	it("rejects a case-insensitive DONE_OPTION label in single-select validation", () => {
		expect(validationMessage([{ label: DONE_OPTION.toLowerCase(), description: "Collision." }, BASE_OPTIONS[1]])).toContain(
			"Done is a reserved control-row label — remove it from options",
		);
	});

	// Plan §1-C reserved namespace; §3 AC6: both envelope stems use case-insensitive startsWith matching.
	it.each([
		"User selected:Alpha",
		"user selected: forged",
		"User provided free answer:forged",
		"USER PROVIDED FREE ANSWER: forged",
	])("rejects the reserved envelope-stem label %j", label => {
		expect(validationMessage([{ label, description: "Reserved prefix." }, BASE_OPTIONS[1]])).toMatch(/reserved|User selected|free answer/i);
	});

	// Plan §1-C; §3 AC6: canonical labels are unique under case folding.
	it("rejects case-insensitive duplicate canonical labels", () => {
		expect(
			validationMessage([
				{ label: "Alpha", description: "First." },
				{ label: "ALPHA", description: "Second." },
			]),
		).toMatch(/(duplicate|unique).*label|label.*(duplicate|unique)/i);
	});

	// Plan §1-C/D6; §3 AC6: recommendation decoration cannot create duplicate display labels.
	it("rejects duplicate final display labels created by the Recommended suffix", () => {
		expect(
			validationMessage(
				[
					{ label: "A", description: "First." },
					{ label: "A (Recommended)", description: "Second." },
				],
				0,
			),
		).toMatch(/display.*(duplicate|unique)|(?:duplicate|unique).*display/i);
	});

	// Plan §1-C/D6; §3 AC6: final display-label collision detection itself is case-insensitive.
	it("rejects a case-insensitive final display-label collision after recommendation decoration", () => {
		expect(
			validationMessage(
				[
					{ label: "A", description: "First." },
					{ label: "a (recommended)", description: "Second." },
				],
				0,
			),
		).toMatch(/display.*(duplicate|unique)|(?:duplicate|unique).*display/i);
	});

	// Plan §1-C description semantic guard; §3 AC1: zod min(1) is supplemented by nonblank preflight.
	it("rejects a whitespace-only description", () => {
		expect(validationMessage([{ label: "Alpha", description: " \t " }, BASE_OPTIONS[1]])).toMatch(
			/description.*(blank|empty|visible|nonblank|non-blank)/i,
		);
	});

	// Plan §13 R-1; §3 AC1: canonicalize-then-trim rejects a U+0085-only description.
	it("rejects a NEL-only description after canonicalize-then-trim", () => {
		expect(validationMessage([{ label: "Alpha", description: "\u0085" }, BASE_OPTIONS[1]])).toMatch(
			/description.*(blank|empty|visible|nonblank|non-blank)/i,
		);
	});

	// Plan §13 R-1: description validation is inspection-only and does not rewrite caller data.
	it("does not transform a nonblank description while validating it", () => {
		const options = [{ label: "Alpha", description: "  visible text  " }, BASE_OPTIONS[1]];
		expect(validationMessage(options)).toBeUndefined();
		expect(options[0].description).toBe("  visible text  ");
	});

	// Plan §1-C; §3 AC1: recommended must reference an offered canonical option.
	it.each([-1, 2])("rejects the out-of-range recommended index %i", recommended => {
		expect(validationMessage(BASE_OPTIONS, recommended)).toMatch(/recommended.*(range|index)|(?:range|index).*recommended/i);
	});

	// Plan §1-C P0-H; §3 AC1/AC6: identical invalid labels fail before either UI or fixture dispatch.
	it("applies the same invalid-label preflight before UI and fixture dispatch", async () => {
		const options = [{ label: "Alpha\nForged", description: "Invalid." }, BASE_OPTIONS[1]];
		const scripted = makeSelectUI(["Alpha"]);
		const uiResult = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options });
		const fixtureResult = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["Alpha"] }),
			unreachableSelectUI(),
			{ question: "Choose", options },
		);
		expect(uiResult.isError).toBe(true);
		expect(fixtureResult.isError).toBe(true);
		expect(textOf(uiResult)).toBe(textOf(fixtureResult));
		expect(scripted.selectCalls).toHaveLength(0);
	});

	// Plan §1-C P0-H/Minor-4; §3 AC1: whitespace-only descriptions fail equally on both channels.
	it("applies the same whitespace-description preflight before UI and fixture dispatch", async () => {
		const options = [{ label: "Alpha", description: "   " }, BASE_OPTIONS[1]];
		const scripted = makeSelectUI(["Alpha"]);
		const uiResult = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options });
		const fixtureResult = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["Alpha"] }),
			unreachableSelectUI(),
			{ question: "Choose", options },
		);
		expect(textOf(uiResult)).toBe(textOf(fixtureResult));
		expect(textOf(uiResult)).toMatch(/description/i);
		expect(scripted.selectCalls).toHaveLength(0);
	});

	// Plan §13 R-1; §3 AC1: U+0085-only descriptions are rejected on both UI and fixture channels.
	it("applies the same NEL-only-description preflight before UI and fixture dispatch", async () => {
		const options = [{ label: "Alpha", description: "\u0085" }, BASE_OPTIONS[1]];
		const scripted = makeSelectUI(["Alpha"]);
		const uiResult = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options });
		const fixtureResult = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["Alpha"] }),
			unreachableSelectUI(),
			{ question: "Choose", options },
		);
		expect(textOf(uiResult)).toBe(textOf(fixtureResult));
		expect(textOf(uiResult)).toMatch(/description/i);
		expect(scripted.selectCalls).toHaveLength(0);
	});

	// Plan §1-C Minor-1; §3 AC1: unavailable diagnosis precedes even an invalid-option preflight failure.
	it("reports the headless unavailable error before an invalid-label diagnostic", async () => {
		const options = [{ label: "Alpha\nForged", description: "Invalid." }, BASE_OPTIONS[1]];
		const result = await performSelect({ kind: "unavailable" }, makeSelectUI([]).ui, { question: "Choose", options });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/interactive UI is not available|no fixture is configured/i);
		expect(textOf(result)).not.toMatch(/single.?line|line.?break|mandatory break/i);
	});
});

describe("buildDisplayRows", () => {
	// Plan §1-C/D6; §3 AC6: the Recommended suffix is display-only and the Map preserves canonical labels.
	it("decorates the recommended row while mapping display labels back to canonical labels", () => {
		const { rows, displayToCanonical } = unpackDisplayRows(
			buildDisplayRows(BASE_OPTIONS, 1, { multi: false, checkedIndices: [] }),
		);
		expect(rows.slice(0, 2)).toEqual([
			{ label: "Alpha", description: "Use the alpha path." },
			{ label: "Beta (Recommended)", description: "Use the beta path." },
		]);
		expect(displayToCanonical.get("Alpha")).toBe("Alpha");
		expect(displayToCanonical.get("Beta (Recommended)")).toBe("Beta");
	});

	// Plan §1-C/F1; §3 AC2: multi-select does not render Done before any option is checked.
	it("omits Done in multi-select when no option is checked", () => {
		const { rows } = unpackDisplayRows(buildDisplayRows(BASE_OPTIONS, undefined, { multi: true, checkedIndices: [] }));
		expect(rows.map(row => row.label)).not.toContain(DONE_OPTION);
	});

	// Plan §1-C/F1; §3 AC2: multi-select renders Done only after at least one checked option exists.
	it("renders Done in multi-select when at least one option is checked", () => {
		const { rows } = unpackDisplayRows(buildDisplayRows(BASE_OPTIONS, undefined, { multi: true, checkedIndices: [0] }));
		expect(rows.map(row => row.label)).toContain(DONE_OPTION);
	});

	// Plan §1-C/D1; §3 AC2: Other is always the final display row, after conditional Done.
	it("always places Other as the final display row", () => {
		const unchecked = unpackDisplayRows(buildDisplayRows(BASE_OPTIONS, undefined, { multi: false, checkedIndices: [] })).rows;
		const checked = unpackDisplayRows(buildDisplayRows(BASE_OPTIONS, undefined, { multi: true, checkedIndices: [1] })).rows;
		expect(unchecked.at(-1)?.label).toBe(OTHER_OPTION);
		expect(checked.at(-2)?.label).toBe(DONE_OPTION);
		expect(checked.at(-1)?.label).toBe(OTHER_OPTION);
	});

	// Plan §1-C: control rows are not canonical selections and therefore are absent from the display-to-canonical Map.
	it("does not map Done or Other to canonical selections", () => {
		const { displayToCanonical } = unpackDisplayRows(
			buildDisplayRows(BASE_OPTIONS, undefined, { multi: true, checkedIndices: [0] }),
		);
		expect(displayToCanonical.has(DONE_OPTION)).toBe(false);
		expect(displayToCanonical.has(OTHER_OPTION)).toBe(false);
	});
});

describe("resolveSelectOption", () => {
	// Plan §1-E; §3 이동 지도: tier 1 exact matching remains the highest-priority fixture resolution.
	it("returns an exact canonical-label match", () => {
		expect(resolveSelectOption("yes", ["yes", "YES-ish"])).toBe("yes");
	});

	// Plan §1-E; §3 이동 지도: tier 2 retains case-insensitive exact matching.
	it("returns a case-insensitive canonical-label match", () => {
		expect(resolveSelectOption("No", ["yes", "no"])).toBe("no");
	});

	// Plan §1-E; §3 이동 지도: tier 3 resolves a unique option contained as a whole phrase in the response.
	it("resolves unique whole-word containment when the response contains the option", () => {
		expect(resolveSelectOption("I think the answer is no, definitely", ["yes", "no"])).toBe("no");
	});

	// Plan §1-E; §3 이동 지도: tier 3 also resolves the reverse unique whole-phrase containment direction.
	it("resolves unique whole-word containment when an option contains the response", () => {
		expect(resolveSelectOption("collapse", ["A) collapse consecutive separators", "B) leave separators unchanged"])).toBe(
			"A) collapse consecutive separators",
		);
	});

	// Plan §1-E; §3 이동 지도: raw-substring false positives remain forbidden.
	it("does not match a short option inside a larger word", () => {
		expect(resolveSelectOption("non-alphanumeric characters only", ["yes", "no"])).toBeUndefined();
	});

	// Plan §1-E; §3 이동 지도: ambiguous containment is never guessed.
	it("returns undefined when multiple options qualify by containment", () => {
		expect(resolveSelectOption("yes or no, unclear", ["yes", "no"])).toBeUndefined();
	});

	// Plan §1-E; §3 이동 지도: a complete tier miss remains a non-throwing undefined result.
	it("returns undefined when every text-matching tier misses", () => {
		expect(resolveSelectOption("completely unrelated", ["Alpha", "Beta"])).toBeUndefined();
	});
});

describe("performAsk", () => {
	// Plan §1-H; §3 AC5: fixture free-text is returned without touching UI and records fixture provenance.
	it("returns a fixture free-text answer with exact content and details", async () => {
		const result = await performAsk(
			fixtureChannel({ kind: "free-text", freeText: "fixture answer" }),
			unreachableAskUI(),
			{ question: "Explain" },
		);
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("fixture answer");
		expect(result.details).toEqual({ question: "Explain", response: "fixture answer", source: "fixture" });
	});

	// Plan §1-H; §3 AC5: lsc_ask delegates to editor and forwards prefill verbatim.
	it("delegates UI input to editor with the supplied prefill", async () => {
		const editorCalls: EditorCall[] = [];
		const ui: AskUI = {
			async editor(title, prefill) {
				editorCalls.push({ title, prefill });
				return "typed answer";
			},
		};
		const result = await performAsk({ kind: "ui" }, ui, { question: "Explain", prefill: "Start here" });
		expect(editorCalls).toEqual([{ title: "Explain", prefill: "Start here" }]);
		expect(textOf(result)).toBe("typed answer");
		expect(result.details).toEqual({ question: "Explain", response: "typed answer", source: "ui" });
	});

	// Plan §1-C P0-K/§1-H; §3 AC5: ask stores canonical free text, not raw CRLF bytes.
	it("stores editor CRLF input canonically in both content and details", async () => {
		const ui: AskUI = { editor: async () => "first\r\nsecond" };
		const result = await performAsk({ kind: "ui" }, ui, { question: "Explain" });
		expect(textOf(result)).toBe("first\nsecond");
		expect(result.details).toEqual({ question: "Explain", response: "first\nsecond", source: "ui" });
	});

	// Plan §1-C/§1-H; §3 AC5: editor Esc cancels ask rather than fabricating an answer.
	it("reports editor Esc as an ask cancellation", async () => {
		const ui: AskUI = { editor: async () => undefined };
		const result = await performAsk({ kind: "ui" }, ui, { question: "Explain" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/cancelled.*lsc_ask|lsc_ask.*cancelled/i);
		expect(result.details).toBeUndefined();
	});

	// Plan §1-C editor normalization/§1-H; §3 AC5: blank editor submission is Esc-equivalent for ask.
	it("reports a canonicalized blank editor submission as an ask cancellation", async () => {
		const ui: AskUI = { editor: async () => " \u0085\t" };
		const result = await performAsk({ kind: "ui" }, ui, { question: "Explain" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/cancelled.*lsc_ask|lsc_ask.*cancelled/i);
	});

	// Plan §1-H; §3 AC5: ask also retains fail-closed headless behavior.
	it("fails closed when ask has neither fixture nor UI", async () => {
		const result = await performAsk({ kind: "unavailable" }, unreachableAskUI(), { question: "Explain" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/interactive UI is not available|no fixture is configured/i);
	});
});

describe("performSelect fixture core", () => {
	// Plan §1-D; §3 AC3/AC7: a single fixture selection resolves to canonical details and envelope content.
	it("returns a canonical single selection from a selection fixture", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["beta"] }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details).toEqual({ question: "Choose", selections: ["Beta"], source: "fixture" });
	});

	// Plan §1-D; §3 AC2/AC3/AC7: fixture free-text uses the same always-available answer channel as UI.
	it("returns a free answer from a free-text fixture", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "free-text", freeText: "fixture guidance" }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} fixture guidance`);
		expect(result.details).toEqual({ question: "Choose", selections: [], freeText: "fixture guidance", source: "fixture" });
	});

	// Plan §1-D/§1-F; §3 이동 지도 AC7: optionIndex is an explicit v2 kind rather than a fallback tier.
	it("resolves a single selection-index fixture by canonical option position", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "selection-index", optionIndex: 1 }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details?.selections).toEqual(["Beta"]);
	});

	// Plan §1-D/§1-F; §3 AC7: response-semantic kinds fail loudly when consumed by the wrong tool.
	it("rejects a confirmation fixture as having no select answer", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "confirmation", confirm: true }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no select answer.*confirmation|confirmation.*no select answer/i);
	});

	// Plan §1-C/§1-D; §3 AC3: fixture selections serialize in offered-option order, not fixture-array order.
	it("serializes multi fixture selections in canonical option order", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["Beta", "Alpha"] }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS, multi: true },
		);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha\n${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details?.selections).toEqual(["Alpha", "Beta"]);
	});
});

describe("performSelect UI core", () => {
	// Plan §1-D; §3 AC3: a canonical single selection has exact envelope content and structured details.
	it("returns exact content and details for a single UI selection", async () => {
		const scripted = makeSelectUI(["Beta"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details).toEqual({ question: "Choose", selections: ["Beta"], source: "ui" });
	});

	// Plan §1-D; §3 AC6: a missing recommendation gives the first single-select call initialIndex zero.
	it("defaults the first single-select cursor to index zero", async () => {
		const scripted = makeSelectUI(["Alpha"]);
		await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(scripted.selectCalls[0]?.dialog).toMatchObject({
			initialIndex: 0,
			selectionMarker: "radio",
			markableCount: 2,
		});
	});

	// Plan §1-D/D6; §3 AC1/AC6: first-call rows preserve non-alphabetical canonical order and descriptions.
	it("preserves non-alphabetical canonical rows on the first single-select call", async () => {
		const scripted = makeSelectUI([undefined]);
		await performSelect(
			{ kind: "ui" },
			scripted.ui,
			{ question: "Choose", options: NON_ALPHABETICAL_EXPECTED.map(option => ({ ...option })) },
		);
		expect(scripted.selectCalls[0]?.options.slice(0, NON_ALPHABETICAL_EXPECTED.length)).toMatchObject(
			NON_ALPHABETICAL_EXPECTED,
		);
	});

	// Plan §1-D/D6; §3 AC6: recommended controls the first cursor but never pollutes returned selections.
	it("uses recommended as the initial cursor and returns an undecorated canonical selection", async () => {
		const scripted = makeSelectUI(["Beta (Recommended)"]);
		const result = await performSelect(
			{ kind: "ui" },
			scripted.ui,
			{ question: "Choose", options: BASE_OPTIONS, recommended: 1 },
		);
		expect(scripted.selectCalls[0]?.dialog?.initialIndex).toBe(1);
		expect(scripted.selectCalls[0]?.options[1]).toMatchObject({
			label: "Beta (Recommended)",
			description: "Use the beta path.",
		});
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
		expect(result.details?.selections).toEqual(["Beta"]);
	});

	// Plan §1-D; §3 AC2/AC3: Other chains to editor and yields a free-only structured answer.
	it("chains Other to editor and returns the typed free answer", async () => {
		const scripted = makeSelectUI([OTHER_OPTION], ["typed guidance"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(scripted.selectCalls[0]?.options.at(-1)?.label).toBe(OTHER_OPTION);
		expect(scripted.editorCalls).toEqual([{ title: "Choose", prefill: undefined }]);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} typed guidance`);
		expect(result.details).toEqual({ question: "Choose", selections: [], freeText: "typed guidance", source: "ui" });
	});

	// Plan §1-D; §3 AC2/AC3: multi-select can finalize free text without any checked canonical option.
	it("returns only the sentinel block for a free-only multi-select answer", async () => {
		const scripted = makeSelectUI([OTHER_OPTION], ["typed guidance"]);
		const result = await performSelect(
			{ kind: "ui" },
			scripted.ui,
			{ question: "Choose", options: BASE_OPTIONS, multi: true },
		);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} typed guidance`);
		expect(textOf(result)).not.toContain(SELECTED_LINE_PREFIX);
		expect(result.details).toEqual({
			question: "Choose",
			selections: [],
			freeText: "typed guidance",
			source: "ui",
		});
	});

	// Plan §1-C/§1-D; §3 AC2: editor Esc returns to select and does not cancel the question.
	it("returns from editor Esc to the selector", async () => {
		const scripted = makeSelectUI([OTHER_OPTION, "Alpha"], [undefined]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(scripted.selectCalls).toHaveLength(2);
		expect(scripted.selectCalls[1]?.dialog?.initialIndex).toBe(BASE_OPTIONS.length);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha`);
	});

	// Plan §1-C/§1-D; §3 AC2: blank editor submission is Esc-equivalent and returns to select.
	it("returns from a canonicalized blank editor submission to the selector", async () => {
		const scripted = makeSelectUI([OTHER_OPTION, "Beta"], [" \u0085 "]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(scripted.selectCalls).toHaveLength(2);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta`);
	});

	// Plan §1-D; §3 AC2: only select Esc cancels the whole select question.
	it("reports select Esc as a cancellation", async () => {
		const result = await performSelect({ kind: "ui" }, makeSelectUI([undefined]).ui, {
			question: "Choose",
			options: BASE_OPTIONS,
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/cancelled.*lsc_select|lsc_select.*cancelled/i);
		expect(result.details).toBeUndefined();
	});

	// Plan §1-D; §3 AC2: select Esc cancels multi-select even after the user has checked an option.
	it("reports multi-select Esc as a cancellation with checked state", async () => {
		const result = await performSelect({ kind: "ui" }, makeSelectUI(["Beta", undefined]).ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/cancelled.*lsc_select|lsc_select.*cancelled/i);
		expect(result.details).toBeUndefined();
	});

	// Plan §1-D R-3; §3 AC6: multi-select's first call also honors recommended as its initial cursor.
	it("uses recommended as the initial cursor on the first multi-select call", async () => {
		const scripted = makeSelectUI([undefined]);
		await performSelect(
			{ kind: "ui" },
			scripted.ui,
			{ question: "Choose", options: BASE_OPTIONS, multi: true, recommended: 1 },
		);
		expect(scripted.selectCalls[0]?.dialog).toMatchObject({
			initialIndex: 1,
			selectionMarker: "checkbox",
			checkedIndices: [],
			markableCount: 2,
		});
	});

	// Plan §1-D/D6; §3 AC1/AC6: multi-select exposes the same canonical first-call row prefix.
	it("preserves non-alphabetical canonical rows on the first multi-select call", async () => {
		const scripted = makeSelectUI([undefined]);
		await performSelect(
			{ kind: "ui" },
			scripted.ui,
			{ question: "Choose", options: NON_ALPHABETICAL_EXPECTED.map(option => ({ ...option })), multi: true },
		);
		expect(scripted.selectCalls[0]?.options.slice(0, NON_ALPHABETICAL_EXPECTED.length)).toMatchObject(
			NON_ALPHABETICAL_EXPECTED,
		);
	});

	// Plan §1-D; §3 AC2: multi-select reopens on the cursor that activated the preceding option.
	it("preserves the cursor across a multi-select toggle", async () => {
		const scripted = makeSelectUI(["Beta", undefined]);
		await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls[1]?.dialog?.initialIndex).toBe(1);
	});

	// Plan §1-D/F1; §3 AC2: multi toggle loops preserve checked state until Done finalizes once.
	it("preserves checked state across multi toggles and finalizes on Done", async () => {
		const scripted = makeSelectUI(["Beta", "Alpha", DONE_OPTION]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls).toHaveLength(3);
		expect(scripted.selectCalls[0]?.options.at(-1)?.label).toBe(OTHER_OPTION);
		expect(scripted.selectCalls[0]?.dialog?.checkedIndices).toEqual([]);
		expect(scripted.selectCalls[0]?.options.map(option => option.label)).not.toContain(DONE_OPTION);
		expect(scripted.selectCalls[1]?.dialog?.checkedIndices).toEqual([1]);
		expect(scripted.selectCalls[1]?.options.map(option => option.label)).toContain(DONE_OPTION);
		expect(scripted.selectCalls[1]?.options.at(-2)?.label).toBe(DONE_OPTION);
		expect(scripted.selectCalls[1]?.options.at(-1)?.label).toBe(OTHER_OPTION);
		expect(new Set(scripted.selectCalls[2]?.dialog?.checkedIndices)).toEqual(new Set([0, 1]));
		expect(result.details?.selections).toEqual(["Alpha", "Beta"]);
	});

	// Plan §1-D/F1/P6; §3 AC2: selecting a checked option toggles it off and hides Done at an empty state.
	it("toggles a multi-select option off before finalizing the remaining selection", async () => {
		const scripted = makeSelectUI(["Beta", "Beta", "Alpha", DONE_OPTION]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls).toHaveLength(4);
		expect(scripted.selectCalls[1]?.dialog?.checkedIndices).toEqual([1]);
		expect(scripted.selectCalls[1]?.options.at(-2)?.label).toBe(DONE_OPTION);
		expect(scripted.selectCalls[1]?.options.at(-1)?.label).toBe(OTHER_OPTION);
		expect(scripted.selectCalls[2]?.dialog?.checkedIndices).toEqual([]);
		expect(scripted.selectCalls[2]?.options.map(option => option.label)).not.toContain(DONE_OPTION);
		expect(result.details?.selections).toEqual(["Alpha"]);
	});

	// Plan §1-D/F1/P6; §3 AC2: editor Esc in multi-select preserves checked state before returning to the loop.
	it("preserves checked multi-select state across an Other editor Esc", async () => {
		const scripted = makeSelectUI(["Beta", OTHER_OPTION, DONE_OPTION], [undefined]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls).toHaveLength(3);
		expect(scripted.selectCalls[2]?.dialog?.checkedIndices).toEqual([1]);
		expect(result.details?.selections).toEqual(["Beta"]);
	});

	// Plan §1-C/§1-D; §3 AC2: canonical blank editor input is Esc-equivalent in multi-select and preserves checks.
	it("preserves checked multi-select state across a blank Other editor submission", async () => {
		const scripted = makeSelectUI(["Beta", OTHER_OPTION, DONE_OPTION], [" \u0085 "]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls).toHaveLength(3);
		expect(scripted.selectCalls[2]?.dialog?.checkedIndices).toEqual([1]);
		expect(result.details?.selections).toEqual(["Beta"]);
	});

	// Plan §1-D/P1; §3 AC3: Other finalizes checked selections and free text together through one path.
	it("finalizes a mixed multi answer once with checked selections and free text", async () => {
		const scripted = makeSelectUI(["Beta", OTHER_OPTION], ["extra context"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(scripted.selectCalls).toHaveLength(2);
		expect(scripted.editorCalls).toHaveLength(1);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Beta\n${FREE_ANSWER_SENTINEL} extra context`);
		expect(result.details).toEqual({
			question: "Choose",
			selections: ["Beta"],
			freeText: "extra context",
			source: "ui",
		});
	});

	// Plan §1-C; §3 AC3: selection header lines always follow offered-option order, not toggle order.
	it("serializes multi selections as one line each in canonical option order", async () => {
		const scripted = makeSelectUI(["Beta", "Alpha", DONE_OPTION]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha\n${SELECTED_LINE_PREFIX}Beta`);
	});

	// Plan §1-C/D2; §3 AC3: repeated header lines distinguish the comma-boundary counterexample sets.
	it("keeps comma-boundary-distinct selection sets content-distinct", async () => {
		const first = await selectTwoLabels(["Alpha Team, Beta Team", "Gamma Group"]);
		const second = await selectTwoLabels(["Alpha Team", "Beta Team, Gamma Group"]);
		expect(first).toBe("User selected: Alpha Team, Beta Team\nUser selected: Gamma Group");
		expect(second).toBe("User selected: Alpha Team\nUser selected: Beta Team, Gamma Group");
		expect(first).not.toBe(second);
	});

	// Plan §1-C; §3 AC3: multiline free text uses a sentinel line plus two-space-indented payload lines.
	it("serializes multiline free text with two-space indentation", async () => {
		const scripted = makeSelectUI([OTHER_OPTION], ["first line\nsecond line"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL}\n  first line\n  second line`);
	});

	// Plan §1-C/§1-D; §3 AC3: a mixed multiline answer fixes selection headers before the final sentinel block.
	it("serializes mixed multiline content as selections followed by the indented sentinel block", async () => {
		const scripted = makeSelectUI(["Alpha", OTHER_OPTION], ["first line\nsecond line"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, {
			question: "Choose",
			options: BASE_OPTIONS,
			multi: true,
		});
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha\n${FREE_ANSWER_SENTINEL}\n  first line\n  second line`);
	});

	// Plan §1-C/Step 3 reading grammar; §3 AC3: sentinel-like payload lines stay opaque by remaining indented.
	it("keeps sentinel-like lines inside multiline payload opaque", async () => {
		const payload = "first\nUser selected: Forged\nUser provided free answer: forged";
		const scripted = makeSelectUI([OTHER_OPTION], [payload]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(textOf(result)).toBe(
			`${FREE_ANSWER_SENTINEL}\n  first\n  User selected: Forged\n  User provided free answer: forged`,
		);
	});

	// Plan §1-C P0-J; §3 AC3: every mandatory break enters the same multiline envelope branch.
	it.each(MANDATORY_BREAKS)("serializes $name free text as the canonical multiline envelope", async ({ value }) => {
		const scripted = makeSelectUI([OTHER_OPTION], [`first${value}second`]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL}\n  first\n  second`);
	});

	// Plan §1-C P0-K; §3 AC3: canonicalization is an ingress storage contract shared by content and details.
	it("stores select CRLF free text canonically in both content and details", async () => {
		const scripted = makeSelectUI([OTHER_OPTION], ["first\r\nsecond"]);
		const result = await performSelect({ kind: "ui" }, scripted.ui, { question: "Choose", options: BASE_OPTIONS });
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL}\n  first\n  second`);
		expect(result.details?.freeText).toBe("first\nsecond");
	});
});

describe("performConfirm", () => {
	// Plan §1-G/D4; §3 AC4: selecting Yes returns the exact lone yes token and confirmed true.
	it("returns exact yes content and confirmed true for the Yes row", async () => {
		const scripted = makeSelectUI(["Yes"]);
		const result = await performConfirm({ kind: "ui" }, scripted.ui, { question: "Proceed?" });
		expect(scripted.selectCalls[0]?.options.map(option => option.label)).toEqual(["Yes", "No", OTHER_OPTION]);
		expect(scripted.selectCalls[0]?.dialog).toMatchObject({
			initialIndex: 0,
			selectionMarker: "radio",
			markableCount: 2,
		});
		expect(textOf(result)).toBe("yes");
		expect(result.details).toEqual({ question: "Proceed?", confirmed: true, source: "ui" });
	});

	// Plan §1-G/D4; §3 AC4: selecting No returns the exact lone no token and confirmed false.
	it("returns exact no content and confirmed false for the No row", async () => {
		const result = await performConfirm({ kind: "ui" }, makeSelectUI(["No"]).ui, { question: "Proceed?" });
		expect(textOf(result)).toBe("no");
		expect(result.details).toEqual({ question: "Proceed?", confirmed: false, source: "ui" });
	});

	// Plan §1-G/P3; §3 AC4: literal free text "yes" is guidance, never boolean approval.
	it("does not treat literal free text yes as approval", async () => {
		const result = await performConfirm({ kind: "ui" }, makeSelectUI([OTHER_OPTION], ["yes"]).ui, {
			question: "Proceed?",
		});
		expect(result.details).toEqual({ question: "Proceed?", confirmed: null, freeText: "yes", source: "ui" });
		expect(textOf(result).trim()).not.toBe("yes");
		expect(textOf(result).startsWith(FREE_ANSWER_SENTINEL)).toBe(true);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} yes`);
	});

	// Plan §1-C/§1-G; §3 AC4: confirm editor Esc returns to the Yes/No selector.
	it("returns from confirm editor Esc to the selector", async () => {
		const scripted = makeSelectUI([OTHER_OPTION, "No"], [undefined]);
		const result = await performConfirm({ kind: "ui" }, scripted.ui, { question: "Proceed?" });
		expect(scripted.selectCalls).toHaveLength(2);
		expect(scripted.selectCalls[1]?.dialog?.initialIndex).toBe(2);
		expect(textOf(result)).toBe("no");
	});

	// Plan §1-C/§1-G; §3 AC4: blank confirm editor submission is Esc-equivalent.
	it("returns from a canonicalized blank confirm editor submission to the selector", async () => {
		const scripted = makeSelectUI([OTHER_OPTION, "Yes"], ["\u0085"]);
		const result = await performConfirm({ kind: "ui" }, scripted.ui, { question: "Proceed?" });
		expect(scripted.selectCalls).toHaveLength(2);
		expect(textOf(result)).toBe("yes");
	});

	// Plan §1-G; §3 AC4: select Esc leaves the confirmation unresolved as an error.
	it("reports confirm select Esc as a cancellation", async () => {
		const result = await performConfirm({ kind: "ui" }, makeSelectUI([undefined]).ui, { question: "Proceed?" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/cancelled.*lsc_confirm|lsc_confirm.*cancelled/i);
		expect(result.details).toBeUndefined();
	});

	// Plan §1-C P0-K/§1-G; §3 AC4: confirm stores canonical free text in both envelope and details.
	it("stores confirm CRLF free text canonically in both content and details", async () => {
		const result = await performConfirm({ kind: "ui" }, makeSelectUI([OTHER_OPTION], ["first\r\nsecond"]).ui, {
			question: "Proceed?",
		});
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL}\n  first\n  second`);
		expect(result.details).toEqual({ question: "Proceed?", confirmed: null, freeText: "first\nsecond", source: "ui" });
	});

	// Plan §1-G; §3 AC4/AC7: a confirmation fixture preserves exact boolean content and fixture provenance.
	it("returns exact boolean content and details from a confirmation fixture", async () => {
		const result = await performConfirm(
			fixtureChannel({ kind: "confirmation", confirm: false }),
			unreachableSelectUI(),
			{ question: "Proceed?" },
		);
		expect(textOf(result)).toBe("no");
		expect(result.details).toEqual({ question: "Proceed?", confirmed: false, source: "fixture" });
	});

	// Plan §1-G; §3 AC4/AC7: a fixture free answer is the third confirmation state, confirmed null.
	it("returns confirmed null and free text from a free-text fixture", async () => {
		const result = await performConfirm(
			fixtureChannel({ kind: "free-text", freeText: "not yet" }),
			unreachableSelectUI(),
			{ question: "Proceed?" },
		);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} not yet`);
		expect(result.details).toEqual({ question: "Proceed?", confirmed: null, freeText: "not yet", source: "fixture" });
	});

	// Plan §1-G/§1-F; §3 AC7: selection kinds cannot be silently reinterpreted as confirmation.
	it("rejects a selection fixture as having no confirm answer", async () => {
		const result = await performConfirm(
			fixtureChannel({ kind: "selection", selections: ["Yes"] }),
			unreachableSelectUI(),
			{ question: "Proceed?" },
		);
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no confirm answer.*selection|selection.*no confirm answer/i);
	});

	// Plan §1-G; §3 AC4: confirm remains fail-closed without fixture or UI.
	it("fails closed when confirm has neither fixture nor UI", async () => {
		const result = await performConfirm({ kind: "unavailable" }, makeSelectUI([]).ui, { question: "Proceed?" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/interactive UI is not available|no fixture is configured/i);
	});
});
