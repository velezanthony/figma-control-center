import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import { makeCancelJob } from "#application/cancel-job.ts";
import { makeReplyChat } from "#application/chat-messages.ts";
import { makeGetJob } from "#application/get-job.ts";
import { makeGetMetadata } from "#application/get-metadata.ts";
import { makeGetStatus } from "#application/get-status.ts";
import { createHistory } from "#application/history.ts";
import { createJobRegistry } from "#application/job-registry.ts";
import { createActivityRecorder } from "#application/record-activity.ts";
import { makeRunBuild } from "#application/run-build.ts";
import { makeRunScript } from "#application/run-script.ts";
import { makeTakeScreenshot } from "#application/take-screenshot.ts";
import { InMemoryActivityLog } from "#application/testing/in-memory-activity-log.ts";
import { InMemoryChatStore } from "#application/testing/in-memory-chat.ts";
import {
	deferred,
	InMemoryFigmaGateway,
	READY_STATUS,
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
import { unusedAreaPlan } from "#application/testing/unused-area-plan.ts";
import { unusedHistoryDiff } from "#application/testing/unused-history-diff.ts";
import { unusedHistoryScript } from "#application/testing/unused-history-script.ts";
import { unusedSheetsPlan } from "#application/testing/unused-sheets-plan.ts";
import { ACTIVITY_TYPE, type ActivityEvent } from "#domain/activity.ts";
import {
	chromeUnreachable,
	FIGMA_NOT_READY_REASON,
	figmaNotReady,
	scriptError,
} from "#domain/figma-error.ts";
import { toJobId } from "#domain/job.ts";
import { err, ok } from "#domain/result.ts";
import { createBuildProgressBus } from "./build-progress.ts";
import { TOOL_NAME } from "./schemas.ts";
import { createMcpServer } from "./server.ts";

const gateway = new InMemoryFigmaGateway();
const scripts = new InMemoryScriptRepository();
const assets = new InMemoryAssetRepository();
const store = new InMemoryResultStore();
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
const client = new Client({ name: "test", version: "0.0.0" });

before(async () => {
	const server = createMcpServer(
		{
			runScript: makeRunScript({
				checkStep: stepResultIssues,
				gateway,
				scripts,
				assets,
				store,
				jobs,
				softDeadlineMs: 20,
				maxInlineResultBytes: 200,
				maxParamsBytes: 1000,
				onJobFinished: recorder.jobFinished,
			}),
			getJob: makeGetJob(jobs, { softDeadlineMs: 20 }),
			getStatus: makeGetStatus(gateway, jobs),
			takeScreenshot: makeTakeScreenshot({
				gateway,
				store,
				now: () => new Date(),
			}),
			getMetadata: makeGetMetadata(gateway),
			runBuild: makeRunBuild({
				project: new InMemoryProjectConfig(projectWith([])),
				checkStep: stepResultIssues,
				gateway,
				scripts,
				assets,
				store,
				maxInlineResultBytes: 200,
				jobs,
				stepTimeoutMs: 30_000,
				maxParamsBytes: 1000,
				maxSteps: 50,
			}),
			cancelJob: makeCancelJob({ jobs }),
			buildManifest: new InMemoryBuildManifest(),
			reads: inMemoryReads({ jobs, store }),
			capture: inMemoryCapture({ jobs }).run,
			historyScript: unusedHistoryScript,
			historyDiff: unusedHistoryDiff,
			areaPlan: unusedAreaPlan,
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
			bus: createBuildProgressBus(),
			progressMinIntervalMs: 0,
			touched: { store, maxInlineBytes: 100_000 },
		},
	);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
});
after(() => client.close());

// Forma de structuredContent que consumen estos tests (cualquier herramienta)
type Out = {
	status: string;
	jobId: string;
	ok: boolean;
	error: { type: string; line?: number; reason?: string } | null;
	touchedNodeIds: string[];
	retryable: boolean;
	warning?: string;
	nextStep: string | null;
	previousScriptRunning: boolean;
	path: string;
	width: number;
	height: number;
	tree: { type: string };
};

const call = async (name: string, args: Record<string, unknown> = {}) => {
	const r = await client.callTool({ name, arguments: args });
	return {
		isError: r.isError === true,
		out: (r.structuredContent ?? {}) as Out,
		text: (r.content as { text: string }[])[0]?.text ?? "",
	};
};

describe("herramientas MCP", () => {
	it("lista las herramientas figma_* con descripción y anotaciones honestas", async () => {
		const { tools } = await client.listTools();
		assert.deepEqual(
			tools.map((t) => t.name).sort(),
			Object.values(TOOL_NAME).sort(),
		);
		const run = tools.find((t) => t.name === TOOL_NAME.runScript);
		assert.equal(run?.annotations?.readOnlyHint, false);
		assert.equal(run?.annotations?.idempotentHint, false);
		for (const name of [
			TOOL_NAME.status,
			TOOL_NAME.metadata,
			TOOL_NAME.screenshot,
			TOOL_NAME.getJob,
		]) {
			assert.equal(
				tools.find((t) => t.name === name)?.annotations?.readOnlyHint,
				true,
				name,
			);
		}
		for (const t of tools) assert.ok((t.description ?? "").length > 40, t.name);
		const props = run?.inputSchema.properties as Record<
			string,
			{ description?: string }
		>;
		for (const field of Object.keys(props))
			assert.ok(props[field]?.description, field);
	});

	it("figma_run_script con code devuelve el contrato y los ids tocados", async () => {
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"], n: 3 });
		const r = await call(TOOL_NAME.runScript, { code: "return 1" });
		assert.equal(r.isError, false);
		assert.equal(r.out.ok, true);
		assert.deepEqual(r.out.touchedNodeIds, ["1:1"]);
		assert.equal(r.out.status, "done");
		assert.equal(r.text, JSON.stringify(r.out));
	});

	it("figma_run_script ok sin ids declarados responde con warning; con ids, sin él (CA-12)", async () => {
		gateway.runReply = async () => ok({ movedCount: 3 });
		const sin = await call(TOOL_NAME.runScript, { code: "return 1" });
		assert.equal(sin.isError, false);
		assert.match(String(sin.out.warning), /sin declarar nodos/);
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		const con = await call(TOOL_NAME.runScript, { code: "return 1" });
		assert.equal(con.out.warning, undefined);
	});

	it("la descripción de figma_run_script trae un ejemplo del return con los ids", async () => {
		const { tools } = await client.listTools();
		const run = tools.find((t) => t.name === TOOL_NAME.runScript);
		assert.match(
			run?.description ?? "",
			/return \{ createdNodeIds: \[[^\]]*\], mutatedNodeIds: \[[^\]]*\] \}/,
		);
	});

	it("figma_run_script con file lee el script del repositorio", async () => {
		scripts.files.set("/s/a.js", "async () => 1");
		gateway.runReply = async () => ok(null);
		await call(TOOL_NAME.runScript, { file: "/s/a.js", format: "function" });
		assert.deepEqual(gateway.runCalls.at(-1)?.script, {
			code: "async () => 1",
			format: "function",
		});
	});

	it("figma_run_script pasa params y los bytes de los assets al gateway (CA-7)", async () => {
		assets.files.set("/s/mapa.png", Uint8Array.from([1, 2, 3]));
		gateway.runReply = async () => ok(null);
		await call(TOOL_NAME.runScript, {
			code: "return params",
			params: { page: "App" },
			assets: { mapa: "/s/mapa.png" },
		});
		assert.deepEqual(gateway.runCalls.at(-1)?.script, {
			code: "return params",
			format: "body",
			params: { page: "App" },
			assets: { mapa: Uint8Array.from([1, 2, 3]) },
		});
	});

	it("exige exactamente uno de file o code", async () => {
		assert.equal((await call(TOOL_NAME.runScript, {})).isError, true);
		const both = await call(TOOL_NAME.runScript, { file: "a", code: "b" });
		assert.equal(both.isError, true);
		assert.match(both.text, /exactamente uno/);
	});

	it("una ruta fuera de la raíz es ok:false/ScriptReadError con isError", async () => {
		const before = gateway.runCalls.length;
		const r = await call(TOOL_NAME.runScript, { file: "/no/existe.js" });
		assert.equal(r.isError, true);
		assert.equal(r.out.error?.type, "ScriptReadError");
		assert.equal(gateway.runCalls.length, before);
	});

	it("un error de sintaxis es ok:false, ScriptError con línea y retryable", async () => {
		gateway.runReply = async () =>
			err(scriptError("SyntaxError: x (línea 4)", 4, true));
		const r = await call(TOOL_NAME.runScript, { code: "x" });
		assert.equal(r.isError, true);
		assert.equal(r.out.ok, false);
		assert.equal(r.out.error?.line, 4);
		assert.equal(r.out.retryable, false);
	});

	it("un script lento devuelve running y figma_get_job entrega el resultado", async () => {
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await call(TOOL_NAME.runScript, { code: "lento" });
		assert.equal(started.out.status, "running");
		const { jobId } = started.out;
		assert.equal(
			(await call(TOOL_NAME.getJob, { jobId })).out?.status,
			"running",
		);
		slow.resolve(ok({ mutatedNodeIds: ["5:5"] }));
		await new Promise((resolve) => setImmediate(resolve));
		const done = await call(TOOL_NAME.getJob, { jobId });
		assert.equal(done.out.status, "done");
		assert.deepEqual(done.out.touchedNodeIds, ["5:5"]);
	});

	it("figma_get_job de un job desconocido es un error de uso", async () => {
		const r = await call(TOOL_NAME.getJob, { jobId: "nada" });
		assert.equal(r.isError, true);
		assert.match(r.text, /No existe el job/);
	});

	it("figma_status informa del siguiente paso con Chrome parado, sin isError", async () => {
		gateway.statusReply = {
			...READY_STATUS,
			chromeReachable: false,
			tabFound: false,
			figmaReady: false,
			fileName: null,
			pageName: null,
			error: chromeUnreachable("127.0.0.1:9222"),
		};
		const r = await call(TOOL_NAME.status);
		assert.equal(r.isError, false);
		assert.equal(r.out.error?.type, "ChromeUnreachable");
		assert.match(String(r.out.nextStep), /chrome\.sh/);
		gateway.statusReply = READY_STATUS;
		assert.equal((await call(TOOL_NAME.status)).out?.ok, true);
	});

	it("figma_status avisa de un script anterior aún en marcha y de qué hacer", async () => {
		const id = jobs.startBuild([]);
		const old = Promise.withResolvers<void>();
		jobs.holdBuildLock(id, old.promise);
		jobs.completeBuild(
			id,
			"cancelled",
			{
				ok: true,
				result: null,
				error: null,
				touchedNodeIds: [],
				retryable: false,
			},
			[],
		);
		const r = await call(TOOL_NAME.status);
		assert.equal(r.out.ok, true);
		assert.equal(r.out.previousScriptRunning, true);
		assert.match(String(r.out.nextStep), /script anterior.*recarga/);
		old.resolve();
		await new Promise((resolve) => setImmediate(resolve));
		assert.equal(
			(await call(TOOL_NAME.status)).out.previousScriptRunning,
			false,
		);
	});

	it("figma_status con permiso de solo lectura da la razón y el siguiente paso", async () => {
		gateway.statusReply = {
			...READY_STATUS,
			figmaReady: false,
			fileName: null,
			pageName: null,
			error: figmaNotReady(0, FIGMA_NOT_READY_REASON.viewOnly),
		};
		const r = await call(TOOL_NAME.status);
		gateway.statusReply = READY_STATUS;
		assert.equal(r.isError, false);
		assert.equal(r.out.error?.reason, FIGMA_NOT_READY_REASON.viewOnly);
		assert.equal(r.out.retryable, true);
		assert.match(String(r.out.nextStep), /permiso de edición/);
	});

	it("figma_screenshot guarda el PNG y devuelve ruta y dimensiones", async () => {
		gateway.screenshotReply = ok({
			png: Uint8Array.from([1, 2]),
			width: 10,
			height: 5,
		});
		const r = await call(TOOL_NAME.screenshot, { nodeId: "1:2" });
		assert.equal(r.isError, false);
		assert.deepEqual([r.out.width, r.out.height], [10, 5]);
		assert.match(r.out.path, /\.png$/);
		assert.equal(gateway.screenshotCalls.at(-1)?.scale, 1);
	});

	it("figma_metadata usa la página actual y la profundidad por defecto", async () => {
		const r = await call(TOOL_NAME.metadata);
		assert.equal(r.isError, false);
		assert.deepEqual(gateway.metadataCalls.at(-1), { nodeId: null, depth: 2 });
		assert.equal(r.out.tree.type, "PAGE");
	});
});

// Eventos que dejó una llamada: lo registrado desde la marca hasta ahora
const eventsFrom = (mark: number): ActivityEvent[] =>
	activity.events.slice(mark);
const typesOf = (events: readonly ActivityEvent[]) => events.map((e) => e.type);

describe("actividad registrada por las herramientas", () => {
	it("cada llamada deja tool_called y tool_finished con el mismo callId (CA-1)", async () => {
		const mark = activity.events.length;
		gateway.runReply = async () => ok({ createdNodeIds: ["1:1"] });
		await call(TOOL_NAME.runScript, { code: "return 1 + 2 + 3" });
		const [called, finished] = eventsFrom(mark);
		assert.equal(called?.type, ACTIVITY_TYPE.toolCalled);
		assert.equal(finished?.type, ACTIVITY_TYPE.toolFinished);
		assert.ok(
			called?.type === ACTIVITY_TYPE.toolCalled &&
				finished?.type === ACTIVITY_TYPE.toolFinished,
		);
		assert.equal(called.tool, TOOL_NAME.runScript);
		assert.equal(finished.callId, called.callId);
		assert.equal(finished.ok, true);
		assert.deepEqual(finished.touchedNodeIds, ["1:1"]);
		assert.ok(finished.ms > 0);
	});

	it("el code no se registra entero, solo longitud y vista previa (CA-2)", async () => {
		const mark = activity.events.length;
		await call(TOOL_NAME.runScript, { code: "return 'secreto largo'" });
		const called = eventsFrom(mark)[0];
		assert.ok(called?.type === ACTIVITY_TYPE.toolCalled);
		assert.equal(called.args["codeLength"], 22);
		assert.equal(called.args["codePreview"], "return '");
		assert.ok(!JSON.stringify(eventsFrom(mark)).includes("secreto"));
	});

	it("un script lento deja tool_finished con jobId y, al acabar, job_finished (CA-3)", async () => {
		const mark = activity.events.length;
		const slow = deferred<ReturnType<typeof ok<unknown>>>();
		gateway.runReply = () => slow.promise;
		const started = await call(TOOL_NAME.runScript, { code: "lento" });
		const finished = eventsFrom(mark).find(
			(e) => e.type === ACTIVITY_TYPE.toolFinished,
		);
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.jobId, started.out.jobId);
		assert.equal(
			eventsFrom(mark).some((e) => e.type === ACTIVITY_TYPE.jobFinished),
			false,
		);
		slow.resolve(ok({ mutatedNodeIds: ["5:5"] }));
		await new Promise((resolve) => setImmediate(resolve));
		const job = eventsFrom(mark).find(
			(e) => e.type === ACTIVITY_TYPE.jobFinished,
		);
		assert.ok(job?.type === ACTIVITY_TYPE.jobFinished);
		assert.equal(job.jobId, started.out.jobId);
		assert.deepEqual(job.touchedNodeIds, ["5:5"]);
	});

	it("un ScriptError se registra con línea y siguiente paso (CA-7)", async () => {
		const mark = activity.events.length;
		gateway.runReply = async () =>
			err(scriptError("SyntaxError: x (línea 4)", 4, true));
		await call(TOOL_NAME.runScript, { code: "x" });
		const finished = eventsFrom(mark)[1];
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.ok, false);
		assert.equal(finished.retryable, false);
		assert.equal(finished.error?.type, "ScriptError");
		assert.equal(finished.error?.line, 4);
		assert.match(finished.error?.nextStep ?? "", /sintaxis/);
	});

	it("una captura deja screenshot_saved y la ruta como resultado (CA-8)", async () => {
		const mark = activity.events.length;
		gateway.screenshotReply = ok({
			png: Uint8Array.from([1]),
			width: 10,
			height: 5,
		});
		const r = await call(TOOL_NAME.screenshot, { nodeId: "1:2" });
		assert.deepEqual(typesOf(eventsFrom(mark)), [
			ACTIVITY_TYPE.toolCalled,
			ACTIVITY_TYPE.screenshotSaved,
			ACTIVITY_TYPE.toolFinished,
		]);
		const shot = eventsFrom(mark)[1];
		assert.ok(shot?.type === ACTIVITY_TYPE.screenshotSaved);
		assert.deepEqual(
			[shot.nodeId, shot.path, shot.width, shot.height],
			["1:2", r.out.path, 10, 5],
		);
		const finished = eventsFrom(mark)[2];
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.resultPath, r.out.path);
	});

	it("una captura fallida no deja screenshot_saved", async () => {
		const mark = activity.events.length;
		gateway.screenshotReply = err(
			scriptError("Nodo no encontrado", null, false),
		);
		await call(TOOL_NAME.screenshot, { nodeId: "9:9" });
		assert.equal(
			typesOf(eventsFrom(mark)).includes(ACTIVITY_TYPE.screenshotSaved),
			false,
		);
	});

	it("figma_status deja status_checked y, con Chrome caído, un tool_finished con error", async () => {
		const mark = activity.events.length;
		gateway.statusReply = {
			...READY_STATUS,
			chromeReachable: false,
			tabFound: false,
			figmaReady: false,
			fileName: null,
			pageName: null,
			error: chromeUnreachable("127.0.0.1:9222"),
		};
		await call(TOOL_NAME.status);
		gateway.statusReply = READY_STATUS;
		const status = eventsFrom(mark).find(
			(e) => e.type === ACTIVITY_TYPE.statusChecked,
		);
		assert.ok(status?.type === ACTIVITY_TYPE.statusChecked);
		assert.equal(status.chromeReachable, false);
		const finished = eventsFrom(mark).at(-1);
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.ok, false);
		assert.equal(finished.error?.type, "ChromeUnreachable");
	});

	it("un error de uso se registra como UsageError", async () => {
		const mark = activity.events.length;
		await call(TOOL_NAME.runScript, {});
		const finished = eventsFrom(mark).at(-1);
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.ok, false);
		assert.equal(finished.error?.type, "UsageError");
		assert.match(finished.error?.message ?? "", /exactamente uno/);
	});

	it("una excepción del manejador se registra como UnexpectedError y la herramienta sigue fallando", async () => {
		const mark = activity.events.length;
		gateway.runReply = () => {
			throw new Error("boom");
		};
		const r = await call(TOOL_NAME.runScript, { code: "x" });
		assert.equal(r.isError, true);
		const finished = eventsFrom(mark).at(-1);
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.error?.type, "UnexpectedError");
		assert.match(finished.error?.message ?? "", /boom/);
	});
});
