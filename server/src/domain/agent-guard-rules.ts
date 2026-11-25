// Reglas del guardián PreToolUse del agente: qué rutas trae cada llamada y si una ruta ya
// resuelta (realpath) vale. Puro: resolver rutas es cosa de quien lo usa (server/src/agent-guard.ts).
import {
	AGENT_SERVER,
	CHAT_TOKENS_DIR,
	FILE_WRITE_TOOLS,
	type GuardRules,
	mcpTool as qualified,
	SECRET_NAMES,
} from "./agent-harness.ts";
import { err, ok, type Result } from "./result.ts";
import { CHAT_AGENT_DENIED_TOOLS, TOOL_NAME } from "./tool-names.ts";

// Contra qué se resuelve una ruta relativa: el cwd de Claude Code (herramientas de ficheros) o la raíz del repo
// (las herramientas del servidor resuelven así las relativas)
export type PathRef = { readonly path: string; readonly base: "cwd" | "repo" };

const MCP_PREFIX = `mcp__${AGENT_SERVER}__`;
const GLOB_CHARS = /[*?[{]/;
const KNOWN_MCP: readonly string[] = Object.values(TOOL_NAME);

type Input = Readonly<Record<string, unknown>>;

class Shape extends Error {}

// Prefijo del motivo cuando llega una herramienta sin reglas: se deniega, pero no es un fallo del guardián
export const UNKNOWN_TOOL = "el guardián no conoce la herramienta";

const optionalString = (input: Input, key: string): string | null => {
	const v = input[key];
	if (v === undefined) return null;
	if (typeof v !== "string") throw new Shape(`«${key}» no es texto`);
	return v;
};

const assetPaths = (input: Input): string[] => {
	const assets = input["assets"];
	if (assets === undefined) return [];
	if (typeof assets !== "object" || assets === null || Array.isArray(assets))
		throw new Shape("«assets» no es un objeto");
	return Object.values(assets).map((v) => {
		if (typeof v !== "string") throw new Shape("un asset no es una ruta");
		return v;
	});
};

// La parte fija de un patrón de Glob absoluto («/etc/**» → «/etc»)
const staticPrefix = (pattern: string): string => {
	const parts = pattern.split("/");
	const fixed = parts.findIndex((p) => GLOB_CHARS.test(p));
	const kept = fixed === -1 ? parts : parts.slice(0, fixed);
	return kept.join("/") || "/";
};

const fileTool = (tool: string, input: Input): PathRef[] => {
	const cwd = (path: string): PathRef => ({ path, base: "cwd" });
	switch (tool) {
		case "Read":
		case "Write":
		case "Edit": {
			const file = optionalString(input, "file_path");
			if (file === null) throw new Shape("falta «file_path»");
			return [cwd(file)];
		}
		case "NotebookEdit": {
			const file = optionalString(input, "notebook_path");
			if (file === null) throw new Shape("falta «notebook_path»");
			return [cwd(file)];
		}
		case "Glob": {
			const refs = [cwd(optionalString(input, "path") ?? ".")];
			const pattern = optionalString(input, "pattern");
			if (pattern?.startsWith("/") || pattern?.split("/").includes(".."))
				refs.push(cwd(staticPrefix(pattern)));
			return refs;
		}
		case "Grep":
			return [cwd(optionalString(input, "path") ?? ".")];
		default:
			throw new Shape(`${UNKNOWN_TOOL} «${tool}»`);
	}
};

const mcpTool = (name: string, input: Input): PathRef[] => {
	const repo = (path: string): PathRef => ({ path, base: "repo" });
	if (!KNOWN_MCP.includes(name)) throw new Shape(`${UNKNOWN_TOOL} «${name}»`);
	if (name === TOOL_NAME.runScript) {
		const file = optionalString(input, "file");
		return [...(file === null ? [] : [file]), ...assetPaths(input)].map(repo);
	}
	if (name === TOOL_NAME.build) {
		const manifest = optionalString(input, "manifest");
		const steps = input["steps"];
		if (steps !== undefined && !Array.isArray(steps))
			throw new Shape("«steps» no es una lista");
		const stepPaths = (steps ?? []).flatMap((step: unknown) => {
			if (typeof step !== "object" || step === null)
				throw new Shape("un paso no es un objeto");
			const s = step as Input;
			const file = optionalString(s, "file");
			return [...(file === null ? [] : [file]), ...assetPaths(s)];
		});
		return [...(manifest === null ? [] : [manifest]), ...stepPaths].map(repo);
	}
	return [];
};

const DENIED: readonly string[] = [
	...FILE_WRITE_TOOLS,
	...CHAT_AGENT_DENIED_TOOLS.map(qualified),
];

// Por qué no vale la herramienta (null si vale): repite los `deny` del arnés por si sus ajustes se saltan
export function toolProblem(tool: string): string | null {
	return DENIED.includes(tool)
		? `el agente del panel solo consulta: «${tool}» no está permitida; los cambios se hacen desde Claude Code en el proyecto`
		: null;
}

// Las rutas que toca una llamada; un error si la llamada no tiene la forma esperada (el guardián deniega)
export function pathsOfCall(
	tool: string,
	input: Input,
): Result<PathRef[], string> {
	try {
		return ok(
			tool.startsWith(MCP_PREFIX)
				? mcpTool(tool.slice(MCP_PREFIX.length), input)
				: fileTool(tool, input),
		);
	} catch (e) {
		if (e instanceof Shape) return err(e.message);
		throw e;
	}
}

const SECRET_PATTERNS = SECRET_NAMES.map(
	(name) =>
		new RegExp(`^${name.replaceAll(".", "\\.").replaceAll("*", ".*")}$`),
);
const baseName = (path: string): string => path.split("/").pop() ?? "";
export const isSecretName = (name: string): boolean =>
	SECRET_PATTERNS.some((p) => p.test(name));

const isWithin = (parent: string, child: string): boolean =>
	parent === "/" || child === parent || child.startsWith(`${parent}/`);

// Por qué no vale una ruta (null si vale). `given` es la ruta absoluta escrita; `real`, la misma tras realpath
export function pathProblem(
	given: string,
	real: string,
	rules: GuardRules,
): string | null {
	if (isSecretName(baseName(given)) || isSecretName(baseName(real)))
		return `«${given}» es un secreto`;
	if (
		real.split("/").includes(CHAT_TOKENS_DIR) ||
		rules.denied.some((d) => isWithin(d, real))
	)
		return `«${given}» es una ruta protegida`;
	if (!rules.roots.some((r) => isWithin(r, real)))
		return `«${given}» está fuera de las raíces del proyecto`;
	return null;
}
