import type {
	ChatError,
	ChatMessage,
	ChatPage,
	ChatSearchResult,
	ChatSessionInfo,
} from "#domain/chat.ts";
import type { Result } from "#domain/result.ts";

// Lo que una sesión (un proceso MCP) sabe de sí misma: su id y el token con el que firma el panel
export type SessionCredentials = {
	readonly sessionId: string;
	readonly token: string;
};

// Lado de la sesión, lectura: recoge lo que el panel le escribió
export interface ChatInbox {
	// La sesión da de alta su token; el almacén solo guarda su huella
	register(credentials: SessionCredentials): void;
	// Mensajes del panel aún sin entregar y firmados con el token de ESTA sesión. Los que llegaron sin firma
	// válida se descartan para siempre: nunca se devuelven
	pending(credentials: SessionCredentials): readonly ChatMessage[];
	markDelivered(credentials: SessionCredentials, messageId: number): void;
}

// Lado de la sesión, escritura: la respuesta de Claude
export interface ChatOutbox {
	reply(
		credentials: SessionCredentials,
		chatId: string,
		text: string,
	): Result<ChatMessage, ChatError>;
}

// Lado del panel
export interface ChatPanel {
	// Sesiones con chat (las que registraron un token), la más reciente primero
	sessions(): readonly ChatSessionInfo[];
	// Escribe a una sesión: se rechaza si el token no es el de esa sesión
	send(input: {
		readonly sessionId: string;
		readonly token: string;
		readonly text: string;
	}): Result<ChatMessage, ChatError>;
	// Mensajes de la sesión con id mayor que `afterId`, del más antiguo al más reciente
	messages(
		sessionId: string,
		afterId: number,
		limit: number,
	): readonly ChatMessage[];
	// Paginación por id (keyset): los `limit` mensajes más recientes con id menor que `beforeId` (sin cursor, los
	// últimos de la conversación), en orden, y si quedan anteriores. Así una conversación larga no se carga entera
	page(sessionId: string, beforeId: number | null, limit: number): ChatPage;
	// Búsqueda de texto en TODA la conversación de la sesión (no solo lo cargado en pantalla): ids en orden y fragmento,
	// con tope. Ignora mayúsculas y acentos; busca palabras y prefijos
	search(sessionId: string, text: string, limit: number): ChatSearchResult;
}

// Dónde deja cada sesión su token para que el panel (otro proceso) pueda firmar. No pasa por la web
export interface ChatTokens {
	publish(sessionId: string, token: string): void;
	read(sessionId: string): string | null;
	revoke(sessionId: string): void;
}
