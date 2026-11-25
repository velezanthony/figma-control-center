import type { ChatMessage, PermissionRequest } from "#web/lib/contract.ts";

// La conversación tal como se pinta: los mensajes y las peticiones de permiso de la sesión, intercalados por su hora.
// Puro, sin DOM: la lista virtualizada solo recibe el resultado. Las claves de las peticiones son negativas para que no
// choquen con los ids de los mensajes (que usan el buscador y el salto a un mensaje)
export type TimelineItem =
	| {
			readonly kind: "message";
			readonly key: number;
			readonly message: ChatMessage;
	  }
	| {
			readonly kind: "permission";
			readonly key: number;
			readonly request: PermissionRequest;
	  };

export const permissionKey = (id: number): number => -id;

const time = (iso: string): number => Date.parse(iso);

export function buildTimeline(
	messages: readonly ChatMessage[],
	requests: readonly PermissionRequest[],
	// Hay mensajes anteriores sin cargar: una petición ya contestada más antigua que lo cargado espera a que se cargue
	// su tramo (si no, se quedaría arriba sola y luego le caerían mensajes encima). Una pendiente sale siempre
	hasMore: boolean,
): TimelineItem[] {
	const first = messages[0];
	const since = hasMore && first !== undefined ? time(first.at) : null;
	const shown = requests
		.filter(
			(r) => r.status === "pending" || since === null || time(r.at) >= since,
		)
		.toSorted((a, b) => time(a.at) - time(b.at) || a.id - b.id);
	const items: TimelineItem[] = [];
	let p = 0;
	for (const message of messages) {
		const at = time(message.at);
		for (let r = shown[p]; r !== undefined && time(r.at) < at; r = shown[++p])
			items.push({ kind: "permission", key: permissionKey(r.id), request: r });
		items.push({ kind: "message", key: message.id, message });
	}
	for (const r of shown.slice(p))
		items.push({ kind: "permission", key: permissionKey(r.id), request: r });
	return items;
}

export type WaitingNotice = { readonly count: number; readonly target: number };

// El aviso «N permisos esperando · Ver»: sale si alguna petición pendiente no se ve. Cuenta todas las pendientes y
// lleva a la primera que no se ve. Sin saber aún qué se ve (`null`: la lista no se ha colocado), no sale
export function waitingNotice(
	timeline: readonly TimelineItem[],
	inView: ReadonlySet<number> | null,
): WaitingNotice | null {
	if (inView === null) return null;
	const pending = timeline.filter(
		(i) => i.kind === "permission" && i.request.status === "pending",
	);
	const hidden = pending.find((i) => !inView.has(i.key));
	return hidden === undefined
		? null
		: { count: pending.length, target: hidden.key };
}
