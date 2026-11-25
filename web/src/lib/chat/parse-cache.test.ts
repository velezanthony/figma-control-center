import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createParseCache } from "./parse-cache.ts";

function setup(max: number) {
	const calls: string[] = [];
	const cache = createParseCache((body: string) => {
		calls.push(body);
		return { parsed: body };
	}, max);
	return { cache, calls };
}

describe("createParseCache: el Markdown de un mensaje se interpreta una vez", () => {
	it("la segunda petición del mismo mensaje devuelve lo mismo sin volver a interpretar", () => {
		const { cache, calls } = setup(10);
		const first = cache.get(1, "hola");
		assert.equal(cache.get(1, "hola"), first);
		assert.deepEqual(calls, ["hola"]);
	});

	it("mensajes distintos se interpretan por separado", () => {
		const { cache, calls } = setup(10);
		cache.get(1, "a");
		cache.get(2, "b");
		assert.deepEqual(calls, ["a", "b"]);
	});

	it("pasado el tope se olvida el menos reciente: la memoria no crece con la conversación", () => {
		const { cache, calls } = setup(2);
		cache.get(1, "a");
		cache.get(2, "b");
		cache.get(3, "c");
		assert.equal(cache.size, 2);
		cache.get(1, "a");
		assert.deepEqual(calls, ["a", "b", "c", "a"]);
	});

	it("volver a pedir un mensaje lo marca como reciente y se salva de la expulsión", () => {
		const { cache, calls } = setup(2);
		cache.get(1, "a");
		cache.get(2, "b");
		cache.get(1, "a");
		cache.get(3, "c");
		cache.get(1, "a");
		assert.deepEqual(calls, ["a", "b", "c"]);
	});

	it("si el texto de un id cambia (no debería) se interpreta de nuevo", () => {
		const { cache, calls } = setup(10);
		cache.get(1, "a");
		cache.get(1, "a editado");
		assert.deepEqual(calls, ["a", "a editado"]);
	});
});
