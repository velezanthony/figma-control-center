// kit.steps.links: los enlaces del área, el punto de inicio y el recorte. Trampas: 4, 5, 12.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { button, PANEL, paramsOf, warningCodes } from "../areas-support.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

type Link = {
	area: string;
	from: string;
	text?: string;
	rows?: true;
	to: string;
	count: number;
	unchanged: number;
};
const linksOf = (r: { report?: unknown }) =>
	(r.report as { links: Link[] }).links;

function scene(fake: FakeFigma) {
	const page = fake.page("Panel");
	const frames: Record<string, FakeNode> = {};
	for (const name of ["Inicio", "Detalle"])
		frames[name] = fake.node(page, "FRAME", name);
	const home = frames["Inicio"] as FakeNode;
	const view = button(fake, home, "Ver detalle");
	const viewAll = button(fake, home, "Ver todos");
	const body = fake.node(home, "FRAME", "cuerpo");
	const row1 = fake.node(body, "FRAME", "fila");
	const row2 = fake.node(body, "FRAME", "fila");
	// el shell lleva su propio «Ver detalle» y se salta
	const shellSet = fake.componentSet(page, "Panel / Lateral", [
		{ activa: "inicio" },
	]);
	const shell = fake.node(home, "INSTANCE", "Panel / Lateral");
	shell.main = shellSet.children[0] as FakeNode;
	const inShell = button(fake, shell, "Ver detalle");
	return { page, frames, home, view, viewAll, row1, row2, inShell };
}

const AREA = {
	...PANEL,
	screens: [{ frame: "Inicio" }, { frame: "Detalle" }],
	links: [
		{ from: "Inicio", text: "Ver detalle", to: "Detalle" },
		{ from: "Inicio", text: "Ver", match: "start" as const, to: "Detalle" },
		{ from: "Inicio", rows: true as const, to: "Detalle" },
	],
	flowStart: { frame: "Inicio", name: "Panel" },
};

describe("kit.steps.links", () => {
	it("pone los enlaces por texto y por filas, sin tocar el shell, y da las cuentas; cumple step@1", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const result = await kit.steps.links(paramsOf(AREA) as never, {});
		assert.equal(StepResultSchema.safeParse(result).success, true);
		assert.equal(s.view.reactions.length, 1);
		assert.equal(s.viewAll.reactions.length, 1);
		assert.equal(s.row1.reactions.length, 1);
		assert.equal(s.row2.reactions.length, 1);
		assert.equal(s.inShell.reactions.length, 0);
		const links = linksOf(result);
		assert.deepEqual(
			links.map((l) => [l.from, l.text ?? "filas", l.to, l.count, l.unchanged]),
			[
				["Inicio", "Ver detalle", "Detalle", 1, 0],
				["Inicio", "Ver", "Detalle", 2, 1],
				["Inicio", "filas", "Detalle", 2, 0],
			],
		);
		assert.equal(links[0]?.area, "Panel");
	});

	it("repetirlo no cambia nada: todo `unchanged`, sin escribir reacciones (trampa 5, la duración vuelve en 32 bits)", async () => {
		const { fake, kit } = setup();
		scene(fake);
		await kit.steps.links(paramsOf(AREA) as never, {});
		const writes = fake.stats.reactionWrites;
		const again = await kit.steps.links(paramsOf(AREA) as never, {});
		assert.equal(fake.stats.reactionWrites, writes);
		for (const l of linksOf(again)) assert.equal(l.unchanged, l.count);
		assert.deepEqual(again.mutatedNodeIds, []);
	});

	it("un enlace con cuenta 0 no es un error: avisa LINK_ZERO con el texto", async () => {
		const { fake, kit } = setup();
		scene(fake);
		const area = {
			...AREA,
			links: [{ from: "Inicio", text: "No existe", to: "Detalle" }],
		};
		const result = await kit.steps.links(paramsOf(area) as never, {});
		assert.deepEqual(
			warningCodes(result).filter((c) => c !== "ADOPTED"),
			["LINK_ZERO"],
		);
		assert.match(
			result.warnings?.find((w) => w.code === "LINK_ZERO")?.message ?? "",
			/Inicio: No existe → Detalle ×0/,
		);
		assert.equal(linksOf(result)[0]?.count, 0);
	});

	it("un enlace a sí mismo no se hace", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const area = {
			...AREA,
			links: [{ from: "Inicio", text: "Ver detalle", to: "Inicio" }],
			flowStart: undefined,
		};
		const result = await kit.steps.links(paramsOf(area) as never, {});
		assert.equal(s.view.reactions.length, 0);
		assert.deepEqual(linksOf(result), []);
	});

	it("el punto de inicio conserva los de otros (trampa 12, medida)", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		s.page.flowStartingPoints = [
			{ nodeId: (s.frames["Detalle"] as FakeNode).id, name: "Móvil" },
		];
		await kit.steps.links(paramsOf(AREA) as never, {});
		assert.deepEqual(
			s.page.flowStartingPoints.map((p) => p.name),
			["Móvil", "Panel"],
		);
	});

	it("con `frame.clip` activa el recorte de cada frame del área", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.links(paramsOf(AREA) as never, {});
		for (const f of Object.values(s.frames)) assert.equal(f.clipsContent, true);
	});

	it("un `clickable` del área sustituye al común", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const other = fake.node(s.home, "FRAME", "otro-boton");
		fake.text(other, "t", "Especial");
		const area = {
			...AREA,
			clickable: { names: ["otro-boton"], namePrefixes: [], components: [] },
			links: [{ from: "Inicio", text: "Especial", to: "Detalle" }],
		};
		const result = await kit.steps.links(paramsOf(area) as never, {});
		assert.equal(linksOf(result)[0]?.count, 1);
		assert.equal(other.reactions.length, 1);
	});

	it("falta un frame en Figma: AREA_NOT_FOUND con la lista, sin escribir nada", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		s.frames["Detalle"]?.remove();
		await assert.rejects(
			kit.steps.links(paramsOf(AREA) as never, {}),
			(e: Error) =>
				e.message.includes("AREA_NOT_FOUND") && e.message.includes("Detalle"),
		);
		assert.equal(fake.stats.reactionWrites, 0);
	});
});

// Lo que hacían los scripts de enlaces de las otras áreas (modos de coincidencia, filas → detalle y chips) cabe en los
// mismos datos: nada de esto necesita un campo nuevo en areas@1
function instanceOf(
	fake: FakeFigma,
	parent: FakeNode,
	set: FakeNode,
	label: string,
): FakeNode {
	const inst = fake.node(parent, "INSTANCE", set.name);
	inst.main = set.children[0] as FakeNode;
	fake.text(inst, "t", label);
	return inst;
}

const CHIPS = ["Boton", "Chip button", "Chip radio"];

function listScene(fake: FakeFigma) {
	const page = fake.page("Panel");
	const frames: Record<string, FakeNode> = {};
	for (const name of ["Inicio", "Lista", "Detalle", "Otro"])
		frames[name] = fake.node(page, "FRAME", name);
	return { page, frames };
}

describe("kit.steps.links: modos de coincidencia", () => {
	it("exact es el modo por defecto; start y contains solo cambian cómo se compara el texto", async () => {
		const { fake, kit } = setup();
		const { frames } = listScene(fake);
		const home = frames["Inicio"] as FakeNode;
		const exact = button(fake, home, "Proyectos");
		const prefixed = button(fake, home, "Proyectos pendientes");
		const containing = button(fake, home, "Todos los Proyectos");
		const area = {
			...PANEL,
			screens: ["Inicio", "Lista", "Detalle", "Otro"].map((frame) => ({
				frame,
			})),
			links: [
				{ from: "Inicio", text: "Proyectos", to: "Lista" },
				{
					from: "Inicio",
					text: "Proyectos ",
					match: "start" as const,
					to: "Detalle",
				},
				{
					from: "Inicio",
					text: "los Proy",
					match: "contains" as const,
					to: "Otro",
				},
			],
		};
		const result = await kit.steps.links(paramsOf(area) as never, {});
		const dest = (n: FakeNode) =>
			(n.reactions[0] as { actions: { destinationId: string }[] } | undefined)
				?.actions[0]?.destinationId;
		assert.equal(dest(exact), (frames["Lista"] as FakeNode).id);
		assert.equal(dest(prefixed), (frames["Detalle"] as FakeNode).id);
		assert.equal(dest(containing), (frames["Otro"] as FakeNode).id);
		assert.deepEqual(
			linksOf(result).map((l) => l.count),
			[1, 1, 1],
		);
	});

	it("el modo es opcional y exact no confunde «Ver» con «Ver todos»", async () => {
		const { fake, kit } = setup();
		const { frames } = listScene(fake);
		const home = frames["Inicio"] as FakeNode;
		const view = button(fake, home, "Ver");
		const viewAll = button(fake, home, "Ver todos");
		const area = {
			...PANEL,
			screens: [{ frame: "Inicio" }, { frame: "Detalle" }],
			links: [{ from: "Inicio", text: "Ver", to: "Detalle" }],
		};
		await kit.steps.links(paramsOf(area) as never, {});
		assert.equal(view.reactions.length, 1);
		assert.equal(viewAll.reactions.length, 0);
	});
});

describe("kit.steps.links: pares fila → detalle", () => {
	it("las filas del cuerpo van al detalle, el detalle vuelve por texto exacto y por «Volver a…»", async () => {
		const { fake, kit } = setup();
		const { frames } = listScene(fake);
		const list = frames["Lista"] as FakeNode;
		const body = fake.node(list, "FRAME", "cuerpo");
		const rows = [1, 2, 3].map(() => fake.node(body, "FRAME", "fila"));
		const header = fake.node(list, "FRAME", "cabecera");
		const outside = fake.node(header, "FRAME", "fila");
		const detail = frames["Detalle"] as FakeNode;
		const back = button(fake, detail, "Lista");
		const backToList = button(fake, detail, "Volver a la lista");
		const area = {
			...PANEL,
			screens: [{ frame: "Lista" }, { frame: "Detalle" }],
			links: [
				{ from: "Lista", rows: true as const, to: "Detalle" },
				{ from: "Detalle", text: "Lista", to: "Lista" },
				{
					from: "Detalle",
					text: "Volver a",
					match: "start" as const,
					to: "Lista",
				},
			],
		};
		const result = await kit.steps.links(paramsOf(area) as never, {});
		for (const row of rows) assert.equal(row.reactions.length, 1);
		assert.equal(outside.reactions.length, 0);
		assert.equal(back.reactions.length, 1);
		assert.equal(backToList.reactions.length, 1);
		assert.deepEqual(
			linksOf(result).map((l) => l.count),
			[3, 1, 1],
		);
	});

	it("los nombres de fila y de cuerpo son listas: sirve cualquiera de las dos convenciones", async () => {
		const { fake, kit } = setup();
		const { frames } = listScene(fake);
		const list = frames["Lista"] as FakeNode;
		const oldBody = fake.node(list, "FRAME", "tbody");
		const newBody = fake.node(list, "FRAME", "cuerpo de tabla");
		const a = fake.node(oldBody, "FRAME", "tr");
		const b = fake.node(newBody, "FRAME", "fila de tabla");
		const area = {
			...PANEL,
			screens: [{ frame: "Lista" }, { frame: "Detalle" }],
			links: [{ from: "Lista", rows: true as const, to: "Detalle" }],
		};
		const params = {
			...paramsOf(area),
			linkRules: {
				...paramsOf(area).linkRules,
				rows: {
					row: ["tr", "fila de tabla"],
					body: ["tbody", "cuerpo de tabla"],
				},
			},
		};
		const result = await kit.steps.links(params as never, {});
		assert.equal(a.reactions.length, 1);
		assert.equal(b.reactions.length, 1);
		assert.equal(linksOf(result)[0]?.count, 2);
	});
});

describe("kit.steps.links: botones Chip", () => {
	function chipScene(fake: FakeFigma) {
		const { page, frames } = listScene(fake);
		const home = frames["Inicio"] as FakeNode;
		const chipButton = fake.componentSet(page, "Chip button", [
			{ estado: "off" },
		]);
		const chipRadio = fake.componentSet(page, "Chip radio", [
			{ estado: "off" },
		]);
		return {
			frames,
			button: instanceOf(fake, home, chipButton, "Listado"),
			radio: instanceOf(fake, home, chipRadio, "Panel"),
		};
	}
	const area = (clickable?: {
		names: string[];
		namePrefixes: string[];
		components: string[];
	}) => ({
		...PANEL,
		screens: [{ frame: "Inicio" }, { frame: "Detalle" }],
		...(clickable === undefined ? {} : { clickable }),
		links: [
			{ from: "Inicio", text: "Listado", to: "Detalle" },
			{ from: "Inicio", text: "Panel", to: "Detalle" },
		],
	});

	it("un área que declara los componentes Chip como pulsables los enlaza", async () => {
		const { fake, kit } = setup();
		const s = chipScene(fake);
		const result = await kit.steps.links(
			paramsOf(
				area({ names: ["boton"], namePrefixes: [], components: CHIPS }),
			) as never,
			{},
		);
		assert.equal(s.button.reactions.length, 1);
		assert.equal(s.radio.reactions.length, 1);
		assert.deepEqual(
			linksOf(result).map((l) => l.count),
			[1, 1],
		);
	});

	it("sin esa declaración (área que no los usa) los chips no se tocan y el enlace avisa LINK_ZERO", async () => {
		const { fake, kit } = setup();
		const s = chipScene(fake);
		const result = await kit.steps.links(paramsOf(area()) as never, {});
		assert.equal(s.button.reactions.length, 0);
		assert.equal(s.radio.reactions.length, 0);
		assert.deepEqual(
			warningCodes(result).filter((c) => c !== "ADOPTED"),
			["LINK_ZERO", "LINK_ZERO"],
		);
	});
});
