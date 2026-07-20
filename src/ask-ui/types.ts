// Node-safe shared types for the ask-ui readability + side-chat subsystem.
//
// This module holds ONLY `import type` from @oh-my-pi (erased at compile) plus pure type/const
// declarations — no runtime value import of any SDK package, so it stays loadable under
// vitest-on-Node ([C12], statusbar precedent). The Bun leaves (component/completion/index) are the
// sole holders of @oh-my-pi runtime value imports; this module is imported by both the pure core
// (state/render-model/palette/completion-core) and by src/ask.ts (type-only) for the bound runtime.
import type { ExtensionContext, ExtensionUiComponent } from "@oh-my-pi/pi-coding-agent";

// ── §1 binder ctx (ask-ui-wiring-contract-v2 §1): the EXACT six-member Pick of the SDK context ─────
// A 7th member, a dropped member, or a hand-rolled look-alike all fail the type-contract pin
// (assets/typecheck/ask-ui-contract.test-d.ts).
export type AskExecutionContext = Pick<
	ExtensionContext,
	"model" | "models" | "modelRegistry" | "sessionManager" | "getSystemPrompt" | "hasUI"
>;

// ── Palette roles (9-role hierarchy, appendix-palette §1) — the NAMES are the contract (render-model
// + snapshots key off them); the RGB/256 values are craft-tunable (D4). ────────────────────────────
export const PALETTE_ROLES = [
	"questionTitle",
	"optionLabel",
	"focusLabel",
	"description",
	"footer",
	"chatQuestion",
	"chatAnswer",
	"error",
	"border",
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

// ── Render environment (render-model + snapshot). colorMode is EXACTLY the two capability modes
// theme.ts getColorMode() reports (truecolor|256color) — never an invented "16color"/"nocolor". ─────
export type ColorMode = "truecolor" | "256color";
export interface RenderEnv {
	columns: number;
	rows: number;
	isLight: boolean;
	colorMode: ColorMode;
}

// ── A caller-supplied option: a short canonical label plus a required display-only description. ─────
export interface AskUiOption {
	label: string;
	description: string;
}

// ── Side-chat vocabulary (appendix §4 schema). ─────────────────────────────────────────────────────
export type ChatTarget = { kind: "option"; label: string } | { kind: "question" };
export type SideChatMode = "one-button" | "free-prompt";

export interface SideChatTurn {
	target: ChatTarget;
	mode: SideChatMode;
	prompt: string;
	response: string;
	model: string;
	startedAt: string;
	endedAt: string;
	status: "complete" | "aborted" | "error";
	error?: string;
}

// ── §2 result unions (ask-ui-wiring-contract-v2 §2 SSOT + §9). The ANSWER arm carries the optional
// sideChat?; the cancel arm stays bare. Free text rides `freeText` for select/confirm, `response`
// for ask. ─────────────────────────────────────────────────────────────────────────────────────────
export type SelectResult =
	| { kind: "answer"; selections: string[]; freeText?: string; sideChat?: SideChatTurn[] }
	| { kind: "cancel" };
export type ConfirmResult =
	| { kind: "answer"; confirmed: boolean | null; freeText?: string; sideChat?: SideChatTurn[] }
	| { kind: "cancel" };
export type AskResult = { kind: "answer"; response: string; sideChat?: SideChatTurn[] } | { kind: "cancel" };
export type AskUiResult = SelectResult | ConfirmResult | AskResult;

// ── The reducer's immutable view config (the question being asked). ─────────────────────────────────
export interface AskUiView {
	tool: "select" | "confirm" | "ask";
	question: string;
	options: readonly AskUiOption[];
	multi: boolean;
	recommended?: number;
	prefill?: string;
}

// ── §1 runtime contract (ask-ui-wiring-contract-v2 §1). The concrete factory + assembler live in the
// Bun leaf index.ts; these TYPES stay Node-safe so src/ask.ts can type the bound runtime without
// importing a leaf. ────────────────────────────────────────────────────────────────────────────────
export type CustomFactoryFn<T> = (
	tui: unknown,
	theme: unknown,
	keybindings: unknown,
	done: (result: T) => void,
) => ExtensionUiComponent | Promise<ExtensionUiComponent>;

export type SelectParams = { question: string; options: AskUiOption[]; multi?: boolean; recommended?: number };
export type ConfirmParams = { question: string };
export type AskParams = { question: string; prefill?: string };

export interface AskRuntime {
	buildSelect(params: SelectParams): CustomFactoryFn<SelectResult>;
	buildConfirm(params: ConfirmParams): CustomFactoryFn<ConfirmResult>;
	buildAsk(params: AskParams): CustomFactoryFn<AskResult>;
}
export type AskRuntimeBinder = (ctx: AskExecutionContext) => AskRuntime;
