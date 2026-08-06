import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Regression guard for the provider-usage-status-bar subsystem.
 *
 * It defends two invariants that keep the NEW `src/statusbar/` module from breaking the EXISTING
 * plugin:
 *
 *   1. Additive registration — `src/main.ts`'s `export default function (pi)` still calls every
 *      existing tool/command registrar AND still installs the preset `session_start` handler; the
 *      statusbar is wired in as ONE additional `registerUsageStatusBar(pi)` call, never as a
 *      substitution. That registrar installs its OWN handlers (a second `session_start`, plus a
 *      shortcut + slash command) through the additive host APIs (`pi.on`, `pi.registerShortcut`,
 *      `pi.registerCommand`). The host stores handlers array-per-event (plan §3 / loader.d.ts:28),
 *      so the second `session_start` coexists with the preset one rather than replacing it.
 *   2. Module isolation — nothing outside `src/statusbar/` imports from it EXCEPT `src/main.ts`,
 *      and main.ts reaches it only through the public entry `./statusbar/index.js`.
 *   3. Runtime dependency — `package.json` declares `@oh-my-pi/pi-ai` as a DIRECT dependency pinned
 *      to `17.0.5` (plan §3 F8 / DR-C). The first runtime VALUE import (`resolveUsedFraction` from
 *      `@oh-my-pi/pi-ai/usage`) needs the package present at install time in a real omp; the exact
 *      pin keeps that value surface from drifting off the compiled type surface (the transitive
 *      `@oh-my-pi/pi-coding-agent` pin). Leaning on the transitive dep is a regression.
 *   4. No direct outbound I/O anywhere under `src/statusbar/` — AC8 ("no provider HTTP / no token")
 *      is a WHOLE-plugin contract, not just gather's: no `fetch`, URL construction, socket, HTTP
 *      client import, or raw credential-token field (`accessToken`/`refreshToken`/`apiKey`). Usage
 *      data enters ONLY through the injected `authStorage` port; accounts carry the credential's
 *      `{ type }` flag and nothing else.
 *   5. Value-import boundary — the two Bun-only omp VALUE imports live EXACTLY in `index.ts`:
 *      `resolveUsedFraction` (`@oh-my-pi/pi-ai/usage`) + `matchesKey` (`@oh-my-pi/pi-tui`), nothing
 *      more. (That the four PURE modules stay value-import-free needs no assertion here: a value
 *      import in any of them makes its OWN unit suite fail to load under vitest-on-Node — DR-C.)
 *
 * WHY this suite is STRUCTURAL (static import-graph / registration-surface analysis) instead of
 * behavioral: once craft wires it, `src/main.ts` transitively imports `src/statusbar/index.ts`,
 * which VALUE-imports `@oh-my-pi/pi-ai/usage` and `@oh-my-pi/pi-tui`. The `import` condition of
 * those packages resolves to TypeScript *source* (they ship no runtime `.js`), which Node/vitest
 * cannot execute (plan §1 / DR-C). Neither `main.ts` nor `statusbar/index.ts` can therefore be
 * imported under vitest-on-Node — this is exactly why no unit test in the plugin imports `main.ts`
 * and why live registration is exercised e2e (plan §9, Gate 0/1). The strongest pure-vitest
 * regression assertion is thus over the modules' static import + `pi`-registration surface, read
 * from source. (This is dependency-graph / registration-surface analysis, not a source-text
 * snapshot: it asserts *which modules depend on which* and *which host hooks a module installs*.)
 *
 * Currently RED by design: `src/statusbar/`, the `main.ts` wiring, and the `@oh-my-pi/pi-ai`
 * dependency do not exist yet — craft adds them per plan §3/§4/§5. Every assertion here PASSES once
 * craft implements to the plan; a genuine regression (a foreign statusbar import, a dropped/replaced
 * existing registrar, the preset handler being clobbered, the registrar failing to install its own
 * hooks, a dropped/loosened `pi-ai` pin, direct provider I/O or a leaked token field under
 * `src/statusbar/`, or an unexpected omp value import) turns it RED again.
 */

function findRepoRoot(start: string): string {
	// Robust to both the runtime location (the file is synced into <worktree>/test/, so src/ is one
	// level up) and any nested location: ascend until we hit the plugin root (the dir with src/main.ts).
	let dir = start;
	for (let depth = 0; depth < 16; depth++) {
		if (existsSync(join(dir, "src", "main.ts"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(`could not locate the plugin root (a directory containing src/main.ts) at or above ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");
const MAIN = join(SRC, "main.ts");
const STATUSBAR_DIR = join(SRC, "statusbar");
const INDEX_TS = join(STATUSBAR_DIR, "index.ts");

// The registration surface main.ts must keep wiring after the statusbar is added. Derived from the
// current main.ts; a regression would be craft dropping or replacing any of these.
const EXISTING_REGISTRARS = [
	"registerFlag",
	"registerPresetCommand",
	"registerCraftInitTool",
	"registerRunTestsTool",
	"registerCraftStateResets",
	"registerAskTools",
	"registerCraftAbortTool",
] as const;

// ── Manifest / I/O structural invariants (M5) ───────────────────────────────
// The runtime value import needs the package present AND pinned (plan §3 F8 / DR-C).
const PI_AI_PACKAGE = "@oh-my-pi/pi-ai";
const PI_AI_PIN = "17.0.5";

// AC8 is a WHOLE-subsystem contract: no file under src/statusbar/ may reach the network
// directly. Matched over comment-stripped source; conformant display-only code has none of these.
const FORBIDDEN_IO_PATTERNS: Array<{ label: string; re: RegExp }> = [
	{ label: "globalThis.fetch", re: /\bglobalThis\s*\.\s*fetch\b/ },
	{ label: "fetch() call", re: /\bfetch\s*\(/ },
	{ label: "new URL()", re: /\bnew\s+URL\s*\(/ },
	{ label: "new URLSearchParams()", re: /\bnew\s+URLSearchParams\s*\(/ },
	{ label: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
	{ label: "WebSocket", re: /\bWebSocket\b/ },
	{ label: "EventSource", re: /\bEventSource\b/ },
];

// Raw credential/token fields (live at runtime on StoredAuthCredential.credential — plan §3:75).
// The pure gather reads ONLY credential.type; touching any of these would be a token leak.
const FORBIDDEN_TOKEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
	{ label: ".accessToken", re: /\.\s*accessToken\b/ },
	{ label: ".refreshToken", re: /\.\s*refreshToken\b/ },
	{ label: ".apiKey", re: /\.\s*apiKey\b/ },
	{ label: 'indexed ["accessToken"|"refreshToken"|"apiKey"|"secret"]', re: /\[\s*["'](?:accessToken|refreshToken|apiKey|secret)["']\s*\]/ },
];

// HTTP-client / raw-socket modules a display-only reader has no business importing.
const FORBIDDEN_IMPORT_MODULES: string[] = [
	"http", "https", "http2", "net", "tls", "dgram",
	"node:http", "node:https", "node:http2", "node:net", "node:tls", "node:dgram",
	"axios", "undici", "node-fetch", "cross-fetch", "got", "superagent", "ky", "phin", "needle", "request",
];

// The EXACT omp VALUE-import surface of the subsystem — both live in index.ts (plan §6 Step 5 / DR-C).
const OMP_VALUE_IMPORT_ALLOWLIST = [
	"matchesKey from @oh-my-pi/pi-tui",
	"resolveUsedFraction from @oh-my-pi/pi-ai/usage",
] as const;

function stripComments(source: string): string {
	// Remove block comments, then line comments (the `[^:]` guard leaves `://` in URLs intact) so a
	// commented-out import or registration is never counted as present. Shared by every parser below,
	// which is why it is a named seam rather than inlined.
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walkTsFiles(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walkTsFiles(full, acc);
		else if (entry.isFile() && entry.name.endsWith(".ts")) acc.push(full);
	}
	return acc;
}

function importSpecifiers(source: string): string[] {
	const clean = stripComments(source);
	const specs: string[] = [];
	for (const m of clean.matchAll(/\bfrom\s*["']([^"']+)["']/g)) specs.push(m[1]);
	for (const m of clean.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
	for (const m of clean.matchAll(/\bimport\s+["']([^"']+)["']/g)) specs.push(m[1]);
	return specs;
}

function importDeclarations(source: string): Array<{ clause: string; from: string }> {
	const clean = stripComments(source);
	const decls: Array<{ clause: string; from: string }> = [];
	for (const m of clean.matchAll(/\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
		decls.push({ clause: m[1].trim(), from: m[2] });
	}
	return decls;
}

function registerCallees(source: string): Set<string> {
	const callees = new Set<string>();
	for (const m of stripComments(source).matchAll(/\b(register[A-Za-z0-9_]+)\s*\(/g)) callees.add(m[1]);
	return callees;
}

function piEvents(source: string): string[] {
	const events: string[] = [];
	for (const m of stripComments(source).matchAll(/\bpi\.on\s*\(\s*["']([^"']+)["']/g)) events.push(m[1]);
	return events;
}

function piMethods(source: string): Set<string> {
	const methods = new Set<string>();
	for (const m of stripComments(source).matchAll(/\bpi\.([A-Za-z0-9_]+)\s*\(/g)) methods.add(m[1]);
	return methods;
}

function isStatusbarSpecifier(spec: string): boolean {
	return /(^|\/)statusbar\//.test(spec);
}

// index.ts's @oh-my-pi/* VALUE imports (type-only imports are erased and excluded), each as a
// sorted "name from module" string — the allowlist test compares against exactly this.
function ompValueImportBindings(source: string): string[] {
	const bindings: string[] = [];
	for (const m of stripComments(source).matchAll(/\bimport\s+(type\s+)?([\s\S]*?)\s+from\s*["']([^"']+)["']/g)) {
		if (m[1]) continue; // `import type …` — erased at compile, never a runtime value import
		const from = m[3];
		if (!from.startsWith("@oh-my-pi/")) continue;
		const clause = m[2].trim();
		const braced = clause.match(/\{([\s\S]*)\}/);
		if (braced) {
			for (const part of braced[1].split(",")) {
				const raw = part.trim();
				if (!raw || /^type\s/.test(raw)) continue; // inline `{ type X }` is erased too
				bindings.push(`${raw.split(/\s+as\s+/)[0].trim()} from ${from}`);
			}
		}
		const outside = clause.replace(/\{[\s\S]*\}/, " ").replace(/,/g, " ").replace(/^\*\s*as\s+/, "").trim();
		for (const tok of outside.split(/\s+/)) {
			if (tok && tok !== "*") bindings.push(`${tok} from ${from}`);
		}
	}
	return bindings.sort();
}

describe("statusbar subsystem is isolated under src/statusbar/", () => {
	it("no existing module imports from src/statusbar/* except main.ts", () => {
		const offenders: Array<{ file: string; spec: string }> = [];
		for (const file of walkTsFiles(SRC, [])) {
			if (file === MAIN) continue;
			if (file.startsWith(STATUSBAR_DIR + sep)) continue; // the subsystem's own intra-imports are fine
			for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
				if (isStatusbarSpecifier(spec)) offenders.push({ file: relative(SRC, file), spec });
			}
		}
		expect(offenders, "existing modules must not depend on the self-contained statusbar subsystem").toEqual([]);
	});

	it("main.ts reaches the statusbar only through its public entry (./statusbar/index.js)", () => {
		const statusbarImports = importSpecifiers(readFileSync(MAIN, "utf8")).filter(isStatusbarSpecifier);
		expect(
			statusbarImports.length,
			'main.ts must import from "./statusbar/index.js" — the single additive wiring point (plan §4)',
		).toBeGreaterThanOrEqual(1);
		for (const spec of statusbarImports) {
			expect(spec.replace(/\.js$/, ""), "main.ts must not reach into statusbar internals").toBe("./statusbar/index");
		}
	});
});

describe("main.ts preserves the existing registration surface and adds the statusbar additively", () => {
	it("still calls every existing tool/command registrar", () => {
		const callees = [...registerCallees(readFileSync(MAIN, "utf8"))];
		for (const name of EXISTING_REGISTRARS) {
			expect(callees, `main.ts must still call ${name}(pi) after the statusbar is added`).toContain(name);
		}
	});

	it("still installs the preset session_start handler directly in main.ts", () => {
		expect(
			piEvents(readFileSync(MAIN, "utf8")),
			"main.ts's preset session_start handler must remain (the statusbar handler is a separate, additional one)",
		).toContain("session_start");
	});

	it("wires registerUsageStatusBar(pi) as one additional registrar, imported from the statusbar entry", () => {
		const source = readFileSync(MAIN, "utf8");
		const statusbarImport = importDeclarations(source).find(d => isStatusbarSpecifier(d.from));
		expect(statusbarImport, 'main.ts must import { registerUsageStatusBar } from "./statusbar/index.js"').toBeDefined();
		expect(statusbarImport?.clause).toMatch(/\bregisterUsageStatusBar\b/);
		expect(statusbarImport?.from.replace(/\.js$/, "")).toBe("./statusbar/index");
		expect([...registerCallees(source)], "main.ts must call registerUsageStatusBar(pi)").toContain("registerUsageStatusBar");
		expect(stripComments(source), "the registerUsageStatusBar(pi) call must be wired into the default export").toMatch(
			/registerUsageStatusBar\s*\(\s*pi\s*\)/,
		);
	});
});

describe("the statusbar registrar installs its own handlers without replacing the existing ones", () => {
	const indexSource = existsSync(INDEX_TS) ? readFileSync(INDEX_TS, "utf8") : "";

	it("exists as the impure registrar entry (src/statusbar/index.ts)", () => {
		expect(existsSync(INDEX_TS), "craft must create the statusbar registrar at src/statusbar/index.ts").toBe(true);
	});

	it("subscribes its OWN session_start handler (a second one, coexisting via array storage)", () => {
		expect(
			piEvents(indexSource),
			"registerUsageStatusBar must install its own session_start handler via pi.on (additive, not a replacement)",
		).toContain("session_start");
	});

	it("installs its own shortcut + slash command via the additive pi.registerShortcut/registerCommand APIs (AC10)", () => {
		const methods = [...piMethods(indexSource)];
		expect(methods, "registerUsageStatusBar must install a keyboard shortcut (AC10)").toContain("registerShortcut");
		expect(methods, "registerUsageStatusBar must install a slash command (AC10)").toContain("registerCommand");
	});
});

describe("package.json declares the direct @oh-my-pi/pi-ai dependency the runtime value import needs (M5/F8)", () => {
	it(`declares ${PI_AI_PACKAGE} in dependencies, pinned to ${PI_AI_PIN}`, () => {
		const pkg: { dependencies?: Record<string, string> } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
		const deps = pkg.dependencies ?? {};
		expect(
			deps[PI_AI_PACKAGE],
			`the runtime value import resolveUsedFraction from "${PI_AI_PACKAGE}/usage" requires ${PI_AI_PACKAGE} as a DIRECT dependency pinned to ${PI_AI_PIN} (plan §3 F8) — not a reliance on the transitive @oh-my-pi/pi-coding-agent pin`,
		).toBe(PI_AI_PIN);
	});
});

describe("the whole src/statusbar/ subsystem performs no direct outbound I/O (AC8 — whole-plugin contract)", () => {
	const statusbarFiles = existsSync(STATUSBAR_DIR) ? walkTsFiles(STATUSBAR_DIR, []) : [];

	it("never calls fetch / constructs a URL / opens a socket connection", () => {
		expect(statusbarFiles.length, "craft must create src/statusbar/ (the AC8 scan target)").toBeGreaterThan(0);
		const offenders: Array<{ file: string; pattern: string }> = [];
		for (const file of statusbarFiles) {
			const clean = stripComments(readFileSync(file, "utf8"));
			for (const { label, re } of FORBIDDEN_IO_PATTERNS) {
				if (re.test(clean)) offenders.push({ file: relative(SRC, file), pattern: label });
			}
		}
		expect(offenders, "src/statusbar/ must read usage ONLY through the injected authStorage port — no direct HTTP/URL/socket (AC8)").toEqual([]);
	});

	it("imports no HTTP-client or raw-socket module", () => {
		expect(statusbarFiles.length, "craft must create src/statusbar/ (the AC8 scan target)").toBeGreaterThan(0);
		const offenders: Array<{ file: string; spec: string }> = [];
		for (const file of statusbarFiles) {
			for (const spec of importSpecifiers(readFileSync(file, "utf8"))) {
				if (FORBIDDEN_IMPORT_MODULES.includes(spec)) offenders.push({ file: relative(SRC, file), spec });
			}
		}
		expect(offenders, "src/statusbar/ must not import any HTTP client / raw-socket module (AC8)").toEqual([]);
	});

	it("never reads a raw credential token field (accessToken/refreshToken/apiKey) — enumerated data stays token-free", () => {
		expect(statusbarFiles.length, "craft must create src/statusbar/ (the AC8 scan target)").toBeGreaterThan(0);
		const offenders: Array<{ file: string; pattern: string }> = [];
		for (const file of statusbarFiles) {
			const clean = stripComments(readFileSync(file, "utf8"));
			for (const { label, re } of FORBIDDEN_TOKEN_PATTERNS) {
				if (re.test(clean)) offenders.push({ file: relative(SRC, file), pattern: label });
			}
		}
		expect(offenders, "src/statusbar/ must only read the credential's { type } flag — never a raw token/secret field (AC8)").toEqual([]);
	});
});

describe("the omp VALUE-import surface is exactly the two runtime values, both in index.ts (DR-C)", () => {
	const indexSource = existsSync(INDEX_TS) ? readFileSync(INDEX_TS, "utf8") : "";

	it("index.ts value-imports EXACTLY resolveUsedFraction (@oh-my-pi/pi-ai/usage) + matchesKey (@oh-my-pi/pi-tui) — nothing more", () => {
		expect(
			ompValueImportBindings(indexSource),
			"index.ts is the SOLE holder of the two Bun-only omp value imports (plan §6 Step 5); a missing, extra, or mis-pathed value import is a regression",
		).toEqual([...OMP_VALUE_IMPORT_ALLOWLIST]);
	});
});
