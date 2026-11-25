import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	attemptDiffRawUrl,
	attemptDiffUrl,
	attemptScriptRawUrl,
	attemptScriptUrl,
	attemptTargetsUrl,
	targetAttemptsUrl,
} from "./endpoints.ts";
import { DEFAULT_ATTEMPTS_VIEW } from "./view-state.ts";

const params = (url: string) => new URL(url, "http://x").searchParams;

describe("attemptTargetsUrl: la lista se pide ya filtrada, ordenada y paginada", () => {
	it("la vista por defecto pide por intentos descendente, página 1 y 25", () => {
		assert.equal(
			attemptTargetsUrl(DEFAULT_ATTEMPTS_VIEW),
			"/api/history/attempt-targets?sort=attempts&dir=desc&page=1&per=25",
		);
	});

	it("cada filtro activo viaja con el nombre que entiende la API", () => {
		const url = attemptTargetsUrl({
			...DEFAULT_ATTEMPTS_VIEW,
			filters: {
				kind: "capture",
				status: "error",
				query: " home ",
				preset: "today",
				since: null,
			},
			sort: { key: "last", dir: "asc" },
			page: 3,
			perPage: 50,
		});
		const p = params(url);
		assert.equal(p.get("kind"), "capture");
		assert.equal(p.get("status"), "error");
		assert.equal(p.get("q"), "home");
		assert.equal(p.get("preset"), "today");
		assert.equal(p.get("sort"), "last");
		assert.equal(p.get("dir"), "asc");
		assert.equal(p.get("page"), "3");
		assert.equal(p.get("per"), "50");
	});

	it("una fecha concreta viaja como since y manda sobre el preset", () => {
		const p = params(
			attemptTargetsUrl({
				...DEFAULT_ATTEMPTS_VIEW,
				filters: {
					...DEFAULT_ATTEMPTS_VIEW.filters,
					preset: "today",
					since: "2026-11-01",
				},
			}),
		);
		assert.equal(p.get("since"), "2026-11-01");
		assert.equal(p.get("preset"), null);
	});

	it("una búsqueda en blanco no se envía", () => {
		const p = params(
			attemptTargetsUrl({
				...DEFAULT_ATTEMPTS_VIEW,
				filters: { ...DEFAULT_ATTEMPTS_VIEW.filters, query: "   " },
			}),
		);
		assert.equal(p.has("q"), false);
	});
});

describe("rutas del detalle", () => {
	it("los intentos de un objetivo piden el tipo y el objetivo exactos, codificados", () => {
		const url = targetAttemptsUrl("build_step", "kit/place@1 · app");
		const p = params(url);
		assert.equal(p.get("kind"), "build_step");
		assert.equal(p.get("target"), "kit/place@1 · app");
		assert.ok(url.startsWith("/api/history/attempts?"));
	});

	it("el contenido de un papel y su texto entero", () => {
		assert.equal(
			attemptScriptUrl(7, "step", ""),
			"/api/history/attempts/7/script?role=step",
		);
		assert.equal(
			attemptScriptUrl(7, "hooks", "a b.js"),
			"/api/history/attempts/7/script?role=hooks&path=a+b.js",
		);
		assert.equal(
			attemptScriptRawUrl(7, "kit", ""),
			"/api/history/attempts/7/script/raw?role=kit",
		);
	});

	it("el diff pide los dos ids y, si los hay, papel y ruta", () => {
		assert.equal(
			attemptDiffUrl(3, 4, null, null),
			"/api/history/attempt-diff?from=3&to=4",
		);
		assert.equal(
			attemptDiffUrl(3, 4, "plan", null),
			"/api/history/attempt-diff?from=3&to=4&role=plan",
		);
		assert.equal(
			attemptDiffRawUrl(3, 4, "hooks", "x.js"),
			"/api/history/attempt-diff/raw?from=3&to=4&role=hooks&path=x.js",
		);
	});
});
