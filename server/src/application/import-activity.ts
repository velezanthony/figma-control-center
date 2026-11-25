import type { ActivityArchive } from "./ports/activity-archive.ts";
import type {
	HistoryMaintenance,
	ImportOutcome,
} from "./ports/history-maintenance.ts";

export type ImportActivityResult =
	| ImportOutcome
	| { readonly status: "nothing-to-import" };

export function makeImportActivity(deps: {
	readonly archive: ActivityArchive;
	readonly maintenance: HistoryMaintenance;
	// Identifica la importación: con la misma clave no se repite
	readonly key: string;
}): () => Promise<ImportActivityResult> {
	return async () => {
		const events = await deps.archive.readAll();
		// Sin eventos no se marca: si el archivo aparece después, aún se podrá importar
		if (events.length === 0) return { status: "nothing-to-import" };
		return deps.maintenance.importOnce(deps.key, events);
	};
}
