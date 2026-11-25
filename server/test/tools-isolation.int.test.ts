// CA-5 en la frontera MCP: cada herramienta figma_history_* de un servidor atado al proyecto A, sobre una base que
// también guarda el proyecto B con las mismas claves, no devuelve nada del B (y al revés).
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerHistoryTools } from "#adapters/mcp/history-tools.ts";
import {
	A,
	B,
	calls,
	OWNERS,
	type Owner,
	other,
	world,
} from "#adapters/sqlite/testing/two-projects.ts";
import { createHistory } from "#application/history.ts";
import { makeHistoryDiff } from "#application/history-diff.ts";
import { makeHistoryScript } from "#application/history-script.ts";
import { InMemoryResultStore } from "#application/testing/in-memory-ports.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";

let dir: string;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), "figma-aislamiento-mcp-"));
});
after(() => rm(dir, { recursive: true, force: true }));

// Un cliente MCP por proyecto, cada uno con su servidor sobre el histórico de ese proyecto
async function clients() {
	const w = world(join(dir, "mcp.db"));
	const open = async (o: Owner) => {
		const server = new McpServer({ name: "test", version: "0.0.0" });
		const history = createHistory({
			query: w.of(o).query,
			now: () => new Date("2026-06-02T00:00:00.000Z"),
			maxRows: 50,
			stepExcerptBytes: 300,
		});
		registerHistoryTools(
			server,
			history,
			undefined,
			makeHistoryScript({ history, store: new InMemoryResultStore() }),
			makeHistoryDiff({
				history,
				store: new InMemoryResultStore(),
				inlineLines: 200,
			}),
		);
		const client = new Client({ name: "test", version: "0.0.0" });
		const [a, b] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(a), client.connect(b)]);
		return async (name: string, args: Record<string, unknown> = {}) => {
			const r = await client.callTool({ name, arguments: args });
			return {
				isError: r.isError === true,
				out: r.structuredContent as Record<string, unknown>,
				text: JSON.stringify(r.structuredContent ?? r.content),
			};
		};
	};
	return { A: await open(A), B: await open(B) };
}

describe("figma_history_attempts y figma_history_script: solo el proyecto de su servidor", () => {
	for (const o of OWNERS) {
		it(`el servidor del proyecto ${o.tag} ve sus intentos y no el contenido ni el hash del otro`, async () => {
			const both = await clients();
			const c = both[o.tag];
			const y = other(o).tag;
			const targets = await c(TOOL_NAME.historyAttempts);
			assert.equal(targets.out["mode"], "targets");
			assert.equal(targets.out["total"], 1);
			const list = await c(TOOL_NAME.historyAttempts, { target: "mismo" });
			// La base de este archivo se siembra en cada llamada a clients(): hay al menos los dos del test
			assert.ok(Number(list.out["total"]) >= 2);
			assert.doesNotMatch(list.text, new RegExp(`paso-${y}`));
			const items = list.out["items"] as {
				id: number;
				scripts: { role: string; sha256: string }[];
			}[];
			const mine = await c(TOOL_NAME.historyScript, {
				attempt: items[0]?.id,
				role: "step",
			});
			assert.equal(mine.isError, false);
			const theirs = await both[other(o).tag](TOOL_NAME.historyAttempts, {
				target: "mismo",
			});
			const theirSha = (
				theirs.out["items"] as { scripts: { role: string; sha256: string }[] }[]
			)[0]?.scripts.find((s) => s.role === "step")?.sha256;
			const crossed = await c(TOOL_NAME.historyScript, { sha256: theirSha });
			assert.equal(
				crossed.isError,
				true,
				"el hash del otro proyecto no existe aquí",
			);
		});
	}
});

describe("figma_history_*: cada herramienta ve solo el proyecto de su servidor", () => {
	for (const o of OWNERS) {
		const x = o.tag;
		const y = other(o).tag;
		it(`el servidor del proyecto ${x} no ve nada del ${y} en ninguna de las seis herramientas`, async () => {
			const c = (await clients())[o.tag];
			const mine = new RegExp(`(pintar-${x}|Boom-${x}|${x}:)`);
			const theirs = new RegExp(
				`(pintar-${y}|Boom-${y}|${y}:|build-${y}|${y}/)`,
			);

			const summary = await c(TOOL_NAME.historySummary);
			assert.equal(summary.isError, false);
			assert.equal(
				(summary.out["summary"] as { calls: number }).calls,
				calls(o) + 2,
			);
			assert.doesNotMatch(summary.text, theirs);

			const errors = await c(TOOL_NAME.historyErrors);
			assert.equal(errors.out["total"], 1);
			assert.match(errors.text, new RegExp(`Boom-${x}`));
			assert.doesNotMatch(errors.text, theirs);

			const nodes = await c(TOOL_NAME.historyNodes);
			assert.equal(nodes.out["total"], 3);
			assert.match(nodes.text, mine);
			assert.doesNotMatch(nodes.text, theirs);

			const sessions = await c(TOOL_NAME.historySessions);
			assert.equal(sessions.out["total"], 1);
			assert.doesNotMatch(sessions.text, theirs);

			const own = await c(TOOL_NAME.historySearch, { query: "pintar" });
			assert.equal(own.out["total"], calls(o));
			assert.doesNotMatch(own.text, theirs);
			const foreign = await c(TOOL_NAME.historySearch, {
				query: `Boom-${y}`,
			});
			assert.equal(foreign.out["total"], 0);
			const foreignNode = await c(TOOL_NAME.historySearch, {
				query: `${y}:solo`,
			});
			assert.equal(foreignNode.out["total"], 0);

			const call = await c(TOOL_NAME.historyCall, { callId: "c1" });
			assert.match(call.text, new RegExp(`pintar-${x}1`));
			assert.doesNotMatch(call.text, theirs);
			const batch = await c(TOOL_NAME.historyCall, { callId: "c3" });
			assert.equal(batch.isError, false);
			assert.doesNotMatch(batch.text, theirs);
			// Una llamada que solo existe en el otro proyecto no existe aquí
			const missing = await c(TOOL_NAME.historyCall, {
				callId: o === A ? "c4" : "no-existe",
			});
			assert.equal(missing.isError, true);
		});
	}

	it("los dos proyectos reciben cada uno su propio extracto del mismo paso (mismo job, mismo índice)", async () => {
		const both = await clients();
		for (const o of [A, B]) {
			const r = await both[o.tag](TOOL_NAME.historyCall, {
				callId: "cs",
				step: 0,
			});
			assert.equal(r.isError, false);
			assert.match(r.text, new RegExp(`"lote":"${o.tag}"`));
			assert.doesNotMatch(r.text, new RegExp(`"lote":"${other(o).tag}"`));
			const steps = await both[o.tag](TOOL_NAME.historyCall, { callId: "cs" });
			assert.match(steps.text, new RegExp(`lote-${o.tag}\\.js`));
			assert.doesNotMatch(steps.text, new RegExp(`lote-${other(o).tag}`));
		}
	});
});
