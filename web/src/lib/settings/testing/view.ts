import type { SettingView } from "#web/lib/contract.ts";

// Un ajuste de ejemplo para los tests: FCC_HISTORY_MAX_ROWS por defecto (200 filas, lo usan el panel y el agente)
export const view = (over: Partial<SettingView> = {}): SettingView => ({
	key: "FCC_HISTORY_MAX_ROWS",
	group: "Histórico",
	name: "Filas por consulta del histórico",
	help: "Tope de filas que devuelve una consulta del histórico, aunque se pidan más.",
	unit: "filas",
	usedBy: ["panel", "agent"],
	stored: null,
	effective: 200,
	origin: "default",
	default: 200,
	running: 200,
	...over,
});
