import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type AskChannel, parseYesNo, performAsk, performConfirm, performSelect, resolveAskChannel } from "../src/ask";
import { FixtureAnswerSet, parseFixtureAnswerFile, resetFixtureCache } from "../src/fixtures";

function fixtureSet(answers: Array<{ match: string; response: string; once?: boolean }>, defaultResponse?: string): FixtureAnswerSet {
	return new FixtureAnswerSet(parseFixtureAnswerFile({ answers, default: defaultResponse }, "t.json"));
}

const tempDirs: string[] = [];
afterEach(() => {
	resetFixtureCache();
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpAnswersFile(content: unknown): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-ask-"));
	tempDirs.push(dir);
	const path = join(dir, "answers.json");
	writeFileSync(path, JSON.stringify(content));
	return path;
}

describe("resolveAskChannel", () => {
	it("picks fixture mode (and loads the answers file) whenever a fixture path was detected, regardless of hasUI", () => {
		const path = tmpAnswersFile({ answers: [], default: "d" });
		const channel = resolveAskChannel(path, true);
		expect(channel.kind).toBe("fixture");
	});

	it("picks ui mode when there is no fixture path and hasUI is true", () => {
		expect(resolveAskChannel(undefined, true)).toEqual({ kind: "ui" });
	});

	it("picks unavailable when there is no fixture path and hasUI is false (headless, no fixture)", () => {
		expect(resolveAskChannel(undefined, false)).toEqual({ kind: "unavailable" });
	});
});

describe("performAsk", () => {
	it("fixture mode: returns the scripted response without touching ui", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "feature name", response: "string-utils-fix" }]) };
		const ui = { input: async () => { throw new Error("ui.input must not be called in fixture mode"); } };
		const result = await performAsk(channel, ui, { question: "What is the feature name?" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({ type: "text", text: "string-utils-fix" });
		expect(result.details).toEqual({ question: "What is the feature name?", response: "string-utils-fix", source: "fixture" });
	});

	it("fixture mode: propagates a clear error when no rule matches and there is no default", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "nope", response: "x" }]) };
		const ui = { input: async () => "should not be called" };
		const result = await performAsk(channel, ui, { question: "unrelated question" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/no answer rule matched/);
	});

	it("ui mode: delegates to ctx.ui.input (ExtensionUIContext mock) and returns its answer", async () => {
		const calls: Array<[string, string | undefined]> = [];
		const ui = {
			input: async (title: string, placeholder?: string) => {
				calls.push([title, placeholder]);
				return "typed answer";
			},
		};
		const result = await performAsk({ kind: "ui" }, ui, { question: "Pick a name", placeholder: "e.g. foo" });
		expect(calls).toEqual([["Pick a name", "e.g. foo"]]);
		expect(result.content[0]).toEqual({ type: "text", text: "typed answer" });
		expect(result.details).toEqual({ question: "Pick a name", response: "typed answer", source: "ui" });
	});

	it("ui mode: reports cancellation as an error", async () => {
		const ui = { input: async () => undefined };
		const result = await performAsk({ kind: "ui" }, ui, { question: "q" });
		expect(result.isError).toBe(true);
	});

	it("unavailable: fails closed with a clear message instead of guessing", async () => {
		const ui = { input: async () => { throw new Error("must not be called"); } };
		const result = await performAsk({ kind: "unavailable" }, ui, { question: "q" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/no fixture is configured/);
	});
});

describe("performSelect", () => {
	it("fixture mode: returns the scripted response when it matches an option", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "worktree", response: "no" }]) };
		const ui = { select: async () => { throw new Error("must not be called"); } };
		const result = await performSelect(channel, ui, { question: "Use a worktree?", options: ["yes", "no"] });
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({ type: "text", text: "no" });
	});

	it("fixture mode: errors when the scripted response does not match any option label", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "worktree", response: "maybe" }]) };
		const ui = { select: async () => "unused" };
		const result = await performSelect(channel, ui, { question: "Use a worktree?", options: ["yes", "no"] });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/does not match any offered option/);
	});

	it("ui mode: delegates to ctx.ui.select (ExtensionUIContext mock) with the option labels", async () => {
		const calls: Array<[string, string[]]> = [];
		const ui = {
			select: async (title: string, options: string[]) => {
				calls.push([title, options]);
				return options[1];
			},
		};
		const result = await performSelect({ kind: "ui" }, ui, { question: "Choose", options: ["a", "b", "c"] });
		expect(calls).toEqual([["Choose", ["a", "b", "c"]]]);
		expect(result.content[0]).toEqual({ type: "text", text: "b" });
	});

	it("ui mode: reports cancellation as an error", async () => {
		const ui = { select: async () => undefined };
		const result = await performSelect({ kind: "ui" }, ui, { question: "q", options: ["a", "b"] });
		expect(result.isError).toBe(true);
	});
});

describe("parseYesNo", () => {
	it("recognizes yes/y/true (case-insensitive, trimmed)", () => {
		expect(parseYesNo("yes")).toBe(true);
		expect(parseYesNo(" Y ")).toBe(true);
		expect(parseYesNo("TRUE")).toBe(true);
	});

	it("recognizes no/n/false", () => {
		expect(parseYesNo("no")).toBe(false);
		expect(parseYesNo("N")).toBe(false);
		expect(parseYesNo("false")).toBe(false);
	});

	it("returns undefined for anything else", () => {
		expect(parseYesNo("maybe")).toBeUndefined();
		expect(parseYesNo("")).toBeUndefined();
	});
});

describe("performConfirm", () => {
	it("fixture mode: parses a yes response", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", response: "yes" }]) };
		const ui = { confirm: async () => { throw new Error("must not be called"); } };
		const result = await performConfirm(channel, ui, { question: "Proceed?" });
		expect(result.isError).toBeFalsy();
		expect(result.content[0]).toEqual({ type: "text", text: "yes" });
		expect(result.details).toEqual({ question: "Proceed?", confirmed: true, source: "fixture" });
	});

	it("fixture mode: parses a no response", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", response: "no" }]) };
		const ui = { confirm: async () => true };
		const result = await performConfirm(channel, ui, { question: "Proceed?" });
		expect(result.details).toEqual({ question: "Proceed?", confirmed: false, source: "fixture" });
	});

	it("fixture mode: errors on an unparseable response", async () => {
		const channel: AskChannel = { kind: "fixture", answers: fixtureSet([{ match: "proceed", response: "sure thing" }]) };
		const ui = { confirm: async () => true };
		const result = await performConfirm(channel, ui, { question: "Proceed?" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/not a recognizable yes\/no answer/);
	});

	it("ui mode: delegates to ctx.ui.confirm (ExtensionUIContext mock)", async () => {
		const calls: Array<[string, string]> = [];
		const ui = {
			confirm: async (title: string, message: string) => {
				calls.push([title, message]);
				return true;
			},
		};
		const result = await performConfirm({ kind: "ui" }, ui, { question: "Merge now?" });
		expect(calls).toEqual([["lets-craft", "Merge now?"]]);
		expect(result.content[0]).toEqual({ type: "text", text: "yes" });
		expect(result.details).toEqual({ question: "Merge now?", confirmed: true, source: "ui" });
	});

	it("unavailable: fails closed with a clear message instead of guessing", async () => {
		const ui = { confirm: async () => { throw new Error("must not be called"); } };
		const result = await performConfirm({ kind: "unavailable" }, ui, { question: "q" });
		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(/no fixture is configured/);
	});
});
