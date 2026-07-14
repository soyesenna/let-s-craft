import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AskChannel,
	performAsk,
	performConfirm,
	performSelect,
	resolveSelectOption,
} from "../src/ask";
import {
	FixtureAnswerSet,
	LSC_FIXTURE_ENV,
	LSC_FIXTURE_FLAG,
	canonicalizeFreeText,
	detectFixturePath,
	getFixtureAnswerSet,
	loadFixtureAnswerFile,
	matchFixtureAnswer,
	matchesRule,
	parseFixtureAnswerFile,
	resetFixtureCache,
} from "../src/fixtures";

const tempDirs: string[] = [];
const canonicalAnswersPath = fileURLToPath(new URL("../fixtures/sample-ts-cli/answers.json", import.meta.url));

afterEach(() => {
	resetFixtureCache();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpAnswersFile(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-fixtures-v2-"));
	tempDirs.push(dir);
	const path = join(dir, "answers.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}

function fixtureSet(answers: ReadonlyArray<Record<string, unknown>>, defaultBody?: Record<string, unknown>): FixtureAnswerSet {
	return new FixtureAnswerSet(
		parseFixtureAnswerFile(
			{
				version: 2,
				answers,
				...(defaultBody === undefined ? {} : { default: defaultBody }),
			},
			"fixture-v2.json",
		),
	);
}

function errorMessage(action: () => unknown): string {
	try {
		action();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("expected action to throw");
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	const text = result.content[0]?.text;
	if (typeof text !== "string") throw new Error("expected a text tool result");
	return text;
}

const selectOptions = [
	{ label: "Alpha", description: "Choose the alpha path." },
	{ label: "Beta", description: "Choose the beta path." },
	{ label: "Gamma", description: "Choose the gamma path." },
];

const unreachableSelectUI = {
	select: async () => {
		throw new Error("ui.select must not run in fixture mode or before preflight succeeds");
	},
	editor: async () => {
		throw new Error("ui.editor must not run in fixture mode or before preflight succeeds");
	},
};

const unreachableEditorUI = {
	editor: async () => {
		throw new Error("ui.editor must not run in fixture mode");
	},
};

describe("parseFixtureAnswerFile v2", () => {
	const validBodies: ReadonlyArray<{ name: string; body: Record<string, unknown> }> = [
		{ name: "free-text", body: { kind: "free-text", freeText: "explain the constraint" } },
		{ name: "selection", body: { kind: "selection", selections: ["Alpha", "Beta"], freeText: "include both" } },
		{ name: "selection-index", body: { kind: "selection-index", optionIndex: 1 } },
		{ name: "confirmation", body: { kind: "confirmation", confirm: false } },
		// once:false는 생략과 동의미다: 규칙을 소진하지 않아 같은 질문에 다시 매칭할 수 있어야 한다.
		{ name: "confirmation with once false", body: { kind: "confirmation", confirm: true, once: false } },
	];

	// plan §3 AC7: response-semantic tagged union의 네 kind를 모두 정상 파싱해야 한다.
	it.each(validBodies)("parses a valid $name rule", ({ body }) => {
		const file = parseFixtureAnswerFile({ version: 2, answers: [{ match: "^question", once: true, ...body }] }, "valid.json");
		expect(file.version).toBe(2);
		expect(file.answers[0]).toMatchObject({ match: "^question", once: true, ...body });
	});

	interface CommonBoundaryCase {
		name: string;
		input: unknown;
		path: RegExp;
		expected: RegExp;
	}

	const commonBoundaryCases: ReadonlyArray<CommonBoundaryCase> = [
		{ name: "version other than 2", input: { version: 3, answers: [] }, path: /\bversion\b/i, expected: /\b2\b/ },
		{ name: "string version 2", input: { version: "2", answers: [] }, path: /\bversion\b/i, expected: /\b2\b/ },
		{
			name: "missing version with a v2-shaped body",
			input: { answers: [{ match: "q", kind: "confirmation", confirm: true }] },
			path: /\bversion\b/i,
			expected: /\b2\b/,
		},
		{ name: "missing answers", input: { version: 2 }, path: /\banswers\b/i, expected: /\barray\b/i },
		{ name: "non-array answers", input: { version: 2, answers: {} }, path: /\banswers\b/i, expected: /\barray\b/i },
		{ name: "non-object rule", input: { version: 2, answers: ["not-an-object"] }, path: /answers\[0\]/i, expected: /\bobject\b/i },
		{
			name: "rule without match",
			input: { version: 2, answers: [{ kind: "confirmation", confirm: true }] },
			path: /answers\[0\]\.match/i,
			expected: /\bstring\b/i,
		},
		{
			name: "rule with non-string match",
			input: { version: 2, answers: [{ match: 42, kind: "confirmation", confirm: true }] },
			path: /answers\[0\]\.match/i,
			expected: /\bstring\b/i,
		},
		{
			name: "rule with non-boolean once",
			input: { version: 2, answers: [{ match: "q", once: "true", kind: "confirmation", confirm: true }] },
			path: /answers\[0\]\.once/i,
			expected: /\bboolean\b/i,
		},
	];

	// plan §1-F/§3 AC7: v1 기준선의 공통 envelope 경계는 v2에서도 path-rich 진단과 함께 유지한다.
	it.each(commonBoundaryCases)("rejects $name with a path-rich error", ({ input, path, expected }) => {
		const message = errorMessage(() => parseFixtureAnswerFile(input, "common-boundary.json"));
		expect(message).toMatch(path);
		expect(message).toMatch(expected);
	});

	// plan §3 AC7: kind가 없는 v2 규칙은 허용 kind 진단과 함께 거부해야 한다.
	it("rejects a rule without kind", () => {
		const message = errorMessage(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", freeText: "answer" }] }, "missing-kind.json"));
		expect(message).toMatch(/answers\[0\].*kind/i);
		expect(message).toMatch(/free-text.*selection.*selection-index.*confirmation/i);
	});

	// plan §3 AC7: 미지 kind는 네 허용 kind를 열거하는 path-rich 오류여야 한다.
	it("rejects an unknown kind and lists every allowed kind", () => {
		const message = errorMessage(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "essay", freeText: "answer" }] }, "unknown-kind.json"));
		expect(message).toMatch(/answers\[0\].*kind/i);
		for (const kind of ["free-text", "selection", "selection-index", "confirmation"]) expect(message).toContain(kind);
	});

	// plan §3 AC7: rule exact allowlist 오류는 path, kind, 허용 키 목록을 모두 제공해야 한다.
	it("rejects an unknown nested rule key with path, kind, and allowed keys", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [{ match: "q", once: true, kind: "free-text", freeText: "answer", surprise: true }] },
				"nested-key.json",
			),
		);
		expect(message).toMatch(/answers\[0\]/);
		expect(message).toMatch(/free-text/i);
		for (const key of ["match", "once", "kind", "freeText"]) expect(message).toContain(key);
		expect(message).toContain("surprise");
	});

	// plan §3 AC7: version:2에 남은 response는 침묵 폐기하지 않고 v2 migration 안내를 병기해야 한다.
	it("rejects stale response in a v2 rule with migration guidance", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [{ match: "q", kind: "confirmation", confirm: true, response: "no" }] },
				"stale-response.json",
			),
		);
		expect(message).toMatch(/answers\[0\].*response/i);
		expect(message).toMatch(/v1|migrat|replaced/i);
		expect(message).toMatch(/kind.*selection.*free-text.*confirmation.*selection-index/i);
	});

	// plan §1-F/§3 AC7: top-level _-prefix metadata는 확장 이름도 관용한다.
	it("allows arbitrary top-level underscore-prefixed metadata", () => {
		const file = parseFixtureAnswerFile(
			{
				version: 2,
				_customMetadata: { owner: "ci" },
				_note: "human-readable comment",
				answers: [{ match: "q", kind: "confirmation", confirm: true }],
			},
			"metadata.json",
		);
		expect(file.answers).toHaveLength(1);
	});

	// plan §1-F/§3 AC7: _-prefix 관용은 top-level 전용이며 rule 내부에는 적용되지 않는다.
	it("rejects an underscore-prefixed key inside a rule", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [{ match: "q", kind: "confirmation", confirm: true, _customMetadata: "not allowed here" }] },
				"nested-metadata.json",
			),
		);
		expect(message).toMatch(/answers\[0\].*_customMetadata/i);
		expect(message).toMatch(/confirmation/i);
	});

	// plan §1-F/§3 AC7: top-level exact allowlist는 defualt 오타로 fallback이 소실되는 것을 막아야 한다.
	it("rejects a misspelled top-level defualt key", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [], defualt: { kind: "confirmation", confirm: true } },
				"typo.json",
			),
		);
		expect(message).toContain("defualt");
		for (const key of ["version", "answers", "default"]) expect(message).toContain(key);
	});

	interface ContradictionCase {
		kind: string;
		valid: Record<string, unknown>;
		foreignField: string;
		foreignValue: unknown;
	}

	const contradictions: ReadonlyArray<ContradictionCase> = [
		{ kind: "free-text", valid: { freeText: "answer" }, foreignField: "selections", foreignValue: ["Alpha"] },
		{ kind: "free-text", valid: { freeText: "answer" }, foreignField: "optionIndex", foreignValue: 0 },
		{ kind: "free-text", valid: { freeText: "answer" }, foreignField: "confirm", foreignValue: true },
		{ kind: "selection", valid: { selections: ["Alpha"] }, foreignField: "optionIndex", foreignValue: 0 },
		{ kind: "selection", valid: { selections: ["Alpha"] }, foreignField: "confirm", foreignValue: true },
		{ kind: "selection-index", valid: { optionIndex: 0 }, foreignField: "freeText", foreignValue: "answer" },
		{ kind: "selection-index", valid: { optionIndex: 0 }, foreignField: "selections", foreignValue: ["Alpha"] },
		{ kind: "selection-index", valid: { optionIndex: 0 }, foreignField: "confirm", foreignValue: true },
		{ kind: "confirmation", valid: { confirm: true }, foreignField: "freeText", foreignValue: "do not merge" },
		{ kind: "confirmation", valid: { confirm: true }, foreignField: "selections", foreignValue: ["No"] },
		{ kind: "confirmation", valid: { confirm: true }, foreignField: "optionIndex", foreignValue: 1 },
	];

	// plan §1-F/§3 AC7: 각 kind와 허용되지 않는 답 필드의 모든 11개 조합은 parse-time에 소거한다.
	it.each(contradictions)("rejects $kind combined with $foreignField", ({ kind, valid, foreignField, foreignValue }) => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [{ match: "q", kind, ...valid, [foreignField]: foreignValue }] },
				"contradiction.json",
			),
		);
		expect(message).toMatch(/answers\[0\]/);
		expect(message).toContain(kind);
		expect(message).toContain(foreignField);
	});

	// plan §1-F/§3 AC7: free-text kind는 freeText 필드를 필수로 요구한다.
	it("rejects free-text without freeText", () => {
		expect(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "free-text" }] }, "required.json")).toThrow(
			/answers\[0\]\.freeText/i,
		);
	});

	// plan §1-F/§3 AC7: selection kind는 비어 있지 않은 문자열 배열을 요구한다.
	it("rejects selection with an empty selections array", () => {
		expect(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "selection", selections: [] }] }, "required.json")).toThrow(
			/answers\[0\]\.selections.*non-empty|answers\[0\]\.selections.*at least/i,
		);
	});

	// plan §1-F/§3 AC7: selection의 모든 원소는 string이어야 한다.
	it("rejects a non-string selection member", () => {
		expect(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "selection", selections: ["Alpha", 2] }] }, "required.json")).toThrow(
			/answers\[0\]\.selections\[1\].*string/i,
		);
	});

	// plan §1-F/§3 AC7: selection-index는 음이 아닌 정수만 허용한다.
	it.each([-1, 0.5])("rejects invalid selection-index optionIndex %s", optionIndex => {
		expect(() =>
			parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "selection-index", optionIndex }] }, "required.json"),
		).toThrow(/answers\[0\]\.optionIndex.*non-negative integer/i);
	});

	// plan §1-F/§3 AC7: confirmation은 boolean confirm만 허용한다.
	it("rejects a non-boolean confirmation", () => {
		expect(() => parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "confirmation", confirm: "yes" }] }, "required.json")).toThrow(
			/answers\[0\]\.confirm.*boolean/i,
		);
	});

	interface BlankCase {
		name: string;
		value: string;
	}

	const blankValues: ReadonlyArray<BlankCase> = [
		{ name: "empty", value: "" },
		{ name: "whitespace-only", value: " \t  " },
		{ name: "NEL-only", value: "\u0085" },
	];

	// plan §1-F/§3 AC7: free-text rule은 canonicalize-then-trim 후 빈 세 입력 클래스를 모두 거부한다.
	it.each(blankValues)("rejects $name freeText in a free-text rule", ({ value }) => {
		expect(() =>
			parseFixtureAnswerFile({ version: 2, answers: [{ match: "q", kind: "free-text", freeText: value }] }, "blank.json"),
		).toThrow(/answers\[0\]\.freeText.*must not be blank/i);
	});

	// plan §1-F/§3 AC7: selection의 optional freeText에도 같은 nonblank predicate가 적용된다.
	it.each(blankValues)("rejects $name freeText in a selection rule", ({ value }) => {
		expect(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [{ match: "q", kind: "selection", selections: ["Alpha"], freeText: value }] },
				"blank.json",
			),
		).toThrow(/answers\[0\]\.freeText.*must not be blank/i);
	});

	// plan §1-C/§1-F/§3 AC7: CRLF와 mandatory break를 canonical \n으로 바꾼 값을 rule에 저장한다.
	it("stores canonical freeText in a free-text rule", () => {
		const file = parseFixtureAnswerFile(
			{ version: 2, answers: [{ match: "q", kind: "free-text", freeText: "first\r\nsecond\u0085third\u2028fourth" }] },
			"canonical.json",
		);
		const answer = file.answers[0];
		if (answer.kind !== "free-text") throw new Error("expected free-text rule");
		expect(answer.freeText).toBe("first\nsecond\nthird\nfourth");
	});

	// plan §1-C/§1-F/§3 AC7: selection의 optional freeText도 raw CRLF가 아니라 canonical 값으로 저장한다.
	it("stores canonical freeText in a selection rule", () => {
		const file = parseFixtureAnswerFile(
			{ version: 2, answers: [{ match: "q", kind: "selection", selections: ["Alpha"], freeText: "note\r\nnext" }] },
			"canonical.json",
		);
		const answer = file.answers[0];
		if (answer.kind !== "selection") throw new Error("expected selection rule");
		expect(answer.freeText).toBe("note\nnext");
	});

	// plan §1-C/§3 AC7/AC10: canonicalizer는 모든 mandatory break에 대해 멱등이어야 한다.
	it("canonicalizes CRLF first and remains idempotent", () => {
		const raw = "a\r\nb\rc\nd\ve\ff\u0085g\u2028h\u2029i";
		const once = canonicalizeFreeText(raw);
		expect(once).toBe("a\nb\nc\nd\ne\nf\ng\nh\ni");
		expect(canonicalizeFreeText(once)).toBe(once);
	});

	// plan §1-F/§3 AC7: version 없는 response 규칙은 v1을 특정하는 migration 오류여야 한다.
	it("reports a targeted v1 migration error for a versionless response rule", () => {
		const message = errorMessage(() => parseFixtureAnswerFile({ answers: [{ match: "q", response: "yes" }] }, "v1.json"));
		expect(message).toMatch(/v1 format detected/i);
		expect(message).toMatch(/response.*replaced.*v2/i);
		expect(message).toMatch(/version.*2/i);
	});

	// plan §1-F/§3 AC7: version:1 response 규칙도 일반 version 오류가 아니라 v1 migration 경로를 탄다.
	it("reports a targeted v1 migration error for an explicit version 1 file", () => {
		const message = errorMessage(() => parseFixtureAnswerFile({ version: 1, answers: [{ match: "q", response: "no" }] }, "v1.json"));
		expect(message).toMatch(/v1 format detected/i);
		expect(message).toMatch(/kind.*selection.*free-text.*confirmation.*selection-index/i);
	});

	// plan §1-F/§3 AC7: string default는 v1 형식 감지 신호다.
	it("reports a targeted v1 migration error for a string default", () => {
		const message = errorMessage(() => parseFixtureAnswerFile({ answers: [], default: "yes" }, "v1-default.json"));
		expect(message).toMatch(/v1 format detected/i);
		expect(message).toMatch(/default|response/i);
	});

	// plan §1-F/§3 AC7: v2 default는 free-text를 제외한 kind+variant body만 정상 파싱한다.
	it.each([
		{ name: "selection", body: { kind: "selection", selections: ["Alpha"] } },
		{ name: "selection-index", body: { kind: "selection-index", optionIndex: 0 } },
		{ name: "confirmation", body: { kind: "confirmation", confirm: true } },
	])("parses a $name default body", ({ body }) => {
		const file = parseFixtureAnswerFile({ version: 2, answers: [], default: body }, "default.json");
		expect(file.default).toEqual(body);
	});

	// plan §1-F/§3 AC7: default에는 rule 전용 match 키가 존재할 수 없다.
	it("rejects match on default", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [], default: { match: ".*", kind: "confirmation", confirm: true } },
				"default.json",
			),
		);
		expect(message).toMatch(/default.*match/i);
		expect(message).toMatch(/confirmation/i);
	});

	// plan §1-F/§3 AC7: default에는 rule 전용 once 키가 존재할 수 없다.
	it("rejects once on default", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile(
				{ version: 2, answers: [], default: { once: true, kind: "confirmation", confirm: true } },
				"default.json",
			),
		);
		expect(message).toMatch(/default.*once/i);
		expect(message).toMatch(/confirmation/i);
	});

	// plan §1-F/§3 AC7: free-text default는 재발문 루프를 막기 위해 explicit once rule 안내와 함께 거부한다.
	it("rejects a free-text default and points to an explicit once rule", () => {
		const message = errorMessage(() =>
			parseFixtureAnswerFile({ version: 2, answers: [], default: { kind: "free-text", freeText: "continue" } }, "default.json"),
		);
		expect(message).toMatch(/default.*free-text/i);
		expect(message).toMatch(/explicit.*match.*once.*true|match rule.*once:true/i);
	});
});

describe("fixture matching semantics", () => {
	// plan §1-F/§3 AC7: tag regex는 질문 시작의 bracketed tag만 prefix-match한다.
	it("keeps bracketed tag prefix matching anchored", () => {
		expect(matchesRule("^\\[Goal\\]", "[Goal] What outcome matters?")).toBe(true);
		expect(matchesRule("^\\[Goal\\]", "Prefix [Goal] must not match")).toBe(false);
	});

	// plan §1-F/§3 AC7: invalid regex는 case-insensitive literal substring fallback을 유지한다.
	it("falls back to literal substring matching for invalid regex syntax", () => {
		expect(matchesRule("[unterminated", "Text with [UNTERMINATED marker")).toBe(true);
		expect(matchesRule("[unterminated", "No marker")).toBe(false);
	});

	// plan §1-F/§3 AC7: first-hit 선언 순서는 tagged body에서도 불변이다.
	it("returns the first matching rule in declaration order", () => {
		const file = parseFixtureAnswerFile(
			{
				version: 2,
				answers: [
					{ match: "feature", kind: "free-text", freeText: "first" },
					{ match: "feature name", kind: "free-text", freeText: "second" },
				],
			},
			"order.json",
		);
		expect(matchFixtureAnswer(file, "What is the feature name?", new Set())).toMatchObject({ kind: "free-text", freeText: "first" });
	});

	// plan §1-F/§3 AC7: once rule은 첫 match 뒤 소진되어 다음 선언 규칙으로 fall through한다.
	it("consumes a once rule after its first match", () => {
		const set = fixtureSet([
			{ match: "confirm", once: true, kind: "confirmation", confirm: true },
			{ match: "confirm", kind: "confirmation", confirm: false },
		]);
		expect(set.match("please confirm")).toEqual({ kind: "confirmation", confirm: true });
		expect(set.match("please confirm")).toEqual({ kind: "confirmation", confirm: false });
		expect(set.match("please confirm")).toEqual({ kind: "confirmation", confirm: false });
	});

	// plan §1-F/§3 AC7: once 소비 상태는 FixtureAnswerSet instance별로 독립이다.
	it("keeps once consumption state independent per answer set", () => {
		const file = parseFixtureAnswerFile(
			{ version: 2, answers: [{ match: "q", once: true, kind: "selection-index", optionIndex: 1 }], default: { kind: "confirmation", confirm: false } },
			"state.json",
		);
		const first = new FixtureAnswerSet(file);
		const second = new FixtureAnswerSet(file);
		expect(first.match("q")).toEqual({ kind: "selection-index", optionIndex: 1 });
		expect(second.match("q")).toEqual({ kind: "selection-index", optionIndex: 1 });
	});

	// plan §1-F/§3 AC7: 소진된 once rule 뒤에는 typed default body가 사용된다.
	it("falls back to the tagged default after a once rule is consumed", () => {
		const set = fixtureSet([{ match: "q", once: true, kind: "selection", selections: ["Alpha"] }], {
			kind: "confirmation",
			confirm: false,
		});
		expect(set.match("q")).toEqual({ kind: "selection", selections: ["Alpha"] });
		expect(set.match("q")).toEqual({ kind: "confirmation", confirm: false });
	});

	// plan §1-F/§3 AC7: no-match/default 부재는 hang 대신 명확한 hard error다.
	it("throws when no rule matches and no default exists", () => {
		const set = fixtureSet([{ match: "different", kind: "confirmation", confirm: true }]);
		expect(() => set.match("question")).toThrow(/no answer rule matched.*no "default"/i);
	});
});

describe("fixture file loading and channel detection", () => {
	// plan §1-F/§3 AC7: loadFixtureAnswerFile은 disk의 v2 body를 검증·정규화한다.
	it("loads and validates a v2 file from disk", () => {
		const path = tmpAnswersFile({
			version: 2,
			answers: [{ match: "q", kind: "free-text", freeText: "line one\r\nline two" }],
			default: { kind: "confirmation", confirm: true },
		});
		const file = loadFixtureAnswerFile(path);
		const answer = file.answers[0];
		if (answer.kind !== "free-text") throw new Error("expected free-text rule");
		expect(answer.freeText).toBe("line one\nline two");
	});

	// plan §1-F/§3 AC7: 존재하지 않는 fixture 파일은 명확히 실패한다.
	it("reports a missing fixture file", () => {
		expect(() => loadFixtureAnswerFile("/nonexistent/answers-v2.json")).toThrow(/does not exist/);
	});

	// plan §1-F/§3 AC7: malformed JSON은 parse validation 전에 JSON 오류로 보고한다.
	it("reports malformed fixture JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-fixtures-bad-json-"));
		tempDirs.push(dir);
		const path = join(dir, "answers.json");
		writeFileSync(path, "{ not valid json");
		expect(() => loadFixtureAnswerFile(path)).toThrow(/not valid JSON/);
	});

	// plan §1-F/§3 AC7: LSC_FIXTURE env는 flag보다 우선한다.
	it("prefers the LSC_FIXTURE environment path over the CLI flag", () => {
		expect(detectFixturePath(() => "/flag.json", { [LSC_FIXTURE_ENV]: "/env.json" })).toBe("/env.json");
	});

	// plan §1-F/§3 AC7: env가 없으면 string flag path를 사용한다.
	it("uses the fixture flag when the environment path is absent", () => {
		const getFlag = (name: string) => (name === LSC_FIXTURE_FLAG ? "/flag.json" : undefined);
		expect(detectFixturePath(getFlag, {})).toBe("/flag.json");
	});

	// plan §1-F/§3 AC7: boolean flag는 경로가 아니므로 fixture mode를 활성화하지 않는다.
	it("ignores a boolean fixture flag", () => {
		expect(detectFixturePath(() => true, {})).toBeUndefined();
	});

	// plan §1-F/§3 AC7: path cache는 once 소비 상태를 같은 파일 경로에서 보존한다.
	it("caches once consumption state by fixture path", () => {
		const path = tmpAnswersFile({
			version: 2,
			answers: [{ match: "q", once: true, kind: "selection", selections: ["first"] }],
			default: { kind: "selection", selections: ["fallback"] },
		});
		expect(getFixtureAnswerSet(path).match("q")).toEqual({ kind: "selection", selections: ["first"] });
		expect(getFixtureAnswerSet(path).match("q")).toEqual({ kind: "selection", selections: ["fallback"] });
	});

	// plan §1-F/§3 AC7: resetFixtureCache는 같은 파일의 once 상태를 초기화한다.
	it("reloads once state after resetFixtureCache", () => {
		const path = tmpAnswersFile({
			version: 2,
			answers: [{ match: "q", once: true, kind: "selection-index", optionIndex: 0 }],
			default: { kind: "confirmation", confirm: false },
		});
		expect(getFixtureAnswerSet(path).match("q")).toEqual({ kind: "selection-index", optionIndex: 0 });
		resetFixtureCache();
		expect(getFixtureAnswerSet(path).match("q")).toEqual({ kind: "selection-index", optionIndex: 0 });
	});
});

describe("canonical sample fixture snapshot", () => {
	const interviewAnswers = [
		{
			tag: "Feature Name",
			question: "[Feature Name] Describe the feature.",
			freeText:
				"Fix slugify so it collapses consecutive non-alphanumeric separators into a single hyphen and trims leading/trailing hyphens, matching the behavior already documented in src/slugify.ts's bug note.",
		},
		{
			tag: "Goal",
			question: "[Goal] What outcome matters?",
			freeText:
				"Fix slugify so it collapses consecutive non-alphanumeric separators into a single hyphen and trims leading/trailing hyphens, matching the behavior already documented in src/slugify.ts's bug note.",
		},
		{
			tag: "Constraints",
			question: "[Constraints] What boundaries apply?",
			freeText: "Keep the CLI dependency-free (node --test only) and keep slugify/capitalize/truncate's public signatures unchanged.",
		},
		{
			tag: "Success Criteria",
			question: "[Success Criteria] How will success be verified?",
			freeText: "All tests under test/ pass via run_test.sh, including the currently-failing 'collapses consecutive separators' case in test/slugify.test.ts.",
		},
		{
			tag: "Context",
			question: "[Context] What existing code is relevant?",
			freeText:
				"The bug is isolated to slugify() in src/slugify.ts; capitalize() and truncate() in src/text-utils.ts and the CLI wiring in src/cli.ts are unaffected and already covered by their own passing tests.",
		},
	] as const;

	function canonicalAnswerSet(): FixtureAnswerSet {
		return new FixtureAnswerSet(loadFixtureAnswerFile(canonicalAnswersPath));
	}

	// plan §2 Step 2/§3 AC7: sync된 canonical answers.json 자체가 v2 parser를 통과해야 한다.
	it("loads the canonical sample answers.json from disk", () => {
		expect(loadFixtureAnswerFile(canonicalAnswersPath).version).toBe(2);
	});

	// plan §2 Step 2/§3 AC7: v1의 다섯 인터뷰 응답 본문은 v2 free-text로 byte-exact 보존한다.
	it.each(interviewAnswers)("preserves the v1 $tag free-text body exactly", ({ question, freeText }) => {
		expect(canonicalAnswerSet().match(question)).toEqual({ kind: "free-text", freeText });
	});

	// plan §2 Step 2/§3 AC7: specific escalation rule은 같은 Proceed? suffix의 generic confirmation보다 먼저 선택된다.
	it("matches Consensus Escalation as the canonical selection before generic Proceed", () => {
		expect(canonicalAnswerSet().match("[Consensus Escalation] Consensus was not reached. Proceed?")).toEqual({
			kind: "selection",
			selections: ["Proceed with current version"],
		});
	});

	// plan §2 Step 2/§3 AC7: Spec/Plan Change 태그는 generic Proceed 규칙보다 먼저 exact label selection으로 해석한다.
	it.each([{ tag: "Spec Change" }, { tag: "Plan Change" }])(
		"matches $tag as the canonical selection before generic Proceed",
		({ tag }) => {
			expect(canonicalAnswerSet().match(`[${tag}] Apply this proposed change? Proceed?`)).toEqual({
				kind: "selection",
				selections: ["Accept — apply to spec.md/plan.md"],
			});
		},
	);

	// plan §1-F/§2 Step 2: 대문자 Proceed?도 case-insensitive generic confirmation 규칙으로 매칭한다.
	it("matches a generic capitalized Proceed question as confirmation true", () => {
		expect(canonicalAnswerSet().match("Continue with the current stage? Proceed?")).toEqual({
			kind: "confirmation",
			confirm: true,
		});
	});

	// plan §1-F/§2 Step 2: 어떤 규칙에도 맞지 않는 질문은 canonical confirmation default를 사용한다.
	it("uses confirmation true for an unmatched question", () => {
		expect(canonicalAnswerSet().match("[Land] Merge the implementation?")).toEqual({
			kind: "confirmation",
			confirm: true,
		});
	});
});

describe("performX fixture integration", () => {
	// plan §1-D/§3 AC3/AC7: free-text select fixture는 canonical multiline envelope와 selections:[] details를 만든다.
	it("maps free-text to select free-answer envelope and details", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "free-text", freeText: "line one\r\nline two" }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User provided free answer:\n  line one\n  line two");
		expect(result.details).toEqual({ question: "choose", selections: [], freeText: "line one\nline two", source: "fixture" });
	});

	// plan §1-D/§3 AC2/AC3: multi에서도 checked 항목 없이 free-text fixture만으로 exact free-answer 결과를 확정한다.
	it("maps multi free-text with zero selections to only the free-answer envelope", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "free-text", freeText: "fixture-only answer" }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, {
			question: "choose",
			options: selectOptions,
			multi: true,
		});
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User provided free answer: fixture-only answer");
		expect(result.details).toEqual({
			question: "choose",
			selections: [],
			freeText: "fixture-only answer",
			source: "fixture",
		});
	});

	// plan §1-G/§3 AC4/AC7: free-text confirm fixture는 confirmed:null이며 승인/거절이 아닌 sentinel이다.
	it("maps free-text to confirm null details and sentinel content", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", kind: "free-text", freeText: "yes" }]) };
		const result = await performConfirm(channel, unreachableSelectUI, { question: "proceed" });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User provided free answer: yes");
		expect(textOf(result).trim()).not.toBe("yes");
		expect(result.details).toEqual({ question: "proceed", confirmed: null, freeText: "yes", source: "fixture" });
	});

	// plan §1-H/§3 AC5/AC7: free-text ask fixture는 canonical body를 기존 response/content 계약으로 소비한다.
	it("maps free-text to the ask response contract", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "explain", kind: "free-text", freeText: "first\r\nsecond" }]) };
		const result = await performAsk(channel, unreachableEditorUI, { question: "explain" });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("first\nsecond");
		expect(result.details).toEqual({ question: "explain", response: "first\nsecond", source: "fixture" });
	});

	// plan §1-D/§3 AC3/AC7: single selection은 정확히 하나의 canonical label을 envelope/details에 보존한다.
	it("maps one selection to a single canonical selection line", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["alpha"] }]) };
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User selected: Alpha");
		expect(result.details).toEqual({ question: "choose", selections: ["Alpha"], source: "fixture" });
	});

	// plan §1-D/§3 AC7: single select에서 selections 2개는 침묵 절삭하지 않고 오류다.
	it("rejects two fixture selections for a single select", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["Alpha", "Beta"] }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/single.*exactly one|exactly one.*single/i);
	});

	// plan §1-D/§3 AC7: single select에서 selection+freeText는 UI 불가능 조합이므로 소비 단계에서 오류다.
	it("rejects selection plus freeText for a single select", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["Alpha"], freeText: "also do this" }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/single.*freeText|freeText.*single/i);
	});

	// plan §1-D/§3 AC3/AC7: multi selection은 각 원소를 해석하고 option 순서 뒤 sentinel을 고정 직렬화한다.
	it("maps multi selection plus freeText in canonical option order", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["beta", "ALPHA"], freeText: "include rationale" }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, {
			question: "choose",
			options: selectOptions,
			multi: true,
		});
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User selected: Alpha\nUser selected: Beta\nUser provided free answer: include rationale");
		expect(result.details).toEqual({
			question: "choose",
			selections: ["Alpha", "Beta"],
			freeText: "include rationale",
			source: "fixture",
		});
	});

	// plan §1-D/§3 AC7: multi 원소 해석은 첫 실패에서 중단하고 해당 원소를 진단한다.
	it("fails fast on the first unresolved multi selection", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["Missing first", "Missing second"] }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions, multi: true });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toContain("Missing first");
		expect(textOf(result)).not.toContain("Missing second");
	});

	// plan §1-D/§3 AC7: 서로 다른 tier 입력이 같은 canonical label로 해석되면 multi 중복 오류다.
	it("rejects duplicate canonical selections in multi mode", async () => {
		const channel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["Alpha", "ALPHA"] }]),
		};
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions, multi: true });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/duplicate.*Alpha|Alpha.*duplicate/i);
	});

	// plan §1-D/§3 AC7: selection-index는 single select의 정본 label을 직접 고른다.
	it("maps selection-index for single select", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "choose", kind: "selection-index", optionIndex: 1 }]) };
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe("User selected: Beta");
		expect(result.details).toEqual({ question: "choose", selections: ["Beta"], source: "fixture" });
	});

	// plan §1-D/§3 AC7: selection-index는 multi select에서 작성 오류로 거부한다.
	it("rejects selection-index for multi select", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "choose", kind: "selection-index", optionIndex: 1 }]) };
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions, multi: true });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/selection-index.*multi|multi.*selection-index/i);
	});

	// plan §1-D/§3 AC7: 범위 밖 selection-index는 clamp하지 않고 명시 오류다.
	it("rejects an out-of-range selection-index", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "choose", kind: "selection-index", optionIndex: 9 }]) };
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/optionIndex.*range|out of range/i);
	});

	// plan §1-G/§3 AC4/AC7: confirmation kind true/false는 정확 yes/no content만 만든다.
	it.each([
		{ confirm: true, expected: "yes" },
		{ confirm: false, expected: "no" },
	])("maps confirmation $confirm to exact $expected content", async ({ confirm, expected }) => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", kind: "confirmation", confirm }]) };
		const result = await performConfirm(channel, unreachableSelectUI, { question: "proceed" });
		expect(result.isError).toBeFalsy();
		expect(textOf(result)).toBe(expected);
		expect(result.details).toEqual({ question: "proceed", confirmed: confirm, source: "fixture" });
	});

	// plan §1-D/§3 AC7: confirmation body는 select 답으로 오해되지 않는다.
	it("rejects confirmation kind when consumed by select", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "choose", kind: "confirmation", confirm: true }]) };
		const result = await performSelect(channel, unreachableSelectUI, { question: "choose", options: selectOptions });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no select answer.*confirmation/i);
	});

	// plan §1-G/§3 AC7: selection body는 confirm 답으로 오해되지 않는다.
	it("rejects selection kind when consumed by confirm", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", kind: "selection", selections: ["Alpha"] }]) };
		const result = await performConfirm(channel, unreachableSelectUI, { question: "proceed" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no confirm answer.*selection/i);
	});

	// plan §1-G/§3 AC7: selection-index body도 confirm 답으로 오해되지 않는다.
	it("rejects selection-index kind when consumed by confirm", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", kind: "selection-index", optionIndex: 0 }]) };
		const result = await performConfirm(channel, unreachableSelectUI, { question: "proceed" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no confirm answer.*selection-index/i);
	});

	// plan §1-H/§3 AC7: selection body는 free-text ask 답으로 오해되지 않는다.
	it("rejects selection kind when consumed by ask", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "explain", kind: "selection", selections: ["Alpha"] }]) };
		const result = await performAsk(channel, unreachableEditorUI, { question: "explain" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no free-text answer.*selection/i);
	});

	// plan §1-H/§3 AC7: confirmation body는 free-text ask 답으로 오해되지 않는다.
	it("rejects confirmation kind when consumed by ask", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "explain", kind: "confirmation", confirm: false }]) };
		const result = await performAsk(channel, unreachableEditorUI, { question: "explain" });
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no free-text answer.*confirmation/i);
	});

	// plan §1-E/§3 AC7: resolveSelectOption v2의 tier 1은 exact canonical label을 반환한다.
	it("resolveSelectOption tier 1 returns an exact label", () => {
		expect(resolveSelectOption("Alpha", ["Alpha", "Beta"])).toBe("Alpha");
	});

	// plan §1-E/§3 AC7: resolveSelectOption v2의 tier 2는 case-insensitive canonical label을 반환한다.
	it("resolveSelectOption tier 2 returns the canonical case", () => {
		expect(resolveSelectOption("bEtA", ["Alpha", "Beta"])).toBe("Beta");
	});

	// plan §1-E/§3 AC7: resolveSelectOption v2의 tier 3은 유일한 whole-word containment만 허용한다.
	it("resolveSelectOption tier 3 resolves unique whole-word containment", () => {
		expect(resolveSelectOption("Please choose Beta for this gate", ["Alpha", "Beta"])).toBe("Beta");
	});

	// plan §1-E/§3 AC7: ambiguous containment는 guess하지 않는다.
	it("resolveSelectOption rejects ambiguous containment", () => {
		expect(resolveSelectOption("Alpha or Beta both work", ["Alpha", "Beta"])).toBeUndefined();
	});

	// plan §1-E/§3 AC1/AC7: description은 표시 전용이므로 tier matching 입력에 참여하지 않는다.
	it("resolveSelectOption does not match description text", () => {
		const options = [
			{ label: "Alpha", description: "Hidden rationale phrase" },
			{ label: "Beta", description: "Alternative" },
		];
		expect(resolveSelectOption("Hidden rationale phrase", options.map(option => option.label))).toBeUndefined();
	});

	// plan §1-C/§3 AC1 + §13 R-1: U+0085-only description은 UI/fixture dispatch 전 같은 preflight 오류를 낸다.
	it("applies identical NEL-only description preflight to UI and fixture channels", async () => {
		const invalidOptions = [
			{ label: "Alpha", description: "\u0085" },
			{ label: "Beta", description: "Valid description" },
		];
		const fixtureChannel: AskChannel = {
			kind: "fixture",
			answers: fixtureSet([{ match: "choose", kind: "selection", selections: ["Alpha"] }]),
		};
		const fixtureResult = await performSelect(fixtureChannel, unreachableSelectUI, { question: "choose", options: invalidOptions });
		const uiResult = await performSelect({ kind: "ui" }, unreachableSelectUI, { question: "choose", options: invalidOptions });
		expect(fixtureResult.isError).toBe(true);
		expect(uiResult.isError).toBe(true);
		expect(textOf(fixtureResult)).toBe(textOf(uiResult));
		expect(textOf(uiResult)).toMatch(/description.*blank/i);
	});

	// plan §1-C/§3 AC2/AC6 + §13 R-2: DONE_OPTION은 single select에서도 전역 reserved control row다.
	it.each(["Done (submit selections)", "done (SUBMIT SELECTIONS)"])("rejects reserved single-select DONE label %s", async reservedLabel => {
		const result = await performSelect({ kind: "ui" }, unreachableSelectUI, {
			question: "choose",
			options: [
				{ label: reservedLabel, description: "Must be rejected" },
				{ label: "Beta", description: "Valid option" },
			],
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/Done.*reserved control-row|reserved control-row.*Done/i);
	});
});
