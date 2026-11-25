import type { ActivityEvent } from "#domain/activity.ts";

export type PruneResult = {
	readonly events: number;
	readonly calls: number;
	readonly sessions: number;
	// Intentos borrados (el último `ok` de cada objetivo se queda) y contenidos que ningún intento usaba
	readonly attempts: number;
	readonly scripts: number;
};

export type ImportOutcome =
	| { readonly status: "imported"; readonly events: number }
	| { readonly status: "already-imported" };

// Mantenimiento del histórico: lo que no es registrar ni consultar
export interface HistoryMaintenance {
	// Borra lo anterior a la fecha (eventos, llamadas y lo que cuelga de ellas)
	prune(olderThan: Date): PruneResult;
	// Cierra como `failed` (con el motivo) los jobs en marcha de esa sesión: se apagó con ellos vivos. Devuelve cuántos
	interruptSessionJobs(sessionId: string, reason: string, at: Date): number;
	// Lo mismo para los jobs de las demás sesiones cuyo proceso ya no existe (`isAlive(pid)`; un pid desconocido cuenta
	// como muerto). Nunca toca los de una sesión viva ni los de la propia
	interruptDeadSessionJobs(options: {
		readonly ownSessionId: string;
		readonly isAlive: (pid: number | null) => boolean;
		readonly reason: string;
		readonly at: Date;
	}): number;
	// Vuelca eventos viejos una sola vez por clave (p. ej. la ruta del archivo): repetirlo no duplica nada
	importOnce(key: string, events: readonly ActivityEvent[]): ImportOutcome;
}
