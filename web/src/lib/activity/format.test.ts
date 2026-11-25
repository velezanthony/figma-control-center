import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { screenshotUrl } from "./endpoints.ts";
import {
	formatClock,
	formatDuration,
	formatPercent,
	nodeUrl,
	shortId,
} from "./format.ts";

describe("formatDuration", () => {
	it("milisegundos, segundos con coma y minutos", () => {
		assert.equal(formatDuration(850), "850 ms");
		assert.equal(formatDuration(1500), "1,5 s");
		assert.equal(formatDuration(59_000), "59,0 s");
		assert.equal(formatDuration(125_000), "2 min 5 s");
	});
});

describe("formatClock", () => {
	it("hora con segundos en 24 h", () => {
		assert.equal(formatClock("2026-01-01T13:05:09.000Z", "UTC"), "13:05:09");
	});
});

describe("nodeUrl", () => {
	it("enlaza al nodo con el id en formato de URL de Figma", () => {
		assert.equal(
			nodeUrl("https://www.figma.com/design/KEY/Nombre", "1:23"),
			"https://www.figma.com/design/KEY/Nombre?node-id=1-23",
		);
	});

	it("sustituye una query previa y admite ids compuestos", () => {
		assert.equal(
			nodeUrl("https://www.figma.com/design/KEY/N?node-id=9-9&t=x", "I1:2;3:4"),
			"https://www.figma.com/design/KEY/N?node-id=I1-2%3B3-4",
		);
	});

	it("una URL inválida no da enlace", () => {
		assert.equal(nodeUrl("no es una url", "1:2"), null);
	});
});

describe("screenshotUrl y shortId", () => {
	it("la captura se pide por nombre de archivo", () => {
		assert.equal(
			screenshotUrl("/a/b/screenshot-1.png"),
			"/screenshots/screenshot-1.png",
		);
	});

	it("shortId recorta", () => {
		assert.equal(shortId("123456789abcdef"), "12345678");
	});
});

describe("formatPercent", () => {
	it("da el porcentaje con coma y sin total no hay porcentaje", () => {
		assert.equal(formatPercent(3, 42), "7,1 %");
		assert.equal(formatPercent(1, 2), "50 %");
		assert.equal(formatPercent(0, 0), null);
	});
});
