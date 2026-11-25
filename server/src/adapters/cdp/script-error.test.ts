import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIT_FAIL_MARKER, NODE_NOT_FOUND_MARKER } from "./protocol.ts";
import { toScriptError } from "./script-error.ts";

// Pilas reales capturadas por CDP en la pestaña de Figma (script `body`: el envoltorio añade 1 línea)
const FIGMA_INTERNAL = {
	text: "Uncaught (in promise)",
	lineNumber: 0,
	exception: {
		className: "Error",
		description: [
			"Error: in setPluginData: Cannot set private plugin data in a plugin without an ID.",
			"    at DocumentNode.setPluginData (https://www.figma.com/webpack-artifacts/assets/72549-7b27ea17bc462b5e.min.js.br:392:72175)",
			"    at <anonymous>:3:12",
			"    at <anonymous>:4:3",
		].join("\n"),
	},
};

const OWN_THROW = {
	text: "Uncaught (in promise)",
	lineNumber: 0,
	exception: {
		className: "Error",
		description: "Error: mio\n    at <anonymous>:4:7\n    at <anonymous>:5:3",
	},
};

describe("toScriptError con el kit de Figma", () => {
	const failure = (extra: string) => ({
		text: "Uncaught (in promise)",
		lineNumber: 0,
		exception: {
			className: "Error",
			description: `Error: ${KIT_FAIL_MARKER}${JSON.stringify({ code: "SIN_SET", message: "No hay set «Botón»", next: "Mira figma_components" })}\n${extra}`,
		},
	});

	it("la marca del kit es la misma en el servidor y en el kit (no puede importarse: se comparan aquí)", async () => {
		const { FAIL_MARKER } = await import("../../../../kits/figma/types.ts");
		assert.equal(KIT_FAIL_MARKER, FAIL_MARKER);
	});

	it("kit.fail: ScriptError con el código delante del mensaje, la línea del paso y el siguiente paso del kit", () => {
		const error = toScriptError(
			failure("    at figma-kit@1.js:5:9\n    at <anonymous>:4:7"),
			1,
		);
		assert.equal(error.type, "ScriptError");
		assert.equal(error.message, "SIN_SET: No hay set «Botón» (línea 3)");
		assert.equal(error.type === "ScriptError" && error.line, 3);
		assert.equal(error.nextStep, "Mira figma_components");
		assert.equal(error.retryable, false);
	});

	it("un error que salta dentro del kit da la línea del paso que lo llamó, no la del kit", () => {
		const error = toScriptError(
			{
				text: "Uncaught (in promise)",
				lineNumber: 0,
				exception: {
					className: "TypeError",
					description:
						"TypeError: x is undefined\n    at pageFind (figma-kit@1.js:120:11)\n    at <anonymous>:6:20",
				},
			},
			1,
		);
		assert.equal(error.type === "ScriptError" && error.line, 5);
	});

	it("un mensaje de kit.fail ilegible cae en el error normal", () => {
		const error = toScriptError(
			{
				text: "Uncaught (in promise)",
				exception: {
					className: "Error",
					description: `Error: ${KIT_FAIL_MARKER}{no es json\n    at <anonymous>:2:1`,
				},
			},
			1,
		);
		assert.equal(error.type, "ScriptError");
		assert.match(error.nextStep, /excepción/);
	});
});

describe("toScriptError", () => {
	it("el nodo que no existe es NodeNotFound con su id y sin línea del envoltorio", () => {
		const error = toScriptError(
			{
				text: "Uncaught (in promise)",
				lineNumber: 0,
				exception: {
					className: "Error",
					description: `Error: ${NODE_NOT_FOUND_MARKER}9:9\n    at <anonymous>:5:7`,
				},
			},
			1,
		);
		assert.equal(error.type, "NodeNotFound");
		assert.equal(error.type === "NodeNotFound" && error.nodeId, "9:9");
		assert.doesNotMatch(error.message, /línea/);
		assert.equal(error.retryable, false);
	});

	it("un error lanzado dentro del código de Figma señala la línea del script, no la del bundle de Figma", () => {
		const error = toScriptError(FIGMA_INTERNAL, 1);
		assert.equal(error.type === "ScriptError" && error.line, 2);
	});

	it("un throw del propio script señala su línea descontando el envoltorio", () => {
		const error = toScriptError(OWN_THROW, 1);
		assert.equal(error.type === "ScriptError" && error.line, 3);
	});

	it("sin ningún marco del script no inventa una línea", () => {
		const error = toScriptError(
			{
				text: "Uncaught",
				lineNumber: 0,
				exception: {
					className: "Error",
					description: "Error: x\n    at f (https://www.figma.com/a.js:10:2)",
				},
			},
			1,
		);
		assert.equal(error.type === "ScriptError" && error.line, null);
	});
});
