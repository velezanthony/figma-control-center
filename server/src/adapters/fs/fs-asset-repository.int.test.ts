import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { FsAssetRepository } from "./fs-asset-repository.ts";

let base: string;
let repo: FsAssetRepository;

before(async () => {
	base = await mkdtemp(join(tmpdir(), "figma-assets-"));
	await mkdir(join(base, "scripts"));
	await writeFile(
		join(base, "scripts", "mapa.png"),
		Uint8Array.from([1, 2, 3]),
	);
	await writeFile(join(base, "scripts", "logo.png"), Uint8Array.from([4, 5]));
	await writeFile(
		join(base, "scripts", "extra.png"),
		Uint8Array.from([6, 7, 8]),
	);
	await writeFile(join(base, "fuera.png"), Uint8Array.from([9]));
	await symlink(join(base, "fuera.png"), join(base, "scripts", "enlace.png"));
	repo = new FsAssetRepository({
		roots: [join(base, "scripts")],
		baseDir: base,
		maxTotalBytes: 5,
	});
});
after(() => rm(base, { recursive: true, force: true }));

describe("FsAssetRepository", () => {
	it("lee los bytes de varios assets por nombre", async () => {
		const r = await repo.read({
			mapa: "scripts/mapa.png",
			logo: join(base, "scripts", "logo.png"),
		});
		assert.ok(r.ok);
		assert.deepEqual(r.value["mapa"], Uint8Array.from([1, 2, 3]));
		assert.deepEqual(r.value["logo"], Uint8Array.from([4, 5]));
	});

	it("un asset fuera de las raíces es ScriptReadError (CA-6)", async () => {
		const r = await repo.read({ malo: join(base, "fuera.png") });
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /fuera de las raíces/);
	});

	it("un enlace simbólico que apunta fuera es ScriptReadError", async () => {
		const r = await repo.read({ malo: "scripts/enlace.png" });
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
	});

	it("un asset inexistente es ScriptReadError", async () => {
		const r = await repo.read({ malo: "scripts/nada.png" });
		assert.ok(!r.ok);
		assert.match(r.error.message, /no existe/);
	});

	it("si el total supera el tope se rechaza entero (CA-6)", async () => {
		const r = await repo.read({
			mapa: "scripts/mapa.png",
			logo: "scripts/logo.png",
			extra: "scripts/extra.png",
		});
		assert.ok(!r.ok);
		assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.match(r.error.message, /supera el tope/);
	});

	it("check acepta lo que read leería y no devuelve bytes", async () => {
		const r = await repo.check({
			mapa: "scripts/mapa.png",
			logo: "scripts/logo.png",
		});
		assert.ok(r.ok);
		assert.equal(r.value, undefined);
	});

	it("check rechaza lo mismo que read: fuera de raíces, enlace, inexistente y total sobre el tope", async () => {
		const outside = await repo.check({ malo: join(base, "fuera.png") });
		assert.ok(!outside.ok && /fuera de las raíces/.test(outside.error.message));
		const link = await repo.check({ malo: "scripts/enlace.png" });
		assert.ok(!link.ok);
		const missing = await repo.check({ malo: "scripts/nada.png" });
		assert.ok(!missing.ok && /no existe/.test(missing.error.message));
		const big = await repo.check({
			mapa: "scripts/mapa.png",
			logo: "scripts/logo.png",
			extra: "scripts/extra.png",
		});
		assert.ok(!big.ok && /supera el tope/.test(big.error.message));
	});
});

describe("FsAssetRepository.describe: nombre, ruta relativa a su raíz, tamaño y sha256", () => {
	it("describe cada asset sin copiar sus bytes", async () => {
		const out = await repo.describe({
			mapa: "scripts/mapa.png",
			logo: join(base, "scripts", "logo.png"),
		});
		assert.deepEqual(out, [
			{
				name: "mapa",
				path: "mapa.png",
				bytes: 3,
				sha256: createHash("sha256")
					.update(Uint8Array.from([1, 2, 3]))
					.digest("hex"),
			},
			{
				name: "logo",
				path: "logo.png",
				bytes: 2,
				sha256: createHash("sha256")
					.update(Uint8Array.from([4, 5]))
					.digest("hex"),
			},
		]);
	});

	it("un asset que no se puede leer se omite: describir nunca falla", async () => {
		assert.deepEqual(await repo.describe({ x: "scripts/no-hay.png" }), []);
	});
});
