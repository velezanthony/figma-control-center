import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	canonicalHash,
	hrefOf,
	pageOnlyHash,
	pageTitle,
	parseHash,
	ROUTE_LABEL,
	ROUTE_NAME,
} from "./route.ts";

describe("rutas por hash", () => {
	it("reconoce cada pantalla", () => {
		assert.equal(parseHash("#/components").route, ROUTE_NAME.components);
		assert.equal(parseHash("#/activity").route, ROUTE_NAME.activity);
		assert.equal(parseHash("#/jobs").route, ROUTE_NAME.jobs);
		assert.equal(parseHash("#/captures").route, ROUTE_NAME.captures);
		assert.equal(parseHash("#/attempts").route, ROUTE_NAME.attempts);
		assert.equal(parseHash("#/attempts?t=x&k=capture").search, "t=x&k=capture");
		assert.equal(hrefOf(ROUTE_NAME.attempts, "t=x"), "#/attempts?t=x");
		assert.equal(pageOnlyHash("#/attempts?t=x&k=capture&a=3"), "#/attempts");
		assert.equal(parseHash("#/chat").route, ROUTE_NAME.chat);
		assert.equal(parseHash("#/settings").route, ROUTE_NAME.settings);
		assert.equal(parseHash("#/help?tab=glossary").route, ROUTE_NAME.help);
		assert.equal(hrefOf(ROUTE_NAME.help), "#/help");
		assert.equal(hrefOf(ROUTE_NAME.settings), "#/settings");
	});

	it("la raíz es la página de inicio", () => {
		assert.equal(parseHash("#/").route, ROUTE_NAME.home);
		assert.equal(parseHash("").route, ROUTE_NAME.home);
	});

	it("cualquier hash desconocido cae en el inicio", () => {
		assert.equal(parseHash("#/nada").route, ROUTE_NAME.home);
	});

	it("separa la ruta de los parámetros de estado", () => {
		assert.deepEqual(parseHash("#/jobs?page=2"), {
			route: ROUTE_NAME.jobs,
			search: "page=2",
		});
		assert.deepEqual(parseHash("#/activity?q=hola"), {
			route: ROUTE_NAME.activity,
			search: "q=hola",
		});
	});

	it("la vieja URL de la actividad con estado (#/?q=…) ya no es la actividad", () => {
		assert.equal(parseHash("#/?q=hola").route, ROUTE_NAME.home);
	});

	it("hrefOf compone ruta y parámetros", () => {
		assert.equal(hrefOf(ROUTE_NAME.home), "#/");
		assert.equal(hrefOf(ROUTE_NAME.activity), "#/activity");
		assert.equal(hrefOf(ROUTE_NAME.captures), "#/captures");
		assert.equal(hrefOf(ROUTE_NAME.activity, "page=2"), "#/activity?page=2");
		assert.equal(hrefOf(ROUTE_NAME.jobs, "page=2"), "#/jobs?page=2");
	});

	it("hrefOf y parseHash son inversos para todas las rutas", () => {
		for (const route of Object.values(ROUTE_NAME)) {
			assert.equal(parseHash(hrefOf(route, "a=1")).route, route);
		}
	});

	it("pageOnlyHash conserva la pantalla y quita sesión, fila abierta y página", () => {
		assert.equal(
			pageOnlyHash("#/activity?session=ab12&open=c9&page=3&q=x"),
			"#/activity",
		);
		assert.equal(pageOnlyHash("#/jobs?page=2&open=j1"), "#/jobs");
		assert.equal(pageOnlyHash("#/captures?page=4"), "#/captures");
	});

	it("pageOnlyHash deja igual un hash sin parámetros y manda a inicio lo desconocido", () => {
		assert.equal(pageOnlyHash("#/jobs"), "#/jobs");
		assert.equal(pageOnlyHash(""), "#/");
		assert.equal(pageOnlyHash("#/nada?x=1"), "#/");
	});

	it("las rutas antiguas en castellano abren su pantalla y se reescriben a la nueva, con sus parámetros", () => {
		const legacy = [
			["#/actividad?q=hola", ROUTE_NAME.activity, "#/activity?q=hola"],
			["#/capturas", ROUTE_NAME.captures, "#/captures"],
			[
				"#/intentos?t=x&k=capture",
				ROUTE_NAME.attempts,
				"#/attempts?t=x&k=capture",
			],
			["#/proyectos", ROUTE_NAME.projects, "#/projects"],
			["#/ajustes", ROUTE_NAME.settings, "#/settings"],
			[
				"#/componentes?s=molecules",
				ROUTE_NAME.components,
				"#/components?s=molecules",
			],
		] as const;
		for (const [old, route, next] of legacy) {
			assert.equal(parseHash(old).route, route);
			assert.equal(canonicalHash(old), next);
		}
	});

	it("una ruta ya nueva, la raíz o una desconocida no se reescriben", () => {
		assert.equal(canonicalHash("#/settings"), null);
		assert.equal(canonicalHash("#/jobs?page=2"), null);
		assert.equal(canonicalHash("#/"), null);
		assert.equal(canonicalHash(""), null);
		assert.equal(canonicalHash("#/nada"), null);
	});
});

describe("título de la pestaña", () => {
	it("cada pantalla lleva su nombre, el de la barra lateral, delante del panel", () => {
		assert.deepEqual(
			Object.values(ROUTE_NAME).map((route) => pageTitle(route)),
			[
				"Inicio · Figma Control Center",
				"Actividad · Figma Control Center",
				"Jobs · Figma Control Center",
				"Capturas · Figma Control Center",
				"Intentos · Figma Control Center",
				"Chat · Figma Control Center",
				"Proyectos · Figma Control Center",
				"Ajustes · Figma Control Center",
				"Componentes · Figma Control Center",
				"Ayuda · Figma Control Center",
			],
		);
		assert.equal(ROUTE_LABEL[ROUTE_NAME.attempts], "Intentos");
	});
});
