import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { craftAuditDir, craftTestLogsDir } from "../artifacts/paths.js";
import { getActiveCraft } from "../craft/state.js";
import { type AuditVerdict, latestAuditNumber, latestRunNumber, parseAuditVerdict } from "../craft/verdict.js";
import type { RenderRow, RowSegment } from "./render.js";

// Re-exported for backward compatibility: these three were originally implemented here (QW7) and
// have since been promoted to craft/verdict.ts as the canonical location (B-1) — verdict.ts is
// shared with lsc_audit_validate's cycle-freshness check, so a duplicate implementation here would
// drift. Existing imports of these names from this module (incl. test/statusbar-craft-progress.test.ts) keep working unchanged.
export { type AuditVerdict, latestAuditNumber, latestRunNumber, parseAuditVerdict };

// ---------------------------------------------------------------------------
// QW7: a second statusbar source layered above the provider-usage table,
// surfacing craft-loop progress during a long craft session (design contract
// F-1). Mirrors the existing gather → (view-model) → render shape, but kept
// in one small file: unlike provider-usage's gather.ts, nothing here imports
// an omp runtime value that would break vitest-on-Node, so the extra file
// split isn't load-bearing here.
//
// Scope cut (this quick win only, not the full F-1 contract): when there is
// no active craft, the card is omitted entirely rather than inferring
// pre-craft/post-craft progress from artifact existence — `getActiveCraft()`
// is an in-process, main-session-only signal (no FS scan needed to answer
// "is a craft running"), which is exactly the cheap check this quick win
// wants. Extending to idle-session artifact inference is a separate,
// larger change.
// ---------------------------------------------------------------------------

export interface CraftProgressInput {
	feature: string;
	/** Highest completed test/logs/run-N.log index (0 = no run yet). */
	iteration: number;
	testsPassed: boolean;
	hasFailure: boolean;
	/** undefined when no audit exists yet, or the latest one didn't parse (fallback). */
	auditVerdict: AuditVerdict | undefined;
}

/**
 * Thin gather: the active craft comes from the in-process singleton (no FS scan); a
 * couple of small directory reads derive the iteration count and the latest audit
 * verdict. Returns undefined when there is no active craft (card omitted — see the
 * file header's scope-cut note). Never throws — the statusbar's render loop calls
 * this on every redraw (see index.ts), so any unexpected FS error (a race against a
 * directory being removed mid-craft, a permission glitch, ...) falls back to "no
 * card" for that frame rather than breaking the whole widget.
 */
export function gatherCraftProgress(): CraftProgressInput | undefined {
	try {
		const craft = getActiveCraft();
		if (!craft) return undefined;

		const root = craft.worktreeRoot ?? craft.projectRoot;

		const logsDir = craftTestLogsDir(root, craft.feature);
		const logNames = existsSync(logsDir) ? readdirSync(logsDir) : [];
		const iteration = latestRunNumber(logNames);

		const auditDir = craftAuditDir(root, craft.feature);
		const auditNames = existsSync(auditDir) ? readdirSync(auditDir) : [];
		const latestN = latestAuditNumber(auditNames);

		let auditVerdict: AuditVerdict | undefined;
		if (latestN !== undefined) {
			try {
				auditVerdict = parseAuditVerdict(readFileSync(join(auditDir, `audit-${latestN}.md`), "utf8"));
			} catch {
				auditVerdict = undefined; // fallback, never throw (QW7 scope)
			}
		}

		return {
			feature: craft.feature,
			iteration,
			testsPassed: craft.testsPassed,
			hasFailure: craft.lastFailureSummary !== undefined,
			auditVerdict,
		};
	} catch {
		return undefined;
	}
}

const NO_AUDIT = "—";

function seg(text: string, style: RowSegment["style"]): RowSegment {
	return { text, style };
}

/**
 * Render the one-line craft progress card, e.g. `⚒ craft demo · iter 3 · tests
 * failing · audit —`. Reuses render.ts's existing SegmentStyle palette (title/
 * label/header/pct-ok/pct-crit/na) so the registrar's style→theme-color table
 * needs no new entries; width degradation (clipping to the terminal width) is
 * applied by the caller via render.ts's exported `clipRow`, same as every other
 * statusbar row.
 */
export function renderCraftProgressRow(input: CraftProgressInput): RenderRow {
	const segments: RowSegment[] = [seg("⚒ craft ", "title"), seg(input.feature, "label"), seg(` · iter ${input.iteration}`, "header")];

	if (input.hasFailure) {
		segments.push(seg(" · tests failing", "pct-crit"));
	} else if (input.testsPassed) {
		segments.push(seg(" · tests passing", "pct-ok"));
	} else {
		segments.push(seg(" · tests pending", "na"));
	}

	segments.push(seg(` · audit ${input.auditVerdict ?? NO_AUDIT}`, input.auditVerdict ? "label" : "na"));

	return { segments };
}
