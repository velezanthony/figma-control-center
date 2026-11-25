import type { DashboardMode } from "#web/lib/contract.ts";
import { DASHBOARD_MODE, modeOf } from "#web/lib/dashboard-mode.ts";
import { SETTINGS_LIST_PATH } from "#web/lib/settings/endpoints.ts";

// El modo con el que arrancó el panel (FCC_DASHBOARD_MODE). Hasta que llega, producción: la galería no asoma
export const modeState = $state<{ current: DashboardMode }>({
	current: DASHBOARD_MODE.production,
});

export async function loadMode(): Promise<void> {
	try {
		const response = await fetch(SETTINGS_LIST_PATH);
		modeState.current = response.ok
			? modeOf(await response.json())
			: DASHBOARD_MODE.production;
	} catch {
		// sin respuesta: se queda en producción
	}
}
