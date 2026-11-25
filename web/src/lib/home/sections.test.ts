import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ROUTE_NAME } from "#web/lib/route.ts";
import { SECTIONS } from "./sections.ts";

describe("secciones del inicio", () => {
	it("hay una tarjeta por cada pantalla salvo el propio inicio y la ayuda, sin repetir", () => {
		const routes = SECTIONS.map((s) => s.route).sort();
		const expected = Object.values(ROUTE_NAME)
			.filter((r) => r !== ROUTE_NAME.home && r !== ROUTE_NAME.help)
			.sort();
		assert.deepEqual(routes, expected);
	});

	it("«Intentos» está entre las tarjetas y dice que es de solo lectura", () => {
		const attempts = SECTIONS.find((s) => s.route === ROUTE_NAME.attempts);
		assert.equal(attempts?.title, "Intentos");
		assert.match(attempts?.description ?? "", /qué cambió/i);
	});

	it("cada tarjeta explica para qué sirve", () => {
		for (const s of SECTIONS) {
			assert.ok(s.title.length > 0 && s.description.length > 20, s.route);
		}
	});
});
