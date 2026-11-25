import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathsOfCall, toolProblem, UNKNOWN_TOOL } from "./agent-guard-rules.ts";
import { AGENT_SERVER } from "./agent-harness.ts";

const mcp = (name: string) => `mcp__${AGENT_SERVER}__${name}`;

describe("pathsOfCall: el guardián reconoce las herramientas por TOOL_NAME", () => {
	it("las lecturas del catálogo (M3) y figma_design_context son conocidas y no llevan rutas", () => {
		for (const tool of [
			"figma_variables",
			"figma_styles",
			"figma_components",
			"figma_instances",
			"figma_export",
			"figma_design_context",
		]) {
			assert.deepEqual(
				pathsOfCall(mcp(tool), { nodeIds: ["1:2"], pages: ["P"] }),
				{ ok: true, value: [] },
				tool,
			);
		}
	});

	it("figma_capture es conocida y sus pantallas son claves, no rutas", () => {
		assert.deepEqual(
			pathsOfCall(mcp("figma_capture"), {
				screens: ["inicio"],
				allowPageWorld: true,
			}),
			{ ok: true, value: [] },
		);
	});

	it("una herramienta que no está en TOOL_NAME se deniega por desconocida", () => {
		const r = pathsOfCall(mcp("figma_inventada"), {});
		assert.ok(!r.ok);
		assert.match(r.error, new RegExp(UNKNOWN_TOOL));
	});
});

describe("toolProblem: el agente del chat solo consulta", () => {
	it("las herramientas que escriben ficheros, cambian Figma o capturan la web se deniegan con el motivo", () => {
		for (const tool of [
			"Write",
			"Edit",
			"NotebookEdit",
			mcp("figma_run_script"),
			mcp("figma_build"),
			mcp("figma_cancel_job"),
			mcp("figma_capture"),
		]) {
			assert.match(toolProblem(tool) ?? "", /solo consulta/, tool);
		}
	});

	it("las lecturas, el histórico y la respuesta al chat pasan", () => {
		for (const tool of [
			"Read",
			"Glob",
			"Grep",
			mcp("figma_status"),
			mcp("figma_history_summary"),
			mcp("figma_chat_reply"),
		]) {
			assert.equal(toolProblem(tool), null, tool);
		}
	});
});
