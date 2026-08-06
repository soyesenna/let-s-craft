import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { craftAuditDir, worktreesRootDir } from "../artifacts/paths.js";
import { getActiveCraft } from "../craft/state.js";
import { type AuditVerdict, latestAuditNumber, latestCheckNumber, parseAuditVerdict } from "../craft/verdict.js";
import type { RenderRow, RowSegment } from "./render.js";

// Re-exported for backward compatibility: these three were originally implemented here (QW7) and
// have since been promoted to craft/verdict.ts as the canonical location (B-1) — verdict.ts is
// shared with lsc_audit_validate's cycle-freshness check, so a duplicate implementation here would
// drift. Existing imports of these names from this module (incl. test/statusbar-craft-progress.test.ts) keep working unchanged.
export { type AuditVerdict, latestAuditNumber, latestCheckNumber, parseAuditVerdict };

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
	/** Sibling `.lsc/worktrees/{feature}-c*-lane-*` directory count for the active craft's audit cycle (0 = single executor, no parallel lanes this cycle). */
	laneCount: number;
	aborted: boolean;
	/** undefined when no audit exists yet, or the latest one didn't parse (fallback). */
	auditVerdict: AuditVerdict | undefined;
}

/**
 * Thin gather: the active craft comes from the in-process singleton (no FS scan); a
 * couple of small directory reads derive the lane count and the latest audit verdict.
 * Returns undefined when there is no active craft (card omitted — see the file
 * header's scope-cut note). Never throws — the statusbar's render loop calls this on
 * every redraw (see index.ts), so any unexpected FS error (a race against a directory
 * being removed mid-craft, a permission glitch, ...) falls back to "no card" for that
 * frame rather than breaking the whole widget.
 *
 * **Progress axis is executor lanes, not test status (C1).** craft is now a single-shot
 * executor run (plan §craft) with no repeating test-pass loop to report progress against —
 * `checkPassed` would be unreachable here regardless, since the deterministic check log is
 * produced by post-craft (`check/run_check.sh`, C3), which never calls `lsc_craft_init` and so
 * never has a craft session with this card rendered in the first place. Sibling lane worktree
 * directories under `.lsc/worktrees/` (readdir on the MAIN checkout, never the worktree root —
 * craft.projectRoot is always the main checkout per state.ts) are the one thing this session can
 * actually observe while craft is in flight.
 */
export function gatherCraftProgress(): CraftProgressInput | undefined {
	try {
		const craft = getActiveCraft();
		if (!craft) return undefined;

		const root = craft.worktreeRoot ?? craft.projectRoot;

		const worktreesRoot = worktreesRootDir(craft.projectRoot);
		const laneNames = existsSync(worktreesRoot) ? readdirSync(worktreesRoot) : [];
		const lanePattern = new RegExp(`^${craft.feature}-c\\d+-lane-\\d+$`);
		const laneCount = laneNames.filter(name => lanePattern.test(name)).length;

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
			laneCount,
			aborted: craft.aborted,
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
 * Render the one-line craft progress card, e.g. `⚒ craft demo · lanes 3 · audit —`
 * or `⚒ craft demo · single executor · aborted · audit APPROVE`. Reuses render.ts's
 * existing SegmentStyle palette (title/label/header/pct-ok/pct-crit/na) so the
 * registrar's style→theme-color table needs no new entries; width degradation
 * (clipping to the terminal width) is applied by the caller via render.ts's exported
 * `clipRow`, same as every other statusbar row.
 */
export function renderCraftProgressRow(input: CraftProgressInput): RenderRow {
	const segments: RowSegment[] = [seg("⚒ craft ", "title"), seg(input.feature, "label")];

	segments.push(input.laneCount > 0 ? seg(` · lanes ${input.laneCount}`, "header") : seg(" · single executor", "header"));

	if (input.aborted) {
		segments.push(seg(" · aborted", "pct-crit"));
	}

	segments.push(seg(` · audit ${input.auditVerdict ?? NO_AUDIT}`, input.auditVerdict ? "label" : "na"));

	return { segments };
}
