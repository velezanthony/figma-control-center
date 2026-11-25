// E26 con la pestaña sin sesión (o solo lectura), todas las herramientas que tocan Figma responden en menos de 1 s
// con FigmaNotReady y el mismo motivo que figma_status; sin job y sin enviar ningún script al simulador.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

const MAX_MS = 1000;
// Lo único que el simulador puede haber recibido: la pregunta de acceso (INITIAL_OPTIONS), nunca un script
const ACCESS_PROBE = "INITIAL_OPTIONS";

type Error_ = { type: string; reason?: string; retryable: boolean };

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

const CASES = [
	["notLoggedIn", "notLoggedIn"],
	["viewOnly", "viewOnly"],
] as const;

for (const [figma, reason] of CASES) {
	describe(`E26 · pestaña ${figma}`, () => {
		it(`run_script, build, metadata, screenshot y status dan ${reason} en menos de 1 s, sin job ni envío al simulador`, async () => {
			env = await startEnvironment({ dashboard: false, figma });
			const claude = await env.startClaude({ reply: null });
			const okStep = {
				file: scenarioPath(SCENARIOS.buildStepOkA.script),
				format: SCENARIOS.buildStepOkA.format,
			};

			const calls: [string, Record<string, unknown>][] = [
				[
					TOOL_NAME.runScript,
					{ file: scenarioPath(SCENARIOS.writeCreated.script) },
				],
				[TOOL_NAME.build, { steps: [okStep] }],
				[TOOL_NAME.metadata, {}],
				[TOOL_NAME.screenshot, { nodeId: "1:1" }],
				[TOOL_NAME.status, {}],
			];
			for (const [name, args] of calls) {
				const started = performance.now();
				const r = await claude.callTool(name, args);
				const ms = performance.now() - started;
				assert.ok(ms < MAX_MS, `${name} tardó ${ms} ms`);
				const error = r.out["error"] as Error_ | null;
				assert.equal(error?.type, "FigmaNotReady", name);
				assert.equal(error?.reason, reason, name);
				assert.equal(r.out["jobId"] ?? null, null, `${name} no crea job`);
				assert.notEqual(r.out["status"], "running", name);
			}

			const sent = (env.simulator?.expressions ?? []).filter(
				(e) => !e.includes(ACCESS_PROBE),
			);
			assert.deepEqual(sent, [], "ningún script llegó al simulador");
			assert.equal(
				env.rows("SELECT 1 FROM jobs").length,
				0,
				"ningún job en el histórico",
			);
		});
	});
}
