import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import type {
	ChatInbox,
	ChatOutbox,
	ChatPanel,
	SessionCredentials,
} from "#application/ports/chat.ts";
import type {
	ChatError,
	ChatMessage,
	ChatPage,
	ChatSearchResult,
	ChatSessionInfo,
} from "#domain/chat.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { hashToken } from "./chat-token.ts";
import type { FigmaDb } from "./database.ts";
import { toFtsQuery } from "./fts-query.ts";
import { chatMessages, sessions } from "./schema.ts";

type Clock = { readonly now?: () => number };
type Row = typeof chatMessages.$inferSelect;

const WRITE_TX = { behavior: "immediate" } as const;

const toMessage = (row: Row): ChatMessage => ({
	id: row.id,
	sessionId: row.sessionId,
	direction: row.direction,
	chatId: row.chatId,
	body: row.body,
	at: new Date(row.at).toISOString(),
	status: row.status,
});

// ¿Sigue vivo ese proceso? La señal 0 no envía nada: solo comprueba que existe y que podemos señalarlo
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}

// Lado de la sesión (proceso MCP): recoge lo que escribió el panel y guarda la respuesta de Claude
export class SqliteChatMailbox implements ChatInbox, ChatOutbox {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #now: () => number;

	constructor(
		options: { readonly db: FigmaDb; readonly projectId: number } & Clock,
	) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#now = options.now ?? Date.now;
	}

	register({ sessionId, token }: SessionCredentials): void {
		const at = this.#now();
		this.#db
			.insert(sessions)
			.values({
				projectId: this.#projectId,
				id: sessionId,
				startedAt: at,
				lastSeenAt: at,
				chatTokenHash: hashToken(token),
			})
			.onConflictDoUpdate({
				target: [sessions.projectId, sessions.id],
				set: { chatTokenHash: hashToken(token) },
			})
			.run();
	}

	pending({ sessionId, token }: SessionCredentials): readonly ChatMessage[] {
		const proof = hashToken(token);
		return this.#db.transaction((tx) => {
			const waiting = tx
				.select()
				.from(chatMessages)
				.where(
					and(
						eq(chatMessages.projectId, this.#projectId),
						eq(chatMessages.sessionId, sessionId),
						eq(chatMessages.direction, "in"),
						eq(chatMessages.status, "pending"),
					),
				)
				.orderBy(asc(chatMessages.id))
				.all();
			// Lo que no trae la firma de esta sesión no lo escribió el panel: se descarta para siempre
			const forged = waiting.filter((m) => m.senderHash !== proof);
			for (const m of forged) {
				tx.update(chatMessages)
					.set({ status: "rejected" })
					.where(
						and(
							eq(chatMessages.projectId, this.#projectId),
							eq(chatMessages.id, m.id),
						),
					)
					.run();
			}
			return waiting.filter((m) => m.senderHash === proof).map(toMessage);
		}, WRITE_TX);
	}

	markDelivered({ sessionId }: SessionCredentials, messageId: number): void {
		this.#db
			.update(chatMessages)
			.set({ status: "delivered", deliveredAt: this.#now() })
			.where(
				and(
					eq(chatMessages.projectId, this.#projectId),
					eq(chatMessages.id, messageId),
					eq(chatMessages.sessionId, sessionId),
				),
			)
			.run();
	}

	reply(
		{ sessionId }: SessionCredentials,
		chatId: string,
		text: string,
	): Result<ChatMessage, ChatError> {
		return this.#db.transaction((tx): Result<ChatMessage, ChatError> => {
			const known = tx
				.select({ id: chatMessages.id })
				.from(chatMessages)
				.where(
					and(
						eq(chatMessages.projectId, this.#projectId),
						eq(chatMessages.sessionId, sessionId),
						eq(chatMessages.direction, "in"),
						eq(chatMessages.chatId, chatId),
					),
				)
				.get();
			if (known === undefined) {
				return err({
					type: "NoSuchChat",
					message: `No hay ninguna conversación ${chatId} en esta sesión.`,
				});
			}
			const at = this.#now();
			const row = tx
				.insert(chatMessages)
				.values({
					projectId: this.#projectId,
					sessionId,
					direction: "out",
					chatId,
					body: text,
					at,
					deliveredAt: at,
					status: "delivered",
				})
				.returning()
				.get();
			return ok(toMessage(row));
		}, WRITE_TX);
	}
}

// Lado del panel (proceso dashboard)
// Palabras de contexto del fragmento que devuelve la búsqueda
const SNIPPET_WORDS = 12;

export class SqliteChatPanel implements ChatPanel {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #now: () => number;
	readonly #isAlive: (pid: number) => boolean;

	constructor(
		options: {
			readonly db: FigmaDb;
			readonly projectId: number;
			readonly isAlive?: (pid: number) => boolean;
		} & Clock,
	) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#now = options.now ?? Date.now;
		this.#isAlive = options.isAlive ?? processAlive;
	}

	sessions(): readonly ChatSessionInfo[] {
		return this.#db
			.select()
			.from(sessions)
			.where(
				and(
					eq(sessions.projectId, this.#projectId),
					isNotNull(sessions.chatTokenHash),
				),
			)
			.orderBy(desc(sessions.lastSeenAt))
			.all()
			.map((s) => ({
				sessionId: s.id,
				pid: s.pid,
				startedAt: new Date(s.startedAt).toISOString(),
				lastSeenAt: new Date(s.lastSeenAt).toISOString(),
				alive: s.pid !== null && this.#isAlive(s.pid),
			}));
	}

	send(input: {
		sessionId: string;
		token: string;
		text: string;
	}): Result<ChatMessage, ChatError> {
		return this.#db.transaction((tx): Result<ChatMessage, ChatError> => {
			const session = tx
				.select({ hash: sessions.chatTokenHash })
				.from(sessions)
				.where(
					and(
						eq(sessions.projectId, this.#projectId),
						eq(sessions.id, input.sessionId),
					),
				)
				.get();
			if (session?.hash == null) {
				return err({
					type: "NoSuchSession",
					message: `La sesión ${input.sessionId} no tiene chat.`,
				});
			}
			const proof = hashToken(input.token);
			if (proof !== session.hash) {
				return err({
					type: "InvalidToken",
					message: "El token no es el de esa sesión.",
				});
			}
			const row = tx
				.insert(chatMessages)
				.values({
					projectId: this.#projectId,
					sessionId: input.sessionId,
					direction: "in",
					chatId: randomUUID(),
					body: input.text,
					at: this.#now(),
					status: "pending",
					senderHash: proof,
				})
				.returning()
				.get();
			return ok(toMessage(row));
		}, WRITE_TX);
	}

	messages(
		sessionId: string,
		afterId: number,
		limit: number,
	): readonly ChatMessage[] {
		return this.#db
			.select()
			.from(chatMessages)
			.where(
				and(
					eq(chatMessages.projectId, this.#projectId),
					eq(chatMessages.sessionId, sessionId),
					gt(chatMessages.id, afterId),
				),
			)
			.orderBy(asc(chatMessages.id))
			.limit(limit)
			.all()
			.map(toMessage);
	}

	page(sessionId: string, beforeId: number | null, limit: number): ChatPage {
		const rows = this.#db
			.select()
			.from(chatMessages)
			.where(
				and(
					eq(chatMessages.projectId, this.#projectId),
					eq(chatMessages.sessionId, sessionId),
					beforeId === null ? undefined : lt(chatMessages.id, beforeId),
				),
			)
			.orderBy(desc(chatMessages.id))
			.limit(limit + 1)
			.all();
		return {
			items: rows.slice(0, limit).reverse().map(toMessage),
			hasMore: rows.length > limit,
		};
	}

	search(sessionId: string, text: string, limit: number): ChatSearchResult {
		const match = toFtsQuery(text);
		if (match === null) return { items: [], truncated: false };
		const rows = this.#db.all<{ id: number; snippet: string }>(
			sql`SELECT m.id AS id, snippet(chat_messages_fts, 0, '', '', '…', ${SNIPPET_WORDS}) AS snippet
				FROM chat_messages_fts
				JOIN chat_messages m ON m.id = chat_messages_fts.rowid
				WHERE chat_messages_fts MATCH ${match} AND m.project_id = ${this.#projectId} AND m.session_id = ${sessionId}
				ORDER BY m.id
				LIMIT ${limit + 1}`,
		);
		return { items: rows.slice(0, limit), truncated: rows.length > limit };
	}
}
