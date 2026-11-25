import type { ImportActivityResult } from "./import-activity.ts";
import type { PruneResult } from "./ports/history-maintenance.ts";

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// El mantenimiento es accesorio: un fallo se avisa y el arranque sigue
export function makeMaintainHistory(deps: {
	readonly importActivity: () => Promise<ImportActivityResult>;
	readonly pruneHistory: () => PruneResult;
	readonly warn: (message: string) => void;
}): () => Promise<void> {
	return async () => {
		try {
			await deps.importActivity();
		} catch (e) {
			deps.warn(
				`histórico: no se pudo importar la actividad vieja: ${reasonOf(e)}`,
			);
		}
		try {
			deps.pruneHistory();
		} catch (e) {
			deps.warn(`histórico: no se pudo aplicar la retención: ${reasonOf(e)}`);
		}
	};
}
