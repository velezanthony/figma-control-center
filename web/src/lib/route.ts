export const ROUTE_NAME = Object.freeze({
	home: "home",
	activity: "activity",
	jobs: "jobs",
	captures: "captures",
	attempts: "attempts",
	chat: "chat",
	projects: "projects",
	settings: "settings",
	components: "components",
	help: "help",
} as const);
export type RouteName = (typeof ROUTE_NAME)[keyof typeof ROUTE_NAME];

// El nombre de cada pantalla, el que enseñan la barra lateral, el inicio y el título de la pestaña
export const ROUTE_LABEL = Object.freeze({
	[ROUTE_NAME.home]: "Inicio",
	[ROUTE_NAME.activity]: "Actividad",
	[ROUTE_NAME.jobs]: "Jobs",
	[ROUTE_NAME.captures]: "Capturas",
	[ROUTE_NAME.attempts]: "Intentos",
	[ROUTE_NAME.chat]: "Chat",
	[ROUTE_NAME.projects]: "Proyectos",
	[ROUTE_NAME.settings]: "Ajustes",
	[ROUTE_NAME.components]: "Componentes",
	[ROUTE_NAME.help]: "Ayuda",
} as const satisfies Record<RouteName, string>);

const PANEL_NAME = "Figma Control Center";

export const pageTitle = (route: RouteName): string =>
	`${ROUTE_LABEL[route]} · ${PANEL_NAME}`;

const HASH_PREFIX = "#/";
const QUERY_SEPARATOR = "?";

const BY_PATH = new Map<string, RouteName>(
	Object.values(ROUTE_NAME)
		.filter((r) => r !== ROUTE_NAME.home)
		.map((r) => [r, r]),
);

// Las rutas de antes, en castellano: abren su pantalla y se reescriben a la nueva para no romper marcadores
const LEGACY_PATH = new Map<string, RouteName>([
	["actividad", ROUTE_NAME.activity],
	["capturas", ROUTE_NAME.captures],
	["intentos", ROUTE_NAME.attempts],
	["proyectos", ROUTE_NAME.projects],
	["ajustes", ROUTE_NAME.settings],
	["componentes", ROUTE_NAME.components],
]);

export type ParsedHash = { readonly route: RouteName; readonly search: string };

// «#/ruta?estado». La raíz y cualquier ruta desconocida caen en el inicio
function split(hash: string): { path: string; search: string } {
	const body = hash.startsWith(HASH_PREFIX)
		? hash.slice(HASH_PREFIX.length)
		: "";
	const at = body.indexOf(QUERY_SEPARATOR);
	return {
		path: at === -1 ? body : body.slice(0, at),
		search: at === -1 ? "" : body.slice(at + 1),
	};
}

export function parseHash(hash: string): ParsedHash {
	const { path, search } = split(hash);
	return {
		route: BY_PATH.get(path) ?? LEGACY_PATH.get(path) ?? ROUTE_NAME.home,
		search,
	};
}

// El hash nuevo si el que llega usa una ruta antigua; null si no hay que reescribir nada
export function canonicalHash(hash: string): string | null {
	const { path, search } = split(hash);
	const route = LEGACY_PATH.get(path);
	return route === undefined ? null : hrefOf(route, search);
}

export function hrefOf(route: RouteName, search = ""): string {
	const path = route === ROUTE_NAME.home ? "" : route;
	return `${HASH_PREFIX}${path}${search === "" ? "" : `${QUERY_SEPARATOR}${search}`}`;
}

// El mismo hash sin los parámetros de vista (sesión, fila abierta, página…): lo que queda al cambiar de proyecto
export function pageOnlyHash(hash: string): string {
	return hrefOf(parseHash(hash).route);
}
