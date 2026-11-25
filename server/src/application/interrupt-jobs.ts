import type { HistoryMaintenance } from "./ports/history-maintenance.ts";

// Figma no deja interrumpir un script en marcha: al irse el servidor, el script pudo seguir o acabar en la pestaña
const UNKNOWN_OUTCOME =
	"El script pudo seguir o terminar en Figma y el servidor no puede saberlo: mira el lienzo con figma_metadata antes de repetirlo.";
const SHUTDOWN_REASON = `El servidor MCP se apagó con el job todavía en marcha. ${UNKNOWN_OUTCOME}`;
const DEAD_SESSION_REASON = `La sesión que lanzó el job terminó sin cerrarlo (el servidor se apagó o cayó). ${UNKNOWN_OUTCOME}`;

// Al apagarse, los jobs en marcha de esta sesión no van a terminar: se cierran `failed` con el motivo
export const makeInterruptOwnJobs =
	(deps: {
		readonly maintenance: HistoryMaintenance;
		readonly sessionId: string;
		readonly now: () => Date;
	}) =>
	(): number =>
		deps.maintenance.interruptSessionJobs(
			deps.sessionId,
			SHUTDOWN_REASON,
			deps.now(),
		);

// Al arrancar, los jobs que dejaron sesiones que ya no existen (un apagado a la fuerza no pudo cerrarlos)
export const makeSweepDeadSessionJobs =
	(deps: {
		readonly maintenance: HistoryMaintenance;
		readonly sessionId: string;
		readonly isAlive: (pid: number | null) => boolean;
		readonly now: () => Date;
	}) =>
	(): number =>
		deps.maintenance.interruptDeadSessionJobs({
			ownSessionId: deps.sessionId,
			isAlive: deps.isAlive,
			reason: DEAD_SESSION_REASON,
			at: deps.now(),
		});
