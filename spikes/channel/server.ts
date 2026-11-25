// Sonda del channel (H5): un servidor MCP mínimo que se declara canal de Claude Code, recibe mensajes por HTTP
// (en el panel real serán los de la tabla chat_messages), los empuja a la sesión con
// `notifications/claude/channel` y expone una herramienta `reply` cuya respuesta se ve por SSE.
// Sigue https://code.claude.com/docs/en/channels-reference.md con McpServer (el mismo SDK que el servidor real).
// Uso (lo arranca Claude Code o la sonda): node spikes/channel/server.ts
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const HOST = "127.0.0.1";
const PORT = Number(process.env["SPIKE_PORT"] ?? 8789);
const CHANNEL_CAPABILITY = "claude/channel";
const CHANNEL_METHOD = "notifications/claude/channel";

const mcp = new McpServer(
	{ name: "channel-spike", version: "0.0.1" },
	{
		capabilities: { experimental: { [CHANNEL_CAPABILITY]: {} } },
		instructions:
			'Los mensajes llegan como <channel source="channel-spike" chat_id="...">. Responde siempre con la herramienta reply, pasando el chat_id de la etiqueta.',
	},
);

const listeners = new Set<(chunk: string) => void>();
const broadcast = (text: string) => {
	const chunk = `${text
		.split("\n")
		.map((l) => `data: ${l}\n`)
		.join("")}\n`;
	for (const emit of listeners) emit(chunk);
};

mcp.registerTool(
	"reply",
	{
		description: "Envía una respuesta al chat del panel.",
		inputSchema: {
			chat_id: z
				.string()
				.describe(
					"La conversación a la que se responde (el chat_id de la etiqueta).",
				),
			text: z.string().describe("El mensaje."),
		},
	},
	({ chat_id, text }) => {
		broadcast(`Reply to ${chat_id}: ${text}`);
		return { content: [{ type: "text" as const, text: "sent" }] };
	},
);

await mcp.connect(new StdioServerTransport());

let nextId = 1;
createServer(async (req, res) => {
	if (req.method === "GET" && req.url === "/events") {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
		});
		res.write(": connected\n\n");
		const emit = (chunk: string) => res.write(chunk);
		listeners.add(emit);
		req.on("close", () => listeners.delete(emit));
		return;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const chat_id = String(nextId++);
	// El SDK solo tipa las notificaciones de MCP: la de channel es una extensión de Claude Code
	await mcp.server.notification({
		method: CHANNEL_METHOD,
		params: {
			content: Buffer.concat(chunks).toString("utf8"),
			meta: { chat_id },
		},
	} as never);
	res.end(`ok ${chat_id}`);
}).listen(PORT, HOST, () =>
	console.error(`channel-spike escuchando en http://${HOST}:${PORT}`),
);
