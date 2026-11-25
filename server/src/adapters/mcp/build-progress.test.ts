import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import type { BuildStep, Progress } from "#domain/build.ts";
import { STEP_STATUS } from "#domain/build.ts";
import { toJobId } from "#domain/job.ts";
import {
	type BuildProgressEvent,
	createBuildProgressBus,
	makeProgressNotifier,
	progressMessage,
} from "./build-progress.ts";

const stepOf = (
	index: number,
	file: string,
	status: BuildStep["status"] = STEP_STATUS.done,
): BuildStep => ({
	index,
	file,
	status,
	ms: 10,
	touchedCount: 1,
	error: null,
	warning: null,
	result: null,
});

// Un evento como el que emite run-build tras terminar el paso `done - 1`
const eventOf = (done: number, total: number): BuildProgressEvent => {
	const steps: BuildStep[] = [];
	for (let i = 0; i < total; i++) {
		steps.push(
			stepOf(i, `s${i}.js`, i < done ? STEP_STATUS.done : STEP_STATUS.pending),
		);
	}
	const progress: Progress = {
		done,
		total,
		cancelled: 0,
		skipped: 0,
		current: null,
	};
	return { jobId: toJobId("job-1"), steps, progress, stepIndex: done - 1 };
};

describe("createBuildProgressBus", () => {
	it("publicar sin oyente no hace nada; con oyente le entrega el evento", () => {
		const bus = createBuildProgressBus();
		const seen: BuildProgressEvent[] = [];
		bus.publish(eventOf(1, 2)); // nadie escucha
		const stop = bus.listen((e) => seen.push(e));
		bus.publish(eventOf(2, 2));
		stop();
		bus.publish(eventOf(2, 2)); // ya no escucha nadie: ninguna tras cerrar
		assert.equal(seen.length, 1);
		assert.equal(seen[0]?.progress.done, 2);
	});
});

describe("progressMessage", () => {
	it("nombra el paso que cambió aunque haya omitidos delante", () => {
		const event: BuildProgressEvent = {
			...eventOf(1, 3),
			steps: [
				stepOf(0, "omitido.js", STEP_STATUS.skipped),
				stepOf(1, "hecho.js"),
				stepOf(2, "pendiente.js", STEP_STATUS.pending),
			],
			stepIndex: 1,
		};
		assert.equal(progressMessage(event), "1/3 hecho.js");
	});

	it("nombra el paso recién terminado (índice done-1)", () => {
		assert.equal(progressMessage(eventOf(2, 3)), "2/3 s1.js");
	});
});

describe("makeProgressNotifier (throttle con mock.timers)", () => {
	afterEach(() => mock.timers.reset());

	it("envía como mucho una cada minIntervalMs; el último paso siempre se notifica", async () => {
		mock.timers.enable({ apis: ["Date"], now: 0 });
		const sent: { message: string; progress: number; total: number }[] = [];
		const notifier = makeProgressNotifier({
			send: (message, progress, total) => {
				sent.push({ message, progress, total });
				return Promise.resolve();
			},
			minIntervalMs: 500,
		});

		notifier.push(eventOf(1, 3)); // t=0 → se envía
		mock.timers.setTime(200);
		notifier.push(eventOf(2, 3)); // dentro del intervalo → se retiene
		mock.timers.setTime(600);
		notifier.push(eventOf(3, 3)); // pasó el intervalo → se envía
		await notifier.flush(); // nada pendiente: el 3 ya salió

		assert.deepEqual(
			sent.map((s) => s.progress),
			[1, 3],
		);
		assert.equal(sent[1]?.total, 3);
	});

	it("un envío que rechaza no propaga el fallo (best-effort): push no lanza y flush resuelve", async () => {
		mock.timers.enable({ apis: ["Date"], now: 0 });
		const notifier = makeProgressNotifier({
			send: () => Promise.reject(new Error("canal caído")),
			minIntervalMs: 500,
		});

		// push lanza el envío sin await: no debe lanzar ni dejar un unhandled rejection.
		assert.doesNotThrow(() => notifier.push(eventOf(1, 2))); // t=0 → se envía (y rechaza, tragado)
		mock.timers.setTime(100);
		notifier.push(eventOf(2, 2)); // retenido
		await assert.doesNotReject(() => notifier.flush()); // vacía el retenido (rechaza, tragado)
	});

	it("flush envía el último paso aunque el throttle lo hubiera retenido", async () => {
		mock.timers.enable({ apis: ["Date"], now: 0 });
		const sent: number[] = [];
		const notifier = makeProgressNotifier({
			send: (_m, progress) => {
				sent.push(progress);
				return Promise.resolve();
			},
			minIntervalMs: 500,
		});

		notifier.push(eventOf(1, 2)); // t=0 → se envía
		mock.timers.setTime(100);
		notifier.push(eventOf(2, 2)); // retenido
		await notifier.flush(); // el último se notifica

		assert.deepEqual(sent, [1, 2]);
	});
});
