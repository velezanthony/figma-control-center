import { chooseProject } from "#application/choose-project.ts";
import type { ResolvedTenants } from "#application/resolve-tenants.ts";
import type { TenantConfig } from "#domain/config.ts";

export type ActiveProjectDeps<T> = {
	// Los proyectos que valen AHORA (el registro dentro del alcance): se pregunta en cada llamada
	readonly resolve: () => Promise<ResolvedTenants>;
	// Dónde se da de alta un proyecto (lo dice el error de uso cuando no hay ninguno)
	readonly panelUrl: string;
	readonly build: (tenant: TenantConfig) => Promise<T>;
	readonly dispose: (value: T) => void;
	// Sello barato y síncrono del registro (su fecha y tamaño): mientras no cambia y hay un proyecto servido, una llamada
	// no vuelve a leerlo. Sin sello, se lee en cada llamada
	readonly stamp?: () => string;
	// Se llama cuando cambia lo que el registro no pudo leer (no en cada llamada)
	readonly onProblems?: (problems: readonly string[]) => void;
	// Si la sesión no puede servir ningún proyecto (un agente de chat sin proyecto único, agent-scope.ts), el error de uso:
	// no se lee el registro ni se monta nada (tampoco se registra el chat)
	readonly refuse?: string | null;
};

export type ActiveState<T> =
	| { readonly kind: "ready"; readonly tenant: TenantConfig; readonly value: T }
	| { readonly kind: "unavailable"; readonly message: string };

export type ActiveProject<T> = {
	// Resuelve el proyecto vigente y lo deja montado; sin proyecto (o ambiguo), el error de uso que se le da a la herramienta
	resolve(): Promise<ActiveState<T>>;
	// Lo ya montado, sin consultar el registro (null si no hay proyecto)
	current(): T | null;
	close(): void;
};

type Mounted<T> = {
	readonly key: string;
	readonly value: Promise<T>;
	ready: T | null;
};

// El servidor MCP no decide el proyecto al arrancar: lo resuelve al usarlo, así que un proyecto dado de alta después se
// ve sin reiniciar. Hay como mucho UNA sesión montada (la del proyecto vigente); se vuelve a montar si su configuración
// cambia y se suelta si el proyecto desaparece o si pasa a haber varios sin elegir.
export function makeActiveProject<T>(
	deps: ActiveProjectDeps<T>,
): ActiveProject<T> {
	let mounted: Mounted<T> | null = null;
	let lastProblems = "";
	let served: {
		stamp: string;
		state: ActiveState<T> & { kind: "ready" };
	} | null = null;

	const release = (): void => {
		const entry = mounted;
		mounted = null;
		if (entry === null) return;
		// Ya montado se suelta en el acto; si aún se está montando, en cuanto termine
		if (entry.ready !== null) deps.dispose(entry.ready);
		else entry.value.then(deps.dispose, () => {});
	};

	return {
		async resolve() {
			if (deps.refuse != null)
				return { kind: "unavailable", message: deps.refuse };
			const stamp = deps.stamp?.() ?? null;
			if (stamp !== null && served?.stamp === stamp && mounted?.ready != null) {
				return served.state;
			}
			served = null;
			const resolved = await deps.resolve();
			const problems = resolved.problems.join("\n");
			if (problems !== lastProblems) {
				lastProblems = problems;
				deps.onProblems?.(resolved.problems);
			}
			const choice = chooseProject(
				resolved.tenants,
				deps.panelUrl,
				resolved.problems,
			);
			if (choice.kind !== "one") {
				release();
				return { kind: "unavailable", message: choice.message };
			}
			const tenant = choice.tenant;
			const key = JSON.stringify(tenant);
			if (mounted?.key !== key) {
				release();
				const entry: Mounted<T> = {
					key,
					value: deps.build(tenant),
					ready: null,
				};
				entry.value.then(
					(value) => {
						if (mounted === entry) entry.ready = value;
					},
					() => {
						// Un montaje fallido no se queda: la siguiente llamada lo reintenta
						if (mounted === entry) mounted = null;
					},
				);
				mounted = entry;
			}
			const entry = mounted;
			try {
				const value = await entry.value;
				entry.ready = value;
				const state = { kind: "ready", tenant, value } as const;
				if (stamp !== null) served = { stamp, state };
				return state;
			} catch (e) {
				return {
					kind: "unavailable",
					message: `No se pudo abrir el proyecto «${tenant.id}»: ${(e as Error).message}`,
				};
			}
		},
		current: () => mounted?.ready ?? null,
		close: release,
	};
}
