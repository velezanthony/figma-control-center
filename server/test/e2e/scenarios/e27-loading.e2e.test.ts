// E27 con la pestaña cargando y FIGMA_READY_TIMEOUT_MS MAYOR que el plazo blando, ninguna herramienta espera más que
// el plazo blando: figma_run_script y figma_build responden FigmaNotReady `loading` al vencer, nunca `running`.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import { TIMING } from "../../harness/env.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

// Mucho más larga que el plazo blando del arnés (400 ms)
const LONG_READY_MS = 20_000;
const ACCESS_PROBE = "INITIAL_OPTIONS";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E27 · pestaña cargando, con la espera más larga que el plazo blando", () => {
	it("run_script y build dan FigmaNotReady loading al vencer el plazo blando, sin job ni script enviado", async () => {
		assert.ok(LONG_READY_MS > TIMING.softDeadlineMs);
		env = await startEnvironment({
			dashboard: false,
			figma: "notReady",
			extraEnv: { FIGMA_READY_TIMEOUT_MS: String(LONG_READY_MS) },
		});
		const claude = await env.startClaude({ reply: null });
		const okStep = {
			file: scenarioPath(SCENARIOS.buildStepOkA.script),
			format: SCENARIOS.buildStepOkA.format,
		};

		for (const [name, args] of [
			[
				TOOL_NAME.runScript,
				{ file: scenarioPath(SCENARIOS.writeCreated.script) },
			],
			[TOOL_NAME.build, { steps: [okStep] }],
		] as const) {
			const started = performance.now();
			const r = await claude.callTool(name, args);
			const ms = performance.now() - started;
			const error = r.out["error"] as { type: string; reason: string } | null;
			assert.equal(error?.type, "FigmaNotReady", name);
			assert.equal(error?.reason, "loading", name);
			assert.notEqual(r.out["status"], "running", name);
			assert.equal(r.out["jobId"] ?? null, null, name);
			assert.ok(ms >= TIMING.softDeadlineMs * 0.8, `${name} no esperó: ${ms}`);
			assert.ok(ms < TIMING.softDeadlineMs * 5, `${name} tardó ${ms} ms`);
		}

		const sent = (env.simulator?.expressions ?? []).filter(
			(e) => !e.includes(ACCESS_PROBE),
		);
		assert.deepEqual(sent, []);
	});
});
