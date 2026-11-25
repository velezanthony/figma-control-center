// Lecturas de intentos para la página «Intentos»: objetivo exacto, página, estado del último,
// orden, `callKept` y el plan de las consultas con volumen
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { AttemptInput } from "#application/ports/attempt-log.ts";
import {
	ATTEMPT_KIND,
	ATTEMPT_ROLE,
	ATTEMPT_STATUS,
	type AttemptKind,
} from "#domain/attempt.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteAttemptLog } from "./sqlite-attempt-log.ts";
import { SqliteHistoryQuery } from "./sqlite-history-query.ts";
import {
	sessionStarted,
	T0,
	toolCalled,
	toolFinished,
} from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-attempt-query-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const DAY = 86_400_000;

function setup() {
	const file = join(dir, `q${++n}.db`);
	const db = openTestDb(file);
	const log = new SqliteAttemptLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => assert.fail(m),
		maxScriptBytes: () => 10_000,
	});
	const maintenance = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => assert.fail(m),
	});
	const query = new SqliteHistoryQuery({
		projectId: PROJECT_ID,
		db: openTestDb(file, { queryOnly: true }),
	});
	return { db, log, maintenance, query };
}

let serial = 0;
const attempt = (over: Partial<AttemptInput> = {}): AttemptInput => ({
	kind: ATTEMPT_KIND.runScript,
	target: "pasos/a.js",
	callId: "c1",
	startedAt: new Date(T0 + ++serial),
	finishedAt: new Date(T0 + serial + 10),
	status: ATTEMPT_STATUS.ok,
	kit: "figma-kit@1",
	scripts: [
		{ role: ATTEMPT_ROLE.step, path: "", content: `v${serial}` },
		{ role: ATTEMPT_ROLE.kit, path: "", content: "kit" },
	],
	...over,
});

const record = (
	log: SqliteAttemptLog,
	target: string,
	times: number,
	over: Partial<AttemptInput> = {},
	kind: AttemptKind = ATTEMPT_KIND.runScript,
) => {
	for (let i = 0; i < times; i++)
		log.record(attempt({ target, kind, ...over }));
};

const base = {
	target: null,
	kind: null,
	sinceMs: null,
	limit: 50,
} as const;

describe("targetAttempts: los intentos de UN objetivo, por igualdad", () => {
	it("trae solo el objetivo exacto, no los que lo contienen", () => {
		const { log, query } = setup();
		record(log, "kit/place@1 · app", 2);
		record(log, "kit/place@1 · app-2", 3);
		const found = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "kit/place@1 · app",
			offset: 0,
			limit: 50,
		});
		assert.equal(found.total, 2);
		assert.deepEqual(
			found.items.map((i) => i.n),
			[1, 2],
		);
	});

	it("el tipo también cuenta: el mismo objetivo de otro tipo no entra", () => {
		const { log, query } = setup();
		record(log, "x.js", 2);
		record(log, "x.js", 1, {}, ATTEMPT_KIND.buildStep);
		const found = query.targetAttempts({
			kind: ATTEMPT_KIND.buildStep,
			target: "x.js",
			offset: 0,
			limit: 50,
		});
		assert.equal(found.total, 1);
	});

	it("un objetivo con % o _ se compara literal", () => {
		const { log, query } = setup();
		record(log, "a%b", 1);
		record(log, "aXb", 1);
		const found = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "a%b",
			offset: 0,
			limit: 50,
		});
		assert.equal(found.total, 1);
	});

	it("pagina en orden de n; con offset null da los últimos", () => {
		const { log, query } = setup();
		record(log, "p.js", 7);
		const q = { kind: ATTEMPT_KIND.runScript, target: "p.js", limit: 3 };
		assert.deepEqual(
			query.targetAttempts({ ...q, offset: 3 }).items.map((i) => i.n),
			[4, 5, 6],
		);
		assert.deepEqual(
			query.targetAttempts({ ...q, offset: null }).items.map((i) => i.n),
			[5, 6, 7],
		);
	});

	it("el primero de una página trae lo que cambió respecto al anterior, que queda fuera", () => {
		const { log, query } = setup();
		record(log, "p.js", 4);
		const page = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "p.js",
			offset: 2,
			limit: 2,
		});
		assert.deepEqual(
			page.items.map((i) => [i.n, i.changed]),
			[
				[3, ["step"]],
				[4, ["step"]],
			],
		);
	});

	it("el primer intento no tiene changed", () => {
		const { log, query } = setup();
		record(log, "p.js", 2);
		const found = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "p.js",
			offset: 0,
			limit: 5,
		});
		assert.equal(found.items[0]?.changed, null);
	});

	it("un objetivo que no existe: vacío", () => {
		const { query } = setup();
		const found = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "no-hay",
			offset: 0,
			limit: 5,
		});
		assert.deepEqual(found, { items: [], total: 0 });
	});
});

describe("attemptTargets: estado del último, orden y página", () => {
	it("filtra por el estado del ÚLTIMO intento, no de cualquiera", () => {
		const { log, query } = setup();
		record(log, "a.js", 1, { status: ATTEMPT_STATUS.error });
		record(log, "a.js", 1, { status: ATTEMPT_STATUS.ok });
		record(log, "b.js", 1, { status: ATTEMPT_STATUS.ok });
		record(log, "b.js", 1, { status: ATTEMPT_STATUS.error });
		const errors = query.attemptTargets({
			...base,
			status: ATTEMPT_STATUS.error,
		});
		assert.deepEqual(
			errors.items.map((t) => t.target),
			["b.js"],
		);
		assert.equal(errors.total, 1);
	});

	it("por intentos (defecto): el más intentado primero; dir asc lo invierte", () => {
		const { log, query } = setup();
		record(log, "uno.js", 1);
		record(log, "tres.js", 3);
		record(log, "dos.js", 2);
		const names = (dir: "asc" | "desc") =>
			query
				.attemptTargets({ ...base, order: "attempts", dir })
				.items.map((t) => t.target);
		assert.deepEqual(names("desc"), ["tres.js", "dos.js", "uno.js"]);
		assert.deepEqual(names("asc"), ["uno.js", "dos.js", "tres.js"]);
	});

	it("por el último: el más reciente primero", () => {
		const { log, query } = setup();
		record(log, "a.js", 1);
		record(log, "b.js", 1);
		record(log, "a.js", 1);
		const names = query
			.attemptTargets({ ...base, order: "last", dir: "desc" })
			.items.map((t) => t.target);
		assert.deepEqual(names, ["a.js", "b.js"]);
	});

	it("pagina con offset y el total sigue siendo el de todos", () => {
		const { log, query } = setup();
		for (const name of ["a", "b", "c", "d", "e"]) record(log, `${name}.js`, 1);
		const page = query.attemptTargets({
			...base,
			order: "last",
			dir: "asc",
			limit: 2,
			offset: 2,
		});
		assert.deepEqual(
			page.items.map((t) => t.target),
			["c.js", "d.js"],
		);
		assert.equal(page.total, 5);
	});

	it("sin los campos nuevos se comporta como antes", () => {
		const { log, query } = setup();
		record(log, "uno.js", 1);
		record(log, "dos.js", 2);
		const found = query.attemptTargets(base);
		assert.deepEqual(
			found.items.map((t) => [t.target, t.attempts, t.lastStatus]),
			[
				["dos.js", 2, "ok"],
				["uno.js", 1, "ok"],
			],
		);
	});
});

describe("callKept y attemptById", () => {
	it("callKept dice si la llamada sigue en el histórico; tras la retención, no", () => {
		const { log, maintenance, query } = setup();
		maintenance.record(sessionStarted("s1", 0));
		maintenance.record(
			toolCalled("s1", "c1", "figma_run_script", { file: "a.js" }, 1),
		);
		maintenance.record(toolFinished("s1", "c1", 5));
		record(log, "a.js", 1, { callId: "c1", startedAt: new Date(T0) });
		const read = () =>
			query.targetAttempts({
				kind: ATTEMPT_KIND.runScript,
				target: "a.js",
				offset: 0,
				limit: 5,
			}).items[0];
		assert.equal(read()?.callKept, true);
		maintenance.prune(new Date(T0 + 50 * DAY));
		assert.equal(read()?.callKept, false, "el intento sigue (último ok)");
	});

	it("un intento sin llamada no la tiene guardada", () => {
		const { log, query } = setup();
		record(log, "a.js", 1, { callId: null });
		const item = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "a.js",
			offset: 0,
			limit: 5,
		}).items[0];
		assert.equal(item?.callKept, false);
	});

	it("attemptById devuelve el intento con lo que cambió, o null", () => {
		const { log, query } = setup();
		record(log, "a.js", 2);
		const second = query.targetAttempts({
			kind: ATTEMPT_KIND.runScript,
			target: "a.js",
			offset: 0,
			limit: 5,
		}).items[1];
		const byId = query.attemptById(second?.id ?? 0);
		assert.equal(byId?.n, 2);
		assert.deepEqual(byId?.changed, ["step"]);
		assert.equal(query.attemptById(99_999), null);
	});
});

describe("plan de las consultas con volumen", () => {
	it("la lista de objetivos y la línea de intentos usan los índices que hay", () => {
		const { db, log } = setup();
		db.$client.exec("BEGIN");
		for (let t = 0; t < 300; t++) record(log, `obj-${t}.js`, 10);
		db.$client.exec("COMMIT");
		const plan = (sql: string, ...params: unknown[]) =>
			(
				db.$client.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as {
					detail: string;
				}[]
			)
				.map((r) => r.detail)
				.join("\n");
		const line = plan(
			"SELECT * FROM attempts WHERE project_id = ? AND kind = ? AND target = ? ORDER BY n LIMIT 50",
			PROJECT_ID,
			"run_script",
			"obj-3.js",
		);
		assert.match(line, /attempts_project_target_n/);
		assert.doesNotMatch(line, /SCAN attempts\b(?! USING)/);
		const last = plan(
			"SELECT a.status FROM attempts a WHERE a.project_id = ? AND a.kind = ? AND a.target = ? AND a.n = ?",
			PROJECT_ID,
			"run_script",
			"obj-3.js",
			10,
		);
		assert.match(last, /attempts_project_target_n/);
	});

	it("la lista de 3 000 intentos responde sin recorrer una consulta por objetivo", () => {
		const { db, log, query } = setup();
		db.$client.exec("BEGIN");
		for (let t = 0; t < 300; t++) record(log, `obj-${t}.js`, 10);
		db.$client.exec("COMMIT");
		const page = query.attemptTargets({ ...base, limit: 25, offset: 25 });
		assert.equal(page.total, 300);
		assert.equal(page.items.length, 25);
		assert.equal(page.items[0]?.attempts, 10);
	});
});
