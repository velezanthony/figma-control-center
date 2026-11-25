// Lo común a las rutas que ESCRIBEN (chat, lanzar el agente): forma de la petición y de la respuesta, y la
// comprobación de que quien llama es el propio panel

export type ApiRequest = {
	readonly method: string;
	readonly pathname: string;
	readonly params: URLSearchParams;
	// Con las claves en minúsculas, como las da node:http
	readonly headers: Readonly<Record<string, string | undefined>>;
	readonly body: string;
};

export type ApiResponse = { readonly status: number; readonly body: unknown };

export const STATUS = Object.freeze({
	ok: 200,
	created: 201,
	accepted: 202,
	badRequest: 400,
	forbidden: 403,
	notFound: 404,
	methodNotAllowed: 405,
	conflict: 409,
	unsupportedMedia: 415,
	serverError: 500,
} as const);

const JSON_TYPE = "application/json";
const CROSS_SITE = "cross-site";
export const MAX_BODY_BYTES = 16_384;

export const failure = (
	status: number,
	type: string,
	message: string,
): ApiResponse => ({
	status,
	body: { ok: false, error: { type, message } },
});

// El panel no tiene autenticación y escribe en una sesión de Claude Code: cualquier página abierta en el
// navegador podría intentarlo. Se exige un Host local (contra DNS rebinding), ningún origen ajeno, y JSON
// (un formulario de otra web no puede enviarlo sin pasar por CORS)
export function untrusted(
	request: ApiRequest,
	allowedHosts: readonly string[],
): ApiResponse | null {
	const { host, origin } = request.headers;
	if (host === undefined || !allowedHosts.includes(host)) {
		return failure(
			STATUS.forbidden,
			"UntrustedHost",
			"El Host de la petición no es el del panel.",
		);
	}
	if (request.headers["sec-fetch-site"] === CROSS_SITE) {
		return failure(
			STATUS.forbidden,
			"UntrustedOrigin",
			"Petición de otro sitio.",
		);
	}
	if (
		origin !== undefined &&
		!allowedHosts.some((h) => origin === `http://${h}`)
	) {
		return failure(
			STATUS.forbidden,
			"UntrustedOrigin",
			"El origen de la petición no es el del panel.",
		);
	}
	if (
		!(request.headers["content-type"] ?? "").toLowerCase().startsWith(JSON_TYPE)
	) {
		return failure(
			STATUS.unsupportedMedia,
			"UnsupportedMediaType",
			"El cuerpo debe ser application/json.",
		);
	}
	return null;
}
