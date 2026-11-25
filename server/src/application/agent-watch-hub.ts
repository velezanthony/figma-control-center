import type { CloseAgentError } from "#domain/agent.ts";
import { isLaunchId } from "#domain/agent-watch.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { AgentLaunches } from "./ports/agent-launches.ts";

// Una conexión de vigilancia abierta por agent-run.ts: el panel no manda nada por ella salvo,
// una vez, el evento `close` del botón «Cerrar agente»
export type WatchLink = { readonly sendClose: () => void };

const UNKNOWN: CloseAgentError = Object.freeze({
	type: "UnknownLaunch",
	message: "Ese lanzamiento del agente no existe o ya terminó.",
});

// Las conexiones de vigilancia de los agentes lanzados desde el panel. El panel reconoce un lanzamiento mientras su
// carpeta existe y su pid vive: tras un reinicio no hace falta memoria, la carpeta está en disco. El panel nunca mata
// procesos (D-3): cerrar es mandar `close` por la conexión, y el cierre lo hace agent-run.ts
export function makeAgentWatchHub(deps: {
	readonly launches: Pick<AgentLaunches, "find">;
	readonly isAlive: (pid: number) => boolean;
}) {
	const links = new Map<string, Set<WatchLink>>();

	const live = (launchId: string): { readonly projectId: string } | null => {
		if (!isLaunchId(launchId)) return null;
		const launch = deps.launches.find(launchId);
		return launch !== null && deps.isAlive(launch.pid) ? launch : null;
	};

	return {
		// Abre la vigilancia de un lanzamiento vivo; devuelve cómo soltarla, o null si el lanzamiento no se reconoce
		attach(launchId: string, link: WatchLink): (() => void) | null {
			if (live(launchId) === null) return null;
			const set = links.get(launchId) ?? new Set<WatchLink>();
			set.add(link);
			links.set(launchId, set);
			return () => {
				set.delete(link);
				if (set.size === 0 && links.get(launchId) === set)
					links.delete(launchId);
			};
		},
		// Un único `close` por cada conexión de ese lanzamiento; después ya no cuentan
		close(launchId: string): Result<void, CloseAgentError> {
			if (live(launchId) === null) return err(UNKNOWN);
			const set = links.get(launchId);
			if (set === undefined || set.size === 0) {
				return err({
					type: "AgentNotWatching",
					message:
						"El agente de este lanzamiento no está conectado al panel: ciérralo desde su terminal.",
				});
			}
			links.delete(launchId);
			for (const link of set) link.sendClose();
			return ok(undefined);
		},
		// Los lanzamientos vivos y conectados de un proyecto: los que el botón «Cerrar agente» puede cerrar
		watching(projectId: string): readonly string[] {
			return [...links.keys()].filter(
				(id) => live(id)?.projectId === projectId,
			);
		},
	};
}

export type AgentWatchHub = ReturnType<typeof makeAgentWatchHub>;
