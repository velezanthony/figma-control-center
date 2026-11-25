import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMPONENT_TYPE, STYLE_KIND } from "#domain/catalog.ts";
import {
	COMPOSE_CONTRACT,
	type ComposeBlock,
	type ComposeFile,
} from "#domain/compose.ts";
import {
	FIGMA_ERROR_TYPE,
	figmaNotReady,
	WEB_ERROR_TYPE,
} from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { SHEETS_CONTRACT, type SheetsFile } from "#domain/sheets.ts";
import { makeComposePlan } from "./compose-plan.ts";
import { InMemoryComposeStore } from "./testing/in-memory-compose-store.ts";
import { InMemoryFigmaReader } from "./testing/in-memory-figma-reader.ts";
import { projectWith } from "./testing/in-memory-web-capture.ts";

const SHEETS: SheetsFile = {
	contract: SHEETS_CONTRACT,
	style: {
		header: { fill: "a", text: "b" },
		card: { fill: "c" },
		texts: {
			description: "d",
			bug: "e",
			tag: "f",
			rowLabel: "g",
			colLabel: "h",
		},
		matrix: { stroke: "i" },
	},
	sheets: [
		{
			key: "button",
			screen: "cmp-button",
			title: "Button",
			page: { name: "Button" },
			description: "d",
		},
		{
			key: "badge",
			screen: "cmp-badge",
			title: "Badge",
			page: { name: "Badge" },
			description: "d",
		},
	],
};

const composeOf = (root: ComposeBlock): ComposeFile => ({
	contract: COMPOSE_CONTRACT,
	key: "alta",
	title: "Alta",
	target: { page: "Pruebas", width: 640 },
	root,
});

const VALID = composeOf({
	stack: "VERTICAL",
	gap: "spacing/4",
	fill: "surface",
	children: [
		{ text: "Alta", style: "Título/L" },
		{ use: "button", variant: { tipo: "primary" }, props: { Etiqueta: "Ok" } },
	],
});

function setup(compose: ComposeFile | null = VALID) {
	const reader = new InMemoryFigmaReader();
	reader.componentsReply = async () =>
		ok([
			{
				id: "1:1",
				key: "k",
				name: "Button",
				type: COMPONENT_TYPE.set,
				page: "Button",
				pageIndex: 0,
				description: "",
				variants: { tipo: ["primary", "ghost"] },
				properties: [{ name: "Etiqueta#1:2", type: "TEXT", defaultValue: "x" }],
				variantCount: 2,
			},
		]);
	reader.variablesReply = async () =>
		ok({
			collections: [
				{
					id: "c1",
					name: "Tokens",
					modes: [{ id: "m", name: "M" }],
					defaultModeId: "m",
					variables: [
						{ name: "spacing/4", resolvedType: "FLOAT" },
						{ name: "surface", resolvedType: "COLOR" },
					].map((v, i) => ({
						id: `v${i}`,
						scopes: [],
						description: "",
						valuesByMode: {},
						...v,
					})),
				},
			],
		});
	reader.stylesReply = async (kind) =>
		ok(
			kind === STYLE_KIND.text
				? [
						{
							id: "S:1",
							key: "s",
							name: "Título/L",
							kind: STYLE_KIND.text,
							description: "",
							boundVariables: {},
							value: {},
						},
					]
				: [],
		);
	const store = new InMemoryComposeStore();
	if (compose !== null) store.composes.set(compose.key, compose);
	const project = projectWith(
		[],
		{},
		null,
		null,
		{},
		{
			sheets: SHEETS,
			sheetsSource: { path: "/p/sheets.json", sha256: "x", text: "{}" },
			composeDir: "/p/compose",
		},
	);
	const plan = makeComposePlan({ reader, composes: store });
	return { reader, store, project, plan };
}

const noReads = (r: InMemoryFigmaReader) =>
	r.readyCalls +
	r.componentsCalls.length +
	r.variablesCalls.length +
	r.stylesCalls.length;

describe("makeComposePlan", () => {
	it("un compose válido da los params: el compose y solo las hojas que usa, con su título", async () => {
		const { plan, project, store } = setup();
		const r = await plan(project, { compose: "alta" });
		assert.equal(r.kind, "ok");
		if (r.kind !== "ok") return;
		assert.deepEqual(r.run.params, {
			compose: VALID,
			sheets: [{ key: "button", title: "Button" }],
		});
		assert.deepEqual(store.reads, [{ dir: "/p/compose", key: "alta" }]);
	});

	it("lo que guarda el historial: el compose como estaba y el sheets.json que se usó", async () => {
		const { plan, project } = setup();
		const r = await plan(project, { compose: "alta" });
		if (r.kind !== "ok") return assert.fail("debía ir bien");
		assert.equal(JSON.parse(r.run.contents.plan).key, "alta");
		assert.deepEqual(r.run.contents.sheets, {
			path: "/p/sheets.json",
			content: "{}",
		});
	});

	it("lee el catálogo del archivo con tres lecturas y ninguna escritura", async () => {
		const { plan, project, reader } = setup();
		await plan(project, { compose: "alta" });
		assert.equal(reader.readyCalls, 1);
		assert.deepEqual(reader.componentsCalls, [{ page: null, query: null }]);
		assert.deepEqual(reader.variablesCalls, [
			{ collection: null, nodeId: null },
		]);
		assert.deepEqual(reader.stylesCalls, [STYLE_KIND.text]);
	});

	it("sin `compose` en project@1 es un ProjectConfigError del campo", async () => {
		const { plan, project } = setup();
		const r = await plan({ ...project, composeDir: null }, { compose: "alta" });
		assert.equal(r.kind, "error");
		if (r.kind !== "error") return;
		assert.equal(r.error.type, WEB_ERROR_TYPE.projectConfigError);
	});

	it("un compose que no está es un error de uso con la ruta donde lo esperaba", async () => {
		const { plan, project, reader } = setup(null);
		const r = await plan(project, { compose: "alta" });
		assert.equal(r.kind, "usage");
		if (r.kind !== "usage") return;
		assert.match(r.message, /\/p\/compose\/alta\.json/);
		assert.equal(noReads(reader), 0);
	});

	it("una clave que el almacén rechaza es un error de uso", async () => {
		const { plan, project, store } = setup();
		store.reply = () => ({ kind: "usage", message: "clave mala" });
		const r = await plan(project, { compose: "../x" });
		assert.deepEqual(r, { kind: "usage", message: "clave mala" });
	});

	it("un fichero que no cumple compose@1 llega como el ContractError del almacén, sin lecturas", async () => {
		const { plan, project, store, reader } = setup();
		const error = {
			type: WEB_ERROR_TYPE.contractError,
			message: "m",
			retryable: true,
			nextStep: "n",
		} as never;
		store.reply = () => ({ kind: "error", error });
		const r = await plan(project, { compose: "alta" });
		assert.deepEqual(r, { kind: "error", error });
		assert.equal(noReads(reader), 0);
	});

	it("E100: un color suelto y una hoja que no existe son ContractError con puntero, sin ninguna lectura de Figma", async () => {
		const { plan, project, reader } = setup(
			composeOf({
				stack: "VERTICAL",
				fill: "#ff6600",
				children: [{ use: "tarjeta" }],
			}),
		);
		const r = await plan(project, { compose: "alta" });
		assert.equal(r.kind, "error");
		if (r.kind !== "error") return;
		assert.equal(r.error.type, WEB_ERROR_TYPE.contractError);
		assert.equal(r.error.path, "/root/fill");
		assert.match(r.error.message, /\/root\/children\/0\/use/);
		assert.equal(noReads(reader), 0);
	});

	it("E100: una variante y un token que no existen se ven tras leer el catálogo, sin escribir nada", async () => {
		const { plan, project, reader } = setup(
			composeOf({
				stack: "VERTICAL",
				gap: "spacing/99",
				children: [{ use: "button", variant: { tipo: "rojo" } }],
			}),
		);
		const r = await plan(project, { compose: "alta" });
		assert.equal(r.kind, "error");
		if (r.kind !== "error") return;
		assert.equal(r.error.type, WEB_ERROR_TYPE.contractError);
		assert.match(r.error.message, /\/root\/gap/);
		assert.match(r.error.message, /\/root\/children\/0\/variant\/tipo/);
		assert.equal(reader.readyCalls, 1);
	});

	it("una pestaña que no está lista es el error de la lectura, no un fallo del compose", async () => {
		const { plan, project, reader } = setup();
		reader.readyReply = async () => err(figmaNotReady(0));
		const r = await plan(project, { compose: "alta" });
		assert.equal(r.kind, "error");
		if (r.kind !== "error") return;
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(reader.componentsCalls.length, 0);
	});

	it("un fallo al leer el catálogo se devuelve tal cual", async () => {
		const { plan, project, reader } = setup();
		const failure = figmaNotReady(0);
		reader.componentsReply = async () => err(failure);
		const r = await plan(project, { compose: "alta" });
		assert.deepEqual(r, { kind: "error", error: failure });
	});
});
