import { ROUTE_NAME, type RouteName } from "#web/lib/route.ts";

// Las pantallas que muestran datos de un proyecto: sin proyecto no tienen nada que enseñar
const NEEDS_PROJECT: ReadonlySet<RouteName> = new Set([
	ROUTE_NAME.activity,
	ROUTE_NAME.jobs,
	ROUTE_NAME.captures,
	ROUTE_NAME.attempts,
	ROUTE_NAME.chat,
]);

export const NEEDS_PROJECT_HINT = "Crea o elige un proyecto para ver esto";

export type ProjectGateState = {
	// La lista de proyectos ya llegó (o falló)
	readonly loaded: boolean;
	// La carga falló: no se sabe si hay proyectos, así que no se dice que no los hay
	readonly failed: boolean;
	readonly activeId: string | null;
};

// Una pantalla de datos queda bloqueada solo cuando se SABE que no hay proyecto activo
export function isRouteBlocked(
	route: RouteName,
	state: ProjectGateState,
): boolean {
	if (!NEEDS_PROJECT.has(route)) return false;
	return state.loaded && !state.failed && state.activeId === null;
}
