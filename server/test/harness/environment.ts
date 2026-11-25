// Arnés de procesos REALES: arranca `dashboard.ts` y (al pedirlo) `main.ts` como en producción, con configuración
// de prueba (carpeta temporal, puertos efímeros, el simulador de Figma como Chrome) y garantiza la limpieza.
// Cada test monta su propio entorno: sin estado compartido.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openFigmaDatabase } from "#adapters/sqlite/database.ts";
import type { EntryDraft, RegistryEntry } from "#domain/registry.ts";
import { SCRIPTS_DIR } from "../fixtures/scenarios/scenarios.ts";
import type { World } from "../fixtures/scenarios/world.ts";
import {
	agentProject,
	agentProjectDirs,
	e2eProject,
	FIGMA_DB_FILE,
	LOOPBACK,
	TIMING,
	testEnv,
} from "./env.ts";
import {
	DEFAULT_REPLY,
	FakeClaudeCode,
	type ReplyPolicy,
} from "./fake-claude.ts";
import { type FakeClaude, installFakeClaude } from "./fake-claude-bin.ts";
import { type FigmaSimulator, startFigmaSimulator } from "./figma-simulator.ts";
import { processesOf } from "./processes.ts";
import { addProjects } from "./projects.ts";
import { freePort, until } from "./wait.ts";

const SERVER_SRC = join(import.meta.dirname, "../../src");
const MAIN = join(SERVER_SRC, "main.ts");
const DASHBOARD = join(SERVER_SRC, "dashboard.ts");
const FAKE_TERMINAL = join(import.meta.dirname, "fake-terminal.ts");
const WEB_INDEX = join(import.meta.dirname, "../../../web/dist/index.html");
const PID_FILE = "fake-claude.pid";
// Con qué argumentos lanzó el panel al lanzador simulado (lo escribe fake-terminal.ts)
export const TERMINAL_ARGV_FILE = "terminal-argv.json";
const DASHBOARD_READY = /Panel de actividad en (http:\/\/\S+)/;
// Lo que se espera a que terminen solos los procesos de un entorno antes de matarlos a la fuerza
const LEFTOVER_GRACE_MS = 1500;
export const FILE_URL = "https://www.figma.com/design/SIMULADO/Archivo";
const OTHER_FILE_URL = "https://www.figma.com/design/OTRO/Otro";

export type FigmaState =
	| "up"
	| "down"
	| "wrongTab"
	| "notReady"
	| "noTab"
	| "notLoggedIn"
	| "viewOnly";

export type EnvironmentOptions = {
	readonly figma?: FigmaState;
	// Sin panel: solo el servidor MCP (escenarios del servidor)
	readonly dashboard?: boolean;
	// Cómo contesta el Claude simulado (null: no contesta). Es el de `startClaude` y el del lanzador
	readonly reply?: ReplyPolicy | null;
	readonly extraEnv?: Readonly<Record<string, string>>;
	// Las sesiones de `startClaude` son agentes de chat (como `make agent`: atienden el panel y solo consultan). Por
	// defecto son un `claude` normal, el que trabaja (scripts, lotes, capturas)
	readonly chatAgent?: boolean;
	// Lanzador que no crea ninguna sesión (el lanzamiento expira): `node --version make agent` sale sin hacer nada
	readonly launcher?: "fake-claude" | "does-nothing";
	// Con `figma: "noTab"`: dónde acaba la pestaña que abre el servidor (por defecto, en el archivo pedido)
	readonly openedTabLandsOn?: (requested: string) => string;
	// Raíz(ces) de scripts (por defecto, los escenarios)
	readonly scriptsRoot?: string;
	// Los proyectos que hay dados de alta al arrancar (por defecto, uno solo con el archivo del simulador; [] = ninguno)
	readonly projects?: readonly EntryDraft[];
	// El proyecto por defecto, con raíces propias fuera del repo: con él se puede lanzar el agente (el arnés lo exige)
	readonly agentProject?: boolean;
	// Prepara a mano la carpeta del entorno antes de arrancar (carpetas de proyecto, ficheros sueltos…). Va antes que la base y
	// los proyectos
	readonly prepareDir?: (dir: string) => void | Promise<void>;
	// Prepara a mano la base única antes de arrancar (en lugar de dar de alta `projects`): una base rota, filas a medida…
	readonly prepareDb?: (file: string) => void | Promise<void>;
	// El archivo de Figma «de mentira» que ve el simulador (por defecto, DEFAULT_WORLD)
	readonly world?: World;
};

export type Environment = {
	readonly dir: string;
	readonly dashboardUrl: string;
	readonly simulator: FigmaSimulator | null;
	readonly fileUrl: string;
	// Los proyectos dados de alta al arrancar, con el id que les dio la base
	readonly projects: readonly RegistryEntry[];
	readonly env: Readonly<Record<string, string>>;
	// El `claude` falso que arranca `make agent` (agent-run.ts) cuando el panel lanza el agente
	readonly fakeClaude: FakeClaude;
	startClaude(options?: {
		reply?: ReplyPolicy | null;
	}): Promise<FakeClaudeCode>;
	api<T>(path: string): Promise<T>;
	// Lectura directa de la base (solo consulta) para comprobar las filas
	rows<T>(sql: string): T[];
	// Escritura directa en la base (siembra de datos y mensajes inyectados que nadie debería poder escribir)
	exec(sql: string): void;
	readonly dbPath: string;
	// Lo que el panel ha escrito en stdout y stderr hasta ahora (avisos de arranque)
	dashboardOutput(): string;
	// Para el panel con esa señal (SIGTERM: cierre normal; SIGKILL: muere de golpe) y espera a que termine
	killDashboard(signal: NodeJS.Signals): Promise<void>;
	// Vuelve a arrancar el panel en el mismo puerto (un reinicio)
	restartDashboard(): Promise<void>;
	stop(): Promise<void>;
};

const live = new Set<number>();
process.on("exit", () => {
	for (const pid of live) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// ya había terminado
		}
	}
});

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// Se resuelve cuando el proceso ha terminado (enseguida si ya lo había hecho)
const exited = (child: ChildProcess): Promise<void> =>
	new Promise((resolve) => {
		if (child.exitCode !== null || child.signalCode !== null) resolve();
		else child.once("exit", () => resolve());
	});

const kill = (pid: number, signal: NodeJS.Signals): void => {
	try {
		process.kill(pid, signal);
	} catch {
		// ya había terminado
	}
};

// Una sesión de agente de chat (`chatAgent`) trabaja con UN proyecto: como `make agent`, la sesión simulada lleva
// FCC_PROJECTS=<id> si hay un solo proyecto al arrancar. Con ninguno o varios, y si el test no fija el alcance, es un
// `claude` normal (sin la marca): así se prueban «No hay ningún proyecto» y «elige uno». Una sesión normal no se toca
function sessionScope(
	env: Readonly<Record<string, string>>,
	projects: readonly RegistryEntry[],
): Record<string, string> {
	if (env["FCC_PROJECTS"] !== undefined || env["FCC_CHAT_AGENT"] !== "1")
		return {};
	const [only, ...rest] = projects;
	return only !== undefined && rest.length === 0
		? { FCC_PROJECTS: only.id }
		: { FCC_CHAT_AGENT: "0" };
}

export async function startEnvironment(
	options: EnvironmentOptions = {},
): Promise<Environment> {
	const wantsDashboard = options.dashboard ?? true;
	if (wantsDashboard && !existsSync(WEB_INDEX)) {
		throw new Error(
			"Falta web/dist: ejecuta `make build-web` antes de los E2E con panel.",
		);
	}
	if (/\s/.test(FAKE_TERMINAL)) {
		throw new Error(
			"La ruta del lanzador simulado no puede llevar espacios (FCC_AGENT_TERMINAL se parte por espacios)",
		);
	}
	const figma = options.figma ?? "up";
	const dir = await mkdtemp(join(tmpdir(), "figma-e2e-"));
	const simulator =
		figma === "down"
			? null
			: await startFigmaSimulator({
					...(options.world !== undefined && { world: options.world }),
					tabUrl:
						figma === "wrongTab" ? OTHER_FILE_URL : `${FILE_URL}?node-id=1`,
					...(figma === "notReady" ? { ready: false } : {}),
					// «wrongTab»: el archivo del proyecto no está abierto y la pestaña que abre el servidor acaba en otro
					...(figma === "wrongTab"
						? {
								openedTabLandsOn: () => OTHER_FILE_URL,
							}
						: {}),
					...(figma === "noTab"
						? {
								noTab: true,
								...(options.openedTabLandsOn !== undefined && {
									openedTabLandsOn: options.openedTabLandsOn,
								}),
							}
						: {}),
					...(figma === "notLoggedIn"
						? { ready: false, notReadyBecause: "notLoggedIn" as const }
						: {}),
					...(figma === "viewOnly"
						? { ready: false, notReadyBecause: "viewOnly" as const }
						: {}),
				});
	// Con Chrome caído, un puerto en el que no escucha nadie
	const cdpPort = simulator?.port ?? (await freePort());
	if (options.prepareDir !== undefined) await options.prepareDir(dir);
	// Los proyectos salen de la base única; un test puede prepararla a mano
	const figmaDb = join(dir, FIGMA_DB_FILE);
	let projects: readonly RegistryEntry[] = [];
	if (options.prepareDb !== undefined) {
		await options.prepareDb(figmaDb);
	} else {
		if (options.agentProject === true) {
			for (const d of Object.values(agentProjectDirs(dir)))
				mkdirSync(d, { recursive: true });
		}
		projects = await addProjects(
			figmaDb,
			join(dir, "salida"),
			options.projects ??
				(options.agentProject === true
					? [agentProject(dir, FILE_URL)]
					: [e2eProject(dir, FILE_URL)]),
		);
	}
	const dashboardPort = await freePort();
	const reply = options.reply === undefined ? DEFAULT_REPLY : options.reply;
	// La carpeta temporal de los procesos del entorno: las carpetas de lanzamiento del agente caen aquí, no en /tmp
	const tmp = join(dir, "tmp");
	mkdirSync(tmp, { recursive: true });
	const baseEnv: Record<string, string> = {
		...getDefaultEnvironment(),
		...testEnv({
			dir,
			cdpPort,
			scriptsRoot: options.scriptsRoot ?? SCRIPTS_DIR,
			dashboardPort,
			agentTerminal:
				options.launcher === "does-nothing"
					? `${process.execPath} --version`
					: `${process.execPath} ${FAKE_TERMINAL}`,
			extra: {
				FAKE_CLAUDE_PID_FILE: join(dir, PID_FILE),
				FAKE_TERMINAL_ARGV_FILE: join(dir, TERMINAL_ARGV_FILE),
				FAKE_CLAUDE_REPLY_DELAY_MS: String(reply?.delayMs ?? 0),
				...(options.chatAgent === true && { FCC_CHAT_AGENT: "1" }),
				...options.extraEnv,
			},
		}),
		TMPDIR: tmp,
	};
	// `make agent` arranca el claude FALSO (en modo sesión, con este entorno como «.env» de su servidor MCP), nunca el real
	const fakeClaude = installFakeClaude(join(dir, "falso"), {
		mode: "session",
		sessionEnv: baseEnv,
	});
	const env: Record<string, string> = {
		...baseEnv,
		PATH: `${fakeClaude.bin}${delimiter}${baseEnv["PATH"] ?? ""}`,
		FCC_CLAUDE_BIN: fakeClaude.claudeBin,
	};

	const claudes: FakeClaudeCode[] = [];
	let dashboard: ChildProcess | null = null;
	let dashboardUrl = "";
	let dashboardText = "";
	const stop = async (): Promise<void> => {
		const problems: string[] = [];
		for (const c of claudes.splice(0)) {
			if (c.pid !== null) live.delete(c.pid);
			await c.close();
			problems.push(...c.violations);
		}
		// Si el panel lanzó una sesión, el lanzador deja su pid nada más crearla: se espera a verlo para no dejarla huérfana
		if (existsSync(join(dir, TERMINAL_ARGV_FILE))) {
			await until("el lanzador dejó el pid de la sesión", () =>
				existsSync(join(dir, PID_FILE)),
			).catch(() => {});
		}
		const sessionPid = existsSync(join(dir, PID_FILE))
			? Number(readFileSync(join(dir, PID_FILE), "utf8")) || null
			: null;
		// El lanzador simulado deja la cadena (make → agent-run.ts → claude falso → MCP) en su propio grupo: se para entero
		if (sessionPid !== null) kill(-sessionPid, "SIGTERM");
		if (dashboard?.pid !== undefined) {
			live.delete(dashboard.pid);
			const gone = exited(dashboard);
			dashboard.kill("SIGTERM");
			await gone;
		}
		// Un proceso que sigue cerrando su base escribiría en la carpeta mientras se borra (ENOTEMPTY)
		if (sessionPid !== null) {
			await until(
				"la sesión simulada ha terminado",
				() => !isAlive(sessionPid),
			);
		}
		try {
			await simulator?.close();
		} catch (e) {
			problems.push(e instanceof Error ? e.message : String(e));
		}
		await rm(dir, { recursive: true, force: true });
		// Último recurso: lo que siga vivo con este entorno se mata y el test falla (no puede quedar nada tras él)
		await until(
			"los procesos del entorno terminan",
			() => processesOf(dir).length === 0,
			LEFTOVER_GRACE_MS,
		).catch(() => {});
		for (const leftover of processesOf(dir)) {
			kill(leftover.pid, "SIGKILL");
			problems.push(
				`quedó vivo el proceso ${leftover.pid}: ${leftover.command}`,
			);
		}
		if (problems.length > 0) {
			throw new Error(
				`Un doble incumplió su contrato:\n${problems.join("\n")}`,
			);
		}
	};

	const launchDashboard = async (): Promise<void> => {
		const child = spawn(process.execPath, [DASHBOARD], {
			env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		dashboard = child;
		if (child.pid !== undefined) live.add(child.pid);
		let output = "";
		child.stdout.on("data", (d: Buffer) => {
			output += String(d);
			dashboardText = output;
		});
		child.stderr.on("data", (d: Buffer) => {
			output += String(d);
			dashboardText = output;
		});
		let exited: number | null = null;
		child.once("exit", (code) => {
			exited = code ?? -1;
		});
		await until("el panel arranca", () => {
			if (exited !== null)
				throw new Error(`el panel salió (${exited}): ${output}`);
			const match = DASHBOARD_READY.exec(output);
			if (match?.[1]) dashboardUrl = match[1];
			return match?.[1] !== undefined;
		});
	};

	try {
		if (wantsDashboard) await launchDashboard();
	} catch (e) {
		await stop().catch(() => {});
		throw e;
	}

	const dbPath = join(dir, FIGMA_DB_FILE);
	return {
		dir,
		dashboardUrl,
		simulator,
		fileUrl: FILE_URL,
		projects,
		env,
		fakeClaude,
		startClaude: async (opts = {}) => {
			const claude = await FakeClaudeCode.connect({
				main: MAIN,
				env: { ...env, ...sessionScope(env, projects) },
				reply: opts.reply === undefined ? reply : opts.reply,
			});
			claudes.push(claude);
			if (claude.pid !== null) live.add(claude.pid);
			return claude;
		},
		api: async <T>(path: string): Promise<T> => {
			const r = await fetch(`${dashboardUrl}${path}`);
			if (!r.ok) throw new Error(`${path} → ${r.status}`);
			return (await r.json()) as T;
		},
		rows: <T>(sql: string): T[] => {
			const db = openFigmaDatabase(dbPath, { queryOnly: true });
			try {
				return db.$client.prepare(sql).all() as T[];
			} finally {
				db.$client.close();
			}
		},
		exec: (sql) => {
			const db = openFigmaDatabase(dbPath);
			try {
				db.$client.exec(sql);
			} finally {
				db.$client.close();
			}
		},
		dbPath,
		dashboardOutput: () => dashboardText,
		killDashboard: async (signal) => {
			const child = dashboard;
			if (child === null) return;
			const gone = exited(child);
			child.kill(signal);
			await gone;
			if (child.pid !== undefined) live.delete(child.pid);
		},
		restartDashboard: () => launchDashboard(),
		stop,
	};
}

export { LOOPBACK, TIMING };
