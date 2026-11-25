import { relativeAgo } from "#web/lib/chat/session-label.ts";
import type { ConnectionStatus } from "#web/lib/contract.ts";

// El panel no mira Chrome: repite lo que dijo el último figma_status, así que dice cuánto hace de eso
export function figmaLabel(
	status: ConnectionStatus | null,
	now: number,
): string {
	if (status === null) return "Figma sin comprobar";
	const state = status.figmaReady
		? "Figma listo"
		: !status.tabFound
			? "Sin pestaña de Figma"
			: "Figma no está listo";
	return `${state} · ${relativeAgo(status.at, now)}`;
}
