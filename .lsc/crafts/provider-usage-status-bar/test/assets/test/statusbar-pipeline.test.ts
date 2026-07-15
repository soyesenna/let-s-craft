import { describe, expect, it } from "vitest";
import { renderRows } from "../src/statusbar/render.js";
import {
	buildUsageViewModel,
	type EnumeratedAccount,
	type UsageInput,
	type UsedFractionResolver,
} from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Cross-layer PURE PIPELINE test (plan §9 integration: "end-to-end pure
// pipeline fixture"). A single realistic 4-provider UsageInput is pushed
// through the REAL buildUsageViewModel (attribution + overage sanitize +
// freshness + ordering) and then the REAL renderRows for BOTH the collapsed
// and expanded views — tying attribution, overage, packing and the row budget
// together, which no single-layer suite exercises.
//
// The fixture carries every §9 shape at once: anthropic + openai-codex
// metadata identity; google-gemini-cli + kimi-code scope identity; a provider
// with two accounts; an overage (>1) window; an api-key (non-subscription)
// account; and an unmatched subscription account (-> unavailable).
//
// Both pure modules import omp usage types only as `import type`, so this loads
// under vitest-on-Node; the runtime report/limit shapes are modeled with local
// structural fixtures (no `as` casts, no omp value import). RED until craft
// implements `src/statusbar/{view-model,render}.ts`.
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
	usedFraction?: number;
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
const HOUR = 60 * 60_000;
const STALE_AFTER = 7 * 60_000;

// The classifier reads `usedFraction` first — the same stub the view-model
// suite injects; overage (>1) passes through untouched.
const resolveUsedFraction: UsedFractionResolver = (limit) => limit.amount?.usedFraction;

function lim(
	id: string,
	provider: string,
	scope: Partial<FxScope>,
	window: FxWindow,
	usedFraction?: number,
): FxLimit {
	return { id, label: id, scope: { provider, ...scope }, window, amount: { unit: "percent", usedFraction } };
}
function rep(provider: string, metadata: Record<string, unknown>, limits: FxLimit[], fetchedAt = NOW): FxReport {
	return { provider, fetchedAt, metadata, limits };
}
function acct(opts: Partial<EnumeratedAccount> & { provider: string; credentialId: number }): EnumeratedAccount {
	return { isSubscription: true, disabled: false, ...opts };
}

// The single realistic 4-provider fixture used by every case below.
// anthropic: alice + bob (metadata identity) + an api-key (non-subscription).
// openai-codex: carol (metadata identity, OVERAGE window 1.4) + dave (no report -> unavailable).
// google-gemini-cli: matched by scope.accountId/projectId.
// kimi-code: matched by scope.accountId (metadata carries only an endpoint).
function pipelineInput(): UsageInput {
	const accounts: EnumeratedAccount[] = [
		acct({ provider: "anthropic", credentialId: 1, accountId: "an-alice", email: "alice@x.com", position: 0 }),
		acct({ provider: "anthropic", credentialId: 2, accountId: "an-bob", email: "bob@x.com", position: 1 }),
		acct({ provider: "anthropic", credentialId: 3, isSubscription: false, position: 2 }), // api key -> note
		acct({ provider: "openai-codex", credentialId: 4, accountId: "cx-carol", email: "carol@openai.com", position: 0 }),
		acct({ provider: "openai-codex", credentialId: 5, accountId: "cx-dave", email: "dave@openai.com", position: 1 }), // unmatched
		acct({ provider: "google-gemini-cli", credentialId: 6, accountId: "gm-acc", projectId: "gm-proj", position: 0 }),
		acct({ provider: "kimi-code", credentialId: 7, accountId: "km-acc", position: 0 }),
	];
	const reports: FxReport[] = [
		rep("anthropic", { accountId: "an-alice", email: "alice@x.com", orgId: "org-1" }, [
			lim("an-alice-5h", "anthropic", {}, { id: "5h", label: "5h", resetsAt: NOW + HOUR }, 0.5),
		]),
		rep("anthropic", { accountId: "an-bob", email: "bob@x.com" }, [
			lim("an-bob-5h", "anthropic", {}, { id: "5h", label: "5h", resetsAt: NOW + 2 * HOUR }, 0.33),
		]),
		rep("openai-codex", { accountId: "cx-carol", email: "carol@openai.com" }, [
			lim("cx-carol-weekly", "openai-codex", {}, { id: "weekly", label: "weekly", resetsAt: NOW + 24 * HOUR }, 1.4), // OVERAGE >1
		]),
		rep("google-gemini-cli", {}, [
			lim("gm-daily", "google-gemini-cli", { accountId: "gm-acc", projectId: "gm-proj" }, { id: "1d", label: "1d", resetsAt: NOW + 12 * HOUR }, 0.6),
		]),
		rep("kimi-code", { endpoint: "https://api.example.invalid" }, [
			lim("km-monthly", "kimi-code", { accountId: "km-acc", shared: true }, { id: "monthly", label: "monthly", resetsAt: NOW + 30 * 24 * HOUR }, 0.1),
		]),
		// NOTE: there is intentionally NO report for cx-dave -> it must classify as unavailable.
	];
	return { now: NOW, staleAfterMs: STALE_AFTER, accounts, reports };
}

const joinText = (rows: Array<{ text: string }>) => rows.map((r) => r.text).join("\n");

describe("statusbar pipeline — buildUsageViewModel attribution (§9 end-to-end)", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);
	const group = (p: string) => vm.groups.find((g) => g.provider === p);

	it("matches metadata-identity providers (anthropic, openai-codex) to their accounts", () => {
		const alice = group("anthropic")?.accounts.find((a) => a.label === "alice");
		const bob = group("anthropic")?.accounts.find((a) => a.label === "bob");
		const carol = group("openai-codex")?.accounts.find((a) => a.label === "carol");
		expect(alice?.freshness).toBe("fresh");
		expect(alice?.windows).toHaveLength(1);
		expect(bob?.freshness).toBe("fresh");
		expect(carol?.freshness).toBe("fresh");
	});

	it("matches scope-identity providers (gemini, kimi) to their accounts", () => {
		const gem = group("google-gemini-cli")?.accounts[0];
		const kimi = group("kimi-code")?.accounts[0];
		expect(gem?.freshness).toBe("fresh");
		expect(gem?.windows).toHaveLength(1);
		expect(kimi?.freshness).toBe("fresh");
		expect(kimi?.windows).toHaveLength(1);
	});

	it("preserves an overage fraction (>1) unclamped through the view model", () => {
		const carol = group("openai-codex")?.accounts.find((a) => a.label === "carol");
		expect(carol?.windows[0]?.fraction).toBe(1.4);
		expect(carol?.windows[0]?.nearLimit).toBe(true);
	});

	it("classifies an unmatched subscription account (dave) as unavailable with no windows", () => {
		const dave = group("openai-codex")?.accounts.find((a) => a.label === "dave");
		expect(dave?.freshness).toBe("unavailable");
		expect(dave?.windows).toHaveLength(0);
	});

	it("orders subscription accounts before the api-key account and marks the latter with a note (no fabricated 0%)", () => {
		const anth = group("anthropic")?.accounts ?? [];
		expect(anth.length).toBeGreaterThanOrEqual(3);
		const apiKey = anth[anth.length - 1];
		expect(apiKey?.isSubscription).toBe(false); // api-key ordered last
		expect(apiKey?.windows).toHaveLength(0); // no fabricated windows
		expect((apiKey?.note ?? "").toLowerCase()).toContain("no usage");
		expect(anth.slice(0, -1).every((a) => a.isSubscription)).toBe(true); // subscription accounts first
	});
});

describe("statusbar pipeline — collapsed render (packing + budget)", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);

	it("packs each account onto one row and passes the overage percent through when the budget is ample", () => {
		const rows = renderRows(vm, { width: 200, maxRows: 30, expanded: false, now: NOW });
		expect(rows.every((r) => r.text.length <= 200)).toBe(true);
		expect(rows.every((r) => r.style !== "more")).toBe(true); // ample budget -> no overflow collapse
		const joined = joinText(rows);
		for (const label of ["alice", "bob", "carol"]) {
			expect(joined).toContain(label);
		}
		expect(joined).toContain("140%"); // overage passed end-to-end, honestly
		// the api-key note and the unavailable account both surface honestly (never 0%):
		expect(joined.toLowerCase()).toContain("no usage"); // api-key note
		expect(joined.includes("n/a") || joined.includes("—")).toBe(true); // dave unavailable
	});

	it("respects a tight row budget with a single '+N more' overflow row (prompt-safe)", () => {
		const maxRows = 6;
		const rows = renderRows(vm, { width: 200, maxRows, expanded: false, now: NOW });
		expect(rows.length).toBeLessThanOrEqual(maxRows); // budget respected
		expect(rows.filter((r) => r.style === "more")).toHaveLength(1); // overflow collapsed into one row
	});
});

describe("statusbar pipeline — expanded render (completeness)", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);

	it("shows every account and every matched window, with no '+N more' and no elision", () => {
		const rows = renderRows(vm, { width: 200, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const joined = joinText(rows);
		for (const label of ["alice", "bob", "carol", "dave"]) {
			expect(joined).toContain(label); // every account present, including the unavailable one
		}
		for (const wl of ["5h", "weekly", "1d", "monthly"]) {
			expect(joined).toContain(wl); // every matched window present
		}
		expect(joined).toContain("140%"); // overage still honest in the expanded view
		expect(rows.every((r) => r.style !== "more")).toBe(true); // expanded never collapses
		expect(rows.some((r) => r.style === "window-na")).toBe(true); // dave gets an explicit n/a row, never a bare name
	});

	it("groups accounts under a per-provider header (all four subscription-bearing providers)", () => {
		const rows = renderRows(vm, { width: 200, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const headers = rows.filter((r) => r.style === "provider-header");
		expect(headers.length).toBeGreaterThanOrEqual(4);
	});
});
