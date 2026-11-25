// E25 figma_build responde en cuanto acepta el lote (jobId y plan) y se puede cancelar antes de que acabe el primer
// paso; el estado final se cuenta con figma_get_job y waitMs. Sin Figma ni Chrome: simulador.
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

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

const step = (key: "buildStepOkA" | "buildStepOkB" | "buildStepSlow") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E25 · jobId al arrancar y cancelar sin esperar", () => {
	it("lote de 3 pasos cancelado antes de que acabe el primero: respuestas inmediatas y final contable con waitMs", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		// El primer paso está retenido en el simulador: que figma_build responda prueba que no espera al final
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepSlow"),
				step("buildStepOkA"),
				step("buildStepOkB"),
			],
		});
		assert.equal(started.out["status"], "running");
		const jobId = String(started.out["jobId"]);
		assert.equal((started.out["steps"] as unknown[]).length, 3);
		await until(
			"el primer paso espera en la puerta",
			() => env.simulator?.waiting(SLOW_GATE) === 1,
		);

		const now = await claude.callTool(TOOL_NAME.cancelJob, { jobId });
		assert.equal(now.out["cancelRequested"], true);
		assert.equal(now.out["status"], "running");
		assert.equal(
			(now.out["progress"] as { done: number }).done,
			0,
			"el primer paso aún no ha acabado",
		);

		// Con waitMs corto, sin que el paso acabe, vence y devuelve el estado en marcha
		const waiting = await claude.callTool(TOOL_NAME.getJob, {
			jobId,
			waitMs: 50,
		});
		assert.equal(waiting.out["status"], "running");

		await releaseGate(env.simulator, SLOW_GATE);
		const final = await claude.waitJob(jobId);
		assert.equal(final.out["status"], "cancelled");
		assert.deepEqual(final.out["progress"], {
			done: 1,
			total: 3,
			cancelled: 2,
			skipped: 0,
			current: null,
		});
		assert.deepEqual(
			(final.out["steps"] as { status: string }[]).map((s) => s.status),
			["done", "cancelled", "cancelled"],
		);
	});

	it("un error de validación llega en la misma respuesta, sin job y sin enviar nada a Figma", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const sent = env.simulator?.expressions.length ?? 0;

		const r = await claude.callTool(TOOL_NAME.build, {
			steps: [{ file: "/no/existe.js", format: SCENARIOS.buildStepOkA.format }],
		});
		assert.equal(r.out["ok"], false);
		assert.equal(r.out["jobId"] ?? null, null);
		assert.equal(env.simulator?.expressions.length ?? 0, sent);
	});
});
