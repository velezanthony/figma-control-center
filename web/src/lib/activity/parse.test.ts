import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseEvent } from "./parse.ts";

const event = {
	v: 1,
	at: "t",
	sessionId: "s",
	type: "tool_called",
	callId: "a",
	tool: "x",
	args: {},
};

describe("parseEvent", () => {
	it("aceptan eventos con la forma del contrato", () => {
		assert.deepEqual(parseEvent(JSON.stringify(event)), event);
	});

	it("descartan basura sin lanzar", () => {
		assert.equal(parseEvent("no json"), null);
		assert.equal(parseEvent('{"type":3}'), null);
	});
});
