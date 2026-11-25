import type { PermissionRequest, PermissionStatus } from "#web/lib/contract.ts";

export type StatusTone = "warning" | "success" | "danger" | "secondary";

export const STATUS_LABEL: Readonly<Record<PermissionStatus, string>> = {
	pending: "Esperando tu respuesta",
	allowed: "Aprobada",
	denied: "Denegada",
	expired: "Sin respuesta desde el panel",
};

export const STATUS_TONE: Readonly<Record<PermissionStatus, StatusTone>> = {
	pending: "warning",
	allowed: "success",
	denied: "danger",
	expired: "secondary",
};

// El contrato no avisa de quién contestó: una petición que no se contestó aquí y ya no se puede contestar
// puede haberse resuelto en la terminal, o la sesión terminó
export const EXPIRED_HINT =
	"Ya no se puede contestar desde aquí: puede que se respondiera en la terminal o que la sesión terminara.";

// Lo que anuncia un lector de pantalla cuando hay algo que contestar
export function announcement(requests: readonly PermissionRequest[]): string {
	const pending = requests.filter((r) => r.status === "pending");
	const last = pending.at(-1);
	if (last === undefined) return "";
	return pending.length === 1
		? `Claude pide permiso para usar ${last.toolName}`
		: `Claude pide permiso para ${pending.length} acciones`;
}

// La respuesta de la API a un POST fallido: el mensaje del servidor, o uno genérico
export function decisionError(body: unknown, fallback: string): string {
	if (typeof body === "object" && body !== null && "error" in body) {
		const { error } = body as { error?: { message?: unknown } };
		if (typeof error?.message === "string") return error.message;
	}
	return fallback;
}

// Los parámetros de la petición en una sola línea (JSON sin sangría), que se ajusta al ancho de la tarjeta. Lo que no
// es JSON de objeto o lista (una vista previa recortada, texto suelto) se deja tal cual
export function compactInput(input: string): string {
	try {
		const value: unknown = JSON.parse(input);
		return typeof value === "object" && value !== null
			? JSON.stringify(value)
			: input;
	} catch {
		return input;
	}
}

// El aviso sobre el campo de escribir cuando alguna petición pendiente no se ve
export const noticeLabel = (count: number): string =>
	count === 1 ? "1 permiso esperando" : `${count} permisos esperando`;
