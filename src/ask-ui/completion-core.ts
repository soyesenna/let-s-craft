// Node-safe pure completion core (U2/U3/U4). Owns the provider-ready request builder, the frozen
// side-chat session (getBranch snapshot, freeze, stable cache identity), the details.sideChat mapper,
// and the pure secret redactor + error normalizer. NO @oh-my-pi runtime value import — the live pi-ai
// stream lives in the Bun leaf completion.ts ([C12]). Canon: ask-ui-wiring-contract-v2 §4/§5 + plan
// §PR3 cache-lifetime canon + plan §PR2 Fallback/Failure canon.
import type { AskUiOption, ChatTarget, SideChatMode, SideChatTurn } from "./types.js";

export interface SideChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface SideChatRequest {
	systemPrompt: string; // non-blank; NO tools field (no-tools = adapter passes none to pi-ai)
	messages: SideChatMessage[]; // getBranch snapshot prefix + prior turns + current user message
	model: string;
	sessionId: string; // `{main}:side:{nonce}` — unique per question
	promptCacheKey: string; // the main session id — stable across the whole panel
	cacheRetention: "none" | "short" | "long"; // the pi-ai CacheRetention union; default "short"
}

export interface SideChatUsage {
	cacheReadInputTokens?: number;
	cacheCreationInputTokens?: number;
}

export interface SideChatResult {
	text: string;
	status: "complete" | "aborted" | "error";
	error?: string;
	usage?: SideChatUsage;
}

/** The invocation-bound live completion seam (implemented by the Bun leaf completion.ts). */
export interface CompletionPort {
	run(request: SideChatRequest, opts: { signal: AbortSignal; onDelta?: (chunk: string) => void }): Promise<SideChatResult>;
}

/** The frozen per-question side-chat session: cache identity + a canonicalized getBranch snapshot. */
export interface SideChatSession {
	nonce: string;
	sessionId: string;
	promptCacheKey: string;
	model: string;
	systemPrompt: string;
	historySnapshot: readonly SideChatMessage[];
}

export interface SideChatSessionSeed {
	mainSessionId: string;
	nonce: string;
	model: string;
	systemPrompt: string;
	getBranch: () => readonly SideChatMessage[];
}

/** The details.sideChat container appended to each result-detail type (appendix §4). */
export interface SideChatDetails {
	turns: SideChatTurn[];
}

/** The turn intent the reducer/driver hands the request builder for the current side turn. */
export interface SideChatTurnSpec {
	target: ChatTarget;
	mode: SideChatMode;
	question: string;
	options: readonly AskUiOption[];
	freePrompt?: string;
}

const CACHE_RETENTION_DEFAULT: SideChatRequest["cacheRetention"] = "short";
const LENGTH_HINT = "Keep it under ~150 words.";

/**
 * Create the per-question side session EXACTLY once: call getBranch a single time, canonicalize its
 * result by value (a fresh frozen message per entry so a later mutation of the source can never leak
 * in), and freeze the whole session. sessionId is namespaced under the main id; promptCacheKey is the
 * bare main id so the cacheable prefix stays stable across every turn/retry (plan §PR3).
 */
export function createSideChatSession(seed: SideChatSessionSeed): SideChatSession {
	const branch = seed.getBranch();
	const historySnapshot = Object.freeze(branch.map(m => Object.freeze({ role: m.role, content: m.content })));
	return Object.freeze({
		nonce: seed.nonce,
		sessionId: `${seed.mainSessionId}:side:${seed.nonce}`,
		promptCacheKey: seed.mainSessionId,
		model: seed.model,
		systemPrompt: seed.systemPrompt,
		historySnapshot,
	});
}

/** The rendered one-button user prompt (option vs question target variants, appendix §3). */
function renderOneButtonPrompt(spec: SideChatTurnSpec): string {
	const optionsBlock = spec.options.map(o => `- ${o.label}: ${o.description}`).join("\n");
	const header = `Question:\n${spec.question}\n\nOptions:\n${optionsBlock}\n\n`;
	if (spec.target.kind === "option") {
		return (
			header +
			`Explain the option "${spec.target.label}": what it does, why one would choose it, and its main ` +
			`tradeoff versus the other options. ${LENGTH_HINT}`
		);
	}
	return (
		header +
		`Explain this question: what is being decided, why it matters, and how the options differ, so I can ` +
		`choose. ${LENGTH_HINT}`
	);
}

/** The verbatim current user prompt for a spec: rendered (one-button) or the raw free-prompt text. */
export function renderTurnPrompt(spec: SideChatTurnSpec): string {
	return spec.mode === "free-prompt" ? spec.freePrompt ?? "" : renderOneButtonPrompt(spec);
}

/**
 * Build the provider-ready request: the frozen system prompt verbatim, the history snapshot prefix,
 * each prior turn flattened as a user/assistant pair, then the current user message — so the current
 * request is a strict superset whose request1-length prefix deep-equals request1 (cacheable prefix
 * invariance, U3). Carries the frozen session's cache identity; cacheRetention defaults to "short".
 */
export function buildSideRequest(
	session: SideChatSession,
	priorTurns: readonly SideChatTurn[],
	spec: SideChatTurnSpec,
): SideChatRequest {
	const messages: SideChatMessage[] = [...session.historySnapshot.map(m => ({ role: m.role, content: m.content }))];
	for (const turn of priorTurns) {
		messages.push({ role: "user", content: turn.prompt });
		messages.push({ role: "assistant", content: turn.response });
	}
	messages.push({ role: "user", content: renderTurnPrompt(spec) });
	return {
		systemPrompt: session.systemPrompt,
		messages,
		model: session.model,
		sessionId: session.sessionId,
		promptCacheKey: session.promptCacheKey,
		cacheRetention: CACHE_RETENTION_DEFAULT,
	};
}

// ── Secret redaction (U4 adversarial vectors: Bearer header, sk- key, URL-embedded key) ────────────
const REDACTED = "[redacted]";
const BEARER_RE = /Bearer\s+[A-Za-z0-9._~+/\-]+=*/g;
const SK_KEY_RE = /sk-[A-Za-z0-9._\-]+/g;
const URL_KEY_RE = /([?&](?:api[_-]?key|apikey|access[_-]?token|token|key)=)[^&\s]+/gi;

/** Strip credential shapes from an error string while keeping the diagnostic context. Idempotent. */
export function redactSecrets(text: string): string {
	return text
		.replace(BEARER_RE, `Bearer ${REDACTED}`)
		.replace(SK_KEY_RE, REDACTED)
		.replace(URL_KEY_RE, `$1${REDACTED}`);
}

/** Convert a thrown value (resolver reject / iterator throw) into a terminal error result. */
export function normalizeSideError(error: unknown): SideChatResult {
	const message = error instanceof Error ? error.message : String(error);
	return { text: "", status: "error", error: redactSecrets(message) };
}

/** Map recorded turns to the details.sideChat container: absent when empty; error field IFF error. */
export function buildSideChatDetails(turns: readonly SideChatTurn[]): SideChatDetails | undefined {
	if (turns.length === 0) return undefined;
	return {
		turns: turns.map(t => {
			const base: SideChatTurn = {
				target: t.target,
				mode: t.mode,
				prompt: t.prompt,
				response: t.response,
				model: t.model,
				startedAt: t.startedAt,
				endedAt: t.endedAt,
				status: t.status,
			};
			if (t.status === "error") base.error = redactSecrets(t.error ?? "");
			return base;
		}),
	};
}
