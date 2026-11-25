import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toFtsQuery } from "./fts-query.ts";

describe("toFtsQuery", () => {
	it("cada palabra pasa a frase con prefijo, enlazadas con Y", () => {
		assert.equal(toFtsQuery("pintar botones"), '"pintar"* "botones"*');
	});

	it("rutas, ids de nodo y nombres con guion bajo se parten en tokens dentro de una sola frase", () => {
		assert.equal(toFtsQuery("scripts/x.js"), '"scripts x js"*');
		assert.equal(toFtsQuery("1:23"), '"1 23"*');
		assert.equal(toFtsQuery("figma_run_script"), '"figma run script"*');
	});

	it("la sintaxis propia de FTS5 queda neutralizada", () => {
		assert.equal(
			toFtsQuery('a OR "b" NEAR(c) -d x:y *'),
			'"a"* "OR"* "b"* "NEAR c"* "d"* "x y"*',
		);
	});

	it("sin letras ni cifras no hay consulta", () => {
		for (const text of ["", "   ", "!!!", '"*()'])
			assert.equal(toFtsQuery(text), null, text);
	});

	it("conserva letras con tilde y la ñ", () => {
		assert.equal(toFtsQuery("diseño ágil"), '"diseño"* "ágil"*');
	});
});
