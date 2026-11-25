import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type CallSummaryInput, summarizeCall } from "./call-summary.ts";
import { isWriteTool, TOOL_NAME } from "./tool-names.ts";

const base: CallSummaryInput = {
	tool: "figma_run_script",
	args: { file: "scripts/x.js" },
	status: "ok",
	ms: 180,
	touchedCount: 3,
	errorType: null,
};

describe("summarizeCall (frase corta que se indexa y ve primero el agente)", () => {
	it("una llamada correcta dice herramienta, objetivo, nodos y duración", () => {
		assert.equal(
			summarizeCall(base),
			"figma_run_script scripts/x.js → 3 nodos, 180 ms",
		);
	});

	it("un solo nodo va en singular", () => {
		assert.equal(
			summarizeCall({ ...base, touchedCount: 1 }),
			"figma_run_script scripts/x.js → 1 nodo, 180 ms",
		);
	});

	it("sin nodos tocados dice ok", () => {
		assert.equal(
			summarizeCall({ ...base, touchedCount: 0 }),
			"figma_run_script scripts/x.js → ok, 180 ms",
		);
	});

	it("un error nombra su tipo", () => {
		assert.equal(
			summarizeCall({ ...base, status: "error", errorType: "ScriptError" }),
			"figma_run_script scripts/x.js → error ScriptError, 180 ms",
		);
	});

	it("una llamada en curso no lleva duración", () => {
		assert.equal(
			summarizeCall({ ...base, status: "running", ms: null }),
			"figma_run_script scripts/x.js → en curso",
		);
	});

	it("el objetivo sale de file, nodeId o jobId, en ese orden", () => {
		assert.equal(
			summarizeCall({
				...base,
				tool: "figma_screenshot",
				args: { nodeId: "1:23" },
			}),
			"figma_screenshot 1:23 → 3 nodos, 180 ms",
		);
		assert.equal(
			summarizeCall({ ...base, tool: "figma_get_job", args: { jobId: "abc" } }),
			"figma_get_job abc → 3 nodos, 180 ms",
		);
	});

	it("un lote resume su manifiesto y los nodos tocados", () => {
		assert.equal(
			summarizeCall({
				...base,
				tool: "figma_build",
				args: { manifest: "scripts/app.json" },
			}),
			"figma_build scripts/app.json → 3 nodos, 180 ms",
		);
	});

	it("un código inline se resume por su tamaño, sin copiarlo", () => {
		assert.equal(
			summarizeCall({
				...base,
				args: { codeLength: 42, codePreview: "return 1" },
			}),
			"figma_run_script código inline (42 car.) → 3 nodos, 180 ms",
		);
	});

	it("sin objetivo, solo la herramienta; la duración se redondea al mostrar", () => {
		assert.equal(
			summarizeCall({
				...base,
				tool: "figma_status",
				args: {},
				touchedCount: 0,
				ms: 12.6,
			}),
			"figma_status → ok, 13 ms",
		);
	});
});

describe("isWriteTool", () => {
	it("escriben las que cambian el archivo: run_script, build y cancel_job", () => {
		for (const t of [
			TOOL_NAME.runScript,
			TOOL_NAME.build,
			TOOL_NAME.cancelJob,
		]) {
			assert.equal(isWriteTool(t), true, t);
		}
	});

	it("las de solo lectura no escriben", () => {
		for (const t of [
			TOOL_NAME.getJob,
			TOOL_NAME.status,
			TOOL_NAME.screenshot,
			TOOL_NAME.metadata,
		]) {
			assert.equal(isWriteTool(t), false, t);
		}
	});

	it("las lecturas del catálogo (M3) y figma_design_context existen y no escriben (CA-9, CA-7)", () => {
		const reads = [
			TOOL_NAME.variables,
			TOOL_NAME.styles,
			TOOL_NAME.components,
			TOOL_NAME.instances,
			TOOL_NAME.export,
			TOOL_NAME.designContext,
		];
		assert.deepEqual(reads, [
			"figma_variables",
			"figma_styles",
			"figma_components",
			"figma_instances",
			"figma_export",
			"figma_design_context",
		]);
		for (const t of reads) assert.equal(isWriteTool(t), false, t);
	});
});

describe("summarizeCall: objetivo de las lecturas del catálogo", () => {
	const read = (tool: string, args: CallSummaryInput["args"]) =>
		summarizeCall({ ...base, tool, args, touchedCount: 0 });

	it("figma_variables con colección la nombra", () => {
		assert.equal(
			read("figma_variables", { collection: "Tokens" }),
			"figma_variables Tokens → ok, 180 ms",
		);
	});

	it("figma_instances nombra la página, o la primera y cuántas más", () => {
		assert.equal(
			read("figma_instances", { pageCount: 1, firstPage: "Pantallas" }),
			"figma_instances Pantallas → ok, 180 ms",
		);
		assert.equal(
			read("figma_instances", { pageCount: 3, firstPage: "Pantallas" }),
			"figma_instances Pantallas (+2) → ok, 180 ms",
		);
	});

	it("figma_export nombra el nodo, o el primero y cuántos más", () => {
		assert.equal(
			read("figma_export", { nodeIdCount: 1, firstNodeId: "10:1" }),
			"figma_export 10:1 → ok, 180 ms",
		);
		assert.equal(
			read("figma_export", { nodeIdCount: 4, firstNodeId: "10:1" }),
			"figma_export 10:1 (+3) → ok, 180 ms",
		);
	});

	it("figma_design_context nombra el nodo", () => {
		assert.equal(
			read("figma_design_context", { nodeId: "10:1", screenshot: true }),
			"figma_design_context 10:1 → ok, 180 ms",
		);
	});

	it("figma_capture: la primera pantalla y cuántas más", () => {
		assert.equal(
			summarizeCall({
				tool: "figma_capture",
				args: { screenCount: 3, firstScreen: "inicio" },
				status: "ok",
				ms: 1200,
				touchedCount: 0,
				errorType: null,
			}),
			"figma_capture inicio (+2) → ok, 1200 ms",
		);
	});
});
