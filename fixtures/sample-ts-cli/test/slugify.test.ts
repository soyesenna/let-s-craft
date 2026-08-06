import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.ts";

test("slugify: lowercases input", () => {
	assert.equal(slugify("HELLO"), "hello");
});

test("slugify: leaves an already-clean slug unchanged", () => {
	assert.equal(slugify("already-clean"), "already-clean");
});
