import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	DASHBOARD_MODE,
	isRouteAvailable,
	modeOf,
	routeIn,
} from "./dashboard-mode.ts";
import { ROUTE_NAME } from "./route.ts";

describe("modo del panel", () => {
	it("en producción la galería de componentes no está disponible y cae en el inicio", () => {
		assert.equal(
			isRouteAvailable(ROUTE_NAME.components, DASHBOARD_MODE.production),
			false,
		);
		assert.equal(
			routeIn(ROUTE_NAME.components, DASHBOARD_MODE.production),
			ROUTE_NAME.home,
		);
	});

	it("en desarrollo la galería abre como cualquier otra pantalla", () => {
		assert.equal(
			isRouteAvailable(ROUTE_NAME.components, DASHBOARD_MODE.development),
			true,
		);
		assert.equal(
			routeIn(ROUTE_NAME.components, DASHBOARD_MODE.development),
			ROUTE_NAME.components,
		);
	});

	it("el resto de pantallas abre en los dos modos", () => {
		for (const mode of Object.values(DASHBOARD_MODE)) {
			for (const route of Object.values(ROUTE_NAME)) {
				if (route === ROUTE_NAME.components) continue;
				assert.equal(routeIn(route, mode), route, `${route} · ${mode}`);
			}
		}
	});

	it("lee el modo del listado de ajustes; si falta, no vale o la respuesta no se entiende, es producción", () => {
		assert.equal(
			modeOf({ ok: true, mode: DASHBOARD_MODE.development }),
			DASHBOARD_MODE.development,
		);
		assert.equal(
			modeOf({ ok: true, mode: DASHBOARD_MODE.production }),
			DASHBOARD_MODE.production,
		);
		for (const body of [{ ok: true }, { mode: "debug" }, null, "texto"]) {
			assert.equal(modeOf(body), DASHBOARD_MODE.production, String(body));
		}
	});
});
