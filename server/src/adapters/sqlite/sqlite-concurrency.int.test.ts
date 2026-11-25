import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { openFigmaDatabase } from "./database.ts";

const OPENER = join(import.meta.dirname, "testing/opener-process.ts");
const WORKER = join(import.meta.dirname, "testing/writer-process.ts");
const CALLS_PER_PROCESS = 150;
const OPENERS = 8;
const OPEN_SYNC_MS = 3000;
const OPEN_ROUNDS = 3;

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-conc-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const runChild = (args: readonly string[]) =>
	new Promise<{ code: number | null; stderr: string }>((resolve) => {
		const child = spawn(process.execPath, [...args], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
		child.on("close", (code) => resolve({ code, stderr }));
	});

const runWriter = (file: string, project: number, session: string) =>
	runChild([WORKER, file, String(project), session, String(CALLS_PER_PROCESS)]);
const runOpener = (file: string, startAt: number) =>
	runChild([OPENER, file, String(startAt)]);

describe("varios procesos escribiendo a la vez en proyectos distintos (WAL + busy_timeout) → CA-6", () => {
	it("sobre una base que aún no existe, ninguno falla por bloqueo ni pierde datos, y cada proyecto conserva lo suyo", async () => {
		const file = join(dir, "concurrente.db");
		// Dos sesiones del proyecto 1 y una del 2, todas a la vez
		const runs = await Promise.all([
			runWriter(file, 1, "sesion-a"),
			runWriter(file, 2, "sesion-b"),
			runWriter(file, 1, "sesion-c"),
		]);
		for (const r of runs) {
			assert.deepEqual(
				{ code: r.code, stderr: r.stderr },
				{ code: 0, stderr: "" },
			);
		}

		const db = openFigmaDatabase(file);
		const count = (sql: string, ...args: number[]) =>
			(db.$client.prepare(sql).get(...args) as { n: number }).n;
		const N = CALLS_PER_PROCESS;
		for (const [project, processes] of [
			[1, 2],
			[2, 1],
		] as const) {
			assert.equal(
				count("SELECT count(*) AS n FROM calls WHERE project_id = ?", project),
				N * processes,
			);
			assert.equal(
				count(
					"SELECT count(*) AS n FROM calls WHERE project_id = ? AND status = 'ok'",
					project,
				),
				N * processes,
			);
			assert.equal(
				count("SELECT count(*) AS n FROM events WHERE project_id = ?", project),
				N * processes * 2,
			);
			assert.equal(
				count(
					"SELECT count(*) AS n FROM sessions WHERE project_id = ?",
					project,
				),
				processes,
			);
			assert.equal(
				count(
					"SELECT sum(calls) AS n FROM sessions WHERE project_id = ?",
					project,
				),
				N * processes,
			);
		}
		assert.equal(
			count("SELECT count(DISTINCT id) AS n FROM events"),
			N * 3 * 2,
		);
		assert.equal(
			count(
				"SELECT count(*) AS n FROM events e JOIN sessions s ON s.project_id = e.project_id AND s.id = e.session_id",
			),
			N * 3 * 2,
		);
		db.$client.close();
	});

	it("varios procesos que abren a la vez una base nueva migran sin pelearse", async () => {
		for (let round = 0; round < OPEN_ROUNDS; round++) {
			const file = join(dir, `apertura-${round}.db`);
			const startAt = Date.now() + OPEN_SYNC_MS;
			const results = await Promise.all(
				Array.from({ length: OPENERS }, () => runOpener(file, startAt)),
			);
			assert.deepEqual(
				results,
				results.map(() => ({ code: 0, stderr: "" })),
			);
		}
	});

	it("un lector abierto mientras se escribe sigue leyendo sin bloquearse", async () => {
		const file = join(dir, "lector.db");
		const reader = openFigmaDatabase(file);
		const writing = runWriter(file, 1, "sesion-c");
		let reads = 0;
		while (reads < 20) {
			reader.$client.prepare("SELECT count(*) FROM calls").get();
			reads++;
			await new Promise((r) => setTimeout(r, 5));
		}
		assert.equal((await writing).code, 0);
		reader.$client.close();
	});
});
