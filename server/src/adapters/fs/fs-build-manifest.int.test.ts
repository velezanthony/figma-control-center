import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import { FsBuildManifest } from "./fs-build-manifest.ts";

let base: string;
let root: string;
let manifest: FsBuildManifest;

const write = (name: string, content: unknown) =>
	writeFile(
		join(root, name),
		typeof content === "string" ? content : JSON.stringify(content),
	);

before(async () => {
	base = await mkdtemp(join(tmpdir(), "figma-manifest-"));
	root = join(base, "scripts");
	await mkdir(join(root, "sub"), { recursive: true });
	await writeFile(join(root, "build_a.js"), "// @scenario: a\n");
	await writeFile(join(root, "build_b.js"), "// @scenario: b\n");
	await writeFile(join(root, "sub", "mapa.png"), Uint8Array.from([1, 2, 3]));
	await writeFile(join(base, "fuera.js"), "// fuera de la raíz\n");

	await symlink(join(base, "fuera.js"), join(root, "enlace.js"));
	await write("enlace-file.json", { steps: [{ file: "enlace.js" }] });
	await write("enlace-asset.json", {
		steps: [{ file: "build_a.js", assets: { x: "enlace.js" } }],
	});
	await write("app.json", {
		name: "app",
		params: { page: "App", shared: "fromManifest" },
		steps: [
			{
				file: "build_a.js",
				format: "function",
				params: { shared: "fromStep", only: "a" },
			},
			{ file: "build_b.js", assets: { mapa: "sub/mapa.png" }, timeoutMs: 1234 },
		],
	});
	await write("sin-nombre.json", { steps: [{ file: "build_a.js" }] });
	await write("fichero-fuera.json", { steps: [{ file: "../fuera.js" }] });
	await write("asset-fuera.json", {
		steps: [{ file: "build_a.js", assets: { x: "../fuera.js" } }],
	});
	await write("dos-pasos.json", {
		steps: [{ file: "build_a.js" }, { file: "build_b.js" }],
	});
	await write("malo.json", "{ esto no es json ");
	await write("sin-pasos.json", { name: "x" });
	await write("sin-file.json", { steps: [{ format: "body" }] });
	await write("vacio.json", { steps: [] });
	await write("dir-file.json", { steps: [{ file: "sub" }] });
	// Un typo de clave (`timoutMs`) no se ignora: el manifiesto entero se rechaza (strictObject)
	await write("clave-de-mas.json", {
		steps: [{ file: "build_a.js", timoutMs: 1000 }],
	});
	await write("con-expect.json", {
		expect: { fileName: "Copia" },
		steps: [{ file: "build_a.js" }],
	});
	await write("expect-vacio.json", {
		expect: { fileName: "" },
		steps: [{ file: "build_a.js" }],
	});
	await write("expect-clave-de-mas.json", {
		expect: { fileName: "Copia", fileKey: "abc" },
		steps: [{ file: "build_a.js" }],
	});
	await write("clave-raiz-de-mas.json", {
		retries: 3,
		steps: [{ file: "build_a.js" }],
	});
	// Un manifiesto fuera de la raíz (en `base`, no en `root`)
	await writeFile(
		join(base, "fuera-manifest.json"),
		JSON.stringify({ steps: [{ file: "scripts/build_a.js" }] }),
	);

	manifest = new FsBuildManifest({
		roots: [root],
		baseDir: base,
		maxSteps: 10,
	});
});
after(() => rm(base, { recursive: true, force: true }));

describe("FsBuildManifest", () => {
	it("devuelve un BuildPlan con rutas resueltas, params plegados y defaults", async () => {
		const r = await manifest.read("scripts/app.json", {
			shared: "fromCall",
			base: "fromCall",
		});
		assert.ok(r.ok);
		assert.equal(r.value.name, "app");
		assert.equal(r.value.steps.length, 2);

		const [a, b] = r.value.steps;
		assert.ok(a && b);

		// file resuelto a su realpath dentro de la raíz; format del paso respetado
		assert.equal(a.file, await realpath(join(root, "build_a.js")));
		assert.equal(a.format, SCRIPT_FORMAT.function);
		// precedencia paso > manifiesto > llamada
		assert.deepEqual(a.params, {
			shared: "fromStep",
			only: "a",
			page: "App",
			base: "fromCall",
		});
		assert.equal(a.assets, undefined);
		assert.equal(a.timeoutMs, undefined);

		// format ausente → el mismo default que figma_run_script (body)
		assert.equal(b.file, await realpath(join(root, "build_b.js")));
		assert.equal(b.format, SCRIPT_FORMAT.body);
		// sin params de paso: gana el manifiesto sobre la llamada
		assert.deepEqual(b.params, {
			shared: "fromManifest",
			page: "App",
			base: "fromCall",
		});
		assert.deepEqual(b.assets, {
			mapa: await realpath(join(root, "sub", "mapa.png")),
		});
		assert.equal(b.timeoutMs, 1234);
	});

	it("sin `name` usa el nombre del fichero del manifiesto", async () => {
		const r = await manifest.read("scripts/sin-nombre.json");
		assert.ok(r.ok);
		assert.equal(r.value.name, "sin-nombre.json");
	});

	it("un `file` fuera de la raíz es ScriptReadError (CA-6)", async () => {
		const r = await manifest.read("scripts/fichero-fuera.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("un asset fuera de la raíz es ScriptReadError (CA-6)", async () => {
		const r = await manifest.read("scripts/asset-fuera.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("un `file` que es un enlace simbólico que sale de la raíz es ScriptReadError (CA-3)", async () => {
		const r = await manifest.read("scripts/enlace-file.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("un asset que es un enlace simbólico que sale de la raíz es ScriptReadError (CA-3)", async () => {
		const r = await manifest.read("scripts/enlace-asset.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("más pasos que el tope se rechaza (CA-6)", async () => {
		const capped = new FsBuildManifest({
			roots: [root],
			baseDir: base,
			maxSteps: 1,
		});
		const r = await capped.read("scripts/dos-pasos.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /tope/);
	});

	it("JSON malformado se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/malo.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /JSON/);
	});

	it("un manifiesto sin `steps` se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/sin-pasos.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /esquema/);
	});

	it("un paso sin `file` se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/sin-file.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /esquema/);
	});

	it("un manifiesto inexistente se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/nada.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /no existe/);
	});

	it("un manifiesto fuera de la raíz se rechaza (no filtra ficheros ajenos)", async () => {
		const r = await manifest.read("fuera-manifest.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("un manifiesto con `steps` vacío se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/vacio.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /esquema/);
	});

	it("una clave desconocida en un paso (typo) se rechaza, no se ignora (CA-6)", async () => {
		const r = await manifest.read("scripts/clave-de-mas.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /esquema/);
	});

	it("una clave desconocida en la raíz del manifiesto se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/clave-raiz-de-mas.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /esquema/);
	});

	it("`expect.fileName` del manifiesto llega al plan", async () => {
		const r = await manifest.read("scripts/con-expect.json");
		assert.ok(r.ok);
		assert.deepEqual(r.value.expect, { fileName: "Copia" });
	});

	it("un manifiesto sin `expect` da un plan sin `expect`", async () => {
		const r = await manifest.read("scripts/sin-nombre.json");
		assert.ok(r.ok);
		assert.equal(r.value.expect, undefined);
	});

	it("un `expect` con nombre vacío o con claves de más se rechaza entero", async () => {
		for (const f of ["expect-vacio.json", "expect-clave-de-mas.json"]) {
			const r = await manifest.read(`scripts/${f}`);
			assert.ok(!r.ok, f);
			assert.match(r.error.message, /esquema/);
		}
	});

	it("un `file` que es un directorio se rechaza (CA-6)", async () => {
		const r = await manifest.read("scripts/dir-file.json");
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /no es un fichero/);
	});
});

describe("FsBuildManifest: pasos `use`", () => {
	it("un paso `use` entra al plan con su etiqueta, el código del kit en formato body, el paso y el área, sin fichero que leer", async () => {
		await write("con-use.json", {
			name: "areas",
			params: { comun: 1 },
			steps: [
				{ file: "build_a.js" },
				{ use: "kit/place@1", area: "Panel", timeoutMs: 9000 },
				{ use: "kit/links@1", area: "Panel" },
			],
		});
		const r = await manifest.read("scripts/con-use.json", { llamada: 1 });
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		const [file, place, links] = r.value.steps;
		assert.match(file?.file ?? "", /build_a\.js$/);
		assert.deepEqual(place, {
			file: "kit/place@1 · Panel",
			format: SCRIPT_FORMAT.body,
			kit: { step: "kit/place@1", area: "Panel" },
			timeoutMs: 9000,
		});
		// los params del manifiesto y de la llamada no llegan a un paso del kit: sus params salen de areas@1
		assert.equal(places(links), "kit/links@1 · Panel");
		assert.equal(place?.params, undefined);
	});

	it("`use` con `file`, `use` con `params` o un paso del kit que no existe rechazan el manifiesto entero", async () => {
		await write("use-con-file.json", {
			steps: [{ use: "kit/place@1", area: "Panel", file: "build_a.js" }],
		});
		await write("use-con-params.json", {
			steps: [{ use: "kit/place@1", area: "Panel", params: { a: 1 } }],
		});
		await write("use-inventado.json", {
			steps: [{ use: "kit/inventado@1", area: "Panel" }],
		});
		for (const f of [
			"use-con-file.json",
			"use-con-params.json",
			"use-inventado.json",
		]) {
			const r = await manifest.read(`scripts/${f}`);
			assert.ok(!r.ok, f);
			assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
			assert.match(r.error.message, /esquema/);
		}
	});
});

const places = (step: { file: string } | undefined) => step?.file;

describe("FsBuildManifest: kit/build-screen@1", () => {
	it("entra al plan con su etiqueta por pantalla y con la pantalla, el área, la variante y la captura que nombra", async () => {
		await write("con-pantalla.json", {
			steps: [
				{ use: "kit/build-screen@1", screen: "home" },
				{
					use: "kit/build-screen@1",
					screen: "p-home",
					area: "Panel",
					variant: 2,
					capture: "2026-11-12/p-home_101500.json",
					timeoutMs: 90000,
				},
			],
		});
		const r = await manifest.read("scripts/con-pantalla.json", undefined);
		assert.ok(r.ok, r.ok ? "" : r.error.message);
		assert.deepEqual(r.value.steps[0], {
			file: "kit/build-screen@1 · home",
			format: SCRIPT_FORMAT.body,
			kit: { step: "kit/build-screen@1", screen: "home" },
		});
		assert.deepEqual(r.value.steps[1], {
			file: "kit/build-screen@1 · p-home",
			format: SCRIPT_FORMAT.body,
			kit: {
				step: "kit/build-screen@1",
				screen: "p-home",
				area: "Panel",
				variant: 2,
				capture: "2026-11-12/p-home_101500.json",
			},
			timeoutMs: 90000,
		});
	});

	it("sin `screen` rechaza el manifiesto", async () => {
		await write("sin-pantalla.json", {
			steps: [{ use: "kit/build-screen@1", area: "Panel" }],
		});
		const r = await manifest.read("scripts/sin-pantalla.json", undefined);
		assert.ok(!r.ok);
	});
});
