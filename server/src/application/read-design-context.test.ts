import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PaintMatch } from "#domain/design-context/to-code.ts";
import {
	DESIGN_CONTEXT_CONTRACT,
	type DesignRead,
} from "#domain/design-context.ts";
import {
	FIGMA_ERROR_TYPE,
	nodeNotFound,
	projectConfigError,
} from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import type { SheetsFile } from "#domain/sheets.ts";
import {
	makeReadDesignContext,
	type ReadDesignContextDeps,
} from "./read-design-context.ts";
import {
	InMemoryProjectConfig,
	projectWith,
} from "./testing/in-memory-web-capture.ts";
import { READ_AT, readSetup } from "./testing/read-setup.ts";

const SHEETS: SheetsFile = {
	contract: "sheets@1",
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
			title: "Botón",
			page: { name: "Botón" },
			description: "",
			source: "templates/button.html",
			tag: "<c-button>",
		},
	],
};

const READ: DesignRead = {
	fileName: "Archivo de ejemplo",
	root: "10:1",
	origin: { kind: "screen", key: "inicio" },
	nodes: [
		{
			id: "10:1",
			parent: null,
			name: "Portada",
			type: "FRAME",
			visible: true,
			box: { x: 0, y: 0, w: 10, h: 10 },
			fills: [{ raw: { type: "SOLID" } }],
		},
		{
			id: "10:2",
			parent: "10:1",
			name: "Botón",
			type: "INSTANCE",
			visible: true,
			box: { x: 0, y: 0, w: 10, h: 10 },
			instance: {
				component: "k-boton",
				variant: {},
				props: {},
				overridden: [],
			},
		},
	],
	variables: {},
	styles: {},
	components: {
		"k-boton": {
			name: "Botón",
			kind: "COMPONENT_SET",
			key: "k-boton",
			remote: false,
			variants: {},
			properties: [],
		},
		"k-tarjeta": {
			name: "Tarjeta",
			kind: "COMPONENT_SET",
			key: "k-tarjeta",
			remote: false,
			variants: {},
			properties: [],
		},
	},
};

type Shot = { path: string; bytes: number; width: number; height: number };

function setup(
	over: {
		read?: DesignRead;
		sheets?: SheetsFile | null;
		matches?: (screen: string) => readonly PaintMatch[];
		screenshot?: ReadDesignContextDeps["screenshot"];
	} = {},
) {
	const base = readSetup();
	base.reader.designContextReply = async () => ok(over.read ?? READ);
	const project = new InMemoryProjectConfig(
		projectWith(
			[],
			{},
			null,
			null,
			{},
			{
				sheets: over.sheets === undefined ? SHEETS : over.sheets,
			},
		),
	);
	const shots: { nodeId: string; scale: number }[] = [];
	const screenshot =
		over.screenshot ??
		(async (nodeId: string, scale: number) => {
			shots.push({ nodeId, scale });
			return ok<Shot>({
				path: "/salida/screenshots/x.png",
				bytes: 5,
				width: 1,
				height: 1,
			});
		});
	const askedScreens: string[] = [];
	const run = makeReadDesignContext({
		...base.deps,
		project,
		screenshot,
		paintMatches:
			over.matches ??
			((screen) => {
				askedScreens.push(screen);
				return [];
			}),
		fileKey: "KEY123",
		maxNodes: 400,
	});
	return { ...base, project, run, shots, askedScreens };
}

const stored = (store: { reads: { json: string }[] }) =>
	JSON.parse(store.reads[0]?.json ?? "{}");

describe("makeReadDesignContext", () => {
	it("deja design-context@1 en reads/ con la clave del archivo, la hora y el mapeo a código", async () => {
		const { store, run } = setup();
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.match(store.reads[0]?.name.tool ?? "", /^design-context_10:1$/);
		const file = stored(store);
		assert.equal(file.contract, DESIGN_CONTEXT_CONTRACT);
		assert.deepEqual(file.file, { key: "KEY123", name: "Archivo de ejemplo" });
		assert.equal(file.readAt, READ_AT.toISOString());
		assert.deepEqual(file.components["k-boton"].code, {
			source: "templates/button.html",
			tag: "<c-button>",
			by: "name",
		});
		assert.deepEqual(file.origin, { kind: "screen", key: "inicio" });
	});

	it("el resumen cuenta nodos, componentes, variables, estilos, sin plantilla y valores sueltos", async () => {
		const { run } = setup();
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.value.summary, {
			nodes: 2,
			components: 2,
			variables: 0,
			styles: 0,
			noCodeMapping: 1,
			unmapped: 1,
		});
	});

	it("la respuesta trae los avisos y los valores sueltos (los cinco primeros) y si se cortó", async () => {
		const { run } = setup();
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		const v = r.outcome.value;
		assert.equal(v.warnings.length, 1);
		assert.equal(v.warnings[0]?.code, "NO_CODE_MAPPING");
		assert.deepEqual(v.unmapped, [
			{ node: "10:1", name: "Portada", fields: ["fills"] },
		]);
		assert.equal(v.truncated, null);
	});

	it("limita a cinco los avisos y los valores sueltos de la respuesta, no el conteo", async () => {
		const components = Object.fromEntries(
			Array.from({ length: 7 }, (_, i) => [
				`k${i}`,
				{
					name: `C${i}`,
					kind: "COMPONENT_SET" as const,
					key: `k${i}`,
					remote: false,
					variants: {},
					properties: [],
				},
			]),
		);
		const { run } = setup({ read: { ...READ, components } });
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.value.warnings.length, 5);
		assert.equal(r.outcome.value.summary["noCodeMapping"], 7);
	});

	it("un recorte sale en la respuesta con cuántos faltan", async () => {
		const read: DesignRead = {
			...READ,
			truncated: { reason: "max-nodes", children: ["1:1", "1:2", "1:3"] },
		};
		const { store, run } = setup({ read });
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.deepEqual(r.outcome.value.truncated, {
			reason: "max-nodes",
			missing: 3,
		});
		assert.deepEqual(stored(store).truncated.children, ["1:1", "1:2", "1:3"]);
	});

	it("pasa al lector el tope por defecto o el pedido, y la variante", async () => {
		const { reader, run } = setup();
		await run({ nodeId: "10:1" });
		await run({ nodeId: "10:1", maxNodes: 50, variant: { Tamaño: "M" } });
		assert.deepEqual(reader.designContextCalls, [
			{ nodeId: "10:1", maxNodes: 400, variant: null },
			{ nodeId: "10:1", maxNodes: 50, variant: { Tamaño: "M" } },
		]);
	});

	it("saca la captura del nodo por defecto y la ruta va en la respuesta; con `screenshot: false` no", async () => {
		const { run, shots } = setup();
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.value.screenshotPath, "/salida/screenshots/x.png");
		assert.deepEqual(shots, [{ nodeId: "10:1", scale: 1 }]);
		const off = await run({ nodeId: "10:1", screenshot: false });
		assert.ok(off.kind === "finished" && off.outcome.ok);
		assert.equal(off.outcome.value.screenshotPath, null);
		assert.equal(shots.length, 1);
	});

	it("si la captura falla, el contexto se guarda igual y avisa SCREENSHOT_FAILED", async () => {
		const { run, store } = setup({
			screenshot: async () => err(nodeNotFound("10:1")),
		});
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.value.screenshotPath, null);
		assert.ok(
			r.outcome.value.warnings.some((w) => w.code === "SCREENSHOT_FAILED"),
		);
		assert.equal(store.reads.length, 1);
	});

	it("sin sheets@1 en el proyecto, ningún componente tiene plantilla", async () => {
		const { run, store } = setup({ sheets: null });
		await run({ nodeId: "10:1" });
		assert.equal(stored(store).components["k-boton"].code, undefined);
	});

	it("un proyecto que no se puede leer es el error de configuración, sin tocar Figma", async () => {
		const { run, project, reader } = setup();
		project.reply = async () =>
			err(projectConfigError("figma-control-center.json", "sheets", "roto"));
		const r = await run({ nodeId: "10:1" });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, "ProjectConfigError");
		assert.equal(reader.designContextCalls.length, 0);
	});

	it("un error del lector (nodo inexistente, variante) sale tal cual y no guarda nada", async () => {
		const { run, reader, store } = setup();
		reader.designContextReply = async () => err(nodeNotFound("9:9"));
		const r = await run({ nodeId: "9:9" });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.nodeNotFound);
		assert.equal(store.reads.length, 0);
	});

	it("`matched` sale de las coincidencias de la pantalla del origen: la clave de `screen`, o la pantalla tras la «/» de `area`", async () => {
		for (const [origin, expected] of [
			[{ kind: "screen", key: "inicio" }, "inicio"],
			[{ kind: "area", key: "app/inicio" }, "inicio"],
		] as const) {
			const { run, askedScreens } = setup({ read: { ...READ, origin } });
			await run({ nodeId: "10:1" });
			assert.deepEqual(askedScreens, [expected]);
		}
		const none = setup({
			read: { ...READ, origin: { kind: "sheet", key: "button" } },
		});
		await none.run({ nodeId: "10:1" });
		assert.deepEqual(none.askedScreens, []);
		const noOrigin = setup({ read: { ...READ, origin: undefined } });
		await noOrigin.run({ nodeId: "10:1" });
		assert.deepEqual(noOrigin.askedScreens, []);
	});

	it("`matched.by` llega a la instancia nombrada", async () => {
		const { run, store } = setup({
			matches: () => [{ node: "10:2", set: "Boton", by: "rule:boton" }],
		});
		await run({ nodeId: "10:1" });
		assert.deepEqual(stored(store).nodes[1].matched, { by: "rule:boton" });
	});
});
