import type {
	AgentLaunches,
	LaunchFiles,
} from "#application/ports/agent-launches.ts";
import type { LaunchFile } from "#domain/agent-harness.ts";

// Doble de las carpetas de lanzamiento: un mapa carpeta → ficheros, y el registro de lo borrado
export class InMemoryAgentLaunches implements AgentLaunches {
	readonly dirs = new Map<string, LaunchFiles>();
	readonly removed: string[] = [];
	// Si se fija, create lanza este error (disco lleno, permisos)
	createFails: Error | null = null;

	pathFor(launchId: string): string {
		return `/tmp/figma-agent-${launchId}`;
	}

	create(dir: string, files: LaunchFiles): void {
		if (this.createFails !== null) throw this.createFails;
		this.dirs.set(dir, files);
	}

	find(launchId: string): LaunchFile | null {
		return this.dirs.get(this.pathFor(launchId))?.launch ?? null;
	}

	setPid(dir: string, pid: number): void {
		const files = this.dirs.get(dir);
		if (files !== undefined)
			this.dirs.set(dir, { ...files, launch: { ...files.launch, pid } });
	}

	remove(dir: string): void {
		this.dirs.delete(dir);
		this.removed.push(dir);
	}

	sweep(isAlive: (pid: number) => boolean): readonly string[] {
		const dead = [...this.dirs].filter(([, f]) => !isAlive(f.launch.pid));
		for (const [dir] of dead) this.remove(dir);
		return dead.map(([dir]) => dir);
	}
}
