#!/usr/bin/env node
// sample-ts-cli — a tiny string-utility CLI: slugify / capitalize / truncate.
import { slugify } from "./slugify.ts";
import { capitalize, truncate } from "./text-utils.ts";

function usage(): string {
	return "Usage: strutil <slugify|capitalize|truncate> <args...>";
}

export function run(argv: string[]): { output: string; exitCode: number } {
	const [command, ...rest] = argv;
	switch (command) {
		case "slugify":
			return { output: slugify(rest.join(" ")), exitCode: 0 };
		case "capitalize":
			return { output: capitalize(rest.join(" ")), exitCode: 0 };
		case "truncate": {
			const maxLength = Number(rest[0]);
			if (!Number.isFinite(maxLength)) return { output: `truncate requires a numeric length. ${usage()}`, exitCode: 1 };
			return { output: truncate(rest.slice(1).join(" "), maxLength), exitCode: 0 };
		}
		default:
			return { output: `Unknown command: ${command ?? "(none)"}. ${usage()}`, exitCode: 1 };
	}
}

// Only execute when run directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
	const { output, exitCode } = run(process.argv.slice(2));
	if (exitCode === 0) console.log(output);
	else console.error(output);
	process.exitCode = exitCode;
}
