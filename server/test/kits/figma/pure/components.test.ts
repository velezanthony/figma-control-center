// Catálogo: kit.component.*
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

const VARIANTS = [
	{ tipo: "primario", tamano: "m" },
	{ tipo: "primario", tamano: "s" },
	{ tipo: "peligro", tamano: "m" },
];

describe("kit.component.find", () => {
	it("encuentra el set por nombre recortado, sin recorrer con findAll", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("Componentes"), "Botón", VARIANTS);
		assert.equal(await kit.component.find(" Botón "), set);
		assert.equal(await kit.component.find("Nada"), null);
		assert.equal(fake.stats.findAll, 0);
	});

	it("las variantes (hijas de un set) no cuentan; un componente suelto sí", async () => {
		const { fake, kit } = setup();
		const page = fake.page("C");
		fake.componentSet(page, "Botón", VARIANTS);
		assert.equal(await kit.component.find("tipo=primario, tamano=m"), null);
		const loose = fake.createFrame();
		loose.type = "COMPONENT";
		loose.name = "Suelto";
		page.appendChild(loose);
		assert.equal(await kit.component.find("Suelto"), loose);
	});

	it("un acierto de la caché se comprueba: si el componente se borró, se vuelve a buscar", async () => {
		const { fake, kit } = setup();
		const page = fake.page("C");
		const old = fake.componentSet(page, "Botón", VARIANTS);
		assert.equal(await kit.component.find("Botón"), old);
		old.remove();
		assert.equal(await kit.component.find("Botón"), null);
		const fresh = fake.componentSet(page, "Botón", VARIANTS);
		assert.equal(await kit.component.find("Botón"), fresh);
	});

	it("setNameOf: el set de una instancia, o el componente si es suelto", async () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Botón", VARIANTS);
		const inst = set.children[0]?.createInstance();
		assert.equal(await kit.component.setNameOf(inst as never), "Botón");
		const loose = fake.createFrame();
		loose.type = "COMPONENT";
		loose.name = "Suelto";
		assert.equal(
			await kit.component.setNameOf(loose.createInstance() as never),
			"Suelto",
		);
	});
});

describe("kit.component.variant", () => {
	it("elige la variante exacta", () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Botón", VARIANTS);
		const v = kit.component.variant(set as never, {
			tipo: "peligro",
			tamano: "m",
		});
		assert.equal((v as unknown as FakeNode).name, "tipo=peligro, tamano=m");
	});

	it("los sets son dispersos: sin una exacta usa la que más props cumple y avisa", () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Botón", VARIANTS);
		const t = kit.track();
		const v = kit.component.variant(set as never, {
			tipo: "peligro",
			tamano: "xl",
		});
		assert.equal(
			(v as unknown as FakeNode).variantProperties?.["tipo"],
			"peligro",
		);
		assert.equal(t.done().warnings?.[0]?.code, "VARIANT_APPROX");
	});

	it("una prop strong pesa más que las demás y nunca se incumple", () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Botón", VARIANTS);
		const v = kit.component.variant(
			set as never,
			{ tipo: "peligro", tamano: "s" },
			{ strong: ["tamano"] },
		);
		assert.equal((v as unknown as FakeNode).variantProperties?.["tamano"], "s");
		assert.throws(
			() =>
				kit.component.variant(
					set as never,
					{ tipo: "peligro", tamano: "xl" },
					{ strong: ["tamano"] },
				),
			/VARIANT_NOT_FOUND/,
		);
	});

	it("un componente suelto es su propia variante", () => {
		const { fake, kit } = setup();
		const loose = fake.createFrame();
		loose.type = "COMPONENT";
		assert.equal(kit.component.variant(loose as never, {}), loose);
	});
});

describe("kit.component.cloneVariant", () => {
	it("clone() pierde las referencias a propiedades; el kit las repone capa a capa y las lee de vuelta", () => {
		const { fake, kit } = setup();
		const set = fake.componentSet(fake.page("C"), "Botón", VARIANTS);
		const original = set.children[0] as FakeNode;
		const raw = original.clone();
		assert.equal(
			raw.children[0]?.componentPropertyReferences,
			null,
			"sin el kit se pierden",
		);

		const t = kit.track();
		const copy = kit.component.cloneVariant(
			original as never,
		) as unknown as FakeNode;
		assert.deepEqual(
			copy.children.map((c) => c.componentPropertyReferences),
			original.children.map((c) => c.componentPropertyReferences),
		);
		assert.equal(copy.parent, set, "la copia queda en el mismo set");
		assert.deepEqual(t.done().createdNodeIds, [copy.id]);
	});
});
