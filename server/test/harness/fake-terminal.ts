// Lanzador simulado para FCC_AGENT_TERMINAL (sustituye a «gnome-terminal --»): el panel lo ejecuta con
// `make agent PROJECT=<id> AGENT_DIR=<carpeta>` como argumentos. En vez de abrir una ventana, ejecuta esa orden de
// verdad, desligada (su propio grupo de procesos) y sin terminal, y sale al instante como el cliente de una terminal real.
// La cadena entera es la de producción: make → agent-run.ts → `claude` (el FALSO del arnés, por FCC_CLAUDE_BIN) →
// servidor MCP.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

// Con FAKE_TERMINAL_ARGV_FILE, deja escrito con qué argumentos lo lanzó el panel (los de `make agent …`)
const argv = process.argv.slice(2);
const argvFile = process.env["FAKE_TERMINAL_ARGV_FILE"];
if (argvFile !== undefined) writeFileSync(argvFile, JSON.stringify(argv));

const [command, ...args] = argv;
if (command === undefined) process.exit(1);
const child = spawn(command, args, {
	detached: true,
	stdio: "ignore",
	env: process.env,
});
// El pid (el del grupo de la cadena) queda escrito ya: si el entorno se para antes, aún sabe a quién parar
const pidFile = process.env["FAKE_CLAUDE_PID_FILE"];
if (pidFile !== undefined && child.pid !== undefined) {
	writeFileSync(pidFile, String(child.pid));
}
child.unref();
