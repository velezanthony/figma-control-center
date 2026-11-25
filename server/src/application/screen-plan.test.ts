import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS_CONTRACT, type AreasFile } from "#domain/areas.ts";
import { CONTRACT } from "#domain/capture.ts";
import type { MapFile } from "#domain/map.ts";
import { mapExample } from "../../test/contracts/map.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import { makeScreenPlan } from "./screen-plan.ts";
import {
	InMemoryWebCaptureStore,
	projectWith,
} from "./testing/in-memory-web-capture.ts";

const IMG = "1".repeat(64);
const BIG = "2".repeat(64);
const MAP = structuredClone(mapExample()) as MapFile;

const node = (id: string, extra: Record<string, unknown>) => ({
	id,
	path: id,
	w: 10,
	h: 10,
	...extra,
});

const capture = (screen = "inicio", extra: Record<string, unknown> = {}) => ({
	contract: CONTRACT.capture,
	screen,
	title: "Inicio",
	source: { capturedAt: "2026-11-12T10:00:00.000+01:00" },
	variants: [
		{
			props: { rol: "a" },
			nodes: [
				node("00000001", {
					t: "frame",
					kids: [
						node("00000002", {
							t: "svg",
							svg: '<svg><path d="M0 0"/></svg>',
							key: "M0 0",
						}),
						node("00000003", {
							t: "svg",
							svg: '<svg><path d="M9 9"/></svg>',
							key: "M9 9",
						}),
						node("00000004", { t: "img", ref: IMG }),
						node("00000005", { t: "img", ref: BIG }),
					],
				}),
			],
			annotations: [],
		},
		{ props: { rol: "b" }, nodes: [], annotations: [] },
	],
	images: {
		[IMG]: { path: `img/${IMG}.png`, width: 40, height: 20, type: "png" },
		[BIG]: { path: `img/${BIG}.jpg`, width: 5000, height: 20, type: "jpeg" },
	},
	warnings: [],
	...extra,
});

const AREAS: AreasFile = {
	contract: AREAS_CONTRACT,
	linkRules: {
		clickable: { names: [], namePrefixes: [], components: [] },
		rows: { row: ["fila de tabla"], body: ["cuerpo inventado"] },
		transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
	},
	areas: [
		{
			name: "Panel",
			page: "Panel",
			frame: { width: 100, minHeight: 100 },
			place: {
				mode: "replace-content",
				source: { pagePrefix: "tmp ", take: "first-frame" },
			},
			main: ["contenido principal"],
			screens: [{ frame: "Portada", screen: "inicio" }, { frame: "Otra" }],
		},
	],
};

const project = (over: Partial<LoadedProject> = {}): LoadedProject => ({
	...projectWith(
		[{ key: "inicio", title: "Inicio", url: "/" }],
		{},
		null,
		AREAS,
		{},
		{
			map: MAP,
			mapSource: { path: "/p/map.json", sha256: "m".repeat(64), text: "{}" },
			iconCatalog: [{ name: "plus", svg: '<svg><path d="M0 0"/></svg>' }],
		},
	),
	...over,
});

async function setup(options: { json?: string; issues?: boolean } = {}) {
	const store = new InMemoryWebCaptureStore();
	if (options.json !== "none")
		await store.saveCapture(
			"inicio",
			options.json ?? JSON.stringify(capture()),
		);
	const make = () =>
		makeScreenPlan({
			store,
			clock: () => new Date("2026-11-12T09:00:00Z"),
			checkCapture: () =>
				options.issues === true
					? [{ pointer: "/variants", message: "mal" }]
					: [],
		});
	return { store, plan: make() };
}

const ok = (
	r: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["plan"]>>,
) => {
	assert.equal(r.kind, "ok", JSON.stringify(r));
	if (r.kind !== "ok") throw new Error();
	return r.run;
};

describe("plan de una pantalla (screen@1)", () => {
	it("sale de la última captura válida: nodos de la variante, props, fuentes y destino con área", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio", area: "Panel" }));
		assert.equal(run.plan.contract, "screen@1");
		assert.equal(run.plan.screen, "inicio");
		assert.equal(run.plan.variant, 0);
		assert.deepEqual(run.plan.props, { rol: "a" });
		assert.equal(run.plan.root.length, 1);
		assert.equal(
			run.plan.sources.capture.path,
			"2026-11-11/inicio_100000.json",
		);
		assert.match(run.plan.sources.capture.sha256, /^[0-9a-f]{64}$/);
		assert.deepEqual(run.plan.sources.map, {
			path: "/p/map.json",
			sha256: "m".repeat(64),
		});
		assert.deepEqual(run.plan.target, {
			page: {
				name: "tmp Portada",
				key: "fcc:screen-page:inicio",
				after: "Panel",
			},
			frame: { name: "Portada", key: "fcc:screen:inicio" },
		});
		assert.deepEqual(run.params, {
			screen: "inicio",
			area: "Panel",
			frame: "Portada",
			variant: 0,
		});
	});

	it("sin área, la página lleva el nombre fijo del kit y el marco el título de la pantalla", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio" }));
		assert.equal(run.plan.target.page.name, "fcc · pantalla · inicio");
		assert.equal(run.plan.target.page.after, undefined);
		assert.equal(run.plan.target.frame.name, "Inicio");
	});

	it("la parte de map@1 que usa el kit va dentro, sin la ruta del catálogo", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio" }));
		assert.equal(run.plan.map.fonts.default, "Fuente Sans");
		assert.equal("catalog" in run.plan.map.icons, false);
		assert.equal(run.plan.map.icons.prefix, "icons/");
	});

	describe("reconocimiento (F4b)", () => {
		const FP = (title: string) => ({ title, tag: "div", cls: ["x"] });
		const MAP_RECOGNIZE = {
			...MAP,
			components: {
				fingerprints: "fp.json",
				leaf: ["a.b"],
				genericClasses: ["flex", "items-\\S+"],
			},
			screens: { inicio: { rules: ["Button"] }, otra: { rules: ["Tab"] } },
		} as MapFile;
		const SOURCE = '{ contract: "recognize@1", rules: {} }';
		const recognizing = () =>
			project({
				map: MAP_RECOGNIZE,
				fingerprints: { "a.b": FP("A"), "c.d": FP("C") },
				recognize: {
					path: "/p/recognize.js",
					source: SOURCE,
					sha256: "r".repeat(64),
				},
			});

		it("el plan lleva solo las huellas de los componentes hoja, las reglas de su pantalla y las clases genéricas", async () => {
			const { plan } = await setup();
			const run = ok(await plan(recognizing(), { screen: "inicio" }));
			assert.deepEqual(Object.keys(run.plan.fingerprints ?? {}), ["a.b"]);
			assert.deepEqual(run.plan.rules, ["Button"]);
			assert.deepEqual(run.plan.map.components, {
				genericClasses: ["flex", "items-\\S+"],
			});
			assert.equal("screens" in run.plan.map, false);
		});

		it("sin reglas declaradas para la pantalla, el plan no limita (no lleva `rules`)", async () => {
			const { plan } = await setup();
			const proj = recognizing();
			const run = ok(
				await plan(
					{ ...proj, map: { ...MAP_RECOGNIZE, screens: {} } as MapFile },
					{ screen: "inicio" },
				),
			);
			assert.equal(run.plan.rules, undefined);
		});

		it("el hash de recognize va en `sources`; su texto y su ruta, para el intento y para el código del paso", async () => {
			const { plan } = await setup();
			const run = ok(await plan(recognizing(), { screen: "inicio" }));
			assert.deepEqual(run.plan.sources.recognize, { sha256: "r".repeat(64) });
			assert.equal(run.recognizeSource, SOURCE);
			assert.deepEqual(run.contents.recognize, {
				path: "/p/recognize.js",
				content: SOURCE,
			});
		});

		it("sin recognize ni huellas el plan es el de antes: nada de F4b", async () => {
			const { plan } = await setup();
			const run = ok(await plan(project(), { screen: "inicio" }));
			assert.equal(run.plan.fingerprints, undefined);
			assert.equal(run.plan.rules, undefined);
			assert.equal(run.plan.sources.recognize, undefined);
			assert.equal(run.plan.map.components, undefined);
			assert.equal(run.recognizeSource, null);
			assert.equal(run.contents.recognize, undefined);
		});

		it("el plan con reconocimiento sigue cumpliendo screen@1 (recognize no cambia el hash de la captura ni del mapa)", async () => {
			const { plan } = await setup();
			const a = ok(await plan(project(), { screen: "inicio" }));
			const b = ok(await plan(recognizing(), { screen: "inicio" }));
			assert.equal(
				b.plan.sources.capture.sha256,
				a.plan.sources.capture.sha256,
			);
		});
	});

	it("las imágenes de la variante llevan su tamaño; una de más de 4096 px se marca y avisa, y no va como asset", async () => {
		const { plan, store } = await setup();
		const run = ok(await plan(project(), { screen: "inicio" }));
		assert.deepEqual(run.plan.images[IMG], {
			asset: IMG,
			width: 40,
			height: 20,
			type: "png",
		});
		assert.equal(run.plan.images[BIG]?.tooLarge, true);
		assert.deepEqual(Object.keys(run.assets).sort(), ["plan", IMG].sort());
		assert.equal(
			run.assets[IMG],
			store.imageFile({ sha256: IMG, type: "png" }),
		);
		assert.equal(run.assets["plan"], run.planPath);
		const warning = run.plan.warnings.find((w) => w.code === "IMAGE_TOO_LARGE");
		assert.equal(warning?.nodeId, "00000005");
	});

	it("el mapa de iconos lleva solo los svg del catálogo; el que no está avisa ICON_KEY_UNKNOWN", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio" }));
		assert.deepEqual(run.plan.icons, { "M0 0": "plus" });
		const warning = run.plan.warnings.find(
			(w) => w.code === "ICON_KEY_UNKNOWN",
		);
		assert.equal(warning?.nodeId, "00000003");
	});

	it("un nombre de capa de areas@1 que no sale de layers.roles es aviso LAYER_NAME_UNKNOWN, no error", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio", area: "Panel" }));
		const unknown = run.plan.warnings
			.filter((w) => w.code === "LAYER_NAME_UNKNOWN")
			.map((w) => w.message);
		assert.equal(unknown.length, 3);
		assert.ok(unknown.some((m) => m.includes("cuerpo inventado")));
		assert.ok(unknown.some((m) => m.includes("fila de tabla")));
		assert.ok(unknown.some((m) => m.includes("contenido principal")));
	});

	it("el plan se guarda en screen-plans/ y su ruta es la del asset `plan`", async () => {
		const { plan, store } = await setup();
		const run = ok(await plan(project(), { screen: "inicio" }));
		assert.equal(
			JSON.parse(store.plans.get(run.planPath) ?? "{}").screen,
			"inicio",
		);
	});

	it("la variante pedida se usa; una que no existe es error de uso", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { screen: "inicio", variant: 1 }));
		assert.deepEqual(run.plan.props, { rol: "b" });
		const bad = await plan(project(), { screen: "inicio", variant: 2 });
		assert.equal(bad.kind, "usage");
		assert.match(bad.kind === "usage" ? bad.message : "", /variante 2/);
	});

	it("`capture` fija una captura concreta; si no existe, error de uso", async () => {
		const { plan, store } = await setup();
		await store.saveCapture(
			"inicio",
			JSON.stringify(capture("inicio", { title: "Nueva" })),
		);
		assert.equal(
			ok(await plan(project(), { screen: "inicio" })).plan.title,
			"Nueva",
		);
		const first = ok(
			await plan(project(), {
				screen: "inicio",
				capture: "2026-11-11/inicio_100000.json",
			}),
		);
		assert.equal(first.plan.title, "Inicio");
		const bad = await plan(project(), {
			screen: "inicio",
			capture: "2026-11-11/nada.json",
		});
		assert.equal(bad.kind, "usage");
	});

	it("sin captura válida: error de uso que dice qué hacer", async () => {
		const { plan } = await setup({ json: "none" });
		const r = await plan(project(), { screen: "inicio" });
		assert.equal(r.kind, "usage");
		assert.match(r.kind === "usage" ? r.message : "", /figma_capture/);
		assert.match(r.kind === "usage" ? r.message : "", /«inicio»/);
	});

	it("una captura que ya no cumple capture@1 es error de uso con el puntero", async () => {
		const { plan } = await setup({ issues: true });
		const r = await plan(project(), { screen: "inicio" });
		assert.equal(r.kind, "usage");
		assert.match(r.kind === "usage" ? r.message : "", /\/variants/);
	});

	it("sin `map` en project@1: ProjectConfigError con el campo `map`", async () => {
		const { plan } = await setup();
		const r = await plan(project({ map: null, mapSource: null }), {
			screen: "inicio",
		});
		assert.equal(r.kind, "error");
		assert.equal(
			r.kind === "error" &&
				r.error.type === "ProjectConfigError" &&
				r.error.field,
			"map",
		);
	});

	it("una pantalla que no está en screens@1, un área desconocida o una pantalla que no está en el área son error de uso", async () => {
		const { plan } = await setup();
		assert.equal((await plan(project(), { screen: "nada" })).kind, "usage");
		assert.equal(
			(await plan(project(), { screen: "inicio", area: "Nada" })).kind,
			"usage",
		);
		const other = project({
			screens: {
				contract: CONTRACT.screens,
				screens: [{ key: "otra", title: "Otra", url: "/o" }],
			},
		});
		const store = new InMemoryWebCaptureStore();
		await store.saveCapture("otra", JSON.stringify(capture("otra")));
		const r = await makeScreenPlan({
			store,
			clock: () => new Date(),
			checkCapture: () => [],
		})(other, { screen: "otra", area: "Panel" });
		assert.equal(r.kind, "usage");
		assert.match(
			r.kind === "usage" ? r.message : "",
			/no está en el área «Panel»/,
		);
	});
});
