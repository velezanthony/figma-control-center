// El lanzador del agente (agent-run.ts, lo que ejecuta `make agent`) con el `claude` FALSO: nunca un Claude Code real.
import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { REPO_ROOT } from "#adapters/config/schema.ts";
import { launchIdOfDir } from "#domain/agent-watch.ts";
import { LOOPBACK, testEnv } from "../test/harness/env.ts";
import { installFakeClaude } from "../test/harness/fake-claude-bin.ts";
import { type FakePanel, startFakePanel } from "../test/harness/fake-panel.ts";
import { addProjects } from "../test/harness/projects.ts";
import { freePort, until } from "../test/harness/wait.ts";

const AGENT_RUN = join(import.meta.dirname, "agent-run.ts");
const FILE_URL = "https://www.figma.com/design/AAA/A";
// Lo que añade un shell al ejecutar el guion del falso: no viene de quien lanza
const SHELL_ADDED = ["PWD", "SHLVL", "_", "OLDPWD"];
// Margen y reintento de la vigilancia en las pruebas: cortos, para no esperar 10 s
const GRACE_MS = 600;
const RETRY_MS = 50;
// Lo que espera agent-run.ts a que claude salga tras SIGTERM antes del SIGKILL (SIGNAL_GRACE_MS)
const SIGNAL_GRACE_MS = 5000;

let base: string;
let tmp: string;
let code: string;
let scripts: string;
let output: string;
let fakeDir: string;
// El panel al que mira agent-run.ts: por defecto, un puerto libre donde no escucha nadie (nunca el panel del dueño)
let panelPort: number;
// Chrome no está: el servidor MCP de la sesión simulada mira un puerto libre
let cdpPort: number;

beforeEach(async () => {
	panelPort = await freePort();
	cdpPort = await freePort();
	base = realpathSync(mkdtempSync(join(tmpdir(), "figma-agent-run-")));
	tmp = join(base, "tmp");
	code = join(base, "a", "codigo");
	scripts = join(base, "a", "scripts");
	output = join(base, "salida-a");
	fakeDir = join(base, "falso");
	for (const d of [tmp, code, scripts, output, join(base, "home")])
		mkdirSync(d, { recursive: true });
	await addProjects(join(base, "figma.db"), join(base, "salida"), [
		{
			name: "A",
			projectDir: code,
			fileUrl: FILE_URL,
			scriptsRoots: [scripts],
			outputDir: output,
		},
	]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

type Fake = ReturnType<typeof installFakeClaude>;

// El entorno con el que el panel (o la terminal) arranca `make agent`: el de pruebas, más cosas que NO deben llegar a claude
const envFor = (fake: Fake | null, over: Record<string, string> = {}) => {
	const env: Record<string, string> = {
		PATH: `${fake?.bin ?? join(base, "sin-falso")}${delimiter}${process.env["PATH"] ?? ""}`,
		HOME: join(base, "home"),
		TMPDIR: tmp,
		LANG: "es_ES.UTF-8",
		FCC_DB: join(base, "figma.db"),
		FCC_OUTPUT_DIR: join(base, "salida"),
		FCC_LOCK_DIR: join(base, "locks"),
		FCC_SCRIPTS_ROOT: join(base, "scripts-maquina"),
		FCC_TEST_HARNESS: "1",
		FCC_DASHBOARD_HOST: LOOPBACK,
		FCC_DASHBOARD_PORT: String(panelPort),
		FCC_AGENT_PANEL_GRACE_MS: String(GRACE_MS),
		FCC_AGENT_WATCH_RETRY_MS: String(RETRY_MS),
		FCC_SECRETO_DEL_PANEL: "no-debe-llegar",
		...over,
	};
	if (fake !== null) env["FCC_CLAUDE_BIN"] = fake.claudeBin;
	return env;
};

const runSync = (args: string[], env: Record<string, string>) =>
	spawnSync(process.execPath, [AGENT_RUN, ...args], {
		env,
		encoding: "utf8",
		cwd: REPO_ROOT,
	});

const launchDirs = () =>
	readdirSync(tmp).filter((n) => n.startsWith("figma-agent-"));

const start = (args: string[], env: Record<string, string>): ChildProcess =>
	spawn(process.execPath, [AGENT_RUN, ...args], {
		env,
		cwd: REPO_ROOT,
		stdio: "ignore",
	});

const exited = (child: ChildProcess) =>
	new Promise<number | null>((resolve) => {
		if (child.exitCode !== null) resolve(child.exitCode);
		else child.once("exit", (code) => resolve(code));
	});

describe("agent-run: test guarda (CA-8)", () => {
	it("en el entorno de pruebas, sin el claude falso, se niega a arrancar", () => {
		const fake = installFakeClaude(fakeDir);
		const env = envFor(fake);
		delete env["FCC_CLAUDE_BIN"];
		const r = runSync(["1"], env);
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /claude falso/);
		assert.equal(fake.record(), null);
		assert.deepEqual(launchDirs(), []);
	});
});

describe("agent-run: lo que recibe claude", () => {
	it("lanza a mano (sin AGENT_DIR): genera la carpeta, pasa los argumentos exactos y la borra al salir claude", () => {
		const fake = installFakeClaude(fakeDir);
		const r = runSync(["1"], envFor(fake));
		assert.equal(r.status, 0, r.stderr);
		const seen = fake.record();
		assert.ok(seen);
		const dir = dirname(seen.argv[2] as string);
		assert.match(dir, new RegExp(`^${tmp}/figma-agent-`));
		assert.deepEqual(seen.argv, [
			"--restricted",
			"--settings",
			join(dir, "settings.json"),
			"--mcp-config",
			join(dir, "mcp.json"),
			"--strict-mcp-config",
			"--tools",
			"Read,Glob,Grep",
			"--permission-mode",
			"default",
			"--add-dir",
			scripts,
			"--add-dir",
			output,
			"--disable-slash-commands",
			"--no-chrome",
			"--dangerously-load-development-channels",
			"server:figma-control-center",
		]);
		const launch = seen.files["launch.json"] as { projectId: string };
		assert.equal(launch.projectId, "1");
		assert.ok(seen.files["settings.json"]);
		assert.ok(seen.files["mcp.json"]);
		assert.deepEqual(launchDirs(), []);
	});

	it("arranca claude en la carpeta del proyecto", () => {
		const fake = installFakeClaude(fakeDir);
		runSync(["1"], envFor(fake));
		assert.equal(fake.record()?.cwd, code);
	});

	it("el entorno de claude es la lista blanca más la marca de agente y el proyecto: nada del panel ni del .env", () => {
		const fake = installFakeClaude(fakeDir);
		runSync(["1"], envFor(fake));
		const env = { ...fake.record()?.env };
		for (const key of SHELL_ADDED) delete env[key];
		assert.deepEqual(env, {
			PATH: envFor(fake)["PATH"],
			HOME: join(base, "home"),
			LANG: "es_ES.UTF-8",
			FCC_CHAT_AGENT: "1",
			FCC_PROJECTS: "1",
		});
	});

	it("con una versión de claude anterior a la mínima se niega y no deja carpeta", () => {
		const fake = installFakeClaude(fakeDir, { version: "2.1.247" });
		const r = runSync(["1"], envFor(fake));
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /2\.1\.247/);
		assert.match(r.stderr, /versión/);
		assert.equal(fake.record(), null);
		assert.deepEqual(launchDirs(), []);
	});

	it("sin proyecto se niega con «elige un proyecto»", () => {
		const fake = installFakeClaude(fakeDir);
		for (const args of [[], [""]]) {
			const r = runSync(args, envFor(fake));
			assert.notEqual(r.status, 0);
			assert.match(r.stderr, /elige un proyecto/);
		}
		assert.equal(fake.record(), null);
	});

	it("un proyecto que no está en el registro no arranca claude y lo dice", () => {
		const fake = installFakeClaude(fakeDir);
		const r = runSync(["9"], envFor(fake));
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /no existe/);
		assert.equal(fake.record(), null);
	});

	it("con AGENT_DIR usa la carpeta que preparó el panel y anota en ella su propio pid", async () => {
		const fake = installFakeClaude(fakeDir);
		// La carpeta la genera el mismo camino que a mano: un lanzamiento del falso «wait» la deja viva
		const holder = installFakeClaude(join(base, "holder"), { mode: "wait" });
		const panel = start(["1"], envFor(holder));
		await until(
			"el panel simulado deja su carpeta",
			() => holder.record() !== null,
		);
		const dir = dirname(holder.record()?.argv[2] as string);
		// Aquí no hay panel al que mirar: un margen largo evita que el cierre por «panel ido» (600 ms) cancele al falso antes de que arranque con la máquina cargada
		const child = start(
			["1", dir],
			envFor(fake, { FCC_AGENT_PANEL_GRACE_MS: "60000" }),
		);
		assert.equal(await exited(child), 0);
		const seen = fake.record();
		assert.ok(seen);
		assert.equal(seen.argv[2], join(dir, "settings.json"));
		assert.equal((seen.files["launch.json"] as { pid: number }).pid, child.pid);
		panel.kill("SIGTERM");
		await exited(panel);
	});

	it("una AGENT_DIR de otro proyecto se rechaza", async () => {
		const fake = installFakeClaude(fakeDir);
		const holder = installFakeClaude(join(base, "holder"), { mode: "wait" });
		const panel = start(["1"], envFor(holder));
		await until("hay carpeta", () => holder.record() !== null);
		const dir = dirname(holder.record()?.argv[2] as string);
		const r = runSync(["2", dir], envFor(fake));
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /otro proyecto/);
		assert.equal(fake.record(), null);
		panel.kill("SIGTERM");
		await exited(panel);
	});
});

describe("agent-run: limpieza (CA-7)", () => {
	for (const signal of ["SIGTERM", "SIGHUP"] as const) {
		it(`con ${signal} (cerrar la terminal) borra la carpeta y se lo pasa a claude`, async () => {
			const fake = installFakeClaude(fakeDir, { mode: "wait" });
			const child = start(["1"], envFor(fake));
			await until("claude arranca", () => fake.record() !== null);
			assert.equal(launchDirs().length, 1);
			child.kill(signal);
			await exited(child);
			assert.deepEqual(launchDirs(), []);
			await until("claude recibe la señal", () => fake.signal() === signal);
		});
	}
});

describe("make agent", () => {
	it("make agent PROJECT=<id> a mano genera la carpeta y lanza claude con el arnés", () => {
		const fake = installFakeClaude(fakeDir);
		const r = spawnSync(
			"make",
			["--no-print-directory", "agent", "PROJECT=1"],
			{
				cwd: REPO_ROOT,
				env: envFor(fake),
				encoding: "utf8",
			},
		);
		assert.equal(r.status, 0, r.stderr);
		assert.equal(fake.record()?.argv[0], "--restricted");
		assert.deepEqual(launchDirs(), []);
	});

	it("make agent sin PROJECT falla con «elige un proyecto»", () => {
		const fake = installFakeClaude(fakeDir);
		const r = spawnSync("make", ["--no-print-directory", "agent"], {
			cwd: REPO_ROOT,
			env: envFor(fake),
			encoding: "utf8",
		});
		assert.notEqual(r.status, 0);
		assert.match(r.stderr, /elige un proyecto/);
		assert.equal(fake.record(), null);
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// Vigilancia del panel: el panel FALSO en un puerto libre y el `claude` falso en modo sesión (con su
// servidor MCP de verdad), para comprobar también que nada pasa por el canal ni por las herramientas (CA-5)

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// La carpeta que deja el panel al lanzar: la prepara un agent-run.ts a mano que se mata de golpe (no la limpia)
async function panelLaunchDir(): Promise<string> {
	const holder = installFakeClaude(join(base, "holder"), { mode: "wait" });
	const runner = start(["1"], envFor(holder));
	await until("la carpeta está lista", () => holder.record() !== null);
	const seen = holder.record();
	assert.ok(seen);
	process.kill(seen.pid, "SIGKILL");
	runner.kill("SIGKILL");
	await exited(runner);
	return dirname(seen.argv[2] as string);
}

// El claude falso en modo sesión: su servidor MCP con el entorno de pruebas (Chrome en un puerto vacío)
const sessionFake = (options: { ignoreSigterm?: boolean } = {}) =>
	installFakeClaude(fakeDir, {
		mode: "session",
		...options,
		sessionEnv: {
			...testEnv({
				dir: base,
				cdpPort,
				scriptsRoot: join(base, "scripts-maquina"),
				dashboardPort: panelPort,
				agentTerminal: "true",
			}),
			PATH: process.env["PATH"] ?? "",
			HOME: join(base, "home"),
		},
	});

// agent-run.ts con lo que escribe en la terminal recogido
function startWatched(args: string[], env: Record<string, string>) {
	const child = spawn(process.execPath, [AGENT_RUN, ...args], {
		env,
		cwd: REPO_ROOT,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (d: Buffer) => {
		stdout += String(d);
	});
	child.stderr.on("data", (d: Buffer) => {
		stderr += String(d);
	});
	return { child, stdout: () => stdout, stderr: () => stderr };
}

const NO_TRAFFIC = { channelMessages: 0, toolCalls: ["figma_status"] };

describe("agent-run: vigila al panel", () => {
	let panel: FakePanel;
	beforeEach(async () => {
		panel = await startFakePanel();
		panelPort = panel.port;
	});
	afterEach(() => panel.stop());

	// Arranca con la carpeta del panel y espera a que la sesión simulada esté lista y la vigilancia abierta
	async function launched(fake: ReturnType<typeof installFakeClaude>) {
		const dir = await panelLaunchDir();
		const run = startWatched(["1", dir], envFor(fake));
		await until("la sesión simulada conecta", () => fake.traffic() !== null);
		await until("la vigilancia está abierta", () => panel.open() === 1);
		return { dir, run };
	}

	it("el panel muere y no vuelve: SIGTERM a claude, carpeta borrada, una línea al salir y fuera (CA-1, CA-5)", async () => {
		const fake = sessionFake();
		const { run } = await launched(fake);
		await panel.die();
		assert.equal(await exited(run.child), 0);
		assert.deepEqual(fake.signals(), ["SIGTERM"]);
		assert.deepEqual(launchDirs(), []);
		assert.equal(run.stdout(), "El panel se cerró: agente cerrado\n");
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
	});

	it("un claude que ignora SIGTERM recibe SIGKILL pasado el plazo y aun así se limpia todo (CA-1)", async () => {
		const fake = sessionFake({ ignoreSigterm: true });
		const { run } = await launched(fake);
		const pid = fake.record()?.pid as number;
		const diedAt = Date.now();
		await panel.die();
		await exited(run.child);
		assert.ok(Date.now() - diedAt >= SIGNAL_GRACE_MS, "esperó el plazo");
		assert.equal(isAlive(pid), false);
		assert.deepEqual(fake.signals(), ["SIGTERM"]);
		assert.deepEqual(launchDirs(), []);
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
	});

	it("el panel vuelve dentro del margen: claude sigue vivo y la vigilancia se restablece (CA-2, CA-5)", async () => {
		const fake = sessionFake();
		const { run } = await launched(fake);
		await panel.die();
		await panel.revive();
		await until("vuelve a vigilar", () => panel.open() === 1);
		// Pasado de largo el margen: nada se ha cerrado
		await new Promise((r) => setTimeout(r, GRACE_MS * 2));
		assert.equal(run.child.exitCode, null);
		assert.deepEqual(fake.signals(), []);
		assert.equal(launchDirs().length, 1);
		assert.equal(run.stdout(), "");
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
		run.child.kill("SIGTERM");
		await exited(run.child);
	});

	it("un panel que vuelve sin reconocer el lanzamiento no cuenta: al fin del margen se cierra", async () => {
		const fake = sessionFake();
		const { run } = await launched(fake);
		await panel.die();
		panel.known = new Set();
		await panel.revive();
		assert.equal(await exited(run.child), 0);
		assert.deepEqual(fake.signals(), ["SIGTERM"]);
		assert.deepEqual(launchDirs(), []);
	});

	it("el usuario cierra la consola durante el margen: un solo cierre, sin error y sin restos (CA-3, CA-5)", async () => {
		const fake = sessionFake();
		const { run } = await launched(fake);
		await panel.die();
		run.child.kill("SIGHUP");
		assert.equal(await exited(run.child), 0);
		assert.deepEqual(launchDirs(), []);
		// El fin del margen ya no hace nada: ni un SIGTERM detrás del SIGHUP
		await new Promise((r) => setTimeout(r, GRACE_MS * 2));
		assert.deepEqual(fake.signals(), ["SIGHUP"]);
		assert.equal(run.stderr(), "");
		assert.equal(run.stdout(), "");
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
	});

	it("el evento close del panel cierra a claude como si el panel se hubiera ido (CA-4, CA-5)", async () => {
		const fake = sessionFake();
		const { dir, run } = await launched(fake);
		assert.equal(panel.sendClose(launchIdOfDir(dir) as string), 1);
		assert.equal(await exited(run.child), 0);
		assert.deepEqual(fake.signals(), ["SIGTERM"]);
		assert.deepEqual(launchDirs(), []);
		assert.equal(run.stdout(), "Cerrado desde el panel: agente cerrado\n");
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
	});

	it("lanzado a mano (sin AGENT_DIR) no abre ninguna conexión con el panel (CA-6, CA-5)", async () => {
		const fake = sessionFake();
		const run = startWatched(["1"], envFor(fake));
		await until("la sesión simulada conecta", () => fake.traffic() !== null);
		await new Promise((r) => setTimeout(r, GRACE_MS));
		assert.deepEqual(panel.requests, []);
		run.child.kill("SIGTERM");
		await exited(run.child);
		assert.deepEqual(launchDirs(), []);
		assert.deepEqual(fake.traffic(), NO_TRAFFIC);
	});
});
