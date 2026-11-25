import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AREAS_CONTRACT, type Area, type AreasFile } from "#domain/areas.ts";
import type { BuildPlan, BuildStep, PlanStep } from "#domain/build.ts";
import { BUILD_STATUS, STEP_STATUS } from "#domain/build.ts";
import {
	areasContractError,
	callTimeout,
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
	figmaNotReady,
	projectConfigError,
	scriptError,
} from "#domain/figma-error.ts";
import { JOB_KIND, JOB_STATUS, toJobId } from "#domain/job.ts";
import { err, ok } from "#domain/result.ts";
import { type KitStep, kitStepCode, kitStepLabel } from "#domain/step.ts";
import type {
	ComposePlanMaker,
	ComposePlanOutcome,
	ComposePlanRun,
} from "./compose-plan.ts";
import { createJobRegistry } from "./job-registry.ts";
import { SCRIPT_FORMAT } from "./ports/figma-gateway.ts";
import type { LoadedProject } from "./ports/project-config.ts";
import { makeAttemptRecorder } from "./record-attempt.ts";
import { makeRunBuild } from "./run-build.ts";
import type { ScreenPlanMaker, ScreenPlanOutcome } from "./screen-plan.ts";
import type {
	SheetPlanMaker,
	SheetPlanOutcome,
	SheetPlanRun,
} from "./sheet-plan.ts";
import { fakeStepIssues } from "./testing/fake-step-check.ts";
import { InMemoryAttemptLog } from "./testing/in-memory-attempt-log.ts";
import {
	deferred,
	InMemoryFigmaGateway,
} from "./testing/in-memory-figma-gateway.ts";
import {
	InMemoryAssetRepository,
	InMemoryResultStore,
	InMemoryScriptRepository,
} from "./testing/in-memory-ports.ts";
import {
	InMemoryProjectConfig,
	projectWith,
} from "./testing/in-memory-web-capture.ts";

function setup(
	overrides: {
		project?: LoadedProject;
		stepTimeoutMs?: number;
		maxParamsBytes?: number;
		maxSteps?: number;
		maxInlineResultBytes?: number;
		onProgress?: (p: { stepIndex: number }) => void;
		screenPlan?: ScreenPlanMaker;
		sheetPlan?: SheetPlanMaker;
		composePlan?: ComposePlanMaker;
	} = {},
) {
	let clock = 0;
	const gateway = new InMemoryFigmaGateway();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const store = new InMemoryResultStore();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`build-${++n}`));
	const progressCalls: {
		jobId: string;
		progress: { done: number; total: number };
	}[] = [];
	const finishedJobs: { jobId: string; ok: boolean; ms: number }[] = [];
	const stepChanges: { changed: readonly number[]; statuses: string[] }[] = [];
	const stepSnapshots: (readonly BuildStep[])[] = [];
	const attemptLog = new InMemoryAttemptLog();
	const project = new InMemoryProjectConfig(
		overrides.project ?? projectWith([]),
	);
	const runBuild = makeRunBuild({
		screenPlan:
			overrides.screenPlan ??
			(async () => assert.fail("no debería pedir el plan de una pantalla")),
		...(overrides.sheetPlan !== undefined && {
			sheetPlan: overrides.sheetPlan,
		}),
		...(overrides.composePlan !== undefined && {
			composePlan: overrides.composePlan,
		}),
		project,
		attempts: makeAttemptRecorder({
			log: attemptLog,
			scripts,
			assets,
			clock: () => new Date(0),
			kits: {
				figma: () => ({ version: "figma-kit@1", content: "KIT" }),
				capture: () => ({ version: "capture-kit@1", content: "KIT" }),
			},
			warn: (m) => assert.fail(m),
		}),
		checkStep: fakeStepIssues,
		gateway,
		scripts,
		assets,
		jobs,
		store,
		maxInlineResultBytes: overrides.maxInlineResultBytes ?? 20_000,
		stepTimeoutMs: overrides.stepTimeoutMs ?? 30_000,
		maxParamsBytes: overrides.maxParamsBytes ?? 20_000,
		maxSteps: overrides.maxSteps ?? 50,
		now: () => (clock += 50),
		onProgress:
			overrides.onProgress ??
			(({ jobId, progress }) => progressCalls.push({ jobId, progress })),
		onStepsChanged: ({ steps, changed }) => {
			stepChanges.push({ changed, statuses: steps.map((s) => s.status) });
			stepSnapshots.push(steps);
		},
		onJobFinished: ({ jobId, outcome, ms }) =>
			finishedJobs.push({ jobId, ok: outcome.ok, ms }),
	});
	// El lote corre en segundo plano y runBuild responde ya: este espera a que el job termine y devuelve su final
	const runToEnd = async (input: Parameters<typeof runBuild>[0]) => {
		const r = await runBuild(input);
		if (r.kind !== "running") return r;
		while (jobs.get(r.jobId)?.status === JOB_STATUS.running) await flush();
		await flush();
		const job = jobs.get(r.jobId);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.ok(job.status !== JOB_STATUS.running);
		return {
			kind: "finished" as const,
			jobId: r.jobId,
			outcome: {
				ok: job.outcome.ok,
				status: job.status,
				error: job.outcome.error,
				touchedNodeIds: job.outcome.touchedNodeIds,
				retryable: job.outcome.retryable,
				progress: job.progress,
				steps: job.steps,
			},
		};
	};
	return {
		project,
		gateway,
		scripts,
		assets,
		store,
		jobs,
		runBuild,
		runToEnd,
		progressCalls,
		finishedJobs,
		stepChanges,
		stepSnapshots,
		attemptLog,
	};
}

const step = (file: string, extra: Partial<PlanStep> = {}): PlanStep => ({
	file,
	format: SCRIPT_FORMAT.function,
	...extra,
});

const planOf = (...steps: PlanStep[]): BuildPlan => ({ name: "lote", steps });

const flush = () => new Promise((r) => setImmediate(r));
const until = async (cond: () => boolean) => {
	for (let i = 0; i < 200 && !cond(); i++) await flush();
	assert.ok(cond(), "la condición no se cumplió");
};

describe("makeRunBuild: validación del plan", () => {
	it("sin sesión el lote se rechaza en la validación previa: sin job, sin tocar Figma y sin lock (CA-6)", async () => {
		const { gateway, scripts, jobs, runBuild, finishedJobs } = setup();
		scripts.files.set("a.js", "A");
		gateway.readyReply = async () =>
			err(figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn));
		const r = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.ok, false);
		const error = r.outcome.error;
		assert.ok(error?.type === FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(error.reason, FIGMA_NOT_READY_REASON.notLoggedIn);
		assert.equal(r.outcome.retryable, error.retryable);
		assert.equal(r.outcome.retryable, true);
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
		assert.equal(finishedJobs.length, 0);
	});

	it("un plan con más pasos que el tope es un error de uso y no toca Figma ni toma el lock", async () => {
		const { gateway, jobs, runBuild } = setup({ maxSteps: 2 });
		const r = await runBuild({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
		});
		assert.ok(r.kind === "usage");
		assert.match(r.message, /3 pasos.*tope es de 2/);
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un plan justo en el tope se ejecuta", async () => {
		const { scripts, runToEnd } = setup({ maxSteps: 1 });
		scripts.files.set("a.js", "A");
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
	});

	it("fromStep fuera del plan es un error de uso, no un lote `done` vacío", async () => {
		const { gateway, jobs, runBuild } = setup();
		const r = await runBuild({
			plan: planOf(step("a.js"), step("b.js")),
			fromStep: 2,
		});
		assert.ok(r.kind === "usage");
		assert.match(r.message, /fromStep 2.*2 pasos/);
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});
});

describe("makeRunBuild: expect del lote", () => {
	const expecting = (fileName: string, ...steps: PlanStep[]): BuildPlan => ({
		name: "lote",
		expect: { fileName },
		steps,
	});
	const openedAs = (gateway: InMemoryFigmaGateway, fileName: string) => {
		gateway.statusReply = { ...gateway.statusReply, fileName };
	};

	for (const fromStep of [0, 2]) {
		it(`si el archivo abierto no se llama como expect, el lote se rechaza como error de uso sin job, sin lock y sin enviar nada (fromStep ${fromStep})`, async () => {
			const { gateway, scripts, jobs, runBuild, finishedJobs } = setup();
			for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
			openedAs(gateway, "Archivo de trabajo");
			const r = await runBuild({
				plan: expecting("Copia", step("a.js"), step("b.js"), step("c.js")),
				fromStep,
			});
			assert.ok(r.kind === "usage");
			assert.match(r.message, /«Archivo de trabajo»/);
			assert.match(r.message, /«Copia»/);
			assert.equal(gateway.runCalls.length, 0);
			assert.equal(jobs.activeBuild(), undefined);
			assert.equal(finishedJobs.length, 0);
		});
	}

	it("con el nombre correcto el lote corre igual que sin expect", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		openedAs(gateway, "Copia");
		const r = await runToEnd({ plan: expecting("Copia", step("a.js")) });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(gateway.runCalls.length, 1);
	});

	it("si no se puede leer el nombre, manda el error de ready() y no el de expect", async () => {
		const { gateway, scripts, runBuild } = setup();
		scripts.files.set("a.js", "A");
		gateway.readyReply = async () =>
			err(figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn));
		const r = await runBuild({ plan: expecting("Copia", step("a.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error?.type, FIGMA_ERROR_TYPE.figmaNotReady);
	});

	it("tras rechazar por expect, el lock queda libre", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		openedAs(gateway, "Otro");
		const bad = await runToEnd({ plan: expecting("Copia", step("a.js")) });
		assert.equal(bad.kind, "usage");
		openedAs(gateway, "Copia");
		const good = await runToEnd({ plan: expecting("Copia", step("a.js")) });
		assert.ok(good.kind === "finished" && good.outcome.ok);
	});
});

describe("makeRunBuild: resultado de cada paso", () => {
	it("un resultado que cabe se guarda tal cual en el paso", async () => {
		const { gateway, scripts, store, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () =>
			ok({ createdNodeIds: ["1:1"], log: ["uno", "dos"] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.deepEqual(r.outcome.steps[0]?.result, {
			kind: "inline",
			json: '{"createdNodeIds":["1:1"],"log":["uno","dos"]}',
		});
		assert.deepEqual(store.json, []);
	});

	it("un resultado mayor que el tope se vuelca a fichero y el paso guarda la ruta y los bytes", async () => {
		const { gateway, scripts, store, runToEnd } = setup({
			maxInlineResultBytes: 30,
		});
		scripts.files.set("a.js", "A");
		const big = { log: "x".repeat(100) };
		gateway.runReply = async () => ok(big);
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		const json = JSON.stringify(big);
		assert.deepEqual(store.json, [json]);
		assert.deepEqual(r.outcome.steps[0]?.result, {
			kind: "file",
			path: "/salida/result-1.json",
			bytes: json.length,
		});
	});

	it("un resultado justo en el tope va en línea", async () => {
		const { gateway, scripts, runToEnd } = setup({ maxInlineResultBytes: 14 });
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ ab: "cdefg" });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(JSON.stringify({ ab: "cdefg" }).length, 14);
		assert.equal(r.outcome.steps[0]?.result?.kind, "inline");
	});

	it("un paso que no devuelve nada, que falla o que no llegó a correr guarda null", async () => {
		const { gateway, scripts, runToEnd } = setup();
		for (const f of ["a.js", "b.js", "c.js", "d.js"]) scripts.files.set(f, f);
		gateway.runReply = async (sc) =>
			sc.code === "A" ? ok(undefined) : err(scriptError("boom", 1, false));
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js"), step("d.js")),
			fromStep: 0,
		});
		assert.ok(r.kind === "finished");
		assert.deepEqual(
			r.outcome.steps.map((s) => s.result),
			[null, null, null, null],
		);
	});

	it("los pasos omitidos por fromStep no traen resultado", async () => {
		const { scripts, runToEnd } = setup();
		scripts.files.set("b.js", "B");
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js")),
			fromStep: 1,
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.result, null);
	});

	it("el resultado llega a onStepsChanged junto con el estado final del paso", async () => {
		const { gateway, scripts, runToEnd, stepSnapshots } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ x: 1 });
		await runToEnd({ plan: planOf(step("a.js")) });
		const last = stepSnapshots.at(-1);
		assert.deepEqual(last?.[0]?.result, { kind: "inline", json: '{"x":1}' });
	});
});

describe("makeRunBuild: un callback que lanza", () => {
	it("el lote cierra failed pero conserva los pasos hechos y sus ids", async () => {
		const { gateway, scripts, runToEnd } = setup({
			onProgress: () => {
				throw new Error("el notificador falló");
			},
		});
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1"]);
		assert.equal(gateway.runCalls.length, 1);
	});
});

describe("makeRunBuild: estado de los pasos", () => {
	it("avisa del plan entero al empezar, de cada paso en curso y de su final", async () => {
		const { scripts, runToEnd, stepChanges } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
			fromStep: 1,
		});
		assert.deepEqual(stepChanges, [
			{ changed: [0, 1, 2], statuses: ["skipped", "pending", "pending"] },
			{ changed: [1], statuses: ["skipped", "running", "pending"] },
			{ changed: [1], statuses: ["skipped", "done", "pending"] },
			{ changed: [2], statuses: ["skipped", "done", "running"] },
			{ changed: [2], statuses: ["skipped", "done", "done"] },
		]);
	});

	it("al cancelar, los pasos que no empezaron avisan como cancelled", async () => {
		const { gateway, scripts, jobs, runBuild, stepChanges } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		const gate = deferred<void>();
		gateway.runReply = async () => {
			await gate.promise;
			return ok({ createdNodeIds: ["1:1"] });
		};
		const r = await runBuild({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
		});
		assert.ok(r.kind === "running");
		await until(() => gateway.runCalls.length === 1);
		jobs.requestCancel(r.jobId);
		gate.resolve();
		await flush();
		await flush();
		const last = stepChanges[stepChanges.length - 1];
		assert.deepEqual(last, {
			changed: [1, 2],
			statuses: ["done", "cancelled", "cancelled"],
		});
	});
});

describe("makeRunBuild", () => {
	it("ejecuta los pasos en orden y devuelve la unión de ids tocados (CA-1)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async (s) =>
			s.code === "A"
				? ok({ createdNodeIds: ["1:1"] })
				: ok({ mutatedNodeIds: ["1:2"] });
		const r = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.equal(r.outcome.ok, true);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1", "1:2"]);
		assert.deepEqual(
			gateway.runCalls.map((c) => c.script.code),
			["A", "B"],
		);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.done);
	});

	it("valida el lote entero antes de tocar Figma: un script ilegible lo rechaza (CA-6)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		const r = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		assert.equal(r.outcome.error?.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(r.outcome.retryable, false);
		assert.equal(r.outcome.retryable, r.outcome.error?.retryable);
		assert.equal(r.jobId, null);
	});

	it("unos params de un paso demasiado grandes rechazan el lote sin tocar Figma (CA-6)", async () => {
		const { gateway, scripts, runToEnd } = setup({ maxParamsBytes: 10 });
		scripts.files.set("a.js", "A");
		const r = await runToEnd({
			plan: planOf(
				step("a.js", { params: { t: "demasiado largo para diez" } }),
			),
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error?.type, FIGMA_ERROR_TYPE.scriptReadError);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un asset fuera de las raíces rechaza el lote (CA-6)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		const r = await runToEnd({
			plan: planOf(step("a.js", { assets: { mapa: "/fuera.png" } })),
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un rechazo del gateway (transporte) es un paso fallido, no revienta el lote", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => {
			throw new Error("CDP caído");
		};
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.failed);
		assert.match(r.outcome.error?.message ?? "", /inesperado/);
	});

	it("un callback onProgress que lanza no deja el lock puesto: se puede lanzar otro lote (CA-8)", async () => {
		const { gateway, scripts, runToEnd } = setup({
			onProgress: () => {
				throw new Error("callback roto");
			},
		});
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		// El lock se liberó pese al throw: un segundo lote NO se rechaza por «hay un lote en marcha»
		scripts.files.set("b.js", "B");
		const r2 = await runToEnd({ plan: planOf(step("b.js")) });
		assert.notEqual(r2.kind, "usage");
	});

	it("reserva el lock de forma síncrona: un segundo lote se rechaza aunque el primero siga validando (CA-8, sin TOCTOU)", async () => {
		const { gateway, scripts, runBuild, runToEnd } = setup();
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		// La lectura de a.js se cuelga: mantiene al primer lote DENTRO de la validación (antes de tocar Figma).
		const gate = deferred<void>();
		scripts.read = async (path) => {
			if (path === "a.js") {
				await gate.promise;
				return ok("A");
			}
			return ok("B");
		};

		// Primer lote lanzado sin await: se queda validando a.js. El lock debe quedar reservado ya (síncrono).
		const first = runToEnd({ plan: planOf(step("a.js")) });
		// Segundo lote mientras el primero valida: debe rechazarse por «hay un lote en marcha».
		const second = await runBuild({ plan: planOf(step("b.js")) });
		assert.equal(second.kind, "usage");

		gate.resolve();
		const r = await first;
		assert.ok(r.kind === "finished" && r.outcome.ok);
		// El segundo lote no llegó a tocar Figma.
		assert.equal(gateway.runCalls.length, 1);
	});

	it("tras una validación fallida el lock queda libre: otro lote no se rechaza (CA-8)", async () => {
		const { scripts, runToEnd } = setup();
		// a.js no existe → la validación falla; el lock reservado debe soltarse.
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.jobId, null);
		scripts.files.set("b.js", "B");
		const r2 = await runToEnd({ plan: planOf(step("b.js")) });
		assert.notEqual(r2.kind, "usage");
	});

	it("pasa a cada paso su script, params y assets resueltos (CA-7)", async () => {
		const { gateway, scripts, assets, runBuild } = setup();
		scripts.files.set("a.js", "return params");
		assets.files.set("/a/mapa.png", Uint8Array.from([1, 2, 3]));
		await runBuild({
			plan: planOf({
				file: "a.js",
				format: SCRIPT_FORMAT.body,
				params: { page: "C" },
				assets: { mapa: "/a/mapa.png" },
			}),
		});
		assert.deepEqual(gateway.runCalls[0]?.script, {
			code: "return params",
			format: "body",
			params: { page: "C" },
			assets: { mapa: Uint8Array.from([1, 2, 3]) },
		});
	});

	it("stopOnError (def.) para el lote al primer fallo y deja los siguientes en pending (CA-4)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		gateway.runReply = async (s) =>
			s.code === "b.js"
				? err(scriptError("boom", 3, false))
				: ok({ createdNodeIds: [s.code] });
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.failed);
		assert.equal(r.outcome.steps[2]?.status, STEP_STATUS.pending);
		assert.equal(r.outcome.error?.type, FIGMA_ERROR_TYPE.scriptError);
		assert.equal(gateway.runCalls.length, 2);
		assert.equal(r.outcome.retryable, false);
	});

	it("stopOnError:false sigue tras un fallo y acaba failed (CA-4)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		gateway.runReply = async (s) =>
			s.code === "b.js"
				? err(scriptError("boom", 3, false))
				: ok({ createdNodeIds: [s.code] });
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
			stopOnError: false,
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.status, BUILD_STATUS.failed);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.failed);
		assert.equal(r.outcome.steps[2]?.status, STEP_STATUS.done);
		assert.equal(gateway.runCalls.length, 3);
	});

	it("fromStep salta los pasos anteriores sin leerlos ni enviarlos (CA-5)", async () => {
		const { gateway, scripts, runToEnd } = setup();
		// a.js NO se registra a propósito: si fromStep lo leyera, fallaría la validación
		scripts.files.set("b.js", "B");
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js")),
			fromStep: 1,
		});
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.skipped);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.done);
		assert.deepEqual(
			gateway.runCalls.map((c) => c.script.code),
			["B"],
		);
	});

	it("cada paso usa su timeoutMs o el de configuración", async () => {
		const { gateway, scripts, runToEnd } = setup({ stepTimeoutMs: 30_000 });
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		await runToEnd({
			plan: planOf(step("a.js", { timeoutMs: 5000 }), step("b.js")),
		});
		assert.equal(gateway.runCalls[0]?.options?.timeoutMs, 5000);
		assert.equal(gateway.runCalls[1]?.options?.timeoutMs, 30_000);
	});

	it("un paso que agota su plazo (Timeout) deja el paso failed y para el lote", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async (s) =>
			s.code === "A" ? err(callTimeout(5000)) : ok({});
		const r = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.failed);
		assert.equal(r.outcome.steps[0]?.error?.type, FIGMA_ERROR_TYPE.timeout);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.pending);
		assert.equal(gateway.runCalls.length, 1);
	});

	it("tras un Timeout el lote se para también con stopOnError:false y no envía el paso siguiente", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async (s) =>
			s.code === "A" ? err(callTimeout(5000)) : ok({});
		const r = await runToEnd({
			plan: planOf(step("a.js"), step("b.js")),
			stopOnError: false,
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(gateway.runCalls.length, 1);
		assert.equal(r.outcome.steps[1]?.status, STEP_STATUS.pending);
	});

	it("tras un Timeout el lock sigue tomado hasta que el script viejo termina", async () => {
		const { gateway, scripts, jobs, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		const old = deferred<void>();
		gateway.orphan = old.promise;
		gateway.runReply = async () => err(callTimeout(5000));
		const first = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(first.kind === "finished");

		const blocked = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(blocked.kind === "usage");
		assert.match(blocked.message, /script anterior.*sigue/);
		assert.equal(gateway.runCalls.length, 1);
		assert.ok(jobs.staleScript());

		old.resolve();
		await flush();
		assert.equal(jobs.activeBuild(), undefined);
		assert.equal(jobs.staleScript(), false);
		gateway.orphan = undefined;
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const again = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(again.kind === "finished" && again.outcome.ok);
	});

	it("un paso que termina sin ids deja un aviso, no un error", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ movedCount: 3 });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.notEqual(r.outcome.steps[0]?.warning, null);
		assert.equal(r.outcome.steps[0]?.error, null);
		assert.deepEqual(r.outcome.touchedNodeIds, []);
	});

	it("dispara el callback de progreso tras cada paso (CA-2)", async () => {
		const { gateway, scripts, runToEnd, progressCalls } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.deepEqual(
			progressCalls.map((p) => p.progress.done),
			[1, 2],
		);
		assert.equal(progressCalls[1]?.progress.total, 2);
	});

	it("supera el plazo blando: devuelve running + jobId y el job muestra el paso actual (CA-2)", async () => {
		const { gateway, scripts, jobs, runBuild } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let calls = 0;
		gateway.runReply = () => {
			calls += 1;
			return calls === 1 ? slow.promise : Promise.resolve(ok({}));
		};
		const r = await runBuild({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "running");
		const job = jobs.get(r.jobId);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.equal(job.status, JOB_STATUS.running);
		assert.deepEqual(job.progress.current, { index: 0, file: "a.js" });
		assert.equal(job.steps[0]?.status, STEP_STATUS.running);

		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await flush();
		const done = jobs.get(r.jobId);
		assert.equal(done?.status, JOB_STATUS.done);
		assert.ok(done && "outcome" in done && done.outcome.ok);
	});

	it("cancelación entre pasos: el paso en curso acaba y los siguientes quedan cancelled (CA-3)", async () => {
		const { gateway, scripts, jobs, runBuild } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let calls = 0;
		gateway.runReply = () => {
			calls += 1;
			return calls === 1 ? slow.promise : Promise.resolve(ok({}));
		};
		const r = await runBuild({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
		});
		assert.ok(r.kind === "running");
		await until(() => gateway.runCalls.length === 1);
		jobs.requestCancel(r.jobId);
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await flush();
		const job = jobs.get(r.jobId);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.ok(job.status !== JOB_STATUS.running);
		assert.equal(job.status, JOB_STATUS.cancelled);
		assert.equal(job.outcome.ok, true);
		assert.deepEqual(job.outcome.touchedNodeIds, ["1:1"]);
		assert.equal(job.steps[0]?.status, STEP_STATUS.done);
		assert.equal(job.steps[1]?.status, STEP_STATUS.cancelled);
		assert.equal(job.steps[2]?.status, STEP_STATUS.cancelled);
		assert.equal(gateway.runCalls.length, 1);
	});

	it("responde en cuanto acepta el lote, con el jobId y el plan entero, sin esperar al primer paso (CA-2)", async () => {
		const { gateway, scripts, runBuild } = setup();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await Promise.race([
			runBuild({ plan: planOf(step("a.js"), step("b.js")) }),
			new Promise<"tarde">((res) => setTimeout(() => res("tarde"), 300)),
		]);
		assert.notEqual(r, "tarde");
		assert.ok(typeof r === "object" && r.kind === "running");
		assert.equal(r.outcome.status, BUILD_STATUS.running);
		assert.deepEqual(
			r.outcome.steps.map((s) => s.file),
			["a.js", "b.js"],
		);
		slow.resolve(ok({}));
	});

	it("un error de validación sigue llegando en la misma respuesta y sin job (CA-2)", async () => {
		const { runToEnd } = setup();
		const r = await runToEnd({ plan: planOf(step("falta.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.ok, false);
	});

	it("cancelado durante el 3.º de 4: progress es 3 hechos, 1 cancelado, no 4 de 4 (CA-1)", async () => {
		const { gateway, scripts, jobs, runBuild } = setup();
		for (const f of ["a.js", "b.js", "c.js", "d.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let calls = 0;
		gateway.runReply = () => {
			calls += 1;
			return calls === 3 ? slow.promise : Promise.resolve(ok({}));
		};
		const r = await runBuild({
			plan: planOf(step("a.js"), step("b.js"), step("c.js"), step("d.js")),
		});
		assert.ok(r.kind === "running");
		await until(() => gateway.runCalls.length === 3);
		jobs.requestCancel(r.jobId);
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await flush();
		const job = jobs.get(r.jobId);
		assert.ok(job && "progress" in job);
		assert.deepEqual(job.progress, {
			done: 3,
			total: 4,
			cancelled: 1,
			skipped: 0,
			current: null,
		});
	});

	it("con fromStep: 2 de 5, done empieza en 0 y skipped es 2 (CA-1)", async () => {
		const { scripts, runToEnd } = setup();
		for (const f of ["a.js", "b.js", "c.js", "d.js", "e.js"])
			scripts.files.set(f, f);
		const r = await runToEnd({
			plan: planOf(
				step("a.js"),
				step("b.js"),
				step("c.js"),
				step("d.js"),
				step("e.js"),
			),
			fromStep: 2,
			stopOnError: true,
		});
		assert.ok(r.kind === "finished");
		assert.deepEqual(r.outcome.progress, {
			done: 3,
			total: 5,
			cancelled: 0,
			skipped: 2,
			current: null,
		});
	});

	it("onProgress dice qué paso cambió: con omitidos delante no es done-1 (CA-1)", async () => {
		const seen: number[] = [];
		const { scripts, runToEnd } = setup({
			onProgress: ({ stepIndex }) => seen.push(stepIndex),
		});
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
			fromStep: 1,
		});
		assert.deepEqual(seen, [1, 2]);
	});

	it("cancelar durante el último paso no lo interrumpe: el lote acaba done y no hay pasos cancelled", async () => {
		const { gateway, scripts, jobs, runBuild } = setup();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let calls = 0;
		gateway.runReply = () => {
			calls += 1;
			return calls === 2 ? slow.promise : Promise.resolve(ok({}));
		};
		const r = await runBuild({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "running");
		await until(() => gateway.runCalls.length === 2);
		jobs.requestCancel(r.jobId);
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await flush();
		const job = jobs.get(r.jobId);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.equal(job.status, JOB_STATUS.done);
		assert.deepEqual(
			job.steps.map((s) => s.status),
			[STEP_STATUS.done, STEP_STATUS.done],
		);
	});

	it("la validación previa comprueba los assets de todos los pasos pero solo lee los bytes del paso que ejecuta", async () => {
		const { gateway, scripts, assets, runBuild } = setup();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		assets.files.set("/a/uno.png", Uint8Array.from([1]));
		assets.files.set("/a/dos.png", Uint8Array.from([2]));
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await runBuild({
			plan: planOf(
				step("a.js", { assets: { uno: "/a/uno.png" } }),
				step("b.js", { assets: { dos: "/a/dos.png" } }),
			),
		});
		assert.ok(r.kind === "running");
		assert.deepEqual(assets.checkCalls, [
			{ uno: "/a/uno.png" },
			{ dos: "/a/dos.png" },
		]);
		assert.deepEqual(assets.readCalls, [{ uno: "/a/uno.png" }]);
		slow.resolve(ok({}));
		await flush();
		await flush();
		assert.deepEqual(assets.readCalls, [
			{ uno: "/a/uno.png" },
			{ dos: "/a/dos.png" },
		]);
		assert.deepEqual(gateway.runCalls[1]?.script.assets, {
			dos: Uint8Array.from([2]),
		});
	});

	it("un asset que desaparece entre la validación y su paso deja ese paso failed sin enviarlo", async () => {
		const { gateway, scripts, assets, jobs, runBuild } = setup();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		assets.files.set("/a/dos.png", Uint8Array.from([2]));
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await runBuild({
			plan: planOf(
				step("a.js"),
				step("b.js", { assets: { dos: "/a/dos.png" } }),
			),
		});
		assert.ok(r.kind === "running");
		assets.files.delete("/a/dos.png");
		slow.resolve(ok({}));
		await flush();
		await flush();
		const job = jobs.get(r.jobId);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.equal(job.status, JOB_STATUS.failed);
		assert.equal(job.steps[1]?.status, STEP_STATUS.failed);
		assert.equal(gateway.runCalls.length, 1);
	});

	it("con el lock tomado por OTRA sesión, el lote se rechaza diciéndolo y sin tocar Figma", async () => {
		const gateway = new InMemoryFigmaGateway();
		const scripts = new InMemoryScriptRepository();
		scripts.files.set("a.js", "A");
		const jobs = createJobRegistry(() => toJobId("build-1"), {
			acquire: () => false,
			release: () => {},
			active: () => toJobId("ajeno-9"),
			foreignPid: () => 777,
		});
		const runBuild = makeRunBuild({
			project: new InMemoryProjectConfig(projectWith([])),
			checkStep: fakeStepIssues,
			gateway,
			scripts,
			assets: new InMemoryAssetRepository(),
			store: new InMemoryResultStore(),
			maxInlineResultBytes: 1000,
			jobs,
			stepTimeoutMs: 1000,
			maxParamsBytes: 1000,
			maxSteps: 5,
		});
		const r = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /otra sesión/);
		assert.match(r.message, /777/);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("si el lock lo gana otra sesión entre la comprobación y la reserva, también se rechaza sin dejar job", async () => {
		const gateway = new InMemoryFigmaGateway();
		const scripts = new InMemoryScriptRepository();
		scripts.files.set("a.js", "A");
		let taken = false;
		const jobs = createJobRegistry(() => toJobId("build-1"), {
			acquire: () => false,
			release: () => {},
			// Libre al comprobar, y ocupado justo después (otro proceso se adelantó)
			active: () => {
				const was = taken;
				taken = true;
				return was ? toJobId("ajeno-9") : undefined;
			},
			foreignPid: () => 888,
		});
		const runBuild = makeRunBuild({
			project: new InMemoryProjectConfig(projectWith([])),
			checkStep: fakeStepIssues,
			gateway,
			scripts,
			assets: new InMemoryAssetRepository(),
			store: new InMemoryResultStore(),
			maxInlineResultBytes: 1000,
			jobs,
			stepTimeoutMs: 1000,
			maxParamsBytes: 1000,
			maxSteps: 5,
		});
		const r = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /888/);
		assert.equal(jobs.get(toJobId("build-1")), undefined);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("con un lote en marcha, otro figma_build se rechaza con error de uso (CA-8)", async () => {
		const { gateway, scripts, runBuild } = setup();
		scripts.files.set("a.js", "A");
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const first = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(first.kind === "running");
		const second = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(second.kind === "usage");
		assert.match(second.message, /lote en marcha/);
		slow.resolve(ok({}));
		await flush();
	});

	it("un lote que termina DENTRO del plazo también avisa (job_finished con estado terminal, no se queda running en el histórico)", async () => {
		const { gateway, scripts, runToEnd, finishedJobs } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(finishedJobs.length, 1);
		assert.equal(finishedJobs[0]?.jobId, r.jobId);
		assert.equal(finishedJobs[0]?.ok, true);
	});

	it("una validación fallida no avisa (no hubo job que cerrar en el histórico)", async () => {
		const { runToEnd, finishedJobs } = setup();
		const r = await runToEnd({ plan: planOf(step("a.js")) }); // a.js no existe
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.jobId, null);
		assert.equal(finishedJobs.length, 0);
	});

	it("un lote que supera el plazo avisa cuando termina en segundo plano", async () => {
		const { gateway, scripts, runBuild, finishedJobs } = setup();
		scripts.files.set("a.js", "A");
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const r = await runBuild({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "running");
		assert.equal(finishedJobs.length, 0);
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await flush();
		assert.equal(finishedJobs.length, 1);
		assert.equal(finishedJobs[0]?.ok, true);
	});
});

describe("makeRunBuild: step@1", () => {
	const HEADER = "// @contract step@1 · prueba\n";

	it("cada paso pide al gateway el kit de Figma", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		await runToEnd({ plan: planOf(step("a.js")) });
		assert.equal(gateway.runCalls[0]?.options?.installKit, true);
	});

	it("un paso con cabecera y resultado bueno: hecho, con los warnings en su aviso y sin el de nodos sin declarar", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		gateway.runReply = async () =>
			ok({
				createdNodeIds: [],
				mutatedNodeIds: [],
				warnings: [{ code: "MULTI_MODE", message: "dos modos" }],
			});
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.equal(r.outcome.steps[0]?.warning, "MULTI_MODE: dos modos");
	});

	it("un informe de desfase (`report.drift`) se guarda entero en reads/ y su ruta sale en el aviso del paso; el lote sigue con el siguiente", async () => {
		const { gateway, scripts, store, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		scripts.files.set("b.js", `${HEADER}B`);
		const drift = {
			sheet: "td",
			reason: "drift",
			figmaOnlyProps: { card: ["no"] },
		};
		gateway.runReply = async (s) =>
			s.code.endsWith("A")
				? ok({
						createdNodeIds: [],
						mutatedNodeIds: [],
						warnings: [
							{ code: "SHEET_DRIFT", message: "Figma va por delante" },
						],
						report: { sheet: "td", skipped: "drift", drift },
					})
				: ok({ createdNodeIds: ["1:1"], mutatedNodeIds: [] });
		const r = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(r.kind === "finished");
		assert.deepEqual(
			r.outcome.steps.map((x) => x.status),
			[STEP_STATUS.done, STEP_STATUS.done],
		);
		assert.equal(store.reads.length, 1);
		assert.equal(store.reads[0]?.name.tool, "desfase_td");
		assert.deepEqual(JSON.parse(store.reads[0]?.json ?? "null"), drift);
		assert.match(
			r.outcome.steps[0]?.warning ?? "",
			/^SHEET_DRIFT: Figma va por delante.*\/salida\/reads\/desfase_td/,
		);
		assert.equal(r.outcome.steps[1]?.warning, null);
	});

	it("con las listas vacías y sin warnings, el paso no lleva aviso", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		gateway.runReply = async () =>
			ok({ createdNodeIds: [], mutatedNodeIds: [] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.warning, null);
	});

	it("un paso con cabecera y resultado malo falla con ContractError (puntero, no reintentable) y conserva los ids que se leen", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		gateway.runReply = async () =>
			ok({ createdNodeIds: ["1:1", 7], mutatedNodeIds: ["1:2"] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		const failed = r.outcome.steps[0];
		assert.equal(failed?.status, STEP_STATUS.failed);
		assert.ok(failed?.error?.type === "ContractError");
		assert.equal(failed.error.path, "/createdNodeIds/1");
		assert.equal(failed.error.retryable, false);
		assert.equal(failed.touchedCount, 2);
		assert.equal(r.outcome.ok, false);
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1", "1:2"]);
	});

	it("con stopOnError el paso malo para el lote; sin él, sigue con el resto", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		scripts.files.set("b.js", "B");
		gateway.runReply = async (s) =>
			s.code.endsWith("A")
				? ok({ createdNodeIds: 5, mutatedNodeIds: [] })
				: ok({ createdNodeIds: ["1:1"] });
		const stop = await runToEnd({ plan: planOf(step("a.js"), step("b.js")) });
		assert.ok(stop.kind === "finished");
		assert.equal(stop.outcome.steps[1]?.status, STEP_STATUS.pending);
		assert.equal(gateway.runCalls.length, 1);

		const go = await runToEnd({
			plan: planOf(step("a.js"), step("b.js")),
			stopOnError: false,
		});
		assert.ok(go.kind === "finished");
		assert.equal(go.outcome.steps[1]?.status, STEP_STATUS.done);
	});

	it("sin cabecera, el paso se trata como siempre: aviso de M2 y ningún juicio", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ movedCount: 1, createdNodeIds: [7] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.match(r.outcome.steps[0]?.warning ?? "", /sin declarar nodos/i);
	});

	it("un paso sin cabecera que declara listas vacías no lleva el aviso: declaró que no tocó nada", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () =>
			ok({ createdNodeIds: [], mutatedNodeIds: [] });
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.status, STEP_STATUS.done);
		assert.equal(r.outcome.steps[0]?.warning, null);
		assert.equal(r.outcome.steps[0]?.touchedCount, 0);
	});

	it("removedNodeIds de un paso no entra en los ids tocados del lote", async () => {
		const { gateway, scripts, runToEnd } = setup();
		scripts.files.set("a.js", `${HEADER}A`);
		gateway.runReply = async () =>
			ok({
				createdNodeIds: ["1:1"],
				mutatedNodeIds: [],
				removedNodeIds: ["1:9"],
			});
		const r = await runToEnd({ plan: planOf(step("a.js")) });
		assert.ok(r.kind === "finished");
		assert.deepEqual(r.outcome.touchedNodeIds, ["1:1"]);
	});
});

describe("makeRunBuild: historial de intentos", () => {
	it("un intento por paso que corre, con el job, el índice y la llamada", async () => {
		const { gateway, scripts, attemptLog, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await runToEnd({
			plan: planOf(step("a.js", { params: { x: 1 } }), step("b.js")),
			callId: "call-5",
		});
		assert.ok(r.kind === "finished");
		assert.deepEqual(
			attemptLog.recorded.map((a) => [
				a.kind,
				a.target,
				a.stepIndex,
				a.callId,
				a.jobId,
				a.status,
			]),
			[
				["build_step", "a.js", 0, "call-5", r.jobId, "ok"],
				["build_step", "b.js", 1, "call-5", r.jobId, "ok"],
			],
		);
		assert.deepEqual(
			attemptLog.recorded[0]?.scripts.map((s) => [s.role, s.content]),
			[
				["step", "A"],
				["params", '{"x":1}'],
				["kit", "KIT"],
			],
		);
	});

	it("los pasos omitidos por fromStep y los que no empezaron por la parada no dejan intento", async () => {
		const { gateway, scripts, attemptLog, runToEnd } = setup();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		gateway.runReply = async (script) =>
			script.code === "b.js"
				? err(scriptError("boom", 1, false))
				: ok({ createdNodeIds: ["1:1"] });
		await runToEnd({
			plan: planOf(step("a.js"), step("b.js"), step("c.js")),
			fromStep: 1,
		});
		assert.deepEqual(
			attemptLog.recorded.map((a) => [a.target, a.status]),
			[["b.js", "error"]],
		);
	});

	it("un paso con resultado fuera de step@1 es contract_error", async () => {
		const { gateway, scripts, attemptLog, runToEnd } = setup();
		scripts.files.set("a.js", "// @contract step@1 · x\nA");
		gateway.runReply = async () =>
			ok({ createdNodeIds: [3], mutatedNodeIds: [] });
		await runToEnd({ plan: planOf(step("a.js")) });
		assert.equal(attemptLog.recorded[0]?.status, "contract_error");
	});

	it("el mismo fichero lanzado en dos lotes cuenta 1 y 2", async () => {
		const { gateway, scripts, attemptLog, runToEnd } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		await runToEnd({ plan: planOf(step("a.js")) });
		await runToEnd({ plan: planOf(step("a.js")) });
		assert.deepEqual(
			attemptLog.recorded.map((a) => a.n),
			[1, 2],
		);
	});
});

// --- pasos `use` ---

const RULES: AreasFile["linkRules"] = {
	clickable: { names: ["boton"], namePrefixes: [], components: [] },
	rows: { row: ["fila"], body: ["cuerpo"] },
	transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
};
const AREA = (name: string, extra: Partial<Area> = {}): Area => ({
	name,
	page: name,
	frame: { width: 100, minHeight: 100 },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "t ", take: "first-frame" },
	},
	screens: [{ frame: "a" }],
	...extra,
});
const AREAS: AreasFile = {
	contract: AREAS_CONTRACT,
	linkRules: RULES,
	areas: [
		AREA("Uno", {
			fills: [
				{
					frame: "a",
					find: { text: "Mapa", minSize: [1, 1] },
					asset: "mapa.png",
				},
			],
		}),
		AREA("Dos"),
	],
	shared: [
		{
			name: "G",
			set: "G / Set",
			page: { name: "Compartido" },
			part: ["p"],
			variantProp: "area",
			from: [{ area: "Uno", frame: "a", value: "uno" }],
		},
		{
			name: "H",
			set: "H / Set",
			page: { name: "Compartido 2" },
			part: ["p"],
			variantProp: "area",
			from: [{ area: "Dos", frame: "a", value: "dos" }],
		},
	],
};
const withAreas = () =>
	projectWith([], {}, null, AREAS, { "mapa.png": "/proyecto/mapa.png" });
const kitStep = (
	use: KitStep,
	area: string,
	extra: Partial<PlanStep> = {},
): PlanStep => ({
	file: kitStepLabel(use, area),
	format: SCRIPT_FORMAT.body,
	kit: { step: use, area },
	...extra,
});
const okStep = () =>
	ok({ createdNodeIds: ["1:1"], mutatedNodeIds: [] as string[] });

describe("makeRunBuild: pasos del kit", () => {
	it("envía el código fijo con la cabecera, en body, con los params del área sacados de areas@1, y no lee ningún fichero", async () => {
		const { gateway, scripts, runToEnd } = setup({ project: withAreas() });
		gateway.runReply = async () => okStep();
		const r = await runToEnd({
			plan: planOf(kitStep("kit/place@1", "Uno")),
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.deepEqual(scripts.reads, []);
		const sent = gateway.runCalls[0];
		assert.equal(sent?.script.code, kitStepCode("kit/place@1"));
		assert.equal(sent?.script.format, SCRIPT_FORMAT.body);
		assert.deepEqual(sent?.options?.installKit, true);
		// solo el grupo compartido que lleva alguna entrada de esa área
		assert.deepEqual(sent?.script.params, {
			area: AREAS.areas[0],
			linkRules: RULES,
			shared: [AREAS.shared?.[0]],
		});
		assert.equal(sent?.script.assets, undefined);
	});

	it("`kit/fill-image@1` recibe las imágenes de los rellenos del área como assets; los demás pasos, ninguna", async () => {
		const { gateway, assets, runToEnd } = setup({ project: withAreas() });
		assets.files.set("/proyecto/mapa.png", Uint8Array.from([1, 2, 3]));
		gateway.runReply = async () => okStep();
		await runToEnd({
			plan: planOf(
				kitStep("kit/place@1", "Uno"),
				kitStep("kit/fill-image@1", "Uno"),
			),
		});
		assert.equal(gateway.runCalls[0]?.script.assets, undefined);
		assert.deepEqual(Object.keys(gateway.runCalls[1]?.script.assets ?? {}), [
			"mapa.png",
		]);
		assert.deepEqual(assets.readCalls, [{ "mapa.png": "/proyecto/mapa.png" }]);
	});

	it("la etiqueta `kit/<paso>@1 · <área>` sale en los pasos del progreso", async () => {
		const { gateway, runToEnd } = setup({ project: withAreas() });
		gateway.runReply = async () => okStep();
		const r = await runToEnd({
			plan: planOf(kitStep("kit/links@1", "Dos")),
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.file, "kit/links@1 · Dos");
	});

	it("se juzga siempre: un resultado fuera de step@1 es contract_error aunque el paso no lo pida", async () => {
		const { gateway, runToEnd } = setup({ project: withAreas() });
		gateway.runReply = async () => ok({ createdNodeIds: [3] });
		const r = await runToEnd({ plan: planOf(kitStep("kit/place@1", "Uno")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.error?.type, "ContractError");
	});

	it("deja un intento por paso con origen `key`, los papeles step, params y kit, y cambia `params` si cambia areas.json", async () => {
		const first = setup({ project: withAreas() });
		first.gateway.runReply = async () => okStep();
		await first.runToEnd({
			plan: planOf(kitStep("kit/place@1", "Uno")),
			callId: "c1",
		});
		const attempt = first.attemptLog.recorded[0];
		assert.deepEqual(
			[attempt?.kind, attempt?.target, attempt?.stepIndex, attempt?.callId],
			["build_step", "kit/place@1 · Uno", 0, "c1"],
		);
		assert.deepEqual(
			attempt?.scripts.map((s) => s.role),
			["step", "params", "kit"],
		);
		assert.equal(attempt?.scripts[0]?.content, kitStepCode("kit/place@1"));
		const params = JSON.parse(attempt?.scripts[1]?.content ?? "{}");
		assert.equal(params.area.name, "Uno");
		// otro areas.json → otro contenido de `params` para el mismo objetivo
		const changed = setup({
			project: projectWith([], {}, null, {
				...AREAS,
				areas: [
					AREA("Uno", { frame: { width: 200, minHeight: 100 } }),
					AREA("Dos"),
				],
			}),
		});
		changed.gateway.runReply = async () => okStep();
		await changed.runToEnd({ plan: planOf(kitStep("kit/place@1", "Uno")) });
		assert.notEqual(
			changed.attemptLog.recorded[0]?.scripts[1]?.content,
			attempt?.scripts[1]?.content,
		);
	});

	it("se mezclan con pasos de fichero: el de fichero lee su script y el del kit no", async () => {
		const { gateway, scripts, runToEnd } = setup({ project: withAreas() });
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => okStep();
		await runToEnd({
			plan: planOf(step("a.js"), kitStep("kit/links@1", "Uno")),
		});
		assert.deepEqual(scripts.reads, ["a.js"]);
		assert.equal(gateway.runCalls.length, 2);
	});

	it("un proyecto sin `areas` rechaza el lote antes del job: ProjectConfigError con el campo `areas`, sin lock y sin tocar la pestaña", async () => {
		const { gateway, jobs, runBuild } = setup({ project: projectWith([]) });
		const r = await runBuild({ plan: planOf(kitStep("kit/place@1", "Uno")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.ok, false);
		assert.equal(
			r.outcome.error?.type === "ProjectConfigError" && r.outcome.error.field,
			"areas",
		);
		assert.equal(jobs.activeBuild(), undefined);
		assert.deepEqual(gateway.runCalls, []);
	});

	it("un areas.json inválido (el error de `load`) se devuelve tal cual, sin job", async () => {
		const { project, gateway, jobs, runBuild } = setup();
		project.reply = async () =>
			err(
				areasContractError("/p/areas.json", [
					{ pointer: "/areas/0/name", message: "x" },
				]),
			);
		const r = await runBuild({ plan: planOf(kitStep("kit/place@1", "Uno")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.error?.type, "ContractError");
		assert.equal(jobs.activeBuild(), undefined);
		assert.deepEqual(gateway.runCalls, []);
	});

	it("un área que no existe es un error de uso con las áreas que hay, sin job", async () => {
		const { gateway, jobs, runBuild } = setup({ project: withAreas() });
		const r = await runBuild({ plan: planOf(kitStep("kit/place@1", "Tres")) });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /«Tres».*Uno, Dos/);
		assert.equal(jobs.activeBuild(), undefined);
		assert.deepEqual(gateway.runCalls, []);
	});

	it("los params de un área que pasan el tope se rechazan antes del job con su tamaño", async () => {
		const { gateway, runBuild } = setup({
			project: withAreas(),
			maxParamsBytes: 100,
		});
		const r = await runBuild({ plan: planOf(kitStep("kit/place@1", "Uno")) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.match(r.outcome.error?.message ?? "", /tope/);
		assert.deepEqual(gateway.runCalls, []);
	});

	it("una imagen de relleno que ya no existe se rechaza antes del job", async () => {
		const { gateway, runBuild } = setup({ project: withAreas() });
		const r = await runBuild({
			plan: planOf(kitStep("kit/fill-image@1", "Uno")),
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.deepEqual(gateway.runCalls, []);
	});

	it("con fromStep no se resuelve lo que se omite: un área desconocida antes no estorba", async () => {
		const { gateway, runToEnd, project } = setup({ project: withAreas() });
		gateway.runReply = async () => okStep();
		const r = await runToEnd({
			plan: planOf(
				kitStep("kit/place@1", "Tres"),
				kitStep("kit/links@1", "Dos"),
			),
			fromStep: 1,
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.equal(project.loads, 1);
	});

	it("un plan sin pasos del kit no lee el proyecto (CA-8)", async () => {
		const { gateway, scripts, runToEnd, project } = setup();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		await runToEnd({ plan: planOf(step("a.js")) });
		assert.equal(project.loads, 0);
	});
});

// Un plan hecho: lo que devolvería makeScreenPlan (su propio test lo cubre)
const screenRun = (over: Record<string, unknown> = {}): ScreenPlanOutcome => ({
	kind: "ok",
	run: {
		plan: { screen: "home" } as never,
		planPath: "/salida/screen-plans/2026-11-12/home_101500.json",
		params: { screen: "home", area: "Uno", frame: "a", variant: 0 },
		assets: {
			plan: "/salida/screen-plans/2026-11-12/home_101500.json",
			["f".repeat(64)]: "/salida/web-captures/img/f.png",
		},
		recognizeSource: null,
		contents: {
			plan: '{"screen":"home"}',
			map: { path: "/proyecto/map.json", content: '{"contract":"map@1"}' },
		},
		...over,
	},
});
const screenStep = (
	extra: Partial<NonNullable<PlanStep["kit"]>> = {},
): PlanStep => ({
	file: kitStepLabel("kit/build-screen@1", "home"),
	format: SCRIPT_FORMAT.body,
	kit: { step: "kit/build-screen@1", screen: "home", area: "Uno", ...extra },
});

describe("makeRunBuild: kit/build-screen@1", () => {
	const withFiles = (outcome: ScreenPlanOutcome = screenRun()) => {
		const calls: unknown[] = [];
		const s = setup({
			project: withAreas(),
			screenPlan: async (project, input) => {
				calls.push(input);
				assert.equal(project.file, withAreas().file);
				return outcome;
			},
		});
		s.assets.files.set(
			"/salida/screen-plans/2026-11-12/home_101500.json",
			Uint8Array.from([1]),
		);
		s.assets.files.set("/salida/web-captures/img/f.png", Uint8Array.from([2]));
		s.gateway.runReply = async () => okStep();
		return { ...s, calls };
	};

	it("envía el código fijo con los params pequeños y el plan y las imágenes como assets; no lee ningún fichero", async () => {
		const { gateway, scripts, assets, runToEnd, calls } = withFiles();
		const r = await runToEnd({
			plan: planOf(
				screenStep({ variant: 1, capture: "2026-11-12/home_1.json" }),
			),
		});
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.deepEqual(scripts.reads, []);
		const sent = gateway.runCalls[0];
		assert.equal(sent?.script.code, kitStepCode("kit/build-screen@1"));
		assert.deepEqual(sent?.script.params, {
			screen: "home",
			area: "Uno",
			frame: "a",
			variant: 0,
		});
		assert.deepEqual(
			Object.keys(sent?.script.assets ?? {}).sort(),
			["f".repeat(64), "plan"].sort(),
		);
		assert.equal(assets.readCalls.length, 1);
		assert.deepEqual(calls, [
			{
				screen: "home",
				area: "Uno",
				variant: 1,
				capture: "2026-11-12/home_1.json",
			},
		]);
	});

	it("la etiqueta `kit/build-screen@1 · <pantalla>` sale en el progreso", async () => {
		const { runToEnd } = withFiles();
		const r = await runToEnd({ plan: planOf(screenStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.file, "kit/build-screen@1 · home");
	});

	it("el intento guarda los papeles step, params, kit, plan y map; cambiar la captura cambia `plan`, cambiar map.json cambia `map` y `plan`", async () => {
		const a = withFiles();
		await a.runToEnd({ plan: planOf(screenStep()), callId: "c1" });
		const attempt = a.attemptLog.recorded[0];
		assert.deepEqual(
			[attempt?.kind, attempt?.target, attempt?.callId],
			["build_step", "kit/build-screen@1 · home", "c1"],
		);
		assert.deepEqual(
			attempt?.scripts.map((x) => x.role),
			["step", "params", "kit", "map", "plan"],
		);
		assert.equal(attempt?.scripts[4]?.content, '{"screen":"home"}');
		assert.equal(attempt?.scripts[3]?.path, "/proyecto/map.json");
		assert.equal(attempt?.scripts[3]?.content, '{"contract":"map@1"}');
	});

	it("con recognize@1 el código del paso lleva el módulo y el intento guarda el papel `recognize` tras `plan`", async () => {
		const SOURCE = '{ contract: "recognize@1", rules: {} }';
		const outcome = screenRun({
			recognizeSource: SOURCE,
			contents: {
				plan: '{"screen":"home"}',
				map: { path: "/proyecto/map.json", content: '{"contract":"map@1"}' },
				recognize: { path: "/proyecto/recognize.js", content: SOURCE },
			},
		});
		const s = withFiles(outcome);
		await s.runToEnd({ plan: planOf(screenStep()), callId: "c2" });
		assert.equal(
			s.gateway.runCalls[0]?.script.code,
			kitStepCode("kit/build-screen@1", { recognize: SOURCE }),
		);
		assert.match(s.gateway.runCalls[0]?.script.code ?? "", /rules: \{\}/);
		const attempt = s.attemptLog.recorded[0];
		assert.deepEqual(
			attempt?.scripts.map((x) => x.role),
			["step", "params", "kit", "map", "plan", "recognize"],
		);
		// el módulo es su propio papel: el papel `step` es el código fijo, así cambiar recognize.js no cambia `step`
		assert.equal(
			attempt?.scripts[0]?.content,
			kitStepCode("kit/build-screen@1"),
		);
		assert.equal(attempt?.scripts[5]?.path, "/proyecto/recognize.js");
		assert.equal(attempt?.scripts[5]?.content, SOURCE);
	});

	it("un `usage` del plan (sin captura, pantalla fuera del área) rechaza el lote sin job, sin lock y sin tocar la pestaña", async () => {
		const { runBuild, gateway, jobs } = withFiles({
			kind: "usage",
			message: "la pantalla «home» no tiene captura",
		});
		const r = await runBuild({ plan: planOf(screenStep()) });
		assert.deepEqual(r, {
			kind: "usage",
			message: "la pantalla «home» no tiene captura",
		});
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un error del plan (sin `map`) rechaza el lote con ese error, sin job", async () => {
		const { runBuild, gateway, jobs } = withFiles({
			kind: "error",
			error: projectConfigError("/p/figma-control-center.json", "map", "falta"),
		});
		const r = await runBuild({ plan: planOf(screenStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.error?.type, "ProjectConfigError");
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un asset que no existe o pasa del tope se rechaza antes de enviar nada (la validación previa de los assets)", async () => {
		const s = withFiles();
		s.assets.files.delete("/salida/web-captures/img/f.png");
		const r = await s.runBuild({ plan: planOf(screenStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.error?.type, "ScriptReadError");
		assert.equal(s.gateway.runCalls.length, 0);
	});

	it("con `fromStep` no se arma el plan de los pasos que se saltan", async () => {
		const { runToEnd, calls } = withFiles();
		await runToEnd({
			plan: planOf(screenStep(), kitStep("kit/place@1", "Uno")),
			fromStep: 1,
		});
		assert.deepEqual(calls, []);
	});
});

const sheetRun = (over: Partial<SheetPlanRun> = {}): SheetPlanOutcome => ({
	kind: "ok",
	run: {
		plan: { sheet: { key: "button" } } as never,
		planPath: "/salida/sheet-plans/2026-11-12/button_101500.json",
		params: { sheet: "button", scratch: false },
		assets: {
			plan: "/salida/sheet-plans/2026-11-12/button_101500.json",
			["f".repeat(64)]: "/salida/web-captures/img/f.png",
		},
		recognizeSource: null,
		contents: {
			plan: '{"sheet":"button"}',
			map: { path: "/proyecto/map.json", content: '{"contract":"map@1"}' },
			sheets: {
				path: "/proyecto/sheets.json",
				content: '{"contract":"sheets@1"}',
			},
		},
		...over,
	},
});
const sheetStep = (
	extra: Partial<NonNullable<PlanStep["kit"]>> = {},
): PlanStep => ({
	file: kitStepLabel("kit/build-component@1", "button"),
	format: SCRIPT_FORMAT.body,
	kit: { step: "kit/build-component@1", sheet: "button", ...extra },
});

describe("makeRunBuild: kit/build-component@1", () => {
	const withFiles = (outcome: SheetPlanOutcome = sheetRun()) => {
		const calls: unknown[] = [];
		const s = setup({
			sheetPlan: async (project, input) => {
				calls.push(input);
				assert.equal(project.file, projectWith([]).file);
				return outcome;
			},
		});
		s.assets.files.set(
			"/salida/sheet-plans/2026-11-12/button_101500.json",
			Uint8Array.from([1]),
		);
		s.assets.files.set("/salida/web-captures/img/f.png", Uint8Array.from([2]));
		s.gateway.runReply = async () => okStep();
		return { ...s, calls };
	};

	it("envía el código fijo con los params pequeños y el plan y las imágenes como assets", async () => {
		const { gateway, scripts, runToEnd, calls } = withFiles();
		const r = await runToEnd({ plan: planOf(sheetStep({ scratch: true })) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.deepEqual(scripts.reads, []);
		const sent = gateway.runCalls[0];
		assert.equal(sent?.script.code, kitStepCode("kit/build-component@1"));
		assert.deepEqual(sent?.script.params, { sheet: "button", scratch: false });
		assert.deepEqual(
			Object.keys(sent?.script.assets ?? {}).sort(),
			["f".repeat(64), "plan"].sort(),
		);
		assert.deepEqual(calls, [{ sheet: "button", scratch: true }]);
	});

	it("la etiqueta `kit/build-component@1 · <hoja>` sale en el progreso", async () => {
		const { runToEnd } = withFiles();
		const r = await runToEnd({ plan: planOf(sheetStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.file, "kit/build-component@1 · button");
	});

	it("el intento guarda los papeles step, params, kit, map, plan y sheets (recognize si lo hay)", async () => {
		const a = withFiles();
		await a.runToEnd({ plan: planOf(sheetStep()), callId: "c1" });
		const attempt = a.attemptLog.recorded[0];
		assert.deepEqual(
			[attempt?.kind, attempt?.target, attempt?.callId],
			["build_step", "kit/build-component@1 · button", "c1"],
		);
		assert.deepEqual(
			attempt?.scripts.map((x) => x.role),
			["step", "params", "kit", "sheets", "map", "plan"],
		);
		const sheets = attempt?.scripts.find((x) => x.role === "sheets");
		assert.equal(sheets?.path, "/proyecto/sheets.json");
		assert.equal(sheets?.content, '{"contract":"sheets@1"}');

		const SOURCE = '{ contract: "recognize@1", rules: {} }';
		const b = withFiles(
			sheetRun({
				recognizeSource: SOURCE,
				contents: {
					plan: "{}",
					map: { path: "/proyecto/map.json", content: "{}" },
					sheets: { path: "/proyecto/sheets.json", content: "{}" },
					recognize: { path: "/proyecto/recognize.js", content: SOURCE },
				},
			}),
		);
		await b.runToEnd({ plan: planOf(sheetStep()), callId: "c2" });
		assert.equal(
			b.gateway.runCalls[0]?.script.code,
			kitStepCode("kit/build-component@1", { recognize: SOURCE }),
		);
		assert.deepEqual(
			b.attemptLog.recorded[0]?.scripts.map((x) => x.role),
			["step", "params", "kit", "sheets", "map", "plan", "recognize"],
		);
		assert.equal(
			b.attemptLog.recorded[0]?.scripts[0]?.content,
			kitStepCode("kit/build-component@1"),
		);
	});

	it("un `usage` del plan (hoja desconocida, sin captura) rechaza el lote sin job, sin lock y sin tocar la pestaña", async () => {
		const { runBuild, gateway, jobs } = withFiles({
			kind: "usage",
			message: "la hoja «button» no tiene captura",
		});
		const r = await runBuild({ plan: planOf(sheetStep()) });
		assert.deepEqual(r, {
			kind: "usage",
			message: "la hoja «button» no tiene captura",
		});
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un error del plan (sin `sheets`) rechaza el lote con ese error, sin job", async () => {
		const { runBuild, gateway, jobs } = withFiles({
			kind: "error",
			error: projectConfigError(
				"/p/figma-control-center.json",
				"sheets",
				"falta",
			),
		});
		const r = await runBuild({ plan: planOf(sheetStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.error?.type, "ProjectConfigError");
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un servidor sin plan de hojas lo dice como error de uso", async () => {
		const s = setup({});
		const r = await s.runBuild({ plan: planOf(sheetStep()) });
		assert.equal(r.kind, "usage");
	});
});

const composeRun = (
	over: Partial<ComposePlanRun> = {},
): ComposePlanOutcome => ({
	kind: "ok",
	run: {
		params: {
			compose: { key: "alta" } as never,
			sheets: [{ key: "button", title: "Button" }],
		},
		contents: {
			plan: '{"key":"alta"}',
			sheets: {
				path: "/proyecto/sheets.json",
				content: '{"contract":"sheets@1"}',
			},
		},
		...over,
	},
});
const composeStep = (
	extra: Partial<NonNullable<PlanStep["kit"]>> = {},
): PlanStep => ({
	file: kitStepLabel("kit/compose@1", "alta"),
	format: SCRIPT_FORMAT.body,
	kit: { step: "kit/compose@1", compose: "alta", ...extra },
});

describe("makeRunBuild: kit/compose@1", () => {
	const withCompose = (outcome: ComposePlanOutcome = composeRun()) => {
		const calls: unknown[] = [];
		const s = setup({
			composePlan: async (project, input) => {
				calls.push(input);
				assert.equal(project.file, projectWith([]).file);
				return outcome;
			},
		});
		s.gateway.runReply = async () => okStep();
		return { ...s, calls };
	};

	it("envía el código fijo con el compose y las hojas como params, sin assets", async () => {
		const { gateway, scripts, runToEnd, calls } = withCompose();
		const r = await runToEnd({ plan: planOf(composeStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, BUILD_STATUS.done);
		assert.deepEqual(scripts.reads, []);
		const sent = gateway.runCalls[0];
		assert.equal(sent?.script.code, kitStepCode("kit/compose@1"));
		assert.deepEqual(sent?.script.params, {
			compose: { key: "alta" },
			sheets: [{ key: "button", title: "Button" }],
		});
		assert.equal(sent?.script.assets, undefined);
		assert.deepEqual(calls, [{ compose: "alta" }]);
	});

	it("la etiqueta `kit/compose@1 · <clave>` sale en el progreso", async () => {
		const { runToEnd } = withCompose();
		const r = await runToEnd({ plan: planOf(composeStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.steps[0]?.file, "kit/compose@1 · alta");
	});

	it("el intento guarda los papeles step, params, kit, sheets y plan (sin map)", async () => {
		const a = withCompose();
		await a.runToEnd({ plan: planOf(composeStep()), callId: "c1" });
		const attempt = a.attemptLog.recorded[0];
		assert.deepEqual(
			[attempt?.kind, attempt?.target, attempt?.callId],
			["build_step", "kit/compose@1 · alta", "c1"],
		);
		assert.deepEqual(
			attempt?.scripts.map((x) => x.role),
			["step", "params", "kit", "sheets", "plan"],
		);
		assert.equal(
			attempt?.scripts.find((x) => x.role === "plan")?.content,
			'{"key":"alta"}',
		);
	});

	it("un `usage` del plan rechaza el lote sin job, sin lock y sin tocar la pestaña", async () => {
		const { runBuild, gateway, jobs } = withCompose({
			kind: "usage",
			message: "el compose «alta» no existe",
		});
		const r = await runBuild({ plan: planOf(composeStep()) });
		assert.deepEqual(r, {
			kind: "usage",
			message: "el compose «alta» no existe",
		});
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un ContractError del plan (E100) rechaza el lote con ese error, sin job ni llamada a Figma", async () => {
		const error = {
			type: "ContractError",
			message: "El compose no cumple compose@1: /root/fill: valor suelto",
			path: "/root/fill",
			retryable: true,
			nextStep: "corrige",
		} as never;
		const { runBuild, gateway, jobs } = withCompose({ kind: "error", error });
		const r = await runBuild({ plan: planOf(composeStep()) });
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, null);
		assert.equal(r.outcome.error?.type, "ContractError");
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("un servidor sin plan de compose lo dice como error de uso", async () => {
		const s = setup({});
		const r = await s.runBuild({ plan: planOf(composeStep()) });
		assert.equal(r.kind, "usage");
	});
});
