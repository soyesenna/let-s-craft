import type { UsageLimit, UsageReport, UsageScope, UsageWindow } from "@oh-my-pi/pi-ai";

// ---------------------------------------------------------------------------
// PURE view-model transform (plan §4/§6 Step 3). Imports omp usage types ONLY
// as `import type` so the module loads under vitest-on-Node (the `@oh-my-pi/*`
// value packages ship TS source Node cannot execute — DR-C). It turns the
// gather layer's `UsageInput` into a render-ready `UsageViewModel`, doing all
// host-equivalent attribution (DR-F), window keying, fraction sanitize and
// ordering without any I/O.
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

export interface WindowVM {
	key: string;
	label: string;
	fraction: number | undefined;
	resetsAt: number | undefined;
	nearLimit: boolean;
}

export interface AccountVM {
	label: string;
	isSubscription: boolean;
	freshness: "fresh" | "stale" | "unavailable";
	windows: WindowVM[];
	note?: string;
}

export interface ProviderGroup {
	provider: string;
	accounts: AccountVM[];
}

export interface UsageViewModel {
	groups: ProviderGroup[];
	empty: boolean;
}

/** Fraction at/above which a window is flagged near its limit (DR-E). */
export const NEAR_LIMIT = 0.75;

/** Longest account label before a soft ellipsis truncation (render enforces width). */
const MAX_LABEL = 40;

/** Per-report attribution digest, computed once (DR-F). */
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

/** Stable serialization of every defined scope dim + window.id + limit.id. */
function windowKey(limit: UsageLimit, window: UsageWindow): string {
	const s: UsageScope = limit.scope;
	const parts: string[] = [];
	const add = (k: string, v: string | number | boolean | undefined): void => {
		if (v === undefined) return;
		if (typeof v === "string" && v.length === 0) return;
		parts.push(`${k}=${String(v)}`);
	};
	add("provider", s.provider);
	add("accountId", s.accountId);
	add("projectId", s.projectId);
	add("orgId", s.orgId);
	add("modelId", s.modelId);
	add("tier", s.tier);
	add("windowId", s.windowId);
	add("shared", s.shared);
	return `${parts.join("|")}#${window.id}#${limit.id}`;
}

/** email → local part; else accountId (soft-truncated); else `#<position|credentialId>`. */
function accountLabel(acc: EnumeratedAccount): string {
	const email = acc.email?.trim();
	if (email !== undefined && email.length > 0) return email.split("@")[0];
	const accountId = acc.accountId?.trim();
	if (accountId !== undefined && accountId.length > 0) {
		return accountId.length > MAX_LABEL ? `${accountId.slice(0, MAX_LABEL - 1)}\u2026` : accountId;
	}
	return `#${acc.position ?? acc.credentialId}`;
}

function buildSubscriptionVM(
	acc: EnumeratedAccount,
	digest: ReportDigest | undefined,
	input: UsageInput,
	resolveFraction: UsedFractionResolver,
): AccountVM {
	const label = accountLabel(acc);
	if (digest === undefined) {
		return { label, isSubscription: true, freshness: "unavailable", windows: [] };
	}
	const report = digest.report;
	const freshness: AccountVM["freshness"] = input.now - report.fetchedAt > input.staleAfterMs ? "stale" : "fresh";
	const windows: WindowVM[] = [];
	for (const limit of report.limits) {
		if (!limit.window) continue;
		const raw = resolveFraction(limit);
		const fraction = typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
		windows.push({
			key: windowKey(limit, limit.window),
			label: limit.window.label ?? limit.window.id ?? limit.id,
			fraction,
			resetsAt: limit.window.resetsAt,
			nearLimit: fraction !== undefined && fraction >= NEAR_LIMIT,
		});
	}
	return { label, isSubscription: true, freshness, windows };
}

function buildNonSubscriptionVM(acc: EnumeratedAccount): AccountVM {
	return {
		label: accountLabel(acc),
		isSubscription: false,
		freshness: "unavailable",
		windows: [],
		note: acc.note ?? "no usage",
	};
}

/** Build the render view model from the gathered input (pure, host-equivalent DR-F). */
export function buildUsageViewModel(input: UsageInput, resolveFraction: UsedFractionResolver): UsageViewModel {
	const digests = (input.reports ?? []).map((r) => digestReport(r));

	// Preserve first-appearance provider order and per-provider input order.
	const providerOrder: string[] = [];
	const byProvider = new Map<string, Array<{ acc: EnumeratedAccount; idx: number }>>();
	input.accounts.forEach((acc, idx) => {
		let list = byProvider.get(acc.provider);
		if (list === undefined) {
			list = [];
			byProvider.set(acc.provider, list);
			providerOrder.push(acc.provider);
		}
		list.push({ acc, idx });
	});

	const matched = new Map<EnumeratedAccount, ReportDigest>();

	for (const provider of providerOrder) {
		const entries = byProvider.get(provider) ?? [];
		const subs = entries.filter((e) => e.acc.isSubscription);
		const pool = digests.filter((d) => d.provider === provider);
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
	}

	const groups: ProviderGroup[] = [];
	for (const provider of providerOrder) {
		const entries = byProvider.get(provider) ?? [];
		const subs = entries.filter((e) => e.acc.isSubscription);
		const nonSubs = entries.filter((e) => !e.acc.isSubscription);
		// Subscription accounts first: stable by position, then input order.
		const sortedSubs = [...subs].sort((a, b) => {
			const pa = a.acc.position ?? Number.MAX_SAFE_INTEGER;
			const pb = b.acc.position ?? Number.MAX_SAFE_INTEGER;
			return pa !== pb ? pa - pb : a.idx - b.idx;
		});
		const accounts: AccountVM[] = [];
		for (const { acc } of sortedSubs) accounts.push(buildSubscriptionVM(acc, matched.get(acc), input, resolveFraction));
		for (const { acc } of nonSubs) accounts.push(buildNonSubscriptionVM(acc));
		groups.push({ provider, accounts });
	}

	// Subscription-bearing groups first, otherwise stable (first-appearance) order.
	const withSub = groups.filter((g) => g.accounts.some((a) => a.isSubscription));
	const withoutSub = groups.filter((g) => !g.accounts.some((a) => a.isSubscription));
	const ordered = [...withSub, ...withoutSub];

	return { groups: ordered, empty: ordered.every((g) => g.accounts.length === 0) };
}
