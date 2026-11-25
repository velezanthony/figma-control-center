import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReadFile } from "#domain/catalog.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
	figmaNotReady,
	scriptError,
} from "#domain/figma-error.ts";
import { JOB_STATUS, toJobId } from "#domain/job.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { createJobRegistry } from "./job-registry.ts";
import { makeRunRead } from "./run-read.ts";
import { deferred } from "./testing/in-memory-figma-gateway.ts";
import { InMemoryFigmaReader } from "./testing/in-memory-figma-reader.ts";

const FILE: ReadFile = {
	path: "/salida/reads/variables.json",
	bytes: 10,
	summary: { collections: 2 },
};

function setup(overrides: { softDeadlineMs?: number } = {}) {
	const finished: { jobId: string; ok: boolean; ms: number }[] = [];
	let clock = 0;
	let n = 0;
	const reader = new InMemoryFigmaReader();
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const runRead = makeRunRead({
		reader,
		jobs,
		softDeadlineMs: overrides.softDeadlineMs ?? 1000,
		now: () => (clock += 50),
		onJobFinished: ({ jobId, outcome, ms }) =>
			finished.push({ jobId, ok: outcome.ok, ms }),
	});
	return { reader, jobs, runRead, finished };
}

describe("makeRunRead: toda lectura pasa por el flujo de jobs (CA-8)", () => {
	it("una lectura corta responde terminada con su jobId, el job queda hecho con la ruta y el resumen y se avisa", async () => {
		const { jobs, runRead, finished } = setup();
		const r = await runRead(async () => ok(FILE));
		assert.ok(r.kind === "finished");
		assert.equal(r.jobId, "job-1");
		assert.deepEqual(r.outcome, ok(FILE));
		const job = jobs.get(toJobId("job-1"));
		assert.ok(job?.status === JOB_STATUS.done);
		assert.deepEqual(job.outcome.result, FILE);
		assert.deepEqual(job.outcome.touchedNodeIds, []);
		assert.deepEqual(finished, [{ jobId: "job-1", ok: true, ms: 50 }]);
	});

	it("una lectura que supera el plazo blando responde running con jobId y el job da el resultado al terminar", async () => {
		const { jobs, runRead, finished } = setup({ softDeadlineMs: 5 });
		const later = deferred<Result<ReadFile, FigmaError>>();
		const r = await runRead(() => later.promise);
		assert.deepEqual(r, { kind: "running", jobId: "job-1" });
		assert.equal(jobs.get(toJobId("job-1"))?.status, JOB_STATUS.running);
		assert.deepEqual(finished, []);
		later.resolve(ok(FILE));
		await jobs.settleOf(toJobId("job-1"));
		const job = jobs.get(toJobId("job-1"));
		assert.ok(job?.status === JOB_STATUS.done);
		assert.deepEqual(job.outcome.result, FILE);
		assert.equal(finished.length, 1);
	});

	it("un fallo de la lectura deja el job fallido con su error, sin ids tocados", async () => {
		const { jobs, runRead, finished } = setup();
		const boom = scriptError("La página «X» no existe", null, false);
		const r = await runRead(async () => err(boom));
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error, boom);
		const job = jobs.get(toJobId("job-1"));
		assert.ok(job?.status === JOB_STATUS.failed);
		assert.equal(job.outcome.error, boom);
		assert.deepEqual(finished, [{ jobId: "job-1", ok: false, ms: 50 }]);
	});

	it("una excepción inesperada al leer cierra el job como fallo, no lo deja en marcha", async () => {
		const { jobs, runRead } = setup();
		const r = await runRead(() => Promise.reject(new Error("disco lleno")));
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.scriptError);
		assert.match(r.outcome.error.message, /disco lleno/);
		assert.equal(jobs.get(toJobId("job-1"))?.status, JOB_STATUS.failed);
	});

	it("con la pestaña sin sesión responde su motivo sin leer y sin crear job", async () => {
		const { reader, jobs, runRead } = setup();
		reader.readyReply = async () =>
			err(figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn));
		let read = false;
		const r = await runRead(async () => {
			read = true;
			return ok(FILE);
		});
		assert.ok(r.kind === "finished" && !r.outcome.ok);
		assert.equal(r.outcome.error.type, FIGMA_ERROR_TYPE.figmaNotReady);
		assert.equal(r.jobId, null);
		assert.equal(read, false);
		assert.equal(jobs.get(toJobId("job-1")), undefined);
	});

	it("con un lote en marcha la lectura responde igual: no consulta el bloqueo de lote (CA-14, decisión 12)", async () => {
		const { jobs, runRead } = setup();
		const build = jobs.startBuild([]);
		assert.equal(jobs.activeBuild(), build);
		const r = await runRead(async () => ok(FILE));
		assert.ok(r.kind === "finished" && r.outcome.ok);
		assert.equal(jobs.activeBuild(), build, "el lote sigue con su bloqueo");
	});
});
