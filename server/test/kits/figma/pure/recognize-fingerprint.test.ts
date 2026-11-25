// Huellas: `fpMatch` y `fpInstance`. Un test por
// regla de `fpMatch` (etiqueta y clases, firma que siempre está, raíz genérica, firma condicional, puntuación, profundidad,
// clases genéricas) y los de la instancia: variante por votos de clases, valores por defecto, alias, textos emparejados por
// texto, tamaño y peso, «Mostrar…» sin pareja, anidadas, niveles numéricos, estado cerrado, icono por swap y tamaño.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	fpMatch,
	genericMatcher,
} from "../../../../../kits/figma/recognize/fingerprint.ts";
import type { Fingerprint } from "../../../../../kits/figma/screen/types.ts";
import type { FakeFigma, FakeNode } from "../fake-figma.ts";
import {
	FONT,
	frame,
	icons,
	paint,
	recognizer,
	SANS,
	styles,
	svg,
	text,
	world,
} from "../screen-support.ts";

const generic = genericMatcher(["flex", "items-\\S+", "gap-\\S+"]);
const fp = (extra: Partial<Fingerprint> = {}): Fingerprint => ({
	title: "Tarjeta",
	tag: "div",
	cls: ["rounded-xl", "border", "bg-white"],
	...extra,
});
const node = (tag: string, cls: string, kids: unknown[] = []) =>
	({ id: "n", t: "frame", tag, cls, kids }) as never;
const key = (m: ReturnType<typeof fpMatch>) => m?.key ?? null;

describe("fpMatch: sus reglas", () => {
	it("necesita la misma etiqueta y todas las clases fijas de la raíz", () => {
		const fps = { a: fp() };
		assert.equal(
			key(fpMatch(node("div", "rounded-xl border bg-white p-4"), fps, generic)),
			"a",
		);
		assert.equal(
			key(fpMatch(node("div", "rounded-xl border"), fps, generic)),
			null,
		);
		assert.equal(
			key(fpMatch(node("span", "rounded-xl border bg-white"), fps, generic)),
			null,
		);
	});

	it("un nodo sin etiqueta o ausente no casa con nada", () => {
		const fps = { a: fp() };
		assert.equal(fpMatch(null, fps, generic), null);
		assert.equal(fpMatch({ id: "x", t: "text" } as never, fps, generic), null);
	});

	it("`skip` descarta las huellas por su título", () => {
		const fps = { a: fp() };
		assert.equal(
			key(
				fpMatch(
					node("div", "rounded-xl border bg-white"),
					fps,
					generic,
					new Set(["Tarjeta"]),
				),
			),
			null,
		);
	});

	it("si el componente tiene firma «siempre presente», tiene que aparecer dentro; si no, no es ese componente", () => {
		const fps = {
			a: fp({ sig: { tag: "h3", cls: ["font-bold"] } }),
		};
		const bare = node("div", "rounded-xl border bg-white");
		const withSig = node("div", "rounded-xl border bg-white", [
			node("h3", "font-bold text-lg"),
		]);
		assert.equal(key(fpMatch(bare, fps, generic)), null);
		assert.equal(key(fpMatch(withSig, fps, generic)), "a");
	});

	it("la firma se busca hasta 4 niveles por debajo en una raíz con carácter, y hasta 1 en una genérica", () => {
		const deep = (levels: number, leaf: unknown) => {
			let n = leaf;
			for (let i = 0; i < levels; i++) n = node("div", "x", [n]);
			return n;
		};
		const sig = { tag: "b", cls: ["s"] };
		const strong = { a: fp({ sig }) };
		const root = (kid: unknown) =>
			node("div", "rounded-xl border bg-white", [kid]);
		// 4 niveles de div intermedios: la firma está en la profundidad 4 (cuenta)
		assert.equal(
			key(fpMatch(root(deep(4, node("b", "s"))) as never, strong, generic)),
			"a",
		);
		assert.equal(
			key(fpMatch(root(deep(5, node("b", "s"))) as never, strong, generic)),
			null,
		);
		const weak = {
			a: fp({ cls: ["flex", "gap-2"], sig }),
		};
		const wroot = (kid: unknown) => node("div", "flex gap-2", [kid]);
		assert.equal(
			key(fpMatch(wroot(deep(1, node("b", "s"))) as never, weak, generic)),
			"a",
		);
		assert.equal(
			key(fpMatch(wroot(deep(2, node("b", "s"))) as never, weak, generic)),
			null,
		);
	});

	it("una raíz genérica (menos de 2 clases que la distingan) sin firma ni firma condicional no casa", () => {
		const fps = { a: fp({ cls: ["flex", "gap-2"] }) };
		assert.equal(key(fpMatch(node("div", "flex gap-2"), fps, generic)), null);
		const withCond = {
			a: fp({ cls: ["flex", "gap-2"], sig_cond: { tag: "i", cls: ["ic"] } }),
		};
		assert.equal(
			key(
				fpMatch(
					node("div", "flex gap-2", [node("i", "ic")]),
					withCond,
					generic,
				),
			),
			"a",
		);
	});

	it("la firma condicional suma 3 puntos, una clase que distingue suma 1 y el número de clases desempata", () => {
		const fps = {
			plain: fp({ title: "A", cls: ["rounded-xl", "border"] }),
			cond: fp({
				title: "B",
				cls: ["rounded-xl", "border"],
				sig_cond: { tag: "i", cls: ["ic"] },
			}),
		};
		const n = node("div", "rounded-xl border", [node("i", "ic")]);
		const m = fpMatch(n, fps, generic);
		assert.equal(m?.key, "cond");
		assert.equal(m?.score, 2 + 3 + 2 / 100);
		// sin la firma condicional gana la sencilla
		assert.equal(
			key(fpMatch(node("div", "rounded-xl border"), fps, generic)),
			"plain",
		);
	});

	it("gana la huella más específica cuando varias casan", () => {
		const fps = {
			small: fp({ title: "A", cls: ["rounded-xl", "border"] }),
			big: fp({ title: "B", cls: ["rounded-xl", "border", "bg-white"] }),
		};
		assert.equal(
			key(fpMatch(node("div", "rounded-xl border bg-white"), fps, generic)),
			"big",
		);
	});

	it("las clases genéricas son expresiones sobre la clase ENTERA: `items-center` lo es, `xitems-center` no", () => {
		assert.equal(generic("items-center"), true);
		assert.equal(generic("xitems-center"), false);
		assert.equal(generic("flex-col"), false);
	});
});

// ---- fpInstance: el componente se crea con sus props deducidas del nodo ----
type Sets = {
	page: FakeNode;
	cardSet: FakeNode;
	titleKey: string;
	subKey: string;
	showKey: string;
};

// Un set «Tarjeta» con variantes `size` (sm, md) y `tone` (a, b); dos textos ligados a una prop (título 14 SemiBold, subtítulo
// 12 Regular) y el subtítulo con un «Mostrar subtítulo»
function cardSet(fake: FakeFigma): Sets {
	const page = fake.page("Componentes");
	const set = fake.node(page, "COMPONENT_SET", "Tarjeta");
	const titleKey = set.addComponentProperty("título", "TEXT", "T");
	const subKey = set.addComponentProperty("subtítulo", "TEXT", "S");
	const showKey = set.addComponentProperty(
		"Mostrar subtítulo",
		"BOOLEAN",
		true,
	);
	const variants = [
		{ size: "sm", tone: "a" },
		{ size: "sm", tone: "b" },
		{ size: "md", tone: "a" },
		{ size: "md", tone: "b" },
	];
	for (const props of variants) {
		const v = fake.node(
			set,
			"COMPONENT",
			Object.entries(props)
				.map(([k, x]) => `${k}=${x}`)
				.join(", "),
		);
		v.variantProperties = props;
		v.resize(200, 80);
		for (const [name, value] of Object.entries(props)) {
			const def = set.componentPropertyDefinitions[name] ?? {
				type: "VARIANT",
				defaultValue: value,
				variantOptions: [],
			};
			if (!def.variantOptions?.includes(value)) def.variantOptions?.push(value);
			set.componentPropertyDefinitions[name] = def;
		}
		const t = fake.text(v, "título", "T", { characters: titleKey });
		const s = fake.text(v, "subtítulo", "S", {
			characters: subKey,
			visible: showKey,
		});
		fake.loadedFonts.add(`${SANS}/SemiBold`);
		fake.loadedFonts.add(`${SANS}/Regular`);
		t.fontName = { family: SANS, style: "SemiBold" };
		t.fontSize = 14;
		s.fontName = { family: SANS, style: "Regular" };
		s.fontSize = 12;
	}
	return { page, cardSet: set, titleKey, subKey, showKey };
}

const FP = (extra: Partial<Fingerprint> = {}): Fingerprint => ({
	title: "Tarjeta",
	tag: "div",
	cls: ["rounded-xl", "border"],
	cond: { "p-4": ["size", "sm"], "text-brand-600": ["tone", "b"] },
	defaults: { size: "md", tone: "a" },
	...extra,
});

const card = (
	cls: string,
	kids: unknown[],
	extra: Record<string, unknown> = {},
) =>
	frame(
		{ tag: "div", cls: `rounded-xl border ${cls}`, w: 200, h: 80, ...extra },
		kids,
	);
const title = (s: string) =>
	text(s, { font: FONT({ size: 14, weight: "600" }) });
const sub = (s: string) => text(s, { font: FONT({ size: 12, weight: "400" }) });
const page = (...kids: unknown[]) =>
	frame({ disp: "flex", w: 400, h: 200 }, kids);

async function viaFingerprint(over: {
	fp?: Fingerprint;
	kids: unknown[];
	cls?: string;
	extra?: Record<string, unknown>;
	module?: Record<string, unknown> | null;
	setup?: (w: ReturnType<typeof world>, s: Sets) => void;
}) {
	const w = world();
	styles(w.fake);
	const s = cardSet(w.fake);
	w.fake.currentPage = w.page;
	over.setup?.(w, s);
	const t = w.kit.track();
	const painted = await paint(
		w,
		[page(card(over.cls ?? "", over.kids, over.extra))],
		{
			fingerprints: { tarjeta: over.fp ?? FP() },
			generic: ["flex", "items-\\S+"],
		},
		{},
		over.module === undefined ? recognizer({}) : over.module,
	);
	return { w, s, ...painted, warnings: t.done().warnings ?? [] };
}

describe("fpInstance: el componente reconocido por su huella", () => {
	it("la variante sale de votar las clases condicionales del nodo (la raíz pesa más que un hijo)", async () => {
		const { root, ctx } = await viaFingerprint({
			cls: "p-4",
			kids: [title("Hola"), sub("Mundo")],
		});
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.main?.name, "size=sm, tone=a");
		assert.deepEqual(ctx.counters.matches, [
			{
				node: ctx.counters.matches[0]?.node,
				set: "Tarjeta",
				by: "fingerprint",
			},
		]);
		assert.equal(ctx.counters.components["Tarjeta"], 1);
	});

	it("sin clases condicionales se usan los valores por defecto de la huella", async () => {
		const { root } = await viaFingerprint({ kids: [title("Hola")] });
		assert.equal((root.children[0] as FakeNode).main?.name, "size=md, tone=a");
	});

	it("una clase condicional de un hijo también vota, con menos peso que la de la raíz", async () => {
		const { root } = await viaFingerprint({
			cls: "p-4",
			kids: [frame({ tag: "span", cls: "text-brand-600" }, [title("Hola")])],
		});
		// la raíz vota size=sm (3) y el hijo tone=b (1): propiedades distintas, ganan las dos
		assert.equal((root.children[0] as FakeNode).main?.name, "size=sm, tone=b");
	});

	it("los textos del nodo se emparejan con las capas del componente por texto, tamaño y peso", async () => {
		const { root } = await viaFingerprint({
			kids: [title("Un título"), sub("Una nota")],
		});
		const inst = root.children[0] as FakeNode;
		const by = (name: string) =>
			inst.descendants().find((d) => d.name === name)?.characters;
		assert.equal(by("título"), "Un título");
		assert.equal(by("subtítulo"), "Una nota");
	});

	it("un «Mostrar…» cuyas capas no recibieron texto se apaga", async () => {
		const { root } = await viaFingerprint({ kids: [title("Solo título")] });
		const inst = root.children[0] as FakeNode;
		const subtitle = inst.descendants().find((d) => d.name === "subtítulo");
		assert.equal(subtitle?.visible, false);
		assert.equal(
			inst.descendants().find((d) => d.name === "título")?.visible,
			true,
		);
	});

	it("la instancia toma el ancho de la captura, y el alto si la raíz es h-full y más alta", async () => {
		const wide = await viaFingerprint({
			kids: [title("A")],
			extra: { w: 260 },
		});
		assert.equal((wide.root.children[0] as FakeNode).width, 260);
		const tall = await viaFingerprint({
			cls: "h-full",
			kids: [title("A")],
			extra: { w: 200, h: 140 },
		});
		assert.equal((tall.root.children[0] as FakeNode).height, 140);
	});

	it("el icono del svg del nodo va al hueco «Icono…» del componente por swap, con el color capturado", async () => {
		const w = world();
		styles(w.fake);
		const plus = icons(w.fake);
		const s = cardSet(w.fake);
		const swapKey = s.cardSet.addComponentProperty(
			"Icono",
			"INSTANCE_SWAP",
			plus.id,
		);
		for (const v of s.cardSet.children) {
			const nested = plus.createInstance();
			nested.name = "icons/plus";
			v.appendChild(nested);
			nested.componentPropertyReferences = { mainComponent: swapKey };
		}
		const minus = w.fake.node(
			w.fake.page("Iconos más"),
			"COMPONENT",
			"icons/minus",
		);
		w.fake.node(minus, "VECTOR", "trazo").strokes = [
			{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 1 },
		];
		w.fake.currentPage = w.page;
		const { root } = await paint(
			w,
			[
				page(
					card("", [
						title("A"),
						svg({ key: "KEY-MENOS", color: [255, 0, 0, 1], w: 16, h: 16 }),
					]),
				),
			],
			{
				fingerprints: { tarjeta: FP() },
				generic: ["flex"],
				icons: { "KEY-MENOS": "minus" },
			},
			{},
			recognizer({}),
		);
		const inst = root.children[0] as FakeNode;
		const swapped = inst.descendants().find((d) => d.name === "icons/minus");
		assert.ok(swapped, "el icono se cambió por el del catálogo");
		const stroke = swapped.descendants().find((d) => d.strokes.length > 0);
		assert.ok(stroke);
		assert.equal((stroke.strokes[0] as { color: { r: number } }).color.r, 1);
	});

	it("sin props de texto: la variante numérica es el número de textos que no son separador y los textos se escriben capa a capa", async () => {
		const w = world();
		styles(w.fake);
		w.fake.loadedFontsToLoad.add("Inter/Regular");
		const pg = w.fake.page("Componentes");
		const set = w.fake.node(pg, "COMPONENT_SET", "Migas");
		for (const n of ["1", "2"]) {
			const v = w.fake.node(set, "COMPONENT", `niveles=${n}`);
			v.variantProperties = { niveles: n };
			for (let i = 0; i < 2 * Number(n) - 1; i++)
				w.fake.text(v, `t${i}`, `x${i}`);
			const def = set.componentPropertyDefinitions["niveles"] ?? {
				type: "VARIANT",
				defaultValue: "1",
				variantOptions: [],
			};
			def.variantOptions?.push(n);
			set.componentPropertyDefinitions["niveles"] = def;
		}
		w.fake.currentPage = w.page;
		const { root } = await paint(
			w,
			[
				page(
					frame({ tag: "nav", cls: "", w: 200, h: 20 }, [
						frame({ tag: "ol", cls: "lista" }, []),
						text("Inicio"),
						text("/"),
						text("Cuenta"),
					]),
				),
			],
			{
				fingerprints: {
					migas: {
						title: "Migas",
						tag: "nav",
						cls: [],
						defaults: {},
						sig: { tag: "ol", cls: ["lista"] },
					},
				},
				generic: [],
			},
			{},
			recognizer({}),
		);
		const inst = root.children[0] as FakeNode;
		assert.equal(inst.type, "INSTANCE");
		assert.equal(inst.main?.name, "niveles=2");
		const chars = inst.descendants().filter((d) => d.type === "TEXT");
		assert.deepEqual(
			chars.map((c) => c.characters),
			["Inicio", "/", "Cuenta"],
		);
	});

	it("el `after` del set corre también tras una coincidencia por huella", async () => {
		const seen: string[] = [];
		await viaFingerprint({
			kids: [title("A")],
			module: recognizer(
				{},
				{
					after: {
						Tarjeta: (i: FakeNode, n: { tag: string }) => {
							seen.push(`${i.type}:${n.tag}`);
						},
					},
				},
			),
		});
		assert.deepEqual(seen, ["INSTANCE:div"]);
	});

	it("una huella cuyo set no está en el archivo no cambia nada: el nodo se pinta", async () => {
		const w = world();
		styles(w.fake);
		const { root } = await paint(
			w,
			[page(card("", [title("A")]))],
			{ fingerprints: { tarjeta: FP() }, generic: [] },
			{},
			recognizer({}),
		);
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
	});

	it("las huellas solo se prueban en marcos, no en textos ni imágenes", async () => {
		const { root } = await viaFingerprint({
			kids: [title("A")],
			fp: FP({ tag: "p", cls: [] }),
		});
		// la huella pide un <p> y el nodo es un <div>: no casa
		assert.equal((root.children[0] as FakeNode).type, "FRAME");
	});
});
