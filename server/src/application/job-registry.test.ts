import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type BuildStep, progressOf, STEP_STATUS } from "#domain/build.ts";
import { callTimeout } from "#domain/figma-error.ts";
import { JOB_KIND, JOB_STATUS, toJobId } from "#domain/job.ts";
import { failed, succeeded } from "#domain/run-outcome.ts";
import { type BuildLock, createJobRegistry } from "./job-registry.ts";

function setup() {
	let n = 0;
	return createJobRegistry(() => toJobId(`job-${++n}`));
}

const stepOf = (
	index: number,
	file: string,
	status: BuildStep["status"] = STEP_STATUS.pending,
): BuildStep => ({
	index,
	file,
	status,
	ms: null,
	touchedCount: 0,
	error: null,
	warning: null,
	result: null,
});

describe("createJobRegistry", () => {
	it("un job recién empezado está en running y sin resultado", () => {
		const jobs = setup();
		const id = jobs.start();
		assert.deepEqual(jobs.get(id), { id, status: JOB_STATUS.running });
	});

	it("cada job recibe su propio id", () => {
		const jobs = setup();
		assert.notEqual(jobs.start(), jobs.start());
	});

	it("un resultado correcto deja el job en done con su outcome", () => {
		const jobs = setup();
		const id = jobs.start();
		const outcome = succeeded({ total: 2 }, ["1:1"]);
		jobs.complete(id, outcome);
		assert.deepEqual(jobs.get(id), { id, status: JOB_STATUS.done, outcome });
	});

	it("un resultado con error deja el job en failed con su outcome", () => {
		const jobs = setup();
		const id = jobs.start();
		const outcome = failed(callTimeout(5000));
		jobs.complete(id, outcome);
		assert.deepEqual(jobs.get(id), { id, status: JOB_STATUS.failed, outcome });
	});

	it("completar un job no afecta a los demás", () => {
		const jobs = setup();
		const a = jobs.start();
		const b = jobs.start();
		jobs.complete(a, succeeded(null, []));
		assert.equal(jobs.get(b)?.status, JOB_STATUS.running);
	});

	it("un id desconocido no devuelve nada", () => {
		const jobs = setup();
		assert.equal(jobs.get(toJobId("no-existe")), undefined);
	});
});

describe("createJobRegistry — lotes", () => {
	it("al empezar no hay ningún lote en marcha", () => {
		const jobs = setup();
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("startBuild registra un lote en marcha con su progreso, sus pasos y el bloqueo", () => {
		const jobs = setup();
		const steps = [stepOf(0, "a.js"), stepOf(1, "b.js")];
		const id = jobs.startBuild(steps);
		const job = jobs.get(id);
		assert.ok(job && "kind" in job && job.kind === JOB_KIND.build);
		assert.equal(job.status, JOB_STATUS.running);
		assert.deepEqual(job.steps, steps);
		assert.deepEqual(job.progress, progressOf(steps));
		assert.equal(jobs.activeBuild(), id);
	});

	it("updateBuild recalcula el progreso y los pasos del lote en marcha", () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js"), stepOf(1, "b.js")]);
		const next = [
			stepOf(0, "a.js", STEP_STATUS.done),
			stepOf(1, "b.js", STEP_STATUS.running),
		];
		jobs.updateBuild(id, next);
		const job = jobs.get(id);
		assert.ok(job && "progress" in job);
		assert.equal(job.progress.done, 1);
		assert.deepEqual(job.progress.current, { index: 1, file: "b.js" });
	});

	it("completeBuild deja el lote en su estado terminal y libera el bloqueo", () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		const outcome = succeeded(null, ["1:1"]);
		jobs.completeBuild(id, JOB_STATUS.cancelled, outcome, [
			stepOf(0, "a.js", STEP_STATUS.cancelled),
		]);
		const job = jobs.get(id);
		assert.ok(job && "outcome" in job && "kind" in job);
		assert.equal(job.status, JOB_STATUS.cancelled);
		assert.deepEqual(job.outcome, outcome);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("requestCancel marca la bandera de cancelación del lote", () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		assert.equal(jobs.isCancelRequested(id), false);
		jobs.requestCancel(id);
		assert.equal(jobs.isCancelRequested(id), true);
	});

	it("settleOf se resuelve cuando el lote termina", async () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		let settled = false;
		void jobs.settleOf(id)?.then(() => {
			settled = true;
		});
		await new Promise((r) => setImmediate(r));
		assert.equal(settled, false);
		jobs.completeBuild(id, JOB_STATUS.done, succeeded(null, []), [
			stepOf(0, "a.js", STEP_STATUS.done),
		]);
		await new Promise((r) => setImmediate(r));
		assert.equal(settled, true);
	});
});

describe("createJobRegistry — limpieza", () => {
	it("al cerrar un lote ya no queda su bandera de cancelación ni su aviso de fin", () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		jobs.requestCancel(id);
		jobs.completeBuild(id, JOB_STATUS.cancelled, succeeded(null, []), [
			stepOf(0, "a.js", STEP_STATUS.cancelled),
		]);
		assert.equal(jobs.isCancelRequested(id), false);
		assert.equal(jobs.settleOf(id), undefined);
	});

	it("abandonar una reserva borra también su bandera de cancelación y su aviso de fin", () => {
		const jobs = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		jobs.requestCancel(id);
		jobs.abandonBuild(id);
		assert.equal(jobs.isCancelRequested(id), false);
		assert.equal(jobs.settleOf(id), undefined);
		assert.equal(jobs.get(id), undefined);
	});

	it("los jobs terminados se podan del más antiguo al más nuevo; uno en marcha nunca", () => {
		let n = 0;
		const jobs = createJobRegistry(() => toJobId(`job-${++n}`), undefined, {
			maxFinished: 2,
		});
		const running = jobs.start();
		const first = jobs.start();
		const second = jobs.start();
		const third = jobs.start();
		for (const id of [first, second, third]) {
			jobs.complete(id, succeeded(null, []));
		}
		assert.equal(jobs.get(first), undefined);
		assert.ok(jobs.get(second));
		assert.ok(jobs.get(third));
		assert.equal(jobs.get(running)?.status, JOB_STATUS.running);
	});

	it("un lote terminado también cuenta para el tope", () => {
		let n = 0;
		const jobs = createJobRegistry(() => toJobId(`job-${++n}`), undefined, {
			maxFinished: 1,
		});
		const a = jobs.startBuild([stepOf(0, "a.js")]);
		jobs.completeBuild(a, JOB_STATUS.done, succeeded(null, []), [
			stepOf(0, "a.js", STEP_STATUS.done),
		]);
		const b = jobs.startBuild([stepOf(0, "b.js")]);
		jobs.completeBuild(b, JOB_STATUS.done, succeeded(null, []), [
			stepOf(0, "b.js", STEP_STATUS.done),
		]);
		assert.equal(jobs.get(a), undefined);
		assert.ok(jobs.get(b));
	});
});

describe("createJobRegistry — lock tomado por otra sesión", () => {
	// Un lock que otro proceso tiene: lo único que ve este registro es que no se puede tomar
	const foreignLock = (pid: number, holder = toJobId("ajeno")): BuildLock => ({
		acquire: () => false,
		release: () => {},
		active: () => holder,
		foreignPid: () => pid,
	});

	it("tryStartBuild con el lock de otro no crea ningún job y dice quién lo tiene", () => {
		const jobs = createJobRegistry(() => toJobId("job-1"), foreignLock(777));
		assert.equal(jobs.tryStartBuild([stepOf(0, "a.js")]), undefined);
		assert.equal(jobs.get(toJobId("job-1")), undefined);
		assert.equal(jobs.activeBuild(), "ajeno");
		assert.equal(jobs.foreignLockPid(), 777);
	});

	it("un lote propio no se cuenta como de otra sesión", () => {
		const jobs = setup();
		jobs.startBuild([stepOf(0, "a.js")]);
		assert.equal(jobs.foreignLockPid(), undefined);
	});

	it("tryStartBuild con el lock libre arranca el lote como startBuild", () => {
		const jobs = setup();
		const id = jobs.tryStartBuild([stepOf(0, "a.js")]);
		assert.ok(id !== undefined);
		assert.equal(jobs.activeBuild(), id);
	});
});
