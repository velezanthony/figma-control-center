import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import type { ProjectScope, TenantConfig } from "#domain/config.ts";
import type { RegistryEntry } from "#domain/registry.ts";

// Resuelve los tenants a los que el servidor tiene acceso: los del registro, filtrados por el
// alcance (any o una lista de ids). El .env no crea ningún proyecto: el archivo de Figma es de cada proyecto (D-1).
// `resolveEntry` (una fila del registro → TenantConfig con sus defaults) se inyecta: la lógica de
// rutas vive en composición/esquema, no aquí, para que `application` no dependa de rutas.
export type ResolveTenantsDeps = {
	readonly registry: ProjectRegistry;
	readonly scope: ProjectScope;
	readonly resolveEntry: (entry: RegistryEntry) => TenantConfig;
};

export type ResolvedTenants = {
	readonly tenants: readonly TenantConfig[];
	// Lo que hay que avisar: el registro entero ilegible o filas ignoradas. Con el registro roto no hay proyectos, pero el
	// panel que lo arregla arranca igual
	readonly problems: readonly string[];
};

export async function resolveTenants(
	deps: ResolveTenantsDeps,
): Promise<ResolvedTenants> {
	const read = await deps.registry.read();
	const rows = read.ok ? read.value.entries : [];
	const problems = read.ok ? (read.value.problems ?? []) : [read.error.message];

	const byId = new Map<string, TenantConfig>();
	for (const entry of rows) {
		byId.set(entry.id, deps.resolveEntry(entry));
	}

	const all = [...byId.values()];
	const scope = deps.scope;
	const allowed =
		scope.kind === "any" ? all : all.filter((t) => scope.ids.includes(t.id));
	return { tenants: allowed, problems };
}
