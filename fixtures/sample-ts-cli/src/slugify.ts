/**
 * Convert arbitrary text into a URL-friendly slug: lowercase, non-alphanumeric runs
 * replaced with a single hyphen, leading/trailing hyphens trimmed.
 *
 * NOTE (intentional bug, used by the lets-craft craft-loop fixture): this
 * implementation replaces each non-alphanumeric character individually instead of
 * collapsing consecutive separators, and never trims the result — so
 * `slugify("Hello   World!!!")` currently produces `"hello---world---"` instead of
 * the expected `"hello-world"`. See test/slugify.test.ts.
 */
export function slugify(input: string): string {
	return input.toLowerCase().replace(/[^a-z0-9]/g, "-");
}
