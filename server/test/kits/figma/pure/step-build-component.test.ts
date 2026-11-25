// kit.steps.buildComponent: el plan de una hoja pintado en su página (o en la aparte). Claves
// `fcc:sheet-page:`, `fcc:sheet:` y `fcc:sheet-scratch:`; FONT_MISSING, COLLECTION_NOT_FOUND y VARIABLE_NOT_FOUND sin
// escribir nada; `report` y step@1 válidos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { warningCodes } from "../areas-support.ts";
import type { FakeNode } from "../fake-figma.ts";
import { styles } from "../screen-support.ts";
import {
	assetsOf,
	key,
	PAGE_KEY,
	SCRATCH_KEY,
	SET_KEY,
	sheetPlanOf,
	sheetWorld,
} from "../sheet-support.ts";

const PARAMS = { sheet: "button", scratch: false };
const SCRATCH = {
	page: { name: "fcc · hoja · button", key: SCRATCH_KEY },
	set: { name: "Button", key: SET_KEY },
};

describe("kit.steps.buildComponent", () => {
	it("pinta la hoja en una página nueva con las claves de la página y del set; cumple step@1", async () => {
		const w = sheetWorld();
		styles(w.fake);
		const plan = sheetPlanOf();
		const result = await w.kit.steps.buildComponent(
			PARAMS as never,
			assetsOf(plan),
		);
		assert.equal(StepResultSchema.safeParse(result).success, true);
		const page = w.fake.root.children.find((p) => p.name === "   Button");
		assert.ok(page);
		assert.equal(key(page), PAGE_KEY);
		const set = page.findOne((n) => n.type === "COMPONENT_SET") as FakeNode;
		assert.equal(key(set), SET_KEY);
		assert.ok(result.createdNodeIds.includes(page.id));
		assert.ok(result.createdNodeIds.includes(set.id));
		for (const v of set.children)
			assert.ok(result.createdNodeIds.includes(v.id));
		// solo la página, el set y las variantes llevan clave: nada dentro de una variante
		const inside = set.children
			.flatMap((v) => v.descendants())
			.filter((n) => key(n) !== "");
		assert.equal(inside.length, 0);
	});

	it("el informe cuenta variantes y propiedades; los avisos del plan salen tal cual", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: { texts: [{ name: "contenido", match: "Botón" }] },
		}) as {
			warnings: unknown[];
		};
		plan.warnings = [
			{ code: "IMAGE_TOO_LARGE", message: "grande", nodeId: "00000009" },
		];
		const result = await w.kit.steps.buildComponent(
			PARAMS as never,
			assetsOf(plan),
		);
		const report = result.report as Record<string, unknown>;
		assert.equal(report["sheet"], "button");
		assert.equal(report["page"], "   Button");
		assert.equal(typeof report["setId"], "string");
		assert.deepEqual(report["variants"], { created: 3, updated: 0, kept: 0 });
		assert.deepEqual(report["properties"], { created: 1, updated: 0, kept: 0 });
		assert.deepEqual(report["instances"], { before: 0, after: 0 });
		assert.deepEqual(report["matches"], []);
		assert.ok(warningCodes(result).includes("IMAGE_TOO_LARGE"));
	});

	it("rehacer la hoja de verdad: el informe cuenta variantes actualizadas e instancias de fuera, no crea otra página ni otro set y cumple step@1", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			sheet: { texts: [{ name: "contenido", match: "Botón" }] },
		});
		const first = await w.kit.steps.buildComponent(
			PARAMS as never,
			assetsOf(plan),
		);
		const set = w.fake.root.children
			.find((p) => p.name === "   Button")
			?.findOne((n) => n.type === "COMPONENT_SET") as FakeNode;
		w.fake
			.page("Otra")
			.appendChild((set.children[0] as FakeNode).createInstance());
		const second = await w.kit.steps.buildComponent(
			PARAMS as never,
			assetsOf(plan),
		);
		assert.equal(StepResultSchema.safeParse(second).success, true);
		const report = second.report as Record<string, unknown>;
		assert.equal(report["setId"], (first.report as { setId: string }).setId);
		assert.deepEqual(report["variants"], { created: 0, updated: 3, kept: 0 });
		assert.deepEqual(report["properties"], { created: 0, updated: 0, kept: 0 });
		assert.deepEqual(report["instances"], { before: 1, after: 1 });
		assert.deepEqual(report["overrides"], { before: 0, after: 0 });
		assert.equal(
			w.fake.root.children.filter((p) => p.name === "   Button").length,
			1,
		);
		// lo que cambia es lo de dentro; el set no es nuevo, y lo que se quitó (cabecera, tarjeta vieja y lo de dentro de las variantes) va declarado
		assert.equal(second.createdNodeIds.includes(set.id), false);
		assert.ok((second.removedNodeIds ?? []).length > 0);
	});

	it("scratch: la página aparte, repetir la vacía y vuelve a pintar; el viejo, declarado como quitado", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({ target: SCRATCH });
		const p = { sheet: "button", scratch: true };
		const first = await w.kit.steps.buildComponent(p as never, assetsOf(plan));
		const second = await w.kit.steps.buildComponent(p as never, assetsOf(plan));
		const pages = w.fake.root.children.filter(
			(x) => x.name === "fcc · hoja · button",
		);
		assert.equal(pages.length, 1);
		assert.equal(key(pages[0] as FakeNode), SCRATCH_KEY);
		const oldSet = (first.report as { setId: string }).setId;
		const newSet = (second.report as { setId: string }).setId;
		assert.notEqual(oldSet, newSet);
		// lo que colgaba de la página (cabecera y tarjeta, que lleva el set) se declara quitado
		const oldTop = first.createdNodeIds.filter(
			(id) => !second.createdNodeIds.includes(id),
		);
		assert.ok(oldTop.length > 0);
		assert.ok(second.removedNodeIds?.some((id) => oldTop.includes(id)));
	});

	it("una fuente que falta, una colección que falta o una variable de style que falta paran el paso sin escribir nada", async () => {
		const noFonts = sheetWorld();
		noFonts.fake.loadedFontsToLoad.clear();
		noFonts.fake.loadedFontsToLoad.add("Otra/Regular");
		const plan = sheetPlanOf();
		const pages = (w: ReturnType<typeof sheetWorld>) =>
			w.fake.root.children.length;
		const before = pages(noFonts);
		await assert.rejects(
			noFonts.kit.steps.buildComponent(PARAMS as never, assetsOf(plan)),
			/FONT_MISSING/,
		);
		assert.equal(pages(noFonts), before);

		const noCollection = sheetWorld();
		const bad = sheetPlanOf() as { map: { tokens: { collections: string[] } } };
		bad.map.tokens.collections = ["Base", "No existe"];
		const b = pages(noCollection);
		await assert.rejects(
			noCollection.kit.steps.buildComponent(PARAMS as never, assetsOf(bad)),
			/COLLECTION_NOT_FOUND/,
		);
		assert.equal(pages(noCollection), b);

		const noVariable = sheetWorld();
		const worse = sheetPlanOf() as { style: { header: { fill: string } } };
		worse.style.header.fill = "no/existe";
		const c = pages(noVariable);
		await assert.rejects(
			noVariable.kit.steps.buildComponent(PARAMS as never, assetsOf(worse)),
			/VARIABLE_NOT_FOUND/,
		);
		assert.equal(pages(noVariable), c);
	});

	it("sin el asset `plan`, o con el plan de otra hoja, para el paso con un siguiente paso", async () => {
		const w = sheetWorld();
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, {}),
			/PLAN_MISSING/,
		);
		const other = sheetPlanOf({ sheet: { key: "otra" } });
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(other)),
			/PLAN_INVALID/,
		);
		const empty = sheetPlanOf({ variants: [] });
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(empty)),
			/PLAN_EMPTY/,
		);
	});

	it("una variante sin nodos (captura de una página vacía o de error) para el paso antes de escribir (PLAN_VARIANT_EMPTY)", async () => {
		const w = sheetWorld();
		const plan = sheetPlanOf({
			variants: [
				{ props: { variant: "primary", size: "sm" }, root: [] },
				{ props: { variant: "primary", size: "lg" }, root: [] },
			],
		});
		const before = w.fake.root.children.length;
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(plan)),
			/PLAN_VARIANT_EMPTY/,
		);
		assert.equal(w.fake.root.children.length, before);
	});

	it("si el pintado falla a medias, no quedan en la página la cabecera, la tarjeta ni las variantes ya pintadas", async () => {
		const w = sheetWorld();
		styles(w.fake);
		const real = w.fake.createComponentFromNode.bind(w.fake);
		let calls = 0;
		w.fake.createComponentFromNode = (n: never) => {
			calls += 1;
			if (calls === 2) throw new Error("in resize: falla a propósito");
			return real(n);
		};
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(sheetPlanOf())),
			/falla a propósito/,
		);
		const page = w.fake.root.children.find((p) => p.name === "   Button");
		assert.deepEqual(
			(page?.children ?? []).map((n) => `${n.type} ${n.name}`),
			[],
		);
	});

	it("un módulo recognize@1 mal formado para el paso antes de escribir (RECOGNIZE_INVALID)", async () => {
		const w = sheetWorld();
		const before = w.fake.root.children.length;
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(sheetPlanOf()), {
				contract: "otro",
			}),
			/RECOGNIZE_INVALID/,
		);
		assert.equal(w.fake.root.children.length, before);
	});

	it("Figma rechaza loadFontAsync con un valor que no es un Error (como con «Semi Bold» mal escrito): el paso falla con FONT_MISSING y un mensaje, no con una promesa sin capturar", async () => {
		const w = sheetWorld();
		w.fake.loadFontAsync = () => Promise.reject({ detail: "style not found" });
		const before = w.fake.root.children.length;
		await assert.rejects(
			w.kit.steps.buildComponent(PARAMS as never, assetsOf(sheetPlanOf())),
			/FONT_MISSING/,
		);
		assert.equal(w.fake.root.children.length, before);
	});
});
