import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { openFigmaDatabase, SQLITE } from "./database.ts";
import { ensureProject } from "./testing/projects.ts";

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-db-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();

describe("openFigmaDatabase: migraciones sobre una base temporal", () => {
	it("crea las tablas, la tabla FTS5 y los tres triggers que la mantienen", () => {
		const db = openFigmaDatabase(join(dir, "a.db"));
		const tables = db.$client
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')")
			.all() as { name: string }[];
		for (const t of [
			"sessions",
			"events",
			"calls",
			"jobs",
			"call_nodes",
			"nodes_touched",
			"captures",
			"meta",
			"calls_fts",
			"chat_messages",
			"chat_messages_fts",
		]) {
			assert.ok(names(tables).includes(t), `falta la tabla ${t}`);
		}
		const triggers = db.$client
			.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
			.all() as { name: string }[];
		assert.deepEqual(names(triggers), [
			"calls_fts_ad",
			"calls_fts_ai",
			"calls_fts_au",
			"chat_fts_ad",
			"chat_fts_ai",
			"chat_fts_au",
		]);
		db.$client.close();
	});

	it("los triggers multilínea no se partieron: insertar, actualizar y borrar mantiene el índice", () => {
		const db = openFigmaDatabase(join(dir, "b.db"));
		ensureProject(db, 1);
		const sql = db.$client;
		sql.exec(
			"INSERT INTO sessions(project_id, id, started_at, last_seen_at) VALUES (1, 's', 1, 1)",
		);
		sql.exec(`INSERT INTO calls(project_id, call_id, session_id, started_at, tool, status, is_write, args_summary, summary, extra_text)
			VALUES (1, 'c', 's', 1, 'figma_run_script', 'running', 1, '{}', 'figma_run_script scripts/pintar.js → en curso', '')`);
		const hits = (q: string) =>
			(
				sql
					.prepare("SELECT rowid FROM calls_fts WHERE calls_fts MATCH ?")
					.all(q) as unknown[]
			).length;
		assert.equal(hits("pintar"), 1);
		sql.exec(
			"UPDATE calls SET summary = 'figma_run_script scripts/borrar.js → ok', error_message = 'Boom en la línea 3', extra_text = '1:23' WHERE call_id = 'c'",
		);
		assert.equal(hits("pintar"), 0);
		assert.equal(hits("borrar"), 1);
		assert.equal(hits("boom"), 1);
		sql.exec("DELETE FROM calls WHERE call_id = 'c'");
		assert.equal(hits("borrar"), 0);
		db.$client.close();
	});

	it("activa WAL, el plazo de espera y las claves ajenas", () => {
		const db = openFigmaDatabase(join(dir, "c.db"));
		const sql = db.$client;
		assert.equal(sql.pragma("journal_mode", { simple: true }), "wal");
		assert.ok((sql.pragma("busy_timeout", { simple: true }) as number) >= 1000);
		assert.equal(sql.pragma("foreign_keys", { simple: true }), 1);
		db.$client.close();
	});

	it("abrir dos veces la misma base no repite las migraciones", () => {
		const file = join(dir, "d.db");
		openFigmaDatabase(file).$client.close();
		const again = openFigmaDatabase(file);
		const applied = again.$client
			.prepare("SELECT count(*) AS n FROM __drizzle_migrations")
			.get() as { n: number };
		const journal = JSON.parse(
			readFileSync(
				join(SQLITE.migrationsFolder, "meta", "_journal.json"),
				"utf8",
			),
		) as { entries: unknown[] };
		assert.equal(applied.n, journal.entries.length);
		again.$client.close();
	});

	it("una base solo con proyectos (la de antes del histórico único) se abre, conserva sus proyectos y gana las tablas del histórico", async () => {
		const old = join(dir, "migraciones-viejas");
		await cp(SQLITE.migrationsFolder, old, { recursive: true });
		const journalPath = join(old, "meta", "_journal.json");
		const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
			entries: { tag: string }[];
		};
		journal.entries = journal.entries.filter((e) => e.tag.includes("projects"));
		await writeFile(journalPath, JSON.stringify(journal));

		const file = join(dir, "antigua.db");
		const raw = new Database(file);
		migrate(drizzle(raw), { migrationsFolder: old });
		raw.exec(
			"INSERT INTO projects(name, project_dir, file_url, file_key, output_dir) VALUES ('Viejo', '/p', 'https://www.figma.com/design/V/V', 'V', '/o')",
		);
		raw.close();

		const db = openFigmaDatabase(file);
		const project = db.$client.prepare("SELECT id, name FROM projects").get();
		assert.deepEqual(project, { id: 1, name: "Viejo" });
		const tables = db.$client
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all() as { name: string }[];
		assert.ok(names(tables).includes("calls"));
		assert.ok(names(tables).includes("calls_fts"));
		db.$client.close();
	});

	it("una conexión de solo consulta lee pero el motor rechaza escribir", () => {
		const file = join(dir, "e.db");
		const writer = openFigmaDatabase(file);
		ensureProject(writer, 1);
		writer.$client.exec(
			"INSERT INTO sessions(project_id, id, started_at, last_seen_at) VALUES (1, 's', 1, 1)",
		);
		const reader = openFigmaDatabase(file, { queryOnly: true });
		assert.equal(
			(
				reader.$client.prepare("SELECT count(*) AS n FROM sessions").get() as {
					n: number;
				}
			).n,
			1,
		);
		assert.throws(
			() =>
				reader.$client.exec(
					"INSERT INTO sessions(project_id, id, started_at, last_seen_at) VALUES (1, 't', 1, 1)",
				),
			(e: Error & { code?: string }) => e.code === "SQLITE_READONLY",
		);
		writer.$client.close();
		reader.$client.close();
	});
});
