import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	callsUrl,
	capturesUrl,
	jobStepResultUrl,
	jobStepsUrl,
	screenshotUrl,
	sessionsUrl,
	statusUrl,
	summaryUrl,
} from "./endpoints.ts";
import { DEFAULT_VIEW } from "./view-state.ts";

const view = (over: Partial<typeof DEFAULT_VIEW> = {}) => ({
	...DEFAULT_VIEW,
	...over,
});

describe("callsUrl (la tabla se pide ya filtrada, ordenada y paginada)", () => {
	it("la vista por defecto pide hora descendente, página 1 y 25 por página, sin filtros", () => {
		assert.equal(
			callsUrl(view()),
			"/api/history/calls?sort=time&dir=desc&page=1&per=25",
		);
	});

	it("cada filtro activo viaja con el nombre que entiende la API", () => {
		const u = callsUrl(
			view({
				filters: {
					query: " pintar ",
					tool: "figma_run_script",
					status: "error",
					sessionId: "s-1",
				},
				sort: { key: "duration", dir: "asc" },
				page: 3,
				perPage: 50,
			}),
		);
		const p = new URL(u, "http://x").searchParams;
		assert.equal(p.get("q"), "pintar");
		assert.equal(p.get("tool"), "figma_run_script");
		assert.equal(p.get("status"), "error");
		assert.equal(p.get("session"), "s-1");
		assert.equal(p.get("sort"), "duration");
		assert.equal(p.get("dir"), "asc");
		assert.equal(p.get("page"), "3");
		assert.equal(p.get("per"), "50");
	});

	it("una búsqueda en blanco y el estado «todos» no se envían", () => {
		const p = new URL(
			callsUrl(
				view({
					filters: { query: "   ", tool: null, status: "all", sessionId: null },
				}),
			),
			"http://x",
		).searchParams;
		assert.equal(p.has("q"), false);
		assert.equal(p.has("status"), false);
	});

	it("jobsOnly y locate se añaden solo cuando se piden", () => {
		const base = new URL(callsUrl(view()), "http://x").searchParams;
		assert.equal(base.has("jobs"), false);
		assert.equal(base.has("locate"), false);
		const p = new URL(
			callsUrl(view(), { jobsOnly: true, locate: "abc" }),
			"http://x",
		).searchParams;
		assert.equal(p.get("jobs"), "1");
		assert.equal(p.get("locate"), "abc");
		assert.equal(
			new URL(callsUrl(view(), { locate: null }), "http://x").searchParams.has(
				"locate",
			),
			false,
		);
	});

	it("un texto con caracteres especiales viaja codificado", () => {
		const u = callsUrl(
			view({
				filters: {
					query: "a&b=c#d",
					tool: null,
					status: "all",
					sessionId: null,
				},
			}),
		);
		assert.equal(new URL(u, "http://x").searchParams.get("q"), "a&b=c#d");
	});
});

describe("el resto de rutas de la API", () => {
	it("resumen, estado, sesiones y capturas", () => {
		assert.equal(summaryUrl(), "/api/history/summary");
		assert.equal(statusUrl(), "/api/history/status");
		assert.equal(sessionsUrl(50), "/api/history/sessions?limit=50");
		assert.equal(capturesUrl(2, 12), "/api/history/captures?page=2&per=12");
	});

	it("los pasos de un lote se piden por el id del job, codificado", () => {
		assert.equal(jobStepsUrl("job-1"), "/api/history/jobs/job-1/steps");
		assert.equal(jobStepsUrl("a/b"), "/api/history/jobs/a%2Fb/steps");
	});

	it("el resultado entero de un paso se pide por el id del job y el índice", () => {
		assert.equal(
			jobStepResultUrl("job-1", 2),
			"/api/history/jobs/job-1/steps/2/result",
		);
		assert.equal(
			jobStepResultUrl("a/b", 0),
			"/api/history/jobs/a%2Fb/steps/0/result",
		);
	});
});

describe("screenshotUrl", () => {
	it("una captura nueva se sirve por screenshots/<fecha>/<archivo>", () => {
		assert.equal(
			screenshotUrl(
				"/home/u/output/1/screenshots/2026-11-09/6449-7353_213104.png",
			),
			"/screenshots/screenshots/2026-11-09/6449-7353_213104.png",
		);
	});

	it("una captura de la carpeta antigua capturas/<fecha>/ se sigue sirviendo por su ruta", () => {
		assert.equal(
			screenshotUrl(
				"/home/u/output/1/capturas/2026-11-09/6449-7353_213104.png",
			),
			"/screenshots/capturas/2026-11-09/6449-7353_213104.png",
		);
		assert.equal(
			screenshotUrl("/o/capturas/2026-11-09/6449-7353_213104-2.png"),
			"/screenshots/capturas/2026-11-09/6449-7353_213104-2.png",
		);
	});

	it("una subcarpeta que no es capturas/<fecha> se sirve solo por el nombre", () => {
		assert.equal(screenshotUrl("/o/capturas/otra/a.png"), "/screenshots/a.png");
		assert.equal(
			screenshotUrl("/o/capturas/2026-11-09/sub/a.png"),
			"/screenshots/a.png",
		);
	});

	it("sirve la captura por su nombre de archivo, no por la ruta absoluta", () => {
		assert.equal(
			screenshotUrl("/home/u/output/shot 1.png"),
			"/screenshots/shot%201.png",
		);
	});
});
