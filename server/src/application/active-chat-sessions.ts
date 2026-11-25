import type { ChatSessionInfo } from "#domain/chat.ts";
import type { ChatPanel, ChatTokens } from "./ports/chat.ts";

// Sesiones a las que se puede escribir ahora: token publicado (la sesión sigue escuchando) y proceso vivo
// (un kill -9 deja el token en disco). Las demás siguen en el histórico, pero no en el selector del chat
export function makeActiveChatSessions(deps: {
	readonly panel: ChatPanel;
	readonly tokens: ChatTokens;
}): () => readonly ChatSessionInfo[] {
	return () =>
		deps.panel
			.sessions()
			.filter((s) => s.alive && deps.tokens.read(s.sessionId) !== null);
}
