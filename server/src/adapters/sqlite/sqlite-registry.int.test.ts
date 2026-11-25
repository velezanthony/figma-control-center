import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import type { EntryDraft } from "#domain/registry.ts";
import { type FigmaDb, openFigmaDatabase } from "./database.ts";
import { SqliteRegistry } from "./sqlite-registry.ts";

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-base-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const opened: FigmaDb[] = [];
afterEach(() => {
	for (const db of opened.splice(0)) db.$client.close();
});

let n = 0;
function open(reserved: number[] = []) {
	const file = join(dir, `figma-${++n}.db`);
	const db = openFigmaDatabase(file);
	opened.push(db);
	const registry = new SqliteRegistry({
		db,
		placeFor: (id) => join(dir, "salida", id),
		reservedIds: () => reserved,
	});
	return { file, db, registry };
}

const draft = (name: string, extra: Partial<EntryDraft> = {}): EntryDraft => ({
	name,
	projectDir: "/p",
	fileUrl: `https://www.figma.com/design/${name}/Archivo`,
	...extra,
});

const added = async (r: SqliteRegistry, d: EntryDraft) => {
	const out = await r.add(d);
	assert.ok(out.ok, out.ok ? "" : out.error.message);
	return out.value;
};

describe("SqliteRegistry: ids", () => {
	it("el alta da 1, 2, 3 y borrar el 3 no lo devuelve: el siguiente es el 4", async () => {
		const { registry } = open();
		const ids = [];
		for (const name of ["A", "B", "C"]) {
			ids.push((await added(registry, draft(name))).id);
		}
		assert.deepEqual(ids, ["1", "2", "3"]);
		assert.ok((await registry.remove("3")).ok);
		assert.equal((await added(registry, draft("D"))).id, "4");
	});

	it("con carpetas numéricas por encima del siguiente (restos de un registro borrado), el id las supera", async () => {
		const { registry } = open([7, 2]);
		assert.equal((await added(registry, draft("A"))).id, "8");
		assert.equal((await added(registry, draft("B"))).id, "9");
	});

	it("las carpetas que van naciendo con cada proyecto no adelantan el contador", async () => {
		const folders: number[] = [];
		const { registry } = open(folders);
		assert.equal((await added(registry, draft("A"))).id, "1");
		folders.push(1);
		assert.equal((await added(registry, draft("B"))).id, "2");
		folders.push(2);
		assert.equal((await added(registry, draft("C"))).id, "3");
	});

	it("pasado el tope de 32767, el alta se rechaza y no deja fila", async () => {
		const { registry, db } = open();
		db.$client
			.prepare(
				"INSERT INTO projects(id, name, project_dir, file_url, file_key, output_dir) VALUES (32767, 'Ultimo', '/p', 'https://www.figma.com/design/U/U', 'U', '/u')",
			)
			.run();
		const out = await registry.add(draft("Otro"));
		assert.ok(!out.ok);
		assert.equal(out.error.reason, "malformed");
		assert.match(out.error.message, /32767/);
		assert.equal(
			db.$client.prepare("SELECT count(*) AS n FROM projects").get()?.[
				"n" as never
			],
			1,
		);
	});

	it("la carpeta numérica 1 con la tabla vacía hace que el primer id sea el 2", async () => {
		const { registry } = open([1]);
		assert.equal((await added(registry, draft("A"))).id, "2");
	});
});

describe("SqliteRegistry: filas", () => {
	it("guarda la carpeta ya resuelta (por defecto, <salida>/<id>) y la lee igual", async () => {
		const { registry } = open();
		const a = await added(registry, draft("A"));
		assert.equal(a.outputDir, join(dir, "salida", "1"));
		const read = await registry.read();
		assert.ok(read.ok);
		assert.deepEqual(read.value.entries, [a]);
		assert.equal(read.value.problems, undefined);
	});

	it("respeta la carpeta propia, las raíces de scripts y quita la barra final", async () => {
		const { registry } = open();
		const a = await added(
			registry,
			draft("A", {
				outputDir: "/x/salida/",
				scriptsRoots: ["/s1", "/s2"],
			}),
		);
		assert.equal(a.outputDir, "/x/salida");
		assert.deepEqual(a.scriptsRoots, ["/s1", "/s2"]);
	});

	it("lo escrito sobrevive a cerrar y volver a abrir la base", async () => {
		const { registry, file, db } = open();
		await added(registry, draft("A"));
		db.$client.close();
		const again = openFigmaDatabase(file);
		opened.push(again);
		const read = await new SqliteRegistry({
			db: again,
			placeFor: () => "/o",
		}).read();
		assert.ok(read.ok);
		assert.deepEqual(
			read.value.entries.map((e) => e.name),
			["A"],
		);
	});

	it("update cambia la fila; uno que no existe es notFound", async () => {
		const { registry } = open();
		const a = await added(registry, draft("A", { outputDir: "/x/o" }));
		const upd = await registry.update({ ...a, name: "Nuevo" });
		assert.ok(upd.ok);
		const read = await registry.read();
		assert.ok(read.ok);
		assert.equal(read.value.entries[0]?.name, "Nuevo");
		const missing = await registry.update({ ...a, id: "99" });
		assert.ok(!missing.ok);
		assert.equal(missing.error.reason, "notFound");
	});

	it("remove borra el histórico del proyecto (y su índice de texto) y deja el del otro", async () => {
		const { registry, db } = open();
		const a = await added(registry, draft("A"));
		const b = await added(registry, draft("B"));
		for (const p of [a.id, b.id]) {
			db.$client.exec(`INSERT INTO sessions(project_id, id, started_at, last_seen_at) VALUES (${p}, 's', 1, 1);
				INSERT INTO calls(project_id, call_id, session_id, started_at, tool, status, is_write, args_summary, summary)
				VALUES (${p}, 'c', 's', 1, 'figma_status', 'ok', 0, '{}', 'estado del proyecto ${p}')`);
		}
		assert.ok((await registry.remove(a.id)).ok);
		const left = db.$client.prepare("SELECT project_id FROM calls").all() as {
			project_id: number;
		}[];
		assert.deepEqual(
			left.map((r) => r.project_id),
			[Number(b.id)],
		);
		const fts = db.$client
			.prepare(
				"SELECT count(*) AS n FROM calls_fts WHERE calls_fts MATCH 'estado'",
			)
			.get() as { n: number };
		assert.equal(fts.n, 1);
	});

	it("remove de un id que no existe no es error", async () => {
		const { registry } = open();
		assert.ok((await registry.remove("5")).ok);
	});
});

describe("SqliteRegistry: índices únicos", () => {
	it("el mismo archivo de Figma, venga la URL como venga, es conflicto y nombra al otro proyecto", async () => {
		const { registry } = open();
		await added(registry, draft("A"));
		const dup = await registry.add(
			draft("B", { fileUrl: "https://www.figma.com/file/A/Otro-nombre" }),
		);
		assert.ok(!dup.ok);
		assert.equal(dup.error.reason, "conflict");
		assert.match(
			dup.error.message,
			/archivo de Figma ya lo usa el proyecto «A»/,
		);
	});

	it("la misma carpeta (con o sin barra final) es conflicto", async () => {
		const { registry } = open();
		await added(registry, draft("A", { outputDir: "/x/o" }));
		const sameDir = await registry.add(draft("C", { outputDir: "/x/o/" }));
		assert.ok(!sameDir.ok);
		assert.match(sameDir.error.message, /outputDir ya lo usa el proyecto «A»/);
	});

	it("un conflicto no deja fila a medias ni gasta el id", async () => {
		const { registry } = open();
		await added(registry, draft("A"));
		assert.ok(!(await registry.add(draft("A"))).ok);
		assert.equal((await added(registry, draft("B"))).id, "2");
	});

	it("update que choca con otro proyecto es conflicto y no cambia nada", async () => {
		const { registry } = open();
		const a = await added(registry, draft("A"));
		await added(registry, draft("B"));
		const out = await registry.update({
			...a,
			fileUrl: "https://www.figma.com/design/B/B",
		});
		assert.ok(!out.ok);
		assert.equal(out.error.reason, "conflict");
		const read = await registry.read();
		assert.ok(read.ok);
		assert.equal(
			read.value.entries[0]?.fileUrl,
			"https://www.figma.com/design/A/Archivo",
		);
	});
});

describe("SqliteRegistry: lectura tolerante", () => {
	it("una fila con una URL inválida (editada a mano) se ignora y se cuenta; el resto sigue", async () => {
		const { registry, db } = open();
		await added(registry, draft("A"));
		db.$client
			.prepare(
				"INSERT INTO projects(name, project_dir, file_url, file_key, output_dir) VALUES ('Mala','/p','esto no es una url','K','/m')",
			)
			.run();
		await added(registry, draft("C"));
		const read = await registry.read();
		assert.ok(read.ok);
		assert.deepEqual(
			read.value.entries.map((e) => e.name),
			["A", "C"],
		);
		assert.equal(read.value.problems?.length, 1);
		assert.match(read.value.problems?.[0] ?? "", /proyecto 2/);
	});
});
