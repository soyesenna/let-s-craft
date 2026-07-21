// Bun-only leaf: the assembler. index.ts is the SOLE module that wires the two leaves (component.ts +
// completion.ts) into the AskRuntimeFactory main.ts injects (plan §Guardrails import graph; v2 §1). It
// holds NO @oh-my-pi runtime VALUE import itself — `ExtensionAPI` is a type-only import (erased) — so
// the value-import surface stays exactly component.ts (pi-tui) + completion.ts (pi-ai).
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { createComponentFactory } from "./component.js";
import { createCompletionPort } from "./completion.js";
import type {
	AskExecutionContext,
	AskResult,
	AskRuntime,
	AskRuntimeBinder,
	AskUiOption,
	ConfirmResult,
	CustomFactoryFn,
	SelectResult,
} from "./types.js";

// Yes/No are fixed English system identifiers (parity with the legacy confirm loop); the descriptions
// are display-only rationale for the readability panel.
const CONFIRM_OPTIONS: AskUiOption[] = [
	{ label: "Yes", description: "Proceed with the action." },
	{ label: "No", description: "Do not proceed." },
];

/**
 * Produce the runtime binder main.ts injects into registerAskTools. The binder captures the
 * invocation context (per-execute) and returns an AskRuntime whose buildX methods each mint a
 * custom<T> factory bound to that context + a single CompletionPort. The per-tool result narrowing
 * (SelectResult / ConfirmResult / AskResult) is sound: a select view only ever yields a SelectResult.
 */
export function createAskRuntimeFactory(pi: ExtensionAPI): AskRuntimeBinder {
	void pi; // the runtime needs only the per-invocation ctx; pi is kept for the v2 §1 factory signature.
	return (ctx: AskExecutionContext): AskRuntime => {
		const port = createCompletionPort(ctx);
		return {
			buildSelect: params =>
				createComponentFactory(ctx, port, {
					tool: "select",
					question: params.question,
					options: params.options,
					multi: params.multi ?? false,
					recommended: params.recommended,
				}) as CustomFactoryFn<SelectResult>,
			buildConfirm: params =>
				createComponentFactory(ctx, port, {
					tool: "confirm",
					question: params.question,
					options: CONFIRM_OPTIONS,
					multi: false,
				}) as CustomFactoryFn<ConfirmResult>,
			buildAsk: params =>
				createComponentFactory(ctx, port, {
					tool: "ask",
					question: params.question,
					options: [],
					multi: false,
					prefill: params.prefill,
				}) as CustomFactoryFn<AskResult>,
		};
	};
}
