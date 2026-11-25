import type { CancelState } from "#web/lib/contract.ts";

// Misma ruta que server/src/adapters/http/routes.ts (JOBS_ROUTE)
export const CANCEL_PATH = "/api/jobs/cancel";

export const cancelStateUrl = (jobId: string): string =>
	`${CANCEL_PATH}?job=${encodeURIComponent(jobId)}`;

export const CANCEL_INIT: RequestInit = {
	method: "POST",
	headers: { "Content-Type": "application/json" },
};

export const cancelBody = (jobId: string): string => JSON.stringify({ jobId });

export const CANCEL_STATES = [
	"available",
	"finished",
	"notBatch",
	"sessionGone",
	"requested",
] as const satisfies readonly CancelState[];

const HINT: Record<CancelState, string> = {
	available:
		"Pide a la sesión de Claude que pare el lote: el paso en curso termina antes de parar.",
	finished: "El job ya terminó: no hay nada que cancelar.",
	notBatch:
		"Solo se cancelan lotes (figma_build): Figma no deja interrumpir un script suelto en marcha.",
	sessionGone:
		"La sesión de Claude que lanzó el lote ya no está activa: nadie puede ejecutar la cancelación.",
	requested:
		"Ya se pidió cancelar: el lote parará en cuanto termine el paso en curso.",
};

const CHECKING = "Comprobando si se puede cancelar…";

// Si el botón se puede pulsar y la frase que lo explica (tooltip y descripción accesible); null = aún sin saber
export function cancelHint(state: CancelState | null): {
	readonly enabled: boolean;
	readonly text: string;
} {
	if (state === null) return { enabled: false, text: CHECKING };
	return { enabled: state === "available", text: HINT[state] };
}

// Lo que se enseña mientras la petición de cancelar vuela o el servidor aún no la refleja: el job para el que se pidió
// pasa a «requested» en el acto. Cualquier otro estado del servidor (el lote ya acabó, la sesión murió) manda sobre esto
export function shownCancelState(
	server: CancelState | null,
	requestedJobId: string | null,
	jobId: string | null,
): CancelState | null {
	if (requestedJobId === null || requestedJobId !== jobId) return server;
	return server === null || server === "available" ? "requested" : server;
}
