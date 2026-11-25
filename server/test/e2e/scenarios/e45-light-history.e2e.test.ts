// E45 el histórico de un lote no llena el contexto: figma_history_call trae un extracto corto por paso y el resultado
// entero se pide aparte con `step` (el valor si cabe en el tope de M1, la ruta si no); el panel lo sirve igual.
// Servidor MCP real + SQLite + API del panel, con el simulador de Figma.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { until } from "../../harness/wait.ts";

const EXCERPT_BYTES = 300;
const STEPS = 11;
// Pocos kilobytes: los extractos de los 11 pasos y, desde F2, los intentos de la llamada (unos 90 caracteres por paso)
const MAX_RESPONSE_CHARS = 10_000;

const step = (key: "buildStepMediumResult" | "buildStepBigResult") => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

type StepOut = {
	index: number;
	result:
		| { kind: "inline"; excerpt: string; bytes: number; truncated: boolean }
		| { kind: "file"; path: string; bytes: number }
		| null;
};

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

async function runBatch() {
	env = await startEnvironment({ dashboard: true });
	const claude = await env.startClaude({ reply: null });
	const started = await claude.callTool(TOOL_NAME.build, {
		steps: Array.from({ length: STEPS }, (_, i) =>
			step(i === STEPS - 1 ? "buildStepBigResult" : "buildStepMediumResult"),
		),
	});
	const jobId = String(started.out["jobId"]);
	await claude.waitJob(jobId);
	await until(
		"el histórico guardó los pasos",
		() =>
			env.rows("SELECT 1 FROM build_steps WHERE status = 'done'").length ===
			STEPS,
	);
	const callId = env.rows<{ call_id: string }>(
		"SELECT call_id FROM calls WHERE tool = 'figma_build'",
	)[0]?.call_id;
	return { claude, jobId, callId: String(callId) };
}

describe("E45 · histórico ligero", () => {
	it("un lote de 11 pasos grandes cabe en pocos kilobytes y cada paso trae solo un extracto", async () => {
		const { claude, callId } = await runBatch();
		const call = await claude.callTool(TOOL_NAME.historyCall, { callId });
		assert.ok(JSON.stringify(call.out).length < MAX_RESPONSE_CHARS);
		const steps = call.out["steps"] as StepOut[];
		assert.equal(steps.length, STEPS);
		for (const s of steps.slice(0, STEPS - 1)) {
			assert.ok(s.result?.kind === "inline");
			assert.equal(s.result.truncated, true);
			assert.ok(s.result.bytes > EXCERPT_BYTES);
			assert.ok(
				new TextEncoder().encode(s.result.excerpt).byteLength <= EXCERPT_BYTES,
			);
		}
		assert.ok(steps[STEPS - 1]?.result?.kind === "file");
		assert.equal(call.out["stepResult"], undefined);
	});

	it("con step devuelve el resultado entero de ese paso: el valor si cabe, la ruta si pasó del tope", async () => {
		const { claude, callId } = await runBatch();
		const inline = await claude.callTool(TOOL_NAME.historyCall, {
			callId,
			step: 0,
		});
		const whole = inline.out["stepResult"] as {
			result: { kind: string; value: { log: string[] } };
		};
		assert.equal(whole.result.kind, "inline");
		assert.equal(whole.result.value.log.length, 150);
		assert.equal(inline.out["steps"], undefined);
		const file = await claude.callTool(TOOL_NAME.historyCall, {
			callId,
			step: STEPS - 1,
		});
		const onDisk = file.out["stepResult"] as { result: { kind: string } };
		assert.equal(onDisk.result.kind, "file");
	});

	it("un step que el lote no tiene es un error de uso", async () => {
		const { claude, callId } = await runBatch();
		const r = await claude.callTool(TOOL_NAME.historyCall, {
			callId,
			step: 99,
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /no tiene el paso 99/);
	});

	it("el panel trae extractos en la lista y el entero por paso", async () => {
		const { jobId } = await runBatch();
		const list = await env.api<{ steps: StepOut[] }>(
			`/api/history/jobs/${jobId}/steps`,
		);
		assert.ok(JSON.stringify(list).length < MAX_RESPONSE_CHARS);
		const one = await env.api<{
			stepResult: { result: { kind: string; value: { log: string[] } } };
		}>(`/api/history/jobs/${jobId}/steps/0/result`);
		assert.equal(one.stepResult.result.value.log.length, 150);
		const missing = await fetch(
			`${env.dashboardUrl}/api/history/jobs/${jobId}/steps/99/result`,
		);
		assert.equal(missing.status, 404);
	});
});
