import type {
	ChatInbox,
	ChatOutbox,
	ChatPanel,
	ChatTokens,
	SessionCredentials,
} from "#application/ports/chat.ts";
import {
	CHAT_LIMITS,
	type ChatError,
	type ChatMessage,
	type ChatPage,
	type ChatSearchResult,
	type ChatSessionInfo,
} from "#domain/chat.ts";
import { err, ok, type Result } from "#domain/result.ts";

type Stored = Omit<ChatMessage, "status"> & {
	status: ChatMessage["status"];
	proof: string | null;
};

// Almacén de chat en memoria con las mismas garantías que el real: la firma del panel es la del token
// de la sesión, y quien no la tenga no entra en `pending`
export class InMemoryChatStore implements ChatInbox, ChatOutbox, ChatPanel {
	readonly all: Stored[] = [];
	// Sesiones cuyo proceso ya no existe
	readonly dead = new Set<string>();
	readonly #tokens = new Map<string, string>();
	#next = 1;

	// Una huella cualquiera: lo único que importa es que dos tokens distintos no coincidan
	static proof(token: string): string {
		return `huella:${token}`;
	}

	register({ sessionId, token }: SessionCredentials): void {
		this.#tokens.set(sessionId, InMemoryChatStore.proof(token));
	}

	pending({ sessionId, token }: SessionCredentials): readonly ChatMessage[] {
		const proof = InMemoryChatStore.proof(token);
		const mine = this.all.filter(
			(m) =>
				m.sessionId === sessionId &&
				m.direction === "in" &&
				m.status === "pending",
		);
		for (const m of mine) if (m.proof !== proof) m.status = "rejected";
		return mine
			.filter((m) => m.status === "pending")
			.map(({ proof: _p, ...m }) => m);
	}

	markDelivered(_c: SessionCredentials, messageId: number): void {
		const m = this.all.find((x) => x.id === messageId);
		if (m !== undefined) m.status = "delivered";
	}

	reply(
		{ sessionId }: SessionCredentials,
		chatId: string,
		text: string,
	): Result<ChatMessage, ChatError> {
		const known = this.all.some(
			(m) =>
				m.sessionId === sessionId &&
				m.direction === "in" &&
				m.chatId === chatId,
		);
		if (!known)
			return err({
				type: "NoSuchChat",
				message: `No hay ninguna conversación ${chatId}.`,
			});
		return ok(this.#add(sessionId, "out", chatId, text, null, "delivered"));
	}

	sessions(): readonly ChatSessionInfo[] {
		return [...this.#tokens.keys()].map((sessionId) => ({
			sessionId,
			pid: 1,
			startedAt: "2026-01-01T00:00:00.000Z",
			lastSeenAt: "2026-01-01T00:00:00.000Z",
			alive: !this.dead.has(sessionId),
		}));
	}

	send(input: {
		sessionId: string;
		token: string;
		text: string;
	}): Result<ChatMessage, ChatError> {
		const registered = this.#tokens.get(input.sessionId);
		if (registered === undefined)
			return err({
				type: "NoSuchSession",
				message: "Esa sesión no tiene chat.",
			});
		const proof = InMemoryChatStore.proof(input.token);
		if (proof !== registered)
			return err({ type: "InvalidToken", message: "Token inválido." });
		return ok(
			this.#add(
				input.sessionId,
				"in",
				`chat-${this.#next}`,
				input.text,
				proof,
				"pending",
			),
		);
	}

	messages(
		sessionId: string,
		afterId: number,
		limit: number,
	): readonly ChatMessage[] {
		return this.all
			.filter((m) => m.sessionId === sessionId && m.id > afterId)
			.slice(0, limit)
			.map(({ proof: _p, ...m }) => m);
	}

	page(sessionId: string, beforeId: number | null, limit: number): ChatPage {
		const older = this.all.filter(
			(m) =>
				m.sessionId === sessionId && (beforeId === null || m.id < beforeId),
		);
		return {
			items: older.slice(-limit).map(({ proof: _p, ...m }) => m),
			hasMore: older.length > limit,
		};
	}

	search(sessionId: string, text: string, limit: number): ChatSearchResult {
		const fold = (s: string) =>
			s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
		const words = fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
		if (words.length === 0) return { items: [], truncated: false };
		const hits = this.all
			.filter(
				(m) =>
					m.sessionId === sessionId &&
					words.every((w) => fold(m.body).includes(w)),
			)
			.map((m) => ({ id: m.id, snippet: m.body.slice(0, 80) }));
		return { items: hits.slice(0, limit), truncated: hits.length > limit };
	}

	// Un mensaje que alguien metió en la base sin pasar por el panel (sin firma o con otra)
	inject(sessionId: string, text: string, proof: string | null): ChatMessage {
		return this.#add(
			sessionId,
			"in",
			`chat-${this.#next}`,
			text,
			proof,
			"pending",
		);
	}

	#add(
		sessionId: string,
		direction: "in" | "out",
		chatId: string,
		body: string,
		proof: string | null,
		status: ChatMessage["status"],
	): ChatMessage {
		const message: Stored = {
			id: this.#next++,
			sessionId,
			direction,
			chatId,
			body,
			at: "2026-01-01T00:00:00.000Z",
			status,
			proof,
		};
		this.all.push(message);
		const { proof: _p, ...visible } = message;
		return visible;
	}
}

export class InMemoryChatTokens implements ChatTokens {
	readonly tokens = new Map<string, string>();
	publish(sessionId: string, token: string): void {
		this.tokens.set(sessionId, token);
	}
	read(sessionId: string): string | null {
		return this.tokens.get(sessionId) ?? null;
	}
	revoke(sessionId: string): void {
		this.tokens.delete(sessionId);
	}
}

export const MAX_CHARS = CHAT_LIMITS.maxChars;
