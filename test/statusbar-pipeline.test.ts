import { describe, expect, it } from "vitest";
import { renderRows, rowText, type RenderRow } from "../src/statusbar/render.js";
import {
	buildUsageViewModel,
	type EnumeratedAccount,
	type UsageInput,
	type UsedFractionResolver,
} from "../src/statusbar/view-model.js";

// ---------------------------------------------------------------------------
// Cross-layer PURE PIPELINE test (integration: "end-to-end pure pipeline
// fixture"). A single realistic UsageInput is pushed through the REAL
// buildUsageViewModel (allowlist + slotting + attribution + overage sanitize +
// freshness + ordering) and then the REAL renderRows for BOTH the collapsed
// (columnar) and expanded views — tying the layers together in ways no
// single-layer suite exercises.
//
// The fixture carries every shape at once: anthropic with two subscription
// accounts whose reports arrive in DIFFERENT scrambled window orders (the
// bug the columnar redesign kills), an anthropic api-key credential (note
// row), an openai-codex account with an OVERAGE (>1) 7d window matched by
// scope identity, an unmatched codex account (-> unavailable), and unsupported
// providers (google-gemini-cli, kimi-code) that must be dropped entirely.
//
// Both pure modules import omp usage types only as `import type`, so this
// loads under vitest-on-Node; the runtime report/limit shapes are modeled with
// local structural fixtures (no `as` casts, no omp value import).
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
	label = id,
): FxLimit {
	return {
		id,
		label,
		scope: { provider, windowId: window.id, ...scope },
		window,
		amount: { unit: "percent", usedFraction },
	};
}
function rep(provider: string, metadata: Record<string, unknown>, limits: FxLimit[], fetchedAt = NOW): FxReport {
	return { provider, fetchedAt, metadata, limits };
}
function acct(opts: Partial<EnumeratedAccount> & { provider: string; credentialId: number }): EnumeratedAccount {
	return { isSubscription: true, disabled: false, ...opts };
}

// The single realistic fixture used by every case below.
// anthropic: alice (windows scrambled fable→7d→5h) + bob (scrambled 7d→5h→fable,
//            and bob has NO fable window) + an api-key credential (note row).
// openai-codex: carol (scope identity, OVERAGE 7d 1.4) + dave (no report -> unavailable).
// google-gemini-cli / kimi-code: accounts + reports that MUST be dropped (unsupported).
function pipelineInput(): UsageInput {
	const accounts: EnumeratedAccount[] = [
		acct({ provider: "anthropic", credentialId: 1, accountId: "an-alice", email: "alice@x.com", position: 0 }),
		acct({ provider: "anthropic", credentialId: 2, accountId: "an-bob", email: "bob@x.com", position: 1 }),
		acct({ provider: "anthropic", credentialId: 3, isSubscription: false, position: 2, note: "no usage - api key" }),
		acct({ provider: "openai-codex", credentialId: 4, accountId: "cx-carol", email: "carol@openai.com", position: 0 }),
		acct({ provider: "openai-codex", credentialId: 5, accountId: "cx-dave", email: "dave@openai.com", position: 1 }),
		acct({ provider: "google-gemini-cli", credentialId: 6, accountId: "gm-acc", projectId: "gm-proj", position: 0 }),
		acct({ provider: "kimi-code", credentialId: 7, accountId: "km-acc", position: 0 }),
	];
	const reports: FxReport[] = [
		// alice: fable → 7d → 5h (scrambled on purpose).
		rep("anthropic", { accountId: "an-alice", email: "alice@x.com", orgId: "org-1" }, [
			lim(
				"anthropic:7d:fable",
				"anthropic",
				{ tier: "fable" },
				{ id: "7d", label: "7 Day", resetsAt: NOW + 3 * 24 * HOUR },
				0.62,
				"Claude 7 Day (Fable)",
			),
			lim("anthropic:7d", "anthropic", {}, { id: "7d", label: "7 Day", resetsAt: NOW + 3 * 24 * HOUR }, 1.0),
			lim("anthropic:5h", "anthropic", {}, { id: "5h", label: "5 Hour", resetsAt: NOW + HOUR }, 0.04),
		]),
		// bob: 7d → 5h, NO fable window at all.
		rep("anthropic", { accountId: "an-bob", email: "bob@x.com" }, [
			lim("anthropic:7d", "anthropic", {}, { id: "7d", label: "7 Day", resetsAt: NOW + 4 * 24 * HOUR }, 0.31),
			lim("anthropic:5h", "anthropic", {}, { id: "5h", label: "5 Hour", resetsAt: NOW + 2 * HOUR }, 0.33),
		]),
		// carol: scope identity (no metadata accountId), OVERAGE 7d.
		rep("openai-codex", {}, [
			lim(
				"codex:7d",
				"openai-codex",
				{ accountId: "cx-carol" },
				{ id: "7d", label: "7 days", resetsAt: NOW + 24 * HOUR },
				1.4,
			),
		]),
		// Unsupported providers — reports present, but the columns must not exist.
		rep("google-gemini-cli", {}, [
			lim(
				"gm-daily",
				"google-gemini-cli",
				{ accountId: "gm-acc", projectId: "gm-proj" },
				{ id: "1d", label: "1d", resetsAt: NOW + 12 * HOUR },
				0.6,
			),
		]),
		rep("kimi-code", { endpoint: "https://api.example.invalid" }, [
			lim(
				"km-monthly",
				"kimi-code",
				{ accountId: "km-acc", shared: true },
				{ id: "monthly", label: "monthly", resetsAt: NOW + 30 * 24 * HOUR },
				0.1,
			),
		]),
		// NOTE: there is intentionally NO report for cx-dave -> it must classify as unavailable.
	];
	return { now: NOW, staleAfterMs: STALE_AFTER, accounts, reports: reports as unknown as UsageInput["reports"] };
}

const joinRows = (rows: RenderRow[]) => rows.map((r) => rowText(r)).join("\n");

describe("statusbar pipeline — buildUsageViewModel (allowlist + slots + attribution)", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);
	const column = (p: string) => vm.columns.find((c) => c.provider === p);

	it("keeps exactly the two supported provider columns, in fixed order — gemini/kimi dropped", () => {
		expect(vm.columns.map((c) => c.provider)).toEqual(["anthropic", "openai-codex"]);
	});

	it("normalizes both anthropic accounts to the SAME slot order despite scrambled reports", () => {
		const anth = column("anthropic");
		const alice = anth?.accounts.find((a) => a.label === "alice");
		const bob = anth?.accounts.find((a) => a.label === "bob");
		expect(alice?.cells.map((c) => c.slotKey)).toEqual(["5h", "7d", "fable-7d"]);
		expect(bob?.cells.map((c) => c.slotKey)).toEqual(["5h", "7d", "fable-7d"]);
		expect(alice?.cells.map((c) => c.fraction)).toEqual([0.04, 1.0, 0.62]);
		expect(bob?.cells.map((c) => c.fraction)).toEqual([0.33, 0.31, undefined]); // bob has no fable window
	});

	it("matches carol by scope identity and preserves the overage fraction unclamped as crit", () => {
		const carol = column("openai-codex")?.accounts.find((a) => a.label === "carol");
		expect(carol?.freshness).toBe("fresh");
		expect(carol?.cells[0]).toMatchObject({ slotKey: "7d", fraction: 1.4, level: "crit" });
	});

	it("classifies the unmatched codex account (dave) as unavailable with an all-empty cell", () => {
		const dave = column("openai-codex")?.accounts.find((a) => a.label === "dave");
		expect(dave?.freshness).toBe("unavailable");
		expect(dave?.cells.map((c) => c.fraction)).toEqual([undefined]);
	});

	it("orders subscription accounts before the api-key account and marks the latter with a note (no fabricated 0%)", () => {
		const anth = column("anthropic")?.accounts ?? [];
		expect(anth.length).toBe(3);
		const apiKey = anth[anth.length - 1];
		expect(apiKey?.isSubscription).toBe(false);
		expect(apiKey?.cells).toHaveLength(0);
		expect((apiKey?.note ?? "").toLowerCase()).toContain("no usage");
		expect(anth.slice(0, -1).every((a) => a.isSubscription)).toBe(true);
	});
});

describe("statusbar pipeline — collapsed columnar render", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);

	it("lays providers out side by side (accounts as rows) and passes the overage percent through", () => {
		const rows = renderRows(vm, { width: 200, maxRows: 12, expanded: false, now: NOW });
		// Height = spacer + 2 chrome rows + max(accounts per provider), NOT the sum of all accounts.
		expect(rows).toHaveLength(1 + 2 + 3);
		const joined = joinRows(rows);
		expect(rowText(rows[0])).toBe(""); // prompt spacer
		expect(rowText(rows[1])).toMatch(/Anthropic.*│ OpenAI Codex/);
		expect(rowText(rows[2])).toMatch(/5h\s+7d\s+Fable 7d.*│\s+7d/);
		for (const label of ["alice", "bob", "carol", "dave"]) expect(joined).toContain(label);
		expect(joined).toContain("140%"); // overage passed end-to-end, honestly
		expect(joined.toLowerCase()).toContain("no usage"); // api-key note
		expect(joined).toContain("–"); // bob's missing fable + dave's empty cell
		expect(joined).not.toContain("gm-acc");
		expect(joined).not.toContain("km-acc");
		for (const row of rows) expect(rowText(row).length).toBeLessThanOrEqual(200);
	});

	it("respects a tight row budget by hiding tail accounts behind a +N title marker", () => {
		const maxRows = 5; // spacer + 2 chrome rows + 2 account rows
		const rows = renderRows(vm, { width: 200, maxRows, expanded: false, now: NOW });
		expect(rows.length).toBeLessThanOrEqual(maxRows);
		expect(rowText(rows[1])).toContain("Anthropic +1"); // the api-key row is hidden, honestly counted
	});
});

describe("statusbar pipeline — expanded render (completeness)", () => {
	const vm = buildUsageViewModel(pipelineInput(), resolveUsedFraction);

	it("shows every account and every slot with full labels, no elision, honest n/a rows", () => {
		const rows = renderRows(vm, { width: 200, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const joined = joinRows(rows);
		for (const label of ["alice", "bob", "carol", "dave"]) expect(joined).toContain(label);
		for (const slotLabel of ["5 hours", "7 days", "Fable · 7 days"]) expect(joined).toContain(slotLabel);
		expect(joined).toContain("140%"); // overage still honest in the expanded view
		expect(joined).toContain("no usage data"); // dave's explicit unavailable row, never a bare name
		expect(joined).toContain("no usage - api key");
		expect(joined).not.toContain("+1"); // expanded never collapses
		expect(joined).not.toContain("gm-"); // unsupported providers stay dropped
	});

	it("titles exactly the two supported providers", () => {
		const rows = renderRows(vm, { width: 200, maxRows: Number.POSITIVE_INFINITY, expanded: true, now: NOW });
		const titles = rows.filter((r) => r.segments.some((s) => s.style === "title"));
		expect(titles.map((r) => rowText(r))).toEqual(["Anthropic", "OpenAI Codex"]);
	});
});
