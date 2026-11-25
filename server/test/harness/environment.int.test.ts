import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { type Environment, startEnvironment } from "./environment.ts";
import { until } from "./wait.ts";

const alive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("arnés de procesos reales (sin panel)", () => {
	let env: Environment;
	let mainPid = 0;

	before(async () => {
		env = await startEnvironment({ dashboard: false, chatAgent: true });
	});

	after(async () => {
		await env?.stop();
	});

	it("el servidor MCP real habla con el simulador de Figma y registra la llamada en SQLite", async () => {
		const claude = await env.startClaude({ reply: null });
		assert.ok(claude.pid !== null);
		mainPid = claude.pid;
		const status = await claude.callTool(TOOL_NAME.status);
		assert.equal(status.out["fileName"], "Archivo de ejemplo");
		await until(
			"la base registra la llamada",
			() => env.rows("SELECT tool FROM calls WHERE status = 'ok'").length === 1,
		);
	});

	it("la sesión se registra con la huella de su token de chat", () => {
		const rows = env.rows<{ n: number }>(
			"SELECT count(*) AS n FROM sessions WHERE chat_token_hash IS NOT NULL",
		);
		assert.equal(rows[0]?.n, 1);
	});

	it("al parar el entorno no queda ningún proceso ni carpeta", async () => {
		const second = await startEnvironment({ dashboard: false });
		const claude = await second.startClaude({ reply: null });
		const pid = claude.pid;
		assert.ok(pid !== null);
		await second.stop();
		await until("el servidor MCP termina", () => !alive(pid));
		assert.equal(existsSync(join(second.dir)), false);
	});

	it("los procesos del primer entorno siguen vivos hasta pararlo", () => {
		assert.equal(alive(mainPid), true);
	});
});
