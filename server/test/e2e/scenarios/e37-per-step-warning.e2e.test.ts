// E37 el aviso de cada paso llega a la respuesta: figma_get_job (con waitMs) y figma_cancel_job lo traen en el paso que
// terminó sin declarar nodos y `null` en el resto. Servidor MCP real + SQLite, con el simulador de Figma como Chrome.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

type StepOut = { file: string; status: string; warning: string | null };

const step = (key: "buildStepOkA" | "readValue" | "buildStepOkC") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E37 · aviso por paso", () => {
	it("figma_get_job y figma_cancel_job traen el aviso solo del paso que no declaró nodos", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [step("buildStepOkA"), step("readValue"), step("buildStepOkC")],
		});
		const jobId = String(started.out["jobId"]);
		assert.deepEqual(
			(started.out["steps"] as StepOut[]).map((s) => s.warning),
			[null, null, null],
		);

		const end = await claude.waitJob(jobId);
		assert.equal(end.out["status"], "done");
		const warnings = (out: Record<string, unknown>) =>
			(out["steps"] as StepOut[]).map((s) => s.warning);
		const got = warnings(end.out);
		assert.equal(got[0], null);
		assert.match(String(got[1]), /sin declarar nodos/);
		assert.equal(got[2], null);

		const cancel = await claude.callTool(TOOL_NAME.cancelJob, { jobId });
		assert.deepEqual(warnings(cancel.out), got);
	});
});
