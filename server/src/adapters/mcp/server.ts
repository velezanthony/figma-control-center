import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chatAgentToolProblem } from "#application/agent-scope.ts";
import type { makeReplyChat } from "#application/chat-messages.ts";
import type { History } from "#application/history.ts";
import type { makeRecordPermission } from "#application/permissions.ts";
import type { ActivityRecorder } from "#application/record-activity.ts";
import type { BuildProgressBus } from "./build-progress.ts";
import { registerBuildTools } from "./build-tools.ts";
import { registerCaptureTools } from "./capture-tools.ts";
import {
	channelServerOptions,
	handlePermissionRequests,
	registerChatTools,
} from "./channel.ts";
import { registerHistoryPrompts } from "./history-prompts.ts";
import { registerHistoryTools } from "./history-tools.ts";
import { type ToolReply, usageError } from "./presenters.ts";
import { registerReadTools } from "./read-tools.ts";
import { registerTools, type UseCases } from "./tools.ts";
import type { TouchedLimit } from "./touched-file.ts";

export const SERVER_INFO = Object.freeze({
	name: "figma-control-center-mcp",
	version: "0.1.0",
} as const);

type Handler = (...args: unknown[]) => unknown;

// null: hay proyecto y las herramientas pueden trabajar; un texto: el error de uso que reciben en su lugar
export type ProjectGate = () => string | null | Promise<string | null>;
// Lo mismo, por herramienta
type ToolGate = (tool: string) => string | null | Promise<string | null>;

// Lo que se pone delante de las herramientas:
//  - `gate`: mientras devuelve un mensaje (ningún proyecto, o varios en alcance y ninguno elegido), cada herramienta
//    responde ese error de uso y no hace nada más (ni toca Figma, ni escribe en el histórico de ningún proyecto). Se
//    evalúa en cada llamada, y puede ser asíncrona: es quien resuelve el proyecto vigente.
//  - `decorate`: cambia la respuesta ya hecha (la usa el aviso de «abrí la pestaña»).
function wrapped(
	server: McpServer,
	options: {
		readonly gate: ToolGate;
		readonly decorate?: (reply: ToolReply) => ToolReply;
	},
): McpServer {
	return new Proxy(server, {
		get(target, prop, receiver) {
			if (prop !== "registerTool") return Reflect.get(target, prop, receiver);
			return (name: string, config: unknown, handler: Handler) =>
				(target.registerTool as (...a: unknown[]) => unknown)(
					name,
					config,
					async (...args: unknown[]) => {
						const message = await options.gate(name);
						if (message !== null) return usageError(message);
						const reply = (await handler(...args)) as ToolReply;
						return options.decorate === undefined
							? reply
							: options.decorate(reply);
					},
				);
		},
	});
}

// Si el servidor abrió la pestaña del proyecto para esta llamada, la respuesta lo dice (`tabOpened`)
function withTabNotice(takeNotice: () => string | null) {
	return (reply: ToolReply): ToolReply => {
		const notice = takeNotice();
		if (notice === null || reply.structuredContent === undefined) return reply;
		const structured = { ...reply.structuredContent, tabOpened: notice };
		return {
			...reply,
			structuredContent: structured,
			content: [{ type: "text", text: JSON.stringify(structured) }],
		};
	};
}

export function createMcpServer(
	useCases: UseCases,
	recorder: ActivityRecorder,
	history: History,
	replyChat: ReturnType<typeof makeReplyChat>,
	permissions: {
		readonly record: ReturnType<typeof makeRecordPermission>;
		readonly warn: (message: string) => void;
	},
	build: {
		readonly bus: BuildProgressBus;
		readonly progressMinIntervalMs: number;
		readonly touched: TouchedLimit;
		readonly now?: () => number;
	},
	// Sin proyecto (o con varios y ninguno elegido), el mensaje de uso con qué hacer (null: hay proyecto)
	projectGate: ProjectGate = () => null,
	// El aviso de que el servidor abrió la pestaña del proyecto (una sola vez); null: no hubo
	takeTabNotice: () => string | null = () => null,
	// Agente del chat del panel (FCC_CHAT_AGENT): solo consulta
	chatAgent = false,
): McpServer {
	// El servidor se declara canal de Claude Code (research preview): solo actúa si la sesión lo carga como canal
	const server = new McpServer(SERVER_INFO, channelServerOptions(chatAgent));
	// Sin proyecto, ese motivo va antes: es lo primero que hay que arreglar
	const gate: ToolGate = async (tool) =>
		(await projectGate()) ?? chatAgentToolProblem(chatAgent, tool);
	const figmaTools = wrapped(server, {
		gate,
		decorate: withTabNotice(takeTabNotice),
	});
	const projectTools = wrapped(server, { gate });
	registerTools(figmaTools, useCases, recorder, build.touched, {
		bus: build.bus,
		minIntervalMs: build.progressMinIntervalMs,
		...(build.now !== undefined && { now: build.now }),
	});
	registerReadTools(figmaTools, useCases.reads, recorder);
	registerBuildTools(
		figmaTools,
		{
			runBuild: useCases.runBuild,
			cancelJob: useCases.cancelJob,
			buildManifest: useCases.buildManifest,
			areaPlan: useCases.areaPlan,
			sheetsPlan: useCases.sheetsPlan,
		},
		recorder,
		{ touched: build.touched },
	);
	// La captura de la web no habla con la pestaña de Figma: sin el aviso de «abrí la pestaña»
	registerCaptureTools(projectTools, useCases.capture, recorder);
	// Las consultas de histórico no se registran en el histórico: preguntar por la actividad no es actividad
	registerHistoryTools(
		projectTools,
		history,
		undefined,
		useCases.historyScript,
		useCases.historyDiff,
	);
	registerHistoryPrompts(server);
	registerChatTools(projectTools, replyChat);
	handlePermissionRequests(server, permissions.record, permissions.warn);
	return server;
}

// stdout es el canal MCP: nada más debe escribir en él
export async function serveOverStdio(server: McpServer): Promise<void> {
	await server.connect(new StdioServerTransport());
}
