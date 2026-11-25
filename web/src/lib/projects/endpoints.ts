import { PROJECT_PARAM } from "./selection.ts";

// Rutas del registro de proyectos (mismas que server/src/adapters/http/routes.ts, PROJECTS_ROUTE)
export const PROJECTS_LIST_PATH = "/api/projects/list";
export const PROJECTS_SAVE_PATH = "/api/projects/save";
export const PROJECTS_DELETE_PATH = "/api/projects/delete";

// Añade ?project=id a cualquier URL de datos, para que el panel pida el proyecto activo (null = sin añadir)
export function withProject(url: string, projectId: string | null): string {
	if (projectId === null) return url;
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}${PROJECT_PARAM}=${encodeURIComponent(projectId)}`;
}

// Lo que el formulario envía al guardar; `confirmScriptsRoots` solo cuando el usuario confirma la raíz (CA-10)
export const saveProjectInit = (
	entry: ProjectEntryInput,
	confirmScriptsRoots: boolean,
): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({
		entry,
		...(confirmScriptsRoots && { confirmScriptsRoots: true }),
	}),
});

export const deleteProjectInit = (id: string): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ id }),
});

// Lo que el formulario manda por proyecto (subconjunto del registro; los opcionales vacíos no se envían).
// El id solo viaja en la edición (upsert por id); en el alta lo da la base.
export type ProjectEntryInput = {
	readonly id?: string;
	readonly name: string;
	readonly projectDir: string;
	readonly fileUrl: string;
	readonly scriptsRoots?: readonly string[];
	readonly outputDir?: string;
};
