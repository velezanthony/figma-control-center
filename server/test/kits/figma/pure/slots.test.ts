// kit.slot.*
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

const slotOf = (v: FakeNode) =>
	v.children.find((c) => c.type === "SLOT") as FakeNode;
const ref = (n: FakeNode) =>
	(n.componentPropertyReferences as { slotContentId?: string } | null)
		?.slotContentId;

describe("kit.slot.fill", () => {
	const withSlot = () => {
		const ctx = setup();
		const set = ctx.fake.componentSet(ctx.fake.page("C"), "Tarjeta", [
			{ tipo: "a" },
		]);
		const variant = set.children[0] as FakeNode;
		variant.createSlot();
		return { ...ctx, inst: variant.createInstance() };
	};

	it("mover una instancia con texto editado a un slot deja capas «inexistentes» y el recorrido revienta", () => {
		const { fake, inst } = withSlot();
		const content = fake.createFrame();
		content.edited = true;
		slotOf(inst).appendChild(content);
		assert.throws(
			() => inst.findAllWithCriteria({ types: ["TEXT"] }),
			/does not exist/,
		);
	});

	it("el kit mete un CLON al final del slot: el recorrido sigue funcionando y el original no se toca", () => {
		const { fake, kit, inst } = withSlot();
		const content = fake.createFrame();
		content.name = "contenido";
		content.edited = true;
		const t = kit.track();
		const copy = kit.slot.fill(
			inst as never,
			content as never,
		) as unknown as FakeNode;
		assert.equal(copy.parent, slotOf(inst));
		assert.notEqual(copy, content);
		assert.equal(copy.edited, false);
		assert.doesNotThrow(() => inst.findAllWithCriteria({ types: ["TEXT"] }));
		assert.equal(
			content.parent,
			fake.currentPage,
			"el original sigue donde estaba",
		);
		assert.deepEqual(t.done().createdNodeIds.includes(copy.id), true);
	});

	it("rellena al final: lo que ya había en el slot queda delante", () => {
		const { fake, kit, inst } = withSlot();
		const first = fake.createFrame();
		const second = fake.createFrame();
		const a = kit.slot.fill(inst as never, first as never);
		const b = kit.slot.fill(inst as never, second as never);
		assert.deepEqual(slotOf(inst).children, [a, b]);
	});

	it("sin slot, o con un nombre que no existe, el error dice qué mirar", () => {
		const { fake, kit, inst } = withSlot();
		const content = fake.createFrame();
		assert.throws(
			() => kit.slot.fill(inst as never, content as never, { slot: "otro" }),
			/SLOT_NOT_FOUND/,
		);
		const plain = fake
			.componentSet(fake.page("P"), "Sin slot", [{ a: "1" }])
			.children[0]?.createInstance();
		assert.throws(
			() => kit.slot.fill(plain as never, content as never),
			/SLOT_NOT_FOUND/,
		);
	});
});

describe("kit.slot.share", () => {
	const setWithTwo = () => {
		const ctx = setup();
		const set = ctx.fake.componentSet(ctx.fake.page("C"), "Tarjeta", [
			{ tipo: "a" },
			{ tipo: "b" },
		]);
		return { ...ctx, set, variants: set.children as FakeNode[] };
	};

	it("setProperties no toca slots: sin el kit no hay forma de compartirlo desde la instancia", () => {
		const { variants } = setWithTwo();
		variants[0]?.createSlot();
		const inst = variants[0]?.createInstance() as FakeNode;
		const key =
			Object.keys(inst.componentProperties).find((k) => k.startsWith("Slot")) ??
			"";
		assert.throws(
			() => inst.setProperties({ [key]: "x" }),
			/cannotSetSlotProperty/,
		);
	});

	it("deja a todas las variantes con una sola propiedad SLOT con ese nombre y borra la sobrante", () => {
		const { kit, set, variants } = setWithTwo();
		const common = kit.slot.share(variants as never, "contenido");
		assert.match(common, /^contenido#/);
		assert.deepEqual(
			variants.map((v) => ref(slotOf(v))),
			[common, common],
		);
		const slotProps = Object.entries(set.componentPropertyDefinitions).filter(
			([, d]) => d.type === "SLOT",
		);
		assert.deepEqual(
			slotProps.map(([k]) => k),
			[common],
		);
	});

	it("si la variante ya tenía slot lo reutiliza; repetirlo no crea más", () => {
		const { kit, set, variants } = setWithTwo();
		(variants[0] as FakeNode).createSlot();
		kit.slot.share(variants as never, "contenido");
		kit.slot.share(variants as never, "contenido");
		assert.equal(
			variants.every(
				(v) => v.children.filter((c) => c.type === "SLOT").length === 1,
			),
			true,
		);
		assert.equal(
			Object.values(set.componentPropertyDefinitions).filter(
				(d) => d.type === "SLOT",
			).length,
			1,
		);
	});

	it("variantes que no son de un set dan un error con siguiente paso", () => {
		const { fake, kit } = setup();
		const loose = fake.createFrame();
		loose.type = "COMPONENT";
		assert.throws(
			() => kit.slot.share([loose] as never, "x"),
			/SLOT_SHARE_SET/,
		);
	});
});
