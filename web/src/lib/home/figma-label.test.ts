import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ConnectionStatus } from "#web/lib/contract.ts";
import { figmaLabel } from "./figma-label.ts";

const AT = "2026-11-11T10:00:00.000Z";
const READY: ConnectionStatus = {
	at: AT,
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "pruebas",
	pageName: "Portada",
};
const minutesAfter = (m: number) => Date.parse(AT) + m * 60_000;

describe("etiqueta de Figma en la barra lateral", () => {
	it("dice cuánto hace de la última comprobación: el panel no mira Chrome, repite el último figma_status", () => {
		assert.equal(
			figmaLabel(READY, minutesAfter(5)),
			"Figma listo · hace 5 min",
		);
		assert.equal(
			figmaLabel(READY, minutesAfter(0)),
			"Figma listo · ahora mismo",
		);
	});

	it("también lo dice cuando la última comprobación salió mal", () => {
		assert.equal(
			figmaLabel(
				{ ...READY, figmaReady: false, tabFound: false },
				minutesAfter(2),
			),
			"Sin pestaña de Figma · hace 2 min",
		);
		assert.equal(
			figmaLabel({ ...READY, figmaReady: false }, minutesAfter(90)),
			"Figma no está listo · hace 1 h",
		);
	});

	it("sin ninguna comprobación no inventa una hora", () => {
		assert.equal(figmaLabel(null, minutesAfter(5)), "Figma sin comprobar");
	});
});
