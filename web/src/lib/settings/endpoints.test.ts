import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	parseSettingsReply,
	resetAllSettingsInit,
	resetSettingInit,
	SETTINGS_LIST_PATH,
	SETTINGS_RESET_ALL_PATH,
	SETTINGS_RESET_PATH,
	SETTINGS_SAVE_PATH,
	saveSettingInit,
} from "./endpoints.ts";
import { view } from "./testing/view.ts";

describe("rutas de ajustes (las mismas que SETTINGS_ROUTE en server/src/adapters/http/routes.ts)", () => {
	it("listar, guardar y restablecer", () => {
		assert.equal(SETTINGS_LIST_PATH, "/api/settings/list");
		assert.equal(SETTINGS_SAVE_PATH, "/api/settings/save");
		assert.equal(SETTINGS_RESET_PATH, "/api/settings/reset");
		assert.equal(SETTINGS_RESET_ALL_PATH, "/api/settings/reset-all");
	});

	it("guardar manda la clave y el valor tal cual se escribió, en JSON por POST", () => {
		const init = saveSettingInit("FCC_HISTORY_MAX_ROWS", " 77 ");
		assert.equal(init.method, "POST");
		assert.deepEqual(init.headers, { "Content-Type": "application/json" });
		assert.deepEqual(JSON.parse(String(init.body)), {
			key: "FCC_HISTORY_MAX_ROWS",
			value: " 77 ",
		});
	});

	it("restablecer manda solo la clave", () => {
		const init = resetSettingInit("FCC_HISTORY_MAX_ROWS");
		assert.equal(init.method, "POST");
		assert.deepEqual(JSON.parse(String(init.body)), {
			key: "FCC_HISTORY_MAX_ROWS",
		});
	});
});

describe("restablecer todo", () => {
	it("va por POST con un objeto vacío: no hay nada que elegir", () => {
		const init = resetAllSettingsInit();
		assert.equal(init.method, "POST");
		assert.deepEqual(init.headers, { "Content-Type": "application/json" });
		assert.deepEqual(JSON.parse(String(init.body)), {});
	});
});

describe("parseSettingsReply: lo que responden listar, guardar y restablecer", () => {
	it("bien: el listado al día y los avisos", () => {
		const settings = [view()];
		assert.deepEqual(
			parseSettingsReply(true, { ok: true, settings, problems: ["p"] }),
			{ ok: true, settings, problems: ["p"] },
		);
	});

	it("un error del servidor trae su tipo y su mensaje", () => {
		assert.deepEqual(
			parseSettingsReply(false, {
				ok: false,
				error: { type: "SetByEnvironment", message: "lo fija el entorno" },
			}),
			{ ok: false, type: "SetByEnvironment", message: "lo fija el entorno" },
		);
	});

	it("una respuesta que no se entiende es un error, no un listado vacío", () => {
		for (const body of [null, "x", { ok: true }, { ok: true, settings: 1 }]) {
			const reply = parseSettingsReply(true, body);
			assert.equal(reply.ok, false, JSON.stringify(body));
		}
		assert.equal(
			parseSettingsReply(false, { ok: true, settings: [], problems: [] }).ok,
			false,
		);
	});
});
