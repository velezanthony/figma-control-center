// CA-4: la prueba de contrato detecta una respuesta que ya no cumple. Aquí se construyen respuestas válidas desde los
// contratos (nunca copiadas de Figma) y se alteran a propósito: el contrato debe aceptar las buenas y rechazar las alteradas.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Script } from "node:vm";
import { checkProbeReply } from "../contract/check-probe.ts";
import {
	evaluation,
	markerLine,
	PROBE_COLLECTION,
	PROBE_COMPONENT,
	PROBE_FRAME,
	PROBE_SET,
	PROBE_STYLE,
	PROBES,
	type Probe,
} from "../contract/probes.ts";
import { paramsEcho } from "../contracts/build.ts";
import {
	exceptionReply,
	FIGMA_BUNDLE_ORIGIN,
	SCRIPT_ORIGIN,
	valueReply,
} from "../contracts/cdp.ts";
import {
	accessState,
	buildPng,
	buildSvg,
	componentsValue,
	exportNodesValue,
	exportValue,
	instancesValue,
	statusValue,
	stylesValue,
	variablesValue,
} from "../contracts/figma-values.ts";

const probe = (id: string): Probe => {
	const found = PROBES.find((p) => p.id === id);
	if (found === undefined) throw new Error(`no hay sonda ${id}`);
	return found;
};

// La línea del texto evaluado donde cae el marcador de la sonda (con el desfase del envoltorio)
const evaluatedLine = (p: Probe): number =>
	(markerLine(p) ?? 1) + evaluation(p).lineOffset;

const ACCESS = {
	figmaType: "object",
	firstPathSegment: "design",
	readyState: "complete",
	hasInitialOptions: true,
	hasUserData: true,
	canEdit: true,
	initialOptionsKeys: ["editing_file", "user_data"],
	userDataKeys: ["id"],
};

const good = {
	status: () => valueReply(1, statusValue("Archivo", "Página")),
	metadata: () =>
		valueReply(1, {
			id: "0:1",
			name: "Página",
			type: "PAGE",
			children: [{ id: "1:2", name: "Marco", type: "FRAME" }],
		}),
	write: () => valueReply(1, { createdNodeIds: ["5:6"] }),
	accessState: () => valueReply(1, accessState(ACCESS)),
	export: () => valueReply(1, exportValue(buildPng(40, 30))),
	syntax: () => {
		const p = probe("syntax-error");
		return exceptionReply(1, {
			className: "SyntaxError",
			message: "Unexpected token ';'",
			frames: [],
			lineNumber: evaluatedLine(p) - 1,
		});
	},
	runtime: (lineShift = 0) => {
		const p = probe("runtime-error");
		return exceptionReply(1, {
			className: "TypeError",
			message: "Cannot read properties of undefined (reading 'name')",
			frames: [
				{
					origin: SCRIPT_ORIGIN,
					line: evaluatedLine(p) + lineShift,
					column: 9,
				},
			],
		});
	},
	internal: (withBundle = true) => {
		const p = probe("figma-internal-error");
		return exceptionReply(1, {
			className: "Error",
			message: "in set_fills: Expected an array",
			frames: [
				...(withBundle
					? [{ fn: "set", origin: FIGMA_BUNDLE_ORIGIN, line: 2, column: 4821 }]
					: []),
				{ origin: SCRIPT_ORIGIN, line: evaluatedLine(p), column: 7 },
			],
		});
	},
};

describe("la prueba de contrato acepta lo que cumple", () => {
	it("cada sonda con una respuesta construida desde el contrato no tiene violaciones", () => {
		assert.deepEqual(checkProbeReply(probe("status"), good.status()), []);
		assert.deepEqual(checkProbeReply(probe("metadata"), good.metadata()), []);
		assert.deepEqual(
			checkProbeReply(probe("write-and-undo"), good.write()),
			[],
		);
		assert.deepEqual(checkProbeReply(probe("export-png"), good.export()), []);
		assert.deepEqual(
			checkProbeReply(probe("access-state"), good.accessState()),
			[],
		);
		assert.deepEqual(checkProbeReply(probe("syntax-error"), good.syntax()), []);
		assert.deepEqual(
			checkProbeReply(probe("runtime-error"), good.runtime()),
			[],
		);
		assert.deepEqual(
			checkProbeReply(probe("figma-internal-error"), good.internal()),
			[],
		);
		const pe = probe("params-echo");
		const sent = Object.values(pe.assets ?? {})[0]?.length ?? 0;
		assert.deepEqual(
			checkProbeReply(pe, valueReply(1, paramsEcho(pe.params ?? {}, sent))),
			[],
		);
	});
});

describe("la prueba de contrato detecta una respuesta alterada (CA-4)", () => {
	it("un estado de acceso con un campo del tipo equivocado o de más", () => {
		for (const altered of [
			{ hasUserData: "sí" },
			{ canEdit: undefined },
			{ extra: 1 },
		]) {
			assert.notDeepEqual(
				checkProbeReply(
					probe("access-state"),
					valueReply(1, { ...ACCESS, ...altered }),
				),
				[],
			);
		}
	});

	it("un estado al que le falta un campo", () => {
		const altered = valueReply(1, { file: "Archivo" });
		assert.notDeepEqual(checkProbeReply(probe("status"), altered), []);
	});

	it("un árbol de metadatos con un tipo de nodo que no existe en @figma/plugin-typings", () => {
		const altered = valueReply(1, { id: "0:1", name: "p", type: "INVENTADO" });
		assert.match(
			checkProbeReply(probe("metadata"), altered).join("\n"),
			/metadatos/,
		);
	});

	it("una exportación que no es un PNG", () => {
		const altered = valueReply(1, {
			base64: Buffer.from("no soy un png").toString("base64"),
		});
		assert.match(
			checkProbeReply(probe("export-png"), altered).join("\n"),
			/PNG/,
		);
	});

	it("una excepción sin los campos que exige ExceptionDetails", () => {
		const altered = {
			id: 1,
			result: {
				result: { type: "object" },
				exceptionDetails: {
					text: "Uncaught",
					exception: {
						type: "object",
						className: "TypeError",
						description: "TypeError: x\n    at <anonymous>:3:1",
					},
				},
			},
		};
		assert.match(
			checkProbeReply(probe("runtime-error"), altered).join("\n"),
			/exceptionId|columnNumber|lineNumber/,
		);
	});

	it("una pila con otro formato de marcos", () => {
		const altered = good.runtime() as {
			result: { exceptionDetails: { exception: { description: string } } };
		};
		altered.result.exceptionDetails.exception.description =
			"TypeError: x\n  en el script, línea 3";
		assert.match(
			checkProbeReply(probe("runtime-error"), altered).join("\n"),
			/pila/,
		);
	});

	it("un error de ejecución con la línea desplazada: la del script ya no coincide", () => {
		assert.match(
			checkProbeReply(probe("runtime-error"), good.runtime(1)).join("\n"),
			/línea/,
		);
	});

	it("un error dentro de Figma sin marcos del bundle de Figma (el contrato espera verlos)", () => {
		assert.match(
			checkProbeReply(probe("figma-internal-error"), good.internal(false)).join(
				"\n",
			),
			/marcos de Figma/,
		);
	});

	it("un valor donde se esperaba una excepción", () => {
		assert.match(
			checkProbeReply(probe("runtime-error"), valueReply(1, { ok: true })).join(
				"\n",
			),
			/excepción/,
		);
	});

	it("un eco de params/assets con otra longitud de asset", () => {
		const pe = probe("params-echo");
		const altered = valueReply(1, paramsEcho(pe.params ?? {}, 999));
		assert.match(checkProbeReply(pe, altered).join("\n"), /longitud|asset/);
	});

	it("un eco de params que no coincide con lo enviado", () => {
		const pe = probe("params-echo");
		const sent = Object.values(pe.assets ?? {})[0]?.length ?? 0;
		const altered = valueReply(1, paramsEcho({ page: "Otro" }, sent));
		assert.match(checkProbeReply(pe, altered).join("\n"), /eco|params/);
	});

	it("un error de protocolo de Chrome", () => {
		const altered = {
			id: 1,
			error: { code: -32000, message: "Cannot find context" },
		};
		assert.match(
			checkProbeReply(probe("status"), altered).join("\n"),
			/protocolo/,
		);
	});
});

// Respuestas de las sondas de lectura (M3) construidas desde el contrato, con lo que cada sonda crea
const BASE_ID = "VariableID:9:1";
const readGood = {
	variables: () =>
		variablesValue({
			collections: [
				{
					id: "VariableCollectionId:9:0",
					name: PROBE_COLLECTION,
					modes: [
						{ id: "9:0", name: "A" },
						{ id: "9:1", name: "B" },
					],
					defaultModeId: "9:0",
					variables: [
						{
							id: "VariableID:9:2",
							name: `${PROBE_COLLECTION}/alias`,
							resolvedType: "COLOR",
							scopes: ["ALL_SCOPES"],
							description: "",
							valuesByMode: {
								"9:0": {
									alias: { id: BASE_ID, name: `${PROBE_COLLECTION}/base` },
								},
								"9:1": { r: 0, g: 1, b: 0, a: 1 },
							},
						},
					],
				},
			],
			bindings: [
				{ nodeId: "9:3", field: "fills", variableId: "VariableID:9:2" },
			],
		}),
	styles: () =>
		stylesValue({
			styles: [
				{
					id: "S:x,",
					key: "x",
					name: PROBE_STYLE,
					kind: "paint",
					description: "",
					boundVariables: {},
					value: [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 }, opacity: 1 }],
				},
			],
		}),
	components: () =>
		componentsValue({
			components: [
				{
					id: "9:4",
					key: "k",
					name: PROBE_SET,
					type: "COMPONENT_SET",
					page: "Página 1",
					pageIndex: 0,
					description: "",
					variants: { Tamaño: ["S", "M"] },
					properties: [],
					variantCount: 2,
				},
			],
		}),
	instances: (
		counts: Record<string, number> = { [PROBE_SET]: 1, [PROBE_COMPONENT]: 1 },
	) =>
		instancesValue({
			frames: [
				{ page: "Página 1", frameId: "9:5", frameName: PROBE_FRAME, counts },
			],
		}),
	png: () =>
		exportNodesValue("PNG", [{ nodeId: "9:6", bytes: buildPng(40, 30) }]),
	svg: () =>
		exportNodesValue("SVG", [{ nodeId: "9:6", bytes: buildSvg(40, 30) }]),
};

describe("sondas de lectura (M3, CA-10)", () => {
	it("cada sonda de lectura con una respuesta construida desde el contrato no tiene violaciones", () => {
		for (const [id, value] of [
			["read-variables", readGood.variables()],
			["read-styles", readGood.styles()],
			["read-components", readGood.components()],
			["read-instances", readGood.instances()],
			["read-export-png", readGood.png()],
			["read-export-svg", readGood.svg()],
		] as const) {
			assert.deepEqual(
				checkProbeReply(probe(id), valueReply(1, value)),
				[],
				id,
			);
		}
	});

	it("read-variables vale en un plan de un solo modo por colección: no añade modos y una respuesta de un modo con el alias cumple", () => {
		const p = probe("read-variables");
		// En ese plan, addMode lanza «Limited to 1 modes only» antes de llegar a leer
		assert.doesNotMatch(p.code, /\.addMode\(/);
		const oneMode = readGood.variables();
		const [collection] = oneMode.collections;
		assert.ok(collection);
		const single = {
			...oneMode,
			collections: [
				{
					...collection,
					modes: [{ id: "9:0", name: "A" }],
					variables: collection.variables.map((v) => ({
						...v,
						valuesByMode: { "9:0": v.valuesByMode["9:0"] },
					})),
				},
			],
		};
		assert.deepEqual(checkProbeReply(p, valueReply(1, single)), []);
	});

	it("cada sonda de lectura crea, lee con el script interno y lo borra todo en finally", () => {
		for (const p of PROBES.filter((x) => x.id.startsWith("read-"))) {
			assert.match(p.code, /const READ_KIND = /, p.id);
			assert.match(p.code, /} finally \{[\s\S]*\.remove\(\)/, p.id);
		}
	});

	it("cada sonda de lectura es JavaScript que compila (nunca se ejecuta sin el archivo de pruebas)", () => {
		for (const p of PROBES.filter((x) => x.id.startsWith("read-"))) {
			assert.doesNotThrow(() => new Script(evaluation(p).expression), p.id);
		}
	});

	it("un alias crudo de Figma (sin resolver) no cumple", () => {
		const value = readGood.variables();
		const raw = {
			...value,
			collections: value.collections.map((c) => ({
				...c,
				variables: c.variables.map((v) => ({
					...v,
					valuesByMode: {
						...v.valuesByMode,
						"9:0": { type: "VARIABLE_ALIAS", id: BASE_ID },
					},
				})),
			})),
		};
		assert.notDeepEqual(
			checkProbeReply(probe("read-variables"), valueReply(1, raw)),
			[],
		);
	});

	it("unos conteos de instancias que no son los de lo creado se detectan", () => {
		assert.notDeepEqual(
			checkProbeReply(
				probe("read-instances"),
				valueReply(1, readGood.instances({ [PROBE_SET]: 2 })),
			),
			[],
		);
	});

	it("un SVG que en realidad es un PNG no cumple", () => {
		assert.notDeepEqual(
			checkProbeReply(probe("read-export-svg"), valueReply(1, readGood.png())),
			[],
		);
	});
});
