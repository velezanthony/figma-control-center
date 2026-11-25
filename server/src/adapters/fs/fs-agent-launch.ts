// La carpeta de cada lanzamiento del agente (`<tmp>/figma-agent-<launchId>/`): settings.json,
// mcp.json y launch.json, solo del usuario. La escribe quien genera el arnés (el panel, o agent-run.ts a mano), la
// leen agent-run.ts y el guardián, y la borra agent-run.ts al salir `claude` (o el barrido si murió sin poder).
import {
	chmodSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type {
	AgentLaunches,
	LaunchFiles,
} from "#application/ports/agent-launches.ts";
import {
	LAUNCH_DIR_PREFIX,
	LAUNCH_FILE,
	type LaunchFile,
	MCP_CONFIG_FILE,
	SETTINGS_FILE,
} from "#domain/agent-harness.ts";
import { err, ok, type Result } from "#domain/result.ts";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
// Una carpeta sin launch.json legible puede estar creándose ahora mismo: solo se barre pasado este tiempo
const UNREADABLE_GRACE_MS = 60_000;

const absolute = z.string().startsWith("/");

export const LaunchFileSchema = z.strictObject({
	projectId: z.string().min(1),
	args: z.array(z.string()),
	cwd: absolute,
	env: z.record(z.string(), z.string()),
	guard: z.strictObject({
		repoRoot: absolute,
		roots: z.array(absolute).min(1),
		denied: z.array(absolute),
	}),
	pid: z.number().int().positive(),
});

// launch.json de una carpeta de lanzamiento, o por qué no se puede usar
export function readLaunchFile(dir: string): Result<LaunchFile, string> {
	let raw: string;
	try {
		raw = readFileSync(join(dir, LAUNCH_FILE), "utf8");
	} catch (e) {
		return err(`no se pudo leer ${LAUNCH_FILE}: ${(e as Error).message}`);
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return err(`${LAUNCH_FILE} no es JSON`);
	}
	const parsed = LaunchFileSchema.safeParse(json);
	return parsed.success
		? ok(parsed.data)
		: err(`${LAUNCH_FILE} no tiene la forma esperada: ${parsed.error.message}`);
}

function writePrivate(file: string, content: unknown): void {
	writeFileSync(file, `${JSON.stringify(content, null, "\t")}\n`, {
		mode: FILE_MODE,
	});
	chmodSync(file, FILE_MODE);
}

export class FsAgentLaunches implements AgentLaunches {
	readonly #parent: string;
	readonly #now: () => number;

	constructor(options: {
		readonly parent: string;
		readonly now?: () => number;
	}) {
		this.#parent = options.parent;
		this.#now = options.now ?? Date.now;
	}

	pathFor(launchId: string): string {
		return join(this.#parent, `${LAUNCH_DIR_PREFIX}${launchId}`);
	}

	create(dir: string, files: LaunchFiles): void {
		// Sin `recursive`: una carpeta que ya existe (de otro, o con otro contenido) es un error, no se reutiliza
		mkdirSync(dir, { mode: DIR_MODE });
		chmodSync(dir, DIR_MODE);
		writePrivate(join(dir, SETTINGS_FILE), files.settings);
		writePrivate(join(dir, MCP_CONFIG_FILE), files.mcpConfig);
		writePrivate(join(dir, LAUNCH_FILE), files.launch);
	}

	find(launchId: string): LaunchFile | null {
		const read = readLaunchFile(this.pathFor(launchId));
		return read.ok ? read.value : null;
	}

	setPid(dir: string, pid: number): void {
		const read = readLaunchFile(dir);
		if (!read.ok) throw new Error(read.error);
		writePrivate(join(dir, LAUNCH_FILE), { ...read.value, pid });
	}

	remove(dir: string): void {
		rmSync(dir, { recursive: true, force: true });
	}

	sweep(isAlive: (pid: number) => boolean): readonly string[] {
		let names: string[];
		try {
			names = readdirSync(this.#parent);
		} catch {
			return [];
		}
		const removed: string[] = [];
		for (const name of names.filter((n) => n.startsWith(LAUNCH_DIR_PREFIX))) {
			const dir = join(this.#parent, name);
			try {
				if (!statSync(dir).isDirectory()) continue;
				const read = readLaunchFile(dir);
				const orphan = read.ok
					? !isAlive(read.value.pid)
					: this.#now() - statSync(dir).mtimeMs > UNREADABLE_GRACE_MS;
				if (!orphan) continue;
				this.remove(dir);
				removed.push(dir);
			} catch {
				// otra carpeta que desaparece a la vez, o sin permisos: no es nuestra o ya no está
			}
		}
		return removed;
	}
}
