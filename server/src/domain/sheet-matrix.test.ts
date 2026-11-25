import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matrixOf } from "./sheet-matrix.ts";

type P = Record<string, string>;

describe("matrixOf", () => {
	it("sin rows, la fila es la primera propiedad de la primera variante y la columna, las demás sin valores neutros", () => {
		const props: P[] = [
			{ variant: "a", size: "sm", state: "default" },
			{ variant: "a", size: "lg", state: "disabled" },
			{ variant: "b", size: "sm", state: "default" },
			{ variant: "b", size: "lg", state: "disabled" },
		];
		const m = matrixOf(props);
		assert.deepEqual(m.rows, ["variant=a", "variant=b"]);
		assert.deepEqual(m.cells, [
			[0, 1],
			[2, 3],
		]);
		assert.deepEqual(m.columns, ["size=sm", "size=lg · state=disabled"]);
	});

	it("matrix.rows con varias propiedades las une con « · »", () => {
		const props: P[] = [
			{ a: "1", b: "x", c: "p" },
			{ a: "1", b: "x", c: "q" },
			{ a: "2", b: "x", c: "p" },
		];
		const m = matrixOf(props, ["a", "b"]);
		assert.deepEqual(m.rows, ["a=1 · b=x", "a=2 · b=x"]);
		assert.deepEqual(m.columns, ["c=p", "c=q"]);
	});

	it("una columna sin nada que la distinga se llama «default» si hay más propiedades que filas, y «—» sale del pintor, no de aquí", () => {
		const props: P[] = [
			{ v: "a", s: "default" },
			{ v: "a", s: "x" },
		];
		const m = matrixOf(props);
		assert.deepEqual(m.columns, ["default", "s=x"]);
	});

	it("si solo hay la propiedad de fila, no hay columnas", () => {
		const m = matrixOf([{ v: "a" }, { v: "b" }]);
		assert.deepEqual(m.rows, ["v=a", "v=b"]);
		assert.deepEqual(m.columns, []);
		assert.deepEqual(m.cells, [[0], [1]]);
	});

	it("las columnas salen de la fila más larga (la primera si hay empate)", () => {
		const props: P[] = [
			{ v: "a", s: "1" },
			{ v: "b", s: "1" },
			{ v: "b", s: "2" },
		];
		assert.deepEqual(matrixOf(props).columns, ["s=1", "s=2"]);
	});

	it("una hoja de una sola variante sin propiedades da una fila sin etiqueta de propiedad", () => {
		const m = matrixOf([{}]);
		assert.deepEqual(m.rows, [""]);
		assert.deepEqual(m.columns, []);
	});
});
