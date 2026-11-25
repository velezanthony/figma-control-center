// figma_capture por MCP en memoria: entrada `screens` + `allowPageWorld?`, salida común
// con `files`, `summary`, `errors` y `touchedNodeIds: []`; nunca el árbol. Sin Chrome: el capturador es un doble.

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
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
import { InMemoryFigmaGateway } from "#application/testing/in-memory-figma-gateway.ts";
import { InMemoryHistoryQuery } from "#application/testing/in-memory-history-query.ts";
import {
	InMemoryAssetRepository,
	InMemoryBuildManifest,
	InMemoryResultStore,
	InMemoryScriptRepository,
} from "#application/testing/in-memory-ports.ts";
import {
	capturedScreen,
	InMemoryProjectConfig,
	inMemoryCapture,
	projectWith,
	textNode,
} from "#application/testing/in-memory-web-capture.ts";
import { inMemoryReads } from "#application/testing/read-setup.ts";
import { unusedAreaPlan } from "#application/testing/unused-area-plan.ts";
import { unusedHistoryDiff } from "#application/testing/unused-history-diff.ts";
import { unusedHistoryScript } from "#application/testing/unused-history-script.ts";
import { unusedSheetsPlan } from "#application/testing/unused-sheets-plan.ts";
import { ACTIVITY_TYPE } from "#domain/activity.ts";
import { toJobId } from "#domain/job.ts";
import { createBuildProgressBus } from "./build-progress.ts";
import { TOOL_NAME } from "./schemas.ts";
import { createMcpServer } from "./server.ts";

const SCREENS = [
	{ key: "inicio", title: "Inicio", url: "/" },
	{
		key: "menu",
		title: "Menú",
		url: "/",
		variants: [{ props: {}, run: [{ evaluateInPage: "1" }] }],
	},
];

let n = 0;
const jobs = createJobRegistry(() => toJobId(`job-${++n}`));
const capture = inMemoryCapture({ jobs, screens: SCREENS, inlineErrors: 1 });
const activity = new InMemoryActivityLog();
const client = new Client({ name: "test", version: "0.0.0" });
const gateway = new InMemoryFigmaGateway();

before(async () => {
	const store = new InMemoryResultStore();
	const scripts = new InMemoryScriptRepository();
	const assets = new InMemoryAssetRepository();
	const recorder = createActivityRecorder({
		log: activity,
		sessionId: "s",
		codePreviewChars: 8,
		now: () => new Date("2026-11-11T00:00:00.000Z"),
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
			capture: capture.run,
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
	);
	const [a, b] = InMemoryTransport.createLinkedPair();
	await Promise.all([server.connect(a), client.connect(b)]);
});

const call = async (args: Record<string, unknown>) => {
	const r = await client.callTool({ name: TOOL_NAME.capture, arguments: args });
	return {
		isError: r.isError === true,
		out: (r.structuredContent ?? {}) as Record<string, unknown>,
		text: (r.content as { text: string }[])[0]?.text ?? "",
	};
};

describe("figma_capture por MCP", () => {
	it("está registrada: no es de solo lectura (lanza un navegador) y no toca Figma", async () => {
		const { tools } = await client.listTools();
		const tool = tools.find((t) => t.name === TOOL_NAME.capture);
		assert.ok(tool);
		assert.equal(tool.annotations?.readOnlyHint, false);
		assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), [
			"allowPageWorld",
			"screens",
		]);
		for (const key of [
			"ok",
			"status",
			"jobId",
			"path",
			"files",
			"rejected",
			"summary",
			"errors",
			"errorCount",
			"error",
			"retryable",
			"touchedNodeIds",
		])
			assert.ok(key in (tool.outputSchema?.properties ?? {}), key);
	});

	it("una captura válida: ok, files con su ruta, summary con conteos, touchedNodeIds vacío y nunca el árbol", async () => {
		const r = await call({ screens: ["inicio"] });
		assert.equal(r.isError, false, r.text);
		assert.equal(r.out["ok"], true);
		assert.equal(r.out["status"], "done");
		assert.match(String(r.out["jobId"]), /^job-/);
		const files = r.out["files"] as { screen: string; path: string }[];
		assert.equal(files[0]?.screen, "inicio");
		assert.equal(r.out["path"], files[0]?.path);
		assert.deepEqual(r.out["summary"], [
			"inicio: 1 variante, 1 nodo, 0 imágenes",
		]);
		assert.deepEqual(r.out["touchedNodeIds"], []);
		assert.doesNotMatch(r.text, /"txt"|"kids"/);
		assert.equal(gateway.runCalls.length, 0);
	});

	it("una que no cumple: ok false con ContractError, los errores recortados y su cuenta", async () => {
		capture.capturer.screens.set(
			"inicio",
			capturedScreen("inicio", [
				textNode("p[0]", { w: -1 }),
				textNode("p[1]", { h: -1 }),
			]),
		);
		try {
			const r = await call({ screens: ["inicio"] });
			assert.equal(r.isError, true);
			assert.equal(r.out["ok"], false);
			assert.equal((r.out["error"] as { type: string }).type, "ContractError");
			assert.equal((r.out["errors"] as unknown[]).length, 1);
			assert.equal(r.out["errorCount"], 2);
			assert.equal((r.out["rejected"] as unknown[]).length, 1);
		} finally {
			capture.capturer.screens.delete("inicio");
		}
	});

	it("evaluateInPage sin allowPageWorld es un error de uso; con él, se captura", async () => {
		const refused = await call({ screens: ["menu"] });
		assert.equal(refused.isError, true);
		assert.match(refused.text, /allowPageWorld/);
		const allowed = await call({ screens: ["menu"], allowPageWorld: true });
		assert.equal(allowed.out["ok"], true);
	});

	it("sin pantallas es un error de entrada", async () => {
		const r = await call({ screens: [] });
		assert.equal(r.isError, true);
	});

	it("la llamada queda en el histórico con sus pantallas resumidas y la ruta de su fichero", async () => {
		const r = await call({ screens: ["inicio"] });
		const called = activity.events.filter(
			(e) =>
				e.type === ACTIVITY_TYPE.toolCalled && e.tool === TOOL_NAME.capture,
		);
		const last = called.at(-1) as
			| { callId: string; args: Record<string, unknown> }
			| undefined;
		assert.deepEqual(last?.args, { screenCount: 1, firstScreen: "inicio" });
		const finished = activity.events.find(
			(e) => e.type === ACTIVITY_TYPE.toolFinished && e.callId === last?.callId,
		) as { resultPath?: string } | undefined;
		assert.equal(finished?.resultPath, r.out["path"]);
		// Una captura de la web no es una captura de Figma: no sale en «Capturas»
		assert.equal(
			activity.events.some((e) => e.type === ACTIVITY_TYPE.screenshotSaved),
			false,
		);
	});
});
