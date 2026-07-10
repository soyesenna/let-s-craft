import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	FixtureAnswerSet,
	LSC_FIXTURE_ENV,
	LSC_FIXTURE_FLAG,
	detectFixturePath,
	getFixtureAnswerSet,
	loadFixtureAnswerFile,
	matchFixtureAnswer,
	matchesRule,
	parseFixtureAnswerFile,
	resetFixtureCache,
} from "../src/fixtures";

const tempDirs: string[] = [];
afterEach(() => {
	resetFixtureCache();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpAnswersFile(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-fixtures-"));
	tempDirs.push(dir);
	const path = join(dir, "answers.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}

describe("matchesRule", () => {
	it("matches a plain substring", () => {
		expect(matchesRule("feature name", "What is the feature name?")).toBe(true);
		expect(matchesRule("feature name", "Something unrelated")).toBe(false);
	});

	it("matches a regex pattern", () => {
		expect(matchesRule("feature.?name", "What's your featurename?")).toBe(true);
		expect(matchesRule("^Ready\\?$", "Ready?")).toBe(true);
		expect(matchesRule("^Ready\\?$", "Are you Ready?")).toBe(false);
	});

	it("falls back to substring matching when the pattern is not valid regex syntax", () => {
		// unbalanced bracket is invalid regex, but should still work as a literal substring
		expect(matchesRule("[unterminated", "text with [unterminated bracket")).toBe(true);
		expect(matchesRule("[unterminated", "no match here")).toBe(false);
	});
});

describe("parseFixtureAnswerFile", () => {
	it("parses a well-formed file", () => {
		const file = parseFixtureAnswerFile({ answers: [{ match: "a", response: "b" }], default: "d" }, "test.json");
		expect(file).toEqual({ answers: [{ match: "a", response: "b", once: undefined }], default: "d" });
	});

	it("ignores unknown top-level keys (e.g. a _note doc comment)", () => {
		const file = parseFixtureAnswerFile({ _note: "draft", answers: [], default: "d" }, "test.json");
		expect(file.default).toBe("d");
	});

	it("rejects a non-object payload", () => {
		expect(() => parseFixtureAnswerFile(["not", "an", "object"], "test.json")).toThrow(/must be a JSON object/);
	});

	it("rejects a missing answers array", () => {
		expect(() => parseFixtureAnswerFile({}, "test.json")).toThrow(/answers.*array/);
	});

	it("rejects an answer entry missing match", () => {
		expect(() => parseFixtureAnswerFile({ answers: [{ response: "b" }] }, "test.json")).toThrow(/answers\[0\]\.match/);
	});

	it("rejects an answer entry missing response", () => {
		expect(() => parseFixtureAnswerFile({ answers: [{ match: "a" }] }, "test.json")).toThrow(/answers\[0\]\.response/);
	});

	it("rejects a non-boolean once field", () => {
		expect(() => parseFixtureAnswerFile({ answers: [{ match: "a", response: "b", once: "yes" }] }, "test.json")).toThrow(/answers\[0\]\.once/);
	});

	it("rejects a non-string default", () => {
		expect(() => parseFixtureAnswerFile({ answers: [], default: 42 }, "test.json")).toThrow(/"default"/);
	});
});

describe("matchFixtureAnswer", () => {
	it("returns the first matching rule in declaration order", () => {
		const file = parseFixtureAnswerFile(
			{
				answers: [
					{ match: "feature", response: "first" },
					{ match: "feature name", response: "second" },
				],
			},
			"t.json",
		);
		const result = matchFixtureAnswer(file, "What is the feature name?", new Set());
		expect(result.response).toBe("first");
	});

	it("skips an already-consumed once rule", () => {
		const file = parseFixtureAnswerFile({ answers: [{ match: "hi", response: "once-answer", once: true }], default: "fallback" }, "t.json");
		const consumed = new Set([0]);
		const result = matchFixtureAnswer(file, "hi there", consumed);
		expect(result.response).toBe("fallback");
	});

	it("reports a consumeIndex only for once rules", () => {
		const file = parseFixtureAnswerFile(
			{
				answers: [
					{ match: "once-q", response: "a", once: true },
					{ match: "repeat-q", response: "b" },
				],
			},
			"t.json",
		);
		expect(matchFixtureAnswer(file, "once-q", new Set()).consumeIndex).toBe(0);
		expect(matchFixtureAnswer(file, "repeat-q", new Set()).consumeIndex).toBeUndefined();
	});

	it("falls back to default when nothing matches", () => {
		const file = parseFixtureAnswerFile({ answers: [{ match: "nope", response: "x" }], default: "the-default" }, "t.json");
		expect(matchFixtureAnswer(file, "totally unrelated", new Set()).response).toBe("the-default");
	});

	it("throws a clear error when nothing matches and there is no default", () => {
		const file = parseFixtureAnswerFile({ answers: [{ match: "nope", response: "x" }] }, "t.json");
		expect(() => matchFixtureAnswer(file, "totally unrelated", new Set())).toThrow(/no answer rule matched/);
	});
});

describe("FixtureAnswerSet", () => {
	it("consumes a once rule after its first match, then falls through to the next question", () => {
		const file = parseFixtureAnswerFile(
			{
				answers: [
					{ match: "confirm", response: "yes", once: true },
					{ match: "confirm", response: "no" },
				],
			},
			"t.json",
		);
		const set = new FixtureAnswerSet(file);
		expect(set.match("please confirm")).toBe("yes");
		expect(set.match("please confirm")).toBe("no");
		expect(set.match("please confirm")).toBe("no");
	});

	it("keeps independent consumption state per instance", () => {
		const file = parseFixtureAnswerFile({ answers: [{ match: "q", response: "once-answer", once: true }], default: "fallback" }, "t.json");
		const a = new FixtureAnswerSet(file);
		const b = new FixtureAnswerSet(file);
		expect(a.match("q")).toBe("once-answer");
		expect(b.match("q")).toBe("once-answer");
	});
});

describe("loadFixtureAnswerFile", () => {
	it("loads and validates a real file from disk", () => {
		const path = tmpAnswersFile({ answers: [{ match: "a", response: "b" }], default: "d" });
		const file = loadFixtureAnswerFile(path);
		expect(file.default).toBe("d");
		expect(file.answers).toHaveLength(1);
	});

	it("throws a clear error when the file does not exist", () => {
		expect(() => loadFixtureAnswerFile("/nonexistent/answers.json")).toThrow(/does not exist/);
	});

	it("throws a clear error on invalid JSON", () => {
		const dir = mkdtempSync(join(tmpdir(), "lsc-fixtures-badjson-"));
		tempDirs.push(dir);
		const path = join(dir, "answers.json");
		writeFileSync(path, "{ not valid json");
		expect(() => loadFixtureAnswerFile(path)).toThrow(/not valid JSON/);
	});
});

describe("detectFixturePath", () => {
	it("prefers the LSC_FIXTURE env var over the flag", () => {
		const env = { [LSC_FIXTURE_ENV]: "/from/env.json" };
		const getFlag = () => "/from/flag.json";
		expect(detectFixturePath(getFlag, env)).toBe("/from/env.json");
	});

	it("falls back to the flag when the env var is unset", () => {
		const getFlag = (name: string) => (name === LSC_FIXTURE_FLAG ? "/from/flag.json" : undefined);
		expect(detectFixturePath(getFlag, {})).toBe("/from/flag.json");
	});

	it("returns undefined when neither is set", () => {
		expect(detectFixturePath(() => undefined, {})).toBeUndefined();
	});

	it("ignores a boolean flag value (flag must carry a string path)", () => {
		const getFlag = () => true;
		expect(detectFixturePath(getFlag, {})).toBeUndefined();
	});
});

describe("getFixtureAnswerSet", () => {
	it("caches by path, preserving once-consumption state across calls", () => {
		const path = tmpAnswersFile({ answers: [{ match: "q", response: "first", once: true }], default: "fallback" });
		expect(getFixtureAnswerSet(path).match("q")).toBe("first");
		expect(getFixtureAnswerSet(path).match("q")).toBe("fallback");
	});

	it("reloads from disk after resetFixtureCache", () => {
		const path = tmpAnswersFile({ answers: [{ match: "q", response: "first", once: true }], default: "fallback" });
		expect(getFixtureAnswerSet(path).match("q")).toBe("first");
		resetFixtureCache();
		expect(getFixtureAnswerSet(path).match("q")).toBe("first");
	});
});
