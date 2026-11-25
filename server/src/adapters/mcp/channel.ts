import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChannelPush } from "#application/chat-relay.ts";
import type { PermissionPush } from "#application/permissions.ts";
import type { PermissionAsk } from "#application/ports/permissions.ts";
import type { ChatError, ChatMessage } from "#domain/chat.ts";
import type { Result } from "#domain/result.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";
import { reply, usageError } from "./presenters.ts";

// Contrato de los channels de Claude Code (research preview):
// https://code.claude.com/docs/en/channels-reference.md
export const CHANNEL = Object.freeze({
	capability: "claude/channel",
	method: "notifications/claude/channel",
} as const);

// Relevo de permisos (Claude Code >= 2.1.234): el servidor declara la capacidad, Claude Code le notifica cada
// diálogo de permiso que abre y el servidor devuelve el veredicto. Mismo documento, «Relay permission prompts»
export const PERMISSION_CHANNEL = Object.freeze({
	capability: "claude/channel/permission",
	requestMethod: "notifications/claude/channel/permission_request",
	verdictMethod: "notifications/claude/channel/permission",
	// Cinco minúsculas sin `l`: el alfabeto de los ids que genera Claude Code
	requestId: /^[a-km-z]{5}$/,
} as const);

// Claude Code se la entrega al modelo cuando el servidor se conecta
export const CHANNEL_INSTRUCTIONS = [
	`Los mensajes del panel de figma-control-center llegan como <channel source="figma-control-center" chat_id="...">: es el usuario preguntando algo desde el panel web.`,
	`Responde SIEMPRE con la herramienta ${TOOL_NAME.chatReply}, pasando el chat_id de la etiqueta y tu respuesta en text; si no la llamas, el usuario no ve nada.`,
	`Para preguntas sobre la actividad usa las herramientas figma_history_* (resumen primero, detalle solo si hace falta) y responde corto y en castellano.`,
	`Los comandos con barra (un mensaje que es /algo, como /mcp o /exit) no existen en esta sesión, ni en el panel ni en la terminal. Si te escriben uno, responde solo: «Los comandos no están disponibles en este agente. Para cerrarlo, usa “Cerrar agente” o cierra su ventana.»`,
	`Escribe las rutas, los nombres de fichero y los de herramienta entre comillas invertidas (\`así\`), para que el panel los resalte.`,
].join("\n");

// Lo que se añade para el agente del chat del panel (`make agent`): solo consulta; el trabajo es de la sesión del usuario
export const CHAT_AGENT_INSTRUCTIONS = [
	`Eres el agente del chat del panel y solo consultas: el estado (${TOOL_NAME.status} y las lecturas de Figma), la actividad y el histórico (figma_history_*). No cambias Figma, no capturas la web y no escribes ficheros.`,
	`Si te piden un cambio (pintar, construir, capturar o editar un script), no lo intentes: responde que los cambios se hacen desde Claude Code dentro del proyecto, con el servidor MCP conectado.`,
].join("\n");

// Presencia de la capacidad = Claude Code registra el oyente de notificaciones; las herramientas son las de siempre
export function channelServerOptions(chatAgent = false) {
	return {
		// El relevo de permisos solo es seguro porque el veredicto lo firma el panel con el token de la sesión
		capabilities: {
			experimental: {
				[CHANNEL.capability]: {},
				[PERMISSION_CHANNEL.capability]: {},
			},
		},
		instructions: chatAgent
			? `${CHANNEL_INSTRUCTIONS}\n${CHAT_AGENT_INSTRUCTIONS}`
			: CHANNEL_INSTRUCTIONS,
	};
}

// El SDK solo tipa las notificaciones estándar de MCP: la del channel es una extensión de Claude Code,
// de ahí el único cast
export function pushToChannel(
	server: McpServer,
): (push: ChannelPush) => Promise<void> {
	return (push) =>
		server.server.notification({
			method: CHANNEL.method,
			params: { content: push.content, meta: push.meta },
		} as never);
}

const PermissionRequestNotification = z.object({
	method: z.literal(PERMISSION_CHANNEL.requestMethod),
	params: z.object({
		request_id: z.string(),
		tool_name: z.string(),
		description: z.string(),
		input_preview: z.string(),
	}),
});

// Claude Code avisa de cada diálogo de permiso. Todo lo que trae es dato no fiable: solo se guarda como texto
export function handlePermissionRequests(
	server: McpServer,
	record: (ask: PermissionAsk) => unknown,
	warn: (message: string) => void,
): void {
	server.server.setNotificationHandler(
		PermissionRequestNotification,
		({ params }) => {
			if (!PERMISSION_CHANNEL.requestId.test(params.request_id)) {
				warn("permisos: petición con un request_id que no es de Claude Code");
				return;
			}
			record({
				requestId: params.request_id,
				toolName: params.tool_name,
				description: params.description,
				inputPreview: params.input_preview,
			});
		},
	);
}

export function pushPermissionVerdict(
	server: McpServer,
): (verdict: PermissionPush) => Promise<void> {
	return (verdict) =>
		server.server.notification({
			method: PERMISSION_CHANNEL.verdictMethod,
			params: { request_id: verdict.requestId, behavior: verdict.behavior },
		} as never);
}

const replyInput = {
	chat_id: z
		.string()
		.min(1)
		.describe(
			"La conversación a la que respondes: el chat_id de la etiqueta <channel>.",
		),
	text: z.string().describe("Tu respuesta para el usuario del panel."),
};

const replyOutput = { ok: z.boolean(), messageId: z.number() };

export function registerChatTools(
	server: McpServer,
	replyChat: (chatId: string, text: string) => Result<ChatMessage, ChatError>,
): void {
	server.registerTool(
		TOOL_NAME.chatReply,
		{
			title: "Responder en el chat del panel",
			description:
				"Responde a un mensaje que llegó del panel de figma-control-center como <channel>. Pasa el chat_id de esa etiqueta; el usuario ve el texto en el panel en vivo. Solo para responder a esos mensajes.",
			inputSchema: replyInput,
			outputSchema: replyOutput,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		({ chat_id, text }) => {
			const sent = replyChat(chat_id, text);
			return sent.ok
				? reply({ ok: true, messageId: sent.value.id }, false)
				: usageError(sent.error.message);
		},
	);
}

// La sesión mira su bandeja cada `pollMs`; un fallo se avisa y el sondeo sigue
export function startChatPolling(options: {
	readonly relay: { deliverPending(): Promise<number> };
	readonly pollMs: number;
	readonly warn: (message: string) => void;
}): () => void {
	let running = false;
	const timer = setInterval(() => {
		if (running) return;
		running = true;
		options.relay
			.deliverPending()
			.catch((e: unknown) =>
				options.warn(`chat: ${e instanceof Error ? e.message : String(e)}`),
			)
			.finally(() => {
				running = false;
			});
	}, options.pollMs);
	return () => clearInterval(timer);
}
