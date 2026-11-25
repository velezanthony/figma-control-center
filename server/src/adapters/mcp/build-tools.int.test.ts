import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import { makeAreaPlan } from "#application/area-plan.ts";
import { makeCancelJob } from "#application/cancel-job.ts";
import { makeReplyChat } from "#application/chat-messages.ts";
import { makeGetJob } from "#application/get-job.ts";
import { makeGetMetadata } from "#application/get-metadata.ts";
import { makeGetStatus } from "#application/get-status.ts";
import { createHistory } from "#application/history.ts";
import { createJobRegistry } from "#application/job-registry.ts";
import type { LoadedProject } from "#application/ports/project-config.ts";
import { createActivityRecorder } from "#application/record-activity.ts";
import { makeRunBuild } from "#application/run-build.ts";
import { makeRunScript } from "#application/run-script.ts";
import { makeTakeScreenshot } from "#application/take-screenshot.ts";
import { InMemoryActivityLog } from "#application/testing/in-memory-activity-log.ts";
import { InMemoryChatStore } from "#application/testing/in-memory-chat.ts";
import {
	deferred,
	InMemoryFigmaGateway,
} from "#application/testing/in-memory-figma-gateway.ts";
import { InMemoryHistoryQuery } from "#application/testing/in-memory-history-query.ts";
import {
	InMemoryAssetRepository,
	InMemoryBuildManifest,
	InMemoryResultStore,
	InMemoryScriptRepository,
} from "#application/testing/in-memory-ports.ts";
import {
	InMemoryProjectConfig,
	inMemoryCapture,
	projectWith,
} from "#application/testing/in-memory-web-capture.ts";
import { inMemoryReads } from "#application/testing/read-setup.ts";
import { unusedHistoryDiff } from "#application/testing/unused-history-diff.ts";
import { unusedHistoryScript } from "#application/testing/unused-history-script.ts";
import { unusedSheetsPlan } from "#application/testing/unused-sheets-plan.ts";
import { ACTIVITY_TYPE } from "#domain/activity.ts";
import { AREAS_CONTRACT, type Area, type AreasFile } from "#domain/areas.ts";
import { manifestError } from "#domain/figma-error.ts";
import { toJobId } from "#domain/job.ts";
import { ok } from "#domain/result.ts";
import { SCRIPT_FORMAT } from "#domain/script-format.ts";
import { kitStepCode } from "#domain/step.ts";
import { createBuildProgressBus } from "./build-progress.ts";
import { TOOL_NAME } from "./schemas.ts";
import { createMcpServer } from "./server.ts";

type Opts = {
	// El proyecto del que salen las áreas (por defecto, sin `areas`)
	project?: LoadedProject;
	softDeadlineMs?: number;
	progressMinIntervalMs?: number;
	maxInlineResultBytes?: number;
};

async function makeServer(opts: Opts = {}) {
	const soft = opts.softDeadlineMs ?? 1000;
	const gateway = new InMemoryFigmaGateway();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const store = new InMemoryResultStore();
	const buildManifest = new InMemoryBuildManifest();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const activity = new InMemoryActivityLog();
	let ticks = 0;
	let calls = 0;
	const recorder = createActivityRecorder({
		log: activity,
		sessionId: "sesion-test",
		codePreviewChars: 8,
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		elapsedMs: () => (ticks += 10),
		newCallId: () => `call-${++calls}`,
		warn: () => {},
	});
	const bus = createBuildProgressBus();
	const project = new InMemoryProjectConfig(opts.project ?? projectWith([]));
	const runBuild = makeRunBuild({
		project,
		checkStep: stepResultIssues,
		gateway,
		scripts,
		assets,
		store,
		maxInlineResultBytes: 100_000,
		jobs,
		stepTimeoutMs: 30_000,
		maxParamsBytes: 10_000,
		maxSteps: 50,
		onStepsChanged: recorder.buildStepsChanged,
		onProgress: (ev) => bus.publish(ev),
		onJobFinished: recorder.buildFinished,
	});
	const server = createMcpServer(
		{
			runScript: makeRunScript({
				checkStep: stepResultIssues,
				gateway,
				scripts,
				assets,
				store,
				jobs,
				softDeadlineMs: soft,
				maxInlineResultBytes: 200,
				maxParamsBytes: 1000,
			}),
			getJob: makeGetJob(jobs, { softDeadlineMs: soft }),
			getStatus: makeGetStatus(gateway, jobs),
			takeScreenshot: makeTakeScreenshot({
				gateway,
				store,
				now: () => new Date(),
			}),
			getMetadata: makeGetMetadata(gateway),
			runBuild,
			cancelJob: makeCancelJob({ jobs }),
			buildManifest,
			reads: inMemoryReads({ jobs, store }),
			capture: inMemoryCapture({ jobs }).run,
			historyScript: unusedHistoryScript,
			historyDiff: unusedHistoryDiff,
			areaPlan: makeAreaPlan({ project }),
			sheetsPlan: unusedSheetsPlan,
		},
		recorder,
		createHistory({
			query: new InMemoryHistoryQuery(),
			now: () => new Date(),
			maxRows: 50,
		}),
		makeReplyChat({
			outbox: new InMemoryChatStore(),
			credentials: { sessionId: "sesion-test", token: "t" },
		}),
		{ record: () => null, warn: () => {} },
		{
			bus,
			progressMinIntervalMs: opts.progressMinIntervalMs ?? 0,
			touched: {
				store,
				maxInlineBytes: opts.maxInlineResultBytes ?? 100_000,
			},
		},
	);
	const client = new Client({ name: "test", version: "0.0.0" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
	return {
		client,
		project,
		gateway,
		scripts,
		assets,
		jobs,
		buildManifest,
		activity,
		store,
	};
}

const step = (file: string) => ({ file, format: SCRIPT_FORMAT.function });

type McpClient = Awaited<ReturnType<typeof makeServer>>["client"];

// figma_build responde ya con el jobId; el final del lote se espera con figma_get_job y waitMs
const waitEnd = async (client: McpClient, jobId: unknown) => {
	let out: Record<string, unknown> = {};
	for (let i = 0; i < 20; i++) {
		const r = await client.callTool({
			name: TOOL_NAME.getJob,
			arguments: { jobId, waitMs: 1000 },
		});
		out = r.structuredContent as Record<string, unknown>;
		if (out["status"] !== "running") break;
	}
	return out;
};
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("figma_build", () => {
	it("responde al aceptar el lote con status=running, el jobId y el plan entero (CA-2)", async () => {
		const { client, gateway, scripts, activity } = await makeServer();
		scripts.files.set("a.js", "A");
		scripts.files.set("b.js", "B");
		gateway.runReply = async (s) =>
			s.code === "A"
				? ok({ createdNodeIds: ["1:1"] })
				: ok({ mutatedNodeIds: ["1:2"] });
		const mark = activity.events.length;

		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js")] },
		});
		const out = r.structuredContent as Record<string, unknown>;

		assert.notEqual(r.isError, true);
		assert.deepEqual(
			Object.keys(out).sort(),
			[
				"error",
				"jobId",
				"ok",
				"progress",
				"result",
				"retryable",
				"status",
				"steps",
				"touchedNodeIds",
				"touchedPath",
			].sort(),
		);
		assert.equal(out["ok"], true);
		assert.equal(out["status"], "running");
		assert.equal(out["result"], null);
		assert.ok(String(out["jobId"]).length > 0);
		assert.deepEqual(out["progress"], {
			done: 0,
			total: 2,
			cancelled: 0,
			skipped: 0,
			current: null,
		});
		const steps = out["steps"] as { file: string; status: string }[];
		assert.deepEqual(
			steps.map((st) => `${st.file}:${st.status}`),
			["a.js:pending", "b.js:pending"],
		);
		assert.deepEqual(Object.keys(steps[0] ?? {}).sort(), [
			"error",
			"file",
			"index",
			"ms",
			"status",
			"touchedCount",
			"warning",
		]);
		// El texto repite el structuredContent (la especificación de MCP lo pide)
		assert.equal(
			(r.content as { text: string }[])[0]?.text,
			JSON.stringify(out),
		);

		// Con waitMs el final llega en cuanto el lote acaba, con el mismo contrato
		const final = await waitEnd(client, out["jobId"]);
		assert.equal(final["kind"], "build");
		assert.equal(final["status"], "done");
		assert.deepEqual(final["touchedNodeIds"], ["1:1", "1:2"]);
		assert.deepEqual(final["progress"], {
			done: 2,
			total: 2,
			cancelled: 0,
			skipped: 0,
			current: null,
		});

		// track: la llamada, cada paso y el cierre del lote (job_finished con su estado terminal) quedan registrados
		const events = activity.events.slice(mark);
		const stepEvents = events.filter(
			(e) => e.type === ACTIVITY_TYPE.buildStepFinished,
		);
		assert.deepEqual(
			stepEvents.map((e) => `${e.file}:${e.status}`),
			[
				"a.js:pending",
				"b.js:pending",
				"a.js:running",
				"a.js:done",
				"b.js:running",
				"b.js:done",
			],
		);
		const finished = events.filter((e) => e.type === ACTIVITY_TYPE.jobFinished);
		assert.equal(finished.length, 1);
		assert.equal(finished[0]?.status, "done");
	});

	it("lee el manifiesto y le pasa los params de la llamada (modo manifest)", async () => {
		const { client, gateway, scripts, buildManifest } = await makeServer();
		scripts.files.set("a.js", "A");
		buildManifest.plans.set("lote.json", {
			name: "app",
			steps: [{ file: "a.js", format: SCRIPT_FORMAT.function }],
		});
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });

		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { manifest: "lote.json", params: { page: "C" } },
		});
		assert.equal((r.structuredContent as { ok: boolean }).ok, true);
		assert.deepEqual(buildManifest.readCalls, [
			{ path: "lote.json", callParams: { page: "C" } },
		]);
		await waitEnd(client, (r.structuredContent as { jobId: string }).jobId);
	});

	it("exige exactamente uno de manifest, steps, areas o sheets", async () => {
		const { client } = await makeServer();
		const none = await client.callTool({
			name: TOOL_NAME.build,
			arguments: {},
		});
		assert.equal(none.isError, true);
		assert.match(
			(none.content as { text: string }[])[0]?.text ?? "",
			/exactamente uno de `manifest`, `steps`, `areas` o `sheets`/,
		);
		const both = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { manifest: "m.json", steps: [step("a.js")] },
		});
		assert.equal(both.isError, true);
		const withAreas = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: ["Uno"], steps: [step("a.js")] },
		});
		assert.equal(withAreas.isError, true);
		const empty = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: [] },
		});
		assert.equal(empty.isError, true);
		const withSheets = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { sheets: ["button"], areas: ["Uno"] },
		});
		assert.equal(withSheets.isError, true);
		assert.match(
			(withSheets.content as { text: string }[])[0]?.text ?? "",
			/exactamente uno de/,
		);
		const emptySheets = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { sheets: [] },
		});
		assert.equal(emptySheets.isError, true);
	});

	it("un manifiesto ilegible rechaza el lote con ok:false sin tocar Figma (CA-6)", async () => {
		const { client, gateway, buildManifest } = await makeServer();
		// El doble devuelve error para una ruta no programada
		void buildManifest;
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { manifest: "no-existe.json" },
		});
		const out = r.structuredContent as Record<string, unknown>;
		assert.equal(r.isError, true);
		assert.equal(out["ok"], false);
		assert.equal(out["status"], "failed");
		assert.equal(
			(out["error"] as { type: string }).type,
			manifestError("x", "y").type,
		);
		assert.equal(
			out["retryable"],
			(out["error"] as { retryable: boolean }).retryable,
		);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("una 2.ª figma_build rechazada no deja sin notificaciones al lote que espera la 1.ª (CA-6)", async () => {
		const { client, gateway, scripts } = await makeServer({
			softDeadlineMs: 10_000,
		});
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		const defs = [
			deferred<ReturnType<typeof ok<unknown>>>(),
			deferred<ReturnType<typeof ok<unknown>>>(),
		];
		let i = 0;
		gateway.runReply = () => defs[i++]?.promise ?? Promise.resolve(ok({}));
		const first = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js")] },
		});
		const jobId = (first.structuredContent as { jobId: string }).jobId;
		const seen: number[] = [];
		const waitP = client.callTool(
			{ name: TOOL_NAME.getJob, arguments: { jobId, waitMs: 10_000 } },
			undefined,
			{ onprogress: (p) => seen.push(p.progress) },
		);
		await settle();

		const second = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js")] },
		});
		assert.equal(second.isError, true);

		defs[0]?.resolve(ok({ createdNodeIds: ["1:1"] }));
		await settle();
		defs[1]?.resolve(ok({ createdNodeIds: ["1:2"] }));
		await waitP;
		await settle();
		assert.deepEqual(seen, [1, 2]);
	});

	it("figma_get_job con waitMs y progressToken: notificaciones crecientes separadas por el intervalo (CA-2)", async () => {
		const { client, gateway, scripts } = await makeServer({
			softDeadlineMs: 10_000,
			progressMinIntervalMs: 100,
		});
		mock.timers.enable({ apis: ["Date"], now: 0 });
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		const defs = [
			deferred<ReturnType<typeof ok<unknown>>>(),
			deferred<ReturnType<typeof ok<unknown>>>(),
			deferred<ReturnType<typeof ok<unknown>>>(),
		];
		let i = 0;
		gateway.runReply = () => defs[i++]?.promise ?? Promise.resolve(ok({}));
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js"), step("c.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;

		const progresses: { progress: number; total?: number }[] = [];
		const callP = client.callTool(
			{ name: TOOL_NAME.getJob, arguments: { jobId, waitMs: 10_000 } },
			undefined,
			{
				onprogress: (p) =>
					progresses.push({
						progress: p.progress,
						...(p.total !== undefined && { total: p.total }),
					}),
			},
		);

		await settle();
		defs[0]?.resolve(ok({ createdNodeIds: ["1:1"] }));
		await settle();
		mock.timers.setTime(100);
		defs[1]?.resolve(ok({ createdNodeIds: ["1:2"] }));
		await settle();
		mock.timers.setTime(200);
		defs[2]?.resolve(ok({ createdNodeIds: ["1:3"] }));
		const r = await callP;
		await settle();

		assert.equal((r.structuredContent as { status: string }).status, "done");
		assert.deepEqual(
			progresses.map((p) => p.progress),
			[1, 2, 3],
		);
		assert.equal(progresses.at(-1)?.total, 3);
	});

	it("si el cliente cancela figma_get_job durante waitMs, la espera se corta y la llamada termina sin esperar al lote", async () => {
		const { client, gateway, scripts, activity } = await makeServer({
			softDeadlineMs: 10_000,
		});
		scripts.files.set("a.js", "A");
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		const mark = activity.events.length;
		const cancel = new AbortController();

		const waitP = client.callTool(
			{ name: TOOL_NAME.getJob, arguments: { jobId, waitMs: 10_000 } },
			undefined,
			{ signal: cancel.signal },
		);
		await settle();
		cancel.abort();
		await assert.rejects(waitP);
		await settle();

		const events = activity.events.slice(mark);
		const called = events.find(
			(e) => e.type === ACTIVITY_TYPE.toolCalled && e.tool === TOOL_NAME.getJob,
		);
		assert.ok(called !== undefined && "callId" in called);
		assert.ok(
			events.some(
				(e) =>
					e.type === ACTIVITY_TYPE.toolFinished && e.callId === called.callId,
			),
			"la llamada sigue esperando al lote tras la cancelación",
		);
		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
	});

	it("figma_build no notifica: el lote corre en segundo plano y solo el histórico recoge sus pasos (CA-2)", async () => {
		const { client, gateway, scripts, jobs, activity } = await makeServer();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let i = 0;
		gateway.runReply = () => {
			i += 1;
			return i === 1
				? slow.promise
				: Promise.resolve(ok({ createdNodeIds: ["1:2"] }));
		};
		const progresses: unknown[] = [];
		const started = await client.callTool(
			{
				name: TOOL_NAME.build,
				arguments: { steps: [step("a.js"), step("b.js")] },
			},
			undefined,
			{ onprogress: (p) => progresses.push(p) },
		);
		const out = started.structuredContent as { status: string; jobId: string };
		assert.equal(out.status, "running");
		const mark = activity.events.length;

		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await settle();
		assert.equal(jobs.get(toJobId(out.jobId))?.status, "done");
		assert.equal(progresses.length, 0);
		assert.ok(
			activity.events
				.slice(mark)
				.some((e) => e.type === ACTIVITY_TYPE.buildStepFinished),
		);
	});

	afterEach(() => mock.timers.reset());
});

describe("figma_build: expect", () => {
	const openedAs = (
		gateway: Awaited<ReturnType<typeof makeServer>>["gateway"],
		fileName: string,
	) => {
		gateway.statusReply = { ...gateway.statusReply, fileName };
	};

	it("con `steps` y `expect` que no coincide responde un error de uso, sin job y sin enviar nada", async () => {
		const { client, gateway, scripts, jobs } = await makeServer();
		scripts.files.set("a.js", "A");
		openedAs(gateway, "Archivo de trabajo");
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: {
				steps: [step("a.js")],
				expect: { fileName: "Copia" },
				fromStep: 0,
			},
		});
		assert.equal(r.isError, true);
		assert.match(JSON.stringify(r.content), /«Archivo de trabajo»/);
		assert.match(JSON.stringify(r.content), /«Copia»/);
		assert.equal(gateway.runCalls.length, 0);
		assert.equal(jobs.activeBuild(), undefined);
	});

	it("el `expect` del manifiesto se comprueba también con fromStep", async () => {
		const { client, gateway, scripts, buildManifest } = await makeServer();
		scripts.files.set("a.js", "A");
		buildManifest.plans.set("m.json", {
			name: "m",
			expect: { fileName: "Copia" },
			steps: [step("a.js"), step("a.js")],
		});
		openedAs(gateway, "Otro");
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { manifest: "m.json", fromStep: 1 },
		});
		assert.equal(r.isError, true);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("si vienen el del manifiesto y el de la llamada, manda el de la llamada", async () => {
		const { client, gateway, scripts, buildManifest } = await makeServer();
		scripts.files.set("a.js", "A");
		buildManifest.plans.set("m.json", {
			name: "m",
			expect: { fileName: "Del manifiesto" },
			steps: [step("a.js")],
		});
		openedAs(gateway, "De la llamada");
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { manifest: "m.json", expect: { fileName: "De la llamada" } },
		});
		assert.notEqual(r.isError, true);
	});

	it("un `expect` mal formado se rechaza entero", async () => {
		const { client, gateway, scripts } = await makeServer();
		scripts.files.set("a.js", "A");
		for (const expect of [{ fileName: "" }, { fileName: "X", otra: 1 }]) {
			const r = await client.callTool({
				name: TOOL_NAME.build,
				arguments: { steps: [step("a.js")], expect },
			});
			assert.equal(r.isError, true);
		}
		assert.equal(gateway.runCalls.length, 0);
	});
});

describe("figma_cancel_job", () => {
	it("cancela un lote a mitad y responde enseguida con el progreso real; el final llega con figma_get_job (CA-2, CA-3)", async () => {
		const { client, gateway, scripts } = await makeServer();
		for (const f of ["a.js", "b.js", "c.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		let i = 0;
		gateway.runReply = () => {
			i += 1;
			return i === 1 ? slow.promise : Promise.resolve(ok({}));
		};
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js"), step("c.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		assert.equal(
			(started.structuredContent as { status: string }).status,
			"running",
		);
		await settle();

		// El paso 1 sigue en curso: la respuesta no lo espera
		const r = await client.callTool({
			name: TOOL_NAME.cancelJob,
			arguments: { jobId },
		});
		const now = r.structuredContent as Record<string, unknown>;
		assert.notEqual(r.isError, true);
		assert.equal(now["cancelRequested"], true);
		assert.equal(now["status"], "running");
		assert.deepEqual(now["progress"], {
			done: 0,
			total: 3,
			cancelled: 0,
			skipped: 0,
			current: { index: 0, file: "a.js" },
		});
		assert.deepEqual(
			(now["steps"] as { status: string }[]).map((st) => st.status),
			["running", "pending", "pending"],
		);

		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		const out = await waitEnd(client, jobId);
		assert.equal(out["ok"], true); // cancelled cuenta como ok
		assert.equal(out["status"], "cancelled");
		assert.deepEqual(out["touchedNodeIds"], ["1:1"]);
		const steps = out["steps"] as { status: string }[];
		assert.equal(steps[0]?.status, "done");
		assert.equal(steps[1]?.status, "cancelled");
		assert.equal(steps[2]?.status, "cancelled");
		assert.equal(gateway.runCalls.length, 1);
	});

	it("sobre un job de figma_run_script es un error de uso y no lo cambia (CA-9)", async () => {
		const { client, gateway } = await makeServer({ softDeadlineMs: 5 });
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await client.callTool({
			name: TOOL_NAME.runScript,
			arguments: { code: "lento" },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;

		const r = await client.callTool({
			name: TOOL_NAME.cancelJob,
			arguments: { jobId },
		});
		assert.equal(r.isError, true);
		assert.match(
			(r.content as { text: string }[])[0]?.text ?? "",
			/no permite interrumpir/,
		);
		slow.resolve(ok({}));
		await settle();
	});
});

describe("figma_get_job con un lote", () => {
	it("añade kind=build, progress y steps al consultar un lote", async () => {
		const { client, gateway, scripts } = await makeServer();
		scripts.files.set("a.js", "A");
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;

		const r = await client.callTool({
			name: TOOL_NAME.getJob,
			arguments: { jobId },
		});
		const out = r.structuredContent as Record<string, unknown>;
		assert.equal(out["kind"], "build");
		assert.equal(out["status"], "running");
		assert.equal((out["progress"] as { total: number }).total, 1);
		assert.ok(Array.isArray(out["steps"]));

		slow.resolve(ok({ createdNodeIds: ["1:1"] }));
		await settle();
	});
});

describe("el aviso de cada paso llega a la respuesta (CA-2)", () => {
	const NO_IDS = /Terminó sin declarar nodos/;
	type StepOut = { file: string; status: string; warning?: string | null };
	const warnings = (out: Record<string, unknown>) =>
		(out["steps"] as StepOut[]).map((st) =>
			"warning" in st ? st.warning : "ausente",
		);

	const batch = async () => {
		const ctx = await makeServer();
		for (const f of ["a.js", "b.js", "c.js"]) ctx.scripts.files.set(f, f);
		ctx.scripts.files.set("b.js", "B");
		ctx.gateway.runReply = async (sc) =>
			sc.code === "B" ? ok({}) : ok({ createdNodeIds: ["1:1"] });
		return ctx;
	};

	it("figma_build trae `warning: null` en cada paso del plan que aún no corrió", async () => {
		const { client } = await batch();
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js"), step("c.js")] },
		});
		const out = started.structuredContent as Record<string, unknown>;
		assert.deepEqual(warnings(out), [null, null, null]);
	});

	it("figma_get_job pone el texto solo en el paso hecho sin ids declarados", async () => {
		const { client } = await batch();
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js"), step("c.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		const out = await waitEnd(client, jobId);
		const w = warnings(out);
		assert.equal(out["status"], "done");
		assert.equal(w[0], null);
		assert.match(String(w[1]), NO_IDS);
		assert.equal(w[2], null);
	});

	it("figma_cancel_job de un lote ya terminado devuelve los mismos avisos", async () => {
		const { client } = await batch();
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js"), step("c.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		await waitEnd(client, jobId);
		const r = await client.callTool({
			name: TOOL_NAME.cancelJob,
			arguments: { jobId },
		});
		const w = warnings(r.structuredContent as Record<string, unknown>);
		assert.deepEqual([w[0], w[2]], [null, null]);
		assert.match(String(w[1]), NO_IDS);
	});

	it("un lote cancelado deja `warning: null` en los pasos que no corrieron", async () => {
		const { client, gateway, scripts } = await makeServer();
		for (const f of ["a.js", "b.js"]) scripts.files.set(f, f);
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js"), step("b.js")] },
		});
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		await settle();
		await client.callTool({ name: TOOL_NAME.cancelJob, arguments: { jobId } });
		slow.resolve(ok({}));
		const out = await waitEnd(client, jobId);
		assert.equal(out["status"], "cancelled");
		const w = warnings(out);
		assert.match(String(w[0]), NO_IDS);
		assert.equal(w[1], null);
	});
});

describe("touchedPath: más ids de los que caben en línea (CA-5)", () => {
	const MAX_INLINE = 60;
	const IDS = Array.from({ length: 20 }, (_, i) => `1:${i + 1}`);
	const inlineBytes = (ids: unknown) =>
		new TextEncoder().encode(JSON.stringify(ids)).byteLength;

	const bigBuild = async () => {
		const server = await makeServer({ maxInlineResultBytes: MAX_INLINE });
		server.scripts.files.set("a.js", "A");
		server.gateway.runReply = async () => ok({ createdNodeIds: IDS });
		const r = await server.client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js")] },
		});
		const out = await waitEnd(
			server.client,
			(r.structuredContent as { jobId: string }).jobId,
		);
		return { ...server, out };
	};

	it("figma_get_job con waitMs recorta la lista en línea y guarda la completa en touchedPath", async () => {
		const { out, store } = await bigBuild();
		const inline = out["touchedNodeIds"] as string[];
		assert.ok(inline.length > 0 && inline.length < IDS.length);
		assert.deepEqual(inline, IDS.slice(0, inline.length));
		assert.ok(inlineBytes(inline) <= MAX_INLINE);
		assert.equal(out["touchedPath"], "/salida/result-1.json");
		assert.deepEqual(JSON.parse(store.json[0] ?? "null"), IDS);
	});

	it("con pocos ids no hay fichero: touchedPath es null", async () => {
		const { client, gateway, scripts, store } = await makeServer();
		scripts.files.set("a.js", "A");
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [step("a.js")] },
		});
		const out = await waitEnd(
			client,
			(r.structuredContent as { jobId: string }).jobId,
		);
		assert.equal(out["touchedPath"], null);
		assert.deepEqual(out["touchedNodeIds"], ["1:1"]);
		assert.equal(store.json.length, 0);
	});

	it("figma_get_job de un lote terminado devuelve el mismo recorte y su touchedPath", async () => {
		const { client, out } = await bigBuild();
		const r = await client.callTool({
			name: TOOL_NAME.getJob,
			arguments: { jobId: out["jobId"] },
		});
		const got = r.structuredContent as Record<string, unknown>;
		assert.ok((got["touchedNodeIds"] as string[]).length < IDS.length);
		assert.equal(typeof got["touchedPath"], "string");
	});

	it("figma_cancel_job de un lote ya terminado recorta igual", async () => {
		const { client, out, store } = await bigBuild();
		const r = await client.callTool({
			name: TOOL_NAME.cancelJob,
			arguments: { jobId: out["jobId"] },
		});
		const got = r.structuredContent as Record<string, unknown>;
		assert.ok((got["touchedNodeIds"] as string[]).length < IDS.length);
		assert.equal(typeof got["touchedPath"], "string");
		assert.deepEqual(JSON.parse(store.json[0] ?? "null"), IDS);
	});
});

// --- figma_build { areas } y pasos `use` ---

const AREA = (name: string, extra: Partial<Area> = {}): Area => ({
	name,
	page: name,
	frame: { width: 100, minHeight: 100 },
	place: {
		mode: "replace-content",
		source: { pagePrefix: "t ", take: "first-frame" },
	},
	screens: [{ frame: "a" }, { frame: "b" }],
	...extra,
});
const AREAS_FILE: AreasFile = {
	contract: AREAS_CONTRACT,
	linkRules: {
		clickable: { names: [], namePrefixes: [], components: [] },
		rows: { row: ["fila"], body: ["cuerpo"] },
		transition: { type: "DISSOLVE", easing: "EASE_OUT", duration: 0.2 },
	},
	areas: [
		AREA("Uno", { links: [{ from: "a", text: "Ir", to: "b" }] }),
		AREA("Dos"),
	],
};
const withAreas = () => ({
	project: projectWith([], {}, null, AREAS_FILE),
});
const okStep = () =>
	ok({ createdNodeIds: ["1:1"], mutatedNodeIds: [] as string[] });

describe("figma_build: pasos del kit y áreas", () => {
	it("`areas` arma place y links para el área y corre los pasos del kit con sus params", async () => {
		const { client, gateway } = await makeServer(withAreas());
		gateway.runReply = async () => okStep();
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: ["Uno"] },
		});
		const out = r.structuredContent as {
			ok: boolean;
			jobId: string;
			steps: { file: string }[];
		};
		assert.equal(out.ok, true);
		assert.deepEqual(
			out.steps.map((s) => s.file),
			["kit/place@1 · Uno", "kit/links@1 · Uno"],
		);
		await waitEnd(client, out.jobId);
		assert.equal(gateway.runCalls.length, 2);
		assert.equal(gateway.runCalls[0]?.script.code, kitStepCode("kit/place@1"));
		const sent = gateway.runCalls[0]?.script.params as
			| { area: { name: string } }
			| undefined;
		assert.equal(sent?.area.name, "Uno");
	});

	it("da el mismo plan que `steps` escrito a mano con los mismos pasos `use`", async () => {
		const a = await makeServer(withAreas());
		a.gateway.runReply = async () => okStep();
		const byAreas = (
			await a.client.callTool({
				name: TOOL_NAME.build,
				arguments: { areas: ["Uno"] },
			})
		).structuredContent as { steps: { file: string }[]; jobId: string };
		await waitEnd(a.client, byAreas.jobId);
		const b = await makeServer(withAreas());
		b.gateway.runReply = async () => okStep();
		const bySteps = (
			await b.client.callTool({
				name: TOOL_NAME.build,
				arguments: {
					steps: [
						{ use: "kit/place@1", area: "Uno" },
						{ use: "kit/links@1", area: "Uno" },
					],
				},
			})
		).structuredContent as { steps: { file: string }[]; jobId: string };
		await waitEnd(b.client, bySteps.jobId);
		assert.deepEqual(
			byAreas.steps.map((s) => s.file),
			bySteps.steps.map((s) => s.file),
		);
		assert.deepEqual(
			a.gateway.runCalls.map((c) => [c.script.code, c.script.params]),
			b.gateway.runCalls.map((c) => [c.script.code, c.script.params]),
		);
	});

	it("`areas` admite expect, stopOnError y fromStep como un lote cualquiera", async () => {
		const { client, gateway } = await makeServer(withAreas());
		gateway.statusReply = { ...gateway.statusReply, fileName: "Otro" };
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: ["Uno"], expect: { fileName: "Esperado" } },
		});
		assert.equal(r.isError, true);
		assert.match(
			(r.content as { text: string }[])[0]?.text ?? "",
			/espera «Esperado»/,
		);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un área desconocida es un error de uso sin job", async () => {
		const { client, gateway, jobs } = await makeServer(withAreas());
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: ["Nada"] },
		});
		assert.equal(r.isError, true);
		assert.match(
			(r.content as { text: string }[])[0]?.text ?? "",
			/«Nada».*Uno, Dos/,
		);
		assert.equal(jobs.activeBuild(), undefined);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un proyecto sin `areas` rechaza el lote con ProjectConfigError y el campo `areas`, sin job", async () => {
		const { client, gateway } = await makeServer();
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { areas: ["Uno"] },
		});
		const out = r.structuredContent as {
			ok: boolean;
			jobId: string | null;
			error: { type: string; field: string };
		};
		assert.equal(r.isError, true);
		assert.equal(out.ok, false);
		assert.equal(out.error.type, "ProjectConfigError");
		assert.equal(out.error.field, "areas");
		assert.equal(gateway.runCalls.length, 0);
	});

	it("un paso `use` en `steps` de un proyecto sin `areas` falla igual, sin job", async () => {
		const { client, gateway, jobs } = await makeServer();
		const r = await client.callTool({
			name: TOOL_NAME.build,
			arguments: { steps: [{ use: "kit/place@1", area: "Uno" }] },
		});
		const out = r.structuredContent as {
			jobId: string | null;
			error: { type: string };
		};
		assert.equal(r.isError, true);
		assert.equal(out.jobId, null);
		assert.equal(out.error.type, "ProjectConfigError");
		assert.equal(jobs.activeBuild(), undefined);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("`use` con `file` o `params` se rechaza en la entrada", async () => {
		const { client } = await makeServer(withAreas());
		for (const bad of [
			{ use: "kit/place@1", area: "Uno", file: "a.js" },
			{ use: "kit/place@1", area: "Uno", params: { x: 1 } },
			{ use: "kit/inventado@1", area: "Uno" },
		]) {
			const r = await client.callTool({
				name: TOOL_NAME.build,
				arguments: { steps: [bad] },
			});
			assert.equal(r.isError, true, JSON.stringify(bad));
		}
	});
});
