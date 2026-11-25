// Mismas rutas que server/src/adapters/http/routes.ts (CHAT_ROUTE)
export const CHAT_SESSIONS_PATH = "/api/chat/sessions";
export const CHAT_MESSAGES_PATH = "/api/chat/messages";
export const CHAT_STREAM_PATH = "/api/chat/stream";
export const CHAT_SEARCH_PATH = "/api/chat/search";
export const CHAT_PERMISSIONS_PATH = "/api/chat/permissions";

const query = (params: Record<string, string>): string =>
	new URLSearchParams(params).toString();

// Lo que ya hay en la conversación, desde el último mensaje que se conoce
export const chatMessagesUrl = (
	sessionId: string,
	afterId: number,
	limit?: number,
): string =>
	`${CHAT_MESSAGES_PATH}?${query({
		session: sessionId,
		after: String(afterId),
		...(limit !== undefined && { limit: String(limit) }),
	})}`;

// Búsqueda de texto en toda la conversación (no solo en lo cargado)
export const chatSearchUrl = (sessionId: string, text: string): string =>
	`${CHAT_SEARCH_PATH}?${query({ session: sessionId, q: text })}`;

// Una página de la conversación (keyset por id): la última, o la anterior al mensaje `before`
export const chatPageUrl = (
	sessionId: string,
	before: number | null,
	limit: number,
): string =>
	`${CHAT_MESSAGES_PATH}?${query({
		session: sessionId,
		limit: String(limit),
		...(before !== null && { before: String(before) }),
	})}`;

// El flujo en vivo: el navegador reanuda solo con Last-Event-ID; `after` es para la primera conexión
export const chatStreamUrl = (sessionId: string, afterId: number): string =>
	`${CHAT_STREAM_PATH}?${query({ session: sessionId, after: String(afterId) })}`;

export const SEND_CHAT_INIT = (
	sessionId: string,
	text: string,
): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ sessionId, text }),
});

// Las peticiones de permiso recientes de la sesión
export const chatPermissionsUrl = (sessionId: string): string =>
	`${CHAT_PERMISSIONS_PATH}?${query({ session: sessionId })}`;

export const DECIDE_PERMISSION_INIT = (
	sessionId: string,
	id: number,
	behavior: "allow" | "deny",
): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ sessionId, id, behavior }),
});
