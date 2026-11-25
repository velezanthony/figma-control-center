import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { hashToken } from "./chat-token.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteChatMailbox, SqliteChatPanel } from "./sqlite-chat.ts";
import { sessionStarted, T0 } from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-chat-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const A = { sessionId: "sesion-a", token: "token-de-a" };
const B = { sessionId: "sesion-b", token: "token-de-b" };

function setup(alive: (pid: number) => boolean = () => true) {
	const file = join(dir, `c${++n}.db`);
	const db = openTestDb(file);
	const log = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => assert.fail(m),
	});
	let clock = T0;
	const now = () => (clock += 10);
	log.record(sessionStarted(A.sessionId, 0));
	log.record(sessionStarted(B.sessionId, 5));
	const mailboxA = new SqliteChatMailbox({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
	});
	const mailboxB = new SqliteChatMailbox({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
	});
	const panel = new SqliteChatPanel({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
		isAlive: alive,
	});
	mailboxA.register(A);
	mailboxB.register(B);
	const raw = <T>(sql: string, ...args: unknown[]) =>
		db.$client.prepare(sql).all(...args) as T[];
	return { db, mailboxA, mailboxB, panel, raw };
}

describe("SqliteChatMailbox.register", () => {
	it("guarda la huella del token, nunca el token", () => {
		const { raw } = setup();
		const row = raw<{ chat_token_hash: string }>(
			"SELECT chat_token_hash FROM sessions WHERE id = ?",
			A.sessionId,
		)[0];
		assert.equal(row?.chat_token_hash, hashToken(A.token));
		assert.match(row?.chat_token_hash ?? "", /^[0-9a-f]{64}$/);
		assert.equal(
			raw("SELECT 1 FROM sessions WHERE chat_token_hash = ?", A.token).length,
			0,
		);
	});

	it("registrar una sesión que aún no estaba en la base la crea", () => {
		const { mailboxA, raw } = setup();
		mailboxA.register({ sessionId: "nueva", token: "t" });
		assert.equal(raw("SELECT 1 FROM sessions WHERE id = 'nueva'").length, 1);
	});
});

describe("SqliteChatPanel.send y SqliteChatMailbox.pending (CA-6 y CA-7)", () => {
	it("un mensaje del panel con el token de la sesión llega a su bandeja, una sola vez", () => {
		const { panel, mailboxA } = setup();
		const sent = panel.send({ ...A, text: "¿qué se hizo?" });
		assert.ok(sent.ok);
		assert.equal(sent.value.direction, "in");
		assert.equal(sent.value.status, "pending");
		assert.equal(sent.value.sessionId, A.sessionId);
		assert.ok(sent.value.chatId.length > 8);
		const pending = mailboxA.pending(A);
		assert.deepEqual(
			pending.map((m) => [m.id, m.body, m.chatId]),
			[[sent.value.id, "¿qué se hizo?", sent.value.chatId]],
		);
		mailboxA.markDelivered(A, sent.value.id);
		assert.deepEqual(mailboxA.pending(A), []);
	});

	it("el panel rechaza escribir con un token que no es el de la sesión, y no deja nada en la base", () => {
		const { panel, raw } = setup();
		const bad = panel.send({
			sessionId: A.sessionId,
			token: "token-de-b",
			text: "hola",
		});
		assert.ok(!bad.ok);
		assert.equal(bad.error.type, "InvalidToken");
		const none = panel.send({
			sessionId: "no-existe",
			token: "x",
			text: "hola",
		});
		assert.ok(!none.ok);
		assert.equal(none.error.type, "NoSuchSession");
		assert.equal(raw("SELECT 1 FROM chat_messages").length, 0);
	});

	it("un mensaje metido en la base sin la firma de la sesión nunca llega a su bandeja y queda rechazado", () => {
		const { mailboxA, db, raw } = setup();
		db.$client.exec(`INSERT INTO chat_messages(project_id, session_id, direction, chat_id, body, at, status, sender_hash)
			VALUES (1, '${A.sessionId}', 'in', 'x1', 'sin firma', 1, 'pending', NULL),
			       (1, '${A.sessionId}', 'in', 'x2', 'firma ajena', 2, 'pending', '${hashToken(B.token)}')`);
		assert.deepEqual(mailboxA.pending(A), []);
		assert.deepEqual(
			raw<{ status: string }>(
				"SELECT status FROM chat_messages ORDER BY id",
			).map((r) => r.status),
			["rejected", "rejected"],
		);
	});

	it("un mensaje legítimo entre inyectados: solo llega el legítimo y respeta el orden", () => {
		const { mailboxA, panel, db } = setup();
		db.$client.exec(
			`INSERT INTO chat_messages(project_id, session_id, direction, chat_id, body, at, status) VALUES (1, '${A.sessionId}', 'in', 'x1', 'inyectado', 1, 'pending')`,
		);
		panel.send({ ...A, text: "uno" });
		panel.send({ ...A, text: "dos" });
		assert.deepEqual(
			mailboxA.pending(A).map((m) => m.body),
			["uno", "dos"],
		);
	});

	it("la bandeja de una sesión no ve los mensajes de otra", () => {
		const { mailboxA, mailboxB, panel } = setup();
		panel.send({ ...B, text: "para b" });
		assert.deepEqual(mailboxA.pending(A), []);
		assert.deepEqual(
			mailboxB.pending(B).map((m) => m.body),
			["para b"],
		);
	});

	it("una sesión con otro token (reinicio) no puede recoger lo firmado con el anterior", () => {
		const { mailboxA, panel } = setup();
		panel.send({ ...A, text: "firmado con el token viejo" });
		assert.deepEqual(
			mailboxA.pending({ sessionId: A.sessionId, token: "token-nuevo" }),
			[],
		);
	});
});

describe("SqliteChatMailbox.reply", () => {
	it("la respuesta se guarda como saliente de esa conversación", () => {
		const { mailboxA, panel, raw } = setup();
		const sent = panel.send({ ...A, text: "hola" });
		assert.ok(sent.ok);
		const r = mailboxA.reply(A, sent.value.chatId, "Hecho");
		assert.ok(r.ok);
		assert.equal(r.value.direction, "out");
		assert.equal(r.value.chatId, sent.value.chatId);
		assert.equal(r.value.sessionId, A.sessionId);
		assert.equal(
			raw("SELECT 1 FROM chat_messages WHERE direction = 'out'").length,
			1,
		);
	});

	it("responder a una conversación de otra sesión o inexistente falla", () => {
		const { mailboxA, panel } = setup();
		const other = panel.send({ ...B, text: "de b" });
		assert.ok(other.ok);
		for (const chatId of [other.value.chatId, "fantasma"]) {
			const r = mailboxA.reply(A, chatId, "intruso");
			assert.ok(!r.ok);
			assert.equal(r.error.type, "NoSuchChat");
		}
	});
});

describe("SqliteChatPanel.messages y sessions", () => {
	it("messages devuelve la conversación de una sesión desde un id, en orden, con tope", () => {
		const { mailboxA, panel } = setup();
		const q1 = panel.send({ ...A, text: "p1" });
		assert.ok(q1.ok);
		mailboxA.reply(A, q1.value.chatId, "r1");
		panel.send({ ...B, text: "de b" });
		panel.send({ ...A, text: "p2" });
		const all = panel.messages(A.sessionId, 0, 10);
		assert.deepEqual(
			all.map((m) => `${m.direction}:${m.body}`),
			["in:p1", "out:r1", "in:p2"],
		);
		assert.deepEqual(
			panel.messages(A.sessionId, all[0]?.id ?? 0, 10).map((m) => m.body),
			["r1", "p2"],
		);
		assert.equal(panel.messages(A.sessionId, 0, 2).length, 2);
		assert.equal(typeof all[0]?.at, "string");
	});

	it("page devuelve la última página en orden, y las anteriores con un cursor por id", () => {
		const { panel } = setup();
		for (let i = 1; i <= 7; i++) panel.send({ ...A, text: `a${i}` });
		panel.send({ ...B, text: "de b" });
		const latest = panel.page(A.sessionId, null, 3);
		assert.deepEqual(
			latest.items.map((m) => m.body),
			["a5", "a6", "a7"],
		);
		assert.equal(latest.hasMore, true);
		const older = panel.page(A.sessionId, latest.items[0]?.id ?? 0, 3);
		assert.deepEqual(
			older.items.map((m) => m.body),
			["a2", "a3", "a4"],
		);
		assert.equal(older.hasMore, true);
		const oldest = panel.page(A.sessionId, older.items[0]?.id ?? 0, 3);
		assert.deepEqual(
			oldest.items.map((m) => m.body),
			["a1"],
		);
		assert.equal(oldest.hasMore, false);
	});

	it("page: una conversación que cabe entera no tiene más y otra sesión no se mezcla", () => {
		const { panel } = setup();
		panel.send({ ...A, text: "uno" });
		panel.send({ ...B, text: "de b" });
		const page = panel.page(A.sessionId, null, 50);
		assert.deepEqual(
			page.items.map((m) => m.body),
			["uno"],
		);
		assert.equal(page.hasMore, false);
		assert.deepEqual(panel.page("nadie", null, 5), {
			items: [],
			hasMore: false,
		});
	});

	describe("search: FTS5 sobre todo el historial de una sesión", () => {
		const seed = (
			panel: ReturnType<typeof setup>["panel"],
			who: typeof A,
			texts: string[],
		) =>
			texts.map((t) => {
				const r = panel.send({ ...who, text: t });
				assert.ok(r.ok);
				return r.value.id;
			});

		it("encuentra por palabra, sin mayúsculas ni acentos, y devuelve los ids en orden con un fragmento", () => {
			const { panel } = setup();
			const [a, , c] = seed(panel, A, [
				"La ACCIÓN falló en el nodo 12:34",
				"nada que ver",
				"otra acción distinta",
			]);
			const result = panel.search(A.sessionId, "accion", 50);
			assert.deepEqual(
				result.items.map((h) => h.id),
				[a, c],
			);
			assert.equal(result.truncated, false);
			assert.match(result.items[0]?.snippet ?? "", /ACCI/i);
		});

		it("busca por prefijo y por varias palabras a la vez", () => {
			const { panel } = setup();
			const [a] = seed(panel, A, [
				"rediseño del panel de actividad",
				"panel viejo",
			]);
			assert.deepEqual(
				panel.search(A.sessionId, "redis", 50).items.map((h) => h.id),
				[a],
			);
			assert.deepEqual(
				panel.search(A.sessionId, "panel actividad", 50).items.map((h) => h.id),
				[a],
			);
		});

		it("no mezcla sesiones y una búsqueda sin letras ni cifras no devuelve nada", () => {
			const { panel } = setup();
			seed(panel, A, ["secreto de a"]);
			seed(panel, B, ["secreto de b"]);
			assert.equal(panel.search(A.sessionId, "secreto", 50).items.length, 1);
			assert.deepEqual(panel.search(A.sessionId, '  "*:-  ', 50), {
				items: [],
				truncated: false,
			});
		});

		it("el texto libre con sintaxis de FTS5 no rompe la consulta", () => {
			const { panel } = setup();
			seed(panel, A, ["uno OR dos NEAR tres"]);
			assert.doesNotThrow(() => panel.search(A.sessionId, 'OR "NEAR(', 50));
		});

		it("pasado el tope devuelve los primeros por id y avisa de que hay más", () => {
			const { panel } = setup();
			const ids = seed(panel, A, ["hola 1", "hola 2", "hola 3", "hola 4"]);
			const result = panel.search(A.sessionId, "hola", 3);
			assert.deepEqual(
				result.items.map((h) => h.id),
				ids.slice(0, 3),
			);
			assert.equal(result.truncated, true);
		});

		it("las respuestas de Claude también se indexan (el índice lo mantiene un trigger)", () => {
			const { panel, mailboxA } = setup();
			const q = panel.send({ ...A, text: "pregunta" });
			assert.ok(q.ok);
			const r = mailboxA.reply(
				A,
				q.value.chatId,
				"respuesta con **negrita** única",
			);
			assert.ok(r.ok);
			assert.deepEqual(
				panel.search(A.sessionId, "negrita", 50).items.map((h) => h.id),
				[r.value.id],
			);
		});
	});

	it("sessions lista solo las que tienen chat, la más reciente primero, con si siguen vivas", () => {
		const { panel, db } = setup((pid) => pid === 4242);
		db.$client.exec(
			"INSERT INTO sessions(project_id, id, started_at, last_seen_at) VALUES (1, 'sin-chat', 1, 1)",
		);
		const s = panel.sessions();
		assert.deepEqual(s.map((x) => x.sessionId).sort(), [
			A.sessionId,
			B.sessionId,
		]);
		assert.ok(s.every((x) => x.alive));
		const dead = setup(() => false).panel.sessions();
		assert.ok(dead.every((x) => !x.alive));
	});
});
