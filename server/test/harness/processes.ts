// Procesos vivos que pertenecen a un entorno del arnés: todos llevan la carpeta temporal del entorno en su
// propio entorno (FAKE_CLAUDE_PID_FILE=<dir>/…). Solo Linux (/proc), como el resto del arnés de procesos.
import { readdirSync, readFileSync } from "node:fs";

export type HarnessProcess = { readonly pid: number; readonly command: string };

const readProc = (pid: string, file: string): string | null => {
	try {
		return readFileSync(`/proc/${pid}/${file}`, "utf8");
	} catch {
		return null;
	}
};

export function processesOf(dir: string): HarnessProcess[] {
	const mark = `FAKE_CLAUDE_PID_FILE=${dir}/`;
	const found: HarnessProcess[] = [];
	for (const pid of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
		if (Number(pid) === process.pid) continue;
		const environ = readProc(pid, "environ");
		if (environ === null || !environ.includes(mark)) continue;
		const command = (readProc(pid, "cmdline") ?? "")
			.split("\0")
			.join(" ")
			.trim();
		found.push({ pid: Number(pid), command });
	}
	return found;
}
