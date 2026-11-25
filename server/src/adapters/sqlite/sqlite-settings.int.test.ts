import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { openFigmaDatabase } from "./database.ts";
import { SqliteSettings } from "./sqlite-settings.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-ajustes-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const open = (file: string) =>
	new SqliteSettings({ db: openFigmaDatabase(file) });

describe("SqliteSettings", () => {
	it("una base sin ajustes devuelve un objeto vacío", () => {
		assert.deepEqual(open(join(dir, `a${++n}.db`)).all(), {});
	});

	it("guarda y sustituye: el último valor de cada clave manda", () => {
		const settings = open(join(dir, `a${++n}.db`));
		settings.set("FCC_HISTORY_MAX_ROWS", "50");
		settings.set("FCC_LIVE_POLL_MS", "250");
		settings.set("FCC_HISTORY_MAX_ROWS", "77");
		assert.deepEqual(settings.all(), {
			FCC_HISTORY_MAX_ROWS: "77",
			FCC_LIVE_POLL_MS: "250",
		});
	});

	it("lo guardado sobrevive a volver a abrir la base y lo ve otra conexión", () => {
		const file = join(dir, `a${++n}.db`);
		open(file).set("FCC_BUILD_MAX_STEPS", "10");
		assert.deepEqual(open(file).all(), { FCC_BUILD_MAX_STEPS: "10" });
	});

	it("remove borra esa fila y deja las demás", () => {
		const settings = open(join(dir, `a${++n}.db`));
		settings.set("FCC_HISTORY_MAX_ROWS", "50");
		settings.set("FCC_LIVE_POLL_MS", "250");
		settings.remove("FCC_HISTORY_MAX_ROWS");
		assert.deepEqual(settings.all(), { FCC_LIVE_POLL_MS: "250" });
	});

	it("remove de una clave sin fila no falla ni toca nada", () => {
		const settings = open(join(dir, `a${++n}.db`));
		settings.set("FCC_LIVE_POLL_MS", "250");
		settings.remove("FCC_HISTORY_MAX_ROWS");
		assert.deepEqual(settings.all(), { FCC_LIVE_POLL_MS: "250" });
	});

	it("removeMany borra solo esas filas en una transacción y dice cuáles tenían fila", () => {
		const settings = open(join(dir, `a${++n}.db`));
		settings.set("FCC_HISTORY_MAX_ROWS", "50");
		settings.set("FCC_LIVE_POLL_MS", "250");
		settings.set("FCC_DB", "/x.db");
		const removed = settings.removeMany([
			"FCC_HISTORY_MAX_ROWS",
			"FCC_LIVE_POLL_MS",
			"FCC_BUILD_MAX_STEPS",
		]);
		assert.deepEqual([...removed].sort(), [
			"FCC_HISTORY_MAX_ROWS",
			"FCC_LIVE_POLL_MS",
		]);
		assert.deepEqual(settings.all(), { FCC_DB: "/x.db" });
	});

	it("removeMany sin filas que borrar no falla", () => {
		const settings = open(join(dir, `a${++n}.db`));
		assert.deepEqual(settings.removeMany(["FCC_LIVE_POLL_MS"]), []);
		assert.deepEqual(settings.removeMany([]), []);
	});
});
