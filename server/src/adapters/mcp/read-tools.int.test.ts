// Las cinco lecturas del catálogo y `resultFile` de figma_run_script por MCP en memoria

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import { makeCancelJob } from "#application/cancel-job.ts";
import { makeReplyChat } from "#application/chat-messages.ts";
import { makeExportNodes } from "#application/export-nodes.ts";
import { makeGetJob } from "#application/get-job.ts";
import { makeGetMetadata } from "#application/get-metadata.ts";
import { makeGetStatus } from "#application/get-status.ts";
import { createHistory } from "#application/history.ts";
import { createJobRegistry } from "#application/job-registry.ts";
import { makeLastScreenMatches } from "#application/last-screen-matches.ts";
import { makeReadComponents } from "#application/read-components.ts";
import { makeReadDesignContext } from "#application/read-design-context.ts";
import { makeReadInstances } from "#application/read-instances.ts";
import { makeReadStyles } from "#application/read-styles.ts";
import { makeReadVariables } from "#application/read-variables.ts";
import { createActivityRecorder } from "#application/record-activity.ts";
import { makeRunBuild } from "#application/run-build.ts";
import { makeRunRead } from "#application/run-read.ts";
import { makeRunScript } from "#application/run-script.ts";
import { makeTakeScreenshot } from "#application/take-screenshot.ts";
import { InMemoryActivityLog } from "#application/testing/in-memory-activity-log.ts";
import { InMemoryChatStore } from "#application/testing/in-memory-chat.ts";
import {
	deferred,
	InMemoryFigmaGateway,
} from "#application/testing/in-memory-figma-gateway.ts";
import { InMemoryFigmaReader } from "#application/testing/in-memory-figma-reader.ts";
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
import { unusedAreaPlan } from "#application/testing/unused-area-plan.ts";
import { unusedHistoryDiff } from "#application/testing/unused-history-diff.ts";
import { unusedHistoryScript } from "#application/testing/unused-history-script.ts";
import { unusedSheetsPlan } from "#application/testing/unused-sheets-plan.ts";
import { ACTIVITY_TYPE } from "#domain/activity.ts";
import type { VariablesRead } from "#domain/catalog.ts";
import type { DesignRead } from "#domain/design-context.ts";
import {
	designVariantError,
	type FigmaError,
	nodeNotFound,
} from "#domain/figma-error.ts";
import { toJobId } from "#domain/job.ts";
import { err, ok, type Result } from "#domain/result.ts";
import { createBuildProgressBus } from "./build-progress.ts";
import { TOOL_NAME } from "./schemas.ts";
import { createMcpServer } from "./server.ts";

const SOFT_DEADLINE_MS = 30;
const EXPORT_MAX_NODES = 2;
const READS = [
	TOOL_NAME.variables,
	TOOL_NAME.styles,
	TOOL_NAME.components,
	TOOL_NAME.instances,
	TOOL_NAME.export,
] as const;
const COMMON_OUTPUT = [
	"ok",
	"status",
	"jobId",
	"path",
	"summary",
	"error",
	"retryable",
	"touchedNodeIds",
	"tabOpened",
];

const VARIABLES: VariablesRead = {
	collections: [
		{
			id: "C:1",
			name: "Tokens",
			modes: [{ id: "1:0", name: "Claro" }],
			defaultModeId: "1:0",
			variables: [],
		},
	],
};

const gateway = new InMemoryFigmaGateway();
const reader = new InMemoryFigmaReader();
const store = new InMemoryResultStore();
let n = 0;
const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
const activity = new InMemoryActivityLog();
let calls = 0;
const recorder = createActivityRecorder({
	log: activity,
	sessionId: "sesion-test",
	codePreviewChars: 8,
	now: () => new Date("2026-11-11T00:00:00.000Z"),
	elapsedMs: () => 0,
	newCallId: () => `call-${++calls}`,
	warn: () => {},
});
const client = new Client({ name: "test", version: "0.0.0" });

before(async () => {
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const runRead = makeRunRead({
		reader,
		jobs,
		softDeadlineMs: SOFT_DEADLINE_MS,
		onJobFinished: recorder.jobFinished,
	});
	const readDeps = { runRead, reader, store, clock: () => new Date() };
	const server = createMcpServer(
		{
			runScript: makeRunScript({
				checkStep: stepResultIssues,
				gateway,
				scripts,
				assets,
				store,
				jobs,
				softDeadlineMs: SOFT_DEADLINE_MS,
				maxInlineResultBytes: 200,
				maxParamsBytes: 1000,
			}),
			getJob: makeGetJob(jobs, { softDeadlineMs: 1000 }),
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
			reads: {
				variables: makeReadVariables(readDeps),
				styles: makeReadStyles(readDeps),
				components: makeReadComponents(readDeps),
				instances: makeReadInstances(readDeps),
				export: makeExportNodes({ ...readDeps, maxNodes: EXPORT_MAX_NODES }),
				designContext: makeReadDesignContext({
					...readDeps,
					project: new InMemoryProjectConfig(projectWith([])),
					screenshot: makeTakeScreenshot({
						gateway,
						store,
						now: () => new Date(),
					}),
					paintMatches: makeLastScreenMatches({
						history: new InMemoryHistoryQuery(),
					}),
					fileKey: "KEY123",
					maxNodes: 400,
				}),
			},
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
beforeEach(() => {
	reader.variablesReply = async () => ok(VARIABLES);
});

type Out = Record<string, unknown> & {
	ok: boolean;
	status: string;
	jobId: string | null;
	path: string | null;
	summary: Record<string, unknown> | null;
	error: { type: string; message: string } | null;
	retryable: boolean;
	touchedNodeIds: string[];
	result?: unknown;
};

const call = async (name: string, args: Record<string, unknown> = {}) => {
	const r = await client.callTool({ name, arguments: args });
	return {
		isError: r.isError === true,
		out: (r.structuredContent ?? {}) as Out,
		text: (r.content as { text: string }[])[0]?.text ?? "",
	};
};

describe("lecturas del catálogo por MCP: registro (CA-9, CA-12)", () => {
	it("las cinco están anotadas como solo lectura de un mundo externo y traen la salida común con tabOpened", async () => {
		const { tools } = await client.listTools();
		for (const name of READS) {
			const tool = tools.find((t) => t.name === name);
			assert.ok(tool, name);
			assert.equal(tool.annotations?.readOnlyHint, true, name);
			assert.equal(tool.annotations?.openWorldHint, true, name);
			assert.deepEqual(
				Object.keys(tool.outputSchema?.properties ?? {}).sort(),
				[...COMMON_OUTPUT].sort(),
				name,
			);
			const props = tool.inputSchema.properties as Record<
				string,
				{ description?: string }
			>;
			for (const [field, schema] of Object.entries(props ?? {})) {
				assert.ok(schema.description, `${name}.${field}`);
			}
			assert.ok((tool.description ?? "").length > 40, name);
		}
	});

	it("figma_run_script admite resultFile, descrito", async () => {
		const { tools } = await client.listTools();
		const run = tools.find((t) => t.name === TOOL_NAME.runScript);
		const props = run?.inputSchema.properties as Record<
			string,
			{ description?: string }
		>;
		assert.match(props["resultFile"]?.description ?? "", /results\//);
	});
});

describe("lecturas del catálogo por MCP: salida y jobs (CA-8, CA-12)", () => {
	it("una lectura corta responde done con jobId, ruta y resumen, sin ids tocados; la fila del histórico lleva ruta y job", async () => {
		const mark = activity.events.length;
		const r = await call(TOOL_NAME.variables, { collection: "Tokens" });
		assert.equal(r.isError, false);
		assert.equal(r.out.ok, true);
		assert.equal(r.out.status, "done");
		assert.match(String(r.out.jobId), /^job-/);
		assert.match(String(r.out.path), /^\/salida\/reads\/variables-/);
		assert.deepEqual(r.out.summary, {
			collections: 1,
			variables: { Tokens: 0 },
			modes: { Tokens: 1 },
		});
		assert.deepEqual(r.out.touchedNodeIds, []);
		assert.equal(r.out.error, null);
		assert.equal(r.text, JSON.stringify(r.out));
		const finished = activity.events
			.slice(mark)
			.find((e) => e.type === ACTIVITY_TYPE.toolFinished);
		assert.ok(finished?.type === ACTIVITY_TYPE.toolFinished);
		assert.equal(finished.resultPath, r.out.path);
		assert.equal(finished.jobId, r.out.jobId);
		assert.ok(
			activity.events
				.slice(mark)
				.some(
					(e) =>
						e.type === ACTIVITY_TYPE.jobFinished && e.jobId === r.out.jobId,
				),
			"el job de la lectura se cierra con job_finished",
		);
	});

	it("figma_get_job de una lectura da su ruta y su resumen", async () => {
		const r = await call(TOOL_NAME.variables);
		const job = await call(TOOL_NAME.getJob, { jobId: r.out.jobId });
		assert.equal(job.out.status, "done");
		assert.deepEqual(job.out.result, {
			path: r.out.path,
			bytes: (job.out.result as { bytes: number }).bytes,
			summary: r.out.summary,
		});
	});

	it("una lectura que supera el plazo blando responde running y figma_get_job con waitMs da el resultado", async () => {
		const later = deferred<Result<VariablesRead, FigmaError>>();
		reader.variablesReply = () => later.promise;
		const r = await call(TOOL_NAME.variables);
		assert.equal(r.out.status, "running");
		assert.equal(r.out.path, null);
		const waiting = call(TOOL_NAME.getJob, { jobId: r.out.jobId, waitMs: 500 });
		later.resolve(ok(VARIABLES));
		const job = await waiting;
		assert.equal(job.out.status, "done");
		assert.match(
			String((job.out.result as { path: string }).path),
			/reads\/variables-/,
		);
	});

	it("un nodo que no existe responde ok:false con NodeNotFound, como resultado y no como excepción", async () => {
		reader.variablesReply = async () => err(nodeNotFound("99:9"));
		const r = await call(TOOL_NAME.variables, { nodeId: "99:9" });
		assert.equal(r.isError, true);
		assert.equal(r.out.ok, false);
		assert.equal(r.out.status, "failed");
		assert.equal(r.out.error?.type, "NodeNotFound");
		assert.match(r.out.error?.message ?? "", /99:9/);
		assert.equal(r.out.retryable, false);
		assert.deepEqual(r.out.touchedNodeIds, []);
	});

	it("figma_instances exige al menos una página", async () => {
		const r = await call(TOOL_NAME.instances, { pages: [] });
		assert.equal(r.isError, true);
	});
});

describe("figma_export por MCP (CA-6, CA-13)", () => {
	it("más nodos que el tope es un error de uso que nombra el ajuste y no toca Figma", async () => {
		const before = reader.exportCalls.length;
		const r = await call(TOOL_NAME.export, {
			nodeIds: ["1:1", "1:2", "1:3"],
			format: "PNG",
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /FIGMA_EXPORT_MAX_NODES/);
		assert.equal(reader.exportCalls.length, before);
	});

	it("exporta con la escala por defecto y no registra una captura (no va a Capturas)", async () => {
		const mark = activity.events.length;
		const r = await call(TOOL_NAME.export, {
			nodeIds: ["10:1"],
			format: "SVG",
		});
		assert.equal(r.out.ok, true);
		assert.deepEqual(reader.exportCalls.at(-1), {
			nodeIds: ["10:1"],
			format: "SVG",
			scale: 1,
		});
		assert.deepEqual(r.out.summary, { files: 1, bytes: 0 });
		assert.equal(
			activity.events
				.slice(mark)
				.some((e) => e.type === ACTIVITY_TYPE.screenshotSaved),
			false,
		);
	});
});

describe("figma_run_script con resultFile por MCP (CA-7)", () => {
	it("deja el resultado en results/<nombre> y responde { path, bytes }", async () => {
		gateway.runReply = async () => ok({ props: 1 });
		const r = await call(TOOL_NAME.runScript, {
			code: "return 1",
			resultFile: "figma_props.json",
		});
		assert.equal(r.out.ok, true);
		assert.deepEqual(r.out.result, {
			path: "/salida/results/figma_props.json",
			bytes: 11,
		});
	});

	it("un nombre con «/» o «..» es un error de uso sin tocar Figma", async () => {
		const before = gateway.runCalls.length;
		const r = await call(TOOL_NAME.runScript, {
			code: "return 1",
			resultFile: "../fuera.json",
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /resultFile/);
		assert.equal(gateway.runCalls.length, before);
	});
});

describe("lecturas con un lote en marcha (CA-14, decisión 12)", () => {
	it("las seis responden sin mirar el bloqueo de lote y figma_run_script sigue rechazado", async () => {
		const build = jobs.startBuild([]);
		try {
			for (const [name, args] of [
				[TOOL_NAME.variables, {}],
				[TOOL_NAME.styles, {}],
				[TOOL_NAME.components, {}],
				[TOOL_NAME.instances, { pages: ["P"] }],
				[TOOL_NAME.export, { nodeIds: ["10:1"], format: "PNG" }],
				[TOOL_NAME.designContext, { nodeId: "10:1" }],
			] as const) {
				const r = await call(name, args);
				assert.equal(r.out.ok, true, name);
			}
			const run = await call(TOOL_NAME.runScript, { code: "return 1" });
			assert.equal(run.isError, true);
			assert.match(run.text, /lote/);
		} finally {
			jobs.completeBuild(
				build,
				"done",
				{
					ok: true,
					result: null,
					error: null,
					touchedNodeIds: [],
					retryable: false,
				},
				[],
			);
		}
	});
});

describe("figma_design_context por MCP", () => {
	const READ_OK: DesignRead = {
		fileName: "Archivo",
		root: "10:1",
		nodes: [
			{
				id: "10:1",
				parent: null,
				name: "Portada",
				type: "FRAME",
				visible: true,
				box: { x: 0, y: 0, w: 10, h: 10 },
				fills: [{ raw: { type: "SOLID" } }],
			},
		],
		variables: {},
		styles: {},
		components: {},
	};
	beforeEach(() => {
		reader.designContextReply = async () => ok(READ_OK);
	});

	it("está anotada como solo lectura de un mundo externo y descrita, con la salida común más captura, avisos, sueltos y recorte", async () => {
		const { tools } = await client.listTools();
		const tool = tools.find((t) => t.name === TOOL_NAME.designContext);
		assert.ok(tool);
		assert.equal(tool.annotations?.readOnlyHint, true);
		assert.equal(tool.annotations?.openWorldHint, true);
		assert.deepEqual(
			Object.keys(tool.outputSchema?.properties ?? {}).sort(),
			[
				...COMMON_OUTPUT,
				"screenshotPath",
				"warnings",
				"unmapped",
				"truncated",
			].sort(),
		);
		const props = tool.inputSchema.properties as Record<
			string,
			{ description?: string }
		>;
		assert.deepEqual(Object.keys(props).sort(), [
			"maxNodes",
			"nodeId",
			"screenshot",
			"variant",
		]);
		for (const [field, schema] of Object.entries(props)) {
			assert.ok(schema.description, `figma_design_context.${field}`);
		}
		assert.ok((tool.description ?? "").length > 40);
		assert.deepEqual(tool.inputSchema.required, ["nodeId"]);
	});

	it("responde done con la ruta de reads/, la captura, el resumen y lo suelto, sin ids tocados", async () => {
		const r = await call(TOOL_NAME.designContext, { nodeId: "10:1" });
		assert.equal(r.isError, false);
		assert.equal(r.out.ok, true);
		assert.equal(r.out.status, "done");
		assert.match(String(r.out.path), /reads\/design-context_10:1-/);
		assert.deepEqual(r.out.summary, {
			nodes: 1,
			components: 0,
			variables: 0,
			styles: 0,
			noCodeMapping: 0,
			unmapped: 1,
		});
		assert.match(String(r.out["screenshotPath"]), /\.png$/);
		assert.deepEqual(r.out["unmapped"], [
			{ node: "10:1", name: "Portada", fields: ["fills"] },
		]);
		assert.deepEqual(r.out["warnings"], []);
		assert.equal(r.out["truncated"], null);
		assert.deepEqual(r.out.touchedNodeIds, []);
	});

	it("pasa `maxNodes` y `variant` al lector; `screenshot: false` no saca la captura", async () => {
		const shots = gateway.screenshotCalls.length;
		const calls = reader.designContextCalls.length;
		const r = await call(TOOL_NAME.designContext, {
			nodeId: "10:1",
			maxNodes: 12,
			screenshot: false,
			variant: { Tamaño: "M" },
		});
		assert.equal(r.out.ok, true);
		assert.deepEqual(reader.designContextCalls.slice(calls), [
			{ nodeId: "10:1", maxNodes: 12, variant: { Tamaño: "M" } },
		]);
		assert.equal(gateway.screenshotCalls.length, shots);
		assert.equal(r.out["screenshotPath"], null);
	});

	it("un nodo inexistente es ok:false con NodeNotFound y una variante inexistente, ContractError", async () => {
		reader.designContextReply = async () => err(nodeNotFound("9:9"));
		const missing = await call(TOOL_NAME.designContext, { nodeId: "9:9" });
		assert.equal(missing.isError, true);
		assert.equal(missing.out.error?.type, "NodeNotFound");
		assert.equal(missing.out["screenshotPath"], null);
		reader.designContextReply = async () =>
			err(designVariantError({ Tamaño: "XL" }, { Tamaño: ["S", "M"] }));
		const variant = await call(TOOL_NAME.designContext, {
			nodeId: "60:1",
			variant: { Tamaño: "XL" },
		});
		assert.equal(variant.out.error?.type, "ContractError");
		assert.equal(variant.out.retryable, false);
	});

	it("`maxNodes` tiene que ser un entero positivo y `nodeId` no puede estar vacío", async () => {
		for (const args of [
			{ nodeId: "10:1", maxNodes: 0 },
			{ nodeId: "10:1", maxNodes: 1.5 },
			{ nodeId: "" },
		]) {
			const r = await call(TOOL_NAME.designContext, args);
			assert.equal(r.isError, true, JSON.stringify(args));
		}
	});
});
