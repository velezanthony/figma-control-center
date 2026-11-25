import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	CANCEL_INIT,
	CANCEL_STATES,
	cancelBody,
	cancelHint,
	cancelStateUrl,
	shownCancelState,
} from "./cancel.ts";

describe("cancelHint", () => {
	it("solo «available» deja pulsar; cada motivo se explica con una frase", () => {
		const reasons = new Set<string>();
		for (const state of CANCEL_STATES) {
			const hint = cancelHint(state);
			assert.equal(hint.enabled, state === "available", state);
			assert.ok(hint.text.length > 20, state);
			reasons.add(hint.text);
		}
		assert.equal(reasons.size, CANCEL_STATES.length);
	});

	it("mientras no se sabe el estado, no deja pulsar y lo dice", () => {
		const hint = cancelHint(null);
		assert.equal(hint.enabled, false);
		assert.match(hint.text, /Comprobando/);
	});

	it("los motivos que no se pueden cancelar nombran la causa", () => {
		assert.match(cancelHint("finished").text, /terminó/);
		assert.match(cancelHint("notBatch").text, /lotes/);
		assert.match(cancelHint("sessionGone").text, /sesión/);
		assert.match(cancelHint("requested").text, /paso en curso/);
	});
});

describe("petición", () => {
	it("pide el estado de un job y envía el jobId en un POST JSON", () => {
		assert.equal(cancelStateUrl("job 1"), "/api/jobs/cancel?job=job%201");
		assert.equal(CANCEL_INIT.method, "POST");
		assert.equal(cancelBody("job-1"), JSON.stringify({ jobId: "job-1" }));
	});
});

describe("shownCancelState (actualización optimista)", () => {
	it("pedida la cancelación de este job, se enseña «requested» al instante aunque el servidor aún diga available o no sepa", () => {
		assert.equal(shownCancelState("available", "job-1", "job-1"), "requested");
		assert.equal(shownCancelState(null, "job-1", "job-1"), "requested");
	});

	it("lo que diga el servidor distinto de available manda sobre lo optimista (el lote ya acabó, por ejemplo)", () => {
		assert.equal(shownCancelState("finished", "job-1", "job-1"), "finished");
		assert.equal(
			shownCancelState("sessionGone", "job-1", "job-1"),
			"sessionGone",
		);
		assert.equal(shownCancelState("requested", "job-1", "job-1"), "requested");
	});

	it("la petición de otro job no cambia el estado de este", () => {
		assert.equal(shownCancelState("available", "job-2", "job-1"), "available");
		assert.equal(shownCancelState("available", null, "job-1"), "available");
	});
});
