// Rutas y nombres del flujo SSE: la web (web/src/lib/activity/endpoints.ts) usa los mismos
export const ROUTE = Object.freeze({
	index: "/",
	events: "/events",
	screenshots: "/screenshots/",
} as const);

// API de consulta del histórico (GET, JSON). La web usa los mismos nombres: web/src/lib/activity/endpoints.ts
export const HISTORY_ROUTE = Object.freeze({
	prefix: "/api/history/",
	summary: "summary",
	errors: "errors",
	nodes: "nodes",
	sessions: "sessions",
	search: "search",
	calls: "calls",
	callsPrefix: "calls/",
	jobsPrefix: "jobs/",
	stepsSuffix: "/steps",
	// jobs/<id>/steps/<índice>/result: el resultado entero de un paso
	stepResult: /^jobs\/(.+)\/steps\/(\d+)\/result$/,
	captures: "captures",
	status: "status",
	// Intentos
	attemptTargets: "attempt-targets",
	attempts: "attempts",
	// attempts/<id>/script y attempts/<id>/script/raw: el contenido de un papel, recortado o entero
	attemptScript: /^attempts\/(\d+)\/script$/,
	attemptScriptRaw: /^attempts\/(\d+)\/script\/raw$/,
	attemptDiff: "attempt-diff",
	attemptDiffRaw: "attempt-diff/raw",
} as const);

// API del chat con la sesión de Claude Code. La web usa los mismos nombres: web/src/lib/chat/endpoints.ts
export const CHAT_ROUTE = Object.freeze({
	prefix: "/api/chat/",
	sessions: "/api/chat/sessions",
	messages: "/api/chat/messages",
	stream: "/api/chat/stream",
	search: "/api/chat/search",
	permissions: "/api/chat/permissions",
} as const);

// Cancelar un lote desde el panel: GET dice si se puede (y si no, por qué), POST deja la petición.
// La web usa el mismo nombre: web/src/lib/activity/endpoints.ts
export const JOBS_ROUTE = Object.freeze({
	prefix: "/api/jobs/",
	cancel: "/api/jobs/cancel",
} as const);

// Lanzar el agente (POST, sin cuerpo ni argumentos), vigilarlo (agent-run.ts deja abierta `watch`), saber qué agente
// del proyecto se puede cerrar y cerrarlo. La web usa los mismos nombres: web/src/lib/agent/launch.ts
export const AGENT_ROUTE = Object.freeze({
	prefix: "/api/agent/",
	launch: "/api/agent/launch",
	watch: "/api/agent/watch",
	close: "/api/agent/close",
	launches: "/api/agent/launches",
} as const);

// La conexión de vigilancia: el panel no manda nada salvo, una vez, este evento (lo lee adapters/http/panel-watch.ts)
export const AGENT_WATCH = Object.freeze({
	launchParam: "launch",
	closeEvent: "close",
} as const);

// Registro de proyectos: listar (GET), guardar y borrar (POST). Lo escribe solo el panel.
export const PROJECTS_ROUTE = Object.freeze({
	prefix: "/api/projects/",
	list: "/api/projects/list",
	save: "/api/projects/save",
	delete: "/api/projects/delete",
} as const);

// Ajustes del panel: listar (GET), guardar, restablecer uno y restablecer todo (POST).
// La web usa los mismos nombres: web/src/lib/settings/endpoints.ts
export const SETTINGS_ROUTE = Object.freeze({
	prefix: "/api/settings/",
	list: "/api/settings/list",
	save: "/api/settings/save",
	reset: "/api/settings/reset",
	resetAll: "/api/settings/reset-all",
} as const);

export const SSE = Object.freeze({
	readyEvent: "ready",
	retryMs: 1000,
} as const);

export const DEFAULT_KEEP_ALIVE_MS = 15_000;

export const CONTENT_TYPE = Object.freeze({
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
} as const);

export const FALLBACK_CONTENT_TYPE = "application/octet-stream";
