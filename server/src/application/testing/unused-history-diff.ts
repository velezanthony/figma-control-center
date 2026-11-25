import type { makeHistoryDiff } from "#application/history-diff.ts";
import { err } from "#domain/result.ts";

// Para los tests de herramientas que no tocan el historial de intentos pero montan los casos de uso enteros
export const unusedHistoryDiff: ReturnType<typeof makeHistoryDiff> = () =>
	Promise.resolve(
		err({
			type: "InvalidInput",
			message: "figma_history_diff no se usa aquí",
		}),
	);
