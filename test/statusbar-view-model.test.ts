import { describe, expect, it } from "vitest";
import {
	buildUsageViewModel,
	classifyLevel,
	CRIT_LIMIT,
	NEAR_LIMIT,
	SUPPORTED_PROVIDERS,
	type EnumeratedAccount,
	type UsageInput,
	type UsedFractionResolver,
} from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Pure-core unit tests for `buildUsageViewModel` (columnar redesign).
//
// The unit under test imports omp usage types only as `import type`, so it is
// loadable under vitest-on-Node; the runtime shapes the classifier reads are
// modeled with local structural fixtures (no `as` casts).
//
// Coverage targets:
//  * the provider allowlist + fixed COLUMN order (anthropic → openai-codex,
//    everything else dropped),
//  * the fixed per-provider window SLOTS — report-limit order must never leak
//    into the cell order (the bug this redesign kills),
//  * fable-slot detection by tier / limit-id / label,
//  * fraction sanitize (overage passthrough, non-finite → undefined) and the
//    ok/warn/crit level thresholds,
//  * the DR-F attribution sub-cases (metadata vs scope identity, unsafe
//    reports, consumed-once, singleton fallback) carried over unchanged.
// ---------------------------------------------------------------------------

interface FxScope {
	provider: string;
	accountId?: string;
	projectId?: string;
	orgId?: string;
	modelId?: string;
	tier?: string;
	windowId?: string;
	shared?: boolean;
}
interface FxWindow {
	id: string;
	label: string;
	durationMs?: number;
	resetsAt?: number;
}
interface FxAmount {
	unit: string;
	used?: number;
	limit?: number;
	remaining?: number;
	usedFraction?: number;
	remainingFraction?: number;
}
interface FxLimit {
	id: string;
	label: string;
	scope: FxScope;
	window?: FxWindow;
	amount: FxAmount;
}
interface FxReport {
	provider: string;
	fetchedAt: number;
	metadata?: Record<string, unknown>;
	limits: FxLimit[];
}

const NOW = 1_000_000_000;
const STALE_AFTER = 7 * 60_000;

// Mirrors the real `resolveUsedFraction` closely enough for the classifier: the
// fixtures set an explicit `usedFraction`, which the real resolver reads first.
const resolveUsed: UsedFractionResolver = (limit) => limit.amount?.usedFraction;

function lim(
	id: string,
	opts: {
		provider?: string;
		scope?: Partial<FxScope>;
		windowId?: string;
		resetsAt?: number;
		noWindow?: boolean;
		usedFraction?: number;
		label?: string;
	} = {},
): FxLimit {
	const windowId = opts.windowId ?? "5h";
	return {
		id,
		label: opts.label ?? id,
		scope: { provider: opts.provider ?? "anthropic", windowId, ...opts.scope },
		window: opts.noWindow ? undefined : { id: windowId, label: windowId, resetsAt: opts.resetsAt },
		amount: { unit: "requests", usedFraction: opts.usedFraction },
	};
}
function rep(opts: {
	provider?: string;
	fetchedAt?: number;
	metadata?: Record<string, unknown>;
	limits: FxLimit[];
}): FxReport {
	return {
		provider: opts.provider ?? "anthropic",
		fetchedAt: opts.fetchedAt ?? NOW,
		metadata: opts.metadata,
		limits: opts.limits,
	};
}
function acct(opts: Partial<EnumeratedAccount> & { credentialId: number }): EnumeratedAccount {
	return { provider: "anthropic", isSubscription: true, disabled: false, ...opts };
}
function input(opts: {
	accounts: EnumeratedAccount[];
	reports: FxReport[] | null;
	now?: number;
	staleAfterMs?: number;
}): UsageInput {
	return {
		now: opts.now ?? NOW,
		staleAfterMs: opts.staleAfterMs ?? STALE_AFTER,
		accounts: opts.accounts,
		reports: opts.reports as unknown as UsageInput["reports"],
	};
}

/** The standard 3 anthropic limits, in a caller-chosen order. */
function anthropicLimits(order: Array<"5h" | "7d" | "fable">, fractions: Partial<Record<string, number>> = {}): FxLimit[] {
	const mk = {
		"5h": () => lim("anthropic:5h", { windowId: "5h", usedFraction: fractions["5h"] ?? 0.1, resetsAt: NOW + 1000 }),
		"7d": () => lim("anthropic:7d", { windowId: "7d", usedFraction: fractions["7d"] ?? 0.2, resetsAt: NOW + 2000 }),
		fable: () =>
			lim("anthropic:7d:fable", {
				windowId: "7d",
				scope: { tier: "fable" },
				label: "Claude 7 Day (Fable)",
				usedFraction: fractions.fable ?? 0.3,
				resetsAt: NOW + 3000,
			}),
	};
	return order.map((k) => mk[k]());
}

describe("provider allowlist and fixed column order", () => {
	it("keeps only anthropic and openai-codex, in that order, regardless of account input order", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, provider: "zai", isSubscription: false, note: "no usage - api key" }),
					acct({ credentialId: 2, provider: "openai-codex", email: "c@x.com" }),
					acct({ credentialId: 3, provider: "gemini", email: "g@x.com" }),
					acct({ credentialId: 4, provider: "anthropic", email: "a@x.com" }),
				],
				reports: [],
			}),
			resolveUsed,
		);
		expect(vm.columns.map((c) => c.provider)).toEqual(["anthropic", "openai-codex"]);
		expect(vm.empty).toBe(false);
	});

	it("SUPPORTED_PROVIDERS names exactly the two columns, in display order", () => {
		expect(SUPPORTED_PROVIDERS).toEqual(["anthropic", "openai-codex"]);
	});

	it("is empty when only unsupported providers have accounts", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, provider: "zai", isSubscription: false, note: "no usage - api key" }),
					acct({ credentialId: 2, provider: "gemini", email: "g@x.com" }),
				],
				reports: [],
			}),
			resolveUsed,
		);
		expect(vm.columns).toEqual([]);
		expect(vm.empty).toBe(true);
	});

	it("is empty on zero accounts and omits a provider column with no accounts", () => {
		expect(buildUsageViewModel(input({ accounts: [], reports: null }), resolveUsed).empty).toBe(true);
		const vm = buildUsageViewModel(
			input({ accounts: [acct({ credentialId: 1, provider: "openai-codex", email: "c@x.com" })], reports: [] }),
			resolveUsed,
		);
		expect(vm.columns.map((c) => c.provider)).toEqual(["openai-codex"]);
	});

	it("exposes display titles and slot metadata on each column", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, email: "a@x.com" }),
					acct({ credentialId: 2, provider: "openai-codex", email: "c@x.com" }),
				],
				reports: [],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].title).toBe("Anthropic");
		expect(vm.columns[0].slots.map((s) => s.key)).toEqual(["5h", "7d", "fable-7d"]);
		expect(vm.columns[0].slots.map((s) => s.header)).toEqual(["5h", "7d", "Fable 7d"]);
		expect(vm.columns[1].title).toBe("OpenAI Codex");
		expect(vm.columns[1].slots.map((s) => s.key)).toEqual(["7d"]);
	});
});

describe("fixed anthropic window slots — 5h, 7d, Fable 7d in that order, always", () => {
	const ORDERS: Array<Array<"5h" | "7d" | "fable">> = [
		["5h", "7d", "fable"],
		["fable", "7d", "5h"],
		["7d", "fable", "5h"],
		["7d", "5h", "fable"],
	];

	for (const order of ORDERS) {
		it(`normalizes report order [${order.join(", ")}] into cells [5h, 7d, fable-7d]`, () => {
			const vm = buildUsageViewModel(
				input({
					accounts: [acct({ credentialId: 1, email: "a@x.com" })],
					reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(order) })],
				}),
				resolveUsed,
			);
			const cells = vm.columns[0].accounts[0].cells;
			expect(cells.map((c) => c.slotKey)).toEqual(["5h", "7d", "fable-7d"]);
			expect(cells.map((c) => c.fraction)).toEqual([0.1, 0.2, 0.3]);
			expect(cells.map((c) => c.resetsAt)).toEqual([NOW + 1000, NOW + 2000, NOW + 3000]);
		});
	}

	it("keeps every account's cells in the same slot order even when each report is scrambled differently", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" }), acct({ credentialId: 2, email: "b@x.com" })],
				reports: [
					rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["fable", "5h", "7d"]) }),
					rep({ metadata: { email: "b@x.com" }, limits: anthropicLimits(["7d", "fable", "5h"]) }),
				],
			}),
			resolveUsed,
		);
		for (const account of vm.columns[0].accounts) {
			expect(account.cells.map((c) => c.slotKey)).toEqual(["5h", "7d", "fable-7d"]);
		}
	});

	it("a missing window leaves its slot present with fraction undefined (cell keeps its position)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h", "7d"]) })],
			}),
			resolveUsed,
		);
		const cells = vm.columns[0].accounts[0].cells;
		expect(cells).toHaveLength(3);
		expect(cells[2].slotKey).toBe("fable-7d");
		expect(cells[2].fraction).toBeUndefined();
		expect(cells[2].level).toBe("ok");
	});

	it("detects the fable slot by scope.tier, by limit-id suffix, and by label", () => {
		const byTier = lim("x1", { windowId: "7d", scope: { tier: "fable" }, usedFraction: 0.4 });
		const byId = lim("anthropic:7d:fable", { windowId: "7d", usedFraction: 0.5 });
		const byLabel = lim("x2", { windowId: "7d", label: "Claude 7 Day (Fable)", usedFraction: 0.6 });
		for (const fable of [byTier, byId, byLabel]) {
			const vm = buildUsageViewModel(
				input({
					accounts: [acct({ credentialId: 1, email: "a@x.com" })],
					reports: [rep({ metadata: { email: "a@x.com" }, limits: [fable] })],
				}),
				resolveUsed,
			);
			const cells = vm.columns[0].accounts[0].cells;
			expect(cells[2].fraction).toBe(fable.amount.usedFraction);
			expect(cells[1].fraction).toBeUndefined(); // never misfiled into the shared 7d slot
		}
	});

	it("ignores windows that fit no slot (scoped non-fable weekly tiers, unknown ids, window-less limits)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [
					rep({
						metadata: { email: "a@x.com" },
						limits: [
							lim("anthropic:7d:opus", { windowId: "7d", scope: { tier: "opus" }, usedFraction: 0.99 }),
							lim("anthropic:monthly", { windowId: "monthly", usedFraction: 0.98 }),
							lim("anthropic:5h:broken", { windowId: "5h", noWindow: true, usedFraction: 0.97 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts[0].cells.map((c) => c.fraction)).toEqual([undefined, undefined, undefined]);
	});

	it("first matching limit wins when a slot is duplicated", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [
					rep({
						metadata: { email: "a@x.com" },
						limits: [
							lim("anthropic:5h", { windowId: "5h", usedFraction: 0.11 }),
							lim("anthropic:5h:dup", { windowId: "5h", usedFraction: 0.99 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts[0].cells[0].fraction).toBe(0.11);
	});
});

describe("openai-codex slots — only the 7 days window", () => {
	it("maps the 7d window and ignores 1h/5h primaries", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, provider: "openai-codex", email: "c@x.com" })],
				reports: [
					rep({
						provider: "openai-codex",
						metadata: { email: "c@x.com" },
						limits: [
							lim("codex:1h", { provider: "openai-codex", windowId: "1h", usedFraction: 0.9 }),
							lim("codex:7d", { provider: "openai-codex", windowId: "7d", usedFraction: 0.19, resetsAt: NOW + 500 }),
							lim("codex:5h", { provider: "openai-codex", windowId: "5h", usedFraction: 0.8 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		const cells = vm.columns[0].accounts[0].cells;
		expect(cells).toHaveLength(1);
		expect(cells[0]).toMatchObject({ slotKey: "7d", fraction: 0.19, resetsAt: NOW + 500, level: "ok" });
	});
});

describe("fraction sanitize and ok/warn/crit levels", () => {
	it("classifyLevel: warn at NEAR_LIMIT, crit at CRIT_LIMIT, boundaries inclusive", () => {
		expect(classifyLevel(undefined)).toBe("ok");
		expect(classifyLevel(0)).toBe("ok");
		expect(classifyLevel(NEAR_LIMIT - 0.001)).toBe("ok");
		expect(classifyLevel(NEAR_LIMIT)).toBe("warn");
		expect(classifyLevel(CRIT_LIMIT - 0.001)).toBe("warn");
		expect(classifyLevel(CRIT_LIMIT)).toBe("crit");
		expect(classifyLevel(1.4)).toBe("crit");
	});

	it("preserves an overage fraction (>1) unclamped and marks it crit", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h"], { "5h": 1.37 }) })],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts[0].cells[0]).toMatchObject({ fraction: 1.37, level: "crit" });
	});

	it("maps a non-finite or missing resolver result to fraction undefined (never NaN)", () => {
		for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
			const vm = buildUsageViewModel(
				input({
					accounts: [acct({ credentialId: 1, email: "a@x.com" })],
					reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h"]) })],
				}),
				() => bad,
			);
			expect(vm.columns[0].accounts[0].cells[0].fraction).toBeUndefined();
		}
	});
});

describe("report → account attribution (DR-F, carried over)", () => {
	it("matches by metadata accountId first", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "acc-1" }), acct({ credentialId: 2, accountId: "acc-2" })],
				reports: [
					rep({ metadata: { accountId: "acc-2" }, limits: anthropicLimits(["5h"], { "5h": 0.22 }) }),
					rep({ metadata: { accountId: "acc-1" }, limits: anthropicLimits(["5h"], { "5h": 0.11 }) }),
				],
			}),
			resolveUsed,
		);
		const [a1, a2] = vm.columns[0].accounts;
		expect(a1.cells[0].fraction).toBe(0.11);
		expect(a2.cells[0].fraction).toBe(0.22);
	});

	it("matches by scope accountId when metadata is absent", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "acc-1" }), acct({ credentialId: 2, accountId: "acc-2" })],
				reports: [
					rep({ limits: [lim("l1", { scope: { accountId: "acc-1" }, usedFraction: 0.11 })] }),
					rep({ limits: [lim("l2", { scope: { accountId: "acc-2" }, usedFraction: 0.22 })] }),
				],
			}),
			resolveUsed,
		);
		const [a1, a2] = vm.columns[0].accounts;
		expect(a1.cells[0].fraction).toBe(0.11);
		expect(a2.cells[0].fraction).toBe(0.22);
	});

	it("matches by email (metadata email or account/user/username label), case-insensitively", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "A@X.com" }), acct({ credentialId: 2, email: "b@x.com" })],
				reports: [
					rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h"], { "5h": 0.11 }) }),
					rep({ metadata: { username: "B@x.CoM" }, limits: anthropicLimits(["5h"], { "5h": 0.22 }) }),
				],
			}),
			resolveUsed,
		);
		const [a1, a2] = vm.columns[0].accounts;
		expect(a1.cells[0].fraction).toBe(0.11);
		expect(a2.cells[0].fraction).toBe(0.22);
	});

	it("never matches an identity-unsafe report (scope splits across orgs/accounts)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "acc-1" })],
				reports: [
					rep({
						metadata: { accountId: "acc-1" },
						limits: [
							lim("l1", { scope: { orgId: "org-a" }, usedFraction: 0.5 }),
							lim("l2", { scope: { orgId: "org-b" }, usedFraction: 0.6 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts[0].freshness).toBe("unavailable");
	});

	it("consumes each report at most once (two accounts cannot share one report)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" }), acct({ credentialId: 2, email: "a@x.com" })],
				reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h"], { "5h": 0.11 }) })],
			}),
			resolveUsed,
		);
		const matched = vm.columns[0].accounts.filter((a) => a.freshness !== "unavailable");
		expect(matched).toHaveLength(1);
	});

	it("falls back to the singleton pairing (one unmatched account + one safe report)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [rep({ limits: anthropicLimits(["5h"], { "5h": 0.11 }) })],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts[0].cells[0].fraction).toBe(0.11);
	});

	it("classifies an unmatched subscription account as unavailable with all-empty cells", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" }), acct({ credentialId: 2, email: "b@x.com" })],
				reports: [rep({ metadata: { email: "a@x.com" }, limits: anthropicLimits(["5h"]) })],
			}),
			resolveUsed,
		);
		const b = vm.columns[0].accounts[1];
		expect(b.freshness).toBe("unavailable");
		expect(b.cells).toHaveLength(3);
		expect(b.cells.every((c) => c.fraction === undefined)).toBe(true);
	});
});

describe("account rows — labels, ordering, staleness, api-key notes", () => {
	it("labels by email local part, else accountId, else #position/credentialId", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, email: "soyesenna@gmail.com", position: 0 }),
					acct({ credentialId: 2, accountId: "kjy915875", position: 1 }),
					acct({ credentialId: 3, position: 7 }),
					acct({ credentialId: 9 }),
				],
				reports: [],
			}),
			resolveUsed,
		);
		expect(vm.columns[0].accounts.map((a) => a.label)).toEqual(["soyesenna", "kjy915875", "#7", "#9"]);
	});

	it("orders subscription accounts by position (then input order), api-key notes last", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, isSubscription: false, note: "no usage - api key" }),
					acct({ credentialId: 2, email: "b@x.com", position: 1 }),
					acct({ credentialId: 3, email: "a@x.com", position: 0 }),
				],
				reports: [],
			}),
			resolveUsed,
		);
		const rows = vm.columns[0].accounts;
		expect(rows.map((a) => a.label)).toEqual(["a", "b", "#1"]);
		expect(rows[2]).toMatchObject({ isSubscription: false, note: "no usage - api key", cells: [] });
	});

	it("marks a report older than staleAfterMs as stale (freshness only — cells still render)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "a@x.com" })],
				reports: [
					rep({ metadata: { email: "a@x.com" }, fetchedAt: NOW - STALE_AFTER - 1, limits: anthropicLimits(["5h"]) }),
				],
			}),
			resolveUsed,
		);
		const a = vm.columns[0].accounts[0];
		expect(a.freshness).toBe("stale");
		expect(a.cells[0].fraction).toBe(0.1);
	});
});
