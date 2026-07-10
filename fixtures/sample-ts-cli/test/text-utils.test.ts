import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalize, truncate } from "../src/text-utils.ts";

test("capitalize: title-cases each word", () => {
	assert.equal(capitalize("hello world"), "Hello World");
});

test("capitalize: normalizes existing casing", () => {
	assert.equal(capitalize("hELLo WoRLD"), "Hello World");
});

test("truncate: leaves short strings untouched", () => {
	assert.equal(truncate("hi", 10), "hi");
});

test("truncate: adds an ellipsis when cut", () => {
	assert.equal(truncate("hello world", 8), "hello w…");
	assert.equal(truncate("hello world", 8).length, 8);
});
