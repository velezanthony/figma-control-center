import type { TenantConfig } from "#domain/config.ts";

export type PanelTenantsDeps<T> = {
	// Los proyectos que valen AHORA (los del registro, dentro del alcance): se pregunta en cada petición
	readonly resolve: () => Promise<readonly TenantConfig[]>;
	readonly build: (config: TenantConfig) => Promise<T>;
	readonly dispose: (tenant: T) => void;
};

type Mounted<T> = { readonly key: string; readonly tenant: Promise<T> };

// El panel resuelve el proyecto al pedirlo, no al arrancar: un alta o un borrado desde «Proyectos» se nota sin
// reiniciar. Cada proyecto se monta una vez (también con peticiones simultáneas), se vuelve a montar si su
// configuración cambia y se libera cuando deja de existir
export function makePanelTenants<T>(
	deps: PanelTenantsDeps<T>,
): (projectId: string | null) => Promise<T | undefined> {
	const mounted = new Map<string, Mounted<T>>();

	const release = (id: string, entry: Mounted<T>): void => {
		mounted.delete(id);
		void entry.tenant.then(deps.dispose, () => {});
	};

	return async (projectId) => {
		const configs = await deps.resolve();
		const alive = new Set(configs.map((c) => c.id));
		for (const [id, entry] of mounted) {
			if (!alive.has(id)) release(id, entry);
		}

		// Sin id, el primero del registro
		const config =
			projectId === null ? configs[0] : configs.find((c) => c.id === projectId);
		if (config === undefined) return undefined;
		const wanted = config.id;

		const key = JSON.stringify(config);
		const current = mounted.get(wanted);
		if (current?.key === key) return current.tenant;
		if (current !== undefined) release(wanted, current);
		const entry: Mounted<T> = { key, tenant: deps.build(config) };
		mounted.set(wanted, entry);
		// Un montaje fallido no se queda cacheado: la siguiente petición lo reintenta
		entry.tenant.catch(() => {
			if (mounted.get(wanted) === entry) mounted.delete(wanted);
		});
		return entry.tenant;
	};
}
