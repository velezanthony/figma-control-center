// E39 un figma_run_script que supera el plazo blando y el cliente que se va: el job queda failed/Interrupted con un
// motivo que no afirma que el script no terminó (pudo seguir o acabar en Figma). Servidor MCP real + SQLite.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";

const LONG_SCRIPT_TIMEOUT_MS = 60_000;

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E39 · script suelto interrumpido", () => {
	it("al irse el cliente, el job queda failed/Interrupted y el motivo dice que el script pudo terminar en Figma", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.runScript, {
			file: scenarioPath(SCENARIOS.longRunning.script),
			format: SCENARIOS.longRunning.format,
			timeoutMs: LONG_SCRIPT_TIMEOUT_MS,
		});
		assert.equal(started.out["status"], "running");
		const jobId = String(started.out["jobId"]);
		const job = () =>
			env.rows<{
				status: string;
				error_type: string | null;
				error_message: string | null;
			}>(
				`SELECT status, error_type, error_message FROM jobs WHERE id = '${jobId}'`,
			)[0];
		assert.equal(job()?.status, "running");

		await claude.close();
		await until(
			"el job queda interrumpido en SQLite",
			() => job()?.status === "failed",
		);
		await releaseGate(env.simulator, SCENARIOS.longRunning.reply.gate);

		assert.equal(job()?.error_type, "Interrupted");
		const reason = job()?.error_message ?? "";
		assert.doesNotMatch(reason, /no llegó a terminar/);
		assert.match(reason, /pudo seguir o terminar en Figma/);
		assert.match(reason, /no puede saberlo/);
		assert.match(reason, /figma_metadata/);
	});
});
