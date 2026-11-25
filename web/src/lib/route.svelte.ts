import { legacyGlossaryHash } from "#web/lib/help/view.ts";
import {
	canonicalHash,
	hrefOf,
	parseHash,
	type RouteName,
} from "#web/lib/route.ts";

// Un marcador con la ruta antigua (o al glosario que estaba en Inicio) se reescribe sin dejar otra entrada en el historial
function redirectLegacy(): void {
	const next =
		canonicalHash(location.hash) ?? legacyGlossaryHash(location.hash);
	if (next !== null) history.replaceState(null, "", next);
}

redirectLegacy();
const initial = parseHash(location.hash);

// Ruta y parámetros de estado de la pantalla actual, leídos del hash
export const routeState = $state<{ current: RouteName; search: string }>({
	current: initial.route,
	search: initial.search,
});

addEventListener("hashchange", () => {
	redirectLegacy();
	const next = parseHash(location.hash);
	routeState.current = next.route;
	routeState.search = next.search;
});

// replaceState no dispara hashchange y no llena el historial con cada tecla
export function replaceSearch(search: string): void {
	routeState.search = search;
	history.replaceState(null, "", hrefOf(routeState.current, search));
}
