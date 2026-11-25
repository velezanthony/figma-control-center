import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DEFAULT_FILTERS, hasActiveFilters, STATUS_FILTER } from "./filters.ts";

describe("hasActiveFilters", () => {
	it("detecta cualquier filtro distinto del de por defecto", () => {
		assert.equal(hasActiveFilters(DEFAULT_FILTERS), false);
		assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, query: "  " }), false);
		assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, query: "x" }), true);
		assert.equal(
			hasActiveFilters({ ...DEFAULT_FILTERS, status: STATUS_FILTER.error }),
			true,
		);
		assert.equal(hasActiveFilters({ ...DEFAULT_FILTERS, tool: "t" }), true);
		assert.equal(
			hasActiveFilters({ ...DEFAULT_FILTERS, sessionId: "s" }),
			true,
		);
	});
});
