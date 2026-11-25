// recognize@1: las reglas del proyecto cambian nodos por instancias antes de pintarlos.
// Orden de las reglas, `plan.rules`, `after` de la regla y del set, RULE_ERROR, RECOGNIZE_INVALID, INSTANCE_SWAP (trampa 23),
// la instancia sustituye al subárbol y los retoques de `nestInstance` (borde del contenedor, ancho, iconos repintados).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FakeNode } from "../fake-figma.ts";
import {
	catalog,
	frame,
	icons,
	img,
	paint,
	recognizer,
	styles,
	svg,
	text,
	world,
} from "../screen-support.ts";

type Node = { cls?: string; tag?: string; kids?: Node[]; txt?: string };
const isButton = (n: Node, cls: Set<string>) =>
	n.tag === "button" && cls.has("btn");
const sizeOf = (cls: Set<string>) => ({
	size: cls.has("btn-sm") ? "sm" : "md",
});

const button = (extra: Record<string, unknown> = {}) =>
	frame({ tag: "button", cls: "btn btn-sm", w: 80, h: 32, ...extra }, [
		text("Guardar", { w: 50 }),
	]);
const page = (...kids: unknown[]) =>
	frame({ disp: "flex", w: 300, h: 100 }, kids);
const codes = (warnings: readonly { code: string }[]) =>
	warnings.map((w) => w.code);

// Pinta con el seguimiento abierto para leer los avisos
async function run(...args: Parameters<typeof paint>) {
	const t = args[0].kit.track();
	const painted = await paint(...args);
	return { ...painted, warnings: t.done().warnings ?? [] };
}

function setup() {
	const w = world();
	styles(w.fake);
	const cat = catalog(w);
	w.fake.currentPage = w.page;
	return { w, ...cat };
}

const BUTTON = {
	Boton: {
		match: isButton,
		props: (
			n: Node,
			cls: Set<string>,
			ctx: { allText(n: Node): string[] },
		) => ({ variant: sizeOf(cls), set: { Label: ctx.allText(n)[0] } }),
	},
};

describe("recognize@1: reglas del proyecto", () => {
	it("una regla que casa cambia el nodo por la instancia de la variante y no pinta su subárbol", async () => {
		const { w } = setup();
		const { root, ctx } = await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(BUTTON),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.main?.name, "size=sm");
		assert.equal(root.children.length, 1);
		// el texto «Guardar» llegó por la propiedad, no por un TEXT pintado aparte
		const label = inst.descendants().find((d) => d.name === "label");
		assert.equal(label?.characters, "Guardar");
		assert.equal(ctx.counters.components["Boton"], 1);
		assert.deepEqual(ctx.counters.matches, [
			{ node: ctx.counters.matches[0]?.node, set: "Boton", by: "rule:Boton" },
		]);
		// el contenedor y la instancia: los hijos capturados del botón no se pintan
		assert.equal(ctx.counters.nodes, 2);
	});

	it("la variante que no existe avisa VARIANT_NOT_FOUND y el nodo se pinta como marco", async () => {
		const { w } = setup();
		const rules = {
			Boton: { ...BUTTON.Boton, props: () => ({ variant: { size: "xl" } }) },
		};
		const { root, warnings } = await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(rules),
		);
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
		assert.ok(
			codes(warnings).includes("VARIANT_NOT_FOUND"),
			JSON.stringify(warnings),
		);
	});

	it("gana la primera regla que casa, en el orden del módulo", async () => {
		const { w, page: pg } = setup();
		w.fake.componentSet(pg, "Otro", [{ k: "a" }]);
		const rules = {
			Otro: {
				match: isButton,
				props: () => ({ variant: { k: "a" } }),
			},
			...BUTTON,
		};
		const { ctx } = await run(w, [page(button())], {}, {}, recognizer(rules));
		assert.deepEqual(Object.keys(ctx.counters.components), ["Otro"]);
	});

	it("plan.rules limita qué reglas se prueban en la pantalla", async () => {
		const { w, page: pg } = setup();
		w.fake.componentSet(pg, "Otro", [{ k: "a" }]);
		const rules = {
			Otro: { match: isButton, props: () => ({ variant: { k: "a" } }) },
			...BUTTON,
		};
		const { ctx } = await run(
			w,
			[page(button())],
			{ rules: ["Boton"] },
			{},
			recognizer(rules),
		);
		assert.deepEqual(Object.keys(ctx.counters.components), ["Boton"]);
	});

	it("una regla cuyo set no está en el archivo se salta y se avisa una vez con SET_NOT_FOUND", async () => {
		const { w } = setup();
		const rules = {
			Fantasma: { match: isButton, props: () => ({ variant: {} }) },
			...BUTTON,
		};
		const { ctx, warnings } = await run(
			w,
			[page(button(), button())],
			{},
			{},
			recognizer(rules),
		);
		assert.equal(ctx.counters.components["Boton"], 2);
		assert.equal(
			codes(warnings).filter((c) => c === "SET_NOT_FOUND").length,
			1,
		);
	});

	it("el `after` de la regla corre con la instancia y el `after` del set también", async () => {
		const { w } = setup();
		const seen: string[] = [];
		const rules = {
			Boton: {
				...BUTTON.Boton,
				props: (_n: Node, cls: Set<string>) => ({
					variant: sizeOf(cls),
					after: (i: FakeNode) => {
						seen.push(`regla:${i.type}`);
					},
				}),
			},
		};
		await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(rules, {
				after: {
					Boton: async (i: FakeNode, n: Node) => {
						seen.push(`set:${i.type}:${n.tag}`);
					},
				},
			}),
		);
		assert.deepEqual(seen, ["regla:INSTANCE", "set:INSTANCE:button"]);
	});

	it("una regla que lanza avisa RULE_ERROR con la regla y el nodo, retira la instancia a medias y pinta el nodo", async () => {
		const { w } = setup();
		const rules = {
			Boton: {
				...BUTTON.Boton,
				props: (_n: Node, cls: Set<string>) => ({
					variant: sizeOf(cls),
					after: () => {
						throw new Error("se rompió");
					},
				}),
			},
		};
		const before = w.fake.all.size;
		const { root, warnings } = await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(rules),
		);
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
		const warn = warnings.find((x) => x.code === "RULE_ERROR");
		assert.ok(warn);
		assert.match(warn.message, /Boton/);
		assert.match(warn.message, /se rompió/);
		assert.equal(
			w.fake.page("x").parent === w.fake.root,
			true,
			"sanity del doble",
		);
		// ninguna instancia suelta quedó en la página abierta
		assert.equal(
			w.page.children.filter((c) => c.type === "INSTANCE").length,
			0,
		);
		assert.ok(w.fake.all.size > before);
	});

	it("un `match` que lanza también es RULE_ERROR y la siguiente regla se prueba", async () => {
		const { w, page: pg } = setup();
		w.fake.componentSet(pg, "Roto", [{ k: "a" }]);
		const rules = {
			Roto: {
				match: () => {
					throw new Error("match roto");
				},
				props: () => ({ variant: {} }),
			},
			...BUTTON,
		};
		const { ctx, warnings } = await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(rules),
		);
		assert.ok(codes(warnings).includes("RULE_ERROR"));
		assert.equal(ctx.counters.components["Boton"], 1);
	});

	it("la instancia toma el ancho capturado si difiere de más de 1,5 px", async () => {
		const { w } = setup();
		const { root } = await run(
			w,
			[page(button({ w: 140 }))],
			{},
			{},
			recognizer(BUTTON),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.width, 140);
	});

	it("el borde que pone el contenedor y el átomo no trae se copia a la instancia", async () => {
		const { w } = setup();
		const { root } = await run(
			w,
			[
				page(
					button({
						bw: [1, 1, 1, 1],
						bc: [200, 0, 0, 1],
					}),
				),
			],
			{},
			{},
			recognizer(BUTTON),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.strokes.length, 1);
		assert.equal(inst.strokeAlign, "INSIDE");
	});

	it("un icono cambiado por INSTANCE_SWAP (trampa 23) llega con el color capturado: la instancia anidada es la del icono", async () => {
		const { w } = setup();
		const plus = icons(w.fake);
		const pg = w.fake.page("Con icono");
		const set = w.fake.componentSet(pg, "Chip", [{ k: "a" }]);
		const slotKey = set.addComponentProperty("Icono", "INSTANCE_SWAP", plus.id);
		const comp = set.children[0] as FakeNode;
		const nested = plus.createInstance();
		nested.name = "icons/plus";
		comp.appendChild(nested);
		nested.componentPropertyReferences = { mainComponent: slotKey };
		const other = w.fake.page("Iconos más");
		const minus = w.fake.node(other, "COMPONENT", "icons/minus");
		const mstroke = w.fake.node(minus, "VECTOR", "trazo");
		mstroke.strokes = [
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 },
		];
		w.fake.currentPage = w.page;
		const rules = {
			Chip: {
				match: (n: Node) => n.tag === "span",
				props: (
					_n: Node,
					_c: Set<string>,
					ctx: { icon(name: string): string | undefined },
				) => ({ variant: { k: "a" }, set: { Icono: ctx.icon("minus") } }),
			},
		};
		const { root } = await run(
			w,
			[
				page(
					frame({ tag: "span", w: 30, h: 30 }, [
						svg({ color: [255, 0, 0, 1], w: 16, h: 16 }),
					]),
				),
			],
			{ icons: {} },
			{},
			recognizer(rules),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		const swapped = inst
			.descendants()
			.find((d) => d.type === "INSTANCE" && d.name.startsWith("icons/"));
		assert.equal(swapped?.name, "icons/minus");
		// el color del svg capturado se repinta en los trazos del icono nuevo
		const stroke = swapped?.descendants().find((d) => d.strokes.length > 0);
		const paintedStroke = stroke?.strokes[0] as { color: { r: number } };
		assert.equal(paintedStroke.color.r, 1);
	});

	it("un INSTANCE_SWAP con un id que no es de un componente lanza (trampa 23) y sale como RULE_ERROR", async () => {
		const { w } = setup();
		const pg = w.fake.page("Con icono");
		const set = w.fake.componentSet(pg, "Chip", [{ k: "a" }]);
		set.addComponentProperty("Icono", "INSTANCE_SWAP", "1:1");
		w.fake.currentPage = w.page;
		const rules = {
			Chip: {
				match: (n: Node) => n.tag === "span",
				props: () => ({ variant: { k: "a" }, set: { Icono: "no-es-un-id" } }),
			},
		};
		const { root, warnings } = await run(
			w,
			[page(frame({ tag: "span", w: 30, h: 30 }, []))],
			{},
			{},
			recognizer(rules),
		);
		const failed = warnings.find((x) => x.code === "RULE_ERROR");
		assert.ok(failed);
		// medido en Figma real (trampa 23): un valor incompatible con el tipo de la propiedad lanza con este texto
		assert.match(
			failed.message,
			/Property value is incompatible with component property type/,
		);
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
	});

	it("`fit: none` deja la instancia como la dejó la regla: sin ancho capturado, borde ni marco de margen", async () => {
		const { w } = setup();
		const rules = {
			Boton: {
				...BUTTON.Boton,
				props: (_n: Node, cls: Set<string>) => ({
					variant: sizeOf(cls),
					fit: "none",
				}),
			},
		};
		const { root } = await run(
			w,
			[page(button({ w: 140, bw: [1, 1, 1, 1], bc: [1, 2, 3, 1] }))],
			{},
			{},
			recognizer(rules),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.width, 80);
		assert.equal(inst.strokes.length, 0);
	});

	it("`fit: height` iguala solo el alto de la fila: nunca envuelve la instancia en un marco", async () => {
		const { w } = setup();
		const rules = {
			Boton: {
				...BUTTON.Boton,
				props: (_n: Node, cls: Set<string>) => ({
					variant: sizeOf(cls),
					fit: "height",
				}),
			},
		};
		const { root } = await run(
			w,
			[page(button({ h: 60, pad: [8, 8, 8, 8] }))],
			{},
			{},
			recognizer(rules),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.height, 60);
	});

	it("un marco con relleno alrededor de un átomo que cabe con él: la instancia queda dentro de un marco con ese hueco", async () => {
		const { w } = setup();
		const { root } = await run(
			w,
			[page(button({ w: 96, h: 48, pad: [8, 8, 8, 8] }))],
			{},
			{},
			recognizer(BUTTON),
		);
		const wrap = root.children[0] as FakeNode;
		assert.equal(wrap.type, "FRAME");
		assert.equal(wrap.paddingTop, 8);
		assert.equal((wrap.children[0] as FakeNode).type, "INSTANCE");
	});

	it("las reglas también ven los svg y las imágenes (un logo de marca no es un marco)", async () => {
		const { w } = setup();
		const pg = w.fake.page("Logo");
		const set = w.fake.componentSet(pg, "Logo", [{ tipo: "completo" }]);
		for (const v of set.children) v.resize(100, 20);
		w.fake.currentPage = w.page;
		const rules = {
			Logo: {
				match: (n: { t: string; src?: string }) =>
					n.t === "img" && /logo\.svg$/.test(n.src ?? ""),
				props: (n: { h: number }) => ({
					variant: { tipo: "completo" },
					fit: "none",
					after: (i: FakeNode) => {
						i.rescale(n.h / i.height);
						i.name = "Logo";
					},
				}),
			},
		};
		const { root } = await run(
			w,
			[page(img("a".repeat(64), { src: "/static/logo.svg", h: 40, w: 200 }))],
			{
				images: {
					["a".repeat(64)]: { asset: "x", width: 1, height: 1, type: "png" },
				},
			},
			{},
			recognizer(rules),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.name, "Logo");
		assert.equal(inst.height, 40);
	});

	it("`ctx.defer(instancia, nodo)` pinta el nodo aparte y al acabar lo mete clonado en el hueco de la instancia", async () => {
		const { w } = setup();
		const pg = w.fake.page("Celda");
		const set = w.fake.componentSet(pg, "Celda", [{ k: "a" }]);
		(set.children[0] as FakeNode).createSlot();
		w.fake.currentPage = w.page;
		const rules = {
			Celda: {
				match: (n: Node) => n.tag === "td",
				props: (
					n: Node,
					_c: Set<string>,
					ctx: {
						defer(i: FakeNode, n: unknown): Promise<void>;
					},
				) => ({
					variant: { k: "a" },
					after: (i: FakeNode) =>
						ctx.defer(i, { ...n, tag: "div", cls: "dentro" }),
				}),
			},
		};
		const { root, ctx } = await run(
			w,
			[page(frame({ tag: "td", w: 100, h: 30 }, [text("Dentro")]))],
			{},
			{},
			recognizer(rules),
		);
		const inst = root.children[0] as FakeNode;
		const slot = inst.descendants().find((d) => d.type === "SLOT");
		assert.ok(slot);
		assert.equal(slot.children.length, 1);
		assert.equal((slot.children[0] as FakeNode).name, "contenido de la celda");
		// el marco pintado aparte ya no cuelga de la página: solo queda el clon
		assert.equal(
			w.page.children.filter((c) => c.name === "contenido de la celda").length,
			0,
		);
		assert.ok(ctx.counters.nodes >= 3);
	});

	it("una fuente del componente que no está en el archivo para el paso con FONT_MISSING: no es un fallo de la regla", async () => {
		const { w } = setup();
		w.fake.loadedFontsToLoad.delete("Inter/Regular");
		await assert.rejects(
			() => run(w, [page(button())], {}, {}, recognizer(BUTTON)),
			/FONT_MISSING/,
		);
	});

	it("el contexto da las raíces de la pantalla y la huella que casa con un nodo", async () => {
		const { w } = setup();
		let roots: unknown;
		let fp: unknown;
		const rules = {
			Boton: {
				match: (n: Node, _c: Set<string>, ctx: Record<string, unknown>) => {
					roots = ctx["roots"];
					fp = (ctx["fingerprintOf"] as (n: Node) => unknown)(n);
					return false;
				},
				props: () => ({ variant: {} }),
			},
		};
		const nodes = [page(button())];
		await run(
			w,
			nodes,
			{
				fingerprints: {
					b: { title: "Marca", tag: "button", cls: ["btn", "btn-sm"] },
				},
				generic: [],
			},
			{},
			recognizer(rules),
		);
		assert.equal((roots as unknown[]).length, 1);
		assert.deepEqual((fp as { key: string; title: string }).title, "Marca");
	});

	it("el `after` del set se encuentra sin distinguir mayúsculas del nombre", async () => {
		const { w } = setup();
		const seen: string[] = [];
		await run(
			w,
			[page(button())],
			{},
			{},
			recognizer(BUTTON, {
				after: {
					BOTON: () => {
						seen.push("ok");
					},
				},
			}),
		);
		assert.deepEqual(seen, ["ok"]);
	});

	it("el contenido diferido en un hueco sin auto-layout no puede ocupar todo el ancho (trampa 25, medida): avisa LAYOUT_PROP y queda dentro", async () => {
		const { w } = setup();
		const pg = w.fake.page("Celda");
		const set = w.fake.componentSet(pg, "Celda", [{ k: "a" }]);
		(set.children[0] as FakeNode).createSlot();
		w.fake.currentPage = w.page;
		const rules = {
			Celda: {
				match: (n: Node) => n.tag === "td",
				props: (
					n: Node,
					_c: Set<string>,
					ctx: { defer(i: FakeNode, n: unknown): Promise<void> },
				) => ({
					variant: { k: "a" },
					after: (i: FakeNode) => ctx.defer(i, { ...n, tag: "div" }),
				}),
			},
		};
		const { root, warnings } = await run(
			w,
			[page(frame({ tag: "td", w: 100, h: 30 }, [text("Dentro")]))],
			{},
			{},
			recognizer(rules),
		);
		const slot = (root.children[0] as FakeNode)
			.descendants()
			.find((d) => d.type === "SLOT");
		assert.equal(slot?.children.length, 1);
		assert.ok(codes(warnings).includes("LAYOUT_PROP"));
	});

	it("un módulo que no cumple la forma para el paso con RECOGNIZE_INVALID antes de pintar nada", async () => {
		const { w } = setup();
		const bad: unknown[] = [
			{},
			{ contract: "recognize@2", rules: {} },
			{ contract: "recognize@1" },
			{ contract: "recognize@1", rules: { X: { match: 1, props: () => 1 } } },
			{ contract: "recognize@1", rules: { X: { match: () => 1 } } },
			"un texto",
			{ contract: "recognize@1", rules: {}, after: { X: 3 } },
		];
		for (const module of bad) {
			const before = w.page.children.length;
			await assert.rejects(
				() => paint(w, [page(button())], {}, {}, module),
				/RECOGNIZE_INVALID/,
			);
			assert.equal(w.page.children.length, before);
		}
	});

	it("sin módulo (null) todo se pinta como antes y no hay coincidencias", async () => {
		const { w } = setup();
		const { root, ctx } = await run(w, [page(button())], {}, {}, null);
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
		assert.deepEqual(ctx.counters.matches, []);
	});
});
