import { z } from "zod";
import type { makeSendChat } from "#application/chat-messages.ts";
import type { ChatPanel } from "#application/ports/chat.ts";
import type { ChatError, ChatSessionInfo } from "#domain/chat.ts";
import {
	nonNegativeIntParam,
	paramsOf,
	parseBody,
	positiveIntParam,
} from "./input.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { CHAT_ROUTE } from "./routes.ts";

export type ChatRequest = ApiRequest;
export type ChatResponse = ApiResponse;

const DEFAULT_LIMIT = 100;
// Páginas de la conversación (keyset por id): tamaño por defecto y tope, para que ninguna petición cargue el historial entero
const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;
// Búsqueda en toda la conversación: tope de resultados y de largo de la consulta
const SEARCH_MAX_HITS = 500;
const SEARCH_MAX_QUERY_CHARS = 200;

const STATUS_OF_ERROR: Readonly<Record<ChatError["type"], number>> = {
	EmptyMessage: STATUS.badRequest,
	MessageTooLong: STATUS.badRequest,
	NoSuchSession: STATUS.notFound,
	NoSuchChat: STATUS.notFound,
	InvalidToken: STATUS.forbidden,
};

const sendBody = z.object({ sessionId: z.string(), text: z.string() });

// `after`: lo que llegó desde un id (un `after` inválido cuenta como desde el principio)
const tailQuery = z.object({
	after: nonNegativeIntParam.catch(0),
	limit: positiveIntParam.default(DEFAULT_LIMIT),
});
// Sin `after`: las últimas páginas, o las anteriores a `before`
const pageQuery = z.object({
	before: positiveIntParam.optional(),
	limit: positiveIntParam.default(PAGE_DEFAULT),
});

// /api/chat/*. Devuelve null si la ruta no es del chat. El flujo en vivo (SSE) lo atiende el servidor aparte
export function handleChatRequest(
	deps: {
		readonly panel: ChatPanel;
		readonly sendChat: ReturnType<typeof makeSendChat>;
		// Sesiones a las que se puede escribir ahora (token publicado y proceso vivo)
		readonly activeSessions: () => readonly ChatSessionInfo[];
		readonly allowedHosts: readonly string[];
	},
	request: ChatRequest,
): ChatResponse | null {
	const { pathname, method } = request;
	if (pathname === CHAT_ROUTE.sessions) {
		if (method !== "GET")
			return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo GET.");
		return {
			status: STATUS.ok,
			body: { ok: true, items: deps.activeSessions() },
		};
	}
	if (pathname === CHAT_ROUTE.search) {
		if (method !== "GET")
			return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo GET.");
		const session = request.params.get("session");
		if (session === null) {
			return failure(
				STATUS.badRequest,
				"MissingSession",
				"Falta el parámetro session.",
			);
		}
		const text = request.params.get("q") ?? "";
		if (text.length > SEARCH_MAX_QUERY_CHARS) {
			return failure(
				STATUS.badRequest,
				"QueryTooLong",
				`La búsqueda supera los ${SEARCH_MAX_QUERY_CHARS} caracteres.`,
			);
		}
		return {
			status: STATUS.ok,
			body: { ok: true, ...deps.panel.search(session, text, SEARCH_MAX_HITS) },
		};
	}
	if (pathname === CHAT_ROUTE.messages) {
		if (method === "GET") {
			const session = request.params.get("session");
			if (session === null)
				return failure(
					STATUS.badRequest,
					"MissingSession",
					"Falta el parámetro session.",
				);
			// `after`: lo que llegó desde un id (SSE y sondeo de entrega). Sin él, páginas de la conversación:
			// las últimas, o las anteriores a `before`
			if (request.params.has("after")) {
				const tail = tailQuery.safeParse(paramsOf(request.params));
				if (!tail.success) {
					return failure(
						STATUS.badRequest,
						"InvalidCursor",
						"limit debe ser un entero positivo.",
					);
				}
				const items = deps.panel.messages(
					session,
					tail.data.after,
					Math.min(tail.data.limit, PAGE_MAX),
				);
				return { status: STATUS.ok, body: { ok: true, items } };
			}
			const cursor = pageQuery.safeParse(paramsOf(request.params));
			if (!cursor.success) {
				return failure(
					STATUS.badRequest,
					"InvalidCursor",
					"before y limit deben ser enteros positivos.",
				);
			}
			const { before, limit } = cursor.data;
			const page = deps.panel.page(
				session,
				before ?? null,
				Math.min(limit, PAGE_MAX),
			);
			return { status: STATUS.ok, body: { ok: true, ...page } };
		}
		if (method === "POST") {
			const blocked = untrusted(request, deps.allowedHosts);
			if (blocked !== null) return blocked;
			const input = parseBody(sendBody, request.body);
			if (input === null) {
				return failure(
					STATUS.badRequest,
					"InvalidBody",
					"Se esperaba { sessionId, text } con textos.",
				);
			}
			const sent = deps.sendChat(input);
			return sent.ok
				? { status: STATUS.created, body: { ok: true, message: sent.value } }
				: failure(
						STATUS_OF_ERROR[sent.error.type],
						sent.error.type,
						sent.error.message,
					);
		}
		return failure(
			STATUS.methodNotAllowed,
			"MethodNotAllowed",
			"Solo GET y POST.",
		);
	}
	if (
		pathname.startsWith(CHAT_ROUTE.prefix) &&
		pathname !== CHAT_ROUTE.stream
	) {
		return failure(STATUS.notFound, "NotFound", `No existe ${pathname}`);
	}
	return null;
}
