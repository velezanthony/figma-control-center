import { untrack } from "svelte";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import { CHAT_SESSIONS_PATH } from "#web/lib/chat/endpoints.ts";
import type { ChatSessionInfo } from "#web/lib/contract.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import {
	CLOSE_INIT,
	closeButtonState,
	closePath,
	closeSettled,
	LAUNCHES_PATH,
	parseCloseResponse,
	parseLaunchesResponse,
	runningBatchPath,
} from "./close.ts";
import {
	appearedSession,
	LAUNCH_INIT,
	launchPath,
	parseLaunchResponse,
	waitExpired,
} from "./launch.ts";

// Cada cuánto se vuelve a mirar qué sesiones escuchan mientras se espera la lanzada o no hay ninguna conocida: una
// sesión publica su token tras arrancar, sin evento en vivo. Con sesiones y sin espera solo se piden al cargar y con
// los eventos del chat (refresh): nunca por cada evento de actividad, que durante un lote no paran
const SESSIONS_POLL_MS = 2000;
const EXPIRED_MESSAGE =
	"La sesión no ha aparecido a tiempo. Si cerraste la terminal o no aceptaste el aviso, reintenta el lanzamiento.";

// El agente (la sesión de Claude Code que escucha el chat): qué sesiones hay y cómo lanzar una desde el panel.
// Debe crearse durante la inicialización de un componente. `live` cambia con cada novedad del histórico (el `tick` de la
// conexión en vivo): un lote que empieza con la página abierta no avisa de otra forma
export function createAgent(live: () => unknown) {
	let poll = $state(0);
	let launching = $state(false);
	let error = $state<string | null>(null);
	let expired = $state(false);
	// Mientras se espera la sesión lanzada: las que ya existían, cuándo se pidió y el plazo que fija el servidor
	let waiting = $state.raw<{
		known: ReadonlySet<string>;
		startedAtMs: number;
		timeoutMs: number;
	} | null>(null);

	const sessions = createResource<{ items: ChatSessionInfo[] }>(
		() => CHAT_SESSIONS_PATH,
		() => poll,
	);
	const items = $derived(sessions.data?.items ?? []);

	// El agente lanzado desde el panel que sigue vivo y vigilando (el que puede cerrar «Cerrar agente»): se mira con las
	// sesiones. Si hay un lote en curso (cerrar lo dejaría interrumpido), también con cada novedad en vivo
	let closeBump = $state(0);
	let closing = $state(false);
	let closeError = $state<string | null>(null);
	// Tras pedir el cierre, las sesiones activas de entonces: se sigue mirando hasta que el cierre se ve (closeSettled)
	let closeRequested = $state.raw<ReadonlySet<string> | null>(null);
	const launches = createResource<unknown>(
		() => (projectState.activeId === null ? null : LAUNCHES_PATH),
		() => poll + closeBump,
	);
	const launchId = $derived(parseLaunchesResponse(launches.data));
	const batches = createResource<{ total?: number }>(
		() => (launchId === null ? null : runningBatchPath()),
		() => [poll, closeBump, live()],
	);
	$effect(() => {
		if (
			closeRequested !== null &&
			closeSettled({ launchId, aliveAtClose: closeRequested, sessions: items })
		)
			closeRequested = null;
	});
	const closeState = $derived(
		closeButtonState({
			launchId,
			batchRunning: (batches.data?.total ?? 0) > 0,
		}),
	);
	const arrived = $derived(
		waiting === null ? null : appearedSession(waiting.known, items),
	);

	$effect(() => {
		const timer = setInterval(() => {
			// Sin ninguna sesión conocida también se pregunta: una sesión publica su token sin avisar
			// Tras pedir el cierre se sigue mirando hasta que el agente se va (su sesión y su vigilancia desaparecen)
			if (waiting === null && items.length > 0 && closeRequested === null)
				return;
			poll++;
			if (
				waiting !== null &&
				waitExpired(waiting.startedAtMs, waiting.timeoutMs, Date.now())
			) {
				waiting = null;
				expired = true;
				error = EXPIRED_MESSAGE;
			}
		}, SESSIONS_POLL_MS);
		return () => clearInterval(timer);
	});

	async function launch(): Promise<void> {
		if (launching || waiting !== null) return;
		launching = true;
		error = null;
		expired = false;
		const known = new Set(items.map((s) => s.sessionId));
		try {
			const response = await fetch(
				launchPath(projectState.activeId),
				LAUNCH_INIT,
			);
			const outcome = parseLaunchResponse(
				response.status,
				await response.json().catch(() => null),
			);
			if (outcome.ok) {
				waiting = {
					known,
					startedAtMs: outcome.startedAtMs,
					timeoutMs: outcome.timeoutMs,
				};
			} else error = outcome.message;
		} catch (e) {
			error = (e as Error).message;
		} finally {
			launching = false;
		}
	}

	// El panel no mata procesos: pide al agente, por su vigilancia, que se cierre
	async function close(): Promise<void> {
		if (closing || launchId === null) return;
		closing = true;
		closeError = null;
		try {
			const response = await fetch(closePath(launchId), CLOSE_INIT);
			const outcome = parseCloseResponse(
				response.status,
				await response.json().catch(() => null),
			);
			if (outcome.ok)
				closeRequested = new Set(
					items.filter((s) => s.alive).map((s) => s.sessionId),
				);
			else closeError = outcome.message;
		} catch (e) {
			closeError = (e as Error).message;
		} finally {
			closing = false;
			closeBump++;
		}
	}

	return {
		// «Cerrar agente»: desactivado (y por qué), si pide confirmación, en curso y el error de la última vez
		get closeState() {
			return closeState;
		},
		get closing() {
			return closing;
		},
		get closeError() {
			return closeError;
		},
		close,
		get sessions() {
			return items;
		},
		// Lanzar un agente necesita un proyecto activo (el servidor ya no tiene uno «por defecto» del .env)
		get canLaunch() {
			return projectState.activeId !== null;
		},
		get loaded() {
			return sessions.data !== null;
		},
		// Se ha pedido lanzar y la sesión aún no ha aparecido
		get waiting() {
			return waiting !== null && arrived === null;
		},
		// Venció el plazo sin que apareciera la sesión: la interfaz ofrece reintentar
		get expired() {
			return expired;
		},
		get launching() {
			return launching;
		},
		get error() {
			return error;
		},
		// La sesión nueva, hasta que alguien la recoja con acknowledge()
		get arrived() {
			return arrived;
		},
		// Vuelve a pedir las sesiones (los eventos del chat pueden traer una sesión nueva)
		// (`untrack`: se llama desde un efecto y `poll++` también lee)
		refresh() {
			untrack(() => poll++);
		},
		acknowledge() {
			waiting = null;
		},
		launch,
	};
}

export type Agent = ReturnType<typeof createAgent>;
