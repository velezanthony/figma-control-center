// La regla del cierre del agente lanzado desde el panel: agent-run.ts vigila una conexión abierta
// con el panel y, si se cae y el panel no vuelve en el margen, cierra a `claude`. Pura: el tiempo llega como entrada y
// lo que hay que hacer sale como efecto; los temporizadores, la conexión y las señales son de agent-run.ts.
import { LAUNCH_DIR_PREFIX } from "./agent-harness.ts";

// Por qué se cierra: el panel no volvió, el panel lo pidió (botón «Cerrar agente») o el usuario cerró la consola
export type CloseReason = "panelGone" | "closeRequested" | "user";

export type WatchState =
	| { readonly phase: "watching" }
	| { readonly phase: "waitingPanel"; readonly since: number }
	| { readonly phase: "closing"; readonly reason: CloseReason }
	| { readonly phase: "closed" };

export type WatchInput =
	// La conexión está abierta y el panel reconoce el lanzamiento
	| { readonly type: "connected" }
	// La conexión se cayó, o un reintento no la abrió (o el panel no reconoce el lanzamiento)
	| { readonly type: "disconnected"; readonly at: number }
	| { readonly type: "tick"; readonly at: number }
	// El panel mandó el evento `close` por la conexión
	| { readonly type: "closeRequested" }
	// SIGHUP o SIGTERM: el usuario cierra la consola
	| { readonly type: "hangup" }
	| { readonly type: "claudeExited" };

export type WatchEffect =
	| { readonly type: "none" }
	| { readonly type: "retry"; readonly afterMs: number }
	// Cerrar a claude nosotros: SIGTERM, SIGKILL tras el plazo, limpiar y salir
	| {
			readonly type: "shutdown";
			readonly reason: Exclude<CloseReason, "user">;
	  }
	// El cierre de siempre al cerrar la terminal: señal a claude, limpieza y salida
	| { readonly type: "userClose" };

export type WatchTiming = {
	// Cuánto se espera a que vuelva el panel (FCC_AGENT_PANEL_GRACE_MS)
	readonly graceMs: number;
	// Cada cuánto se reintenta conectar mientras tanto (FCC_AGENT_WATCH_RETRY_MS)
	readonly retryMs: number;
};

export const WATCH_START: WatchState = Object.freeze({ phase: "watching" });

type Step = { readonly state: WatchState; readonly effect: WatchEffect };

const NONE: WatchEffect = Object.freeze({ type: "none" });
const stay = (state: WatchState): Step => ({ state, effect: NONE });

function closing(reason: Exclude<CloseReason, "user">): Step {
	return {
		state: { phase: "closing", reason },
		effect: { type: "shutdown", reason },
	};
}

// Un solo cierre: cerrando o cerrada, nada (ni el usuario, ni el fin del margen, ni el panel) abre otro
export function watchStep(
	state: WatchState,
	input: WatchInput,
	timing: WatchTiming,
): Step {
	if (state.phase === "closed") return stay(state);
	if (state.phase === "closing") {
		return input.type === "claudeExited"
			? stay({ phase: "closed" })
			: stay(state);
	}
	switch (input.type) {
		case "hangup":
			return {
				state: { phase: "closing", reason: "user" },
				effect: { type: "userClose" },
			};
		case "claudeExited":
			return stay({ phase: "closed" });
		case "closeRequested":
			return closing("closeRequested");
		case "connected":
			return stay({ phase: "watching" });
		case "disconnected":
		case "tick": {
			if (state.phase === "watching") {
				return input.type === "tick"
					? stay(state)
					: {
							state: { phase: "waitingPanel", since: input.at },
							effect: { type: "retry", afterMs: timing.retryMs },
						};
			}
			if (input.at - state.since >= timing.graceMs) return closing("panelGone");
			return input.type === "tick"
				? stay(state)
				: {
						state,
						effect: { type: "retry", afterMs: timing.retryMs },
					};
		}
		default: {
			const unreachable: never = input;
			return unreachable;
		}
	}
}

// El id de un lanzamiento es el UUID que le da quien lo prepara (randomUUID): con esa forma, nunca sale de su carpeta
const LAUNCH_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isLaunchId = (value: string): boolean => LAUNCH_ID.test(value);

// El id del lanzamiento de una carpeta `<tmp>/figma-agent-<id>`, o null si no es la carpeta de un lanzamiento
export function launchIdOfDir(dir: string): string | null {
	const name = dir.replace(/\/+$/, "").split("/").at(-1) ?? "";
	if (!name.startsWith(LAUNCH_DIR_PREFIX)) return null;
	const id = name.slice(LAUNCH_DIR_PREFIX.length);
	return isLaunchId(id) ? id : null;
}
