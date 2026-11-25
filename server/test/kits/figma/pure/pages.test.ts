// Páginas y nodos por clave (kit.page.*, kit.node.*, kit.frame.ensure)
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setup } from "../support.ts";

describe("kit.page", () => {
	it("find: busca por nombre recortado y devuelve null si no existe", async () => {
		const { fake, kit } = setup();
		const p = fake.page("  App ");
		assert.equal(await kit.page.find("App"), p);
		assert.equal(await kit.page.find("Otra"), null);
	});

	it("ensure: crea la página con su clave y repetirlo devuelve la misma", async () => {
		const { fake, kit } = setup();
		const a = await kit.page.ensure({ key: "fcc:uno", name: "Uno" });
		const b = await kit.page.ensure({ key: "fcc:uno", name: "Otro nombre" });
		assert.equal(a, b);
		assert.equal(fake.root.children.filter((p) => p.name === "Uno").length, 1);
	});

	it("ensure: si ya hay una página con ese nombre, la adopta y le pone la clave", async () => {
		const { fake, kit } = setup();
		const existing = fake.page("Pruebas");
		const t = kit.track();
		assert.equal(
			await kit.page.ensure({ key: "k", name: "Pruebas" }),
			existing,
		);
		assert.equal(existing.getSharedPluginData("fcc", "key"), "k");
		assert.deepEqual(t.done().mutatedNodeIds, [existing.id]);
	});

	it("remove: borrar la página abierta lanza sin el kit; con el kit pasa antes a otra", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Borrar");
		await fake.setCurrentPageAsync(page);
		assert.throws(() => page.remove(), /current page/);
		const t = kit.track();
		await kit.page.remove(page as never);
		assert.equal(fake.currentPage === page, false);
		assert.equal(fake.root.children.includes(page), false);
		assert.deepEqual(t.done().removedNodeIds, [page.id]);
	});

	it("remove: la única página del archivo no se borra y el error dice qué hacer", async () => {
		const { fake, kit } = setup();
		const only = fake.currentPage;
		await assert.rejects(kit.page.remove(only as never), (e: Error) =>
			e.message.includes("LAST_PAGE"),
		);
	});
});

describe("kit.node", () => {
	it("tag: guarda la clave con setSharedPluginData; setPluginData lanza fuera de un plugin", async () => {
		const { fake, kit } = setup();
		const frame = fake.createFrame();
		assert.throws(() => frame.setPluginData(), /without an ID/);
		kit.node.tag(frame as never, "fcc:marco");
		assert.equal(frame.getSharedPluginData("fcc", "key"), "fcc:marco");
	});

	it("byKey: encuentra el nodo en cualquier página, o solo en la pedida, con findAllWithCriteria", async () => {
		const { fake, kit } = setup();
		const a = fake.page("A");
		const b = fake.page("B");
		const frame = fake.createFrame();
		b.appendChild(frame);
		kit.node.tag(frame as never, "k");
		assert.equal(await kit.node.byKey("k"), frame);
		assert.equal(await kit.node.byKey("k", { page: b as never }), frame);
		assert.equal(await kit.node.byKey("k", { page: a as never }), null);
		assert.equal(await kit.node.byKey("nada"), null);
		assert.equal(
			fake.stats.findAll,
			0,
			"findAll recorre todo: se usa findAllWithCriteria",
		);
	});

	it("byKey: con la clave repetida devuelve el primero y avisa", async () => {
		const { fake, kit } = setup();
		const one = fake.createFrame();
		const two = fake.createFrame();
		kit.node.tag(one as never, "k");
		kit.node.tag(two as never, "k");
		const t = kit.track();
		assert.equal(await kit.node.byKey("k"), one);
		assert.equal(t.done().warnings?.[0]?.code, "KEY_DUPLICATED");
	});

	it("byKey ignora las copias que Figma refleja en las instancias: una subcapa de instancia y una instancia del componente etiquetado no son dueñas de la clave", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Solicitudes");
		// Las copias van ANTES que el componente, para que el orden no tape el fallo
		const icons = fake.page("Iconos");
		const icon = fake.createFrame();
		icon.type = "COMPONENT";
		icons.appendChild(icon);
		kit.node.tag(icon as never, "fcc:icono");
		const cell = fake.createFrame();
		cell.type = "COMPONENT";
		cell.name = "Td";
		cell.appendChild(icon.createInstance());
		const td = cell.createInstance();
		page.appendChild(td);
		page.appendChild(icon.createInstance());
		fake.root.children.splice(fake.root.children.indexOf(icons), 1);
		fake.root.children.push(icons);
		const nested = td.descendants().find((n) => n.type === "INSTANCE");
		assert.equal(
			nested?.getSharedPluginData("fcc", "key"),
			"fcc:icono",
			"el doble refleja la clave",
		);
		const t = kit.track();
		assert.equal(await kit.node.byKey("fcc:icono"), icon);
		assert.equal(
			t.done().warnings,
			undefined,
			"sin copias no hay clave repetida",
		);
	});

	it("byKey sigue avisando de un duplicado de verdad", async () => {
		const { fake, kit } = setup();
		const a = fake.createFrame();
		const b = fake.createFrame();
		kit.node.tag(a as never, "k");
		kit.node.tag(b as never, "k");
		const t = kit.track();
		await kit.node.byKey("k");
		assert.equal(t.done().warnings?.[0]?.code, "KEY_DUPLICATED");
	});

	it("get: por id con getNodeByIdAsync (el síncrono está obsoleto); null si ya no existe", async () => {
		const { fake, kit } = setup();
		const frame = fake.createFrame();
		assert.throws(() => fake.getNodeById(), /obsoleto/);
		assert.equal(await kit.node.get(frame.id), frame);
		frame.remove();
		assert.equal(await kit.node.get(frame.id), null);
	});
});

describe("kit.frame.ensure", () => {
	const options = (page: unknown) => ({
		key: "fcc:pantalla",
		page: page as never,
		name: "Pantalla",
		width: 1440,
		minHeight: 900,
	});

	it("crea el marco con su clave y tamaño; repetir devuelve el mismo, sin duplicar", async () => {
		const { fake, kit } = setup();
		const page = fake.page("P");
		const t = kit.track();
		const a = await kit.frame.ensure(options(page));
		const b = await kit.frame.ensure(options(page));
		assert.equal(a, b);
		assert.equal(page.children.length, 1);
		assert.deepEqual(
			[page.children[0]?.width, page.children[0]?.minHeight],
			[1440, 900],
		);
		assert.deepEqual(t.done().createdNodeIds, [a.id]);
	});

	it("la misma clave en otra página es otro marco", async () => {
		const { fake, kit } = setup();
		const a = await kit.frame.ensure(options(fake.page("A")));
		const b = await kit.frame.ensure(options(fake.page("B")));
		assert.notEqual(a, b);
	});

	it("una clave que ya tiene un nodo que no es un marco da un error con siguiente paso", async () => {
		const { fake, kit } = setup();
		const page = fake.page("P");
		const text = fake.text(page, "t", "x");
		kit.node.tag(text as never, "fcc:pantalla");
		await assert.rejects(kit.frame.ensure(options(page)), /KEY_NOT_FRAME/);
	});
});
