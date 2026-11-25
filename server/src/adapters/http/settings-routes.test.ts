import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	describeSettings,
	EDITABLE_KEYS,
	editableKeyProblem,
	isSettingDefault,
	normalizeSetting,
	setByEnvironment,
	settingProblems,
	validateSetting,
} from "#adapters/config/schema.ts";
import {
	makeListSettings,
	makeResetAllSettings,
	makeResetSetting,
	makeSaveSetting,
} from "#application/settings.ts";
import { InMemorySettings } from "#application/testing/in-memory-settings.ts";
import { err, ok, type Result } from "#domain/result.ts";
import {
	DASHBOARD_MODE,
	type DashboardMode,
	type SettingsError,
	type SettingView,
	settingsError,
} from "#domain/settings.ts";
import type { ApiRequest } from "./request-guard.ts";
import { handleSettingsRequest } from "./settings-routes.ts";

const PANEL_HOST = "127.0.0.1:4173";
const ORIGIN = `http://${PANEL_HOST}`;

const VIEW: SettingView = {
	key: "FCC_LIVE_POLL_MS",
	group: "Panel",
	name: "Sondeo en vivo del panel",
	help: "Cada cuánto mira el panel si hay actividad nueva.",
	unit: "ms",
	usedBy: ["panel"],
	stored: "900",
	effective: 250,
	origin: "env",
	default: 500,
	running: 250,
};

type Listing = Result<
	{ settings: readonly SettingView[]; problems: readonly string[] },
	SettingsError
>;

const noop = () => ok(undefined);

// Solo la lectura, con un listado fijo
function setup(
	listing: Listing = ok({
		settings: [VIEW],
		problems: ["ajuste ignorado: «X» no vale"],
	}),
	mode: DashboardMode = DASHBOARD_MODE.production,
) {
	const deps = {
		mode,
		list: () => listing,
		save: noop,
		reset: noop,
		resetAll: () => ok([]),
		allowedHosts: [PANEL_HOST],
	};
	const call = (over: Partial<ApiRequest> = {}) =>
		handleSettingsRequest(deps, {
			method: "GET",
			pathname: "/api/settings/list",
			params: new URLSearchParams(),
			headers: {},
			body: "",
			...over,
		});
	return { call };
}

// Escrituras con los casos de uso reales, el almacén en memoria y las reglas de la configuración; `env` es el entorno
// del panel
function writable(
	initial: Record<string, string> = {},
	env: Record<string, string> = {},
) {
	const store = new InMemorySettings(initial);
	const deps = {
		mode: DASHBOARD_MODE.production,
		list: makeListSettings({
			store,
			describe: (stored) => describeSettings(env, stored),
			problems: settingProblems,
		}),
		save: makeSaveSetting({
			store,
			validate: validateSetting,
			normalize: normalizeSetting,
			isDefault: isSettingDefault,
			setByEnvironment: (key) => setByEnvironment(env, key),
		}),
		reset: makeResetSetting({ store, checkKey: editableKeyProblem }),
		resetAll: makeResetAllSettings({ store, editableKeys: EDITABLE_KEYS }),
		allowedHosts: [PANEL_HOST],
	};
	const post = (
		pathname: string,
		body: unknown,
		over: Partial<ApiRequest> = {},
	) =>
		handleSettingsRequest(deps, {
			method: "POST",
			pathname,
			params: new URLSearchParams(),
			headers: {
				host: PANEL_HOST,
				origin: ORIGIN,
				"content-type": "application/json",
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
			...over,
		});
	return { store, post };
}

const SAVE = "/api/settings/save";
const RESET = "/api/settings/reset";
const RESET_ALL = "/api/settings/reset-all";
const errorOf = (body: unknown) =>
	(body as { error: { type: string; message: string } }).error;
const resetOf = (body: unknown) => (body as { reset: string[] }).reset;
const settingOf = (body: unknown, key: string) =>
	(body as { settings: SettingView[] }).settings.find((s) => s.key === key);

describe("handleSettingsRequest: listar", () => {
	it("una ruta que no es de ajustes no la maneja", () => {
		assert.equal(setup().call({ pathname: "/api/projects/list" }), null);
	});

	it("GET /list devuelve cada ajuste con su valor guardado, el efectivo y su origen, y los que no valen", () => {
		const r = setup().call();
		assert.ok(r);
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, {
			ok: true,
			settings: [VIEW],
			problems: ["ajuste ignorado: «X» no vale"],
			mode: DASHBOARD_MODE.production,
		});
	});

	it("el listado dice en qué modo corre el panel: con él la web enseña o esconde la galería", () => {
		const r = setup(undefined, DASHBOARD_MODE.development).call();
		assert.ok(r);
		assert.equal(
			(r.body as { mode: unknown }).mode,
			DASHBOARD_MODE.development,
		);
	});

	it("listar es solo de lectura: cualquier otro método es 405 y otra ruta bajo /api/settings/ es 404", () => {
		for (const method of ["POST", "PUT", "DELETE"]) {
			const r = setup().call({ method });
			assert.equal(r?.status, 405, method);
		}
		assert.equal(setup().call({ pathname: "/api/settings/otra" })?.status, 404);
	});

	it("si la base no se puede leer, 500 con el motivo", () => {
		const r = setup(err(settingsError("unreadable", "base bloqueada"))).call();
		assert.equal(r?.status, 500);
		assert.match(JSON.stringify(r?.body), /base bloqueada/);
	});
});

describe("handleSettingsRequest: guardar y restablecer rechazan lo que no viene del panel, sin escribir", () => {
	const INITIAL = { FCC_HISTORY_MAX_ROWS: "50" };
	const bodies = {
		[SAVE]: { key: "FCC_HISTORY_MAX_ROWS", value: "77" },
		[RESET]: { key: "FCC_HISTORY_MAX_ROWS" },
		[RESET_ALL]: {},
	};
	const cases: [string, number, string, Partial<ApiRequest>, unknown?][] = [
		["GET", 405, "MethodNotAllowed", { method: "GET" }],
		[
			"un Host ajeno",
			403,
			"UntrustedHost",
			{
				headers: {
					host: "evil.test",
					origin: ORIGIN,
					"content-type": "application/json",
				},
			},
		],
		[
			"un origen ajeno",
			403,
			"UntrustedOrigin",
			{
				headers: {
					host: PANEL_HOST,
					origin: "http://evil.test",
					"content-type": "application/json",
				},
			},
		],
		[
			"cross-site",
			403,
			"UntrustedOrigin",
			{
				headers: {
					host: PANEL_HOST,
					"sec-fetch-site": "cross-site",
					"content-type": "application/json",
				},
			},
		],
		[
			"otro Content-Type",
			415,
			"UnsupportedMediaType",
			{ headers: { host: PANEL_HOST, "content-type": "text/plain" } },
		],
		[
			"parámetros en la URL",
			400,
			"ArgumentsNotAllowed",
			{ params: new URLSearchParams({ key: "FCC_HISTORY_MAX_ROWS" }) },
		],
		["JSON roto", 400, "BadRequest", {}, "{no es json"],
	];
	for (const path of [SAVE, RESET, RESET_ALL] as const) {
		for (const [what, status, type, over, body] of cases) {
			it(`${path} con ${what} es ${status} ${type}`, () => {
				const { store, post } = writable(INITIAL);
				const r = post(path, body ?? bodies[path], over);
				assert.equal(r?.status, status);
				assert.equal(errorOf(r?.body).type, type);
				assert.deepEqual(store.all(), INITIAL);
			});
		}
		it(`${path} con un campo de más es 400`, () => {
			const { store, post } = writable(INITIAL);
			const r = post(path, { ...bodies[path], extra: 1 });
			assert.equal(r?.status, 400);
			assert.equal(errorOf(r?.body).type, "BadRequest");
			assert.deepEqual(store.all(), INITIAL);
		});
	}
	it("guardar sin valor es 400", () => {
		const { store, post } = writable(INITIAL);
		const r = post(SAVE, { key: "FCC_HISTORY_MAX_ROWS" });
		assert.equal(r?.status, 400);
		assert.deepEqual(store.all(), INITIAL);
	});
});

describe("handleSettingsRequest: guardar", () => {
	it("un valor válido se guarda como lo lee zod y responde 200 con el listado al día", () => {
		const { store, post } = writable();
		const r = post(SAVE, { key: "FCC_HISTORY_MAX_ROWS", value: " 500 " });
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), { FCC_HISTORY_MAX_ROWS: "500" });
		const body = r?.body as { ok: boolean; problems: string[] };
		assert.equal(body.ok, true);
		assert.deepEqual(body.problems, []);
		const row = settingOf(r?.body, "FCC_HISTORY_MAX_ROWS");
		assert.equal(row?.origin, "panel");
		assert.equal(row?.effective, 500);
	});

	for (const [what, key, value, pattern] of [
		["una clave desconocida", "FCC_NO_EXISTE", "1", /desconocid/i],
		["una clave de arranque", "FCC_DB", "/x.db", /arranque/i],
		[
			"un valor inválido",
			"FCC_HISTORY_MAX_ROWS",
			"0",
			/^Tiene que ser un número entero mayor que 0\.$/,
		],
	] as const) {
		it(`${what} es 400 SettingRejected con el motivo y no se guarda`, () => {
			const { store, post } = writable();
			const r = post(SAVE, { key, value });
			assert.equal(r?.status, 400);
			assert.equal(errorOf(r?.body).type, "SettingRejected");
			assert.match(errorOf(r?.body).message, pattern);
			assert.deepEqual(store.all(), {});
		});
	}

	it("guardar el valor por defecto sin nada guardado es 200 y no deja nada guardado (sigue «Por defecto»)", () => {
		const { store, post } = writable();
		const r = post(SAVE, { key: "FCC_HISTORY_MAX_ROWS", value: "200" });
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), {});
		assert.equal(settingOf(r?.body, "FCC_HISTORY_MAX_ROWS")?.origin, "default");
	});

	it("guardar el valor por defecto con algo guardado lo borra, como restablecer", () => {
		const { store, post } = writable({ FCC_HISTORY_MAX_ROWS: "500" });
		const r = post(SAVE, { key: "FCC_HISTORY_MAX_ROWS", value: "200" });
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), {});
		assert.equal(settingOf(r?.body, "FCC_HISTORY_MAX_ROWS")?.stored, null);
	});

	it("una clave que fija el entorno del panel es 409 SetByEnvironment y no se guarda", () => {
		const { store, post } = writable({}, { FCC_LIVE_POLL_MS: "250" });
		const r = post(SAVE, { key: "FCC_LIVE_POLL_MS", value: "900" });
		assert.equal(r?.status, 409);
		assert.equal(errorOf(r?.body).type, "SetByEnvironment");
		assert.deepEqual(store.all(), {});
	});

	it("si la base no se puede abrir, 500 con el motivo", () => {
		const { store, post } = writable();
		store.failWith = new Error("base bloqueada");
		const r = post(SAVE, { key: "FCC_HISTORY_MAX_ROWS", value: "77" });
		assert.equal(r?.status, 500);
		assert.match(errorOf(r?.body).message, /base bloqueada/);
	});
});

describe("handleSettingsRequest: restablecer", () => {
	it("borra solo ese ajuste y responde 200 con el listado al día: vuelve al valor por defecto", () => {
		const { store, post } = writable({
			FCC_HISTORY_MAX_ROWS: "77",
			FCC_LIVE_POLL_MS: "900",
		});
		const r = post(RESET, { key: "FCC_HISTORY_MAX_ROWS" });
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), { FCC_LIVE_POLL_MS: "900" });
		const row = settingOf(r?.body, "FCC_HISTORY_MAX_ROWS");
		assert.equal(row?.origin, "default");
		assert.equal(row?.effective, 200);
		assert.equal(row?.stored, null);
	});

	it("con la clave fijada en el entorno borra lo guardado y el efectivo sigue siendo el del entorno (D-6)", () => {
		const { store, post } = writable(
			{ FCC_LIVE_POLL_MS: "900" },
			{ FCC_LIVE_POLL_MS: "250" },
		);
		const r = post(RESET, { key: "FCC_LIVE_POLL_MS" });
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), {});
		assert.equal(settingOf(r?.body, "FCC_LIVE_POLL_MS")?.effective, 250);
	});

	it("sin nada guardado responde bien", () => {
		const { post } = writable();
		assert.equal(post(RESET, { key: "FCC_HISTORY_MAX_ROWS" })?.status, 200);
	});

	for (const key of ["FCC_DB", "FCC_NO_EXISTE"]) {
		it(`${key} (de arranque o desconocida) es 400 SettingRejected y no se borra (D-9)`, () => {
			const { store, post } = writable({ [key]: "x" });
			const r = post(RESET, { key });
			assert.equal(r?.status, 400);
			assert.equal(errorOf(r?.body).type, "SettingRejected");
			assert.deepEqual(store.all(), { [key]: "x" });
		});
	}

	it("si la base no se puede abrir, 500 con el motivo", () => {
		const { store, post } = writable();
		store.failWith = new Error("base bloqueada");
		const r = post(RESET, { key: "FCC_HISTORY_MAX_ROWS" });
		assert.equal(r?.status, 500);
		assert.match(errorOf(r?.body).message, /base bloqueada/);
	});
});

describe("handleSettingsRequest: restablecer todo", () => {
	it("borra lo guardado de todas las claves editables, responde qué restableció y el listado al día", () => {
		const { store, post } = writable({
			FCC_HISTORY_MAX_ROWS: "77",
			FCC_LIVE_POLL_MS: "900",
		});
		const r = post(RESET_ALL, {});
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), {});
		const body = r?.body as { ok: boolean; reset: string[] };
		assert.equal(body.ok, true);
		assert.deepEqual([...body.reset].sort(), [
			"FCC_HISTORY_MAX_ROWS",
			"FCC_LIVE_POLL_MS",
		]);
		const row = settingOf(r?.body, "FCC_HISTORY_MAX_ROWS");
		assert.equal(row?.origin, "default");
		assert.equal(row?.stored, null);
	});

	it("también borra lo guardado bajo una clave que fija el entorno (D-6)", () => {
		const { store, post } = writable(
			{ FCC_LIVE_POLL_MS: "900" },
			{ FCC_LIVE_POLL_MS: "250" },
		);
		const r = post(RESET_ALL, {});
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), {});
		assert.equal(settingOf(r?.body, "FCC_LIVE_POLL_MS")?.effective, 250);
	});

	it("no toca los restos de claves que ya no son editables (D-9)", () => {
		const { store, post } = writable({
			FCC_HISTORY_MAX_ROWS: "77",
			FCC_DB: "/x.db",
			FCC_NO_EXISTE: "1",
		});
		const r = post(RESET_ALL, {});
		assert.equal(r?.status, 200);
		assert.deepEqual(store.all(), { FCC_DB: "/x.db", FCC_NO_EXISTE: "1" });
		assert.deepEqual(resetOf(r?.body), ["FCC_HISTORY_MAX_ROWS"]);
	});

	it("sin nada guardado responde bien y no restablece nada", () => {
		const { post } = writable();
		const r = post(RESET_ALL, {});
		assert.equal(r?.status, 200);
		assert.deepEqual(resetOf(r?.body), []);
	});

	it("si la base no se puede abrir, 500 con el motivo", () => {
		const { store, post } = writable();
		store.failWith = new Error("base bloqueada");
		const r = post(RESET_ALL, {});
		assert.equal(r?.status, 500);
		assert.match(errorOf(r?.body).message, /base bloqueada/);
	});
});
