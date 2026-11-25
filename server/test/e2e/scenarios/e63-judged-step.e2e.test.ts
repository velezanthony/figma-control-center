// E63 step@1 juzgado: con cabecera y resultado bueno, `ok` y los `warnings` en `warning`;
// con resultado malo, ContractError con el puntero, `retryable: false` y los ids que se leen; sin cabecera, el aviso de
// M2 de siempre; kit.fail llega con su código y su siguiente paso; en un lote, el paso malo para el lote.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NO_IDS_WARNING } from "#domain/run-outcome.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { scenarioPath } from "../../harness/script-files.ts";

let env: Environment;
afterEach(async () => {
	await env?.stop();
});

type Key = keyof typeof SCENARIOS;
const file = (key: Key) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

async function run(key: Key) {
	env = await startEnvironment({ dashboard: false });
	const claude = await env.startClaude({ reply: null });
	return { claude, r: await claude.callTool(TOOL_NAME.runScript, file(key)) };
}

describe("E63 · step@1 juzgado", () => {
	it("cabecera y resultado bueno: ok, los ids de creados y cambiados y los warnings sumados al aviso", async () => {
		const { r } = await run("stepOk");
		assert.equal(r.isError, false);
		assert.deepEqual(r.out["touchedNodeIds"], ["12:1", "12:2"]);
		assert.equal(r.out["warning"], "MULTI_MODE: colección con dos modos");
	});

	it("cabecera y dos listas vacías (repetir un paso por clave): ok y sin aviso de nodos sin declarar", async () => {
		const { r } = await run("stepEmpty");
		assert.equal(r.isError, false);
		assert.deepEqual(r.out["touchedNodeIds"], []);
		assert.equal("warning" in r.out, false);
	});

	it("cabecera y resultado malo: ContractError con el puntero JSON, no reintentable y con los ids que se leen", async () => {
		const { r } = await run("stepBad");
		assert.equal(r.isError, true);
		const error = r.out["error"] as {
			type: string;
			path: string;
			message: string;
			retryable: boolean;
			nextStep: string;
		};
		assert.equal(error.type, "ContractError");
		assert.equal(error.path, "/createdNodeIds/1");
		assert.match(error.message, /\/createdNodeIds\/1: no es texto/);
		assert.equal(error.retryable, false);
		assert.equal(r.out["retryable"], false);
		assert.match(error.nextStep, /ya corrió/);
		assert.deepEqual(r.out["touchedNodeIds"], ["12:3", "12:4"]);
	});

	it("sin cabecera, el aviso de M2 de siempre: ningún script de hoy se juzga", async () => {
		const { r } = await run("readValue");
		assert.equal(r.isError, false);
		assert.equal(r.out["warning"], NO_IDS_WARNING);
	});

	it("kit.fail: ScriptError con el código delante del mensaje, la línea del paso y el siguiente paso que dio el script", async () => {
		const { r } = await run("stepKitFail");
		assert.equal(r.isError, true);
		const error = r.out["error"] as {
			type: string;
			message: string;
			line: number;
			nextStep: string;
			retryable: boolean;
		};
		assert.equal(error.type, "ScriptError");
		assert.equal(error.message, "SIN_SET: No hay set «Botón» (línea 3)");
		assert.equal(error.line, 3);
		assert.equal(error.nextStep, "Mira figma_components");
		assert.equal(error.retryable, false);
	});

	it("en un lote, el paso malo falla con ContractError y para el lote (stopOnError)", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [file("stepOk"), file("stepBad"), file("stepOk")],
		});
		const end = await claude.waitJob(String(started.out["jobId"]));
		assert.equal(end.out["status"], "failed");
		const steps = end.out["steps"] as {
			status: string;
			warning: string | null;
			error: { type: string; path: string } | null;
			touchedCount: number;
		}[];
		assert.deepEqual(
			steps.map((s) => s.status),
			["done", "failed", "pending"],
		);
		assert.equal(steps[0]?.warning, "MULTI_MODE: colección con dos modos");
		assert.equal(steps[1]?.error?.type, "ContractError");
		assert.equal(steps[1]?.error?.path, "/createdNodeIds/1");
		assert.equal(steps[1]?.touchedCount, 2);
	});
});
