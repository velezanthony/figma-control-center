// kit.instance.create y kit.fonts.ensure
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

const text = (n: FakeNode, name: string) =>
	n.descendants().find((d) => d.name === name)?.characters;
const shown = (n: FakeNode, name: string) =>
	n.descendants().find((d) => d.name === name)?.visible;

describe("kit.instance.create", () => {
	it("crea la instancia de la variante pedida con sus textos (carga las fuentes antes)", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Tarjeta", [
			{ tipo: "a" },
			{ tipo: "b" },
		]);
		const t = kit.track();
		const inst = (await kit.instance.create(set as never, {
			variant: { tipo: "b" },
			texts: { Label: "Hola" },
		})) as unknown as FakeNode;
		assert.equal(inst.main?.variantProperties?.["tipo"], "b");
		assert.equal(text(inst, "label"), "Hola");
		assert.deepEqual(t.done().createdNodeIds, [inst.id]);
	});

	it("sin cargar la fuente, escribir el texto lanza: es lo que el kit evita", async () => {
		const { fake } = setup();
		const set = fake.componentSet(fake.page("C"), "Tarjeta", [{ tipo: "a" }]);
		const inst = set.children[0]?.createInstance() as FakeNode;
		const key = Object.keys(inst.componentProperties).find((k) =>
			k.startsWith("Label"),
		);
		assert.throws(
			() => inst.setProperties({ [key ?? ""]: "x" }),
			/unloaded font/,
		);
	});

	it("el texto de un componente anidado se aplica a la instancia anidada que es dueña de la prop", async () => {
		const { fake, kit } = setup();
		const inner = fake.componentSet(fake.page("I"), "Etiqueta", [{ x: "1" }]);
		const outer = fake.componentSet(fake.page("O"), "Filtro", [{ y: "1" }]);
		const nested = inner.children[0]?.createInstance() as FakeNode;
		(outer.children[0] as FakeNode).appendChild(nested);
		nested.name = "etiqueta-anidada";
		// La prop `Label` del exterior no la lee nadie aquí: se renombra la del exterior para que solo la tenga la anidada
		for (const k of Object.keys(outer.componentPropertyDefinitions)) {
			if (k.startsWith("Label")) delete outer.componentPropertyDefinitions[k];
		}
		const inst = (await kit.instance.create(outer as never, {
			texts: { Label: "Anidado" },
		})) as unknown as FakeNode;
		const inNested = inst.descendants().find((d) => d.type === "INSTANCE");
		assert.equal(text(inNested as FakeNode, "label"), "Anidado");
		assert.equal(kit.track().done().warnings, undefined);
	});

	it("una prop de texto que no existe da un aviso, no un error", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Tarjeta", [{ tipo: "a" }]);
		const t = kit.track();
		await kit.instance.create(set as never, { texts: { Inventada: "x" } });
		assert.equal(t.done().warnings?.[0]?.code, "TEXT_PROP_NOT_FOUND");
	});

	it("un «Mostrar X» se apaga si no hay texto para X, y se enciende si lo hay", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Tarjeta", [{ tipo: "a" }]);
		const sin = (await kit.instance.create(
			set as never,
			{},
		)) as unknown as FakeNode;
		assert.equal(shown(sin, "desc"), false);
		const con = (await kit.instance.create(set as never, {
			texts: { Descripción: "Algo" },
		})) as unknown as FakeNode;
		assert.equal(shown(con, "desc"), true);
		assert.equal(text(con, "desc"), "Algo");
	});

	it("`visible` manda sobre la regla del «Mostrar»", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Tarjeta", [{ tipo: "a" }]);
		const inst = (await kit.instance.create(set as never, {
			texts: { Descripción: "Algo" },
			visible: { "Mostrar descripción": false },
		})) as unknown as FakeNode;
		assert.equal(shown(inst, "desc"), false);
	});

	it("un set con una propiedad SLOT sin defaultValue se instancia igual (rev.: SLOT sin valor por defecto)", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Contenedor", [
			{ tipo: "a" },
		]);
		set.addComponentProperty("Contenido", "SLOT");
		assert.equal(
			Object.values(set.componentPropertyDefinitions).some(
				(d) => d.type === "SLOT" && !("defaultValue" in d),
			),
			true,
		);
		const inst = await kit.instance.create(set as never, {
			texts: { Label: "x" },
		});
		assert.ok(inst);
	});
});

describe("kit.fonts.ensure", () => {
	it("carga cada fuente una vez, también las de varios estilos de un texto mixto", async () => {
		const { fake, kit } = setup();
		const page = fake.page("F");
		const a = fake.text(page, "a", "x");
		const b = fake.text(page, "b", "y");
		b.fontName = fake.mixed;
		b.segments = [
			{ fontName: { family: "Inter", style: "Bold" } },
			{ fontName: { family: "Inter", style: "Regular" } },
		];
		await kit.fonts.ensure([a as never, b as never]);
		assert.deepEqual([...fake.loadedFonts].sort(), [
			"Inter/Bold",
			"Inter/Regular",
		]);
		a.characters = "ya se puede";
	});

	it("acepta un contenedor: carga las fuentes de todos sus textos", async () => {
		const { fake, kit } = setup();
		const frame = fake.createFrame();
		const t = fake.text(frame, "t", "x");
		t.fontName = { family: "Montserrat", style: "Medium" };
		await kit.fonts.ensure(frame as never);
		assert.equal(fake.loadedFonts.has("Montserrat/Medium"), true);
	});

	it("una fuente que no existe da un error con siguiente paso", async () => {
		const { fake, kit } = setup();
		const t = fake.text(fake.page("F"), "t", "x");
		t.fontName = { family: "Ausente Sans", style: "Regular" };
		await assert.rejects(kit.fonts.ensure(t as never), /FONT_MISSING/);
	});
});
