import { screenshotUrl } from "#web/lib/activity/endpoints.ts";
import { routeState } from "#web/lib/route.svelte.ts";
import { pageOnlyHash, parseHash } from "#web/lib/route.ts";
import { PROJECTS_LIST_PATH, withProject } from "./endpoints.ts";
import {
	activeIdAfterLoad,
	PROJECT_PARAM,
	PROJECT_STORAGE_KEY,
	type ProjectEntry,
	type ProjectOption,
	parseProjectList,
} from "./selection.ts";

// URL de una captura del proyecto activo (para los <img> de capturas; enhebra ?project)
export const projectScreenshotUrl = (path: string): string =>
	withProject(screenshotUrl(path), projectState.activeId);

// El proyecto activo vive en la query REAL (?project=id, global a toda la app) y en localStorage (el último
// elegido). La ruta de la pantalla va en el hash (#/…), así que el proyecto se mantiene al cambiar de pantalla.
function urlProject(): string | null {
	return new URLSearchParams(location.search).get(PROJECT_PARAM);
}

function storedProject(): string | null {
	try {
		return localStorage.getItem(PROJECT_STORAGE_KEY);
	} catch {
		return null;
	}
}

// `leaveView`: el usuario cambió de proyecto, así que la vista del anterior (sesión, fila abierta, página) no se arrastra
function persist(id: string | null, leaveView = false): void {
	const url = new URL(location.href);
	if (id === null) url.searchParams.delete(PROJECT_PARAM);
	else url.searchParams.set(PROJECT_PARAM, id);
	if (leaveView) url.hash = pageOnlyHash(url.hash);
	history.replaceState(null, "", url.href);
	if (leaveView) routeState.search = parseHash(url.hash).search;
	try {
		if (id !== null) localStorage.setItem(PROJECT_STORAGE_KEY, id);
	} catch {
		// sin almacenamiento
	}
}

// Fuente única del proyecto activo: todas las vistas leen projectState.activeId (resource y el SSE lo enhebran)
export const projectState = $state<{
	projects: ProjectOption[];
	// Las filas enteras y los avisos del registro (los usa «Proyectos»): una sola carga para todo el panel
	entries: readonly ProjectEntry[];
	problems: readonly string[];
	activeId: string | null;
	loaded: boolean;
	// La última carga de la lista falló: no se sabe si hay proyectos
	failed: boolean;
}>({
	projects: [],
	entries: [],
	problems: [],
	activeId: urlProject() ?? storedProject(),
	loaded: false,
	failed: false,
});

// Pide la lista al registro y fija el proyecto activo (URL > localStorage > primero). Si la carga falla no se toca
// la selección ni la URL: un fallo pasajero no puede borrar un ?project válido.
export async function loadProjects(): Promise<void> {
	let list: ReturnType<typeof parseProjectList> = null;
	try {
		const response = await fetch(PROJECTS_LIST_PATH);
		list = parseProjectList(response.ok, await response.json());
	} catch {
		// sin lista: se queda como estaba y la UI muestra el estado correspondiente
	}
	if (list !== null) {
		projectState.entries = list.entries;
		projectState.problems = list.problems;
		projectState.projects = list.entries.map((e) => ({
			id: e.id,
			name: e.name,
		}));
	}
	projectState.loaded = true;
	projectState.failed = list === null;
	if (list === null) return;
	const resolved = activeIdAfterLoad(
		list,
		projectState.activeId,
		urlProject(),
		storedProject(),
	);
	projectState.activeId = resolved;
	persist(resolved);
}

export function selectProject(id: string): void {
	projectState.activeId = id;
	persist(id, true);
}
