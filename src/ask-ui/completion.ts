// Bun-only leaf (B2): the live BYO-completion adapter. This is the SOLE holder of a pi-ai runtime
// VALUE import in the subsystem ([C12]) — vitest-on-Node cannot import pi-ai's source-TS entry point,
// so the pure request/redaction logic lives in completion-core.ts and only this adapter touches the
// network surface. Canon: ask-ui-wiring-contract-v2 §4 (CompletionPort, no-tools, resolver-by-identity,
// error dualism) + completion-bridge precedent ([C13]).
import { streamSimple } from "@oh-my-pi/pi-ai";
import type { AssistantMessage, Context, SimpleStreamOptions } from "@oh-my-pi/pi-ai";
import { redactSecrets, type CompletionPort, type SideChatUsage } from "./completion-core.js";
import type { AskExecutionContext } from "./types.js";

function extractText(message: AssistantMessage | undefined): string {
	if (!message) return "";
	let out = "";
	for (const part of message.content) if (part.type === "text") out += part.text;
	return out;
}

function mapUsage(message: AssistantMessage | undefined): SideChatUsage | undefined {
	const usage = message?.usage;
	if (!usage) return undefined;
	return { cacheReadInputTokens: usage.cacheRead, cacheCreationInputTokens: usage.cacheWrite };
}

/**
 * Build the live CompletionPort bound to the invocation context. Each `run` drives pi-ai `streamSimple`
 * (the resolver-aware entry: raw `stream` forwards a non-string apiKey straight to the provider and
 * crashes on `key.includes`, O1 live evidence) with the frozen request: `{ systemPrompt: [...] }`, the
 * converted messages (assistant history as a text content-block array — pi-ai's redaction pass has no
 * string guard for assistant content), NO tools (no-tools side call), and the apiKey RESOLVER forwarded
 * by identity (streamSimple resolves it internally, re-invoking for rotation). A provider
 * terminal error resolves to `{status:"error"}` with the message redacted; an aborted turn resolves to
 * `{status:"aborted"}`; a resolver reject / iterator throw propagates so the caller's normalizeSideError
 * turns it into a terminal error state (error dualism, v2 §4).
 */
export function createCompletionPort(ctx: AskExecutionContext): CompletionPort {
	return {
		async run(request, opts) {
			const model = ctx.models.resolve(request.model) ?? ctx.model;
			if (!model) return { text: "", status: "error", error: "lets-craft: no model available for the side chat." };
			const apiKey = ctx.modelRegistry.resolver(model, request.sessionId);
			const context = {
				systemPrompt: [request.systemPrompt],
				// O1 live evidence (appendix-live-spike.md): pi-ai's unconditional redaction pass
				// (transform-messages) has no string guard for ASSISTANT content — a bare string crashes
				// `assistantMsg.content.map`. Emit assistant history as a text content-block array; other
				// roles keep the plain string (the user/developer redaction arms already guard strings).
				messages: request.messages.map(m =>
					m.role === "assistant" ? { role: m.role, content: [{ type: "text", text: m.content }] } : { role: m.role, content: m.content },
				),
				// no `tools` field — the side call is deliberately tool-free.
			} as unknown as Context;
			const options = {
				apiKey,
				signal: opts.signal,
				sessionId: request.sessionId,
				promptCacheKey: request.promptCacheKey,
				cacheRetention: request.cacheRetention,
			} as unknown as SimpleStreamOptions;

			const events = streamSimple(model, context, options);
			let text = "";
			let terminal: AssistantMessage | undefined;
			for await (const event of events) {
				if (event.type === "text_delta") {
					text += event.delta;
					opts.onDelta?.(event.delta);
				} else if (event.type === "done") {
					terminal = event.message;
				} else if (event.type === "error") {
					terminal = event.error;
				}
			}

			const usage = mapUsage(terminal);
			const body = text.length > 0 ? text : extractText(terminal);
			const stopReason = terminal?.stopReason;
			if (stopReason === "aborted") return { text: body, status: "aborted", usage };
			if (stopReason === "error") {
				return { text: body, status: "error", error: redactSecrets(terminal?.errorMessage ?? "side completion failed"), usage };
			}
			return { text: body, status: "complete", usage };
		},
	};
}
