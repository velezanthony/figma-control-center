import {
	agentHarness,
	type CheckedRoot,
	type HarnessMachine,
	type LaunchFile,
} from "#domain/agent-harness.ts";
import type { TenantConfig } from "#domain/config.ts";
import type { RegistryEntry } from "#domain/registry.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { AgentLaunches, LaunchFiles } from "./ports/agent-launches.ts";
import type { ProjectRegistry } from "./ports/project-registry.ts";

export type PrepareError = {
	readonly type: "ProjectNotAvailable" | "UnsafeProjectPaths" | "LaunchFailed";
	readonly message: string;
};

export type PreparedLaunch = {
	readonly dir: string;
	readonly files: LaunchFiles;
};

// Lo de la máquina tal como lo da la configuración; aquí se resuelve con realpath (lo que no existe se queda igual)
export type PrepareMachine = Omit<
	HarnessMachine,
	"launchDir" | "otherProjects"
>;

// Genera la carpeta de un lanzamiento del agente: resuelve el proyecto y las raíces de todos
// (realpath), comprueba las rutas peligrosas y escribe settings.json, mcp.json y launch.json. Lo usan el panel
// (cada lanzamiento) y agent-run.ts cuando un desarrollador lanza `make agent PROJECT=<id>` a mano (D-6, D-9)
export function makePrepareAgentLaunch(deps: {
	readonly registry: ProjectRegistry;
	readonly resolveEntry: (entry: RegistryEntry) => TenantConfig;
	// realpath, o null si la ruta no existe
	readonly realpath: (path: string) => Promise<string | null>;
	readonly launches: AgentLaunches;
	readonly machine: PrepareMachine;
	// Quién vigila la carpeta al crearla (el panel o agent-run.ts)
	readonly pid: number;
}): (
	projectId: string,
	launchId: string,
) => Promise<Result<PreparedLaunch, PrepareError>> {
	const check = async (given: string): Promise<CheckedRoot> => ({
		given,
		real: await deps.realpath(given),
	});
	const resolved = async (path: string): Promise<string> =>
		(await deps.realpath(path)) ?? path;

	return async (projectId, launchId) => {
		const read = await deps.registry.read();
		if (!read.ok) {
			return err({ type: "ProjectNotAvailable", message: read.error.message });
		}
		const entries = read.value.entries;
		const entry = entries.find((e) => e.id === projectId);
		if (entry === undefined) {
			return err({
				type: "ProjectNotAvailable",
				message: `El proyecto ${projectId} no existe o no está disponible.`,
			});
		}
		const rootsOf = (e: RegistryEntry): string[] => {
			const t = deps.resolveEntry(e);
			return [e.projectDir, ...t.scriptsRoots, t.outputDir];
		};
		const tenant = deps.resolveEntry(entry);
		const m = deps.machine;
		const otherProjects = await Promise.all(
			entries
				.filter((e) => e.id !== projectId)
				.map(async (e) => ({
					id: e.id,
					roots: (await Promise.all(rootsOf(e).map(deps.realpath))).filter(
						(r): r is string => r !== null,
					),
				})),
		);
		const dir = deps.launches.pathFor(launchId);
		const harness = agentHarness(
			{
				id: projectId,
				projectDir: await check(entry.projectDir),
				scriptsRoots: await Promise.all(tenant.scriptsRoots.map(check)),
				outputDir: await check(tenant.outputDir),
			},
			{
				repoRoot: await resolved(m.repoRoot),
				home: await resolved(m.home),
				nodeBin: m.nodeBin,
				launchDir: dir,
				outputRoot: await resolved(m.outputRoot),
				dbPath: await resolved(m.dbPath),
				secretsFile: await resolved(m.secretsFile),
				defaultScriptsRoots: await Promise.all(
					m.defaultScriptsRoots.map(resolved),
				),
				otherProjects,
			},
		);
		if (!harness.ok) return harness;
		const h = harness.value;
		const launch: LaunchFile = {
			projectId,
			args: h.args,
			cwd: h.cwd,
			env: h.env,
			guard: h.guard,
			pid: deps.pid,
		};
		const files: LaunchFiles = {
			settings: h.settings,
			mcpConfig: h.mcpConfig,
			launch,
		};
		try {
			deps.launches.create(dir, files);
		} catch (e) {
			deps.launches.remove(dir);
			return err({
				type: "LaunchFailed",
				message: `No se pudo preparar la carpeta del lanzamiento: ${(e as Error).message}`,
			});
		}
		return ok({ dir, files });
	};
}
