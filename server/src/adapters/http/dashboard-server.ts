import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { join } from "node:path";
import type { ActivityFeed } from "#application/activity-feed.ts";
import type { AgentWatchHub } from "#application/agent-watch-hub.ts";
import type { makeSendChat } from "#application/chat-messages.ts";
import type { History } from "#application/history.ts";
import type { makeDecidePermission } from "#application/permissions.ts";
import type { CancelPanel } from "#application/ports/cancel-requests.ts";
import type { ChatPanel } from "#application/ports/chat.ts";
import type { PermissionPanel } from "#application/ports/permissions.ts";
import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import type { SettingsListing } from "#application/settings.ts";
import type { AgentLaunchError, AgentLaunched } from "#domain/agent.ts";
import type { ChatSessionInfo } from "#domain/chat.ts";
import type { Result } from "#domain/result.ts";
import type { DashboardMode, SettingsError } from "#domain/settings.ts";
import { handleAgentRequest, openAgentWatch } from "./agent-routes.ts";
import { handleCancelRequest } from "./cancel-routes.ts";
import { handleChatRequest } from "./chat-routes.ts";
import { contentTypeOf, readBytes, resolveInside } from "./files.ts";
import { handleHistoryRequest } from "./history-routes.ts";
import { handlePermissionRequest } from "./permission-routes.ts";
import { handleProjectsRequest } from "./projects-routes.ts";
import { type ApiRequest, MAX_BODY_BYTES } from "./request-guard.ts";
import {
	AGENT_ROUTE,
	AGENT_WATCH,
	CHAT_ROUTE,
	DEFAULT_KEEP_ALIVE_MS,
	HISTORY_ROUTE,
	JOBS_ROUTE,
	PROJECTS_ROUTE,
	ROUTE,
	SETTINGS_ROUTE,
	SSE,
} from "./routes.ts";
import { handleSettingsRequest } from "./settings-routes.ts";

const INDEX_FILE = "index.html";
// El nombre suelto (las más antiguas), screenshots/<AAAA-MM-DD>/<nombre> (las nuevas) o capturas/<AAAA-MM-DD>/<nombre>
// (la carpeta de antes, que el histórico sigue citando); ninguna otra subcarpeta
const SCREENSHOT_NAME =
	/^(?:(?:screenshots|capturas)\/\d{4}-\d{2}-\d{2}\/)?[A-Za-z0-9][A-Za-z0-9._-]*\.png$/;
const PNG_TYPE = "image/png";
const JSON_TYPE = "application/json; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";

const HTTP = Object.freeze({
	ok: 200,
	forbidden: 403,
	notFound: 404,
	methodNotAllowed: 405,
	payloadTooLarge: 413,
	notBuilt: 503,
} as const);

const SECURITY_HEADERS = Object.freeze({
	"Cache-Control": "no-store",
	"X-Content-Type-Options": "nosniff",
} as const);

// Los datos que el panel muestra de UN proyecto (tenant). El panel resuelve cuál según ?project=id.
export type PanelTenant = {
	readonly feed: ActivityFeed;
	readonly history: History;
	readonly chat: {
		readonly panel: ChatPanel;
		readonly sendChat: ReturnType<typeof makeSendChat>;
		// Sesiones a las que se puede escribir ahora (token publicado y proceso vivo)
		readonly activeSessions: () => readonly ChatSessionInfo[];
		// Cada cuántos ms se mira si hay mensajes nuevos para quien sigue una conversación
		readonly pollMs: number;
	};
	readonly permissions: {
		readonly panel: PermissionPanel;
		readonly decide: ReturnType<typeof makeDecidePermission>;
	};
	// Cancelar un lote desde el panel: el panel deja la petición y la sesión dueña del job la ejecuta
	readonly cancel: { readonly panel: CancelPanel };
	readonly screenshotsDir: string;
};

export type DashboardServerDeps = {
	// Multi-tenant: resuelve el proyecto seleccionado (?project=id); undefined si no existe/sin alcance
	readonly forProject: (
		projectId: string | null,
	) => Promise<PanelTenant | undefined>;
	readonly agent: {
		readonly launch: (
			projectId: string,
		) => Promise<Result<AgentLaunched, AgentLaunchError>>;
		readonly projectIds: () => Promise<readonly string[]>;
		// Las conexiones de vigilancia de los agentes lanzados desde el panel
		readonly watch: AgentWatchHub;
	};
	// Registro de proyectos: lo lee y lo escribe solo el panel
	readonly projects: {
		readonly registry: ProjectRegistry;
	};
	// Ajustes del panel: los de la máquina, no los de un proyecto. Listar, guardar, restablecer uno y restablecer todo
	readonly settings: {
		// Producción o desarrollo (FCC_DASHBOARD_MODE): sale con el listado
		readonly mode: DashboardMode;
		readonly list: () => Result<SettingsListing, SettingsError>;
		readonly save: (key: string, value: string) => Result<void, SettingsError>;
		readonly reset: (key: string) => Result<void, SettingsError>;
		readonly resetAll: () => Result<readonly string[], SettingsError>;
	};
	// Hosts con los que se acepta que el navegador llegue al panel; por defecto, los locales con el puerto real
	readonly allowedHosts?: readonly string[];
	readonly webDir: string;
	readonly keepAliveMs?: number;
};

const pathnameOf = (req: IncomingMessage): string => {
	const url = req.url ?? ROUTE.index;
	const query = url.indexOf("?");
	return query === -1 ? url : url.slice(0, query);
};

const queryOf = (req: IncomingMessage): URLSearchParams => {
	const url = req.url ?? "";
	const at = url.indexOf("?");
	return new URLSearchParams(at === -1 ? "" : url.slice(at + 1));
};

function send(
	res: ServerResponse,
	status: number,
	type: string,
	body: Buffer | string,
	method: string | undefined,
): void {
	res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type });
	res.end(method === "HEAD" ? undefined : body);
}

const notFound = (res: ServerResponse) =>
	send(res, HTTP.notFound, "text/plain; charset=utf-8", "No encontrado", "GET");

async function sendFile(
	res: ServerResponse,
	file: string,
	method: string | undefined,
	type = contentTypeOf(file),
): Promise<void> {
	send(res, HTTP.ok, type, await readBytes(file), method);
}

const LAST_EVENT_ID = "last-event-id";
// Mensajes de chat que se envían de una vez en cada vuelta
const CHAT_BATCH = 100;

// El navegador reenvía en esta cabecera el último `id:` que vio; lo que no sea un entero se ignora
function lastEventId(req: IncomingMessage): number | null {
	const raw = req.headers[LAST_EVENT_ID];
	const n = typeof raw === "string" ? Number(raw) : Number.NaN;
	return Number.isInteger(n) && n >= 0 ? n : null;
}

const frame = (id: number, data: unknown, event?: string): string =>
	`${event === undefined ? "" : `event: ${event}\n`}id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

// Lo que se sigue cuando no hay proyecto: nada que reenviar ni que esperar
const EMPTY_FEED: ActivityFeed = {
	start() {},
	stop() {},
	subscribe: () => ({ latestId: 0, replay: [], unsubscribe() {} }),
};

function streamEvents(
	req: IncomingMessage,
	res: ServerResponse,
	feed: ActivityFeed,
	keepAliveMs: number | undefined,
): void {
	res.writeHead(HTTP.ok, {
		...SECURITY_HEADERS,
		"Content-Type": "text/event-stream; charset=utf-8",
		Connection: "keep-alive",
	});
	res.write(`retry: ${SSE.retryMs}\n\n`);
	const subscription = feed.subscribe((events) => {
		for (const { id, event } of events) res.write(frame(id, event));
	}, lastEventId(req));
	// Quien reconecta recibe primero lo que se perdió; después «ready» (con el id más reciente) le dice a
	// la web que pida el estado a la API: así no queda hueco entre su última carga y esta conexión
	for (const { id, event } of subscription.replay) res.write(frame(id, event));
	res.write(
		frame(
			subscription.latestId,
			{ latestId: subscription.latestId },
			SSE.readyEvent,
		),
	);
	// Un comentario cada cierto tiempo mantiene viva la conexión a través de proxies
	const keepAlive = setInterval(
		() => res.write(": keep-alive\n\n"),
		keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS,
	);
	req.on("close", () => {
		clearInterval(keepAlive);
		subscription.unsubscribe();
	});
}

// Lee el cuerpo de una petición con un tope: un cuerpo mayor se corta sin leerlo entero (null)
async function readBody(req: IncomingMessage): Promise<string | null> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) return null;
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

const LOOPBACK_NAMES = ["127.0.0.1", "localhost", "[::1]"] as const;

function trustedHosts(
	deps: DashboardServerDeps,
	server: Server,
): readonly string[] {
	if (deps.allowedHosts !== undefined) return deps.allowedHosts;
	const address = server.address();
	return typeof address === "object" && address !== null
		? LOOPBACK_NAMES.map((name) => `${name}:${address.port}`)
		: [];
}

// Mensajes nuevos de una conversación, uno por evento, con su id: el navegador reanuda con Last-Event-ID
function streamChat(
	req: IncomingMessage,
	res: ServerResponse,
	chat: PanelTenant["chat"],
	keepAliveMs: number | undefined,
): void {
	const params = queryOf(req);
	const session = params.get("session");
	if (session === null) {
		send(
			res,
			HTTP.notFound,
			"text/plain; charset=utf-8",
			"Falta session",
			"GET",
		);
		return;
	}
	res.writeHead(HTTP.ok, {
		...SECURITY_HEADERS,
		"Content-Type": "text/event-stream; charset=utf-8",
		Connection: "keep-alive",
	});
	res.write(`retry: ${SSE.retryMs}\n\n`);
	let cursor = lastEventId(req) ?? Number(params.get("after") ?? 0);
	if (!Number.isInteger(cursor) || cursor < 0) cursor = 0;
	const flush = () => {
		for (const message of chat.panel.messages(session, cursor, CHAT_BATCH)) {
			cursor = message.id;
			res.write(frame(message.id, message));
		}
	};
	flush();
	const timer = setInterval(() => {
		try {
			flush();
		} catch {
			// la base puede estar ocupada un instante: se reintenta en la vuelta siguiente
		}
	}, chat.pollMs);
	const keepAlive = setInterval(
		() => res.write(": keep-alive\n\n"),
		keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS,
	);
	req.on("close", () => {
		clearInterval(timer);
		clearInterval(keepAlive);
	});
}

function apiRequestOf(req: IncomingMessage, body: string): ApiRequest {
	const headers = Object.fromEntries(
		Object.entries(req.headers).map(([k, v]) => [
			k,
			Array.isArray(v) ? v[0] : v,
		]),
	);
	return {
		method: req.method ?? "GET",
		pathname: pathnameOf(req),
		params: queryOf(req),
		headers,
		body,
	};
}

// La vigilancia de un agente: la conexión queda abierta sin escribir nada (ni latidos) y, si
// el panel pide cerrar, lleva un único evento `close` y se termina. Si el panel muere, el sistema cierra el socket
function streamAgentWatch(
	req: IncomingMessage,
	res: ServerResponse,
	request: ApiRequest,
	deps: DashboardServerDeps,
	allowedHosts: readonly string[],
): void {
	const opened = openAgentWatch(
		{ watch: deps.agent.watch, allowedHosts },
		request,
		{
			sendClose: () => {
				res.end(`event: ${AGENT_WATCH.closeEvent}\ndata: {}\n\n`);
			},
		},
	);
	if (!("release" in opened)) {
		send(
			res,
			opened.status,
			JSON_TYPE,
			JSON.stringify(opened.body),
			req.method,
		);
		return;
	}
	res.writeHead(HTTP.ok, {
		...SECURITY_HEADERS,
		"Content-Type": "text/event-stream; charset=utf-8",
		Connection: "keep-alive",
	});
	res.flushHeaders();
	res.on("close", opened.release);
}

async function route(
	req: IncomingMessage,
	res: ServerResponse,
	deps: DashboardServerDeps,
	server: Server,
): Promise<void> {
	// Proyecto seleccionado (?project=id); sin él, el por defecto. undefined = id inexistente o sin alcance.
	// Se resuelve solo en las rutas que lo necesitan (y una vez por petición): los estáticos y /api/projects/* no
	// dependen de que un proyecto monte bien
	let resolved: Promise<PanelTenant | undefined> | undefined;
	const tenantOf = (): Promise<PanelTenant | undefined> => {
		resolved ??= deps
			.forProject(queryOf(req).get("project"))
			.catch(() => undefined);
		return resolved;
	};
	const noTenant = (): void =>
		send(
			res,
			HTTP.notFound,
			JSON_TYPE,
			JSON.stringify({
				ok: false,
				error: {
					type: "ProjectNotAvailable",
					message: "El proyecto seleccionado no existe o no está disponible.",
				},
			}),
			req.method,
		);

	// Ninguna ruta, de lectura o de escritura, atiende un Host que no es el del panel (DNS rebinding)
	const host = req.headers.host;
	if (host === undefined || !trustedHosts(deps, server).includes(host)) {
		return send(
			res,
			HTTP.forbidden,
			JSON_TYPE,
			JSON.stringify({
				ok: false,
				error: {
					type: "UntrustedHost",
					message: "El Host de la petición no es el del panel.",
				},
			}),
			req.method,
		);
	}

	const earlyPath = pathnameOf(req);
	if (earlyPath === CHAT_ROUTE.stream && req.method === "GET") {
		const tenant = await tenantOf();
		if (!tenant) return noTenant();
		return streamChat(req, res, tenant.chat, deps.keepAliveMs);
	}
	if (
		earlyPath.startsWith(CHAT_ROUTE.prefix) ||
		earlyPath.startsWith(JOBS_ROUTE.prefix) ||
		earlyPath.startsWith(AGENT_ROUTE.prefix) ||
		earlyPath.startsWith(PROJECTS_ROUTE.prefix) ||
		earlyPath.startsWith(SETTINGS_ROUTE.prefix)
	) {
		// La vigilancia es un GET, pero tampoco acepta cuerpo: se lee para poder rechazarlo
		const body =
			req.method === "POST" || earlyPath === AGENT_ROUTE.watch
				? await readBody(req)
				: "";
		if (body === null) {
			return send(
				res,
				HTTP.payloadTooLarge,
				JSON_TYPE,
				JSON.stringify({
					ok: false,
					error: {
						type: "PayloadTooLarge",
						message: "El cuerpo es demasiado grande.",
					},
				}),
				req.method,
			);
		}
		const request = apiRequestOf(req, body);
		const allowedHosts = trustedHosts(deps, server);
		if (earlyPath === AGENT_ROUTE.watch) {
			return streamAgentWatch(req, res, request, deps, allowedHosts);
		}
		// Agente y registro son de máquina; chat y permisos, del proyecto seleccionado
		let api =
			(await handleAgentRequest({ ...deps.agent, allowedHosts }, request)) ??
			(await handleProjectsRequest(
				{ ...deps.projects, allowedHosts },
				request,
			)) ??
			handleSettingsRequest({ ...deps.settings, allowedHosts }, request);
		if (api === null && earlyPath.startsWith(CHAT_ROUTE.prefix)) {
			const tenant = await tenantOf();
			if (!tenant) return noTenant();
			api =
				handlePermissionRequest(
					{ ...tenant.permissions, allowedHosts },
					request,
				) ?? handleChatRequest({ ...tenant.chat, allowedHosts }, request);
		}
		if (api === null && earlyPath.startsWith(JOBS_ROUTE.prefix)) {
			const tenant = await tenantOf();
			if (!tenant) return noTenant();
			api = handleCancelRequest({ ...tenant.cancel, allowedHosts }, request);
		}
		if (api !== null) {
			return send(
				res,
				api.status,
				JSON_TYPE,
				JSON.stringify(api.body),
				req.method,
			);
		}
	}
	if (req.method !== "GET" && req.method !== "HEAD") {
		return send(
			res,
			HTTP.methodNotAllowed,
			"text/plain; charset=utf-8",
			"Método no permitido",
			"GET",
		);
	}
	const pathname = pathnameOf(req);
	if (pathname === ROUTE.events) {
		const tenant = await tenantOf();
		if (!tenant) {
			// Sin proyecto elegido y sin ninguno que servir, el panel sigue conectado: el flujo se abre vacío (un id
			// que se pidió y no existe sí es un error)
			if (queryOf(req).get("project") !== null) return noTenant();
			return streamEvents(req, res, EMPTY_FEED, deps.keepAliveMs);
		}
		return streamEvents(req, res, tenant.feed, deps.keepAliveMs);
	}

	if (pathname.startsWith(HISTORY_ROUTE.prefix)) {
		const tenant = await tenantOf();
		if (!tenant) return noTenant();
		const api = handleHistoryRequest(tenant.history, pathname, queryOf(req));
		if (api !== null) {
			return api.text !== undefined
				? send(
						res,
						api.status,
						api.contentType ?? TEXT_TYPE,
						api.text,
						req.method,
					)
				: send(
						res,
						api.status,
						JSON_TYPE,
						JSON.stringify(api.body),
						req.method,
					);
		}
	}

	if (pathname.startsWith(ROUTE.screenshots)) {
		const tenant = await tenantOf();
		if (!tenant) return noTenant();
		const name = pathname.slice(ROUTE.screenshots.length);
		if (!SCREENSHOT_NAME.test(name)) return notFound(res);
		const file = await resolveInside(tenant.screenshotsDir, name);
		if (file === null) return notFound(res);
		return sendFile(res, file, req.method, PNG_TYPE);
	}

	const relative = pathname === ROUTE.index ? INDEX_FILE : pathname;
	const file = await resolveInside(deps.webDir, relative);
	if (file !== null) return sendFile(res, file, req.method);
	if (pathname === ROUTE.index) {
		return send(
			res,
			HTTP.notBuilt,
			"text/plain; charset=utf-8",
			`El panel no está compilado (falta ${join(deps.webDir, INDEX_FILE)}). Ejecuta «make build-web».`,
			req.method,
		);
	}
	return notFound(res);
}

export function createDashboardServer(deps: DashboardServerDeps): Server {
	const server: Server = createServer((req, res) => {
		route(req, res, deps, server).catch(() => {
			if (!res.headersSent) {
				send(
					res,
					HTTP.notFound,
					"text/plain; charset=utf-8",
					"No encontrado",
					"GET",
				);
			} else {
				res.end();
			}
		});
	});
	return server;
}
