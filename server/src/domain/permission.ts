// Contrato del relevo de permisos con el panel. Sin imports, como chat.ts, para que la web lo comparta con
// `import type`. Lo que trae es dato de la herramienta que Claude quiere usar: se muestra como texto, nunca se interpreta.

export type PermissionBehavior = "allow" | "deny";

// `expired`: no se puede contestar desde el panel (la sesión terminó); en la base solo existen los otros tres
export type PermissionStatus = "pending" | "allowed" | "denied" | "expired";

export type PermissionRequest = {
	readonly id: number;
	readonly sessionId: string;
	// El id de cinco letras que Claude Code emitió: es lo que lleva el veredicto de vuelta
	readonly requestId: string;
	readonly toolName: string;
	readonly description: string;
	readonly inputPreview: string;
	// ISO 8601 UTC
	readonly at: string;
	readonly status: PermissionStatus;
	readonly decidedAt: string | null;
};

export type PermissionError = {
	readonly type:
		| "NoSuchSession"
		| "NoSuchRequest"
		| "InvalidToken"
		| "AlreadyDecided"
		| "Expired";
	readonly message: string;
};

export const PERMISSION_LIMITS = Object.freeze({
	// Claude Code ya recorta cada campo a 3.500 puntos de código; esto solo acota lo que se guarda si un cliente no lo hace
	maxFieldChars: 20_000,
	// Cuántas peticiones recientes de una sesión ve el panel
	listLimit: 20,
} as const);
