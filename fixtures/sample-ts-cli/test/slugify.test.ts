import assert from "node:assert/strict";
import { test } from "node:test";
import { slugify } from "../src/slugify.ts";

test("slugify: lowercases input", () => {
	assert.equal(slugify("HELLO"), "hello");
});

test("slugify: collapses consecutive separators and trims leading/trailing hyphens", () => {
	// Intentionally failing — see the bug note in src/slugify.ts. This is the craft-loop
	// fixture's target failure: fixing it (collapse runs of non-alphanumeric chars into
	// a single hyphen, then trim the ends) should make this test pass.
	assert.equal(slugify("Hello   World!!!"), "hello-world");
});

test("slugify: leaves an already-clean slug unchanged", () => {
	assert.equal(slugify("already-clean"), "already-clean");
});
