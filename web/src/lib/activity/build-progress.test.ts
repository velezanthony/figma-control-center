import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { BuildStepItem, CallItem } from "#web/lib/contract.ts";
import {
	buildProgress,
	isBuildCall,
	isCancelledBuild,
	progressTone,
	RESULT_PREVIEW_CHARS,
	stepBadge,
	stepResultView,
} from "./build-progress.ts";

const step = (over: Partial<BuildStepItem>): BuildStepItem => ({
	index: 0,
	file: "build_home.js",
	status: "pending",
	ms: null,
	touchedCount: 0,
	error: null,
	warning: null,
	result: null,
	...over,
});

const entry = (over: Partial<CallItem>): CallItem => ({
	callId: "a",
	sessionId: "s",
	fileUrl: null,
	tool: "figma_build",
	startedAt: "x",
	args: {},
	status: "ok",
	ms: 1,
	retryable: null,
	touchedNodeIds: [],
	error: null,
	resultPath: null,
	jobId: "job-1",
	job: null,
	screenshots: [],
	summary: "",
	...over,
});

describe("buildProgress", () => {
	it("cuenta los pasos terminados y señala el que está en curso", () => {
		assert.deepEqual(
			buildProgress([
				step({ index: 0, status: "done" }),
				step({ index: 1, file: "swap.js", status: "running" }),
				step({ index: 2, file: "publish.js", status: "pending" }),
			]),
			{
				done: 1,
				total: 3,
				cancelled: 0,
				skipped: 0,
				current: { index: 1, file: "swap.js" },
			},
		);
	});

	it("done cuenta solo los ejecutados (done y failed); cancelled y skipped van aparte", () => {
		assert.deepEqual(
			buildProgress([
				step({ index: 0, status: "done" }),
				step({ index: 1, status: "failed" }),
				step({ index: 2, status: "skipped" }),
				step({ index: 3, status: "cancelled" }),
			]),
			{ done: 2, total: 4, cancelled: 1, skipped: 1, current: null },
		);
	});

	it("sin pasos, 0 de 0 y sin paso en curso", () => {
		assert.deepEqual(buildProgress([]), {
			done: 0,
			total: 0,
			cancelled: 0,
			skipped: 0,
			current: null,
		});
	});
});

describe("progressTone", () => {
	it("un lote cancelado sin fallos no va en rojo; rojo solo si algún paso falló", () => {
		const cancelled = [
			step({ index: 0, status: "done" }),
			step({ index: 1, status: "cancelled" }),
		];
		assert.notEqual(progressTone(cancelled), "danger");
		assert.equal(
			progressTone([...cancelled, step({ index: 2, status: "failed" })]),
			"danger",
		);
	});
});

describe("stepBadge", () => {
	it("cada estado de paso mapea a una variante, un texto y un término del glosario", () => {
		assert.deepEqual(stepBadge("running"), {
			variant: "warning",
			text: "En curso",
			term: "step.running",
		});
		assert.deepEqual(stepBadge("done"), {
			variant: "success",
			text: "Hecho",
			term: "step.done",
		});
		assert.deepEqual(stepBadge("failed"), {
			variant: "danger",
			text: "Fallo",
			term: "step.failed",
		});
		assert.equal(stepBadge("pending").variant, "secondary");
		assert.equal(stepBadge("skipped").variant, "secondary");
		assert.equal(stepBadge("cancelled").variant, "secondary");
	});
});

describe("isBuildCall", () => {
	it("solo una llamada a figma_build es un lote", () => {
		assert.equal(isBuildCall(entry({ tool: "figma_build" })), true);
		assert.equal(isBuildCall(entry({ tool: "figma_run_script" })), false);
	});
});

describe("isCancelledBuild", () => {
	it("verdadero solo si el job terminó cancelado", () => {
		const job = (status: "running" | "done" | "failed" | "cancelled") => ({
			status,
			ms: null,
			error: null,
			touchedNodeIds: [],
		});
		assert.equal(isCancelledBuild(entry({ job: job("cancelled") })), true);
		assert.equal(isCancelledBuild(entry({ job: job("running") })), false);
		assert.equal(isCancelledBuild(entry({ job: null })), false);
	});
});

describe("stepResultView: qué se enseña del resultado de un paso", () => {
	it("un extracto sin recortar sale tal cual", () => {
		const v = stepResultView(
			step({
				status: "done",
				result: {
					kind: "inline",
					excerpt: '{"log":["a"]}',
					bytes: 13,
					truncated: false,
				},
			}),
		);
		assert.deepEqual(v, {
			kind: "excerpt",
			text: '{"log":["a"]}',
			bytes: 13,
			truncated: false,
		});
	});

	it("un extracto recortado lo dice y trae cuánto ocupa entero", () => {
		const v = stepResultView(
			step({
				status: "done",
				result: {
					kind: "inline",
					excerpt: '{"log":["a"',
					bytes: 5000,
					truncated: true,
				},
			}),
		);
		assert.deepEqual(v, {
			kind: "excerpt",
			text: '{"log":["a"',
			bytes: 5000,
			truncated: true,
		});
	});

	it("con el resultado entero ya pedido sale legible", () => {
		const v = stepResultView(
			step({
				status: "done",
				result: {
					kind: "inline",
					excerpt: '{"log":["a"',
					bytes: 5000,
					truncated: true,
				},
			}),
			{ kind: "inline", value: { log: ["a"] } },
		);
		assert.deepEqual(v, {
			kind: "text",
			text: '{\n  "log": [\n    "a"\n  ]\n}',
			hiddenChars: 0,
		});
	});

	it("el resultado entero más largo que la vista previa se recorta y dice cuántos caracteres faltan", () => {
		const value = { texto: "x".repeat(RESULT_PREVIEW_CHARS * 2) };
		const full = JSON.stringify(value, null, 2);
		const v = stepResultView(
			step({
				status: "done",
				result: { kind: "inline", excerpt: "{", bytes: 9999, truncated: true },
			}),
			{ kind: "inline", value },
		);
		assert.ok(v.kind === "text");
		assert.equal(v.text.length, RESULT_PREVIEW_CHARS);
		assert.equal(v.hiddenChars, full.length - RESULT_PREVIEW_CHARS);
		assert.equal(v.text, full.slice(0, RESULT_PREVIEW_CHARS));
	});

	it("un resultado en fichero da la ruta y los bytes", () => {
		const v = stepResultView(
			step({
				status: "done",
				result: { kind: "file", path: "/salida/result-1.json", bytes: 90_000 },
			}),
		);
		assert.deepEqual(v, {
			kind: "file",
			path: "/salida/result-1.json",
			bytes: 90_000,
		});
	});

	it("un paso hecho, omitido o cancelado sin resultado dice que no hay resultado guardado", () => {
		for (const status of ["done", "skipped", "cancelled"] as const) {
			assert.deepEqual(stepResultView(step({ status })), {
				kind: "none",
				text: "Sin resultado guardado",
			});
		}
	});

	it("un paso pendiente, en curso o fallido no enseña nada", () => {
		for (const status of ["pending", "running", "failed"] as const) {
			assert.deepEqual(stepResultView(step({ status })), { kind: "hidden" });
		}
	});
});
