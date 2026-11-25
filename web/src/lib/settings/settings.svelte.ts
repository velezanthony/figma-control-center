import type { SettingView } from "#web/lib/contract.ts";
import {
	parseSettingsReply,
	resetAllSettingsInit,
	resetSettingInit,
	SETTINGS_LIST_PATH,
	SETTINGS_RESET_ALL_PATH,
	SETTINGS_RESET_PATH,
	SETTINGS_SAVE_PATH,
	type SettingsReply,
	saveSettingInit,
} from "./endpoints.ts";

// La pantalla de ajustes: el listado (de la máquina, sin proyecto), el error de cada fila y la fila que se está
// guardando. Guardar y restablecer responden el listado al día, así que la pantalla se repinta sin otra petición.
export function createSettings() {
	const state = $state<{
		loaded: boolean;
		settings: readonly SettingView[];
		problems: readonly string[];
		// No se pudo leer el listado (la base no se abre): no se ofrece guardar nada
		loadError: string | null;
		// clave → por qué no se guardó o no se restableció lo último
		errors: Record<string, string>;
		busyKey: string | null;
		// «Restablecer todo» en curso y por qué falló lo último
		resettingAll: boolean;
		resetAllError: string | null;
	}>({
		loaded: false,
		settings: [],
		problems: [],
		loadError: null,
		errors: {},
		busyKey: null,
		resettingAll: false,
		resetAllError: null,
	});

	async function request(
		path: string,
		init?: RequestInit,
	): Promise<SettingsReply> {
		try {
			const response = await fetch(path, init);
			return parseSettingsReply(response.ok, await response.json());
		} catch (e) {
			return { ok: false, type: "NetworkError", message: (e as Error).message };
		}
	}

	const apply = (reply: SettingsReply & { ok: true }): void => {
		state.settings = reply.settings;
		state.problems = reply.problems;
	};

	async function load(): Promise<void> {
		const reply = await request(SETTINGS_LIST_PATH);
		state.loaded = true;
		if (reply.ok) {
			apply(reply);
			state.loadError = null;
		} else {
			state.loadError = reply.message;
		}
	}

	async function write(key: string, init: RequestInit, path: string) {
		state.busyKey = key;
		const reply = await request(path, init);
		state.busyKey = null;
		const { [key]: _, ...others } = state.errors;
		if (reply.ok) {
			apply(reply);
			state.errors = others;
		} else {
			state.errors = { ...others, [key]: reply.message };
		}
	}

	async function resetAll(): Promise<void> {
		state.resettingAll = true;
		const reply = await request(
			SETTINGS_RESET_ALL_PATH,
			resetAllSettingsInit(),
		);
		state.resettingAll = false;
		if (reply.ok) {
			apply(reply);
			state.errors = {};
			state.resetAllError = null;
		} else {
			state.resetAllError = reply.message;
		}
	}

	return {
		state,
		resetAll,
		load,
		save: (key: string, value: string) =>
			write(key, saveSettingInit(key, value), SETTINGS_SAVE_PATH),
		reset: (key: string) =>
			write(key, resetSettingInit(key), SETTINGS_RESET_PATH),
	};
}
