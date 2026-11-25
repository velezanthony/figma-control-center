// Composición de la configuración con los ajustes del panel. La ruta de la base sale del
// arranque (entorno y valores por defecto); con la base abierta se leen los ajustes guardados y se compone la
// configuración final: default < base < entorno. Lo comparten las dos raíces (main.ts y dashboard.ts).
// Si la base no se puede abrir, el proceso arranca con la configuración de siempre y el error sale por stderr.
import type { LayeredConfig } from "#adapters/config/schema.ts";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteSettings } from "#adapters/sqlite/sqlite-settings.ts";
import type { SettingsStore } from "#application/ports/settings.ts";

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Un almacén que no se pudo abrir: cada lectura o escritura cuenta por qué
function unavailable(reason: string): SettingsStore {
	const fail = (): never => {
		throw new Error(reason);
	};
	return { all: fail, set: fail, remove: fail, removeMany: fail };
}

export function composeConfig(options: {
	readonly boot: LayeredConfig;
	readonly layeredWith: (
		stored: Readonly<Record<string, string>>,
	) => LayeredConfig;
	readonly warn: (message: string) => void;
}): {
	layered: LayeredConfig;
	store: SettingsStore;
	// Lo guardado que se leyó al arrancar: con ello se sabe con qué valor corre este proceso
	storedAtBoot: Readonly<Record<string, string>>;
} {
	const { dbPath } = options.boot.machine;
	let store: SettingsStore;
	let stored: Readonly<Record<string, string>> = {};
	try {
		store = new SqliteSettings({ db: openFigmaDatabase(dbPath) });
		stored = store.all();
	} catch (e) {
		const reason = `no se pudieron leer los ajustes de ${dbPath}: ${reasonOf(e)}`;
		options.warn(`figma-control-center: ${reason}`);
		store = unavailable(reason);
	}
	const layered = options.layeredWith(stored);
	for (const problem of layered.settingProblems) {
		options.warn(`figma-control-center: ${problem}`);
	}
	return { layered, store, storedAtBoot: stored };
}
