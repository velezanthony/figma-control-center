import type {
	CancelError,
	CancelRequestInfo,
	CancelState,
} from "#domain/cancel-request.ts";
import type { Result } from "#domain/result.ts";

// Lado de la sesión: recoge las cancelaciones que el panel pidió para los jobs de ESTA sesión
export interface CancelInbox {
	pending(sessionId: string): readonly CancelRequestInfo[];
	markHandled(sessionId: string, id: number): void;
}

// Lado del panel: ve si se puede cancelar un job y deja la petición
export interface CancelPanel {
	// null: ese job no existe en la base
	stateOf(jobId: string): CancelState | null;
	request(jobId: string): Result<CancelRequestInfo, CancelError>;
}
