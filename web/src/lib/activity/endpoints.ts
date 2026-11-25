import type { View } from "./view-state.ts";

// Mismas rutas y nombres que server/src/adapters/http/routes.ts
export const EVENTS_PATH = "/events";
export const READY_EVENT = "ready";
export const SCREENSHOTS_PATH = "/screenshots/";

export const HISTORY_PATH = "/api/history/";
const HISTORY = Object.freeze({
	summary: "summary",
	sessions: "sessions",
	calls: "calls",
	captures: "captures",
	status: "status",
	jobsPrefix: "jobs/",
	stepsSuffix: "/steps",
} as const);

const PARAM = Object.freeze({
	query: "q",
	tool: "tool",
	status: "status",
	session: "session",
	sort: "sort",
	dir: "dir",
	page: "page",
	perPage: "per",
	limit: "limit",
	jobs: "jobs",
	locate: "locate",
} as const);
const JOBS_ONLY = "1";

const PATH_SEPARATOR = "/";

// Las capturas se sirven por su ruta dentro de la carpeta de salida, no por la absoluta: las nuevas cuelgan de
// screenshots/<fecha>/ y las de antes, de capturas/<fecha>/ (el histórico las sigue citando); las más antiguas (y
// cualquier otra) se sirven por el nombre suelto
const DATED_CAPTURE =
	/(?:^|[\\/])(screenshots|capturas)[\\/](\d{4}-\d{2}-\d{2})[\\/]([^\\/]+)$/;

export const screenshotUrl = (path: string): string => {
	const dated = DATED_CAPTURE.exec(path);
	const parts = dated
		? dated.slice(1)
		: [path.slice(path.lastIndexOf(PATH_SEPARATOR) + 1)];
	return `${SCREENSHOTS_PATH}${parts.map(encodeURIComponent).join(PATH_SEPARATOR)}`;
};

const url = (name: string, params: URLSearchParams): string => {
	const query = params.toString();
	return `${HISTORY_PATH}${name}${query === "" ? "" : `?${query}`}`;
};

export type CallsRequest = {
	// Solo las llamadas que lanzaron un job (pantalla de Jobs)
	readonly jobsOnly?: boolean;
	// Id de una llamada: el servidor devuelve la página que la contiene con estos filtros y orden
	readonly locate?: string | null;
};

// La tabla: filtros, orden y página viajan al servidor; nada se filtra ni se ordena en el navegador
export function callsUrl(
	view: Pick<View, "filters" | "sort" | "page" | "perPage">,
	request: CallsRequest = {},
): string {
	const p = new URLSearchParams();
	const { filters, sort } = view;
	if (filters.query.trim() !== "") p.set(PARAM.query, filters.query.trim());
	if (filters.tool !== null) p.set(PARAM.tool, filters.tool);
	if (filters.status !== "all") p.set(PARAM.status, filters.status);
	if (filters.sessionId !== null) p.set(PARAM.session, filters.sessionId);
	p.set(PARAM.sort, sort.key);
	p.set(PARAM.dir, sort.dir);
	p.set(PARAM.page, String(view.page));
	p.set(PARAM.perPage, String(view.perPage));
	if (request.jobsOnly === true) p.set(PARAM.jobs, JOBS_ONLY);
	if (request.locate) p.set(PARAM.locate, request.locate);
	return url(HISTORY.calls, p);
}

export const summaryUrl = (): string =>
	url(HISTORY.summary, new URLSearchParams());

export const statusUrl = (): string =>
	url(HISTORY.status, new URLSearchParams());

export function sessionsUrl(limit: number): string {
	return url(
		HISTORY.sessions,
		new URLSearchParams({ [PARAM.limit]: String(limit) }),
	);
}

// Pasos de un lote (figma_build): mismos nombres que server/src/adapters/http/routes.ts
export const jobStepsUrl = (jobId: string): string =>
	`${HISTORY_PATH}${HISTORY.jobsPrefix}${encodeURIComponent(jobId)}${HISTORY.stepsSuffix}`;

// El resultado entero de un paso: mismo nombre que en server/src/adapters/http/routes.ts
export const jobStepResultUrl = (jobId: string, index: number): string =>
	`${jobStepsUrl(jobId)}/${index}/result`;

export function capturesUrl(page: number, perPage: number): string {
	return url(
		HISTORY.captures,
		new URLSearchParams({
			[PARAM.page]: String(page),
			[PARAM.perPage]: String(perPage),
		}),
	);
}
