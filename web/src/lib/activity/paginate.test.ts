import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DEFAULT_PER_PAGE, PER_PAGE_CHOICES, paginate } from "./paginate.ts";

describe("paginate", () => {
	it("calcula páginas y el «Mostrando X-Y de Z»", () => {
		assert.deepEqual(paginate(42, 2, 25), {
			page: 2,
			pageCount: 2,
			start: 25,
			end: 42,
			from: 26,
			to: 42,
			total: 42,
		});
		assert.deepEqual(paginate(42, 1, 25), {
			page: 1,
			pageCount: 2,
			start: 0,
			end: 25,
			from: 1,
			to: 25,
			total: 42,
		});
	});

	it("sin resultados hay una página vacía y 0-0", () => {
		assert.deepEqual(paginate(0, 1, 25), {
			page: 1,
			pageCount: 1,
			start: 0,
			end: 0,
			from: 0,
			to: 0,
			total: 0,
		});
	});

	it("ajusta la página cuando los filtros reducen el total", () => {
		assert.equal(paginate(30, 9, 25).page, 2);
		assert.equal(paginate(5, 3, 25).page, 1);
		assert.equal(paginate(0, 4, 25).page, 1);
	});

	it("una página menor que 1 o rota cae en la primera", () => {
		assert.equal(paginate(100, 0, 25).page, 1);
		assert.equal(paginate(100, -3, 25).page, 1);
		assert.equal(paginate(100, Number.NaN, 25).page, 1);
	});

	it("un total exacto no deja una página vacía al final", () => {
		assert.equal(paginate(50, 2, 25).pageCount, 2);
		assert.equal(paginate(51, 3, 25).to, 51);
	});

	it("expone las opciones de filas por página", () => {
		assert.deepEqual(PER_PAGE_CHOICES, [10, 25, 50, 100]);
		assert.ok(PER_PAGE_CHOICES.includes(DEFAULT_PER_PAGE));
	});
});
