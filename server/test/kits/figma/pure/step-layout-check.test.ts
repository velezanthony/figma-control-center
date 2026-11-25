// kit.steps.layoutCheck: textos que se pisan, contenedores colapsados y filas desalineadas por frame,
// Solo lee. Trampas: 5, 6 y 7 (sin verificar: las cierra `make kit-contract`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { PANEL, paramsOf, RULES } from "../areas-support.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

type Row = {
	area: string;
	frame: string;
	frameId: string;
	overlaps: number;
	samples: string[];
	collapsed: number;
	misalignedRows: number;
};
const layoutOf = (r: { report?: unknown }) =>
	(r.report as { layout: Row[] }).layout;

function put(
	fake: FakeFigma,
	parent: FakeNode,
	chars: string,
	box: [number, number, number, number],
): FakeNode {
	const t = fake.text(parent, chars, chars);
	[t.x, t.y, t.width, t.height] = box;
	return t;
}

const frameOf = (fake: FakeFigma, name = "Inicio") => {
	const page = fake.page("Panel");
	return { page, frame: fake.node(page, "FRAME", name) };
};

const run = (kit: ReturnType<typeof setup>["kit"]) =>
	kit.steps.layoutCheck(paramsOf(PANEL) as never, {});

describe("kit.steps.layoutCheck", () => {
	it("un frame sin nada que decir sale con ceros (distingue «bien» de «no mirado») y cumple step@1, sin tocar nada", async () => {
		const { fake, kit } = setup();
		const { page, frame } = frameOf(fake);
		fake.node(page, "FRAME", "Detalle");
		fake.node(page, "RECTANGLE", "no es un frame");
		put(fake, frame, "Hola", [0, 0, 50, 20]);
		const result = await run(kit);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		assert.deepEqual(result.createdNodeIds, []);
		assert.deepEqual(result.mutatedNodeIds, []);
		assert.deepEqual(
			layoutOf(result).map((r) => [
				r.area,
				r.frame,
				r.overlaps,
				r.collapsed,
				r.misalignedRows,
			]),
			[
				["Panel", "Inicio", 0, 0, 0],
				["Panel", "Detalle", 0, 0, 0],
			],
		);
		assert.equal(layoutOf(result)[0]?.frameId, frame.id);
	});

	it("dos textos con la caja de línea y los glifos encima se cuentan, con su muestra «A ✕ B» de 20 caracteres", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		put(fake, frame, "Potencia de contrato en P1", [10, 10, 200, 20]);
		put(fake, frame, "Titular", [20, 15, 80, 20]);
		const row = layoutOf(await run(kit))[0] as Row;
		assert.equal(row.overlaps, 1);
		assert.deepEqual(row.samples, ["Potencia de contrato ✕ Titular"]);
	});

	it("los umbrales: 2 px de ancho y 4 de alto en la caja de línea no cuentan", async () => {
		const { fake, kit } = setup();
		const { page, frame } = frameOf(fake);
		put(fake, frame, "A", [0, 0, 50, 20]);
		put(fake, frame, "B", [48, 5, 50, 20]);
		put(fake, frame, "C", [0, 100, 50, 20]);
		put(fake, frame, "D", [10, 116, 50, 20]);
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
		const second = fake.node(page, "FRAME", "Otro");
		put(fake, second, "E", [0, 0, 50, 20]);
		put(fake, second, "F", [47, 4, 50, 20]);
		assert.equal((layoutOf(await run(kit))[1] as Row).overlaps, 1);
	});

	it("si las cajas de línea se pisan pero los glifos no, no es un solape", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		const a = put(fake, frame, "Arriba", [0, 0, 100, 40]);
		const b = put(fake, frame, "Abajo", [0, 10, 100, 40]);
		a.renderBounds = { x: 0, y: 0, width: 100, height: 10 };
		b.renderBounds = { x: 0, y: 30, width: 100, height: 10 };
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
	});

	it("lo que un contenedor con recorte deja fuera no se pisa", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		const clip = fake.node(frame, "FRAME", "recorte");
		[clip.x, clip.y, clip.width, clip.height] = [0, 0, 100, 30];
		clip.clipsContent = true;
		put(fake, clip, "Dentro", [0, 0, 100, 20]);
		put(fake, clip, "Fuera", [0, 50, 100, 20]);
		put(fake, frame, "Debajo", [0, 50, 100, 20]);
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
	});

	it("sin recorte, el mismo texto fuera de la caja sí pisa al de debajo", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		const box = fake.node(frame, "FRAME", "sin recorte");
		[box.x, box.y, box.width, box.height] = [0, 0, 100, 30];
		put(fake, box, "Fuera", [0, 50, 100, 20]);
		put(fake, frame, "Debajo", [0, 50, 100, 20]);
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 1);
	});

	it("ignora lo oculto, lo transparente y los textos vacíos", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		put(fake, frame, "Visible", [0, 0, 100, 20]);
		put(fake, frame, "Oculto", [0, 0, 100, 20]).visible = false;
		put(fake, frame, "Transparente", [0, 0, 100, 20]).opacity = 0;
		put(fake, frame, "   ", [0, 0, 100, 20]);
		const hiddenGroup = fake.node(frame, "FRAME", "grupo oculto");
		put(fake, hiddenGroup, "Dentro", [0, 0, 100, 20]);
		hiddenGroup.visible = false;
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
	});

	it("trampa 5 (sin verificar): un texto cuyo absoluteRenderBounds es null se descarta en silencio", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		put(fake, frame, "Uno", [0, 0, 100, 20]);
		put(fake, frame, "Sin glifos", [0, 0, 100, 20]).renderBounds = null;
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
	});

	it("trampa 6 (sin verificar): las cajas de un texto en un marco con auto-layout ya están maquetadas al leerlas", async () => {
		const { fake, kit } = setup();
		fake.autoLayout = true;
		const { frame } = frameOf(fake);
		frame.layoutMode = "VERTICAL";
		frame.itemSpacing = 0;
		put(fake, frame, "Primero", [0, 0, 100, 20]);
		put(fake, frame, "Segundo", [0, 0, 100, 20]);
		assert.equal((layoutOf(await run(kit))[0] as Row).overlaps, 0);
	});

	it("las muestras se quedan en cuatro y el recuento sigue completo", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		for (let i = 0; i < 6; i++)
			put(fake, frame, `Texto ${i}`, [i * 100, 0, 100, 20]);
		for (let i = 0; i < 6; i++)
			put(fake, frame, `Otro ${i}`, [i * 100, 5, 100, 20]);
		const row = layoutOf(await run(kit))[0] as Row;
		assert.equal(row.overlaps, 6);
		assert.equal(row.samples.length, 4);
	});

	it("contenedores colapsados: un frame o instancia de ancho <= 4 con un hijo de más de 40 (también dentro de instancias, trampa 7)", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		const narrow = fake.node(frame, "FRAME", "colapsado");
		narrow.width = 4;
		fake.node(narrow, "FRAME", "ancho").width = 41;
		const fine = fake.node(frame, "FRAME", "bien");
		fine.width = 4;
		fake.node(fine, "FRAME", "justo").width = 40;
		const inst = fake.node(frame, "INSTANCE", "instancia");
		const inner = fake.node(inst, "INSTANCE", "interna");
		inner.width = 3;
		fake.node(inner, "FRAME", "ancho").width = 100;
		assert.equal((layoutOf(await run(kit))[0] as Row).collapsed, 2);
	});

	describe("filas de tabla", () => {
		function table(fake: FakeFigma, frame: FakeNode, xs: number[][]) {
			const body = fake.node(frame, "FRAME", "cuerpo");
			const rows = xs.map((cells) => {
				const row = fake.node(body, "FRAME", "fila");
				for (const x of cells) fake.node(row, "FRAME", "celda").x = x;
				return row;
			});
			return { body, rows };
		}

		it("cuenta cada fila cuyas columnas no están donde las de la primera (tolerancia de 1 px, x redondeadas)", async () => {
			const { fake, kit } = setup();
			const { frame } = frameOf(fake);
			table(fake, frame, [
				[0, 100, 200],
				[0.4, 100.6, 200],
				[0, 110, 200],
				[0, 100],
				[0, 100, 202],
			]);
			assert.equal((layoutOf(await run(kit))[0] as Row).misalignedRows, 3);
		});

		it("una sola fila visible no se compara, y una fila oculta no cuenta", async () => {
			const { fake, kit } = setup();
			const { frame } = frameOf(fake);
			const { rows } = table(fake, frame, [
				[0, 100],
				[0, 500],
			]);
			(rows[1] as FakeNode).visible = false;
			assert.equal((layoutOf(await run(kit))[0] as Row).misalignedRows, 0);
		});

		it("el cuerpo y la fila se reconocen por los nombres de linkRules.rows, no por otros", async () => {
			const { fake, kit } = setup();
			const { frame } = frameOf(fake);
			const body = fake.node(frame, "FRAME", "otro cuerpo");
			for (const x of [0, 50]) {
				const row = fake.node(body, "FRAME", "fila");
				fake.node(row, "FRAME", "celda").x = x;
			}
			assert.equal((layoutOf(await run(kit))[0] as Row).misalignedRows, 0);
		});
	});

	it("solo lee: no escribe ningún nodo ni etiqueta", async () => {
		const { fake, kit } = setup();
		const { frame } = frameOf(fake);
		put(fake, frame, "A", [0, 0, 100, 20]);
		put(fake, frame, "B", [0, 0, 100, 20]);
		const before = JSON.stringify([...fake.all.keys()]);
		const result = await run(kit);
		assert.equal(JSON.stringify([...fake.all.keys()]), before);
		assert.deepEqual(result.mutatedNodeIds, []);
		assert.equal(frame.shared.size, 0);
	});

	it("si la página del área no existe, dice qué falta y no ha tocado nada", async () => {
		const { kit } = setup();
		await assert.rejects(run(kit), /AREA_NOT_FOUND|Panel/);
	});
});

// Paridad con una referencia congelada: el script de revisión original, tal cual, sobre el mismo archivo falso y con los nombres de fila y cuerpo que
// escribe a mano (los de linkRules.rows)
const LEGACY = new URL("../../../fixtures/parity/check.js", import.meta.url);
describe("kit.steps.layoutCheck frente al script de referencia", () => {
	it("da los mismos recuentos y las mismas muestras por frame que el script de referencia", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Panel");
		const bad = fake.node(page, "FRAME", "Con fallos");
		put(fake, bad, "Potencia de contrato en P1", [10, 10, 200, 20]);
		put(fake, bad, "Titular", [20, 15, 80, 20]);
		put(fake, bad, "Otro texto", [0, 60, 100, 20]).renderBounds = null;
		const clip = fake.node(bad, "FRAME", "recorte");
		[clip.x, clip.y, clip.width, clip.height] = [0, 100, 100, 30];
		clip.clipsContent = true;
		put(fake, clip, "Fuera del recorte", [0, 120, 100, 40]);
		put(fake, bad, "Debajo", [0, 140, 100, 20]);
		const narrow = fake.node(bad, "FRAME", "colapsado");
		narrow.width = 3;
		fake.node(narrow, "FRAME", "ancho").width = 60;
		const body = fake.node(bad, "FRAME", "cuerpo de tabla");
		for (const xs of [
			[0, 100],
			[0, 130],
			[0, 100],
		]) {
			const row = fake.node(body, "FRAME", "fila de tabla");
			for (const x of xs) fake.node(row, "FRAME", "celda").x = x;
		}
		const clean = fake.node(page, "FRAME", "Limpio");
		put(fake, clean, "Hola", [0, 0, 50, 20]);

		const params = {
			...paramsOf(PANEL),
			linkRules: {
				...RULES,
				rows: {
					row: ["tr", "fila de tabla"],
					body: ["tbody", "cuerpo de tabla"],
				},
			},
		};
		const result = await kit.steps.layoutCheck(params as never, {});

		const g = globalThis as unknown as { window?: unknown };
		g.window = { __CHK_AREAS: ["Panel"] };
		let old: Record<string, string>;
		try {
			const run = new Function(`return (${readFileSync(LEGACY, "utf8")})();`);
			old = (await run()) as Record<string, string>;
		} finally {
			delete g.window;
		}

		const fromKit = Object.fromEntries(
			layoutOf(result)
				.filter(
					(r) => r.overlaps > 0 || r.collapsed > 0 || r.misalignedRows > 0,
				)
				.map((r) => [
					`Panel / ${r.frame}`,
					`solapes=${r.overlaps} colapsos=${r.collapsed} filas-desalineadas=${r.misalignedRows} ${r.samples.join(" | ")}`,
				]),
		);
		assert.deepEqual(Object.keys(old), ["Panel / Con fallos"]);
		assert.deepEqual(fromKit, old);
	});
});
