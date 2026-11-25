import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type BuildStep, STEP_STATUS } from "#domain/build.ts";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import { succeeded } from "#domain/run-outcome.ts";
import { makeCancelJob } from "./cancel-job.ts";
import { createJobRegistry } from "./job-registry.ts";

function setup() {
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const cancelJob = makeCancelJob({ jobs });
	return { jobs, cancelJob };
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

describe("makeCancelJob", () => {
	it("un job de figma_run_script no se puede cancelar (CA-9)", async () => {
		const { jobs, cancelJob } = setup();
		const id = jobs.start();
		const r = await cancelJob({ jobId: id });
		assert.ok(r.kind === "usage");
		assert.match(r.message, /no permite interrumpir/);
		assert.equal(jobs.get(id)?.status, JOB_STATUS.running);
	});

	it("un job desconocido es error de uso", async () => {
		const { cancelJob } = setup();
		const r = await cancelJob({ jobId: toJobId("no-existe") });
		assert.ok(r.kind === "usage");
	});

	it("cancelar responde enseguida con el progreso y los pasos reales y cancelRequested (CA-2)", async () => {
		const { jobs, cancelJob } = setup();
		const steps = [
			stepOf(0, "a.js", STEP_STATUS.done),
			stepOf(1, "b.js", STEP_STATUS.running),
			stepOf(2, "c.js"),
		];
		const id = jobs.startBuild(steps);
		const started = performance.now();
		const r = await cancelJob({ jobId: id });
		assert.ok(performance.now() - started < 200);
		assert.ok(r.kind === "cancelRequested");
		assert.equal(r.jobId, id);
		assert.equal(jobs.isCancelRequested(id), true);
		assert.deepEqual(r.outcome.progress, {
			done: 1,
			total: 3,
			cancelled: 0,
			skipped: 0,
			current: { index: 1, file: "b.js" },
		});
		assert.deepEqual(r.outcome.steps, steps);
	});

	it("cancelar un lote ya terminado devuelve su estado sin volver a pedir cancelación", async () => {
		const { jobs, cancelJob } = setup();
		const id = jobs.startBuild([stepOf(0, "a.js")]);
		jobs.completeBuild(id, JOB_STATUS.done, succeeded(null, ["1:1"]), [
			stepOf(0, "a.js", STEP_STATUS.done),
		]);
		const r = await cancelJob({ jobId: id });
		assert.ok(r.kind === "finished");
		assert.equal(r.outcome.status, JOB_STATUS.done);
		assert.equal(jobs.isCancelRequested(id), false);
	});
});
