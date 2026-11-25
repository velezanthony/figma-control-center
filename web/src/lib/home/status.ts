import type { ConnectionStatus } from "#web/lib/contract.ts";

export type Health = "ok" | "warning" | "error" | "idle";
export type PanelConnection = "connecting" | "open" | "closed";

export type NextStep = {
	readonly text: string;
	// Orden de terminal que lo resuelve
	readonly command?: string;
	// Acción que el propio panel puede hacer
	readonly action?: "launch-agent";
};

export type StatusRow = {
	readonly id: "panel" | "chrome" | "figma" | "agent";
	readonly health: Health;
	readonly label: string;
	readonly detail?: string;
	readonly next: NextStep | null;
};

export type HomeInput = {
	readonly connection: PanelConnection;
	// La última llamada a figma_status; null si aún no hubo ninguna
	readonly status: ConnectionStatus | null;
	readonly agentActive: boolean;
	readonly agentWaiting: boolean;
};

const UNCHECKED: NextStep = {
	text: "Aún no se ha comprobado: Claude lo hace con figma_status al conectar.",
};

function panelRow(connection: PanelConnection): StatusRow {
	if (connection === "open") {
		return { id: "panel", health: "ok", label: "Panel conectado", next: null };
	}
	if (connection === "connecting") {
		return { id: "panel", health: "warning", label: "Conectando…", next: null };
	}
	return {
		id: "panel",
		health: "error",
		label: "Sin conexión con el panel",
		next: {
			text: "Arranca el panel y recarga la página.",
			command: "make dashboard",
		},
	};
}

function chromeRow(status: ConnectionStatus | null): StatusRow {
	if (status === null) {
		return {
			id: "chrome",
			health: "idle",
			label: "Chrome sin comprobar",
			next: UNCHECKED,
		};
	}
	return status.chromeReachable
		? { id: "chrome", health: "ok", label: "Chrome responde", next: null }
		: {
				id: "chrome",
				health: "error",
				label: "Chrome no responde",
				next: {
					text: "Arranca Chrome con el puerto de depuración.",
					command: "make chrome",
				},
			};
}

function figmaRow(status: ConnectionStatus | null): StatusRow {
	if (status === null) {
		return {
			id: "figma",
			health: "idle",
			label: "Figma sin comprobar",
			next: UNCHECKED,
		};
	}
	if (!status.chromeReachable) {
		return {
			id: "figma",
			health: "idle",
			label: "Figma sin comprobar",
			next: { text: "Primero hace falta Chrome." },
		};
	}
	if (!status.tabFound) {
		return {
			id: "figma",
			health: "warning",
			label: "Sin pestaña de Figma",
			next: {
				text: "Abre la URL del archivo del proyecto (la de la página «Proyectos») en el Chrome de depuración.",
			},
		};
	}
	if (!status.figmaReady) {
		return {
			id: "figma",
			health: "warning",
			label: "Figma no está listo",
			next: {
				text: "Espera a que cargue el archivo o inicia sesión en la pestaña.",
				command: "make chrome",
			},
		};
	}
	const file = status.fileName ?? "sin archivo";
	return {
		id: "figma",
		health: "ok",
		label: "Figma listo",
		detail: status.pageName === null ? file : `${file} · ${status.pageName}`,
		next: null,
	};
}

function agentRow(active: boolean, waiting: boolean): StatusRow {
	if (active) {
		return {
			id: "agent",
			health: "ok",
			label: "Agente escuchando",
			next: null,
		};
	}
	if (waiting) {
		return {
			id: "agent",
			health: "warning",
			label: "Agente arrancando…",
			next: {
				text: "Acepta los avisos en la terminal que se abrió; la sesión aparecerá sola.",
			},
		};
	}
	return {
		id: "agent",
		health: "warning",
		label: "Ningún agente escuchando",
		next: {
			text: "Lanza una sesión de Claude Code que atienda el chat.",
			action: "launch-agent",
		},
	};
}

// Panel, Chrome y Figma: lo que dice el pie de la barra lateral
export function connectionRows(
	connection: PanelConnection,
	status: ConnectionStatus | null,
): readonly StatusRow[] {
	return [panelRow(connection), chromeRow(status), figmaRow(status)];
}

// Las cuatro piezas de las que depende trabajar con Figma desde Claude, cada una con su siguiente paso si falla
export function statusRows(input: HomeInput): readonly StatusRow[] {
	return [
		...connectionRows(input.connection, input.status),
		agentRow(input.agentActive, input.agentWaiting),
	];
}

export type Summary = { readonly health: Health; readonly text: string };

const ALL_READY = "Todo listo · en vivo";
// Lo más grave primero: un error tapa un aviso, y un aviso, lo que está sin comprobar
const SEVERITY: readonly Health[] = ["error", "warning", "idle"];

// Una línea para varias filas: la primera de lo más grave que haya, o que todo está listo
export function connectionSummary(rows: readonly StatusRow[]): Summary {
	for (const health of SEVERITY) {
		const row = rows.find((r) => r.health === health);
		if (row !== undefined) return { health, text: row.label };
	}
	return { health: "ok", text: ALL_READY };
}
