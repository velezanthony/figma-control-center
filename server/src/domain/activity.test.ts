import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	isActivityEvent,
} from "./activity.ts";

const base = {
	v: ACTIVITY_VERSION,
	at: "2026-01-01T00:00:00.000Z",
	sessionId: "s1",
};

describe("isActivityEvent", () => {
	it("acepta un evento con la cabecera común y un tipo conocido", () => {
		assert.equal(
			isActivityEvent({ ...base, type: ACTIVITY_TYPE.toolCalled }),
			true,
		);
	});

	it("acepta un evento build_step_finished", () => {
		assert.equal(
			isActivityEvent({ ...base, type: ACTIVITY_TYPE.buildStepFinished }),
			true,
		);
	});

	it("rechaza un tipo desconocido", () => {
		assert.equal(isActivityEvent({ ...base, type: "otro" }), false);
	});

	it("rechaza otra versión del contrato", () => {
		assert.equal(
			isActivityEvent({ ...base, v: 99, type: ACTIVITY_TYPE.toolCalled }),
			false,
		);
	});

	it("rechaza lo que no es un objeto o le falta la cabecera", () => {
		assert.equal(isActivityEvent(null), false);
		assert.equal(isActivityEvent("tool_called"), false);
		assert.equal(isActivityEvent({ type: ACTIVITY_TYPE.toolCalled }), false);
		assert.equal(
			isActivityEvent({
				...base,
				sessionId: 3,
				type: ACTIVITY_TYPE.toolCalled,
			}),
			false,
		);
	});
});
