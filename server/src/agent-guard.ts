// Guardián PreToolUse del agente lanzado desde el panel. Lo ejecuta Claude Code antes de cada
// herramienta de ficheros o del servidor: `node agent-guard.ts <carpeta del lanzamiento>`, con la llamada en JSON por
// stdin. Sale 0 si la deja pasar y 2 (motivo en stderr) si no. FALLA CERRADO: cualquier error propio sale con 2, porque
// una salida distinta de 0 y 2 deja pasar la llamada. No carga la configuración (ni el .env): solo su launch.json.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { readLaunchFile } from "#adapters/fs/fs-agent-launch.ts";
import {
	pathProblem,
	pathsOfCall,
	toolProblem,
	UNKNOWN_TOOL,
} from "#domain/agent-guard-rules.ts";

const ALLOW = 0;
const DENY = 2;
const STDIN = 0;

const deny = (reason: string): never => {
	process.stderr.write(`agente del panel: ${reason}\n`);
	process.exit(DENY);
};
const failClosed = (reason: string): never =>
	deny(`el guardián falla cerrado: ${reason}`);
process.on("uncaughtException", (e) => failClosed(e.message));

// realpath de una ruta que quizá aún no existe (un Write nuevo): la del antepasado que sí existe, más el resto
function realpathLoose(path: string): string {
	let existing = path;
	const rest: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		rest.unshift(basename(existing));
		existing = parent;
	}
	return join(realpathSync(existing), ...rest);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

// null si la llamada pasa; si no, el motivo. Lanza ante un fallo propio (falla cerrado)
function verdict(dir: string | undefined, stdin: string): string | null {
	if (dir === undefined) throw new Error("falta la carpeta del lanzamiento");
	const launch = readLaunchFile(dir);
	if (!launch.ok) throw new Error(launch.error);
	let call: unknown;
	try {
		call = JSON.parse(stdin);
	} catch {
		throw new Error("la llamada no es JSON");
	}
	if (
		!isRecord(call) ||
		typeof call["tool_name"] !== "string" ||
		!isRecord(call["tool_input"])
	) {
		throw new Error("la llamada no trae tool_name y tool_input");
	}
	const refused = toolProblem(call["tool_name"]);
	if (refused !== null) return refused;
	const given = call["cwd"];
	const cwd =
		typeof given === "string" && isAbsolute(given) ? given : launch.value.cwd;
	const refs = pathsOfCall(call["tool_name"], call["tool_input"]);
	if (!refs.ok) {
		if (refs.error.startsWith(UNKNOWN_TOOL)) return refs.error;
		throw new Error(refs.error);
	}
	const rules = launch.value.guard;
	for (const ref of refs.value) {
		const path = resolve(ref.base === "repo" ? rules.repoRoot : cwd, ref.path);
		const problem = pathProblem(path, realpathLoose(path), rules);
		if (problem !== null) return problem;
	}
	return null;
}

const reason = (() => {
	try {
		return verdict(process.argv[2], readFileSync(STDIN, "utf8"));
	} catch (e) {
		return failClosed((e as Error).message);
	}
})();
if (reason !== null) deny(reason);
process.exit(ALLOW);
