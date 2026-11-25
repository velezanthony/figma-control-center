import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ACTIVITY_TYPE,
	ACTIVITY_VERSION,
	type ActivityEvent,
} from "#domain/activity.ts";
import { BUILD_STATUS, type BuildStep, STEP_STATUS } from "#domain/build.ts";
import { callTimeout, scriptError } from "#domain/figma-error.ts";
import { toJobId } from "#domain/job.ts";
import { failed, succeeded } from "#domain/run-outcome.ts";
import type { ActivityLog } from "./ports/activity-log.ts";
import { createActivityRecorder } from "./record-activity.ts";
import { InMemoryActivityLog } from "./testing/in-memory-activity-log.ts";
import { READY_STATUS } from "./testing/in-memory-figma-gateway.ts";

function setup(
	overrides: { log?: ActivityLog; codePreviewChars?: number } = {},
) {
	const log = new InMemoryActivityLog();
	const warnings: string[] = [];
	let ticks = 0;
	let calls = 0;
	const recorder = createActivityRecorder({
		log: overrides.log ?? log,
		sessionId: "sesion-1",
		codePreviewChars: overrides.codePreviewChars ?? 10,
		now: () => new Date("2026-03-04T05:06:07.000Z"),
		elapsedMs: () => (ticks += 25),
		newCallId: () => `call-${++calls}`,
		warn: (m) => warnings.push(m),
	});
	return { log, recorder, warnings };
}

const only = <T extends ActivityEvent["type"]>(
	events: readonly ActivityEvent[],
	type: T,
) =>
	events.filter(
		(e): e is Extract<ActivityEvent, { type: T }> => e.type === type,
	);

describe("createActivityRecorder", () => {
	it("session_started lleva la cabecera común, el pid y el archivo de Figma", () => {
		const { log, recorder } = setup();
		recorder.sessionStarted({ pid: 42, fileUrl: "https://figma.com/design/x" });
		assert.deepEqual(log.events, [
			{
				v: ACTIVITY_VERSION,
				at: "2026-03-04T05:06:07.000Z",
				sessionId: "sesion-1",
				type: ACTIVITY_TYPE.sessionStarted,
				pid: 42,
				fileUrl: "https://figma.com/design/x",
			},
		]);
	});

	it("una llamada registra tool_called y tool_finished con el mismo callId y la duración (CA-1)", () => {
		const { log, recorder } = setup();
		const call = recorder.startCall("figma_status", {});
		call.finished({ ok: true, touchedNodeIds: [] });
		const [called] = only(log.events, ACTIVITY_TYPE.toolCalled);
		const [finished] = only(log.events, ACTIVITY_TYPE.toolFinished);
		assert.equal(called?.callId, "call-1");
		assert.equal(called?.tool, "figma_status");
		assert.equal(finished?.callId, called?.callId);
		assert.equal(finished?.ms, 25);
		assert.equal(finished?.ok, true);
	});

	it("los argumentos se resumen: del code solo queda la vista previa (CA-2)", () => {
		const { log, recorder } = setup({ codePreviewChars: 5 });
		recorder.startCall("figma_run_script", {
			code: "return 1 + 2 + 3",
			format: "body",
		});
		const [called] = only(log.events, ACTIVITY_TYPE.toolCalled);
		assert.deepEqual(called?.args, {
			codeLength: 16,
			codePreview: "retur",
			format: "body",
		});
		assert.ok(!JSON.stringify(log.events).includes("1 + 2 + 3"));
	});

	it("tool_finished solo lleva los opcionales que existen", () => {
		const { log, recorder } = setup();
		recorder.startCall("figma_run_script", {}).finished({
			ok: true,
			touchedNodeIds: ["1:1"],
			jobId: "job-9",
			resultPath: "/salida/r.json",
		});
		const [finished] = only(log.events, ACTIVITY_TYPE.toolFinished);
		assert.equal(finished?.jobId, "job-9");
		assert.equal(finished?.resultPath, "/salida/r.json");
		assert.ok(!("error" in (finished ?? {})));
		assert.ok(!("retryable" in (finished ?? {})));
	});

	it("un error lleva tipo, mensaje, siguiente paso y línea", () => {
		const { log, recorder } = setup();
		const error = scriptError("SyntaxError: x (línea 4)", 4, true);
		recorder.startCall("figma_run_script", {}).finished({
			ok: false,
			retryable: error.retryable,
			touchedNodeIds: [],
			error: {
				type: error.type,
				message: error.message,
				nextStep: error.nextStep,
				line: 4,
			},
		});
		const [finished] = only(log.events, ACTIVITY_TYPE.toolFinished);
		assert.deepEqual(finished?.error, {
			type: "ScriptError",
			message: "SyntaxError: x (línea 4)",
			nextStep: error.nextStep,
			line: 4,
		});
		assert.equal(finished?.retryable, false);
	});

	it("una captura guardada registra nodo, ruta y dimensiones con el callId de la llamada", () => {
		const { log, recorder } = setup();
		const call = recorder.startCall("figma_screenshot", { nodeId: "1:2" });
		call.screenshotSaved({
			nodeId: "1:2",
			path: "/salida/s.png",
			width: 40,
			height: 20,
		});
		const [shot] = only(log.events, ACTIVITY_TYPE.screenshotSaved);
		assert.deepEqual(
			[shot?.callId, shot?.nodeId, shot?.path, shot?.width, shot?.height],
			["call-1", "1:2", "/salida/s.png", 40, 20],
		);
	});

	it("figma_status registra el estado de la conexión", () => {
		const { log, recorder } = setup();
		recorder.startCall("figma_status", {}).statusChecked(READY_STATUS);
		const [status] = only(log.events, ACTIVITY_TYPE.statusChecked);
		assert.deepEqual(
			[
				status?.chromeReachable,
				status?.figmaReady,
				status?.fileName,
				status?.pageName,
			],
			[true, true, "Archivo", "Página"],
		);
	});

	it("un job terminado bien registra job_finished con duración y nodos (CA-3)", () => {
		const { log, recorder } = setup();
		recorder.jobFinished({
			jobId: toJobId("job-1"),
			outcome: succeeded(null, ["2:2"]),
			ms: 4200,
		});
		const [job] = only(log.events, ACTIVITY_TYPE.jobFinished);
		assert.deepEqual(
			[job?.jobId, job?.ok, job?.ms, job?.touchedNodeIds],
			["job-1", true, 4200, ["2:2"]],
		);
		assert.ok(!("error" in (job ?? {})));
	});

	it("un job fallido registra el error de Figma con su siguiente paso", () => {
		const { log, recorder } = setup();
		recorder.jobFinished({
			jobId: toJobId("job-2"),
			outcome: failed(callTimeout(5000)),
			ms: 5000,
		});
		const [job] = only(log.events, ACTIVITY_TYPE.jobFinished);
		assert.equal(job?.ok, false);
		assert.equal(job?.error?.type, "Timeout");
		assert.equal(job?.error?.line, null);
		assert.match(job?.error?.nextStep ?? "", /figma_get_job/);
	});

	const stepRow = (over: Partial<BuildStep> = {}): BuildStep => ({
		index: 0,
		file: "a.js",
		status: STEP_STATUS.done,
		ms: 12,
		touchedCount: 2,
		error: null,
		warning: null,
		result: null,
		...over,
	});

	it("los pasos que cambian de estado registran un evento cada uno, también pending y running", () => {
		const { log, recorder } = setup();
		const steps: BuildStep[] = [
			stepRow(),
			stepRow({
				index: 1,
				file: "b.js",
				status: STEP_STATUS.running,
				ms: null,
				touchedCount: 0,
			}),
			stepRow({
				index: 2,
				file: "c.js",
				status: STEP_STATUS.pending,
				ms: null,
				touchedCount: 0,
			}),
		];
		recorder.buildStepsChanged({
			jobId: toJobId("job-1"),
			steps,
			changed: [1, 2],
		});
		const evs = only(log.events, ACTIVITY_TYPE.buildStepFinished);
		assert.deepEqual(
			evs.map((e) => [e.index, e.file, e.status]),
			[
				[1, "b.js", "running"],
				[2, "c.js", "pending"],
			],
		);
	});

	it("un paso terminado registra su duración y sus nodos", () => {
		const { log, recorder } = setup();
		recorder.buildStepsChanged({
			jobId: toJobId("job-1"),
			steps: [stepRow()],
			changed: [0],
		});
		const [ev] = only(log.events, ACTIVITY_TYPE.buildStepFinished);
		assert.deepEqual(
			[ev?.jobId, ev?.index, ev?.file, ev?.status, ev?.ms, ev?.touchedCount],
			["job-1", 0, "a.js", "done", 12, 2],
		);
	});

	it("un paso con resultado lo registra en el evento; uno sin resultado no lleva la clave", () => {
		const { log, recorder } = setup();
		recorder.buildStepsChanged({
			jobId: toJobId("job-1"),
			steps: [
				stepRow({ result: { kind: "inline", json: '{"log":["a"]}' } }),
				stepRow({
					index: 1,
					result: { kind: "file", path: "/salida/r.json", bytes: 90_000 },
				}),
				stepRow({ index: 2 }),
			],
			changed: [0, 1, 2],
		});
		const evs = only(log.events, ACTIVITY_TYPE.buildStepFinished);
		assert.deepEqual(evs[0]?.result, { kind: "inline", json: '{"log":["a"]}' });
		assert.deepEqual(evs[1]?.result, {
			kind: "file",
			path: "/salida/r.json",
			bytes: 90_000,
		});
		assert.equal(evs[2] !== undefined && "result" in evs[2], false);
	});

	it("un paso fallido registra su error de Figma; uno con aviso, el aviso", () => {
		const { log, recorder } = setup();
		recorder.buildStepsChanged({
			jobId: toJobId("job-1"),
			steps: [
				stepRow({
					status: STEP_STATUS.failed,
					touchedCount: 0,
					error: scriptError("boom", 3, false),
				}),
			],
			changed: [0],
		});
		recorder.buildStepsChanged({
			jobId: toJobId("job-1"),
			steps: [stepRow({ warning: "sin ids declarados" })],
			changed: [0],
		});
		const evs = only(log.events, ACTIVITY_TYPE.buildStepFinished);
		assert.equal(evs[0]?.status, "failed");
		assert.equal(evs[0]?.error?.type, "ScriptError");
		assert.equal(evs[0]?.error?.line, 3);
		assert.equal(evs[1]?.warning, "sin ids declarados");
	});

	it("un lote terminado registra job_finished con su estado (cancelled es ok)", () => {
		const { log, recorder } = setup();
		recorder.buildFinished({
			jobId: toJobId("job-1"),
			outcome: {
				ok: true,
				status: BUILD_STATUS.cancelled,
				error: null,
				touchedNodeIds: ["1:1"],
			},
			ms: 4200,
		});
		const [job] = only(log.events, ACTIVITY_TYPE.jobFinished);
		assert.deepEqual(
			[job?.jobId, job?.ok, job?.status, job?.ms, job?.touchedNodeIds],
			["job-1", true, "cancelled", 4200, ["1:1"]],
		);
	});

	it("si el registro lanza, avisa y no rompe a quien llama (CA-9)", () => {
		const exploding: ActivityLog = {
			record() {
				throw new Error("disco lleno");
			},
		};
		const { recorder, warnings } = setup({ log: exploding });
		assert.doesNotThrow(() => {
			recorder.sessionStarted({ pid: 1, fileUrl: "u" });
			const call = recorder.startCall("figma_status", {});
			call.finished({ ok: true, touchedNodeIds: [] });
		});
		assert.equal(warnings.length, 3);
		assert.match(warnings[0] ?? "", /disco lleno/);
	});
});
