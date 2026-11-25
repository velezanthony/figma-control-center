import type { ActivityEvent } from "#domain/activity.ts";

// Contrato: registrar nunca lanza ni bloquea una herramienta; si no puede escribir, avisa por stderr y sigue
export interface ActivityLog {
	record(event: ActivityEvent): void;
}
