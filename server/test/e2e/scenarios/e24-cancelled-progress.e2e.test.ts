// E24 un lote de 4 pasos cancelado durante el 3.º cuenta 3 hechos y 1 cancelado, no 4 de 4: en la respuesta de
// figma_build, de figma_cancel_job y de figma_get_job. Servidor MCP real + SQLite con el simulador de Figma.
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

type StepKey =
	| "buildStepOkA"
	| "buildStepOkB"
	| "buildStepOkC"
	| "buildStepSlow";
const step = (key: StepKey) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

const CANCELLED_AT_3 = {
	done: 3,
	total: 4,
	cancelled: 1,
	skipped: 0,
	current: null,
};

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E24 · progreso real de un lote cancelado", () => {
	it("figma_cancel_job y figma_get_job cuentan 3 de 4 con 1 cancelado", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepOkB"),
				step("buildStepSlow"),
				step("buildStepOkC"),
			],
		});
		const jobId = String(started.out["jobId"]);

		await until(
			"el 3.º paso está en curso",
			() => env.simulator?.waiting(SLOW_GATE) === 1,
		);
		const now = await claude.callTool(TOOL_NAME.cancelJob, { jobId });
		assert.equal(now.out["cancelRequested"], true);
		await releaseGate(env.simulator, SLOW_GATE);

		const job = await claude.waitJob(jobId);
		assert.equal(job.out["status"], "cancelled");
		assert.deepEqual(job.out["progress"], CANCELLED_AT_3);

		const again = await claude.callTool(TOOL_NAME.cancelJob, { jobId });
		assert.deepEqual(again.out["progress"], CANCELLED_AT_3);
	});

	it("con fromStep: 2 de 5, done empieza en 0 y skipped es 2", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const r = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepOkB"),
				step("buildStepOkC"),
				step("buildStepOkA"),
				step("buildStepOkB"),
			],
			fromStep: 2,
		});
		const final = await claude.waitJob(String(r.out["jobId"]));
		assert.deepEqual(final.out["progress"], {
			done: 3,
			total: 5,
			cancelled: 0,
			skipped: 2,
			current: null,
		});
	});
});
