// E2 escritura con nodos · E3 script largo · E4 captura · E5 coherencia del histórico:
// servidor MCP real + SQLite + API del panel, con el simulador de Figma como Chrome.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { pngDimensions } from "../../contracts/figma-values.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";

const CREATED_AND_MUTATED = ["10:1", "10:2", "10:3"];
const SCREENSHOT_NODE = "10:1";
const SCREENSHOT_SCALE = 2;
// 120 x 80 px por la escala: el tamaño del nodo del mundo simulado
const SCREENSHOT_SIZE = { width: 240, height: 160 };

type Page<T> = { items: T[]; total: number };
type CallApi = {
	callId: string;
	tool: string;
	status: string;
	fileUrl: string | null;
	touchedNodeIds: string[];
	jobId: string | null;
	job: { status: string; touchedNodeIds: string[] } | null;
	screenshots: {
		nodeId: string;
		path: string;
		width: number;
		height: number;
	}[];
};

let env: Environment;
let claude: FakeClaudeCode;

const calls = (query = "") =>
	env.api<Page<CallApi>>(`/api/history/calls${query}`);
const run = (scenario: keyof typeof SCENARIOS) => {
	const s = SCENARIOS[scenario];
	return claude.callTool(TOOL_NAME.runScript, {
		file: scenarioPath(s.script),
		format: s.format,
	});
};

before(async () => {
	env = await startEnvironment();
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
});

describe("E2 · escritura correcta con nodos tocados", () => {
	it("la respuesta MCP declara los nodos que tocó el script", async () => {
		const r = await run("writeCreated");
		assert.equal(r.isError, false);
		assert.equal(r.out["status"], "done");
		assert.deepEqual(
			[...(r.out["touchedNodeIds"] as string[])].sort(),
			CREATED_AND_MUTATED,
		);
	});

	it("SQLite guarda la llamada como escritura, con sus nodos", async () => {
		await until(
			"la base registra la escritura",
			() =>
				env.rows("SELECT 1 FROM calls WHERE is_write = 1 AND status = 'ok'")
					.length === 1,
		);
		const [row] = env.rows<{ touched_count: number }>(
			"SELECT touched_count FROM calls WHERE is_write = 1",
		);
		assert.equal(row?.touched_count, CREATED_AND_MUTATED.length);
		const nodes = env.rows<{ node_id: string }>(
			"SELECT node_id FROM call_nodes ORDER BY node_id",
		);
		assert.deepEqual(
			nodes.map((n) => n.node_id),
			CREATED_AND_MUTATED,
		);
		const touched = env.rows<{ n: number }>(
			"SELECT count(*) AS n FROM nodes_touched",
		);
		assert.equal(touched[0]?.n, CREATED_AND_MUTATED.length);
	});

	it("la API devuelve la llamada con los nodos y el archivo de Figma para enlazarlos", async () => {
		const [item] = (await calls("?tool=figma_run_script")).items;
		assert.deepEqual(
			[...(item?.touchedNodeIds ?? [])].sort(),
			CREATED_AND_MUTATED,
		);
		assert.equal(item?.fileUrl, env.fileUrl);
	});
});

describe("E3 · script largo", () => {
	let jobId = "";

	it("pasado el plazo blando devuelve running y un jobId", async () => {
		const r = await run("longRunning");
		assert.equal(r.out["status"], "running");
		jobId = String(r.out["jobId"]);
		assert.ok(jobId.length > 0);
	});

	it("mientras no termina, SQLite y la API lo tienen en curso", async () => {
		await until(
			"el job queda registrado en curso",
			() =>
				env.rows("SELECT 1 FROM jobs WHERE status = 'running'").length === 1,
		);
		const running = (await calls("?status=running")).items;
		assert.equal(running[0]?.jobId, jobId);
		assert.equal(running[0]?.job?.status, "running");
	});

	it("figma_get_job sigue diciendo running hasta que Figma termina", async () => {
		const r = await claude.callTool(TOOL_NAME.getJob, { jobId });
		assert.equal(r.out["status"], "running");
	});

	it("al terminar Figma, figma_get_job entrega el resultado y la API lo da por terminado", async () => {
		await releaseGate(env.simulator, SCENARIOS.longRunning.reply.gate);
		await until("el job termina", async () => {
			const r = await claude.callTool(TOOL_NAME.getJob, { jobId });
			return r.out["status"] === "done";
		});
		const done = await claude.callTool(TOOL_NAME.getJob, { jobId });
		assert.deepEqual((done.out["result"] as { slept: boolean }).slept, true);
		await until(
			"la base cierra el job",
			() => env.rows("SELECT 1 FROM jobs WHERE status = 'done'").length === 1,
		);
		const [item] = (
			await calls(`?tool=figma_run_script&status=ok`)
		).items.filter((i) => i.jobId === jobId);
		assert.equal(item?.job?.status, "done");
		assert.deepEqual(item?.job?.touchedNodeIds, ["10:4"]);
	});
});

describe("E4 · captura", () => {
	let path = "";

	it("figma_screenshot deja un PNG con el tamaño del nodo por la escala en el directorio de salida", async () => {
		const r = await claude.callTool(TOOL_NAME.screenshot, {
			nodeId: SCREENSHOT_NODE,
			scale: SCREENSHOT_SCALE,
		});
		assert.equal(r.isError, false);
		path = String(r.out["path"]);
		assert.ok(path.startsWith(env.env["FCC_OUTPUT_DIR"] ?? "?"), path);
		assert.deepEqual(pngDimensions(await readFile(path)), SCREENSHOT_SIZE);
	});

	it("SQLite y la API la registran con su nodo y dimensiones", async () => {
		await until(
			"la base registra la captura",
			() => env.rows("SELECT 1 FROM captures").length === 1,
		);
		const page = await env.api<
			Page<{ shot: { nodeId: string; width: number; height: number } }>
		>("/api/history/captures");
		assert.equal(page.items[0]?.shot.nodeId, SCREENSHOT_NODE);
		assert.equal(page.items[0]?.shot.width, SCREENSHOT_SIZE.width);
	});

	it("el panel sirve la imagen", async () => {
		const inside = relative(env.env["FCC_OUTPUT_DIR"] ?? "", path);
		const r = await fetch(`${env.dashboardUrl}/screenshots/${inside}`);
		assert.equal(r.status, 200);
		assert.equal(r.headers.get("content-type"), "image/png");
		assert.deepEqual(
			pngDimensions(Buffer.from(await r.arrayBuffer())),
			SCREENSHOT_SIZE,
		);
	});
});

describe("E5 · coherencia del histórico entre MCP, API y base", () => {
	before(async () => {
		// Un error para que haya de todo: escritura, job, captura y fallo
		await run("errorRuntime");
		await until(
			"la base registra el error",
			() => env.rows("SELECT 1 FROM calls WHERE status = 'error'").length === 1,
		);
	});

	it("los conteos del resumen coinciden en las tres vías", async () => {
		const [sql] = env.rows<{ calls: number; writes: number; errors: number }>(
			"SELECT count(*) AS calls, sum(is_write) AS writes, sum(status = 'error') AS errors FROM calls",
		);
		const api = (
			await env.api<{
				summary: { calls: number; writes: number; errors: number };
			}>("/api/history/summary")
		).summary;
		const mcp = (await claude.callTool(TOOL_NAME.historySummary)).out[
			"summary"
		] as typeof api;
		for (const via of [api, mcp]) {
			assert.equal(via.calls, sql?.calls);
			assert.equal(via.writes, sql?.writes);
			assert.equal(via.errors, sql?.errors);
		}
	});

	it("los errores agrupados coinciden en las tres vías", async () => {
		type Group = { type: string; count: number };
		const sql = env.rows<Group>(
			"SELECT error_type AS type, count(*) AS count FROM calls WHERE status = 'error' GROUP BY error_type",
		);
		const api = (await env.api<Page<Group>>("/api/history/errors")).items;
		const mcp = (await claude.callTool(TOOL_NAME.historyErrors)).out[
			"items"
		] as Group[];
		const norm = (g: Group[]) => g.map((x) => `${x.type}:${x.count}`).sort();
		assert.deepEqual(norm(api), norm(sql));
		assert.deepEqual(norm(mcp), norm(sql));
	});

	it("los nodos tocados coinciden en las tres vías", async () => {
		type Node = { nodeId: string };
		const sql = env
			.rows<{ node_id: string }>("SELECT DISTINCT node_id FROM call_nodes")
			.map((n) => n.node_id);
		const api = (await env.api<Page<Node>>("/api/history/nodes")).items.map(
			(n) => n.nodeId,
		);
		const mcp = (
			(await claude.callTool(TOOL_NAME.historyNodes)).out["items"] as Node[]
		).map((n) => n.nodeId);
		assert.deepEqual(api.sort(), sql.sort());
		assert.deepEqual(mcp.sort(), sql.sort());
	});

	it("la lista de llamadas de la API tiene tantas filas como la base", async () => {
		const [sql] = env.rows<{ n: number }>("SELECT count(*) AS n FROM calls");
		assert.equal((await calls()).total, sql?.n);
	});
});
