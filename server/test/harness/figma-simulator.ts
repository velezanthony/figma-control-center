// Simulador de Figma: el doble de la frontera Chrome + Figma. Es el servidor CDP de
// adapters/cdp/testing/fake-cdp-server.ts con un `respond` que contesta según el ESCENARIO activo.
// No reimplementa Figma: reconoce el script que llega (marcador `@scenario` o huella de los scripts internos)
// y devuelve un ejemplo construido desde los contratos. Todo lo que emite lo valida el doble CDP contra el contrato.

import { KIT_PROBE_EXPRESSION } from "#adapters/cdp/figma-kit.ts";
import {
	FIGMA_KIT_SHA_GLOBAL,
	NODE_NOT_FOUND_MARKER,
} from "#adapters/cdp/protocol.ts";
import {
	type FakeCdp,
	type FakeReply,
	startFakeCdp,
} from "#adapters/cdp/testing/fake-cdp-server.ts";
import { FIGMA_KIT } from "#domain/step.ts";
import { SCRIPT_ORIGIN } from "../contracts/cdp.ts";
import {
	type AccessValue,
	accessValue,
	buildJpg,
	buildPdf,
	buildPng,
	buildSvg,
	componentsValue,
	designReadValue,
	type ExportFormatValue,
	exportNodesValue,
	exportValue,
	instancesValue,
	type MetadataNode,
	metadataValue,
	statusValue,
	stylesValue,
	variablesValue,
} from "../contracts/figma-values.ts";
import {
	FIGMA_INTERNAL_FRAMES,
	LINE_MARKER,
	SCENARIO_MARKER,
	SCENARIOS,
	type Scenario,
	type ScenarioReply,
} from "../fixtures/scenarios/scenarios.ts";
import { DEFAULT_WORLD, type World } from "../fixtures/scenarios/world.ts";
import { kitStepReply } from "./kit-step-reply.ts";

// Huellas de lo que el servidor evalúa por su cuenta (adapters/cdp/protocol.ts y adapters/cdp/scripts/)
const FINGERPRINT = Object.freeze({
	ready: "typeof figma",
	access: "INITIAL_OPTIONS",
	status: "figma.root.name",
	screenshot: "exportAsync",
	metadata: "const NODE_ID",
} as const);
const NODE_ID_LITERAL = /locate\(("[^"]*")\)/;
// Cabecera de los scripts internos de lectura (adapters/cdp/scripts/read-header.ts): qué lectura es. Su entrada son
// los `params` que el envoltorio (adapters/cdp/script-wrapper.ts) pone en la primera línea
const READ_KIND_LINE = /^const READ_KIND = "([\w-]+)";$/m;
const WRAPPED_PARAMS_LINE =
	/^\(async \(\) => \{const params = (.*);const assets = \{\};(?:const kit = .*;)?$/m;
// La instalación del kit: deja el hash del empaquetado en un global y evalúa el empaquetado (adapters/cdp/figma-kit.ts)
const KIT_INSTALL_SHA = new RegExp(
	`^globalThis\\.${FIGMA_KIT_SHA_GLOBAL} = "([0-9a-f]+)";`,
);
const METADATA_NODE_ID = /const NODE_ID = (.+);/;
const METADATA_DEPTH = /const DEPTH = (\d+);/;
const SCALE_LITERAL = /value: ([\d.]+)/;
const COLUMN_OF_ERROR = 9;

export type SimulatorOptions = {
	// URL de la pestaña (por defecto, la que empieza por `fileUrl`; otra distinta simula «pestaña no encontrada»)
	readonly tabUrl?: string;
	// Chrome sin ninguna pestaña de Figma (el servidor tiene que abrirla). `openedTabLandsOn`: dónde acaba la que abre
	readonly noTab?: boolean;
	readonly openedTabLandsOn?: (requested: string) => string;
	// false: el editor no llega a definir `figma`
	readonly ready?: boolean;
	// Por qué no está listo (lo que diagnostica figma_status); por defecto, «cargando»
	readonly notReadyBecause?: Exclude<AccessValue, "ready">;
	readonly world?: World;
};

export type FigmaSimulator = Pick<
	FakeCdp,
	| "port"
	| "expressions"
	| "violations"
	| "release"
	| "waiting"
	| "close"
	| "tabUrl"
	| "tabs"
	| "tabRequests"
> & {
	// Recarga simulada de la pestaña: el kit instalado desaparece y el siguiente script lo vuelve a instalar
	reloadTab(): void;
};

const byId = (id: string): Scenario | undefined =>
	Object.values(SCENARIOS).find((s) => s.id === id);

// Línea (desde 1) del texto evaluado donde aparece el marcador: la que informaría Chrome
const lineOf = (expression: string, marker: string): number => {
	const at = expression.split("\n").findIndex((l) => l.includes(marker));
	return at === -1 ? 1 : at + 1;
};

const find = (root: MetadataNode, id: string): MetadataNode | null => {
	if (root.id === id) return root;
	for (const child of root.children ?? []) {
		const hit = find(child, id);
		if (hit) return hit;
	}
	return null;
};

const cut = (node: MetadataNode, depth: number): MetadataNode => ({
	id: node.id,
	name: node.name,
	type: node.type,
	...(depth > 0 && node.children
		? { children: node.children.map((c) => cut(c, depth - 1)) }
		: {}),
});

const notFound = (expression: string, id: string): FakeReply => ({
	kind: "exception",
	className: "Error",
	message: `${NODE_NOT_FOUND_MARKER}${id}`,
	frames: [
		{
			origin: SCRIPT_ORIGIN,
			line: lineOf(expression, "const node = await locate"),
			column: COLUMN_OF_ERROR,
		},
	],
});

// Lo que lanzan los scripts de lectura con una página que no existe: un Error con su nombre en la línea de la cabecera
const missingPage = (expression: string, name: string): FakeReply => ({
	kind: "exception",
	className: "Error",
	message: `La página «${name}» no existe en el archivo`,
	frames: [
		{
			origin: SCRIPT_ORIGIN,
			line: lineOf(expression, "const READ_KIND"),
			column: COLUMN_OF_ERROR,
		},
	],
});

const subtreeIds = (node: MetadataNode): string[] => [
	node.id,
	...(node.children ?? []).flatMap(subtreeIds),
];

const EXPORT_BYTES: Readonly<
	Record<ExportFormatValue, (w: number, h: number) => Buffer>
> = {
	PNG: (w, h) => buildPng(w, h),
	JPG: () => buildJpg(),
	SVG: (w, h) => buildSvg(w, h),
	PDF: () => buildPdf(),
};

type Query = Readonly<Record<string, unknown>>;
const text = (q: Query, key: string): string | null =>
	typeof q[key] === "string" ? (q[key] as string) : null;
const texts = (q: Query, key: string): string[] =>
	Array.isArray(q[key]) ? (q[key] as string[]) : [];

// Las lecturas del catálogo (M3) contestan desde el mundo, filtradas como lo harían los scripts internos
function readReply(
	expression: string,
	world: World,
	kind: string,
	query: Query,
): FakeReply {
	const { catalog } = world;
	switch (kind) {
		case "variables": {
			const collection = text(query, "collection");
			const nodeId = text(query, "nodeId");
			if (nodeId !== null && find(world.root, nodeId) === null)
				return notFound(expression, nodeId);
			const node = nodeId === null ? null : find(world.root, nodeId);
			const inside = node === null ? null : new Set(subtreeIds(node));
			const bindings =
				inside === null
					? undefined
					: [...catalog.bindings.entries()]
							.filter(([id]) => inside.has(id))
							.flatMap(([, list]) => list);
			const wanted =
				bindings === undefined
					? null
					: new Set(bindings.map((b) => b.variableId));
			const collections = catalog.variables.collections
				.filter((c) => collection === null || c.name === collection)
				.map((c) => ({
					...c,
					variables: c.variables.filter(
						(v) => wanted === null || wanted.has(v.id),
					),
				}))
				.filter((c) => wanted === null || c.variables.length > 0);
			return {
				kind: "value",
				value: variablesValue({
					collections,
					...(bindings !== undefined && { bindings }),
				}),
			};
		}
		case "styles": {
			const only = text(query, "kind");
			return {
				kind: "value",
				value: stylesValue({
					styles: catalog.styles.filter(
						(s) => only === null || s.kind === only,
					),
				}),
			};
		}
		case "components": {
			const page = text(query, "page");
			if (page !== null && !catalog.pages.includes(page))
				return missingPage(expression, page);
			const needle = text(query, "query")?.toLowerCase() ?? null;
			return {
				kind: "value",
				value: componentsValue({
					components: catalog.components.filter(
						(c) =>
							(page === null || c.page === page) &&
							(needle === null || c.name.toLowerCase().includes(needle)),
					),
				}),
			};
		}
		case "instances": {
			const pages = texts(query, "pages");
			const missing = pages.find((p) => !catalog.pages.includes(p));
			if (missing !== undefined) return missingPage(expression, missing);
			const frame = text(query, "frame");
			return {
				kind: "value",
				value: instancesValue({
					frames: catalog.frames.filter(
						(f) =>
							pages.includes(f.page) &&
							(frame === null || f.frameName === frame),
					),
				}),
			};
		}
		case "export": {
			const ids = texts(query, "nodeIds");
			const format = text(query, "format") as ExportFormatValue;
			const scale = typeof query["scale"] === "number" ? query["scale"] : 1;
			const missing = ids.find((id) => !world.sizes.has(id));
			if (missing !== undefined) return notFound(expression, missing);
			const raster = format === "PNG" || format === "JPG";
			const nodes = ids.map((nodeId) => {
				const size = world.sizes.get(nodeId) ?? { width: 1, height: 1 };
				const factor = raster ? scale : 1;
				return {
					nodeId,
					bytes: EXPORT_BYTES[format](
						Math.max(1, Math.round(size.width * factor)),
						Math.max(1, Math.round(size.height * factor)),
					),
				};
			});
			return { kind: "value", value: exportNodesValue(format, nodes) };
		}
		case "design-context": {
			const nodeId = text(query, "nodeId") ?? "";
			const entry = catalog.designContexts.get(nodeId);
			if (entry === undefined) return notFound(expression, nodeId);
			const asked = query["variant"];
			if (typeof asked === "object" && asked !== null && entry.variants) {
				const unknown = Object.entries(asked as Record<string, string>).some(
					([prop, option]) => !entry.variants?.[prop]?.includes(option),
				);
				if (unknown)
					return {
						kind: "value",
						value: designReadValue({
							unknownVariant: {
								variants: structuredClone(entry.variants) as never,
							},
						}),
					};
			}
			const max = typeof query["maxNodes"] === "number" ? query["maxNodes"] : 0;
			const { read } = entry;
			if (!("nodes" in read) || max <= 0 || read.nodes.length <= max)
				return { kind: "value", value: read };
			return {
				kind: "value",
				value: designReadValue({
					...read,
					nodes: read.nodes.slice(0, max),
					truncated: {
						reason: "max-nodes",
						children: read.nodes.slice(max).map((n) => n.id),
					},
				}),
			};
		}
		default:
			return {
				kind: "exception",
				className: "Error",
				message: `El simulador no conoce la lectura «${kind}»`,
				frames: [{ origin: SCRIPT_ORIGIN, line: 1, column: 1 }],
			};
	}
}

function scenarioReply(expression: string, reply: ScenarioReply): FakeReply {
	switch (reply.kind) {
		case "value":
			return reply;
		case "gated":
			return {
				kind: "gated",
				gate: reply.gate,
				afterRelease: { kind: "value", value: reply.value },
			};
		case "hang":
			return reply;
		case "syntaxError": {
			const line = lineOf(expression, LINE_MARKER.syntax);
			return {
				kind: "exception",
				className: "SyntaxError",
				message: reply.message,
				frames: [],
				lineNumber: line - 1,
			};
		}
		case "runtimeError":
			return {
				kind: "exception",
				className: reply.name,
				message: reply.message,
				frames: [
					{
						origin: SCRIPT_ORIGIN,
						line: lineOf(expression, LINE_MARKER.throws),
						column: COLUMN_OF_ERROR,
					},
				],
			};
		case "figmaInternalError":
			return {
				kind: "exception",
				className: reply.name,
				message: reply.message,
				frames: [
					...FIGMA_INTERNAL_FRAMES,
					{
						origin: SCRIPT_ORIGIN,
						line: lineOf(expression, LINE_MARKER.throws),
						column: COLUMN_OF_ERROR,
					},
				],
			};
	}
}

export async function startFigmaSimulator(
	options: SimulatorOptions = {},
): Promise<FigmaSimulator> {
	const world = options.world ?? DEFAULT_WORLD;
	const ready = options.ready ?? true;
	const access: AccessValue = ready
		? "ready"
		: (options.notReadyBecause ?? "loading");

	// Lo que la pestaña simulada tiene instalado (el kit de Figma); no ejecuta el empaquetado: solo recuerda su hash
	let installedKit: { version: string; sha256: string } | null = null;

	const respond = (expression: string): FakeReply => {
		if (expression === KIT_PROBE_EXPRESSION) {
			return { kind: "value", value: installedKit };
		}
		const kitSha = KIT_INSTALL_SHA.exec(expression)?.[1];
		if (kitSha !== undefined) {
			installedKit = { version: FIGMA_KIT, sha256: kitSha };
			return { kind: "value", value: null };
		}
		if (expression === FINGERPRINT.ready) {
			return { kind: "value", value: ready ? "object" : "undefined" };
		}
		if (expression.includes(FINGERPRINT.access)) {
			return { kind: "value", value: accessValue(access) };
		}
		const marker = SCENARIO_MARKER.exec(expression)?.[1];
		if (marker !== undefined) {
			const scenario = byId(marker);
			if (scenario) return scenarioReply(expression, scenario.reply);
		}
		// Un paso del kit (`use`): se reconoce por su código fijo y se contesta desde sus params
		const kitStep = kitStepReply(expression);
		if (kitStep !== null) return kitStep;
		// Antes que la captura: el script de exportación también llama a exportAsync
		const readKind = READ_KIND_LINE.exec(expression)?.[1];
		if (readKind !== undefined) {
			const query = JSON.parse(
				WRAPPED_PARAMS_LINE.exec(expression)?.[1] ?? "{}",
			) as Query;
			return readReply(expression, world, readKind, query);
		}
		if (expression.includes(FINGERPRINT.screenshot)) {
			const id = JSON.parse(NODE_ID_LITERAL.exec(expression)?.[1] ?? "null") as
				| string
				| null;
			const size = id === null ? undefined : world.sizes.get(id);
			if (id === null || size === undefined)
				return notFound(expression, String(id));
			const scale = Number(SCALE_LITERAL.exec(expression)?.[1] ?? 1);
			const png = buildPng(
				Math.max(1, Math.round(size.width * scale)),
				Math.max(1, Math.round(size.height * scale)),
			);
			return { kind: "value", value: exportValue(png) };
		}
		if (expression.includes(FINGERPRINT.metadata)) {
			const id = JSON.parse(METADATA_NODE_ID.exec(expression)?.[1] ?? "null") as
				| string
				| null;
			const depth = Number(METADATA_DEPTH.exec(expression)?.[1] ?? 0);
			const node = id === null ? world.root : find(world.root, id);
			if (node === null) return notFound(expression, String(id));
			return { kind: "value", value: metadataValue(cut(node, depth)) };
		}
		if (expression.includes(FINGERPRINT.status)) {
			return { kind: "value", value: statusValue(world.file, world.page) };
		}
		return {
			kind: "exception",
			className: "Error",
			message:
				"El simulador no reconoce este script: añade un escenario (// @scenario: <id>)",
			frames: [{ origin: SCRIPT_ORIGIN, line: 1, column: 1 }],
		};
	};

	const fake = await startFakeCdp({
		respond,
		tabUrl: options.tabUrl,
		...(options.noTab === true && { tabUrls: [] }),
		openedTabLandsOn: options.openedTabLandsOn,
	});
	return Object.assign(fake, {
		reloadTab: () => {
			installedKit = null;
		},
	});
}
