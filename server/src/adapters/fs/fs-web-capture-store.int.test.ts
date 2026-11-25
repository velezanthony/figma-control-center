import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FsWebCaptureStore } from "./fs-web-capture-store.ts";

let out: string;
beforeEach(async () => {
	out = await mkdtemp(join(tmpdir(), "salida-captura-"));
});
afterEach(async () => {
	await rm(out, { recursive: true, force: true });
});

// 10:20:30 hora local del 11 de noviembre
const AT = new Date(2026, 10, 11, 10, 20, 30);
const rel = (p: string) => relative(out, p).split("\\").join("/");
const image = (sha: string, type: "png" | "jpeg" = "png") => ({
	sha256: sha,
	bytes: new Uint8Array([1, 2, 3]),
	width: 1,
	height: 1,
	type,
});

describe("FsWebCaptureStore: web-captures/ de la carpeta de salida", () => {
	it("una captura válida va a web-captures/<día local>/<pantalla>_<HHMMSS>.json; otra a la misma hora, -2", async () => {
		const store = new FsWebCaptureStore(out);
		const a = await store.saveCapture("inicio", "{}", AT);
		const b = await store.saveCapture("inicio", '{"b":1}', AT);
		assert.equal(rel(a.path), "web-captures/2026-11-11/inicio_102030.json");
		assert.equal(rel(b.path), "web-captures/2026-11-11/inicio_102030-2.json");
		assert.equal(await readFile(b.path, "utf8"), '{"b":1}');
		assert.equal(a.bytes, 2);
	});

	it("las imágenes van a web-captures/img/<sha256>.<ext> una sola vez", async () => {
		const store = new FsWebCaptureStore(out);
		await store.saveImage(image("a".repeat(64)));
		await store.saveImage(image("a".repeat(64)));
		await store.saveImage(image("b".repeat(64), "jpeg"));
		assert.deepEqual((await readdir(join(out, "web-captures/img"))).sort(), [
			`${"a".repeat(64)}.png`,
			`${"b".repeat(64)}.jpg`,
		]);
		assert.equal(
			store.imagePath({ sha256: "b".repeat(64), type: "jpeg" }),
			`img/${"b".repeat(64)}.jpg`,
		);
		assert.equal(
			(
				await stat(
					join(out, "web-captures", store.imagePath(image("a".repeat(64)))),
				)
			).size,
			3,
		);
	});

	it("una captura que no cumple va a rejected/<día>/ con su .errors.json al lado", async () => {
		const store = new FsWebCaptureStore(out);
		const r = await store.saveRejected("inicio", "{}", "[1]", AT);
		assert.equal(
			rel(r.path),
			"web-captures/rejected/2026-11-11/inicio_102030.json",
		);
		assert.equal(
			rel(r.errorsPath),
			"web-captures/rejected/2026-11-11/inicio_102030.errors.json",
		);
		assert.equal(await readFile(r.errorsPath, "utf8"), "[1]");
	});

	it("no escribe en screenshots/ (las capturas PNG de Figma)", async () => {
		const store = new FsWebCaptureStore(out);
		await store.saveCapture("inicio", "{}", AT);
		assert.deepEqual(await readdir(out), ["web-captures"]);
	});

	describe("latest y read (la fuente del plan de una pantalla)", () => {
		it("sin capturas de esa pantalla da null", async () => {
			const store = new FsWebCaptureStore(out);
			assert.equal(await store.latest("inicio"), null);
			await store.saveCapture("otra", "{}", AT);
			assert.equal(await store.latest("inicio"), null);
		});

		it("devuelve la más reciente: por día, por hora y, a la misma hora, la de número más alto", async () => {
			const store = new FsWebCaptureStore(out);
			await store.saveCapture(
				"inicio",
				'{"n":1}',
				new Date(2026, 10, 10, 23, 0, 0),
			);
			await store.saveCapture(
				"inicio",
				'{"n":2}',
				new Date(2026, 10, 11, 9, 0, 0),
			);
			await store.saveCapture("inicio", '{"n":3}', AT);
			await store.saveCapture("inicio", '{"n":4}', AT);
			const latest = await store.latest("inicio");
			assert.equal(latest?.json, '{"n":4}');
			assert.equal(latest?.relative, "2026-11-11/inicio_102030-2.json");
			assert.equal(
				rel(latest?.path ?? ""),
				"web-captures/2026-11-11/inicio_102030-2.json",
			);
		});

		it("ignora rejected/, oracle/ y los .errors.json aunque sean más nuevos", async () => {
			const store = new FsWebCaptureStore(out);
			await store.saveCapture("inicio", '{"ok":1}', AT);
			await store.saveRejected(
				"inicio",
				'{"mal":1}',
				"[1]",
				new Date(2026, 10, 12, 8, 0, 0),
			);
			await mkdir(join(out, "web-captures/oracle/2026-11-13"), {
				recursive: true,
			});
			await writeFile(
				join(out, "web-captures/oracle/2026-11-13/inicio_080000.json"),
				'{"oraculo":1}',
			);
			assert.equal((await store.latest("inicio"))?.json, '{"ok":1}');
		});

		it("una pantalla cuyo nombre es prefijo de otra no se confunde con ella", async () => {
			const store = new FsWebCaptureStore(out);
			await store.saveCapture("home", '{"a":1}', AT);
			await store.saveCapture(
				"home-2",
				'{"b":1}',
				new Date(2026, 10, 12, 8, 0, 0),
			);
			assert.equal((await store.latest("home"))?.json, '{"a":1}');
		});

		it("read(ruta relativa) lee esa captura; fuera de web-captures/, en rejected/ o inexistente da null", async () => {
			const store = new FsWebCaptureStore(out);
			await store.saveCapture("inicio", '{"x":1}', AT);
			await store.saveRejected("inicio", "{}", "[]", AT);
			assert.equal(
				(await store.read("2026-11-11/inicio_102030.json"))?.json,
				'{"x":1}',
			);
			assert.equal(await store.read("../escape.json"), null);
			assert.equal(
				await store.read("rejected/2026-11-11/inicio_102030.json"),
				null,
			);
			assert.equal(await store.read("2026-11-11/no-existe.json"), null);
		});
	});

	it("imageFile da la ruta real de una imagen y savePlan deja el plan en screen-plans/<día>/", async () => {
		const store = new FsWebCaptureStore(out);
		assert.equal(
			rel(store.imageFile({ sha256: "a".repeat(64), type: "jpeg" })),
			`web-captures/img/${"a".repeat(64)}.jpg`,
		);
		const plan = await store.savePlan("inicio", "{}", AT);
		assert.equal(rel(plan.path), "screen-plans/2026-11-11/inicio_102030.json");
		assert.equal(await readFile(plan.path, "utf8"), "{}");
	});

	it("saveSheetPlan deja el plan de una hoja en sheet-plans/<día>/ y numera el repetido", async () => {
		const store = new FsWebCaptureStore(out);
		const first = await store.saveSheetPlan("button", "{}", AT);
		assert.equal(rel(first.path), "sheet-plans/2026-11-11/button_102030.json");
		assert.equal(await readFile(first.path, "utf8"), "{}");
		const second = await store.saveSheetPlan("button", "{1}", AT);
		assert.equal(
			rel(second.path),
			"sheet-plans/2026-11-11/button_102030-2.json",
		);
	});
});
