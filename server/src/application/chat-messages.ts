import { CHAT_LIMITS, type ChatError, type ChatMessage } from "#domain/chat.ts";
import { err, type Result } from "#domain/result.ts";
import type {
	ChatOutbox,
	ChatPanel,
	ChatTokens,
	SessionCredentials,
} from "./ports/chat.ts";

// Un mensaje se recorta y debe tener texto y un tamaño razonable
function cleaned(text: string): Result<string, ChatError> {
	const trimmed = text.trim();
	if (trimmed === "") {
		return err({ type: "EmptyMessage", message: "El mensaje está vacío." });
	}
	if (trimmed.length > CHAT_LIMITS.maxChars) {
		return err({
			type: "MessageTooLong",
			message: `El mensaje supera los ${CHAT_LIMITS.maxChars} caracteres.`,
		});
	}
	return { ok: true, value: trimmed };
}

// Claude responde a una conversación del panel
export function makeReplyChat(deps: {
	readonly outbox: ChatOutbox;
	readonly credentials: SessionCredentials;
}): (chatId: string, text: string) => Result<ChatMessage, ChatError> {
	return (chatId, text) => {
		const body = cleaned(text);
		return body.ok
			? deps.outbox.reply(deps.credentials, chatId, body.value)
			: body;
	};
}

// El panel escribe a una sesión, firmando con el token que esa sesión publicó (el navegador nunca lo ve)
export function makeSendChat(deps: {
	readonly panel: ChatPanel;
	readonly tokens: ChatTokens;
}): (input: {
	sessionId: string;
	text: string;
}) => Result<ChatMessage, ChatError> {
	return ({ sessionId, text }) => {
		const body = cleaned(text);
		if (!body.ok) return body;
		const token = deps.tokens.read(sessionId);
		if (token === null) {
			return err({
				type: "NoSuchSession",
				message: `La sesión ${sessionId} no tiene chat activo (no ha publicado su token).`,
			});
		}
		return deps.panel.send({ sessionId, token, text: body.value });
	};
}
