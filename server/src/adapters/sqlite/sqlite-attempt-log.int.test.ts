// El historial de intentos en SQLite: número por objetivo, un contenido = una fila,
// gzip, too_big, papeles que cambiaron y retención con el último `ok` protegido
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gunzipSync } from "node:zlib";
import type { AttemptInput } from "#application/ports/attempt-log.ts";
import {
	ATTEMPT_KIND,
	ATTEMPT_ROLE,
	ATTEMPT_STATUS,
	SCRIPT_STORED,
} from "#domain/attempt.ts";
import type { FigmaDb } from "./database.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteAttemptLog } from "./sqlite-attempt-log.ts";
import { SqliteHistoryQuery } from "./sqlite-history-query.ts";
import { T0 } from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-attempts-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const KIT = "// kit v1\n";
const DAY = 86_400_000;

function setup(maxScriptBytes = 1000) {
	const file = join(dir, `a${++n}.db`);
	const db = openTestDb(file);
	const warnings: string[] = [];
	const log = new SqliteAttemptLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => warnings.push(m),
		maxScriptBytes: () => maxScriptBytes,
	});
	const query = new SqliteHistoryQuery({
		projectId: PROJECT_ID,
		db: openTestDb(file, { queryOnly: true }),
	});
	const maintenance = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => assert.fail(m),
	});
	return { db, log, query, maintenance, warnings };
}

const attempt = (
	over: Partial<AttemptInput> & { step?: string; params?: string } = {},
): AttemptInput => {
	const { step = "return 1;", params = "null", ...rest } = over;
	return {
		kind: ATTEMPT_KIND.runScript,
		target: "pasos/a.js",
		callId: "c1",
		startedAt: new Date(T0),
		finishedAt: new Date(T0 + 10),
		status: ATTEMPT_STATUS.ok,
		kit: "figma-kit@1",
		scripts: [
			{ role: ATTEMPT_ROLE.step, path: "", content: step },
			{ role: ATTEMPT_ROLE.params, path: "", content: params },
			{ role: ATTEMPT_ROLE.kit, path: "", content: KIT },
		],
		...rest,
	};
};

const rows = (db: FigmaDb, table: string): number =>
	(
		db.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {
			n: number;
		}
	).n;

describe("SqliteAttemptLog: números y contenidos", () => {
	it("numera los intentos por proyecto, tipo y objetivo: 1, 2, 3", () => {
		const { log } = setup();
		const a = log.record(attempt());
		const b = log.record(attempt());
		const c = log.record(attempt({ target: "pasos/b.js" }));
		const d = log.record(attempt({ kind: ATTEMPT_KIND.buildStep }));
		assert.deepEqual([a?.n, b?.n, c?.n, d?.n], [1, 2, 1, 1]);
	});

	it("el mismo contenido lanzado diez veces ocupa una fila; un contenido distinto, otra", () => {
		const { db, log } = setup();
		for (let i = 0; i < 10; i++) log.record(attempt());
		assert.equal(rows(db, "attempts"), 10);
		assert.equal(rows(db, "script_blobs"), 3, "step, params y kit");
		log.record(attempt({ step: "return 2;" }));
		assert.equal(rows(db, "script_blobs"), 4);
	});

	it("guarda el contenido exacto comprimido con gzip y su hash", () => {
		const { db, log, query } = setup();
		const step = "// @contract step@1 · ñandú\nreturn {};\n";
		const saved = log.record(attempt({ step }));
		assert.ok(saved);
		const raw = db.$client
			.prepare(
				"SELECT content, bytes, stored, kind FROM script_blobs WHERE sha256 = ?",
			)
			.get(sha(step)) as {
			content: Buffer;
			bytes: number;
			stored: string;
			kind: string;
		};
		assert.equal(gunzipSync(raw.content).toString("utf8"), step);
		assert.equal(raw.bytes, Buffer.byteLength(step));
		assert.equal(raw.stored, SCRIPT_STORED.full);
		assert.equal(raw.kind, "js");
		const got = query.storedScript({
			by: "attempt",
			attemptId: saved.id,
			role: ATTEMPT_ROLE.step,
		});
		assert.deepEqual(got, {
			kind: "found",
			script: {
				sha256: sha(step),
				kind: "js",
				bytes: raw.bytes,
				stored: "full",
				content: step,
			},
		});
	});

	it("los params son JSON; el kit, un contenido más que se repite poco", () => {
		const { db, log } = setup();
		log.record(attempt({ params: '{"a":1}' }));
		const kinds = db.$client
			.prepare(
				"SELECT role, b.kind AS kind FROM attempt_scripts s JOIN script_blobs b USING (project_id, sha256) ORDER BY role",
			)
			.all() as { role: string; kind: string }[];
		assert.deepEqual(kinds, [
			{ role: "kit", kind: "js" },
			{ role: "params", kind: "json" },
			{ role: "step", kind: "js" },
		]);
	});

	it("un contenido mayor que el tope queda solo como hash y tamaño (too_big)", () => {
		const { db, log, query } = setup(50);
		const big = "x".repeat(200);
		const saved = log.record(attempt({ step: big }));
		const row = db.$client
			.prepare(
				"SELECT content, bytes, stored FROM script_blobs WHERE sha256 = ?",
			)
			.get(sha(big)) as {
			content: Buffer | null;
			bytes: number;
			stored: string;
		};
		assert.deepEqual(
			[row.content, row.bytes, row.stored],
			[null, 200, "too_big"],
		);
		const got = query.storedScript({
			by: "attempt",
			attemptId: saved?.id ?? 0,
			role: ATTEMPT_ROLE.step,
		});
		assert.equal(got.kind === "found" && got.script.stored, "too_big");
		assert.equal(got.kind === "found" && got.script.content, null);
	});

	it("un papel con varias rutas pide la ruta; con ella, da el contenido", () => {
		const { log, query } = setup();
		const saved = log.record(
			attempt({
				scripts: [
					{ role: ATTEMPT_ROLE.step, path: "", content: "s" },
					{ role: ATTEMPT_ROLE.hooks, path: "a.js", content: "ha" },
					{ role: ATTEMPT_ROLE.hooks, path: "b.js", content: "hb" },
					{ role: ATTEMPT_ROLE.kit, path: "", content: KIT },
				],
			}),
		);
		const id = saved?.id ?? 0;
		assert.deepEqual(
			query.storedScript({ by: "attempt", attemptId: id, role: "hooks" }),
			{
				kind: "needs_path",
				paths: ["a.js", "b.js"],
			},
		);
		const b = query.storedScript({
			by: "attempt",
			attemptId: id,
			role: "hooks",
			path: "b.js",
		});
		assert.equal(b.kind === "found" && b.script.content, "hb");
		assert.deepEqual(
			query.storedScript({ by: "attempt", attemptId: id, role: "screens" }),
			{ kind: "not_found" },
		);
		assert.deepEqual(
			query.storedScript({ by: "attempt", attemptId: 9999, role: "step" }),
			{ kind: "not_found" },
		);
	});

	it("por hash directamente", () => {
		const { log, query } = setup();
		log.record(attempt({ step: "return 5;" }));
		const got = query.storedScript({ by: "sha256", sha256: sha("return 5;") });
		assert.equal(got.kind === "found" && got.script.content, "return 5;");
		assert.deepEqual(
			query.storedScript({ by: "sha256", sha256: "0".repeat(64) }),
			{ kind: "not_found" },
		);
	});

	it("guarda la llamada, el job, el paso, el kit con su hash, los assets y el primer error", () => {
		const { log, query } = setup();
		log.record(
			attempt({
				kind: ATTEMPT_KIND.buildStep,
				callId: "c9",
				jobId: "job-1",
				stepIndex: 3,
				status: ATTEMPT_STATUS.error,
				firstError: "boom",
				assets: [
					{ name: "datos", path: "a/datos.json", bytes: 4, sha256: "ab" },
				],
			}),
		);
		const [item] = query.attempts({
			target: "pasos/a.js",
			kind: null,
			sinceMs: null,
			limit: 10,
		}).items;
		assert.equal(item?.callId, "c9");
		assert.equal(item?.jobId, "job-1");
		assert.equal(item?.stepIndex, 3);
		assert.equal(item?.status, "error");
		assert.equal(item?.firstError, "boom");
		assert.equal(item?.kit, "figma-kit@1");
		assert.equal(item?.kitSha256, sha(KIT));
		assert.deepEqual(item?.assets, [
			{ name: "datos", path: "a/datos.json", bytes: 4, sha256: "ab" },
		]);
		assert.equal(item?.startedAt, new Date(T0).toISOString());
	});

	it("un fallo al escribir se avisa y no rompe: devuelve null", () => {
		const { db, log, warnings } = setup();
		db.$client.exec("DROP TABLE attempt_scripts");
		assert.equal(log.record(attempt()), null);
		assert.match(warnings[0] ?? "", /intento/);
	});
});

describe("HistoryQuery: qué cambió entre intentos", () => {
	it("el tercer intento cambió `step`; `params` y `kit` iguales; los dos primeros comparten contenido", () => {
		const { db, log, query } = setup();
		log.record(attempt());
		log.record(attempt());
		log.record(attempt({ step: "return 2;" }));
		const items = query.attempts({
			target: "pasos/a.js",
			kind: null,
			sinceMs: null,
			limit: 10,
		}).items;
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2, 3],
		);
		assert.deepEqual(
			items.map((i) => i.changed),
			[null, [], ["step"]],
		);
		const first = items[0]?.scripts.find((s) => s.role === "step")?.sha256;
		assert.equal(
			first,
			items[1]?.scripts.find((s) => s.role === "step")?.sha256,
		);
		assert.equal(rows(db, "script_blobs"), 4);
	});

	it("un intento fuera del tope sigue comparándose con su anterior", () => {
		const { log, query } = setup();
		for (let i = 0; i < 4; i++) log.record(attempt({ step: `return ${i};` }));
		const items = query.attempts({
			target: "pasos/a.js",
			kind: null,
			sinceMs: null,
			limit: 2,
		});
		assert.deepEqual(
			items.items.map((i) => i.n),
			[3, 4],
		);
		assert.deepEqual(
			items.items.map((i) => i.changed),
			[["step"], ["step"]],
		);
		assert.equal(items.total, 4);
	});

	it("attemptsOfCall lista los de una llamada", () => {
		const { log, query } = setup();
		log.record(attempt({ callId: "c1" }));
		log.record(attempt({ callId: "c2", target: "otro.js" }));
		log.record(
			attempt({
				callId: "c2",
				target: "otro.js",
				kind: ATTEMPT_KIND.buildStep,
			}),
		);
		assert.deepEqual(
			query.attemptsOfCall("c2").map((a) => [a.n, a.kind, a.target]),
			[
				[1, "run_script", "otro.js"],
				[1, "build_step", "otro.js"],
			],
		);
		assert.deepEqual(query.attemptsOfCall("nada"), []);
	});
});

describe("HistoryQuery: objetivos", () => {
	it("sin filtro, los objetivos con su número de intentos, último estado y fecha, el que más intentos tiene primero", () => {
		const { log, query } = setup();
		for (let i = 0; i < 3; i++)
			log.record(attempt({ finishedAt: new Date(T0 + i) }));
		log.record(
			attempt({
				target: "b.js",
				status: ATTEMPT_STATUS.error,
				startedAt: new Date(T0 + 500),
			}),
		);
		const out = query.attemptTargets({
			target: null,
			kind: null,
			sinceMs: null,
			limit: 10,
		});
		assert.equal(out.total, 2);
		assert.deepEqual(
			out.items.map((t) => [t.target, t.attempts, t.lastStatus]),
			[
				["pasos/a.js", 3, "ok"],
				["b.js", 1, "error"],
			],
		);
		assert.equal(out.items[1]?.lastAt, new Date(T0 + 500).toISOString());
	});

	it("filtra por texto contenido en el objetivo, por tipo y por fecha, y respeta el tope", () => {
		const { log, query } = setup();
		log.record(attempt({ target: "pasos/a.js", startedAt: new Date(T0) }));
		log.record(
			attempt({
				target: "pasos/b.js",
				kind: ATTEMPT_KIND.buildStep,
				startedAt: new Date(T0 + DAY),
			}),
		);
		log.record(
			attempt({
				target: "inicio",
				kind: ATTEMPT_KIND.capture,
				startedAt: new Date(T0 + 2 * DAY),
			}),
		);
		const ask = (over: object) =>
			query
				.attemptTargets({
					target: null,
					kind: null,
					sinceMs: null,
					limit: 10,
					...over,
				})
				.items.map((t) => t.target);
		assert.deepEqual(ask({ target: "pasos/" }).sort(), [
			"pasos/a.js",
			"pasos/b.js",
		]);
		assert.deepEqual(ask({ target: "%" }), [], "un % no es comodín");
		assert.deepEqual(ask({ kind: "capture" }), ["inicio"]);
		assert.deepEqual(ask({ sinceMs: T0 + DAY }).sort(), [
			"inicio",
			"pasos/b.js",
		]);
		assert.equal(ask({ limit: 1 }).length, 1);
	});
});

describe("retención de intentos", () => {
	const old = (over: Parameters<typeof attempt>[0] = {}) =>
		attempt({ startedAt: new Date(T0), finishedAt: new Date(T0 + 1), ...over });

	it("borra los intentos viejos y se queda el último `ok` de cada objetivo", () => {
		const { db, log, maintenance } = setup();
		log.record(old({ step: "uno" })); // viejo, ok, pero no es el último ok
		log.record(old({ step: "dos" })); // viejo, ok, ÚLTIMO ok: se protege
		log.record(old({ step: "tres", status: ATTEMPT_STATUS.error })); // viejo, error, posterior al último ok: fuera
		log.record(old({ target: "otro.js", status: ATTEMPT_STATUS.error })); // viejo, sin ningún ok: fuera
		log.record(
			attempt({
				target: "c.js",
				startedAt: new Date(T0 + 100 * DAY),
				step: "reciente",
			}),
		); // reciente: se queda
		const pruned = maintenance.prune(new Date(T0 + 50 * DAY));
		assert.equal(pruned.attempts, 3);
		const left = db.$client
			.prepare("SELECT target, n FROM attempts ORDER BY target, n")
			.all();
		assert.deepEqual(left, [
			{ target: "c.js", n: 1 },
			{ target: "pasos/a.js", n: 2 },
		]);
	});

	it("los contenidos que ningún intento usa se borran; los que sí, no", () => {
		const { db, log, maintenance } = setup();
		log.record(old({ step: "se-va", status: ATTEMPT_STATUS.error }));
		log.record(old({ step: "se-queda" }));
		const pruned = maintenance.prune(new Date(T0 + 50 * DAY));
		assert.equal(pruned.scripts, 1);
		const shas = (
			db.$client.prepare("SELECT sha256 FROM script_blobs").all() as {
				sha256: string;
			}[]
		).map((r) => r.sha256);
		assert.equal(shas.includes(sha("se-va")), false);
		assert.equal(shas.includes(sha("se-queda")), true);
		assert.equal(
			rows(db, "attempt_scripts"),
			3,
			"step, params y kit del protegido",
		);
	});

	it("el protegido es por tipo y objetivo: el mismo objetivo de otro tipo guarda el suyo", () => {
		const { db, log, maintenance } = setup();
		log.record(old({ kind: ATTEMPT_KIND.runScript }));
		log.record(old({ kind: ATTEMPT_KIND.buildStep }));
		maintenance.prune(new Date(T0 + 50 * DAY));
		assert.equal(rows(db, "attempts"), 2);
	});
});

import { createHash } from "node:crypto";

function sha(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}
