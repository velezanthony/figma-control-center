// Escenarios de los E2E herméticos. Los ejemplos se CONSTRUYEN desde los contratos (server/test/contracts/):
// no son copias de salidas reales. Cada escenario se reconoce por el marcador `// @scenario: <id>` de su script.
import { join } from "node:path";
import {
	FIGMA_BUNDLE_ORIGIN,
	SCRIPT_ORIGIN,
} from "../../contracts/cdp.ts";
import { KIT_FAIL_MARKER } from "#adapters/cdp/protocol.ts";
import { WriteResultSchema } from "../../contracts/figma-values.ts";

export const SCRIPTS_DIR = join(import.meta.dirname, "scripts");
export const SCENARIO_MARKER = /@scenario:\s*([\w-]+)/;

// Marcadores de línea dentro de los scripts: el simulador informa la línea donde aparecen, como haría Chrome
export const LINE_MARKER = Object.freeze({
	syntax: "@error-here",
	throws: "@throw-here",
	hang: "@hang-here",
} as const);

export type ScenarioReply =
	| { readonly kind: "value"; readonly value: unknown }
	| { readonly kind: "syntaxError"; readonly message: string }
	| { readonly kind: "runtimeError"; readonly name: string; readonly message: string }
	// El error salta dentro del API de Figma: los primeros marcos son de su bundle, y el del script va después
	| { readonly kind: "figmaInternalError"; readonly name: string; readonly message: string }
	| { readonly kind: "hang" }
	// Espera a que el test libere la puerta (control determinista del tiempo)
	| { readonly kind: "gated"; readonly gate: string; readonly value: unknown };

export type Scenario = {
	readonly id: string;
	readonly script: string;
	readonly format: "body" | "function";
	readonly reply: ScenarioReply;
};

const created = WriteResultSchema.parse({
	createdNodeIds: ["10:1", "10:2"],
	mutatedNodeIds: ["10:3"],
});
const slept = WriteResultSchema.parse({ mutatedNodeIds: ["10:4"] });

export const SCENARIOS = {
	writeCreated: {
		id: "write-created",
		script: "write-created.js",
		format: "body",
		reply: { kind: "value", value: created },
	},
	longRunning: {
		id: "long-running",
		script: "long-running.js",
		format: "body",
		reply: {
			kind: "gated",
			gate: "long-running",
			value: { ...slept, slept: true },
		},
	},
	readValue: {
		id: "read-value",
		script: "read-value.js",
		format: "body",
		reply: { kind: "value", value: { pages: 3, current: "Inicio" } },
	},
	errorSyntax: {
		id: "error-syntax",
		script: "error-syntax.js",
		format: "function",
		reply: { kind: "syntaxError", message: "Unexpected token ';'" },
	},
	errorRuntime: {
		id: "error-runtime",
		script: "error-runtime.js",
		format: "body",
		reply: {
			kind: "runtimeError",
			name: "TypeError",
			message: "Cannot read properties of undefined (reading 'name')",
		},
	},
	errorFigmaInternal: {
		id: "error-figma-internal",
		script: "error-figma-internal.js",
		format: "body",
		reply: {
			kind: "figmaInternalError",
			name: "Error",
			message: "Error: in set_fills: Expected an array of paints",
		},
	},
	errorTimeout: {
		id: "error-timeout",
		script: "error-timeout.js",
		format: "body",
		reply: { kind: "hang" },
	},
	// Pasos de un lote (E14–E17): cada uno declara los nodos que toca, construidos desde el contrato de escritura.
	buildStepOkA: {
		id: "build-step-ok-a",
		script: "build-step-ok-a.js",
		format: "body",
		reply: {
			kind: "value",
			value: WriteResultSchema.parse({ createdNodeIds: ["11:1"] }),
		},
	},
	buildStepOkB: {
		id: "build-step-ok-b",
		script: "build-step-ok-b.js",
		format: "body",
		reply: {
			kind: "value",
			value: WriteResultSchema.parse({ createdNodeIds: ["11:2"] }),
		},
	},
	buildStepOkC: {
		id: "build-step-ok-c",
		script: "build-step-ok-c.js",
		format: "body",
		reply: {
			kind: "value",
			value: WriteResultSchema.parse({ createdNodeIds: ["11:3"] }),
		},
	},
	// Paso lento: espera a que el test libere la puerta (control determinista del tiempo del lote).
	buildStepSlow: {
		id: "build-step-slow",
		script: "build-step-slow.js",
		format: "body",
		reply: {
			kind: "gated",
			gate: "build-step-slow",
			value: WriteResultSchema.parse({ mutatedNodeIds: ["11:4"] }),
		},
	},
	// Paso con un resultado mayor que el tope en línea (FCC_MAX_INLINE_RESULT_BYTES): va a fichero.
	buildStepBigResult: {
		id: "build-step-big-result",
		script: "build-step-big-result.js",
		format: "body",
		reply: {
			kind: "value",
			value: WriteResultSchema.parse({
				mutatedNodeIds: ["11:5"],
				log: Array.from({ length: 3000 }, (_, i) => `enlace ${i}`),
			}),
		},
	},
	// Paso que falla en ejecución (error con fichero y línea, @throw-here).
	buildStepMediumResult: {
		id: "build-step-medium-result",
		script: "build-step-medium-result.js",
		format: "body",
		reply: {
			kind: "value",
			value: WriteResultSchema.parse({
				mutatedNodeIds: ["11:6"],
				log: Array.from({ length: 150 }, (_, i) => `enlace ${i}`),
			}),
		},
	},
	buildStepFail: {
		id: "build-step-fail",
		script: "build-step-fail.js",
		format: "body",
		reply: {
			kind: "runtimeError",
			name: "TypeError",
			message: "Cannot read properties of undefined (reading 'name')",
		},
	},
	// step@1 (F2, E63): la primera línea del script lleva `// @contract step@1` y el resultado se juzga
	stepOk: {
		id: "step-ok",
		script: "step-ok.js",
		format: "body",
		reply: {
			kind: "value",
			value: {
				createdNodeIds: ["12:1"],
				mutatedNodeIds: ["12:2"],
				warnings: [{ code: "MULTI_MODE", message: "colección con dos modos" }],
			},
		},
	},
	stepEmpty: {
		id: "step-empty",
		script: "step-empty.js",
		format: "body",
		reply: { kind: "value", value: { createdNodeIds: [], mutatedNodeIds: [] } },
	},
	// Resultado que NO cumple step@1: un id que no es texto
	stepBad: {
		id: "step-bad",
		script: "step-bad.js",
		format: "body",
		reply: {
			kind: "value",
			value: { createdNodeIds: ["12:3", 7], mutatedNodeIds: ["12:4"] },
		},
	},
	// kit.fail dentro del paso: el error lleva la marca del kit con el código, el mensaje y el siguiente paso
	stepKitFail: {
		id: "step-kit-fail",
		script: "step-kit-fail.js",
		format: "body",
		reply: {
			kind: "runtimeError",
			name: "Error",
			message: `${KIT_FAIL_MARKER}${JSON.stringify({ code: "SIN_SET", message: "No hay set «Botón»", next: "Mira figma_components" })}`,
		},
	},
} as const satisfies Record<string, Scenario>;

export type ScenarioKey = keyof typeof SCENARIOS;

// Marcos del bundle de Figma que preceden al del script cuando el error salta dentro de su API.
// Su línea es a propósito distinta de cualquier línea del script: si el adaptador la usara, el test lo vería
export const FIGMA_INTERNAL_FRAMES = [
	{ fn: "Object.set", origin: FIGMA_BUNDLE_ORIGIN, line: 2, column: 48211 },
	{ fn: "validatePaints", origin: FIGMA_BUNDLE_ORIGIN, line: 2, column: 47990 },
] as const;
export const SCRIPT_FRAME_ORIGIN = SCRIPT_ORIGIN;
