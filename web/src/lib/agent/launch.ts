import type { ChatSessionInfo } from "#web/lib/contract.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";

// Misma ruta que server/src/adapters/http/routes.ts (AGENT_ROUTE)
export const LAUNCH_PATH = "/api/agent/launch";

// El agente del proyecto que se está viendo (?project); sin proyecto, el de siempre
export const launchPath = (projectId: string | null): string =>
	withProject(LAUNCH_PATH, projectId);

// Sin cuerpo: el navegador solo pide «lanza»; qué se ejecuta lo decide el servidor
export const LAUNCH_INIT: RequestInit = {
	method: "POST",
	headers: { "Content-Type": "application/json" },
};

// El plazo de espera lo manda el servidor en la respuesta: la web no lo duplica
export type LaunchOutcome =
	| {
			readonly ok: true;
			readonly launchId: string;
			readonly startedAtMs: number;
			readonly timeoutMs: number;
	  }
	| { readonly ok: false; readonly message: string };

const GENERIC_ERROR = "No se pudo lanzar el agente.";

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null;

export function parseLaunchResponse(
	status: number,
	body: unknown,
): LaunchOutcome {
	if (isRecord(body)) {
		const { launchId, startedAt, timeoutMs } = body;
		const startedAtMs =
			typeof startedAt === "string" ? Date.parse(startedAt) : Number.NaN;
		if (
			body["ok"] === true &&
			typeof launchId === "string" &&
			!Number.isNaN(startedAtMs) &&
			typeof timeoutMs === "number"
		) {
			return { ok: true, launchId, startedAtMs, timeoutMs };
		}
		const error = body["error"];
		if (isRecord(error) && typeof error["message"] === "string") {
			return { ok: false, message: error["message"] };
		}
	}
	return { ok: false, message: `${GENERIC_ERROR} (HTTP ${status})` };
}

// La sesión que no estaba cuando se lanzó (la más reciente si aparecen varias)
export function appearedSession(
	known: ReadonlySet<string>,
	items: readonly ChatSessionInfo[],
): string | null {
	const fresh = items
		.filter((s) => !known.has(s.sessionId))
		.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	return fresh[0]?.sessionId ?? null;
}

export const waitExpired = (
	startedAtMs: number,
	timeoutMs: number,
	now: number,
): boolean => now - startedAtMs >= timeoutMs;
