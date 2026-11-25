import type { makeHistoryScript } from "#application/history-script.ts";
import { err } from "#domain/result.ts";

// Para los tests de herramientas que no tocan el historial de intentos pero montan los casos de uso enteros
export const unusedHistoryScript: ReturnType<typeof makeHistoryScript> = () =>
	Promise.resolve(
		err({
			type: "InvalidInput",
			message: "figma_history_script no se usa aquí",
		}),
	);
