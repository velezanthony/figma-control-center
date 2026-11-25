// sheet/properties.ts: las propiedades del set (texto, booleano, intercambio
// de iconos) y las referencias en las capas propias; INSTANCE_SWAP compatible (medido), nada dentro de instancias
// anidadas (H8) y el icono que falta avisa en vez de lanzar.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import {
	assetsOf,
	button,
	frame,
	icons,
	sheetPlanOf,
	sheetWorld,
	svg,
	text,
} from "../sheet-support.ts";

const defs = (set: unknown) =>
	(set as FakeNode).componentPropertyDefinitions as Record<
		string,
		{ type: string; defaultValue?: unknown; preferredValues?: unknown[] }
	>;
const byName = (set: unknown, name: string) =>
	Object.entries(defs(set)).find(([k]) => k.split("#")[0] === name);
const run = (w: ReturnType<typeof sheetWorld>, plan: unknown) =>
	w.kit.sheet.paint(plan as never, assetsOf(plan), null);

const ICONS = { "M0 0L1 1": "plus" };
const withIcon = () =>
	frame({ tag: "button", w: 100, h: 32, disp: "flex" }, [
		text("Botón", { w: 60 }),
		svg({ w: 20, h: 20 }),
	]);

const compOf = (vs: readonly { component: unknown }[], i: number): FakeNode =>
	(vs[i] as { component: unknown }).component as FakeNode;

describe("sheet/properties: textos, booleanos e iconos", () => {
	it("una propiedad TEXT con el texto que coincide por defecto, y cada capa propia con ese texto la referencia", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: { texts: [{ name: "contenido", match: "Botón" }] },
		});
		const { set, variants } = await run(w, plan);
		const found = byName(set, "contenido");
		assert.ok(found);
		assert.deepEqual([found[1].type, found[1].defaultValue], ["TEXT", "Botón"]);
		for (const v of variants) {
			const t = (v.component as unknown as FakeNode).findAll(
				(n) => n.type === "TEXT" && n.characters === "Botón",
			);
			assert.ok(t.length > 0);
			for (const n of t)
				assert.deepEqual(n.componentPropertyReferences, {
					characters: found[0],
				});
		}
	});

	it("un texto que no coincide no se liga", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: { texts: [{ name: "contenido", match: "Otro" }] },
		});
		const { variants } = await run(w, plan);
		const t = compOf(variants, 0).findAll((n) => n.type === "TEXT");
		for (const n of t) assert.equal(n.componentPropertyReferences, null);
	});

	it("un BOOLEAN por capa con ese nombre (visible), con su valor por defecto", async () => {
		const w = sheetWorld();
		const dot = () =>
			frame({ tag: "button", w: 100, h: 32, disp: "flex" }, [
				frame({ tag: "span", cls: "dot", w: 8, h: 8 }),
				text("Botón"),
			]);
		const plan = sheetPlanOf({
			variants: [{ props: { v: "a" }, root: [dot()] }],
			sheet: {
				names: [{ classes: "dot", name: "punto" }],
				booleans: [{ name: "Mostrar punto", layer: "punto", on: true }],
			},
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
		const { set, variants } = await run(w, plan);
		const found = byName(set, "Mostrar punto");
		assert.deepEqual(
			[found?.[1].type, found?.[1].defaultValue],
			["BOOLEAN", true],
		);
		const layer = compOf(variants, 0).findOne((n) => n.name === "punto");
		assert.deepEqual(layer?.componentPropertyReferences, {
			visible: found?.[0],
		});
	});

	it("un icono con booleano e intercambio: dos propiedades, INSTANCE_SWAP con el id del componente y los del catálogo como preferidos", async () => {
		const w = sheetWorld();
		const plus = icons(w.fake);
		const plan = sheetPlanOf({
			variants: [{ props: { v: "a" }, root: [withIcon()] }],
			icons: ICONS,
			sheet: {
				icons: [
					{ icon: "plus", boolean: "Mostrar icono", swap: "Icono", on: true },
				],
			},
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
		const { set, variants } = await run(w, plan);
		const bool = byName(set, "Mostrar icono");
		const swap = byName(set, "Icono");
		assert.deepEqual(
			[bool?.[1].type, bool?.[1].defaultValue],
			["BOOLEAN", true],
		);
		assert.deepEqual(
			[swap?.[1].type, swap?.[1].defaultValue],
			["INSTANCE_SWAP", plus.id],
		);
		assert.deepEqual(swap?.[1].preferredValues, [
			{ type: "COMPONENT", key: (plus as unknown as { key: string }).key },
		]);
		const inst = compOf(variants, 0).findOne(
			(n) => n.type === "INSTANCE" && n.name === "icons/plus",
		);
		assert.deepEqual(inst?.componentPropertyReferences, {
			mainComponent: swap?.[0],
			visible: bool?.[0],
		});
	});

	it("noBooleanWhen: en las variantes que lo cumplen el icono no lleva la referencia visible", async () => {
		const w = sheetWorld();
		icons(w.fake);
		const plan = sheetPlanOf({
			icons: ICONS,
			variants: [
				{ props: { v: "a" }, root: [withIcon()] },
				{ props: { v: "icon only" }, root: [withIcon()] },
			],
			sheet: {
				icons: [
					{
						icon: "plus",
						boolean: "Mostrar icono",
						swap: "Icono",
						noBooleanWhen: { v: "icon only" },
					},
				],
			},
			matrix: { rows: ["v=a", "v=icon only"], columns: [], cells: [[0], [1]] },
		});
		const { variants } = await run(w, plan);
		const refs = variants.map(
			(v) =>
				(v.component as unknown as FakeNode).findOne(
					(n) => n.type === "INSTANCE" && n.name === "icons/plus",
				)?.componentPropertyReferences,
		);
		assert.deepEqual(Object.keys(refs[0] ?? {}).sort(), [
			"mainComponent",
			"visible",
		]);
		assert.deepEqual(Object.keys(refs[1] ?? {}), ["mainComponent"]);
	});

	it("un icono que no está en el catálogo avisa ICON_NOT_FOUND y no crea el intercambio, en vez de lanzar", async () => {
		const w = sheetWorld();
		icons(w.fake);
		const plan = sheetPlanOf({
			sheet: {
				icons: [{ icon: "fantasma", boolean: "Mostrar icono", swap: "Icono" }],
			},
		});
		const tracker = w.kit.track();
		const { set } = await run(w, plan);
		assert.equal(byName(set, "Icono"), undefined);
		assert.ok(byName(set, "Mostrar icono"));
		assert.ok(
			(tracker.done().warnings ?? []).some((x) => x.code === "ICON_NOT_FOUND"),
		);
	});

	it("dentro de una instancia anidada no se pone ninguna referencia (H8: Figma lanza)", async () => {
		const w = sheetWorld();
		const page = w.fake.page("Otros");
		const inner = w.fake.componentSet(page, "Interno", [{ v: "a" }]);
		w.fake.loadedFontsToLoad.add("Inter/Regular");
		const comp = inner.children[0] as FakeNode;
		w.fake.text(comp, "texto", "Botón");
		const plan = sheetPlanOf({
			sheet: { texts: [{ name: "contenido", match: "Botón" }] },
		});
		const made = await run(w, plan);
		const compOfSheet = made.variants[0]?.component as unknown as FakeNode;
		const instance = comp.createInstance();
		compOfSheet.appendChild(instance);
		const own = compOfSheet.findAll(
			(n) => n.type === "TEXT" && n.characters === "Botón",
		);
		for (const n of own) {
			if (n.parent?.type === "INSTANCE")
				assert.equal(n.componentPropertyReferences, null);
		}
		assert.throws(() => {
			const inside = instance.findOne((n) => n.type === "TEXT") as FakeNode;
			inside.componentPropertyReferences = { characters: "x#1:0" };
		}, /instance sublayer/);
	});

	it("un hueco (`slots`) cuya capa no existe no crea la propiedad y avisa SLOT_LAYER_NOT_FOUND", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: { slots: [{ name: "Hueco", layer: "x" }] },
		});
		const tracker = w.kit.track();
		const { set } = await run(w, plan);
		assert.equal(byName(set, "Hueco"), undefined);
		assert.ok(
			(tracker.done().warnings ?? []).some(
				(x) => x.code === "SLOT_LAYER_NOT_FOUND",
			),
		);
	});

	it("un nombre de propiedad repetido lo impide el fichero de hojas; aquí Figma no lanza: crea otra con el nombre y un 2 (H4, medido)", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: {
				texts: [{ name: "x", match: "Botón" }],
				booleans: [{ name: "x", layer: "y" }],
			},
		});
		const { set } = await run(w, plan);
		assert.ok(byName(set, "x"));
		assert.ok(byName(set, "x2"));
	});

	it("las capas que la propiedad oculta no dejan al marco con el ancho de «todo visible» (medido en el archivo de pruebas: Figma no siempre recalcula el ajuste al contenido)", async () => {
		const w = sheetWorld();
		icons(w.fake);
		const row = () =>
			frame(
				{
					tag: "button",
					w: 134,
					h: 44,
					disp: "flex",
					gap: 6,
					pad: [12, 24, 12, 24],
				},
				[
					svg({ x: 24, y: 12, w: 16, h: 16 }),
					text("Botón", { x: 46, y: 12, w: 42, h: 20 }),
					svg({ x: 94, y: 12, w: 16, h: 16 }),
				],
			);
		const plan = sheetPlanOf({
			icons: ICONS,
			variants: [
				{ props: { v: "a" }, root: [row()] },
				{ props: { v: "b" }, root: [row()] },
			],
			sheet: {
				icons: [{ icon: "plus", boolean: "Mostrar icono", swap: "Icono" }],
			},
			matrix: { rows: ["v=a", "v=b"], columns: [], cells: [[0], [1]] },
		});
		const { variants } = await run(w, plan);
		for (const v of variants) {
			const c = v.component as unknown as FakeNode;
			const shown = c.children.filter((k) => k.visible);
			// solo queda el texto: relleno 24 + 42 + 24, sin los dos iconos ni sus huecos
			assert.equal(shown.length, 1);
			assert.equal(c.width, 24 + 24 + 42);
		}
	});
});
void button;
