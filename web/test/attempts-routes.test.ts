import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { HISTORY_ROUTE } from "../../server/src/adapters/http/routes.ts";
import {
	attemptDiffRawUrl,
	attemptDiffUrl,
	attemptScriptRawUrl,
	attemptScriptUrl,
	attemptTargetsUrl,
	targetAttemptsUrl,
} from "../src/lib/attempts/endpoints.ts";
import { DEFAULT_ATTEMPTS_VIEW } from "../src/lib/attempts/view-state.ts";

// La web repite los nombres de las rutas (no importa el servidor): este test los compara con los reales
describe("rutas de intentos: la web usa las mismas que HISTORY_ROUTE", () => {
	const path = (url: string) => url.split("?")[0] ?? "";
	const route = (name: string) => `${HISTORY_ROUTE.prefix}${name}`;

	it("lista, intentos de un objetivo, diff y su texto entero", () => {
		assert.equal(
			path(attemptTargetsUrl(DEFAULT_ATTEMPTS_VIEW)),
			route(HISTORY_ROUTE.attemptTargets),
		);
		assert.equal(
			path(targetAttemptsUrl("capture", "x")),
			route(HISTORY_ROUTE.attempts),
		);
		assert.equal(
			path(attemptDiffUrl(1, 2, null, null)),
			route(HISTORY_ROUTE.attemptDiff),
		);
		assert.equal(
			path(attemptDiffRawUrl(1, 2, null, null)),
			route(HISTORY_ROUTE.attemptDiffRaw),
		);
	});

	it("el contenido de un papel y su texto entero casan con los patrones del servidor", () => {
		const script = path(attemptScriptUrl(7, "step", null)).slice(
			HISTORY_ROUTE.prefix.length,
		);
		const raw = path(attemptScriptRawUrl(7, "step", null)).slice(
			HISTORY_ROUTE.prefix.length,
		);
		assert.match(script, HISTORY_ROUTE.attemptScript);
		assert.match(raw, HISTORY_ROUTE.attemptScriptRaw);
		assert.doesNotMatch(script, HISTORY_ROUTE.attemptScriptRaw);
	});
});
