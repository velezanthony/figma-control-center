import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { FIGMA_ERROR_TYPE } from "#domain/figma-error.ts";
import { FsScriptRepository } from "./fs-script-repository.ts";

let base: string;
let repo: FsScriptRepository;

before(async () => {
	base = await mkdtemp(join(tmpdir(), "figma-scripts-"));
	await mkdir(join(base, "scripts"));
	await mkdir(join(base, "otra-raiz"));
	await mkdir(join(base, "scripts-vecino"));
	await writeFile(join(base, "scripts", "ok.js"), "async () => 1");
	await writeFile(join(base, "otra-raiz", "b.js"), "async () => 2");
	await writeFile(join(base, "scripts-vecino", "x.js"), "secreto");
	await writeFile(join(base, "fuera.js"), "secreto");
	await symlink(join(base, "fuera.js"), join(base, "scripts", "enlace.js"));
	repo = new FsScriptRepository({
		roots: [
			join(base, "scripts"),
			join(base, "otra-raiz"),
			join(base, "no-existe"),
		],
		baseDir: base,
	});
});
after(() => rm(base, { recursive: true, force: true }));

const failure = async (path: string) => {
	const r = await repo.read(path);
	assert.ok(!r.ok, `se esperaba error para ${path}`);
	assert.equal(r.error.type, FIGMA_ERROR_TYPE.scriptReadError);
	assert.equal(r.error.retryable, false);
	return r.error.message;
};

describe("FsScriptRepository", () => {
	it("lee un script por ruta absoluta dentro de la raíz", async () => {
		assert.deepEqual(await repo.read(join(base, "scripts", "ok.js")), {
			ok: true,
			value: "async () => 1",
		});
	});

	it("resuelve rutas relativas contra baseDir", async () => {
		assert.deepEqual(await repo.read("scripts/ok.js"), {
			ok: true,
			value: "async () => 1",
		});
	});

	it("admite varias raíces", async () => {
		assert.deepEqual(await repo.read(join(base, "otra-raiz", "b.js")), {
			ok: true,
			value: "async () => 2",
		});
	});

	it("una ruta fuera de las raíces es ScriptReadError", async () => {
		assert.match(await failure(join(base, "fuera.js")), /fuera de las raíces/);
		assert.match(await failure("/etc/hostname"), /fuera de las raíces/);
	});

	it("un «..» que escapa de la raíz es ScriptReadError", async () => {
		assert.match(await failure("scripts/../fuera.js"), /fuera de las raíces/);
	});

	it("una carpeta vecina con el mismo prefijo no cuenta como dentro", async () => {
		assert.match(
			await failure(join(base, "scripts-vecino", "x.js")),
			/fuera de las raíces/,
		);
	});

	it("un enlace simbólico que apunta fuera es ScriptReadError", async () => {
		assert.match(
			await failure(join(base, "scripts", "enlace.js")),
			/fuera de las raíces/,
		);
	});

	it("un fichero inexistente es ScriptReadError", async () => {
		assert.match(await failure(join(base, "scripts", "nada.js")), /no existe/);
	});

	it("una carpeta no es un script", async () => {
		const dir = join(base, "scripts", "sub");
		await mkdir(dir);
		assert.match(await failure(dir), /no es un fichero/);
	});
});

describe("FsScriptRepository.identity: la ruta relativa a su raíz de scripts", () => {
	it("da la ruta relativa a la raíz en que está, venga relativa o absoluta", async () => {
		assert.equal(await repo.identity("scripts/ok.js"), "ok.js");
		assert.equal(await repo.identity(join(base, "scripts", "ok.js")), "ok.js");
		assert.equal(await repo.identity(join(base, "otra-raiz", "b.js")), "b.js");
	});

	it("la misma carpeta en otra máquina (otra ruta absoluta) da el mismo nombre", async () => {
		const other = await mkdtemp(join(tmpdir(), "figma-scripts-otra-"));
		try {
			await mkdir(join(other, "scripts"));
			await writeFile(join(other, "scripts", "ok.js"), "x");
			const twin = new FsScriptRepository({
				roots: [join(other, "scripts")],
				baseDir: other,
			});
			assert.equal(await twin.identity("scripts/ok.js"), "ok.js");
		} finally {
			await rm(other, { recursive: true, force: true });
		}
	});

	it("una subcarpeta se conserva con barras normales", async () => {
		await mkdir(join(base, "scripts", "sub"), { recursive: true });
		await writeFile(join(base, "scripts", "sub", "c.js"), "x");
		assert.equal(await repo.identity("scripts/sub/c.js"), "sub/c.js");
	});

	it("una ruta que no existe o está fuera de las raíces vuelve tal cual (el historial no falla por esto)", async () => {
		assert.equal(await repo.identity("scripts/no-hay.js"), "scripts/no-hay.js");
		assert.equal(await repo.identity("fuera.js"), "fuera.js");
	});
});
