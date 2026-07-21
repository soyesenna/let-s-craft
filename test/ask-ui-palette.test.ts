// U6 — palette role -> ANSI SGR INVARIANTS (9 roles, isLight adaptation, 256 derived from 24-bit).
//
// Scope: the Node-safe pure `src/ask-ui/palette.ts` (+ its role vocabulary in types.ts), per the
// render-surface contract (TesterSnapshot SSOT). This file owns the *unit* palette contract (U6);
// TesterSnapshot's ask-ui-snapshot.test.ts owns the structural render invariants. No overlap.
//
// ORACLE POLICY (D4 re-ratification, ask-ui-wiring-contract-v2 §6): exact RGB / ANSI byte values are
// NON-contract — the palette is craft-tunable. This file therefore asserts ONLY test-owned
// INVARIANTS and NEVER re-reads production ROLE_TABLE as the oracle for a color VALUE ("value X is
// correct"). A role->attribute lookup for ATTRIBUTE self-consistency is still allowed (§6); a
// role->color lookup used to justify a color value is not. Concretely the invariants are:
//   (1) exactly the 9 hierarchy roles exist and every role resolves in both modes;
//   (2) fgCode format is well-formed (truecolor 38;2;R;G;B / 256 38;5;N);
//   (3) the 9 roles are pairwise-distinct per mode (no accidental color collapse / table shift);
//   (4) the 256 column is a SINGLE deterministic function of the mode's OWN 24-bit output
//       (rgbToXterm256 of the truecolor rgb) — never a second hardcoded table;
//   (5) light != dark adaptation (the body role adapts for contrast, the palette is not mode-blind);
//   (6) attribute -> SGR self-consistency + the declared weight/emphasis hierarchy;
//   (7) sgr / paint / RESET assembly terminates every painted run.
//
// EXPECTED STATE: RED — `../src/ask-ui/palette` and `../src/ask-ui/types` do not exist until PR2. The
// import failure is the correct pre-craft signal, not a defect in this file.
import { describe, expect, it } from "vitest";
import { RESET, ROLE_TABLE, resolvePalette, rgbToXterm256, type Palette } from "../src/ask-ui/palette";
import { PALETTE_ROLES, type PaletteRole } from "../src/ask-ui/types";

// The 9 roles the hierarchy is built from (appendix-palette §1). These names ARE the contract
// (render-model + snapshots key off them); RGB / 256 values are NOT (D4).
const EXPECTED_ROLES: readonly PaletteRole[] = [
	"questionTitle",
	"optionLabel",
	"focusLabel",
	"description",
	"footer",
	"chatQuestion",
	"chatAnswer",
	"error",
	"border",
];

// Parse an "38;2;R;G;B" foreground code back into its channels. The rgb SOURCE here is the palette's
// OWN truecolor output — deliberately not ROLE_TABLE — so the 256-derivation invariant below is an
// internal-consistency check, not an oracle mirror.
function parseTruecolorRgb(fgCode: string): [number, number, number] {
	const m = /^38;2;(\d{1,3});(\d{1,3});(\d{1,3})$/.exec(fgCode);
	if (!m) throw new Error(`not a truecolor fg code: ${JSON.stringify(fgCode)}`);
	return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// Split an opening SGR sequence "\x1b[<params>m" into its attribute params (those BEFORE the 38
// color introducer). Checking attrs before "38" avoids false positives when an RGB channel is 1/3/7.
function attrParams(seq: string): string[] {
	const m = /\x1b\[([0-9;]*)m/.exec(seq);
	const params = m && m[1].length > 0 ? m[1].split(";") : [];
	const i = params.indexOf("38");
	return i === -1 ? params : params.slice(0, i);
}

const darkTrue = (): Palette => resolvePalette({ isLight: false, colorMode: "truecolor" });
const lightTrue = (): Palette => resolvePalette({ isLight: true, colorMode: "truecolor" });
const dark256 = (): Palette => resolvePalette({ isLight: false, colorMode: "256color" });
const light256 = (): Palette => resolvePalette({ isLight: true, colorMode: "256color" });

// ---------------------------------------------------------------------------
// (1) Role vocabulary — exactly the 9 hierarchy roles, each resolvable in both modes
// ---------------------------------------------------------------------------

describe("palette role vocabulary (U6, AC5.1)", () => {
	it("declares exactly the 9 hierarchy roles", () => {
		expect([...PALETTE_ROLES].sort()).toEqual([...EXPECTED_ROLES].sort());
		expect(PALETTE_ROLES).toHaveLength(9);
	});

	it("resolves every role to a foreground code in both dark and light modes", () => {
		const d = darkTrue();
		const l = lightTrue();
		for (const role of PALETTE_ROLES) {
			expect(typeof d.fgCode(role)).toBe("string");
			expect(d.fgCode(role).length).toBeGreaterThan(0);
			expect(typeof l.fgCode(role)).toBe("string");
			expect(l.fgCode(role).length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// (2) fgCode format — well-formed SGR foreground per color mode (NOT the exact value)
// ---------------------------------------------------------------------------

describe("fgCode format is a well-formed SGR foreground (U6, AC5.1/AC5.2)", () => {
	it("emits a 24-bit 38;2;R;G;B foreground for every role in truecolor mode", () => {
		for (const p of [darkTrue(), lightTrue()]) {
			for (const role of PALETTE_ROLES) {
				expect(p.fgCode(role)).toMatch(/^38;2;\d{1,3};\d{1,3};\d{1,3}$/);
				for (const ch of parseTruecolorRgb(p.fgCode(role))) {
					expect(ch).toBeGreaterThanOrEqual(0);
					expect(ch).toBeLessThanOrEqual(255);
				}
			}
		}
	});

	it("emits a 256-index 38;5;N foreground for every role in 256color mode", () => {
		for (const p of [dark256(), light256()]) {
			for (const role of PALETTE_ROLES) {
				expect(p.fgCode(role)).toMatch(/^38;5;\d{1,3}$/);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// (3) Pairwise distinction — the 9 roles never collapse to the same color (per mode)
// ---------------------------------------------------------------------------

describe("the 9 roles are pairwise-distinct per mode (U6, AC5.1)", () => {
	// A single collapsed pair (accidental table shift, two roles tuned to the same color, or a 256
	// approximation that merges two cells) destroys the visual hierarchy — catch it directly.
	const distinctFor = (p: Palette): void => {
		const codes = PALETTE_ROLES.map(r => p.fgCode(r));
		expect(new Set(codes).size).toBe(PALETTE_ROLES.length);
	};

	it("has 9 distinct foregrounds in dark truecolor", () => distinctFor(darkTrue()));
	it("has 9 distinct foregrounds in light truecolor", () => distinctFor(lightTrue()));
	it("keeps the 9 roles distinct after the 256 approximation (dark)", () => distinctFor(dark256()));
	it("keeps the 9 roles distinct after the 256 approximation (light)", () => distinctFor(light256()));
});

// ---------------------------------------------------------------------------
// (4) 256 derivation — a SINGLE deterministic function of the mode's OWN 24-bit output
// ---------------------------------------------------------------------------

describe("256-color fgCode is rgbToXterm256 of the SAME rgb the truecolor mode emits (U6, AC5.2)", () => {
	it("derives every dark 256 index from the dark truecolor rgb (no second hardcoded table)", () => {
		const t = darkTrue();
		const p = dark256();
		for (const role of PALETTE_ROLES) {
			const [r, g, b] = parseTruecolorRgb(t.fgCode(role));
			expect(p.fgCode(role)).toBe(`38;5;${rgbToXterm256(r, g, b)}`);
		}
	});

	it("derives every light 256 index from the light truecolor rgb", () => {
		const t = lightTrue();
		const p = light256();
		for (const role of PALETTE_ROLES) {
			const [r, g, b] = parseTruecolorRgb(t.fgCode(role));
			expect(p.fgCode(role)).toBe(`38;5;${rgbToXterm256(r, g, b)}`);
		}
	});
});

describe("rgbToXterm256 is a deterministic in-range approximation (U6, AC5.2)", () => {
	it("returns an integer xterm-256 index in [0,255] for any rgb", () => {
		for (const [r, g, b] of [
			[0, 0, 0],
			[255, 255, 255],
			[230, 195, 148],
			[59, 63, 68],
			[255, 107, 107],
		] as const) {
			const idx = rgbToXterm256(r, g, b);
			expect(Number.isInteger(idx)).toBe(true);
			expect(idx).toBeGreaterThanOrEqual(0);
			expect(idx).toBeLessThanOrEqual(255);
		}
	});

	it("is stable — the same rgb always maps to the same index", () => {
		expect(rgbToXterm256(230, 195, 148)).toBe(rgbToXterm256(230, 195, 148));
	});

	it("orders black below white (rejects a constant/broken approximation)", () => {
		expect(rgbToXterm256(0, 0, 0)).toBeLessThan(rgbToXterm256(255, 255, 255));
	});

	it("maps clearly distinct colors to distinct indices (a saturated red vs a mid gray)", () => {
		expect(rgbToXterm256(220, 40, 40)).not.toBe(rgbToXterm256(120, 125, 130));
	});
});

// ---------------------------------------------------------------------------
// (5) isLight adaptation — the palette is not mode-blind; the body role adapts for contrast
// ---------------------------------------------------------------------------

describe("isLight adaptation (U6, AC5.2)", () => {
	it("adapts the description (body) fg between dark and light for contrast", () => {
		expect(darkTrue().fgCode("description")).not.toBe(lightTrue().fgCode("description"));
	});

	it("is not mode-blind — the light palette differs from the dark palette across the role set", () => {
		const dark = PALETTE_ROLES.map(r => darkTrue().fgCode(r));
		const light = PALETTE_ROLES.map(r => lightTrue().fgCode(r));
		expect(dark).not.toEqual(light);
	});
});

// ---------------------------------------------------------------------------
// (6) Attribute -> SGR self-consistency + the declared weight/emphasis hierarchy (AC5.1)
// ---------------------------------------------------------------------------

describe("sgr reflects each role's declared attributes (U6, AC5.1)", () => {
	// Self-consistency: the emitted SGR must carry exactly the bold/italic/reverse the role DECLARES.
	// This is an attribute lookup (allowed under D4), not a color-value mirror.
	it("mirrors each role's declared bold/italic/reverse into its opening SGR (both modes)", () => {
		for (const [p, mode] of [
			[darkTrue(), "dark"],
			[lightTrue(), "light"],
		] as const) {
			for (const role of PALETTE_ROLES) {
				const attrs = attrParams(p.sgr(role));
				const style = ROLE_TABLE[role][mode];
				expect(attrs.includes("1")).toBe(Boolean(style.bold));
				expect(attrs.includes("3")).toBe(Boolean(style.italic));
				expect(attrs.includes("7")).toBe(Boolean(style.reverse));
			}
		}
	});

	it("pins the visual hierarchy: bold title/label/error, italic chat echo, plain body", () => {
		const p = darkTrue();
		expect(attrParams(p.sgr("questionTitle"))).toContain("1"); // title is bold
		expect(attrParams(p.sgr("optionLabel"))).toContain("1"); // option labels are bold
		expect(attrParams(p.sgr("error"))).toContain("1"); // error is bold
		expect(attrParams(p.sgr("chatQuestion"))).toContain("3"); // echoed question is italic
		expect(attrParams(p.sgr("description"))).not.toContain("1"); // body stays normal weight
	});

	it("makes the focused option label visually distinct from a plain option label", () => {
		const p = darkTrue();
		expect(p.sgr("focusLabel")).not.toBe(p.sgr("optionLabel"));
		expect(attrParams(p.sgr("focusLabel"))).toContain("7"); // reverse-video accent per appendix §1
	});
});

// ---------------------------------------------------------------------------
// (7) sgr / paint / RESET assembly — every painted run is terminated
// ---------------------------------------------------------------------------

describe("sgr / paint / RESET assembly (U6, AC5.1)", () => {
	it("wraps fgCode into a complete opening SGR sequence", () => {
		const p = darkTrue();
		const seq = p.sgr("questionTitle");
		expect(seq.startsWith("\x1b[")).toBe(true);
		expect(seq.endsWith("m")).toBe(true);
		expect(seq).toContain(p.fgCode("questionTitle"));
	});

	it("paints text as sgr(role) + text + RESET", () => {
		const p = darkTrue();
		expect(p.paint("chatAnswer", "hello")).toBe(`${p.sgr("chatAnswer")}hello${RESET}`);
	});

	it("always terminates painted text with the reset sequence", () => {
		expect(darkTrue().paint("error", "boom").endsWith(RESET)).toBe(true);
		expect(RESET).toBe("\x1b[0m");
	});
});
