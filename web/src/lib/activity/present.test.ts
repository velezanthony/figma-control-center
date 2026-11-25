import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CallItem } from "#web/lib/contract.ts";
import { argSummary, callLabel, jobLabel } from "./present.ts";

const entry = (over: Partial<CallItem>): CallItem => ({
	callId: "a",
	sessionId: "s",
	fileUrl: null,
	tool: "t",
	startedAt: "x",
	args: {},
	status: "ok",
	ms: 1,
	retryable: null,
	touchedNodeIds: [],
	error: null,
	resultPath: null,
	jobId: null,
	job: null,
	screenshots: [],
	summary: "",
	...over,
});

describe("callLabel", () => {
	it("en curso, correcto y error con su tipo", () => {
		assert.deepEqual(callLabel(entry({ status: "running" })), {
			tone: "running",
			text: "En curso",
			term: "status.running",
		});
		assert.deepEqual(callLabel(entry({})), {
			tone: "ok",
			text: "Correcto",
			term: "status.ok",
		});
		const error = {
			type: "ScriptError",
			message: "m",
			nextStep: null,
			line: 3,
		};
		assert.deepEqual(callLabel(entry({ status: "error", error })), {
			tone: "error",
			text: "ScriptError",
			term: "ScriptError",
		});
	});

	it("un tipo de error que el glosario no conoce cae en el término genérico de error", () => {
		const error = {
			type: "Rarisimo",
			message: "m",
			nextStep: null,
			line: null,
		};
		assert.equal(
			callLabel(entry({ status: "error", error })).term,
			"status.error",
		);
	});
});

describe("jobLabel", () => {
	it("sin job no hay etiqueta; con job, su estado", () => {
		assert.equal(jobLabel(entry({})), null);
		const job = (status: "running" | "done" | "failed" | "cancelled") => ({
			status,
			ms: null,
			error: null,
			touchedNodeIds: [],
		});
		assert.equal(jobLabel(entry({ job: job("running") }))?.tone, "running");
		assert.equal(jobLabel(entry({ job: job("done") }))?.tone, "ok");
		assert.equal(jobLabel(entry({ job: job("failed") }))?.tone, "error");
		assert.deepEqual(jobLabel(entry({ job: job("cancelled") })), {
			tone: "cancelled",
			text: "Job cancelado",
			term: "status.jobCancelled",
		});
	});
});

describe("argSummary", () => {
	it("un lote por manifiesto enseña el manifiesto", () => {
		assert.equal(
			argSummary(entry({ args: { manifest: "lotes/area.json" } })),
			"lotes/area.json",
		);
	});

	it("un lote por steps enseña «N pasos · fichero»", () => {
		assert.equal(
			argSummary(entry({ args: { stepCount: 3, firstFile: "build_a.js" } })),
			"3 pasos · build_a.js",
		);
		assert.equal(
			argSummary(entry({ args: { stepCount: 1, firstFile: "build_a.js" } })),
			"1 paso · build_a.js",
		);
	});

	it("un script por ruta sigue enseñando la ruta", () => {
		assert.equal(
			argSummary(entry({ args: { file: "scripts/x.js" } })),
			"scripts/x.js",
		);
	});
});
