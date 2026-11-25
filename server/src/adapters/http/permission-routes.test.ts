import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeDecidePermission } from "#application/permissions.ts";
import { InMemoryChatTokens } from "#application/testing/in-memory-chat.ts";
import { InMemoryPermissionStore } from "#application/testing/in-memory-permissions.ts";
import { handlePermissionRequest } from "./permission-routes.ts";
import type { ApiRequest } from "./request-guard.ts";

const HOSTS = ["127.0.0.1:4173"];
const CRED = { sessionId: "s1", token: "token-s1" };
const PATH = "/api/chat/permissions";
const ASK = {
	requestId: "abcde",
	toolName: "Bash",
	description: "Run shell command",
	inputPreview: "{}",
};

function setup() {
	const store = new InMemoryPermissionStore();
	const tokens = new InMemoryChatTokens();
	store.register(CRED);
	tokens.publish(CRED.sessionId, CRED.token);
	const deps = {
		panel: store,
		decide: makeDecidePermission({ panel: store, tokens }),
		allowedHosts: HOSTS,
	};
	const call = (over: Partial<ApiRequest>) => {
		const r = handlePermissionRequest(deps, {
			method: "GET",
			pathname: PATH,
			params: new URLSearchParams(),
			headers: { host: HOSTS[0] },
			body: "",
			...over,
		});
		assert.ok(r);
		return r;
	};
	const post = (
		body: unknown,
		headers: Record<string, string | undefined> = {},
	) =>
		call({
			method: "POST",
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

describe("handlePermissionRequest", () => {
	it("otra ruta no la maneja", () => {
		const { deps } = setup();
		assert.equal(
			handlePermissionRequest(deps, {
				method: "GET",
				pathname: "/api/chat/messages",
				params: new URLSearchParams(),
				headers: {},
				body: "",
			}),
			null,
		);
	});

	it("GET lista las peticiones de la sesión y exige session", () => {
		const { store, call } = setup();
		store.record(CRED, ASK);
		const r = call({ params: new URLSearchParams({ session: "s1" }) });
		assert.equal(r.status, 200);
		assert.equal((r.body as { items: unknown[] }).items.length, 1);
		assert.equal(call({}).status, 400);
	});

	it("POST aprueba una petición y devuelve su nuevo estado", () => {
		const { store, post } = setup();
		const saved = store.record(CRED, ASK);
		assert.ok(saved);
		const r = post({ sessionId: "s1", id: saved.id, behavior: "allow" });
		assert.equal(r.status, 200);
		assert.equal(
			(r.body as { request: { status: string } }).request.status,
			"allowed",
		);
	});

	it("contestar dos veces es un conflicto, y no cambia la primera decisión", () => {
		const { store, post } = setup();
		const saved = store.record(CRED, ASK);
		assert.ok(saved);
		post({ sessionId: "s1", id: saved.id, behavior: "deny" });
		const again = post({ sessionId: "s1", id: saved.id, behavior: "allow" });
		assert.equal(again.status, 409);
		assert.equal(store.list("s1", 5)[0]?.status, "denied");
	});

	it("una sesión sin token publicado no se puede contestar (404) y una petición ajena tampoco", () => {
		const { store, tokens, post } = setup();
		const saved = store.record(CRED, ASK);
		assert.ok(saved);
		assert.equal(
			post({ sessionId: "s1", id: saved.id + 99, behavior: "allow" }).status,
			404,
		);
		tokens.revoke("s1");
		assert.equal(
			post({ sessionId: "s1", id: saved.id, behavior: "allow" }).status,
			404,
		);
	});

	it("rechaza el cuerpo inválido, un behavior desconocido, un id no entero y el origen ajeno", () => {
		const { post } = setup();
		assert.equal(post("no es json").status, 400);
		assert.equal(
			post({ sessionId: "s1", id: 1, behavior: "maybe" }).status,
			400,
		);
		assert.equal(
			post({ sessionId: "s1", id: 1.5, behavior: "allow" }).status,
			400,
		);
		assert.equal(
			post({ sessionId: "s1", id: "1", behavior: "allow" }).status,
			400,
		);
		assert.equal(
			post(
				{ sessionId: "s1", id: 1, behavior: "allow" },
				{ origin: "https://malo.example" },
			).status,
			403,
		);
	});

	it("el verbo PUT no está permitido", () => {
		const { call } = setup();
		assert.equal(call({ method: "PUT" }).status, 405);
	});
});
