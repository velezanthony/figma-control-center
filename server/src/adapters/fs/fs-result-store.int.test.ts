import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { EXPORT_FORMAT } from "#domain/catalog.ts";
import { FsResultStore } from "./fs-result-store.ts";

const PNG = Uint8Array.from([137, 80, 78, 71]);
// 9 de noviembre de 2026, 21:31:04 en la hora local de quien ejecuta (los componentes locales, no un instante UTC)
const AT = new Date(2026, 10, 9, 21, 31, 4);
const shot = (nodeId: string, at: Date) => ({ nodeId, at });

let base: string;
before(async () => {
	base = await mkdtemp(join(tmpdir(), "figma-out-"));
});
after(() => rm(base, { recursive: true, force: true }));

describe("FsResultStore", () => {
	it("guarda un JSON y devuelve su ruta y tamaño", async () => {
		const store = new FsResultStore(join(base, "salida", "anidada"));
		const stored = await store.saveJson('{"a":"ñ"}');
		assert.ok(stored.path.endsWith(".json"));
		assert.equal(stored.bytes, Buffer.byteLength('{"a":"ñ"}'));
		assert.equal(await readFile(stored.path, "utf8"), '{"a":"ñ"}');
	});

	it("guarda un PNG byte a byte", async () => {
		const store = new FsResultStore(base);
		const png = Uint8Array.from([137, 80, 78, 71, 0, 255]);
		const stored = await store.savePng(png, shot("1:2", AT));
		assert.ok(stored.path.endsWith(".png"));
		assert.equal(stored.bytes, 6);
		assert.deepEqual(new Uint8Array(await readFile(stored.path)), png);
	});

	it("dos guardados seguidos no se pisan", async () => {
		const store = new FsResultStore(base);
		const [a, b] = await Promise.all([
			store.saveJson("1"),
			store.saveJson("2"),
		]);
		assert.notEqual(a.path, b.path);
	});

	describe("nombre de las capturas", () => {
		const nameOf = (dir: string, stored: { path: string }) =>
			relative(dir, stored.path);

		it("va en screenshots/<fecha>/<nodo>_<hora>.png con la fecha y la hora locales y el nodo con «-» en vez de «:»", async () => {
			const dir = join(base, "nombres-a");
			const stored = await new FsResultStore(dir).savePng(
				PNG,
				shot("6449:7353", AT),
			);
			assert.equal(
				nameOf(dir, stored),
				join("screenshots", "2026-11-09", "6449-7353_213104.png"),
			);
		});

		it("rellena con ceros el mes, el día y la hora", async () => {
			const dir = join(base, "nombres-b");
			const stored = await new FsResultStore(dir).savePng(
				PNG,
				shot("1:2", new Date(2027, 0, 5, 3, 4, 5)),
			);
			assert.equal(
				nameOf(dir, stored),
				join("screenshots", "2027-01-05", "1-2_030405.png"),
			);
		});

		it("si el nombre existe, añade -2, -3… sin pisar la anterior", async () => {
			const dir = join(base, "nombres-c");
			const store = new FsResultStore(dir);
			const names = [];
			for (let i = 0; i < 3; i++) {
				names.push(nameOf(dir, await store.savePng(PNG, shot("1:2", AT))));
			}
			assert.deepEqual(names, [
				join("screenshots", "2026-11-09", "1-2_213104.png"),
				join("screenshots", "2026-11-09", "1-2_213104-2.png"),
				join("screenshots", "2026-11-09", "1-2_213104-3.png"),
			]);
		});

		it("dos capturas a la vez del mismo nodo y segundo no se pisan", async () => {
			const dir = join(base, "nombres-d");
			const store = new FsResultStore(dir);
			const [a, b] = await Promise.all([
				store.savePng(PNG, shot("1:2", AT)),
				store.savePng(PNG, shot("1:2", AT)),
			]);
			assert.notEqual(a.path, b.path);
		});

		it("un id de nodo con símbolos no puede salirse de la carpeta ni crear subcarpetas", async () => {
			const dir = join(base, "nombres-e");
			const stored = await new FsResultStore(dir).savePng(
				PNG,
				shot("../../x/I12:3;45:6", AT),
			);
			assert.equal(
				nameOf(dir, stored),
				join("screenshots", "2026-11-09", "______x_I12-3_45-6_213104.png"),
			);
		});
	});
});

describe("FsResultStore: lecturas, exportaciones y resultados con nombre", () => {
	const inside = (dir: string, path: string) =>
		relative(dir, path).split("\\").join("/");

	it("una lectura va a reads/<herramienta>_<fecha>_<hora>.json con la hora local", async () => {
		const dir = join(base, "lecturas");
		const stored = await new FsResultStore(dir).saveRead('{"a":1}', {
			tool: "figma_variables",
			at: AT,
		});
		assert.equal(
			inside(dir, stored.path),
			"reads/figma_variables_2026-11-09_213104.json",
		);
		assert.equal(await readFile(stored.path, "utf8"), '{"a":1}');
		assert.equal(stored.bytes, 7);
	});

	it("dos lecturas en el mismo segundo no se pisan", async () => {
		const dir = join(base, "lecturas-dobles");
		const store = new FsResultStore(dir);
		const name = { tool: "figma_styles", at: AT };
		const a = await store.saveRead("1", name);
		const b = await store.saveRead("2", name);
		assert.equal(
			inside(dir, b.path),
			"reads/figma_styles_2026-11-09_213104-2.json",
		);
		assert.equal(await readFile(a.path, "utf8"), "1");
	});

	it("una exportación va a exports/<fecha>/<nodo>_<hora>.<formato> byte a byte", async () => {
		const dir = join(base, "exportaciones");
		const bytes = Uint8Array.from([60, 115, 118, 103]);
		const stored = await new FsResultStore(dir).saveExport(bytes, {
			nodeId: "I10:1;2:3",
			format: EXPORT_FORMAT.svg,
			at: AT,
		});
		assert.equal(
			inside(dir, stored.path),
			"exports/2026-11-09/I10-1_2-3_213104.svg",
		);
		assert.deepEqual(new Uint8Array(await readFile(stored.path)), bytes);
		assert.equal(stored.bytes, 4);
	});

	it("un resultado con nombre va a results/<nombre> y pisa el anterior", async () => {
		const dir = join(base, "resultados");
		const store = new FsResultStore(dir);
		await store.saveResult("figma_props.json", '{"v":1}');
		const stored = await store.saveResult("figma_props.json", '{"v":2}');
		assert.equal(inside(dir, stored.path), "results/figma_props.json");
		assert.equal(await readFile(stored.path, "utf8"), '{"v":2}');
	});

	it("un nombre con «/» o «..» no escribe nada fuera de results/", async () => {
		const dir = join(base, "resultados-malos");
		const store = new FsResultStore(dir);
		for (const bad of ["../fuera.json", "a/b.json", "..", ".", ""]) {
			await assert.rejects(() => store.saveResult(bad, "{}"), bad);
		}
		await assert.rejects(() => readFile(join(base, "fuera.json")));
	});
});

describe("FsResultStore.saveScript: history-scripts/<sha256>.<ext>", () => {
	const SHA = "ab".repeat(32);

	it("escribe el contenido exacto en history-scripts/ de la carpeta de salida", async () => {
		const store = new FsResultStore(join(base, "scripts-historial"));
		const stored = await store.saveScript(SHA, "js", "return 'ñ';\n");
		assert.equal(
			relative(join(base, "scripts-historial"), stored.path),
			join("history-scripts", `${SHA}.js`),
		);
		assert.equal(stored.bytes, Buffer.byteLength("return 'ñ';\n"));
		assert.equal(await readFile(stored.path, "utf8"), "return 'ñ';\n");
	});

	it("repetirlo pisa el fichero (es el mismo contenido) y json lleva su extensión", async () => {
		const store = new FsResultStore(join(base, "scripts-historial"));
		await store.saveScript(SHA, "json", "{}");
		const again = await store.saveScript(SHA, "json", "{}");
		assert.ok(again.path.endsWith(`${SHA}.json`));
	});

	it("un hash que no es de 64 hexadecimales lanza sin escribir (nada de «..» ni «/»)", async () => {
		const store = new FsResultStore(join(base, "scripts-historial"));
		await assert.rejects(
			store.saveScript("../escapa", "js", "x"),
			/hash no válido/,
		);
	});
});

describe("FsResultStore.saveDiff: history-diffs/<nombre>.diff", () => {
	it("escribe el diff entero en history-diffs/ de la carpeta de salida", async () => {
		const store = new FsResultStore(join(base, "diffs-historial"));
		const stored = await store.saveDiff(
			"4-5-step.diff",
			"@@ -1 +1 @@\n-a\n+b\n",
		);
		assert.equal(
			relative(join(base, "diffs-historial"), stored.path),
			join("history-diffs", "4-5-step.diff"),
		);
		assert.equal(await readFile(stored.path, "utf8"), "@@ -1 +1 @@\n-a\n+b\n");
	});

	it("repetirlo pisa el fichero", async () => {
		const store = new FsResultStore(join(base, "diffs-historial"));
		await store.saveDiff("1-2-kit.diff", "uno");
		const again = await store.saveDiff("1-2-kit.diff", "dos");
		assert.equal(await readFile(again.path, "utf8"), "dos");
	});

	it("un nombre con ruta o sin la extensión lanza sin escribir", async () => {
		const store = new FsResultStore(join(base, "diffs-historial"));
		for (const name of [
			"../x.diff",
			"a/b.diff",
			"sin-extension",
			".diff",
			"a b.diff",
		]) {
			await assert.rejects(
				store.saveDiff(name, "x"),
				/nombre de diff no válido/,
				name,
			);
		}
	});
});
