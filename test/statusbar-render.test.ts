import { describe, expect, it } from "vitest";
import {
	BAR_CELLS,
	BAR_CELLS_EXPANDED,
	deriveMaxRows,
	formatCountdown,
	LABEL_MAX,
	MAX_BAR_ROWS,
	MIN_BAR_ROWS,
	meterBar,
	renderRows,
	RESERVE_ROWS,
	rowText,
	usedPercent,
	type RenderRow,
} from "../src/statusbar/render.js";
import type { AccountVM, CellVM, ProviderColumnVM, UsageLevel, UsageViewModel } from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Pure-core unit tests for the columnar render layer.
//
// `render.ts` imports no omp values (VM types only, `import type`), so it is
// loadable under vitest-on-Node. We hand-build `UsageViewModel`s with local
// builders — the view-model transform is exercised in its own suite.
//
// Coverage targets: the eighth-block meter quantization; deriveMaxRows by
// FORMULA against the exported constants (never frozen literals); the
// side-by-side column layout (providers as columns, accounts as rows, slot
// sub-columns aligned); the width degradation ladder (countdown → bar shrink →
// percent-only → vertical stacking); the row budget (`+N` on the title); the
// tiny strip modes (maxRows 1–2); expanded completeness; and per-segment
// styling (warn/crit escalation) so a single-style-per-row regression is
// caught.
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;
const HOUR = 60 * 60_000;
const MIN = 60_000;

const ANTHROPIC_SLOTS = [
	{ key: "5h", header: "5h", label: "5 hours" },
	{ key: "7d", header: "7d", label: "7 days" },
	{ key: "fable-7d", header: "Fable 7d", label: "Fable · 7 days" },
];
const CODEX_SLOTS = [{ key: "7d", header: "7d", label: "7 days" }];

function cell(slotKey: string, fraction: number | undefined, opts: { resetsAt?: number; level?: UsageLevel } = {}): CellVM {
	const level = opts.level ?? (fraction !== undefined && fraction >= 0.9 ? "crit" : fraction !== undefined && fraction >= 0.75 ? "warn" : "ok");
	return { slotKey, fraction, resetsAt: opts.resetsAt, level };
}

/** Anthropic account with cells for [5h, 7d, fable]; undefined = no-data slot. */
function anthAcc(
	label: string,
	fractions: [number | undefined, number | undefined, number | undefined],
	opts: { freshness?: AccountVM["freshness"]; resetsAt?: number } = {},
): AccountVM {
	return {
		label,
		isSubscription: true,
		freshness: opts.freshness ?? "fresh",
		cells: [
			cell("5h", fractions[0], { resetsAt: opts.resetsAt }),
			cell("7d", fractions[1], { resetsAt: opts.resetsAt }),
			cell("fable-7d", fractions[2], { resetsAt: opts.resetsAt }),
		],
	};
}
function codexAcc(label: string, fraction: number | undefined, opts: { resetsAt?: number } = {}): AccountVM {
	return { label, isSubscription: true, freshness: "fresh", cells: [cell("7d", fraction, opts)] };
}
function noteAcc(label: string, note: string): AccountVM {
	return { label, isSubscription: false, freshness: "unavailable", cells: [], note };
}
function anthColumn(accounts: AccountVM[]): ProviderColumnVM {
	return { provider: "anthropic", title: "Anthropic", slots: ANTHROPIC_SLOTS, accounts };
}
function codexColumn(accounts: AccountVM[]): ProviderColumnVM {
	return { provider: "openai-codex", title: "OpenAI Codex", slots: CODEX_SLOTS, accounts };
}
function mkVm(columns: ProviderColumnVM[]): UsageViewModel {
	return { columns, empty: columns.every((c) => c.accounts.length === 0) };
}
const texts = (rows: RenderRow[]): string[] => rows.map(rowText);
const allText = (rows: RenderRow[]): string => texts(rows).join("\n");

const WIDE = { width: 200, maxRows: 12, expanded: false, now: NOW };

describe("meterBar — eighth-block quantization over `cells` columns", () => {
	it("maps 0 to an empty track and 1 to a full fill", () => {
		expect(meterBar(0, 5)).toEqual({ fill: "", track: "░░░░░" });
		expect(meterBar(1, 5)).toEqual({ fill: "█████", track: "" });
	});

	it("renders sub-cell precision with partial blocks (fill+track is always `cells` wide)", () => {
		expect(meterBar(0.5, 5)).toEqual({ fill: "██▌", track: "░░" }); // 2.5 cells = 20 eighths
		expect(meterBar(0.62, 5)).toEqual({ fill: "███▏", track: "░" }); // 3.1 -> 3 + 1/8 (24.8 -> 25 eighths)
		for (const f of [0, 0.04, 0.1, 0.33, 0.5, 0.62, 0.75, 0.9, 0.99, 1]) {
			const { fill, track } = meterBar(f, 5);
			expect(fill.length + track.length).toBe(5);
		}
	});

	it("clamps overage and negatives, never throws on non-finite input", () => {
		expect(meterBar(1.4, 5).fill).toBe("█████");
		expect(meterBar(-0.1, 5).fill).toBe("");
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
			expect(() => meterBar(bad, 5)).not.toThrow();
			expect(meterBar(bad, 5).track).toBe("░░░░░");
		}
	});
});

describe("usedPercent / formatCountdown / deriveMaxRows (formula, not literals)", () => {
	it("usedPercent rounds, floors negatives at 0, passes overage through", () => {
		expect(usedPercent(0)).toBe(0);
		expect(usedPercent(0.618)).toBe(62);
		expect(usedPercent(-0.5)).toBe(0);
		expect(usedPercent(1.37)).toBe(137);
	});

	it("formatCountdown: sub-minute 'now', then two-unit d/h/m truncation", () => {
		expect(formatCountdown(30_000)).toBe("now");
		expect(formatCountdown(5 * MIN)).toBe("5m");
		expect(formatCountdown(3 * HOUR + 28 * MIN)).toBe("3h28m");
		expect(formatCountdown(3 * 24 * HOUR + 19 * HOUR)).toBe("3d19h");
		expect(formatCountdown(2 * 24 * HOUR)).toBe("2d");
	});

	it("deriveMaxRows = clamp(H - RESERVE_ROWS, MIN_BAR_ROWS, MAX_BAR_ROWS), 0 at H<=1", () => {
		expect(deriveMaxRows(0)).toBe(0);
		expect(deriveMaxRows(1)).toBe(0);
		for (const h of [2, 8, RESERVE_ROWS + MIN_BAR_ROWS, 20, 24, 60]) {
			expect(deriveMaxRows(h)).toBe(Math.min(MAX_BAR_ROWS, Math.max(MIN_BAR_ROWS, h - RESERVE_ROWS)));
		}
		expect(deriveMaxRows(60)).toBe(MAX_BAR_ROWS);
	});
});

describe("collapsed side-by-side layout — providers as columns, accounts as rows", () => {
	const vm = mkVm([
		anthColumn([anthAcc("kjy915875", [0.04, 1.0, 0.62]), anthAcc("senna", [0.12, 0.31, 0.02])]),
		codexColumn([codexAcc("senna", 0.19)]),
	]);

	it("row 0 carries BOTH provider titles side by side, separated by the vertical rule", () => {
		const rows = renderRows(vm, WIDE);
		expect(texts(rows)[0]).toMatch(/Anthropic\s+│ OpenAI Codex/);
	});

	it("row 1 is the shared header row with the fixed slot order 5h, 7d, Fable 7d │ 7d", () => {
		const rows = renderRows(vm, WIDE);
		expect(texts(rows)[1]).toMatch(/5h\s+7d\s+Fable 7d\s+│\s+7d/);
	});

	it("accounts stack as rows INSIDE their provider column (height = 2 + max accounts, not the sum)", () => {
		const rows = renderRows(vm, WIDE);
		expect(rows).toHaveLength(2 + 2);
		expect(texts(rows)[2]).toMatch(/^kjy915875\s/);
		expect(texts(rows)[2]).toContain("senna"); // codex account rides the SAME physical row
		expect(texts(rows)[3]).toMatch(/^senna\s/);
	});

	it("every row is padded to equal per-column width so the vertical rule aligns", () => {
		const rows = renderRows(vm, WIDE);
		const rulePositions = texts(rows).map((t) => t.indexOf("│"));
		expect(new Set(rulePositions).size).toBe(1);
		expect(rulePositions[0]).toBeGreaterThan(0);
	});

	it("renders percents with bars at full width and a no-data slot as '–'", () => {
		const vm2 = mkVm([anthColumn([anthAcc("a", [0.62, 0.31, undefined])])]);
		const rows = renderRows(vm2, WIDE);
		const accountRow = texts(rows)[2];
		expect(accountRow).toContain("62%");
		expect(accountRow).toContain("31%");
		expect(accountRow).toContain("–");
		expect(accountRow).toContain("█");
	});

	it("appends the reset countdown only to warn/crit cells", () => {
		const vm2 = mkVm([
			anthColumn([anthAcc("hot", [0.95, 0.5, undefined], { resetsAt: NOW + 3 * HOUR + 28 * MIN })]),
		]);
		const row = texts(renderRows(vm2, WIDE))[2];
		expect(row).toContain("95% 3h28m"); // crit cell carries its countdown
		expect(row).not.toContain("50% 3h28m"); // ok cell does not
	});

	it("renders an api-key credential as a dim note row without cells", () => {
		const vm2 = mkVm([anthColumn([anthAcc("a", [0.1, 0.2, 0.3]), noteAcc("#3", "no usage - api key")])]);
		const body = allText(renderRows(vm2, WIDE));
		expect(body).toContain("no usage - api key");
	});

	it("marks a stale account inline on its label", () => {
		const vm2 = mkVm([anthColumn([anthAcc("old", [0.1, 0.2, 0.3], { freshness: "stale" })])]);
		expect(texts(renderRows(vm2, WIDE))[2]).toContain("old (stale)");
	});

	it("clips long account labels to LABEL_MAX with an ellipsis", () => {
		const long = "a".repeat(LABEL_MAX + 10);
		const vm2 = mkVm([anthColumn([anthAcc(long, [0.1, 0.2, 0.3])])]);
		const row = texts(renderRows(vm2, WIDE))[2];
		expect(row).toContain(`${"a".repeat(LABEL_MAX - 1)}…`);
		expect(row).not.toContain(long);
	});
});

describe("width degradation ladder", () => {
	const vm = mkVm([
		anthColumn([
			anthAcc("kjy915875", [0.04, 1.0, 0.62], { resetsAt: NOW + 3 * HOUR + 28 * MIN }),
			anthAcc("senna", [0.12, 0.31, 0.02]),
		]),
		codexColumn([codexAcc("senna", 0.19)]),
	]);

	it("full width: bars + countdowns; tighter: countdowns dropped first, bars kept", () => {
		const full = allText(renderRows(vm, WIDE));
		expect(full).toContain("100% 3h28m");
		const mid = allText(renderRows(vm, { ...WIDE, width: 68 }));
		expect(mid).not.toContain("3h28m");
		expect(mid).toContain("█");
		expect(mid).toContain("│"); // still side by side
	});

	it("~50 cols: bars shed entirely (percent-only), still side by side", () => {
		const rows = renderRows(vm, { ...WIDE, width: 50 });
		const body = allText(rows);
		expect(body).not.toContain("█");
		expect(body).toContain("100%");
		expect(body).toContain("│");
		expect(rows).toHaveLength(4);
	});

	it("~40 cols: providers stack vertically — each table gets the full width", () => {
		const rows = renderRows(vm, { ...WIDE, width: 40 });
		const body = texts(rows);
		expect(body.join("\n")).not.toContain("│");
		const anthTitle = body.findIndex((t) => t.startsWith("Anthropic"));
		const codexTitle = body.findIndex((t) => t.startsWith("OpenAI Codex"));
		expect(anthTitle).toBe(0);
		expect(codexTitle).toBeGreaterThan(anthTitle + 2); // full anthropic table in between
	});

	it("never emits a row wider than opts.width (hard clip with ellipsis)", () => {
		for (const width of [200, 90, 70, 50, 40, 30, 24]) {
			for (const row of renderRows(vm, { ...WIDE, width })) {
				expect(rowText(row).length).toBeLessThanOrEqual(width);
			}
		}
	});
});

describe("row budget", () => {
	const many = anthColumn([
		anthAcc("a1", [0.1, 0.2, 0.3]),
		anthAcc("a2", [0.2, 0.3, 0.4]),
		anthAcc("a3", [0.3, 0.4, 0.5]),
		anthAcc("a4", [0.4, 0.5, 0.6]),
	]);
	const vm = mkVm([many, codexColumn([codexAcc("c1", 0.19)])]);

	it("shows maxRows-2 accounts per column and flags hidden ones as +N on the title", () => {
		const rows = renderRows(vm, { ...WIDE, maxRows: 4 });
		expect(rows).toHaveLength(4);
		const body = texts(rows);
		expect(body[0]).toContain("Anthropic +2");
		expect(body.join("\n")).toContain("a1");
		expect(body.join("\n")).toContain("a2");
		expect(body.join("\n")).not.toContain("a3");
	});

	it("returns nothing at maxRows<=0 and on an empty view model", () => {
		expect(renderRows(vm, { ...WIDE, maxRows: 0 })).toEqual([]);
		expect(renderRows(mkVm([]), WIDE)).toEqual([]);
	});

	it("maxRows=2 with two providers: one compact strip per provider", () => {
		const rows = renderRows(vm, { ...WIDE, maxRows: 2 });
		expect(rows).toHaveLength(2);
		expect(rowText(rows[0])).toMatch(/^Anthropic /);
		expect(rowText(rows[0])).toContain("+3"); // 3 other accounts
		expect(rowText(rows[1])).toMatch(/^OpenAI Codex /);
	});

	it("maxRows=1: both provider strips joined on a single row, worst account first", () => {
		const hot = mkVm([
			anthColumn([anthAcc("cool", [0.1, 0.2, 0.3]), anthAcc("hot", [0.2, 0.97, 0.4], { resetsAt: NOW + HOUR })]),
			codexColumn([codexAcc("c1", 0.19)]),
		]);
		const rows = renderRows(hot, { ...WIDE, maxRows: 1 });
		expect(rows).toHaveLength(1);
		const t = rowText(rows[0]);
		expect(t).toContain("Anthropic hot 7d 97% 1h");
		expect(t).toContain("│ OpenAI Codex c1 7d 19%");
	});
});

describe("expanded overlay — complete, vertical, resets always shown", () => {
	const vm = mkVm([
		anthColumn([
			anthAcc("kjy915875", [0.04, 1.0, 0.62], { resetsAt: NOW + 2 * HOUR }),
			anthAcc("ghost", [undefined, undefined, undefined], { freshness: "unavailable" }),
			noteAcc("#3", "no usage - api key"),
		]),
		codexColumn([codexAcc("senna", 0.19, { resetsAt: NOW + 6 * 24 * HOUR })]),
	]);
	const EXP = { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW };

	it("renders every provider, account and slot with full slot labels and resets, no elision", () => {
		const body = allText(renderRows(vm, EXP));
		expect(body).toContain("Anthropic");
		expect(body).toContain("OpenAI Codex");
		expect(body).toContain("5 hours");
		expect(body).toContain("7 days");
		expect(body).toContain("Fable · 7 days");
		expect(body).toContain("resets 2h");
		expect(body).toContain("resets 6d");
		expect(body).not.toContain("+1");
	});

	it("keeps the fixed slot order 5 hours → 7 days → Fable · 7 days", () => {
		const body = allText(renderRows(vm, EXP));
		const i5 = body.indexOf("5 hours");
		const i7 = body.indexOf("7 days");
		const iF = body.indexOf("Fable · 7 days");
		expect(i5).toBeGreaterThanOrEqual(0);
		expect(i5).toBeLessThan(i7);
		expect(i7).toBeLessThan(iF);
	});

	it("shows resets on ok-level cells too (unlike the collapsed table)", () => {
		const body = allText(renderRows(vm, EXP));
		expect(body).toMatch(/4%\s+resets 2h/);
	});

	it("renders an unavailable account as a single 'no usage data' line and api-key notes verbatim", () => {
		const body = allText(renderRows(vm, EXP));
		expect(body).toContain("ghost");
		expect(body).toContain("no usage data");
		expect(body).toContain("no usage - api key");
	});

	it("uses the wider expanded meter", () => {
		const full = texts(renderRows(vm, EXP)).find((t) => t.includes("100%"));
		expect(full).toBeDefined();
		expect(full).toContain("█".repeat(BAR_CELLS_EXPANDED));
	});

	it("separates providers with a blank spacer row", () => {
		const body = texts(renderRows(vm, EXP));
		const codexTitle = body.findIndex((t) => t === "OpenAI Codex");
		expect(codexTitle).toBeGreaterThan(0);
		expect(body[codexTitle - 1]).toBe("");
	});
});

describe("segment styling — level escalation is per-cell, not per-row", () => {
	it("gives ok/warn/crit cells distinct pct styles within ONE row", () => {
		const vm = mkVm([anthColumn([anthAcc("mix", [0.5, 0.8, 0.95])])]);
		const row = renderRows(vm, WIDE)[2];
		const styles = row.segments.map((s) => s.style);
		expect(styles).toContain("pct-ok");
		expect(styles).toContain("pct-warn");
		expect(styles).toContain("pct-crit");
		expect(styles).toContain("bar-crit");
	});

	it("styles titles, headers, rules and notes distinctly", () => {
		const vm = mkVm([
			anthColumn([anthAcc("a", [0.1, 0.2, 0.3]), noteAcc("#2", "no usage - api key")]),
			codexColumn([codexAcc("c", 0.1)]),
		]);
		const rows = renderRows(vm, WIDE);
		expect(rows[0].segments.some((s) => s.style === "title" && s.text === "Anthropic")).toBe(true);
		expect(rows[0].segments.some((s) => s.style === "sep" && s.text.includes("│"))).toBe(true);
		expect(rows[1].segments.every((s) => ["header", "sep"].includes(s.style))).toBe(true);
		expect(rows[3].segments.some((s) => s.style === "note")).toBe(true);
	});

	it("collapsed meters honor BAR_CELLS", () => {
		const vm = mkVm([anthColumn([anthAcc("a", [1.0, 0.2, 0.3])])]);
		const row = texts(renderRows(vm, WIDE))[2];
		expect(row).toContain("█".repeat(BAR_CELLS));
	});
});
