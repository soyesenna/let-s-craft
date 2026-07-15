import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";

// ---------------------------------------------------------------------------
// PURE view-model transform. Imports omp usage types ONLY as `import type` so
// the module loads under vitest-on-Node (the `@oh-my-pi/*` value packages ship
// TS source Node cannot execute). It turns the gather layer's `UsageInput`
// into a render-ready `UsageViewModel`: a fixed-order list of provider COLUMNS
// (anthropic, openai-codex — the only supported providers), each holding its
// account ROWS whose usage windows are normalized into fixed per-provider
// SLOTS so every account shows the same windows in the same order.
// ---------------------------------------------------------------------------

/** Resolves a limit's used fraction (0..1; >1 = overage). Host: `resolveUsedFraction`. */
export type UsedFractionResolver = (limit: UsageLimit) => number | undefined;

/** One enumerated credential the gather layer produced; carries no token data. */
export interface EnumeratedAccount {
	provider: string;
	credentialId: number;
	isSubscription: boolean;
	accountId?: string;
	email?: string;
	projectId?: string;
	position?: number;
	disabled: boolean;
	note?: string;
}

/** The gather layer's output: accounts + the raw reports, forwarded verbatim. */
export interface UsageInput {
	now: number;
	staleAfterMs: number;
	accounts: EnumeratedAccount[];
	reports: UsageReport[] | null;
}

/** Visual escalation of a usage cell: ok < warn (NEAR_LIMIT) < crit (CRIT_LIMIT). */
export type UsageLevel = "ok" | "warn" | "crit";

/** A fixed window slot of a provider: same key/labels for every account. */
export interface SlotSpec {
	key: string;
	/** Compact column header for the collapsed table (e.g. "5h"). */
	header: string;
	/** Full row label for the expanded overlay (e.g. "5 hours"). */
	label: string;
}

/** One account's value for one slot; `fraction === undefined` renders as "no data". */
export interface CellVM {
	slotKey: string;
	fraction: number | undefined;
	resetsAt: number | undefined;
	level: UsageLevel;
}

export interface AccountVM {
	label: string;
	isSubscription: boolean;
	freshness: "fresh" | "stale" | "unavailable";
	/** Aligned 1:1 with the owning column's `slots`; `[]` for note-only rows. */
	cells: CellVM[];
	note?: string;
}

/** A provider column: fixed slots + its account rows, in display order. */
export interface ProviderColumnVM {
	provider: string;
	title: string;
	slots: SlotSpec[];
	accounts: AccountVM[];
}

export interface UsageViewModel {
	columns: ProviderColumnVM[];
	empty: boolean;
}

/** Fraction at/above which a cell escalates to "warn". */
export const NEAR_LIMIT = 0.75;
/** Fraction at/above which a cell escalates to "crit". */
export const CRIT_LIMIT = 0.9;

/** Longest account label before a soft ellipsis truncation (render enforces width). */
const MAX_LABEL = 40;

/** Classify a sanitized fraction into its visual escalation level. */
export function classifyLevel(fraction: number | undefined): UsageLevel {
	if (fraction === undefined) return "ok";
	if (fraction >= CRIT_LIMIT) return "crit";
	if (fraction >= NEAR_LIMIT) return "warn";
	return "ok";
}

// ---------------------------------------------------------------------------
// Provider specs — the ONLY providers the status bar shows, in display order.
// Each spec maps a report limit onto one of its fixed slots (or none), which is
// what pins the per-account window ORDER regardless of report.limits order.
// ---------------------------------------------------------------------------

interface ProviderSpec {
	provider: string;
	title: string;
	slots: SlotSpec[];
	slotOf(limit: UsageLimit): string | undefined;
}

function limitWindowId(limit: UsageLimit): string | undefined {
	return (limit.scope.windowId ?? limit.window?.id)?.toLowerCase();
}

/** The model-scoped "Fable only" weekly cap, by tier, limit id, or label. */
function isFableScoped(limit: UsageLimit): boolean {
	if (limit.scope.tier === "fable") return true;
	if (limit.id.toLowerCase().endsWith(":fable")) return true;
	return /\bfable\b/i.test(limit.label);
}

const PROVIDER_SPECS: readonly ProviderSpec[] = [
	{
		provider: "anthropic",
		title: "Anthropic",
		slots: [
			{ key: "5h", header: "5h", label: "5 hours" },
			{ key: "7d", header: "7d", label: "7 days" },
			{ key: "fable-7d", header: "Fable 7d", label: "Fable · 7 days" },
		],
		slotOf(limit) {
			const windowId = limitWindowId(limit);
			const tier = limit.scope.tier;
			if (windowId === "5h" && tier === undefined) return "5h";
			if (windowId === "7d") {
				if (isFableScoped(limit)) return "fable-7d";
				if (tier === undefined) return "7d";
			}
			return undefined;
		},
	},
	{
		provider: "openai-codex",
		title: "OpenAI Codex",
		slots: [{ key: "7d", header: "7d", label: "7 days" }],
		slotOf(limit) {
			return limitWindowId(limit) === "7d" ? "7d" : undefined;
		},
	},
];

/** Providers the status bar supports, in display (column) order. */
export const SUPPORTED_PROVIDERS: readonly string[] = PROVIDER_SPECS.map((s) => s.provider);

// ---------------------------------------------------------------------------
// Report → account attribution (unchanged contract): identity-safe digests,
// per-account matching tiers (accountId > email > projectId), consumed-once,
// then a singleton fallback.
// ---------------------------------------------------------------------------

/** Per-report attribution digest, computed once. */
interface ReportDigest {
	report: UsageReport;
	provider: string;
	effAccountId: string | undefined;
	effProjectId: string | undefined;
	emailLower: string | undefined;
	labelLowers: string[];
	identityUnsafe: boolean;
	consumed: boolean;
}

/** Trim a maybe-string to a non-empty string, else undefined. */
function trimNonEmpty(v: unknown): string | undefined {
	if (typeof v !== "string") return undefined;
	const t = v.trim();
	return t.length > 0 ? t : undefined;
}

/** The single value of a distinct-set over a scope dim, or undefined unless size === 1. */
function digestReport(report: UsageReport): ReportDigest {
	const meta: Record<string, unknown> = report.metadata ?? {};
	const emailLower = trimNonEmpty(meta.email)?.toLowerCase();
	const metaAccountId = trimNonEmpty(meta.accountId);
	const labelLowers: string[] = [];
	for (const k of ["account", "user", "username"] as const) {
		const v = trimNonEmpty(meta[k])?.toLowerCase();
		if (v !== undefined) labelLowers.push(v);
	}

	const accSet = new Set<string>();
	const projSet = new Set<string>();
	const orgSet = new Set<string>();
	for (const limit of report.limits) {
		const a = trimNonEmpty(limit.scope.accountId);
		if (a !== undefined) accSet.add(a);
		const p = trimNonEmpty(limit.scope.projectId);
		if (p !== undefined) projSet.add(p);
		const o = trimNonEmpty(limit.scope.orgId);
		if (o !== undefined) orgSet.add(o);
	}
	const scopeAccountId = accSet.size === 1 ? [...accSet][0] : undefined;
	const scopeProjectId = projSet.size === 1 ? [...projSet][0] : undefined;

	// (A) metadata vs scope accountId conflict; (B) any identity-bearing scope
	// dim splits across ≥2 distinct values within one report → identity is unsafe.
	const unsafeA = metaAccountId !== undefined && scopeAccountId !== undefined && metaAccountId !== scopeAccountId;
	const unsafeB = accSet.size >= 2 || projSet.size >= 2 || orgSet.size >= 2;

	return {
		report,
		provider: report.provider,
		effAccountId: metaAccountId ?? scopeAccountId,
		effProjectId: scopeProjectId,
		emailLower,
		labelLowers,
		identityUnsafe: unsafeA || unsafeB,
		consumed: false,
	};
}

/** email → local part; else accountId (soft-truncated); else `#<position|credentialId>`. */
function accountLabel(acc: EnumeratedAccount): string {
	const email = acc.email?.trim();
	if (email !== undefined && email.length > 0) return email.split("@")[0];
	const accountId = acc.accountId?.trim();
	if (accountId !== undefined && accountId.length > 0) {
		return accountId.length > MAX_LABEL ? `${accountId.slice(0, MAX_LABEL - 1)}…` : accountId;
	}
	return `#${acc.position ?? acc.credentialId}`;
}

/** Map a matched report onto the spec's fixed slots (first matching limit wins). */
function buildCells(spec: ProviderSpec, report: UsageReport | undefined, resolveFraction: UsedFractionResolver): CellVM[] {
	const bySlot = new Map<string, UsageLimit>();
	if (report !== undefined) {
		for (const limit of report.limits) {
			if (!limit.window) continue;
			const slot = spec.slotOf(limit);
			if (slot !== undefined && !bySlot.has(slot)) bySlot.set(slot, limit);
		}
	}
	return spec.slots.map((slot) => {
		const limit = bySlot.get(slot.key);
		if (limit === undefined) return { slotKey: slot.key, fraction: undefined, resetsAt: undefined, level: "ok" as const };
		const raw = resolveFraction(limit);
		const fraction = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
		return { slotKey: slot.key, fraction, resetsAt: limit.window?.resetsAt, level: classifyLevel(fraction) };
	});
}

/** Build the render view model from the gathered input (pure). */
export function buildUsageViewModel(input: UsageInput, resolveFraction: UsedFractionResolver): UsageViewModel {
	const digests = (input.reports ?? []).map((r) => digestReport(r));

	const columns: ProviderColumnVM[] = [];
	for (const spec of PROVIDER_SPECS) {
		const entries = input.accounts
			.map((acc, idx) => ({ acc, idx }))
			.filter((e) => e.acc.provider === spec.provider);
		if (entries.length === 0) continue;

		const subs = entries.filter((e) => e.acc.isSubscription);
		const nonSubs = entries.filter((e) => !e.acc.isSubscription);

		const pool = digests.filter((d) => d.provider === spec.provider);
		const matched = new Map<EnumeratedAccount, ReportDigest>();
		const safe = (): ReportDigest[] => pool.filter((d) => !d.consumed && !d.identityUnsafe);
		const claim = (acc: EnumeratedAccount, d: ReportDigest): void => {
			d.consumed = true;
			matched.set(acc, d);
		};

		// Per-account tiers, iterating in input order (first in order wins).
		for (const { acc } of subs) {
			if (acc.accountId !== undefined) {
				const key = acc.accountId.trim();
				const c = safe().filter((d) => d.effAccountId !== undefined && d.effAccountId === key);
				if (c.length === 1) {
					claim(acc, c[0]);
					continue;
				}
			}
			if (acc.email !== undefined) {
				const key = acc.email.trim().toLowerCase();
				const c = safe().filter(
					(d) => (d.emailLower !== undefined && d.emailLower === key) || d.labelLowers.includes(key),
				);
				if (c.length === 1) {
					claim(acc, c[0]);
					continue;
				}
			}
			if (acc.projectId !== undefined) {
				const key = acc.projectId.trim();
				const c = safe().filter((d) => d.effProjectId !== undefined && d.effProjectId === key);
				if (c.length === 1) {
					claim(acc, c[0]);
					continue;
				}
			}
		}

		// Singleton fallback: one still-unmatched account + one unconsumed safe report.
		const unmatchedSubs = subs.filter((e) => !matched.has(e.acc));
		const safeUnconsumed = safe();
		if (unmatchedSubs.length === 1 && safeUnconsumed.length === 1) {
			claim(unmatchedSubs[0].acc, safeUnconsumed[0]);
		}

		// Subscription accounts first: stable by position, then input order.
		const sortedSubs = [...subs].sort((a, b) => {
			const pa = a.acc.position ?? Number.MAX_SAFE_INTEGER;
			const pb = b.acc.position ?? Number.MAX_SAFE_INTEGER;
			return pa !== pb ? pa - pb : a.idx - b.idx;
		});

		const accounts: AccountVM[] = [];
		for (const { acc } of sortedSubs) {
			const digest = matched.get(acc);
			const label = accountLabel(acc);
			if (digest === undefined) {
				accounts.push({ label, isSubscription: true, freshness: "unavailable", cells: buildCells(spec, undefined, resolveFraction) });
				continue;
			}
			const freshness: AccountVM["freshness"] =
				input.now - digest.report.fetchedAt > input.staleAfterMs ? "stale" : "fresh";
			accounts.push({
				label,
				isSubscription: true,
				freshness,
				cells: buildCells(spec, digest.report, resolveFraction),
			});
		}
		for (const { acc } of nonSubs) {
			accounts.push({
				label: accountLabel(acc),
				isSubscription: false,
				freshness: "unavailable",
				cells: [],
				note: acc.note ?? "no usage",
			});
		}

		columns.push({ provider: spec.provider, title: spec.title, slots: spec.slots, accounts });
	}

	return { columns, empty: columns.length === 0 };
}
