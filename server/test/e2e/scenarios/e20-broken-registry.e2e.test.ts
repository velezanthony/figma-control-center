// E20 registro de proyectos roto: el panel arranca igual (así se puede arreglar) y «Proyectos» recibe el problema con
// la ruta de la base; el MCP, sin ningún proyecto, arranca y lo explica. Sin Figma ni Chrome.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { addProjects } from "../../harness/projects.ts";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

// La base única es el registro: una ilegible no tumba el panel ni el MCP, y se cuenta con su ruta
const startBroken = async (): Promise<string> => {
	let path = "";
	env = await startEnvironment({
		figma: "down",
		prepareDb: (file) => {
			path = file;
			return writeFile(file, "esto no es una base SQLite");
		},
	});
	return path;
};

type Listed = { entries: { id: string; name: string }[]; problems: string[] };

describe("E20 · registro de proyectos roto", () => {
	it("con la base ilegible el panel arranca sin proyectos y cuenta el problema con la ruta; el MCP arranca y lo explica", async () => {
		const path = await startBroken();
		const listed = await env.api<Listed>("/api/projects/list");
		assert.deepEqual(listed.entries, []);
		assert.equal(listed.problems.length, 1);
		assert.ok(listed.problems[0]?.includes(path));
		// Sin ningún proyecto el servidor MCP arranca y sus herramientas explican qué hacer
		const claude = await env.startClaude({ reply: null });
		const status = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(status.isError, true);
		assert.match(status.text, /No hay ningún proyecto/);
		assert.ok(status.text.includes(path));
	});

	it("con una fila inválida (editada a mano), se ignora esa fila y el resto sigue", async () => {
		env = await startEnvironment({
			figma: "down",
			prepareDb: async (file) => {
				await addProjects(file, join(dirname(file), "salida"), [
					{
						name: "Buena",
						projectDir: "/p",
						fileUrl: "https://www.figma.com/design/B/B",
					},
				]);
				const db = openFigmaDatabase(file);
				try {
					db.$client
						.prepare(
							"INSERT INTO projects(name, project_dir, file_url, file_key, output_dir) VALUES ('Mala','/p','esto no es una url','K','/mala')",
						)
						.run();
				} finally {
					db.$client.close();
				}
			},
		});
		// Con una sola fila válida, el MCP trabaja con ella
		const claude = await env.startClaude({ reply: null });
		const status = await claude.callTool(TOOL_NAME.status, {});
		assert.notEqual(status.isError, true);
		const listed = await env.api<Listed>("/api/projects/list");
		assert.deepEqual(
			listed.entries.map((e) => e.name),
			["Buena"],
		);
		assert.equal(listed.problems.length, 1);
		assert.match(listed.problems[0] ?? "", /proyecto 2/);
	});
});
