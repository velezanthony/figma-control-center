// kit.sheet.paint: la página, la cabecera y la tarjeta, las variantes, el set y la matriz de una
// hoja. Un grupo por pieza (`sheet/page.ts`, `header.ts`, `variants.ts`, `set.ts`,
// `matrix.ts`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exposeNamed } from "../../../../../kits/figma/sheet/set.ts";
import type { FakeNode } from "../fake-figma.ts";
import {
	assetsOf,
	button,
	frame,
	key,
	PAGE_KEY,
	SCRATCH_KEY,
	SET_KEY,
	sheetPlanOf,
	sheetWorld,
	text,
} from "../sheet-support.ts";

const paint = (w: ReturnType<typeof sheetWorld>, plan: unknown) =>
	w.kit.sheet.paint(plan as never, assetsOf(plan), null);
const textsOf = (n: FakeNode) => n.findAll((x) => x.type === "TEXT");

const compOf = (vs: readonly { component: unknown }[], i: number): FakeNode =>
	(vs[i] as { component: unknown }).component as FakeNode;

describe("sheet/page: la página de la hoja", () => {
	it("una hoja nueva crea la página con su clave, tras la que dice `after`", async () => {
		const w = sheetWorld();
		const before = w.fake.page("   Badge");
		w.fake.page("   Otra");
		const plan = sheetPlanOf({
			target: {
				page: { name: "   Button", key: PAGE_KEY, after: "   Badge" },
				set: { name: "Button", key: SET_KEY },
			},
		});
		const { page } = await paint(w, plan);
		const pages = w.fake.root.children;
		assert.equal(pages.indexOf(page as never), pages.indexOf(before) + 1);
		assert.equal(key(page), PAGE_KEY);
		assert.equal(w.fake.currentPage, page);
	});

	it("sin `after`, va al final de su sección (tras las páginas con sangría), nunca arriba del todo", async () => {
		const w = sheetWorld();
		w.fake.page("Átomos");
		w.fake.page("   Uno");
		w.fake.page("   Dos");
		w.fake.page("Moléculas");
		const plan = sheetPlanOf({
			target: {
				page: { name: "   Button", key: PAGE_KEY, section: "Átomos" },
				set: { name: "Button", key: SET_KEY },
			},
		});
		const { page } = await paint(w, plan);
		const names = w.fake.root.children.map((p) => p.name);
		assert.equal(names.indexOf("   Button"), names.indexOf("   Dos") + 1);
		assert.ok(names.indexOf("   Button") > 0);
		assert.equal(key(page), PAGE_KEY);
	});

	it("sin `after` ni sección que exista, al final y avisa PAGE_AFTER_NOT_FOUND", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			target: {
				page: { name: "   Button", key: PAGE_KEY, after: "No existe" },
				set: { name: "Button", key: SET_KEY },
			},
		});
		const tracker = w.kit.track();
		await paint(w, plan);
		const warnings = tracker.done().warnings ?? [];
		assert.ok(warnings.some((x) => x.code === "PAGE_AFTER_NOT_FOUND"));
		assert.equal(w.fake.root.children.at(-1)?.name, "   Button");
	});

	it("una página con ese nombre (recortado) y sin clave se adopta y avisa ADOPTED", async () => {
		const w = sheetWorld();
		const existing = w.fake.page("Button ");
		const tracker = w.kit.track();
		const { page } = await paint(w, sheetPlanOf());
		assert.equal((page as unknown as FakeNode).id, existing.id);
		assert.equal(key(existing), PAGE_KEY);
		assert.ok(
			(tracker.done().warnings ?? []).some((x) => x.code === "ADOPTED"),
		);
	});

	it("una página de verdad con contenido no se repinta (SHEET_EXISTS): rehacer es de H-b", async () => {
		const w = sheetWorld();
		const existing = w.fake.page("   Button");
		w.fake.node(existing, "FRAME", "algo");
		await assert.rejects(paint(w, sheetPlanOf()), /SHEET_EXISTS/);
		assert.equal(existing.children.length, 1);
	});

	it("en la página aparte (scratch) repetir vacía y vuelve a pintar", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			target: {
				page: { name: "fcc · hoja · button", key: SCRATCH_KEY },
				set: { name: "Button", key: SET_KEY },
			},
		});
		const first = await paint(w, plan);
		const second = await paint(w, plan);
		const pages = w.fake.root.children.filter(
			(p) => p.name === "fcc · hoja · button",
		);
		assert.equal(pages.length, 1);
		assert.equal(first.page.id, second.page.id);
		assert.equal(
			pages[0]?.findAll((n) => n.type === "COMPONENT_SET").length,
			1,
		);
	});
});

describe("sheet/index: al acabar", () => {
	it("encuadra la cabecera y la tarjeta (figma.viewport.scrollAndZoomIntoView), lo que hace que Figma recalcule lo que se ocultó por propiedad", async () => {
		const w = sheetWorld();
		const { head, card } = await paint(w, sheetPlanOf());
		assert.deepEqual(
			w.fake.viewport.zoomed.map((n) => n.id),
			[(head as unknown as FakeNode).id, (card as unknown as FakeNode).id],
		);
	});
});

describe("sheet/header: la cabecera y la tarjeta", () => {
	it("Header (1480 × 218, radio 24, título 80 SemiBold) y la tarjeta (título, vertical, 32, y 266, relleno 80)", async () => {
		const w = sheetWorld();
		const { head, card } = await paint(w, sheetPlanOf());
		const h = head as unknown as FakeNode;
		const c = card as unknown as FakeNode;
		assert.equal(h.name, "Header");
		assert.equal(h.width, 1480);
		assert.equal(h.height, 218);
		assert.equal(h.cornerRadius, 24);
		assert.equal(h.layoutMode, "HORIZONTAL");
		assert.equal(h.paddingLeft, 80);
		const title = h.children[0] as FakeNode;
		assert.equal(title.characters, "Button");
		assert.equal(title.fontSize, 80);
		assert.deepEqual(title.fontName, {
			family: "Fuente Sans",
			style: "SemiBold",
		});
		assert.equal(c.name, "Button");
		assert.equal(c.layoutMode, "VERTICAL");
		assert.equal(c.itemSpacing, 32);
		assert.equal(c.y, 266);
		assert.equal(c.paddingTop, 80);
		assert.equal(c.paddingLeft, 80);
		assert.equal(c.width, 1480);
	});

	it("los rellenos y los textos van ligados a las variables de `style`", async () => {
		const w = sheetWorld();
		const { head, card } = await paint(w, sheetPlanOf());
		const bound = (n: FakeNode) =>
			JSON.stringify((n as unknown as { fills: unknown }).fills);
		const h = head as unknown as FakeNode;
		assert.ok(bound(h).includes(w.variable("brand/50").id));
		assert.ok(
			bound(h.children[0] as FakeNode).includes(w.variable("brand/600").id),
		);
		assert.ok(
			bound(card as unknown as FakeNode).includes(w.variable("white").id),
		);
	});

	it("la tarjeta lleva descripción (16 Regular), el aviso de fallo (14 SemiBold con su prefijo) y la línea del código (14 Medium)", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({ sheet: { bug: "no gira" } });
		const { card } = await paint(w, plan);
		const texts = (card as unknown as FakeNode).children.filter(
			(n) => n.type === "TEXT",
		);
		assert.deepEqual(
			texts.map((t) => [
				t.characters,
				t.fontSize,
				(t.fontName as { style: string }).style,
			]),
			[
				["Botón con variantes", 16, "Regular"],
				["Fallo conocido: no gira", 14, "SemiBold"],
				["<ui-button>", 14, "Medium"],
			],
		);
		for (const t of texts) assert.equal(t.layoutAlign, "STRETCH");
	});

	it("sin fallo ni línea de código no se pintan esas dos", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({ sheet: { tag: undefined } });
		const { card } = await paint(w, plan);
		const texts = (card as unknown as FakeNode).children.filter(
			(n) => n.type === "TEXT",
		);
		assert.equal(texts.length, 1);
	});

	it("una variable de `style` que no existe para el paso con VARIABLE_NOT_FOUND sin escribir nada", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf() as { style: { card: { fill: string } } };
		plan.style.card.fill = "no/existe";
		const pagesBefore = w.fake.root.children.length;
		await assert.rejects(paint(w, plan), /VARIABLE_NOT_FOUND/);
		assert.equal(w.fake.root.children.length, pagesBefore);
	});
});

describe("sheet/variants: cada variante, convertida en componente", () => {
	it("un componente por variante, llamado `k=v, k2=v2`, con lo pintado dentro", async () => {
		const w = sheetWorld();
		const { variants } = await paint(w, sheetPlanOf());
		assert.deepEqual(
			variants.map((v) => v.component.name),
			[
				"variant=primary, size=sm",
				"variant=primary, size=lg",
				"variant=danger, size=sm",
			],
		);
		for (const v of variants) {
			assert.equal(v.component.type, "COMPONENT");
			assert.equal(v.component.children.length, 1);
			assert.ok(textsOf(v.component as unknown as FakeNode).length >= 1);
		}
	});

	it("`createComponentFromNode` conserva la disposición del marco y el kit relee el componente que devuelve (H1)", async () => {
		const w = sheetWorld();
		const { variants } = await paint(w, sheetPlanOf());
		assert.equal(compOf(variants, 0).layoutMode, "HORIZONTAL");
	});

	it("`names` pone el nombre de la capa por clases (substring), antes que el rol", async () => {
		const w = sheetWorld();
		const nested = frame({ tag: "div", w: 100, h: 40 }, [
			frame({ tag: "button", cls: "btn x", w: 80, h: 32 }, [text("a")]),
		]);
		const plan = sheetPlanOf({
			variants: [{ props: { v: "a" }, root: [nested] }],
			sheet: { names: [{ classes: "btn", name: "Boton raiz" }] },
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
		const { variants } = await paint(w, plan);
		const inner = compOf(variants, 0).children[0] as FakeNode;
		assert.equal(inner.name, "Boton raiz");
	});

	it("una variante sin nodos o varias raíces se pintan como en el pintor de pantallas (varias raíces: su posición real)", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			variants: [
				{
					props: { v: "a" },
					root: [
						frame({ x: 10, y: 20, w: 50, h: 20, tag: "i" }, [text("a")]),
						frame({ x: 100, y: 40, w: 30, h: 20, tag: "b" }, [text("b")]),
					],
				},
			],
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
		const { variants } = await paint(w, plan);
		const comp = variants[0]?.component as unknown as FakeNode;
		assert.equal(comp.children.length, 2);
		assert.deepEqual(
			comp.children.map((c) => [c.x, c.y]),
			[
				[0, 0],
				[90, 20],
			],
		);
	});

	it("el texto único de un bloque ocupa su ancho y parte líneas (como en CSS); en línea o w-fit se queda a su medida", async () => {
		const w = sheetWorld();
		const help = (extra: Record<string, unknown>) =>
			frame({ tag: "div", cls: "form-help", w: 320, h: 16, ...extra }, [
				text("Máximo 200 caracteres.", { w: 141, h: 16 }),
			]);
		const plan = sheetPlanOf({
			variants: [
				{ props: { v: "bloque" }, root: [help({})] },
				{ props: { v: "fit" }, root: [help({ cls: "form-help w-fit" })] },
				{ props: { v: "linea" }, root: [help({ disp: "inline-block" })] },
			],
			matrix: {
				rows: ["v=bloque", "v=fit", "v=linea"],
				columns: [],
				cells: [[0], [1], [2]],
			},
		});
		const { variants } = await paint(w, plan);
		const [block, fit, inline] = [0, 1, 2].map((i) => compOf(variants, i));
		const textOf = (c: FakeNode) => textsOf(c)[0];
		assert.equal(textOf(block as FakeNode)?.layoutGrow, 1);
		assert.equal(textOf(block as FakeNode)?.textAutoResize, "HEIGHT");
		assert.equal(block?.width, 320);
		assert.equal(block?.primaryAxisSizingMode, "FIXED");
		for (const c of [fit, inline]) {
			assert.equal(textOf(c as FakeNode)?.layoutGrow, 0);
			assert.equal(textOf(c as FakeNode)?.textAutoResize, "WIDTH_AND_HEIGHT");
		}
	});
});

describe("sheet/set: el set de variantes", () => {
	it("combina las variantes con el nombre y la clave del plan, y sus variantes llevan su clave", async () => {
		const w = sheetWorld();
		const { set, variants } = await paint(w, sheetPlanOf());
		const s = set as unknown as FakeNode;
		assert.equal(s.type, "COMPONENT_SET");
		assert.equal(s.name, "Button");
		assert.equal(key(s), SET_KEY);
		assert.equal(s.children.length, 3);
		// H7: tras combinar, el kit relee las variantes del set (con otro id)
		assert.deepEqual(
			variants.map((v) => v.component.id),
			s.children.map((c) => c.id),
		);
		assert.equal(
			key(s.children[0] as FakeNode),
			"fcc:sheet-variant:button:variant=primary, size=sm",
		);
	});

	it("la descripción lleva el aviso de fallo con su prefijo, la descripción y la línea del código (H15: con saltos de línea)", async () => {
		const w = sheetWorld();
		const { set } = await paint(w, sheetPlanOf({ sheet: { bug: "no gira" } }));
		assert.equal(
			(set as unknown as FakeNode).description,
			"FALLO CONOCIDO: no gira\n\nBotón con variantes\n<ui-button>",
		);
		const w2 = sheetWorld();
		const plain = await paint(w2, sheetPlanOf());
		assert.equal(
			(plain.set as unknown as FakeNode).description,
			"Botón con variantes\n<ui-button>",
		);
	});

	it("`exposed` expone las instancias con ese nombre que Figma deja exponer (H10) y avisa EXPOSE_FAILED de las que no, sin parar el paso", async () => {
		const w = sheetWorld();
		const page = w.fake.page("Banderas");
		const withRefs = w.fake.componentSet(page, "Flag", [{ v: "a" }]);
		const plain = w.fake.node(page, "COMPONENT", "Plana");
		const host = w.fake.node(page, "COMPONENT", "host");
		const ok = (withRefs.children[0] as FakeNode).createInstance();
		ok.name = "Flag";
		host.appendChild(ok);
		const bad = plain.createInstance();
		bad.name = "Flag";
		host.appendChild(bad);
		const tracker = w.kit.track();
		const failed = exposeNamed(host as never, ["Flag"]);
		for (const f of failed) tracker.warn("EXPOSE_FAILED", f.message, f.id);
		assert.equal(ok.isExposedInstance, true);
		assert.equal(bad.isExposedInstance, false);
		assert.equal(failed.length, 1);
		assert.match(failed[0]?.message ?? "", /Can only expose instances/);
		assert.deepEqual(
			(tracker.done().warnings ?? []).map((x) => x.code),
			["EXPOSE_FAILED"],
		);
	});
});

describe("sheet/variants: reconocimiento de la hoja", () => {
	const fp = (title: string, cls: string[]) => ({ title, tag: "div", cls });

	it("si la mejor huella es la del propio set, la raíz se pinta como marco: no se cae a la siguiente mejor (KPI card frente a Filter select)", async () => {
		const w = sheetWorld();
		const page = w.fake.page("Componentes");
		w.fake.loadedFontsToLoad.add("Inter/Regular");
		w.fake.componentSet(page, "KPI card", [{ v: "a" }]);
		w.fake.componentSet(page, "Filter select", [{ v: "a" }]);
		const root = frame({ tag: "div", cls: "kpi fila", w: 100, h: 40 }, []);
		const plan = sheetPlanOf({
			sheet: { title: "Kpi card" },
			variants: [{ props: { v: "a" }, root: [root] }],
			fingerprints: {
				"molecules.kpi": fp("KPI card", ["kpi", "fila"]),
				"molecules.filter": fp("Filter select", ["fila"]),
			},
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
		const { variants } = await paint(w, plan);
		const inside = compOf(variants, 0).findAll((n) => n.type === "INSTANCE");
		assert.equal(inside.length, 0);
	});

	// Lo que le pasó a `Dropdown` el 2026-11-13: la raíz de la captura casaba con la huella de otro componente y cada
	// variante quedaba como una sola instancia de él, sin el menú abierto
	const dropdownWorld = () => {
		const w = sheetWorld();
		const page = w.fake.page("Componentes");
		w.fake.loadedFontsToLoad.add("Inter/Regular");
		w.fake.componentSet(page, "Filter dropdown", [{ v: "a" }]);
		w.fake.componentSet(page, "Menu item", [{ v: "a" }]);
		return w;
	};
	const dropdownPrints = {
		"molecules.filter": fp("Filter dropdown", ["relative", "inline-block"]),
		"molecules.item": fp("Menu item", ["menu-item", "fila"]),
	};
	const dropdownRoot = () =>
		frame({ tag: "div", cls: "relative inline-block", w: 120, h: 38 }, [
			frame({ tag: "div", cls: "disparador", w: 120, h: 38 }, [
				text("Acciones"),
			]),
			frame({ tag: "div", cls: "menu", w: 200, h: 36 }, [
				frame({ tag: "div", cls: "menu-item fila", w: 198, h: 36 }, []),
			]),
		]);
	const dropdownPlan = (root: unknown) =>
		sheetPlanOf({
			sheet: { title: "Dropdown", texts: [] },
			variants: [{ props: { v: "a" }, root: [root] }],
			fingerprints: dropdownPrints,
			rules: ["Menu item"],
			matrix: { rows: ["v=a"], columns: [], cells: [[0]] },
		});
	const mainsOf = async (c: FakeNode) =>
		Promise.all(
			c
				.findAll((n) => n.type === "INSTANCE")
				.map(async (n) => (await n.getMainComponentAsync())?.parent?.name),
		);

	it("la raíz de la variante es el propio componente: nunca se reconoce como otro, y sus hijos sí (Menu item sigue siendo instancia)", async () => {
		const w = dropdownWorld();
		const { variants } = await paint(w, dropdownPlan(dropdownRoot()));
		const c = compOf(variants, 0);
		assert.deepEqual(await mainsOf(c), ["Menu item"]);
		assert.ok(c.findOne((n) => n.name !== "" && n.type === "TEXT"));
	});

	it("si una variante acaba siendo una sola instancia de otro componente, el paso falla con SHEET_ROOT_IS_OTHER sin escribir nada", async () => {
		const w = dropdownWorld();
		const wrapped = frame({ tag: "div", cls: "envoltorio", w: 120, h: 38 }, [
			frame({ tag: "div", cls: "relative inline-block", w: 120, h: 38 }, [
				text("Acciones"),
			]),
		]);
		const step = (plan: unknown) =>
			w.kit.steps.buildComponent(
				{ sheet: "button", scratch: false } as never,
				assetsOf(plan),
			);
		await step(dropdownPlan(dropdownRoot()));
		const before = JSON.stringify(
			w.fake.root.children.map((p) => [p.id, p.descendants().map((n) => n.id)]),
		);
		const plan = dropdownPlan(wrapped);
		await assert.rejects(
			w.kit.steps.buildComponent(
				{ sheet: "button", scratch: false } as never,
				assetsOf(plan),
			),
			/SHEET_ROOT_IS_OTHER[\s\S]*Filter dropdown/,
		);
		const after = JSON.stringify(
			w.fake.root.children.map((p) => [p.id, p.descendants().map((n) => n.id)]),
		);
		assert.equal(after, before, "no queda nada pintado");
	});
});

describe("sheet/matrix: la matriz con sus etiquetas", () => {
	it("el set vive en un marco `<título> — matriz` dentro de la tarjeta, con borde discontinuo y radio 16", async () => {
		const w = sheetWorld();
		const { set, matrixFrame, card } = await paint(w, sheetPlanOf());
		const m = matrixFrame as unknown as FakeNode;
		assert.equal(m.name, "Button — matriz");
		assert.equal(m.parent?.id, (card as unknown as FakeNode).id);
		const s = set as unknown as FakeNode;
		assert.equal(s.parent?.id, m.id);
		assert.deepEqual(s.dashPattern, [6, 4]);
		assert.equal(s.cornerRadius, 16);
		assert.ok(JSON.stringify(s.strokes).includes(w.variable("border").id));
	});

	it("etiquetas de fila y de columna con su estilo, y las columnas que no se distinguen se llaman «—»", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			matrix: {
				rows: ["variant=primary", "variant=danger"],
				columns: ["size=sm", ""],
				cells: [[0, 1], [2]],
			},
		});
		const { matrixFrame } = await paint(w, plan);
		const labels = (matrixFrame as unknown as FakeNode).children.filter(
			(n) => n.type === "TEXT",
		);
		assert.deepEqual(
			labels.map((l) => [
				l.characters,
				l.fontSize,
				(l.fontName as { style: string }).style,
			]),
			[
				["size=sm", 11, "Medium"],
				["—", 11, "Medium"],
				["variant=primary", 12, "SemiBold"],
				["variant=danger", 12, "SemiBold"],
			],
		);
	});

	it("sin columnas distinguibles no hay etiquetas de columna (y el set no se desplaza hacia abajo)", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			variants: [
				{ props: { v: "a" }, root: [button()] },
				{ props: { v: "b" }, root: [button()] },
			],
			matrix: { rows: ["v=a", "v=b"], columns: [], cells: [[0], [1]] },
		});
		const { matrixFrame, set } = await paint(w, plan);
		const labels = (matrixFrame as unknown as FakeNode).children.filter(
			(n) => n.type === "TEXT",
		);
		assert.equal(labels.length, 2);
		assert.equal((set as unknown as FakeNode).y, 0);
	});

	it("las variantes se centran en su celda: x e y con 40 de margen y 32 de separación; el set mide lo que ocupan", async () => {
		const w = sheetWorld();
		const { set, variants, matrixFrame } = await paint(w, sheetPlanOf());
		const s = set as unknown as FakeNode;
		const c = variants.map((v) => v.component as unknown as FakeNode);
		const labels = (matrixFrame as unknown as FakeNode).children.filter(
			(n) => n.type === "TEXT",
		);
		const offX = Math.max(...labels.slice(2).map((l) => l.width)) + 16;
		assert.ok(Math.abs(s.x - offX) < 0.01);
		// columna 0: ancho 80 (variantes 0 y 2); columna 1: ancho 120 (variante 1) o el de su etiqueta si es mayor
		assert.ok(
			Math.abs(c[0]?.x === undefined ? 1 : c[0].x - 40) <
				0.5 + Math.max(0, labels[0] ? labels[0].width - 80 : 0) / 2,
		);
		assert.ok((c[1]?.x ?? 0) > (c[0]?.x ?? 0) + 80);
		assert.equal(c[0]?.y, c[1]?.y);
		assert.ok((c[2]?.y ?? 0) > (c[0]?.y ?? 0));
		const right = Math.max(...c.map((n) => n.x + n.width));
		assert.ok(Math.abs(s.width - (right + 40)) < 0.5);
	});

	it("`align: top` pone cada variante arriba de su celda en vez de centrada", async () => {
		const w = sheetWorld();
		const tall = (h: number) => frame({ tag: "div", w: 60, h });
		const plan = sheetPlanOf({
			sheet: { matrix: { align: "top" } },
			variants: [
				{ props: { v: "a", s: "1" }, root: [tall(100)] },
				{ props: { v: "a", s: "2" }, root: [tall(40)] },
			],
			matrix: { rows: ["v=a"], columns: ["s=1", "s=2"], cells: [[0, 1]] },
		});
		const { variants } = await paint(w, plan);
		assert.equal(variants[0]?.component.y, variants[1]?.component.y);
		const w2 = sheetWorld();
		const centered = await paint(w2, {
			...plan,
			sheet: { ...(plan["sheet"] as object), matrix: undefined },
		});
		assert.ok(
			(centered.variants[1]?.component.y ?? 0) >
				(centered.variants[0]?.component.y ?? 0),
		);
	});

	it("si la matriz es más ancha que la tarjeta, la tarjeta y la cabecera crecen a su ancho", async () => {
		const w = sheetWorld();
		const wide = (n: number) => frame({ tag: "div", w: 900 + n, h: 30 });
		const plan = sheetPlanOf({
			variants: [
				{ props: { v: "a", s: "1" }, root: [wide(1)] },
				{ props: { v: "a", s: "2" }, root: [wide(2)] },
			],
			matrix: { rows: ["v=a"], columns: ["s=1", "s=2"], cells: [[0, 1]] },
		});
		const { head, card, matrixFrame } = await paint(w, plan);
		const need = (matrixFrame as unknown as FakeNode).width + 160;
		assert.ok(need > 1480);
		assert.ok(Math.abs((card as unknown as FakeNode).width - need) < 0.01);
		assert.ok(Math.abs((head as unknown as FakeNode).width - need) < 0.01);
	});
});
void button;
