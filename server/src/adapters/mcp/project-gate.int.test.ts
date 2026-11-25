// Con varios proyectos en alcance y ninguno elegido, ninguna herramienta toca Figma ni el histórico: todas responden
// con el mismo error de uso (la lista de ids y cómo elegir).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { stepResultIssues } from "#adapters/contracts/step.ts";
import { CHAT_AGENT_READ_ONLY } from "#application/agent-scope.ts";
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
import { InMemoryFigmaGateway } from "#application/testing/in-memory-figma-gateway.ts";
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
import { toJobId } from "#domain/job.ts";
import { createBuildProgressBus } from "./build-progress.ts";
import { CHANNEL_INSTRUCTIONS } from "./channel.ts";
import { TOOL_NAME } from "./schemas.ts";
import { createMcpServer } from "./server.ts";

const MESSAGE =
	"Hay 2 proyectos en alcance (ejemplo, cliente) y ninguno elegido.";

async function setup(
	gate: (() => string | null | Promise<string | null>) | undefined,
	tabNotice?: () => string | null,
	chatAgent = false,
) {
	const gateway = new InMemoryFigmaGateway();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const store = new InMemoryResultStore();
	let n = 0;
	const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
	const activity = new InMemoryActivityLog();
	const recorder = createActivityRecorder({
		log: activity,
		sessionId: "s",
		codePreviewChars: 8,
		now: () => new Date("2026-01-01T00:00:00.000Z"),
		elapsedMs: () => 1,
		newCallId: () => `c-${++n}`,
		warn: () => {},
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
				softDeadlineMs: 20,
				maxInlineResultBytes: 200,
				maxParamsBytes: 1000,
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
			credentials: { sessionId: "s", token: "t" },
		}),
		{ record: () => null, warn: () => {} },
		{
			bus: createBuildProgressBus(),
			progressMinIntervalMs: 0,
			touched: { store, maxInlineBytes: 100_000 },
		},
		gate,
		tabNotice,
		chatAgent,
	);
	const client = new Client({ name: "test", version: "0.0.0" });
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
	return { client, gateway, activity };
}

const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
	[TOOL_NAME.status, {}],
	[TOOL_NAME.runScript, { code: "return 1" }],
	[TOOL_NAME.screenshot, { nodeId: "1:2" }],
	[TOOL_NAME.capture, { screens: ["inicio"] }],
	[TOOL_NAME.metadata, {}],
	[TOOL_NAME.build, { steps: [{ file: "a.js" }] }],
	[TOOL_NAME.getJob, { jobId: "job-1" }],
	[TOOL_NAME.cancelJob, { jobId: "job-1" }],
	[TOOL_NAME.historySummary, {}],
	[TOOL_NAME.historyErrors, {}],
	[TOOL_NAME.chatReply, { chat_id: "c", text: "hola" }],
];

describe("puerta de proyecto del servidor MCP", () => {
	it("sin elegir proyecto, cada herramienta responde el error de uso y no toca Figma ni el histórico", async () => {
		const { client, gateway, activity } = await setup(() => MESSAGE);
		for (const [name, args] of CALLS) {
			const r = await client.callTool({ name, arguments: args });
			assert.equal(r.isError, true, name);
			assert.equal((r.content as { text: string }[])[0]?.text, MESSAGE, name);
		}
		assert.equal(gateway.runCalls.length, 0);
		assert.deepEqual(activity.events, []);
	});

	it("con proyecto elegido (sin puerta) las herramientas funcionan como siempre", async () => {
		const { client } = await setup(undefined);
		const r = await client.callTool({
			name: TOOL_NAME.runScript,
			arguments: { code: "return 1" },
		});
		assert.equal((r.content as { text: string }[])[0]?.text === MESSAGE, false);
	});

	it("la puerta puede ser asíncrona (resuelve el proyecto al usarlo) y gobierna también el chat", async () => {
		let message: string | null = MESSAGE;
		const { client, gateway } = await setup(async () => {
			await Promise.resolve();
			return message;
		});
		for (const [name, args] of CALLS) {
			const r = await client.callTool({ name, arguments: args });
			assert.equal(r.isError, true, name);
			assert.equal((r.content as { text: string }[])[0]?.text, MESSAGE, name);
		}
		message = null;
		await client.callTool({
			name: TOOL_NAME.runScript,
			arguments: { code: "return 1" },
		});
		assert.equal(gateway.runCalls.length, 1);
	});

	it("la puerta se evalúa en cada llamada", async () => {
		let message: string | null = MESSAGE;
		const { client } = await setup(() => message);
		const first = await client.callTool({
			name: TOOL_NAME.status,
			arguments: {},
		});
		assert.equal(first.isError, true);
		message = null;
		const second = await client.callTool({
			name: TOOL_NAME.status,
			arguments: {},
		});
		assert.notEqual((second.content as { text: string }[])[0]?.text, MESSAGE);
	});
});

describe("aviso de la pestaña abierta por el servidor", () => {
	const NOTICE =
		"El servidor abrió la pestaña del archivo X porque no estaba abierta.";

	it("la respuesta de la herramienta que la provocó lo dice, una sola vez", async () => {
		let pending: string | null = NOTICE;
		const { client } = await setup(undefined, () => {
			const now = pending;
			pending = null;
			return now;
		});
		const first = await client.callTool({
			name: TOOL_NAME.status,
			arguments: {},
		});
		assert.equal(
			(first.structuredContent as Record<string, unknown>)["tabOpened"],
			NOTICE,
		);
		assert.match(
			(first.content as { text: string }[])[0]?.text ?? "",
			/abrió la pestaña/,
		);
		const second = await client.callTool({
			name: TOOL_NAME.status,
			arguments: {},
		});
		assert.equal(
			(second.structuredContent as Record<string, unknown>)["tabOpened"],
			undefined,
		);
	});

	it("las consultas de histórico no lo consumen ni lo llevan", async () => {
		let asked = 0;
		const { client } = await setup(undefined, () => {
			asked++;
			return NOTICE;
		});
		const r = await client.callTool({
			name: TOOL_NAME.historySummary,
			arguments: {},
		});
		assert.equal(
			(r.structuredContent as Record<string, unknown>)["tabOpened"],
			undefined,
		);
		assert.equal(asked, 0);
	});
});

describe("agente del chat del panel: el servidor solo deja consultar", () => {
	const WRITES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
		[TOOL_NAME.runScript, { code: "return 1" }],
		[TOOL_NAME.build, { steps: [{ file: "a.js" }] }],
		[TOOL_NAME.cancelJob, { jobId: "job-1" }],
		[TOOL_NAME.capture, { screens: ["inicio"] }],
	];

	it("con proyecto, las herramientas que cambian Figma o capturan la web responden que eso se hace desde Claude Code", async () => {
		const { client, gateway, activity } = await setup(
			undefined,
			undefined,
			true,
		);
		for (const [name, args] of WRITES) {
			const r = await client.callTool({ name, arguments: args });
			assert.equal(r.isError, true, name);
			assert.equal(
				(r.content as { text: string }[])[0]?.text,
				CHAT_AGENT_READ_ONLY,
				name,
			);
		}
		assert.equal(gateway.runCalls.length, 0);
		assert.deepEqual(activity.events, []);
	});

	it("las consultas siguen funcionando", async () => {
		const { client } = await setup(undefined, undefined, true);
		const r = await client.callTool({
			name: TOOL_NAME.historySummary,
			arguments: {},
		});
		assert.notEqual(r.isError, true);
	});

	it("sus instrucciones añaden que solo consulta y que los cambios se piden en Claude Code dentro del proyecto", async () => {
		const agent = await setup(undefined, undefined, true);
		const instructions = agent.client.getInstructions() ?? "";
		assert.ok(instructions.startsWith(CHANNEL_INSTRUCTIONS));
		assert.match(instructions, /solo consultas/);
		assert.match(instructions, /desde Claude Code dentro del proyecto/);
		const normal = await setup(undefined);
		assert.equal(normal.client.getInstructions(), CHANNEL_INSTRUCTIONS);
	});
});
