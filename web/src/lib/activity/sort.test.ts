import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DEFAULT_SORT, SORT_KEY, toggleSort } from "./sort.ts";

describe("toggleSort", () => {
	it("la misma columna invierte la dirección", () => {
		assert.deepEqual(
			toggleSort({ key: SORT_KEY.tool, dir: "asc" }, SORT_KEY.tool),
			{ key: SORT_KEY.tool, dir: "desc" },
		);
		assert.deepEqual(
			toggleSort({ key: SORT_KEY.tool, dir: "desc" }, SORT_KEY.tool),
			{ key: SORT_KEY.tool, dir: "asc" },
		);
	});

	it("otra columna empieza ascendente", () => {
		assert.deepEqual(toggleSort(DEFAULT_SORT, SORT_KEY.duration), {
			key: SORT_KEY.duration,
			dir: "asc",
		});
	});
});
