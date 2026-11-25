// E1 — cada tipo de error del dominio, de punta a punta con el servidor MCP real y el panel real:
// respuesta MCP (tipo, línea, reintentable, siguiente paso) → fila en SQLite → API del panel.
// Los valores esperados salen de las reglas del dominio y de los escenarios, no de una ejecución real.
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	ERROR_SCENARIOS,
	type ErrorScenario,
} from "../../fixtures/scenarios/errors.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { markerLine, scenarioPath } from "../../harness/script-files.ts";
import { until } from "../../harness/wait.ts";

// Plazo de la llamada más corto que el plazo blando: el Timeout vuelve en la propia respuesta y no como job
const SHORT_CALL_TIMEOUT_MS = 150;
// Todo escenario de E1 termina con un error dentro de la propia respuesta: un plazo blando holgado evita que una
// máquina cargada lo adelante (la respuesta saldría como job en marcha y no como error)
const SOFT_DEADLINE_MS = 10_000;

type CallRow = {
	status: string;
	error_type: string;
	error_line: number | null;
	next_step: string;
	retryable: number;
};
type CallsApi = {
	items: {
		status: string;
		error: {
			type: string;
			nextStep: string | null;
			line: number | null;
		} | null;
		retryable: boolean | null;
	}[];
};

const figmaFor = (setup: ErrorScenario["setup"]) =>
	setup.kind === "chromeDown"
		? "down"
		: setup.kind === "wrongTab"
			? "wrongTab"
			: setup.kind === "figmaNotLoaded"
				? "notReady"
				: "up";

const argsFor = (env: Environment, setup: ErrorScenario["setup"]) => {
	if (setup.kind === "pathOutsideRoots")
		return { file: join(env.dir, "fuera.js") };
	if (setup.kind === "script") {
		const scenario = SCENARIOS[setup.scenario];
		return {
			file: scenarioPath(scenario.script),
			format: scenario.format,
			...(setup.scenario === "errorTimeout"
				? { timeoutMs: SHORT_CALL_TIMEOUT_MS }
				: {}),
		};
	}
	if (setup.kind === "nodeMissing") return { nodeId: "99:99" };
	return { code: "return 1;" };
};

const toolFor = (setup: ErrorScenario["setup"]) =>
	setup.kind === "nodeMissing" ? TOOL_NAME.screenshot : TOOL_NAME.runScript;

describe("E1 · errores del dominio", { concurrency: 4 }, () => {
	for (const scenario of ERROR_SCENARIOS) {
		it(`${scenario.id}: ${scenario.type}`, async () => {
			const env = await startEnvironment({
				figma: figmaFor(scenario.setup),
				extraEnv: { FCC_SOFT_DEADLINE_MS: String(SOFT_DEADLINE_MS) },
			});
			try {
				const claude = await env.startClaude({ reply: null });
				const run = await claude.callTool(
					toolFor(scenario.setup),
					argsFor(env, scenario.setup),
				);

				// 1) Respuesta MCP
				const error = run.out["error"] as {
					type: string;
					line?: number | null;
					nextStep: string;
					retryable: boolean;
				};
				assert.equal(run.isError, true);
				assert.equal(error.type, scenario.type);
				assert.equal(error.retryable, scenario.retryable);
				assert.equal(run.out["retryable"], scenario.retryable);
				assert.match(error.nextStep, scenario.nextStep);
				const line =
					scenario.setup.kind === "script" &&
					scenario.setup.lineMarker !== undefined
						? markerLine(
								SCENARIOS[scenario.setup.scenario].script,
								scenario.setup.lineMarker,
							)
						: null;
				if (scenario.type === "ScriptError")
					assert.equal(error.line ?? null, line);

				// 2) Fila en SQLite
				await until(
					"la base registra el error",
					() =>
						env.rows("SELECT 1 FROM calls WHERE status = 'error'").length === 1,
				);
				const [row] = env.rows<CallRow>(
					"SELECT status, error_type, error_line, next_step, retryable FROM calls",
				);
				assert.equal(row?.error_type, scenario.type);
				assert.equal(
					row?.error_line ?? null,
					scenario.type === "ScriptError" ? line : null,
				);
				assert.match(row?.next_step ?? "", scenario.nextStep);
				assert.equal(row?.retryable, scenario.retryable ? 1 : 0);

				// 3) API del panel
				const api = await env.api<CallsApi>("/api/history/calls");
				const [item] = api.items;
				assert.equal(item?.status, "error");
				assert.equal(item?.error?.type, scenario.type);
				assert.match(item?.error?.nextStep ?? "", scenario.nextStep);
				assert.equal(item?.retryable, scenario.retryable);
			} finally {
				await env.stop();
			}
		});
	}
});
