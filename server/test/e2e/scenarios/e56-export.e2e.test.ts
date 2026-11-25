// E56 exportar 3 nodos en SVG y PNG: un fichero por nodo en exports/ con su tamaño, el índice en reads/,
// error de uso con más nodos que el tope (FIGMA_EXPORT_MAX_NODES) y error con el id de un nodo que no existe.
// Servidor MCP real, con el simulador de Figma; el tope se baja a 3 con el entorno.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	EXPORT_SIGNATURE,
	pngDimensions,
} from "../../contracts/figma-values.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";

const MAX_NODES = 3;
const NODES = ["10:1", "10:3", "10:4"];

type Entry = {
	nodeId: string;
	path: string;
	bytes: number;
	width?: number;
	height?: number;
};

let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	env = await startEnvironment({
		extraEnv: { FIGMA_EXPORT_MAX_NODES: String(MAX_NODES) },
	});
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
});

const indexOf = async (out: Record<string, unknown>) =>
	JSON.parse(await readFile(String(out["path"]), "utf8")) as Entry[];
const insideOutput = (path: string) =>
	relative(env.projects[0]?.outputDir ?? "", path)
		.split("\\")
		.join("/");

describe("E56 · exportar nodos", () => {
	it("tres nodos en SVG: un fichero por nodo en exports/ con su tamaño en bytes y el índice en reads/", async () => {
		const r = await claude.callTool(TOOL_NAME.export, {
			nodeIds: NODES,
			format: "SVG",
		});
		assert.equal(r.isError, false);
		assert.equal(r.out["ok"], true);
		assert.match(insideOutput(String(r.out["path"])), /^reads\/export_/);
		const index = await indexOf(r.out);
		assert.deepEqual(
			index.map((e) => e.nodeId),
			NODES,
		);
		let total = 0;
		for (const entry of index) {
			assert.match(insideOutput(entry.path), /^exports\/[\d-]+\/.+\.svg$/);
			const bytes = await readFile(entry.path);
			assert.equal(EXPORT_SIGNATURE.SVG(bytes), true);
			assert.equal((await stat(entry.path)).size, entry.bytes);
			assert.equal(entry.width, undefined);
			total += entry.bytes;
		}
		assert.deepEqual(r.out["summary"], { files: 3, bytes: total });
	});

	it("tres nodos en PNG a escala 2: ancho y alto de cada uno en el índice", async () => {
		const r = await claude.callTool(TOOL_NAME.export, {
			nodeIds: NODES,
			format: "PNG",
			scale: 2,
		});
		const index = await indexOf(r.out);
		assert.deepEqual(
			index.map((e) => [e.nodeId, e.width, e.height]),
			[
				["10:1", 240, 160],
				["10:3", 128, 64],
				["10:4", 48, 48],
			],
		);
		for (const entry of index) {
			assert.deepEqual(pngDimensions(await readFile(entry.path)), {
				width: entry.width,
				height: entry.height,
			});
		}
	});

	it("más nodos que el tope es un error de uso que nombra el ajuste", async () => {
		const r = await claude.callTool(TOOL_NAME.export, {
			nodeIds: [...NODES, "10:2"],
			format: "PNG",
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /FIGMA_EXPORT_MAX_NODES/);
		assert.match(r.text, new RegExp(String(MAX_NODES)));
	});

	it("un id que no existe es un error con el id y no exporta nada", async () => {
		const r = await claude.callTool(TOOL_NAME.export, {
			nodeIds: ["10:1", "99:9"],
			format: "PNG",
		});
		assert.equal(r.isError, true);
		assert.equal(r.out["ok"], false);
		const error = r.out["error"] as { type: string; message: string };
		assert.equal(error.type, "NodeNotFound");
		assert.match(error.message, /99:9/);
	});

	it("las exportaciones no entran en Capturas del panel", async () => {
		assert.deepEqual(env.rows("SELECT 1 FROM captures"), []);
	});
});
