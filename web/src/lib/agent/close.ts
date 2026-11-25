import { HISTORY_PATH } from "#web/lib/activity/endpoints.ts";

// Mismas rutas que server/src/adapters/http/routes.ts (AGENT_ROUTE)
export const CLOSE_PATH = "/api/agent/close";
export const LAUNCHES_PATH = "/api/agent/launches";

export const NO_AGENT_REASON = "No hay ningún agente abierto desde el panel";
export const CLOSE_CONFIRM =
	"Hay un lote en curso: si cierras el agente, el lote queda interrumpido. ¿Cerrar igualmente?";
const GENERIC_ERROR = "No se pudo cerrar el agente.";
// La herramienta de los lotes (mismo nombre que TOOL_NAME.build del servidor)
const BUILD_TOOL = "figma_build";

// Sin cuerpo: el navegador solo dice qué lanzamiento cerrar; el panel no mata nada, se lo pide al agente
export const CLOSE_INIT: RequestInit = {
	method: "POST",
	headers: { "Content-Type": "application/json" },
};

export const closePath = (launchId: string): string =>
	`${CLOSE_PATH}?launch=${encodeURIComponent(launchId)}`;

// ¿Hay un lote en curso? Se pregunta al histórico (un lote en curso es un figma_build con su job en marcha)
export const runningBatchPath = (): string =>
	`${HISTORY_PATH}calls?${new URLSearchParams({ tool: BUILD_TOOL, status: "running", jobs: "1", per: "1" })}`;

export type CloseButtonState = {
	readonly disabled: boolean;
	// Por qué está desactivado (tooltip), o null
	readonly reason: string | null;
	// La pregunta antes de cerrar, o null si se cierra sin preguntar
	readonly confirm: string | null;
};

// El botón cierra el agente del proyecto activo (D-5): desactivado sin agente, con confirmación si hay un lote en curso
export function closeButtonState(input: {
	readonly launchId: string | null;
	readonly batchRunning: boolean;
}): CloseButtonState {
	if (input.launchId === null)
		return { disabled: true, reason: NO_AGENT_REASON, confirm: null };
	return {
		disabled: false,
		reason: null,
		confirm: input.batchRunning ? CLOSE_CONFIRM : null,
	};
}

// Tras pedir el cierre, ¿ya se ve en el panel? El agente se ha ido (no queda lanzamiento) y su sesión ha dejado de
// estar activa; hasta entonces se siguen pidiendo las sesiones, o el selector la seguiría mostrando como activa
export function closeSettled(input: {
	readonly launchId: string | null;
	// Las sesiones activas cuando se pidió el cierre (entre ellas, la del agente)
	readonly aliveAtClose: ReadonlySet<string>;
	readonly sessions: readonly {
		readonly sessionId: string;
		readonly alive: boolean;
	}[];
}): boolean {
	if (input.launchId !== null) return false;
	if (input.aliveAtClose.size === 0) return true;
	const aliveNow = new Set(
		input.sessions.filter((s) => s.alive).map((s) => s.sessionId),
	);
	return [...input.aliveAtClose].some((id) => !aliveNow.has(id));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

// El lanzamiento que el botón puede cerrar (el primero vivo y vigilando del proyecto), o null
export function parseLaunchesResponse(body: unknown): string | null {
	if (!isRecord(body) || body["ok"] !== true) return null;
	const items = body["items"];
	if (!Array.isArray(items)) return null;
	const first: unknown = items[0];
	return isRecord(first) && typeof first["launchId"] === "string"
		? first["launchId"]
		: null;
}

export type CloseOutcome =
	| { readonly ok: true }
	| { readonly ok: false; readonly message: string };

export function parseCloseResponse(
	status: number,
	body: unknown,
): CloseOutcome {
	if (isRecord(body)) {
		if (body["ok"] === true) return { ok: true };
		const error = body["error"];
		if (isRecord(error) && typeof error["message"] === "string")
			return { ok: false, message: error["message"] };
	}
	return { ok: false, message: `${GENERIC_ERROR} (HTTP ${status})` };
}
