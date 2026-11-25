import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { hashToken } from "./chat-token.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteChatMailbox } from "./sqlite-chat.ts";
import {
	SqlitePermissionMailbox,
	SqlitePermissionPanel,
} from "./sqlite-permissions.ts";
import { sessionStarted, T0 } from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-permisos-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const A = { sessionId: "sesion-a", token: "token-de-a" };
const B = { sessionId: "sesion-b", token: "token-de-b" };
const ASK = {
	requestId: "abcde",
	toolName: "Bash",
	description: "Run shell command",
	inputPreview: '{"command":"rm -rf <b>x</b>"}',
};

function setup(alive: (pid: number) => boolean = () => true) {
	const file = join(dir, `p${++n}.db`);
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
	new SqliteChatMailbox({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
	}).register(A);
	new SqliteChatMailbox({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
	}).register(B);
	const mailboxA = new SqlitePermissionMailbox({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
	});
	const panel = new SqlitePermissionPanel({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		now,
		isAlive: alive,
	});
	const raw = <T>(sql: string, ...args: unknown[]) =>
		db.$client.prepare(sql).all(...args) as T[];
	const exec = (sql: string) => db.$client.exec(sql);
	return { mailboxA, panel, raw, exec };
}

describe("SqlitePermissionMailbox.record", () => {
	it("guarda la petición pendiente con sus cuatro campos como texto", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.equal(saved?.status, "pending");
		assert.deepEqual(
			panel
				.list(A.sessionId, 10)
				.map((r) => [r.requestId, r.toolName, r.inputPreview]),
			[["abcde", "Bash", ASK.inputPreview]],
		);
	});

	it("un requestId repetido en la misma sesión se ignora, en otra sesión no", () => {
		const { mailboxA, panel } = setup();
		assert.ok(mailboxA.record(A, ASK));
		assert.equal(mailboxA.record(A, { ...ASK, toolName: "Write" }), null);
		assert.equal(panel.list(A.sessionId, 10).length, 1);
		assert.ok(mailboxA.record(B, ASK));
	});
});

describe("SqlitePermissionPanel.decide", () => {
	it("decide con el token de la sesión y deja constar la firma y la hora", () => {
		const { mailboxA, panel, raw } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		const decided = panel.decide({
			sessionId: A.sessionId,
			token: A.token,
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(decided.ok);
		assert.equal(decided.value.status, "allowed");
		const row = raw<{ decider_hash: string; decided_at: number }>(
			"SELECT decider_hash, decided_at FROM permission_requests",
		)[0];
		assert.equal(row?.decider_hash, hashToken(A.token));
		assert.ok((row?.decided_at ?? 0) > 0);
	});

	it("con el token de otra sesión se rechaza y la petición sigue pendiente", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		const decided = panel.decide({
			sessionId: A.sessionId,
			token: B.token,
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "InvalidToken");
		assert.equal(panel.list(A.sessionId, 10)[0]?.status, "pending");
	});

	it("una petición de otra sesión no se decide aunque el token sea válido", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		const decided = panel.decide({
			sessionId: B.sessionId,
			token: B.token,
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "NoSuchRequest");
	});

	it("solo se decide una vez", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		const input = { sessionId: A.sessionId, token: A.token, id: saved.id };
		assert.ok(panel.decide({ ...input, behavior: "deny" }).ok);
		const again = panel.decide({ ...input, behavior: "allow" });
		assert.ok(!again.ok);
		assert.equal(again.error.type, "AlreadyDecided");
		assert.equal(panel.list(A.sessionId, 10)[0]?.status, "denied");
	});

	it("si el proceso de la sesión ya no existe, la petición consta como caducada y no se decide", () => {
		const { mailboxA, panel, exec } = setup(() => false);
		exec("UPDATE sessions SET pid = 1");
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		assert.equal(panel.list(A.sessionId, 10)[0]?.status, "expired");
		const decided = panel.decide({
			sessionId: A.sessionId,
			token: A.token,
			id: saved.id,
			behavior: "allow",
		});
		assert.ok(!decided.ok);
		assert.equal(decided.error.type, "Expired");
	});
});

describe("SqlitePermissionMailbox.verdicts", () => {
	it("devuelve lo que decidió el panel una sola vez y no lo repite tras marcarlo enviado", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		assert.deepEqual(mailboxA.verdicts(A), []);
		panel.decide({
			sessionId: A.sessionId,
			token: A.token,
			id: saved.id,
			behavior: "deny",
		});
		assert.deepEqual(mailboxA.verdicts(A), [
			{ id: saved.id, requestId: "abcde", behavior: "deny" },
		]);
		mailboxA.markSent(A, saved.id);
		assert.deepEqual(mailboxA.verdicts(A), []);
	});

	it("una decisión metida en la base sin la firma de la sesión no se devuelve y queda rechazada", () => {
		const { mailboxA, panel, raw, exec } = setup();
		const saved = mailboxA.record(A, ASK);
		assert.ok(saved);
		exec(
			"UPDATE permission_requests SET status = 'allowed', decider_hash = 'falsa'",
		);
		assert.deepEqual(mailboxA.verdicts(A), []);
		assert.equal(
			raw<{ status: string }>("SELECT status FROM permission_requests")[0]
				?.status,
			"rejected",
		);
		assert.deepEqual(panel.list(A.sessionId, 10), [], "el panel no la muestra");
	});

	it("una sesión no recoge las decisiones de otra", () => {
		const { mailboxA, panel } = setup();
		const saved = mailboxA.record(B, ASK);
		assert.ok(saved);
		panel.decide({
			sessionId: B.sessionId,
			token: B.token,
			id: saved.id,
			behavior: "allow",
		});
		assert.deepEqual(mailboxA.verdicts(A), []);
	});
});
