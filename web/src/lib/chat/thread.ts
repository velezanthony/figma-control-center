import type { ChatMessage, ChatSessionInfo } from "#web/lib/contract.ts";

// Une lo ya conocido con lo recién llegado (historial y flujo en vivo se solapan): sin repetidos y por id
export function mergeMessages(
	current: readonly ChatMessage[],
	incoming: readonly ChatMessage[],
): ChatMessage[] {
	const byId = new Map<number, ChatMessage>();
	for (const message of [...current, ...incoming])
		byId.set(message.id, message);
	return [...byId.values()].sort((a, b) => a.id - b.id);
}

export const lastMessageId = (messages: readonly ChatMessage[]): number =>
	messages.reduce((max, m) => Math.max(max, m.id), 0);

// ¿Hay alguna sesión VIVA a la que escribir? Si no, el panel ofrece lanzar el agente en vez del hilo.
// Ojo: `sessions()` del servidor devuelve también las muertas (con chatTokenHash), por eso no basta
// con `length`: una sesión muerta en el histórico no es un agente escuchando.
export const hasLiveSession = (sessions: readonly ChatSessionInfo[]): boolean =>
	sessions.some((s) => s.alive);

// A qué sesión escribir si la URL no dice ninguna: la más reciente que sigue viva
export function defaultSession(
	sessions: readonly ChatSessionInfo[],
): string | null {
	const alive = sessions
		.filter((s) => s.alive)
		.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
	return alive[0]?.sessionId ?? null;
}

// A qué sesión escribir: la de la URL si sigue activa; si no (o sin URL), la más reciente
export function pickSession(
	requested: string | null,
	sessions: readonly ChatSessionInfo[],
): string | null {
	return requested !== null && sessions.some((s) => s.sessionId === requested)
		? requested
		: defaultSession(sessions);
}

// El servidor envía cada mensaje como JSON en un evento SSE; basura o formas raras se descartan sin lanzar
export function parseChatMessage(data: string): ChatMessage | null {
	try {
		const m = JSON.parse(data) as Partial<ChatMessage>;
		return typeof m.id === "number" &&
			typeof m.body === "string" &&
			typeof m.chatId === "string" &&
			(m.direction === "in" || m.direction === "out")
			? (m as ChatMessage)
			: null;
	} catch {
		return null;
	}
}
