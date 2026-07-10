/** Title-case each whitespace-separated word: first letter upper, rest lower. */
export function capitalize(input: string): string {
	return input
		.split(/\s+/)
		.filter(Boolean)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
		.join(" ");
}

/** Truncate to at most `maxLength` characters, replacing the last character with an ellipsis when cut. */
export function truncate(input: string, maxLength: number): string {
	if (input.length <= maxLength) return input;
	if (maxLength <= 1) return input.slice(0, Math.max(0, maxLength));
	return `${input.slice(0, maxLength - 1)}…`;
}
