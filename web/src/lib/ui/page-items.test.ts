import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { GAP, pageItems } from "./page-items.ts";

describe("pageItems (1 … n-1 [n] n+1 … total)", () => {
	it("con pocas páginas las muestra todas", () => {
		assert.deepEqual(pageItems(1, 1), [1]);
		assert.deepEqual(pageItems(2, 5), [1, 2, 3, 4, 5]);
	});

	it("en medio deja huecos a ambos lados de la actual y sus vecinas", () => {
		assert.deepEqual(pageItems(10, 20), [1, GAP, 9, 10, 11, GAP, 20]);
	});

	it("un hueco de una sola página se rellena con ella", () => {
		assert.deepEqual(pageItems(4, 20), [1, 2, 3, 4, 5, GAP, 20]);
		assert.deepEqual(pageItems(17, 20), [1, GAP, 16, 17, 18, 19, 20]);
	});

	it("en los extremos solo hay un hueco", () => {
		assert.deepEqual(pageItems(1, 20), [1, 2, GAP, 20]);
		assert.deepEqual(pageItems(20, 20), [1, GAP, 19, 20]);
	});
});
