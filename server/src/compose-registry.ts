// Composición del registro de proyectos sobre la base única. Lo comparten las dos raíces (main.ts y dashboard.ts).
// Si la base no se puede abrir (fichero corrupto, sin permisos), el proceso arranca igual: el registro responde con el
// error y su ruta, y el panel que lo arregla sigue sirviéndose (como con cualquier otro registro ilegible).
import { numericFolders } from "#adapters/fs/numeric-folders.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteRegistry } from "#adapters/sqlite/sqlite-registry.ts";
import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import { registryError } from "#domain/registry.ts";
import { err } from "#domain/result.ts";

export function openRegistry(options: {
	readonly dbPath: string;
	readonly outputRoot: string;
	readonly outputDirFor: (id: string) => string;
}): ProjectRegistry {
	try {
		return new SqliteRegistry({
			db: openFigmaDatabase(options.dbPath),
			placeFor: options.outputDirFor,
			reservedIds: () => numericFolders(options.outputRoot),
		});
	} catch (e) {
		const failure = err(
			registryError(
				"unreadable",
				`no se pudo abrir la base ${options.dbPath}: ${e instanceof Error ? e.message : String(e)}`,
			),
		);
		return {
			read: async () => failure,
			add: async () => failure,
			update: async () => failure,
			remove: async () => failure,
		};
	}
}
