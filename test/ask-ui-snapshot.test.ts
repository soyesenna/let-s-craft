// ask-ui render/palette INVARIANT suite — appendix-test-plan §Snapshot/Render, rows R1–R7.
//
// STATUS: RED BY DESIGN. `src/ask-ui/{types,palette,render-model}.ts` do not exist yet — the
// feature is unimplemented (plan §PR2). These imports fail to resolve, so every case in this file
// fails at collection. That is the correct, expected state for a pre-craft test suite: the craft
// stage makes it GREEN by implementing the pure render-model + palette; this test is never edited
// to force green (it is hash-protected once the craft loop starts).
//
// SCOPE (Target): pure render-model path ONLY. This suite imports the three Node-safe pure modules
// (types/palette/render-model) and NEVER a Bun leaf (component/completion/index) — vitest on Node
// cannot import @oh-my-pi runtime values (plan §PR2 Import graph, [C12]). `OTHER_OPTION`/`DONE_OPTION`
// come from the pure host module `../src/ask` (the same control-row labels state/render-model use).
//
// WHAT EACH ROW DEFENDS (R-ID → AC):
//   R1 (AC3.1, AC5.1) focus option shows its FULL description via internal scroll (dense, exhaustive
//                     reachability); browse-view role→element mapping (title/label/focus/description/
//                     footer) present.
//   R2 (AC3.2)        non-focus options keep label + first description line only (no tail); every
//                     option's label reachable — nothing is "lost".
//   R3 (AC3.3)        R1+R2 still hold on a small terminal (24 rows), where the focus description
//                     genuinely exceeds the window so internal scroll is required to reach the tail;
//                     each non-focus option keeps its label + first line CO-PRESENT (unit not split).
//   R4 (AC5.2)        the palette adapts per Theme.isLight — the emitted color codes differ between
//                     light and dark, and body-text contrast moves in the correct direction against
//                     the TEST-OWNED reference backgrounds.
//   R5 (AC5.3)        no cell-size sequence (OSC 66 / DECDWL / DECDHL / DECSWL) ever appears.
//   R6 (AC5.1, AC5.2) chat panel (one-button answer shown): chat-question / chat-answer / error /
//                     border role hierarchy in both themes; the error-state footer keeps the `r`
//                     retry hint (N2 parity), the complete-state footer does not.
//   R7 (D2/P2)        the Other(n) / Done(n+1) control rows are focusable rows: when a control row
//                     holds focus the render invariants (focus-role mapping, RESET termination, no
//                     size sequences, height budget) still hold.
//
// ORACLE POLICY (D4 re-ratification; appendix-palette §1; v2 §6):
//   Exact RGB/256 bytes are NON-contract — the palette is craft-tunable (plan OQ3). This suite pins
//   only test-OWNED invariants, never a byte snapshot and never a production-table mirror:
//     • role→element MAPPING: element Y is painted with whatever code role X currently resolves to.
//       Role→code lookup via `resolvePalette().fgCode(role)` is allowed for THIS mapping judgment,
//       but never as "the value of role X is correct" — a value assertion would just mirror the
//       production table and pass even if that table were wrong. So `ROLE_TABLE`/`rgbToXterm256` are
//       NOT imported here; the palette's own value-derivation is TesterUnit's ask-ui-palette.test.ts.
//     • PAIRWISE distinction: all 9 roles resolve to distinct codes in every (mode × theme).
//     • ADAPTATION: light ≠ dark for body/text roles; render output differs while visible text stays
//       identical.
//     • CONTRAST DIRECTION: judged against TEST-OWNED reference backgrounds (below) — the RGB is
//       parsed out of the ACTUAL emitted truecolor code, so a wrong production RGB that inverts or
//       collapses contrast is caught. This is a proxy for the *named* reference bg, not a proof for
//       every unknown host background (plan/appendix framing).
//     • STYLING TERMINATION: every styled line ends with a RESET (no color bleeds past a line).
//     • SIZE-SEQUENCE ABSENCE: no font/cell-size escape ever appears.
//
// REACHABILITY POLICY (v2 §6; critic §What's-Missing "D4 불변식 oracle"; CS1 + critic N-A):
//   Description reachability is DENSE, EXHAUSTIVE and FULL-TEXT — not a sparse spot-check and not a
//   marker-only oracle. Each option's description is built from per-clause SEGMENTS (a unique marker
//   [<tag>#NN] plus the full clause prose); the suite requires every original SEGMENT — prose and all —
//   to be reachable, so a renderer that keeps the markers but drops the clause bodies FAILS. Segment
//   presence is judged with a wrap-robust normalization (collapse every whitespace run on BOTH the
//   rendered text and the segment, line-break boundaries ignored) so a correctly word-wrapped clause is
//   never false-RED (critic N-A); markers survive only as head/tail POSITION assists. The scroll loop is
//   CONVERGENCE-based (advance until the render output stops changing, i.e. the window has clamped at the
//   tail) — no fixed ceiling; if a content-derived watchdog is reached before convergence the render
//   never clamped (a buggy, non-clamping renderer) and the suite hard-FAILS.
//
// DETERMINISM: fixed inputs (4 options at the SSOT upper-bound description length, AC3.1) and fixed,
// parameterized terminal width/height. render-model is pure, so identical input ⇒ identical output.

import { describe, expect, it } from "vitest";
import { DONE_OPTION, OTHER_OPTION } from "../src/ask";
import {
	PALETTE_ROLES,
	type AskUiOption,
	type ChatTarget,
	type ColorMode,
	type PaletteRole,
	type RenderEnv,
} from "../src/ask-ui/types";
import { RESET, resolvePalette, type Palette } from "../src/ask-ui/palette";
import {
	renderChatPanel,
	renderSelectView,
	type ChatPanelViewModel,
	type ChatTurnView,
	type SelectViewModel,
} from "../src/ask-ui/render-model";

// ── Fixed, deterministic environments (terminal width × height, color mode, theme mode) ─────────
// Dark is the default; light variants are derived. SMALL is deliberately narrow (40 cols) as well
// as short (24 rows) so the SSOT-length descriptions wrap past the focus window and force internal
// scroll — that is the whole point of R3. ColorMode is the canonical union only (truecolor|256color;
// getColorMode() capability, plan.md:46) — no invented "16color"/"nocolor" modes (N5).
const WIDE: RenderEnv = { columns: 80, rows: 40, isLight: false, colorMode: "truecolor" };
const SMALL: RenderEnv = { columns: 40, rows: 24, isLight: false, colorMode: "truecolor" };
const asLight = (env: RenderEnv): RenderEnv => ({ ...env, isLight: true });

// Test-OWNED reference backgrounds (never read from production): the named dark/light terminal
// backgrounds the palette targets. Contrast DIRECTION is judged against THESE, so the reference is
// independent of the palette SSOT and a wrong production RGB cannot move the goalposts with it.
const REFERENCE_BG = {
	dark: [30, 34, 38] as const, // #1E2226 — a representative dark terminal background
	light: [245, 245, 242] as const, // #F5F5F2 — a representative light terminal background
};

// ── SSOT upper-bound-length option descriptions (AC3.1 condition: 4 options × long description) ──
// Each description is a realistic max-guidance rationale (What / Why / Pros / Cons / When / Failure /
// Tradeoff, per the lsc_select description contract), tiled with a UNIQUE dense marker per clause so
// the suite can prove EXHAUSTIVELY which spans are reachable. Markers are [<tag>#NN] with a two-digit,
// zero-padded index and a per-option tag letter, so `[A#00]` matches only itself (never `[A#01]`,
// never `[B#00]`) and never collides across options in a non-focus first-line render.
const TAGS = ["A", "B", "C", "D"] as const;
// Shared clause prose (identity is carried by the marker, not the words). Long enough that on the
// 40×24 SMALL terminal it cannot fit at scroll 0 — so R3's "internal scroll is genuinely required"
// holds no matter how the layout budgets rows across options.
const CLAUSES: readonly string[] = [
	"What: this option takes a concrete, well-scoped action that resolves the pending question directly.",
	"It never leaves the operator guessing about what will happen next or in what order it happens.",
	"Why: choose it when you want the safest and most auditable outcome available at this step.",
	"It records exactly what was decided, by whom, and at what time, for a later reviewer to trust.",
	"Pros: it is reversible, so an honest mistake can be walked back without losing any prior work.",
	"It is auditable, preserving full provenance for a maintainer arriving months after the fact.",
	"It composes cleanly with the surrounding pipeline stages and honours their existing contracts.",
	"Cons: it costs one extra confirmation step before it will actually proceed with the change.",
	"It requires a clean working tree and is measurably slower than the terser neighbouring options.",
	"It also prints more output, which is simply more to read on a cramped, small terminal window.",
	"When to choose: prefer it whenever review integrity plainly matters more than raw execution speed.",
	"Traceability and reproducibility should outweigh a minimal keystroke count for this decision.",
	"Failure mode: if a precondition is unmet it stops early with an explicit, actionable message.",
	"It never proceeds half-way and never leaves inconsistent state behind for someone else to fix.",
	"Tradeoff: you accept a little more ceremony now in exchange for a durable, self-explaining history.",
	"That history repays the cost the very first time somebody must audit what really happened here.",
];
const LAST_MARKER = CLAUSES.length - 1; // tail marker index; present only when scrolled to the end
function marker(tagIndex: number, n: number): string {
	return `[${TAGS[tagIndex]}#${String(n).padStart(2, "0")}]`;
}
/**
 * The focused-option description's per-clause SEGMENTS (unique marker + the FULL clause prose), in
 * order — exactly the units joined to build each option's description. These segments, not the bare
 * markers, are the full-text reachability oracle's unit (CS1): a renderer that keeps a marker but
 * drops its clause body no longer passes, because the prose is part of the segment.
 */
function descriptionSegments(tagIndex: number): string[] {
	return CLAUSES.map((clause, n) => `${marker(tagIndex, n)} ${clause}`);
}
const OPTION_LABELS = ["Merge and clean", "Force clean only", "Rebase interactive", "Abort operation"] as const;
const OPTIONS: readonly AskUiOption[] = OPTION_LABELS.map((label, i) => ({
	label,
	// tile each description with its per-option marker per clause (dense, head-to-tail).
	description: CLAUSES.map((clause, n) => `${marker(i, n)} ${clause}`).join(" "),
}));

const FOOTER = "↑↓ 이동 · Enter 선택 · ? 상세 · t 채팅 · / 검색 · Esc 뒤로";
const QUESTION = "How should the approved worktree be landed?";

// Base single-select browse view-model. recommended is intentionally omitted so no " (Recommended)"
// suffix perturbs the label-line color assertions; recommended rendering is a mapping concern
// (TesterUnit render-model.test.ts).
function selectVm(overrides: Partial<SelectViewModel> = {}): SelectViewModel {
	return {
		question: QUESTION,
		options: OPTIONS,
		multi: false,
		focusIndex: 0,
		optionScroll: 0,
		descriptionScroll: 0,
		footerHint: FOOTER,
		...overrides,
	};
}
// Multi-select view-model with two options already checked, so the Done control row is projected
// (multi && checkedIndices.length > 0 — parity with ask.ts:307-308). Used to exercise the extended
// focus domain: canonicalCursor n = Other, n+1 = Done (v2 §3, D2/P2).
function multiVm(overrides: Partial<SelectViewModel> = {}): SelectViewModel {
	return selectVm({ multi: true, checkedIndices: [0, 2], ...overrides });
}
const OTHER_INDEX = OPTIONS.length; // canonicalCursor n
const DONE_INDEX = OPTIONS.length + 1; // canonicalCursor n+1 (only when multi && checked>0)

// ── Chat panel view-models (R6): a completed one-button answer, and an error state ───────────────
const CHAT_TARGET: ChatTarget = { kind: "option", label: OPTION_LABELS[0] };
const ANSWER_TURNS: readonly ChatTurnView[] = [
	{ kind: "question", text: `[Q-ECHO] Explain the option "${OPTION_LABELS[0]}": what it does and its main tradeoff.` },
	{
		kind: "answer",
		text: "[A-BODY] It merges the approved branch with --no-ff, so the review history survives as one auditable merge commit. Choose it when provenance matters; the tradeoff is an extra merge commit and a required clean tree.",
	},
];
function chatComplete(): ChatPanelViewModel {
	return { target: CHAT_TARGET, turns: ANSWER_TURNS, status: "complete", footerHint: "Enter 전송 · Esc 뒤로" };
}
function chatError(): ChatPanelViewModel {
	return {
		target: { kind: "question" },
		turns: [{ kind: "question", text: "[Q-ECHO-ERR] Explain this question so I can decide." }],
		status: "error",
		error: "[ERR-BODY] provider request failed (429): rate limited.",
		footerHint: "r 재시도 · Esc 뒤로",
	};
}

// ── ANSI helpers ────────────────────────────────────────────────────────────────────────────────
function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Strip every escape sequence, leaving only the visible text of a rendered line. */
function stripAnsi(text: string): string {
	return text
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // CSI (includes SGR)
		.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "") // OSC … BEL/ST
		.replace(/\x1b[#()][0-9A-Za-z]/g, "") // ESC # n (line size) / charset select
		.replace(/\x1b[=>]/g, ""); // keypad mode
}
/**
 * Collapse EVERY whitespace run (spaces, tabs and line breaks alike) to a single space, then trim.
 * This is the wrap-robust normalization the full-text reachability oracle applies to BOTH sides — the
 * rendered visible text and the expected segment — so a clause the renderer word-wraps across visual
 * lines still compares equal to its un-wrapped source. A naive `.includes` on un-collapsed text would
 * false-RED a correct renderer, since the SSOT-length clauses always wrap at 80 columns (critic N-A).
 */
function normalizeVisible(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}
/**
 * True iff `fgCode` (a palette color introducer like "38;2;230;195;132" or "38;5;179") appears as a
 * complete SGR parameter run — bounded by "[" or ";" before and ";" or "m" after. The boundary check
 * is what makes this robust to (a) attribute ordering (bold before/after color) and (b) 256-index
 * prefixes ("38;5;17" must NOT match "38;5;179").
 */
function usesRoleColor(text: string, fgCode: string): boolean {
	return new RegExp(`[\\[;]${escapeRegExp(fgCode)}[;m]`).test(text);
}
/**
 * Fold one SGR parameter run (the text between "[" and "m") into the active foreground introducer.
 * Recognises full reset (0 / empty) and default-foreground (39) → no foreground; the 8/16-colour
 * foregrounds (30-37, 90-97); and the extended 38;5;N / 38;2;R;G;B forms, whose trailing params are
 * consumed. Background codes leave the foreground alone — 48;5;N / 48;2;R;G;B params are explicitly
 * skipped so an R/G/B value is never misread as a foreground code.
 */
function nextForeground(current: string | null, params: string): string | null {
	const parts = params === "" ? ["0"] : params.split(";");
	let fg = current;
	for (let i = 0; i < parts.length; i++) {
		const code = Number(parts[i]);
		if (code === 0 || code === 39) fg = null; // full reset / default foreground
		else if (code === 38) {
			if (parts[i + 1] === "5") { fg = `38;5;${parts[i + 2] ?? ""}`; i += 2; }
			else if (parts[i + 1] === "2") { fg = `38;2;${parts[i + 2] ?? ""};${parts[i + 3] ?? ""};${parts[i + 4] ?? ""}`; i += 4; }
		} else if (code === 48) {
			if (parts[i + 1] === "5") i += 2; // skip extended-background params
			else if (parts[i + 1] === "2") i += 4;
		} else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = String(code); // basic/bright fg
	}
	return fg;
}
/**
 * True iff every character of `needle` (matched in the line's VISIBLE text) is painted with `fgCode`
 * as the ACTIVE foreground. Walks the line's SGR tokens left-to-right, tracking (via `nextForeground`)
 * the foreground the terminal would have open at each visible column, and requires the WHOLE needle to
 * sit inside one span where `fgCode` is active. Unlike a line-wide substring test, this rejects a
 * render that opens `fgCode` elsewhere on the line (a border, a neighbouring element) while painting
 * the needle itself with a different colour — the same-line role-colour false-green D4 was closing
 * over (CS2; v2 §6). Every occurrence of `needle` is tried, so it stays correct if the needle repeats.
 */
function rolePaintsText(line: string, needle: string, fgCode: string): boolean {
	const sgr = /\x1b\[([0-9;]*)m/g;
	let activeFg: string | null = null;
	let visible = "";
	const fgAt: (string | null)[] = [];
	let last = 0;
	const pushText = (chunk: string): void => {
		const plain = stripAnsi(chunk);
		for (let k = 0; k < plain.length; k++) {
			visible += plain[k];
			fgAt.push(activeFg);
		}
	};
	for (let m = sgr.exec(line); m !== null; m = sgr.exec(line)) {
		pushText(line.slice(last, m.index));
		last = sgr.lastIndex;
		activeFg = nextForeground(activeFg, m[1]);
	}
	pushText(line.slice(last));
	for (let at = visible.indexOf(needle); at >= 0; at = visible.indexOf(needle, at + 1)) {
		let painted = true;
		for (let i = at; i < at + needle.length; i++) {
			if (fgAt[i] !== fgCode) { painted = false; break; }
		}
		if (painted) return true;
	}
	return false;
}
/**
 * True iff `line` leaves no color/attribute open past its end — i.e. the LAST SGR on the line is a
 * reset. Defends "styled runs are RESET-terminated; no color bleeds past a line" (v2 §6) without
 * pinning any exact byte layout (trailing padding after the reset is fine).
 */
function terminatesStyling(line: string): boolean {
	const sgr = /\x1b\[[0-9;]*m/g;
	let lastOpen = -1;
	let lastReset = -1;
	for (let m = sgr.exec(line); m !== null; m = sgr.exec(line)) {
		const isReset = m[0] === RESET || /^\x1b\[0?m$/.test(m[0]);
		if (isReset) lastReset = m.index;
		else lastOpen = m.index;
	}
	return lastOpen === -1 || lastReset > lastOpen;
}
/** Parse R,G,B out of a truecolor fgCode ("38;2;r;g;b"); null if it is not a truecolor code. */
function parseTrueColor(fgCode: string): [number, number, number] | null {
	const m = /^38;2;(\d+);(\d+);(\d+)$/.exec(fgCode);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** WCAG relative luminance of an sRGB triple — used only as a contrast-direction proxy (AC5.2). */
function relLuminance([r, g, b]: readonly [number, number, number]): number {
	const lin = (c: number): number => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio between two relative luminances. */
function contrastRatio(l1: number, l2: number): number {
	const hi = Math.max(l1, l2);
	const lo = Math.min(l1, l2);
	return (hi + 0.05) / (lo + 0.05);
}
/** The first rendered line whose visible text contains `needle` (asserts one exists). */
function rawLineWith(lines: string[], needle: string): string {
	const line = lines.find(l => stripAnsi(l).includes(needle));
	expect(line, `expected a rendered line containing ${JSON.stringify(needle)}`).toBeDefined();
	return line as string;
}
/**
 * Visit every descriptionScroll offset until the render output CONVERGES (stops changing because the
 * window has clamped at the tail). No fixed ceiling; a content-derived watchdog only guards against a
 * non-clamping implementation (convergence fires first).
 */
function forEachDescriptionScroll(
	base: SelectViewModel,
	env: RenderEnv,
	visit: (visibleText: string, scroll: number) => void,
): void {
	const watchdog = base.options.reduce((n, o) => n + o.description.length, 100);
	let prev = "";
	for (let scroll = 0; ; scroll++) {
		const raw = renderSelectView({ ...base, descriptionScroll: scroll }, env).join("\n");
		visit(stripAnsi(raw), scroll);
		if (scroll > 0 && raw === prev) break; // fixpoint: window clamped, output stable
		prev = raw;
		if (scroll >= watchdog) {
			// Convergence (fixpoint) MUST fire before this content-derived watchdog. Reaching it means the
			// render window never clamped at the tail (a non-terminating / cycling renderer) — a hard FAIL,
			// not a silent stop (CS1).
			throw new Error(
				`descriptionScroll never converged within ${watchdog} offsets — the render window did not clamp at the tail (buggy, non-clamping renderer)`,
			);
		}
	}
}
/**
 * The subset of `segments` (each a full description clause: marker + prose) reachable in FULL across
 * internal-scroll offsets. BOTH the rendered visible text and each segment pass through the SAME
 * wrap-robust normalization (`normalizeVisible`), then a segment counts as reachable iff SOME single
 * scroll render fully contains it — the window height ≫ a segment, so a correctly word-wrapped clause
 * always fits inside one window even as it wraps across visual lines (critic N-A). This is the
 * full-text oracle: a renderer that keeps only the marker and drops the clause prose fails, because
 * the prose is part of the segment (CS1).
 */
function reachableSegments(base: SelectViewModel, env: RenderEnv, segments: string[]): Set<string> {
	const wanted = segments.map(normalizeVisible);
	const seen = new Set<string>();
	forEachDescriptionScroll(base, env, text => {
		const norm = normalizeVisible(text);
		for (const w of wanted) if (norm.includes(w)) seen.add(w);
	});
	return seen;
}
/** Union of option labels reachable across list-scroll offsets (convergence-based). */
function reachableLabels(base: SelectViewModel, env: RenderEnv): Set<string> {
	const seen = new Set<string>();
	const watchdog = base.options.length + 8;
	let prev = "";
	for (let scroll = 0; ; scroll++) {
		const raw = renderSelectView({ ...base, optionScroll: scroll }, env).join("\n");
		const text = stripAnsi(raw);
		for (const l of OPTION_LABELS) if (text.includes(l)) seen.add(l);
		if (seen.size === OPTION_LABELS.length) break;
		if (scroll > 0 && raw === prev) break;
		prev = raw;
		if (scroll >= watchdog) break;
	}
	return seen;
}
/** True iff some list-scroll offset renders BOTH `label` and `firstLineMarker` together (co-present). */
function labelAndFirstLineCoPresent(base: SelectViewModel, env: RenderEnv, label: string, firstLineMarker: string): boolean {
	const watchdog = base.options.length + 8;
	let prev = "";
	for (let scroll = 0; ; scroll++) {
		const raw = renderSelectView({ ...base, optionScroll: scroll }, env).join("\n");
		const text = stripAnsi(raw);
		if (text.includes(label) && text.includes(firstLineMarker)) return true;
		if (scroll > 0 && raw === prev) break;
		prev = raw;
		if (scroll >= watchdog) break;
	}
	return false;
}

// Cell-size / line-size sequences that AC5.3 forbids in every render.
const SIZE_SEQUENCES: ReadonlyArray<{ name: string; seq: string }> = [
	{ name: "OSC 66 (cell size)", seq: "\x1b]66;" },
	{ name: "DECDHL top (ESC # 3)", seq: "\x1b#3" },
	{ name: "DECDHL bottom (ESC # 4)", seq: "\x1b#4" },
	{ name: "DECSWL single-width (ESC # 5)", seq: "\x1b#5" },
	{ name: "DECDWL double-width (ESC # 6)", seq: "\x1b#6" },
];

/** Every render output this suite produces (both views × full focus domain × control rows × chat). */
function allOutputs(env: RenderEnv): string[] {
	const outs: string[] = [];
	// single-select: question header (-1), each option, and the Other control row (n)
	for (let f = -1; f <= OPTIONS.length; f++) outs.push(renderSelectView(selectVm({ focusIndex: f }), env).join("\n"));
	// multi-select control rows: Other (n) and Done (n+1) both projected + focusable
	for (const f of [OTHER_INDEX, DONE_INDEX]) outs.push(renderSelectView(multiVm({ focusIndex: f }), env).join("\n"));
	outs.push(renderChatPanel(chatComplete(), env).join("\n"));
	outs.push(renderChatPanel(chatError(), env).join("\n"));
	return outs;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R1 — focus option shows its FULL description (internal scroll) + browse role→element mapping
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R1: focus description is reachable in full and the browse role hierarchy maps correctly (AC3.1, AC5.1)", () => {
	it("makes the ENTIRE focused-option description reachable in FULL across internal-scroll offsets (dense, exhaustive, full-text)", () => {
		const segments = descriptionSegments(0);
		const seen = reachableSegments(selectVm({ focusIndex: 0 }), WIDE, segments);
		expect([...seen].sort()).toEqual(segments.map(normalizeVisible).sort());
	});

	it("renders the question title with the questionTitle role color", () => {
		const lines = renderSelectView(selectVm(), WIDE);
		const titleLine = rawLineWith(lines, QUESTION);
		const fg = resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode("questionTitle");
		expect(rolePaintsText(titleLine, QUESTION, fg)).toBe(true);
	});

	it("renders the focused label with the focus color and a non-focused label with the option color (distinct roles)", () => {
		const palette = resolvePalette({ isLight: false, colorMode: "truecolor" });
		// focusLabel and optionLabel are distinct roles — the accent must not collapse.
		expect(palette.fgCode("focusLabel")).not.toEqual(palette.fgCode("optionLabel"));

		const lines = renderSelectView(selectVm({ focusIndex: 1 }), WIDE);
		expect(rolePaintsText(rawLineWith(lines, OPTION_LABELS[1]), OPTION_LABELS[1], palette.fgCode("focusLabel"))).toBe(true);
		expect(rolePaintsText(rawLineWith(lines, OPTION_LABELS[0]), OPTION_LABELS[0], palette.fgCode("optionLabel"))).toBe(true);
	});

	it("renders the focused description text with the description role color", () => {
		const lines = renderSelectView(selectVm({ focusIndex: 0 }), WIDE);
		const fg = resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode("description");
		expect(rolePaintsText(rawLineWith(lines, marker(0, 0)), marker(0, 0), fg)).toBe(true);
	});

	it("renders the footer key hints with the footer role color", () => {
		const lines = renderSelectView(selectVm(), WIDE);
		const fg = resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode("footer");
		expect(rolePaintsText(rawLineWith(lines, "Esc"), "Esc", fg)).toBe(true);
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R2 — non-focus keeps label + first line only; no option is lost
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R2: non-focus options keep label + first line and every option stays reachable (AC3.2)", () => {
	it("shows each non-focused option's first description line but none of its tail segments", () => {
		const text = normalizeVisible(stripAnsi(renderSelectView(selectVm({ focusIndex: 0 }), WIDE).join("\n")));
		for (const i of [1, 2, 3]) {
			// head POSITION assist (marker only): the option's first-line marker is present…
			expect(text, `option ${i} first line`).toContain(marker(i, 0));
			// …and EVERY segment after the first visual line is absent — the whole tail, not just the last (CS1).
			const tail = descriptionSegments(i).slice(1).map(normalizeVisible);
			for (let n = 0; n < tail.length; n++) {
				expect(text, `option ${i} tail segment ${n + 1} must be truncated`).not.toContain(tail[n]);
			}
		}
	});

	it("never expands a non-focused option to its full description, even as the focused one scrolls", () => {
		// descriptionScroll only moves the FOCUSED option's window; a non-focused option (index 1) must
		// stay capped at its first line at every scroll offset — EVERY tail segment stays absent, not just
		// the last one (convergence-scanned, no fixed cap; CS1).
		const tail = descriptionSegments(1).slice(1).map(normalizeVisible);
		forEachDescriptionScroll(selectVm({ focusIndex: 0 }), WIDE, (text, scroll) => {
			const norm = normalizeVisible(text);
			for (let n = 0; n < tail.length; n++) {
				expect(norm, `non-focus tail segment ${n + 1} leaked at scroll ${scroll}`).not.toContain(tail[n]);
			}
		});
	});

	it("keeps every option label reachable (nothing lost) and shows all labels together when they fit", () => {
		expect(reachableLabels(selectVm({ focusIndex: 0 }), WIDE)).toEqual(new Set(OPTION_LABELS));
		// On the roomy terminal all four labels are present simultaneously.
		const text = stripAnsi(renderSelectView(selectVm({ focusIndex: 0 }), WIDE).join("\n"));
		for (const label of OPTION_LABELS) expect(text).toContain(label);
	});

	it("keeps each option's full description reachable by focusing it (round-trip over all options)", () => {
		for (let i = 0; i < OPTIONS.length; i++) {
			const segments = descriptionSegments(i);
			const seen = reachableSegments(selectVm({ focusIndex: i }), WIDE, segments);
			expect([...seen].sort(), `option ${i} full text`).toEqual(segments.map(normalizeVisible).sort());
		}
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R3 — small terminal (24 rows): R1 & R2 still hold; internal + list scroll are genuinely required
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R3: readability holds on a small 24-row terminal (AC3.3)", () => {
	it("keeps the render within the terminal height budget and emits one visual line per array element", () => {
		for (let f = -1; f < OPTIONS.length; f++) {
			const lines = renderSelectView(selectVm({ focusIndex: f }), SMALL);
			expect(lines.length, `focus ${f} height`).toBeLessThanOrEqual(SMALL.rows);
			for (const l of lines) expect(l).not.toContain("\n");
		}
	});

	it("requires internal scroll to reach the focused description's tail, and scroll does reach it", () => {
		const segments = descriptionSegments(0);
		const atZero = stripAnsi(renderSelectView(selectVm({ focusIndex: 0, descriptionScroll: 0 }), SMALL).join("\n"));
		// head/tail POSITION assist (marker only): head present at scroll 0, tail marker not yet reached.
		expect(atZero, "head visible without scrolling").toContain(marker(0, 0));
		expect(atZero, "tail hidden until scrolled (scroll is genuinely required)").not.toContain(marker(0, LAST_MARKER));
		// full-text reachability (segments): every segment becomes reachable once internal scroll is applied.
		const seen = reachableSegments(selectVm({ focusIndex: 0 }), SMALL, segments);
		expect([...seen].sort()).toEqual(segments.map(normalizeVisible).sort());
	});

	it("keeps every option reachable via list scroll on the small terminal", () => {
		expect(reachableLabels(selectVm({ focusIndex: 0 }), SMALL)).toEqual(new Set(OPTION_LABELS));
	});

	it("keeps non-focus options truncated to a preview (never their full description) on the small terminal", () => {
		// Focus is on option 0, so options 1-3 are always non-focused: EVERY tail segment must be absent.
		const text = normalizeVisible(stripAnsi(renderSelectView(selectVm({ focusIndex: 0 }), SMALL).join("\n")));
		for (const i of [1, 2, 3]) {
			const tail = descriptionSegments(i).slice(1).map(normalizeVisible);
			for (let n = 0; n < tail.length; n++) {
				expect(text, `option ${i} tail segment ${n + 1} must never leak`).not.toContain(tail[n]);
			}
		}
	});

	it("keeps each non-focus option's label and its first description line CO-PRESENT (unit never split)", () => {
		// Focus option 0 → options 1..3 are non-focus. For each, some list-scroll offset must show BOTH
		// the label AND its first description line together — the "label + first line" preview unit is
		// never split, even when the small terminal must scroll the list to reveal that option (R2's
		// unit is preserved on the small terminal, which R3 previously left unpinned).
		for (const i of [1, 2, 3]) {
			expect(
				labelAndFirstLineCoPresent(selectVm({ focusIndex: 0 }), SMALL, OPTION_LABELS[i], marker(i, 0)),
				`option ${i} label + first line must be co-present at some list-scroll offset`,
			).toBe(true);
		}
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R4 — light/dark palette adaptation (AC5.2) — invariants only, no production-table mirror (D4)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R4: the palette adapts to Theme.isLight while keeping contrast direction (AC5.2)", () => {
	it("emits different color codes for light vs dark for every body/text role", () => {
		const dark = resolvePalette({ isLight: false, colorMode: "truecolor" });
		const light = resolvePalette({ isLight: true, colorMode: "truecolor" });
		const bodyRoles: PaletteRole[] = ["questionTitle", "optionLabel", "description", "chatAnswer"];
		for (const role of bodyRoles) {
			expect(dark.fgCode(role), `${role} must differ between modes`).not.toEqual(light.fgCode(role));
		}
	});

	it("produces a materially different render between light and dark for the same view", () => {
		const dark = renderSelectView(selectVm(), WIDE).join("\n");
		const light = renderSelectView(selectVm(), asLight(WIDE)).join("\n");
		expect(light).not.toEqual(dark);
		// Same visible text, different color codes.
		expect(stripAnsi(light)).toEqual(stripAnsi(dark));
	});

	it("uses the light-mode role code in a light render and the dark-mode role code in a dark render", () => {
		const darkLines = renderSelectView(selectVm({ focusIndex: 0 }), WIDE);
		const lightLines = renderSelectView(selectVm({ focusIndex: 0 }), asLight(WIDE));
		const darkFg = resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode("description");
		const lightFg = resolvePalette({ isLight: true, colorMode: "truecolor" }).fgCode("description");
		expect(rolePaintsText(rawLineWith(darkLines, marker(0, 0)), marker(0, 0), darkFg)).toBe(true);
		expect(rolePaintsText(rawLineWith(lightLines, marker(0, 0)), marker(0, 0), lightFg)).toBe(true);
	});

	it("moves body-text contrast in the correct direction against the TEST-OWNED reference backgrounds (AC5.2 proxy)", () => {
		// PROXY, per plan framing (appendix §1): against the NAMED reference backgrounds, dark-mode body
		// text must be LIGHTER than the dark bg and light-mode body text DARKER than the light bg, each
		// clearing the ≥4.5:1 body-text target (plan.md:228). The text RGB is parsed from the ACTUAL
		// emitted truecolor code (not read from the palette table), and the reference bg is test-owned —
		// so a wrong production RGB that inverts or under-shoots contrast is caught. This is NOT a
		// contrast proof for arbitrary unknown host backgrounds.
		const darkBgL = relLuminance(REFERENCE_BG.dark);
		const lightBgL = relLuminance(REFERENCE_BG.light);
		for (const role of ["description", "chatAnswer"] as const) {
			const darkFg = parseTrueColor(resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode(role));
			const lightFg = parseTrueColor(resolvePalette({ isLight: true, colorMode: "truecolor" }).fgCode(role));
			expect(darkFg, `${role} dark fg must be a truecolor code`).not.toBeNull();
			expect(lightFg, `${role} light fg must be a truecolor code`).not.toBeNull();
			const darkL = relLuminance(darkFg as [number, number, number]);
			const lightL = relLuminance(lightFg as [number, number, number]);
			// Direction: dark text sits on the dark bg (must be lighter); light text on the light bg (darker).
			expect(darkL, `${role} dark text lighter than the dark reference bg`).toBeGreaterThan(darkBgL);
			expect(lightL, `${role} light text darker than the light reference bg`).toBeLessThan(lightBgL);
			// Magnitude: each mode clears the ≥4.5:1 body-text target against its OWN reference bg.
			expect(contrastRatio(darkL, darkBgL), `${role} dark contrast ≥ 4.5:1`).toBeGreaterThanOrEqual(4.5);
			expect(contrastRatio(lightL, lightBgL), `${role} light contrast ≥ 4.5:1`).toBeGreaterThanOrEqual(4.5);
		}
	});

	it("keeps role→element mapping and pairwise distinction in 256-color mode (no exact-value mirror)", () => {
		const env256: RenderEnv = { ...WIDE, colorMode: "256color" };
		const palette = resolvePalette({ isLight: false, colorMode: "256color" });
		// Every role resolves to a 256-index code and they stay pairwise-distinct (no fallback collapse).
		const codes = PALETTE_ROLES.map(r => palette.fgCode(r));
		for (const c of codes) expect(c, "256 fallback must be a 38;5;N code").toMatch(/^38;5;\d+$/);
		expect(new Set(codes).size, "roles must stay pairwise-distinct in 256-color mode").toBe(PALETTE_ROLES.length);
		// And the render actually paints the title element with the questionTitle 256 code (mapping holds).
		const lines = renderSelectView(selectVm(), env256);
		expect(rolePaintsText(rawLineWith(lines, QUESTION), QUESTION, palette.fgCode("questionTitle"))).toBe(true);
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R5 — no cell-size sequences (AC5.3)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R5: no font/cell-size escape sequences appear in any render (AC5.3)", () => {
	it("emits no OSC 66 / DECDWL / DECDHL / DECSWL sequence across every view and theme", () => {
		const outputs = [...allOutputs(WIDE), ...allOutputs(SMALL), ...allOutputs(asLight(WIDE)), ...allOutputs(asLight(SMALL))];
		for (const out of outputs) {
			for (const { name, seq } of SIZE_SEQUENCES) {
				expect(out.includes(seq), `${name} must never be emitted`).toBe(false);
			}
		}
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R6 — chat panel (one-button answer shown): chat-question / chat-answer / error / border hierarchy
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R6: chat panel renders the chat-question/answer/error/border hierarchy in both themes (AC5.1, AC5.2)", () => {
	for (const theme of [
		{ name: "dark", isLight: false },
		{ name: "light", isLight: true },
	] as const) {
		const env: RenderEnv = { ...WIDE, isLight: theme.isLight };
		const palette = resolvePalette({ isLight: theme.isLight, colorMode: "truecolor" });

		it(`[${theme.name}] echoes the user question with the chatQuestion role color`, () => {
			const lines = renderChatPanel(chatComplete(), env);
			expect(rolePaintsText(rawLineWith(lines, "[Q-ECHO]"), "[Q-ECHO]", palette.fgCode("chatQuestion"))).toBe(true);
		});

		it(`[${theme.name}] renders the agent answer with the chatAnswer role color`, () => {
			const lines = renderChatPanel(chatComplete(), env);
			expect(rolePaintsText(rawLineWith(lines, "[A-BODY]"), "[A-BODY]", palette.fgCode("chatAnswer"))).toBe(true);
		});

		it(`[${theme.name}] draws a panel border with the border role color`, () => {
			const out = renderChatPanel(chatComplete(), env).join("\n");
			expect(usesRoleColor(out, palette.fgCode("border"))).toBe(true);
		});

		it(`[${theme.name}] renders an error turn with the error role color and keeps its own border`, () => {
			const lines = renderChatPanel(chatError(), env);
			expect(rolePaintsText(rawLineWith(lines, "[ERR-BODY]"), "[ERR-BODY]", palette.fgCode("error"))).toBe(true);
			expect(usesRoleColor(lines.join("\n"), palette.fgCode("border"))).toBe(true);
		});

		it(`[${theme.name}] keeps the chat panel within the terminal height budget`, () => {
			expect(renderChatPanel(chatComplete(), env).length).toBeLessThanOrEqual(env.rows);
			expect(renderChatPanel(chatError(), env).length).toBeLessThanOrEqual(env.rows);
		});
	}

	it("keeps the retry hint (r) in the error-state footer and omits it when complete (N2 parity)", () => {
		// The error state advertises the `r` retry affordance in its footer; the completed state does
		// not (it advertises send/back). This pins the retry surface the `r` key contract (state reducer,
		// TesterUnit) depends on — a retry that is never advertised is unreachable.
		const errorFooter = rawLineWith(renderChatPanel(chatError(), WIDE), "재시도");
		expect(stripAnsi(errorFooter), "the r retry key is shown in the error footer").toContain("r 재시도");
		expect(
			usesRoleColor(errorFooter, resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode("footer")),
			"the error footer uses the footer role color",
		).toBe(true);
		const completeText = stripAnsi(renderChatPanel(chatComplete(), WIDE).join("\n"));
		expect(completeText, "completed state advertises send").toContain("전송");
		expect(completeText, "completed state must not advertise retry").not.toContain("재시도");
	});

	it("adapts chat colors between light and dark (chatAnswer differs, visible text identical)", () => {
		const dark = renderChatPanel(chatComplete(), WIDE).join("\n");
		const light = renderChatPanel(chatComplete(), asLight(WIDE)).join("\n");
		expect(light).not.toEqual(dark);
		expect(stripAnsi(light)).toEqual(stripAnsi(dark));
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// R7 — control rows (Other=n, Done=n+1) are focusable rows; invariants hold under control focus (D2/P2)
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("R7: the Other/Done control rows are focusable and preserve the render invariants (D2/P2)", () => {
	it("paints the Other row with the focus color when it is the focus target (canonicalCursor = n)", () => {
		const palette = resolvePalette({ isLight: false, colorMode: "truecolor" });
		const focused = renderSelectView(multiVm({ focusIndex: OTHER_INDEX }), WIDE);
		expect(rolePaintsText(rawLineWith(focused, OTHER_OPTION), OTHER_OPTION, palette.fgCode("focusLabel"))).toBe(true);
		// The focused Other row renders differently from when it is not the focus target.
		const notFocused = renderSelectView(multiVm({ focusIndex: 0 }), WIDE);
		expect(rawLineWith(focused, OTHER_OPTION)).not.toEqual(rawLineWith(notFocused, OTHER_OPTION));
	});

	it("paints the Done row with the focus color when it is the focus target (canonicalCursor = n+1)", () => {
		const palette = resolvePalette({ isLight: false, colorMode: "truecolor" });
		const focused = renderSelectView(multiVm({ focusIndex: DONE_INDEX }), WIDE);
		expect(rolePaintsText(rawLineWith(focused, DONE_OPTION), DONE_OPTION, palette.fgCode("focusLabel"))).toBe(true);
		const notFocused = renderSelectView(multiVm({ focusIndex: 0 }), WIDE);
		expect(rawLineWith(focused, DONE_OPTION)).not.toEqual(rawLineWith(notFocused, DONE_OPTION));
	});

	it("keeps every render invariant while a control row holds focus (RESET termination, no size seq, height)", () => {
		for (const env of [WIDE, SMALL, asLight(WIDE)]) {
			for (const focusIndex of [OTHER_INDEX, DONE_INDEX]) {
				const lines = renderSelectView(multiVm({ focusIndex }), env);
				expect(lines.length, `control focus ${focusIndex} height`).toBeLessThanOrEqual(env.rows);
				const out = lines.join("\n");
				for (const line of lines) {
					expect(terminatesStyling(line), `color bleed on control focus ${focusIndex}`).toBe(true);
				}
				for (const { name, seq } of SIZE_SEQUENCES) {
					expect(out.includes(seq), `${name} on control focus ${focusIndex}`).toBe(false);
				}
			}
		}
	});
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Cross-cutting: role coverage, pairwise distinction, RESET termination, determinism, mode resolution
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("palette coverage, pairwise distinction, styling termination and render determinism", () => {
	it("exercises all nine palette roles across the browse + chat views", () => {
		expect(PALETTE_ROLES.length).toBe(9);
		const outputs = allOutputs(WIDE); // dark truecolor
		for (const role of PALETTE_ROLES) {
			const fg = resolvePalette({ isLight: false, colorMode: "truecolor" }).fgCode(role);
			const covered = outputs.some(out => usesRoleColor(out, fg));
			expect(covered, `role ${role} (${fg}) must appear in some render`).toBe(true);
		}
	});

	it("keeps all nine roles pairwise-distinct in every mode × theme (no accent collapse)", () => {
		for (const isLight of [false, true]) {
			for (const colorMode of ["truecolor", "256color"] as const) {
				const p = resolvePalette({ isLight, colorMode });
				const codes = PALETTE_ROLES.map(r => p.fgCode(r));
				expect(new Set(codes).size, `pairwise-distinct (${colorMode}, ${isLight ? "light" : "dark"})`).toBe(
					PALETTE_ROLES.length,
				);
			}
		}
	});

	it("RESET-terminates every styled line so no color bleeds past a line end (all views/themes/focus)", () => {
		for (const env of [WIDE, SMALL, asLight(WIDE), asLight(SMALL)]) {
			const renders: string[][] = [];
			for (let f = -1; f <= DONE_INDEX; f++) renders.push(renderSelectView(multiVm({ focusIndex: f }), env));
			renders.push(renderChatPanel(chatComplete(), env));
			renders.push(renderChatPanel(chatError(), env));
			for (const lines of renders) {
				for (const line of lines) {
					expect(terminatesStyling(line), `color bleed: ${JSON.stringify(stripAnsi(line)).slice(0, 48)}`).toBe(true);
				}
			}
		}
	});

	it("is pure/deterministic: identical input yields byte-identical output", () => {
		const a = renderSelectView(selectVm({ focusIndex: 2, descriptionScroll: 1 }), SMALL);
		const b = renderSelectView(selectVm({ focusIndex: 2, descriptionScroll: 1 }), SMALL);
		expect(a).toEqual(b);
		const c = renderChatPanel(chatComplete(), WIDE);
		const d = renderChatPanel(chatComplete(), WIDE);
		expect(c).toEqual(d);
	});

	it("resolves a palette for each canonical color mode without throwing", () => {
		const modes: ColorMode[] = ["truecolor", "256color"];
		for (const colorMode of modes) {
			for (const isLight of [false, true]) {
				const palette: Palette = resolvePalette({ isLight, colorMode });
				expect(palette.isLight).toBe(isLight);
				expect(palette.colorMode).toBe(colorMode);
				expect(typeof palette.fgCode("questionTitle")).toBe("string");
			}
		}
	});
});
