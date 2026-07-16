import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeFileAtomicSync } from "../src/utils/atomic-write";

const tempDirs: string[] = [];
afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

function tmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "lsc-atomic-write-"));
	tempDirs.push(dir);
	return dir;
}

describe("writeFileAtomicSync", () => {
	it("writes a new file with the exact content", () => {
		const dir = tmpDir();
		const filePath = join(dir, "state.json");

		writeFileAtomicSync(filePath, '{"a":1}');

		expect(readFileSync(filePath, "utf8")).toBe('{"a":1}');
	});

	it("overwrites an existing file with the new content", () => {
		const dir = tmpDir();
		const filePath = join(dir, "state.json");
		writeFileSync(filePath, '{"a":1}');

		writeFileAtomicSync(filePath, '{"a":2}');

		expect(readFileSync(filePath, "utf8")).toBe('{"a":2}');
	});

	it("leaves no *.tmp file behind in the directory after a successful write", () => {
		const dir = tmpDir();
		const filePath = join(dir, "state.json");

		writeFileAtomicSync(filePath, '{"a":1}');

		const leftoverTmp = readdirSync(dir).filter(name => name.endsWith(".tmp"));
		expect(leftoverTmp).toEqual([]);
	});

	it("throws when the parent directory does not exist, same as a plain writeFileSync (callers must mkdir first)", () => {
		const dir = tmpDir();
		const filePath = join(dir, "missing-subdir", "state.json");

		expect(() => writeFileAtomicSync(filePath, '{"a":1}')).toThrow();
		expect(existsSync(filePath)).toBe(false);
		// No stray tmp file left in the (nonexistent) target directory either.
		expect(existsSync(join(dir, "missing-subdir"))).toBe(false);
	});
});
