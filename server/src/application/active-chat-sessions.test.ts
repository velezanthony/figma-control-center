import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeActiveChatSessions } from "./active-chat-sessions.ts";
import {
	InMemoryChatStore,
	InMemoryChatTokens,
} from "./testing/in-memory-chat.ts";

const cred = (id: string) => ({ sessionId: id, token: `token-${id}` });

function setup() {
	const store = new InMemoryChatStore();
	const tokens = new InMemoryChatTokens();
	const start = (id: string) => {
		store.register(cred(id));
		tokens.publish(id, `token-${id}`);
	};
	return {
		store,
		tokens,
		start,
		active: makeActiveChatSessions({ panel: store, tokens }),
	};
}

describe("makeActiveChatSessions", () => {
	it("incluye las sesiones con token publicado y proceso vivo", () => {
		const { start, active } = setup();
		start("a");
		start("b");
		assert.deepEqual(
			active().map((s) => s.sessionId),
			["a", "b"],
		);
	});

	it("excluye las que ya no tienen el token publicado (la sesión se cerró)", () => {
		const { start, tokens, active } = setup();
		start("a");
		start("b");
		tokens.revoke("a");
		assert.deepEqual(
			active().map((s) => s.sessionId),
			["b"],
		);
	});

	it("excluye las de proceso muerto aunque el token siga en disco (kill -9)", () => {
		const { start, store, active } = setup();
		start("a");
		start("b");
		store.dead.add("b");
		assert.deepEqual(
			active().map((s) => s.sessionId),
			["a"],
		);
	});

	it("conserva el orden del almacén: la más reciente primero", () => {
		const { start, store, active } = setup();
		start("vieja");
		start("nueva");
		const order = store.sessions().map((s) => s.sessionId);
		assert.deepEqual(
			active().map((s) => s.sessionId),
			order,
		);
	});
});
