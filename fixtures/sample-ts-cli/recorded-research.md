# Recorded external research — sample-ts-cli / slugify bug fix

> **Fixture-mode stand-in for `.lsc/crafts/{feature}/research/SYNTHESIS.md`.** This file is
> consumed verbatim by `skills/pre-craft/SKILL.md` Stage 1 step 5's fixture branch when
> `LSC_FIXTURE` is set — no live `librarian` waves are spawned against it, and its content is
> adopted as-is into `trace.md`'s "External Research Summary" section. It is deliberately
> shaped like a real `SYNTHESIS.md` (Intent / Claims with sources / Conclusion) so the E2E run
> exercises the same downstream document structure a live research pass would produce, without
> spending real time or tokens on actual web research (Phase 7 boundedness, C15↔AC7
> reconciliation). The citations below are illustrative/representative of well-known prior art
> for slug generation, not independently re-verified for this fixture.

## Intent

The feature under research is a narrow bug fix: `slugify()` in `fixtures/sample-ts-cli/src/slugify.ts`
replaces each non-alphanumeric character with its own hyphen instead of collapsing consecutive
separators into one, and never trims leading/trailing hyphens. External research here asks: is
"collapse consecutive separators + trim ends" the conventional, expected behavior for a slugify
utility, or is there a competing convention this fix should consider instead?

## Claims

1. **Collapsing consecutive separator runs into a single hyphen is the standard behavior across
   mainstream slugify implementations** — e.g. the widely-used npm package `slugify` and Django's
   `django.utils.text.slugify` both replace runs of whitespace/punctuation with one separator
   rather than one-per-character. [Source 1: npm `slugify` package README, "Multiple consecutive
   non-alphanumeric characters are collapsed into a single replacement character"] [Source 2:
   Django documentation, `django.utils.text.slugify`, "Also strips leading and trailing
   whitespace"]

2. **Trimming leading/trailing separator characters after collapsing is likewise standard** — a
   slug that starts or ends with a hyphen is considered malformed by every major implementation
   surveyed, and is typically fixed with a final `.replace(/^-+|-+$/g, "")`-style pass. [Source 1]
   [Source 3: MDN discussion of URL slug conventions — "slugs should not begin or end with a
   separator"]

3. **No competing convention was found** that intentionally preserves repeated separators or
   leading/trailing hyphens in a general-purpose slugify utility; deviations from
   collapse-and-trim are exclusively bugs reported against those same libraries, not a
   deliberate alternate design. [Source 4: representative issue-tracker pattern across
   slug-generation libraries, consistently filed as a bug and fixed to match claims 1-2]

## Conclusion

The bug-fix direction already implied by `src/slugify.ts`'s own inline note — collapse runs of
non-alphanumeric characters into a single hyphen, then trim leading/trailing hyphens — matches
established prior art for slug generation with no credible competing convention. External
research surfaces no reason to deviate from this approach; the interview/plan stages can treat
"collapse + trim" as the settled target behavior rather than an open design question.
