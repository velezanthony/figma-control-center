import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	closeDetail,
	DEFAULT_ATTEMPTS_VIEW,
	openTarget,
	parseAttemptsView,
	serializeAttemptsView,
} from "./view-state.ts";

describe("estado de «Intentos» en la URL", () => {
	it("sin parámetros da la vista por defecto, y esta se serializa vacía", () => {
		assert.deepEqual(parseAttemptsView(""), DEFAULT_ATTEMPTS_VIEW);
		assert.equal(serializeAttemptsView(DEFAULT_ATTEMPTS_VIEW), "");
	});

	it("ida y vuelta de la lista con todos sus filtros", () => {
		const view = {
			...DEFAULT_ATTEMPTS_VIEW,
			filters: {
				kind: "capture",
				status: "contract_error",
				query: "home · x",
				preset: "last_hour",
				since: null,
			},
			sort: { key: "last", dir: "asc" },
			page: 2,
			perPage: 50,
		} as const;
		assert.deepEqual(parseAttemptsView(serializeAttemptsView(view)), view);
	});

	it("ida y vuelta del detalle: objetivo, tipo, par, papel y ruta", () => {
		const view = {
			...DEFAULT_ATTEMPTS_VIEW,
			detail: {
				kind: "build_step",
				target: "kit/place@1 · app",
				a: 11,
				b: 14,
				role: "hooks",
				path: "x/y.js",
			},
		} as const;
		const search = serializeAttemptsView(view);
		const p = new URLSearchParams(search);
		assert.equal(p.get("t"), "kit/place@1 · app");
		assert.equal(p.get("k"), "build_step");
		assert.equal(p.get("a"), "11");
		assert.equal(p.get("b"), "14");
		assert.deepEqual(parseAttemptsView(search), view);
	});

	it("una fecha since sustituye al preset", () => {
		const view = parseAttemptsView("preset=today&since=2026-11-01");
		assert.equal(view.filters.since, "2026-11-01");
		assert.equal(view.filters.preset, null);
	});

	it("valores que no se entienden caen en su defecto", () => {
		const view = parseAttemptsView(
			"kind=otro&status=raro&sort=azar&dir=sideways&page=-2&per=7&preset=ayer&a=x&b=-3&k=raro&t=x",
		);
		assert.deepEqual(view.filters, DEFAULT_ATTEMPTS_VIEW.filters);
		assert.deepEqual(view.sort, DEFAULT_ATTEMPTS_VIEW.sort);
		assert.equal(view.page, 1);
		assert.equal(view.perPage, DEFAULT_ATTEMPTS_VIEW.perPage);
		assert.equal(
			view.detail,
			null,
			"un detalle sin tipo válido no es un detalle",
		);
	});

	it("un detalle necesita t y k; a y b que no son ids positivos se descartan", () => {
		const view = parseAttemptsView("t=x.js&k=run_script&a=0&b=zz");
		assert.deepEqual(view.detail, {
			kind: "run_script",
			target: "x.js",
			a: null,
			b: null,
			role: null,
			path: null,
		});
	});

	it("abrir un objetivo deja la lista como estaba y vacía el par; cerrarlo quita solo el detalle", () => {
		const list = {
			...DEFAULT_ATTEMPTS_VIEW,
			filters: { ...DEFAULT_ATTEMPTS_VIEW.filters, query: "home" },
			page: 4,
		};
		const open = openTarget(list, "capture", "home");
		assert.equal(open.page, 4);
		assert.deepEqual(open.detail, {
			kind: "capture",
			target: "home",
			a: null,
			b: null,
			role: null,
			path: null,
		});
		assert.deepEqual(closeDetail(open), list);
	});
});
