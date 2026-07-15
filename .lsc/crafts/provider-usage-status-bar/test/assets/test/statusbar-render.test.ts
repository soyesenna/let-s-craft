import { describe, expect, it } from "vitest";
import {
	deriveMaxRows,
	formatCountdown,
	localPart,
	MAX_BAR_ROWS,
	MIN_BAR_ROWS,
	miniBar,
	renderRows,
	RESERVE_ROWS,
	usedPercent,
} from "../src/statusbar/render.js";
import type { AccountVM, UsageViewModel, WindowVM } from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Pure-core unit tests for the render layer (plan §6 Step 4 / §9 unit).
//
// `render.ts` imports no omp values (VM types only, `import type`), so it is
// loadable under vitest-on-Node. We hand-build `UsageViewModel`s (the render
// input) with local builders — the view-model transform is exercised in its
// own suite. Bar glyphs are the spec/DR-E normative set: fill U+2593 "▓",
// empty U+2591 "░"; the packed-row separator is U+00B7 "·"; truncation is the
// ellipsis U+2026 "…".
//
// Coverage targets (Stage-4 consensus, iteration 2): deriveMaxRows asserted by
// FORMULA + invariants against the imported RESERVE_ROWS/MIN_BAR_ROWS/
// MAX_BAR_ROWS (Gate-1-tunable — never frozen as literals); a normal-height
// (maxRows>=3) budget/`+N more` path; a stage-by-stage width ladder + label
// ellipsis (so a blunt whole-row truncation is caught); and expanded
// completeness (every account × every window, no elision) — so an expanded
// view that drops accounts/windows is caught.
//
// RED until craft implements `src/statusbar/render.ts` (a load error on the
// missing module is the expected pre-implementation state).
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;
const HOUR = 60 * 60_000;
const MIN = 60_000;

function win(
	label: string,
	opts: { key?: string; fraction?: number | undefined; resetsAt?: number; nearLimit?: boolean } = {},
): WindowVM {
	return {
		key: opts.key ?? label,
		label,
		fraction: "fraction" in opts ? opts.fraction : 0.5,
		resetsAt: opts.resetsAt,
		nearLimit: opts.nearLimit ?? false,
	};
}
function acc(
	label: string,
	opts: { isSubscription?: boolean; freshness?: AccountVM["freshness"]; windows?: WindowVM[]; note?: string } = {},
): AccountVM {
	return {
		label,
		isSubscription: opts.isSubscription ?? true,
		freshness: opts.freshness ?? "fresh",
		windows: opts.windows ?? [],
		note: opts.note,
	};
}
function mkVm(groups: Array<{ provider: string; accounts: AccountVM[] }>): UsageViewModel {
	return { groups, empty: groups.every((g) => g.accounts.length === 0) };
}
const joinText = (rows: Array<{ text: string }>) => rows.map((r) => r.text).join("\n");

describe("miniBar — quantization round(clamp01(raw)*cells) (DR-E)", () => {
	it("maps in-range fractions to the nearest visual (half-up), ▓ fill and ░ empty", () => {
		expect(miniBar(0, 5)).toBe("░░░░░");
		expect(miniBar(0.33, 5)).toBe("▓▓░░░");
		expect(miniBar(0.5, 5)).toBe("▓▓▓░░"); // 2.5 -> 3 (half-up)
		expect(miniBar(0.6, 5)).toBe("▓▓▓░░");
		expect(miniBar(0.75, 5)).toBe("▓▓▓▓░");
		expect(miniBar(0.9, 5)).toBe("▓▓▓▓▓");
		expect(miniBar(1, 5)).toBe("▓▓▓▓▓");
	});

	it("clamps overage fill to a full bar without throwing (raw > 1)", () => {
		expect(() => miniBar(1.4, 5)).not.toThrow();
		expect(miniBar(1.4, 5)).toBe("▓▓▓▓▓");
	});

	it("clamps a negative fraction to an empty bar", () => {
		expect(miniBar(-0.1, 5)).toBe("░░░░░");
	});

	it("never throws on non-finite input (defensive; the VM maps these to undefined)", () => {
		expect(() => miniBar(Number.NaN, 5)).not.toThrow();
		expect(() => miniBar(Number.POSITIVE_INFINITY, 5)).not.toThrow();
		expect(() => miniBar(Number.NEGATIVE_INFINITY, 5)).not.toThrow();
	});

	it("emits exactly `cells` glyphs for every in-range fraction", () => {
		for (const f of [0, 0.1, 0.33, 0.5, 0.6, 0.75, 0.9, 1]) {
			expect(miniBar(f, 5)).toHaveLength(5);
		}
	});

	// The width ladder shrinks the bar to 3 cells, so quantization must be
	// correct for cells=3 too (not just the default 5).
	it("quantizes correctly at cells=3: round(clamp01(raw)*3)", () => {
		expect(miniBar(0, 3)).toBe("░░░");
		expect(miniBar(0.33, 3)).toBe("▓░░"); // 0.99 -> 1
		expect(miniBar(0.5, 3)).toBe("▓▓░"); // 1.5 -> 2 (half-up)
		expect(miniBar(0.9, 3)).toBe("▓▓▓"); // 2.7 -> 3 (half-up)
		expect(miniBar(1, 3)).toBe("▓▓▓");
	});

	it("clamps overage and negatives at cells=3 without throwing", () => {
		expect(() => miniBar(1.4, 3)).not.toThrow();
		expect(miniBar(1.4, 3)).toBe("▓▓▓"); // overage -> full
		expect(miniBar(-0.1, 3)).toBe("░░░"); // negative -> empty
		for (const f of [0, 0.2, 0.5, 0.8, 1]) {
			expect(miniBar(f, 3)).toHaveLength(3);
		}
	});
});

describe("usedPercent — raw percent, overage passthrough, negatives floored", () => {
	it("rounds the raw fraction, passing overage and flooring negatives at 0", () => {
		expect(usedPercent(0)).toBe(0);
		expect(usedPercent(0.33)).toBe(33);
		expect(usedPercent(0.6)).toBe(60);
		expect(usedPercent(1)).toBe(100);
		expect(usedPercent(1.4)).toBe(140); // overage shown honestly
		expect(usedPercent(-0.1)).toBe(0); // negative floored
	});
});

describe("formatCountdown", () => {
	it("shows 'now' for non-positive and sub-minute remaining", () => {
		expect(formatCountdown(0)).toBe("now");
		expect(formatCountdown(-5_000)).toBe("now");
		expect(formatCountdown(30_000)).toBe("now"); // sub-minute
	});

	it("treats exactly one minute as '1m' and just under a minute as 'now' (sub-minute boundary)", () => {
		expect(formatCountdown(60_000)).toBe("1m"); // exactly a minute is NOT sub-minute
		expect(formatCountdown(59_999)).toBe("now"); // just under a minute
	});

	it("formats minutes, hours+minutes, and multi-day durations", () => {
		expect(formatCountdown(45 * MIN)).toBe("45m");
		expect(formatCountdown(2 * HOUR + 10 * MIN)).toBe("2h10m");
		expect(formatCountdown(3 * 24 * HOUR + 4 * HOUR)).toBe("3d4h");
	});
});

describe("localPart", () => {
	it("returns the email local part before @", () => {
		expect(localPart("user@x.com")).toBe("user");
		expect(localPart("user.work@example.com")).toBe("user.work");
	});
});

describe("deriveMaxRows — formula + invariants (Gate-1-tunable constants, not literals)", () => {
	it("returns 0 for a terminal height <= 1 (strict prompt reserve, even at H=1)", () => {
		expect(deriveMaxRows(0)).toBe(0);
		expect(deriveMaxRows(1)).toBe(0);
	});

	it("matches clamp(H - RESERVE_ROWS, MIN_BAR_ROWS, MAX_BAR_ROWS) for H > 1 (formula, not hardcoded)", () => {
		for (const h of [2, 3, 8, 10, 14, 24, 40, 80, 200]) {
			const expected = Math.min(MAX_BAR_ROWS, Math.max(MIN_BAR_ROWS, h - RESERVE_ROWS));
			expect(deriveMaxRows(h)).toBe(expected);
		}
	});

	it("keeps the budget strictly below the terminal height (prompt reserve) for every H", () => {
		for (const h of [2, 5, 10, 24, 80, 200, 1_000]) {
			expect(deriveMaxRows(h)).toBeLessThan(h);
		}
		expect(deriveMaxRows(1)).toBeLessThan(1);
	});

	it("never drops below MIN_BAR_ROWS while a bar renders (H > 1)", () => {
		for (const h of [2, 3, 5, 9]) {
			expect(deriveMaxRows(h)).toBeGreaterThanOrEqual(MIN_BAR_ROWS);
		}
	});

	it("caps a very large terminal at MAX_BAR_ROWS", () => {
		expect(deriveMaxRows(RESERVE_ROWS + MAX_BAR_ROWS + 100)).toBe(MAX_BAR_ROWS);
		expect(deriveMaxRows(10_000)).toBe(MAX_BAR_ROWS);
	});
});

describe("renderRows — per-window formatting (AC3/AC5/AC11)", () => {
	it("renders the exact packed collapsed shape for a subscription account (AC11)", () => {
		const model = mkVm([
			{
				provider: "anthropic",
				accounts: [acc("user", { windows: [win("5h", { fraction: 0.33 }), win("7d", { fraction: 0.6 })] })],
			},
		]);
		const rows = renderRows(model, { width: 120, maxRows: 10, expanded: false, now: NOW });
		const accountRow = rows.find((r) => r.text.includes("user"));
		expect(accountRow).toBeDefined();
		// windows non-near-limit -> no countdown, matching the AC11 canonical shape;
		// only whitespace width is normalized so the assertion is not spacing-brittle.
		expect((accountRow?.text ?? "").replace(/\s+/g, " ").trim()).toBe("user 5h ▓▓░░░ 33% · 7d ▓▓▓░░ 60%");
	});

	it("shows the reset countdown on a near-limit window (derived from resetsAt vs now)", () => {
		const model = mkVm([
			{
				provider: "anthropic",
				accounts: [acc("user", { windows: [win("5h", { fraction: 0.9, nearLimit: true, resetsAt: NOW + 2 * HOUR + 10 * MIN })] })],
			},
		]);
		const joined = joinText(renderRows(model, { width: 120, maxRows: 10, expanded: false, now: NOW }));
		expect(joined).toContain("90%");
		expect(joined).toContain("2h10m");
	});

	it("renders an overage window without throwing: raw percent shown, bar-fill clamped full", () => {
		const model = mkVm([
			{
				provider: "anthropic",
				accounts: [acc("user", { windows: [win("5h", { fraction: 1.4, nearLimit: true, resetsAt: NOW + HOUR })] })],
			},
		]);
		const run = () => renderRows(model, { width: 120, maxRows: 10, expanded: false, now: NOW });
		expect(run).not.toThrow();
		const joined = joinText(run());
		expect(joined).toContain("140%"); // honest overage percent
		expect(joined).toContain("▓▓▓▓▓"); // fill clamped to full — no RangeError
	});

	it("renders an unresolved (undefined) fraction as n/a, never 0%", () => {
		const model = mkVm([
			{ provider: "anthropic", accounts: [acc("user", { windows: [win("5h", { fraction: undefined })] })] },
		]);
		const rows = renderRows(model, { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const joined = joinText(rows);
		expect(joined).toContain("n/a");
		expect(joined).not.toContain("0%");
		expect(rows.some((r) => r.style === "window-na")).toBe(true);
	});

	it("renders a 0 fraction as 0% with an empty bar (not n/a)", () => {
		const model = mkVm([
			{ provider: "anthropic", accounts: [acc("user", { windows: [win("5h", { fraction: 0 })] })] },
		]);
		const joined = joinText(renderRows(model, { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW }));
		expect(joined).toContain("0%");
		expect(joined).toContain("░░░░░");
		expect(joined).not.toContain("n/a");
	});

	it("marks a stale account with a (stale) marker and window-stale styling", () => {
		const model = mkVm([
			{
				provider: "anthropic",
				accounts: [acc("user", { freshness: "stale", windows: [win("5h", { fraction: 0.5, resetsAt: NOW + HOUR })] })],
			},
		]);
		const rows = renderRows(model, { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		expect(joinText(rows)).toContain("(stale)");
		expect(rows.some((r) => r.style === "window-stale")).toBe(true);
	});
});

describe("renderRows — normal-height budget maxRows>=3 (AC7)", () => {
	// One provider, 4 accounts; only "risky" is near-limit, so it is the
	// deterministic top-risk account retained first when the budget overflows.
	const overflowVm = () =>
		mkVm([
			{
				provider: "anthropic",
				accounts: [
					acc("calm1", { windows: [win("5h", { fraction: 0.2 })] }),
					acc("risky", { windows: [win("5h", { fraction: 0.95, nearLimit: true })] }),
					acc("calm2", { windows: [win("5h", { fraction: 0.1 })] }),
					acc("calm3", { windows: [win("5h", { fraction: 0.3 })] }),
				],
			},
		]);

	it("collapses the overflow into exactly one '+N more' row with the correct N, within budget", () => {
		const maxRows = 4;
		const rows = renderRows(overflowVm(), { width: 120, maxRows, expanded: false, now: NOW });
		expect(rows.length).toBeLessThanOrEqual(maxRows); // budget respected -> prompt-safe
		const moreRows = rows.filter((r) => r.style === "more");
		expect(moreRows).toHaveLength(1); // exactly one overflow row
		const shownAccounts = rows.filter((r) => r.style === "account-strong" || r.style === "account-dim").length;
		const n = Number.parseInt(moreRows[0]?.text.match(/\+(\d+)\s*more/)?.[1] ?? "NaN", 10);
		expect(n).toBe(4 - shownAccounts); // N == hidden account count (no off-by-one)
		expect(n).toBeGreaterThanOrEqual(1); // something really was hidden
	});

	it("retains the near-limit account first under budget pressure", () => {
		const rows = renderRows(overflowVm(), { width: 120, maxRows: 4, expanded: false, now: NOW });
		expect(joinText(rows)).toContain("risky"); // near-limit account survives
	});

	it("emits no '+N more' when every account fits the budget", () => {
		const rows = renderRows(overflowVm(), { width: 120, maxRows: 20, expanded: false, now: NOW });
		expect(rows.every((r) => r.style !== "more")).toBe(true);
		const joined = joinText(rows);
		for (const label of ["calm1", "risky", "calm2", "calm3"]) {
			expect(joined).toContain(label);
		}
	});
});

describe("renderRows — collapsed width ladder, stage by stage (AC7)", () => {
	// One account, two windows: a near-limit window (priority) and a low window.
	// Both carry a reset time so the ladder can shed the low window's countdown
	// first. Non-numeric window labels keep countdown tokens unambiguous to parse.
	// Render at `width`: build the two-window fixture (near "hi" + low "lo"),
	// assert the HARD width bound at every step, return the packed account row.
	const accountRowAt = (width: number): string => {
		const vm = mkVm([
			{
				provider: "anthropic",
				accounts: [
					acc("user", {
						windows: [
							win("hi", { fraction: 0.9, nearLimit: true, resetsAt: NOW + 2 * HOUR + 10 * MIN }), // near -> "2h10m"
							win("lo", { fraction: 0.3, nearLimit: false, resetsAt: NOW + 3 * HOUR }), // low -> "3h"
						],
					}),
				],
			},
		]);
		const rows = renderRows(vm, { width, maxRows: 10, expanded: false, now: NOW });
		for (const r of rows) expect(r.text.length).toBeLessThanOrEqual(width);
		return rows.find((r) => r.text.includes("90%"))?.text ?? "";
	};

	it("retains BOTH the mini-bar and the percent of the near-limit window at every width", () => {
		for (const width of [120, 90, 70, 56, 44, 36]) {
			const row = accountRowAt(width);
			expect(row).toContain("90%"); // near-limit percent always kept
			expect(/[▓░]/u.test(row.split("·").find((s) => s.includes("90%")) ?? "")).toBe(true); // near-limit bar always kept
		}
	});

	it("drops the low window's mini-bar before its percent as width shrinks — never a blunt cut", () => {
		// Dense integer sweep so we reliably observe the ladder's drop-bar-keep-pct
		// stage regardless of the impl's exact width thresholds.
		const lowHasBar: boolean[] = [];
		const lowHasPct: boolean[] = [];
		for (let width = 44; width >= 12; width--) {
			const row = accountRowAt(width);
			lowHasPct.push(row.includes("30%"));
			lowHasBar.push(/[▓░]/u.test(row.split("·").find((s) => s.includes("30%")) ?? ""));
		}
		// low-window detail is monotonic non-increasing as width shrinks (never returns):
		for (const seq of [lowHasBar, lowHasPct]) {
			expect(seq.every((v, i) => i === 0 || !(v && !seq[i - 1]))).toBe(true);
		}
		// the low window loses its bar no later than its percent (bar dropped first):
		const bi = lowHasBar.indexOf(false);
		const pi = lowHasPct.indexOf(false);
		const barGone = bi === -1 ? lowHasBar.length : bi;
		const pctGone = pi === -1 ? lowHasPct.length : pi;
		expect(barGone).toBeLessThanOrEqual(pctGone);
		// there IS a width where the low window keeps its percent but has lost its bar —
		// impossible for a blunt suffix truncation (which loses the trailing percent first):
		expect(lowHasPct.some((pct, i) => pct && !lowHasBar[i])).toBe(true);
	});

	it("shows both windows' percents at a generous width", () => {
		const row = accountRowAt(120);
		expect(row).toContain("90%");
		expect(row).toContain("30%");
	});

	it("truncates an over-long label with an ellipsis (…) rather than a blunt whole-row cut at an absurd width", () => {
		const longVm = mkVm([
			{
				provider: "anthropic",
				accounts: [acc("verylongaccountlabelname", { windows: [win("hi", { fraction: 0.9, nearLimit: true })] })],
			},
		]);
		const width = 8;
		const rows = renderRows(longVm, { width, maxRows: 10, expanded: false, now: NOW });
		for (const r of rows) expect(r.text.length).toBeLessThanOrEqual(width);
		expect(joinText(rows)).toContain("…"); // ellipsis => intelligent truncation, not slice(0, width)
	});
});

describe("renderRows — tiny-height ladder (AC7)", () => {
	// 3 accounts across 2 providers; alpha holds the only near-limit window so it
	// is the deterministic top-risk account; the other two form the "+2 more".
	const multi = () =>
		mkVm([
			{
				provider: "anthropic",
				accounts: [
					acc("alpha", { windows: [win("5h", { fraction: 0.9, nearLimit: true, resetsAt: NOW + HOUR })] }),
					acc("beta", { windows: [win("5h", { fraction: 0.2 })] }),
				],
			},
			{ provider: "openai-codex", accounts: [acc("gamma", { windows: [win("5h", { fraction: 0.1 })] })] },
		]);

	// maxRows 0/1/2 are the NORMATIVE ladder values (not tunables) — assert the
	// render directly at each, independent of deriveMaxRows' reserve constant.
	it("renders nothing at maxRows=0", () => {
		expect(renderRows(multi(), { width: 120, maxRows: 0, expanded: false, now: NOW })).toEqual([]);
	});

	it("renders a single synthesized '<top-risk> · +N more' row with no header at maxRows=1", () => {
		const rows = renderRows(multi(), { width: 120, maxRows: 1, expanded: false, now: NOW });
		expect(rows).toHaveLength(1);
		expect(rows.every((r) => r.style !== "provider-header")).toBe(true);
		expect(rows[0]?.text).toContain("alpha");
		expect(rows[0]?.text).toContain("+2 more");
	});

	it("renders a provider header + one synthesized row at maxRows=2", () => {
		const rows = renderRows(multi(), { width: 120, maxRows: 2, expanded: false, now: NOW });
		expect(rows).toHaveLength(2);
		expect(rows[0]?.style).toBe("provider-header");
		expect(rows[1]?.text).toContain("alpha");
		expect(rows[1]?.text).toContain("+2 more");
	});

	it("omits the '+N more' suffix when N===0 (single account total) at maxRows=1", () => {
		const solo = mkVm([{ provider: "anthropic", accounts: [acc("solo", { windows: [win("5h", { fraction: 0.5 })] })] }]);
		const rows = renderRows(solo, { width: 120, maxRows: 1, expanded: false, now: NOW });
		expect(rows).toHaveLength(1);
		expect(rows.every((r) => r.style !== "provider-header")).toBe(true);
		expect(rows[0]?.text).not.toContain("+");
		expect(rows[0]?.text).not.toContain("more");
	});

	it("omits the '+N more' suffix when N===0 at maxRows=2 (header + bare packed row)", () => {
		const solo = mkVm([{ provider: "anthropic", accounts: [acc("solo", { windows: [win("5h", { fraction: 0.5 })] })] }]);
		const rows = renderRows(solo, { width: 120, maxRows: 2, expanded: false, now: NOW });
		expect(rows).toHaveLength(2);
		expect(rows[0]?.style).toBe("provider-header");
		expect(rows[1]?.text).not.toContain("+");
		expect(rows[1]?.text).not.toContain("more");
		expect(rows[1]?.text).toContain("solo");
	});

	it("keeps rows <= maxRows for the multi-account fixture at each tiny budget", () => {
		for (const maxRows of [0, 1, 2]) {
			const rows = renderRows(multi(), { width: 120, maxRows, expanded: false, now: NOW });
			expect(rows.length).toBeLessThanOrEqual(maxRows);
		}
	});
});

describe("renderRows — expanded completeness (AC2/AC3)", () => {
	// 2 providers x 2 accounts x 3 windows = 12 windows, each label unique so we
	// can prove EVERY account and EVERY window renders on its own line, never
	// elided — the discriminator against an expanded view that drops detail.
	const bigExpandedVm = () => {
		const mkAcc = (label: string, prefix: string) =>
			acc(label, {
				windows: [
					win(`${prefix}-w1`, { fraction: 0.2 }),
					win(`${prefix}-w2`, { fraction: 0.5 }),
					win(`${prefix}-w3`, { fraction: 0.95, nearLimit: true }),
				],
			});
		return mkVm([
			{ provider: "anthropic", accounts: [mkAcc("alice", "an-a"), mkAcc("bob", "an-b")] },
			{ provider: "openai-codex", accounts: [mkAcc("carol", "cx-a"), mkAcc("dave", "cx-b")] },
		]);
	};

	it("renders every account and every window on its own line — no elision, no '+N more' — when expanded", () => {
		const rows = renderRows(bigExpandedVm(), { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const joined = joinText(rows);
		for (const label of ["alice", "bob", "carol", "dave"]) {
			expect(joined).toContain(label); // every account present
		}
		const windowLabels = ["an-a", "an-b", "cx-a", "cx-b"].flatMap((p) => [`${p}-w1`, `${p}-w2`, `${p}-w3`]);
		for (const wl of windowLabels) {
			expect(joined).toContain(wl); // every window present
		}
		// exactly one row per window (12) — never collapsed:
		const windowRows = rows.filter((r) => r.style === "window" || r.style === "window-stale" || r.style === "window-na");
		expect(windowRows).toHaveLength(12);
		// expanded never emits an overflow collapse:
		expect(rows.every((r) => r.style !== "more")).toBe(true);
	});

	it("emits an explicit n/a row (window-na) for an unavailable account with zero windows (never a bare name)", () => {
		const vm = mkVm([
			{ provider: "anthropic", accounts: [acc("gone", { freshness: "unavailable", windows: [] })] },
		]);
		const rows = renderRows(vm, { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const joined = joinText(rows);
		expect(joined).toContain("gone"); // the account name still appears...
		expect(rows.some((r) => r.style === "window-na")).toBe(true); // ...with an explicit n/a row
		expect(joined.includes("n/a") || joined.includes("—")).toBe(true);
		expect(joined).not.toContain("0%"); // never fabricated as 0%
	});

	it("omits only the countdown field for a window missing resetsAt (bar + percent still render)", () => {
		const vm = mkVm([
			{
				provider: "anthropic",
				accounts: [
					acc("user", {
						windows: [
							win("timed", { fraction: 0.5, resetsAt: NOW + 2 * HOUR + 10 * MIN }),
							win("plain", { fraction: 0.5 }), // no resetsAt
						],
					}),
				],
			},
		]);
		const rows = renderRows(vm, { width: 120, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const timedRow = rows.find((r) => r.text.includes("timed"))?.text ?? "";
		const plainRow = rows.find((r) => r.text.includes("plain"))?.text ?? "";
		expect(timedRow).toContain("2h10m"); // countdown present when resetsAt is set
		expect(plainRow).toContain("50%"); // same bar + percent...
		expect(plainRow).toMatch(/\d+%\s*$/); // ...ends at the percent: ONLY the countdown was dropped
		expect(plainRow).not.toContain("now"); // and no fabricated countdown
	});
});
