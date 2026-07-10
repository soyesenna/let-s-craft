import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "../src/cli.ts";

test("cli: dispatches to capitalize", () => {
	assert.deepEqual(run(["capitalize", "hello", "world"]), { output: "Hello World", exitCode: 0 });
});

test("cli: dispatches to truncate", () => {
	assert.deepEqual(run(["truncate", "5", "hello world"]), { output: "hell…", exitCode: 0 });
});

test("cli: reports an error for an unknown command", () => {
	const result = run(["nope"]);
	assert.equal(result.exitCode, 1);
	assert.match(result.output, /Unknown command/);
});
