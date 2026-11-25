import type { ChatMessage, ChatStatus } from "#web/lib/contract.ts";

// Pasado este tiempo sin respuesta se avisa con calma: Claude puede estar usando varias herramientas
export const SLOW_REPLY_MS = 60_000;

// Pasado este tiempo (mucho mayor) es probable que no haya un agente escuchando el canal: se sugiere `make
// agent`. Es una heurística: no distingue «no hay agente» de «tarea muy larga», por eso el aviso es tentativo
export const STALLED_REPLY_MS = 180_000;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PAD = 2;

// Qué se le enseña al usuario tras enviar: en cola (la sesión aún no lo ha recogido), pensando (entregado, sin
// respuesta; con los segundos que lleva) o no entregado (la firma no valió y nunca llegó a Claude)
export type ReplyState =
	| { readonly kind: "idle" }
	| { readonly kind: "queued" }
	| {
			readonly kind: "thinking";
			readonly elapsedSec: number;
			readonly slow: boolean;
			// Tanto tiempo sin respuesta que seguramente no hay agente en el canal (sugerir `make agent`)
			readonly stalled: boolean;
	  }
	| { readonly kind: "undelivered" };

export function replyState(
	messages: readonly ChatMessage[],
	now: number,
	slowAfterMs: number = SLOW_REPLY_MS,
	stalledAfterMs: number = STALLED_REPLY_MS,
): ReplyState {
	const ordered = [...messages].sort((a, b) => a.id - b.id);
	const question = ordered.findLast((m) => m.direction === "in");
	if (question === undefined) return { kind: "idle" };
	if (ordered.some((m) => m.direction === "out" && m.id > question.id)) {
		return { kind: "idle" };
	}
	switch (question.status) {
		case "pending":
			return { kind: "queued" };
		case "rejected":
			return { kind: "undelivered" };
		case "delivered": {
			const elapsedMs = Math.max(0, now - Date.parse(question.at));
			return {
				kind: "thinking",
				elapsedSec: Math.floor(elapsedMs / MS_PER_SECOND),
				slow: elapsedMs >= slowAfterMs,
				stalled: elapsedMs >= stalledAfterMs,
			};
		}
	}
}

const DELIVERY: Readonly<Record<ChatStatus, string>> = {
	pending: "Enviando…",
	delivered: "Entregado a la sesión",
	rejected: "No entregado",
};

export const deliveryLabel = (status: ChatStatus): string => DELIVERY[status];

export function elapsedLabel(seconds: number): string {
	if (seconds < SECONDS_PER_MINUTE) return `${seconds} s`;
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
	const rest = String(seconds % SECONDS_PER_MINUTE).padStart(SECONDS_PAD, "0");
	return `${minutes} min ${rest} s`;
}

// El estado de entrega de un mensaje cambia en la base sin que el SSE (solo mensajes nuevos) lo avise: mientras
// haya mensajes del usuario sin recoger se vuelve a pedir desde justo antes del más antiguo
export function pendingCursor(messages: readonly ChatMessage[]): number | null {
	const pending = messages.filter(
		(m) => m.direction === "in" && m.status === "pending",
	);
	return pending.length === 0
		? null
		: Math.min(...pending.map((m) => m.id)) - 1;
}
