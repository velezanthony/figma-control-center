import type { ActivityEvent } from "#domain/activity.ts";

// Actividad guardada antes del histórico en SQLite: se lee entera, del más antiguo al más reciente
export interface ActivityArchive {
	readAll(): Promise<readonly ActivityEvent[]>;
}
