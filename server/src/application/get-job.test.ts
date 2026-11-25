import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import { succeeded } from "#domain/run-outcome.ts";
import { makeGetJob } from "./get-job.ts";
import { createJobRegistry } from "./job-registry.ts";

const SOFT_DEADLINE_MS = 200;

function setup() {
	const jobs = createJobRegistry(() => toJobId("j1"));
	return {
		jobs,
		getJob: makeGetJob(jobs, { softDeadlineMs: SOFT_DEADLINE_MS }),
	};
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("makeGetJob", () => {
	it("devuelve el job en curso, el terminado y null si no existe", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.start();
		assert.equal((await getJob("j1"))?.status, JOB_STATUS.running);
		jobs.complete(id, succeeded(1, []));
		assert.equal((await getJob("j1"))?.status, JOB_STATUS.done);
		assert.equal(await getJob("otro"), null);
	});

	it("con waitMs responde en cuanto el job termina, sin agotar la espera (CA-2)", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.start();
		const started = performance.now();
		const waiting = getJob("j1", 150);
		await pause(20);
		jobs.complete(id, succeeded(1, []));
		assert.equal((await waiting)?.status, JOB_STATUS.done);
		assert.ok(performance.now() - started < 120);
	});

	it("con waitMs, si el job no termina a tiempo devuelve su estado en marcha al vencer", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.start();
		const started = performance.now();
		assert.equal((await getJob("j1", 40))?.status, JOB_STATUS.running);
		assert.ok(performance.now() - started >= 35);
		jobs.complete(id, succeeded(1, []));
	});

	it("la espera tiene de tope el plazo blando", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.start();
		const started = performance.now();
		assert.equal((await getJob("j1", 60_000))?.status, JOB_STATUS.running);
		assert.ok(performance.now() - started < SOFT_DEADLINE_MS + 150);
		jobs.complete(id, succeeded(1, []));
	});

	it("con waitMs, si quien espera cancela, responde ya con el estado en marcha", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.start();
		const cancel = new AbortController();
		const started = performance.now();
		const waiting = getJob("j1", 150, cancel.signal);
		await pause(10);
		cancel.abort();
		assert.equal((await waiting)?.status, JOB_STATUS.running);
		assert.ok(performance.now() - started < 120);
		jobs.complete(id, succeeded(1, []));
	});

	it("un lote también se espera", async () => {
		const { jobs, getJob } = setup();
		const id = jobs.startBuild([]);
		const waiting = getJob("j1", 150);
		await pause(10);
		jobs.completeBuild(id, JOB_STATUS.done, succeeded(null, []), []);
		assert.equal((await waiting)?.status, JOB_STATUS.done);
	});
});
