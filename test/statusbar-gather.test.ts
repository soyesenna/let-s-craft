import { afterEach, describe, expect, it, vi } from "vitest";
import { gatherUsageInput } from "../src/statusbar/gather.js";
import type { AuthStoragePort, OAuthAccountLike, StoredCredentialLike } from "../src/statusbar/gather.js";
import type { UsageReport } from "@oh-my-pi/pi-ai";

// ─────────────────────────────────────────────────────────────────────────────
// Integration tests for the pure DATA gather (plan §6 Step 2 / §9). Everything
// flows through a structural fake AuthStoragePort — the ONLY data source: no
// provider HTTP, no token handling. The stored credentials deliberately carry
// runtime secret tokens (via cast) so the test can prove those never leak into
// the token-free UsageInput. Currently RED only because ../src/statusbar/gather.js
// does not exist yet (the craft skill implements it to this contract).
// ─────────────────────────────────────────────────────────────────────────────

const SECRET = "sk-SECRET-token-value";

/** Build a stored credential shaped like the host's StoredAuthCredential — whose
 *  `credential` object carries live tokens — cast down to the port's narrow
 *  `{ type }` view. The extra secret fields exist at RUNTIME so we can assert
 *  gather never copies them into the enumerated output (AC8, token-free). */
function storedCred(
	id: number,
	provider: string,
	type: "oauth" | "api_key",
	disabledCause: string | null = null,
): StoredCredentialLike {
	return {
		id,
		provider,
		disabledCause,
		credential: { type, accessToken: SECRET, refreshToken: SECRET, apiKey: SECRET },
	} as unknown as StoredCredentialLike;
}

// 4 subscription (oauth) providers + 1 api-key (non-subscription), none disabled.
const BASE_STORED: readonly StoredCredentialLike[] = [
	storedCred(1, "anthropic", "oauth"),
	storedCred(2, "openai-codex", "oauth"),
	storedCred(3, "gemini", "oauth"),
	storedCred(4, "kimi", "oauth"),
	storedCred(5, "openai", "api_key"),
];

const OAUTH_ACCOUNTS: Readonly<Record<string, readonly OAuthAccountLike[]>> = {
	anthropic: [{ position: 0, credentialId: 1, accountId: "acc-anthropic", email: "alice@anthropic.com" }],
	"openai-codex": [{ position: 0, credentialId: 2, accountId: "acc-codex", email: "bob@openai.com" }],
	gemini: [{ position: 0, credentialId: 3, accountId: "acc-gemini", projectId: "proj-gemini" }],
	kimi: [{ position: 0, credentialId: 4, accountId: "acc-kimi" }],
};

/** A realistic 4-provider report set — anthropic/openai-codex carry identity in
 *  `metadata`, gemini/kimi carry it in `limit.scope`; openai-codex also holds an
 *  OVERAGE limit (usedFraction 1.4) that must survive gather unclamped. gather
 *  treats these as opaque and forwards them verbatim. */
function makeReports(): UsageReport[] {
	return [
		{
			provider: "anthropic",
			fetchedAt: 1_000,
			metadata: { accountId: "acc-anthropic", email: "alice@anthropic.com", orgId: "org-1" },
			limits: [
				{
					id: "anthropic-5h",
					label: "5 Hour",
					scope: { provider: "anthropic" },
					window: { id: "5h", label: "5 Hour", resetsAt: 5_000 },
					amount: { usedFraction: 0.33, unit: "percent" },
				},
			],
		},
		{
			provider: "openai-codex",
			fetchedAt: 1_000,
			metadata: { email: "bob@openai.com", accountId: "acc-codex" },
			limits: [
				{
					id: "codex-weekly",
					label: "Weekly",
					scope: { provider: "openai-codex" },
					window: { id: "weekly", label: "Weekly", resetsAt: 9_000 },
					amount: { usedFraction: 1.4, unit: "percent" }, // overage (>1), unclamped
				},
			],
		},
		{
			provider: "gemini",
			fetchedAt: 1_000,
			metadata: { currentTierId: "tier-1", currentTierName: "Free" },
			limits: [
				{
					id: "gemini-daily",
					label: "Daily",
					scope: { provider: "gemini", accountId: "acc-gemini", projectId: "proj-gemini" },
					window: { id: "1d", label: "Daily", resetsAt: 8_000 },
					amount: { usedFraction: 0.6, unit: "percent" },
				},
			],
		},
		{
			provider: "kimi",
			fetchedAt: 1_000,
			metadata: { endpoint: "https://api.example.invalid" },
			limits: [
				{
					id: "kimi-monthly",
					label: "Monthly",
					scope: { provider: "kimi", accountId: "acc-kimi", shared: true },
					window: { id: "monthly", label: "Monthly", resetsAt: 12_000 },
					amount: { usedFraction: 0.1, unit: "percent" },
				},
			],
		},
	];
}

/** The sole data source. Records every method call so a test can prove gather
 *  touches nothing else. */
class FakeAuthStoragePort implements AuthStoragePort {
	listStoredCalls: Array<string | undefined> = [];
	listOAuthCalls: string[] = [];
	fetchCalls: Array<{ signal?: AbortSignal }> = [];

	constructor(
		private readonly stored: readonly StoredCredentialLike[],
		private readonly oauthByProvider: Readonly<Record<string, readonly OAuthAccountLike[]>>,
		private readonly reports: UsageReport[] | null,
	) {}

	listStoredCredentials(provider?: string): readonly StoredCredentialLike[] {
		this.listStoredCalls.push(provider);
		return provider === undefined ? this.stored : this.stored.filter((c) => c.provider === provider);
	}

	listOAuthAccounts(provider: string): readonly OAuthAccountLike[] {
		this.listOAuthCalls.push(provider);
		return this.oauthByProvider[provider] ?? [];
	}

	async fetchUsageReports(options?: { signal?: AbortSignal }): Promise<UsageReport[] | null> {
		this.fetchCalls.push({ signal: options?.signal });
		return this.reports;
	}
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("gatherUsageInput — enumeration", () => {
	it("enumerates all accounts (incl. api_key), marks oauth as subscription, and attaches identity", async () => {
		const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, makeReports());
		const input = await gatherUsageInput(port, 42_000, 7 * 60_000, new AbortController().signal);

		expect(input.now).toBe(42_000);
		expect(input.staleAfterMs).toBe(7 * 60_000);
		expect(input.accounts).toHaveLength(5);

		const anth = input.accounts.find((a) => a.provider === "anthropic");
		expect(anth).toMatchObject({
			provider: "anthropic",
			credentialId: 1,
			isSubscription: true,
			email: "alice@anthropic.com",
			accountId: "acc-anthropic",
			position: 0,
			disabled: false,
		});

		const codex = input.accounts.find((a) => a.provider === "openai-codex");
		expect(codex).toMatchObject({
			credentialId: 2,
			isSubscription: true,
			email: "bob@openai.com",
			accountId: "acc-codex",
		});

		const gemini = input.accounts.find((a) => a.provider === "gemini");
		expect(gemini).toMatchObject({
			credentialId: 3,
			isSubscription: true,
			accountId: "acc-gemini",
			projectId: "proj-gemini",
		});

		const kimi = input.accounts.find((a) => a.provider === "kimi");
		expect(kimi).toMatchObject({ credentialId: 4, isSubscription: true, accountId: "acc-kimi" });
	});

	it("carries the api-key credential as a non-subscription account (for the #position/credentialId fallback label)", async () => {
		const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, makeReports());
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		const apiKey = input.accounts.find((a) => a.provider === "openai");
		expect(apiKey).toMatchObject({ provider: "openai", credentialId: 5, isSubscription: false, disabled: false });
		// api-key credentials have no OAuth summary ⇒ no email/accountId; the view-model
		// falls back to a #position/credentialId label. gather must still carry the account.
		expect(apiKey?.email).toBeUndefined();
		expect(apiKey?.accountId).toBeUndefined();
	});

	it("skips a credential with a hard disabledCause", async () => {
		const withDisabled = [...BASE_STORED, storedCred(6, "disabled-co", "api_key", "user disabled")];
		const port = new FakeAuthStoragePort(withDisabled, OAUTH_ACCOUNTS, makeReports());
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		expect(input.accounts.find((a) => a.provider === "disabled-co")).toBeUndefined();
		expect(input.accounts).toHaveLength(5); // the 5 enabled accounts, disabled one dropped
	});

	it("enumerates BOTH stored oauth credentials of the same provider, and never a phantom summary lacking a stored credential", async () => {
		// anthropic has TWO stored oauth credentials (ids 1 and 7) → two distinct accounts
		// for one provider (the core "all accounts, multiple per provider" requirement).
		const stored: readonly StoredCredentialLike[] = [
			storedCred(1, "anthropic", "oauth"),
			storedCred(7, "anthropic", "oauth"),
		];
		// listOAuthAccounts returns one summary per stored credential PLUS a phantom
		// (credentialId 999) with NO backing stored credential. Stored credentials are the
		// source of truth for which accounts exist; OAuth summaries only ATTACH identity to a
		// credential that actually exists — so the phantom must NOT surface as an account.
		const oauth: Readonly<Record<string, readonly OAuthAccountLike[]>> = {
			anthropic: [
				{ position: 0, credentialId: 1, accountId: "acc-anth-a", email: "alice@anthropic.com" },
				{ position: 1, credentialId: 7, accountId: "acc-anth-b", email: "carol@anthropic.com" },
				{ position: 2, credentialId: 999, accountId: "acc-phantom", email: "ghost@anthropic.com" },
			],
		};
		const port = new FakeAuthStoragePort(stored, oauth, makeReports());
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		const anthropic = input.accounts.filter((a) => a.provider === "anthropic");
		// BOTH stored oauth accounts are enumerated, each with its OWN attached identity
		// (cred 1 → alice/pos 0, cred 7 → carol/pos 1 — not swapped, not collapsed to one):
		expect(anthropic).toHaveLength(2);
		const first = anthropic.find((a) => a.credentialId === 1);
		const second = anthropic.find((a) => a.credentialId === 7);
		expect(first).toMatchObject({ isSubscription: true, email: "alice@anthropic.com", accountId: "acc-anth-a", position: 0 });
		expect(second).toMatchObject({ isSubscription: true, email: "carol@anthropic.com", accountId: "acc-anth-b", position: 1 });

		// The phantom OAuth summary (credentialId 999, no stored credential) never appears —
		// gather intersects stored credentials × OAuth summaries, it does not union them:
		expect(input.accounts.some((a) => a.credentialId === 999)).toBe(false);
		expect(input.accounts.some((a) => a.email === "ghost@anthropic.com")).toBe(false);
		expect(input.accounts.some((a) => a.accountId === "acc-phantom")).toBe(false);
		// Exactly the two stored credentials — nothing phantom added, nothing dropped:
		expect(input.accounts).toHaveLength(2);
	});
});

describe("gatherUsageInput — usage reports", () => {
	it("forwards the provider reports verbatim, preserving overage fractions", async () => {
		const reports = makeReports();
		const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, reports);
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		expect(input.reports).toEqual(reports); // no mangling / filtering / clamping
		const codex = input.reports?.find((r) => r.provider === "openai-codex");
		expect(codex?.limits[0].amount.usedFraction).toBe(1.4); // overage survives gather
	});

	it("returns reports: null when fetchUsageReports yields null, still enumerating accounts", async () => {
		const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, null);
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		expect(input.reports).toBeNull();
		expect(input.accounts).toHaveLength(5);
	});
});

describe("gatherUsageInput — isolation (AC8)", () => {
	it("produces a token-free UsageInput — no raw credential/token fields leak", async () => {
		const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, makeReports());
		const input = await gatherUsageInput(port, 1, 1_000, new AbortController().signal);

		const forbidden = ["credential", "accessToken", "refreshToken", "apiKey", "token", "secret"];
		for (const acc of input.accounts) {
			for (const key of forbidden) {
				expect(Object.keys(acc)).not.toContain(key);
			}
		}
		// The secret token strings must not appear ANYWHERE in the serialized input.
		expect(JSON.stringify(input)).not.toContain("SECRET");
	});

	it("touches only the injected port — no provider HTTP — and forwards the abort signal", async () => {
		const hasFetch = typeof globalThis.fetch === "function";
		const fetchSpy = hasFetch
			? vi.spyOn(globalThis, "fetch").mockImplementation((() => {
					throw new Error("gather must not perform provider HTTP");
				}) as unknown as typeof globalThis.fetch)
			: undefined;

		try {
			const port = new FakeAuthStoragePort(BASE_STORED, OAUTH_ACCOUNTS, makeReports());
			const ac = new AbortController();
			await gatherUsageInput(port, 1, 1_000, ac.signal);

			// Enumeration + fetch went ONLY through the port:
			expect(port.listStoredCalls.length).toBeGreaterThanOrEqual(1);
			const oauthQueried = new Set(port.listOAuthCalls);
			for (const provider of ["anthropic", "openai-codex", "gemini", "kimi"]) {
				expect(oauthQueried.has(provider)).toBe(true);
			}
			// Usage fetched exactly once, with our signal forwarded (AC6/F6 cancellation seam):
			expect(port.fetchCalls).toHaveLength(1);
			expect(port.fetchCalls[0].signal).toBe(ac.signal);
			// No provider HTTP whatsoever:
			if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy?.mockRestore();
		}
	});
});
