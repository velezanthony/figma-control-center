// Raíz de composición del servidor MCP. El servidor arranca SIEMPRE, haya o no proyectos: el proyecto vigente se
// resuelve en cada llamada (application/active-project.ts) y su sesión (compose-session.ts: plano de datos, chat,
// sondeos) se monta cuando aparece. Mientras no hay proyecto, toda herramienta responde un error de uso que dice qué
// hacer. Las bandejas de chat se instancian en la sesión (un lado del chat por raíz).
// stdout es el canal MCP: los fallos de arranque van a stderr.
import { randomUUID } from "node:crypto";
import { bootLayered, layeredWith } from "#adapters/config/env.ts";
import { FILE_URL_IGNORED_WARNING } from "#adapters/config/schema.ts";
import { createFsTabLocks } from "#adapters/fs/fs-build-lock.ts";
import { createBuildProgressBus } from "#adapters/mcp/build-progress.ts";
import { startChatPolling } from "#adapters/mcp/channel.ts";
import { createMcpServer, serveOverStdio } from "#adapters/mcp/server.ts";
import type { UseCases } from "#adapters/mcp/tools.ts";
import { isProcessAlive } from "#adapters/process/is-process-alive.ts";
import { makeActiveProject } from "#application/active-project.ts";
import { agentScopeProblem } from "#application/agent-scope.ts";
import { resolveTenants } from "#application/resolve-tenants.ts";
import { openRegistry } from "./compose-registry.ts";
import { mountSession, type Session } from "./compose-session.ts";
import { composeConfig } from "./compose-settings.ts";

const FATAL_EXIT_CODE = 1;

const fatal = (reason: unknown): never => {
	console.error("figma-control-center-mcp: fallo fatal:", reason);
	process.exit(FATAL_EXIT_CODE);
};
process.on("uncaughtException", fatal);
process.on("unhandledRejection", fatal);

// El apagado se registra ANTES del primer `await`: si Claude Code cierra la tubería o manda una señal mientras se
// resuelve el registro o se abre la base, nadie más se enteraría. Lo que hay que limpiar se enlaza más abajo.
let cleanup = () => {};
const shutdown = () => {
	cleanup();
	process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

const warn = (message: string): void => console.error(message);

// default < base (ajustes del panel) < entorno: la configuración final se compone una vez, con la base ya abierta
const { layered } = composeConfig({ boot: bootLayered, layeredWith, warn });

if (layered.fileUrlIgnored) {
	console.error(`figma-control-center-mcp: ${FILE_URL_IGNORED_WARNING}`);
}

// Fachada que reenvía cada llamada a lo que tenga la sesión vigente EN ese momento. Se lee al llamar, no al registrar
// la herramienta: el proyecto puede aparecer o cambiar con el servidor ya arrancado.
function delegate<T extends object>(get: () => T): T {
	return new Proxy({} as T, {
		get:
			(_target, prop) =>
			(...args: unknown[]) => {
				const target = get();
				const member = Reflect.get(target, prop) as (
					...a: unknown[]
				) => unknown;
				return member.apply(target, args);
			},
	});
}

// Lock de lote por archivo de Figma, entre procesos (CA-8): una carpeta de máquina con un fichero por fileKey, así que
// otra sesión de Claude Code sobre el mismo archivo no puede tener un lote a la vez. Se suelta al apagar.
const tabLocks = createFsTabLocks({
	dir: layered.machine.locksDir,
	pid: process.pid,
	isAlive: isProcessAlive,
});
const sessionId = randomUUID();
const buildProgress = createBuildProgressBus();

const registry = openRegistry({
	dbPath: layered.machine.dbPath,
	outputRoot: layered.outputRoot,
	outputDirFor: layered.outputDirFor,
});
const panelUrl = `http://${layered.machine.dashboard.host}:${layered.machine.dashboard.port}`;

// Los proyectos salen solo del registro (D-1): el archivo de Figma es de cada proyecto, no del .env. Con uno solo en
// alcance, ese; con varios y ninguno elegido (FCC_PROJECTS=<id>, o `make agent PROJECT=<id>`), o con ninguno, las
// herramientas responden el error de uso (servir el primero escribiría en un archivo que nadie eligió).
const active = makeActiveProject<Session>({
	resolve: () =>
		resolveTenants({
			registry,
			scope: layered.scope,
			resolveEntry: layered.resolveEntry,
		}),
	panelUrl,
	build: (config) =>
		mountSession(
			{
				machine: layered.machine,
				sessionId,
				tabLocks,
				progress: buildProgress,
				server,
				warn,
			},
			config,
		),
	dispose: (session) => session.dispose(),
	// Un agente de chat (make agent) sin exactamente un proyecto en alcance no atiende el chat ni toca Figma
	refuse: agentScopeProblem(layered.machine.chat.agent, layered.scope),
	onProblems: (problems) => {
		for (const problem of problems) {
			console.error(
				`figma-control-center-mcp: registro de proyectos: ${problem}`,
			);
		}
	},
});

const session = (): Session => {
	const current = active.current();
	if (current === null) throw new Error("no hay proyecto servido");
	return current;
};

// Los casos de uso son funciones; el manifiesto es un puerto (un objeto con métodos): cada uno con su fachada
const useCasesNow = () => session().useCases;
const useCases: UseCases = {
	runScript: delegate(useCasesNow).runScript,
	getJob: delegate(useCasesNow).getJob,
	getStatus: delegate(useCasesNow).getStatus,
	takeScreenshot: delegate(useCasesNow).takeScreenshot,
	getMetadata: delegate(useCasesNow).getMetadata,
	runBuild: delegate(useCasesNow).runBuild,
	cancelJob: delegate(useCasesNow).cancelJob,
	buildManifest: delegate(() => useCasesNow().buildManifest),
	areaPlan: delegate(useCasesNow).areaPlan,
	sheetsPlan: delegate(useCasesNow).sheetsPlan,
	reads: delegate(() => useCasesNow().reads),
	capture: delegate(useCasesNow).capture,
	historyScript: delegate(useCasesNow).historyScript,
	historyDiff: delegate(useCasesNow).historyDiff,
};

const server = createMcpServer(
	useCases,
	delegate(() => session().recorder),
	delegate(() => session().history),
	(chatId, text) => session().replyChat(chatId, text),
	{
		record: (ask) => active.current()?.recordPermission(ask) ?? null,
		warn,
	},
	{
		bus: buildProgress,
		progressMinIntervalMs: layered.machine.build.progressMinIntervalMs,
		touched: {
			store: delegate(() => session().tenant.store),
			maxInlineBytes: layered.machine.output.maxInlineResultBytes,
		},
	},
	async () => {
		const state = await active.resolve();
		return state.kind === "ready" ? null : state.message;
	},
	() => active.current()?.tenant.gateway.takeTabNotice() ?? null,
	layered.machine.chat.agent,
);

// Resolver el proyecto no espera a una llamada: el mismo latido de las sesiones monta uno dado de alta después (y
// registra el chat del agente). Un mismo motivo para no tener proyecto se cuenta una sola vez.
let lastUnavailable = "";
const resolveProject = async (): Promise<number> => {
	const state = await active.resolve();
	const message = state.kind === "ready" ? "" : state.message;
	if (message !== lastUnavailable) {
		lastUnavailable = message;
		if (message !== "") console.error(`figma-control-center-mcp: ${message}`);
	}
	return 0;
};
let stopHeartbeat = () => {};
cleanup = () => {
	stopHeartbeat();
	active.close();
	tabLocks.releaseAll();
};

// El proyecto vigente se monta antes de conectar: cuando Claude Code ve el servidor, su sesión (y el chat del agente)
// ya están registrados. Si no hay ninguno, arranca igual.
await resolveProject();
await serveOverStdio(server).catch(fatal);
// Si el cliente (Claude Code) cierra la tubería —se va sin mandar señal—, el servidor no debe quedar huérfano:
// el cierre del transporte y el EOF de stdin (registrado arriba) disparan el mismo apagado ordenado.
server.server.onclose = shutdown;
stopHeartbeat = startChatPolling({
	relay: { deliverPending: resolveProject },
	pollMs: layered.machine.chat.pollMs,
	warn,
});
console.error(
	`figma-control-center-mcp listo (CDP ${layered.machine.cdp.host}:${layered.machine.cdp.port})`,
);
