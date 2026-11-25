import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { findRanges, fold, foldQuery, splitByRanges } from "./fold.ts";

describe("fold: comparar sin mayúsculas ni acentos", () => {
	it("pasa a minúsculas y quita los diacríticos", () => {
		assert.equal(fold("Acción ÁRBOL ñandú").text, "accion arbol nandu");
	});

	it("cada carácter plegado apunta a su posición en el original, aunque se pierdan marcas", () => {
		// «é» descompuesta (e + acento) ocupa dos unidades de código en el original
		const { text, map } = fold("éx");
		assert.equal(text, "ex");
		assert.deepEqual(map, [0, 2]);
	});

	it("un texto sin letras especiales no cambia de longitud", () => {
		const { text, map } = fold("abc 123");
		assert.equal(text, "abc 123");
		assert.equal(map.length, 7);
	});
});

describe("findRanges: dónde está lo buscado, en coordenadas del texto original", () => {
	it("encuentra todas las apariciones sin solaparlas", () => {
		assert.deepEqual(findRanges("aaa", "aa"), [{ start: 0, end: 2 }]);
		assert.deepEqual(findRanges("el nodo y otro nodo", "nodo"), [
			{ start: 3, end: 7 },
			{ start: 15, end: 19 },
		]);
	});

	it("ignora mayúsculas y acentos tanto en el texto como en lo buscado", () => {
		assert.deepEqual(findRanges("La ACCIÓN falló", "accion"), [
			{ start: 3, end: 9 },
		]);
		assert.deepEqual(findRanges("accion", "ACCIÓN"), [{ start: 0, end: 6 }]);
	});

	it("el rango cubre el carácter original completo aunque venga descompuesto", () => {
		const text = "café solo";
		assert.deepEqual(findRanges(text, "café"), [{ start: 0, end: 5 }]);
	});

	it("una búsqueda vacía o de solo espacios no resalta nada", () => {
		assert.deepEqual(findRanges("hola", ""), []);
		assert.deepEqual(findRanges("hola", "   "), []);
	});

	it("lo que se busca se recorta por los extremos pero conserva los espacios interiores", () => {
		assert.equal(foldQuery("  Nodo  tocado "), "nodo  tocado");
		assert.deepEqual(findRanges("el nodo  tocado ayer", " Nodo  tocado"), [
			{ start: 3, end: 15 },
		]);
	});

	it("los caracteres especiales de expresión regular se buscan tal cual", () => {
		assert.deepEqual(findRanges("a.b a*b", "a.b"), [{ start: 0, end: 3 }]);
		assert.deepEqual(findRanges("1:23 (x)", "(x)"), [{ start: 5, end: 8 }]);
	});
});

describe("splitByRanges: el texto troceado para resaltar solo lo encontrado", () => {
	it("alterna trozos normales y coincidencias y recompone el texto original", () => {
		const text = "el nodo y otro nodo";
		const parts = splitByRanges(text, findRanges(text, "nodo"));
		assert.deepEqual(parts, [
			{ text: "el ", hit: false },
			{ text: "nodo", hit: true },
			{ text: " y otro ", hit: false },
			{ text: "nodo", hit: true },
		]);
		assert.equal(parts.map((p) => p.text).join(""), text);
	});

	it("sin coincidencias, un solo trozo; con la coincidencia pegada a los bordes no hay trozos vacíos", () => {
		assert.deepEqual(splitByRanges("hola", []), [{ text: "hola", hit: false }]);
		assert.deepEqual(splitByRanges("nodo", [{ start: 0, end: 4 }]), [
			{ text: "nodo", hit: true },
		]);
	});
});
