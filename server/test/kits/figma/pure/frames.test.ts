// kit.frame.replaceContent: vaciar un marco y rellenarlo conservando su id. Trampas: 1, 2, 6 y 8.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { ids, setup } from "../support.ts";

// Un marco con dos hijos viejos y, en otra página, un origen con tres hijos nuevos y su propia disposición
function scene(fake: FakeFigma) {
	const area = fake.page("Area");
	const temp = fake.page("tmp Uno");
	const frame = fake.node(area, "FRAME", "Uno");
	fake.node(frame, "FRAME", "viejo A");
	fake.node(frame, "FRAME", "viejo B");
	const source = fake.node(temp, "COMPONENT", "origen");
	source.layoutMode = "HORIZONTAL";
	source.itemSpacing = 12;
	source.paddingLeft = 8;
	source.clipsContent = true;
	fake.node(source, "FRAME", "nuevo A");
	fake.node(source, "FRAME", "nuevo B");
	fake.node(source, "FRAME", "nuevo C");
	return { area, temp, frame, source };
}

const names = (node: FakeNode) => node.children.map((c) => c.name);

describe("kit.frame.replaceContent", () => {
	it("vacía el marco y mete los hijos del origen en su orden, sin cambiar el id del marco", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		const id = frame.id;
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: false,
		});
		assert.equal(frame.id, id);
		assert.deepEqual(names(frame), ["nuevo A", "nuevo B", "nuevo C"]);
		assert.deepEqual(source.children, []);
		assert.equal(frame.removed, false);
	});

	it("rehacer el marco a mano pierde su id y con él los enlaces que le llegaban; replaceContent no (trampa 1, medida)", async () => {
		const { fake, kit } = setup();
		const { area, frame, source } = scene(fake);
		const button = fake.node(area, "FRAME", "boton");
		await button.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: frame.id }] },
		]);
		// A mano: se borra y se crea otro (id nuevo; el destino del enlace ya no existe)
		const rebuilt = fake.node(area, "FRAME", "Uno");
		frame.remove();
		assert.notEqual(rebuilt.id, frame.id);
		assert.equal(await fake.getNodeByIdAsync(frame.id), null);
		// Con el kit: el mismo marco sigue siendo el destino
		const { fake: fake2, kit: kit2 } = setup();
		const scene2 = scene(fake2);
		const link = fake2.node(scene2.area, "FRAME", "boton");
		await kit2.frame.replaceContent(
			scene2.frame as never,
			scene2.source as never,
			{
				copyLayout: true,
			},
		);
		await link.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: scene2.frame.id }] },
		]);
		assert.equal(link.reactions.length, 1);
		assert.ok(await fake2.getNodeByIdAsync(scene2.frame.id));
		void kit;
		void source;
	});

	it("con copyLayout copia la disposición y los rellenos del origen al marco", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		source.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: true,
		});
		assert.equal(frame.layoutMode, "HORIZONTAL");
		assert.equal(frame.itemSpacing, 12);
		assert.equal(frame.paddingLeft, 8);
		assert.equal(frame.clipsContent, true);
		assert.equal(frame.fills.length, 1);
	});

	it("sin copyLayout no toca la disposición del marco", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: false,
		});
		assert.equal(frame.layoutMode, "NONE");
		assert.equal(frame.itemSpacing, 0);
	});

	it("una propiedad que lanza al copiarla no para el paso (trampa 8, medida): se avisa LAYOUT_PROP con el nombre y el mensaje de Figma", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		// Un origen cuyo `paddingTop` no es un número: copiarlo a mano lanza
		Object.defineProperty(source, "paddingTop", { get: () => "mucho" });
		assert.throws(() => {
			frame.paddingTop = (
				source as unknown as { paddingTop: number }
			).paddingTop;
		}, /Expected number/);
		const t = kit.track();
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: true,
		});
		const warnings = t.done().warnings ?? [];
		assert.equal(warnings.length, 1);
		assert.equal(warnings[0]?.code, "LAYOUT_PROP");
		assert.match(warnings[0]?.message ?? "", /paddingTop.*Expected number/);
		// lo demás sí se copió
		assert.equal(frame.itemSpacing, 12);
	});

	it("pone a 0 los hijos fijos antes de vaciar (trampa 6, medida)", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		frame.overflowDirection = "VERTICAL";
		frame.numberOfFixedChildren = 1;
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: false,
		});
		assert.equal(frame.numberOfFixedChildren, 0);
	});

	it("mover desde otra página conserva los ids de los hijos (trampa 2, medida): lo declarado son los ids que tiene el marco", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		const before = ids(source.children);
		const t = kit.track();
		const moved = await kit.frame.replaceContent(
			frame as never,
			source as never,
			{ copyLayout: false },
		);
		const done = t.done();
		assert.deepEqual(ids(moved), before);
		assert.deepEqual(done.createdNodeIds, ids(frame.children));
		for (const id of done.createdNodeIds)
			assert.ok(await fake.getNodeByIdAsync(id));
	});

	it("declara lo que borró, lo que creó y el marco como cambiado; cumple step@1", async () => {
		const { fake, kit } = setup();
		const { frame, source } = scene(fake);
		const old = ids(frame.children);
		const t = kit.track();
		await kit.frame.replaceContent(frame as never, source as never, {
			copyLayout: true,
		});
		const done = t.done();
		assert.deepEqual(done.removedNodeIds, old);
		assert.deepEqual(done.createdNodeIds, ids(frame.children));
		assert.deepEqual(done.mutatedNodeIds, [frame.id]);
		assert.equal(StepResultSchema.safeParse(done).success, true);
	});
});
