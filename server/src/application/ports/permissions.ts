import type {
	PermissionBehavior,
	PermissionError,
	PermissionRequest,
} from "#domain/permission.ts";
import type { Result } from "#domain/result.ts";
import type { SessionCredentials } from "./chat.ts";

// Lo que Claude Code pide: la petición tal cual llega del canal
export type PermissionAsk = {
	readonly requestId: string;
	readonly toolName: string;
	readonly description: string;
	readonly inputPreview: string;
};

// Un veredicto que el panel firmó y la sesión aún no ha devuelto a Claude Code
export type PermissionVerdict = {
	readonly id: number;
	readonly requestId: string;
	readonly behavior: PermissionBehavior;
};

// Lado de la sesión: guarda lo que Claude Code pide y recoge lo que el panel decidió
export interface PermissionInbox {
	// Una petición con un requestId ya visto en esta sesión se ignora (null): Claude Code descarta los ids repetidos
	record(
		credentials: SessionCredentials,
		ask: PermissionAsk,
	): PermissionRequest | null;
	// Decisiones firmadas con el token de ESTA sesión aún sin devolver. Las que no traen firma válida se descartan
	// para siempre: nunca se devuelven
	verdicts(credentials: SessionCredentials): readonly PermissionVerdict[];
	markSent(credentials: SessionCredentials, id: number): void;
}

// Lado del panel
export interface PermissionPanel {
	// Las peticiones más recientes de la sesión, la más antigua primero
	list(sessionId: string, limit: number): readonly PermissionRequest[];
	// Decide una vez: se rechaza si el token no es el de la sesión, si ya se decidió o si la sesión terminó
	decide(input: {
		readonly sessionId: string;
		readonly token: string;
		readonly id: number;
		readonly behavior: PermissionBehavior;
	}): Result<PermissionRequest, PermissionError>;
}
