import type { AgentLaunchError, AgentLaunched } from "#domain/agent.ts";
import { isProjectId } from "#domain/registry.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { AgentLaunches } from "./ports/agent-launches.ts";
import type { ProcessSpawner } from "./ports/process-spawner.ts";
import type { PreparedLaunch, PrepareError } from "./prepare-agent-launch.ts";

// Lo único que el panel sabe lanzar. No sale de la configuración ni de la petición
export const AGENT_COMMAND = Object.freeze(["make", "agent"] as const);

type Pending = {
	readonly at: number;
	// Sesiones con chat que ya existían al lanzar: la nueva es la que no está aquí
	readonly known: ReadonlySet<string>;
};

// Abre una terminal con `make agent PROJECT=<id> AGENT_DIR=<carpeta>`: antes genera la carpeta
// del lanzamiento con el arnés (y se niega con raíces peligrosas) y barre las de lanzamientos muertos. A la vez solo hay
// un lanzamiento en vuelo: hasta que la sesión nueva publica su token o vence el plazo, otro intento se rechaza
export function makeLaunchAgent(deps: {
	readonly spawner: ProcessSpawner;
	readonly terminal: readonly string[];
	readonly cwd: string;
	readonly activeSessionIds: () => readonly string[];
	readonly now: () => number;
	readonly timeoutMs: number;
	readonly newId: () => string;
	readonly prepare: (
		projectId: string,
		launchId: string,
	) => Promise<Result<PreparedLaunch, PrepareError>>;
	readonly launches: Pick<AgentLaunches, "remove" | "sweep">;
	readonly isAlive: (pid: number) => boolean;
}): (projectId: string) => Promise<Result<AgentLaunched, AgentLaunchError>> {
	let pending: Pending | null = null;

	const inFlight = (): boolean => {
		if (pending === null) return false;
		const arrived = deps
			.activeSessionIds()
			.some((id) => !pending?.known.has(id));
		return !arrived && deps.now() - pending.at < deps.timeoutMs;
	};

	return async (projectId) => {
		// Defensa en profundidad: el id va como argumento de `make` y solo con la forma de un id de proyecto
		if (!isProjectId(projectId)) {
			return err({
				type: "InvalidProject",
				message: "El proyecto no tiene un id válido.",
			});
		}
		if (inFlight()) {
			return err({
				type: "LaunchInProgress",
				message:
					"Ya hay un agente arrancando: espera a que aparezca su sesión o a que venza el plazo.",
			});
		}
		// Se anota antes de esperar: otra petición simultánea ya lo ve en vuelo
		const mine: Pending = {
			at: deps.now(),
			known: new Set(deps.activeSessionIds()),
		};
		pending = mine;
		const release = (): void => {
			if (pending === mine) pending = null;
		};
		deps.launches.sweep(deps.isAlive);
		const launchId = deps.newId();
		const prepared = await deps.prepare(projectId, launchId);
		if (!prepared.ok) {
			release();
			return prepared;
		}
		const { dir } = prepared.value;
		const launched = await deps.spawner.spawn(
			[
				...deps.terminal,
				...AGENT_COMMAND,
				`PROJECT=${projectId}`,
				`AGENT_DIR=${dir}`,
			],
			{ cwd: deps.cwd },
		);
		if (launched.ok) {
			return ok({
				launchId,
				startedAt: new Date(mine.at).toISOString(),
				timeoutMs: deps.timeoutMs,
			});
		}
		// Un lanzamiento que falló no ocupa el hueco ni deja su carpeta
		release();
		deps.launches.remove(dir);
		const [binary] = deps.terminal;
		return err(
			launched.error.type === "NotFound"
				? {
						type: "TerminalNotFound",
						message: `No se encontró la terminal configurada («${binary}»). Revisa FCC_AGENT_TERMINAL en .env.`,
					}
				: {
						type: "LaunchFailed",
						message: `No se pudo abrir la terminal: ${launched.error.message}`,
					},
		);
	};
}
