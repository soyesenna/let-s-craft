import type { AuthStorage, UsageReport } from "@oh-my-pi/pi-ai";
import type { EnumeratedAccount, UsageInput } from "./view-model.js";

// ---------------------------------------------------------------------------
// PURE data-gather seam (plan §4/§6 Step 2). Imports omp types ONLY as
// `import type`, so it loads under vitest-on-Node. Usage enters EXCLUSIVELY
// through the injected `AuthStoragePort` — no provider HTTP, no OAuth-token
// handling. The enumerated accounts copy identity fields individually and never
// carry the credential object or any token/secret (AC8).
// ---------------------------------------------------------------------------

/** Structural view of a stored credential row (host: `StoredAuthCredential`). */
export interface StoredCredentialLike {
	id: number;
	provider: string;
	credential: { type: string };
	disabledCause: string | null;
}

/** Structural view of an OAuth account summary (host: `OAuthAccountSummary`). */
export interface OAuthAccountLike {
	position: number;
	credentialId: number;
	accountId?: string;
	email?: string;
	projectId?: string;
}

/** The read-only auth-storage surface gather depends on; host AuthStorage satisfies it. */
export interface AuthStoragePort {
	listStoredCredentials(provider?: string): readonly StoredCredentialLike[];
	listOAuthAccounts(provider: string): readonly OAuthAccountLike[];
	fetchUsageReports(options?: { signal?: AbortSignal }): Promise<UsageReport[] | null>;
}

type Assert<T extends true> = T;

/** Compile-time proof that the real AuthStorage is a structural AuthStoragePort (DR-F). */
export type AuthStorageSatisfiesPort = Assert<AuthStorage extends AuthStoragePort ? true : false>;

/**
 * Enumerate accounts from stored credentials and fetch usage once, forwarding
 * the caller's abort signal. OAuth identity attaches by credentialId INTERSECTION
 * with stored creds (the source of truth) so a phantom OAuth summary never surfaces.
 */
export async function gatherUsageInput(
	port: AuthStoragePort,
	now: number,
	staleAfterMs: number,
	signal: AbortSignal,
): Promise<UsageInput> {
	const stored = port.listStoredCredentials().filter((c) => !c.disabledCause);
	const storedIds = new Set(stored.map((c) => c.id));

	// Providers with at least one OAuth credential → query their accounts once each.
	const oauthProviders = new Set<string>();
	for (const cred of stored) {
		if (cred.credential.type === "oauth") oauthProviders.add(cred.provider);
	}

	const identityByCredId = new Map<number, OAuthAccountLike>();
	for (const provider of oauthProviders) {
		for (const summary of port.listOAuthAccounts(provider)) {
			// Intersection: only OAuth summaries backed by a stored cred attach.
			if (storedIds.has(summary.credentialId)) identityByCredId.set(summary.credentialId, summary);
		}
	}

	const accounts: EnumeratedAccount[] = [];
	for (const cred of stored) {
		if (cred.credential.type === "oauth") {
			const identity = identityByCredId.get(cred.id);
			// Fields copied individually — never spread/copy the credential object.
			const account: EnumeratedAccount = {
				provider: cred.provider,
				credentialId: cred.id,
				isSubscription: true,
				disabled: false,
			};
			if (identity?.accountId !== undefined) account.accountId = identity.accountId;
			if (identity?.email !== undefined) account.email = identity.email;
			if (identity?.projectId !== undefined) account.projectId = identity.projectId;
			if (identity?.position !== undefined) account.position = identity.position;
			accounts.push(account);
		} else {
			accounts.push({
				provider: cred.provider,
				credentialId: cred.id,
				isSubscription: false,
				disabled: false,
				note: `no usage - ${cred.credential.type.replace(/_/g, " ")}`,
			});
		}
	}

	const reports = await port.fetchUsageReports({ signal });
	return { now, staleAfterMs, accounts, reports };
}
