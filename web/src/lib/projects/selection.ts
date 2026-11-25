// Selección del proyecto activo: lógica pura, sin APIs del navegador (se prueba con Vitest, en node).
// La parte reactiva (localStorage, URL, fetch de la lista) vive en projects.svelte.ts.

// Parámetro en el hash (?project=id) y clave de localStorage para recordar el último elegido
export const PROJECT_PARAM = "project";
export const PROJECT_STORAGE_KEY = "figma-control-center:project";

// Lo que el panel necesita de cada proyecto para listarlo y elegirlo (subconjunto del registro)
export type ProjectOption = {
	readonly id: string;
	readonly name: string;
};

// Una fila del registro tal como la devuelve /api/projects/list (el panel de Proyectos las muestra enteras)
export type ProjectEntry = ProjectOption & {
	readonly projectDir?: string;
	readonly fileUrl?: string;
	readonly scriptsRoots?: readonly string[];
	readonly outputDir?: string;
};

export type ProjectList = {
	readonly entries: readonly ProjectEntry[];
	// Lo que el servidor no pudo leer del registro, con su ruta
	readonly problems: readonly string[];
};

// La respuesta de /api/projects/list; null si la carga falló (error HTTP, cuerpo sin filas): una carga fallida NO es
// una lista vacía y no debe cambiar la selección
export function parseProjectList(
	httpOk: boolean,
	body: unknown,
): ProjectList | null {
	if (!httpOk || typeof body !== "object" || body === null) return null;
	const { ok, entries, problems } = body as {
		ok?: boolean;
		entries?: unknown;
		problems?: unknown;
	};
	if (ok === false || !Array.isArray(entries)) return null;
	return {
		entries: entries as ProjectEntry[],
		problems: Array.isArray(problems) ? (problems as string[]) : [],
	};
}

// El proyecto activo tras pedir la lista: con la lista, como siempre; sin ella (la carga falló), el que ya había
export function activeIdAfterLoad(
	list: { readonly entries: readonly ProjectOption[] } | null,
	current: string | null,
	fromUrl: string | null,
	fromStorage: string | null,
): string | null {
	if (list === null) return current;
	return resolveActiveId(list.entries, fromUrl, fromStorage);
}

// Resuelve el proyecto activo entre los disponibles (recomendación de diseño):
// 1) el de la URL si es válido, 2) el último de localStorage si es válido, 3) el primero, 4) ninguno.
export function resolveActiveId(
	available: readonly ProjectOption[],
	fromUrl: string | null,
	fromStorage: string | null,
): string | null {
	const has = (id: string | null): id is string =>
		id !== null && available.some((p) => p.id === id);
	if (has(fromUrl)) return fromUrl;
	if (has(fromStorage)) return fromStorage;
	return available[0]?.id ?? null;
}
