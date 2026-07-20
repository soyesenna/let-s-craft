// U3 (CompletionPort request shape + cache lifetime) + U4 (pure redactor + error normalizer)
// + U2 (details.sideChat schema for all 3 result types).
//
// Scope: the Node-safe pure core `src/ask-ui/completion-core.ts` ONLY (reducer transitions live in
// ask-ui-state.test.ts; live pi-ai wiring lives in the Bun adapter suite). Every symbol here is the
// completion surface the orchestrator pinned (ask-ui-wiring-contract-v2 §4): SideChatRequest{
// systemPrompt, messages, model, sessionId, promptCacheKey, cacheRetention:"none"|"short"|"long"},
// SideChatResult{text, status, error?, usage?}, CompletionPort.run(req, {signal, onDelta}),
// buildSideChatDetails(turns). Cache-lifetime canon: plan §PR3 (session created once per question,
// frozen, getBranch called exactly once, reused across turns). Failure canon: plan §PR2
// Fallback/Failure (resolver reject / iterator exception -> normalizeSideError; secrets never stored).
//
// U4 SCOPE (iteration 2, ask-ui-wiring-contract-v2 §4): this file owns ONLY the PURE failure pieces
// — the secret redactor (3 adversarial vectors) and normalizeSideError. The actual driver behaviour
// (a real createCompletionPort mapping a provider terminal error / abort / resolver reject / iterator
// throw / usage into a SideChatResult) is verified against the live adapter in the Bun suite (B2) and
// the reducer's absorption of those results in integration (I4) — NOT by a fake port that re-checks
// its own return value here.
//
// EXPECTED STATE: RED — `../src/ask-ui/completion-core` does not exist until PR3 implements it. The
// import failure is the correct pre-craft signal, not a defect in this file.
import { describe, expect, it, vi } from "vitest";
import {
	buildSideChatDetails,
	buildSideRequest,
	createSideChatSession,
	normalizeSideError,
	redactSecrets,
	type SideChatDetails,
	type SideChatMessage,
	type SideChatRequest,
	type SideChatSession,
} from "../src/ask-ui/completion-core";
import type { ChatTarget, SideChatMode, SideChatTurn } from "../src/ask-ui/types";
import type { AskResultDetails, ConfirmResultDetails, SelectResultDetails } from "../src/ask";

// SideChatRequest.cacheRetention exact-union pin moved to assets/typecheck/ask-ui-contract.test-d.ts (CS5 — real tsc stage runs it; a dormant in-suite alias was transpiled away, never checked).

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

// ---------------------------------------------------------------------------
// Fixtures — a frozen side session + a two-option question, exercised across turns.
// ---------------------------------------------------------------------------

const QUESTION = "How should the feature branch be integrated?";
const OPTIONS: ReadonlyArray<{ label: string; description: string }> = [
	{ label: "Rebase", description: "Replay the feature commits on top of the target branch." },
	{ label: "Merge", description: "Create a merge commit that joins both histories." },
];
const OPTION_TARGET: ChatTarget = { kind: "option", label: "Rebase" };
const QUESTION_TARGET: ChatTarget = { kind: "question" };

// A canonicalized getBranch() snapshot: the exact `{ role, content }` message shape a request carries.
const HISTORY: readonly SideChatMessage[] = Object.freeze([
	{ role: "user", content: "Earlier in the session: what is the branch state?" },
	{ role: "assistant", content: "Earlier: the branch is three commits ahead of main." },
]);

const SYSTEM_PROMPT =
	"You are assisting a user answering a multiple-choice question inside the lets-craft pipeline. " +
	"You have NO tools and cannot run commands — answer directly from the provided context.";

function makeSession(over: Partial<SideChatSession> = {}): SideChatSession {
	return {
		nonce: "nonce-1",
		sessionId: "main-abc:side:nonce-1",
		promptCacheKey: "main-abc",
		model: "anthropic/claude-sonnet",
		systemPrompt: SYSTEM_PROMPT,
		historySnapshot: HISTORY,
		...over,
	};
}

function oneButton(target: ChatTarget) {
	return { target, mode: "one-button" as SideChatMode, question: QUESTION, options: OPTIONS };
}
function freePrompt(target: ChatTarget, text: string) {
	return { target, mode: "free-prompt" as SideChatMode, question: QUESTION, options: OPTIONS, freePrompt: text };
}

// The confirmed prior turn a follow-up request replays. Its `prompt` MUST be byte-identical to the
// user message the first request emitted, or the cacheable prefix breaks — so we lift it from req1.
function priorTurn(fromRequest: SideChatRequest, response: string): SideChatTurn {
	const lastUser = fromRequest.messages[fromRequest.messages.length - 1];
	return {
		target: OPTION_TARGET,
		mode: "one-button",
		prompt: lastUser.content,
		response,
		model: "anthropic/claude-sonnet",
		startedAt: "2026-07-20T00:00:00.000Z",
		endedAt: "2026-07-20T00:00:01.000Z",
		status: "complete",
	};
}

function turn(over: Partial<SideChatTurn> = {}): SideChatTurn {
	return {
		target: OPTION_TARGET,
		mode: "one-button",
		prompt: 'Explain the option "Rebase".',
		response: "Rebase replays commits linearly.",
		model: "anthropic/claude-sonnet",
		startedAt: "2026-07-20T00:00:00.000Z",
		endedAt: "2026-07-20T00:00:02.000Z",
		status: "complete",
		...over,
	};
}

// ---------------------------------------------------------------------------
// U3 — request shape (AC6.1)
// ---------------------------------------------------------------------------

describe("buildSideRequest — provider-ready request shape (U3, AC6.1)", () => {
	it("carries the frozen session identity onto the request", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		expect(req.sessionId).toBe(session.sessionId);
		expect(req.promptCacheKey).toBe(session.promptCacheKey);
		expect(req.model).toBe(session.model);
	});

	it("uses the non-empty frozen system prompt verbatim", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		expect(typeof req.systemPrompt).toBe("string");
		expect(req.systemPrompt.trim().length).toBeGreaterThan(0);
		expect(req.systemPrompt).toBe(session.systemPrompt);
	});

	it("never carries tools on the request (no-tools side call)", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		// The pinned SideChatRequest has no `tools` field; a builder that smuggled one in would leak it.
		expect((req as unknown as Record<string, unknown>).tools).toBeUndefined();
	});

	it("defaults cacheRetention to the pinned pi-ai union value 'short'", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		// The exact pi-ai domain union is "none" | "short" | "long" (ai/src/types.ts:106); the side
		// call's default lifetime is "short" (v2 §4, D3). Arbitrary markers like "5m"/"session" are gone.
		expect(req.cacheRetention).toBe("short");
		expect(["none", "short", "long"]).toContain(req.cacheRetention);
	});

	it("prepends the getBranch history snapshot as the message prefix", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		expect(req.messages.slice(0, HISTORY.length)).toEqual(HISTORY);
	});

	it("puts the rendered one-button prompt (question + focused option) in the trailing user message", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const last = req.messages[req.messages.length - 1];
		expect(last.role).toBe("user");
		expect(last.content).toContain(QUESTION);
		expect(last.content).toContain("Rebase"); // the focused option label
		expect(last.content).toContain("Merge"); // the alternatives are offered for contrast
	});

	it("bounds the one-button prompt with a length hint but leaves the system prompt hint-free (cache-prefix invariance)", () => {
		const session = makeSession();
		const req = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const last = req.messages[req.messages.length - 1];
		expect(last.content).toContain("150"); // "~150 words" bound lives in the USER prompt only
		expect(req.systemPrompt).not.toContain("150"); // ...never in the mode-invariant system prefix
	});

	it("varies the one-button prompt for a question-target vs an option-target", () => {
		const session = makeSession();
		const optionReq = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const questionReq = buildSideRequest(session, [], oneButton(QUESTION_TARGET));
		const optionMsg = optionReq.messages[optionReq.messages.length - 1].content;
		const questionMsg = questionReq.messages[questionReq.messages.length - 1].content;
		expect(optionMsg).not.toBe(questionMsg);
		expect(questionMsg).toContain(QUESTION);
	});

	it("uses the raw user input as the free-prompt message with no length hint (deep path)", () => {
		const session = makeSession();
		const raw = "But what happens to open PRs that target the old branch tip?";
		const req = buildSideRequest(session, [], freePrompt(OPTION_TARGET, raw));
		const last = req.messages[req.messages.length - 1];
		expect(last.role).toBe("user");
		expect(last.content).toBe(raw);
		expect(last.content).not.toContain("150"); // free-prompt turns are unbounded (spec §Goal, R4)
	});
});

// ---------------------------------------------------------------------------
// U3 — cache lifetime: prefix deep-equality oracle + getBranch-once + freeze (AC6.1)
// ---------------------------------------------------------------------------

describe("side chat session cache lifetime (U3, AC6.1)", () => {
	it("makes the follow-up request a strict superset whose request1-length prefix deep-equals request1", () => {
		const session = makeSession();
		const req1 = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const turn1 = priorTurn(req1, "Rebase keeps history linear...");
		const req2 = buildSideRequest(session, [turn1], freePrompt(OPTION_TARGET, "And if there are conflicts?"));

		// The whole point of a stable prefix: req1's messages appear, byte-for-byte, at the head of req2.
		expect(req2.messages.length).toBeGreaterThan(req1.messages.length);
		expect(req2.messages.slice(0, req1.messages.length)).toEqual(req1.messages);
	});

	it("keeps sessionId / promptCacheKey / cacheRetention / systemPrompt identical across turns", () => {
		const session = makeSession();
		const req1 = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const req2 = buildSideRequest(session, [priorTurn(req1, "A1")], freePrompt(OPTION_TARGET, "follow up"));
		expect(req2.sessionId).toBe(req1.sessionId);
		expect(req2.promptCacheKey).toBe(req1.promptCacheKey);
		expect(req2.cacheRetention).toBe(req1.cacheRetention); // stable lifetime marker across the whole panel
		expect(req2.systemPrompt).toBe(req1.systemPrompt); // mode-invariant prefix
	});

	it("appends each prior turn as a user/assistant pair before the current user message", () => {
		const session = makeSession();
		const req1 = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		const turn1 = priorTurn(req1, "assistant answer one");
		const req2 = buildSideRequest(session, [turn1], freePrompt(OPTION_TARGET, "current user text"));
		const tail = req2.messages.slice(req1.messages.length);
		expect(tail).toEqual([
			{ role: "assistant", content: "assistant answer one" },
			{ role: "user", content: "current user text" },
		]);
	});

	it("creates the session by calling getBranch exactly once and freezing the result", () => {
		const getBranch = vi.fn(() => HISTORY);
		const session = createSideChatSession({
			mainSessionId: "main-abc",
			nonce: "nonce-1",
			model: "anthropic/claude-sonnet",
			systemPrompt: SYSTEM_PROMPT,
			getBranch,
		});
		expect(getBranch).toHaveBeenCalledTimes(1);
		expect(session.sessionId).toBe("main-abc:side:nonce-1");
		expect(session.promptCacheKey).toBe("main-abc");
		expect(session.model).toBe("anthropic/claude-sonnet");
		expect(session.systemPrompt).toBe(SYSTEM_PROMPT);
		expect(session.historySnapshot).toEqual(HISTORY);
		expect(Object.isFrozen(session)).toBe(true);
		expect(Object.isFrozen(session.historySnapshot)).toBe(true);
	});

	it("decouples the snapshot by value and deep-freezes it — post-creation mutation of the source array or its messages never leaks in", () => {
		// A MUTABLE source (unlike the frozen HISTORY fixture): a plain growable array of writable
		// message objects. A shallow-aliasing implementation that stored the caller's array or its
		// message objects would surface the mutations below; a by-value canonicalized snapshot cannot.
		const mutableSource: { role: SideChatMessage["role"]; content: string }[] = [
			{ role: "user", content: "Earlier in the session: what is the branch state?" },
			{ role: "assistant", content: "Earlier: the branch is three commits ahead of main." },
		];
		const getBranch = vi.fn(() => mutableSource);
		const session = createSideChatSession({
			mainSessionId: "main-abc",
			nonce: "nonce-1",
			model: "anthropic/claude-sonnet",
			systemPrompt: SYSTEM_PROMPT,
			getBranch,
		});
		// The exact bytes the snapshot must preserve: its creation-time value equals the canonical
		// HISTORY shape (mutableSource was byte-identical to HISTORY at the moment of creation).
		const bytesAtCreation = JSON.stringify(HISTORY);
		expect(JSON.stringify(session.historySnapshot)).toBe(bytesAtCreation);

		// Mutate the ORIGINAL source AFTER creation: grow the array AND rewrite an existing message.
		mutableSource.push({ role: "user", content: "A post-creation turn that must NOT appear in the snapshot." });
		mutableSource[0].content = "MUTATED after creation — a live alias would surface this string.";

		// The snapshot is byte-for-byte the creation-time value: it neither grew nor changed a byte.
		expect(JSON.stringify(session.historySnapshot)).toBe(bytesAtCreation);
		expect(session.historySnapshot).toEqual(HISTORY);

		// Deep freeze: the array is frozen AND every message object is individually frozen, so the
		// snapshot cannot be mutated in place either.
		expect(Object.isFrozen(session.historySnapshot)).toBe(true);
		for (const message of session.historySnapshot) {
			expect(Object.isFrozen(message)).toBe(true);
		}
	});

	it("reuses the frozen snapshot for every subsequent request — getBranch is never called again", () => {
		const getBranch = vi.fn(() => HISTORY);
		const session = createSideChatSession({
			mainSessionId: "main-abc",
			nonce: "nonce-1",
			model: "anthropic/claude-sonnet",
			systemPrompt: SYSTEM_PROMPT,
			getBranch,
		});
		const req1 = buildSideRequest(session, [], oneButton(OPTION_TARGET));
		buildSideRequest(session, [priorTurn(req1, "A1")], freePrompt(OPTION_TARGET, "again"));
		expect(getBranch).toHaveBeenCalledTimes(1);
	});

	it("namespaces the side session under the main id while keeping the cache key stable across nonces", () => {
		const getBranch = () => HISTORY;
		const a = createSideChatSession({ mainSessionId: "main-9", nonce: "aaa", model: "m", systemPrompt: "s", getBranch });
		const b = createSideChatSession({ mainSessionId: "main-9", nonce: "bbb", model: "m", systemPrompt: "s", getBranch });
		expect(a.sessionId).toBe("main-9:side:aaa");
		expect(b.sessionId).toBe("main-9:side:bbb");
		expect(a.sessionId).not.toBe(b.sessionId); // unique side ids avoid main-session cache pollution
		expect(a.promptCacheKey).toBe("main-9");
		expect(b.promptCacheKey).toBe("main-9"); // stable across the whole question
	});
});

// ---------------------------------------------------------------------------
// U2 — details.sideChat schema for all 3 result types (AC1.4)
// ---------------------------------------------------------------------------

describe("buildSideChatDetails — details.sideChat schema (U2, AC1.4)", () => {
	it("is ABSENT (undefined) when no chat turn occurred", () => {
		expect(buildSideChatDetails([])).toBeUndefined();
	});

	it("wraps recorded turns into a { turns } record when chat did occur", () => {
		const details = buildSideChatDetails([turn()]);
		expect(details).toBeDefined();
		expect(details?.turns).toHaveLength(1);
		expect(details?.turns[0]).toMatchObject({
			target: { kind: "option", label: "Rebase" },
			mode: "one-button",
			prompt: 'Explain the option "Rebase".',
			response: "Rebase replays commits linearly.",
			model: "anthropic/claude-sonnet",
			status: "complete",
		});
	});

	it("carries ISO-8601 startedAt / endedAt on every turn", () => {
		const details = buildSideChatDetails([turn(), turn({ status: "aborted", response: "partial" })]);
		for (const t of details?.turns ?? []) {
			expect(t.startedAt).toMatch(ISO_8601);
			expect(t.endedAt).toMatch(ISO_8601);
		}
	});

	it("omits the error field for a completed turn (error present IFF status === 'error')", () => {
		const [t] = buildSideChatDetails([turn({ status: "complete" })])!.turns;
		expect("error" in t).toBe(false);
	});

	it("omits the error field for an aborted turn even when partial text exists", () => {
		const [t] = buildSideChatDetails([turn({ status: "aborted", response: "partial answer" })])!.turns;
		expect("error" in t).toBe(false);
		expect(t.response).toBe("partial answer");
	});

	it("keeps the error field only on an error turn", () => {
		const [t] = buildSideChatDetails([turn({ status: "error", response: "", error: "429 rate_limit_exceeded" })])!.turns;
		expect(t.status).toBe("error");
		expect(t.error).toContain("429");
	});

	it("strips a stray error string off a non-error turn (schema stays well-formed at the boundary)", () => {
		// A malformed upstream turn (status complete + a leftover error) must NOT reach details.sideChat
		// with an error field — the status<->error combination rule is enforced here, not merely trusted.
		const [t] = buildSideChatDetails([turn({ status: "complete", error: "should not survive" })])!.turns;
		expect("error" in t).toBe(false);
	});

	it("redacts secrets carried in an error turn's message at the details boundary", () => {
		const [t] = buildSideChatDetails([
			turn({ status: "error", response: "", error: "auth: Bearer sk-ant-LEAK112233445566 rejected" }),
		])!.turns;
		expect(t.error).not.toContain("sk-ant-LEAK112233445566");
	});

	it("produces the SAME sideChat schema for all 3 result-detail types (ask / select / confirm)", () => {
		const sideChat: SideChatDetails | undefined = buildSideChatDetails([turn()]);
		// The optional sideChat field is uniform across the 3 details containers (appendix §4): the
		// exact same value type-checks and reads back identically under each result type.
		const ask: AskResultDetails = { question: QUESTION, response: "Rebase", source: "ui", sideChat };
		const select: SelectResultDetails = { question: QUESTION, selections: ["Rebase"], source: "ui", sideChat };
		const confirm: ConfirmResultDetails = { question: QUESTION, confirmed: true, source: "ui", sideChat };
		expect(ask.sideChat?.turns).toHaveLength(1);
		expect(select.sideChat).toBe(sideChat);
		expect(confirm.sideChat).toBe(sideChat);
		expect(ask.sideChat).toEqual(select.sideChat);
		expect(select.sideChat).toEqual(confirm.sideChat);
	});
});

// ---------------------------------------------------------------------------
// U4 — pure secret redactor: adversarial vectors (AC4.1/AC4.2)
// ---------------------------------------------------------------------------

describe("redactSecrets — adversarial vectors never survive into a stored error (U4, AC4.1)", () => {
	it("strips a Bearer token from an Authorization header string", () => {
		const raw = "401 Unauthorized — Authorization: Bearer sk-ant-api03-AbCdEf0123456789ZyXwVu insufficient scope";
		const out = redactSecrets(raw);
		expect(out).not.toContain("sk-ant-api03-AbCdEf0123456789ZyXwVu");
		expect(out).not.toContain("Bearer sk-ant-api03-AbCdEf0123456789ZyXwVu");
		expect(out).toContain("401"); // the diagnostic context survives redaction
	});

	it("strips a bare sk- prefixed API key", () => {
		const raw = "provider rejected credential sk-proj-abcdEFGH1234ijklMNOP5678qrst (revoked)";
		const out = redactSecrets(raw);
		expect(out).not.toContain("sk-proj-abcdEFGH1234ijklMNOP5678qrst");
		expect(out).toContain("revoked");
	});

	it("strips a URL-embedded api_key query parameter while keeping the endpoint", () => {
		const raw = "GET https://api.example.com/v1/messages?api_key=SUPERSECRETdeadbeef99&model=x -> 403";
		const out = redactSecrets(raw);
		expect(out).not.toContain("SUPERSECRETdeadbeef99");
		expect(out).toContain("https://api.example.com/v1/messages");
	});

	it("scrubs every secret when several appear in one message", () => {
		const raw = "auth Bearer sk-ant-TOKENvalue12345678 and fallback ?api_key=OTHERSECRETabcdef99 both failed";
		const out = redactSecrets(raw);
		expect(out).not.toContain("sk-ant-TOKENvalue12345678");
		expect(out).not.toContain("OTHERSECRETabcdef99");
	});

	it("leaves ordinary error prose intact", () => {
		const raw = "429 Too Many Requests: rate limit exceeded, retry after 30 seconds";
		const out = redactSecrets(raw);
		expect(out).toContain("rate limit exceeded");
		expect(out).toContain("429");
		expect(out).toContain("retry after 30 seconds");
	});

	it("is idempotent — re-running over an already-redacted string is a no-op", () => {
		const raw = "Authorization: Bearer sk-ant-DoubleRun1234567890 denied";
		const once = redactSecrets(raw);
		expect(redactSecrets(once)).toBe(once);
	});
});

// ---------------------------------------------------------------------------
// U4 — error normalization: resolver-reject / iterator-exception -> terminal error result (AC4.1)
// ---------------------------------------------------------------------------

describe("normalizeSideError — throws become terminal error results (U4, AC4.1)", () => {
	it("converts a thrown Error into a terminal error SideChatResult", () => {
		const r = normalizeSideError(new Error("resolver failed: ECONNREFUSED 127.0.0.1:443"));
		expect(r.status).toBe("error");
		expect(typeof r.text).toBe("string"); // terminal result still exposes a (possibly empty) text field
		expect(r.error).toContain("ECONNREFUSED");
	});

	it("converts a non-Error throw via string coercion", () => {
		const r = normalizeSideError("upstream exploded");
		expect(r.status).toBe("error");
		expect(r.error).toContain("upstream exploded");
	});

	it("redacts secrets carried inside a thrown error message at the source", () => {
		const r = normalizeSideError(new Error("auth handshake: Bearer sk-ant-LEAK99887766554433 was rejected"));
		expect(r.status).toBe("error");
		expect(r.error).not.toContain("sk-ant-LEAK99887766554433");
	});
});
