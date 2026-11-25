// Contrato del chat del panel con la sesión de Claude Code (channel). Sin imports, como activity.ts, para que
// la web lo comparta con `import type`. Las constantes son del servidor: la web usa los literales del tipo.

export type ChatDirection = "in" | "out";
export type ChatStatus = "pending" | "delivered" | "rejected";

export type ChatMessage = {
	// Posición en la conversación: el cursor del SSE y de la lectura incremental
	readonly id: number;
	readonly sessionId: string;
	// `in`: del panel a la sesión · `out`: la respuesta de Claude
	readonly direction: ChatDirection;
	// La conversación: lo fija el panel al enviar y Claude lo devuelve al responder
	readonly chatId: string;
	readonly body: string;
	// ISO 8601 UTC
	readonly at: string;
	readonly status: ChatStatus;
};

// Una sesión a la que se puede escribir
export type ChatSessionInfo = {
	readonly sessionId: string;
	readonly pid: number | null;
	readonly startedAt: string;
	readonly lastSeenAt: string;
	// El proceso de la sesión sigue vivo
	readonly alive: boolean;
};

// Una página de la conversación (del más antiguo al más reciente) y si quedan mensajes anteriores
export type ChatPage = {
	readonly items: readonly ChatMessage[];
	readonly hasMore: boolean;
};

// Un mensaje que contiene lo buscado y un fragmento de su texto (sin marcas: quien pinta resalta)
export type ChatSearchHit = {
	readonly id: number;
	readonly snippet: string;
};

// Los resultados van en orden de id; `truncated`: había más y se cortó en el tope
export type ChatSearchResult = {
	readonly items: readonly ChatSearchHit[];
	readonly truncated: boolean;
};

export type ChatError = {
	readonly type:
		| "EmptyMessage"
		| "MessageTooLong"
		| "NoSuchSession"
		| "NoSuchChat"
		| "InvalidToken";
	readonly message: string;
};

export const CHAT_LIMITS = Object.freeze({
	maxChars: 4000,
} as const);
