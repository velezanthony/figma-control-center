import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSION_LIMITS } from "#domain/permission.ts";
import {
	createPermissionRelay,
	makeDecidePermission,
	makeRecordPermission,
	type PermissionPush,
} from "./permissions.ts";
import { InMemoryChatTokens } from "./testing/in-memory-chat.ts";
import { InMemoryPermissionStore } from "./testing/in-memory-permissions.ts";

const CRED = { sessionId: "s1", token: "token-s1" };
const ASK = {
	requestId: "abcde",
	toolName: "Bash",
	description: "Run shell command",
	inputPreview: '{"command":"ls"}',
};

function setup(over: { failPush?: boolean } = {}) {
	const store = new InMemoryPermissionStore();
	store.register(CRED);
	store.register({ sessionId: "s2", token: "token-s2" });
	const tokens = new InMemoryChatTokens();
	tokens.publish("s1", CRED.token);
	tokens.publish("s2", "token-s2");
	const pushes: PermissionPush[] = [];
	const warnings: string[] = [];
	return {
		store,
		tokens,
		pushes,
		warnings,
		record: makeRecordPermission({ inbox: store, credentials: CRED }),
		decide: makeDecidePermission({ panel: store, tokens }),
		relay: createPermissionRelay({
			inbox: store,
			credentials: CRED,
			push: async (p) => {
				if (over.failPush) throw new Error("transporte cerrado");
				pushes.push(p);
			},
			warn: (m) => warnings.push(m),
		}),
	};
}

describe("makeRecordPermission (Claude Code pide permiso)", () => {
	it("guarda la petición como pendiente con su id, herramienta, descripción y entrada", () => {
		const { record } = setup();
		const saved = record(ASK);
		assert.equal(saved?.status, "pending");
		assert.equal(saved?.requestId, "abcde");
		assert.equal(saved?.toolName, "Bash");
		assert.equal(saved?.inputPreview, ASK.inputPreview);
	});

	it("un request_id repetido en la sesión se ignora: Claude Code descarta los veredictos de ids repetidos", () => {
		const { record, store } = setup();
		record(ASK);
		assert.equal(record({ ...ASK, toolName: "Write" }), null);
		assert.equal(store.all.length, 1);
	});

	it("recorta un campo desmesurado en vez de guardarlo entero", () => {
		const { record } = setup();
		const saved = record({
			...ASK,
			inputPreview: "x".repeat(PERMISSION_LIMITS.maxFieldChars + 500),
		});
		assert.ok(saved);
		assert.ok(saved.inputPreview.length <= PERMISSION_LIMITS.maxFieldChars + 1);
	});
});

describe("makeDecidePermission (el panel decide)", () => {
	it("aprueba una petición pendiente firmando con el token de la sesión", () => {
		const { record, decide } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		const decided = decide({
			sessionId: "s1",
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(decided.ok);
		assert.equal(decided.value.status, "allowed");
		assert.notEqual(decided.value.decidedAt, null);
	});

	it("solo se contesta una vez: la segunda decisión, aunque sea la contraria, se rechaza", () => {
		const { record, decide } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		decide({ sessionId: "s1", id: saved.id, behavior: "allow" });
		const again = decide({ sessionId: "s1", id: saved.id, behavior: "deny" });
		assert.ok(!again.ok);
		assert.equal(again.error.type, "AlreadyDecided");
	});

	it("sin token publicado la sesión no tiene chat y no se decide", () => {
		const { record, decide, tokens } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		tokens.revoke("s1");
		const decided = decide({
			sessionId: "s1",
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "NoSuchSession");
	});

	it("con el token de otra sesión no se decide", () => {
		const { record, store } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		const decided = store.decide({
			sessionId: "s1",
			token: "token-s2",
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "InvalidToken");
	});

	it("una petición de otra sesión no se puede decidir desde esta", () => {
		const { store, decide } = setup();
		const other = makeRecordPermission({
			inbox: store,
			credentials: { sessionId: "s2", token: "token-s2" },
		})(ASK);
		assert.ok(other);
		const decided = decide({
			sessionId: "s1",
			id: other.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "NoSuchRequest");
	});

	it("si la sesión terminó, la petición pendiente consta como caducada y no se decide", () => {
		const { record, decide, store } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		store.dead.add("s1");
		assert.equal(store.list("s1", 10)[0]?.status, "expired");
		const decided = decide({
			sessionId: "s1",
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "Expired");
	});
});

describe("createPermissionRelay (la sesión devuelve a Claude Code lo que decidió el panel)", () => {
	it("empuja el id de Claude Code y la decisión, y no lo repite", async () => {
		const { record, decide, relay, pushes } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		decide({ sessionId: "s1", id: saved.id, behavior: "deny" });
		assert.equal(await relay.deliverVerdicts(), 1);
		assert.deepEqual(pushes, [{ requestId: "abcde", behavior: "deny" }]);
		assert.equal(await relay.deliverVerdicts(), 0);
	});

	it("sin decisión no empuja nada", async () => {
		const { record, relay, pushes } = setup();
		record(ASK);
		assert.equal(await relay.deliverVerdicts(), 0);
		assert.deepEqual(pushes, []);
	});

	it("una decisión sin firma de esta sesión no se devuelve nunca", async () => {
		const { record, store, relay, pushes } = setup();
		const saved = record(ASK);
		assert.ok(saved);
		const forged = store.all[0];
		assert.ok(forged);
		forged.status = "allowed";
		forged.proof = "huella:otro";
		assert.equal(await relay.deliverVerdicts(), 0);
		assert.deepEqual(pushes, []);
		assert.equal(
			await relay.deliverVerdicts(),
			0,
			"queda descartada para siempre",
		);
	});

	it("si el empuje falla avisa, no la da por devuelta y la reintenta", async () => {
		const failing = setup({ failPush: true });
		const saved = failing.record(ASK);
		assert.ok(saved);
		failing.decide({ sessionId: "s1", id: saved.id, behavior: "allow" });
		assert.equal(await failing.relay.deliverVerdicts(), 0);
		assert.match(failing.warnings[0] ?? "", /transporte cerrado/);
		const retry = createPermissionRelay({
			inbox: failing.store,
			credentials: CRED,
			push: async (p) => {
				failing.pushes.push(p);
			},
			warn: () => {},
		});
		assert.equal(await retry.deliverVerdicts(), 1);
	});
});
