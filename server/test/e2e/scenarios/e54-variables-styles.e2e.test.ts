// E54 variables y estilos: figma_variables y figma_styles dejan el JSON completo en reads/ de la carpeta
// de salida del proyecto, la respuesta trae un resumen pequeño, la lectura corre por el flujo de jobs (status, jobId) y
// el histórico guarda la ruta. Servidor MCP real + SQLite, con el simulador de Figma.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	StylesValueSchema,
	VariablesValueSchema,
} from "../../contracts/figma-values.ts";
import { DEFAULT_WORLD } from "../../fixtures/scenarios/world.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import type { FakeClaudeCode } from "../../harness/fake-claude.ts";
import { until } from "../../harness/wait.ts";

// El resumen es para la conversación: unos conteos, nunca la lista
const MAX_SUMMARY_CHARS = 300;

let env: Environment;
let claude: FakeClaudeCode;
before(async () => {
	env = await startEnvironment();
	claude = await env.startClaude({ reply: null });
});
after(async () => {
	await env?.stop();
});

const insideOutput = (path: string) =>
	relative(env.projects[0]?.outputDir ?? "", path)
		.split("\\")
		.join("/");

describe("E54 · variables y estilos", () => {
	let variablesPath = "";
	let jobId = "";

	it("figma_variables deja colecciones, modos, valores y alias en reads/ y responde un resumen pequeño con su job", async () => {
		const r = await claude.callTool(TOOL_NAME.variables, {});
		assert.equal(r.isError, false);
		assert.equal(r.out["ok"], true);
		assert.equal(r.out["status"], "done");
		jobId = String(r.out["jobId"]);
		assert.ok(jobId.length > 0);
		assert.deepEqual(r.out["touchedNodeIds"], []);
		variablesPath = String(r.out["path"]);
		assert.match(
			insideOutput(variablesPath),
			/^reads\/variables_[\d-]+_\d{6}\.json$/,
		);
		const file = VariablesValueSchema.parse(
			JSON.parse(await readFile(variablesPath, "utf8")),
		);
		assert.deepEqual(file, DEFAULT_WORLD.catalog.variables);
		const tokens = file.collections.find((c) => c.name === "Tokens");
		assert.deepEqual(
			tokens?.modes.map((m) => m.name),
			["Claro", "Oscuro"],
		);
		assert.deepEqual(tokens?.variables[0]?.valuesByMode["2:1"], {
			alias: { id: "VariableID:1:3", name: "gris/900" },
		});
		assert.deepEqual(r.out["summary"], {
			collections: 2,
			variables: { Primitives: 1, Tokens: 2 },
			modes: { Primitives: 1, Tokens: 2 },
		});
		assert.ok(JSON.stringify(r.out["summary"]).length < MAX_SUMMARY_CHARS);
	});

	it("con nodeId solo salen las variables ligadas en ese nodo y dónde", async () => {
		const r = await claude.callTool(TOOL_NAME.variables, { nodeId: "10:1" });
		const file = VariablesValueSchema.parse(
			JSON.parse(await readFile(String(r.out["path"]), "utf8")),
		);
		assert.deepEqual(file.bindings, [
			{ nodeId: "10:1", field: "fills", variableId: "VariableID:1:2" },
		]);
		assert.deepEqual(
			file.collections.map((c) => c.variables.map((v) => v.name)),
			[["color/fondo"]],
		);
	});

	it("el job de la lectura se puede consultar con figma_get_job", async () => {
		const job = await claude.callTool(TOOL_NAME.getJob, { jobId });
		assert.equal(job.out["status"], "done");
		assert.equal((job.out["result"] as { path: string }).path, variablesPath);
	});

	it("figma_styles deja los estilos en reads/ con su resumen por tipo", async () => {
		const r = await claude.callTool(TOOL_NAME.styles, {});
		assert.equal(r.out["ok"], true);
		const file = StylesValueSchema.parse(
			JSON.parse(await readFile(String(r.out["path"]), "utf8")),
		);
		assert.deepEqual(file.styles, DEFAULT_WORLD.catalog.styles);
		assert.deepEqual(r.out["summary"], {
			paint: 1,
			text: 1,
			effect: 0,
			grid: 0,
		});
	});

	it("el histórico guarda la llamada con la ruta del fichero y su job, como lectura", async () => {
		await until(
			"la base registra la lectura",
			() =>
				env.rows(
					`SELECT 1 FROM calls WHERE tool = 'figma_variables' AND result_path = '${variablesPath}'`,
				).length === 1,
		);
		const [row] = env.rows<{
			job_id: string;
			is_write: number;
			status: string;
		}>(
			`SELECT job_id, is_write, status FROM calls WHERE result_path = '${variablesPath}'`,
		);
		assert.deepEqual(row, { job_id: jobId, is_write: 0, status: "ok" });
		await until(
			"el job de la lectura queda hecho",
			() =>
				env.rows(`SELECT 1 FROM jobs WHERE id = '${jobId}' AND status = 'done'`)
					.length === 1,
		);
	});
});
