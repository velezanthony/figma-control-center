import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ChatMessage, ChatSessionInfo } from "#web/lib/contract.ts";
import {
	defaultSession,
	hasLiveSession,
	lastMessageId,
	mergeMessages,
	parseChatMessage,
	pickSession,
} from "./thread.ts";

const msg = (
	id: number,
	direction: "in" | "out",
	over: Partial<ChatMessage> = {},
): ChatMessage => ({
	id,
	sessionId: "s1",
	direction,
	chatId: `chat-${direction === "in" ? id : id - 1}`,
	body: `m${id}`,
	at: "2026-01-01T00:00:00.000Z",
	status: "delivered",
	...over,
});
const ids = (ms: readonly ChatMessage[]) => ms.map((m) => m.id);

describe("mergeMessages", () => {
	it("ordena por id y no repite los mensajes que llegan por el historial y por el flujo", () => {
		const merged = mergeMessages(
			[msg(1, "in"), msg(2, "out")],
			[msg(2, "out"), msg(3, "in")],
		);
		assert.deepEqual(ids(merged), [1, 2, 3]);
	});

	it("un mensaje conocido se actualiza con su versión nueva (pendiente → entregado)", () => {
		const merged = mergeMessages(
			[msg(1, "in", { status: "pending" })],
			[msg(1, "in", { status: "delivered" })],
		);
		assert.equal(merged.length, 1);
		assert.equal(merged[0]?.status, "delivered");
	});

	it("no modifica las listas recibidas y sin nada nuevo devuelve lo mismo", () => {
		const current = [msg(2, "in"), msg(1, "in")];
		const merged = mergeMessages(current, []);
		assert.deepEqual(ids(merged), [1, 2]);
		assert.deepEqual(ids(current), [2, 1]);
	});
});

describe("lastMessageId", () => {
	it("el mayor id conocido, o 0 si la conversación está vacía", () => {
		assert.equal(lastMessageId([]), 0);
		assert.equal(lastMessageId([msg(3, "in"), msg(7, "out"), msg(5, "in")]), 7);
	});
});

describe("defaultSession", () => {
	const s = (
		sessionId: string,
		alive: boolean,
		lastSeenAt: string,
	): ChatSessionInfo => ({
		sessionId,
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		lastSeenAt,
		alive,
	});

	it("la más reciente de las vivas; las muertas no valen", () => {
		const sessions = [
			s("vieja", true, "2026-01-01T00:00:01.000Z"),
			s("nueva", true, "2026-01-01T00:00:09.000Z"),
			s("muerta", false, "2026-01-01T00:00:20.000Z"),
		];
		assert.equal(defaultSession(sessions), "nueva");
	});

	it("sin sesiones vivas no hay ninguna por defecto", () => {
		assert.equal(defaultSession([]), null);
		assert.equal(
			defaultSession([s("muerta", false, "2026-01-01T00:00:20.000Z")]),
			null,
		);
	});
});

describe("hasLiveSession: ¿hay un agente al que escribir?", () => {
	const s = (alive: boolean): ChatSessionInfo => ({
		sessionId: alive ? "viva" : "muerta",
		pid: 1,
		startedAt: "2026-01-01T00:00:00.000Z",
		lastSeenAt: "2026-01-01T00:00:00.000Z",
		alive,
	});

	it("sin sesiones, o solo con muertas, no hay agente (hay que lanzarlo)", () => {
		assert.equal(hasLiveSession([]), false);
		assert.equal(hasLiveSession([s(false), s(false)]), false);
	});

	it("con al menos una viva, hay agente", () => {
		assert.equal(hasLiveSession([s(false), s(true)]), true);
	});
});

describe("parseChatMessage", () => {
	it("acepta un mensaje con la forma del contrato", () => {
		const m = msg(4, "out");
		assert.deepEqual(parseChatMessage(JSON.stringify(m)), m);
	});

	it("descarta basura sin lanzar", () => {
		for (const bad of [
			"no json",
			"null",
			"[]",
			'{"id":"x"}',
			'{"id":1,"body":"a","chatId":"c","direction":"raro"}',
		]) {
			assert.equal(parseChatMessage(bad), null, bad);
		}
	});
});

describe("pickSession", () => {
	const alive = (id: string, lastSeenAt: string): ChatSessionInfo => ({
		sessionId: id,
		pid: 1,
		startedAt: lastSeenAt,
		lastSeenAt,
		alive: true,
	});
	const items = [alive("a", "2026-01-01"), alive("b", "2026-01-02")];

	it("respeta la sesión pedida por la URL si sigue activa", () => {
		assert.equal(pickSession("a", items), "a");
	});

	it("una sesión de la URL que ya no está activa cae en la más reciente", () => {
		assert.equal(pickSession("muerta", items), "b");
	});

	it("sin petición, la más reciente; sin sesiones, ninguna", () => {
		assert.equal(pickSession(null, items), "b");
		assert.equal(pickSession("a", []), null);
	});
});
