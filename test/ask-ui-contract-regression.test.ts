import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as zod from "zod/v4";
import {
	type AskChannel,
	type AskUI,
	type SelectUI,
	FREE_ANSWER_SENTINEL,
	SELECTED_LINE_PREFIX,
	buildDisplayRows,
	performAsk,
	performConfirm,
	performSelect,
	registerAskTools,
	resolveSelectOption,
} from "../src/ask";
import {
	FixtureAnswerSet,
	type FixtureAnswerBody,
	matchesRule,
	parseFixtureAnswerFile,
} from "../src/fixtures";
import { registerScaffoldTool } from "../src/artifacts/scaffold";
import { registerCraftAbortTool } from "../src/craft/abort";
import { registerCraftInitTool } from "../src/craft/init";
import { registerLandTool } from "../src/craft/land";
import { registerLatencyReportTool } from "../src/craft/latency-report";
import { registerRunCheckTool } from "../src/craft/run-check";
import { registerAuditValidateTools } from "../src/craft/verdict";
import { registerDoctorTool } from "../src/doctor";
import { registerClaimsTool } from "../src/research/claims-tool";

/**
 * Contract-regression pins for the ask seam — baseline pins + U5/exact-pin future contract.
 *
 * Two classes of assertion share this file (v2 §8 keeps them together under one owner). What makes
 * that safe is that NEITHER class depends on the new src/ask-ui/* runtime — this file pins the
 * frozen current contract and the manifest/tool-table, so it can serve as the boundary/baseline.
 *   1. BASELINE PINS — invariants that MUST survive the ask-readability-option-chat craft
 *      (custom<T> UI + BYO side-chat), independent of src/ask-ui/*. GREEN now, MUST STAY GREEN
 *      through craft. Companion to test/statusbar-regression.test.ts (whose static import-graph
 *      pattern this file extends to the src/ask-ui/ boundary).
 *   2. FUTURE-CONTRACT blocks — pins on the manifest + tool table the craft has not reached yet.
 *      RED now, GREEN once PR1 lands. Kept here (not in the feature suites) because they pin
 *      package.json/package-lock.json and the registered tool definitions, not src/ask-ui/*.
 *
 * ── BASELINE PINS (GREEN now, GREEN through craft) ───────────────────────────
 *   • CONTENT envelope grammar — SELECTED_LINE_PREFIX / FREE_ANSWER_SENTINEL and the
 *     2-space multiline indent (ask.ts:75-85; plan §Guardrails "CONTENT envelope 문법 무변경").
 *   • fixture answer schema — the closed 4-kind union (free-text / selection /
 *     selection-index / confirmation) + kind-mismatch isError (fixtures.ts:30-34; plan
 *     "fixtures.ts 스키마 무변경"). The new side-chat adds NO fixture kind (spec Non-Goals).
 *   • the `proceed\??$` gate catch-all matchesRule behavior (fixtures/sample-ts-cli/answers.json:42).
 *   • resolveSelectOption matches canonical labels only — descriptions never participate (ask.ts:220-231).
 *   • buildDisplayRows appends " (Recommended)" for display, then maps it back to the canonical label.
 *   • src/ask-ui/ import-graph boundary — @oh-my-pi runtime VALUE imports live ONLY in the two Bun
 *     leaves component.ts/completion.ts; no pure module / src/ask.ts imports a leaf. The scanner
 *     (hasOmpRuntimeValueImport) covers EVERY runtime edge (P4/N8): static `import … from`, bare
 *     side-effect `import "…"`, dynamic `import("…")`, and `export … from` re-export (incl.
 *     `export * from`), all path-normalized. The ask.ts-side negative edge is asserted now; the
 *     src/ask-ui/ internal checks + the two POSITIVE edges are skipped-with-reason until craft
 *     creates the module (so they stay GREEN pre-craft):
 *       – main.ts injects createAskRuntimeFactory(pi) into registerAskTools (v2 §1 main→index edge);
 *       – index.ts assembles BOTH Bun leaves (imports ./component + ./completion).
 *     (appendix-test-plan §회귀가드; [C12]).
 *
 * ── FUTURE-CONTRACT blocks (RED now → GREEN once PR1 lands) ──────────────────
 *   • U5 loadMode (AC2.4): PR1 adds loadMode:"essential" to the 3 ask tools and
 *     loadMode:"discoverable" to the 13 batch tools. 16 assertions, RED until PR1.
 *   • SDK exact-pin (v2 §7 / A-§5.6): PR1 pins @oh-my-pi/pi-coding-agent, pi-ai AND pi-tui to
 *     EXACTLY "17.0.5" in package.json + package-lock.json (pi-tui becomes a direct dep). Today the
 *     pins are 16.4.0 and pi-tui is only transitive, so these 9 assertions are RED until PR1.
 *
 * Every OTHER test here is GREEN pre-craft; the src/ask-ui/ internal + positive-edge checks SKIP
 * until craft creates the module.
 */

// ── shared fixtures / helpers (ask.test.ts fake conventions) ─────────────────
const BASE_OPTIONS = [
	{ label: "Alpha", description: "Use the alpha path." },
	{ label: "Beta", description: "Use the beta path." },
];

function fixtureChannel(body: FixtureAnswerBody): AskChannel {
	return {
		kind: "fixture",
		answers: new FixtureAnswerSet(
			parseFixtureAnswerFile({ version: 2, answers: [{ match: ".*", ...body }] }, "regression-answers.json"),
		),
	};
}

function textOf(result: { content: readonly unknown[] }): string {
	const first = result.content[0];
	if (!first || typeof first !== "object" || !("text" in first) || typeof first.text !== "string") {
		throw new Error("expected the first tool-result content item to be text");
	}
	return first.text;
}

// A ui port that must never be touched on the fixture path (ask.test.ts:200-217 convention).
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

// ── envelope grammar (U1 · AC1.4 / AC2.2) ────────────────────────────────────
describe("CONTENT envelope grammar is frozen (U1 · AC1.4/AC2.2)", () => {
	it("keeps the canonical envelope stem constants exactly", () => {
		expect(SELECTED_LINE_PREFIX).toBe("User selected: ");
		expect(FREE_ANSWER_SENTINEL).toBe("User provided free answer:");
	});

	it("emits one `User selected: <label>` line per selection, in offered-option order", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "selection", selections: ["Beta", "Alpha"] }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS, multi: true },
		);
		expect(textOf(result)).toBe(`${SELECTED_LINE_PREFIX}Alpha\n${SELECTED_LINE_PREFIX}Beta`);
	});

	it("puts a single-line free answer on the sentinel line itself", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "free-text", freeText: "single line guidance" }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL} single line guidance`);
	});

	it("indents a multiline free answer by exactly two spaces per line under the sentinel", async () => {
		const result = await performSelect(
			fixtureChannel({ kind: "free-text", freeText: "line one\nline two" }),
			unreachableSelectUI(),
			{ question: "Choose", options: BASE_OPTIONS },
		);
		expect(textOf(result)).toBe(`${FREE_ANSWER_SENTINEL}\n  line one\n  line two`);
	});

	it("keeps confirm booleans as the bare yes/no tokens (no envelope decoration)", async () => {
		const yes = await performConfirm(fixtureChannel({ kind: "confirmation", confirm: true }), unreachableSelectUI(), {
			question: "Proceed?",
		});
		const no = await performConfirm(fixtureChannel({ kind: "confirmation", confirm: false }), unreachableSelectUI(), {
			question: "Proceed?",
		});
		expect(textOf(yes)).toBe("yes");
		expect(textOf(no)).toBe("no");
	});
});

// ── fixture answer schema: closed 4-kind union + kind-mismatch isError (U1 · AC2.2) ──
describe("fixture answer schema stays a closed 4-kind union (U1 · AC2.2)", () => {
	it("parses exactly the four canonical kinds", () => {
		const bodies: FixtureAnswerBody[] = [
			{ kind: "free-text", freeText: "x" },
			{ kind: "selection", selections: ["A"] },
			{ kind: "selection-index", optionIndex: 0 },
			{ kind: "confirmation", confirm: true },
		];
		for (const body of bodies) {
			expect(() =>
				parseFixtureAnswerFile({ version: 2, answers: [{ match: ".*", ...body }] }, "u.json"),
			).not.toThrow();
		}
	});

	it("rejects any kind outside the closed union (e.g. a would-be chat kind)", () => {
		expect(() =>
			parseFixtureAnswerFile({ version: 2, answers: [{ match: ".*", kind: "chat", prompt: "hi" }] }, "u.json"),
		).toThrow(/kind must be one of/i);
	});

	it("select rejects a confirmation body — kind mismatch is a loud isError, never a silent reinterpretation", async () => {
		const result = await performSelect(fixtureChannel({ kind: "confirmation", confirm: true }), unreachableSelectUI(), {
			question: "Choose",
			options: BASE_OPTIONS,
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no select answer|confirmation/i);
	});

	it("confirm rejects a selection body — kind mismatch is a loud isError", async () => {
		const result = await performConfirm(fixtureChannel({ kind: "selection", selections: ["Yes"] }), unreachableSelectUI(), {
			question: "Proceed?",
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no confirm answer|selection/i);
	});

	it("ask rejects a non-free-text body — kind mismatch is a loud isError", async () => {
		const result = await performAsk(fixtureChannel({ kind: "selection", selections: ["A"] }), unreachableAskUI(), {
			question: "Q",
		});
		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/no free-text answer|selection/i);
	});
});

// ── fixture rule matching: the `proceed\??$` gate catch-all (matchesRule) ─────
describe("fixture rule matching keeps the `proceed\\??$` gate catch-all (matchesRule)", () => {
	const CATCH_ALL = "proceed\\??$";

	it("matches a gate question ending in `proceed?` (case-insensitive)", () => {
		expect(matchesRule(CATCH_ALL, "Consensus reached. Proceed?")).toBe(true);
	});

	it("matches a gate question ending in `proceed` without the question mark", () => {
		expect(matchesRule(CATCH_ALL, "Ready to proceed")).toBe(true);
	});

	it("does not match a question that does not END in proceed", () => {
		expect(matchesRule(CATCH_ALL, "Should we proceed to the next milestone right now?")).toBe(false);
	});

	it("falls back to a case-insensitive substring test when the pattern is not valid regex", () => {
		expect(matchesRule("(unclosed", "text with an (unclosed group written literally")).toBe(true);
		expect(matchesRule("(unclosed", "nothing similar here")).toBe(false);
	});
});

// ── select resolution ignores descriptions (resolveSelectOption) ─────────────
describe("select option resolution ignores descriptions (resolveSelectOption)", () => {
	it("resolves against canonical labels only — a token living only in a description never matches", () => {
		expect(resolveSelectOption("zebra", ["Alpha", "Beta"])).toBeUndefined();
	});

	it("a fixture selection matching only a description fails to resolve (isError)", async () => {
		const options = [
			{ label: "Alpha", description: "the zebra path for migration" },
			{ label: "Beta", description: "the yak path for rollback" },
		];
		const result = await performSelect(fixtureChannel({ kind: "selection", selections: ["zebra"] }), unreachableSelectUI(), {
			question: "Choose",
			options,
		});
		expect(result.isError).toBe(true);
	});

	it("still resolves a genuine canonical-label match", () => {
		expect(resolveSelectOption("Alpha", ["Alpha", "Beta"])).toBe("Alpha");
	});
});

// ── Recommended suffix is display-only: append then strip (buildDisplayRows) ──
describe("Recommended suffix is display-only, appended then stripped (buildDisplayRows)", () => {
	it("appends ` (Recommended)` to the recommended row and maps it back to the canonical label", () => {
		const { rows, displayToCanonical } = buildDisplayRows(BASE_OPTIONS, 1, { multi: false, checkedIndices: [] });
		expect(rows[1].label).toBe("Beta (Recommended)");
		expect(displayToCanonical.get("Beta (Recommended)")).toBe("Beta");
		// the non-recommended row is undecorated and maps to itself
		expect(rows[0].label).toBe("Alpha");
		expect(displayToCanonical.get("Alpha")).toBe("Alpha");
	});

	it("leaves every row undecorated when no recommendation is given", () => {
		const { rows, displayToCanonical } = buildDisplayRows(BASE_OPTIONS, undefined, { multi: false, checkedIndices: [] });
		expect(rows[0].label).toBe("Alpha");
		expect(rows[1].label).toBe("Beta");
		expect(displayToCanonical.get("Beta")).toBe("Beta");
	});
});

// ── src/ask-ui/ import-graph boundary (statusbar-regression.test.ts:31-43, extended) ──
function findRepoRoot(start: string): string {
	let dir = start;
	for (let depth = 0; depth < 16; depth++) {
		if (existsSync(join(dir, "src", "main.ts"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`could not locate the plugin root (a directory containing src/main.ts) at or above ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");
const ASK_TS = join(SRC, "ask.ts");
const MAIN_TS = join(SRC, "main.ts");
const ASK_UI_DIR = join(SRC, "ask-ui");
const ASK_UI_INDEX = join(ASK_UI_DIR, "index.ts");
const askUiPresent = existsSync(ASK_UI_DIR);
const askUiIndexPresent = existsSync(ASK_UI_INDEX);

// Node-safe pure core modules + the two Bun leaves that MAY hold @oh-my-pi runtime value imports.
const PURE_MODULES = ["types.ts", "state.ts", "render-model.ts", "palette.ts", "completion-core.ts"];
const OMP_VALUE_IMPORT_LEAVES = ["component.ts", "completion.ts"];
const LEAF_BASENAMES = ["component", "completion", "index"];

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walkTsFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walkTsFiles(full, acc);
		else if (entry.isFile() && entry.name.endsWith(".ts")) acc.push(full);
	}
	return acc;
}

// Every module specifier a file pulls in AT RUNTIME: static `… from "x"` / re-export `export … from
// "x"` (both via `from`), dynamic `import("x")`, and bare side-effect `import "x"`.
function importSpecifiers(source: string): string[] {
	const clean = stripComments(source);
	const specs: string[] = [];
	for (const m of clean.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specs.push(m[1]);
	for (const m of clean.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
	for (const m of clean.matchAll(/\bimport\s+["']([^"']+)["']/g)) specs.push(m[1]);
	return specs;
}

// Path normalization: drop a trailing `.js` so `@oh-my-pi/x.js` and `./component.js` compare like
// their extension-less forms (P4/N8).
function normalizeSpec(spec: string): string {
	return spec.replace(/\.js$/, "");
}

function isOmpSpecifier(spec: string): boolean {
	return normalizeSpec(spec).startsWith("@oh-my-pi/");
}

// True iff an import/export CLAUSE binds at least one runtime VALUE: a non-type named binding, or a
// default / `* as ns` namespace binding. `import type …`, `export type …`, and `{ type X }` are
// erased at compile and never count.
function clauseBindsValue(clause: string): boolean {
	const c = clause.trim();
	const braced = c.match(/\{([\s\S]*)\}/);
	if (braced) {
		for (const part of braced[1].split(",")) {
			const raw = part.trim();
			if (raw && !/^type\s/.test(raw)) return true; // a non-type named binding
		}
	}
	const outside = c
		.replace(/\{[\s\S]*\}/, " ")
		.replace(/,/g, " ")
		.replace(/^\*\s*as\s+/, "")
		.trim();
	for (const tok of outside.split(/\s+/)) {
		if (tok && tok !== "*") return true; // default or namespace binding
	}
	return false;
}

// True iff the source has ANY @oh-my-pi/* runtime VALUE dependency (type-only imports/exports are
// erased at compile and never count — mirrors statusbar-regression's ompValueImportBindings logic).
// Covers every runtime edge (P4/N8), not just `import … from`:
//   1. static  `import [type] <clause> from "@oh-my-pi/…"`
//   2. bare     `import "@oh-my-pi/…"`             (side-effect: executes the module at load)
//   3. dynamic  `import("@oh-my-pi/…")`            (runtime module load)
//   4. re-export `export [type] <clause> from "@oh-my-pi/…"` incl. `export * from …`
function hasOmpRuntimeValueImport(source: string): boolean {
	const clean = stripComments(source);
	// 1. static import … from
	for (const m of clean.matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
		if (m[1]) continue; // `import type … from` — erased
		if (!isOmpSpecifier(m[3])) continue;
		if (clauseBindsValue(m[2])) return true;
	}
	// 2. bare side-effect import "…"
	for (const m of clean.matchAll(/\bimport\s*["']([^"']+)["']/g)) {
		if (isOmpSpecifier(m[1])) return true;
	}
	// 3. dynamic import("…")
	for (const m of clean.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) {
		if (isOmpSpecifier(m[1])) return true;
	}
	// 4. re-export … from (incl. export * from — re-exports all values)
	for (const m of clean.matchAll(/\bexport\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
		if (m[1]) continue; // `export type … from` — erased
		if (!isOmpSpecifier(m[3])) continue;
		const clause = m[2].trim();
		if (clause === "*" || /^\*(\s|$)/.test(clause)) return true; // export * from … / export * as ns from …
		if (clauseBindsValue(clause)) return true;
	}
	return false;
}

// The ask-ui leaf specifiers a given file imports. ask.ts (outside ask-ui) can only reach a leaf
// via an `ask-ui/` path; a pure module inside ask-ui reaches one as a sibling (`./component`).
function leafImportSpecifiers(file: string, source: string): string[] {
	return importSpecifiers(source).filter(spec => {
		const norm = normalizeSpec(spec);
		const base = norm.split("/").pop() ?? "";
		if (!LEAF_BASENAMES.includes(base)) return false;
		if (file === ASK_TS) return /(^|\/)ask-ui\/(component|completion|index)$/.test(norm);
		return /^\.\/(component|completion|index)$/.test(norm) || /(^|\/)ask-ui\/(component|completion|index)$/.test(norm);
	});
}

describe("src/ask-ui import-graph boundary (statusbar-regression pattern extended, [C12])", () => {
	// ask.ts ALWAYS exists — asserted now (GREEN: no ask-ui import yet) and after craft (contract:
	// ask.ts reaches the runtime factory only through main.ts wiring, never by importing a leaf).
	it("src/ask.ts never imports an ask-ui Bun leaf (index/component/completion)", () => {
		const leaks = leafImportSpecifiers(ASK_TS, readFileSync(ASK_TS, "utf8"));
		expect(
			leaks,
			"ask.ts must reach the runtime factory only through main.ts wiring (createAskRuntimeFactory→registerAskTools), never by importing an ask-ui leaf (plan §Guardrails import graph)",
		).toEqual([]);
	});

	it.skipIf(!askUiPresent)(
		"@oh-my-pi runtime VALUE imports live only in component.ts/completion.ts (skipped until craft creates src/ask-ui)",
		() => {
			const offenders: string[] = [];
			for (const file of walkTsFiles(ASK_UI_DIR, [])) {
				if (!hasOmpRuntimeValueImport(readFileSync(file, "utf8"))) continue;
				const name = relative(ASK_UI_DIR, file);
				if (!OMP_VALUE_IMPORT_LEAVES.includes(name)) offenders.push(name);
			}
			expect(
				offenders,
				"only component.ts (pi-tui/coding-agent) and completion.ts (pi-ai) may hold @oh-my-pi runtime VALUE imports — pure modules and index.ts must stay value-import-free, across static/dynamic/side-effect/re-export forms (appendix-test-plan §회귀가드; [C12])",
			).toEqual([]);
		},
	);

	it.skipIf(!askUiPresent)(
		"pure ask-ui modules never import a Bun leaf — no pure→leaf import edge (skipped until craft creates src/ask-ui)",
		() => {
			const offenders: Array<{ file: string; spec: string }> = [];
			for (const name of PURE_MODULES) {
				const file = join(ASK_UI_DIR, name);
				if (!existsSync(file)) continue;
				for (const spec of leafImportSpecifiers(file, readFileSync(file, "utf8"))) offenders.push({ file: name, spec });
			}
			expect(
				offenders,
				"pure Node-safe modules (types/state/render-model/palette/completion-core) must not import index/component/completion — only index.ts assembles the leaves (plan §Guardrails import graph)",
			).toEqual([]);
		},
	);

	// ── positive edges (skipped-with-reason until craft creates src/ask-ui/index) ──
	// The negative edges above prove ask.ts / pure modules DON'T reach a leaf. These two prove the
	// production wiring actually EXISTS: main.ts injects the binder, and index.ts assembles both leaves.
	// Without them, main.ts could keep the legacy `registerAskTools(pi)` call and every pure/Bun test
	// still pass while production never gets a bound runtime (architect P2.2 / rec 8; v2 §1).
	it.skipIf(!askUiIndexPresent)(
		"src/main.ts injects createAskRuntimeFactory(pi) into registerAskTools (main→index positive edge)",
		() => {
			const main = stripComments(readFileSync(MAIN_TS, "utf8"));
			const importsFromIndex = importSpecifiers(main).some(spec => /(^|\/)ask-ui(\/index)?$/.test(normalizeSpec(spec)));
			expect(
				importsFromIndex && /\bcreateAskRuntimeFactory\b/.test(main),
				"main.ts must import createAskRuntimeFactory from ./ask-ui/index (v2 §1 main→index edge)",
			).toBe(true);
			// registerAskTools MUST receive a 2nd argument (the binder), not the bare legacy 1-arg call …
			expect(
				/\bregisterAskTools\s*\(\s*pi\s*,[^)]/.test(main),
				"main.ts must call registerAskTools(pi, <binder>) — registerAskTools(pi) alone strands production on the legacy path (v2 §1)",
			).toBe(true);
			// … and that binder MUST be produced by createAskRuntimeFactory(pi).
			expect(
				/\bcreateAskRuntimeFactory\s*\(\s*pi\s*\)/.test(main),
				"the injected binder must be createAskRuntimeFactory(pi) (v2 §1: registerAskTools(pi, createAskRuntimeFactory(pi)))",
			).toBe(true);
		},
	);

	it.skipIf(!askUiIndexPresent)(
		"src/ask-ui/index.ts assembles BOTH Bun leaves (imports ./component and ./completion; skipped until craft creates it)",
		() => {
			const assembled = new Set(
				leafImportSpecifiers(ASK_UI_INDEX, readFileSync(ASK_UI_INDEX, "utf8")).map(spec => normalizeSpec(spec).split("/").pop()),
			);
			expect(
				assembled.has("component") && assembled.has("completion"),
				"index.ts is the sole assembler of the Bun leaves — it must import BOTH ./component and ./completion (plan §Guardrails import graph; v2 §1)",
			).toBe(true);
		},
	);
});

// ── SDK exact-pin regression (v2 §7 · A-§5.6) — EXPECTED RED until PR1 bumps to 17.0.5 ──
// PR1 pins @oh-my-pi/pi-coding-agent, pi-ai AND pi-tui to EXACTLY "17.0.5" (pi-tui becomes a DIRECT
// dependency — today it is only a transitive dep of pi-coding-agent). Same RED-until-PR1 class as
// U5: the manifest/lock still pin 16.4.0 (and pi-tui is not a direct dep), so every assertion here
// is RED now and GREEN once PR1 lands the bump + lockfile sync. Without this pin, a default run
// (E2E gated off) could stay green on a stale 16.4.0 install — this is the deterministic Node guard
// the run_test.sh lock-hash reinstall depends on.
const PINNED_SDK_VERSION = "17.0.5";
const PINNED_SDK_PACKAGES = ["@oh-my-pi/pi-coding-agent", "@oh-my-pi/pi-ai", "@oh-my-pi/pi-tui"];

interface PackageManifest {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}
interface LockEntry {
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}
interface PackageLock {
	packages?: Record<string, LockEntry>;
}

function readJson<T>(file: string): T {
	return JSON.parse(readFileSync(file, "utf8")) as T;
}

// Section-agnostic lookup: craft MAY declare a pin under dependencies OR devDependencies — the
// contract is the EXACT version string, not which section holds it. A later `.toBe("17.0.5")` also
// rejects a floating range ("^17.0.5" / "~17.0.5"): those are not exact pins.
function declaredVersion(deps: PackageManifest | LockEntry, name: string): string | undefined {
	return { ...deps.devDependencies, ...deps.dependencies }[name];
}

describe("SDK exact-pin regression (v2 §7 · A-§5.6) — EXPECTED RED until PR1 bumps to 17.0.5", () => {
	const pkgPath = join(ROOT, "package.json");
	const lockPath = join(ROOT, "package-lock.json");

	for (const name of PINNED_SDK_PACKAGES) {
		it(`package.json pins ${name} to exactly ${PINNED_SDK_VERSION} (RED until PR1)`, () => {
			expect(
				declaredVersion(readJson<PackageManifest>(pkgPath), name),
				`${name} must be a DIRECT dependency pinned to exactly ${PINNED_SDK_VERSION} (no ^/~) — component.ts/completion.ts load these at runtime; a floating or missing pin re-opens SDK drift (v2 §7)`,
			).toBe(PINNED_SDK_VERSION);
		});
	}

	for (const name of PINNED_SDK_PACKAGES) {
		it(`package-lock.json root declares ${name} at exactly ${PINNED_SDK_VERSION} (RED until PR1)`, () => {
			const root = readJson<PackageLock>(lockPath).packages?.[""] ?? {};
			expect(
				declaredVersion(root, name),
				`the package-lock root must mirror the ${PINNED_SDK_VERSION} pin for ${name} (manifest and lock must agree)`,
			).toBe(PINNED_SDK_VERSION);
		});
	}

	for (const name of PINNED_SDK_PACKAGES) {
		it(`package-lock.json resolves node_modules/${name} to exactly ${PINNED_SDK_VERSION} (RED until PR1)`, () => {
			const entry = readJson<PackageLock>(lockPath).packages?.[`node_modules/${name}`];
			expect(
				entry?.version,
				`the resolved node_modules/${name} entry must be ${PINNED_SDK_VERSION} — a stale lock lets the build/Bun/e2e stages run the wrong SDK (v2 §7 / run_test.sh lock-hash guard)`,
			).toBe(PINNED_SDK_VERSION);
		});
	}
});

// ── loadMode assignment (U5 · AC2.4) — EXPECTED RED before PR1 adds loadMode ──
interface RegisteredToolDef {
	name: string;
	loadMode?: string;
}

function isNamedTool(value: unknown): value is RegisteredToolDef {
	return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

type LooseRegister = (...args: unknown[]) => void;

// A signature-agnostic capture (appendix-test-plan U5; v2 §1): registerAskTools grows an OPTIONAL
// binder param in craft — registerAskTools(pi, binder?), where binder = createAskRuntimeFactory(pi)
// (an AskRuntimeBinder). The loose cast + inert binder lets this capture the tool DEFINITIONS
// regardless of the wrapper signature; the binder is NEVER called at registration time (it binds
// per-execute, UI-channel only — v2 §1), and the inert proxy absorbs any incidental access.
const inertBinder: unknown = new Proxy(function () {}, {
	get: () => inertBinder,
	apply: () => inertBinder,
});

let capturedCache: Map<string, RegisteredToolDef> | undefined;

// Lazily built inside the tests (not at module top-level) so a hypothetical throw from any one
// registrar cannot break collection of the GREEN pins above.
function capturedTools(): Map<string, RegisteredToolDef> {
	if (capturedCache) return capturedCache;
	const tools = new Map<string, RegisteredToolDef>();
	const mockPi = {
		zod,
		getFlag: () => undefined,
		registerTool(def: unknown): void {
			if (isNamedTool(def)) tools.set(def.name, def);
		},
		registerCommand(): void {},
		registerShortcut(): void {},
		registerFlag(): void {},
		on(): void {},
	};
	const pi = mockPi as unknown as never;
	(registerAskTools as unknown as LooseRegister)(pi, inertBinder);
	(registerCraftInitTool as unknown as LooseRegister)(pi);
	(registerRunCheckTool as unknown as LooseRegister)(pi);
	(registerCraftAbortTool as unknown as LooseRegister)(pi);
	(registerAuditValidateTools as unknown as LooseRegister)(pi);
	(registerLandTool as unknown as LooseRegister)(pi);
	(registerScaffoldTool as unknown as LooseRegister)(pi);
	(registerClaimsTool as unknown as LooseRegister)(pi);
	(registerLatencyReportTool as unknown as LooseRegister)(pi);
	(registerDoctorTool as unknown as LooseRegister)(pi);
	capturedCache = tools;
	return tools;
}

// OQ1 표 (plan §OQ1): 3 interactive ask tools = essential, 10 batch tools = discoverable
// (C2: lsc_verify_hash/lsc_restore_tests/lsc_craft_release retired with hash-manifest.ts/release.ts).
const ESSENTIAL_TOOLS = ["lsc_ask", "lsc_select", "lsc_confirm"];
const DISCOVERABLE_TOOLS = [
	"lsc_craft_init",
	"lsc_run_check",
	"lsc_craft_abort",
	"lsc_audit_begin",
	"lsc_audit_validate",
	"lsc_land",
	"lsc_scaffold",
	"lsc_claims",
	"lsc_latency_report",
	"lsc_doctor",
];

describe("loadMode assignment (U5 · AC2.4) — EXPECTED RED before PR1 adds loadMode", () => {
	// This preflight is GREEN today: all 13 tools already register; only their loadMode field is missing.
	it("registers all 13 pipeline tools (3 essential + 10 discoverable)", () => {
		const tools = capturedTools();
		for (const name of [...ESSENTIAL_TOOLS, ...DISCOVERABLE_TOOLS]) {
			expect(tools.has(name), `tool ${name} must be registered`).toBe(true);
		}
	});

	for (const name of ESSENTIAL_TOOLS) {
		// RED now (loadMode field absent) → GREEN once PR1 sets loadMode:"essential".
		it(`${name} declares loadMode "essential" (RED until PR1)`, () => {
			expect(capturedTools().get(name)?.loadMode).toBe("essential");
		});
	}

	for (const name of DISCOVERABLE_TOOLS) {
		// RED now (loadMode field absent) → GREEN once PR1 sets loadMode:"discoverable".
		it(`${name} declares loadMode "discoverable" (RED until PR1)`, () => {
			expect(capturedTools().get(name)?.loadMode).toBe("discoverable");
		});
	}
});
