import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { layoutSize, placeFloating } from "./floating.ts";

const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 100, height: 40 };
const GAP = 8;
const at = (left: number, top: number, width = 60, height = 30) => ({
	left,
	top,
	right: left + width,
	bottom: top + height,
});

describe("placeFloating (posición fija junto al disparador)", () => {
	it("bottom centra el contenido bajo el disparador, con el hueco", () => {
		const p = placeFloating(at(400, 300), SIZE, VIEWPORT, "bottom", GAP);
		assert.deepEqual(p, { top: 338, left: 380, placement: "bottom" });
	});

	it("top lo coloca encima, alineado al centro", () => {
		const p = placeFloating(at(400, 300), SIZE, VIEWPORT, "top", GAP);
		assert.deepEqual(p, { top: 252, left: 380, placement: "top" });
	});

	it("top-end lo coloca encima con su borde derecho en el del ancla", () => {
		const p = placeFloating(at(400, 300), SIZE, VIEWPORT, "top-end", GAP);
		assert.deepEqual(p, { top: 252, left: 360, placement: "top-end" });
	});

	it("top-end sin sitio arriba se voltea a bottom-end, alineado igual", () => {
		const p = placeFloating(at(400, 20), SIZE, VIEWPORT, "top-end", GAP);
		assert.deepEqual(p, { top: 58, left: 360, placement: "bottom-end" });
	});

	it("bottom-start alinea el borde izquierdo con el del disparador", () => {
		const p = placeFloating(at(400, 300), SIZE, VIEWPORT, "bottom-start", GAP);
		assert.deepEqual(p, { top: 338, left: 400, placement: "bottom-start" });
	});

	it("si abajo no cabe y arriba sí, se voltea", () => {
		const p = placeFloating(at(400, 750), SIZE, VIEWPORT, "bottom", GAP);
		assert.equal(p.placement, "top");
		assert.equal(p.top, 702);
	});

	it("si no cabe en ningún lado, se queda donde se pidió", () => {
		const small = { width: 1000, height: 60 };
		const p = placeFloating(at(400, 20), SIZE, small, "bottom", GAP);
		assert.equal(p.placement, "bottom");
	});

	it("no se sale por los bordes laterales", () => {
		const right = placeFloating(at(980, 300), SIZE, VIEWPORT, "bottom", GAP);
		assert.equal(right.left, 1000 - 100 - 8);
		const left = placeFloating(at(0, 300), SIZE, VIEWPORT, "bottom", GAP);
		assert.equal(left.left, 8);
	});
});

describe("layoutSize (tamaño de maqueta para colocar el flotante)", () => {
	it("redondea hacia arriba un ancho fraccionario: con el de abajo se saldría del margen", () => {
		assert.deepEqual(layoutSize({ width: "234.406px", height: "29px" }), {
			width: 235,
			height: 29,
		});
	});

	it("pegado al borde derecho, un ancho fraccionario no invade el margen", () => {
		const size = layoutSize({ width: "234.406px", height: "29px" });
		const p = placeFloating(at(940, 20), size, VIEWPORT, "bottom-end", GAP);
		assert.ok(p.left + 234.40625 <= VIEWPORT.width - 8);
	});
});
