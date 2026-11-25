import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { withProject } from "./endpoints.ts";

describe("withProject", () => {
	it("añade ?project cuando la URL no tiene query", () => {
		assert.equal(withProject("/events", "ejemplo"), "/events?project=ejemplo");
	});

	it("añade &project cuando la URL ya tiene query", () => {
		assert.equal(
			withProject("/api/history/calls?page=1", "ejemplo"),
			"/api/history/calls?page=1&project=ejemplo",
		);
	});

	it("no toca la URL si no hay proyecto activo", () => {
		assert.equal(withProject("/events", null), "/events");
	});

	it("escapa el id", () => {
		assert.equal(withProject("/events", "a b"), "/events?project=a%20b");
	});
});
