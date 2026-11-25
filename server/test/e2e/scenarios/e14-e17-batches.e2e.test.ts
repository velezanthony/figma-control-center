// E14 lote de 3 pasos, uno lento · E15 cancelar a mitad · E16 fallo de un paso · E17 reanudar con fromStep · E22 lote por manifiesto:
// servidor MCP real + SQLite, con el simulador de Figma como Chrome. Los pasos son escenarios herméticos
// (// @scenario: build-step-*), sus resultados se construyen desde los contratos. Sin Figma ni Chrome.
import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { SCENARIOS } from "../../fixtures/scenarios/scenarios.ts";
import {
	type Environment,
	startEnvironment,
} from "../../harness/environment.ts";
import { markerLine, scenarioPath } from "../../harness/script-files.ts";
import { releaseGate, until } from "../../harness/wait.ts";

const SLOW_GATE = SCENARIOS.buildStepSlow.reply.gate;

type StepKey =
	| "buildStepOkA"
	| "buildStepOkB"
	| "buildStepOkC"
	| "buildStepSlow"
	| "buildStepFail";

const step = (key: StepKey) => ({
	file: scenarioPath(SCENARIOS[key].script),
	format: SCENARIOS[key].format,
});

type BuildStepOut = {
	index: number;
	file: string;
	status: string;
	error: { line: number | null } | null;
};
type Progress = { done: number; total: number };

let env: Environment;
type Claude = Awaited<ReturnType<Environment["startClaude"]>>;
// figma_build responde ya con el jobId: el final del lote se espera con figma_get_job y waitMs
const buildToEnd = async (claude: Claude, args: Record<string, unknown>) => {
	const started = await claude.callTool(TOOL_NAME.build, args);
	return claude.waitJob(String(started.out["jobId"]));
};
const stepStatuses = (jobId: string): string =>
	env
		.rows<{ status: string }>(
			`SELECT status FROM build_steps WHERE job_id = '${jobId}' ORDER BY step_index`,
		)
		.map((r) => r.status)
		.join();
afterEach(async () => {
	await env?.stop();
});

describe("E14 · lote de 3 pasos, uno lento", () => {
	it("devuelve running + jobId y el plan al aceptarlo, el progreso crece con token y en figma_get_job, y deja filas en build_steps", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepSlow"),
				step("buildStepOkC"),
			],
		});

		assert.equal(started.out["status"], "running");
		const jobId = String(started.out["jobId"]);
		assert.ok(jobId.length > 0);
		assert.equal((started.out["steps"] as BuildStepOut[]).length, 3);

		// Con el 2.º paso en marcha el plan entero está en build_steps: el panel cuenta 1/3, no 1/1
		await until(
			"el plan entero está en build_steps con el 2.º en curso",
			() => stepStatuses(jobId) === "done,running,pending",
		);

		// figma_get_job ve el lote en curso con su progreso
		const mid = await claude.callTool(TOOL_NAME.getJob, { jobId });
		assert.equal(mid.out["kind"], "build");
		assert.equal(mid.out["status"], "running");
		assert.equal((mid.out["progress"] as Progress).done, 1);

		// Con waitMs y token, figma_get_job notifica el progreso mientras espera
		const progresses: { progress: number; total?: number }[] = [];
		const waiting = claude.callTool(
			TOOL_NAME.getJob,
			{ jobId, waitMs: 5000 },
			{ onProgress: (p) => progresses.push(p) },
		);
		// Soltamos el paso lento: el lote acaba en segundo plano
		await releaseGate(env.simulator, SLOW_GATE);
		const done = await waiting;
		assert.equal(done.out["status"], "done");
		assert.ok(
			progresses.some((p) => p.progress === 3 && p.total === 3),
			`sin progreso 3/3: ${JSON.stringify(progresses)}`,
		);
		assert.equal((done.out["progress"] as Progress).done, 3);
		assert.deepEqual([...(done.out["touchedNodeIds"] as string[])].sort(), [
			"11:1",
			"11:3",
			"11:4",
		]);
		assert.equal(stepStatuses(jobId), "done,done,done");
	});
});

describe("E15 · cancelar a mitad", () => {
	it("el paso en curso termina, los siguientes quedan cancelled y touchedNodeIds es lo que corrió (CA-3)", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepSlow"),
				step("buildStepOkB"),
			],
		});
		assert.equal(started.out["status"], "running");
		const jobId = String(started.out["jobId"]);

		await until(
			"el paso lento está en curso",
			() => stepStatuses(jobId) === "done,running,pending",
		);
		// Cancelar responde enseguida, con el paso lento aún en curso: no espera a que acabe
		const now = await claude.callTool(TOOL_NAME.cancelJob, { jobId });
		assert.notEqual(now.isError, true);
		assert.equal(now.out["cancelRequested"], true);
		assert.equal(now.out["status"], "running");
		assert.deepEqual(now.out["progress"], {
			done: 1,
			total: 3,
			cancelled: 0,
			skipped: 0,
			current: { index: 1, file: step("buildStepSlow").file },
		});

		await releaseGate(env.simulator, SLOW_GATE);
		const r = await claude.waitJob(jobId);

		assert.notEqual(r.isError, true);
		assert.equal(r.out["ok"], true); // cancelled cuenta como ok
		assert.equal(r.out["status"], "cancelled");
		assert.deepEqual([...(r.out["touchedNodeIds"] as string[])].sort(), [
			"11:1",
			"11:4",
		]);
		const steps = r.out["steps"] as BuildStepOut[];
		assert.equal(steps[0]?.status, "done");
		assert.equal(steps[1]?.status, "done"); // el que estaba en marcha acabó
		assert.equal(steps[2]?.status, "cancelled");

		await until(
			"el panel (SQLite) marca el job cancelado",
			() =>
				env.rows("SELECT 1 FROM jobs WHERE status = 'cancelled'").length === 1,
		);
		await until(
			"build_steps guarda el paso cancelado",
			() => stepStatuses(jobId) === "done,done,cancelled",
		);
	});
});

describe("E16 · fallo en el paso 2", () => {
	it("con stopOnError (def.) el lote falla con el error (fichero+línea) y el paso 3 queda pending (CA-4)", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const r = await buildToEnd(claude, {
			steps: [
				step("buildStepOkA"),
				step("buildStepFail"),
				step("buildStepOkC"),
			],
		});
		assert.equal(r.out["ok"], false);
		assert.equal(r.out["status"], "failed");
		const steps = r.out["steps"] as BuildStepOut[];
		assert.equal(steps[0]?.status, "done");
		assert.equal(steps[1]?.status, "failed");
		assert.ok(steps[1]?.file.endsWith("build-step-fail.js"));
		assert.equal(
			steps[1]?.error?.line,
			markerLine("build-step-fail.js", "@throw-here"),
		);
		assert.equal(steps[2]?.status, "pending");
	});

	it("con stopOnError:false el paso 3 se ejecuta aunque el lote acabe failed (CA-4)", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const r = await buildToEnd(claude, {
			steps: [
				step("buildStepOkA"),
				step("buildStepFail"),
				step("buildStepOkC"),
			],
			stopOnError: false,
		});
		assert.equal(r.out["status"], "failed");
		const steps = r.out["steps"] as BuildStepOut[];
		assert.equal(steps[1]?.status, "failed");
		assert.equal(steps[2]?.status, "done");
	});
});

describe("E17 · reanudar con fromStep", () => {
	it("los pasos anteriores salen skipped y no se envían al simulador (CA-5)", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });

		const r = await buildToEnd(claude, {
			steps: [step("buildStepOkA"), step("buildStepOkB"), step("buildStepOkC")],
			fromStep: 2,
		});
		assert.equal(r.out["status"], "done");
		const steps = r.out["steps"] as BuildStepOut[];
		assert.equal(steps[0]?.status, "skipped");
		assert.equal(steps[1]?.status, "skipped");
		assert.equal(steps[2]?.status, "done");
		assert.deepEqual(r.out["touchedNodeIds"], ["11:3"]);
		const jobId = String(r.out["jobId"]);
		await until(
			"build_steps guarda los omitidos y el hecho",
			() => stepStatuses(jobId) === "skipped,skipped,done",
		);

		// Los pasos omitidos nunca llegaron a Chrome: su marcador no aparece entre las expresiones evaluadas
		const exprs = env.simulator?.expressions ?? [];
		assert.equal(
			exprs.some((e) => e.includes("@scenario: build-step-ok-a")),
			false,
		);
		assert.equal(
			exprs.some((e) => e.includes("@scenario: build-step-ok-b")),
			false,
		);
		assert.equal(
			exprs.some((e) => e.includes("@scenario: build-step-ok-c")),
			true,
		);
	});
});

describe("E18 · apagado con un lote vivo", () => {
	const startSlowBuild = async (
		claude: Awaited<ReturnType<Environment["startClaude"]>>,
	) => {
		const started = await claude.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepSlow"),
				step("buildStepOkB"),
			],
		});
		assert.equal(started.out["status"], "running");
		const jobId = String(started.out["jobId"]);
		await until(
			"el paso lento está en curso",
			() => stepStatuses(jobId) === "done,running,pending",
		);
		return jobId;
	};
	const jobStatus = (jobId: string) =>
		env.rows<{ status: string; error_type: string | null }>(
			`SELECT status, error_type FROM jobs WHERE id = '${jobId}'`,
		)[0];

	it("al apagar el servidor, el job del lote queda interrumpido (failed) y no «en curso»", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const jobId = await startSlowBuild(claude);
		assert.equal(jobStatus(jobId)?.status, "running");

		await claude.close();

		await until(
			"el job queda interrumpido en SQLite",
			() => jobStatus(jobId)?.status === "failed",
		);
		assert.equal(jobStatus(jobId)?.error_type, "Interrupted");
		assert.equal(stepStatuses(jobId), "done,failed,pending");
	});

	it("al arrancar una sesión nueva se cierran los jobs de sesiones muertas y no los de una viva", async () => {
		env = await startEnvironment({ dashboard: false });
		const dead = await env.startClaude({ reply: null });
		const deadJob = await startSlowBuild(dead);
		// Muere sin poder cerrar nada (SIGKILL no se puede capturar)
		const deadPid = dead.pid;
		assert.ok(deadPid !== null);
		process.kill(deadPid, "SIGKILL");
		await until("el proceso muerto", () => {
			try {
				process.kill(deadPid, 0);
				return false;
			} catch {
				return true;
			}
		});
		assert.equal(jobStatus(deadJob)?.status, "running");

		const alive = await env.startClaude({ reply: null });
		await until(
			"el barrido cierra el job de la sesión muerta",
			() => jobStatus(deadJob)?.status === "failed",
		);

		// Otra sesión arranca mientras la viva sigue con su lote: el de la viva no se toca
		env.simulator?.release(SLOW_GATE);
		const liveStarted = await alive.callTool(TOOL_NAME.build, {
			steps: [
				step("buildStepOkA"),
				step("buildStepSlow"),
				step("buildStepOkB"),
			],
		});
		const liveJob = String(liveStarted.out["jobId"]);
		await until(
			"el lote de la sesión viva está en marcha",
			() => stepStatuses(liveJob) === "done,running,pending",
		);
		await env.startClaude({ reply: null });
		await new Promise((resolve) => setTimeout(resolve, 300));
		assert.equal(jobStatus(liveJob)?.status, "running");
		env.simulator?.release(SLOW_GATE);
	});
});

describe("E22 · lote por manifiesto", () => {
	it("un manifest con params compartidos ejecuta sus pasos en orden y deja el plan en build_steps", async () => {
		const dir = await mkdtemp(join(tmpdir(), "figma-manifest-"));
		try {
			for (const key of ["buildStepOkA", "buildStepOkB"] as const) {
				await copyFile(
					scenarioPath(SCENARIOS[key].script),
					join(dir, SCENARIOS[key].script),
				);
			}
			await writeFile(
				join(dir, "lote.json"),
				JSON.stringify({
					name: "area",
					params: { pagina: "App" },
					steps: [
						{ file: SCENARIOS.buildStepOkA.script },
						{ file: SCENARIOS.buildStepOkB.script },
					],
				}),
			);
			env = await startEnvironment({ dashboard: false, scriptsRoot: dir });
			const claude = await env.startClaude({ reply: null });

			const r = await buildToEnd(claude, {
				manifest: join(dir, "lote.json"),
			});

			assert.equal(r.out["ok"], true);
			assert.equal(r.out["status"], "done");
			assert.deepEqual([...(r.out["touchedNodeIds"] as string[])].sort(), [
				"11:1",
				"11:2",
			]);
			const jobId = String(r.out["jobId"]);
			assert.equal(stepStatuses(jobId), "done,done");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("un manifest fuera de las raíces es error de uso y no toca Figma", async () => {
		env = await startEnvironment({ dashboard: false });
		const claude = await env.startClaude({ reply: null });
		const r = await claude.callTool(TOOL_NAME.build, {
			manifest: "/etc/passwd",
		});
		assert.equal(r.out["ok"], false);
		assert.equal(r.out["jobId"] ?? null, null);
	});
});
