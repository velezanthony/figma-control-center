import type { DashboardMode } from "#web/lib/contract.ts";
import { ROUTE_NAME, type RouteName } from "#web/lib/route.ts";

// Espejo de DASHBOARD_MODE (server/src/domain/settings.ts): la web solo importa tipos del contrato
export const DASHBOARD_MODE = {
	production: "production",
	development: "development",
} as const satisfies Record<DashboardMode, DashboardMode>;

// Pantallas que solo sirven para construir el panel: en producción no se ofrecen ni se abren
const DEVELOPMENT_ONLY: ReadonlySet<RouteName> = new Set([
	ROUTE_NAME.components,
]);

export const isRouteAvailable = (
	route: RouteName,
	mode: DashboardMode,
): boolean =>
	mode === DASHBOARD_MODE.development || !DEVELOPMENT_ONLY.has(route);

// Una pantalla que no existe en este modo cae en el inicio, como una ruta desconocida
export const routeIn = (route: RouteName, mode: DashboardMode): RouteName =>
	isRouteAvailable(route, mode) ? route : ROUTE_NAME.home;

// El modo que trae el listado de ajustes; si falta o no se entiende, producción (la galería no aparece por un fallo)
export function modeOf(body: unknown): DashboardMode {
	const mode =
		typeof body === "object" && body !== null
			? (body as Record<string, unknown>)["mode"]
			: undefined;
	return mode === DASHBOARD_MODE.development
		? DASHBOARD_MODE.development
		: DASHBOARD_MODE.production;
}
