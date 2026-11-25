import type { AgentWatchHub, WatchLink } from "#application/agent-watch-hub.ts";
import type {
	AgentLaunchError,
	AgentLaunched,
	AgentWatching,
	CloseAgentError,
} from "#domain/agent.ts";
import type { Result } from "#domain/result.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { AGENT_ROUTE, AGENT_WATCH } from "./routes.ts";

const STATUS_OF_ERROR: Readonly<Record<AgentLaunchError["type"], number>> = {
	LaunchInProgress: STATUS.conflict,
	TerminalNotFound: STATUS.serverError,
	LaunchFailed: STATUS.serverError,
	InvalidProject: STATUS.badRequest,
	ProjectRequired: STATUS.badRequest,
	ProjectNotAvailable: STATUS.notFound,
	UnsafeProjectPaths: STATUS.conflict,
};
const STATUS_OF_CLOSE_ERROR: Readonly<Record<CloseAgentError["type"], number>> =
	{
		UnknownLaunch: STATUS.notFound,
		AgentNotWatching: STATUS.conflict,
	};
const PROJECT_PARAM = "project";
const LAUNCH_PARAM = AGENT_WATCH.launchParam;

const UNKNOWN_LAUNCH = failure(
	STATUS.notFound,
	"UnknownLaunch",
	"Ese lanzamiento del agente no existe o ya terminó.",
);

// Mismas comprobaciones que lanzar (Host local, ningún origen ajeno, JSON, sin cuerpo) y solo `?launch=<id>`: devuelve
// el id o la respuesta de rechazo
function launchRequest(
	request: ApiRequest,
	method: string,
	allowedHosts: readonly string[],
): string | ApiResponse {
	if (request.method !== method) {
		return failure(
			STATUS.methodNotAllowed,
			"MethodNotAllowed",
			`Solo ${method}.`,
		);
	}
	const blocked = untrusted(request, allowedHosts);
	if (blocked !== null) return blocked;
	const otherParams = [...request.params.keys()].filter(
		(key) => key !== LAUNCH_PARAM,
	);
	const launchId = request.params.get(LAUNCH_PARAM);
	if (request.body !== "" || otherParams.length > 0 || launchId === null) {
		return failure(
			STATUS.badRequest,
			"ArgumentsNotAllowed",
			"Solo se acepta ?launch=<id del lanzamiento>, sin cuerpo.",
		);
	}
	return launchId;
}

type WatchDeps = {
	readonly watch: Pick<AgentWatchHub, "attach">;
	readonly allowedHosts: readonly string[];
};

// GET /api/agent/watch?launch=<id>: la conexión que deja abierta agent-run.ts. Si se acepta,
// devuelve cómo soltarla; quien la sirve no escribe nada por ella hasta que `link.sendClose` lo pida
export function openAgentWatch(
	deps: WatchDeps,
	request: ApiRequest,
	link: WatchLink,
): ApiResponse | { readonly release: () => void } {
	const launchId = launchRequest(request, "GET", deps.allowedHosts);
	if (typeof launchId !== "string") return launchId;
	const release = deps.watch.attach(launchId, link);
	return release === null ? UNKNOWN_LAUNCH : { release };
}

// /api/agent/*. Devuelve null si la ruta no es del agente. Lanzar es una escritura sobre la máquina del usuario:
// mismas comprobaciones que el chat (Host local, ningún origen ajeno, JSON) y, además, ningún argumento salvo
// `?project=<id>` (obligatorio) de un proyecto que existe: el navegador solo pide «lanza el agente de este proyecto»,
// nunca dice qué ejecutar
export async function handleAgentRequest(
	deps: {
		readonly launch: (
			projectId: string,
		) => Promise<Result<AgentLaunched, AgentLaunchError>>;
		// Los proyectos que existen ahora: `?project` solo vale con uno de ellos
		readonly projectIds: () => Promise<readonly string[]>;
		readonly watch: Pick<AgentWatchHub, "close" | "watching">;
		readonly allowedHosts: readonly string[];
	},
	request: ApiRequest,
): Promise<ApiResponse | null> {
	if (!request.pathname.startsWith(AGENT_ROUTE.prefix)) return null;
	if (request.pathname === AGENT_ROUTE.close) {
		// El panel no mata procesos (D-3): manda `close` por la vigilancia y el cierre lo hace agent-run.ts
		const launchId = launchRequest(request, "POST", deps.allowedHosts);
		if (typeof launchId !== "string") return launchId;
		const closed = deps.watch.close(launchId);
		return closed.ok
			? { status: STATUS.accepted, body: { ok: true } }
			: failure(
					STATUS_OF_CLOSE_ERROR[closed.error.type],
					closed.error.type,
					closed.error.message,
				);
	}
	if (request.pathname === AGENT_ROUTE.launches) {
		if (request.method !== "GET") {
			return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo GET.");
		}
		const projectId = request.params.get(PROJECT_PARAM);
		const otherParams = [...request.params.keys()].filter(
			(key) => key !== PROJECT_PARAM,
		);
		if (projectId === null || projectId === "" || otherParams.length > 0) {
			return failure(
				STATUS.badRequest,
				"ProjectRequired",
				"Solo se acepta ?project=<id>.",
			);
		}
		return {
			status: STATUS.ok,
			body: {
				ok: true,
				items: deps.watch
					.watching(projectId)
					.map((launchId): AgentWatching => ({ launchId })),
			},
		};
	}
	if (request.pathname !== AGENT_ROUTE.launch) {
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
	const otherParams = [...request.params.keys()].filter(
		(key) => key !== PROJECT_PARAM,
	);
	if (request.body !== "" || otherParams.length > 0) {
		return failure(
			STATUS.badRequest,
			"ArgumentsNotAllowed",
			"Lanzar el agente no acepta cuerpo ni más parámetro que ?project.",
		);
	}
	const projectId = request.params.get(PROJECT_PARAM);
	if (projectId === null || projectId === "") {
		return failure(
			STATUS.badRequest,
			"ProjectRequired",
			"Elige un proyecto: el agente solo trabaja con el proyecto elegido.",
		);
	}
	if (!(await deps.projectIds()).includes(projectId)) {
		return failure(
			STATUS.notFound,
			"ProjectNotAvailable",
			"El proyecto seleccionado no existe o no está disponible.",
		);
	}
	const launched = await deps.launch(projectId);
	return launched.ok
		? {
				status: STATUS.accepted,
				body: { ok: true, ...launched.value },
			}
		: failure(
				STATUS_OF_ERROR[launched.error.type],
				launched.error.type,
				launched.error.message,
			);
}
