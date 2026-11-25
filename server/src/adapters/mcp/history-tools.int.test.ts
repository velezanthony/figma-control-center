import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHistory } from "#application/history.ts";
import { makeHistoryDiff } from "#application/history-diff.ts";
import { makeHistoryScript } from "#application/history-script.ts";
import {
	EMPTY_SUMMARY,
	InMemoryHistoryQuery,
} from "#application/testing/in-memory-history-query.ts";
import { InMemoryResultStore } from "#application/testing/in-memory-ports.ts";
import type { AttemptItem } from "#domain/attempt.ts";
import type { CallItem, StoredBuildStep } from "#domain/history.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { registerHistoryTools } from "./history-tools.ts";

const NOW = new Date("2026-06-01T12:00:00.000Z");
const MAX_ROWS = 5;

const call = (callId: string, over: Partial<CallItem> = {}): CallItem => ({
	callId,
	sessionId: "s1",
	fileUrl: null,
	tool: "figma_run_script",
	startedAt: "2026-06-01T11:30:00.000Z",
	args: { file: "scripts/x.js" },
	status: "ok",
	ms: 180,
	retryable: null,
	touchedNodeIds: ["1:23"],
	error: null,
	resultPath: "/tmp/r.json",
	jobId: null,
	job: null,
	screenshots: [],
	summary: "figma_run_script scripts/x.js → 1 nodo, 180 ms",
	...over,
});

const query = new InMemoryHistoryQuery();
const store = new InMemoryResultStore();
const client = new Client({ name: "test", version: "0.0.0" });

before(async () => {
	const server = new McpServer({ name: "test", version: "0.0.0" });
	const history = createHistory({ query, now: () => NOW, maxRows: MAX_ROWS });
	registerHistoryTools(
		server,
		history,
		"Europe/Madrid",
		makeHistoryScript({ history, store }),
		makeHistoryDiff({ history, store, inlineLines: 4 }),
	);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
});

const run = async (name: string, args: Record<string, unknown> = {}) => {
	const r = await client.callTool({ name, arguments: args });
	return {
		isError: r.isError === true,
		structured: r.structuredContent as Record<string, unknown> | undefined,
		text: (r.content as { text: string }[])[0]?.text ?? "",
	};
};

const stepRow = (
	index: number,
	result: StoredBuildStep["result"],
): StoredBuildStep => ({
	index,
	file: `p${index}.js`,
	status: "done",
	ms: 10,
	touchedCount: 0,
	error: null,
	warning: null,
	result,
});

describe("herramientas figma_history_*: catálogo", () => {
	it("las nueve existen, con los nombres del contrato", async () => {
		const names = (await client.listTools()).tools
			.map((t) => t.name)
			.filter((n) => n.startsWith("figma_history_"))
			.sort();
		assert.deepEqual(
			names,
			[
				TOOL_NAME.historyAttempts,
				TOOL_NAME.historyCall,
				TOOL_NAME.historyDiff,
				TOOL_NAME.historyErrors,
				TOOL_NAME.historyNodes,
				TOOL_NAME.historyScript,
				TOOL_NAME.historySearch,
				TOOL_NAME.historySessions,
				TOOL_NAME.historySummary,
			].sort(),
		);
	});

	it("todas están anotadas como solo lectura, idempotentes y sin mundo abierto", async () => {
		const tools = (await client.listTools()).tools.filter((t) =>
			t.name.startsWith("figma_history_"),
		);
		assert.equal(tools.length, 9);
		for (const t of tools) {
			assert.equal(t.annotations?.readOnlyHint, true, t.name);
			assert.equal(t.annotations?.idempotentHint, true, t.name);
			assert.equal(t.annotations?.openWorldHint, false, t.name);
			assert.ok(
				t.description && t.description.length > 40,
				`${t.name} necesita una descripción útil`,
			);
		}
	});

	it("los campos de entrada están descritos y validados con zod (rango y límite)", async () => {
		const search = (await client.listTools()).tools.find(
			(t) => t.name === TOOL_NAME.historySearch,
		);
		const props = (search?.inputSchema.properties ?? {}) as Record<
			string,
			{ description?: string }
		>;
		for (const field of [
			"query",
			"preset",
			"since",
			"until",
			"sessionId",
			"limit",
		]) {
			assert.ok(props[field]?.description, `${field} sin descripción`);
		}
		assert.deepEqual(search?.inputSchema.required, ["query"]);
	});
});

describe("herramientas figma_history_*: respuestas", () => {
	it("summary devuelve el resumen y pide al histórico el rango resuelto", async () => {
		query.summaryReply = {
			...EMPTY_SUMMARY,
			calls: 12,
			errors: 2,
			topTools: [{ tool: "figma_run_script", calls: 9, errors: 2 }],
		};
		const r = await run(TOOL_NAME.historySummary, { preset: "last_hour" });
		assert.equal(r.isError, false);
		assert.equal(r.structured?.["ok"], true);
		const summary = r.structured?.["summary"] as {
			calls: number;
			topTools: unknown[];
		};
		assert.equal(summary.calls, 12);
		assert.equal(summary.topTools.length, 1);
		assert.equal(
			query.summaryCalls.at(-1)?.range.fromMs,
			NOW.getTime() - 3_600_000,
		);
	});

	it("errors, nodes y sessions traen items, total y truncated", async () => {
		query.errorsReply = {
			items: [
				{
					type: "ScriptError",
					count: 3,
					lastAt: "2026-06-01T11:00:00.000Z",
					nextStep: "Corrige.",
					examples: [],
				},
			],
			total: 9,
		};
		const e = await run(TOOL_NAME.historyErrors, { limit: 1 });
		assert.equal(e.structured?.["total"], 9);
		assert.equal(e.structured?.["truncated"], true);
		assert.equal(((e.structured?.["items"] ?? []) as unknown[]).length, 1);
		query.nodesReply = {
			items: [
				{
					nodeId: "1:23",
					touches: 4,
					lastAt: "2026-06-01T11:00:00.000Z",
					lastCallId: "c1",
					lastTool: "figma_run_script",
				},
			],
			total: 1,
		};
		const n = await run(TOOL_NAME.historyNodes, { sessionId: "s1" });
		assert.equal(n.structured?.["truncated"], false);
		assert.equal(query.nodesCalls.at(-1)?.range.sessionId, "s1");
		query.sessionsReply = { items: [], total: 0 };
		const s = await run(TOOL_NAME.historySessions);
		assert.deepEqual(s.structured?.["items"], []);
	});

	it("el límite pedido nunca pasa del tope de filas configurado", async () => {
		await run(TOOL_NAME.historyErrors, { limit: 1000 });
		assert.equal(query.errorsCalls.at(-1)?.limit, MAX_ROWS);
	});

	it("search devuelve filas breves con el resumen, sin volcar los detalles de cada llamada, y la hora en la zona local", async () => {
		query.callsReply = {
			items: [call("c1")],
			total: 40,
			page: 1,
			perPage: MAX_ROWS,
		};
		const r = await run(TOOL_NAME.historySearch, {
			query: "pintar",
			preset: "today",
		});
		const items = r.structured?.["items"] as Record<string, unknown>[];
		assert.deepEqual(items[0], {
			callId: "c1",
			// La hora de la zona del sistema, con su diferencia: la que enseña el panel
			startedAt: "2026-06-01T13:30:00.000+02:00",
			tool: "figma_run_script",
			status: "ok",
			ms: 180,
			summary: "figma_run_script scripts/x.js → 1 nodo, 180 ms",
			errorType: null,
			jobStatus: null,
		});
		assert.equal(r.structured?.["total"], 40);
		assert.equal(r.structured?.["truncated"], true);
		assert.equal(query.callsCalls.at(-1)?.search, "pintar");
	});

	it("call devuelve el detalle completo de una llamada", async () => {
		query.callReply = call("c1", {
			status: "error",
			error: {
				type: "ScriptError",
				message: "Boom",
				nextStep: "Corrige.",
				line: 3,
			},
		});
		const r = await run(TOOL_NAME.historyCall, { callId: "c1" });
		const item = r.structured?.["call"] as CallItem;
		assert.equal(item.callId, "c1");
		assert.equal(item.error?.message, "Boom");
		assert.deepEqual(item.args, { file: "scripts/x.js" });
	});

	it("call de un lote incluye sus pasos", async () => {
		query.callReply = call("c9", { tool: "figma_build", jobId: "job-1" });
		query.stepsReply = [
			{
				index: 0,
				file: "build_home.js",
				status: "done",
				ms: 40,
				touchedCount: 2,
				error: null,
				warning: null,
				result: { kind: "inline", value: { log: ["x×0"] } },
			},
			{
				index: 1,
				file: "swap.js",
				status: "cancelled",
				ms: null,
				touchedCount: 0,
				error: null,
				warning: null,
				result: null,
			},
			{
				index: 2,
				file: "publish.js",
				status: "done",
				ms: 9,
				touchedCount: 0,
				error: null,
				warning: null,
				result: { kind: "file", path: "/salida/result-1.json", bytes: 90_000 },
			},
		];
		const r = await run(TOOL_NAME.historyCall, { callId: "c9" });
		const steps = r.structured?.["steps"] as {
			index: number;
			file: string;
			result: unknown;
		}[];
		assert.equal(steps?.length, 3);
		assert.equal(steps[1]?.file, "swap.js");
		assert.deepEqual(
			steps.map((st) => st.result),
			[
				{
					kind: "inline",
					excerpt: '{"log":["x×0"]}',
					bytes: 16,
					truncated: false,
				},
				null,
				{ kind: "file", path: "/salida/result-1.json", bytes: 90_000 },
			],
		);
		assert.equal(query.stepsCalls.at(-1), "job-1");
		assert.equal(r.structured?.["stepResult"], undefined);
	});

	it("call de un lote de 11 pasos grandes cabe en pocos kilobytes y no lleva los resultados enteros", async () => {
		query.callReply = call("c10", { tool: "figma_build", jobId: "job-11" });
		query.stepsReply = Array.from({ length: 11 }, (_, index) => ({
			index,
			file: `paso_${index}.js`,
			status: "done" as const,
			ms: 40,
			touchedCount: 2,
			error: null,
			warning: null,
			result: {
				kind: "inline" as const,
				value: { log: Array.from({ length: 800 }, (_, i) => `línea ${i}`) },
			},
		}));
		const r = await run(TOOL_NAME.historyCall, { callId: "c10" });
		assert.ok(JSON.stringify(r.structured).length < 8_000);
		assert.ok(!JSON.stringify(r.structured).includes("línea 700"));
	});

	it("call con step devuelve el resultado entero de ese paso y no la lista de pasos", async () => {
		query.callReply = call("c9", { tool: "figma_build", jobId: "job-1" });
		const value = { log: Array.from({ length: 200 }, (_, i) => `l${i}`) };
		query.stepsReply = [
			stepRow(0, null),
			stepRow(1, { kind: "inline", value }),
			stepRow(2, { kind: "file", path: "/salida/r.json", bytes: 90_000 }),
		];
		const inline = await run(TOOL_NAME.historyCall, { callId: "c9", step: 1 });
		assert.equal(inline.isError, false);
		assert.deepEqual(inline.structured?.["stepResult"], {
			index: 1,
			file: "p1.js",
			status: "done",
			result: { kind: "inline", value },
		});
		assert.equal(inline.structured?.["steps"], undefined);
		assert.equal(
			(inline.structured?.["call"] as CallItem | undefined)?.callId,
			"c9",
		);
		const file = await run(TOOL_NAME.historyCall, { callId: "c9", step: 2 });
		assert.deepEqual(
			(file.structured?.["stepResult"] as { result: unknown } | undefined)
				?.result,
			{ kind: "file", path: "/salida/r.json", bytes: 90_000 },
		);
		const none = await run(TOOL_NAME.historyCall, { callId: "c9", step: 0 });
		assert.equal(
			(none.structured?.["stepResult"] as { result: unknown } | undefined)
				?.result,
			null,
		);
	});

	it("call con un step que no existe es un error de uso que dice cuántos pasos hay", async () => {
		query.callReply = call("c9", { tool: "figma_build", jobId: "job-1" });
		query.stepsReply = [stepRow(0, null), stepRow(1, null)];
		const r = await run(TOOL_NAME.historyCall, { callId: "c9", step: 7 });
		assert.equal(r.isError, true);
		assert.match(r.text, /paso 7/);
		assert.match(r.text, /2 pasos/);
	});

	it("call con step de una llamada que no es un lote es un error de uso", async () => {
		query.callReply = call("c1");
		const r = await run(TOOL_NAME.historyCall, { callId: "c1", step: 0 });
		assert.equal(r.isError, true);
	});

	it("call sin job no pide pasos ni los incluye", async () => {
		query.callReply = call("c1", { jobId: null });
		query.stepsReply = [];
		const before = query.stepsCalls.length;
		const r = await run(TOOL_NAME.historyCall, { callId: "c1" });
		assert.equal(r.structured?.["steps"], undefined);
		assert.equal(query.stepsCalls.length, before);
	});
});

describe("herramientas figma_history_*: errores de uso", () => {
	it("un rango inválido llega como error de herramienta que dice qué campo está mal", async () => {
		const r = await run(TOOL_NAME.historySummary, { since: "ayer" });
		assert.equal(r.isError, true);
		assert.match(r.text, /since/);
	});

	it("una llamada que no existe dice su id", async () => {
		query.callReply = null;
		const r = await run(TOOL_NAME.historyCall, { callId: "fantasma" });
		assert.equal(r.isError, true);
		assert.match(r.text, /fantasma/);
	});

	it("una búsqueda vacía es un error de uso", async () => {
		const r = await run(TOOL_NAME.historySearch, { query: "  " });
		assert.equal(r.isError, true);
	});

	it("una entrada que no cumple el esquema (preset desconocido) la rechaza zod", async () => {
		const r = await run(TOOL_NAME.historySummary, { preset: "ayer" });
		assert.equal(r.isError, true);
	});
});

const attempt = (n: number, over: Partial<AttemptItem> = {}): AttemptItem => ({
	id: 10 + n,
	n,
	kind: "run_script",
	target: "pasos/a.js",
	status: "ok",
	firstError: null,
	callId: "c1",
	jobId: null,
	stepIndex: null,
	startedAt: "2026-06-01T11:30:00.000Z",
	finishedAt: "2026-06-01T11:30:01.000Z",
	kit: "figma-kit@1",
	kitSha256: "k".repeat(64),
	assets: [],
	scripts: [
		{
			role: "step",
			path: "",
			sha256: "s".repeat(64),
			bytes: 10,
			stored: "full",
		},
		{
			role: "params",
			path: "",
			sha256: "p".repeat(64),
			bytes: 2,
			stored: "full",
		},
		{
			role: "kit",
			path: "",
			sha256: "k".repeat(64),
			bytes: 100,
			stored: "full",
		},
	],
	changed: null,
	callKept: true,
	...over,
});

describe("figma_history_attempts", () => {
	it("sin target: los objetivos con su número de intentos, el estado y la fecha del último", async () => {
		query.attemptTargetsReply = {
			items: [
				{
					kind: "run_script",
					target: "pasos/a.js",
					attempts: 3,
					lastStatus: "error",
					lastAt: "2026-06-01T11:30:00.000Z",
				},
			],
			total: 1,
		};
		const r = await run(TOOL_NAME.historyAttempts, { kind: "run_script" });
		assert.equal(r.isError, false);
		assert.equal(r.structured?.["mode"], "targets");
		const [first] = (r.structured?.["items"] ?? []) as {
			attempts: number;
			lastAt: string;
		}[];
		assert.equal(first?.attempts, 3);
		assert.equal(
			first?.lastAt,
			"2026-06-01T13:30:00.000+02:00",
			"la hora local",
		);
		assert.equal(query.attemptTargetsCalls.at(-1) !== undefined, true);
	});

	it("con target: los intentos en orden, con la llamada, el kit y qué papeles cambiaron (también en una frase)", async () => {
		query.attemptsReply = {
			items: [
				attempt(1),
				attempt(2, { changed: [] }),
				attempt(3, {
					changed: ["step"],
					status: "contract_error",
					firstError: "/createdNodeIds/0: no es texto",
					jobId: "j1",
					stepIndex: 2,
				}),
			],
			total: 3,
		};
		const r = await run(TOOL_NAME.historyAttempts, { target: "a.js" });
		assert.equal(r.structured?.["mode"], "attempts");
		const items = r.structured?.["items"] as {
			n: number;
			changed: string[] | null;
			change: string;
			callId: string;
			jobId: string | null;
			stepIndex: number | null;
			kit: string;
			firstError: string | null;
		}[];
		assert.deepEqual(
			items.map((i) => i.n),
			[1, 2, 3],
		);
		assert.equal(items[0]?.change, "intento 1: primero de este objetivo");
		assert.equal(
			items[1]?.change,
			"intento 2: sin cambios (step, params y kit iguales)",
		);
		assert.equal(
			items[2]?.change,
			"intento 3: cambió step; params y kit iguales",
		);
		assert.deepEqual(items[2]?.changed, ["step"]);
		assert.equal(items[2]?.jobId, "j1");
		assert.equal(items[2]?.stepIndex, 2);
		assert.equal(items[2]?.kit, "figma-kit@1");
		assert.match(items[2]?.firstError ?? "", /createdNodeIds/);
		assert.equal(
			(query.attemptsCalls.at(-1) as { target: string }).target,
			"a.js",
		);
	});

	it("una fecha `since` que no es ISO es un error de uso", async () => {
		const r = await run(TOOL_NAME.historyAttempts, { since: "ayer" });
		assert.equal(r.isError, true);
		assert.match(r.text, /ISO 8601/);
	});
});

describe("figma_history_script", () => {
	it("escribe el contenido en la carpeta de salida y devuelve path, bytes y hash (nunca el contenido)", async () => {
		query.storedScriptReply = {
			kind: "found",
			script: {
				sha256: "c".repeat(64),
				kind: "js",
				bytes: 9,
				stored: "full",
				content: "return 1;",
			},
		};
		const r = await run(TOOL_NAME.historyScript, { attempt: 12, role: "step" });
		assert.equal(r.isError, false);
		assert.match(String(r.structured?.["path"]), /history-scripts\/c{64}\.js$/);
		assert.equal(r.structured?.["bytes"], 9);
		assert.doesNotMatch(r.text, /return 1/);
		assert.equal(
			store.scripts.get(String(r.structured?.["path"])),
			"return 1;",
		);
	});

	it("un contenido too_big da un error de uso que lo dice", async () => {
		query.storedScriptReply = {
			kind: "found",
			script: {
				sha256: "d".repeat(64),
				kind: "js",
				bytes: 5_000_000,
				stored: "too_big",
				content: null,
			},
		};
		const r = await run(TOOL_NAME.historyScript, { sha256: "d".repeat(64) });
		assert.equal(r.isError, true);
		assert.match(r.text, /FCC_SCRIPT_MAX_BYTES/);
	});

	it("sin attempt+role ni sha256, error de uso", async () => {
		const r = await run(TOOL_NAME.historyScript, {});
		assert.equal(r.isError, true);
	});
});

describe("figma_history_call: los intentos de la llamada", () => {
	it("trae attempts con id, n, tipo, objetivo y estado cuando la llamada dejó alguno", async () => {
		query.callReply = call("c9");
		query.attemptsOfCallReply = [
			{ id: 5, n: 2, kind: "build_step", target: "build.js", status: "ok" },
		];
		const r = await run(TOOL_NAME.historyCall, { callId: "c9" });
		assert.deepEqual(r.structured?.["attempts"], [
			{ id: 5, n: 2, kind: "build_step", target: "build.js", status: "ok" },
		]);
		assert.equal(query.attemptsOfCallCalls.at(-1), "c9");
	});

	it("sin intentos no lleva la clave", async () => {
		query.callReply = call("c8");
		query.attemptsOfCallReply = [];
		const r = await run(TOOL_NAME.historyCall, { callId: "c8" });
		assert.equal("attempts" in (r.structured ?? {}), false);
	});
});

describe("figma_history_diff", () => {
	const withContents = (
		a: string,
		b: string,
		over: Partial<AttemptItem> = {},
	) => {
		const ref = (sha: string) => ({
			role: "step" as const,
			path: "",
			sha256: sha,
			bytes: 1,
			stored: "full" as const,
		});
		query.attemptsById.set(1, attempt(1, { id: 1, scripts: [ref("A")] }));
		query.attemptsById.set(
			2,
			attempt(2, { id: 2, scripts: [ref("B")], ...over }),
		);
		query.storedScriptFor = (sel) =>
			sel.by === "sha256"
				? {
						kind: "found",
						script: {
							sha256: sel.sha256,
							kind: "js",
							bytes: 1,
							stored: "full",
							content: sel.sha256 === "A" ? a : b,
						},
					}
				: { kind: "not_found" };
	};
	const many = (p: string, n: number) =>
		Array.from({ length: n }, (_, i) => `${p}${i}`).join("\n");

	it("resumen por papel y el diff en la respuesta, recortado, con el entero en un fichero", async () => {
		withContents(many("a", 10), many("b", 10));
		const r = await run(TOOL_NAME.historyDiff, { from: 1, to: 2 });
		assert.equal(r.isError, false);
		assert.deepEqual(r.structured?.["roles"], [
			{ role: "step", path: "", state: "changed", added: 10, removed: 10 },
		]);
		const diff = r.structured?.["diff"] as {
			text: string;
			truncated: boolean;
			file: string;
		};
		assert.equal(diff.truncated, true);
		assert.equal(diff.text.split("\n").length - 1, 4);
		assert.match(diff.file, /history-diffs\/1-2-step\.diff$/);
		assert.equal(
			(store.diffs.get(diff.file) ?? "")
				.split("\n")
				.filter((l) => l.startsWith("+b")).length,
			10,
		);
	});

	it("sin cambios: roles iguales y diff null", async () => {
		withContents("igual", "igual");
		query.attemptsById.set(
			2,
			attempt(2, {
				id: 2,
				scripts: [
					{ role: "step", path: "", sha256: "A", bytes: 1, stored: "full" },
				],
			}),
		);
		const r = await run(TOOL_NAME.historyDiff, { from: 1, to: 2 });
		assert.equal(r.structured?.["diff"], null);
	});

	it("un id que no existe o objetivos distintos son errores de uso con su explicación", async () => {
		withContents("a", "b");
		const missing = await run(TOOL_NAME.historyDiff, { from: 1, to: 99 });
		assert.equal(missing.isError, true);
		assert.match(missing.text, /99/);
		withContents("a", "b", { target: "otro.js" });
		const other = await run(TOOL_NAME.historyDiff, { from: 1, to: 2 });
		assert.equal(other.isError, true);
		assert.match(other.text, /mismo objetivo/);
	});

	it("sin from o to, o con ids que no son enteros positivos, lo rechaza zod", async () => {
		assert.equal((await run(TOOL_NAME.historyDiff, { from: 1 })).isError, true);
		assert.equal(
			(await run(TOOL_NAME.historyDiff, { from: 0, to: 2 })).isError,
			true,
		);
	});
});
