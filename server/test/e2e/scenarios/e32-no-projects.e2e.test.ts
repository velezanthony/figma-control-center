// E32 el servidor MCP arranca siempre: sin proyecto (registro vacío, roto o inexistente) toda herramienta responde el
// error de uso que manda a «Proyectos» con la URL del panel; un proyecto dado de alta (o borrado) con el servidor ya
// arrancado se nota en la siguiente llamada, sin reiniciar. MCP y panel reales, sin Figma ni Chrome.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { until } from "../../harness/wait.ts";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

// Sin proyectos: la base única vacía, o ilegible (devuelve su ruta)
const startWith = async (
	broken: boolean,
	extraEnv: Record<string, string> = {},
): Promise<string> => {
	let path = "";
	env = await startEnvironment({
		figma: "up",
		projects: [],
		extraEnv,
		...(broken && {
			prepareDb: (file: string) => {
				path = file;
				return writeFile(file, "esto no es una base SQLite");
			},
		}),
	});
	return path;
};

const TOOLS_WITHOUT_PROJECT: ReadonlyArray<readonly [string, object]> = [
	[TOOL_NAME.status, {}],
	[TOOL_NAME.runScript, { code: "return 1" }],
	[TOOL_NAME.screenshot, { nodeId: "1:2" }],
	[TOOL_NAME.metadata, {}],
	[TOOL_NAME.getJob, { jobId: "x" }],
	[TOOL_NAME.historySummary, {}],
	[TOOL_NAME.chatReply, { chat_id: "c", text: "hola" }],
];

async function expectNoProject(): Promise<void> {
	const claude = await env.startClaude({ reply: null });
	for (const [tool, args] of TOOLS_WITHOUT_PROJECT) {
		const r = await claude.callTool(tool, args as Record<string, unknown>);
		assert.equal(r.isError, true, tool);
		assert.match(r.text, /^No hay ningún proyecto\./, tool);
		assert.match(r.text, /"Proyectos"/, tool);
		assert.ok(r.text.includes(env.dashboardUrl), `${tool}: URL del panel`);
	}
	// Nada tocó Figma
	assert.equal(env.simulator?.expressions.length, 0);
}

const saveProject = (name: string) =>
	fetch(`${env.dashboardUrl}/api/projects/save`, {
		method: "POST",
		headers: { Origin: env.dashboardUrl, "Content-Type": "application/json" },
		body: JSON.stringify({
			entry: {
				name,
				projectDir: env.dir,
				fileUrl: env.fileUrl,
				outputDir: join(env.dir, "nuevo-salida"),
			},
		}),
	});

describe("E32 · el servidor MCP sin proyectos", () => {
	it("con el registro vacío arranca y cada herramienta manda a «Proyectos» con la URL del panel", async () => {
		await startWith(false);
		await expectNoProject();
	});

	it("con la base ilegible arranca y el error cuenta el problema con la ruta", async () => {
		const path = await startWith(true);
		const claude = await env.startClaude({ reply: null });
		const r = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(r.isError, true);
		assert.match(r.text, /^No hay ningún proyecto\./);
		assert.ok(r.text.includes(path));
	});

	it("un proyecto dado de alta después se usa sin reiniciar, y al borrarlo vuelve el error", async () => {
		await startWith(false);
		const claude = await env.startClaude({ reply: null });
		const before = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(before.isError, true);

		const saved = await saveProject("Nuevo");
		assert.equal(saved.status, 200);

		const after = await claude.callTool(TOOL_NAME.status, {});
		assert.notEqual(after.isError, true, after.text);
		assert.equal(after.out["figmaReady"], true);
		// La sesión se anotó en la base del proyecto nuevo
		const db = openFigmaDatabase(env.dbPath, {
			queryOnly: true,
		});
		try {
			assert.equal(
				db.$client.prepare("SELECT 1 FROM sessions").all().length,
				1,
			);
		} finally {
			db.$client.close();
		}

		const listed = await env.api<{ entries: { id: string }[] }>(
			"/api/projects/list",
		);
		const id = listed.entries[0]?.id;
		assert.ok(id);
		const deleted = await fetch(`${env.dashboardUrl}/api/projects/delete`, {
			method: "POST",
			headers: {
				Origin: env.dashboardUrl,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ id }),
		});
		assert.equal(deleted.status, 200);
		const gone = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(gone.isError, true);
		assert.match(gone.text, /^No hay ningún proyecto\./);
	});

	it("un agente de chat sin ninguna llamada: el proyecto dado de alta lo registra solo, por el latido", async () => {
		// Un agente siempre lleva su proyecto: el 1, que aún no existe y es el que dará la base al primero
		await startWith(false, { FCC_PROJECTS: "1", FCC_CHAT_AGENT: "1" });
		await env.startClaude({ reply: null });
		assert.equal((await saveProject("Nuevo")).status, 200);
		await until("la sesión quedó registrada con chat", () => {
			const db = openFigmaDatabase(env.dbPath, { queryOnly: true });
			try {
				return (
					db.$client
						.prepare("SELECT 1 FROM sessions WHERE chat_token_hash IS NOT NULL")
						.all().length === 1
				);
			} finally {
				db.$client.close();
			}
		});
	});
});
