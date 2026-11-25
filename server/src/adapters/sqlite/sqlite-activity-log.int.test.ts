import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { FigmaDb } from "./database.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import {
	buildStepFinished,
	jobFinished,
	screenshotSaved,
	scriptError,
	sessionStarted,
	statusChecked,
	T0,
	toolCalled,
	toolFinished,
} from "./testing/events.ts";
import { openTestDb, PROJECT_ID } from "./testing/projects.ts";

let dir: string;
let n = 0;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-log-"));
});
after(() => rm(dir, { recursive: true, force: true }));

function setup() {
	const db: FigmaDb = openTestDb(join(dir, `t${++n}.db`));
	const warnings: string[] = [];
	const log = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db,
		warn: (m) => warnings.push(m),
	});
	const all = <T>(sql: string, ...args: unknown[]) =>
		db.$client.prepare(sql).all(...args) as T[];
	const one = <T>(sql: string, ...args: unknown[]): T => {
		const row = db.$client.prepare(sql).get(...args);
		assert.ok(row, `la consulta no devolvió ninguna fila: ${sql}`);
		return row as T;
	};
	return { db, log, warnings, all, one };
}

const S = "sesion-1";

describe("SqliteActivityLog: llamadas y sesiones", () => {
	it("tool_called crea la llamada en curso con su resumen y cuenta en la sesión", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S));
		log.record(
			toolCalled(S, "c1", "figma_run_script", { file: "scripts/x.js" }, 1000),
		);
		const call = one<Record<string, unknown>>(
			"SELECT * FROM calls WHERE call_id = 'c1'",
		);
		assert.equal(call["status"], "running");
		assert.equal(call["tool"], "figma_run_script");
		assert.equal(call["is_write"], 1);
		assert.equal(call["started_at"], T0 + 1000);
		assert.equal(call["summary"], "figma_run_script scripts/x.js → en curso");
		assert.deepEqual(JSON.parse(call["args_summary"] as string), {
			file: "scripts/x.js",
		});
		const session = one<Record<string, unknown>>(
			"SELECT * FROM sessions WHERE id = ?",
			S,
		);
		assert.equal(session["calls"], 1);
		assert.equal(session["writes"], 0);
		assert.equal(session["pid"], 4242);
		assert.equal(session["last_seen_at"], T0 + 1000);
	});

	it("la misma tool_called dos veces deja una sola llamada y un solo recuento", () => {
		const { log, one } = setup();
		const e = toolCalled(S, "c1", "figma_status", {}, 10);
		log.record(e);
		log.record(e);
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM calls").n, 1);
		assert.equal(one<{ calls: number }>("SELECT calls FROM sessions").calls, 1);
	});

	it("tool_finished completa la llamada: duración, nodos, resumen y contadores", () => {
		const { log, one, all } = setup();
		log.record(
			toolCalled(S, "c1", "figma_run_script", { file: "scripts/x.js" }, 0),
		);
		log.record(
			toolFinished(S, "c1", 180, {
				ms: 180.5,
				touchedNodeIds: ["1:2", "1:3", "1:4"],
				resultPath: "/tmp/r.json",
			}),
		);
		const call = one<Record<string, unknown>>(
			"SELECT * FROM calls WHERE call_id = 'c1'",
		);
		assert.equal(call["status"], "ok");
		assert.equal(call["ms"], 180.5);
		assert.equal(call["finished_at"], T0 + 180);
		assert.equal(call["touched_count"], 3);
		assert.equal(call["result_path"], "/tmp/r.json");
		assert.equal(
			call["summary"],
			"figma_run_script scripts/x.js → 3 nodos, 181 ms",
		);
		assert.deepEqual(
			all<{ node_id: string }>(
				"SELECT node_id FROM call_nodes ORDER BY node_id",
			).map((r) => r.node_id),
			["1:2", "1:3", "1:4"],
		);
		const session = one<Record<string, unknown>>("SELECT * FROM sessions");
		assert.equal(session["total_ms"], 180.5);
		assert.equal(session["errors"], 0);
	});

	it("un error guarda tipo, mensaje, siguiente paso y línea, y cuenta como error de la sesión", () => {
		const { log, one } = setup();
		log.record(
			toolCalled(S, "c1", "figma_run_script", { file: "scripts/x.js" }, 0),
		);
		log.record(
			toolFinished(S, "c1", 50, {
				ok: false,
				error: scriptError("Boom"),
				retryable: false,
			}),
		);
		const call = one<Record<string, unknown>>("SELECT * FROM calls");
		assert.equal(call["status"], "error");
		assert.equal(call["error_type"], "ScriptError");
		assert.equal(call["error_message"], "Boom");
		assert.equal(call["next_step"], "Corrige el script y vuelve a ejecutarlo.");
		assert.equal(call["error_line"], 3);
		assert.equal(call["retryable"], 0);
		assert.equal(
			call["summary"],
			"figma_run_script scripts/x.js → error ScriptError, 100 ms",
		);
		assert.equal(
			one<{ errors: number }>("SELECT errors FROM sessions").errors,
			1,
		);
	});

	it("nodes_touched acumula veces y recuerda la última llamada", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S, 0));
		for (const [i, id] of ["c1", "c2"].entries()) {
			log.record(
				toolCalled(S, id, "figma_run_script", { file: "a.js" }, 100 * (i + 1)),
			);
			log.record(
				toolFinished(S, id, 100 * (i + 1) + 50, { touchedNodeIds: ["9:9"] }),
			);
		}
		const node = one<Record<string, unknown>>(
			"SELECT * FROM nodes_touched WHERE node_id = '9:9'",
		);
		assert.equal(node["touch_count"], 2);
		assert.equal(node["first_at"], T0 + 150);
		assert.equal(node["last_at"], T0 + 250);
		assert.equal(node["last_call_id"], "c2");
		assert.equal(node["last_session_id"], S);
		assert.equal(node["file_url"], "https://www.figma.com/design/abc/Archivo");
	});

	it("un evento de una sesión desconocida la crea en vez de perderse", () => {
		const { log, one } = setup();
		log.record(toolCalled("huérfana", "c1", "figma_status", {}, 500));
		const session = one<Record<string, unknown>>(
			"SELECT * FROM sessions WHERE id = 'huérfana'",
		);
		assert.equal(session["started_at"], T0 + 500);
		assert.equal(session["pid"], null);
	});

	it("cada evento queda en el registro inmutable con id creciente y su carga intacta", () => {
		const { log, all } = setup();
		const first = sessionStarted(S, 0);
		const second = statusChecked(S, 10);
		log.record(first);
		log.record(second);
		const rows = all<{
			id: number;
			type: string;
			at: number;
			payload: string;
			call_id: string | null;
		}>("SELECT * FROM events ORDER BY id");
		assert.deepEqual(
			rows.map((r) => r.type),
			["session_started", "status_checked"],
		);
		assert.ok((rows[1]?.id ?? 0) > (rows[0]?.id ?? 1));
		assert.deepEqual(JSON.parse(rows[0]?.payload ?? ""), first);
		assert.equal(rows[1]?.at, T0 + 10);
		assert.equal(rows[0]?.call_id, null);
	});
});

describe("SqliteActivityLog: jobs y capturas", () => {
	function launchJob(log: SqliteActivityLog) {
		log.record(
			toolCalled(S, "c1", "figma_run_script", { file: "scripts/largo.js" }, 0),
		);
		log.record(toolFinished(S, "c1", 20000, { jobId: "job-1" }));
	}

	it("una llamada que devuelve jobId sin recibirlo lo lanzó: el job queda en curso", () => {
		const { log, one } = setup();
		launchJob(log);
		const job = one<Record<string, unknown>>(
			"SELECT * FROM jobs WHERE id = 'job-1'",
		);
		assert.equal(job["status"], "running");
		assert.equal(job["call_id"], "c1");
		assert.equal(
			one<{ starts_job: number }>("SELECT starts_job FROM calls").starts_job,
			1,
		);
	});

	it("consultar un job con figma_get_job no crea otro job", () => {
		const { log, one } = setup();
		launchJob(log);
		log.record(toolCalled(S, "c2", "figma_get_job", { jobId: "job-1" }, 30000));
		log.record(toolFinished(S, "c2", 30010, { jobId: "job-1" }));
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM jobs").n, 1);
		assert.equal(
			one<{ s: number }>(
				"SELECT starts_job AS s FROM calls WHERE call_id = 'c2'",
			).s,
			0,
		);
	});

	it("job_finished cierra el job y suma sus nodos a la llamada que lo lanzó", () => {
		const { log, one, all } = setup();
		launchJob(log);
		log.record(
			jobFinished(S, "job-1", 60000, { ms: 40000, touchedNodeIds: ["5:5"] }),
		);
		const job = one<Record<string, unknown>>("SELECT * FROM jobs");
		assert.equal(job["status"], "done");
		assert.equal(job["ms"], 40000);
		assert.deepEqual(JSON.parse(job["touched_json"] as string), ["5:5"]);
		assert.deepEqual(
			all<{ node_id: string }>(
				"SELECT node_id FROM call_nodes WHERE call_id = 'c1'",
			).map((r) => r.node_id),
			["5:5"],
		);
		assert.equal(
			one<{ node_id: string }>("SELECT node_id FROM nodes_touched").node_id,
			"5:5",
		);
	});

	it("un job fallido guarda su error", () => {
		const { log, one } = setup();
		launchJob(log);
		log.record(
			jobFinished(S, "job-1", 60000, {
				ok: false,
				error: scriptError("Se acabó la memoria"),
			}),
		);
		const job = one<Record<string, unknown>>("SELECT * FROM jobs");
		assert.equal(job["status"], "failed");
		assert.equal(job["error_type"], "ScriptError");
		assert.equal(job["error_message"], "Se acabó la memoria");
	});

	it("si el job termina antes de registrar la llamada que lo lanzó, se enlazan igualmente", () => {
		const { log, one } = setup();
		log.record(toolCalled(S, "c1", "figma_run_script", { file: "a.js" }, 0));
		log.record(jobFinished(S, "job-1", 100, { touchedNodeIds: ["7:7"] }));
		log.record(toolFinished(S, "c1", 150, { jobId: "job-1" }));
		const job = one<Record<string, unknown>>("SELECT * FROM jobs");
		assert.equal(job["status"], "done");
		assert.equal(job["call_id"], "c1");
	});

	it("screenshot_saved guarda la captura de la llamada", () => {
		const { log, one } = setup();
		log.record(toolCalled(S, "c1", "figma_screenshot", { nodeId: "1:23" }, 0));
		log.record(screenshotSaved(S, "c1", 40));
		const shot = one<Record<string, unknown>>("SELECT * FROM captures");
		assert.equal(shot["call_id"], "c1");
		assert.equal(shot["node_id"], "1:23");
		assert.equal(shot["path"], "/tmp/out/shot-1.png");
		assert.equal(shot["width"], 800);
		assert.equal(shot["at"], T0 + 40);
	});
});

describe("SqliteActivityLog: toques, cancelados y escrituras", () => {
	it("un lote seguido de dos figma_get_job y un cancel cuenta cada nodo una sola vez", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S));
		log.record(toolCalled(S, "c1", "figma_build", { manifest: "m.json" }, 0));
		log.record(toolFinished(S, "c1", 50, { jobId: "job-1" }));
		log.record(
			jobFinished(S, "job-1", 5000, { touchedNodeIds: ["1:1", "1:2"] }),
		);
		for (const [i, tool] of [
			"figma_get_job",
			"figma_get_job",
			"figma_cancel_job",
		].entries()) {
			const id = `q${i}`;
			log.record(toolCalled(S, id, tool, { jobId: "job-1" }, 6000 + i * 10));
			log.record(
				toolFinished(S, id, 6005 + i * 10, {
					jobId: "job-1",
					touchedNodeIds: ["1:1", "1:2"],
				}),
			);
		}
		const touches = one<{ n: number }>(
			"SELECT touch_count AS n FROM nodes_touched WHERE node_id = '1:1'",
		);
		assert.equal(touches.n, 1);
		assert.equal(
			one<{ n: number }>("SELECT count(*) AS n FROM call_nodes").n,
			2,
		);
	});

	it("un job cancelado sale como job cancelado, no como fallido desconocido", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S));
		log.record(toolCalled(S, "c1", "figma_build", { manifest: "m.json" }, 0));
		log.record(toolFinished(S, "c1", 50, { jobId: "job-1" }));
		log.record(
			jobFinished(S, "job-1", 5000, { ok: true, status: "cancelled" }),
		);
		const call = one<{ summary: string }>(
			"SELECT summary FROM calls WHERE call_id = 'c1'",
		);
		assert.match(call.summary, /job cancelado$/);
		assert.doesNotMatch(call.summary, /fallido/);
	});

	it("writes cuenta al terminar solo lo que ejecutó algo en la pestaña", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S));
		const call = (
			id: string,
			tool: string,
			fin: Parameters<typeof toolFinished>[3],
		) => {
			log.record(toolCalled(S, id, tool, {}, 0));
			log.record(toolFinished(S, id, 10, fin));
		};
		const writes = () =>
			one<{ writes: number }>("SELECT writes FROM sessions").writes;
		log.record(toolCalled(S, "en-curso", "figma_run_script", {}, 0));
		assert.equal(writes(), 0, "una llamada en curso aún no cuenta");
		call("ok", "figma_run_script", {});
		call("script", "figma_run_script", { ok: false, error: scriptError() });
		call("plazo", "figma_run_script", {
			ok: false,
			error: { type: "Timeout", message: "t", nextStep: "n", line: null },
		});
		assert.equal(writes(), 3);
		call("sin-sesion", "figma_run_script", {
			ok: false,
			error: { type: "FigmaNotReady", message: "m", nextStep: "n", line: null },
		});
		call("ruta", "figma_run_script", {
			ok: false,
			error: {
				type: "ScriptReadError",
				message: "m",
				nextStep: "n",
				line: null,
			},
		});
		call("cancel", "figma_cancel_job", { jobId: "job-1" } as never);
		assert.equal(writes(), 3, "ni fallos previos a la pestaña ni cancelar");
		assert.equal(
			one<{ n: number }>("SELECT sum(is_write) AS n FROM calls").n,
			7,
			"is_write sigue clasificando la llamada",
		);
	});
});

describe("SqliteActivityLog: búsqueda de texto (FTS5)", () => {
	function seeded() {
		const s = setup();
		s.log.record(
			toolCalled(
				S,
				"c1",
				"figma_run_script",
				{ file: "scripts/pintar-botones.js" },
				0,
			),
		);
		s.log.record(toolFinished(S, "c1", 10, { touchedNodeIds: ["12:34"] }));
		s.log.record(
			toolCalled(S, "c2", "figma_screenshot", { nodeId: "1:23" }, 20),
		);
		s.log.record(
			toolFinished(S, "c2", 30, {
				ok: false,
				error: scriptError("Nodo no encontrado"),
			}),
		);
		const hits = (q: string) =>
			s
				.all<{ call_id: string }>(
					"SELECT c.call_id FROM calls_fts f JOIN calls c ON c.rowid = f.rowid WHERE calls_fts MATCH ? ORDER BY c.call_id",
					q,
				)
				.map((r) => r.call_id);
		return { ...s, hits };
	}

	it("encuentra por ruta, herramienta, texto de error y id de nodo", () => {
		const { hits } = seeded();
		assert.deepEqual(hits("pintar"), ["c1"]);
		assert.deepEqual(hits("screenshot"), ["c2"]);
		assert.deepEqual(hits("encontrado"), ["c2"]);
		assert.deepEqual(hits('"12 34"'), ["c1"]);
	});

	it("el texto del error de un job también se busca", () => {
		const { log, hits } = seeded();
		log.record(
			toolCalled(S, "c3", "figma_run_script", { file: "scripts/largo.js" }, 40),
		);
		log.record(toolFinished(S, "c3", 20000, { jobId: "j" }));
		log.record(
			jobFinished(S, "j", 30000, {
				ok: false,
				error: scriptError("memoria agotada"),
			}),
		);
		assert.deepEqual(hits("memoria"), ["c3"]);
	});
});

describe("SqliteActivityLog: robustez", () => {
	it("registrar nunca lanza: si la base falla, avisa y sigue", () => {
		const { db, log, warnings } = setup();
		db.$client.close();
		assert.doesNotThrow(() =>
			log.record(toolCalled(S, "c1", "figma_status", {}, 0)),
		);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0] ?? "", /histórico/);
	});
});

describe("SqliteActivityLog: retención", () => {
	it("prune borra lo anterior a la fecha y lo que cuelga, y conserva lo reciente", () => {
		const { log, one } = setup();
		log.record(sessionStarted("vieja", 0));
		log.record(
			toolCalled("vieja", "v1", "figma_screenshot", { nodeId: "1:1" }, 10),
		);
		log.record(toolFinished("vieja", "v1", 20, { touchedNodeIds: ["1:1"] }));
		log.record(screenshotSaved("vieja", "v1", 30, "1:1", "/tmp/v.png"));
		const DAY = 86_400_000;
		log.record(toolCalled("nueva", "n1", "figma_status", {}, 5 * DAY));
		log.record(toolFinished("nueva", "n1", 5 * DAY + 5, {}));
		const result = log.prune(new Date(T0 + DAY));
		assert.equal(result.calls, 1);
		assert.equal(result.sessions, 1);
		assert.ok(result.events >= 4);
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM calls").n, 1);
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM captures").n, 0);
		assert.equal(
			one<{ n: number }>("SELECT count(*) AS n FROM call_nodes").n,
			0,
		);
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM sessions").n, 1);
		assert.equal(
			one<{ n: number }>(
				"SELECT count(*) AS n FROM calls_fts WHERE calls_fts MATCH 'screenshot'",
			).n,
			0,
		);
	});
});

describe("SqliteActivityLog: importación de eventos viejos", () => {
	const OLD = [
		sessionStarted("legado", 0),
		toolCalled(
			"legado",
			"l1",
			"figma_run_script",
			{ file: "scripts/x.js" },
			100,
		),
		toolFinished("legado", "l1", 300, { touchedNodeIds: ["2:2"] }),
	];

	it("importa conservando la hora original de cada evento", () => {
		const { log, one } = setup();
		const outcome = log.importOnce("activity.jsonl", OLD);
		assert.deepEqual(outcome, { status: "imported", events: 3 });
		const call = one<Record<string, unknown>>(
			"SELECT * FROM calls WHERE call_id = 'l1'",
		);
		assert.equal(call["started_at"], T0 + 100);
		assert.equal(call["status"], "ok");
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM events").n, 3);
	});

	it("repetir la importación con la misma clave no duplica nada", () => {
		const { log, one } = setup();
		log.importOnce("activity.jsonl", OLD);
		assert.deepEqual(log.importOnce("activity.jsonl", OLD), {
			status: "already-imported",
		});
		assert.equal(one<{ n: number }>("SELECT count(*) AS n FROM events").n, 3);
		assert.equal(
			one<{ calls: number }>("SELECT calls FROM sessions WHERE id = 'legado'")
				.calls,
			1,
		);
	});

	it("otra clave sí importa", () => {
		const { log } = setup();
		log.importOnce("a", OLD);
		assert.equal(
			log.importOnce("b", [OLD[0] as (typeof OLD)[number]]).status,
			"imported",
		);
	});
});

describe("SqliteActivityLog: pasos de un lote (build_steps)", () => {
	type StepRow = {
		job_id: string;
		step_index: number;
		file: string;
		status: string;
		ms: number | null;
		touched_count: number;
		error_type: string | null;
		error_message: string | null;
		next_step: string | null;
		error_line: number | null;
		warning: string | null;
		result_json: string | null;
		result_path: string | null;
		result_bytes: number | null;
	};

	it("build_step_finished crea una fila por paso con su estado, duración y nodos", () => {
		const { log, all } = setup();
		log.record(sessionStarted(S));
		log.record(
			buildStepFinished(S, "job-1", 100, {
				index: 0,
				file: "build_home.js",
				status: "done",
				ms: 320,
				touchedCount: 4,
			}),
		);
		log.record(
			buildStepFinished(S, "job-1", 200, {
				index: 1,
				file: "swap.js",
				status: "failed",
				ms: 50,
				error: scriptError("Boom"),
			}),
		);
		const rows = all<StepRow>(
			"SELECT * FROM build_steps WHERE job_id = 'job-1' ORDER BY step_index",
		);
		assert.equal(rows.length, 2);
		assert.equal(rows[0]?.file, "build_home.js");
		assert.equal(rows[0]?.status, "done");
		assert.equal(rows[0]?.ms, 320);
		assert.equal(rows[0]?.touched_count, 4);
		assert.equal(rows[1]?.status, "failed");
		assert.equal(rows[1]?.error_type, "ScriptError");
		assert.equal(rows[1]?.error_message, "Boom");
	});

	it("el mismo paso reportado dos veces se actualiza en su sitio (gana el último)", () => {
		const { log, all } = setup();
		log.record(sessionStarted(S));
		log.record(
			buildStepFinished(S, "job-1", 100, { index: 0, status: "done", ms: 10 }),
		);
		log.record(
			buildStepFinished(S, "job-1", 200, {
				index: 0,
				status: "failed",
				ms: 99,
				error: scriptError("Reventó"),
			}),
		);
		const rows = all<StepRow>(
			"SELECT * FROM build_steps WHERE job_id = 'job-1'",
		);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.status, "failed");
		assert.equal(rows[0]?.ms, 99);
		assert.equal(rows[0]?.error_message, "Reventó");
	});

	it("el resultado en línea queda en result_json; el de fichero, en result_path y result_bytes; sin resultado, NULL", () => {
		const { log, all } = setup();
		log.record(sessionStarted(S));
		log.record(
			buildStepFinished(S, "job-1", 100, {
				index: 0,
				result: { kind: "inline", json: '{"log":["a"]}' },
			}),
		);
		log.record(
			buildStepFinished(S, "job-1", 110, {
				index: 1,
				result: { kind: "file", path: "/salida/r.json", bytes: 90_000 },
			}),
		);
		log.record(buildStepFinished(S, "job-1", 120, { index: 2 }));
		const rows = all<StepRow>(
			"SELECT * FROM build_steps WHERE job_id = 'job-1' ORDER BY step_index",
		);
		assert.deepEqual(
			rows.map((r) => [r.result_json, r.result_path, r.result_bytes]),
			[
				['{"log":["a"]}', null, null],
				[null, "/salida/r.json", 90_000],
				[null, null, null],
			],
		);
	});

	it("un aviso de un paso sin nodos queda en warning, sin error", () => {
		const { log, all } = setup();
		log.record(sessionStarted(S));
		log.record(
			buildStepFinished(S, "job-1", 100, {
				index: 0,
				status: "done",
				warning: "El paso terminó sin declarar nodos.",
			}),
		);
		const rows = all<StepRow>(
			"SELECT * FROM build_steps WHERE job_id = 'job-1'",
		);
		assert.equal(rows[0]?.warning, "El paso terminó sin declarar nodos.");
		assert.equal(rows[0]?.error_type, null);
	});

	it("el estado final de un lote cancelado se proyecta a jobs.status", () => {
		const { log, one } = setup();
		log.record(sessionStarted(S));
		log.record(toolCalled(S, "c1", "figma_build", { manifest: "m.json" }, 0));
		log.record(toolFinished(S, "c1", 50, { jobId: "job-1" }));
		log.record(
			jobFinished(S, "job-1", 5000, { ok: true, status: "cancelled" }),
		);
		const job = one<{ status: string }>(
			"SELECT status FROM jobs WHERE id = 'job-1'",
		);
		assert.equal(job.status, "cancelled");
	});

	it("un lote rápido (job_finished ANTES de tool_finished) queda terminal y enlazado, no running", () => {
		const { log, one, all } = setup();
		// Orden real de un lote que termina dentro del plazo: la llamada, sus pasos, el cierre del job y, por
		// último, tool_finished (que lo emite `track` al devolver la herramienta). tool_finished NO debe pisar
		// el estado terminal; la fila jobs queda `done` y enlazada a la llamada, y los pasos cuelgan del job.
		log.record(sessionStarted(S));
		log.record(toolCalled(S, "c1", "figma_build", { manifest: "m.json" }, 0));
		log.record(
			buildStepFinished(S, "job-1", 10, {
				index: 0,
				file: "build_home.js",
				status: "done",
				ms: 8,
				touchedCount: 2,
			}),
		);
		log.record(
			jobFinished(S, "job-1", 20, { ok: true, touchedNodeIds: ["1:1", "1:2"] }),
		);
		log.record(toolFinished(S, "c1", 25, { jobId: "job-1" }));

		const job = one<Record<string, unknown>>(
			"SELECT * FROM jobs WHERE id = 'job-1'",
		);
		assert.equal(job["status"], "done"); // terminal, no "running"
		assert.equal(job["call_id"], "c1"); // enlazado con la llamada
		const call = one<Record<string, unknown>>(
			"SELECT * FROM calls WHERE call_id = 'c1'",
		);
		assert.equal(call["job_id"], "job-1"); // trazabilidad call.jobId → build_steps.job_id
		const steps = all<{ step_index: number }>(
			"SELECT step_index FROM build_steps WHERE job_id = ?",
			call["job_id"],
		);
		assert.deepEqual(
			steps.map((r) => r.step_index),
			[0],
		);
	});
});

describe("SqliteActivityLog: jobs interrumpidos", () => {
	const REASON = "interrumpido";
	const AT = new Date(T0 + 90_000);
	// Un job en marcha de una sesión con ese pid
	const runningJob = (
		log: SqliteActivityLog,
		session: string,
		jobId: string,
		pid: number | null,
		run: <R>(sql: string, ...args: unknown[]) => R,
	) => {
		log.record(sessionStarted(session));
		log.record(toolCalled(session, `c-${jobId}`, "figma_build", {}, 100));
		log.record(toolFinished(session, `c-${jobId}`, 200, { jobId }));
		run("UPDATE sessions SET pid = ? WHERE id = ?", pid, session);
	};
	const statusOf = (
		one: <T>(sql: string, ...args: unknown[]) => T,
		jobId: string,
	) =>
		one<{
			status: string;
			error_type: string | null;
			error_message: string | null;
		}>(
			"SELECT status, error_type, error_message FROM jobs WHERE id = ?",
			jobId,
		);

	it("interruptSessionJobs cierra como failed, con motivo, los jobs en marcha de esa sesión y solo esos", () => {
		const { log, one, db } = setup();
		const run = (sql: string, ...args: unknown[]) =>
			db.$client.prepare(sql).run(...args) as never;
		runningJob(log, "mia", "job-mio", 1, run);
		runningJob(log, "otra", "job-otro", 2, run);
		log.record(jobFinished("mia", "job-hecho", 300, { ok: true }));

		assert.equal(log.interruptSessionJobs("mia", REASON, AT), 1);

		const mine = statusOf(one, "job-mio");
		assert.deepEqual(
			[mine.status, mine.error_type, mine.error_message],
			["failed", "Interrupted", REASON],
		);
		assert.equal(statusOf(one, "job-otro").status, "running");
		assert.equal(statusOf(one, "job-hecho").status, "done");
	});

	it("un paso en curso de un job interrumpido pasa a failed", () => {
		const { log, one, db } = setup();
		const run = (sql: string, ...args: unknown[]) =>
			db.$client.prepare(sql).run(...args) as never;
		runningJob(log, "mia", "job-mio", 1, run);
		log.record(
			buildStepFinished("mia", "job-mio", 150, {
				index: 0,
				status: "running",
				ms: null,
			}),
		);
		log.record(
			buildStepFinished("mia", "job-mio", 150, {
				index: 1,
				status: "pending",
				ms: null,
			}),
		);
		log.interruptSessionJobs("mia", REASON, AT);
		const rows = db.$client
			.prepare(
				"SELECT status FROM build_steps WHERE job_id = 'job-mio' ORDER BY step_index",
			)
			.all() as { status: string }[];
		assert.deepEqual(
			rows.map((r) => r.status),
			["failed", "pending"],
		);
		assert.ok(one("SELECT 1 FROM jobs WHERE id = 'job-mio'"));
	});

	it("interruptDeadSessionJobs cierra los de sesiones muertas y nunca los de una viva ni los propios", () => {
		const { log, one, db } = setup();
		const run = (sql: string, ...args: unknown[]) =>
			db.$client.prepare(sql).run(...args) as never;
		runningJob(log, "propia", "job-propio", 10, run);
		runningJob(log, "viva", "job-vivo", 11, run);
		runningJob(log, "muerta", "job-muerto", 12, run);
		runningJob(log, "sin-pid", "job-sin-pid", null, run);

		const closed = log.interruptDeadSessionJobs({
			ownSessionId: "propia",
			isAlive: (pid) => pid === 10 || pid === 11,
			reason: REASON,
			at: AT,
		});

		assert.equal(closed, 2);
		assert.equal(statusOf(one, "job-muerto").status, "failed");
		assert.equal(statusOf(one, "job-sin-pid").status, "failed");
		assert.equal(statusOf(one, "job-vivo").status, "running");
		assert.equal(statusOf(one, "job-propio").status, "running");
	});
});
