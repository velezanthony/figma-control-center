import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeReplyChat, makeSendChat } from "./chat-messages.ts";
import {
	InMemoryChatStore,
	InMemoryChatTokens,
	MAX_CHARS,
} from "./testing/in-memory-chat.ts";

const CRED = { sessionId: "s1", token: "token-s1" };

function setup() {
	const store = new InMemoryChatStore();
	const tokens = new InMemoryChatTokens();
	store.register(CRED);
	tokens.publish(CRED.sessionId, CRED.token);
	return {
		store,
		tokens,
		send: makeSendChat({ panel: store, tokens }),
		reply: makeReplyChat({ outbox: store, credentials: CRED }),
	};
}

describe("makeSendChat (el panel escribe a una sesión)", () => {
	it("firma con el token que publicó la sesión y deja el mensaje pendiente", () => {
		const { send, store } = setup();
		const r = send({ sessionId: "s1", text: "  hola  " });
		assert.ok(r.ok);
		assert.equal(r.value.body, "hola");
		assert.equal(r.value.direction, "in");
		assert.equal(r.value.status, "pending");
		assert.equal(store.all.length, 1);
	});

	it("una sesión que no publicó su token no existe para el chat", () => {
		const { send, store } = setup();
		const r = send({ sessionId: "otra", text: "hola" });
		assert.ok(!r.ok);
		assert.equal(r.error.type, "NoSuchSession");
		assert.equal(store.all.length, 0);
	});

	it("un token que ya no es el de la sesión se rechaza y no se escribe nada", () => {
		const { send, tokens, store } = setup();
		tokens.publish("s1", "token-viejo");
		const r = send({ sessionId: "s1", text: "hola" });
		assert.ok(!r.ok);
		assert.equal(r.error.type, "InvalidToken");
		assert.equal(store.all.length, 0);
	});

	it("un mensaje vacío o demasiado largo se rechaza antes de tocar el almacén", () => {
		const { send, store } = setup();
		const empty = send({ sessionId: "s1", text: "   " });
		assert.ok(!empty.ok);
		assert.equal(empty.error.type, "EmptyMessage");
		const long = send({ sessionId: "s1", text: "x".repeat(MAX_CHARS + 1) });
		assert.ok(!long.ok);
		assert.equal(long.error.type, "MessageTooLong");
		assert.equal(
			send({ sessionId: "s1", text: "x".repeat(MAX_CHARS) }).ok,
			true,
		);
		assert.equal(store.all.length, 1);
	});
});

describe("makeReplyChat (Claude responde)", () => {
	it("guarda la respuesta como saliente de esa conversación", () => {
		const { send, reply } = setup();
		const sent = send({ sessionId: "s1", text: "hola" });
		assert.ok(sent.ok);
		const r = reply(sent.value.chatId, " Hecho ");
		assert.ok(r.ok);
		assert.equal(r.value.direction, "out");
		assert.equal(r.value.chatId, sent.value.chatId);
		assert.equal(r.value.body, "Hecho");
	});

	it("responder a una conversación que no existe es un error que la nombra", () => {
		const { reply } = setup();
		const r = reply("fantasma", "hola");
		assert.ok(!r.ok);
		assert.equal(r.error.type, "NoSuchChat");
		assert.match(r.error.message, /fantasma/);
	});

	it("una respuesta vacía o enorme se rechaza", () => {
		const { send, reply } = setup();
		const sent = send({ sessionId: "s1", text: "hola" });
		assert.ok(sent.ok);
		const empty = reply(sent.value.chatId, "  ");
		assert.ok(!empty.ok);
		assert.equal(empty.error.type, "EmptyMessage");
		const long = reply(sent.value.chatId, "y".repeat(MAX_CHARS + 1));
		assert.ok(!long.ok);
		assert.equal(long.error.type, "MessageTooLong");
	});
});
