import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	type BuildStep,
	buildStatusOf,
	kitPlanStep,
	kitTarget,
	mergeTouched,
	progressOf,
	STEP_STATUS,
} from "./build.ts";
import { SCRIPT_FORMAT } from "./script-format.ts";

const step = (
	index: number,
	status: BuildStep["status"],
	over: Partial<BuildStep> = {},
): BuildStep => ({
	index,
	file: `s${index}.js`,
	status,
	ms: null,
	touchedCount: 0,
	error: null,
	warning: null,
	result: null,
	...over,
});

const { pending, running, done, failed, skipped, cancelled } = STEP_STATUS;

describe("progressOf: cuántos pasos van y cuál está en curso", () => {
	it("cuenta los terminados, el total y el paso en curso", () => {
		assert.deepEqual(
			progressOf([step(0, done), step(1, running), step(2, pending)]),
			{
				done: 1,
				total: 3,
				cancelled: 0,
				skipped: 0,
				current: { index: 1, file: "s1.js" },
			},
		);
	});

	it("sin paso en curso, current es null", () => {
		assert.deepEqual(progressOf([step(0, done), step(1, done)]), {
			done: 2,
			total: 2,
			cancelled: 0,
			skipped: 0,
			current: null,
		});
	});

	it("done cuenta solo los pasos ejecutados (done y failed); cancelled y skipped se cuentan aparte", () => {
		assert.deepEqual(
			progressOf([
				step(0, done),
				step(1, failed),
				step(2, skipped),
				step(3, cancelled),
				step(4, pending),
			]),
			{ done: 2, total: 5, cancelled: 1, skipped: 1, current: null },
		);
	});

	it("un lote de 4 pasos cancelado durante el 3.º: 3 hechos y 1 cancelado, no 4 de 4", () => {
		assert.deepEqual(
			progressOf([
				step(0, done),
				step(1, done),
				step(2, done),
				step(3, cancelled),
			]),
			{ done: 3, total: 4, cancelled: 1, skipped: 0, current: null },
		);
	});

	it("con fromStep, los omitidos no cuentan como hechos", () => {
		const p = progressOf([
			step(0, skipped),
			step(1, skipped),
			step(2, pending),
			step(3, pending),
			step(4, pending),
		]);
		assert.equal(p.done, 0);
		assert.equal(p.skipped, 2);
	});
});

describe("buildStatusOf: el estado del lote a partir de sus pasos", () => {
	it("en marcha mientras haya un paso pendiente o en curso", () => {
		assert.equal(buildStatusOf([step(0, done), step(1, running)]), running);
		assert.equal(buildStatusOf([step(0, done), step(1, pending)]), "running");
	});

	it("failed si algún paso ya terminado falló", () => {
		assert.equal(buildStatusOf([step(0, done), step(1, failed)]), failed);
	});

	it("cancelled si se canceló y ninguno falló", () => {
		assert.equal(buildStatusOf([step(0, done), step(1, cancelled)]), cancelled);
		assert.equal(
			buildStatusOf([step(0, skipped), step(1, cancelled)]),
			"cancelled",
		);
	});

	it("done si todos terminaron bien (done o skipped)", () => {
		assert.equal(
			buildStatusOf([step(0, done), step(1, skipped), step(2, done)]),
			done,
		);
	});

	it("failed tiene prioridad sobre cancelled", () => {
		assert.equal(buildStatusOf([step(0, failed), step(1, cancelled)]), failed);
	});

	it("con pasos pendientes sigue 'running' aunque uno haya fallado: el estado terminal lo fija el runner (B5)", () => {
		assert.equal(
			buildStatusOf([step(0, done), step(1, failed), step(2, pending)]),
			running,
		);
	});

	it("sin pasos, 'done' (la validación previa descarta lotes vacíos)", () => {
		assert.equal(buildStatusOf([]), done);
	});
});

describe("mergeTouched: unión de los nodos que tocó cada paso", () => {
	it("une sin repetidos conservando el orden de aparición", () => {
		assert.deepEqual(
			mergeTouched([
				["a", "b"],
				["b", "c"],
			]),
			["a", "b", "c"],
		);
	});

	it("sin pasos, lista vacía", () => {
		assert.deepEqual(mergeTouched([]), []);
	});
});

describe("kit/compose@1 en el plan", () => {
	it("su objetivo es la clave del compose y su etiqueta la lleva", () => {
		assert.equal(kitTarget({ step: "kit/compose@1", compose: "alta" }), "alta");
		const planned = kitPlanStep(
			{ use: "kit/compose@1", compose: "alta", timeoutMs: 5 },
			SCRIPT_FORMAT.body,
		);
		assert.equal(planned.file, "kit/compose@1 · alta");
		assert.deepEqual(planned.kit, { step: "kit/compose@1", compose: "alta" });
		assert.equal(planned.timeoutMs, 5);
	});
});
