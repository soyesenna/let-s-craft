// Node-safe palette: role -> SGR resolution for the ask-ui readability hierarchy (U6, R1/R4/R6).
//
// ORACLE POLICY (D4): exact RGB/256 values are NON-contract (craft-tunable). The 24-bit ROLE_TABLE
// below is the SSOT; the 256-color column is a SINGLE deterministic function (rgbToXterm256) of the
// mode's OWN 24-bit output — never a second hardcoded table. The contract the tests own is the set
// of INVARIANTS (9 roles, pairwise distinct per mode, light != dark, attribute self-consistency,
// RESET termination) — see test/ask-ui-palette.test.ts + test/ask-ui-snapshot.test.ts.
import { PALETTE_ROLES, type ColorMode, type PaletteRole } from "./types.js";

export const RESET = "\x1b[0m";

interface RoleStyle {
	rgb: readonly [number, number, number];
	bold?: boolean;
	italic?: boolean;
	reverse?: boolean;
}

// SSOT: the 24-bit brand palette (appendix-palette §1), per Theme.isLight mode. The 256 column is
// DERIVED (rgbToXterm256) — never stored twice. RGB values are craft-tunable (D4); the invariants
// (distinctness in both modes, light != dark, body-text contrast direction) are the contract.
export const ROLE_TABLE: Record<PaletteRole, { dark: RoleStyle; light: RoleStyle }> = {
	questionTitle: { dark: { rgb: [230, 195, 132], bold: true }, light: { rgb: [122, 90, 0], bold: true } },
	optionLabel: { dark: { rgb: [143, 188, 230], bold: true }, light: { rgb: [0, 91, 153], bold: true } },
	focusLabel: { dark: { rgb: [245, 167, 66], bold: true, reverse: true }, light: { rgb: [178, 94, 0], bold: true, reverse: true } },
	description: { dark: { rgb: [168, 176, 184] }, light: { rgb: [72, 82, 92] } },
	footer: { dark: { rgb: [108, 117, 125] }, light: { rgb: [138, 146, 154] } },
	chatQuestion: { dark: { rgb: [127, 184, 148], italic: true }, light: { rgb: [46, 125, 79], italic: true } },
	chatAnswer: { dark: { rgb: [208, 214, 220] }, light: { rgb: [34, 40, 46] } },
	error: { dark: { rgb: [255, 107, 107], bold: true }, light: { rgb: [200, 40, 40], bold: true } },
	border: { dark: { rgb: [58, 63, 68] }, light: { rgb: [201, 205, 210] } },
};

/**
 * Deterministic in-range xterm-256 approximation of an sRGB triple: the 6x6x6 color cube (16-231)
 * for chromatic colors and the 24-step grayscale ramp (232-255) for neutral ones. A single pure
 * function of the rgb — the 256 palette column is `rgbToXterm256(<the mode's truecolor rgb>)`, so it
 * can never drift from the 24-bit SSOT (U6 invariant 4).
 */
export function rgbToXterm256(r: number, g: number, b: number): number {
	if (r === g && g === b) {
		if (r < 8) return 16;
		if (r > 248) return 231;
		return Math.round(((r - 8) / 247) * 24) + 232;
	}
	const toCube = (v: number): number => (v < 48 ? 0 : v < 115 ? 1 : Math.round((v - 35) / 40));
	return 16 + 36 * toCube(r) + 6 * toCube(g) + toCube(b);
}

export interface Palette {
	isLight: boolean;
	colorMode: ColorMode;
	/** The SGR foreground parameter run for a role ("38;2;R;G;B" truecolor / "38;5;N" 256). */
	fgCode(role: PaletteRole): string;
	/** The complete opening SGR sequence for a role (attributes + foreground): "\x1b[...m". */
	sgr(role: PaletteRole): string;
	/** Paint text with a role: sgr(role) + text + RESET. Every painted run is RESET-terminated. */
	paint(role: PaletteRole, text: string): string;
}

/** Resolve the palette for a given render environment (Theme.isLight + color capability). */
export function resolvePalette(env: { isLight: boolean; colorMode: ColorMode }): Palette {
	const modeKey = env.isLight ? "light" : "dark";

	const fgCode = (role: PaletteRole): string => {
		const [r, g, b] = ROLE_TABLE[role][modeKey].rgb;
		return env.colorMode === "256color" ? `38;5;${rgbToXterm256(r, g, b)}` : `38;2;${r};${g};${b}`;
	};

	const sgr = (role: PaletteRole): string => {
		const style = ROLE_TABLE[role][modeKey];
		const attrs: string[] = [];
		if (style.bold) attrs.push("1");
		if (style.italic) attrs.push("3");
		if (style.reverse) attrs.push("7");
		attrs.push(fgCode(role));
		return `\x1b[${attrs.join(";")}m`;
	};

	const paint = (role: PaletteRole, text: string): string => `${sgr(role)}${text}${RESET}`;

	return { isLight: env.isLight, colorMode: env.colorMode, fgCode, sgr, paint };
}

// Referencing PALETTE_ROLES keeps the role vocabulary the single source; a role added to the table
// but missing from PALETTE_ROLES (or vice versa) is caught by the palette suite's vocabulary test.
void PALETTE_ROLES;
