import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ROUTE_NAME, type RouteName } from "#web/lib/route.ts";
import { isRouteBlocked, NEEDS_PROJECT_HINT } from "./gating.ts";

const NO_PROJECT = { loaded: true, failed: false, activeId: null } as const;
const WITH_PROJECT = {
	loaded: true,
	failed: false,
	activeId: "ejemplo",
} as const;

const NEED_ONE: readonly RouteName[] = [
	ROUTE_NAME.activity,
	ROUTE_NAME.jobs,
	ROUTE_NAME.captures,
	ROUTE_NAME.attempts,
	ROUTE_NAME.chat,
];
const ALWAYS: readonly RouteName[] = [
	ROUTE_NAME.home,
	ROUTE_NAME.projects,
	ROUTE_NAME.settings,
	ROUTE_NAME.components,
];

describe("isRouteBlocked", () => {
	it("sin proyecto, Actividad, Jobs, Capturas, Intentos y Chat quedan bloqueadas", () => {
		for (const route of NEED_ONE)
			assert.equal(isRouteBlocked(route, NO_PROJECT), true, route);
	});

	it("sin proyecto, Inicio, Proyectos, Ajustes y Componentes siguen disponibles", () => {
		for (const route of ALWAYS)
			assert.equal(isRouteBlocked(route, NO_PROJECT), false, route);
	});

	it("con proyecto no se bloquea ninguna", () => {
		for (const route of [...NEED_ONE, ...ALWAYS]) {
			assert.equal(isRouteBlocked(route, WITH_PROJECT), false, route);
		}
	});

	it("mientras la lista de proyectos no ha llegado, o si falló la carga, no se bloquea nada (no es «sin proyecto»)", () => {
		for (const route of NEED_ONE) {
			assert.equal(
				isRouteBlocked(route, { loaded: false, failed: false, activeId: null }),
				false,
				route,
			);
			assert.equal(
				isRouteBlocked(route, { loaded: true, failed: true, activeId: null }),
				false,
				route,
			);
		}
	});

	it("el motivo es la frase firmada", () => {
		assert.equal(NEEDS_PROJECT_HINT, "Crea o elige un proyecto para ver esto");
	});
});
