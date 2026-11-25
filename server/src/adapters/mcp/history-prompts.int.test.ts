import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { registerHistoryPrompts } from "./history-prompts.ts";

const client = new Client({ name: "test", version: "0.0.0" });

before(async () => {
	const server = new McpServer({ name: "test", version: "0.0.0" });
	registerHistoryPrompts(server);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
});

const textOf = async (name: string, args?: Record<string, string>) => {
	const r = await client.getPrompt({ name, ...(args && { arguments: args }) });
	assert.equal(r.messages.length, 1);
	assert.equal(r.messages[0]?.role, "user");
	const content = r.messages[0]?.content;
	assert.equal(content?.type, "text");
	return content?.type === "text" ? content.text : "";
};

describe("prompts MCP del histórico (los comandos /)", () => {
	it("se listan los siete, con descripción, y piden argumentos solo session, attempts y attempt-changes", async () => {
		const { prompts } = await client.listPrompts();
		assert.deepEqual(prompts.map((p) => p.name).sort(), [
			"attempt-changes",
			"attempts",
			"costly-screens",
			"errors-today",
			"last-hour",
			"nodes-today",
			"session",
		]);
		for (const p of prompts)
			assert.ok(p.description && p.description.length > 20, p.name);
		const session = prompts.find((p) => p.name === "session");
		assert.deepEqual(
			session?.arguments?.map((a) => [a.name, a.required]),
			[["id", true]],
		);
		assert.equal(
			prompts.find((p) => p.name === "last-hour")?.arguments,
			undefined,
		);
		assert.equal(
			prompts.find((p) => p.name === "costly-screens")?.arguments,
			undefined,
		);
		assert.deepEqual(
			prompts
				.find((p) => p.name === "attempts")
				?.arguments?.map((a) => [a.name, a.required]),
			[["target", true]],
		);
		assert.deepEqual(
			prompts
				.find((p) => p.name === "attempt-changes")
				?.arguments?.map((a) => [a.name, a.required]),
			[
				["target", true],
				["a", true],
				["b", true],
			],
		);
	});

	it("attempts pide los intentos del objetivo con lo que cambió en cada uno y deja el diff para después", async () => {
		const text = await textOf("attempts", { target: "home" });
		assert.match(text, /home/);
		assert.match(text, new RegExp(TOOL_NAME.historyAttempts));
		assert.match(text, /target/);
		assert.match(text, new RegExp(TOOL_NAME.historyDiff));
		assert.match(text, /no (pidas|cargues|vuelques)/i);
	});

	it("attempt-changes localiza los dos intentos por su número y los compara con figma_history_diff", async () => {
		const text = await textOf("attempt-changes", {
			target: "home",
			a: "2",
			b: "5",
		});
		assert.match(text, /home/);
		assert.match(text, /intento 2/);
		assert.match(text, /intento 5/);
		assert.match(text, new RegExp(TOOL_NAME.historyAttempts));
		assert.match(text, new RegExp(TOOL_NAME.historyDiff));
		assert.match(text, /from/);
		assert.match(text, /to/);
	});

	it("costly-screens pide los objetivos más intentados de la última semana", async () => {
		const text = await textOf("costly-screens");
		assert.match(text, new RegExp(TOOL_NAME.historyAttempts));
		assert.match(text, /since/);
		assert.match(text, /semana/i);
		assert.match(text, /intentos/);
	});

	it("attempts y attempt-changes sin sus argumentos se rechazan", async () => {
		await assert.rejects(client.getPrompt({ name: "attempts" }));
		await assert.rejects(
			client.getPrompt({
				name: "attempt-changes",
				arguments: { target: "x" },
			}),
		);
	});

	it("last-hour manda empezar por el resumen de la última hora y dejar el detalle para después", async () => {
		const text = await textOf("last-hour");
		assert.match(text, new RegExp(TOOL_NAME.historySummary));
		assert.match(text, /last_hour/);
		assert.match(text, /callId/);
		assert.match(text, /nodos?/i);
		assert.match(text, new RegExp(TOOL_NAME.historyCall));
		assert.match(text, /no (pidas|cargues|vuelques)/i);
	});

	it("errors-today y nodes-today usan el rango de hoy y su herramienta", async () => {
		const errores = await textOf("errors-today");
		assert.match(errores, /today/);
		assert.match(errores, new RegExp(TOOL_NAME.historyErrors));
		const nodes = await textOf("nodes-today");
		assert.match(nodes, /today/);
		assert.match(nodes, new RegExp(TOOL_NAME.historyNodes));
	});

	it("session lleva el id pedido a las consultas", async () => {
		const text = await textOf("session", { id: "abc-123" });
		assert.match(text, /abc-123/);
		assert.match(text, new RegExp(TOOL_NAME.historySummary));
		assert.match(text, /sessionId/);
	});

	it("el prompt session sin id se rechaza", async () => {
		await assert.rejects(client.getPrompt({ name: "session" }));
	});

	it("todas las herramientas que nombran los prompts existen en el catálogo", async () => {
		const known = new Set<string>(Object.values(TOOL_NAME));
		const texts = [
			await textOf("last-hour"),
			await textOf("errors-today"),
			await textOf("nodes-today"),
			await textOf("session", { id: "x" }),
			await textOf("attempts", { target: "x" }),
			await textOf("attempt-changes", { target: "x", a: "1", b: "2" }),
			await textOf("costly-screens"),
		];
		for (const text of texts) {
			for (const m of text.matchAll(/figma_[a-z_]+/g))
				assert.ok(known.has(m[0]), `${m[0]} no existe`);
		}
	});
});
