import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FsProjectConfig } from "./fs-project-config.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;

let dir: string;
let project: string;
let scripts: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "proyecto-captura-"));
	project = join(dir, "proyecto");
	scripts = join(dir, "raiz-scripts");
	await mkdir(project);
	await mkdir(scripts);
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const CONFIG = {
	contract: "project@1",
	web: {
		baseUrl: "http://127.0.0.1:8123",
		viewport: { w: 800, h: 600 },
		users: { lector: { username: "lector", secretRef: "qa" } },
	},
	screens: "screens.json",
	hooks: "hooks.js",
};
const SCREENS = {
	contract: "screens@1",
	screens: [
		{ key: "inicio", title: "Inicio", url: "/" },
		{ key: "panel", title: "Panel", url: "/p/", session: "lector" },
	],
};
const HOOKS = `{ contract: "capture@1", hooks: { ready: () => true } }`;

async function write(
	config: unknown = CONFIG,
	screens: unknown = SCREENS,
	at = project,
) {
	await writeFile(
		join(project, "figma-control-center.json"),
		JSON.stringify(config),
	);
	await writeFile(join(at, "screens.json"), JSON.stringify(screens));
	await writeFile(join(at, "hooks.js"), HOOKS);
}

const load = () =>
	new FsProjectConfig({ projectDir: project, scriptsRoots: [scripts] }).load();

const problem = async () => {
	const r = await load();
	assert.equal(r.ok, false);
	if (r.ok) throw new Error();
	assert.equal(r.error.type, "ProjectConfigError");
	return r.error;
};

describe("FsProjectConfig: figma-control-center.json en la carpeta del proyecto (D-4)", () => {
	it("lee project@1, su screens@1 y el texto de los ganchos con su sha256", async () => {
		await write();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.config.web.baseUrl, "http://127.0.0.1:8123");
		assert.deepEqual(
			r.value.screens.screens.map((s) => s.key),
			["inicio", "panel"],
		);
		assert.deepEqual(r.value.hooks, {
			source: HOOKS,
			sha256: createHash("sha256").update(HOOKS).digest("hex"),
		});
	});

	it("sin el fichero es ProjectConfigError que dice cómo se llama y dónde va", async () => {
		const e = await problem();
		assert.match(e.message, /figma-control-center\.json/);
	});

	it("un campo que no cumple project@1 nombra el campo", async () => {
		await write({ ...CONFIG, web: { ...CONFIG.web, baseUrl: "no es url" } });
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "web.baseUrl");
	});

	it("un screens@1 que no cumple nombra el fichero y el campo", async () => {
		await write(CONFIG, {
			contract: "screens@1",
			screens: [{ key: "x", title: "X" }],
		});
		const e = await problem();
		assert.match(e.message, /screens\.json/);
		assert.equal(e.type === "ProjectConfigError" && e.field, "screens.0.url");
	});

	it("una session sin usuario en web.users es un problema con su campo", async () => {
		await write(CONFIG, {
			contract: "screens@1",
			screens: [{ key: "x", title: "X", url: "/", session: "nadie" }],
		});
		const e = await problem();
		assert.equal(
			e.type === "ProjectConfigError" && e.field,
			"screens.0.session",
		);
		assert.match(e.message, /nadie/);
	});

	it("una ruta que sale de la carpeta del proyecto y de sus raíces de scripts no se lee", async () => {
		await write({ ...CONFIG, screens: "../fuera.json" });
		await writeFile(join(dir, "fuera.json"), JSON.stringify(SCREENS));
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "screens");
		await symlink(join(dir, "fuera.json"), join(project, "enlace.json"));
		await write({ ...CONFIG, screens: "enlace.json" });
		const linked = await problem();
		assert.equal(
			linked.type === "ProjectConfigError" && linked.field,
			"screens",
		);
	});

	it("los ganchos y el screens@1 pueden vivir en una raíz de scripts del proyecto", async () => {
		await write(
			{
				...CONFIG,
				screens: "../raiz-scripts/screens.json",
				hooks: "../raiz-scripts/hooks.js",
			},
			SCREENS,
			scripts,
		);
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
	});
});

const AREAS = {
	contract: "areas@1",
	linkRules: {
		clickable: { names: ["boton"], namePrefixes: [], components: [] },
		rows: { row: ["fila"], body: ["cuerpo"] },
		transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
	},
	areas: [
		{
			name: "Uno",
			page: "Uno",
			frame: { width: 100, minHeight: 100 },
			place: {
				mode: "replace-content",
				source: { pagePrefix: "t ", take: "first-frame" },
			},
			screens: [{ frame: "a", screen: "inicio" }, { frame: "b" }],
			fills: [
				{
					frame: "b",
					find: { text: "Mapa", minSize: [10, 10] },
					asset: "mapa.png",
				},
			],
		},
	],
};

async function writeAreas(
	areas: unknown = AREAS,
	ref: string | null = "areas.json",
) {
	await write(ref === null ? CONFIG : { ...CONFIG, areas: ref });
	await writeFile(join(project, "areas.json"), JSON.stringify(areas));
	await writeFile(join(project, "mapa.png"), "png");
}

describe("FsProjectConfig: areas@1", () => {
	it("sin `areas` en project@1, `areas` es null y no hay assets", async () => {
		await writeAreas(AREAS, null);
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.areas, null);
		assert.deepEqual(r.value.areaAssets, {});
	});

	it("con `areas` lee el fichero y da la ruta real de cada imagen de relleno", async () => {
		await writeAreas();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.areas?.areas[0]?.name, "Uno");
		assert.deepEqual(Object.keys(r.value.areaAssets), ["mapa.png"]);
		assert.match(r.value.areaAssets["mapa.png"] ?? "", /mapa\.png$/);
	});

	it("una ruta de `areas` que se sale de la carpeta es ProjectConfigError con el campo `areas`", async () => {
		await writeAreas(AREAS, "../fuera.json");
		await writeFile(join(dir, "fuera.json"), JSON.stringify(AREAS));
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "areas");
	});

	it("un areas.json que no es JSON es ProjectConfigError con el campo `areas`", async () => {
		await write({ ...CONFIG, areas: "areas.json" });
		await writeFile(join(project, "areas.json"), "{roto");
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "areas");
		assert.match(e.message, /JSON/);
	});

	it("un areas.json que no cumple el esquema es ContractError con el puntero, reintentable", async () => {
		const bad = structuredClone(AREAS) as Loose;
		bad.areas[0].place.mode = "graft";
		await writeAreas(bad);
		const r = await load();
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.equal(r.error.type, "ContractError");
		assert.equal(
			r.error.type === "ContractError" && r.error.path,
			"/areas/0/place/mode",
		);
		assert.equal(r.error.retryable, true);
	});

	it("un frame de enlace que no existe o una `screen` fuera de screens@1 es ContractError con su puntero", async () => {
		const bad = structuredClone(AREAS) as Loose;
		bad.areas[0].links = [{ from: "z", text: "Ir", to: "b" }];
		await writeAreas(bad);
		const first = await load();
		assert.ok(!first.ok && first.error.type === "ContractError");
		assert.equal(first.error.path, "/areas/0/links/0/from");
		const other = structuredClone(AREAS) as Loose;
		other.areas[0].screens[0].screen = "no-existe";
		await writeAreas(other);
		const second = await load();
		assert.ok(!second.ok && second.error.type === "ContractError");
		assert.equal(second.error.path, "/areas/0/screens/0/screen");
	});

	it("una imagen de relleno que no existe o se sale de las raíces es ProjectConfigError con `areas`", async () => {
		await writeAreas();
		await rm(join(project, "mapa.png"));
		const missing = await problem();
		assert.equal(
			missing.type === "ProjectConfigError" && missing.field,
			"areas",
		);
		const out = structuredClone(AREAS) as Loose;
		out.areas[0].fills[0].asset = "../fuera.png";
		await writeAreas(out);
		await writeFile(join(dir, "fuera.png"), "png");
		const outside = await problem();
		assert.equal(
			outside.type === "ProjectConfigError" && outside.field,
			"areas",
		);
	});
});

const MAP = {
	contract: "map@1",
	tokens: {
		collections: ["Base"],
		classPrefixes: { fill: ["bg-"], text: ["text-"], stroke: ["border-"] },
		classToVariable: [{ from: "^text-(.+)$", to: "text/$1" }],
	},
	fonts: {
		families: [],
		default: "Sans",
		styles: { "400": "Regular" },
		italic: { suffix: "Italic" },
	},
	icons: { pages: "Icons", prefix: "icons/", catalog: "icons.json" },
	layers: { roles: { p: "párrafo" }, textPrefix: true },
};
const ICONS = [{ name: "plus", svg: '<svg><path d="M0 0"/></svg>' }];

async function writeMap(
	map: unknown = MAP,
	ref: string | null = "map.json",
	icons: unknown = ICONS,
) {
	await write(ref === null ? CONFIG : { ...CONFIG, map: ref });
	await writeFile(join(project, "map.json"), JSON.stringify(map));
	await writeFile(join(project, "icons.json"), JSON.stringify(icons));
}

describe("FsProjectConfig: map@1", () => {
	it("sin `map` en project@1, `map` es null y no hay catálogo", async () => {
		await writeMap(MAP, null);
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.map, null);
		assert.equal(r.value.mapSource, null);
		assert.deepEqual(r.value.iconCatalog, []);
	});

	it("con `map` lee el fichero, su sha256 y el catálogo de iconos", async () => {
		await writeMap();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.map?.fonts.default, "Sans");
		assert.deepEqual(r.value.iconCatalog, ICONS);
		assert.equal(
			r.value.mapSource?.sha256,
			createHash("sha256").update(JSON.stringify(MAP)).digest("hex"),
		);
		assert.match(r.value.mapSource?.path ?? "", /map\.json$/);
	});

	it("una ruta de `map` que se sale de la carpeta es ProjectConfigError con el campo `map`", async () => {
		await writeMap(MAP, "../fuera.json");
		await writeFile(join(dir, "fuera.json"), JSON.stringify(MAP));
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "map");
	});

	it("un map.json que no es JSON es ProjectConfigError con el campo `map`", async () => {
		await write({ ...CONFIG, map: "map.json" });
		await writeFile(join(project, "map.json"), "{roto");
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "map");
		assert.match(e.message, /JSON/);
	});

	it("un map.json que no cumple el esquema es ContractError con el puntero, reintentable", async () => {
		const bad = structuredClone(MAP) as Loose;
		bad.layers.textPrefix = "sí";
		await writeMap(bad);
		const r = await load();
		assert.ok(!r.ok && r.error.type === "ContractError");
		assert.equal(r.error.path, "/layers/textPrefix");
		assert.equal(r.error.retryable, true);
	});

	it("una expresión regular que no compila es ContractError con su puntero", async () => {
		const bad = structuredClone(MAP) as Loose;
		bad.tokens.classToVariable[0].from = "(";
		await writeMap(bad);
		const r = await load();
		assert.ok(!r.ok && r.error.type === "ContractError");
		assert.equal(r.error.path, "/tokens/classToVariable/0/from");
	});

	it("un catálogo que no existe, se sale de las raíces o no es [{ name, svg }] es ProjectConfigError con `map.icons.catalog`", async () => {
		await writeMap();
		await rm(join(project, "icons.json"));
		const missing = await problem();
		assert.equal(
			missing.type === "ProjectConfigError" && missing.field,
			"map.icons.catalog",
		);
		const out = structuredClone(MAP) as Loose;
		out.icons.catalog = "../fuera.json";
		await writeMap(out);
		await writeFile(join(dir, "fuera.json"), "[]");
		const outside = await problem();
		assert.equal(
			outside.type === "ProjectConfigError" && outside.field,
			"map.icons.catalog",
		);
		await writeMap(MAP, "map.json", [{ name: "plus" }]);
		const shape = await problem();
		assert.equal(
			shape.type === "ProjectConfigError" && shape.field,
			"map.icons.catalog",
		);
		await writeMap(MAP);
		await writeFile(join(project, "icons.json"), "no json");
		const raw = await problem();
		assert.equal(
			raw.type === "ProjectConfigError" && raw.field,
			"map.icons.catalog",
		);
	});
});

const RECOGNIZE = `{ contract: "recognize@1", rules: {} }`;

describe("FsProjectConfig: recognize@1 (el módulo se lee como texto)", () => {
	const withRecognize = async (ref: string | null = "recognize.js") => {
		await write(ref === null ? CONFIG : { ...CONFIG, recognize: ref });
		await writeFile(join(project, "recognize.js"), RECOGNIZE);
	};

	it("sin `recognize` es null", async () => {
		await withRecognize(null);
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.recognize, null);
	});

	it("con `recognize` lee su texto con su sha256 y su ruta; nunca lo ejecuta", async () => {
		await withRecognize();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.recognize?.source, RECOGNIZE);
		assert.equal(
			r.value.recognize?.sha256,
			createHash("sha256").update(RECOGNIZE).digest("hex"),
		);
		assert.match(r.value.recognize?.path ?? "", /recognize\.js$/);
	});

	it("una ruta que se sale de las raíces, que no existe o un fichero vacío son ProjectConfigError con el campo `recognize`", async () => {
		await withRecognize("../fuera.js");
		await writeFile(join(dir, "fuera.js"), RECOGNIZE);
		const outside = await problem();
		assert.equal(
			outside.type === "ProjectConfigError" && outside.field,
			"recognize",
		);
		await withRecognize("no-existe.js");
		const missing = await problem();
		assert.equal(
			missing.type === "ProjectConfigError" && missing.field,
			"recognize",
		);
		await withRecognize();
		await writeFile(join(project, "recognize.js"), "  \n");
		const empty = await problem();
		assert.equal(
			empty.type === "ProjectConfigError" && empty.field,
			"recognize",
		);
		assert.match(empty.message, /vacío/);
	});
});

const FINGERPRINTS = {
	"a.b": { title: "Tarjeta", tag: "div", cls: ["rounded-xl"], sig: null },
	"c.d": { title: "Aviso", tag: "div", cls: ["p-4"], extra: "se admite" },
};
const COMPONENTS = {
	fingerprints: "fingerprints.json",
	leaf: ["a.b"],
	genericClasses: ["flex"],
};

describe("FsProjectConfig: map@1.components y screens", () => {
	async function writeComponents(
		components: unknown = COMPONENTS,
		fingerprints: unknown = FINGERPRINTS,
		extra: Record<string, unknown> = {},
	) {
		await write({ ...CONFIG, map: "map.json" });
		await writeFile(
			join(project, "map.json"),
			JSON.stringify({ ...MAP, components, ...extra }),
		);
		await writeFile(join(project, "icons.json"), JSON.stringify(ICONS));
		await writeFile(
			join(project, "fingerprints.json"),
			typeof fingerprints === "string"
				? fingerprints
				: JSON.stringify(fingerprints),
		);
	}

	it("sin `components` no hay huellas", async () => {
		await writeMap();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(r.value.fingerprints, {});
	});

	it("lee las huellas del fichero al que apunta `components.fingerprints` (todas, con lo que traigan de más)", async () => {
		await writeComponents();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(Object.keys(r.value.fingerprints), ["a.b", "c.d"]);
		assert.equal(r.value.fingerprints["a.b"]?.title, "Tarjeta");
	});

	it("`screens` con reglas se lee tal cual", async () => {
		await writeComponents(COMPONENTS, FINGERPRINTS, {
			screens: { inicio: { rules: ["Button"] } },
		});
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(r.value.map?.screens, { inicio: { rules: ["Button"] } });
	});

	it("unas huellas que no existen, se salen de las raíces, no son JSON o no cumplen son ProjectConfigError con `map.components.fingerprints`", async () => {
		const field = (e: Awaited<ReturnType<typeof problem>>) =>
			e.type === "ProjectConfigError" && e.field;
		await writeComponents();
		await rm(join(project, "fingerprints.json"));
		assert.equal(field(await problem()), "map.components.fingerprints");
		await writeComponents({ ...COMPONENTS, fingerprints: "../fuera.json" });
		await writeFile(join(dir, "fuera.json"), "{}");
		assert.equal(field(await problem()), "map.components.fingerprints");
		await writeComponents(COMPONENTS, "no json");
		assert.equal(field(await problem()), "map.components.fingerprints");
		await writeComponents(COMPONENTS, { "a.b": { title: "sin etiqueta" } });
		assert.equal(field(await problem()), "map.components.fingerprints");
	});

	it("un componente de `leaf` que no está en las huellas es ContractError con su puntero", async () => {
		await writeComponents({ ...COMPONENTS, leaf: ["a.b", "no.esta"] });
		const r = await load();
		assert.ok(!r.ok && r.error.type === "ContractError");
		assert.equal(r.error.path, "/components/leaf/1");
		assert.equal(r.error.retryable, true);
	});

	it("una clase genérica que no compila es ContractError con su puntero", async () => {
		await writeComponents({ ...COMPONENTS, genericClasses: ["("] });
		const r = await load();
		assert.ok(!r.ok && r.error.type === "ContractError");
		assert.equal(r.error.path, "/components/genericClasses/0");
	});
});

describe("FsProjectConfig: sheets@1", () => {
	const SHEETS = {
		contract: "sheets@1",
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
			{
				key: "inicio",
				screen: "inicio",
				title: "Inicio",
				page: { name: "I" },
				description: "d",
			},
		],
	};
	async function writeSheets(
		sheets: unknown = SHEETS,
		given: string | null = "sheets.json",
	) {
		await write(given === null ? CONFIG : { ...CONFIG, sheets: given });
		await writeFile(join(project, "sheets.json"), JSON.stringify(sheets));
	}

	it("sin `sheets` en project@1, `sheets` y `sheetsSource` son null", async () => {
		await writeSheets(SHEETS, null);
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.sheets, null);
		assert.equal(r.value.sheetsSource, null);
	});

	it("con `sheets` lee el fichero, su ruta real, su sha256 y su texto", async () => {
		await writeSheets();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.sheets?.sheets[0]?.key, "inicio");
		assert.match(r.value.sheetsSource?.path ?? "", /sheets\.json$/);
		assert.equal(r.value.sheetsSource?.text, JSON.stringify(SHEETS));
		assert.equal(
			r.value.sheetsSource?.sha256,
			createHash("sha256").update(JSON.stringify(SHEETS)).digest("hex"),
		);
	});

	it("una ruta que se sale de la carpeta es ProjectConfigError con el campo `sheets`", async () => {
		await writeSheets(SHEETS, "../fuera.json");
		await writeFile(join(dir, "fuera.json"), JSON.stringify(SHEETS));
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "sheets");
	});

	it("un sheets.json que no es JSON es ProjectConfigError con el campo `sheets`", async () => {
		await write({ ...CONFIG, sheets: "sheets.json" });
		await writeFile(join(project, "sheets.json"), "{roto");
		const e = await problem();
		assert.equal(e.type === "ProjectConfigError" && e.field, "sheets");
		assert.match(e.message, /JSON/);
	});

	it("un sheets.json que no cumple el esquema es ContractError con el puntero, reintentable", async () => {
		const bad = structuredClone(SHEETS) as Loose;
		bad.sheets[0].matrix = { align: "bottom" };
		await writeSheets(bad);
		const r = await load();
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.equal(r.error.type, "ContractError");
		assert.equal(
			r.error.type === "ContractError" && r.error.path,
			"/sheets/0/matrix/align",
		);
		assert.equal(r.error.retryable, true);
		assert.match(r.error.message, /sheets@1/);
	});

	it("una pantalla que no está en screens@1 es ContractError con su puntero", async () => {
		const bad = structuredClone(SHEETS) as Loose;
		bad.sheets[0].screen = "fantasma";
		await writeSheets(bad);
		const r = await load();
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.equal(
			r.error.type === "ContractError" && r.error.path,
			"/sheets/0/screen",
		);
	});
});

describe("FsProjectConfig: compose (la carpeta de los compose@1)", () => {
	it("sin `compose` en project@1, `composeDir` es null", async () => {
		await write();
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.equal(r.value.composeDir, null);
	});

	it("con `compose` da la ruta real de la carpeta, dentro del proyecto", async () => {
		await write({ ...CONFIG, compose: "compose/" });
		await mkdir(join(project, "compose"));
		const r = await load();
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.match(r.value.composeDir ?? "", /proyecto\/compose$/);
	});

	it("una carpeta que no existe, un fichero o una ruta fuera del proyecto son ProjectConfigError con el campo `compose`", async () => {
		await write({ ...CONFIG, compose: "compose/" });
		const missing = await problem();
		assert.equal(
			missing.type === "ProjectConfigError" && missing.field,
			"compose",
		);

		await writeFile(join(project, "compose"), "no soy una carpeta");
		const file = await problem();
		assert.equal(file.type === "ProjectConfigError" && file.field, "compose");
		assert.match(file.message, /carpeta/);

		await mkdir(join(dir, "fuera"));
		await write({ ...CONFIG, compose: "../fuera" });
		const outside = await problem();
		assert.equal(
			outside.type === "ProjectConfigError" && outside.field,
			"compose",
		);
	});
});
