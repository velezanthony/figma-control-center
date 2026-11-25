// Proceso hijo de las pruebas del lock entre procesos: un «MCP» mínimo que solo habla del lock de lote. Lee órdenes
// por stdin (una por línea) y contesta una línea por orden, así el test sincroniza sin esperas.
//   try <urlDelArchivo> <jobId>            → OK | BUSY <pidDelOtro|?>
//   try-at <epochMs> <urlDelArchivo> <jobId> → lo mismo, esperando a esa hora (salida simultánea de varios procesos)
//   active <urlDelArchivo>                  → NONE | <jobId> <pid del otro|own>
//   release <urlDelArchivo> <jobId>         → OK
//   release-all                             → OK
//   pid                                     → su pid
// Uso: node lock-process.ts <carpetaDeLocks>
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { toJobId } from "#domain/job.ts";
import { createFsTabLocks } from "../fs-build-lock.ts";

const [dir] = process.argv.slice(2);
if (dir === undefined) {
	console.error("uso: lock-process.ts <carpetaDeLocks>");
	process.exit(2);
}

// kill(pid, 0) solo comprueba que el proceso existe (en producción lo inyecta main.ts con is-process-alive.ts)
const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
};

const locks = createFsTabLocks({
	dir,
	pid: process.pid,
	isAlive,
});

async function handle(line: string): Promise<string> {
	const [command, ...args] = line.trim().split(" ");
	switch (command) {
		case "pid":
			return String(process.pid);
		case "try-at": {
			const [at, url, job] = args;
			await sleep(Math.max(0, Number(at) - Date.now()));
			return handle(`try ${url} ${job}`);
		}
		case "try": {
			const [url, job] = args as [string, string];
			const lock = locks.forUrl(url);
			if (lock.acquire(toJobId(job))) return "OK";
			return `BUSY ${lock.foreignPid?.() ?? "?"}`;
		}
		case "active": {
			const [url] = args as [string];
			const lock = locks.forUrl(url);
			const id = lock.active();
			return id === undefined
				? "NONE"
				: `${id} ${lock.foreignPid?.() ?? "own"}`;
		}
		case "release": {
			const [url, job] = args as [string, string];
			locks.forUrl(url).release(toJobId(job));
			return "OK";
		}
		case "release-all":
			locks.releaseAll();
			return "OK";
		default:
			return `ERROR orden desconocida: ${line}`;
	}
}

const rl = createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on("line", (line) => {
	chain = chain.then(async () => {
		process.stdout.write(`${await handle(line)}\n`);
	});
});
rl.on("close", () => process.exit(0));
