import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	countLabel,
	initialResult,
	jumpPlan,
	mergeResults,
	stepResult,
} from "./search-state.ts";

describe("mergeResults: lo local (mensajes cargados) y lo del servidor (todo el historial)", () => {
	it("une sin repetir y en orden de id", () => {
		assert.deepEqual(mergeResults([5, 9], [2, 5, 7]), [2, 5, 7, 9]);
	});

	it("con un lado vacío devuelve el otro ordenado", () => {
		assert.deepEqual(mergeResults([], [3, 1]), [1, 3]);
		assert.deepEqual(mergeResults([], []), []);
	});
});

describe("stepResult: moverse entre resultados", () => {
	const ids = [2, 5, 9];

	it("siguiente y anterior, dando la vuelta en los extremos", () => {
		assert.equal(stepResult(ids, 5, 1), 9);
		assert.equal(stepResult(ids, 5, -1), 2);
		assert.equal(stepResult(ids, 9, 1), 2);
		assert.equal(stepResult(ids, 2, -1), 9);
	});

	it("sin resultado actual, siguiente es el primero y anterior el último", () => {
		assert.equal(stepResult(ids, null, 1), 2);
		assert.equal(stepResult(ids, null, -1), 9);
	});

	it("si el actual ya no está entre los resultados, se ancla al más cercano por id", () => {
		assert.equal(stepResult(ids, 6, 1), 9);
		assert.equal(stepResult(ids, 6, -1), 5);
	});

	it("sin resultados no hay a dónde ir", () => {
		assert.equal(stepResult([], null, 1), null);
	});
});

describe("initialResult", () => {
	it("al buscar se salta al resultado más reciente; si el actual sigue valiendo, se conserva", () => {
		assert.equal(initialResult([2, 5, 9], null), 9);
		assert.equal(initialResult([2, 5, 9], 5), 5);
		assert.equal(initialResult([2, 5, 9], 4), 9);
		assert.equal(initialResult([], 4), null);
	});
});

describe("countLabel: «3 de 12»", () => {
	it("posición humana (desde 1) y total", () => {
		assert.equal(
			countLabel({
				ids: [2, 5, 9],
				current: 5,
				searching: false,
				truncated: false,
			}),
			"2 de 3",
		);
	});

	it("sin resultados, lo dice; buscando, lo dice; si el servidor cortó, el total lleva «+»", () => {
		assert.equal(
			countLabel({
				ids: [],
				current: null,
				searching: false,
				truncated: false,
			}),
			"Sin resultados",
		);
		assert.equal(
			countLabel({ ids: [], current: null, searching: true, truncated: false }),
			"Buscando…",
		);
		assert.equal(
			countLabel({
				ids: [1, 2],
				current: 1,
				searching: false,
				truncated: true,
			}),
			"1 de 2+",
		);
	});
});

describe("jumpPlan: cargar lo necesario para llegar a un mensaje antiguo sin dejar huecos", () => {
	it("si el mensaje ya está cargado no hay nada que pedir", () => {
		assert.equal(
			jumpPlan({ oldestLoaded: 100, targetId: 100, cursor: null }),
			null,
		);
		assert.equal(
			jumpPlan({ oldestLoaded: 100, targetId: 150, cursor: null }),
			null,
		);
	});

	it("si es más antiguo, se pide desde justo antes de él hacia delante", () => {
		assert.deepEqual(
			jumpPlan({ oldestLoaded: 100, targetId: 30, cursor: null }),
			{ after: 29 },
		);
	});

	it("tras cada tanda se continúa desde el último id recibido hasta enlazar con lo cargado", () => {
		assert.deepEqual(
			jumpPlan({ oldestLoaded: 100, targetId: 30, cursor: 80 }),
			{ after: 80 },
		);
		assert.equal(
			jumpPlan({ oldestLoaded: 100, targetId: 30, cursor: 99 }),
			null,
		);
		assert.equal(
			jumpPlan({ oldestLoaded: 100, targetId: 30, cursor: 120 }),
			null,
		);
	});

	it("sin nada cargado no hay con qué enlazar", () => {
		assert.equal(
			jumpPlan({ oldestLoaded: null, targetId: 30, cursor: null }),
			null,
		);
	});
});
