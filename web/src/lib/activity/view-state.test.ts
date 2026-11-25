import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DEFAULT_PER_PAGE } from "./paginate.ts";
import { DEFAULT_SORT, SORT_KEY } from "./sort.ts";
import { DEFAULT_VIEW, parseView, serializeView } from "./view-state.ts";

describe("estado de la vista en la URL", () => {
	it("sin parámetros da la vista por defecto, y esta se serializa vacía", () => {
		assert.deepEqual(parseView(""), DEFAULT_VIEW);
		assert.equal(serializeView(DEFAULT_VIEW), "");
		assert.deepEqual(DEFAULT_VIEW.sort, DEFAULT_SORT);
		assert.equal(DEFAULT_VIEW.perPage, DEFAULT_PER_PAGE);
	});

	it("ida y vuelta de una vista completa", () => {
		const view = {
			filters: {
				query: "run script",
				tool: "figma_run_script",
				status: "error",
				sessionId: "s2",
			},
			sort: { key: SORT_KEY.duration, dir: "asc" },
			page: 3,
			perPage: 50,
			open: "call-9",
		} as const;
		assert.deepEqual(parseView(serializeView(view)), view);
	});

	it("solo escribe lo que difiere del defecto", () => {
		const text = serializeView({ ...DEFAULT_VIEW, page: 2 });
		assert.equal(text, "page=2");
	});

	it("acepta la cadena con o sin «?»", () => {
		assert.equal(parseView("?page=4").page, 4);
		assert.equal(parseView("page=4").page, 4);
	});

	it("valores inválidos caen en los de por defecto", () => {
		const v = parseView("page=abc&per=7&status=raro&sort=nada&dir=sideways");
		assert.equal(v.page, 1);
		assert.equal(v.perPage, DEFAULT_PER_PAGE);
		assert.equal(v.filters.status, "all");
		assert.deepEqual(v.sort, DEFAULT_SORT);
	});

	it("una página menor que 1 se corrige", () => {
		assert.equal(parseView("page=0").page, 1);
		assert.equal(parseView("page=-2").page, 1);
	});

	it("escapa lo que escribe el usuario en la búsqueda", () => {
		const view = {
			...DEFAULT_VIEW,
			filters: { ...DEFAULT_VIEW.filters, query: "a&b=c #1" },
		};
		assert.equal(parseView(serializeView(view)).filters.query, "a&b=c #1");
	});
});
