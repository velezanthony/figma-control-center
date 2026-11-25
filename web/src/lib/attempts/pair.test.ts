import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultPair, resolvePair } from "./pair.ts";

const ids = (...list: number[]) => list.map((id) => ({ id }));

describe("par de intentos que se compara", () => {
	it("por defecto, el último y el anterior (antes, después)", () => {
		assert.deepEqual(defaultPair(ids(10, 11, 12)), { a: 11, b: 12 });
	});

	it("con un solo intento no hay par: solo «después»", () => {
		assert.deepEqual(defaultPair(ids(10)), { a: null, b: 10 });
	});

	it("sin intentos, nada", () => {
		assert.deepEqual(defaultPair([]), { a: null, b: null });
	});

	it("un par de la URL que está entre los intentos se respeta", () => {
		assert.deepEqual(resolvePair(ids(10, 11, 12), 10, 12), { a: 10, b: 12 });
	});

	it("un id que ya no está (retención, URL vieja) cae al par por defecto", () => {
		assert.deepEqual(resolvePair(ids(10, 11, 12), 99, 12), { a: 11, b: 12 });
		assert.deepEqual(resolvePair(ids(10, 11, 12), 10, 99), { a: 11, b: 12 });
	});

	it("sin par en la URL, el de por defecto", () => {
		assert.deepEqual(resolvePair(ids(10, 11), null, null), { a: 10, b: 11 });
	});

	it("solo «después» en la URL: se respeta y no hay «antes»", () => {
		assert.deepEqual(resolvePair(ids(10, 11, 12), null, 11), {
			a: null,
			b: 11,
		});
	});

	it("antes y después iguales no es un par: cae al de por defecto", () => {
		assert.deepEqual(resolvePair(ids(10, 11, 12), 11, 11), { a: 11, b: 12 });
	});
});
