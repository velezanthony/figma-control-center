// Las sondas que se lanzan contra el archivo de pruebas (archivo de pruebas): las usan `make e2e-record` (guarda las
// respuestas reales para investigar) y `make e2e-contract` (las valida contra los contratos). Toda escritura se
// deshace dentro del propio script. No son datos de los tests herméticos: esos se construyen desde los contratos.

import { wrapScript } from "#adapters/cdp/script-wrapper.ts";
import { COMPONENTS_SCRIPT } from "#adapters/cdp/scripts/components.ts";
import { EXPORT_SCRIPT } from "#adapters/cdp/scripts/export.ts";
import { INSTANCES_SCRIPT } from "#adapters/cdp/scripts/instances.ts";
import { metadataScript } from "#adapters/cdp/scripts/metadata.ts";
import { STYLES_SCRIPT } from "#adapters/cdp/scripts/styles.ts";
import { VARIABLES_SCRIPT } from "#adapters/cdp/scripts/variables.ts";
import {
	SCRIPT_FORMAT,
	type ScriptFormat,
} from "#application/ports/figma-gateway.ts";

export const PROBE_FRAME = "__contrato_figma_control_center";
// Lo que crean las sondas de lectura (M3): nombres propios para reconocerlo en la respuesta (y borrarlo en `finally`)
export const PROBE_COLLECTION = "__contrato_variables";
export const PROBE_STYLE = "__contrato_estilo";
export const PROBE_SET = "__contrato_set";
export const PROBE_COMPONENT = "__contrato_componente";
export const PROBE_FRAME_SIZE = Object.freeze({
	width: 40,
	height: 30,
} as const);

export type Probe = {
	readonly id: string;
	readonly code: string;
	readonly format: ScriptFormat;
	// Marcador de la línea donde se espera el error (solo sondas de error)
	readonly lineMarker?: string;
	// Params y assets que recibe la sonda: el envoltorio los inyecta como argumentos del script
	readonly params?: Readonly<Record<string, unknown>>;
	readonly assets?: Readonly<Record<string, Uint8Array>>;
	readonly expects:
		| "ready"
		| "status"
		| "metadata"
		| "write"
		| "export"
		| "syntaxError"
		| "runtimeError"
		| "figmaInternalError"
		| "paramsEcho"
		| "accessState"
		| "variables"
		| "styles"
		| "components"
		| "instances"
		| "exportNodes";
	// Solo en las sondas de exportación: el formato pedido (su firma es lo que se comprueba)
	readonly exportFormat?: "PNG" | "SVG";
};

const body = (
	id: string,
	expects: Probe["expects"],
	code: string,
	lineMarker?: string,
): Probe => ({
	id,
	code: code.trim(),
	format: SCRIPT_FORMAT.body,
	expects,
	...(lineMarker === undefined ? {} : { lineMarker }),
});

// Un set de dos variantes («Tamaño=S» y «Tamaño=M») en la página actual; las variantes quedan en `small` y `medium`
const variantSet = `const small = figma.createComponent();
created.push(small);
small.name = "Tamaño=S";
const medium = figma.createComponent();
created.push(medium);
medium.name = "Tamaño=M";
const set = figma.combineAsVariants([small, medium], figma.currentPage);
created.push(set);
set.name = "${PROBE_SET}";`;

// Sonda de lectura: `setup` crea (apuntando cada nodo en `created`) y termina llamando a `read(params)`, el script
// interno de lectura tal cual; `finally` borra lo creado, del último al primero (lo que ya cayó con su padre se salta, y
// un borrado que falla no impide los demás)
const readProbe = (
	id: string,
	expects: Probe["expects"],
	script: string,
	setup: string,
): Probe =>
	body(
		id,
		expects,
		`const read = async (params) => {
${script}
};
const created = [];
try {
${setup}
} finally {
	for (const node of created.reverse()) {
		// Las colecciones y los estilos no tienen \`removed\`; un nodo que cayó con su padre, sí
		if (node.removed === true) continue;
		try {
			node.remove();
		} catch (e) {
			console.error("sonda: no se pudo borrar", node.id, e);
		}
	}
}`,
	);

export const PROBES: readonly Probe[] = [
	body(
		"status",
		"status",
		"return { file: figma.root.name, page: figma.currentPage.name };",
	),
	body("metadata", "metadata", metadataScript(null, 1)),
	// Solo lectura y sin datos personales (nombres de claves y booleanos): qué hay en la pestaña en cada estado
	// (listo, solo lectura, sin sesión, cargando) para contrastar las heurísticas de figma_status. Se lanza con
	// `make e2e-record STATE=<estado>` (ver docs/users/installation.md) y se guarda por estado.
	body(
		"access-state",
		"accessState",
		`const options = globalThis.INITIAL_OPTIONS;
const hasOptions = options !== null && typeof options === "object";
const userData = hasOptions ? options.user_data : null;
const canEdit = hasOptions ? options.editing_file?.can_edit : undefined;
return {
	figmaType: typeof figma,
	firstPathSegment: globalThis.location?.pathname?.split("/")[1] ?? null,
	readyState: document.readyState,
	hasInitialOptions: hasOptions,
	hasUserData: userData != null,
	canEdit: typeof canEdit === "boolean" ? canEdit : null,
	initialOptionsKeys: hasOptions ? Object.keys(options).sort() : [],
	userDataKeys: userData != null && typeof userData === "object" ? Object.keys(userData).sort() : [],
};`,
	),
	body(
		"write-and-undo",
		"write",
		`const frame = figma.createFrame();
frame.name = "${PROBE_FRAME}";
const id = frame.id;
frame.remove();
return { createdNodeIds: [id] };`,
	),
	body(
		"export-png",
		"export",
		`const frame = figma.createFrame();
frame.name = "${PROBE_FRAME}";
frame.resize(40, 30);
try {
	const bytes = await frame.exportAsync({ format: "PNG" });
	return { base64: figma.base64Encode(bytes) };
} finally {
	frame.remove();
}`,
	),
	{
		id: "syntax-error",
		code: `async () => {\n\tconst broken = ; // @error-here\n}`,
		format: SCRIPT_FORMAT.function,
		expects: "syntaxError",
		lineMarker: "@error-here",
	},
	body(
		"runtime-error",
		"runtimeError",
		`const nothing = undefined;\nreturn nothing.name; // @throw-here`,
		"@throw-here",
	),
	body(
		"figma-internal-error",
		"figmaInternalError",
		`const frame = figma.createFrame();
frame.name = "${PROBE_FRAME}";
try {
	frame.fills = "no-es-un-array"; // @throw-here
} finally {
	frame.remove();
}`,
		"@throw-here",
	),
	// params y assets: el script recibe los dos y devuelve su eco y la longitud del asset en bytes.
	// Sin escritura: solo lee lo que llegó (assets[nombre] es un Uint8Array). Valida CA-7 contra el archivo de pruebas.
	{
		id: "params-echo",
		code: "return { params, assetLength: assets.muestra.length };",
		format: SCRIPT_FORMAT.body,
		expects: "paramsEcho",
		params: { page: "App", n: 3 },
		assets: { muestra: new Uint8Array([1, 2, 3, 4, 5]) },
	},
	// Lecturas del catálogo (M3, CA-10): cada sonda crea lo que necesita, llama al MISMO script interno de lectura que usa
	// el servidor (con su entrada como `params`) y lo borra todo en `finally`, aunque la lectura falle.
	// Solo el modo por defecto: hay planes de Figma con un modo por colección (addMode lanza «Limited to 1 modes only»).
	// Varios modos los cubren los tests herméticos con dobles
	readProbe(
		"read-variables",
		"variables",
		VARIABLES_SCRIPT,
		`const collection = figma.variables.createVariableCollection("${PROBE_COLLECTION}");
created.push(collection);
const frame = figma.createFrame();
created.push(frame);
frame.name = "${PROBE_FRAME}";
const modeA = collection.modes[0].modeId;
collection.renameMode(modeA, "A");
const base = figma.variables.createVariable("${PROBE_COLLECTION}/base", collection, "COLOR");
base.setValueForMode(modeA, { r: 1, g: 0, b: 0, a: 1 });
const alias = figma.variables.createVariable("${PROBE_COLLECTION}/alias", collection, "COLOR");
alias.setValueForMode(modeA, figma.variables.createVariableAlias(base));
frame.fills = [figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", alias)];
return await read({ collection: "${PROBE_COLLECTION}", nodeId: frame.id });`,
	),
	readProbe(
		"read-styles",
		"styles",
		STYLES_SCRIPT,
		`const style = figma.createPaintStyle();
created.push(style);
style.name = "${PROBE_STYLE}";
style.paints = [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 } }];
return await read({ kind: "paint" });`,
	),
	readProbe(
		"read-components",
		"components",
		COMPONENTS_SCRIPT,
		`${variantSet}
return await read({ page: figma.currentPage.name, query: "${PROBE_SET}" });`,
	),
	readProbe(
		"read-instances",
		"instances",
		INSTANCES_SCRIPT,
		`${variantSet}
const loose = figma.createComponent();
created.push(loose);
loose.name = "${PROBE_COMPONENT}";
const frame = figma.createFrame();
created.push(frame);
frame.name = "${PROBE_FRAME}";
frame.appendChild(small.createInstance());
frame.appendChild(loose.createInstance());
return await read({ pages: [figma.currentPage.name], frame: "${PROBE_FRAME}" });`,
	),
	...(["PNG", "SVG"] as const).map((format) => ({
		...readProbe(
			`read-export-${format.toLowerCase()}`,
			"exportNodes",
			EXPORT_SCRIPT,
			`const frame = figma.createFrame();
created.push(frame);
frame.name = "${PROBE_FRAME}";
frame.resize(${PROBE_FRAME_SIZE.width}, ${PROBE_FRAME_SIZE.height});
return await read({ nodeIds: [frame.id], format: "${format}", scale: 1 });`,
		),
		exportFormat: format,
	})),
];

export const READY_EXPRESSION = "typeof figma";

// Lo que se evalúa en Chrome y el desfase de líneas del envoltorio (para comprobar la línea del script)
export const evaluation = (probe: Probe) => {
	const wrapped = wrapScript({
		code: probe.code,
		format: probe.format,
		...(probe.params !== undefined && { params: probe.params }),
		...(probe.assets !== undefined && { assets: probe.assets }),
	});
	return { expression: wrapped.expression, lineOffset: wrapped.lineOffset };
};

// Línea (desde 1) del script donde está el marcador
export const markerLine = (probe: Probe): number | null =>
	probe.lineMarker === undefined
		? null
		: probe.code
				.split("\n")
				.findIndex((l) => l.includes(probe.lineMarker ?? "")) + 1;
