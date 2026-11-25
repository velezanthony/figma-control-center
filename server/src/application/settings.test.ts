import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SettingView } from "#domain/settings.ts";
import {
	makeListSettings,
	makeResetAllSettings,
	makeResetSetting,
	makeSaveSetting,
} from "./settings.ts";
import { InMemorySettings } from "./testing/in-memory-settings.ts";

const validate = (key: string, value: string): string | null =>
	key === "FCC_LIVE_POLL_MS" && /^[1-9][0-9]*$/.test(value)
		? null
		: `«${key}» con «${value}» no vale`;

// Lo que dice la configuración de una clave: editable, de arranque o desconocida
const EDITABLE = ["FCC_LIVE_POLL_MS", "FCC_HISTORY_MAX_ROWS"];
const checkKey = (key: string): string | null =>
	EDITABLE.includes(key) ? null : `«${key}» no es editable`;
const notSetByEnvironment = (): boolean => false;

describe("makeSaveSetting", () => {
	it("guarda un ajuste que vale", () => {
		const store = new InMemorySettings();
		const result = makeSaveSetting({
			store,
			validate,
			setByEnvironment: notSetByEnvironment,
		})("FCC_LIVE_POLL_MS", "250");
		assert.ok(result.ok);
		assert.deepEqual(store.all(), { FCC_LIVE_POLL_MS: "250" });
	});

	it("rechaza uno que no vale, con el motivo, y no guarda nada", () => {
		const store = new InMemorySettings();
		const result = makeSaveSetting({
			store,
			validate,
			setByEnvironment: notSetByEnvironment,
		})("FCC_DB", "/x.db");
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "rejected");
		assert.match(result.error.message, /FCC_DB/);
		assert.deepEqual(store.all(), {});
	});

	it("si la base falla al escribir, lo cuenta como error de lectura/escritura", () => {
		const store = new InMemorySettings();
		store.failWith = new Error("disco lleno");
		const result = makeSaveSetting({
			store,
			validate,
			setByEnvironment: notSetByEnvironment,
		})("FCC_LIVE_POLL_MS", "250");
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "unreadable");
		assert.match(result.error.message, /disco lleno/);
	});
});

describe("makeSaveSetting: un valor igual al de por defecto no se guarda", () => {
	const isDefault = (_key: string, value: string): boolean =>
		value.trim() === "500";
	const save = (store: InMemorySettings) =>
		makeSaveSetting({
			store,
			validate: () => null,
			isDefault,
			setByEnvironment: notSetByEnvironment,
		});

	it("sin nada guardado, no escribe nada y responde bien", () => {
		const store = new InMemorySettings();
		assert.ok(save(store)("FCC_LIVE_POLL_MS", " 500 ").ok);
		assert.deepEqual(store.all(), {});
	});

	it("con algo guardado, lo borra (como restablecer) y deja lo demás", () => {
		const store = new InMemorySettings({
			FCC_LIVE_POLL_MS: "250",
			FCC_HISTORY_MAX_ROWS: "50",
		});
		assert.ok(save(store)("FCC_LIVE_POLL_MS", "500").ok);
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "50" });
	});

	it("un valor distinto del default se guarda", () => {
		const store = new InMemorySettings();
		assert.ok(save(store)("FCC_LIVE_POLL_MS", "250").ok);
		assert.deepEqual(store.all(), { FCC_LIVE_POLL_MS: "250" });
	});

	it("si lo fija el entorno sigue siendo 409: el entorno se mira antes", () => {
		const store = new InMemorySettings({ FCC_LIVE_POLL_MS: "250" });
		const result = makeSaveSetting({
			store,
			validate: () => null,
			isDefault,
			setByEnvironment: () => true,
		})("FCC_LIVE_POLL_MS", "500");
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "environment");
		assert.deepEqual(store.all(), { FCC_LIVE_POLL_MS: "250" });
	});
});

describe("makeSaveSetting: el entorno manda", () => {
	it("una clave que fija el entorno no se guarda: error de entorno y la base sin tocar", () => {
		const store = new InMemorySettings({ FCC_HISTORY_MAX_ROWS: "50" });
		const result = makeSaveSetting({
			store,
			validate,
			setByEnvironment: (key) => key === "FCC_LIVE_POLL_MS",
		})("FCC_LIVE_POLL_MS", "250");
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "environment");
		assert.match(result.error.message, /FCC_LIVE_POLL_MS/);
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "50" });
	});

	it("guarda el valor como lo lee la configuración, no como llega", () => {
		const store = new InMemorySettings();
		const result = makeSaveSetting({
			store,
			validate: () => null,
			normalize: (_key, value) => value.trim(),
			setByEnvironment: notSetByEnvironment,
		})("FCC_LIVE_POLL_MS", " 500 ");
		assert.ok(result.ok);
		assert.deepEqual(store.all(), { FCC_LIVE_POLL_MS: "500" });
	});
});

describe("makeResetSetting", () => {
	it("borra solo esa clave", () => {
		const store = new InMemorySettings({
			FCC_LIVE_POLL_MS: "250",
			FCC_HISTORY_MAX_ROWS: "50",
		});
		const result = makeResetSetting({ store, checkKey })("FCC_LIVE_POLL_MS");
		assert.ok(result.ok);
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "50" });
	});

	it("sin nada guardado de esa clave no falla", () => {
		const store = new InMemorySettings({ FCC_HISTORY_MAX_ROWS: "50" });
		const result = makeResetSetting({ store, checkKey })("FCC_LIVE_POLL_MS");
		assert.ok(result.ok);
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "50" });
	});

	it("una clave de arranque o desconocida se rechaza con el motivo y no se borra nada (D-9)", () => {
		for (const key of ["FCC_DB", "FCC_NO_EXISTE"]) {
			const store = new InMemorySettings({ [key]: "x" });
			const result = makeResetSetting({ store, checkKey })(key);
			assert.ok(!result.ok, key);
			assert.equal(result.error.reason, "rejected");
			assert.match(result.error.message, new RegExp(key));
			assert.deepEqual(store.all(), { [key]: "x" });
		}
	});

	it("si la base no se puede abrir, error de lectura/escritura con el motivo", () => {
		const store = new InMemorySettings();
		store.failWith = new Error("base bloqueada");
		const result = makeResetSetting({ store, checkKey })("FCC_LIVE_POLL_MS");
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "unreadable");
		assert.match(result.error.message, /base bloqueada/);
	});
});

describe("makeListSettings", () => {
	const view: SettingView = {
		key: "FCC_LIVE_POLL_MS",
		group: "Panel",
		name: "Sondeo en vivo del panel",
		help: "Cada cuánto mira el panel si hay actividad nueva.",
		unit: "ms",
		usedBy: ["panel"],
		stored: "900",
		effective: 900,
		origin: "panel",
		default: 500,
		running: 900,
	};

	it("describe lo guardado con la función de configuración y cuenta los ajustes que no valen", () => {
		const store = new InMemorySettings({ FCC_LIVE_POLL_MS: "900" });
		const seen: Record<string, string>[] = [];
		const list = makeListSettings({
			store,
			describe: (stored) => {
				seen.push({ ...stored });
				return [view];
			},
			problems: () => ["ajuste ignorado: «X» no vale"],
		});
		const result = list();
		assert.ok(result.ok);
		assert.deepEqual(result.value, {
			settings: [view],
			problems: ["ajuste ignorado: «X» no vale"],
		});
		assert.deepEqual(seen, [{ FCC_LIVE_POLL_MS: "900" }]);
	});

	it("lee la base en cada llamada: un ajuste guardado después se ve sin reiniciar", () => {
		const store = new InMemorySettings();
		const list = makeListSettings({
			store,
			describe: (stored) => [
				{ ...view, stored: stored["FCC_LIVE_POLL_MS"] ?? null },
			],
			problems: () => [],
		});
		assert.equal(list().ok && list().ok ? 1 : 0, 1);
		store.set("FCC_LIVE_POLL_MS", "300");
		const after = list();
		assert.ok(after.ok);
		assert.equal(after.value.settings[0]?.stored, "300");
	});

	it("si la base no se puede leer, error en lugar de una lista vacía", () => {
		const store = new InMemorySettings();
		store.failWith = new Error("base bloqueada");
		const result = makeListSettings({
			store,
			describe: () => [],
			problems: () => [],
		})();
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "unreadable");
	});
});

describe("makeResetAllSettings", () => {
	const resetAll = (store: InMemorySettings) =>
		makeResetAllSettings({ store, editableKeys: EDITABLE });

	it("borra lo guardado de todas las claves editables y dice cuáles", () => {
		const store = new InMemorySettings({
			FCC_LIVE_POLL_MS: "250",
			FCC_HISTORY_MAX_ROWS: "50",
		});
		const result = resetAll(store)();
		assert.ok(result.ok);
		assert.deepEqual([...result.value].sort(), EDITABLE.slice().sort());
		assert.deepEqual(store.all(), {});
	});

	it("deja los restos de claves que no son editables", () => {
		const store = new InMemorySettings({
			FCC_LIVE_POLL_MS: "250",
			FCC_DB: "/x.db",
		});
		const result = resetAll(store)();
		assert.ok(result.ok);
		assert.deepEqual(result.value, ["FCC_LIVE_POLL_MS"]);
		assert.deepEqual(store.all(), { FCC_DB: "/x.db" });
	});

	it("sin nada guardado no hace nada y responde bien", () => {
		const result = resetAll(new InMemorySettings())();
		assert.ok(result.ok);
		assert.deepEqual(result.value, []);
	});

	it("si la base falla, lo cuenta como error de lectura/escritura", () => {
		const store = new InMemorySettings();
		store.failWith = new Error("disco lleno");
		const result = resetAll(store)();
		assert.ok(!result.ok);
		assert.equal(result.error.reason, "unreadable");
		assert.match(result.error.message, /disco lleno/);
	});
});
