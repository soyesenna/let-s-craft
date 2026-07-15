import { describe, expect, it } from "vitest";
import {
	buildUsageViewModel,
	type EnumeratedAccount,
	type UsageInput,
	type UsedFractionResolver,
	type WindowVM,
} from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Pure-core unit tests for `buildUsageViewModel` (plan §6 Step 3 / §9 unit).
//
// The unit under test imports omp usage types only as `import type`, so it is
// loadable under vitest-on-Node. The `@oh-my-pi/pi-ai` VALUE package is added
// as a dependency only at craft Gate 0 and is not resolvable here, so — exactly
// like the preset suites fake the `AgentModelStore`/`SessionModelApi` seams — we
// model the runtime shapes the classifier reads with local structural fixtures.
// No `as` casts: the builders return typed objects the pure core can consume.
//
// Coverage targets (Stage-4 consensus, iteration 2): the resolver→WindowVM
// sanitize matrix (overage/negative/non-finite/zero/near-limit boundary — so a
// VM that clamps overage to 1 is caught), a full-scope window-key matrix (so a
// key = limit.id-only impl is caught), and the DR-F attribution sub-cases
// (metadata-only vs scope-only, projectId tier, multi-project/-org unsafe,
// consumed-once, no-identity, positive singleton, empty).
//
// These tests are RED until craft implements `src/statusbar/view-model.ts`
// (a load error on the missing module is the expected pre-implementation state);
// they turn GREEN once the module is built to the plan's contract.
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
const STALE_AFTER = 7 * 60_000; // plan STALE_AFTER_MS

// Mirrors the real `resolveUsedFraction` closely enough for the classifier: the
// fixtures set an explicit `usedFraction`, which the real resolver reads first.
const resolveUsed: UsedFractionResolver = (limit) => limit.amount?.usedFraction;

function win(id: string, opts: { label?: string; resetsAt?: number } = {}): FxWindow {
	return { id, label: opts.label ?? id, resetsAt: opts.resetsAt };
}
function lim(
	id: string,
	opts: {
		provider?: string;
		scope?: Partial<FxScope>;
		window?: FxWindow;
		usedFraction?: number;
		label?: string;
	} = {},
): FxLimit {
	return {
		id,
		label: opts.label ?? id,
		scope: { provider: opts.provider ?? "anthropic", ...opts.scope },
		window: opts.window,
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
		reports: opts.reports,
	};
}

describe("buildUsageViewModel — grouping & labeling (AC2)", () => {
	it("renders two same-provider accounts as distinct AccountVMs labeled by email local-part", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, email: "user@x.com", accountId: "acc-1", position: 0 }),
					acct({ credentialId: 2, email: "user.work@x.com", accountId: "acc-2", position: 1 }),
				],
				reports: [
					rep({
						metadata: { email: "user@x.com", accountId: "acc-1" },
						limits: [lim("l1", { scope: { accountId: "acc-1" }, window: win("5h"), usedFraction: 0.5 })],
					}),
					rep({
						metadata: { email: "user.work@x.com", accountId: "acc-2" },
						limits: [lim("l2", { scope: { accountId: "acc-2" }, window: win("7d"), usedFraction: 0.6 })],
					}),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		expect(accounts.map((a) => a.label).sort()).toEqual(["user", "user.work"]);
		expect(accounts.find((a) => a.label === "user")?.windows).toHaveLength(1);
		expect(accounts.find((a) => a.label === "user.work")?.windows).toHaveLength(1);
	});

	it("labels an api-key account with no email using the '#<id>' fallback, never a blank name", () => {
		const vm = buildUsageViewModel(
			input({ accounts: [acct({ credentialId: 7, isSubscription: false })], reports: [] }),
			resolveUsed,
		);
		const account = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0];
		expect(account?.label).toBe("#7");
	});
});

describe("buildUsageViewModel — ordering & subscription vs non-subscription (AC4)", () => {
	it("orders subscription accounts first and dims non-subscription with a 'no usage' note and no fabricated windows", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					// non-subscription listed first in input to prove reordering
					acct({ credentialId: 7, isSubscription: false }),
					acct({ credentialId: 1, isSubscription: true, email: "pro@x.com", accountId: "acc-s", position: 0 }),
				],
				reports: [
					rep({
						metadata: { email: "pro@x.com", accountId: "acc-s" },
						limits: [lim("l1", { scope: { accountId: "acc-s" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		expect(accounts).toHaveLength(2);

		// subscription first, emphasized, carries its matched window
		expect(accounts[0]?.isSubscription).toBe(true);
		expect(accounts[0]?.label).toBe("pro");
		expect(accounts[0]?.windows).toHaveLength(1);

		// non-subscription after: no fabricated 0% windows, an explicit note
		const nonSub = accounts[1];
		expect(nonSub?.isSubscription).toBe(false);
		expect(nonSub?.windows).toHaveLength(0);
		expect(nonSub?.label).toBe("#7");
		expect(typeof nonSub?.note).toBe("string");
		expect((nonSub?.note ?? "").length).toBeGreaterThan(0);
		expect((nonSub?.note ?? "").toLowerCase()).toContain("no usage");
	});
});

describe("buildUsageViewModel — empty view model", () => {
	it("marks the view model empty when there are zero accounts", () => {
		const vm = buildUsageViewModel(input({ accounts: [], reports: null }), resolveUsed);
		expect(vm.empty).toBe(true);
		expect(vm.groups.every((g) => g.accounts.length === 0)).toBe(true);
	});

	it("is not empty when at least one account is present", () => {
		const vm = buildUsageViewModel(
			input({ accounts: [acct({ credentialId: 1, accountId: "a", email: "u@x.com" })], reports: [] }),
			resolveUsed,
		);
		expect(vm.empty).toBe(false);
	});
});

describe("buildUsageViewModel — freshness (AC5)", () => {
	it("marks a matched report fresh when within staleAfterMs", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						fetchedAt: NOW,
						metadata: { accountId: "a" },
						limits: [lim("l1", { scope: { accountId: "a" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.freshness).toBe("fresh");
	});

	it("marks a report stale when fetchedAt is older than staleAfterMs", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						fetchedAt: NOW - STALE_AFTER - 1_000,
						metadata: { accountId: "a" },
						limits: [lim("l1", { scope: { accountId: "a" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.freshness).toBe("stale");
	});

	// Boundary: staleness is a strict `>` (plan §6 Step 3.5: now - fetchedAt > staleAfterMs).
	it("treats exactly staleAfterMs since fetchedAt as fresh (boundary is strict >)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						fetchedAt: NOW - STALE_AFTER, // now - fetchedAt === staleAfterMs exactly
						metadata: { accountId: "a" },
						limits: [lim("l1", { scope: { accountId: "a" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.freshness).toBe("fresh");
	});

	it("treats one ms beyond staleAfterMs as stale", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						fetchedAt: NOW - STALE_AFTER - 1,
						metadata: { accountId: "a" },
						limits: [lim("l1", { scope: { accountId: "a" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		expect(vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.freshness).toBe("stale");
	});

	it("marks a subscription account unavailable with no windows when no report matches", () => {
		const vm = buildUsageViewModel(
			input({ accounts: [acct({ credentialId: 1, accountId: "a", email: "u@x.com" })], reports: [] }),
			resolveUsed,
		);
		const account = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0];
		expect(account?.freshness).toBe("unavailable");
		expect(account?.windows).toHaveLength(0);
	});
});

describe("buildUsageViewModel — fraction sanitize resolver matrix (AC9)", () => {
	it("preserves a 0 fraction as 0 and maps an unresolved fraction to undefined (order preserved)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						metadata: { accountId: "a" },
						limits: [
							lim("l0", { scope: { accountId: "a" }, window: win("5h"), usedFraction: 0 }),
							lim("l1", { scope: { accountId: "a" }, window: win("7d") }), // no usedFraction -> resolver undefined
						],
					}),
				],
			}),
			resolveUsed,
		);
		const account = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0];
		expect(account?.windows).toHaveLength(2);
		expect(account?.windows[0]?.fraction).toBe(0); // valid 0% — preserved, not undefined
		expect(account?.windows[1]?.fraction).toBeUndefined(); // unresolved -> undefined (renders n/a, never 0%)
	});

	// Table-driven: the WindowVM fraction is exactly what the injected resolver
	// returns, finite-sanitized — isolating the VM's sanitize + nearLimit rule
	// from how the real resolver derives the number. A VM that CLAMPS overage to
	// 1 (a plausible wrong impl) is caught by the 1.4 -> 1.4 row.
	function soleWindow(resolved: number | undefined): WindowVM | undefined {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "a" })],
				reports: [
					rep({
						metadata: { accountId: "a" },
						limits: [lim("l1", { scope: { accountId: "a" }, window: win("5h") })],
					}),
				],
			}),
			() => resolved,
		);
		return vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.windows[0];
	}

	const cases: Array<{ name: string; resolved: number | undefined; fraction: number | undefined; nearLimit: boolean }> = [
		{ name: "overage >1 is preserved (NOT clamped) and is near-limit", resolved: 1.4, fraction: 1.4, nearLimit: true },
		{ name: "a negative fraction is preserved as-is", resolved: -0.1, fraction: -0.1, nearLimit: false },
		{ name: "NaN sanitizes to undefined", resolved: Number.NaN, fraction: undefined, nearLimit: false },
		{ name: "+Infinity sanitizes to undefined", resolved: Number.POSITIVE_INFINITY, fraction: undefined, nearLimit: false },
		{ name: "-Infinity sanitizes to undefined", resolved: Number.NEGATIVE_INFINITY, fraction: undefined, nearLimit: false },
		{ name: "zero is preserved as 0 (never undefined)", resolved: 0, fraction: 0, nearLimit: false },
		{ name: "the NEAR_LIMIT boundary 0.75 is near-limit", resolved: 0.75, fraction: 0.75, nearLimit: true },
	];

	for (const c of cases) {
		it(`sanitize: ${c.name}`, () => {
			const w = soleWindow(c.resolved);
			expect(w).toBeDefined();
			expect(w?.fraction).toBe(c.fraction);
			expect(w?.nearLimit).toBe(c.nearLimit);
		});
	}
});

describe("buildUsageViewModel — generic window keying (AC9)", () => {
	// Per-limit keying dims (windowId/modelId/tier/shared) legitimately vary
	// within ONE account's report (they never make it identityUnsafe), so two
	// limits sharing window.id AND limit.id but differing in exactly one such
	// dim must yield TWO windows with DISTINCT keys — proving the key serializes
	// the scope dim, not just limit.id (a key = limit.id-only impl collapses them).
	const perLimitDims: Array<{ dim: keyof FxScope; a: Partial<FxScope>; b: Partial<FxScope> }> = [
		{ dim: "windowId", a: { windowId: "wA" }, b: { windowId: "wB" } },
		{ dim: "modelId", a: { modelId: "mA" }, b: { modelId: "mB" } },
		{ dim: "tier", a: { tier: "tA" }, b: { tier: "tB" } },
		{ dim: "shared", a: { shared: true }, b: { shared: false } },
	];

	for (const { dim, a, b } of perLimitDims) {
		it(`disambiguates two same-window.id/same-limit.id limits by differing scope.${String(dim)}`, () => {
			const vm = buildUsageViewModel(
				input({
					accounts: [acct({ credentialId: 1, accountId: "acc-1" })],
					reports: [
						rep({
							metadata: { accountId: "acc-1" },
							limits: [
								lim("dup", { scope: { accountId: "acc-1", ...a }, window: win("7d") }),
								lim("dup", { scope: { accountId: "acc-1", ...b }, window: win("7d") }),
							],
						}),
					],
				}),
				resolveUsed,
			);
			const windows = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.windows ?? [];
			expect(windows).toHaveLength(2); // one per limit — never collapsed
			expect(windows[0]?.key).not.toBe(windows[1]?.key); // disambiguated by the scope dim
			// the key is not just the bare literal window.id / limit.id:
			expect(windows[0]?.key).not.toBe("7d");
			expect(windows[0]?.key).not.toBe("dup");
		});
	}

	// Identity-bearing dims (accountId/projectId/orgId) cannot legitimately vary
	// within one report (that trips identityUnsafe), so isolate each by matching
	// the account via a STABLE email and rebuilding with only that scope dim
	// changed — the sole window's key must differ.
	function soleWindowKey(scopeOverride: Partial<FxScope>): string | undefined {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, email: "u@x.com" })], // matched by email; no accountId
				reports: [
					rep({
						metadata: { email: "u@x.com" },
						limits: [lim("l", { scope: { ...scopeOverride }, window: win("5h") })],
					}),
				],
			}),
			resolveUsed,
		);
		return vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.windows[0]?.key;
	}

	const identityDims: Array<{ dim: keyof FxScope; a: Partial<FxScope>; b: Partial<FxScope> }> = [
		{ dim: "accountId", a: { accountId: "idA" }, b: { accountId: "idB" } },
		{ dim: "projectId", a: { projectId: "pA" }, b: { projectId: "pB" } },
		{ dim: "orgId", a: { orgId: "oA" }, b: { orgId: "oB" } },
	];
	for (const { dim, a, b } of identityDims) {
		it(`serializes scope.${String(dim)} into the window key`, () => {
			const keyA = soleWindowKey(a);
			const keyB = soleWindowKey(b);
			expect(keyA).toBeDefined();
			expect(keyA).not.toBe(keyB);
			expect(keyA).not.toBe("5h"); // not the bare window id
			expect(keyA).not.toBe("l"); // not the bare limit id
		});
	}

	it("falls back to limit.id when scope AND window.id are identical (collision tiebreaker)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "acc-1" })],
				reports: [
					rep({
						metadata: { accountId: "acc-1" },
						limits: [
							lim("lim-A", { scope: { accountId: "acc-1", modelId: "same" }, window: win("7d") }),
							lim("lim-B", { scope: { accountId: "acc-1", modelId: "same" }, window: win("7d") }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		const windows = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0]?.windows ?? [];
		expect(windows).toHaveLength(2);
		// identical scope + identical window.id -> limit.id is the disambiguator
		expect(windows[0]?.key).not.toBe(windows[1]?.key);
	});
});

describe("buildUsageViewModel — host-equivalent attribution (DR-F)", () => {
	it("matches multiple gemini accounts by unique scope.accountId/projectId when metadata has no identity (2 accounts — no singleton rescue)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ provider: "google-gemini-cli", credentialId: 1, accountId: "g1", projectId: "p1", position: 0 }),
					acct({ provider: "google-gemini-cli", credentialId: 2, accountId: "g2", projectId: "p2", position: 1 }),
				],
				reports: [
					rep({
						provider: "google-gemini-cli",
						metadata: {},
						limits: [
							lim("l1a", { provider: "google-gemini-cli", scope: { accountId: "g1", projectId: "p1" }, window: win("5h"), usedFraction: 0.5 }),
							lim("l1b", { provider: "google-gemini-cli", scope: { accountId: "g1", projectId: "p1" }, window: win("7d"), usedFraction: 0.6 }),
						],
					}),
					rep({
						provider: "google-gemini-cli",
						metadata: {},
						limits: [lim("l2", { provider: "google-gemini-cli", scope: { accountId: "g2", projectId: "p2" }, window: win("5h"), usedFraction: 0.4 })],
					}),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "google-gemini-cli")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		// scope.accountId attribution across 2 accounts — a metadata-only join leaves BOTH unavailable (singleton can't rescue 2)
		expect(accounts.every((a) => a.freshness === "fresh")).toBe(true);
		expect(accounts.find((a) => a.label === "g1")?.windows).toHaveLength(2);
		expect(accounts.find((a) => a.label === "g2")?.windows).toHaveLength(1);
	});

	it("matches multiple kimi-code accounts by unique scope.accountId when metadata carries only an endpoint (2 accounts)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ provider: "kimi-code", credentialId: 1, accountId: "k1", position: 0 }),
					acct({ provider: "kimi-code", credentialId: 2, accountId: "k2", position: 1 }),
				],
				reports: [
					rep({ provider: "kimi-code", metadata: { endpoint: "https://api.example.invalid" }, limits: [lim("l1", { provider: "kimi-code", scope: { accountId: "k1", shared: true }, window: win("monthly"), usedFraction: 0.1 })] }),
					rep({ provider: "kimi-code", metadata: { endpoint: "https://api.example.invalid" }, limits: [lim("l2", { provider: "kimi-code", scope: { accountId: "k2", shared: true }, window: win("monthly"), usedFraction: 0.2 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "kimi-code")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		expect(accounts.every((a) => a.freshness === "fresh")).toBe(true);
		expect(accounts.every((a) => a.windows.length === 1)).toBe(true);
	});

	it("matches gemini accounts by unique scope.projectId when they have no accountId (projectId tier, 2 accounts)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ provider: "google-gemini-cli", credentialId: 1, projectId: "proj-1", position: 0 }),
					acct({ provider: "google-gemini-cli", credentialId: 2, projectId: "proj-2", position: 1 }),
				],
				reports: [
					rep({ provider: "google-gemini-cli", metadata: {}, limits: [lim("l1", { provider: "google-gemini-cli", scope: { projectId: "proj-1" }, window: win("1d"), usedFraction: 0.5 })] }),
					rep({ provider: "google-gemini-cli", metadata: {}, limits: [lim("l2", { provider: "google-gemini-cli", scope: { projectId: "proj-2" }, window: win("1d"), usedFraction: 0.6 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "google-gemini-cli")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		// tier-3 projectId — an accountId/metadata-only join leaves both unavailable (singleton can't rescue 2)
		expect(accounts.every((a) => a.freshness === "fresh")).toBe(true);
	});

	it("attributes anthropic by metadata identity when scope carries no accountId (2 accounts; a scope-only join would miss them)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, accountId: "acc-A", email: "a@x.com", position: 0 }),
					acct({ credentialId: 2, accountId: "acc-B", email: "b@x.com", position: 1 }),
				],
				reports: [
					rep({ metadata: { accountId: "acc-A", email: "a@x.com" }, limits: [lim("l1", { scope: { provider: "anthropic" }, window: win("5h"), usedFraction: 0.5 })] }),
					rep({ metadata: { accountId: "acc-B", email: "b@x.com" }, limits: [lim("l2", { scope: { provider: "anthropic" }, window: win("5h"), usedFraction: 0.6 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		// metadata-first: scope carries no accountId, so a scope-only join leaves both unavailable
		expect(accounts.every((a) => a.freshness === "fresh")).toBe(true);
		expect(accounts.every((a) => a.windows.length === 1)).toBe(true);
	});

	it("attributes openai-codex by metadata identity when scope carries no accountId (2 accounts)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ provider: "openai-codex", credentialId: 1, accountId: "cx-A", email: "carol@openai.com", position: 0 }),
					acct({ provider: "openai-codex", credentialId: 2, accountId: "cx-B", email: "dan@openai.com", position: 1 }),
				],
				reports: [
					rep({ provider: "openai-codex", metadata: { accountId: "cx-A", email: "carol@openai.com" }, limits: [lim("l1", { provider: "openai-codex", scope: { provider: "openai-codex" }, window: win("weekly"), usedFraction: 0.4 })] }),
					rep({ provider: "openai-codex", metadata: { accountId: "cx-B", email: "dan@openai.com" }, limits: [lim("l2", { provider: "openai-codex", scope: { provider: "openai-codex" }, window: win("weekly"), usedFraction: 0.5 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "openai-codex")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		expect(accounts.every((a) => a.freshness === "fresh")).toBe(true);
	});

	it("matches by email after trimming and lowercasing, and a sibling must not steal the report (2 accounts)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, email: "user@x.com", position: 0 }),
					acct({ credentialId: 2, email: "other@x.com", position: 1 }),
				],
				reports: [
					rep({ metadata: { email: "  User@X.com  " }, limits: [lim("l1", { scope: { provider: "anthropic" }, window: win("5h"), usedFraction: 0.5 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		// report-side normalization (" User@X.com " -> user@x.com) is REQUIRED; a 2nd account blocks a singleton rescue
		expect(accounts.find((a) => a.label === "user")?.freshness).toBe("fresh");
		expect(accounts.find((a) => a.label === "user")?.windows).toHaveLength(1);
		expect(accounts.find((a) => a.label === "other")?.freshness).toBe("unavailable");
	});

	it("renders a metadata/scope-conflict report's account unavailable while a clean sibling still matches", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ provider: "openai-codex", credentialId: 1, accountId: "acct-A", email: "a@x.com", position: 0 }),
					acct({ provider: "openai-codex", credentialId: 2, accountId: "acct-C", email: "c@x.com", position: 1 }),
				],
				reports: [
					// conflict: metadata.accountId acct-A but scope.accountId acct-B -> identityUnsafe -> excluded
					rep({
						provider: "openai-codex",
						metadata: { accountId: "acct-A" },
						limits: [lim("lc", { provider: "openai-codex", scope: { accountId: "acct-B" }, window: win("5h"), usedFraction: 0.9 })],
					}),
					// clean: metadata acct-C == scope acct-C -> identity-safe
					rep({
						provider: "openai-codex",
						metadata: { accountId: "acct-C" },
						limits: [lim("lk", { provider: "openai-codex", scope: { accountId: "acct-C" }, window: win("5h"), usedFraction: 0.3 })],
					}),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "openai-codex")?.accounts ?? [];
		const conflict = accounts.find((a) => a.label === "a");
		const clean = accounts.find((a) => a.label === "c");
		// the conflict account never inherits the wrong report's usage
		expect(conflict?.freshness).toBe("unavailable");
		expect(conflict?.windows).toHaveLength(0);
		// the clean sibling is still matched
		expect(clean?.freshness).toBe("fresh");
		expect((clean?.windows ?? []).length).toBeGreaterThan(0);
	});

	it("excludes a report whose limits span two distinct scope accountIds (multi-scope) — account unavailable", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ provider: "google-gemini-cli", credentialId: 1, accountId: "acct-A" })],
				reports: [
					rep({
						provider: "google-gemini-cli",
						metadata: {},
						limits: [
							lim("l1", { provider: "google-gemini-cli", scope: { accountId: "acct-A" }, window: win("5h"), usedFraction: 0.5 }),
							lim("l2", { provider: "google-gemini-cli", scope: { accountId: "acct-B" }, window: win("7d"), usedFraction: 0.6 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		// two distinct scope.accountId -> unique-Set undefined + identityUnsafe -> excluded from all tiers
		const account = vm.groups.find((g) => g.provider === "google-gemini-cli")?.accounts[0];
		expect(account?.freshness).toBe("unavailable");
		expect(account?.windows).toHaveLength(0);
	});

	it("excludes a report whose limits span two distinct scope.projectId (multi-project) — account unavailable", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ provider: "google-gemini-cli", credentialId: 1, projectId: "p-A" })],
				reports: [
					rep({
						provider: "google-gemini-cli",
						metadata: {},
						limits: [
							lim("l1", { provider: "google-gemini-cli", scope: { projectId: "p-A" }, window: win("1d"), usedFraction: 0.5 }),
							lim("l2", { provider: "google-gemini-cli", scope: { projectId: "p-B" }, window: win("7d"), usedFraction: 0.6 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		const account = vm.groups.find((g) => g.provider === "google-gemini-cli")?.accounts[0];
		expect(account?.freshness).toBe("unavailable");
		expect(account?.windows).toHaveLength(0);
	});

	it("excludes a report whose limits span two distinct scope.orgId (multi-org) even with a consistent accountId", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, accountId: "acc-1" })],
				reports: [
					rep({
						metadata: { accountId: "acc-1" },
						limits: [
							lim("l1", { scope: { accountId: "acc-1", orgId: "org-A" }, window: win("5h"), usedFraction: 0.5 }),
							lim("l2", { scope: { accountId: "acc-1", orgId: "org-B" }, window: win("7d"), usedFraction: 0.6 }),
						],
					}),
				],
			}),
			resolveUsed,
		);
		// scope.accountId is consistent, but two distinct scope.orgId -> identityUnsafe -> excluded
		const account = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0];
		expect(account?.freshness).toBe("unavailable");
		expect(account?.windows).toHaveLength(0);
	});

	it("does not let the singleton fallback resurrect a lone conflict report for a lone account", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ provider: "openai-codex", credentialId: 1, accountId: "solo-A", email: "solo@x.com" })],
				reports: [
					rep({
						provider: "openai-codex",
						metadata: { accountId: "solo-A" },
						limits: [lim("l1", { provider: "openai-codex", scope: { accountId: "other-B" }, window: win("5h"), usedFraction: 0.7 })],
					}),
				],
			}),
			resolveUsed,
		);
		// lone account + lone identityUnsafe report: the singleton fallback must NOT pair them
		const account = vm.groups.find((g) => g.provider === "openai-codex")?.accounts[0];
		expect(account?.freshness).toBe("unavailable");
		expect(account?.windows).toHaveLength(0);
	});

	it("consumes a matched report once: two accounts matching the same report leave exactly one unavailable", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, accountId: "dup-acc", email: "dup@x.com", position: 0 }),
					acct({ credentialId: 2, accountId: "dup-acc", email: "dup@x.com", position: 1 }),
				],
				reports: [
					rep({
						metadata: { accountId: "dup-acc", email: "dup@x.com" },
						limits: [lim("l1", { scope: { accountId: "dup-acc" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		expect(accounts.filter((a) => a.freshness === "fresh")).toHaveLength(1); // report consumed once
		expect(accounts.filter((a) => a.freshness === "unavailable")).toHaveLength(1); // the second can't reuse it
		expect(accounts.find((a) => a.freshness === "fresh")?.windows).toHaveLength(1);
		expect(accounts.find((a) => a.freshness === "unavailable")?.windows).toHaveLength(0);
	});

	it("leaves two no-identity accounts both unavailable (no positional guess) despite matchable reports", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [
					acct({ credentialId: 1, position: 0 }), // no accountId / email / projectId
					acct({ credentialId: 2, position: 1 }),
				],
				reports: [
					rep({ metadata: { accountId: "x" }, limits: [lim("l1", { scope: { accountId: "x" }, window: win("5h"), usedFraction: 0.5 })] }),
					rep({ metadata: { accountId: "y" }, limits: [lim("l2", { scope: { accountId: "y" }, window: win("7d"), usedFraction: 0.6 })] }),
				],
			}),
			resolveUsed,
		);
		const accounts = vm.groups.find((g) => g.provider === "anthropic")?.accounts ?? [];
		expect(accounts).toHaveLength(2);
		expect(accounts.every((a) => a.freshness === "unavailable")).toBe(true);
		expect(accounts.every((a) => a.windows.length === 0)).toBe(true);
	});

	it("pairs a lone account with the sole identity-safe report via the singleton fallback (positive case)", () => {
		const vm = buildUsageViewModel(
			input({
				accounts: [acct({ credentialId: 1, position: 0 })], // no direct identity to trip a tier
				reports: [
					rep({
						metadata: { accountId: "server-known-id" },
						limits: [lim("l1", { scope: { accountId: "server-known-id" }, window: win("5h"), usedFraction: 0.5 })],
					}),
				],
			}),
			resolveUsed,
		);
		const account = vm.groups.find((g) => g.provider === "anthropic")?.accounts[0];
		// 1 unmatched account + 1 unconsumed identity-safe report -> singleton fallback pairs them
		expect(account?.freshness).toBe("fresh");
		expect(account?.windows).toHaveLength(1);
	});
});
