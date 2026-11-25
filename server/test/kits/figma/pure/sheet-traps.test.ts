// El doble reproduce lo medido y lo no medido que usan las hojas: lo medido, tal cual; lo no medido, lo más duro
// posible, y cada uno lo cierra
// `make kit-contract`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createKit } from "../../../../../kits/figma/kit.ts";
import { installFakeFigma } from "../fake-figma.ts";

function setup() {
	const fake = installFakeFigma();
	fake.strictProperties = true;
	fake.loadedFontsToLoad.add("Inter/Regular");
	const page = fake.page("Hoja");
	const set = fake.componentSet(page, "Set", [{ v: "a" }, { v: "b" }]);
	return { fake, page, set };
}

describe("el doble: propiedades de componente (sin verificar salvo INSTANCE_SWAP, medido)", () => {
	it("las opciones de addComponentProperty rechazan claves de más (esquema estricto)", () => {
		const { fake } = setup();
		const set = fake.page("X").children[0] ?? fake.page("Y");
		const holder = fake.componentSet(fake.page("P"), "S2", [{ v: "a" }]);
		assert.throws(
			() =>
				holder.addComponentProperty("n", "TEXT", "x", { extra: 1 } as never),
			/Unrecognized key: "extra"/,
		);
		assert.throws(
			() =>
				holder.addComponentProperty("n2", "INSTANCE_SWAP", "1:1", {
					preferredValues: [{ type: "COMPONENT", key: "k", extra: 1 } as never],
				}),
			/Unrecognized key: "extra"/,
		);
		void set;
	});

	it("INSTANCE_SWAP con un id que no es de un componente lanza (H9, sin verificar)", () => {
		const { set, fake } = setup();
		const frame = fake.createFrame();
		assert.throws(
			() => set.addComponentProperty("Icono", "INSTANCE_SWAP", frame.id),
			/instance swap component property is invalid/,
		);
		assert.throws(
			() => set.addComponentProperty("Icono", "INSTANCE_SWAP", "nada"),
			/is invalid/,
		);
		const comp = set.children[0];
		assert.ok(comp);
		const key = set.addComponentProperty("Icono2", "INSTANCE_SWAP", comp.id, {
			preferredValues: [{ type: "COMPONENT", key: comp.key }],
		});
		assert.deepEqual(set.componentPropertyDefinitions[key]?.preferredValues, [
			{ type: "COMPONENT", key: comp.key },
		]);
	});

	it("en una variante no se pueden añadir propiedades (se añaden al set)", () => {
		const { set } = setup();
		assert.throws(
			() =>
				(set.children[0] as typeof set).addComponentProperty(
					"Otra",
					"BOOLEAN",
					true,
				),
			/variant/,
		);
	});

	it("una propiedad SLOT se lee sin defaultValue (H12, sin verificar)", () => {
		const { set } = setup();
		const slot = (set.children[0] as typeof set).createSlot();
		assert.ok(slot);
		const key = Object.keys(set.componentPropertyDefinitions).find((k) =>
			k.startsWith("Slot#"),
		);
		assert.ok(key);
		assert.equal(
			"defaultValue" in (set.componentPropertyDefinitions[key] ?? {}),
			false,
		);
	});
});

describe("el doble: referencias, exposición y números", () => {
	it("una capa dentro de una instancia no admite referencias (H8, sin verificar) y un campo desconocido lanza", () => {
		const { fake, page, set } = setup();
		const comp = set.children[0] as typeof set;
		const inner = fake.text(comp, "t", "x");
		const instance = comp.createInstance();
		page.appendChild(instance);
		const inside = instance.findOne((n) => n.type === "TEXT");
		assert.ok(inside);
		assert.throws(() => {
			inside.componentPropertyReferences = { characters: "k" };
		}, /instance sublayer/);
		assert.throws(() => {
			inner.componentPropertyReferences = { inventado: "k" };
		}, /Unrecognized key/);
		inner.componentPropertyReferences = { characters: "k" };
		assert.deepEqual(inner.componentPropertyReferences, { characters: "k" });
	});

	it("isExposedInstance solo existe en una instancia y solo se expone si tiene hijos con referencias o instancias expuestas (H10, medido)", () => {
		const { fake, page, set } = setup();
		// el set de la prueba lleva textos con referencias de propiedad: su instancia puede exponerse y se relee
		const instance = (set.children[0] as typeof set).createInstance();
		page.appendChild(instance);
		instance.isExposedInstance = true;
		assert.equal(instance.isExposedInstance, true);
		// una instancia de un componente vacío no puede
		const empty = fake.node(page, "COMPONENT", "vacío");
		const plain = empty.createInstance();
		assert.throws(() => {
			plain.isExposedInstance = true;
		}, /Can only expose instances that have exposed nested instances or children with component property references/);
		assert.throws(() => {
			fake.createFrame().isExposedInstance = true;
		}, /solo existe en una instancia/);
	});

	it("dashPattern vuelve en 32 bits (medido)", () => {
		const { fake } = setup();
		const f = fake.createFrame();
		f.dashPattern = [6, 4.3];
		assert.deepEqual(f.dashPattern, [6, Math.fround(4.3)]);
		assert.throws(() => {
			f.dashPattern = ["a"] as never;
		}, /Expected an array of numbers/);
	});

	it("la descripción de un set con saltos de línea se relee igual (H15, sin verificar)", () => {
		const { set } = setup();
		set.description = "uno\n\ndos\ntres";
		assert.equal(set.description, "uno\n\ndos\ntres");
	});
});

describe("el doble: combinar variantes, componentes y páginas", () => {
	it("combineAsVariants conserva el id de cada variante, las deja en 0,0 y el set mide la mayor (H7, medido)", () => {
		const { fake, page } = setup();
		const a = fake.createFrame();
		a.resize(80, 30);
		const b = fake.createFrame();
		b.resize(120, 50);
		page.appendChild(a);
		page.appendChild(b);
		const ca = fake.createComponentFromNode(a);
		ca.name = "v=a";
		const cb = fake.createComponentFromNode(b);
		cb.name = "v=b";
		const host = fake.createFrame();
		page.appendChild(host);
		const ids = [ca.id, cb.id];
		const set = fake.combineAsVariants([ca, cb], host);
		assert.equal(set.children.length, 2);
		assert.deepEqual(
			set.children.map((c) => c.id),
			ids,
		);
		assert.deepEqual(
			set.children.map((c) => c.variantProperties),
			[{ v: "a" }, { v: "b" }],
		);
		assert.equal(set.width, 120);
		assert.equal(set.height, 50);
		// H13: cambiar una variante no reajusta el set; resizeWithoutConstraints sí lo cambia
		(set.children[1] as typeof set).resize(500, 500);
		assert.equal(set.width, 120);
		set.resizeWithoutConstraints(300, 200);
		assert.deepEqual([set.width, set.height], [300, 200]);
	});

	it("createComponentFromNode conserva la disposición del marco y devuelve otro nodo (H1, sin verificar)", () => {
		const { fake, page } = setup();
		const f = fake.createFrame();
		f.layoutMode = "HORIZONTAL";
		f.itemSpacing = 7;
		f.paddingLeft = 3;
		page.appendChild(f);
		const kid = fake.createFrame();
		f.appendChild(kid);
		const comp = fake.createComponentFromNode(f);
		assert.notEqual(comp.id, f.id);
		assert.equal(comp.type, "COMPONENT");
		assert.deepEqual(
			[comp.layoutMode, comp.itemSpacing, comp.paddingLeft],
			["HORIZONTAL", 7, 3],
		);
		assert.equal(comp.children.length, 1);
	});

	it("insertChild de una página que ya existe la cambia de sitio sin cambiar su id (sin verificar para páginas; medido para nodos)", () => {
		const { fake } = setup();
		const a = fake.page("A");
		const b = fake.page("B");
		const id = a.id;
		fake.root.insertChild(fake.root.children.length, a);
		assert.equal(a.id, id);
		assert.equal(fake.root.children.at(-1)?.id, id);
		assert.ok(fake.root.children.includes(b));
		assert.equal(fake.root.children.filter((p) => p.id === id).length, 1);
	});
});

// Rehacer una hoja sobre el set que ya existe: medido en el archivo de pruebas el 2026-11-12
// con `make kit-contract`; el doble lo reproduce.
describe("el doble: rehacer sobre el set que ya existe (H2 a H6 y H11, medidos)", () => {
	const labelKey = (set: ReturnType<typeof setup>["set"]) =>
		Object.keys(set.componentPropertyDefinitions).find((k) =>
			k.startsWith("Label#"),
		) as string;

	it("H2: vaciar una variante y rellenarla deja a sus instancias con el mismo componente, el texto puesto por propiedad y sin el cambio directo en una subcapa", async () => {
		const { fake, page, set } = setup();
		await fake.loadFontAsync({ family: "Inter", style: "Regular" });
		const key = labelKey(set);
		const target = set.children[0] as typeof set;
		const inst = target.createInstance();
		fake.page("Otra").appendChild(inst);
		inst.setProperties({ [key]: "Por propiedad" });
		const direct = inst.findOne((n) => n.name === "desc");
		assert.ok(direct);
		direct.characters = "directo";
		assert.equal((await inst.getMainComponentAsync())?.id, target.id);

		const donor = fake.node(page, "COMPONENT", "donante");
		const label = fake.text(donor, "label", "Etiqueta nueva");
		fake.text(donor, "desc", "desc nueva");
		for (const c of [...target.children]) c.remove();
		for (const c of [...donor.children]) target.appendChild(c);
		label.componentPropertyReferences = { characters: key };

		assert.equal((await inst.getMainComponentAsync())?.id, target.id);
		assert.equal(
			inst.findOne((n) => n.name === "label")?.characters,
			"Por propiedad",
		);
		assert.equal(
			inst.findOne((n) => n.name === "desc")?.characters,
			"desc nueva",
		);
		assert.equal(inst.componentProperties[key]?.value, "Por propiedad");
	});

	it("overrides lista los nodos de la instancia con algo cambiado en ella", async () => {
		const { fake, set } = setup();
		await fake.loadFontAsync({ family: "Inter", style: "Regular" });
		const inst = (set.children[0] as typeof set).createInstance();
		assert.equal(inst.overrides.length, 0);
		inst.setProperties({ [labelKey(set)]: "Otro" });
		const { overrides } = inst;
		assert.equal(overrides.length, 1);
		assert.deepEqual(overrides[0]?.overriddenFields, ["characters"]);
	});

	it("H3: editComponentProperty conserva la clave nombre#id y no pisa el valor que una instancia ya puso", async () => {
		const { fake, set } = setup();
		await fake.loadFontAsync({ family: "Inter", style: "Regular" });
		const key = labelKey(set);
		const inst = (set.children[0] as typeof set).createInstance();
		inst.setProperties({ [key]: "Por propiedad" });
		const bool = set.addComponentProperty("Mostrar", "BOOLEAN", true);
		const returned = set.editComponentProperty(key, {
			defaultValue: "Otro defecto",
		});
		assert.equal(returned, key);
		assert.equal(
			set.componentPropertyDefinitions[key]?.defaultValue,
			"Otro defecto",
		);
		assert.equal(
			set.editComponentProperty(bool, { defaultValue: false }),
			bool,
		);
		assert.equal(set.componentPropertyDefinitions[bool]?.defaultValue, false);
		assert.equal(inst.componentProperties[key]?.value, "Por propiedad");
		assert.throws(
			() => set.editComponentProperty(key, { inventado: 1 } as never),
			/Unrecognized key: "inventado"/,
		);
	});

	it("H4: addComponentProperty con un nombre que ya existe no lanza: crea otra clave con el nombre y un 2", () => {
		const { set } = setup();
		const again = set.addComponentProperty("Label", "TEXT", "x");
		assert.match(again, /^Label2#/);
		assert.equal(
			Object.keys(set.componentPropertyDefinitions).length >= 4,
			true,
		);
	});

	it("H5: una propiedad sin capas que la usen se queda en el set", () => {
		const { set } = setup();
		for (const v of set.children) for (const n of [...v.children]) n.remove();
		assert.ok(labelKey(set));
	});

	it("H6: set.appendChild de un componente añade una variante, lee sus props del nombre y sus opciones", () => {
		const { fake, page, set } = setup();
		const c = fake.node(page, "COMPONENT", "v=c");
		set.appendChild(c);
		assert.equal(set.children.length, 3);
		assert.deepEqual(c.variantProperties, { v: "c" });
		assert.deepEqual(set.componentPropertyDefinitions["v"]?.variantOptions, [
			"a",
			"b",
			"c",
		]);
	});

	it("compartir un hueco con editComponentProperty renombra el nodo SLOT con el nombre de la propiedad, y un SLOT admite slotContentId y visible a la vez (medido)", () => {
		const { set } = setup();
		const kit = createKit();
		const variants = set.children as (typeof set)[];
		for (const v of variants) {
			const slot = v.createSlot();
			slot.name = "hueco";
		}
		const key = kit.slot.share(variants as never, "Hueco", { layer: "hueco" });
		const slot = (variants[0] as typeof set).findOne((n) => n.type === "SLOT");
		assert.equal(slot?.name, "Hueco");
		const show = set.addComponentProperty("Mostrar hueco", "BOOLEAN", true);
		if (slot !== null && slot !== undefined) {
			slot.componentPropertyReferences = {
				...(slot.componentPropertyReferences ?? {}),
				visible: show,
			};
		}
		assert.deepEqual(slot?.componentPropertyReferences, {
			slotContentId: key,
			visible: show,
		});
	});

	it("H11: un hueco repintado con createSlot y kit.slot.share conserva su clave y lo que la instancia metió dentro", async () => {
		const { fake, set } = setup();
		const kit = createKit();
		const variants = set.children as (typeof set)[];
		const common = kit.slot.share(variants as never, "Hueco");
		const inst = (variants[0] as typeof set).createInstance();
		fake.page("Otra").appendChild(inst);
		const slotIn = inst.findOne((n) => n.type === "SLOT");
		assert.ok(slotIn);
		fake.node(slotIn, "RECTANGLE", "contenido");
		for (const v of variants) v.findOne((n) => n.type === "SLOT")?.remove();
		const again = kit.slot.share(variants as never, "Hueco");
		assert.equal(again, common);
		const after = inst.findOne((n) => n.type === "SLOT");
		assert.deepEqual(
			after?.children.map((c) => c.name),
			["contenido"],
		);
	});
});
