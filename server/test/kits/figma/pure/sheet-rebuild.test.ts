// Rehacer una hoja sobre el set que ya existe: se conservan el set, las variantes emparejadas por
// props y las propiedades por nombre, para que las instancias de fuera sigan apuntando al mismo componente.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import {
	assetsOf,
	button,
	frame,
	key,
	PAGE_KEY,
	SCRATCH_KEY,
	SET_KEY,
	setOf,
	sheetPlanOf,
	sheetWorld,
	text,
} from "../sheet-support.ts";

type World = ReturnType<typeof sheetWorld>;
type Plan = Record<string, unknown>;

const paint = (w: World, plan: unknown) =>
	w.kit.sheet.paint(plan as never, assetsOf(plan), null);

const TEXTS = [{ name: "contenido", match: "Botón" }];
const planOf = (sheet: Plan = {}, over: Plan = {}) =>
	sheetPlanOf({ sheet: { texts: TEXTS, ...sheet }, ...over } as never);

const FOUR = [
	{ props: { variant: "primary", size: "sm" }, root: [button()] },
	{ props: { variant: "primary", size: "lg" }, root: [button("Botón", 120)] },
	{ props: { variant: "danger", size: "sm" }, root: [button()] },
	{ props: { variant: "danger", size: "lg" }, root: [button("Botón", 120)] },
];

const defs = (set: FakeNode) => set.componentPropertyDefinitions;
const named = (set: FakeNode, name: string) =>
	Object.keys(defs(set)).find((k) => k.split("#")[0] === name);
const idsOf = (set: FakeNode) => set.children.map((c) => c.id);
const keysOf = (set: FakeNode) =>
	Object.keys(defs(set))
		.filter((k) => defs(set)[k]?.type !== "VARIANT")
		.sort();

const warningsOf = (done: { warnings?: { code: string; message: string }[] }) =>
	done.warnings ?? [];

// Una instancia de la variante `index` del set, en una página de fuera
function instanceOutside(w: World, set: FakeNode, index: number): FakeNode {
	const inst = (set.children[index] as FakeNode).createInstance();
	w.fake.page("Otra").appendChild(inst);
	return inst;
}

describe("rehacer una hoja sobre el set que ya existe", () => {
	it("rehacer dos veces deja el mismo set, las mismas variantes y las mismas claves de propiedad, con una sola cabecera y una sola tarjeta", async () => {
		const w = sheetWorld();
		const plan = planOf();
		const first = await paint(w, plan);
		const set1 = setOf(w.fake);
		const [setId, ids, keys] = [set1.id, idsOf(set1), keysOf(set1)];
		const second = await paint(w, plan);
		const set2 = setOf(w.fake);
		assert.equal(set2.id, setId);
		assert.equal((second.set as unknown as FakeNode).id, first.set.id);
		assert.deepEqual(idsOf(set2), ids);
		assert.deepEqual(keysOf(set2), keys);
		const page = w.fake.root.children.find((p) => p.name === "   Button");
		assert.equal(page?.children.filter((n) => n.name === "Header").length, 1);
		assert.equal(page?.children.filter((n) => n.name === "Button").length, 1);
		assert.equal(
			w.fake.root.children.filter((p) => p.name === "   Button").length,
			1,
		);
		assert.equal(key(set2), SET_KEY);
		assert.equal(key(page as FakeNode), PAGE_KEY);
	});

	it("lo de dentro de cada variante se repinta: capas nuevas, mismo componente", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const variant = setOf(w.fake).children[0] as FakeNode;
		const oldKids = variant.children.map((c) => c.id);
		await paint(w, plan);
		assert.equal(variant.removed, false);
		assert.equal(variant.children.length, oldKids.length);
		assert.equal(
			variant.children.some((c) => oldKids.includes(c.id)),
			false,
		);
		assert.equal(variant.layoutMode, "HORIZONTAL");
	});

	it("una variante nueva de la captura se añade al set sin tocar los ids de las demás", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const set = setOf(w.fake);
		const before = idsOf(set);
		const plan = planOf(
			{},
			{
				variants: FOUR,
				matrix: {
					rows: ["variant=primary", "variant=danger"],
					columns: ["size=sm", "size=lg"],
					cells: [
						[0, 1],
						[2, 3],
					],
				},
			},
		);
		const tracker = w.kit.track();
		await paint(w, plan);
		const after = setOf(w.fake);
		assert.equal(after.id, set.id);
		assert.deepEqual(idsOf(after).slice(0, 3), before);
		assert.equal(after.children.length, 4);
		assert.deepEqual((after.children[3] as FakeNode).variantProperties, {
			variant: "danger",
			size: "lg",
		});
		assert.equal(
			key(after.children[3] as FakeNode),
			"fcc:sheet-variant:button:variant=danger, size=lg",
		);
		assert.equal(
			warningsOf(tracker.done()).some((x) => x.code === "VARIANT_NOT_CAPTURED"),
			false,
		);
	});

	it("una variante que está en el set y no en la captura se queda, con VARIANT_NOT_CAPTURED y cuántas instancias tiene fuera", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const set = setOf(w.fake);
		const lost = set.children[2] as FakeNode;
		const lostKids = lost.children.map((c) => c.id);
		instanceOutside(w, set, 2);
		instanceOutside(w, set, 2);
		const plan = planOf(
			{},
			{
				variants: FOUR.slice(0, 2),
				matrix: {
					rows: ["variant=primary"],
					columns: ["size=sm", "size=lg"],
					cells: [[0, 1]],
				},
			},
		);
		const tracker = w.kit.track();
		const out = await paint(w, plan);
		const done = tracker.done();
		assert.equal(lost.removed, false);
		assert.equal(setOf(w.fake).children.length, 3);
		assert.deepEqual(
			lost.children.map((c) => c.id),
			lostKids,
		);
		const warning = warningsOf(done).find(
			(x) => x.code === "VARIANT_NOT_CAPTURED",
		);
		assert.ok(warning);
		assert.match(warning.message, /2 instancias/);
		assert.match(warning.message, /danger/);
		assert.deepEqual(out.counts.variants, { created: 0, updated: 2, kept: 1 });
	});

	it("una propiedad hecha a mano que los datos no declaran y `keep` no nombra para el paso con SHEET_HAND_EDITS y no escribe nada", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const set = setOf(w.fake);
		set.addComponentProperty("Mostrar hueco", "BOOLEAN", true);
		const page = w.fake.root.children.find(
			(p) => p.name === "   Button",
		) as FakeNode;
		const [kids, pageKids] = [
			set.children.flatMap((c) => c.children.map((k) => k.id)),
			page.children.map((c) => c.id),
		];
		await assert.rejects(paint(w, plan), (e: Error) => {
			assert.match(e.message, /SHEET_HAND_EDITS/);
			assert.match(e.message, /Mostrar hueco/);
			return true;
		});
		assert.deepEqual(
			set.children.flatMap((c) => c.children.map((k) => k.id)),
			kids,
		);
		assert.deepEqual(
			page.children.map((c) => c.id),
			pageKids,
		);
	});

	it("con `keep` la propiedad a mano se conserva (misma clave) y PROPERTY_KEPT avisa si ninguna capa la usa", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const set = setOf(w.fake);
		const hand = set.addComponentProperty("Mostrar hueco", "BOOLEAN", true);
		const plan = planOf({ keep: ["Mostrar hueco"] });
		const tracker = w.kit.track();
		const out = await paint(w, plan);
		assert.equal(named(set, "Mostrar hueco"), hand);
		const warning = warningsOf(tracker.done()).find(
			(x) => x.code === "PROPERTY_KEPT",
		);
		assert.ok(warning);
		assert.match(warning.message, /Mostrar hueco/);
		assert.deepEqual(out.counts.properties, {
			created: 0,
			updated: 0,
			kept: 1,
		});
	});

	it("una propiedad que ya existe conserva su clave y cambia su valor por defecto con editComponentProperty", async () => {
		const w = sheetWorld();
		const dot = (on: boolean) =>
			planOf(
				{
					texts: [],
					names: [{ classes: "dot", name: "punto" }],
					booleans: [{ name: "Mostrar punto", layer: "punto", on }],
				},
				{
					variants: [
						{
							props: { v: "a" },
							root: [
								frame({ tag: "button", w: 100, h: 32, disp: "flex" }, [
									frame({ tag: "span", cls: "dot", w: 8, h: 8 }),
									text("Botón"),
								]),
							],
						},
					],
					matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
				},
			);
		await paint(w, dot(true));
		const set = setOf(w.fake);
		const before = named(set, "Mostrar punto");
		assert.ok(before);
		assert.equal(defs(set)[before]?.defaultValue, true);
		const out = await paint(w, dot(false));
		assert.equal(named(set, "Mostrar punto"), before);
		assert.equal(defs(set)[before]?.defaultValue, false);
		assert.deepEqual(out.counts.properties, {
			created: 0,
			updated: 1,
			kept: 0,
		});
		const layer = (set.children[0] as FakeNode).findOne(
			(n) => n.name === "punto",
		);
		assert.deepEqual(layer?.componentPropertyReferences, { visible: before });
	});

	it("una propiedad con el mismo nombre y otro tipo para el paso con SHEET_PROPERTY_TYPE antes de escribir", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const set = setOf(w.fake);
		set.addComponentProperty("Mostrar punto", "TEXT", "x");
		const kids = idsOf(set);
		await assert.rejects(
			paint(
				w,
				planOf({ booleans: [{ name: "Mostrar punto", layer: "punto" }] }),
			),
			/SHEET_PROPERTY_TYPE/,
		);
		assert.deepEqual(idsOf(set), kids);
	});

	it("una instancia de fuera conserva su componente y el texto puesto por propiedad, y el informe cuenta instancias y overrides antes y después", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const set = setOf(w.fake);
		const inst = instanceOutside(w, set, 0);
		const prop = named(set, "contenido") as string;
		inst.setProperties({ [prop]: "Cambiado" });
		const main = (set.children[0] as FakeNode).id;
		const out = await paint(w, plan);
		assert.equal((await inst.getMainComponentAsync())?.id, main);
		assert.equal(inst.componentProperties[prop]?.value, "Cambiado");
		const label = inst.findOne((n) => n.type === "TEXT");
		assert.equal(label?.characters, "Cambiado");
		assert.deepEqual(out.counts.outside, { before: 1, after: 1 });
		assert.deepEqual(out.counts.overrides, { before: 1, after: 1 });
	});

	it("las instancias que están en la propia página de la hoja no cuentan como de fuera", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const set = setOf(w.fake);
		const page = w.fake.root.children.find(
			(p) => p.name === "   Button",
		) as FakeNode;
		page.appendChild((set.children[0] as FakeNode).createInstance());
		const out = await paint(w, plan);
		assert.deepEqual(out.counts.outside, { before: 0, after: 0 });
	});

	it("la raíz de la variante toma el aspecto de la captura nueva (radio de esquina) sin cambiar de componente", async () => {
		const w = sheetWorld();
		const rounded = (rad: number) =>
			planOf(
				{ texts: [] },
				{
					variants: [
						{
							props: { v: "a" },
							root: [
								frame(
									{
										tag: "button",
										w: 80,
										h: 32,
										disp: "flex",
										rad: [rad, rad, rad, rad],
									},
									[text("Botón")],
								),
							],
						},
					],
					matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
				},
			);
		await paint(w, rounded(6));
		const variant = setOf(w.fake).children[0] as FakeNode;
		assert.equal(variant.topLeftRadius, 6);
		await paint(w, rounded(10));
		assert.equal(setOf(w.fake).children[0], variant);
		assert.equal(variant.topLeftRadius, 10);
	});

	it("las variables a las que el pintor ligó la raíz (el relleno) siguen ligadas al rehacer, y si la captura nueva ya no las liga se sueltan", async () => {
		const w = sheetWorld();
		const padded = (pad: number) =>
			planOf(
				{ texts: [] },
				{
					variants: [
						{
							props: { v: "a" },
							root: [
								frame(
									{
										tag: "button",
										w: 80,
										h: 32,
										disp: "flex",
										pad: [pad, pad, pad, pad],
									},
									[text("Botón")],
								),
							],
						},
					],
					matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
				},
			);
		await paint(w, padded(16));
		const variant = setOf(w.fake).children[0] as FakeNode;
		assert.equal(variant.paddingLeft, 16);
		assert.ok(variant.boundVariables["paddingLeft"]);
		await paint(w, padded(0));
		assert.equal(variant.paddingLeft, 0);
		assert.equal(variant.boundVariables["paddingLeft"], undefined);
		await paint(w, padded(16));
		assert.ok(variant.boundVariables["paddingLeft"]);
		assert.equal(variant.paddingLeft, 16);
	});

	it("la hoja de la primera vez cuenta todo como creado", async () => {
		const w = sheetWorld();
		const out = await paint(w, planOf());
		assert.deepEqual(out.counts.variants, { created: 3, updated: 0, kept: 0 });
		assert.deepEqual(out.counts.properties, {
			created: 1,
			updated: 0,
			kept: 0,
		});
		assert.equal(out.rebuilt, false);
		const again = await paint(w, planOf());
		assert.equal(again.rebuilt, true);
		assert.deepEqual(again.counts.variants, {
			created: 0,
			updated: 3,
			kept: 0,
		});
	});

	it("un set sin clave que se llama como la hoja, en su página, se adopta (ADOPTED) en vez de crear otro", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const set = setOf(w.fake);
		set.setSharedPluginData("fcc", "key", "");
		const tracker = w.kit.track();
		await paint(w, planOf());
		assert.equal(setOf(w.fake).id, set.id);
		assert.equal(key(set), SET_KEY);
		assert.ok(warningsOf(tracker.done()).some((x) => x.code === "ADOPTED"));
		const page = w.fake.root.children.find((p) => p.name === "   Button");
		assert.equal(page?.findAll((n) => n.type === "COMPONENT_SET").length, 1);
	});

	it("la página aparte (scratch) sigue vaciándose y creando un set nuevo aunque haya uno de verdad con la misma clave de set", async () => {
		const w = sheetWorld();
		await paint(w, planOf());
		const real = setOf(w.fake);
		const scratch = planOf(
			{},
			{
				target: {
					page: { name: "fcc · hoja · button", key: SCRATCH_KEY },
					set: { name: "Button", key: SET_KEY },
				},
			},
		);
		const out = await paint(w, scratch);
		assert.notEqual(out.set.id, real.id);
		assert.equal(real.removed, false);
		assert.equal(out.rebuilt, false);
	});

	it("una página con contenido que no es la hoja sigue sin repintarse (SHEET_EXISTS)", async () => {
		const w = sheetWorld();
		const page = w.fake.page("   Button");
		w.fake.node(page, "FRAME", "algo");
		await assert.rejects(paint(w, planOf()), /SHEET_EXISTS/);
	});
});

describe("rehacer una hoja con huecos (`slots`)", () => {
	const slotRow = () =>
		frame({ tag: "td", w: 100, h: 32, disp: "flex" }, [
			frame({ tag: "div", cls: "slot", w: 40, h: 20 }, [text("Contenido")]),
		]);
	const slotPlan = (extra: Plan = {}) =>
		planOf(
			{
				texts: [],
				names: [{ classes: "slot", name: "hueco" }],
				slots: [{ name: "Hueco", layer: "hueco", boolean: "Mostrar hueco" }],
				...extra,
			},
			{
				variants: [
					{ props: { v: "a" }, root: [slotRow()] },
					{ props: { v: "b" }, root: [slotRow()] },
				],
				matrix: { rows: ["v=a", "v=b"], columns: [], cells: [[0], [1]] },
			},
		);

	it("la capa con ese nombre pasa a hueco en cada variante, con su contenido dentro, y comparte una sola propiedad SLOT y su booleano", async () => {
		const w = sheetWorld();
		const tracker = w.kit.track();
		await paint(w, slotPlan());
		const set = setOf(w.fake);
		const slotKey = named(set, "Hueco");
		assert.ok(slotKey);
		assert.equal(defs(set)[slotKey]?.type, "SLOT");
		const show = named(set, "Mostrar hueco");
		assert.equal(defs(set)[show as string]?.type, "BOOLEAN");
		for (const v of set.children) {
			const slots = v.findAll((n) => n.type === "SLOT");
			assert.equal(slots.length, 1);
			// el kit encuentra el hueco por la clave de su propiedad, se llame como se llame el nodo (Figma lo renombra al compartirlo)
			assert.match(slots[0]?.name ?? "", /^hueco$/i);
			assert.deepEqual(slots[0]?.componentPropertyReferences, {
				slotContentId: slotKey,
				visible: show,
			});
			assert.deepEqual(
				slots[0]?.children.map((c) => c.characters),
				["Contenido"],
			);
			assert.equal(
				v.findAll((n) => n.type === "FRAME" && n.name === "hueco").length,
				0,
			);
		}
		assert.equal(
			Object.values(defs(set)).filter((d) => d.type === "SLOT").length,
			1,
		);
		assert.equal(
			warningsOf(tracker.done()).some((x) => x.code === "SLOTS_NOT_BUILT"),
			false,
		);
	});

	it("rehacer conserva la clave del hueco y lo que una instancia de fuera metió dentro (H11)", async () => {
		const w = sheetWorld();
		const plan = slotPlan();
		await paint(w, plan);
		const set = setOf(w.fake);
		const slotKey = named(set, "Hueco");
		const inst = instanceOutside(w, set, 0);
		const slotIn = inst.findOne((n) => n.type === "SLOT") as FakeNode;
		w.fake.node(slotIn, "RECTANGLE", "mío");
		await paint(w, plan);
		assert.equal(named(setOf(w.fake), "Hueco"), slotKey);
		assert.equal(
			Object.values(defs(setOf(w.fake))).filter((d) => d.type === "SLOT")
				.length,
			1,
		);
		const after = inst.findOne((n) => n.type === "SLOT") as FakeNode;
		assert.ok(after.children.some((c) => c.name === "mío"));
	});

	it("un hueco cuya capa ya no está en ninguna variante avisa SLOT_LAYER_NOT_FOUND y no crea la propiedad", async () => {
		const w = sheetWorld();
		const tracker = w.kit.track();
		await paint(w, slotPlan({ slots: [{ name: "Otro", layer: "no existe" }] }));
		const done = tracker.done();
		assert.ok(warningsOf(done).some((x) => x.code === "SLOT_LAYER_NOT_FOUND"));
		assert.equal(named(setOf(w.fake), "Otro"), undefined);
	});
});
