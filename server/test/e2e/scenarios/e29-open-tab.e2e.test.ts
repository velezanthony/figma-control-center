// E29 abrir la pestaña del proyecto (D-2 B): sin la pestaña en Chrome, la primera llamada la abre (PUT /json/new), lo
// dice, comprueba la clave del archivo y, si Figma la lleva a otro, la cierra y falla; dos sesiones a la vez abren una.
// Con el Chrome falso del arnés: nunca el Chrome real ni el puerto 9222.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";

const FILE_URL = "https://www.figma.com/design/SIMULADO/Archivo";
const puts = (env: Environment) =>
	(env.simulator?.tabRequests ?? []).filter((r) => r.startsWith("PUT"));

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E29 · abrir la pestaña del proyecto", () => {
	it("sin la pestaña, figma_status la abre, responde ok y lo dice una sola vez", async () => {
		env = await startEnvironment({ figma: "noTab" });
		assert.deepEqual(env.simulator?.tabs(), []);
		const claude = await env.startClaude({ reply: null });

		const first = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(first.isError, false);
		assert.equal(first.out["ok"], true);
		assert.match(String(first.out["tabOpened"]), /abrió la pestaña/);
		assert.deepEqual(env.simulator?.tabs(), [FILE_URL]);
		assert.equal(puts(env).length, 1);

		const second = await claude.callTool(TOOL_NAME.status, {});
		assert.equal(second.out["tabOpened"], undefined);
		assert.equal(puts(env).length, 1);
	});

	it("dos sesiones a la vez abren una sola pestaña", async () => {
		env = await startEnvironment({ figma: "noTab" });
		const [a, b] = await Promise.all([
			env.startClaude({ reply: null }),
			env.startClaude({ reply: null }),
		]);
		const [ra, rb] = await Promise.all([
			a.callTool(TOOL_NAME.status, {}),
			b.callTool(TOOL_NAME.status, {}),
		]);
		assert.equal(ra.out["ok"], true);
		assert.equal(rb.out["ok"], true);
		assert.equal(puts(env).length, 1);
		assert.deepEqual(env.simulator?.tabs(), [FILE_URL]);
	});

	it("si Figma la lleva a otro archivo, la cierra y la herramienta falla con FigmaTabNotFound", async () => {
		env = await startEnvironment({
			figma: "noTab",
			openedTabLandsOn: () => "https://www.figma.com/design/EQUIVOCADO/Otro",
		});
		const claude = await env.startClaude({ reply: null });
		const r = await claude.callTool(TOOL_NAME.status, {});
		const error = r.out["error"] as { type: string; message: string } | null;
		assert.equal(error?.type, "FigmaTabNotFound");
		assert.match(error?.message ?? "", /EQUIVOCADO/);
		assert.deepEqual(env.simulator?.tabs(), []);
		assert.equal(
			(env.simulator?.tabRequests ?? []).filter((q) =>
				q.includes("/json/close/"),
			).length,
			1,
		);
	});
});
