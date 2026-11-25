// Los scripts internos de lectura (adapters/cdp/scripts/) ejecutados de verdad, con `vm`, contra un `figma` de mentira
// que solo tiene lo que el API de plugins expone (@figma/plugin-typings); el lector interpreta la respuesta con zod.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { EXPORT_FORMAT, STYLE_KIND } from "#domain/catalog.ts";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { CdpClient } from "./cdp-client.ts";
import { CdpFigmaReader } from "./cdp-figma-reader.ts";
import { type FakeCdp, startFakeCdp } from "./testing/fake-cdp-server.ts";

const FILE_URL = "https://www.figma.com/design/KEY/Nombre";

// --- Un archivo de mentira: dos páginas, un set de botones con dos variantes, un icono suelto y una pantalla ---

type Node = {
	id: string;
	name: string;
	type: string;
	parent?: Node | null;
	children?: Node[];
	visible?: boolean;
	[key: string]: unknown;
};

const alias = (id: string) => ({ type: "VARIABLE_ALIAS", id });
const link = (parent: Node, children: Node[]): Node[] => {
	for (const c of children) c.parent = parent;
	parent.children = children;
	return children;
};
// findAll / findAllWithCriteria sobre un subárbol (sin el propio nodo, como Figma). Lo oculto dentro de una instancia
// solo se salta con skipInvisibleInstanceChildren, como hace Figma
const descendants = (node: Node, insideInstance = false): Node[] =>
	(node.children ?? []).flatMap((c) => {
		const hidden =
			insideInstance &&
			c.visible === false &&
			figma.skipInvisibleInstanceChildren;
		if (hidden) return [];
		return [c, ...descendants(c, insideInstance || c.type === "INSTANCE")];
	});
const searchable = (node: Node): Node => {
	node["findAll"] = () => descendants(node);
	node["findAllWithCriteria"] = ({ types }: { types: string[] }) =>
		descendants(node).filter((n) => types.includes(n.type));
	return node;
};

const exportCalls: unknown[] = [];
const exportable = (node: Node, width: number, height: number): Node => {
	node["exportAsync"] = async (settings: { format: string }) => {
		// La copia JSON saca los ajustes del contexto de `vm` (otro realm) para compararlos
		exportCalls.push({
			id: node.id,
			settings: JSON.parse(JSON.stringify(settings)),
		});
		if (settings.format === "PNG") {
			const png = Buffer.alloc(24);
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
			png.write("IHDR", 12, "latin1");
			png.writeUInt32BE(width, 16);
			png.writeUInt32BE(height, 20);
			return new Uint8Array(png);
		}
		return new Uint8Array(Buffer.from(`<svg width="${width}"/>`));
	};
	return node;
};

const smallVariant: Node = {
	id: "20:2",
	name: "Tamaño=S",
	type: "COMPONENT",
	key: "k-s",
	description: "",
};
const mediumVariant: Node = {
	id: "20:3",
	name: "Tamaño=M",
	type: "COMPONENT",
	key: "k-m",
	description: "",
};
const buttonSet: Node = searchable({
	id: "20:1",
	name: "Botón",
	type: "COMPONENT_SET",
	key: "k-set",
	description: "Acción principal",
	componentPropertyDefinitions: {
		Tamaño: { type: "VARIANT", defaultValue: "S", variantOptions: ["S", "M"] },
		"Texto#1:0": { type: "TEXT", defaultValue: "Hola" },
	},
});
link(buttonSet, [smallVariant, mediumVariant]);
const icon: Node = {
	id: "21:1",
	name: "Icono flecha",
	type: "COMPONENT",
	key: "k-icon",
	description: "",
	componentPropertyDefinitions: {
		"Visible#2:0": { type: "BOOLEAN", defaultValue: true },
	},
};
const componentsPage: Node = searchable({
	id: "0:2",
	name: "Componentes",
	type: "PAGE",
	loadAsync: async () => {},
});
link(componentsPage, [buttonSet, icon]);

const instance = (id: string, main: Node, visible = true): Node =>
	searchable({
		id,
		name: main.name,
		type: "INSTANCE",
		visible,
		getMainComponentAsync: async () => main,
	});
const card = instance("30:5", icon);
const hiddenInside = instance("I30:5;1:1", smallVariant, false);
link(card, [hiddenInside]);
const home: Node = exportable(
	searchable({
		id: "30:1",
		name: "Inicio",
		type: "FRAME",
		boundVariables: { fills: [alias("VariableID:1:2")] },
	}),
	120,
	80,
);
link(home, [
	instance("30:2", smallVariant),
	instance("30:3", mediumVariant),
	{
		...instance("30:4", icon),
		boundVariables: {
			componentProperties: { "Visible#2:0": alias("VariableID:1:4") },
		},
	},
	card,
]);
const loose: Node = { id: "30:9", name: "Nota suelta", type: "TEXT" };
const screensPage: Node = searchable({
	id: "0:1",
	name: "Pantallas",
	type: "PAGE",
	loadAsync: async () => {},
});
link(screensPage, [home, loose]);
for (const n of home.children ?? []) searchable(n);

const nodes = new Map<string, Node>();
const index = (n: Node) => {
	nodes.set(n.id, n);
	for (const c of n.children ?? []) index(c);
};
index(screensPage);
index(componentsPage);

const variables = [
	{
		id: "VariableID:1:2",
		name: "color/fondo",
		resolvedType: "COLOR",
		scopes: ["ALL_FILLS"],
		description: "Fondo",
		valuesByMode: {
			"1:0": { r: 1, g: 1, b: 1, a: 1 },
			"1:1": alias("VariableID:1:3"),
		},
	},
	{
		id: "VariableID:1:3",
		name: "gris/900",
		resolvedType: "COLOR",
		scopes: [],
		description: "",
		valuesByMode: {
			"1:0": { r: 0.1, g: 0.1, b: 0.1, a: 1 },
			"1:1": alias("VariableID:remota"),
		},
	},
	{
		id: "VariableID:1:4",
		name: "icono/visible",
		resolvedType: "BOOLEAN",
		scopes: [],
		description: "",
		valuesByMode: { "2:0": true },
	},
];
const collections = [
	{
		id: "VariableCollectionId:1:1",
		name: "Tokens",
		modes: [
			{ modeId: "1:0", name: "Claro" },
			{ modeId: "1:1", name: "Oscuro" },
		],
		defaultModeId: "1:0",
		variableIds: ["VariableID:1:2", "VariableID:1:3"],
	},
	{
		id: "VariableCollectionId:2:1",
		name: "Flags",
		modes: [{ modeId: "2:0", name: "Único" }],
		defaultModeId: "2:0",
		variableIds: ["VariableID:1:4"],
	},
];

const paint = {
	id: "S:paint,",
	key: "paint",
	name: "Marca/Primario",
	description: "",
	paints: [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 }, opacity: 1 }],
	boundVariables: {},
};
const text = {
	id: "S:text,",
	key: "text",
	name: "Título",
	description: "Cabecera",
	fontName: { family: "Montserrat", style: "Bold" },
	fontSize: 24,
	lineHeight: { unit: "AUTO" },
	letterSpacing: { unit: "PIXELS", value: 0 },
	textCase: "ORIGINAL",
	textDecoration: "NONE",
	paragraphSpacing: 0,
	boundVariables: { fontSize: alias("VariableID:9:9") },
};

const figma = {
	root: { name: "Archivo", children: [screensPage, componentsPage] },
	currentPage: screensPage,
	skipInvisibleInstanceChildren: false,
	getNodeByIdAsync: async (id: string) => nodes.get(id) ?? null,
	base64Encode: (b: Uint8Array) => Buffer.from(b).toString("base64"),
	variables: {
		getLocalVariablesAsync: async () => variables,
		getLocalVariableCollectionsAsync: async () => collections,
		getVariableByIdAsync: async (id: string) =>
			variables.find((v) => v.id === id) ?? null,
	},
	getLocalPaintStylesAsync: async () => [paint],
	getLocalTextStylesAsync: async () => [text],
	getLocalEffectStylesAsync: async () => [],
	getLocalGridStylesAsync: async () => [],
};

// Lo que vio findAllWithCriteria mientras contaba (para comprobar que se activó skipInvisibleInstanceChildren)
const servers: FakeCdp[] = [];
const clients: CdpClient[] = [];
const readerFor = async (fake: object = figma) => {
	const server = await startFakeCdp({ figma: fake });
	servers.push(server);
	const client = new CdpClient({
		host: "127.0.0.1",
		port: server.port,
		fileUrl: FILE_URL,
		callTimeoutMs: 2000,
		readyTimeoutMs: 200,
		readyPollIntervalMs: 20,
	});
	clients.push(client);
	return new CdpFigmaReader(client);
};
after(async () => {
	for (const c of clients) c.close();
	for (const s of servers) await s.close();
});

describe("CdpFigmaReader.variables (CA-1, CA-2)", () => {
	it("todas las colecciones locales con modos, valores por modo y alias con id y nombre (null si es remota)", async () => {
		const r = await (await readerFor()).variables({
			collection: null,
			nodeId: null,
		});
		assert.ok(r.ok);
		assert.deepEqual(
			r.value.collections.map((c) => c.name),
			["Tokens", "Flags"],
		);
		const tokens = r.value.collections[0];
		assert.deepEqual(tokens?.modes, [
			{ id: "1:0", name: "Claro" },
			{ id: "1:1", name: "Oscuro" },
		]);
		assert.equal(tokens?.defaultModeId, "1:0");
		assert.deepEqual(tokens?.variables[0], {
			id: "VariableID:1:2",
			name: "color/fondo",
			resolvedType: "COLOR",
			scopes: ["ALL_FILLS"],
			description: "Fondo",
			valuesByMode: {
				"1:0": { r: 1, g: 1, b: 1, a: 1 },
				"1:1": { alias: { id: "VariableID:1:3", name: "gris/900" } },
			},
		});
		assert.deepEqual(tokens?.variables[1]?.valuesByMode["1:1"], {
			alias: { id: "VariableID:remota", name: null },
		});
		assert.equal(r.value.bindings, undefined);
	});

	it("`collection` filtra por nombre exacto", async () => {
		const r = await (await readerFor()).variables({
			collection: "Flags",
			nodeId: null,
		});
		assert.ok(r.ok);
		assert.deepEqual(
			r.value.collections.map((c) => c.name),
			["Flags"],
		);
	});

	it("con `nodeId` solo salen las variables ligadas en el subárbol y dónde", async () => {
		const r = await (await readerFor()).variables({
			collection: null,
			nodeId: "30:1",
		});
		assert.ok(r.ok);
		assert.deepEqual(r.value.bindings, [
			{ nodeId: "30:1", field: "fills", variableId: "VariableID:1:2" },
			{
				nodeId: "30:4",
				field: "componentProperties.Visible#2:0",
				variableId: "VariableID:1:4",
			},
		]);
		assert.deepEqual(
			r.value.collections.map((c) => [c.name, c.variables.map((v) => v.name)]),
			[
				["Tokens", ["color/fondo"]],
				["Flags", ["icono/visible"]],
			],
		);
	});

	it("un `nodeId` que no existe es NodeNotFound con el id", async () => {
		const r = await (await readerFor()).variables({
			collection: null,
			nodeId: "99:9",
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.nodeNotFound);
		assert.match(r.error.message, /99:9/);
	});
});

describe("CdpFigmaReader.styles (CA-3)", () => {
	it("lista los estilos locales por tipo con su valor corto y sus variables ligadas", async () => {
		const r = await (await readerFor()).styles(null);
		assert.ok(r.ok);
		assert.deepEqual(
			r.value.map((s) => [s.kind, s.name]),
			[
				["paint", "Marca/Primario"],
				["text", "Título"],
			],
		);
		assert.deepEqual(r.value[0]?.value, paint.paints);
		const title = r.value[1];
		assert.deepEqual(title?.boundVariables, {
			fontSize: { type: "VARIABLE_ALIAS", id: "VariableID:9:9" },
		});
		assert.deepEqual(title?.value, {
			fontName: { family: "Montserrat", style: "Bold" },
			fontSize: 24,
			lineHeight: { unit: "AUTO" },
			letterSpacing: { unit: "PIXELS", value: 0 },
			textCase: "ORIGINAL",
			textDecoration: "NONE",
			paragraphSpacing: 0,
		});
		assert.equal(title?.key, "text");
		assert.equal(title?.description, "Cabecera");
	});

	it("`kind` pide solo ese tipo", async () => {
		const r = await (await readerFor()).styles(STYLE_KIND.text);
		assert.ok(r.ok);
		assert.deepEqual(
			r.value.map((s) => s.kind),
			["text"],
		);
	});
});

describe("CdpFigmaReader.components (CA-4)", () => {
	it("los sets con sus opciones de variante y propiedades, y los componentes sueltos; las variantes no salen sueltas", async () => {
		const r = await (await readerFor()).components({ page: null, query: null });
		assert.ok(r.ok);
		assert.deepEqual(r.value, [
			{
				id: "20:1",
				key: "k-set",
				name: "Botón",
				type: "COMPONENT_SET",
				page: "Componentes",
				pageIndex: 1,
				description: "Acción principal",
				variants: { Tamaño: ["S", "M"] },
				properties: [{ name: "Texto#1:0", type: "TEXT", defaultValue: "Hola" }],
				variantCount: 2,
			},
			{
				id: "21:1",
				key: "k-icon",
				name: "Icono flecha",
				type: "COMPONENT",
				page: "Componentes",
				pageIndex: 1,
				description: "",
				variants: {},
				properties: [
					{ name: "Visible#2:0", type: "BOOLEAN", defaultValue: true },
				],
				variantCount: 0,
			},
		]);
	});

	it("`query` busca el texto en el nombre sin distinguir mayúsculas; `page` filtra por nombre exacto", async () => {
		const reader = await readerFor();
		const byQuery = await reader.components({ page: null, query: "ICONO" });
		assert.ok(byQuery.ok);
		assert.deepEqual(
			byQuery.value.map((c) => c.name),
			["Icono flecha"],
		);
		const byPage = await reader.components({ page: "Pantallas", query: null });
		assert.ok(byPage.ok);
		assert.deepEqual(byPage.value, []);
	});

	// Forma real del archivo de pruebas, reducida: un set con una propiedad SLOT. Figma no da `defaultValue` en un SLOT (ni
	// en un VARIANT), aunque @figma/plugin-typings lo declare siempre
	const slotFile = () => {
		const td: Node = searchable({
			id: "40:1",
			name: "Td",
			type: "COMPONENT_SET",
			key: "k-td",
			description: "",
			componentPropertyDefinitions: {
				Estado: {
					type: "VARIANT",
					defaultValue: "Normal",
					variantOptions: ["Normal"],
				},
				"Hueco#6521:429": { type: "SLOT" },
				"Texto#1:1": { type: "TEXT", defaultValue: "Celda" },
			},
		});
		link(td, [
			{
				id: "40:2",
				name: "Estado=Normal",
				type: "COMPONENT",
				key: "k-td-n",
				description: "",
			},
		]);
		const page: Node = searchable({
			id: "0:3",
			name: "Tablas",
			type: "PAGE",
			loadAsync: async () => {},
		});
		link(page, [td]);
		return { ...figma, root: { name: "Archivo", children: [page] } };
	};

	it("una propiedad SLOT, que Figma da sin defaultValue, sale con defaultValue null", async () => {
		const r = await (await readerFor(slotFile())).components({
			page: null,
			query: null,
		});
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(r.value[0]?.properties, [
			{ name: "Hueco#6521:429", type: "SLOT", defaultValue: null },
			{ name: "Texto#1:1", type: "TEXT", defaultValue: "Celda" },
		]);
	});

	it("una respuesta que no cumple nombra el componente y el campo que fallan", async () => {
		const file = slotFile();
		const td = file.root.children[0]?.children?.[0];
		assert.ok(td);
		td["key"] = 42;
		const r = await (await readerFor(file)).components({
			page: null,
			query: null,
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /los componentes/);
		assert.match(r.error.message, /«Td»/);
		assert.match(r.error.message, /\bkey\b/);
	});

	it("una página que no existe es ScriptError con su nombre", async () => {
		const r = await (await readerFor()).components({
			page: "Inexistente",
			query: null,
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /Inexistente/);
	});

	it("un set roto (Figma lanza al leer sus propiedades) aborta con un ScriptError que dice qué set, su id y su página", async () => {
		const file = slotFile();
		const td = file.root.children[0]?.children?.[0];
		assert.ok(td);
		Object.defineProperty(td, "componentPropertyDefinitions", {
			get: () => {
				throw new Error("Component set has existing errors");
			},
		});
		const r = await (await readerFor(file)).components({
			page: null,
			query: null,
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.equal(r.error.retryable, false);
		assert.match(
			r.error.message,
			/El set «Td» \(40:1, página «Tablas»\) tiene errores en Figma: Component set has existing errors/,
		);
		assert.match(r.error.nextStep, /arréglalo en Figma o quítalo/);
	});
});

describe("CdpFigmaReader.instances (CA-5)", () => {
	it("cuenta por frame de primer nivel, por el nombre del set si es variante y del componente si no, sin lo oculto dentro de instancias", async () => {
		const r = await (await readerFor()).instances({
			pages: ["Pantallas"],
			frame: null,
		});
		assert.ok(r.ok);
		assert.deepEqual(r.value, [
			{
				page: "Pantallas",
				frameId: "30:1",
				frameName: "Inicio",
				counts: { Botón: 2, "Icono flecha": 2 },
			},
		]);
		assert.equal(
			figma.skipInvisibleInstanceChildren,
			false,
			"deja skipInvisibleInstanceChildren como estaba",
		);
	});

	it("`frame` deja solo ese frame; una página que no existe es ScriptError con su nombre", async () => {
		const reader = await readerFor();
		const none = await reader.instances({
			pages: ["Pantallas"],
			frame: "Otro",
		});
		assert.ok(none.ok);
		assert.deepEqual(none.value, []);
		const missing = await reader.instances({
			pages: ["Pantallas", "Fantasma"],
			frame: null,
		});
		assert.ok(
			!missing.ok && missing.error.type === FIGMA_ERROR_TYPE.scriptError,
		);
		assert.match(missing.error.message, /Fantasma/);
	});
});

describe("CdpFigmaReader.export (CA-6)", () => {
	it("PNG a la escala pedida, con ancho y alto; SVG sin escala ni dimensiones", async () => {
		const reader = await readerFor();
		exportCalls.length = 0;
		const png = await reader.export({
			nodeIds: ["30:1"],
			format: EXPORT_FORMAT.png,
			scale: 2,
		});
		assert.ok(png.ok);
		assert.equal(png.value[0]?.nodeId, "30:1");
		assert.equal(png.value[0]?.width, 120);
		assert.equal(png.value[0]?.height, 80);
		const svg = await reader.export({
			nodeIds: ["30:1"],
			format: EXPORT_FORMAT.svg,
			scale: 2,
		});
		assert.ok(svg.ok);
		assert.equal(
			Buffer.from(svg.value[0]?.bytes ?? []).toString(),
			'<svg width="120"/>',
		);
		assert.equal(svg.value[0]?.width, undefined);
		assert.deepEqual(exportCalls, [
			{
				id: "30:1",
				settings: { format: "PNG", constraint: { type: "SCALE", value: 2 } },
			},
			{ id: "30:1", settings: { format: "SVG" } },
		]);
	});

	it("un id que no existe es NodeNotFound con el id y no exporta ninguno", async () => {
		const reader = await readerFor();
		exportCalls.length = 0;
		const r = await reader.export({
			nodeIds: ["30:1", "99:9"],
			format: EXPORT_FORMAT.png,
			scale: 1,
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.nodeNotFound);
		assert.match(r.error.message, /99:9/);
		assert.deepEqual(exportCalls, []);
	});
});

describe("CdpFigmaReader: respuestas que no cumplen", () => {
	it("una respuesta con otra forma es ScriptError «Respuesta inesperada»", async () => {
		const broken = {
			...figma,
			getLocalPaintStylesAsync: async () => [{ id: 1 }],
		};
		const r = await (await readerFor(broken)).styles(STYLE_KIND.paint);
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.error.message, /Respuesta inesperada/);
	});

	it("ready() es la espera a la pestaña del cliente", async () => {
		assert.deepEqual(await (await readerFor()).ready(), {
			ok: true,
			value: true,
		});
	});
});

describe("CdpFigmaReader.designContext", () => {
	const fill = (id: string) => ({
		type: "SOLID",
		color: { r: 1, g: 1, b: 1 },
		boundVariables: { color: alias(id) },
	});
	const base = (id: string, name: string, type: string): Node => ({
		id,
		name,
		type,
		visible: true,
		x: 0,
		y: 0,
		width: 100,
		height: 50,
		layoutMode: "NONE",
		fills: [],
		strokes: [],
		effects: [],
		opacity: 1,
		getSharedPluginData: () => "",
	});
	const page: Node = {
		id: "0:1",
		name: "Pantallas",
		type: "PAGE",
		loadAsync: async () => {},
	};
	const root = base("50:1", "Portada", "FRAME");
	root["fills"] = [fill("VariableID:1:2")];
	root["parent"] = page;
	const label = base("50:2", "Título", "TEXT");
	Object.assign(label, {
		characters: "Hola",
		fontName: { family: "Inter", style: "Bold" },
		fontSize: 20,
		lineHeight: { unit: "AUTO" },
		letterSpacing: { unit: "PERCENT", value: 0 },
		textStyleId: "",
		getStyledTextSegments: () => [],
	});
	link(root, [label]);
	const set: Node = {
		...base("60:1", "Botón", "COMPONENT_SET"),
		key: "k-set",
		componentPropertyDefinitions: {
			Tamaño: {
				type: "VARIANT",
				defaultValue: "S",
				variantOptions: ["S", "M"],
			},
		},
		parent: page,
	};
	const small: Node = {
		...base("60:2", "Tamaño=S", "COMPONENT"),
		variantProperties: { Tamaño: "S" },
	};
	link(set, [small]);
	set["defaultVariant"] = small;
	const world = new Map<string, Node>(
		[root, label, set, small].map((n) => [n.id, n]),
	);
	const fake = {
		mixed: Symbol("mixed"),
		root: { name: "Archivo" },
		getNodeByIdAsync: async (id: string) => world.get(id) ?? null,
		getStyleByIdAsync: async () => null,
		variables: {
			getVariableByIdAsync: async (id: string) =>
				id === "VariableID:1:2"
					? {
							id,
							name: "color/fondo",
							resolvedType: "COLOR",
							variableCollectionId: "VariableCollectionId:1:1",
							valuesByMode: { "1:0": { r: 1, g: 1, b: 1, a: 1 } },
						}
					: null,
			getVariableCollectionByIdAsync: async () => ({
				name: "Tokens",
				defaultModeId: "1:0",
			}),
		},
	};
	const query = { nodeId: "50:1", maxNodes: 400, variant: null };

	it("lee el nodo con el script interno y valida la respuesta con el contrato", async () => {
		const r = await (await readerFor(fake)).designContext(query);
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.fileName, "Archivo");
		assert.equal(r.value.root, "50:1");
		assert.deepEqual(
			r.value.nodes.map((n) => [n.id, n.parent]),
			[
				["50:1", null],
				["50:2", "50:1"],
			],
		);
		assert.deepEqual(r.value.nodes[0]?.fills, [{ variable: "VariableID:1:2" }]);
		assert.equal(r.value.variables["VariableID:1:2"]?.collection, "Tokens");
	});

	it("un nodo que no existe es NodeNotFound", async () => {
		const r = await (await readerFor(fake)).designContext({
			...query,
			nodeId: "9:9",
		});
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.nodeNotFound);
	});

	it("una variante que no existe en el set es ContractError con las opciones válidas, reintentable no", async () => {
		const r = await (await readerFor(fake)).designContext({
			nodeId: "60:1",
			maxNodes: 400,
			variant: { Tamaño: "XL" },
		});
		assert.ok(!r.ok);
		assert.equal(r.error.type, "ContractError");
		assert.equal(r.error.retryable, false);
		assert.match(r.error.message, /Tamaño/);
		assert.match(r.error.message, /S, M/);
		assert.match(r.error.message, /XL/);
	});

	it("una respuesta que no cumple el contrato es un error que dice dónde", async () => {
		const broken = {
			...fake,
			getNodeByIdAsync: async (id: string) =>
				id === "50:1" ? { ...root, type: undefined } : (world.get(id) ?? null),
		};
		const r = await (await readerFor(broken)).designContext(query);
		assert.ok(!r.ok);
		assert.match(r.error.message, /contexto de diseño/);
	});

	it("una instancia de un set roto aborta con un ScriptError que dice qué set, su id y su página", async () => {
		const brokenSet: Node = { ...set };
		Object.defineProperty(brokenSet, "componentPropertyDefinitions", {
			get: () => {
				throw new Error("Component set has existing errors");
			},
		});
		const variant: Node = { ...small, parent: brokenSet };
		const frame = base("70:1", "Marco", "FRAME");
		frame["parent"] = page;
		const used: Node = {
			...base("70:2", "Botón", "INSTANCE"),
			componentProperties: {},
			overrides: [],
			getMainComponentAsync: async () => variant,
		};
		link(frame, [used]);
		const r = await (
			await readerFor({
				...fake,
				getNodeByIdAsync: async (id: string) =>
					id === "70:1" ? frame : (world.get(id) ?? null),
			})
		).designContext({ ...query, nodeId: "70:1" });
		assert.ok(!r.ok && r.error.type === FIGMA_ERROR_TYPE.scriptError);
		assert.match(
			r.error.message,
			/El set «Botón» \(60:1, página «Pantallas»\) tiene errores en Figma: Component set has existing errors/,
		);
		assert.match(r.error.nextStep, /arréglalo en Figma o quítalo/);
	});
});
