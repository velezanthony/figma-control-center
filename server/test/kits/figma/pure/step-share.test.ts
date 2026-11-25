// kit.steps.share: el contenido común a varias áreas pasa a un componente con una variante por área.
// Trampas: 3, 5, 13.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { sharedGroupKey } from "#domain/areas.ts";
import {
	button,
	PANEL,
	PROFILE,
	paramsOf,
	warningCodes,
} from "../areas-support.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

type Report = {
	shared: { group: string; area: string; frame: string; variant: string }[];
};
const reportOf = (r: { report?: unknown }) => r.report as Report;

// El área con dos frames, cada uno con su contenido `principal` (con un botón que enlaza al otro frame) y su shell antes
function scene(fake: FakeFigma) {
	const after = fake.page("Panel");
	const frames: Record<string, FakeNode> = {};
	for (const name of ["Inicio", "Detalle"]) {
		const f = fake.node(after, "FRAME", name);
		f.layoutMode = "HORIZONTAL";
		fake.node(f, "FRAME", "lateral");
		const main = fake.node(f, "FRAME", "principal");
		main.width = 600;
		frames[name] = f;
	}
	for (const [name, other] of [
		["Inicio", "Detalle"],
		["Detalle", "Inicio"],
	] as const) {
		const b = button(fake, frames[name]?.children[1] as FakeNode, "Ir");
		void b.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: frames[other]?.id }] },
		]);
	}
	return { fake, after, frames };
}

const sharedSet = (fake: FakeFigma): FakeNode => {
	const page = fake.root.children.find(
		(p) => p.name === "Compartido",
	) as FakeNode;
	return page.children.find((c) => c.type === "COMPONENT_SET") as FakeNode;
};

const group = {
	...PROFILE,
	from: [{ area: "Panel", frame: "Inicio", value: "panel" }],
};

describe("kit.steps.share", () => {
	it("crea la página del grupo tras `after`, el set con una variante por entrada y pone una instancia en el sitio de la capa", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const result = await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		assert.equal(StepResultSchema.safeParse(result).success, true);
		const names = fake.root.children.map((p) => p.name);
		assert.equal(names[names.indexOf("Panel") + 1], "Compartido");
		const page = fake.root.children.find(
			(p) => p.name === "Compartido",
		) as FakeNode;
		assert.equal(
			page.getSharedPluginData("fcc", "key"),
			sharedGroupKey("Perfil"),
		);
		const set = page.children.find(
			(c) => c.type === "COMPONENT_SET",
		) as FakeNode;
		assert.equal(set.name, "Perfil / Contenido");
		assert.deepEqual(
			set.children.map((c) => c.name),
			["area=panel"],
		);
		const frame = s.frames["Inicio"] as FakeNode;
		const inst = frame.children[1] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.main?.name, "area=panel");
		assert.equal(inst.layoutGrow, 1);
		assert.deepEqual(reportOf(result).shared, [
			{
				group: "Perfil",
				area: "Panel",
				frame: "Inicio",
				variant: "area=panel",
			},
		]);
	});

	it("el set recién hecho lleva la disposición `sheet` y una descripción", async () => {
		const { fake, kit } = setup();
		scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const page = fake.root.children.find(
			(p) => p.name === "Compartido",
		) as FakeNode;
		const set = page.children.find(
			(c) => c.type === "COMPONENT_SET",
		) as FakeNode;
		assert.equal(set.layoutMode, "HORIZONTAL");
		assert.equal(set.itemSpacing, 40);
		assert.equal(set.paddingLeft, 40);
		assert.match(set.description, /Perfil/);
	});

	it("solo procesa las entradas del área del paso", async () => {
		const { fake, kit } = setup();
		scene(fake);
		const result = await kit.steps.share(
			paramsOf(PANEL, [PROFILE]) as never,
			{},
		);
		assert.deepEqual(
			reportOf(result).shared.map((s) => s.area),
			["Panel"],
		);
	});

	it("quita los enlaces de la capa antes de moverla: con ellos, Figma no deja cambiarla de página (trampa 3, sin verificar)", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		const part = s.frames["Inicio"]?.children[1] as FakeNode;
		const page = fake.page("Otra página");
		assert.throws(() => page.appendChild(part), /links to another page/);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const moved = fake.root.children
			.find((p) => p.name === "Compartido")
			?.findAllWithCriteria({ types: ["FRAME"] });
		for (const node of moved ?? []) assert.equal(node.reactions.length, 0);
	});

	it("repetirlo: el frame ya no tiene la capa (ALREADY_SHARED), sin cambios y sin tocar el set", async () => {
		const { fake, kit } = setup();
		scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const page = fake.root.children.find(
			(p) => p.name === "Compartido",
		) as FakeNode;
		const set = page.children.find(
			(c) => c.type === "COMPONENT_SET",
		) as FakeNode;
		const variants = set.children.map((c) => c.id);
		const again = await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		assert.deepEqual(warningCodes(again), ["ALREADY_SHARED"]);
		assert.deepEqual(again.createdNodeIds, []);
		assert.deepEqual(
			set.children.map((c) => c.id),
			variants,
		);
		assert.deepEqual(reportOf(again).shared, []);
	});

	it("con un set ya hecho, rehace la variante del mismo nombre en su sitio: conserva su id y le pone el contenido nuevo", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const set = sharedSet(fake);
		const before = set.children[0] as FakeNode;
		// otra pasada con contenido nuevo en el frame
		const frame = s.frames["Inicio"] as FakeNode;
		const fresh = fake.node(frame, "FRAME", "principal");
		fake.node(fresh, "FRAME", "bloque nuevo");
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		assert.equal(set.children.length, 1);
		assert.equal(set.children[0]?.id, before.id, "la misma variante");
		assert.equal(before.removed, false);
		assert.equal(before.name, "area=panel");
		assert.deepEqual(
			before.children.map((c) => c.name),
			["bloque nuevo"],
		);
		const inst = frame.children.find((c) => c.type === "INSTANCE") as FakeNode;
		assert.equal(inst.main?.id, before.id);
	});

	it("las instancias de fuera siguen apuntando a la variante rehecha y ven el contenido nuevo; sin ORPHAN_INSTANCES (trampa 13)", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const old = sharedSet(fake).children[0] as FakeNode;
		const outside = fake.node(fake.page("Otra área"), "FRAME", "Fuera");
		const stray = old.createInstance();
		outside.appendChild(stray);
		const fresh = fake.node(
			s.frames["Inicio"] as FakeNode,
			"FRAME",
			"principal",
		);
		fake.node(fresh, "FRAME", "bloque nuevo");
		const result = await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		assert.equal(warningCodes(result).includes("ORPHAN_INSTANCES"), false);
		assert.equal(old.removed, false);
		assert.equal(stray.main?.id, old.id);
		assert.deepEqual(
			stray.children.map((c) => c.name),
			["bloque nuevo"],
		);
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("el texto cambiado en una instancia de fuera se reaplica por su ruta; el que ya no tiene capa avisa OVERRIDES_LOST", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const old = sharedSet(fake).children[0] as FakeNode;
		const stray = old.createInstance();
		fake.node(fake.page("Otra área"), "FRAME", "Fuera").appendChild(stray);
		const label = stray.findOne((n) => n.type === "TEXT") as FakeNode;
		await fake.loadFontAsync(label.fontName as never);
		label.characters = "Cambiado fuera";
		// la segunda pasada trae el mismo botón (con su texto) y nada más
		const fresh = fake.node(
			s.frames["Inicio"] as FakeNode,
			"FRAME",
			"principal",
		);
		button(fake, fresh, "Ir");
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const now = stray.findOne((n) => n.type === "TEXT") as FakeNode;
		assert.equal(now.characters, "Cambiado fuera");
		// una tercera pasada sin el botón: el cambio ya no tiene dónde ir y se avisa
		fake.node(s.frames["Inicio"] as FakeNode, "FRAME", "principal");
		const result = await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const lost = (result.warnings ?? []).find(
			(w) => w.code === "OVERRIDES_LOST",
		);
		assert.ok(lost);
		assert.match(lost.message, /Cambiado fuera/);
	});

	it("la instancia sale de la variante que hay en el set", async () => {
		const { fake, kit } = setup();
		const s = scene(fake);
		await kit.steps.share(paramsOf(PANEL, [group]) as never, {});
		const inst = s.frames["Inicio"]?.children[1] as FakeNode;
		const main = inst.main as FakeNode;
		assert.equal(main.removed, false);
		assert.ok(await fake.getNodeByIdAsync(main.id));
		assert.equal(main.parent?.type, "COMPONENT_SET");
	});

	it("falla AREA_NOT_FOUND si falta la página del área, sin crear la del grupo", async () => {
		const { fake, kit } = setup();
		scene(fake);
		await assert.rejects(
			kit.steps.share(
				paramsOf({ ...PANEL, page: "No existe" }, [group]) as never,
				{},
			),
			(e: Error) => e.message.includes("AREA_NOT_FOUND"),
		);
		assert.equal(
			fake.root.children.some((p) => p.name === "Compartido"),
			false,
		);
	});
});
