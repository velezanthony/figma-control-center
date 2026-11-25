import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRACT, type Screen } from "#domain/capture.ts";
import type { Fingerprints, MapFile } from "#domain/map.ts";
import {
	SHEETS_CONTRACT,
	type Sheet,
	type SheetsFile,
} from "#domain/sheets.ts";
import { mapExample } from "../../test/contracts/map.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import { makeSheetPlan } from "./sheet-plan.ts";
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

const capture = (screen = "cmp-button") => ({
	contract: CONTRACT.capture,
	screen,
	title: "Button",
	source: { capturedAt: "2026-11-12T10:00:00.000+01:00" },
	variants: [
		{
			props: { variant: "primary", size: "sm" },
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
					],
				}),
			],
			annotations: [],
		},
		{
			props: { variant: "primary", size: "lg" },
			nodes: [
				node("00000005", {
					t: "frame",
					kids: [node("00000006", { t: "img", ref: BIG })],
				}),
			],
			annotations: [],
		},
		{
			props: { variant: "danger", size: "sm" },
			nodes: [node("00000007", { t: "frame", kids: [] })],
			annotations: [],
		},
	],
	images: {
		[IMG]: { path: `img/${IMG}.png`, width: 40, height: 20, type: "png" },
		[BIG]: { path: `img/${BIG}.jpg`, width: 5000, height: 20, type: "jpeg" },
	},
	warnings: [],
});

const SHEET: Sheet = {
	key: "button",
	screen: "cmp-button",
	title: "Button",
	page: { name: "   Button", after: "   Badge", section: "Atomos" },
	description: "d",
	matrix: { rows: ["variant"] },
	rules: ["Badge"],
};
const SHEETS: SheetsFile = {
	contract: SHEETS_CONTRACT,
	style: {
		header: { fill: "a", text: "b" },
		card: { fill: "c" },
		texts: {
			description: "d",
			bug: "e",
			tag: "f",
			rowLabel: "g",
			colLabel: "h",
		},
		matrix: { stroke: "i" },
	},
	sheets: [
		SHEET,
		{
			key: "badge",
			screen: "cmp-badge",
			title: "Badge",
			page: { name: "   Badge" },
			description: "x",
		},
	],
};
const SCREENS: Screen[] = [
	{ key: "cmp-button", title: "Button", url: "/g/button/raw/" },
	{ key: "cmp-badge", title: "Badge", url: "/g/badge/raw/" },
];
const FPS: Fingerprints = {
	"atoms.ui.button": { title: "Button", tag: "button", cls: ["btn"] },
	"atoms.ui.badge": { title: "Badge", tag: "span", cls: ["badge"] },
	"atoms.ui.huerfano": { title: "Sin hoja", tag: "i", cls: ["x"] },
};
const RECOGNIZE = "module = { rules: { Badge: {} } }";

const project = (over: Partial<LoadedProject> = {}): LoadedProject => ({
	...projectWith(
		SCREENS,
		{},
		null,
		null,
		{},
		{
			map: {
				...MAP,
				components: {
					fingerprints: "f.json",
					leaf: ["atoms.ui.button", "atoms.ui.badge", "atoms.ui.huerfano"],
					genericClasses: [],
				},
			},
			mapSource: { path: "/p/map.json", sha256: "m".repeat(64), text: "{}" },
			iconCatalog: [{ name: "plus", svg: '<svg><path d="M0 0"/></svg>' }],
			fingerprints: FPS,
			recognize: {
				path: "/p/recognize.js",
				source: RECOGNIZE,
				sha256: "r".repeat(64),
			},
			sheets: SHEETS,
			sheetsSource: {
				path: "/p/sheets.json",
				sha256: "s".repeat(64),
				text: "{}",
			},
		},
	),
	...over,
});

async function setup(options: { none?: boolean; issues?: boolean } = {}) {
	const store = new InMemoryWebCaptureStore();
	if (options.none !== true)
		await store.saveCapture("cmp-button", JSON.stringify(capture()));
	const plan = makeSheetPlan({
		store,
		clock: () => new Date("2026-11-12T09:00:00Z"),
		checkCapture: () =>
			options.issues === true ? [{ pointer: "/variants", message: "mal" }] : [],
	});
	return { store, plan };
}

const ok = (
	r: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>["plan"]>>,
) => {
	assert.equal(r.kind, "ok", JSON.stringify(r));
	if (r.kind !== "ok") throw new Error();
	return r.run;
};

describe("plan de una hoja (component@1)", () => {
	it("sale de la última captura válida: variantes en orden, hoja, estilo, fuentes y destino", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		const p = run.plan;
		assert.equal(p.contract, "component@1");
		assert.equal(p.sheet.key, "button");
		assert.deepEqual(p.style, SHEETS.style);
		assert.deepEqual(
			p.variants.map((v) => v.props),
			[
				{ variant: "primary", size: "sm" },
				{ variant: "primary", size: "lg" },
				{ variant: "danger", size: "sm" },
			],
		);
		assert.match(p.sources.capture.path, /^2026-11-11\/cmp-button_/);
		assert.deepEqual(p.sources.sheets, {
			path: "/p/sheets.json",
			sha256: "s".repeat(64),
		});
		assert.deepEqual(p.sources.map, {
			path: "/p/map.json",
			sha256: "m".repeat(64),
		});
		assert.deepEqual(p.sources.recognize, { sha256: "r".repeat(64) });
		assert.deepEqual(p.target, {
			page: {
				name: "   Button",
				key: "fcc:sheet-page:button",
				after: "   Badge",
				section: "Atomos",
			},
			set: { name: "Button", key: "fcc:sheet:button" },
		});
	});

	it("sin `section`, la página va a la sección por defecto de sheets@1 (default: true); con `after` o `section` propios no se toca", async () => {
		const { plan } = await setup();
		const p = project({
			sheets: {
				...SHEETS,
				sections: { Atomos: { default: true }, Moleculas: {} },
				sheets: [
					{ ...SHEET, page: { name: "   Button" } },
					...SHEETS.sheets.slice(1),
				],
			},
		});
		const page = ok(await plan(p, { sheet: "button" })).plan.target.page;
		assert.equal(page.section, "Atomos");
		const own = ok(await plan(project(), { sheet: "button" })).plan.target.page;
		assert.equal(own.section, "Atomos");
		assert.equal(own.after, "   Badge");
	});

	it("scratch apunta a la página aparte, sin after ni section", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button", scratch: true }));
		assert.deepEqual(run.plan.target.page, {
			name: "fcc · hoja · button",
			key: "fcc:sheet-scratch:button",
		});
		assert.equal(run.plan.target.set.key, "fcc:sheet:button");
		assert.deepEqual(run.params, { sheet: "button", scratch: true });
	});

	it("las etiquetas de la matriz salen de las variantes y de matrix.rows", async () => {
		const { plan } = await setup();
		const { matrix } = ok(await plan(project(), { sheet: "button" })).plan;
		assert.deepEqual(matrix.rows, ["variant=primary", "variant=danger"]);
		assert.deepEqual(matrix.columns, ["size=sm", "size=lg"]);
		assert.deepEqual(matrix.cells, [[0, 1], [2]]);
	});

	it("imágenes de todas las variantes con tooLarge, y un asset por imagen válida", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		assert.deepEqual(Object.keys(run.plan.images).sort(), [IMG, BIG].sort());
		assert.equal(run.plan.images[BIG]?.tooLarge, true);
		assert.deepEqual(Object.keys(run.assets).sort(), ["plan", IMG].sort());
		assert.deepEqual(
			run.plan.warnings
				.filter((w) => w.code === "IMAGE_TOO_LARGE")
				.map((w) => w.nodeId),
			["00000006"],
		);
	});

	it("iconos del catálogo por su clave y aviso ICON_KEY_UNKNOWN para el que no está", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		assert.deepEqual(run.plan.icons, { "M0 0": "plus" });
		assert.deepEqual(
			run.plan.warnings
				.filter((w) => w.code === "ICON_KEY_UNKNOWN")
				.map((w) => w.nodeId),
			["00000003"],
		);
	});

	it("las reglas son las de la hoja", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		assert.deepEqual(run.plan.rules, ["Badge"]);
	});

	it("las huellas del plan incluyen la del propio set: compite y, si gana, no instancia; quitarla haría ganar a la siguiente (KPI card frente a Filter select)", async () => {
		const { plan } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		assert.deepEqual(Object.keys(run.plan.fingerprints ?? {}).sort(), [
			"atoms.ui.badge",
			"atoms.ui.button",
			"atoms.ui.huerfano",
		]);
	});

	it("una hoja sin `rules` no prueba ninguna regla (como un META sin nest)", async () => {
		const { plan } = await setup();
		const p = project({
			sheets: {
				...SHEETS,
				sheets: [{ ...SHEET, rules: undefined }, ...SHEETS.sheets.slice(1)],
			},
		});
		assert.deepEqual(ok(await plan(p, { sheet: "button" })).plan.rules, []);
	});

	it("avisa FINGERPRINT_WITHOUT_SHEET de una huella cuyo título no es de ninguna hoja", async () => {
		const { plan } = await setup();
		const w = ok(
			await plan(project(), { sheet: "button" }),
		).plan.warnings.filter((x) => x.code === "FINGERPRINT_WITHOUT_SHEET");
		assert.equal(w.length, 1);
		assert.match(w[0]?.message ?? "", /Sin hoja/);
	});

	it("avisa RULE_UNNAMED de una regla que recognize.js no nombra", async () => {
		const { plan } = await setup();
		const p = project({
			sheets: {
				...SHEETS,
				sheets: [
					{ ...SHEET, rules: ["Badge", "Fantasma"] },
					...SHEETS.sheets.slice(1),
				],
			},
		});
		const w = ok(await plan(p, { sheet: "button" })).plan.warnings.filter(
			(x) => x.code === "RULE_UNNAMED",
		);
		assert.equal(w.length, 1);
		assert.match(w[0]?.message ?? "", /Fantasma/);
	});

	it("deja el plan en sheet-plans/ y lo da como asset junto al texto del recognize", async () => {
		const { plan, store } = await setup();
		const run = ok(await plan(project(), { sheet: "button" }));
		assert.match(run.planPath, /\/salida\/sheet-plans\/2026-11-11\/button_/);
		assert.equal(store.sheetPlans.get(run.planPath), JSON.stringify(run.plan));
		assert.equal(run.assets["plan"], run.planPath);
		assert.equal(run.recognizeSource, RECOGNIZE);
		assert.equal(run.contents.sheets.content, "{}");
		assert.equal(run.contents.map.path, "/p/map.json");
	});

	it("una captura concreta se pinta en vez de la última", async () => {
		const { plan, store } = await setup();
		await store.saveCapture(
			"cmp-button",
			JSON.stringify({ ...capture(), title: "Otra" }),
		);
		const first = [...store.captures.keys()][0] ?? "";
		const run = ok(
			await plan(project(), {
				sheet: "button",
				capture: first.replace("/salida/web-captures/", ""),
			}),
		);
		assert.equal(
			run.plan.sources.capture.path,
			first.replace("/salida/web-captures/", ""),
		);
	});

	it("sin `sheets` en el proyecto es ProjectConfigError con el campo", async () => {
		const { plan } = await setup();
		const r = await plan(project({ sheets: null, sheetsSource: null }), {
			sheet: "button",
		});
		assert.equal(r.kind, "error");
		assert.equal(
			r.kind === "error" &&
				r.error.type === "ProjectConfigError" &&
				r.error.field,
			"sheets",
		);
	});

	it("sin `map` es ProjectConfigError con el campo map", async () => {
		const { plan } = await setup();
		const r = await plan(project({ map: null, mapSource: null }), {
			sheet: "button",
		});
		assert.equal(
			r.kind === "error" &&
				r.error.type === "ProjectConfigError" &&
				r.error.field,
			"map",
		);
	});

	it("una hoja desconocida, sin captura o con una captura que ya no cumple es error de uso", async () => {
		const a = await setup();
		const unknown = await a.plan(project(), { sheet: "fantasma" });
		assert.equal(unknown.kind, "usage");
		assert.match(
			unknown.kind === "usage" ? unknown.message : "",
			/button, badge/,
		);
		const b = await setup({ none: true });
		const none = await b.plan(project(), { sheet: "button" });
		assert.equal(none.kind, "usage");
		assert.match(none.kind === "usage" ? none.message : "", /figma_capture/);
		const c = await setup({ issues: true });
		const bad = await c.plan(project(), { sheet: "button" });
		assert.equal(bad.kind, "usage");
		assert.match(bad.kind === "usage" ? bad.message : "", /capture@1/);
	});

	it("sin recognize no hay fuente ni avisos de reglas", async () => {
		const { plan } = await setup();
		const run = ok(
			await plan(project({ recognize: null }), { sheet: "button" }),
		);
		assert.equal(run.recognizeSource, null);
		assert.equal(run.plan.sources.recognize, undefined);
		assert.equal(
			run.plan.warnings.some((w) => w.code === "RULE_UNNAMED"),
			false,
		);
	});
});
