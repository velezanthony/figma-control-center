import {
	type FigmaDb,
	type OpenOptions,
	openFigmaDatabase,
} from "../database.ts";
import { projects } from "../schema.ts";

// El proyecto de los tests de un solo proyecto
export const PROJECT_ID = 1;

// Da de alta una fila de `projects` (con la clave de archivo y la carpeta que su id hace únicas) si aún no existe
export function ensureProject(db: FigmaDb, id: number): void {
	db.insert(projects)
		.values({
			id,
			name: `proyecto-${id}`,
			projectDir: "/p",
			fileUrl: `https://www.figma.com/design/P${id}/P${id}`,
			fileKey: `P${id}`,
			outputDir: `/salida/${id}`,
		})
		.onConflictDoNothing()
		.run();
}

// Abre la base única de prueba con el proyecto `PROJECT_ID` (y los pedidos) ya dado(s) de alta, que es lo que exige la FK
export function openTestDb(
	file: string,
	options: OpenOptions & { readonly projects?: readonly number[] } = {},
): FigmaDb {
	const db = openFigmaDatabase(file);
	for (const id of new Set([PROJECT_ID, ...(options.projects ?? [])])) {
		ensureProject(db, id);
	}
	if (options.queryOnly === true) db.$client.pragma("query_only = ON");
	return db;
}
