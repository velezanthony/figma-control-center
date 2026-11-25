// kit.links.*: enlaces del prototipo por texto, por filas y repuestos. Trampas: 3, 4, 5, 15 y 16.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import { setup } from "../support.ts";

const TRANSITION = {
	type: "DISSOLVE",
	easing: "EASE_OUT",
	duration: 0.2,
} as const;
const CLICKABLE = {
	names: ["a", "button"],
	namePrefixes: ["enlace ·"],
	components: ["Button", "Tab"],
};

// Un botón con su texto dentro de un padre
function button(
	fake: FakeFigma,
	parent: FakeNode,
	name: string,
	label: string,
	type = "FRAME",
): FakeNode {
	const b = fake.node(parent, type, name);
	fake.text(b, "t", label);
	return b;
}

// Un set «Button» cuya variante base cambia a «hover» al pasar por encima (lo que un botón trae de su componente)
async function hoverButton(fake: FakeFigma, page: FakeNode) {
	const set = fake.componentSet(page, "Button", [
		{ state: "default" },
		{ state: "hover" },
	]);
	const [base, hover] = set.children as [FakeNode, FakeNode];
	const reaction = {
		trigger: { type: "ON_HOVER" },
		actions: [
			{ type: "NODE", destinationId: hover.id, navigation: "CHANGE_TO" },
		],
	};
	await base.setReactionsAsync([reaction]);
	return { set, base, hover, reaction };
}

// Una instancia del botón en `parent` con `label` como único texto visible
function instanceIn(base: FakeNode, parent: FakeNode, label: string): FakeNode {
	const b = base.createInstance();
	parent.appendChild(b);
	for (const c of b.children) {
		if (c.name === "label") c.seedCharacters(label);
		else c.visible = false;
	}
	return b;
}

const warningCodes = (result: { warnings?: { code: string }[] }) =>
	(result.warnings ?? []).map((w) => w.code);

const triggers = (node: FakeNode): string[] =>
	node.reactions.map((r) => (r as { trigger: { type: string } }).trigger.type);

describe("kit.links.to", () => {
	it("pone un clic que navega al destino con la transición pedida", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const from = fake.node(page, "FRAME", "Inicio");
		const to = fake.node(page, "FRAME", "Detalle");
		const b = button(fake, from, "a", "Ver");
		const r = await kit.links.to(b as never, to as never, {
			transition: TRANSITION,
		});
		assert.deepEqual(r, { changed: true });
		assert.equal(b.reactions.length, 1);
		const reaction = b.reactions[0] as {
			trigger: { type: string };
			actions: {
				type: string;
				destinationId: string;
				navigation: string;
				transition: { type: string; easing: { type: string } };
			}[];
		};
		assert.equal(reaction.trigger.type, "ON_CLICK");
		assert.equal(reaction.actions[0]?.destinationId, to.id);
		assert.equal(reaction.actions[0]?.navigation, "NAVIGATE");
		assert.equal(reaction.actions[0]?.transition.type, "DISSOLVE");
		assert.equal(reaction.actions[0]?.transition.easing.type, "EASE_OUT");
	});

	it("la duración vuelve en 32 bits (trampa 5, sin verificar): repetir no cambia nada y no escribe", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const from = fake.node(page, "FRAME", "Inicio");
		const to = fake.node(page, "FRAME", "Detalle");
		const b = button(fake, from, "a", "Ver");
		await kit.links.to(b as never, to as never, { transition: TRANSITION });
		const duration = (
			b.reactions[0] as { actions: { transition: { duration: number } }[] }
		).actions[0]?.transition.duration;
		assert.notEqual(duration, 0.2, "el doble devuelve la duración en 32 bits");
		const writes = fake.stats.reactionWrites;
		const t = kit.track();
		const again = await kit.links.to(b as never, to as never, {
			transition: TRANSITION,
		});
		assert.deepEqual(again, { changed: false });
		assert.equal(fake.stats.reactionWrites, writes);
		assert.deepEqual(t.done().mutatedNodeIds, []);
	});

	it("un destino distinto sí cambia el enlace", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const from = fake.node(page, "FRAME", "Inicio");
		const one = fake.node(page, "FRAME", "Uno");
		const two = fake.node(page, "FRAME", "Dos");
		const b = button(fake, from, "a", "Ver");
		await kit.links.to(b as never, one as never, { transition: TRANSITION });
		const r = await kit.links.to(b as never, two as never, {
			transition: TRANSITION,
		});
		assert.deepEqual(r, { changed: true });
		assert.equal(
			(b.reactions[0] as { actions: { destinationId: string }[] }).actions[0]
				?.destinationId,
			two.id,
		);
	});

	it("un destino en otra página lanza en Figma (trampa 3, sin verificar) y el kit falla antes con LINK_OTHER_PAGE", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const other = fake.page("Otra");
		const from = fake.node(page, "FRAME", "Inicio");
		const to = fake.node(other, "FRAME", "Lejos");
		const b = button(fake, from, "a", "Ver");
		await assert.rejects(
			b.setReactionsAsync([
				{ actions: [{ type: "NODE", destinationId: to.id }] },
			]),
			/another page/,
		);
		await assert.rejects(
			kit.links.to(b as never, to as never, { transition: TRANSITION }),
			(e: Error) => e.message.includes("LINK_OTHER_PAGE"),
		);
		assert.equal(b.reactions.length, 0);
	});

	it("conserva las demás reacciones del nodo (el hover de un botón) y solo pone o sustituye su clic", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const from = fake.node(page, "FRAME", "Inicio");
		const one = fake.node(page, "FRAME", "Uno");
		const two = fake.node(page, "FRAME", "Dos");
		const { base } = await hoverButton(fake, page);
		const b = instanceIn(base, from, "Ver");
		assert.deepEqual(triggers(b), ["ON_HOVER"], "trae el hover de su variante");
		await kit.links.to(b as never, one as never, { transition: TRANSITION });
		assert.deepEqual(triggers(b), ["ON_HOVER", "ON_CLICK"]);
		const again = await kit.links.to(b as never, two as never, {
			transition: TRANSITION,
		});
		assert.deepEqual(again, { changed: true });
		assert.deepEqual(triggers(b), ["ON_HOVER", "ON_CLICK"]);
		const click = b.reactions[1] as { actions: { destinationId: string }[] };
		assert.equal(click.actions[0]?.destinationId, two.id);
	});

	it("en una capa de una instancia el enlace queda como cambio de la instancia y se relee (trampa 4, sin verificar)", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const from = fake.node(page, "FRAME", "Inicio");
		const to = fake.node(page, "FRAME", "Detalle");
		const inst = fake.node(from, "INSTANCE", "Tarjeta");
		const inner = button(fake, inst, "pie", "Ver más");
		const t = kit.track();
		const r = await kit.links.to(inner as never, to as never, {
			transition: TRANSITION,
		});
		assert.deepEqual(r, { changed: true });
		assert.equal(inner.reactions.length, 1);
		assert.deepEqual(t.done().mutatedNodeIds, [inner.id]);
	});
});

describe("kit.links.byText", () => {
	const frameWith = (fake: FakeFigma) => {
		const page = fake.page("Area");
		const frame = fake.node(page, "FRAME", "Inicio");
		return { page, frame };
	};

	it("encuentra los nodos pulsables por su texto visible, con match exact por defecto", async () => {
		const { fake, kit } = setup();
		const { frame } = frameWith(fake);
		const a = button(fake, frame, "button", "Ver");
		button(fake, frame, "button", "Ver todos");
		button(fake, frame, "caja", "Ver");
		const found = await kit.links.byText(frame as never, "Ver", {
			clickable: CLICKABLE,
		});
		assert.deepEqual(
			found.map((n) => n.id),
			[a.id],
		);
	});

	it("match start y contains", async () => {
		const { fake, kit } = setup();
		const { frame } = frameWith(fake);
		const one = button(fake, frame, "a", "Ver todos");
		const two = button(fake, frame, "a", "Quiero ver todos ya");
		const start = await kit.links.byText(frame as never, "Ver", {
			match: "start",
			clickable: CLICKABLE,
		});
		assert.deepEqual(
			start.map((n) => n.id),
			[one.id],
		);
		const contains = await kit.links.byText(frame as never, "ver todos", {
			match: "contains",
			clickable: CLICKABLE,
		});
		assert.deepEqual(
			contains.map((n) => n.id),
			[two.id],
		);
	});

	it("es pulsable por nombre, por prefijo del nombre, por componente y por una pieza de un componente", async () => {
		const { fake, kit } = setup();
		const { page, frame } = frameWith(fake);
		const set = fake.componentSet(page, "Button", [{ k: "v" }]);
		const tab = fake.componentSet(page, "Tab", [{ k: "v" }]);
		const card = fake.componentSet(page, "KPI card", [{ k: "v" }]);
		const byName = button(fake, frame, "button", "Ir");
		const byPrefix = button(fake, frame, "enlace · detalle", "Ir");
		const byComponent = fake.node(frame, "INSTANCE", "Button");
		(byComponent as unknown as { main: FakeNode }).main = set
			.children[0] as FakeNode;
		fake.text(byComponent, "t", "Ir");
		const byTab = fake.node(frame, "INSTANCE", "Tab");
		byTab.main = tab.children[0] as FakeNode;
		fake.text(byTab, "t", "Ir");
		const holder = fake.node(frame, "INSTANCE", "KPI card");
		holder.main = card.children[0] as FakeNode;
		const part = button(fake, holder, "pie", "Ir");
		const found = await kit.links.byText(frame as never, "Ir", {
			clickable: {
				...CLICKABLE,
				parts: [{ name: "pie", insideComponent: "KPI card" }],
			},
		});
		assert.deepEqual(
			found.map((n) => n.id).sort(),
			[byName, byPrefix, byComponent, byTab, part].map((n) => n.id).sort(),
		);
	});

	it("el texto oculto por un antecesor no cuenta (trampa 15, medida)", async () => {
		const { fake, kit } = setup();
		const { frame } = frameWith(fake);
		const b = fake.node(frame, "FRAME", "button");
		fake.text(b, "t", "Resumen");
		const counter = fake.node(b, "FRAME", "contador");
		fake.text(counter, "n", "3");
		counter.visible = false;
		const found = await kit.links.byText(frame as never, "Resumen", {
			clickable: CLICKABLE,
		});
		assert.deepEqual(
			found.map((n) => n.id),
			[b.id],
		);
	});

	it("salta lo que está dentro del componente que se le dice (el shell)", async () => {
		const { fake, kit } = setup();
		const { page, frame } = frameWith(fake);
		const shell = fake.componentSet(page, "Lateral", [{ k: "v" }]);
		const inst = fake.node(frame, "INSTANCE", "Lateral");
		inst.main = shell.children[0] as FakeNode;
		button(fake, inst, "button", "Inicio");
		const out = button(fake, frame, "button", "Inicio");
		const found = await kit.links.byText(frame as never, "Inicio", {
			clickable: CLICKABLE,
			skipInside: "Lateral",
		});
		assert.deepEqual(
			found.map((n) => n.id),
			[out.id],
		);
	});

	it("recorre por tipo con findAllWithCriteria, nunca con findAll (trampa 16, medida)", async () => {
		const { fake, kit } = setup();
		const { frame } = frameWith(fake);
		button(fake, frame, "button", "Ver");
		await kit.links.byText(frame as never, "Ver", { clickable: CLICKABLE });
		assert.equal(fake.stats.findAll, 0);
	});
});

describe("kit.links.rows", () => {
	it("devuelve las filas de tabla que están dentro de su cuerpo", () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const frame = fake.node(page, "FRAME", "Lista");
		const body = fake.node(frame, "FRAME", "cuerpo de tabla");
		const row1 = fake.node(body, "FRAME", "fila de tabla");
		const row2 = fake.node(body, "FRAME", "tr");
		const head = fake.node(frame, "FRAME", "cabecera");
		fake.node(head, "FRAME", "fila de tabla");
		const found = kit.links.rows(frame as never, {
			row: ["tr", "fila de tabla"],
			body: ["tbody", "cuerpo de tabla"],
		});
		assert.deepEqual(
			found.map((n) => n.id),
			[row1.id, row2.id],
		);
	});
});

describe("kit.links.capture y restore", () => {
	it("guarda las reacciones de lo que tiene texto y las repone en el nodo nuevo con el mismo texto", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const old = fake.node(page, "FRAME", "viejo");
		const oldButton = button(fake, old, "a", "Ver");
		await oldButton.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: dest.id }] },
		]);
		fake.node(old, "FRAME", "sin texto");
		const saved = kit.links.capture(old as never);
		assert.deepEqual(
			saved.map((s) => s.text),
			["Ver"],
		);
		const fresh = fake.node(page, "FRAME", "nuevo");
		const freshButton = button(fake, fresh, "a", "Ver");
		button(fake, fresh, "a", "Otro");
		const r = await kit.links.restore(fresh as never, saved, {
			clickable: CLICKABLE,
		});
		assert.deepEqual(r, { restored: 1, total: 1 });
		assert.equal(freshButton.reactions.length, 1);
	});

	it("si el texto ya no está cuenta menos repuestos que guardados", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const old = fake.node(page, "FRAME", "viejo");
		const oldButton = button(fake, old, "a", "Ver");
		await oldButton.setReactionsAsync([
			{ actions: [{ type: "NODE", destinationId: dest.id }] },
		]);
		const saved = kit.links.capture(old as never);
		const fresh = fake.node(page, "FRAME", "nuevo");
		button(fake, fresh, "a", "Otra cosa");
		const r = await kit.links.restore(fresh as never, saved, {
			clickable: CLICKABLE,
		});
		assert.deepEqual(r, { restored: 0, total: 1 });
	});

	it("un cambio de variante que no vale en el nodo nuevo no se repone y se avisa REACTION_DROPPED con cuál; el clic sí", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const { base, reaction } = await hoverButton(fake, page);
		const old = fake.node(page, "FRAME", "viejo");
		const oldButton = instanceIn(base, old, "Enviar");
		await oldButton.setReactionsAsync([
			reaction,
			{
				trigger: { type: "ON_CLICK" },
				actions: [{ type: "NODE", destinationId: dest.id }],
			},
		]);
		const saved = kit.links.capture(old as never);
		const fresh = fake.node(page, "FRAME", "nuevo");
		const freshButton = button(fake, fresh, "button", "Enviar");
		const t = kit.track();
		const r = await kit.links.restore(fresh as never, saved, {
			clickable: CLICKABLE,
		});
		assert.deepEqual(r, { restored: 1, total: 1 });
		assert.deepEqual(triggers(freshButton), ["ON_CLICK"]);
		const warning = (t.done().warnings ?? []).find(
			(w) => w.code === "REACTION_DROPPED",
		);
		assert.ok(warning, "avisa de lo que no se repone");
		assert.match(warning.message, /Enviar/);
		assert.match(warning.message, /ON_HOVER/);
		assert.match(warning.message, /CHANGE_TO/);
		assert.match(warning.message, /state=hover/);
	});

	it("un cambio de variante del set viejo no se repone sobre el hover que el nodo nuevo ya trae, y eso no se avisa", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const oldButton = await hoverButton(fake, page);
		const newButton = await hoverButton(fake, page);
		const old = fake.node(page, "FRAME", "viejo");
		instanceIn(oldButton.base, old, "Ver");
		const saved = kit.links.capture(old as never);
		const fresh = fake.node(page, "FRAME", "nuevo");
		const freshButton = instanceIn(newButton.base, fresh, "Ver");
		const t = kit.track();
		await kit.links.restore(fresh as never, saved, { clickable: CLICKABLE });
		const hover = freshButton.reactions[0] as {
			actions: { destinationId: string }[];
		};
		assert.equal(freshButton.reactions.length, 1);
		assert.equal(hover.actions[0]?.destinationId, newButton.hover.id);
		assert.equal(warningCodes(t.done()).includes("REACTION_DROPPED"), false);
	});

	it("conserva las reacciones propias del nodo nuevo (su hover) al reponer el clic", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const { base } = await hoverButton(fake, page);
		const old = fake.node(page, "FRAME", "viejo");
		const oldButton = button(fake, old, "a", "Ver");
		await oldButton.setReactionsAsync([
			{
				trigger: { type: "ON_CLICK" },
				actions: [{ type: "NODE", destinationId: dest.id }],
			},
		]);
		const saved = kit.links.capture(old as never);
		const fresh = fake.node(page, "FRAME", "nuevo");
		const freshButton = instanceIn(base, fresh, "Ver");
		await kit.links.restore(fresh as never, saved, { clickable: CLICKABLE });
		assert.deepEqual(triggers(freshButton), ["ON_HOVER", "ON_CLICK"]);
	});

	it("si Figma rechaza igualmente lo que se repone, no lanza: avisa REACTION_REJECTED con su mensaje y sigue con el resto", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const old = fake.node(page, "FRAME", "viejo");
		for (const label of ["Uno", "Dos"]) {
			const b = button(fake, old, "a", label);
			await b.setReactionsAsync([
				{
					trigger: { type: "ON_CLICK" },
					actions: [{ type: "NODE", destinationId: dest.id }],
				},
			]);
		}
		const saved = kit.links.capture(old as never);
		const fresh = fake.node(page, "FRAME", "nuevo");
		const one = button(fake, fresh, "a", "Uno");
		const two = button(fake, fresh, "a", "Dos");
		one.setReactionsAsync = async () => {
			throw "rechazado por Figma";
		};
		const t = kit.track();
		const r = await kit.links.restore(fresh as never, saved, {
			clickable: CLICKABLE,
		});
		assert.deepEqual(r, { restored: 1, total: 2 });
		assert.equal(two.reactions.length, 1);
		const warning = (t.done().warnings ?? []).find(
			(w) => w.code === "REACTION_REJECTED",
		);
		assert.ok(warning);
		assert.match(warning.message, /rechazado por Figma/);
	});

	it("el texto oculto no cuenta al guardar (trampa 15)", () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const old = fake.node(page, "FRAME", "viejo");
		const b = fake.node(old, "FRAME", "a");
		const hidden = fake.text(b, "t", "Fantasma");
		hidden.visible = false;
		void b.setReactionsAsync([]);
		assert.deepEqual(kit.links.capture(old as never), []);
	});

	it("lo que devuelve cumple step@1 al declarar los nodos cambiados", async () => {
		const { fake, kit } = setup();
		const page = fake.page("Area");
		const dest = fake.node(page, "FRAME", "Destino");
		const from = fake.node(page, "FRAME", "Inicio");
		const b = button(fake, from, "a", "Ver");
		const t = kit.track();
		await kit.links.to(b as never, dest as never, { transition: TRANSITION });
		assert.equal(StepResultSchema.safeParse(t.done()).success, true);
	});
});
