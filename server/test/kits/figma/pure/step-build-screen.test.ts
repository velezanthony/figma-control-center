// kit.steps.buildScreen: el plan de una pantalla pintado en su página temporal. Claves
// `fcc:screen-page:` y `fcc:screen:`, repetir vacía y vuelve a pintar, `tooLarge`, FONT_MISSING y COLLECTION_NOT_FOUND sin
// escribir nada; `report` y step@1 válidos; compatible con `kit/place@1`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { PANEL, png, warningCodes } from "../areas-support.ts";
import type { FakeNode } from "../fake-figma.ts";
import {
	catalog,
	frame,
	icons,
	img,
	planMap,
	planOf,
	recognizer,
	styles,
	text,
	world,
} from "../screen-support.ts";

const REF = "c".repeat(64);
const BIG = "d".repeat(64);
const SCREEN_KEY = "fcc:screen:inicio";
const PAGE_KEY = "fcc:screen-page:inicio";
const key = (
	n: FakeNode | { getSharedPluginData(ns: string, k: string): string },
) => n.getSharedPluginData("fcc", "key");

const root = () =>
	frame({ disp: "flex", w: 300, h: 50 }, [
		text("Hola"),
		img(REF, { w: 40, h: 20 }),
		img(BIG, { w: 40, h: 20 }),
	]);
const IMAGES = {
	[REF]: { asset: REF, width: 40, height: 20, type: "png" },
	[BIG]: { asset: BIG, width: 5000, height: 20, type: "jpeg", tooLarge: true },
};
const assetsOf = (
	plan: unknown,
	extra: Record<string, Uint8Array> = { [REF]: png(40, 20) },
) => ({
	plan: new TextEncoder().encode(JSON.stringify(plan)),
	...extra,
});
const withArea = (over: Record<string, unknown> = {}) =>
	planOf({
		root: [root()],
		images: IMAGES,
		target: {
			page: { name: "tmp Inicio", key: PAGE_KEY, after: "Panel" },
			frame: { name: "Inicio", key: SCREEN_KEY },
		},
		...over,
	});
const PARAMS = { screen: "inicio", area: "Panel", frame: "Inicio", variant: 0 };

function prepared() {
	const w = world();
	styles(w.fake);
	icons(w.fake);
	const panel = w.fake.page("Panel");
	return { w, panel };
}

describe("kit.steps.buildScreen", () => {
	it("pinta el plan en una página nueva tras la del área, con la clave de la página y del marco; cumple step@1", async () => {
		const { w, panel } = prepared();
		const result = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(withArea()),
		);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		const pages = w.fake.root.children;
		const page = pages.find((p) => p.name === "tmp Inicio");
		assert.ok(page);
		assert.equal(pages.indexOf(page), pages.indexOf(panel) + 1);
		assert.equal(key(page), PAGE_KEY);
		assert.equal(page.children.length, 1);
		const marco = page.children[0] as FakeNode;
		assert.equal(marco.name, "Inicio");
		assert.equal(key(marco), SCREEN_KEY);
		assert.ok(result.createdNodeIds.includes(page.id));
		assert.ok(result.createdNodeIds.includes(marco.id));
		// solo la página y el marco se etiquetan: nada dentro del marco lleva clave
		assert.equal(marco.descendants().filter((n) => key(n) !== "").length, 0);
	});

	it("el informe cuenta nodos, imágenes, iconos y lo que se corrigió; el aviso del plan sale tal cual", async () => {
		const { w } = prepared();
		const plan = withArea({
			warnings: [
				{ code: "IMAGE_TOO_LARGE", message: "grande", nodeId: "00000009" },
			],
		});
		const result = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(plan),
		);
		const report = result.report as Record<string, unknown>;
		assert.equal(report["screen"], "inicio");
		assert.equal(report["page"], "tmp Inicio");
		assert.equal(typeof report["frameId"], "string");
		assert.equal(report["nodes"], 4);
		assert.equal(report["images"], 1);
		assert.equal(report["icons"], 0);
		assert.deepEqual(report["matches"], []);
		assert.ok(warningCodes(result).includes("IMAGE_TOO_LARGE"));
	});

	it("repetir el paso vacía la página y vuelve a pintar: una sola página, un solo marco, el viejo declarado como quitado", async () => {
		const { w } = prepared();
		const first = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(withArea()),
		);
		const second = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(withArea()),
		);
		const pages = w.fake.root.children.filter((p) => p.name === "tmp Inicio");
		assert.equal(pages.length, 1);
		assert.equal(pages[0]?.children.length, 1);
		const old = (first.report as { frameId: string }).frameId;
		const now = (second.report as { frameId: string }).frameId;
		assert.notEqual(old, now);
		assert.ok(second.removedNodeIds?.includes(old));
	});

	it("sin área, la página lleva el nombre fijo y no se coloca tras ninguna", async () => {
		const { w } = prepared();
		const plan = withArea({
			target: {
				page: { name: "fcc · pantalla · inicio", key: PAGE_KEY },
				frame: { name: "Inicio", key: SCREEN_KEY },
			},
		});
		await w.kit.steps.buildScreen(
			{ screen: "inicio", variant: 0 } as never,
			assetsOf(plan),
		);
		assert.ok(
			w.fake.root.children.some((p) => p.name === "fcc · pantalla · inicio"),
		);
	});

	it("una página `after` que no existe: la página queda al final y se avisa", async () => {
		const { w } = prepared();
		const plan = withArea({
			target: {
				page: { name: "tmp Inicio", key: PAGE_KEY, after: "No existe" },
				frame: { name: "Inicio", key: SCREEN_KEY },
			},
		});
		const result = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(plan),
		);
		assert.ok(warningCodes(result).includes("PAGE_AFTER_NOT_FOUND"));
	});

	it("lo que falta en Figma para el paso ANTES de escribir: una colección o una fuente", async () => {
		const { w } = prepared();
		const before = w.fake.all.size;
		const noCollection = withArea({
			map: planMap({
				tokens: { ...(planMap()["tokens"] as object), collections: ["Falta"] },
			}),
		});
		await assert.rejects(
			w.kit.steps.buildScreen(PARAMS as never, assetsOf(noCollection)),
			/COLLECTION_NOT_FOUND/,
		);
		const noFont = withArea({
			map: planMap({
				fonts: { ...(planMap()["fonts"] as object), default: "Ausente Sans" },
			}),
		});
		await assert.rejects(
			w.kit.steps.buildScreen(PARAMS as never, assetsOf(noFont)),
			/FONT_MISSING/,
		);
		assert.equal(w.fake.all.size, before);
		assert.equal(
			w.fake.root.children.some((p) => p.name === "tmp Inicio"),
			false,
		);
	});

	it("un plan que no llega, que no es de esa pantalla o que no tiene nodos, para el paso con su código", async () => {
		const { w } = prepared();
		await assert.rejects(
			w.kit.steps.buildScreen(PARAMS as never, {}),
			/PLAN_MISSING/,
		);
		await assert.rejects(
			w.kit.steps.buildScreen(
				{ ...PARAMS, screen: "otra" } as never,
				assetsOf(withArea()),
			),
			/PLAN_INVALID/,
		);
		await assert.rejects(
			w.kit.steps.buildScreen(
				PARAMS as never,
				assetsOf(withArea({ root: [] })),
			),
			/PLAN_EMPTY/,
		);
	});

	it("un color sin variable se cuenta y se avisa una vez por color", async () => {
		const { w } = prepared();
		const plan = withArea({
			root: [
				frame({ bg: [1, 2, 3, 1], w: 10, h: 10 }),
				frame({ bg: [1, 2, 3, 1], w: 10, h: 10 }),
			],
		});
		const result = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(plan),
		);
		assert.equal((result.report as { untokenized: number }).untokenized, 2);
		assert.equal(
			warningCodes(result).filter((c) => c === "TOKEN_UNTOKENIZED").length,
			1,
		);
	});

	it("la pantalla pintada la toma kit/place@1 (take: first-frame): el frame del área conserva su id y la página temporal desaparece", async () => {
		const { w, panel } = prepared();
		const target = w.fake.node(panel, "FRAME", "Inicio");
		w.fake.node(target, "FRAME", "viejo");
		await w.kit.steps.buildScreen(PARAMS as never, assetsOf(withArea()));
		const area = {
			...PANEL,
			shell: undefined,
			unwrap: undefined,
			main: undefined,
			place: {
				mode: "replace-content",
				source: { pagePrefix: "tmp ", take: "first-frame", remove: true },
			},
			screens: [{ frame: "Inicio", screen: "inicio" }],
			frame: { width: 300, minHeight: 50 },
		};
		await w.kit.steps.place({
			area,
			linkRules: {
				clickable: { names: [], namePrefixes: [], components: [] },
				rows: { row: [], body: [] },
				transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
			},
			shared: [],
		} as never);
		assert.equal(
			w.fake.root.children.some((p) => p.name === "tmp Inicio"),
			false,
		);
		const kept = panel.children.find((c) => c.name === "Inicio") as FakeNode;
		assert.equal(kept.id, target.id);
		assert.equal(kept.children.length > 0, true);
		assert.equal(
			kept.children.some((c) => c.name === "viejo"),
			false,
		);
	});

	it("recognize@1: el informe lleva qué nodos son instancias y por qué regla; el módulo llega como tercer argumento", async () => {
		const { w } = prepared();
		catalog(w);
		const plan = withArea({
			root: [
				frame({ disp: "flex", w: 300, h: 50 }, [
					frame({ tag: "button", cls: "btn", w: 80, h: 32 }, [text("Ok")]),
				]),
			],
		});
		const module = recognizer({
			Boton: {
				match: (n: { tag?: string }) => n.tag === "button",
				props: () => ({ variant: { size: "sm" } }),
			},
		});
		const result = await w.kit.steps.buildScreen(
			PARAMS as never,
			assetsOf(plan),
			module,
		);
		const report = result.report as {
			instances: Record<string, number>;
			matches: { node: string; set: string; by: string }[];
		};
		assert.deepEqual(report.instances, { Boton: 1 });
		assert.equal(report.matches.length, 1);
		assert.equal(report.matches[0]?.set, "Boton");
		assert.equal(report.matches[0]?.by, "rule:Boton");
		assert.equal(StepResultSchema.safeParse(result).success, true);
	});

	it("un recognize@1 que no cumple la forma para el paso ANTES de escribir: ni página ni nodos", async () => {
		const { w } = prepared();
		const before = w.fake.all.size;
		await assert.rejects(
			w.kit.steps.buildScreen(PARAMS as never, assetsOf(withArea()), {
				contract: "recognize@1",
			}),
			/RECOGNIZE_INVALID/,
		);
		assert.equal(w.fake.all.size, before);
		assert.equal(
			w.fake.root.children.some((p) => p.name === "tmp Inicio"),
			false,
		);
	});

	it("repetir el paso no borra los componentes y sets que viven en la página: solo vacía lo pintado", async () => {
		const { w } = prepared();
		await w.kit.steps.buildScreen(PARAMS as never, assetsOf(withArea()));
		const page = w.fake.root.children.find(
			(p) => p.name === "tmp Inicio",
		) as FakeNode;
		const set = w.fake.componentSet(page, "Bandera", [{ pais: "es" }]);
		await w.kit.steps.buildScreen(PARAMS as never, assetsOf(withArea()));
		assert.equal(set.removed, false);
		assert.ok(page.children.includes(set));
		assert.equal(page.children.filter((c) => c.type === "FRAME").length, 1);
	});
});
