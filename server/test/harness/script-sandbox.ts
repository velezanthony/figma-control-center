// Arnés de los tests que ejecutan spikes/m0/*.sh: repo y HOME temporales, `google-chrome`, `pkill` y `pgrep` FALSOS
// delante del PATH (apuntan su llamada en un fichero y salen: ninguno lanza ni mata nada), un puerto libre (nunca el
// 9222) y el modo de prueba por defecto. Un test que quiera el camino «real» pasa `dryRun: false` y sigue usando los falsos.
import { type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { REPO_ROOT } from "#adapters/config/schema.ts";
import { freePort } from "./wait.ts";

// El puerto del Chrome de depuración del dueño: ningún test lo usa
export const OWNER_DEBUG_PORT = 9222;

const FAKE_BINARIES = [
	"google-chrome",
	"google-chrome-stable",
	"chromium",
	"chromium-browser",
] as const;

const FAKE_CHROME = `#!/usr/bin/env bash
if [[ "\${1:-}" == "--version" ]]; then echo "Google Chrome 155.0.0.0"; exit 0; fi
{ printf 'google-chrome'; printf '\\t%s' "$@"; printf '\\n'; } >> "$FAKE_LOG"
# serve: se queda contestando en el puerto con los argumentos que recibió (como un Chrome de verdad);
# serve-other: contesta en el puerto pero su orden no lleva ni el perfil ni los argumentos de Chrome
case "\${FAKE_CHROME_MODE:-}" in
  serve) exec "$FAKE_NODE" "$FAKE_DIR/server.js" "$FIGMA_CDP_PORT" "$@" ;;
  serve-other) exec "$FAKE_NODE" "$FAKE_DIR/server.js" "$FIGMA_CDP_PORT" ;;
esac
exit 0
`;

// pkill no encuentra nada (sale 1) y pgrep imprime lo que el test haya dejado en pgrep.out
const FAKE_PKILL = `#!/usr/bin/env bash
{ printf 'pkill'; printf '\\t%s' "$@"; printf '\\n'; } >> "$FAKE_LOG"
exit 1
`;
const FAKE_PGREP = `#!/usr/bin/env bash
{ printf 'pgrep'; printf '\\t%s' "$@"; printf '\\n'; } >> "$FAKE_LOG"
if [[ -s "$FAKE_DIR/pgrep.out" ]]; then cat "$FAKE_DIR/pgrep.out"; exit 0; fi
exit 1
`;

export type FakeCall = { readonly tool: string; readonly args: string[] };

export type RunOptions = {
	readonly env?: Readonly<Record<string, string>>;
	// true por defecto: los scripts imprimen sus argumentos en vez de lanzar. false = camino real, con los falsos
	readonly dryRun?: boolean;
};

export type ScriptSandbox = {
	readonly root: string;
	readonly home: string;
	readonly port: number;
	run(
		cmd: string,
		args: readonly string[],
		options?: RunOptions,
	): SpawnSyncReturns<string>;
	writeEnv(text: string): void;
	// Lo que los falsos apuntaron: una entrada por llamada, en orden
	calls(): FakeCall[];
	// Lo que imprimirá el pgrep falso
	setPgrepOutput(text: string): void;
	cleanup(): void;
};

export async function createScriptSandbox(): Promise<ScriptSandbox> {
	const root = mkdtempSync(join(tmpdir(), "figma-root-"));
	const home = mkdtempSync(join(tmpdir(), "figma-home-"));
	const fakeDir = mkdtempSync(join(tmpdir(), "figma-fakes-"));
	const bin = join(fakeDir, "bin");
	const log = join(fakeDir, "calls.log");
	const port = await freePort();
	if (port === OWNER_DEBUG_PORT) throw new Error("el puerto libre es el 9222");

	mkdirSync(bin);
	writeFileSync(log, "");
	for (const name of FAKE_BINARIES)
		writeExecutable(join(bin, name), FAKE_CHROME);
	writeFileSync(join(fakeDir, "server.js"), DEBUG_PORT_SERVER_FILE);
	writeExecutable(join(bin, "pkill"), FAKE_PKILL);
	writeExecutable(join(bin, "pgrep"), FAKE_PGREP);

	mkdirSync(join(root, "spikes"));
	cpSync(join(REPO_ROOT, "spikes/m0"), join(root, "spikes/m0"), {
		recursive: true,
	});
	cpSync(join(REPO_ROOT, "Makefile"), join(root, "Makefile"));

	return {
		root,
		home,
		port,
		run(cmd, args, options = {}) {
			const env: Record<string, string> = {
				PATH: `${bin}${delimiter}${process.env["PATH"] ?? ""}`,
				HOME: home,
				FAKE_LOG: log,
				FAKE_DIR: fakeDir,
				FAKE_NODE: process.execPath,
				FIGMA_CDP_PORT: String(port),
				...(options.dryRun !== false && { FCC_CHROME_DRY_RUN: "1" }),
				...options.env,
			};
			// Sin modo de prueba el script lanzaría Chrome (a los falsos): solo en el puerto libre
			if (options.dryRun === false && env["FIGMA_CDP_PORT"] !== String(port)) {
				throw new Error("el camino real solo se prueba en el puerto libre");
			}
			return spawnSync(cmd, args, { cwd: root, env, encoding: "utf8" });
		},
		writeEnv: (text) => writeFileSync(join(root, ".env"), text),
		calls: () =>
			readFileSync(log, "utf8")
				.split("\n")
				.filter((line) => line !== "")
				.map((line) => {
					const [tool = "", ...args] = line.split("\t");
					return { tool, args };
				}),
		setPgrepOutput: (text) => writeFileSync(join(fakeDir, "pgrep.out"), text),
		cleanup() {
			// Un falso en modo `serve` sigue vivo a propósito: se mata lo que cuelga de los directorios del arnés
			for (const dir of [home, fakeDir]) killProcessesMentioning(dir);
			for (const dir of [root, home, fakeDir]) {
				rmSync(dir, { recursive: true, force: true });
				if (existsSync(dir)) throw new Error(`no se borró ${dir}`);
			}
		},
	};
}

function writeExecutable(path: string, text: string): void {
	writeFileSync(path, text);
	chmodSync(path, 0o755);
}

// Procesos vivos cuya orden menciona alguno de los directorios temporales del arnés (no debe quedar ninguno)
export function liveProcessesMentioning(...fragments: string[]): string[] {
	const out = spawnSync("pgrep", ["-af", "figma-(root|home|fakes)-"], {
		encoding: "utf8",
	}).stdout;
	return out
		.split("\n")
		.filter((line) => fragments.some((f) => line.includes(f)));
}

// Alguien que contesta en /json/version del puerto libre (el falso no abre nada), en OTRO proceso: los scripts se
// ejecutan con spawnSync y bloquearían un servidor del propio test. Su orden lleva `--remote-debugging-port` y, si se
// pide, `--user-data-dir`, como un Chrome de verdad. Devuelve su pid y cómo pararlo.
const DEBUG_PORT_SERVER_FILE = `require("node:http").createServer((_req, res) => res.end("{}"))
  .listen(Number(process.argv[2]), "127.0.0.1");
`;

function killProcessesMentioning(fragment: string): void {
	const found = spawnSync("pgrep", ["-f", "--", fragment], {
		encoding: "utf8",
	}).stdout;
	for (const pid of found.split("\n").filter(Boolean)) {
		try {
			process.kill(Number(pid), "SIGKILL");
		} catch {
			// ya había terminado
		}
	}
}

const DEBUG_PORT_SERVER = `
const port = Number(process.argv[1]);
// Chrome reescribe su título: /proc/<pid>/cmdline llega como una sola cadena con espacios
if (process.env.REWRITE_TITLE) process.title = "chrome " + process.argv.slice(2).join(" ");
require("node:http").createServer((_req, res) => res.end("{}"))
  .listen(port, "127.0.0.1", () => console.log("listo"));
`;

export async function serveDebugPort(
	port: number,
	userDataDir?: string,
	options: { readonly rewriteTitle?: boolean } = {},
): Promise<{ readonly pid: number; stop(): Promise<void> }> {
	if (port === OWNER_DEBUG_PORT) {
		throw new Error("el puerto del dueño no se usa en tests");
	}
	const child = spawn(
		process.execPath,
		[
			"-e",
			DEBUG_PORT_SERVER,
			String(port),
			`--remote-debugging-port=${port}`,
			...(userDataDir === undefined ? [] : [`--user-data-dir=${userDataDir}`]),
		],
		{
			stdio: ["ignore", "pipe", "inherit"],
			env: {
				...process.env,
				...(options.rewriteTitle === true && { REWRITE_TITLE: "1" }),
			},
		},
	);
	await new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.stdout.once("data", () => resolve());
	});
	const pid = child.pid;
	if (pid === undefined) throw new Error("no arrancó el servidor del puerto");
	return {
		pid,
		stop: () =>
			new Promise<void>((done) => {
				child.once("exit", () => done());
				child.kill("SIGKILL");
			}),
	};
}
