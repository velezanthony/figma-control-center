import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttemptItem } from "#domain/attempt.ts";
import type { CallItem, ErrorGroup, StoredBuildStep } from "#domain/history.ts";
import { createHistory } from "./history.ts";
import { InMemoryHistoryQuery } from "./testing/in-memory-history-query.ts";

const NOW = new Date(2026, 5, 1, 15, 30, 0);
const MAX_ROWS = 50;

function setup(stepExcerptBytes?: number) {
	const query = new InMemoryHistoryQuery();
	const history = createHistory({
		query,
		now: () => NOW,
		maxRows: MAX_ROWS,
		...(stepExcerptBytes !== undefined && { stepExcerptBytes }),
	});
	return { query, history };
}

const call = (callId: string): CallItem => ({
	callId,
	sessionId: "s",
	fileUrl: null,
	tool: "figma_status",
	startedAt: "2026-06-01T10:00:00.000Z",
	args: {},
	status: "ok",
	ms: 10,
	retryable: null,
	touchedNodeIds: [],
	error: null,
	resultPath: null,
	jobId: null,
	job: null,
	screenshots: [],
	summary: "figma_status → ok, 10 ms",
});

const group = (type: string): ErrorGroup => ({
	type,
	count: 1,
	lastAt: "2026-06-01T10:00:00.000Z",
	nextStep: null,
	examples: [],
});

describe("createHistory: summarize", () => {
	it("resuelve el rango y pide al puerto el resumen con el tope de herramientas", () => {
		const { query, history } = setup();
		const r = history.summarize({ preset: "last_hour", sessionId: "abc" });
		assert.ok(r.ok);
		assert.equal(query.summaryCalls.length, 1);
		assert.equal(query.summaryCalls[0]?.range.sessionId, "abc");
		assert.equal(
			query.summaryCalls[0]?.range.fromMs,
			NOW.getTime() - 3_600_000,
		);
		assert.equal(query.summaryCalls[0]?.topTools, 10);
	});

	it("un rango inválido es un error de uso y no toca el puerto", () => {
		const { query, history } = setup();
		const r = history.summarize({ since: "ayer" });
		assert.ok(!r.ok);
		assert.equal(r.error.type, "InvalidRange");
		assert.equal(query.summaryCalls.length, 0);
	});
});

describe("createHistory: errores, nodos y sesiones", () => {
	it("el límite por defecto es 20 y nunca pasa del tope de filas", () => {
		const { query, history } = setup();
		history.errors();
		history.errors({}, 10_000);
		history.errors({}, 5);
		assert.deepEqual(
			query.errorsCalls.map((c) => c.limit),
			[20, MAX_ROWS, 5],
		);
	});

	it("dice el total y si se cortó por el tope", () => {
		const { query, history } = setup();
		query.errorsReply = { items: [group("A"), group("B")], total: 7 };
		const r = history.errors({}, 2);
		assert.ok(r.ok);
		assert.equal(r.value.total, 7);
		assert.equal(r.value.items.length, 2);
		assert.equal(r.value.truncated, true);
		query.errorsReply = { items: [group("A")], total: 1 };
		const all = history.errors();
		assert.ok(all.ok && !all.value.truncated);
	});

	it("nodos y sesiones usan el mismo rango y el mismo tope", () => {
		const { query, history } = setup();
		history.nodesTouched({ sessionId: "s1" }, 3);
		history.sessions({ preset: "today" }, 1_000);
		assert.equal(query.nodesCalls[0]?.limit, 3);
		assert.equal(query.nodesCalls[0]?.range.sessionId, "s1");
		assert.equal(query.sessionsCalls[0]?.limit, MAX_ROWS);
	});
});

describe("createHistory: search", () => {
	it("una búsqueda vacía o en blanco es un error de uso", () => {
		const { query, history } = setup();
		for (const text of ["", "   "]) {
			const r = history.search({ query: text });
			assert.ok(!r.ok);
			assert.equal(r.error.type, "EmptyQuery");
		}
		assert.equal(query.callsCalls.length, 0);
	});

	it("busca por texto, lo más reciente primero, con el rango y el límite acotado", () => {
		const { query, history } = setup();
		query.callsReply = { items: [call("a")], total: 9, page: 1, perPage: 20 };
		const r = history.search({
			query: "  pintar  ",
			range: { preset: "today" },
			limit: 1_000,
		});
		assert.ok(r.ok);
		const sent = query.callsCalls[0];
		assert.equal(sent?.search, "pintar");
		assert.deepEqual(sent?.sort, { key: "time", dir: "desc" });
		assert.equal(sent?.perPage, MAX_ROWS);
		assert.equal(sent?.page, 1);
		assert.equal(sent?.status, "all");
		assert.equal(r.value.total, 9);
		assert.equal(r.value.truncated, true);
	});
});

describe("createHistory: call", () => {
	it("devuelve la llamada o un NotFound que nombra el id", () => {
		const { query, history } = setup();
		const missing = history.call("nope");
		assert.ok(!missing.ok);
		assert.equal(missing.error.type, "NotFound");
		assert.match(missing.error.message, /nope/);
		query.callReply = call("yes");
		const found = history.call("yes");
		assert.ok(found.ok);
		assert.equal(found.value.callId, "yes");
	});
});

describe("createHistory: list (la tabla del panel)", () => {
	it("aplica los valores por defecto: orden por hora descendente, página 1 y 25 por página", () => {
		const { query, history } = setup();
		history.list({});
		assert.deepEqual(query.callsCalls[0], {
			range: { fromMs: null, toMs: null, sessionId: null },
			tool: null,
			status: "all",
			search: "",
			jobsOnly: false,
			sort: { key: "time", dir: "desc" },
			page: 1,
			perPage: 25,
			locate: null,
		});
	});

	it("pasa filtros, orden y localización tal cual y acota página y tamaño", () => {
		const { query, history } = setup();
		history.list({
			tool: "figma_status",
			status: "error",
			search: "boom",
			jobsOnly: true,
			sort: { key: "duration", dir: "asc" },
			page: -3,
			perPage: 9_999,
			locate: "abc",
			range: { sessionId: "s1" },
		});
		const sent = query.callsCalls[0];
		assert.equal(sent?.tool, "figma_status");
		assert.equal(sent?.status, "error");
		assert.equal(sent?.search, "boom");
		assert.equal(sent?.jobsOnly, true);
		assert.deepEqual(sent?.sort, { key: "duration", dir: "asc" });
		assert.equal(sent?.page, 1);
		assert.equal(sent?.perPage, MAX_ROWS);
		assert.equal(sent?.locate, "abc");
		assert.equal(sent?.range.sessionId, "s1");
	});

	it("devuelve la página que dijo el puerto y marca truncated solo si se acortó el tamaño", () => {
		const { query, history } = setup();
		query.callsReply = { items: [call("a")], total: 120, page: 3, perPage: 25 };
		const normal = history.list({ perPage: 25 });
		assert.ok(normal.ok);
		assert.equal(normal.value.page, 3);
		assert.equal(normal.value.total, 120);
		assert.equal(normal.value.truncated, false);
		const clipped = history.list({ perPage: 10_000 });
		assert.ok(clipped.ok && clipped.value.truncated);
	});
});

describe("createHistory: captures", () => {
	it("acota el tamaño de página y devuelve el total", () => {
		const { query, history } = setup();
		query.capturesReply = { items: [], total: 4 };
		const r = history.captures(2, 10_000);
		assert.deepEqual(query.capturesCalls[0], { page: 2, perPage: MAX_ROWS });
		assert.equal(r.total, 4);
		assert.equal(r.page, 2);
	});
});

describe("createHistory: status", () => {
	it("devuelve el último estado de la conexión que conoce el histórico", () => {
		const { query, history } = setup();
		assert.equal(history.status(), null);
		query.statusReply = {
			at: "2026-06-01T10:00:00.000Z",
			chromeReachable: true,
			tabFound: true,
			figmaReady: true,
			fileName: "A",
			pageName: "P",
		};
		assert.equal(history.status()?.fileName, "A");
	});
});

const step = (
	index: number,
	result: StoredBuildStep["result"],
	status: StoredBuildStep["status"] = "done",
): StoredBuildStep => ({
	index,
	file: `p${index}.js`,
	status,
	ms: 10,
	touchedCount: 0,
	error: null,
	warning: null,
	result,
});

describe("createHistory: pasos de un lote", () => {
	const big = { log: Array.from({ length: 100 }, (_, i) => `linea ${i}`) };

	it("steps devuelve un extracto por paso, con su tamaño total y si se recortó", () => {
		const { query, history } = setup(40);
		query.stepsReply = [
			step(0, { kind: "inline", value: { ok: 1 } }),
			step(1, { kind: "inline", value: big }),
			step(2, { kind: "file", path: "/salida/r.json", bytes: 90_000 }),
			step(3, null, "skipped"),
		];
		const out = history.steps("job-1");
		assert.deepEqual(
			out.map((s) => s.result),
			[
				{ kind: "inline", excerpt: '{"ok":1}', bytes: 8, truncated: false },
				{
					kind: "inline",
					excerpt: JSON.stringify(big).slice(0, 40),
					bytes: JSON.stringify(big).length,
					truncated: true,
				},
				{ kind: "file", path: "/salida/r.json", bytes: 90_000 },
				null,
			],
		);
		assert.equal(query.stepsCalls.at(-1), "job-1");
	});

	it("el tope por defecto es pequeño: ningún extracto pasa de 300 bytes", () => {
		const { query, history } = setup();
		query.stepsReply = [step(0, { kind: "inline", value: big })];
		const result = history.steps("job-1")[0]?.result;
		assert.ok(result?.kind === "inline");
		assert.ok(new TextEncoder().encode(result.excerpt).byteLength <= 300);
		assert.equal(result.truncated, true);
	});

	it("stepResult da el resultado entero del paso pedido", () => {
		const { query, history } = setup(40);
		query.stepsReply = [
			step(0, { kind: "inline", value: big }),
			step(1, { kind: "file", path: "/salida/r.json", bytes: 90_000 }),
			step(2, null, "cancelled"),
		];
		const inline = history.stepResult("job-1", 0);
		assert.ok(inline.ok);
		assert.deepEqual(inline.value, {
			index: 0,
			file: "p0.js",
			status: "done",
			result: { kind: "inline", value: big },
		});
		const file = history.stepResult("job-1", 1);
		assert.ok(file.ok);
		assert.deepEqual(file.value.result, {
			kind: "file",
			path: "/salida/r.json",
			bytes: 90_000,
		});
		const none = history.stepResult("job-1", 2);
		assert.ok(none.ok);
		assert.equal(none.value.result, null);
	});

	it("un paso que el lote no tiene, o un lote sin pasos, es NotFound y dice cuántos hay", () => {
		const { query, history } = setup();
		query.stepsReply = [step(0, null), step(1, null)];
		const missing = history.stepResult("job-1", 5);
		assert.ok(!missing.ok);
		assert.equal(missing.error.type, "NotFound");
		assert.match(missing.error.message, /5/);
		assert.match(missing.error.message, /2 pasos/);
		query.stepsReply = [];
		const noBatch = history.stepResult("job-2", 0);
		assert.ok(!noBatch.ok);
		assert.equal(noBatch.error.type, "NotFound");
	});
});

describe("History: intentos", () => {
	const item = (n: number): AttemptItem => ({
		id: n,
		n,
		kind: "run_script",
		target: "a.js",
		status: "ok",
		firstError: null,
		callId: "c",
		jobId: null,
		stepIndex: null,
		startedAt: "2026-06-01T10:00:00.000Z",
		finishedAt: "2026-06-01T10:00:01.000Z",
		kit: "figma-kit@1",
		kitSha256: "k",
		assets: [],
		scripts: [],
		changed: null,
		callKept: true,
	});

	it("los objetivos: pasa el texto, el tipo y la fecha; el tope es FCC_HISTORY_MAX_ROWS", () => {
		const { query, history } = setup();
		query.attemptTargetsReply = {
			items: [
				{
					kind: "run_script",
					target: "a.js",
					attempts: 3,
					lastStatus: "ok",
					lastAt: "2026-06-01T10:00:00.000Z",
				},
			],
			total: 9,
		};
		const out = history.attemptTargets({
			target: "a",
			kind: "run_script",
			since: "2026-06-01T00:00:00.000Z",
			limit: 5000,
		});
		assert.ok(out.ok);
		assert.equal(out.value.total, 9);
		assert.equal(out.value.truncated, true);
		assert.deepEqual(query.attemptTargetsCalls[0], {
			target: "a",
			kind: "run_script",
			sinceMs: Date.parse("2026-06-01T00:00:00.000Z"),
			limit: MAX_ROWS,
		});
	});

	it("sin filtros: todo es null y el tope por defecto es 20", () => {
		const { query, history } = setup();
		history.attemptTargets({});
		assert.deepEqual(query.attemptTargetsCalls[0], {
			target: null,
			kind: null,
			sinceMs: null,
			limit: 20,
		});
	});

	it("estado, orden, dirección y salto se pasan a la consulta solo si se piden", () => {
		const { query, history } = setup();
		history.attemptTargets({
			status: "error",
			order: "last",
			dir: "asc",
			offset: 50,
			limit: 25,
		});
		assert.deepEqual(query.attemptTargetsCalls[0], {
			target: null,
			kind: null,
			sinceMs: null,
			limit: 25,
			status: "error",
			order: "last",
			dir: "asc",
			offset: 50,
		});
	});

	it("preset today y last_hour: el mismo corte que las demás consultas del histórico", () => {
		const { query, history } = setup();
		history.attemptTargets({ preset: "today" });
		history.attemptTargets({ preset: "last_hour" });
		const since = (i: number) =>
			(query.attemptTargetsCalls[i] as { sinceMs: number }).sinceMs;
		assert.equal(since(0), new Date(2026, 5, 1, 0, 0, 0).getTime());
		assert.equal(since(1), NOW.getTime() - 3_600_000);
	});

	it("preset y since a la vez es un error de uso", () => {
		const { history } = setup();
		const out = history.attemptTargets({
			preset: "today",
			since: "2026-06-01T00:00:00.000Z",
		});
		assert.ok(!out.ok);
	});

	it("targetAttempts: objetivo exacto, tope de filas y total sin cortar", () => {
		const { query, history } = setup();
		query.targetAttemptsReply = { items: [item(1)], total: 4000 };
		const out = history.targetAttempts({
			kind: "run_script",
			target: "a.js",
			offset: null,
			limit: 99_999,
		});
		assert.equal(out.total, 4000);
		assert.equal(out.truncated, true);
		assert.deepEqual(query.targetAttemptsCalls[0], {
			kind: "run_script",
			target: "a.js",
			offset: null,
			limit: MAX_ROWS,
		});
	});

	it("attemptById: lo que sabe la consulta, o null", () => {
		const { query, history } = setup();
		query.attemptsById.set(7, item(7));
		assert.equal(history.attemptById(7)?.n, 7);
		assert.equal(history.attemptById(8), null);
	});

	it("una fecha que no es ISO 8601 es un error de uso", () => {
		const { history } = setup();
		const out = history.attemptTargets({ since: "ayer" });
		assert.ok(!out.ok);
		assert.match(out.error.message, /ISO 8601/);
	});

	it("los intentos de un objetivo traen lo que dice la consulta", () => {
		const { query, history } = setup();
		query.attemptsReply = { items: [item(1), item(2)], total: 2 };
		const out = history.attempts({ target: "a.js" });
		assert.ok(out.ok);
		assert.deepEqual(
			out.value.items.map((i) => i.n),
			[1, 2],
		);
		assert.equal(out.value.truncated, false);
		assert.deepEqual(query.attemptsCalls[0], {
			target: "a.js",
			kind: null,
			sinceMs: null,
			limit: 20,
		});
	});

	it("los de una llamada y un contenido se piden tal cual", () => {
		const { query, history } = setup();
		query.attemptsOfCallReply = [
			{ id: 1, n: 1, kind: "build_step", target: "a.js", status: "ok" },
		];
		assert.equal(history.attemptsOfCall("c1").length, 1);
		assert.deepEqual(query.attemptsOfCallCalls, ["c1"]);
		history.script({ by: "sha256", sha256: "ab" });
		assert.deepEqual(query.storedScriptCalls, [{ by: "sha256", sha256: "ab" }]);
	});
});
