import type { SettingView } from "#web/lib/contract.ts";

// Rutas de los ajustes (mismas que server/src/adapters/http/routes.ts, SETTINGS_ROUTE)
export const SETTINGS_LIST_PATH = "/api/settings/list";
export const SETTINGS_SAVE_PATH = "/api/settings/save";
export const SETTINGS_RESET_PATH = "/api/settings/reset";
export const SETTINGS_RESET_ALL_PATH = "/api/settings/reset-all";

const postJson = (body: unknown): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

// El valor viaja tal cual se escribió: lo valida (y lo deja limpio) el servidor, con el mismo zod que el .env (D-4)
export const saveSettingInit = (key: string, value: string): RequestInit =>
	postJson({ key, value });

export const resetSettingInit = (key: string): RequestInit => postJson({ key });

// Restablecer todo: sin nada que elegir, el cuerpo es un objeto vacío
export const resetAllSettingsInit = (): RequestInit => postJson({});

export type SettingsReply =
	| {
			readonly ok: true;
			readonly settings: readonly SettingView[];
			readonly problems: readonly string[];
	  }
	| { readonly ok: false; readonly type: string; readonly message: string };

const UNREADABLE_REPLY = "El panel respondió algo que no se entiende.";

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

// Listar, guardar y restablecer (uno o todo) responden lo mismo: el listado al día, o un error con su tipo y su mensaje
export function parseSettingsReply(
	responseOk: boolean,
	body: unknown,
): SettingsReply {
	if (!isObject(body)) {
		return { ok: false, type: "BadReply", message: UNREADABLE_REPLY };
	}
	const error = body["error"];
	if (body["ok"] === false && isObject(error)) {
		return {
			ok: false,
			type: typeof error["type"] === "string" ? error["type"] : "Error",
			message:
				typeof error["message"] === "string"
					? error["message"]
					: UNREADABLE_REPLY,
		};
	}
	const { settings, problems } = body;
	if (
		!responseOk ||
		body["ok"] !== true ||
		!Array.isArray(settings) ||
		!Array.isArray(problems)
	) {
		return { ok: false, type: "BadReply", message: UNREADABLE_REPLY };
	}
	return {
		ok: true,
		settings: settings as SettingView[],
		problems: problems as string[],
	};
}
