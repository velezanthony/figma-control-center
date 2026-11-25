// Cuando Figma va por delante de la web: el paso compara el set con la captura antes de escribir y,
// si hay desfase, no escribe nada y devuelve el informe; la decisión de sheets@1 (`drift`) manda con su huella.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { warningCodes } from "../areas-support.ts";
import type { FakeNode } from "../fake-figma.ts";
import {
	assetsOf,
	button,
	icons,
	setOf,
	sheetPlanOf,
	sheetWorld,
} from "../sheet-support.ts";

type World = ReturnType<typeof sheetWorld>;
type Plan = Record<string, unknown>;
type Json = Record<string, any>;

const PARAMS = { sheet: "button", scratch: false };
const TEXTS = [{ name: "contenido", match: "Botón" }];
const planOf = (sheet: Plan = {}, over: Plan = {}) =>
	sheetPlanOf({ sheet: { texts: TEXTS, ...sheet }, ...over } as never);
const run = (w: World, plan: unknown) =>
	w.kit.steps.buildComponent(PARAMS as never, assetsOf(plan));
const driftOf = (r: { report?: unknown }): Json =>
	(r.report as Json)["drift"] as Json;

// Lo que le pasó a `td`: alguien añadió a mano la prop de variante `card` (todas las variantes con `card=no` y una `card=title`)
function addHandMadeCard(set: FakeNode): void {
	for (const v of set.children) {
		v.variantProperties = { ...(v.variantProperties ?? {}), card: "no" };
		v.name = `${v.name}, card=no`;
	}
	const first = set.children[0] as FakeNode;
	const extra = first.clone();
	set.appendChild(extra);
	extra.name = `${(first.variantProperties ? Object.entries(first.variantProperties).filter(([k]) => k !== "card") : []).map(([k, v]) => `${k}=${v}`).join(", ")}, card=title`;
	extra.variantProperties = {
		...(first.variantProperties ?? {}),
		card: "title",
	};
	set.componentPropertyDefinitions["card"] = {
		type: "VARIANT",
		defaultValue: "no",
		variantOptions: ["no", "title"],
	};
}

async function built() {
	const w = sheetWorld();
	const plan = planOf();
	await run(w, plan);
	return { w, plan, set: setOf(w.fake) };
}

const snapshot = (w: World) =>
	JSON.stringify(
		w.fake.root.children.map((p) => [p.id, p.descendants().map((n) => n.id)]),
	);

describe("kit/build-component@1: desfase entre Figma y la web", () => {
	it("una prop de variante hecha a mano en Figma: la hoja no se escribe, el paso acaba con el aviso SHEET_DRIFT y el informe, y cumple step@1", async () => {
		const { w, plan, set } = await built();
		addHandMadeCard(set);
		const before = snapshot(w);
		const result = await run(w, plan);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		assert.equal(snapshot(w), before, "no se escribió nada");
		assert.deepEqual(result.createdNodeIds, []);
		assert.deepEqual(result.mutatedNodeIds, []);
		assert.ok(warningCodes(result).includes("SHEET_DRIFT"));
		const r = result.report as Json;
		assert.equal(r["skipped"], "drift");
		const d = driftOf(result);
		assert.equal(d["reason"], "drift");
		assert.deepEqual(d["figmaOnlyProps"], { card: ["no", "title"] });
		assert.equal(d["figmaOnlyVariants"].length, 4);
		assert.deepEqual(d["webOnlyVariants"], [
			"variant=primary, size=sm",
			"variant=primary, size=lg",
			"variant=danger, size=sm",
		]);
		assert.deepEqual(d["handMadeProperties"], []);
		assert.deepEqual(d["set"], {
			id: set.id,
			name: "Button",
			page: "   Button",
		});
		assert.deepEqual(d["fingerprint"].variantProps["card"], ["no", "title"]);
	});

	it("kit.sheet.assess da el veredicto sin escribir nada: blocked con el informe, o paint", async () => {
		const { w, plan, set } = await built();
		const before = snapshot(w);
		const clean = await w.kit.sheet.assess(plan as never);
		assert.equal(clean.verdict.kind, "paint");
		addHandMadeCard(set);
		const dirty = await w.kit.sheet.assess(plan as never);
		assert.equal(dirty.verdict.kind, "blocked");
		assert.equal(dirty.existing.set?.id, set.id);
		void before;
	});

	it("la huella actual va ordenada y sin el sufijo #id, lista para copiar a sheets.json", async () => {
		const { w, plan, set } = await built();
		addHandMadeCard(set);
		const d = driftOf(await run(w, plan));
		assert.deepEqual(d["fingerprint"].properties, ["contenido"]);
		assert.deepEqual(Object.keys(d["fingerprint"].variantProps).sort(), [
			"card",
			"size",
			"variant",
		]);
		assert.deepEqual(d["fingerprint"].variantProps["variant"], [
			"danger",
			"primary",
		]);
		assert.deepEqual(
			d["fingerprint"].variants,
			[...d["fingerprint"].variants].sort(),
		);
	});

	it("el informe cuenta las instancias del set fuera de su página, por página y marco de primer nivel", async () => {
		const { w, plan, set } = await built();
		const other = w.fake.page("Otra");
		const frame = w.fake.node(other, "FRAME", "Pantalla");
		for (const i of [0, 1]) {
			const inst = (set.children[i] as FakeNode).createInstance();
			frame.appendChild(inst);
		}
		const home = w.fake.page("Inicio");
		home.appendChild((set.children[2] as FakeNode).createInstance());
		addHandMadeCard(set);
		const d = driftOf(await run(w, plan));
		assert.equal(d["usage"].total, 3);
		assert.deepEqual(
			d["usage"].pages.map((p: Json) => [p["page"], p["count"]]).sort(),
			[
				["Inicio", 1],
				["Otra", 2],
			],
		);
		const otherPage = d["usage"].pages.find((p: Json) => p["page"] === "Otra");
		assert.deepEqual(otherPage.frames, [{ name: "Pantalla", count: 2 }]);
	});

	it("una variante de Figma sin pareja con las mismas props de variante también es desfase", async () => {
		const { w, plan, set } = await built();
		const extra = (set.children[0] as FakeNode).clone();
		set.appendChild(extra);
		extra.name = "variant=primary, size=xl";
		extra.variantProperties = { variant: "primary", size: "xl" };
		const d = driftOf(await run(w, plan));
		assert.deepEqual(d["figmaOnlyProps"], {});
		assert.deepEqual(d["figmaOnlyVariants"], ["variant=primary, size=xl"]);
	});

	it("la web con variantes nuevas y Figma sin ninguna sin pareja no es desfase: se añaden como siempre", async () => {
		const { w, set } = await built();
		const four = planOf(
			{},
			{
				variants: [
					{ props: { variant: "primary", size: "sm" }, root: [button()] },
					{
						props: { variant: "primary", size: "lg" },
						root: [button("Botón", 120)],
					},
					{ props: { variant: "danger", size: "sm" }, root: [button()] },
					{
						props: { variant: "danger", size: "lg" },
						root: [button("Botón", 120)],
					},
				],
				matrix: {
					rows: ["variant=primary", "variant=danger"],
					columns: ["size=sm", "size=lg"],
					cells: [
						[0, 1],
						[2, 3],
					],
				},
			},
		);
		const result = await run(w, four);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
		assert.equal(setOf(w.fake).id, set.id);
		assert.equal(setOf(w.fake).children.length, 4);
	});

	it("con desfase de variantes, las propiedades a mano salen en el informe y no es SHEET_HAND_EDITS", async () => {
		const { w, plan, set } = await built();
		addHandMadeCard(set);
		set.addComponentProperty("Mostrar hueco", "BOOLEAN", true);
		const result = await run(w, plan);
		assert.deepEqual(driftOf(result)["handMadeProperties"], ["Mostrar hueco"]);
	});

	it("sin desfase de variantes, una propiedad a mano sigue siendo SHEET_HAND_EDITS", async () => {
		const { w, plan, set } = await built();
		set.addComponentProperty("Mostrar hueco", "BOOLEAN", true);
		await assert.rejects(run(w, plan), /SHEET_HAND_EDITS/);
	});

	it("la primera vez y la página aparte no comparan nada", async () => {
		const w = sheetWorld();
		const first = await run(w, planOf());
		assert.equal(warningCodes(first).includes("SHEET_DRIFT"), false);
	});
});

describe("kit/build-component@1: la decisión de sheets@1 (`drift`)", () => {
	async function decided(
		decision: Plan | null,
		afterDecision?: (set: FakeNode) => void,
	) {
		const { w, set } = await built();
		addHandMadeCard(set);
		const report = driftOf(await run(w, planOf()));
		const drift =
			decision === null
				? undefined
				: { ...decision, fingerprint: report["fingerprint"] };
		afterDecision?.(set);
		return { w, set, plan: planOf(drift === undefined ? {} : { drift }) };
	}

	it("figma: la hoja se salta con un aviso suave, sin escribir nada", async () => {
		const { w, plan } = await decided({ decision: "figma" });
		const before = snapshot(w);
		const result = await run(w, plan);
		assert.equal(snapshot(w), before);
		assert.deepEqual(
			warningCodes(result).filter(
				(c) => c.startsWith("DRIFT") || c.startsWith("SHEET"),
			),
			["DRIFT_FIGMA_WINS"],
		);
		assert.equal((result.report as Json)["skipped"], "figma");
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("web: se rehace como siempre; las variantes de Figma sin pareja se quedan", async () => {
		const { w, set, plan } = await decided({ decision: "web" });
		const ids = set.children.map((c) => c.id);
		const result = await run(w, plan);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
		assert.deepEqual(
			set.children.slice(0, 4).map((c) => c.id),
			ids,
		);
		assert.equal(set.children.length, 4 + 3);
		assert.ok(warningCodes(result).includes("VARIANT_NOT_CAPTURED"));
	});

	it("map: las variantes de la web se emparejan con card=no, se repintan, y la de Figma sin pareja se conserva", async () => {
		const { w, set, plan } = await decided({
			decision: "map",
			values: { card: "no" },
		});
		const ids = set.children.map((c) => c.id);
		const kids = set.children.map((c) => c.children.map((k) => k.id));
		const result = await run(w, plan);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
		assert.deepEqual(
			set.children.map((c) => c.id),
			ids,
			"mismas variantes, ninguna nueva",
		);
		for (const i of [0, 1, 2])
			assert.equal(
				(set.children[i] as FakeNode).children.some((k) =>
					kids[i]?.includes(k.id),
				),
				false,
				"las emparejadas se repintan",
			);
		assert.deepEqual(
			(set.children[3] as FakeNode).children.map((k) => k.id),
			kids[3],
		);
		assert.deepEqual((result.report as Json)["variants"], {
			created: 0,
			updated: 3,
			kept: 1,
		});
	});

	it("map: una variante nueva de la web se añade con los valores añadidos en su nombre y en sus props", async () => {
		const { w, set, plan } = await decided({
			decision: "map",
			values: { card: "no" },
		});
		const withNew = {
			...plan,
			variants: [
				...(plan["variants"] as unknown[]),
				{
					props: { variant: "primary", size: "xl" },
					root: [button("Botón", 150)],
				},
			],
			matrix: {
				rows: ["variant=primary", "variant=danger"],
				columns: ["size=sm", "size=lg", "size=xl"],
				cells: [[0, 1, 3], [2]],
			},
		};
		await run(w, withNew);
		const added = set.children.at(-1) as FakeNode;
		assert.equal(added.name, "variant=primary, size=xl, card=no");
		assert.deepEqual(added.variantProperties, {
			variant: "primary",
			size: "xl",
			card: "no",
		});
		assert.equal(set.children.length, 5);
	});

	it("la huella cambió desde que se decidió: SHEET_DRIFT otra vez con el informe nuevo, aunque haya decisión", async () => {
		const { w, plan } = await decided({ decision: "web" }, (set) => {
			const extra = (set.children[0] as FakeNode).clone();
			set.appendChild(extra);
			extra.name = "variant=primary, size=sm, card=actions";
			extra.variantProperties = {
				variant: "primary",
				size: "sm",
				card: "actions",
			};
		});
		const before = snapshot(w);
		const result = await run(w, plan);
		assert.equal(snapshot(w), before);
		assert.equal(driftOf(result)["reason"], "fingerprint-changed");
		assert.ok(warningCodes(result).includes("SHEET_DRIFT"));
		assert.equal(driftOf(result)["decision"], "web");
	});

	it("una decisión con una huella que ya no es la del set se vuelve a preguntar aunque no haya desfase de variantes", async () => {
		const { w, set } = await built();
		const stale = {
			variantProps: {},
			variants: [],
			properties: [],
			layers: [],
		};
		const plan = planOf({ drift: { decision: "web", fingerprint: stale } });
		assert.ok(set);
		const result = await run(w, plan);
		assert.equal(driftOf(result)["reason"], "fingerprint-changed");
		assert.deepEqual(driftOf(result)["figmaOnlyVariants"], []);
	});

	it("map que no cubre todas las props solo-Figma, o que nombra una que no lo es: SHEET_DRIFT (map-incomplete)", async () => {
		for (const values of [{ otra: "x" }, { card: "no", otra: "x" }, {}]) {
			const { w, plan } = await decided({ decision: "map", values });
			const result = await run(w, plan);
			assert.equal(
				driftOf(result)["reason"],
				"map-incomplete",
				JSON.stringify(values),
			);
		}
	});
});

// Lo que le pasó a `td` el 2026-11-13: capas hechas a mano dentro de las variantes (una ligada a una propiedad que
// `keep` conserva y un «componente dentro» que la captura no recrea). Repintar las borraba y las pantallas perdían lo que llevaban
const KEEP = ["Mostrar extra"];
const RULES = ["Flag"];
const keepPlan = (sheet: Plan = {}) =>
	planOf({ keep: KEEP, ...sheet }, { rules: RULES });

function addHandMadeLayers(w: World, set: FakeNode) {
	const show = set.addComponentProperty("Mostrar extra", "BOOLEAN", false);
	const other = w.fake.page("Otros");
	const menu = w.fake.node(other, "COMPONENT", "Menú");
	const otherMenu = w.fake.node(other, "COMPONENT", "Menú grande");
	const flag = w.fake.node(other, "COMPONENT", "Flag");
	const plus = icons(w.fake);
	for (const v of set.children) {
		const extra = w.fake.node(v, "FRAME", "extra");
		extra.componentPropertyReferences = { visible: show };
		const m = menu.createInstance();
		v.appendChild(m);
		m.name = "menú";
		v.appendChild(flag.createInstance());
		v.appendChild(plus.createInstance());
	}
	return { show, otherMenu };
}

// Una instancia de esa variante dentro de un marco de primer nivel de esa página
function instanceIn(
	w: World,
	variant: FakeNode,
	pageName: string,
	frameName: string,
): FakeNode {
	const page =
		w.fake.root.children.find((p) => p.name === pageName) ??
		w.fake.page(pageName);
	const frame =
		page.children.find((c) => c.name === frameName) ??
		w.fake.node(page, "FRAME", frameName);
	const inst = variant.createInstance();
	frame.appendChild(inst);
	return inst;
}

describe("kit/build-component@1: capas hechas a mano en las variantes", () => {
	async function withLayers() {
		const { w, set } = await built();
		const added = addHandMadeLayers(w, set);
		return { w, set, ...added };
	}

	it("una capa ligada a una propiedad de `keep` y un componente dentro que la captura no recrea: la hoja no se escribe aunque todas las variantes tengan pareja", async () => {
		const { w, set } = await withLayers();
		const before = snapshot(w);
		const result = await run(w, keepPlan());
		assert.equal(StepResultSchema.safeParse(result).success, true);
		assert.equal(snapshot(w), before, "no se escribió nada");
		assert.ok(warningCodes(result).includes("SHEET_DRIFT"));
		assert.equal(
			warningCodes(result).includes("PROPERTY_KEPT"),
			false,
			"no se llegó a repintar",
		);
		const d = driftOf(result);
		assert.equal(d["reason"], "drift");
		assert.deepEqual(d["figmaOnlyProps"], {});
		assert.deepEqual(d["figmaOnlyVariants"], []);
		const variants = set.children.map((c) => c.name).sort();
		assert.deepEqual(d["handMadeLayers"], [
			{ name: "extra", type: "FRAME", properties: ["Mostrar extra"], variants },
			{ name: "menú", type: "INSTANCE", properties: [], variants },
		]);
		assert.deepEqual(d["fingerprint"].layers, d["handMadeLayers"]);
	});

	it("un hueco hecho a mano (SLOT con su propiedad en `keep`) también es capa a mano", async () => {
		const { w, set } = await built();
		const v = set.children[0] as FakeNode;
		const slot = v.createSlot();
		v.appendChild(slot);
		slot.name = "hueco";
		const d = driftOf(await run(w, planOf({ keep: ["Slot"] })));
		assert.deepEqual(d["handMadeLayers"], [
			{ name: "hueco", type: "SLOT", properties: ["Slot"], variants: [v.name] },
		]);
	});

	it("las capas que los datos declaran, los iconos del catálogo y los componentes de `rules` no son capas a mano", async () => {
		const { w } = await built();
		const result = await run(w, planOf({}, { rules: RULES }));
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
	});

	it("el informe cuenta las instancias de las pantallas con algo en esas capas (valor de la propiedad, cambio directo, intercambio), por página y marco", async () => {
		const { w, set, show, otherMenu } = await withLayers();
		const [a, b, c] = set.children as FakeNode[];
		instanceIn(w, a as FakeNode, "Pantallas", "Inicio").setProperties({
			[show]: true,
		});
		const changed = instanceIn(w, b as FakeNode, "Pantallas", "Inicio");
		(changed.findOne((n) => n.name === "menú") as FakeNode).visible = false;
		const swapped = instanceIn(w, c as FakeNode, "Listas", "Tabla");
		(swapped.findOne((n) => n.name === "menú") as FakeNode).main = otherMenu;
		instanceIn(w, a as FakeNode, "Listas", "Tabla");
		const d = driftOf(await run(w, keepPlan()));
		assert.equal(d["usage"].total, 4);
		const u = d["handMadeUsage"];
		assert.equal(u.total, 3);
		assert.equal(u.kinds.properties, 1);
		assert.ok(u.kinds.overrides >= 1);
		assert.equal(u.kinds.swaps, 1);
		assert.equal(u.kinds.slots, 0);
		assert.deepEqual(
			u.pages.map((p: Json) => [p["page"], p["count"], p["frames"]]).sort(),
			[
				["Listas", 1, [{ name: "Tabla", count: 1 }]],
				["Pantallas", 2, [{ name: "Inicio", count: 2 }]],
			],
		);
	});

	it("lo que una instancia metió en un hueco hecho a mano cuenta como contenido", async () => {
		const { w, set } = await built();
		const v = set.children[0] as FakeNode;
		const slot = v.createSlot();
		v.appendChild(slot);
		const inst = instanceIn(w, v, "Pantallas", "Inicio");
		const inner = inst.findOne((n) => n.type === "SLOT") as FakeNode;
		w.fake.node(inner, "RECTANGLE", "mío");
		const u = driftOf(await run(w, planOf({ keep: ["Slot"] })))[
			"handMadeUsage"
		];
		assert.equal(u.total, 1);
		assert.equal(u.kinds.slots, 1);
	});

	it("el aviso del paso nombra las capas a mano y cuántas instancias tienen algo en ellas", async () => {
		const { w, set, show } = await withLayers();
		instanceIn(
			w,
			set.children[0] as FakeNode,
			"Pantallas",
			"Inicio",
		).setProperties({
			[show]: true,
		});
		const result = await run(w, keepPlan());
		const warning = (result.warnings ?? []).find(
			(x: { code: string }) => x.code === "SHEET_DRIFT",
		) as { message: string };
		assert.match(
			warning.message,
			/capas a mano: extra \(FRAME\), menú \(INSTANCE\)/,
		);
		assert.match(warning.message, /1 instancia con contenido en ellas/);
	});

	it("figma: con la huella que incluye las capas, la hoja se salta sin escribir", async () => {
		const { w } = await withLayers();
		const fp = driftOf(await run(w, keepPlan()))["fingerprint"];
		const before = snapshot(w);
		const result = await run(
			w,
			keepPlan({ drift: { decision: "figma", fingerprint: fp } }),
		);
		assert.equal(snapshot(w), before);
		assert.ok(warningCodes(result).includes("DRIFT_FIGMA_WINS"));
	});

	it("web: se repinta con consentimiento y las capas a mano de las variantes emparejadas se pierden (PROPERTY_KEPT)", async () => {
		const { w, set } = await withLayers();
		const fp = driftOf(await run(w, keepPlan()))["fingerprint"];
		const result = await run(
			w,
			keepPlan({ drift: { decision: "web", fingerprint: fp } }),
		);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
		assert.ok(warningCodes(result).includes("PROPERTY_KEPT"));
		assert.equal(
			set.findAll((n) => n.name === "extra" || n.name === "menú").length,
			0,
		);
	});

	it("una capa a mano nueva después de decidir cambia la huella: se vuelve a preguntar", async () => {
		const { w, set } = await withLayers();
		const fp = driftOf(await run(w, keepPlan()))["fingerprint"];
		const v = set.children[0] as FakeNode;
		const more = w.fake.node(v, "TEXT", "nota");
		more.componentPropertyReferences = {
			visible: Object.keys(set.componentPropertyDefinitions).find((k) =>
				k.startsWith("Mostrar extra"),
			) as string,
		};
		const result = await run(
			w,
			keepPlan({ drift: { decision: "figma", fingerprint: fp } }),
		);
		assert.equal(driftOf(result)["reason"], "fingerprint-changed");
	});
});

describe("kit/build-component@1: sobrescrituras de instancias de fuera en riesgo", () => {
	const labelKey = (set: FakeNode): string =>
		Object.keys(set.componentPropertyDefinitions).find((k) =>
			k.startsWith("contenido"),
		) as string;

	it("una instancia de otra pantalla con un cambio en una capa de dentro bloquea la hoja con overrides-at-risk y el informe dice página, marco y capas", async () => {
		const { w, plan, set } = await built();
		const inst = instanceIn(
			w,
			set.children[0] as FakeNode,
			"Pantallas",
			"Inicio",
		);
		inst.setProperties({ [labelKey(set)]: "Otro" });
		const before = snapshot(w);
		const result = await run(w, plan);
		assert.equal(snapshot(w), before, "no se escribió nada");
		assert.equal((result.report as Json)["skipped"], "drift");
		assert.ok(warningCodes(result).includes("SHEET_DRIFT"));
		const d = driftOf(result);
		assert.equal(d["reason"], "overrides-at-risk");
		assert.deepEqual(d["overridesAtRisk"], {
			total: 1,
			affected: [
				{ id: inst.id, page: "Pantallas", frame: "Inicio", layers: 1 },
			],
		});
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("un cambio solo en la raíz de la instancia sobrevive al repintado: no bloquea", async () => {
		const { w, plan, set } = await built();
		const inst = instanceIn(
			w,
			set.children[0] as FakeNode,
			"Pantallas",
			"Inicio",
		);
		Object.defineProperty(inst, "overrides", {
			get: () => [{ id: inst.id, overriddenFields: ["componentProperties"] }],
		});
		const result = await run(w, plan);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
	});

	it("sin instancias de fuera con cambios no bloquea; las de la propia página de la hoja tampoco cuentan", async () => {
		const { w, plan, set } = await built();
		instanceIn(w, set.children[0] as FakeNode, "Pantallas", "Inicio");
		const page = w.fake.root.children.find((p) => p.name === "   Button");
		const own = (set.children[1] as FakeNode).createInstance();
		(page as FakeNode).appendChild(own);
		own.setProperties({ [labelKey(set)]: "Otro" });
		const result = await run(w, plan);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
	});

	it("una decisión registrada con la huella del set autoriza el repintado aunque haya sobrescrituras en riesgo", async () => {
		const { w, plan, set } = await built();
		const inst = instanceIn(
			w,
			set.children[0] as FakeNode,
			"Pantallas",
			"Inicio",
		);
		inst.setProperties({ [labelKey(set)]: "Otro" });
		const fingerprint = driftOf(await run(w, plan))["fingerprint"];
		const result = await run(
			w,
			planOf({ drift: { decision: "web", fingerprint } }),
		);
		assert.equal(warningCodes(result).includes("SHEET_DRIFT"), false);
		assert.equal((result.report as Json)["skipped"], undefined);
	});

	it("kit.sheet.assess devuelve blocked con el informe sin escribir nada", async () => {
		const { w, plan, set } = await built();
		const inst = instanceIn(
			w,
			set.children[0] as FakeNode,
			"Pantallas",
			"Inicio",
		);
		inst.setProperties({ [labelKey(set)]: "Otro" });
		const out = await w.kit.sheet.assess(plan as never);
		assert.equal(out.verdict.kind, "blocked");
	});
});
