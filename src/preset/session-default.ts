import type { ExtensionAPI, ExtensionModelQuery } from "@oh-my-pi/pi-coding-agent";
import type { Model } from "@oh-my-pi/pi-ai";
import { type EffortLevel, splitEffort } from "./validate.js";

/** Entry types omp stamps on a brand-new session before session_start fires. */
export const SESSION_BOOT_STAMP_TYPES: ReadonlySet<string> = new Set([
	"model_change",
	"thinking_level_change",
	"service_tier_change",
]);

/** Structural view of a session entry; avoids an SDK value import in Node tests. */
export interface SessionEntryLike {
	type: string;
	role?: string | null;
}

/** Count session entries by type for debug-only gate diagnostics. */
export function entryTypeHistogram(entries: readonly SessionEntryLike[]): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const entry of entries) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
	return counts;
}

/**
 * True only for a fresh main session containing at most one of each known boot
 * stamp. Unknown entries exclude resumed and subagent sessions; a default-role
 * model change or duplicate stamp proves an active post-boot model choice.
 */
export function isFreshMainSession(entries: readonly SessionEntryLike[]): boolean {
	const counts: Record<string, number> = {};
	for (const entry of entries) {
		if (!SESSION_BOOT_STAMP_TYPES.has(entry.type)) return false;
		if (entry.type === "model_change" && entry.role === "default") return false;
		counts[entry.type] = (counts[entry.type] ?? 0) + 1;
		if (counts[entry.type] > 1) return false;
	}
	return true;
}

export interface SessionModelApi<M> {
	resolve(spec: string): M | undefined;
	setModel(model: M): Promise<boolean>;
	setThinkingLevel(level: EffortLevel): void;
}

type Assert<T extends true> = T;

/** Compile-time proof that the type-only host surfaces satisfy the pure seam. */
export type SessionApiSatisfiesHost = Assert<
	{
		resolve: ExtensionModelQuery["resolve"];
		setModel: ExtensionAPI["setModel"];
		setThinkingLevel: (level: EffortLevel) => void;
	} extends SessionModelApi<Model>
		? true
		: false
>;

export type SessionDefaultResult =
	| { status: "applied"; base: string; effort: EffortLevel | null }
	| { status: "unresolved"; base: string }
	| { status: "no-key"; base: string }
	| { status: "none" };

/** Resolve and apply a validated session-default spec without persistence. */
export async function applySessionDefaultModel<M>(
	spec: string | null,
	api: SessionModelApi<M>,
): Promise<SessionDefaultResult> {
	if (spec === null) return { status: "none" };
	const { base, effort } = splitEffort(spec);
	const model = api.resolve(base);
	if (model === undefined) return { status: "unresolved", base };
	if (!(await api.setModel(model))) return { status: "no-key", base };
	const validatedEffort = effort as EffortLevel | null;
	if (validatedEffort !== null) api.setThinkingLevel(validatedEffort);
	return { status: "applied", base, effort: validatedEffort };
}
