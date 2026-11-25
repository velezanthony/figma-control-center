// Rehacer una hoja conserva las sobrescrituras que las instancias de otras pantallas tenían en capas de dentro: se leen por la
// ruta de la capa (nombres e índice entre hermanas del mismo nombre) antes de vaciar la variante y se reaplican en la nueva.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	captureOverrides,
	reapplyOverrides,
} from "../../../../../kits/figma/sheet/overrides.ts";
import type { FakeNode } from "../fake-figma.ts";
import {
	assetsOf,
	frame,
	setOf,
	sheetPlanOf,
	sheetWorld,
} from "../sheet-support.ts";

type World = ReturnType<typeof sheetWorld>;
type Plan = Record<string, unknown>;

const paint = (w: World, plan: unknown) =>
	w.kit.sheet.paint(plan as never, assetsOf(plan), null);
const planOf = (sheet: Plan = {}, over: Plan = {}) =>
	sheetPlanOf({ sheet: { texts: [], ...sheet }, ...over } as never);
const lostIn = (tracker: ReturnType<World["kit"]["track"]>) =>
	(tracker.done().warnings ?? []).filter((x) => x.code === "OVERRIDES_LOST");

async function externalInstance(w: World, set: FakeNode): Promise<FakeNode> {
	const inst = (set.children[0] as FakeNode).createInstance();
	w.fake.node(w.fake.page("Pantallas"), "FRAME", "Inicio").appendChild(inst);
	return inst;
}

const allowInter = (w: World): void => {
	w.fake.loadedFonts.add("Inter/Regular");
	w.fake.loadedFontsToLoad.add("Inter/Regular");
};

async function setText(w: World, node: FakeNode, value: string): Promise<void> {
	await w.fake.loadFontAsync(node.fontName as never);
	node.characters = value;
}

describe("rehacer una hoja: sobrescrituras de las instancias de fuera", () => {
	it("el texto cambiado a mano en una capa de dentro sigue ahí tras rehacer", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const inst = await externalInstance(w, setOf(w.fake));
		const label = inst.findOne((n) => n.type === "TEXT") as FakeNode;
		await setText(w, label, "Organización");
		const oldId = label.id;
		await paint(w, plan);
		const now = inst.findOne((n) => n.type === "TEXT") as FakeNode;
		assert.notEqual(now.id, oldId, "la capa se recreó con otro id");
		assert.equal(now.characters, "Organización");
	});

	it("la propiedad de una instancia anidada y la visibilidad de una capa se conservan", async () => {
		const w = sheetWorld();
		allowInter(w);
		const page = w.fake.page("Hoja");
		const labels = w.fake.componentSet(page, "Label", [{ tone: "a" }]);
		const labelKey = Object.keys(labels.componentPropertyDefinitions).find(
			(k) => k.startsWith("Label"),
		) as string;
		const main = w.fake.componentSet(page, "Filter", [{ v: "a" }]);
		const variant = main.children[0] as FakeNode;
		const fill = (): void => {
			const nested = (labels.children[0] as FakeNode).createInstance();
			nested.name = "Label";
			variant.appendChild(nested);
			w.fake.text(variant, "icono", "i");
		};
		fill();
		const inst = await externalInstance(w, main);
		const nested = inst.findOne((n) => n.type === "INSTANCE") as FakeNode;
		nested.setProperties({ [labelKey]: "Proyecto" });
		(inst.findOne((n) => n.name === "icono") as FakeNode).visible = false;

		const saved = await captureOverrides(variant as never, page as never);
		for (const c of [...variant.children]) c.remove();
		fill();
		await reapplyOverrides(saved);

		const again = inst.findOne((n) => n.type === "INSTANCE") as FakeNode;
		assert.equal(again.componentProperties[labelKey]?.value, "Proyecto");
		assert.equal(
			again.findAll((n) => n.type === "TEXT")[0]?.characters,
			"Proyecto",
		);
		assert.equal(
			(inst.findOne((n) => n.name === "icono") as FakeNode).visible,
			false,
		);
	});

	it("dos capas con el mismo nombre se distinguen por su orden entre hermanas", async () => {
		const w = sheetWorld();
		allowInter(w);
		const page = w.fake.page("Hoja");
		const main = w.fake.componentSet(page, "Dos", [{ v: "a" }]);
		const variant = main.children[0] as FakeNode;
		const fill = (): void => {
			for (const c of [...variant.children]) c.remove();
			w.fake.text(variant, "fila", "uno");
			w.fake.text(variant, "fila", "dos");
		};
		fill();
		const inst = await externalInstance(w, main);
		await setText(w, inst.children[1] as FakeNode, "cambiado");
		const saved = await captureOverrides(variant as never, page as never);
		fill();
		await reapplyOverrides(saved);
		assert.deepEqual(
			inst.children.map((c) => c.characters),
			["uno", "cambiado"],
		);
	});

	it("si la ruta ya no existe no falla: avisa OVERRIDES_LOST con página, marco y ruta", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const inst = await externalInstance(w, setOf(w.fake));
		const label = inst.findOne((n) => n.type === "TEXT") as FakeNode;
		const name = label.name;
		await setText(w, label, "Organización");
		const empty = (w: number) =>
			frame({ tag: "button", w, h: 32, disp: "flex", cls: "btn" }, []);
		const renamed = planOf(
			{},
			{
				variants: [
					{ props: { variant: "primary", size: "sm" }, root: [empty(80)] },
					{ props: { variant: "primary", size: "lg" }, root: [empty(120)] },
					{ props: { variant: "danger", size: "sm" }, root: [empty(80)] },
				],
			},
		);
		const tracker = w.kit.track();
		await paint(w, renamed);
		const lost = lostIn(tracker);
		assert.equal(lost.length, 1);
		assert.match(lost[0]?.message ?? "", /Pantallas/);
		assert.match(lost[0]?.message ?? "", /Inicio/);
		assert.ok((lost[0]?.message ?? "").includes(name));
		assert.equal(lost[0]?.nodeId, inst.id);
	});

	it("un cambio en la raíz de la instancia sigue intacto y no se da por perdido", async () => {
		const w = sheetWorld();
		const plan = planOf({ texts: [{ name: "contenido", match: "Botón" }] });
		await paint(w, plan);
		const set = setOf(w.fake);
		const inst = await externalInstance(w, set);
		const prop = Object.keys(set.componentPropertyDefinitions).find((k) =>
			k.startsWith("contenido"),
		) as string;
		inst.setProperties({ [prop]: "Cambiado" });
		const tracker = w.kit.track();
		await paint(w, plan);
		assert.equal(inst.componentProperties[prop]?.value, "Cambiado");
		assert.equal(
			(inst.findOne((n) => n.type === "TEXT") as FakeNode).characters,
			"Cambiado",
		);
		assert.equal(lostIn(tracker).length, 0);
	});
	it("si la capa de esa ruta ya es otra cosa no se reaplica y avisa: el botón y el modal que cambian de nombre", async () => {
		const w = sheetWorld();
		const page = w.fake.page("Hoja");
		const main = w.fake.componentSet(page, "Modal", [{ v: "a" }]);
		const variant = main.children[0] as FakeNode;
		const fill = (shape: "viejo" | "nuevo"): void => {
			for (const c of [...variant.children]) c.remove();
			if (shape === "viejo") {
				const button = w.fake.node(variant, "FRAME", "fila");
				w.fake.text(button, "texto", "Abrir");
			} else {
				const button = w.fake.node(variant, "FRAME", "bloque");
				w.fake.text(button, "texto", "Abrir");
				const modal = w.fake.node(variant, "FRAME", "fila");
				w.fake.text(modal, "titulo", "Crea tu cuenta");
				w.fake.text(modal, "cuerpo", "Cuerpo");
			}
		};
		fill("viejo");
		const inst = await externalInstance(w, main);
		(inst.findOne((n) => n.name === "fila") as FakeNode).visible = false;
		const saved = await captureOverrides(variant as never, page as never);
		fill("nuevo");
		const tracker = w.kit.track();
		await reapplyOverrides(saved);
		const modal = inst.findOne((n) => n.name === "fila") as FakeNode;
		assert.equal(modal.visible, true, "el modal no debe quedar oculto");
		const lost = lostIn(tracker);
		assert.equal(lost.length, 1);
		assert.match(lost[0]?.message ?? "", /la capa cambió/);
		assert.match(lost[0]?.message ?? "", /visible=false/);
	});

	it("un texto que no se puede reaplicar sale en el aviso con su valor", async () => {
		const w = sheetWorld();
		const plan = planOf();
		await paint(w, plan);
		const inst = await externalInstance(w, setOf(w.fake));
		await setText(
			w,
			inst.findOne((n) => n.type === "TEXT") as FakeNode,
			"Organización",
		);
		const empty = frame({ tag: "button", w: 80, h: 32, disp: "flex" }, []);
		const tracker = w.kit.track();
		await paint(
			w,
			planOf(
				{},
				{
					variants: [
						{ props: { variant: "primary", size: "sm" }, root: [empty] },
						{ props: { variant: "primary", size: "lg" }, root: [empty] },
						{ props: { variant: "danger", size: "sm" }, root: [empty] },
					],
				},
			),
		);
		assert.match(
			lostIn(tracker)[0]?.message ?? "",
			/characters="Organización"/,
		);
	});

	it("un cambio de un campo que el kit no reaplica (relleno, nombre) avisa con la ruta y el valor; lo que va con otro reaplicado, no", async () => {
		const w = sheetWorld();
		allowInter(w);
		const page = w.fake.page("Hoja");
		const main = w.fake.componentSet(page, "Caja", [{ v: "a" }]);
		const variant = main.children[0] as FakeNode;
		const fill = (): void => {
			for (const c of [...variant.children]) c.remove();
			const row = w.fake.node(variant, "FRAME", "fila");
			w.fake.text(row, "texto", "Hola");
		};
		fill();
		const inst = await externalInstance(w, main);
		const row = inst.findOne((n) => n.name === "fila") as FakeNode;
		row.fills = [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 }, opacity: 1 }];
		row.markOverridden("fills");
		const label = inst.findOne((n) => n.name === "texto") as FakeNode;
		await setText(w, label, "Adiós");
		label.markOverridden("styledTextSegments");
		const saved = await captureOverrides(variant as never, page as never);
		fill();
		const tracker = w.kit.track();
		await reapplyOverrides(saved);
		assert.equal(
			(inst.findOne((n) => n.name === "texto") as FakeNode).characters,
			"Adiós",
		);
		const lost = lostIn(tracker);
		assert.equal(lost.length, 1);
		const message = lost[0]?.message ?? "";
		assert.match(message, /fila: fills=#ff6600/);
		assert.doesNotMatch(message, /styledTextSegments/);
		assert.match(message, /un cambio/);
		assert.equal(lost[0]?.nodeId, inst.id);
	});

	it("un cambio cuya capa ya no estaba en la instancia antes de rehacer (de otra variante) avisa con la ruta de su capa de origen y el valor que se ve", async () => {
		const w = sheetWorld();
		allowInter(w);
		const page = w.fake.page("Hoja");
		const main = w.fake.componentSet(page, "Modal", [
			{ estado: "cerrado" },
			{ estado: "abierto" },
		]);
		const [closed, open] = main.children as [FakeNode, FakeNode];
		const button = w.fake.node(closed, "FRAME", "fila");
		w.fake.text(button, "texto", "Abrir");
		const row = w.fake.node(open, "FRAME", "fila");
		w.fake.text(row, "texto", "Abrir");
		const inst = await externalInstance(w, main);
		inst.main = open;
		(inst.findOne((n) => n.name === "fila") as FakeNode).visible = false;
		inst.staleOverride(`I${inst.id};${button.id}`, ["visible"]);
		inst.staleOverride(`I${inst.id};9999:1`, ["fills"]);
		const saved = await captureOverrides(open as never, page as never);
		const tracker = w.kit.track();
		await reapplyOverrides(saved);
		const lost = lostIn(tracker);
		assert.equal(lost.length, 1);
		const message = lost[0]?.message ?? "";
		assert.match(message, /2 cambios/);
		assert.match(message, /fila \(sin capa antes de rehacer\): visible=false/);
		assert.match(message, /9999:1 \(sin capa antes de rehacer\): fills=\?/);
	});
});
