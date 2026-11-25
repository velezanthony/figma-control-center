// Claude Code simulado: un cliente MCP por stdio contra el `main.ts` REAL que sigue el contrato de channels
// (https://code.claude.com/docs/en/channels-reference.md): comprueba que el servidor se declara canal, recibe
// `notifications/claude/channel` y responde con la herramienta `figma_chat_reply`. NUNCA lanza un Claude Code real.
// Todo lo que recibe y envía lo valida contra server/test/contracts/channel.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	PanelChannelNotificationSchema,
	PermissionChannelCapabilitiesSchema,
	PermissionRequestNotificationSchema,
	PermissionVerdictNotificationSchema,
	ReplyArgumentsSchema,
} from "../contracts/channel.ts";
import { MARKDOWN_REPLY } from "../fixtures/scenarios/chat-replies.ts";
import { TIMING } from "./env.ts";

export type ReplyPolicy = {
	// «Claude está pensando…»: cuánto tarda en contestar
	readonly delayMs: number;
	readonly text: (content: string) => string;
};

export const DEFAULT_REPLY: ReplyPolicy = {
	delayMs: 0,
	text: () => MARKDOWN_REPLY,
};

export type ToolOutcome = {
	readonly isError: boolean;
	readonly out: Record<string, unknown>;
	readonly text: string;
};

const NotificationEnvelope = z.object({
	method: z.literal("notifications/claude/channel"),
	params: z.looseObject({}),
});

const VerdictEnvelope = z.object({
	method: z.literal("notifications/claude/channel/permission"),
	params: z.looseObject({}),
});

// El alfabeto de los ids de Claude Code: cinco minúsculas sin `l`
const ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz";
const idFor = (n: number): string =>
	Array.from(
		{ length: 5 },
		(_, i) => ID_ALPHABET[(n * 7 + i * 3) % ID_ALPHABET.length],
	).join("");

export type PermissionAskInput = {
	readonly toolName: string;
	readonly description: string;
	readonly inputPreview: string;
	// Por defecto, un id nuevo en el alfabeto de Claude Code
	readonly requestId?: string;
};

export class FakeClaudeCode {
	readonly received: Array<{ content: string; chatId: string }> = [];
	// Veredictos que Claude Code aplicaría (id emitido por él y aún abierto) y los que descartaría en silencio
	readonly verdicts: Array<{ requestId: string; behavior: "allow" | "deny" }> =
		[];
	readonly droppedVerdicts: Array<{ requestId: string; behavior: string }> = [];
	// Ids emitidos y aún abiertos: contestar en la terminal, o con un veredicto, lo cierra
	readonly #open = new Set<string>();
	readonly #seen = new Set<string>();
	#asked = 0;
	readonly violations: string[] = [];
	readonly #client: Client;
	readonly #transport: StdioClientTransport;
	readonly #timers = new Set<ReturnType<typeof setTimeout>>();
	#policy: ReplyPolicy | null;

	private constructor(
		client: Client,
		transport: StdioClientTransport,
		policy: ReplyPolicy | null,
	) {
		this.#client = client;
		this.#transport = transport;
		this.#policy = policy;
	}

	static async connect(options: {
		readonly main: string;
		readonly env: Readonly<Record<string, string>>;
		readonly reply: ReplyPolicy | null;
	}): Promise<FakeClaudeCode> {
		const client = new Client({
			name: "claude-code-simulado",
			version: "0.0.0",
		});
		const transport = new StdioClientTransport({
			command: process.execPath,
			args: [options.main],
			env: options.env,
			stderr: "ignore",
		});
		const fake = new FakeClaudeCode(client, transport, options.reply);
		client.setNotificationHandler(NotificationEnvelope, (n) => {
			fake.#onChannel(n);
		});
		client.setNotificationHandler(VerdictEnvelope, (n) => {
			fake.#onVerdict(n);
		});
		await client.connect(transport);
		const capabilities = PermissionChannelCapabilitiesSchema.safeParse(
			client.getServerCapabilities(),
		);
		if (!capabilities.success) {
			fake.violations.push(
				`capacidades del servidor: ${capabilities.error.message}`,
			);
		}
		return fake;
	}

	get pid(): number | null {
		return this.#transport.pid;
	}

	get instructions(): string {
		return this.#client.getInstructions() ?? "";
	}

	setReply(policy: ReplyPolicy | null): void {
		this.#policy = policy;
	}

	async callTool(
		name: string,
		args: Record<string, unknown> = {},
		// Con onProgress el SDK añade `_meta.progressToken` y entrega cada notifications/progress del servidor
		options?: {
			readonly onProgress?: (p: {
				readonly progress: number;
				readonly total?: number;
				readonly message?: string;
			}) => void;
		},
	): Promise<ToolOutcome> {
		const r = await this.#client.callTool(
			{ name, arguments: args },
			undefined,
			options?.onProgress === undefined
				? undefined
				: {
						onprogress: (p) =>
							options.onProgress?.({
								progress: p.progress,
								...(p.total !== undefined && { total: p.total }),
								...(typeof p.message === "string" && { message: p.message }),
							}),
					},
		);
		const content = r.content as Array<{ text?: string }>;
		return {
			isError: r.isError === true,
			out: (r.structuredContent ?? {}) as Record<string, unknown>,
			text: content[0]?.text ?? "",
		};
	}

	// El texto de un prompt MCP del servidor (los comandos «/mcp__<servidor>__<nombre>» de Claude Code)
	async prompt(
		name: string,
		args: Record<string, string> = {},
	): Promise<string> {
		const r = await this.#client.getPrompt({ name, arguments: args });
		const content = r.messages[0]?.content;
		return content?.type === "text" ? content.text : "";
	}

	// La descripción que el servidor da de una herramienta: la que Claude Code pone en un diálogo de permiso
	async toolDescription(name: string): Promise<string> {
		const { tools } = await this.#client.listTools();
		const tool = tools.find((t) => t.name === name);
		if (tool?.description === undefined) {
			throw new Error(`el servidor no describe la herramienta ${name}`);
		}
		return tool.description;
	}

	// figma_build responde ya con el jobId: espera al final del job con figma_get_job y waitMs
	async waitJob(jobId: string): Promise<ToolOutcome> {
		const deadline = Date.now() + TIMING.waitMs;
		let last = await this.callTool(TOOL_NAME.getJob, { jobId, waitMs: 1000 });
		while (last.out["status"] === "running" && Date.now() < deadline) {
			last = await this.callTool(TOOL_NAME.getJob, { jobId, waitMs: 1000 });
		}
		return last;
	}

	// Claude Code abre un diálogo de permiso y se lo notifica al canal (contrato: «Relay permission prompts»)
	async askPermission(input: PermissionAskInput): Promise<string> {
		const requestId = input.requestId ?? idFor(++this.#asked);
		const notification = PermissionRequestNotificationSchema.parse({
			method: "notifications/claude/channel/permission_request",
			params: {
				request_id: requestId,
				tool_name: input.toolName,
				description: input.description,
				input_preview: input.inputPreview,
			},
		});
		this.#open.add(requestId);
		this.#seen.add(requestId);
		await this.#client.notification(notification);
		return requestId;
	}

	// Alguien contesta en la terminal antes que el panel: el diálogo se cierra y un veredicto posterior no cuenta
	answerInTerminal(requestId: string): void {
		this.#open.delete(requestId);
	}

	#onVerdict(raw: unknown): void {
		const parsed = PermissionVerdictNotificationSchema.safeParse(raw);
		if (!parsed.success) {
			this.violations.push(`veredicto de permiso: ${parsed.error.message}`);
			return;
		}
		const { request_id: requestId, behavior } = parsed.data.params;
		if (this.#open.delete(requestId)) {
			this.verdicts.push({ requestId, behavior });
		} else {
			this.droppedVerdicts.push({ requestId, behavior });
		}
	}

	#onChannel(raw: unknown): void {
		const parsed = PanelChannelNotificationSchema.safeParse(raw);
		if (!parsed.success) {
			this.violations.push(`notificación de channel: ${parsed.error.message}`);
			return;
		}
		const { content, meta } = parsed.data.params;
		const chatId = meta["chat_id"] ?? "";
		this.received.push({ content, chatId });
		const policy = this.#policy;
		if (policy === null) return;
		const timer = setTimeout(() => {
			this.#timers.delete(timer);
			const args = ReplyArgumentsSchema.parse({
				chat_id: chatId,
				text: policy.text(content),
			});
			this.callTool(TOOL_NAME.chatReply, args).catch((e: unknown) => {
				this.violations.push(`figma_chat_reply: ${String(e)}`);
			});
		}, policy.delayMs);
		this.#timers.add(timer);
	}

	async close(): Promise<void> {
		for (const t of this.#timers) clearTimeout(t);
		this.#timers.clear();
		// main.ts sale con SIGTERM (revoca su token); esperar a que cierre por stdin costaría 2 s por entorno
		const pid = this.pid;
		if (pid !== null) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// ya había terminado
			}
		}
		await this.#client.close().catch(() => {});
	}
}
