import type { LaunchFile } from "#domain/agent-harness.ts";

// Lo que se escribe en la carpeta de un lanzamiento
export type LaunchFiles = {
	readonly settings: Readonly<Record<string, unknown>>;
	readonly mcpConfig: Readonly<Record<string, unknown>>;
	readonly launch: LaunchFile;
};

// Las carpetas de lanzamiento del agente (`<tmp>/figma-agent-<launchId>/`): solo del usuario,
// fuera de toda raíz de proyecto y del repo
export interface AgentLaunches {
	// Dónde iría la carpeta de un lanzamiento (sin crearla)
	pathFor(launchId: string): string;
	// Crea la carpeta (0700) con sus ficheros (0600)
	create(dir: string, files: LaunchFiles): void;
	// El launch.json de un lanzamiento, o null si su carpeta no existe o no se puede leer
	find(launchId: string): LaunchFile | null;
	// Anota en launch.json quién la vigila ahora
	setPid(dir: string, pid: number): void;
	remove(dir: string): void;
	// Borra las carpetas cuyo vigilante ya no vive (o sin launch.json legible); devuelve las borradas
	sweep(isAlive: (pid: number) => boolean): readonly string[];
}
