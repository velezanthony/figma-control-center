// El aspecto de un marco, las imágenes y los svg. Trampas 1 y 2 (medidas); 16, 17, 18, 19, 20,
// 21 y 24 (sin verificar: las cierra `make kit-contract`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { png as pngBytes } from "../areas-support.ts";
import { frame, icons, img, paint, svg, world } from "../screen-support.ts";

type Paints = {
	type: string;
	opacity?: number;
	imageHash?: string;
	scaleMode?: string;
	gradientTransform?: number[][];
	gradientStops?: unknown[];
	boundVariables?: { color?: { id: string } };
}[];

const fillsOf = (n: { fills?: unknown } | undefined | null) =>
	(n?.fills ?? []) as Paints;

describe("pintor: aspecto de un marco", () => {
	it("el fondo se liga a la variable de su clase y conserva el alfa (trampas 1 y 2)", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame({ cls: "bg-brand-500", bg: [255, 102, 0, 0.5] }),
		]);
		const fills = root.fills as Paints;
		assert.equal(
			fills[0]?.boundVariables?.color?.id,
			w.variable("brand/500").id,
		);
		assert.equal(fills[0]?.opacity, 0.5);
	});

	it("sin fondo no hay relleno; el overflow auto recorta y da dirección de desplazamiento", async () => {
		const w = world();
		const a = await paint(w, [frame({ ov: "hidden auto" })]);
		assert.deepEqual(a.root.fills, []);
		assert.equal(a.root.clipsContent, true);
		assert.equal(a.root.overflowDirection, "VERTICAL");
		const b = await paint(w, [frame({ ov: "auto" })]);
		assert.equal(b.root.overflowDirection, "BOTH");
		const c = await paint(w, [frame({ ov: "hidden" })]);
		assert.equal(c.root.clipsContent, true);
		assert.equal(c.root.overflowDirection, "NONE");
	});

	it("un degradado lineal y uno radial se añaden al relleno con su transformación (trampa 18, sin verificar)", async () => {
		const w = world();
		const { root } = await paint(w, [
			frame({
				grad: {
					angle: 90,
					stops: [
						{ c: [0, 0, 0, 1], p: 0 },
						{ c: [255, 255, 255, 1], p: 1 },
					],
				},
			}),
		]);
		const [g] = root.fills as Paints;
		assert.equal(g?.type, "GRADIENT_LINEAR");
		assert.equal(g?.gradientTransform?.length, 2);
		assert.equal(g?.gradientStops?.length, 2);
		const radial = await paint(w, [
			frame({ grad: { radial: true, stops: [{ c: [0, 0, 0, 1], p: 0 }] } }),
		]);
		assert.equal((radial.root.fills as Paints)[0]?.type, "GRADIENT_RADIAL");
	});

	it("el borde se pinta por dentro: igual en los cuatro lados o por lado (trampa 16, sin verificar)", async () => {
		const w = world();
		const same = await paint(w, [
			frame({ bw: [2, 2, 2, 2], bc: [17, 24, 39, 1], cls: "border-gray-900" }),
		]);
		assert.equal(same.root.strokeAlign, "INSIDE");
		assert.equal(same.root.strokeWeight, 2);
		assert.equal(
			(same.root.strokes as Paints)[0]?.boundVariables?.color?.id,
			w.variable("gray/900").id,
		);
		const sides = await paint(w, [
			frame({ bw: [1, 2, 3, 4], bc: [17, 24, 39, 1] }),
		]);
		assert.deepEqual(
			[
				sides.root.strokeTopWeight,
				sides.root.strokeRightWeight,
				sides.root.strokeBottomWeight,
				sides.root.strokeLeftWeight,
			],
			[1, 2, 3, 4],
		);
	});

	it("los radios iguales se ligan a la variable por valor; 9999 a la del radio completo (trampas 17 y 24, sin verificar)", async () => {
		const w = world();
		const a = await paint(w, [frame({ rad: [8, 8, 8, 8] })]);
		assert.equal(a.root.cornerRadius, 8);
		assert.equal(
			a.root.boundVariables["topLeftRadius"]?.id,
			w.variable("radius/lg").id,
		);
		const full = await paint(w, [frame({ rad: [9999, 9999, 9999, 9999] })]);
		assert.equal(
			full.root.boundVariables["topLeftRadius"]?.id,
			w.variable("radius/full").id,
		);
		const mixed = await paint(w, [frame({ rad: [4, 0, 4, 0] })]);
		assert.deepEqual(
			[
				mixed.root.topLeftRadius,
				mixed.root.topRightRadius,
				mixed.root.bottomRightRadius,
				mixed.root.bottomLeftRadius,
			],
			[4, 0, 4, 0],
		);
		assert.deepEqual(mixed.root.boundVariables, {});
	});

	it("la opacidad del nodo se escribe solo si es menor que 1", async () => {
		const w = world();
		assert.equal((await paint(w, [frame({ op: 0.4 })])).root.opacity, 0.4);
		assert.equal((await paint(w, [frame({ op: 1 })])).root.opacity, 1);
	});

	it("la sombra usa el estilo de efecto de su clase si se ve; si no, capas sueltas y la primera queda debajo (trampa 19, sin verificar)", async () => {
		const w = world();
		const style = w.fake.effectStyle("shadow-md");
		const shadow = { c: [0, 0, 0, 0.2], x: 0, y: 2, b: 6, s: -1, inset: false };
		const named = await paint(w, [frame({ cls: "shadow-md", shs: [shadow] })]);
		assert.equal(named.root.effectStyleId, style.id);
		const loose = await paint(w, [
			frame({
				cls: "",
				shs: [
					shadow,
					{ ...shadow, inset: true, y: 4 },
					{ ...shadow, c: [0, 0, 0, 0] },
				],
			}),
		]);
		const effects = loose.root.effects as {
			type: string;
			spread: number;
			offset: { y: number };
		}[];
		assert.deepEqual(
			effects.map((e) => e.type),
			["INNER_SHADOW", "DROP_SHADOW"],
		);
		assert.equal(effects[1]?.spread, -1);
		// una clase de sombra cuya sombra calculada es transparente no gana
		const hidden = await paint(w, [
			frame({ cls: "shadow-md", shs: [{ ...shadow, c: [0, 0, 0, 0] }] }),
		]);
		assert.equal(hidden.root.effectStyleId, "");
		assert.deepEqual(hidden.root.effects, []);
	});
});

describe("pintor: imágenes", () => {
	const REF = "a".repeat(64);
	const BIG = "b".repeat(64);
	const images = {
		[REF]: { asset: REF, width: 40, height: 20, type: "png" },
		[BIG]: {
			asset: BIG,
			width: 5000,
			height: 20,
			type: "jpeg",
			tooLarge: true,
		},
	};
	const wrap = (...kids: unknown[]) => frame({ disp: "flex" }, kids);

	it("un rectángulo con la imagen como relleno: FILL, o FIT con contain; con radios y opacidad", async () => {
		const w = world();
		const { root } = await paint(
			w,
			[
				wrap(
					img(REF, { rad: [4, 4, 4, 4], op: 0.5 }),
					img(REF, { fit: "contain" }),
				),
			],
			{ images },
			{ [REF]: pngBytes(40, 20) },
		);
		const [a, b] = root.children;
		assert.equal(a?.name, "imagen");
		assert.equal(fillsOf(a)[0]?.scaleMode, "FILL");
		assert.equal(fillsOf(b)[0]?.scaleMode, "FIT");
		assert.equal(a?.topLeftRadius, 4);
		assert.equal(a?.opacity, 0.5);
	});

	it("mismos bytes, mismo hash (trampa 20, sin verificar): la imagen se crea una vez por referencia", async () => {
		const w = world();
		const { root } = await paint(
			w,
			[wrap(img(REF), img(REF))],
			{ images },
			{ [REF]: pngBytes(40, 20) },
		);
		const [a, b] = root.children;
		assert.equal(fillsOf(a)[0]?.imageHash, fillsOf(b)[0]?.imageHash);
		const direct = w.fake.createImage(pngBytes(40, 20)).hash;
		assert.equal(direct, fillsOf(a)[0]?.imageHash);
	});

	it("trampa 5 (medida): una imagen de más de 4096 px sale como rectángulo sin imagen y con aviso; nunca para el paso", async () => {
		const w = world();
		const t = w.kit.track();
		const { root } = await paint(
			w,
			[wrap(img(BIG))],
			{ images },
			{ [BIG]: pngBytes(5000, 20) },
		);
		const rect = root.children[0];
		assert.deepEqual(rect?.fills, []);
		assert.ok(t.done().warnings?.some((x) => x.code === "IMAGE_TOO_LARGE"));
		// sin el kit, createImage lanza
		assert.throws(() => w.fake.createImage(pngBytes(5000, 20)), /too large/);
	});

	it("una imagen sin asset avisa IMAGE_MISSING y deja el rectángulo", async () => {
		const w = world();
		const t = w.kit.track();
		const { root } = await paint(w, [wrap(img(REF))], { images }, {});
		assert.equal(root.children[0]?.name, "imagen");
		assert.ok(t.done().warnings?.some((x) => x.code === "IMAGE_MISSING"));
	});
});

describe("pintor: svg e iconos", () => {
	const PLAN_ICON = { "M0 0L1 1": "plus" };

	it("un svg con icono en el catálogo es una instancia de su componente, a su ancho y con los trazos repintados", async () => {
		const w = world();
		icons(w.fake);
		const { root } = await paint(
			w,
			[
				frame({ disp: "flex", cls: "text-text-primary" }, [
					svg({ cls: "", w: 48 }),
				]),
			],
			{ icons: PLAN_ICON },
		);
		const inst = root.children[0];
		assert.equal(inst?.type, "INSTANCE");
		assert.equal(inst?.width, 48);
		const stroke = inst?.children[0]?.strokes as Paints;
		assert.equal(
			stroke[0]?.boundVariables?.color?.id,
			w.variable("text/primary").id,
		);
	});

	it("sin icono, createNodeFromSvg: se llama «svg», sin relleno y repintado con la variable (trampa 21, sin verificar)", async () => {
		const w = world();
		icons(w.fake);
		const node = svg({
			svg: '<svg><path stroke="#111827" d="M9 9"/></svg>',
			key: "M9 9",
			cls: "",
		});
		const { root } = await paint(w, [frame({ disp: "flex" }, [node])]);
		const out = root.children[0];
		assert.equal(out?.name, "svg");
		assert.deepEqual(out?.fills, []);
		const vector = out?.children[0]?.strokes as Paints;
		assert.ok(vector[0]?.boundVariables?.color);
	});

	it("un svg que gira se llama «spinner»; un icono (t: icon) por su nombre; el que falta avisa ICON_MISSING", async () => {
		const w = world();
		icons(w.fake);
		const t = w.kit.track();
		const kids = [
			svg({ spin: true, key: "otro", svg: "<svg></svg>" }),
			{
				id: "99999999",
				path: "0",
				t: "icon",
				name: "plus",
				x: 0,
				y: 0,
				w: 24,
				h: 24,
			},
			{
				id: "99999998",
				path: "0",
				t: "icon",
				name: "nada",
				x: 0,
				y: 0,
				w: 24,
				h: 24,
			},
		];
		const { root } = await paint(w, [frame({ disp: "flex" }, kids)]);
		assert.equal(root.children[0]?.name, "spinner");
		assert.equal(root.children[1]?.type, "INSTANCE");
		assert.equal(root.children[2]?.type, "FRAME");
		assert.ok(t.done().warnings?.some((x) => x.code === "ICON_MISSING"));
	});
});
