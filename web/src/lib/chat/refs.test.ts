import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { splitRefs } from "./refs.ts";

const CALL = "3f9d5c00-aaaa-4bbb-8ccc-0123456789ab";

describe("splitRefs: ids de nodo y de llamada dentro de un texto", () => {
	it("un texto sin ids queda como un único trozo de texto", () => {
		assert.deepEqual(splitRefs("nada que enlazar", false), [
			{ t: "text", text: "nada que enlazar" },
		]);
	});

	it("un id de nodo en prosa se separa del texto que lo rodea", () => {
		assert.deepEqual(splitRefs("Se tocó el nodo 1234:5678 después.", false), [
			{ t: "text", text: "Se tocó el nodo " },
			{ t: "node", id: "1234:5678" },
			{ t: "text", text: " después." },
		]);
	});

	it("un id de llamada (UUID) en prosa se separa del texto", () => {
		assert.deepEqual(splitRefs(`Falló la llamada ${CALL}.`, false), [
			{ t: "text", text: "Falló la llamada " },
			{ t: "call", id: CALL },
			{ t: "text", text: "." },
		]);
	});

	it("varios ids en el mismo texto se separan todos y en orden", () => {
		const parts = splitRefs(`1234:5678, 456:789 y ${CALL}`, false);
		assert.deepEqual(
			parts.filter((p) => p.t !== "text"),
			[
				{ t: "node", id: "1234:5678" },
				{ t: "node", id: "456:789" },
				{ t: "call", id: CALL },
			],
		);
	});

	it("una hora en prosa no es un nodo: «a las 11:59» ni «12:00:24»", () => {
		for (const text of [
			"a las 11:59 se paró",
			"a las 12:00:24 se paró",
			"de 9:05 a 17:30",
		]) {
			assert.deepEqual(splitRefs(text, false), [{ t: "text", text }], text);
		}
	});

	it("dentro de código en línea, un id con pinta de hora sí es un nodo (el usuario lo marcó como código)", () => {
		assert.deepEqual(splitRefs("1:23", true), [{ t: "node", id: "1:23" }]);
	});

	it("un id de instancia de Figma («I12:3;45:6») es un solo nodo", () => {
		assert.deepEqual(splitRefs("I12:3;45:6", true), [
			{ t: "node", id: "I12:3;45:6" },
		]);
	});

	it("un trozo más largo que no es un id no se parte: versiones, rutas y hex", () => {
		for (const text of [
			"v1:2:3",
			"abc123:456",
			"a3f9d5c00-aaaa-4bbb-8ccc-0123456789abc",
		]) {
			assert.deepEqual(splitRefs(text, true), [{ t: "text", text }], text);
		}
	});
});
