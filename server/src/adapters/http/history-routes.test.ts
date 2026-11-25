import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHistory } from "#application/history.ts";
import {
	EMPTY_SUMMARY,
	InMemoryHistoryQuery,
} from "#application/testing/in-memory-history-query.ts";
import type { AttemptItem, ScriptLookup } from "#domain/attempt.ts";
import type { CallItem } from "#domain/history.ts";
import {
	CONTENT_LINES,
	DIFF_LINES,
	handleHistoryRequest,
	PER_PAGE_MAX,
} from "./history-routes.ts";

const NOW = new Date(2026, 5, 1, 15, 30, 0);

const call = (callId: string): CallItem => ({
	callId,
	sessionId: "s1",
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

function setup() {
	const query = new InMemoryHistoryQuery();
	const history = createHistory({ query, now: () => NOW, maxRows: 50 });
	const raw = (path: string, search = "") =>
		handleHistoryRequest(history, path, new URLSearchParams(search));
	const get = (path: string, search = "") => {
		const response = raw(path, search);
		assert.ok(response, `${path} debería ser una ruta del histórico`);
		return response;
	};
	return { query, get, raw };
}

describe("handleHistoryRequest (GET /api/history/*)", () => {
	it("una ruta que no es del histórico no la maneja", () => {
		assert.equal(setup().raw("/events"), null);
		assert.equal(setup().raw("/api/otra"), null);
	});

	it("una ruta del histórico que no existe es un 404 con cuerpo de error", () => {
		const r = setup().get("/api/history/nada");
		assert.equal(r.status, 404);
		assert.equal((r.body as { ok: boolean }).ok, false);
	});

	it("summary resuelve el rango de la URL (preset, since, until y session)", () => {
		const { query, get } = setup();
		query.summaryReply = { ...EMPTY_SUMMARY, calls: 3 };
		const r = get("/api/history/summary", "preset=last_hour&session=abc");
		assert.equal(r.status, 200);
		assert.equal((r.body as { summary: { calls: number } }).summary.calls, 3);
		assert.equal(query.summaryCalls[0]?.range.sessionId, "abc");
		get(
			"/api/history/summary",
			"since=2026-06-01T00:00:00Z&until=2026-06-02T00:00:00Z",
		);
		assert.equal(
			query.summaryCalls[1]?.range.fromMs,
			Date.parse("2026-06-01T00:00:00Z"),
		);
	});

	it("un rango inválido es un 400 que dice qué campo", () => {
		const r = setup().get("/api/history/summary", "since=ayer");
		assert.equal(r.status, 400);
		const body = r.body as {
			ok: boolean;
			error: { type: string; message: string };
		};
		assert.equal(body.ok, false);
		assert.equal(body.error.type, "InvalidRange");
		assert.match(body.error.message, /since/);
	});

	it("errors, nodes y sessions aceptan limit y devuelven items, total y truncated", () => {
		const { query, get } = setup();
		query.errorsReply = { items: [], total: 4 };
		const r = get("/api/history/errors", "limit=2");
		assert.deepEqual(r.body, {
			ok: true,
			items: [],
			total: 4,
			truncated: true,
		});
		assert.equal(query.errorsCalls[0]?.limit, 2);
		get("/api/history/nodes", "limit=abc");
		assert.equal(query.nodesCalls[0]?.limit, 20);
		assert.equal(get("/api/history/sessions").status, 200);
	});

	it("search exige q", () => {
		const { query, get } = setup();
		assert.equal(get("/api/history/search").status, 400);
		assert.equal(get("/api/history/search", "q=%20").status, 400);
		get("/api/history/search", "q=pintar&preset=today&limit=5");
		assert.equal(query.callsCalls[0]?.search, "pintar");
		assert.equal(query.callsCalls[0]?.perPage, 5);
	});

	it("calls traduce los parámetros de la tabla del panel", () => {
		const { query, get } = setup();
		query.callsReply = {
			items: [call("c1")],
			total: 120,
			page: 3,
			perPage: 25,
		};
		const r = get(
			"/api/history/calls",
			"tool=figma_status&status=error&q=boom&jobs=1&sort=duration&dir=asc&page=3&per=25&locate=c1&session=s1",
		);
		assert.deepEqual(r.body, {
			ok: true,
			items: [call("c1")],
			total: 120,
			truncated: false,
			page: 3,
			perPage: 25,
		});
		assert.deepEqual(query.callsCalls[0], {
			range: { fromMs: null, toMs: null, sessionId: "s1" },
			tool: "figma_status",
			status: "error",
			search: "boom",
			jobsOnly: true,
			sort: { key: "duration", dir: "asc" },
			page: 3,
			perPage: 25,
			locate: "c1",
		});
	});

	it("calls ignora valores desconocidos de orden o estado y usa los defectos", () => {
		const { query, get } = setup();
		get("/api/history/calls", "status=raro&sort=raro&dir=raro&page=0&per=x");
		const sent = query.callsCalls[0];
		assert.equal(sent?.status, "all");
		assert.deepEqual(sent?.sort, { key: "time", dir: "desc" });
		assert.equal(sent?.page, 1);
		assert.equal(sent?.perPage, 25);
	});

	it("calls/:id devuelve la llamada o un 404", () => {
		const { query, get } = setup();
		assert.equal(get("/api/history/calls/c9").status, 404);
		query.callReply = call("c9");
		const r = get("/api/history/calls/c9");
		assert.equal(r.status, 200);
		assert.equal((r.body as { call: CallItem }).call.callId, "c9");
		assert.equal(query.callCalls.at(-1), "c9");
	});

	it("jobs/:id/steps devuelve los pasos del lote", () => {
		const { query, get } = setup();
		query.stepsReply = [
			{
				index: 0,
				file: "build_home.js",
				status: "done",
				ms: 40,
				touchedCount: 2,
				error: null,
				warning: null,
				result: { kind: "inline", value: { log: ["a"] } },
			},
		];
		const r = get("/api/history/jobs/job-1/steps");
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, {
			ok: true,
			steps: [
				{
					...query.stepsReply[0],
					result: {
						kind: "inline",
						excerpt: '{"log":["a"]}',
						bytes: 13,
						truncated: false,
					},
				},
			],
		});
		assert.equal(query.stepsCalls.at(-1), "job-1");
	});

	it("jobs/:id/steps/:n/result devuelve el resultado entero de ese paso", () => {
		const { query, get } = setup();
		const value = { log: Array.from({ length: 300 }, (_, i) => `l${i}`) };
		query.stepsReply = [
			{
				index: 0,
				file: "a.js",
				status: "done",
				ms: 1,
				touchedCount: 0,
				error: null,
				warning: null,
				result: null,
			},
			{
				index: 1,
				file: "b.js",
				status: "done",
				ms: 1,
				touchedCount: 0,
				error: null,
				warning: null,
				result: { kind: "inline", value },
			},
		];
		const r = get("/api/history/jobs/job-1/steps/1/result");
		assert.equal(r.status, 200);
		assert.deepEqual(r.body, {
			ok: true,
			stepResult: {
				index: 1,
				file: "b.js",
				status: "done",
				result: { kind: "inline", value },
			},
		});
		assert.equal(query.stepsCalls.at(-1), "job-1");
	});

	it("jobs/:id/steps/:n/result de un paso que no existe o con un índice que no es número es 404", () => {
		const { query, get } = setup();
		query.stepsReply = [];
		for (const path of [
			"/api/history/jobs/job-1/steps/3/result",
			"/api/history/jobs/job-1/steps/x/result",
			"/api/history/jobs/job-1/steps/-1/result",
			"/api/history/jobs//steps/0/result",
		]) {
			assert.equal(get(path).status, 404, path);
		}
	});

	it("jobs//steps con id vacío es un 404, no un 200 con lista vacía", () => {
		const { query, get } = setup();
		const r = get("/api/history/jobs//steps");
		assert.equal(r.status, 404);
		assert.equal(query.stepsCalls.length, 0);
	});

	it("captures pagina y status devuelve el último estado de la conexión", () => {
		const { query, get } = setup();
		query.capturesReply = { items: [], total: 0 };
		assert.deepEqual(get("/api/history/captures", "page=2&per=10").body, {
			ok: true,
			items: [],
			total: 0,
			truncated: false,
			page: 2,
			perPage: 10,
		});
		assert.equal(
			(get("/api/history/status").body as { status: unknown }).status,
			null,
		);
	});
});

const attemptItem = (
	id: number,
	over: Partial<AttemptItem> = {},
): AttemptItem => ({
	id,
	n: id,
	kind: "run_script",
	target: "a.js",
	status: "ok",
	firstError: null,
	callId: null,
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
	...over,
});

const found = (content: string | null, sha256 = "h"): ScriptLookup => ({
	kind: "found",
	script: {
		sha256,
		kind: "js",
		bytes: content?.length ?? 5_000_000,
		stored: content === null ? "too_big" : "full",
		content,
	},
});

const lines = (prefix: string, n: number) =>
	Array.from({ length: n }, (_, i) => `${prefix}${i}`).join("\n");

describe("GET /api/history/attempt-targets", () => {
	it("pasa los filtros, el orden y la página a la consulta", () => {
		const { query, get } = setup();
		query.attemptTargetsReply = { items: [], total: 120 };
		const r = get(
			"/api/history/attempt-targets",
			"kind=capture&status=error&q=home&preset=today&sort=last&dir=asc&page=3&per=10",
		);
		assert.deepEqual(query.attemptTargetsCalls[0], {
			target: "home",
			kind: "capture",
			sinceMs: new Date(2026, 5, 1, 0, 0, 0).getTime(),
			limit: 10,
			status: "error",
			order: "last",
			dir: "asc",
			offset: 20,
		});
		assert.deepEqual(r.body, {
			ok: true,
			items: [],
			total: 120,
			page: 3,
			perPage: 10,
		});
	});

	it("un parámetro que no se entiende cae en su defecto: nunca un 400", () => {
		const { query, get } = setup();
		const r = get(
			"/api/history/attempt-targets",
			"kind=otro&status=raro&sort=azar&dir=sideways&page=-4&per=x&preset=ayer",
		);
		assert.equal(r.status, 200);
		assert.deepEqual(query.attemptTargetsCalls[0], {
			target: null,
			kind: null,
			sinceMs: null,
			limit: 25,
			order: "attempts",
			dir: "desc",
			offset: 0,
		});
	});

	it("per pasa de PER_PAGE_MAX: se queda en el tope", () => {
		const { query, get } = setup();
		get("/api/history/attempt-targets", "per=99999");
		const limit = (query.attemptTargetsCalls[0] as { limit: number }).limit;
		assert.ok(limit <= PER_PAGE_MAX && limit < 99_999);
	});

	it("since inválido (no es ISO) es un 400 con el error de uso", () => {
		const r = setup().get("/api/history/attempt-targets", "since=ayer");
		assert.equal(r.status, 400);
	});
});

describe("GET /api/history/attempts", () => {
	it("pide el objetivo exacto; sin page, los últimos", () => {
		const { query, get } = setup();
		query.targetAttemptsReply = {
			items: [attemptItem(4), attemptItem(5)],
			total: 5,
		};
		const r = get(
			"/api/history/attempts",
			"kind=run_script&target=pasos%2Fa.js&per=2",
		);
		assert.deepEqual(query.targetAttemptsCalls[0], {
			kind: "run_script",
			target: "pasos/a.js",
			offset: null,
			limit: 2,
		});
		assert.deepEqual(
			{
				total: (r.body as { total: number }).total,
				offset: (r.body as { offset: number }).offset,
				perPage: (r.body as { perPage: number }).perPage,
			},
			{ total: 5, offset: 3, perPage: 2 },
		);
	});

	it("cada intento trae la frase de qué cambió, como figma_history_attempts", () => {
		const { query, get } = setup();
		const ref = (role: "step" | "kit") => ({
			role,
			path: "",
			sha256: role,
			bytes: 1,
			stored: "full" as const,
		});
		query.targetAttemptsReply = {
			items: [
				attemptItem(1, { scripts: [ref("step"), ref("kit")] }),
				attemptItem(2, {
					scripts: [ref("step"), ref("kit")],
					changed: ["step"],
				}),
			],
			total: 2,
		};
		const body = get("/api/history/attempts", "kind=run_script&target=a.js")
			.body as { items: { change: string }[] };
		assert.deepEqual(
			body.items.map((i) => i.change),
			[
				"intento 1: primero de este objetivo",
				"intento 2: cambió step; kit igual",
			],
		);
	});

	it("con page, salta (page-1)*per", () => {
		const { query, get } = setup();
		get("/api/history/attempts", "kind=run_script&target=a.js&page=3&per=10");
		assert.equal(
			(query.targetAttemptsCalls[0] as { offset: number }).offset,
			20,
		);
	});

	it("sin kind válido o sin target es un 400", () => {
		const { get } = setup();
		assert.equal(get("/api/history/attempts", "target=a.js").status, 400);
		assert.equal(
			get("/api/history/attempts", "kind=otro&target=a.js").status,
			400,
		);
		assert.equal(get("/api/history/attempts", "kind=capture").status, 400);
	});
});

describe("GET /api/history/attempts/<id>/script", () => {
	it("devuelve el contenido con sus líneas, sin recorte si cabe", () => {
		const { query, get } = setup();
		query.storedScriptReply = found("a\nb\n", "abc");
		const r = get("/api/history/attempts/7/script", "role=step");
		assert.deepEqual(query.storedScriptCalls[0], {
			by: "attempt",
			attemptId: 7,
			role: "step",
			path: undefined,
		});
		assert.deepEqual(r.body, {
			ok: true,
			sha256: "abc",
			kind: "js",
			bytes: 4,
			stored: "full",
			lines: 2,
			content: "a\nb\n",
			truncated: false,
		});
	});

	it("recorta a CONTENT_LINES y dice cuántas líneas tiene en total", () => {
		const { query, get } = setup();
		query.storedScriptReply = found(lines("l", CONTENT_LINES + 500));
		const body = get("/api/history/attempts/7/script", "role=kit").body as {
			content: string;
			lines: number;
			truncated: boolean;
		};
		assert.equal(body.truncated, true);
		assert.equal(body.lines, CONTENT_LINES + 500);
		assert.equal(body.content.split("\n").length - 1, CONTENT_LINES);
	});

	it("un contenido too_big no trae texto", () => {
		const { query, get } = setup();
		query.storedScriptReply = found(null);
		const body = get("/api/history/attempts/7/script", "role=kit").body as {
			stored: string;
			content: string | null;
		};
		assert.equal(body.stored, "too_big");
		assert.equal(body.content, null);
	});

	it("sin role es 400; id o papel que no existen, 404; varias rutas sin path, 400", () => {
		const { query, get } = setup();
		assert.equal(get("/api/history/attempts/7/script").status, 400);
		query.storedScriptReply = { kind: "not_found" };
		assert.equal(
			get("/api/history/attempts/7/script", "role=step").status,
			404,
		);
		assert.equal(
			get("/api/history/attempts/abc/script", "role=step").status,
			404,
		);
		query.storedScriptReply = { kind: "needs_path", paths: ["x.js", "y.js"] };
		const r = get("/api/history/attempts/7/script", "role=hooks");
		assert.equal(r.status, 400);
		assert.match(JSON.stringify(r.body), /x\.js/);
	});

	it("raw: el texto entero como text/plain", () => {
		const { query, get } = setup();
		query.storedScriptReply = found(lines("l", CONTENT_LINES + 10));
		const r = get("/api/history/attempts/7/script/raw", "role=kit");
		assert.equal(r.status, 200);
		assert.equal(typeof r.text, "string");
		assert.equal(r.contentType, "text/plain; charset=utf-8");
		assert.equal((r.text ?? "").split("\n").length, CONTENT_LINES + 10);
	});

	it("raw de un contenido too_big es un 409", () => {
		const { query, get } = setup();
		query.storedScriptReply = found(null);
		assert.equal(
			get("/api/history/attempts/7/script/raw", "role=kit").status,
			409,
		);
	});
});

describe("GET /api/history/attempt-diff", () => {
	function withAttempts(a: string, b: string, over: Partial<AttemptItem> = {}) {
		const ctx = setup();
		const ref = (sha: string) => ({
			role: "step" as const,
			path: "",
			sha256: sha,
			bytes: 1,
			stored: "full" as const,
		});
		ctx.query.attemptsById.set(
			1,
			attemptItem(1, { scripts: [ref("A")], ...over }),
		);
		ctx.query.attemptsById.set(2, attemptItem(2, { scripts: [ref("B")] }));
		ctx.query.storedScriptFor = (sel) =>
			sel.by === "sha256"
				? found(sel.sha256 === "A" ? a : b, sel.sha256)
				: { kind: "not_found" };
		return ctx;
	}

	it("da los papeles, los assets y el diff del primero que cambió", () => {
		const { get } = withAttempts("a\nb\n", "a\nB\n");
		const r = get("/api/history/attempt-diff", "from=1&to=2");
		const body = r.body as any;
		assert.equal(r.status, 200);
		assert.equal(body.ok, true);
		assert.deepEqual(body.roles, [
			{ role: "step", path: "", state: "changed", added: 1, removed: 1 },
		]);
		assert.equal(body.diff.kind, "diff");
		assert.equal(body.diff.truncated, false);
		assert.equal(body.from.id, 1);
		assert.equal(body.to.id, 2);
	});

	it("recorta el diff a DIFF_LINES y lo dice", () => {
		const { get } = withAttempts(lines("a", 1500), lines("b", 1500));
		const body = get("/api/history/attempt-diff", "from=1&to=2").body as any;
		assert.equal(body.diff.truncated, true);
		const n = body.diff.hunks.reduce(
			(t: number, h: any) => t + h.lines.length,
			0,
		);
		assert.equal(n, DIFF_LINES);
		assert.equal(body.diff.added, 1500, "las cuentas son las del diff entero");
	});

	it("from y to obligatorios y enteros: 400; un id que no existe: 404; objetivos distintos: 400", () => {
		const { get } = withAttempts("a", "b");
		assert.equal(get("/api/history/attempt-diff", "from=1").status, 400);
		assert.equal(get("/api/history/attempt-diff", "from=x&to=2").status, 400);
		assert.equal(get("/api/history/attempt-diff", "from=1&to=9").status, 404);
		const other = withAttempts("a", "b", { target: "otro.js" });
		assert.equal(
			other.get("/api/history/attempt-diff", "from=1&to=2").status,
			400,
		);
	});

	it("raw: el diff unificado entero como text/plain, sin recorte", () => {
		const { get } = withAttempts(lines("a", 1500), lines("b", 1500));
		const r = get("/api/history/attempt-diff/raw", "from=1&to=2");
		assert.equal(typeof r.text, "string");
		assert.equal(r.contentType, "text/plain; charset=utf-8");
		assert.match(r.text ?? "", /^--- /m);
		assert.match(r.text ?? "", /^@@ /m);
		assert.equal(
			(r.text ?? "").split("\n").filter((l) => l.startsWith("+b")).length,
			1500,
		);
	});
});
