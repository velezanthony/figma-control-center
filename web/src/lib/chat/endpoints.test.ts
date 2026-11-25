import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	chatMessagesUrl,
	chatPageUrl,
	chatPermissionsUrl,
	chatSearchUrl,
	chatStreamUrl,
	DECIDE_PERMISSION_INIT,
	SEND_CHAT_INIT,
} from "./endpoints.ts";

describe("rutas del chat", () => {
	it("el historial y el flujo piden la sesión y desde qué mensaje", () => {
		assert.equal(
			chatMessagesUrl("s-1", 5),
			"/api/chat/messages?session=s-1&after=5",
		);
		assert.equal(
			chatStreamUrl("s-1", 0),
			"/api/chat/stream?session=s-1&after=0",
		);
	});

	it("las páginas de la conversación piden la última, o la anterior a un id, con su tamaño", () => {
		assert.equal(
			chatPageUrl("s-1", null, 50),
			"/api/chat/messages?session=s-1&limit=50",
		);
		assert.equal(
			chatPageUrl("s-1", 120, 50),
			"/api/chat/messages?session=s-1&limit=50&before=120",
		);
	});

	it("la búsqueda en todo el historial lleva la sesión y el texto codificado", () => {
		const url = new URL(chatSearchUrl("s-1", "nodo 12:34 & más"), "http://x");
		assert.equal(url.pathname, "/api/chat/search");
		assert.equal(url.searchParams.get("session"), "s-1");
		assert.equal(url.searchParams.get("q"), "nodo 12:34 & más");
	});

	it("un tramo de mensajes desde un id puede pedir su tamaño", () => {
		assert.equal(
			chatMessagesUrl("s-1", 5, 200),
			"/api/chat/messages?session=s-1&after=5&limit=200",
		);
	});

	it("un id de sesión con caracteres especiales viaja codificado", () => {
		assert.equal(
			new URL(chatMessagesUrl("a&b=c", 1), "http://x").searchParams.get(
				"session",
			),
			"a&b=c",
		);
	});

	it("enviar es un POST con JSON y sin ningún token: el navegador no conoce secretos", () => {
		const init = SEND_CHAT_INIT("s-1", "hola");
		assert.equal(init.method, "POST");
		assert.deepEqual(init.headers, { "Content-Type": "application/json" });
		assert.deepEqual(JSON.parse(String(init.body)), {
			sessionId: "s-1",
			text: "hola",
		});
	});
});

describe("rutas de los permisos", () => {
	it("se piden por sesión y se contestan con un POST JSON { sessionId, id, behavior }", () => {
		assert.equal(
			chatPermissionsUrl("s-1"),
			"/api/chat/permissions?session=s-1",
		);
		const init = DECIDE_PERMISSION_INIT("s-1", 7, "deny");
		assert.equal(init.method, "POST");
		assert.deepEqual(JSON.parse(String(init.body)), {
			sessionId: "s-1",
			id: 7,
			behavior: "deny",
		});
	});
});
