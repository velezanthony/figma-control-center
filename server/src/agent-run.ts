// Tercera raíz de composición: el lanzador del agente de chat, lo que ejecuta `make agent`.
// `node server/src/agent-run.ts <proyecto> [carpeta del lanzamiento]`. Con la carpeta (la prepara el panel) la usa; sin
// ella (un desarrollador a mano) la genera con el mismo caso de uso. Comprueba la versión de Claude Code, arranca
// `claude` con la terminal heredada, el arnés y un entorno limpio, y borra la carpeta al salir (también con SIGTERM y
// SIGHUP, al cerrar la terminal). Si viene del panel (con la carpeta), vigila al panel con una conexión abierta y, si el
// panel se va y no vuelve en el margen (o pide cerrar), cierra a `claude` con señales del sistema: nada pasa por el
// modelo. Puede escribir en stdout: no es el servidor MCP, pero mientras `claude` vive la terminal
// es suya y no se escribe nada.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
	bootLayered,
	launchEnvironment,
	layeredWith,
} from "#adapters/config/env.ts";
import { REPO_ROOT } from "#adapters/config/schema.ts";
import {
	FsAgentLaunches,
	readLaunchFile,
} from "#adapters/fs/fs-agent-launch.ts";
import { watchPanel } from "#adapters/http/panel-watch.ts";
import { isProcessAlive } from "#adapters/process/is-process-alive.ts";
import { makePrepareAgentLaunch } from "#application/prepare-agent-launch.ts";
import { agentEnvironment, type LaunchFile } from "#domain/agent-harness.ts";
import {
	type CloseReason,
	launchIdOfDir,
	WATCH_START,
	type WatchEffect,
	type WatchInput,
	watchStep,
} from "#domain/agent-watch.ts";
import { claudeVersionProblem } from "#domain/claude-version.ts";
import { isProjectId } from "#domain/registry.ts";
import { openRegistry } from "./compose-registry.ts";
import { composeConfig } from "./compose-settings.ts";

const REFUSED = 1;
const CLAUDE = "claude";
// Cuánto espera a que `claude` salga tras pasarle la señal de cerrar
const SIGNAL_GRACE_MS = 5_000;
// Salida cuando lo cerramos nosotros (el panel se fue o pidió cerrar): todo fue como debía
const CLOSED_BY_US = 0;
// Lo que se dice en la terminal cuando `claude` ya ha salido (D-4); mientras vive, nada: la pantalla es suya
const CLOSED_NOTICE: Readonly<Record<Exclude<CloseReason, "user">, string>> = {
	panelGone: "El panel se cerró: agente cerrado",
	closeRequested: "Cerrado desde el panel: agente cerrado",
};

const refuse = (message: string): never => {
	console.error(`make agent: ${message}`);
	process.exit(REFUSED);
};

// default < ajustes del panel < entorno: el margen de la vigilancia es un ajuste editable
const { layered } = composeConfig({
	boot: bootLayered,
	layeredWith,
	warn: (message) => console.error(message),
});
const { machine } = layered;
const [project = "", agentDir = ""] = process.argv.slice(2);

// Test guarda (CA-8): en el entorno de pruebas solo se arranca el `claude` falso, nunca el real
if (machine.agent.testHarness && machine.agent.claudeBin === null) {
	refuse(
		"en el entorno de pruebas solo se arranca el claude falso (FCC_CLAUDE_BIN): no se lanza Claude Code real",
	);
}
if (project === "") {
	refuse(
		"elige un proyecto: make agent PROJECT=<número> (el número sale en la página «Proyectos» del panel). Para trabajar sin límites, `claude` a secas",
	);
}
if (!isProjectId(project))
	refuse(`«${project}» no es el número de un proyecto`);

const claudeBin = machine.agent.claudeBin ?? CLAUDE;
const launches = new FsAgentLaunches({ parent: tmpdir() });

async function prepared(): Promise<{ dir: string; launch: LaunchFile }> {
	if (agentDir !== "") {
		const read = readLaunchFile(agentDir);
		if (!read.ok)
			return refuse(`la carpeta del lanzamiento no vale: ${read.error}`);
		if (read.value.projectId !== project) {
			return refuse(
				`la carpeta del lanzamiento es de otro proyecto (${read.value.projectId}, no ${project})`,
			);
		}
		return { dir: agentDir, launch: read.value };
	}
	launches.sweep(isProcessAlive);
	const prepare = makePrepareAgentLaunch({
		registry: openRegistry({
			dbPath: machine.dbPath,
			outputRoot: bootLayered.outputRoot,
			outputDirFor: bootLayered.outputDirFor,
		}),
		resolveEntry: bootLayered.resolveEntry,
		realpath: (p) => realpath(p).catch(() => null),
		launches,
		machine: {
			repoRoot: REPO_ROOT,
			home: homedir(),
			nodeBin: process.execPath,
			outputRoot: bootLayered.outputRoot,
			dbPath: machine.dbPath,
			secretsFile: machine.web.secretsFile,
			defaultScriptsRoots: bootLayered.defaultScriptsRoots,
		},
		pid: process.pid,
	});
	const r = await prepare(project, randomUUID());
	if (!r.ok) return refuse(r.error.message);
	return { dir: r.value.dir, launch: r.value.files.launch };
}

const { dir, launch } = await prepared();
let cleaned = false;
const cleanup = (): void => {
	if (cleaned) return;
	cleaned = true;
	launches.remove(dir);
};
const fail = (message: string): never => {
	cleanup();
	return refuse(message);
};

try {
	launches.setPid(dir, process.pid);
} catch (e) {
	fail(`no se pudo anotar el lanzador en la carpeta: ${(e as Error).message}`);
}

const env = agentEnvironment(launchEnvironment, launch.env);
const version = spawnSync(claudeBin, ["--version"], { env, encoding: "utf8" });
const problem =
	version.error !== undefined
		? `no se pudo ejecutar «${claudeBin}»: ${version.error.message}`
		: claudeVersionProblem(version.stdout ?? "");
if (problem !== null) fail(problem);

const child: ChildProcess = spawn(claudeBin, [...launch.args], {
	cwd: launch.cwd,
	env,
	stdio: "inherit",
});

// --- Vigilancia del panel (solo si la carpeta es de un lanzamiento del panel; a mano no hay panel que vigilar, D-6) ---
const launchId = agentDir === "" ? null : launchIdOfDir(dir);
const timing = {
	graceMs: machine.agent.panelGraceMs,
	retryMs: machine.agent.watchRetryMs,
};
let watch = WATCH_START;
let connection: { readonly cancel: () => void } | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let graceTimer: NodeJS.Timeout | null = null;
let closedBy: Exclude<CloseReason, "user"> | null = null;
// La señal con la que el usuario cerró (SIGHUP o SIGTERM): es la que se le pasa a claude
let hangupSignal: NodeJS.Signals = "SIGHUP";

const stopWatching = (): void => {
	connection?.cancel();
	connection = null;
	if (retryTimer !== null) clearTimeout(retryTimer);
	if (graceTimer !== null) clearTimeout(graceTimer);
	retryTimer = null;
	graceTimer = null;
};

function apply(input: WatchInput): void {
	const wasWatching = watch.phase === "watching";
	const next = watchStep(watch, input, timing);
	watch = next.state;
	if (wasWatching && watch.phase === "waitingPanel") {
		// El fin del margen llega aunque un reintento se quede colgado
		graceTimer = setTimeout(
			() => apply({ type: "tick", at: Date.now() }),
			timing.graceMs,
		);
	}
	if (watch.phase === "watching" && graceTimer !== null) {
		clearTimeout(graceTimer);
		graceTimer = null;
	}
	run(next.effect);
}

function run(effect: WatchEffect): void {
	switch (effect.type) {
		case "none":
			return;
		case "retry":
			connection = null;
			retryTimer = setTimeout(connect, effect.afterMs);
			return;
		case "shutdown":
			// SIGTERM, SIGKILL si no sale en el plazo; la limpieza y la salida, al salir claude
			stopWatching();
			closedBy = effect.reason;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), SIGNAL_GRACE_MS).unref();
			return;
		case "userClose":
			// El cierre de siempre al cerrar la terminal
			stopWatching();
			cleanup();
			child.kill(hangupSignal);
			setTimeout(() => process.exit(REFUSED), SIGNAL_GRACE_MS).unref();
			return;
		default: {
			const unreachable: never = effect;
			throw new Error(`efecto desconocido: ${JSON.stringify(unreachable)}`);
		}
	}
}

function connect(): void {
	retryTimer = null;
	if (launchId === null) return;
	connection = watchPanel(
		{
			host: machine.dashboard.host,
			port: machine.dashboard.port,
			launchId,
		},
		{
			onConnected: () => apply({ type: "connected" }),
			onLost: () => apply({ type: "disconnected", at: Date.now() }),
			onClose: () => apply({ type: "closeRequested" }),
		},
	);
}

child.once("error", (e) => {
	stopWatching();
	fail(`no se pudo arrancar «${claudeBin}»: ${e.message}`);
});
child.once("exit", (code) => {
	apply({ type: "claudeExited" });
	stopWatching();
	cleanup();
	if (closedBy !== null) {
		console.log(CLOSED_NOTICE[closedBy]);
		process.exit(CLOSED_BY_US);
	}
	process.exit(code ?? REFUSED);
});
// Ctrl+C lo gestiona claude (no sale al primero): solo se le pasa, y se limpia cuando salga
process.on("SIGINT", () => child.kill("SIGINT"));
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
	process.on(signal, () => {
		hangupSignal = signal;
		apply({ type: "hangup" });
	});
}
if (launchId !== null) connect();
