// E28 los proyectos salen solo del registro (D-1): FIGMA_FILE_URL en el entorno avisa y no crea ninguno; con varios
// proyectos en alcance y ninguno elegido las herramientas dan error de uso con los ids y los nombres. Panel y MCP
// reales, sin Figma ni Chrome.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { until } from "../../harness/wait.ts";

const FILE_URL = "https://www.figma.com/design/SIMULADO/Archivo";
const OTHER_URL = "https://www.figma.com/design/OTRO/Otro";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

// Los proyectos pedidos, cada uno con su archivo de Figma y su carpeta para que no choquen; devuelve sus ids
const projectsNamed = (names: readonly string[]) =>
	names.map((name, i) => ({
		name,
		projectDir: "/p",
		fileUrl: i === 0 ? FILE_URL : `${OTHER_URL}${i}`,
	}));

describe("E28 · proyectos sin .env", () => {
	it("con FIGMA_FILE_URL en el entorno el panel avisa de que ya no se usa y no lista ningún proyecto por ello", async () => {
		env = await startEnvironment({
			figma: "down",
			projects: projectsNamed(["ejemplo"]),
			extraEnv: { FIGMA_FILE_URL: OTHER_URL },
		});
		await until("el panel avisó", () =>
			/FIGMA_FILE_URL ya no se usa/.test(env.dashboardOutput()),
		);
		assert.doesNotMatch(env.dashboardOutput(), /Base SQLite/);
		const listed = await env.api<{ entries: { name: string }[] }>(
			"/api/projects/list",
		);
		assert.deepEqual(
			listed.entries.map((e) => e.name),
			["ejemplo"],
		);
	});

	it("con varios proyectos en alcance y ninguno elegido, las herramientas dan error de uso con los ids y cómo elegir", async () => {
		env = await startEnvironment({
			figma: "up",
			projects: projectsNamed(["ejemplo", "cliente"]),
		});
		const claude = await env.startClaude({ reply: null });
		for (const [tool, args] of [
			[TOOL_NAME.status, {}],
			[TOOL_NAME.runScript, { code: "return 1" }],
			[TOOL_NAME.historySummary, {}],
		] as const) {
			const r = await claude.callTool(tool, args);
			assert.equal(r.isError, true, tool);
			assert.match(r.text, /1 \(«ejemplo»\)/, tool);
			assert.match(r.text, /2 \(«cliente»\)/, tool);
			assert.match(r.text, /FCC_PROJECTS/, tool);
		}
		// Nada tocó Figma ni dejó una sesión en el histórico de ningún proyecto
		assert.equal(env.simulator?.expressions.length, 0);
	});

	it("con FCC_PROJECTS elegido, el MCP trabaja con ese proyecto aunque haya varios", async () => {
		env = await startEnvironment({
			figma: "up",
			projects: projectsNamed(["ejemplo", "cliente"]),
			extraEnv: { FCC_PROJECTS: "1" },
		});
		const claude = await env.startClaude({ reply: null });
		const status = await claude.callTool(TOOL_NAME.status, {});
		assert.notEqual(status.isError, true);
		assert.equal(status.out["figmaReady"], true);
	});
});
