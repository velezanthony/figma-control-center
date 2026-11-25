// Las piezas de valores del kit que no necesitan DOM, en Node. El color, que en el navegador
// pinta en un canvas, llega como función: aquí una que solo entiende rgb()/rgba() y «transparent».
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	gradient,
	luminance,
	px,
	shadows,
	splitTop,
} from "../../../../../kits/capture/parse.ts";

type Rgba = [number, number, number, number];
const color = (c: string): Rgba | null => {
	const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(
		c.trim(),
	);
	if (!m) return null;
	const a = m[4] === undefined ? 1 : Number(m[4]);
	return a === 0 ? null : [Number(m[1]), Number(m[2]), Number(m[3]), a];
};

describe("kit de captura: valores sin DOM", () => {
	it("px lee el número de un valor CSS y da 0 con lo que no lo es", () => {
		assert.equal(px("12.5px"), 12.5);
		assert.equal(px("auto"), 0);
	});

	it("luminance: blanco 1, negro 0", () => {
		assert.equal(luminance([255, 255, 255, 1]), 1);
		assert.equal(luminance([0, 0, 0, 1]), 0);
	});

	it("splitTop parte por las comas de primer nivel, no por las de dentro de paréntesis", () => {
		assert.deepEqual(splitTop("to right, rgb(1, 2, 3) 10%, rgb(4, 5, 6)"), [
			"to right",
			"rgb(1, 2, 3) 10%",
			"rgb(4, 5, 6)",
		]);
	});

	it("shadows: varias sombras con color, desplazamiento, desenfoque, extensión e inset", () => {
		assert.deepEqual(
			shadows(
				"rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgb(255, 0, 0) 2px 4px 6px 1px inset",
				color,
			),
			[
				{ c: [0, 0, 0, 0.1], x: 0, y: 1, b: 3, s: 0, inset: false },
				{ c: [255, 0, 0, 1], x: 2, y: 4, b: 6, s: 1, inset: true },
			],
		);
		assert.deepEqual(shadows("none", color), []);
	});

	it("gradient lineal: ángulo en grados y paradas repartidas si no traen posición", () => {
		assert.deepEqual(
			gradient(
				"linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))",
				100,
				50,
				color,
			),
			{
				angle: 90,
				stops: [
					{ c: [255, 0, 0, 1], p: 0 },
					{ c: [0, 0, 255, 1], p: 1 },
				],
			},
		);
	});

	it("gradient «to right»: 90 grados; con posiciones, las suyas", () => {
		const g = gradient(
			"linear-gradient(to right, rgb(0, 0, 0) 20%, rgb(255, 255, 255) 80%)",
			10,
			10,
			color,
		);
		assert.deepEqual(g, {
			angle: 90,
			stops: [
				{ c: [0, 0, 0, 1], p: 0.2 },
				{ c: [255, 255, 255, 1], p: 0.8 },
			],
		});
	});

	it("gradient radial: el transparente toma el color del vecino con alfa 0", () => {
		assert.deepEqual(
			gradient(
				"radial-gradient(circle, rgb(10, 20, 30) 0%, transparent 100%)",
				10,
				10,
				color,
			),
			{
				radial: true,
				stops: [
					{ c: [10, 20, 30, 1], p: 0 },
					{ c: [10, 20, 30, 0], p: 1 },
				],
			},
		);
	});

	it("sin degradado (o con una sola parada) no hay gradient", () => {
		assert.equal(gradient("none", 1, 1, color), null);
		assert.equal(gradient("linear-gradient(rgb(1, 1, 1))", 1, 1, color), null);
	});
});
