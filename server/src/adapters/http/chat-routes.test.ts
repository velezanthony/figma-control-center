import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeActiveChatSessions } from "#application/active-chat-sessions.ts";
import { makeSendChat } from "#application/chat-messages.ts";
import {
	InMemoryChatStore,
	InMemoryChatTokens,
} from "#application/testing/in-memory-chat.ts";
import { type ChatRequest, handleChatRequest } from "./chat-routes.ts";

const HOSTS = ["127.0.0.1:4173", "localhost:4173"];
const CRED = { sessionId: "s1", token: "token-s1" };

function setup() {
	const store = new InMemoryChatStore();
	const tokens = new InMemoryChatTokens();
	store.register(CRED);
	tokens.publish(CRED.sessionId, CRED.token);
	const deps = {
		panel: store,
		sendChat: makeSendChat({ panel: store, tokens }),
		activeSessions: makeActiveChatSessions({ panel: store, tokens }),
		allowedHosts: HOSTS,
	};
	const call = (over: Partial<ChatRequest> & { pathname: string }) => {
		const response = handleChatRequest(deps, {
			method: "GET",
			params: new URLSearchParams(),
			headers: { host: HOSTS[0] },
			body: "",
			...over,
		});
		assert.ok(response, `${over.pathname} debería ser una ruta del chat`);
		return response;
	};
	const post = (
		body: unknown,
		headers: Record<string, string | undefined> = {},
	) =>
		call({
			method: "POST",
			pathname: "/api/chat/messages",
			headers: {
				host: HOSTS[0],
				"content-type": "application/json",
				origin: `http://${HOSTS[0]}`,
				...headers,
			},
			body: typeof body === "string" ? body : JSON.stringify(body),
		});
	return { store, tokens, deps, call, post };
}

describe("handleChatRequest", () => {
	it("una ruta que no es del chat no la maneja", () => {
		const { deps } = setup();
		const r = handleChatRequest(deps, {
			method: "GET",
			pathname: "/events",
			params: new URLSearchParams(),
			headers: {},
			body: "",
		});
		assert.equal(r, null);
	});

	it("GET /api/chat/sessions lista las sesiones con chat", () => {
		const { call } = setup();
		const r = call({ pathname: "/api/chat/sessions" });
		assert.equal(r.status, 200);
		const body = r.body as { ok: boolean; items: { sessionId: string }[] };
		assert.equal(body.ok, true);
		assert.deepEqual(
			body.items.map((s) => s.sessionId),
			["s1"],
		);
	});

	it("GET /api/chat/sessions solo ofrece las sesiones con el chat activo", () => {
		const { call, store, tokens } = setup();
		for (const id of ["muerta", "cerrada", "viva"]) {
			store.register({ sessionId: id, token: `t-${id}` });
			tokens.publish(id, `t-${id}`);
		}
		store.dead.add("muerta");
		tokens.revoke("cerrada");
		const body = call({ pathname: "/api/chat/sessions" }).body as {
			items: { sessionId: string }[];
		};
		assert.deepEqual(
			body.items.map((s) => s.sessionId),
			["s1", "viva"],
		);
	});

	it("GET /api/chat/messages devuelve la conversación desde un id, y exige la sesión", () => {
		const { call, post } = setup();
		post({ sessionId: "s1", text: "uno" });
		post({ sessionId: "s1", text: "dos" });
		const all = call({
			pathname: "/api/chat/messages",
			params: new URLSearchParams("session=s1"),
		});
		assert.deepEqual(
			(all.body as { items: { body: string }[] }).items.map((m) => m.body),
			["uno", "dos"],
		);
		const after = call({
			pathname: "/api/chat/messages",
			params: new URLSearchParams("session=s1&after=1"),
		});
		assert.deepEqual(
			(after.body as { items: { body: string }[] }).items.map((m) => m.body),
			["dos"],
		);
		assert.equal(call({ pathname: "/api/chat/messages" }).status, 400);
	});

	describe("paginación por id", () => {
		const bodies = (r: { body: unknown }) =>
			(r.body as { items: { body: string }[] }).items.map((m) => m.body);
		const query = (call: ReturnType<typeof setup>["call"], q: string) =>
			call({ pathname: "/api/chat/messages", params: new URLSearchParams(q) });

		it("sin cursor devuelve la última página (en orden) y avisa de que hay más antiguos", () => {
			const { call, post } = setup();
			for (const t of ["a", "b", "c", "d"]) post({ sessionId: "s1", text: t });
			const r = query(call, "session=s1&limit=2");
			assert.deepEqual(bodies(r), ["c", "d"]);
			assert.equal((r.body as { hasMore: boolean }).hasMore, true);
		});

		it("con before devuelve la página anterior a ese id; al llegar al principio hasMore es falso", () => {
			const { call, post } = setup();
			for (const t of ["a", "b", "c", "d"]) post({ sessionId: "s1", text: t });
			const r = query(call, "session=s1&limit=2&before=3");
			assert.deepEqual(bodies(r), ["a", "b"]);
			assert.equal((r.body as { hasMore: boolean }).hasMore, false);
		});

		it("el tamaño de página tiene un tope en el servidor y un valor por defecto", () => {
			const { call, post } = setup();
			for (let i = 0; i < 205; i++) post({ sessionId: "s1", text: `m${i}` });
			assert.equal(bodies(query(call, "session=s1&limit=100000")).length, 200);
			assert.equal(bodies(query(call, "session=s1")).length, 50);
		});

		it("un cursor o un tamaño que no son enteros positivos son un 400", () => {
			const { call } = setup();
			for (const q of ["before=x", "before=-1", "limit=0", "limit=abc"]) {
				assert.equal(query(call, `session=s1&${q}`).status, 400, q);
			}
		});

		it("after acepta un tamaño (para cargar tramos al saltar a un resultado antiguo) con el mismo tope", () => {
			const { call, post } = setup();
			for (const t of ["a", "b", "c", "d"]) post({ sessionId: "s1", text: t });
			assert.deepEqual(bodies(query(call, "session=s1&after=0&limit=2")), [
				"a",
				"b",
			]);
			assert.equal(query(call, "session=s1&after=0&limit=0").status, 400);
		});

		it("after sigue funcionando como antes (lo usan el SSE y el sondeo de entrega)", () => {
			const { call, post } = setup();
			for (const t of ["a", "b", "c"]) post({ sessionId: "s1", text: t });
			assert.deepEqual(bodies(query(call, "session=s1&after=1")), ["b", "c"]);
		});
	});

	describe("búsqueda", () => {
		const search = (call: ReturnType<typeof setup>["call"], q: string) =>
			call({ pathname: "/api/chat/search", params: new URLSearchParams(q) });
		const ids = (r: { body: unknown }) =>
			(r.body as { items: { id: number }[] }).items.map((i) => i.id);

		it("GET /api/chat/search devuelve los mensajes que contienen lo buscado, con id y fragmento", () => {
			const { call, post } = setup();
			post({ sessionId: "s1", text: "el nodo 1234 falló" });
			post({ sessionId: "s1", text: "otra cosa" });
			const r = search(call, "session=s1&q=nodo");
			assert.equal(r.status, 200);
			assert.deepEqual(ids(r), [1]);
			assert.equal(
				typeof (r.body as { items: { snippet: string }[] }).items[0]?.snippet,
				"string",
			);
			assert.equal((r.body as { truncated: boolean }).truncated, false);
		});

		it("exige la sesión y una consulta no vacía se trata como sin resultados", () => {
			const { call } = setup();
			assert.equal(search(call, "q=nodo").status, 400);
			assert.deepEqual(ids(search(call, "session=s1&q=")), []);
			assert.deepEqual(ids(search(call, "session=s1")), []);
		});

		it("una consulta demasiado larga es un 400 y solo se admite GET", () => {
			const { call } = setup();
			assert.equal(search(call, `session=s1&q=${"a".repeat(300)}`).status, 400);
			assert.equal(
				call({
					pathname: "/api/chat/search",
					method: "POST",
					params: new URLSearchParams("session=s1&q=a"),
				}).status,
				405,
			);
		});

		it("el tope de resultados lo pone el servidor", () => {
			const { call, post } = setup();
			for (let i = 0; i < 520; i++)
				post({ sessionId: "s1", text: `repetido ${i}` });
			const r = search(call, "session=s1&q=repetido");
			assert.equal(ids(r).length, 500);
			assert.equal((r.body as { truncated: boolean }).truncated, true);
		});
	});

	it("POST escribe a la sesión con el token que esta publicó: el navegador no manda ninguno", () => {
		const { post, store } = setup();
		const r = post({ sessionId: "s1", text: "  hola  " });
		assert.equal(r.status, 201);
		const message = (
			r.body as { message: { body: string; direction: string; status: string } }
		).message;
		assert.deepEqual(
			[message.body, message.direction, message.status],
			["hola", "in", "pending"],
		);
		assert.equal(store.all.length, 1);
	});

	it("errores de uso: sesión sin chat (404), mensaje vacío (400), JSON roto o con tipos malos (400)", () => {
		const { post } = setup();
		assert.equal(post({ sessionId: "otra", text: "hola" }).status, 404);
		assert.equal(post({ sessionId: "s1", text: "   " }).status, 400);
		assert.equal(post("{no es json").status, 400);
		assert.equal(post({ sessionId: 1, text: "hola" }).status, 400);
		assert.equal(post({ sessionId: "s1", text: 5 }).status, 400);
		assert.equal(post([]).status, 400);
		const body = post({ sessionId: "s1", text: " " }).body as {
			ok: boolean;
			error: { type: string };
		};
		assert.deepEqual([body.ok, body.error.type], [false, "EmptyMessage"]);
	});

	it("un token que ya no es el de la sesión se rechaza con 403", () => {
		const { post, tokens } = setup();
		tokens.publish("s1", "token-viejo");
		assert.equal(post({ sessionId: "s1", text: "hola" }).status, 403);
	});

	it("solo acepta JSON: un formulario de otra página no puede escribir (415)", () => {
		const { post, store } = setup();
		assert.equal(
			post(
				{ sessionId: "s1", text: "hola" },
				{ "content-type": "application/x-www-form-urlencoded" },
			).status,
			415,
		);
		assert.equal(
			post({ sessionId: "s1", text: "hola" }, { "content-type": "text/plain" })
				.status,
			415,
		);
		assert.equal(store.all.length, 0);
	});

	it("un POST de otro origen o con un Host que no es local se rechaza (CSRF y DNS rebinding)", () => {
		const { post, store } = setup();
		assert.equal(
			post(
				{ sessionId: "s1", text: "hola" },
				{ origin: "https://malo.example" },
			).status,
			403,
		);
		assert.equal(
			post(
				{ sessionId: "s1", text: "hola" },
				{ origin: "http://127.0.0.1:9999" },
			).status,
			403,
		);
		assert.equal(
			post({ sessionId: "s1", text: "hola" }, { host: "malo.example:4173" })
				.status,
			403,
		);
		assert.equal(
			post(
				{ sessionId: "s1", text: "hola" },
				{ "sec-fetch-site": "cross-site" },
			).status,
			403,
		);
		assert.equal(store.all.length, 0);
	});

	it("sin Origin (curl o un script local) con JSON y Host local sí vale", () => {
		const { post } = setup();
		assert.equal(
			post({ sessionId: "s1", text: "hola" }, { origin: undefined }).status,
			201,
		);
	});

	it("cualquier otra ruta del chat o método no permitido", () => {
		const { call } = setup();
		assert.equal(call({ pathname: "/api/chat/nada" }).status, 404);
		assert.equal(
			call({ pathname: "/api/chat/messages", method: "DELETE" }).status,
			405,
		);
		assert.equal(
			call({ pathname: "/api/chat/sessions", method: "POST" }).status,
			405,
		);
	});
});
