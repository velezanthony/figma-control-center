// Prueba automática de la sonda SIN Claude Code: un cliente MCP hace de sesión. Comprueba que
//  1. el servidor se declara canal (capabilities.experimental['claude/channel']),
//  2. un mensaje por HTTP llega como `notifications/claude/channel` con meta.chat_id,
//  3. la herramienta reply se puede llamar y su texto sale por SSE.
// Lo que NO puede comprobar es que Claude Code entregue la etiqueta al modelo: eso es el paso manual del README.
// Uso: node spikes/channel/probe.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

const PORT = 18_789;
const BASE = `http://127.0.0.1:${PORT}`;
const ChannelNotification = z.object({
	method: z.literal("notifications/claude/channel"),
	params: z.object({
		content: z.string(),
		meta: z.record(z.string(), z.string()).optional(),
	}),
});

const transport = new StdioClientTransport({
	command: process.execPath,
	args: [new URL("./server.ts", import.meta.url).pathname],
	env: { ...(process.env as Record<string, string>), SPIKE_PORT: String(PORT) },
	stderr: "inherit",
});
const client = new Client({ name: "probe", version: "0.0.0" });

const received: z.infer<typeof ChannelNotification>["params"][] = [];
client.setNotificationHandler(ChannelNotification, (n) => {
	received.push(n.params);
});
await client.connect(transport);

const results: [string, boolean][] = [];
const check = (name: string, ok: boolean) => {
	results.push([name, ok]);
	console.log(`${ok ? "OK  " : "FALLA"} ${name}`);
};

const experimental = client.getServerCapabilities()?.experimental;
check(
	"el servidor declara experimental['claude/channel']",
	experimental !== undefined && "claude/channel" in experimental,
);
check(
	"el servidor trae instrucciones para el modelo",
	(client.getInstructions() ?? "").includes("reply"),
);

await new Promise((r) => setTimeout(r, 300));
const sse = fetch(`${BASE}/events`);
const stream = (await sse).body?.getReader();
await fetch(BASE, { method: "POST", body: "¿qué se hizo en la última hora?" });
for (let i = 0; i < 50 && received.length === 0; i++)
	await new Promise((r) => setTimeout(r, 50));
check(
	"el mensaje llega como notifications/claude/channel",
	received.length === 1 &&
		received[0]?.content === "¿qué se hizo en la última hora?",
);
const chatId = received[0]?.meta?.["chat_id"];
check(
	"la notificación lleva meta.chat_id",
	chatId !== undefined && chatId !== "",
);

const reply = await client.callTool({
	name: "reply",
	arguments: { chat_id: chatId ?? "?", text: "Hecho: 3 llamadas" },
});
check("la herramienta reply responde", reply.isError !== true);
let seen = "";
const decoder = new TextDecoder();
for (let i = 0; i < 20 && !seen.includes("Hecho"); i++) {
	const { value } = (await stream?.read()) ?? {};
	if (value) seen += decoder.decode(value);
}
check(
	"la respuesta sale por SSE con su chat_id",
	seen.includes(`Reply to ${chatId}: Hecho: 3 llamadas`),
);

await stream?.cancel();
await client.close();
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
