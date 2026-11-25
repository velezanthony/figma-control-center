import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { CallsQuery, ResolvedRange } from "#domain/history.ts";
import { SqliteActivityLog } from "./sqlite-activity-log.ts";
import { SqliteHistoryQuery } from "./sqlite-history-query.ts";
import {
	at,
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
	dir = await mkdtemp(join(tmpdir(), "figma-hq-"));
});
after(() => rm(dir, { recursive: true, force: true }));

const A = "sesion-a";
const B = "sesion-b";
const ALL: ResolvedRange = { fromMs: null, toMs: null, sessionId: null };
const timeout = {
	type: "CallTimeout",
	message: "Se agotó el plazo",
	nextStep: "Trocea el script.",
	line: null,
};

// Ocho llamadas en dos sesiones: ok, captura, error, job terminado, job fallido, job en curso, status y get_job sin terminar
function seed() {
	const file = join(dir, `q${++n}.db`);
	const log = new SqliteActivityLog({
		projectId: PROJECT_ID,
		db: openTestDb(file),
		warn: (m) => assert.fail(m),
	});
	const run = (
		s: string,
		id: string,
		tool: string,
		args: Record<string, string | number>,
		start: number,
		end: number | null,
		fin: Parameters<typeof toolFinished>[3] = {},
	) => {
		log.record(toolCalled(s, id, tool, args, start));
		if (end !== null) log.record(toolFinished(s, id, end, fin));
	};
	log.record(sessionStarted(A, 0));
	run(A, "c1", "figma_run_script", { file: "scripts/pintar.js" }, 1000, 1200, {
		ms: 200,
		touchedNodeIds: ["1:1", "1:2"],
	});
	run(A, "c2", "figma_screenshot", { nodeId: "1:1" }, 2000, 2100, {
		ms: 100,
		touchedNodeIds: ["1:1"],
	});
	log.record(screenshotSaved(A, "c2", 2050, "1:1", "/out/s1.png"));
	run(A, "c3", "figma_run_script", { file: "scripts/rota.js" }, 3000, 3050, {
		ms: 50,
		ok: false,
		error: scriptError("Boom"),
	});
	run(A, "c4", "figma_run_script", { file: "scripts/largo.js" }, 4000, 4500, {
		ms: 500,
		jobId: "job-1",
	});
	log.record(
		jobFinished(A, "job-1", 60_000, { ms: 55_000, touchedNodeIds: ["1:3"] }),
	);
	run(A, "c5", "figma_run_script", { file: "scripts/largo2.js" }, 5000, 5500, {
		ms: 500,
		jobId: "job-2",
	});
	log.record(
		jobFinished(A, "job-2", 70_000, { ok: false, ms: 65_000, error: timeout }),
	);
	log.record(statusChecked(A, 6000));
	log.record(
		sessionStarted(B, 10_000, "https://www.figma.com/design/xyz/Otro"),
	);
	run(B, "c6", "figma_status", {}, 11_000, 11_100, { ms: 100 });
	run(B, "c7", "figma_get_job", { jobId: "job-1" }, 12_000, null);
	run(
		B,
		"c8",
		"figma_run_script",
		{ file: "scripts/encurso.js" },
		13_000,
		13_100,
		{ ms: 100, jobId: "job-3" },
	);
	return new SqliteHistoryQuery({
		projectId: PROJECT_ID,
		db: openTestDb(file, { queryOnly: true }),
	});
}

const query = (over: Partial<CallsQuery> = {}): CallsQuery => ({
	range: ALL,
	tool: null,
	status: "all",
	search: "",
	jobsOnly: false,
	sort: { key: "time", dir: "desc" },
	page: 1,
	perPage: 25,
	locate: null,
	...over,
});
const ids = (q: SqliteHistoryQuery, over: Partial<CallsQuery> = {}) =>
	q.calls(query(over)).items.map((c) => c.callId);

describe("SqliteHistoryQuery.summary", () => {
	it("writes no cuenta las llamadas que no ejecutaron nada en la pestaña ni figma_cancel_job", () => {
		const file = join(dir, `q${++n}.db`);
		const log = new SqliteActivityLog({
			projectId: PROJECT_ID,
			db: openTestDb(file),
			warn: (m) => assert.fail(m),
		});
		log.record(sessionStarted(A, 0));
		const run = (
			id: string,
			tool: string,
			fin: Parameters<typeof toolFinished>[3],
		) => {
			log.record(toolCalled(A, id, tool, {}, 10));
			log.record(toolFinished(A, id, 20, fin));
		};
		run("a", "figma_run_script", {});
		run("b", "figma_run_script", {
			ok: false,
			error: { type: "FigmaNotReady", message: "m", nextStep: "n", line: null },
		});
		run("c", "figma_cancel_job", {});
		const q = new SqliteHistoryQuery({
			projectId: PROJECT_ID,
			db: openTestDb(file, { queryOnly: true }),
		});
		assert.equal(q.summary(ALL, 10).writes, 1);
	});

	it("cuenta llamadas, escrituras, errores (también de jobs), en curso, jobs y nodos distintos", () => {
		const s = seed().summary(ALL, 10);
		assert.equal(s.calls, 8);
		assert.equal(s.writes, 5);
		assert.equal(s.errors, 2);
		assert.equal(s.running, 2);
		assert.equal(s.jobs, 3);
		assert.equal(s.nodesTouched, 3);
	});

	it("la duración media y el p95 se calculan sobre las llamadas terminadas, sin redondear", () => {
		const s = seed().summary(ALL, 10);
		assert.equal(s.meanMs, 1550 / 7);
		assert.equal(s.p95Ms, 500);
	});

	it("las herramientas más usadas llevan llamadas y errores, y el tope las corta", () => {
		const q = seed();
		assert.deepEqual(q.summary(ALL, 10).topTools[0], {
			tool: "figma_run_script",
			calls: 5,
			errors: 2,
		});
		assert.equal(q.summary(ALL, 1).topTools.length, 1);
	});

	it("un rango por tiempo o por sesión acota todo", () => {
		const q = seed();
		assert.equal(q.summary({ ...ALL, fromMs: T0 + 10_000 }, 10).calls, 3);
		assert.equal(q.summary({ ...ALL, sessionId: B }, 10).calls, 3);
		assert.equal(
			q.summary({ ...ALL, fromMs: T0 + 2000, toMs: T0 + 3000 }, 10).calls,
			2,
		);
		assert.equal(
			q.summary({ ...ALL, sessionId: B, fromMs: T0 + 12_500 }, 10).calls,
			1,
		);
	});

	it("una base sin datos devuelve ceros y null, no falla", () => {
		const q = new SqliteHistoryQuery({
			projectId: PROJECT_ID,
			db: openTestDb(join(dir, "vacia.db")),
		});
		const s = q.summary(ALL, 10);
		assert.deepEqual(
			[s.calls, s.errors, s.meanMs, s.p95Ms, s.topTools.length],
			[0, 0, null, null, 0],
		);
	});
});

describe("SqliteHistoryQuery.errors", () => {
	it("agrupa por tipo, con el siguiente paso y ejemplos; incluye los jobs fallidos", () => {
		const e = seed().errors(ALL, 10);
		assert.equal(e.total, 2);
		const types = e.items.map((g) => g.type).sort();
		assert.deepEqual(types, ["CallTimeout", "ScriptError"]);
		const script = e.items.find((g) => g.type === "ScriptError");
		assert.equal(script?.count, 1);
		assert.equal(script?.nextStep, "Corrige el script y vuelve a ejecutarlo.");
		assert.equal(script?.examples[0]?.callId, "c3");
		assert.equal(script?.examples[0]?.message, "Boom");
		assert.equal(script?.examples[0]?.tool, "figma_run_script");
		const job = e.items.find((g) => g.type === "CallTimeout");
		assert.equal(job?.examples[0]?.callId, "c5");
	});

	it("respeta el límite y el total dice cuántos grupos había", () => {
		const e = seed().errors(ALL, 1);
		assert.equal(e.items.length, 1);
		assert.equal(e.total, 2);
	});
});

describe("SqliteHistoryQuery.nodes y sessions", () => {
	it("nodos tocados: veces, última llamada y herramienta, lo más reciente primero", () => {
		const nodes = seed().nodes(ALL, 10);
		assert.deepEqual(
			nodes.items.map((x) => x.nodeId),
			["1:3", "1:1", "1:2"],
		);
		const first = nodes.items.find((x) => x.nodeId === "1:1");
		assert.equal(first?.touches, 2);
		assert.equal(first?.lastCallId, "c2");
		assert.equal(first?.lastTool, "figma_screenshot");
		assert.equal(first?.lastAt, at(2000));
		assert.equal(nodes.total, 3);
	});

	it("nodos de una sola sesión", () => {
		assert.equal(seed().nodes({ ...ALL, sessionId: B }, 10).total, 0);
	});

	it("sesiones: contadores, y primero la que estuvo activa más recientemente", () => {
		const s = seed().sessions(ALL, 10);
		// La A terminó su último job (a los 70 s) después de la última llamada de la B
		assert.deepEqual(
			s.items.map((x) => x.sessionId),
			[A, B],
		);
		const a = s.items.find((x) => x.sessionId === A);
		assert.equal(a?.calls, 5);
		assert.equal(a?.writes, 4);
		assert.equal(a?.errors, 1);
		assert.equal(a?.startedAt, at(0));
		const b = s.items.find((x) => x.sessionId === B);
		assert.equal(b?.fileUrl, "https://www.figma.com/design/xyz/Otro");
		assert.equal(b?.pid, 4242);
	});
});

describe("SqliteHistoryQuery.calls: la tabla del panel", () => {
	it("por defecto, la hora descendente y el total", () => {
		const page = seed().calls(query());
		assert.deepEqual(
			page.items.map((c) => c.callId),
			["c8", "c7", "c6", "c5", "c4", "c3", "c2", "c1"],
		);
		assert.equal(page.total, 8);
		assert.equal(page.page, 1);
	});

	it("cada fila trae sus nodos, su error, su job y sus capturas", () => {
		const q = seed();
		const by = (id: string) =>
			q.calls(query()).items.find((c) => c.callId === id);
		assert.deepEqual(by("c1")?.touchedNodeIds.slice().sort(), ["1:1", "1:2"]);
		assert.equal(
			by("c1")?.summary,
			"figma_run_script scripts/pintar.js → 2 nodos, 200 ms",
		);
		assert.equal(by("c1")?.startedAt, at(1000));
		assert.equal(by("c3")?.status, "error");
		assert.equal(by("c3")?.error?.type, "ScriptError");
		assert.equal(by("c3")?.error?.line, 3);
		assert.equal(by("c2")?.screenshots[0]?.path, "/out/s1.png");
		const withJob = by("c4");
		assert.equal(withJob?.job?.status, "done");
		assert.equal(withJob?.job?.ms, 55_000);
		assert.deepEqual(withJob?.job?.touchedNodeIds, ["1:3"]);
		assert.deepEqual(withJob?.touchedNodeIds, []);
		assert.equal(by("c5")?.job?.error?.type, "CallTimeout");
		assert.equal(by("c8")?.job?.status, "running");
		assert.equal(by("c6")?.job, null);
		assert.equal(by("c7")?.status, "running");
		assert.deepEqual(by("c1")?.args, { file: "scripts/pintar.js" });
		assert.equal(by("c1")?.fileUrl, "https://www.figma.com/design/abc/Archivo");
		assert.equal(by("c6")?.fileUrl, "https://www.figma.com/design/xyz/Otro");
	});

	it("filtra por herramienta y por estado (el error incluye jobs fallidos; en curso, jobs sin terminar)", () => {
		const q = seed();
		assert.deepEqual(ids(q, { tool: "figma_status" }), ["c6"]);
		assert.deepEqual(ids(q, { status: "error" }), ["c5", "c3"]);
		assert.deepEqual(ids(q, { status: "running" }), ["c8", "c7"]);
		assert.deepEqual(ids(q, { status: "ok" }), ["c6", "c4", "c2", "c1"]);
	});

	it("filtra por rango de tiempo y por sesión", () => {
		const q = seed();
		assert.deepEqual(ids(q, { range: { ...ALL, sessionId: B } }), [
			"c8",
			"c7",
			"c6",
		]);
		assert.deepEqual(
			ids(q, { range: { ...ALL, fromMs: T0 + 2000, toMs: T0 + 4000 } }),
			["c4", "c3", "c2"],
		);
	});

	it("jobsOnly devuelve solo los que lanzaron un job, los que siguen en curso primero", () => {
		assert.deepEqual(ids(seed(), { jobsOnly: true }), ["c8", "c5", "c4"]);
	});

	it("ordena por herramienta, duración (los sin duración siempre al final), estado y nodos", () => {
		const q = seed();
		assert.deepEqual(
			ids(q, { sort: { key: "duration", dir: "asc" } }).slice(0, 2),
			["c3", "c8"],
		);
		assert.deepEqual(
			ids(q, { sort: { key: "duration", dir: "asc" } }).at(-1),
			"c7",
		);
		assert.equal(
			ids(q, { sort: { key: "duration", dir: "desc" } }).at(-1),
			"c7",
		);
		assert.equal(ids(q, { sort: { key: "tool", dir: "asc" } })[0], "c7");
		assert.equal(ids(q, { sort: { key: "status", dir: "asc" } })[0], "c5");
		assert.equal(ids(q, { sort: { key: "nodes", dir: "desc" } })[0], "c1");
	});

	it("pagina en la base: página, tamaño y total; una página fuera de rango cae en la última", () => {
		const q = seed();
		const second = q.calls(query({ perPage: 3, page: 2 }));
		assert.deepEqual(
			second.items.map((c) => c.callId),
			["c5", "c4", "c3"],
		);
		assert.equal(second.total, 8);
		const beyond = q.calls(query({ perPage: 3, page: 99 }));
		assert.equal(beyond.page, 3);
		assert.deepEqual(
			beyond.items.map((c) => c.callId),
			["c2", "c1"],
		);
	});

	it("locate devuelve la página que contiene esa llamada con los filtros y el orden dados", () => {
		const q = seed();
		assert.equal(q.calls(query({ perPage: 3, locate: "c1" })).page, 3);
		assert.equal(q.calls(query({ perPage: 3, locate: "c8" })).page, 1);
		assert.equal(
			q.calls(query({ perPage: 3, locate: "c3", status: "error" })).page,
			1,
		);
		assert.equal(
			q.calls(query({ perPage: 3, locate: "no-existe", page: 2 })).page,
			2,
		);
	});

	it("la búsqueda de texto encuentra por ruta, herramienta, error y nodo (de la llamada o de su job)", () => {
		const q = seed();
		assert.deepEqual(ids(q, { search: "pintar" }), ["c1"]);
		assert.deepEqual(ids(q, { search: "scripts/rota.js" }), ["c3"]);
		assert.deepEqual(ids(q, { search: "screenshot" }), ["c2"]);
		assert.deepEqual(ids(q, { search: "boom" }), ["c3"]);
		assert.deepEqual(ids(q, { search: "1:3" }), ["c4"]);
		assert.deepEqual(ids(q, { search: "plazo" }), ["c5"]);
		assert.deepEqual(ids(q, { search: "figma_run_script rota" }), ["c3"]);
		assert.equal(q.calls(query({ search: "pintar" })).total, 1);
	});

	it("la búsqueda por prefijo y los caracteres especiales de FTS5 no rompen la consulta", () => {
		const q = seed();
		assert.deepEqual(ids(q, { search: "pint" }), ["c1"]);
		for (const text of [
			'"',
			"'",
			"a OR",
			"(",
			"*",
			"NEAR(",
			"-x",
			"x:y",
			"}{",
			"scripts/",
		]) {
			assert.doesNotThrow(() => q.calls(query({ search: text })), text);
		}
		assert.deepEqual(ids(q, { search: "!!!" }), ids(q, { search: "" }));
	});
});

describe("SqliteHistoryQuery: call, captures y estado", () => {
	it("call(id) devuelve la llamada completa o null", () => {
		const q = seed();
		assert.equal(q.call("c4")?.job?.status, "done");
		assert.equal(
			q.call("c4")?.summary,
			"figma_run_script scripts/largo.js → 1 nodo, 500 ms · job terminado",
		);
		assert.equal(q.call("nope"), null);
	});

	it("captures: la más reciente primero, con su llamada", () => {
		const page = seed().captures(1, 10);
		assert.equal(page.total, 1);
		assert.equal(page.items[0]?.shot.path, "/out/s1.png");
		assert.equal(page.items[0]?.call.callId, "c2");
	});

	it("lastStatus: el último status_checked, o null", () => {
		const status = seed().lastStatus();
		assert.equal(status?.fileName, "Archivo");
		assert.equal(status?.figmaReady, true);
		assert.equal(status?.at, at(6000));
		const q = new SqliteHistoryQuery({
			projectId: PROJECT_ID,
			db: openTestDb(join(dir, "sin-status.db")),
		});
		assert.equal(q.lastStatus(), null);
	});
});

describe("SqliteHistoryQuery.steps: pasos de un lote", () => {
	function withSteps() {
		const file = join(dir, `qs${++n}.db`);
		const log = new SqliteActivityLog({
			projectId: PROJECT_ID,
			db: openTestDb(file),
			warn: (m) => assert.fail(m),
		});
		log.record(sessionStarted(A, 0));
		log.record(
			buildStepFinished(A, "job-1", 300, {
				index: 1,
				file: "swap.js",
				status: "done",
				ms: 40,
				touchedCount: 2,
				result: { kind: "inline", json: '{"log":["a","b"]}' },
			}),
		);
		log.record(
			buildStepFinished(A, "job-1", 100, {
				index: 0,
				file: "build_home.js",
				status: "failed",
				ms: 10,
				error: scriptError("Boom"),
			}),
		);
		log.record(
			buildStepFinished(A, "job-2", 100, {
				index: 0,
				result: { kind: "file", path: "/salida/r.json", bytes: 90_000 },
			}),
		);
		return new SqliteHistoryQuery({
			projectId: PROJECT_ID,
			db: openTestDb(file, { queryOnly: true }),
		});
	}

	it("devuelve los pasos de un job ordenados por índice", () => {
		const steps = withSteps().steps("job-1");
		assert.deepEqual(
			steps.map((s) => s.index),
			[0, 1],
		);
		assert.equal(steps[0]?.file, "build_home.js");
		assert.equal(steps[0]?.status, "failed");
		assert.equal(steps[0]?.error?.message, "Boom");
		assert.equal(steps[1]?.file, "swap.js");
		assert.equal(steps[1]?.touchedCount, 2);
		assert.equal(steps[1]?.error, null);
	});

	it("devuelve el resultado de cada paso: el JSON en línea ya leído, la ruta del fichero o null", () => {
		const query = withSteps();
		const steps = query.steps("job-1");
		assert.equal(steps[0]?.result, null);
		assert.deepEqual(steps[1]?.result, {
			kind: "inline",
			value: { log: ["a", "b"] },
		});
		assert.deepEqual(query.steps("job-2")[0]?.result, {
			kind: "file",
			path: "/salida/r.json",
			bytes: 90_000,
		});
	});

	it("un job sin pasos (o de script) devuelve una lista vacía", () => {
		assert.deepEqual(withSteps().steps("job-fantasma"), []);
	});
});
