import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FsComposeStore } from "./fs-compose-store.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "compose-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const COMPOSE = {
	contract: "compose@1",
	key: "alta",
	title: "Alta",
	target: { page: "Pruebas", width: 640 },
	root: { text: "Hola", style: "Texto/S" },
};
const put = (name: string, value: unknown) =>
	writeFile(
		join(dir, name),
		typeof value === "string" ? value : JSON.stringify(value),
	);

describe("FsComposeStore.read", () => {
	it("lee <clave>.json de la carpeta y devuelve el compose con su ruta y su texto", async () => {
		await put("alta.json", COMPOSE);
		const store = new FsComposeStore();
		const r = await store.read(dir, "alta");
		assert.equal(r.kind, "ok");
		if (r.kind !== "ok") return;
		assert.equal(r.compose.title, "Alta");
		assert.equal(r.path, join(dir, "alta.json"));
		assert.equal(JSON.parse(r.text).key, "alta");
	});

	it("un compose que no existe es `missing`, con la ruta donde lo esperaba", async () => {
		const r = await new FsComposeStore().read(dir, "nada");
		assert.deepEqual(r, { kind: "missing", path: join(dir, "nada.json") });
	});

	it("una clave con barras o puntos no sale de la carpeta: es un error de uso", async () => {
		await mkdir(join(dir, "sub"));
		await put("alta.json", COMPOSE);
		for (const key of ["../alta", "sub/alta", "alta.json", ""]) {
			const r = await new FsComposeStore().read(join(dir, "sub"), key);
			assert.equal(r.kind, "usage", key);
		}
	});

	it("un JSON roto o un compose que no cumple el contrato es ContractError con el puntero", async () => {
		await put("roto.json", "{ no es json");
		const broken = await new FsComposeStore().read(dir, "roto");
		assert.equal(broken.kind, "error");
		await put("mal.json", { ...COMPOSE, key: "mal", target: { page: "P" } });
		const bad = await new FsComposeStore().read(dir, "mal");
		assert.equal(bad.kind, "error");
		if (bad.kind !== "error") return;
		assert.equal(bad.error.type, "ContractError");
		assert.equal("path" in bad.error ? bad.error.path : null, "/target/width");
	});

	it("la clave del fichero tiene que ser la del nombre: si no, es ContractError en /key", async () => {
		await put("alta.json", { ...COMPOSE, key: "otra" });
		const r = await new FsComposeStore().read(dir, "alta");
		assert.equal(r.kind, "error");
		if (r.kind !== "error") return;
		assert.equal("path" in r.error ? r.error.path : null, "/key");
	});
});
