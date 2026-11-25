import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChannelPush, createChatRelay } from "./chat-relay.ts";
import { InMemoryChatStore } from "./testing/in-memory-chat.ts";

const CRED = { sessionId: "s1", token: "token-s1" };

function setup(over: { failPush?: boolean } = {}) {
	const store = new InMemoryChatStore();
	store.register(CRED);
	store.register({ sessionId: "s2", token: "token-s2" });
	const pushes: ChannelPush[] = [];
	const warnings: string[] = [];
	const relay = createChatRelay({
		inbox: store,
		credentials: CRED,
		push: async (p) => {
			if (over.failPush) throw new Error("transporte cerrado");
			pushes.push(p);
		},
		warn: (m) => warnings.push(m),
	});
	return { store, relay, pushes, warnings };
}

describe("createChatRelay (la sesión empuja a Claude lo que escribió el panel)", () => {
	it("cada mensaje pendiente se empuja con su texto y su chat_id, y queda entregado", async () => {
		const { store, relay, pushes } = setup();
		const sent = store.send({
			...CRED,
			text: "¿qué se hizo en la última hora?",
		});
		assert.ok(sent.ok);
		assert.equal(await relay.deliverPending(), 1);
		assert.deepEqual(pushes, [
			{
				content: "¿qué se hizo en la última hora?",
				meta: { chat_id: sent.value.chatId },
			},
		]);
		assert.equal(store.all[0]?.status, "delivered");
	});

	it("un mensaje no se entrega dos veces", async () => {
		const { store, relay, pushes } = setup();
		store.send({ ...CRED, text: "uno" });
		await relay.deliverPending();
		assert.equal(await relay.deliverPending(), 0);
		assert.equal(pushes.length, 1);
	});

	it("varios mensajes salen en orden", async () => {
		const { store, relay, pushes } = setup();
		store.send({ ...CRED, text: "a" });
		store.send({ ...CRED, text: "b" });
		await relay.deliverPending();
		assert.deepEqual(
			pushes.map((p) => p.content),
			["a", "b"],
		);
	});

	it("los mensajes de otra sesión no se entregan a esta", async () => {
		const { store, relay, pushes } = setup();
		store.send({ sessionId: "s2", token: "token-s2", text: "para la otra" });
		assert.equal(await relay.deliverPending(), 0);
		assert.deepEqual(pushes, []);
	});

	it("un mensaje sin firma o con la firma de otra sesión nunca produce notificación (CA-7)", async () => {
		const { store, relay, pushes } = setup();
		store.inject("s1", "inyectado sin firma", null);
		store.inject(
			"s1",
			"inyectado con otra firma",
			InMemoryChatStore.proof("token-s2"),
		);
		assert.equal(await relay.deliverPending(), 0);
		assert.deepEqual(pushes, []);
		assert.equal(await relay.deliverPending(), 0);
		assert.deepEqual(
			store.all.map((m) => m.status),
			["rejected", "rejected"],
		);
	});

	it("un mensaje legítimo y uno inyectado: solo llega el legítimo", async () => {
		const { store, relay, pushes } = setup();
		store.inject("s1", "inyectado", null);
		store.send({ ...CRED, text: "legítimo" });
		await relay.deliverPending();
		assert.deepEqual(
			pushes.map((p) => p.content),
			["legítimo"],
		);
	});

	it("si el empuje falla avisa y el mensaje sigue pendiente para el siguiente intento", async () => {
		const { store, relay, warnings } = setup({ failPush: true });
		store.send({ ...CRED, text: "uno" });
		assert.equal(await relay.deliverPending(), 0);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? "", /transporte cerrado/);
		assert.equal(store.all[0]?.status, "pending");
	});
});
