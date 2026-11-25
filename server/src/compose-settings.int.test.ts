import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { LayeredConfig } from "#adapters/config/schema.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteSettings } from "#adapters/sqlite/sqlite-settings.ts";
import { composeConfig } from "./compose-settings.ts";

let dir: string;
before(() => {
	dir = mkdtempSync(join(tmpdir(), "figma-compose-settings-"));
});
after(() => rmSync(dir, { recursive: true, force: true }));

// Una configuración falsa que solo recuerda con qué ajustes guardados se pidió (y dónde está su base)
const fakeLayered = (dbPath: string, stored: Record<string, string> = {}) =>
	({
		machine: { dbPath },
		settingProblems: [],
		marker: stored,
	}) as unknown as LayeredConfig & { marker: Record<string, string> };

describe("composeConfig", () => {
	it("lee los ajustes de la base única y los pasa a la configuración final, que se compone una vez", () => {
		const file = join(dir, "ok.db");
		new SqliteSettings({ db: openFigmaDatabase(file) }).set(
			"FCC_HISTORY_MAX_ROWS",
			"77",
		);
		const warnings: string[] = [];
		const { layered, store } = composeConfig({
			boot: fakeLayered(file),
			layeredWith: (stored) => fakeLayered(file, { ...stored }),
			warn: (m) => warnings.push(m),
		});
		assert.deepEqual((layered as unknown as { marker: unknown }).marker, {
			FCC_HISTORY_MAX_ROWS: "77",
		});
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "77" });
		assert.deepEqual(warnings, []);
	});

	it("devuelve lo guardado que leyó al arrancar, que no cambia aunque se guarde algo después", () => {
		const file = join(dir, "arranque.db");
		new SqliteSettings({ db: openFigmaDatabase(file) }).set(
			"FCC_LIVE_POLL_MS",
			"300",
		);
		const { store, storedAtBoot } = composeConfig({
			boot: fakeLayered(file),
			layeredWith: () => fakeLayered(file),
			warn: () => {},
		});
		store.set("FCC_LIVE_POLL_MS", "900");
		assert.deepEqual(storedAtBoot, { FCC_LIVE_POLL_MS: "300" });
	});

	it("avisa de los ajustes guardados que no valen, sin tumbar el arranque", () => {
		const file = join(dir, "avisos.db");
		const warnings: string[] = [];
		composeConfig({
			boot: fakeLayered(file),
			layeredWith: () =>
				({
					...fakeLayered(file),
					settingProblems: ["ajuste ignorado: «X» no vale"],
				}) as unknown as LayeredConfig,
			warn: (m) => warnings.push(m),
		});
		assert.deepEqual(warnings, [
			"figma-control-center: ajuste ignorado: «X» no vale",
		]);
	});

	it("si la base no se puede abrir, arranca con la configuración de siempre y los ajustes responden con el error y la ruta", () => {
		const broken = join(dir, "rota.db");
		writeFileSync(broken, "esto no es una base SQLite");
		const warnings: string[] = [];
		const seen: Record<string, string>[] = [];
		const { store, storedAtBoot } = composeConfig({
			boot: fakeLayered(broken),
			layeredWith: (stored) => {
				seen.push({ ...stored });
				return fakeLayered(broken);
			},
			warn: (m) => warnings.push(m),
		});
		assert.deepEqual(seen, [{}]);
		assert.deepEqual(storedAtBoot, {});
		assert.throws(
			() => store.all(),
			(e: Error) => e.message.includes(broken),
		);
		assert.throws(
			() => store.remove("FCC_LIVE_POLL_MS"),
			(e: Error) => e.message.includes(broken),
		);
		assert.equal(warnings.length, 1);
		assert.ok(warnings[0]?.includes(broken));
	});
});
