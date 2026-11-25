// E38 el resultado de cada paso queda en el histórico: figma_history_call lo trae (en línea si cabe en el tope de M1,
// con ruta y bytes si no) y la respuesta de figma_build/figma_get_job no lo lleva. Servidor MCP real + SQLite.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";
import { until } from "../../harness/wait.ts";

type Result =
	| { kind: "inline"; excerpt: string; bytes: number; truncated: boolean }
	| { kind: "file"; path: string; bytes: number }
	| null;
type StepOut = { index: number; status: string; result: Result };

const step = (
	key: "buildStepOkA" | "buildStepBigResult" | "buildStepFail",
) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

describe("E38 · resultado por paso", () => {
	it("figma_history_call trae el extracto de cada paso (línea, fichero o null) y la respuesta del lote no", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepBigResult"),
				step("buildStepFail"),
			],
			stopOnError: false,
		});
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "failed");
		assert.equal(end.out["result"], null);
		for (const s of end.out["steps"] as Record<string, unknown>[]) {
			assert.equal(
				"result" in s,
				false,
				"la respuesta del lote no lleva el resultado",
			);
		}

		await until(
			"el histórico guardó los tres pasos",
			() =>
				env.rows(
					"SELECT 1 FROM build_steps WHERE status = 'done' OR status = 'failed'",
				).length === 3,
		);
		const calls = env.rows<{ call_id: string }>(
			"SELECT call_id FROM calls WHERE tool = 'figma_build'",
		);
		const call = await claude.callTool(TOOL_NAME.historyCall, {
			callId: calls[0]?.call_id,
		});
		const steps = call.out["steps"] as StepOut[];

		assert.deepEqual(steps[0]?.result, {
			kind: "inline",
			excerpt: '{"createdNodeIds":["11:1"]}',
			bytes: 27,
			truncated: false,
		});
		const big = steps[1]?.result;
		assert.ok(big?.kind === "file");
		assert.ok(big.bytes > 20_000);
		assert.equal((await stat(big.path)).size, big.bytes);
		const onDisk = JSON.parse(await readFile(big.path, "utf8")) as {
			log: string[];
		};
		assert.equal(onDisk.log.length, 3000);
		assert.equal(steps[2]?.status, "failed");
		assert.equal(steps[2]?.result, null);
	});
});
