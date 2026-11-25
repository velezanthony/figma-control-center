// Da de alta proyectos en la base única de un entorno de prueba, por el mismo registro que usan el panel y el servidor.
import { join } from "node:path";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { SqliteRegistry } from "#adapters/sqlite/sqlite-registry.ts";
import type { EntryDraft, RegistryEntry } from "#domain/registry.ts";

export async function addProjects(
	dbFile: string,
	outputRoot: string,
	drafts: readonly EntryDraft[],
): Promise<RegistryEntry[]> {
	const db = openFigmaDatabase(dbFile);
	try {
		const registry = new SqliteRegistry({
			db,
			placeFor: (id) => join(outputRoot, id),
		});
		const added: RegistryEntry[] = [];
		for (const draft of drafts) {
			const result = await registry.add(draft);
			if (!result.ok) throw new Error(result.error.message);
			added.push(result.value);
		}
		return added;
	} finally {
		db.$client.close();
	}
}
