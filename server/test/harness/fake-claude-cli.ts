// `claude` FALSO para las pruebas del lanzador (agent-run.ts): nunca lanza Claude Code. Lo instala fake-claude-bin.ts
// como `<carpeta>/bin/claude` (un guion que llama a este fichero con su configuración delante). Deja escrito con qué
// argumentos, cwd y entorno lo arrancaron y una copia de los ficheros del lanzamiento que vio. Según su modo sale al
// momento, espera a una señal o hace de sesión de Claude Code (conecta con el servidor MCP de su mcp.json, con chat).
import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_REPLY, FakeClaudeCode } from "./fake-claude.ts";

export type FakeClaudeMode = "exit" | "wait" | "session";

export type FakeClaudeConfig = {
	readonly version: string;
	readonly mode: FakeClaudeMode;
	// Dónde deja lo que vio (JSON), en modo wait/session la señal que recibió y, en modo sesión, lo que dio figma_status
	readonly record: string;
	// El entorno de pruebas que haría de .env para el servidor MCP en modo sesión (el de verdad lo cargaría del .env)
	readonly sessionEnv: Readonly<Record<string, string>>;
	readonly exitCode: number;
	// Hace como un claude colgado: anota SIGTERM pero no sale (solo un SIGKILL lo para)
	readonly ignoreSigterm: boolean;
};

// Lo que pasó por el canal y por las herramientas mientras vivía (modo sesión): la vigilancia no gasta tokens (CA-5)
export type FakeClaudeTraffic = {
	readonly channelMessages: number;
	readonly toolCalls: readonly string[];
};

export type FakeClaudeRecord = {
	readonly argv: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly files: Readonly<Record<string, unknown>>;
	readonly pid: number;
};

// Vida máxima pase lo que pase: nunca queda huérfano
const MAX_LIFE_MS = 5 * 60_000;
const SERVER = "figma-control-center";
const WATCH_MS = 500;

const [configFile, ...args] = process.argv.slice(2);
const config = JSON.parse(
	readFileSync(configFile as string, "utf8"),
) as FakeClaudeConfig;

if (args[0] === "--version") {
	process.stdout.write(`${config.version} (Claude Code)\n`);
	process.exit(0);
}

const after = (flag: string): string | null => {
	const i = args.indexOf(flag);
	return i === -1 ? null : (args[i + 1] ?? null);
};
const readJson = (file: string | null): unknown => {
	if (file === null || !existsSync(file)) return null;
	return JSON.parse(readFileSync(file, "utf8")) as unknown;
};
const settingsFile = after("--settings");
const mcpFile = after("--mcp-config");
const env: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env))
	if (v !== undefined) env[k] = v;
const record: FakeClaudeRecord = {
	argv: args,
	cwd: process.cwd(),
	env,
	files: {
		"settings.json": readJson(settingsFile),
		"mcp.json": readJson(mcpFile),
		"launch.json":
			settingsFile === null
				? null
				: readJson(join(dirname(settingsFile), "launch.json")),
	},
	pid: process.pid,
};
writeFileSync(config.record, JSON.stringify(record));

if (config.mode === "exit") process.exit(config.exitCode);

let claude: FakeClaudeCode | undefined;
const toolCalls: string[] = [];
const writeTraffic = (): void => {
	if (claude === undefined) return;
	const traffic: FakeClaudeTraffic = {
		channelMessages: claude.received.length,
		toolCalls,
	};
	writeFileSync(`${config.record}.traffic.json`, JSON.stringify(traffic));
};
const stopOn = (signal: NodeJS.Signals) => {
	process.on(signal, () => {
		writeFileSync(`${config.record}.signal`, signal);
		appendFileSync(`${config.record}.signals`, `${signal}\n`);
		writeTraffic();
		if (signal === "SIGTERM" && config.ignoreSigterm) return;
		void (claude?.close() ?? Promise.resolve()).finally(() =>
			process.exit(config.exitCode),
		);
	});
};
stopOn("SIGTERM");
stopOn("SIGHUP");
stopOn("SIGINT");
setTimeout(() => process.exit(1), MAX_LIFE_MS).unref();
// Si su entorno de pruebas desaparece sin avisarle (el test se abortó), sale: nunca queda huérfano. Mientras, deja al día
// lo que le ha llegado por el canal (un SIGKILL no le deja escribirlo al final)
setInterval(() => {
	if (!existsSync(configFile as string)) process.exit(1);
	writeTraffic();
}, WATCH_MS);

if (config.mode === "session") {
	const mcp = readJson(mcpFile) as {
		mcpServers: Record<string, { args: string[]; env: Record<string, string> }>;
	};
	const server = mcp.mcpServers[SERVER];
	if (server === undefined) throw new Error(`mcp.json sin ${SERVER}`);
	claude = await FakeClaudeCode.connect({
		main: server.args[0] as string,
		env: { ...config.sessionEnv, ...server.env },
		reply: DEFAULT_REPLY,
	});
	// Lo que ve su servidor MCP: los tests comprueban que solo ve el proyecto lanzado
	toolCalls.push("figma_status");
	const status = await claude.callTool("figma_status");
	writeFileSync(`${config.record}.status.json`, JSON.stringify(status.out));
	writeTraffic();
}
