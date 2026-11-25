import { HISTORY_PATH } from "#web/lib/activity/endpoints.ts";
import type { AttemptKind } from "#web/lib/contract.ts";
import type { AttemptsView } from "./view-state.ts";

// Mismos nombres que HISTORY_ROUTE en server/src/adapters/http/routes.ts
const ROUTE = Object.freeze({
	targets: "attempt-targets",
	attempts: "attempts",
	attemptsPrefix: "attempts/",
	script: "/script",
	raw: "/raw",
	diff: "attempt-diff",
	diffRaw: "attempt-diff/raw",
} as const);

const PARAM = Object.freeze({
	kind: "kind",
	status: "status",
	query: "q",
	preset: "preset",
	since: "since",
	sort: "sort",
	dir: "dir",
	page: "page",
	perPage: "per",
	target: "target",
	role: "role",
	path: "path",
	from: "from",
	to: "to",
} as const);

const url = (name: string, params: URLSearchParams): string => {
	const query = params.toString();
	return `${HISTORY_PATH}${name}${query === "" ? "" : `?${query}`}`;
};

// La lista de objetivos: filtros, orden y página viajan al servidor; nada se filtra ni se ordena en el navegador
export function attemptTargetsUrl(
	view: Pick<AttemptsView, "filters" | "sort" | "page" | "perPage">,
): string {
	const p = new URLSearchParams();
	const { filters, sort } = view;
	if (filters.kind !== null) p.set(PARAM.kind, filters.kind);
	if (filters.status !== null) p.set(PARAM.status, filters.status);
	if (filters.query.trim() !== "") p.set(PARAM.query, filters.query.trim());
	if (filters.since !== null) p.set(PARAM.since, filters.since);
	else if (filters.preset !== null) p.set(PARAM.preset, filters.preset);
	p.set(PARAM.sort, sort.key);
	p.set(PARAM.dir, sort.dir);
	p.set(PARAM.page, String(view.page));
	p.set(PARAM.perPage, String(view.perPage));
	return url(ROUTE.targets, p);
}

// Los intentos de UN objetivo (los últimos, en orden)
export const targetAttemptsUrl = (kind: AttemptKind, target: string): string =>
	url(
		ROUTE.attempts,
		new URLSearchParams({ [PARAM.kind]: kind, [PARAM.target]: target }),
	);

const roleParams = (role: string, path: string | null) => {
	const p = new URLSearchParams({ [PARAM.role]: role });
	if (path !== null && path !== "") p.set(PARAM.path, path);
	return p;
};

const scriptName = (id: number) =>
	`${ROUTE.attemptsPrefix}${id}${ROUTE.script}`;

// El contenido de un papel de un intento, recortado; y el texto entero para abrirlo en otra pestaña
export const attemptScriptUrl = (
	id: number,
	role: string,
	path: string | null,
): string => url(scriptName(id), roleParams(role, path));

export const attemptScriptRawUrl = (
	id: number,
	role: string,
	path: string | null,
): string => url(`${scriptName(id)}${ROUTE.raw}`, roleParams(role, path));

const diffParams = (
	from: number,
	to: number,
	role: string | null,
	path: string | null,
) => {
	const p = new URLSearchParams({
		[PARAM.from]: String(from),
		[PARAM.to]: String(to),
	});
	if (role !== null) p.set(PARAM.role, role);
	if (path !== null && path !== "") p.set(PARAM.path, path);
	return p;
};

export const attemptDiffUrl = (
	from: number,
	to: number,
	role: string | null,
	path: string | null,
): string => url(ROUTE.diff, diffParams(from, to, role, path));

export const attemptDiffRawUrl = (
	from: number,
	to: number,
	role: string | null,
	path: string | null,
): string => url(ROUTE.diffRaw, diffParams(from, to, role, path));
