import { z } from "zod";
import type { SettingsListing } from "#application/settings.ts";
import type { Result } from "#domain/result.ts";
import type { DashboardMode, SettingsError } from "#domain/settings.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { SETTINGS_ROUTE } from "./routes.ts";

// Validación del borde: strictObject, un campo de más es error. El valor lo valida después la configuración (zod)
const saveSchema = z.strictObject({
	key: z.string().min(1),
	value: z.string(),
});
const resetSchema = z.strictObject({ key: z.string().min(1) });
const resetAllSchema = z.strictObject({});

type Write = Result<void, SettingsError>;

// Un fallo de un ajuste como respuesta: no vale (400), lo fija el entorno (409) o la base no se abre (500)
function failureOf(error: SettingsError): ApiResponse {
	if (error.reason === "rejected") {
		return failure(STATUS.badRequest, "SettingRejected", error.message);
	}
	if (error.reason === "environment") {
		return failure(STATUS.conflict, "SetByEnvironment", error.message);
	}
	return failure(STATUS.serverError, error.type, error.message);
}

function listed(
	list: () => Result<SettingsListing, SettingsError>,
	mode: DashboardMode,
	extra: Readonly<Record<string, unknown>> = {},
): ApiResponse {
	const listing = list();
	return listing.ok
		? {
				status: STATUS.ok,
				body: {
					ok: true,
					settings: listing.value.settings,
					problems: listing.value.problems,
					mode,
					...extra,
				},
			}
		: failureOf(listing.error);
}

// /api/settings/*. Listar es lectura; guardar, restablecer y restablecer todo son escrituras con las mismas comprobaciones que Proyectos
// (solo POST, Host local, ningún origen ajeno, JSON, sin parámetros en la URL) y responden el listado al día, para que
// la pantalla se repinte sin otra petición. Devuelve null si la ruta no es de ajustes.
export function handleSettingsRequest(
	deps: {
		// El modo del panel va con el listado: la web lo lee al arrancar para enseñar o esconder la galería
		readonly mode: DashboardMode;
		readonly list: () => Result<SettingsListing, SettingsError>;
		readonly save: (key: string, value: string) => Write;
		readonly reset: (key: string) => Write;
		readonly resetAll: () => Result<readonly string[], SettingsError>;
		readonly allowedHosts: readonly string[];
	},
	request: ApiRequest,
): ApiResponse | null {
	if (!request.pathname.startsWith(SETTINGS_ROUTE.prefix)) return null;

	if (request.pathname === SETTINGS_ROUTE.list) {
		if (request.method !== "GET") {
			return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo GET.");
		}
		return listed(deps.list, deps.mode);
	}

	if (
		request.pathname !== SETTINGS_ROUTE.save &&
		request.pathname !== SETTINGS_ROUTE.reset &&
		request.pathname !== SETTINGS_ROUTE.resetAll
	) {
		return failure(
			STATUS.notFound,
			"NotFound",
			`No existe ${request.pathname}`,
		);
	}
	if (request.method !== "POST") {
		return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo POST.");
	}
	const blocked = untrusted(request, deps.allowedHosts);
	if (blocked !== null) return blocked;
	if ([...request.params.keys()].length > 0) {
		return failure(
			STATUS.badRequest,
			"ArgumentsNotAllowed",
			"Los ajustes van en el cuerpo, sin parámetros en la URL.",
		);
	}

	let json: unknown;
	try {
		json = JSON.parse(request.body);
	} catch {
		return failure(
			STATUS.badRequest,
			"BadRequest",
			"El cuerpo no es JSON válido.",
		);
	}

	if (request.pathname === SETTINGS_ROUTE.resetAll) {
		const parsed = resetAllSchema.safeParse(json);
		if (!parsed.success) {
			return failure(
				STATUS.badRequest,
				"BadRequest",
				z.prettifyError(parsed.error),
			);
		}
		const done = deps.resetAll();
		return done.ok
			? listed(deps.list, deps.mode, { reset: done.value })
			: failureOf(done.error);
	}

	let written: Write;
	if (request.pathname === SETTINGS_ROUTE.save) {
		const parsed = saveSchema.safeParse(json);
		if (!parsed.success) {
			return failure(
				STATUS.badRequest,
				"BadRequest",
				z.prettifyError(parsed.error),
			);
		}
		written = deps.save(parsed.data.key, parsed.data.value);
	} else {
		const parsed = resetSchema.safeParse(json);
		if (!parsed.success) {
			return failure(
				STATUS.badRequest,
				"BadRequest",
				z.prettifyError(parsed.error),
			);
		}
		written = deps.reset(parsed.data.key);
	}
	return written.ok ? listed(deps.list, deps.mode) : failureOf(written.error);
}
