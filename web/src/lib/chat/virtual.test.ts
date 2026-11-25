import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	applyMeasurements,
	buildOffsets,
	captureAnchor,
	includeIndex,
	indexAt,
	keysInView,
	restoreAnchor,
	visibleRange,
} from "./virtual.ts";

const EST = 100;

describe("buildOffsets: la posición de cada elemento con alturas variables", () => {
	it("sin medir nada, todos valen la estimación y el último desplazamiento es el total", () => {
		assert.deepEqual(
			buildOffsets(["a", "b", "c"], new Map(), EST),
			[0, 100, 200, 300],
		);
	});

	it("un elemento medido usa su altura real y empuja a los de debajo", () => {
		const offsets = buildOffsets(["a", "b", "c"], new Map([["b", 250]]), EST);
		assert.deepEqual(offsets, [0, 100, 350, 450]);
	});

	it("una lista vacía mide cero", () => {
		assert.deepEqual(buildOffsets([], new Map(), EST), [0]);
	});
});

describe("indexAt", () => {
	const offsets = [0, 100, 350, 450];

	it("devuelve el elemento que contiene esa coordenada", () => {
		assert.equal(indexAt(offsets, 0), 0);
		assert.equal(indexAt(offsets, 99), 0);
		assert.equal(indexAt(offsets, 100), 1);
		assert.equal(indexAt(offsets, 349), 1);
		assert.equal(indexAt(offsets, 350), 2);
	});

	it("se acota a los extremos", () => {
		assert.equal(indexAt(offsets, -50), 0);
		assert.equal(indexAt(offsets, 450), 2);
		assert.equal(indexAt(offsets, 99999), 2);
	});

	it("coincide con una búsqueda lineal en una lista grande con alturas irregulares", () => {
		const keys = Array.from({ length: 2000 }, (_, i) => i);
		const heights = new Map(keys.map((k) => [k, 40 + ((k * 37) % 300)]));
		const big = buildOffsets(keys, heights, EST);
		const linear = (y: number) => {
			let i = 0;
			while (i < keys.length - 1 && (big[i + 1] ?? 0) <= y) i++;
			return i;
		};
		for (const y of [0, 1, 777, 12345, 99999, 250000, 400000]) {
			assert.equal(indexAt(big, y), linear(y), String(y));
		}
	});
});

describe("visibleRange: qué se monta (lo visible más un colchón arriba y abajo)", () => {
	const keys = Array.from({ length: 100 }, (_, i) => i);
	const offsets = buildOffsets(keys, new Map(), EST);

	it("sin colchón, solo lo que toca el viewport", () => {
		assert.deepEqual(visibleRange(offsets, 1000, 300, 0), {
			start: 10,
			end: 13,
		});
	});

	it("el colchón añade elementos por encima y por debajo", () => {
		assert.deepEqual(visibleRange(offsets, 1000, 300, 200), {
			start: 8,
			end: 15,
		});
	});

	it("en los extremos no se sale de la lista", () => {
		assert.deepEqual(visibleRange(offsets, 0, 300, 500), { start: 0, end: 8 });
		assert.deepEqual(visibleRange(offsets, 9700, 300, 500), {
			start: 92,
			end: 100,
		});
	});

	it("una lista vacía no monta nada", () => {
		assert.deepEqual(visibleRange([0], 0, 300, 100), { start: 0, end: 0 });
	});

	it("el número de montados no depende de cuántos mensajes hay", () => {
		const many = buildOffsets(
			Array.from({ length: 50000 }, (_, i) => i),
			new Map(),
			EST,
		);
		const r = visibleRange(many, 2_000_000, 800, 800);
		assert.ok(r.end - r.start <= 26, `${r.end - r.start}`);
	});
});

describe("includeIndex: un elemento con el foco no se desmonta", () => {
	it("amplía el rango hasta cubrirlo, por arriba o por abajo, y si ya está dentro no cambia", () => {
		assert.deepEqual(includeIndex({ start: 10, end: 15 }, 12, 100), {
			start: 10,
			end: 15,
		});
		assert.deepEqual(includeIndex({ start: 10, end: 15 }, 4, 100), {
			start: 4,
			end: 15,
		});
		assert.deepEqual(includeIndex({ start: 10, end: 15 }, 20, 100), {
			start: 10,
			end: 21,
		});
	});

	it("un índice fuera de la lista se ignora", () => {
		assert.deepEqual(includeIndex({ start: 10, end: 15 }, -1, 100), {
			start: 10,
			end: 15,
		});
		assert.deepEqual(includeIndex({ start: 10, end: 15 }, 100, 100), {
			start: 10,
			end: 15,
		});
	});
});

describe("anclaje del scroll: lo que se ve no salta cuando cambia lo de arriba", () => {
	const keys = ["a", "b", "c", "d"];

	it("captureAnchor guarda el elemento bajo el borde superior y cuánto se ha entrado en él", () => {
		const offsets = buildOffsets(keys, new Map(), EST);
		assert.deepEqual(captureAnchor(keys, offsets, 250), {
			key: "c",
			delta: 50,
		});
	});

	it("si un elemento de arriba se mide más alto, el scroll se desplaza lo mismo y el ancla no se mueve en pantalla", () => {
		const before = buildOffsets(keys, new Map(), EST);
		const anchor = captureAnchor(keys, before, 250);
		assert.ok(anchor);
		const after = buildOffsets(keys, new Map([["a", 180]]), EST);
		assert.equal(restoreAnchor(anchor, keys, after), 330);
	});

	it("si se anteponen mensajes más antiguos, el scroll baja lo que ocupan y se sigue viendo lo mismo", () => {
		const before = buildOffsets(keys, new Map(), EST);
		const anchor = captureAnchor(keys, before, 250);
		assert.ok(anchor);
		const withOlder = ["x", "y", ...keys];
		const after = buildOffsets(withOlder, new Map(), EST);
		assert.equal(restoreAnchor(anchor, withOlder, after), 450);
	});

	it("un cambio por debajo del ancla no la mueve", () => {
		const before = buildOffsets(keys, new Map(), EST);
		const anchor = captureAnchor(keys, before, 250);
		assert.ok(anchor);
		const after = buildOffsets(keys, new Map([["d", 500]]), EST);
		assert.equal(restoreAnchor(anchor, keys, after), 250);
	});

	it("si el ancla ya no existe no se puede restaurar (null) y una lista vacía no tiene ancla", () => {
		const offsets = buildOffsets(keys, new Map(), EST);
		const anchor = captureAnchor(keys, offsets, 10);
		assert.ok(anchor);
		assert.equal(restoreAnchor(anchor, ["z"], [0, 100]), null);
		assert.equal(captureAnchor([], [0], 0), null);
	});
});

describe("applyMeasurements", () => {
	it("anota las alturas nuevas y avisa de si algo cambió", () => {
		const heights = new Map<string, number>();
		assert.equal(applyMeasurements(heights, [["a", 120.2]]), true);
		assert.equal(heights.get("a"), 120.2);
	});

	it("una variación de menos de medio píxel es ruido de redondeo y no cuenta", () => {
		const heights = new Map([["a", 120]]);
		assert.equal(applyMeasurements(heights, [["a", 120.4]]), false);
		assert.equal(heights.get("a"), 120);
		assert.equal(applyMeasurements(heights, [["a", 121]]), true);
	});

	it("ignora alturas no válidas (un elemento oculto mide 0)", () => {
		const heights = new Map<string, number>();
		assert.equal(
			applyMeasurements(heights, [
				["a", 0],
				["b", Number.NaN],
			]),
			false,
		);
		assert.equal(heights.size, 0);
	});
});

describe("keysInView: qué elementos se ven de verdad en la pantalla", () => {
	// Tres elementos de 100 px: 0-100, 100-200, 200-300
	const offsets = [0, 100, 200, 300];
	const k = ["a", "b", "c"];

	it("devuelve los que asoman al menos el mínimo, o enteros si son más bajos que el mínimo", () => {
		assert.deepEqual(keysInView(k, offsets, 0, 150, 40), ["a", "b"]);
		// b asoma solo 30 px (170-200): no cuenta
		assert.deepEqual(keysInView(k, offsets, 170, 100, 40), ["c"]);
	});

	it("un elemento más bajo que el mínimo cuenta si se ve entero", () => {
		assert.deepEqual(keysInView(["x"], [0, 20], 0, 100, 40), ["x"]);
	});

	it("sin pantalla o sin elementos, nada", () => {
		assert.deepEqual(keysInView(k, offsets, 0, 0, 40), []);
		assert.deepEqual(keysInView([], [0], 0, 100, 40), []);
	});
});
