// Disposición, correcciones medidas y raíces del pintor. Trampas 13, 14 y 15 (sin verificar).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCtx } from "../../../../../kits/figma/screen/ctx.ts";
import {
	fixPositions,
	growForAbsolutes,
} from "../../../../../kits/figma/screen/fix-positions.ts";
import {
	absolute,
	childProp,
} from "../../../../../kits/figma/screen/layout.ts";
import {
	frame,
	paint,
	planOf,
	styles,
	svg,
	text,
	world,
} from "../screen-support.ts";

type K = Record<string, unknown>;
const box = (extra: K = {}, kids: unknown[] = []) =>
	frame({ w: 50, h: 20, kids, ...extra }, kids);

describe("pintor: disposición", () => {
	it("flex en fila: layoutMode, separación, alineaciones y el borde se cuenta en el layout", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame(
				{
					disp: "flex",
					dir: "row",
					gap: 8,
					jc: "space-between",
					ai: "center",
					w: 200,
					h: 40,
					pad: [4, 8, 4, 8],
				},
				[box({ x: 8, y: 4 }), box({ x: 142, y: 4 })],
			),
		]);
		assert.equal(root.layoutMode, "HORIZONTAL");
		assert.equal(root.itemSpacing, 8);
		assert.equal(root.primaryAxisAlignItems, "SPACE_BETWEEN");
		assert.equal(root.counterAxisAlignItems, "CENTER");
		assert.equal(root.strokesIncludedInLayout, true);
		assert.deepEqual(
			[
				root.paddingTop,
				root.paddingRight,
				root.paddingBottom,
				root.paddingLeft,
			],
			[4, 8, 4, 8],
		);
	});

	it("flex en columna es vertical y el relleno o la separación que coincide con una variable numérica se liga", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame(
				{
					disp: "flex",
					dir: "column",
					rgap: 16,
					pad: [16, 0, 0, 0],
					w: 100,
					h: 100,
				},
				[box({ y: 16 }), box({ y: 52 })],
			),
		]);
		assert.equal(root.layoutMode, "VERTICAL");
		assert.equal(root.itemSpacing, 16);
		assert.equal(
			root.boundVariables["itemSpacing"]?.id,
			w.variable("spacing/4").id,
		);
		assert.equal(
			root.boundVariables["paddingTop"]?.id,
			w.variable("spacing/4").id,
		);
	});

	it("un borde transparente no se pinta pero ocupa sitio: se suma al relleno y no se liga a ninguna variable", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame(
				{ disp: "flex", bw: [2, 2, 2, 2], bc: null, pad: [14, 14, 14, 14] },
				[box({ x: 16, y: 16 })],
			),
		]);
		assert.equal(root.paddingTop, 16);
		assert.equal(root.boundVariables["paddingTop"], undefined);
		assert.deepEqual(root.strokes, []);
	});

	it("flujo normal: los márgenes entre hermanos pasan a itemSpacing (el menor hueco); inline va en fila", async () => {
		const w = world();
		const block = await paint(w, [
			frame({ disp: "block", w: 100, h: 100 }, [
				box({ y: 0, w: 100 }),
				box({ y: 30, w: 100 }),
				box({ y: 70, w: 100 }),
			]),
		]);
		assert.equal(block.root.layoutMode, "VERTICAL");
		assert.equal(block.root.itemSpacing, 10);
		const inline = await paint(w, [
			frame({ disp: "block", w: 120, h: 20 }, [
				box({ x: 0, disp: "inline-block" }),
				box({ x: 60, disp: "inline-block" }),
			]),
		]);
		assert.equal(inline.root.layoutMode, "HORIZONTAL");
	});

	it("filas y celdas de tabla: las filas estiran a sus celdas, los grupos van en vertical y la celda se centra", async () => {
		const w = world();
		const cell = (x: number) =>
			frame({ disp: "table-cell", x, y: 0, w: 50, h: 30, va: "middle" }, [
				text("c", { x, y: 5 }),
			]);
		const row = frame({ disp: "table-row", w: 100, h: 30, y: 0 }, [
			cell(0),
			cell(50),
		]);
		const { root } = await paint(w, [
			frame({ disp: "table", w: 100, h: 30 }, [row]),
		]);
		assert.equal(root.layoutMode, "VERTICAL");
		const r = root.children[0];
		assert.equal(r?.layoutMode, "HORIZONTAL");
		assert.equal(r?.layoutAlign, "STRETCH");
		assert.equal(r?.children[0]?.counterAxisAlignItems, "CENTER");
		assert.equal(r?.children[0]?.layoutAlign, "STRETCH");
	});

	it("rejilla: fila con salto a ancho fijo; las columnas iguales se igualan con su holgura de 0,5", async () => {
		const w = world();
		const cells = [0, 1, 2, 3].map((i) =>
			box({ x: (i % 2) * 100, y: Math.floor(i / 2) * 50, w: 100, h: 50 }),
		);
		const { root } = await paint(w, [
			frame({ disp: "grid", gap: 0, rgap: 0, w: 200, h: 100 }, cells),
		]);
		assert.equal(root.layoutWrap, "WRAP");
		assert.equal(root.primaryAxisSizingMode, "FIXED");
		assert.equal(root.width, 201);
		assert.deepEqual(
			root.children.map((c) => c.width),
			[99.5, 99.5, 99.5, 99.5],
		);
		const oneRow = await paint(w, [
			frame({ disp: "grid", w: 200, h: 50 }, [
				box({ x: 0, w: 100 }),
				box({ x: 100, w: 100 }),
			]),
		]);
		assert.equal(oneRow.root.layoutWrap, "NO_WRAP");
	});

	it("tamaño fijo solo con alto explícito (clase h-*) o sin contenido; si no, abraza su contenido", async () => {
		const w = world();
		styles(w.fake);
		const hug = await paint(w, [
			frame({ disp: "flex", w: 100, h: 60 }, [text("hola", { w: 30, h: 20 })]),
		]);
		assert.equal(hug.root.counterAxisSizingMode, "AUTO");
		const fixed = await paint(w, [
			frame({ disp: "flex", cls: "h-16", w: 100, h: 64 }, [
				box({ w: 30, h: 20 }),
			]),
		]);
		assert.equal(fixed.root.counterAxisSizingMode, "FIXED");
		assert.equal(fixed.root.height, 64);
		const empty = await paint(w, [frame({ w: 30, h: 12 })]);
		assert.equal(empty.root.width, 30);
		assert.equal(empty.root.height, 12);
	});

	it("flex-1 crece, una pareja de hermanos se estira en el eje cruzado y un hijo absoluto sale del flujo con sus anclas", async () => {
		const w = world();
		const grow = await paint(w, [
			frame({ disp: "flex", dir: "row", ai: "stretch", w: 200, h: 40 }, [
				box({ fg: 1, w: 100, h: 40, x: 0 }, [text("x")]),
				box({ w: 50, h: 40, x: 100 }),
			]),
		]);
		assert.equal(grow.root.children[0]?.layoutGrow, 1);
		const abs = await paint(w, [
			frame({ disp: "flex", w: 100, h: 40 }, [
				box({ x: 0 }),
				box({ pos: "absolute", x: 80, y: 0, w: 20, h: 20 }),
			]),
		]);
		const out = abs.root.children[1];
		assert.equal(out?.layoutPositioning, "ABSOLUTE");
		assert.deepEqual(out?.constraints, { horizontal: "MAX", vertical: "MIN" });
	});

	it("el ancla no estira si el padre mide 0; con padre normal, el hijo a tamaño completo sí se estira y el pequeño se ancla por posición", async () => {
		const w = world();
		const anchors = async (parentH: number, kid: K) => {
			const { root } = await paint(w, [
				frame({ disp: "flex", w: 390, h: parentH }, [
					box({ pos: "fixed", ...kid }),
				]),
			]);
			return root.children[0]?.constraints;
		};
		assert.deepEqual(await anchors(0, { x: 16, y: 16, w: 36, h: 36 }), {
			horizontal: "MIN",
			vertical: "MIN",
		});
		assert.deepEqual(await anchors(100, { x: 0, y: 0, w: 390, h: 100 }), {
			horizontal: "STRETCH",
			vertical: "STRETCH",
		});
		assert.deepEqual(await anchors(100, { x: 350, y: 10, w: 36, h: 36 }), {
			horizontal: "MAX",
			vertical: "MIN",
		});
	});

	it("el orden de pintado: lo absoluto va encima de lo estático y un z-index negativo, debajo de todo", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame({ disp: "flex", w: 100, h: 40 }, [
				box({ pos: "absolute", x: 0, y: 0, name: "a" }),
				box({ x: 0 }),
				box({ cls: "-z-10", pos: "absolute", x: 0, y: 0 }),
			]),
		]);
		assert.equal(root.children[0]?.layoutPositioning, "ABSOLUTE");
		assert.equal(root.children.length, 3);
	});

	it("trampa 13 (medida): layoutGrow y layoutAlign en un hijo de un marco sin auto-layout no lanzan; el tamaño FILL sí; el pintor solo pone FILL con padre auto-layout", async () => {
		const w = world();
		const parent = w.fake.createFrame();
		const child = w.fake.node(parent, "FRAME", "hijo");
		assert.doesNotThrow(() => {
			child.layoutGrow = 1;
			child.layoutAlign = "STRETCH";
		});
		assert.throws(() => {
			child.layoutSizingHorizontal = "FILL";
		}, /auto-layout/);
		// el pintor no avisa por layoutGrow: Figma lo acepta
		const ctx = await createCtx(planOf() as never, {});
		const t = w.kit.track();
		const other = w.fake.node(parent, "FRAME", "otro");
		childProp(ctx, parent as never, other as never, "layoutGrow", 1);
		assert.equal(other.layoutGrow, 1);
		assert.equal(t.done().warnings, undefined);
	});

	it("trampa 15 (sin verificar): ABSOLUTE solo vale dentro de auto-layout; si no, aviso y el hijo se queda donde está", async () => {
		const w = world();
		const parent = w.fake.createFrame();
		const child = w.fake.node(parent, "FRAME", "hijo");
		assert.throws(() => {
			child.layoutPositioning = "ABSOLUTE";
		}, /without auto-layout/);
		const ctx = await createCtx(planOf() as never, {});
		const t = w.kit.track();
		absolute(ctx, parent as never, child as never, { x: 5, y: 6 } as never);
		assert.equal(child.layoutPositioning, "AUTO");
		assert.ok(t.done().warnings?.some((x) => x.code === "LAYOUT_PROP"));
	});
});

// Las correcciones se prueban sobre un marco ya hecho, con las posiciones que Figma dejó (el doble apila los hijos)
async function setup(
	kids: { w: number; x: number; y?: number; extra?: K }[],
	over: K = {},
) {
	const w = world();
	const ctx = await createCtx(planOf() as never, {});
	const f = w.fake.createFrame();
	f.layoutMode = "HORIZONTAL";
	const plan: K[] = [];
	const nodes = kids.map((k) => {
		const c = w.fake.node(f, "FRAME", "hijo");
		c.resize(k.w, 20);
		const pk = {
			id: "1",
			path: "0",
			t: "frame",
			w: k.w,
			h: 20,
			x: k.x,
			y: k.y ?? 0,
			kids: [{}],
			...k.extra,
		};
		plan.push(pk);
		ctx.km.set(c as never, pk as never);
		return c;
	});
	return { w, ctx, f, nodes, plan, n: { w: 400, h: 20, ...over } };
}

describe("pintor: correcciones medidas en Figma", () => {
	it("un hijo a más de 1,5 px de su sitio pero hacia delante se envuelve en un marco «margen» con ese padding", async () => {
		const s = await setup([
			{ w: 50, x: 0 },
			{ w: 50, x: 70 },
		]);
		const moved = fixPositions(s.ctx, s.f as never, s.n as never, [], false);
		assert.equal(moved, 0);
		const wrapper = s.f.children[1];
		assert.equal(wrapper?.name, "margen");
		assert.equal(wrapper?.paddingLeft, 20);
		assert.equal(wrapper?.children[0], s.nodes[1]);
		assert.equal(s.ctx.counters.wrapped.length, 1);
	});

	it("la tolerancia es de 1,5 px (3 tras un texto): dentro de ella no se toca nada", async () => {
		const s = await setup([
			{ w: 50, x: 0 },
			{ w: 50, x: 51 },
		]);
		fixPositions(s.ctx, s.f as never, s.n as never, [], false);
		assert.equal(s.f.children.length, 2);
		assert.equal(s.f.children[1], s.nodes[1]);
		// 5 px ya es más que la tolerancia
		const over = await setup([
			{ w: 50, x: 0 },
			{ w: 50, x: 55 },
		]);
		fixPositions(over.ctx, over.f as never, over.n as never, [], false);
		assert.equal(over.f.children[1]?.name, "margen");
		const afterOver = await setup([
			{ w: 50, x: 0, extra: { t: "text" } },
			{ w: 50, x: 54 },
		]);
		fixPositions(
			afterOver.ctx,
			afterOver.f as never,
			afterOver.n as never,
			[],
			false,
		);
		assert.equal(afterOver.f.children[1]?.name, "margen");
		const after = await setup([
			{ w: 50, x: 0, extra: { t: "text" } },
			{ w: 50, x: 52.5 },
		]);
		fixPositions(after.ctx, after.f as never, after.n as never, [], false);
		assert.equal(after.f.children.length, 2);
	});

	it("un hijo que cae a más de 4 px hacia atrás se saca del flujo como absoluto, con sus anclas, y el marco queda fijo", async () => {
		const s = await setup([
			{ w: 50, x: 0 },
			{ w: 50, x: 30, y: 0 },
		]);
		const anchors: [unknown, unknown][] = [];
		const moved = fixPositions(
			s.ctx,
			s.f as never,
			s.n as never,
			anchors as never,
			false,
		);
		assert.equal(moved, 1);
		assert.equal(s.nodes[1]?.layoutPositioning, "ABSOLUTE");
		assert.equal(anchors.length, 1);
		assert.equal(s.f.primaryAxisSizingMode, "FIXED");
		assert.equal(s.ctx.counters.moved.length, 1);
	});

	it("un contenedor transparente con un hijo absoluto que desborda crece para incluirlo; dentro de un recorte no se desplaza", async () => {
		const w = world();
		const ctx = await createCtx(planOf() as never, {});
		const f = w.fake.createFrame();
		f.layoutMode = "HORIZONTAL";
		f.resize(100, 40);
		const abs = w.fake.node(f, "FRAME", "panel");
		abs.layoutPositioning = "ABSOLUTE";
		abs.x = -10;
		const k = { t: "frame", pos: "absolute", x: -10, y: 0, w: 150, h: 60 };
		const n = { w: 100, h: 40, bg: null, bw: [0, 0, 0, 0] };
		growForAbsolutes(ctx, f as never, n as never, [k] as never);
		assert.equal(f.paddingLeft, 10);
		assert.equal(abs.x, 0);
		assert.equal(f.primaryAxisSizingMode, "FIXED");
		assert.ok(f.width >= 150);
		assert.equal(f.height, 60);
		const clipped = w.fake.createFrame();
		clipped.layoutMode = "HORIZONTAL";
		ctx.clip = 1;
		growForAbsolutes(
			ctx,
			clipped as never,
			{ ...n } as never,
			[{ ...k, x: -10 }] as never,
		);
		assert.equal(clipped.paddingLeft, 0);
	});

	it("un botón de bloque con texto de una línea que se envuelve en «margen» conserva su alto (medido: crecía a los 100 del envoltorio recién creado)", async () => {
		const w = world();
		w.fake.hugLayout = true;
		styles(w.fake);
		const label = "Me gustaría recibir más información";
		const button = frame(
			{
				tag: "button",
				cls: "w-full",
				y: 72,
				w: 384,
				h: 48,
				pad: [14, 20, 14, 20],
			},
			[
				frame({ tag: "span", disp: "inline", x: 20, y: 86, w: 294, h: 20 }, [
					text(label, { x: 20, y: 86, w: 294 }),
				]),
			],
		);
		const form = frame({ tag: "form", w: 384, h: 120 }, [
			frame({ y: 0, w: 384, h: 20 }, [text("Nombre", { w: 384 })]),
			frame({ y: 32, w: 384, h: 20 }, [text("Email", { y: 32, w: 384 })]),
			button,
		]);
		const { root } = await paint(w, [form]);
		const wrapper = root.findOne((n) => n.name === "margen");
		assert.ok(
			wrapper,
			"el botón cae 8 px más abajo que el hueco del formulario",
		);
		const merged = root.findOne((n) => n.name === "texto enriquecido");
		const painted = merged?.parent;
		assert.equal(painted?.parent, wrapper);
		assert.equal(painted?.height, 48);
		assert.equal(merged?.textAutoResize, "HEIGHT");
		assert.equal(wrapper?.height, 56);
	});
});

describe("pintor: las raíces de la pantalla", () => {
	it("una sola raíz que es un marco es el propio marco de la pantalla", async () => {
		const w = world();
		const { root, plan } = await paint(w, [
			frame({ disp: "flex", w: 300, h: 50 }),
		]);
		assert.equal(root.type, "FRAME");
		assert.equal(root.parent, w.page);
		assert.equal((plan as { root: unknown[] }).root.length, 1);
	});

	it("una sola raíz que es un svg va dentro de un marco horizontal que se ajusta", async () => {
		const w = world();
		const { root } = await paint(w, [svg({ key: "otro" })]);
		assert.equal(root.layoutMode, "HORIZONTAL");
		assert.equal(root.children.length, 1);
	});

	it("varias raíces apiladas: un marco vertical con el fondo de map@1, lo sticky y lo fixed fijados (trampa 14, sin verificar)", async () => {
		const w = world();
		const t = w.kit.track();
		const header = frame(
			{ tag: "header", pos: "sticky", x: 0, y: 0, w: 800, h: 60 },
			[text("cabecera")],
		);
		const main = frame({ tag: "main", x: 0, y: 60, w: 800, h: 200 }, [
			text("contenido"),
		]);
		const modal = frame(
			{ tag: "div", pos: "fixed", x: 100, y: 80, w: 200, h: 100 },
			[text("modal")],
		);
		const { root } = await paint(w, [header, main, modal]);
		assert.equal(root.layoutMode, "VERTICAL");
		assert.equal(root.counterAxisSizingMode, "FIXED");
		assert.equal(root.clipsContent, true);
		const fills = root.fills as {
			boundVariables?: { color?: { id: string } };
		}[];
		assert.equal(fills[0]?.boundVariables?.color?.id, w.variable("gray/50").id);
		assert.deepEqual(
			root.children.map((c) => c.layoutAlign ?? ""),
			["STRETCH", "STRETCH", "INHERIT"],
		);
		assert.equal(root.children[2]?.layoutPositioning, "ABSOLUTE");
		// el doble NO conserva scrollBehavior en un hijo de auto-layout: el kit lo dice en vez de tragárselo
		assert.ok(t.done().warnings?.some((x) => x.code === "SCROLL_BEHAVIOR"));
	});

	it("sin `screen.background` el marco apilado queda sin relleno; con una variable que no existe, aviso", async () => {
		const w = world();
		const none = await paint(
			w,
			[frame({ y: 0, w: 100, h: 10 }), frame({ y: 10, w: 100, h: 10 })],
			{
				map: { ...(planOf()["map"] as object), screen: undefined },
			},
		);
		assert.deepEqual(none.root.fills, []);
		const t = w.kit.track();
		await paint(
			w,
			[frame({ y: 0, w: 100, h: 10 }), frame({ y: 10, w: 100, h: 10 })],
			{
				map: {
					...(planOf()["map"] as object),
					screen: { background: "no/existe" },
				},
			},
		);
		assert.ok(
			t.done().warnings?.some((x) => x.code === "BACKGROUND_NOT_FOUND"),
		);
	});

	it("un botón en flujo más un overlay fixed a pantalla completa: la raíz abarca el overlay, sin hug ni recorte", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame({ tag: "div", x: 0, y: 0, w: 218, h: 44 }, [text("abrir")]),
			frame({ tag: "div", pos: "fixed", x: 0, y: 0, w: 1024, h: 768 }, [
				text("modal"),
			]),
		]);
		assert.equal(root.layoutMode, "NONE");
		assert.equal(root.clipsContent, false);
		assert.equal(root.width, 1024);
		assert.equal(root.height, 768);
	});

	it("un solo nodo en flujo no es una página apilada; dos o más sin fixed sí lo siguen siendo", async () => {
		const w = world();
		const stack = await paint(w, [
			frame({ x: 0, y: 0, w: 100, h: 10 }),
			frame({ x: 0, y: 10, w: 100, h: 10 }),
		]);
		assert.equal(stack.root.layoutMode, "VERTICAL");
		assert.equal(stack.root.clipsContent, true);
	});

	it("raíces sueltas que no se apilan: cada una en su posición real dentro de un marco que las abarca", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame({ x: 10, y: 10, w: 50, h: 20 }),
			frame({ x: 100, y: 40, w: 30, h: 30 }),
		]);
		assert.equal(root.width, 120);
		assert.equal(root.height, 60);
		assert.deepEqual(
			root.children.map((c) => [c.x, c.y]),
			[
				[0, 0],
				[90, 30],
			],
		);
	});
});
