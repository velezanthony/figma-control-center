import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { FsSecretStore } from "./fs-secrets.ts";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "secretos-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

const file = () => join(dir, "secrets.json");

describe("FsSecretStore: el fichero de secretos de la máquina", () => {
	it("resuelve los secretRef pedidos con su valor", async () => {
		await writeFile(file(), JSON.stringify({ a: "uno", b: "dos", c: "tres" }));
		const r = await new FsSecretStore(file()).resolve(["a", "c"]);
		assert.equal(r.ok, true);
		assert.deepEqual(r.ok && [...r.value], [
			["a", "uno"],
			["c", "tres"],
		]);
	});

	it("un secretRef que no está es SecretMissing con su nombre y sin ningún valor", async () => {
		await writeFile(file(), JSON.stringify({ a: "valor-secreto" }));
		const r = await new FsSecretStore(file()).resolve(["a", "falta"]);
		assert.equal(r.ok, false);
		if (r.ok) return;
		assert.equal(r.error.type, "SecretMissing");
		assert.match(r.error.message, /falta/);
		assert.doesNotMatch(JSON.stringify(r.error), /valor-secreto/);
	});

	it("sin fichero, o con uno que no es un objeto de textos, es SecretMissing con el motivo", async () => {
		const missing = await new FsSecretStore(file()).resolve(["a"]);
		assert.equal(!missing.ok && missing.error.type, "SecretMissing");
		assert.match(!missing.ok ? missing.error.message : "", /no existe/);
		await writeFile(file(), JSON.stringify({ a: 1 }));
		const bad = await new FsSecretStore(file()).resolve(["a"]);
		assert.equal(!bad.ok && bad.error.type, "SecretMissing");
		await writeFile(file(), "{roto");
		const broken = await new FsSecretStore(file()).resolve(["a"]);
		assert.equal(!broken.ok && broken.error.type, "SecretMissing");
	});

	it("sin secretRef que resolver no lee el fichero (una captura pública no lo necesita)", async () => {
		const r = await new FsSecretStore(join(dir, "no-existe.json")).resolve([]);
		assert.equal(r.ok, true);
	});

	it("nunca escribe un valor por stderr", async () => {
		await writeFile(file(), JSON.stringify({ a: "valor-secreto" }));
		const spy = mock.method(process.stderr, "write", () => true);
		try {
			await new FsSecretStore(file()).resolve(["a", "falta"]);
			await new FsSecretStore(file()).resolve(["a"]);
		} finally {
			spy.mock.restore();
		}
		const written = spy.mock.calls.map((c) => String(c.arguments[0])).join("");
		assert.doesNotMatch(written, /valor-secreto/);
	});
});
