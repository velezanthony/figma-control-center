import { withProject } from "#web/lib/projects/endpoints.ts";
import { EVENTS_PATH, READY_EVENT } from "./endpoints.ts";
import {
	createRefreshScheduler,
	freshCallId,
	HIGHLIGHT_MS,
	REFRESH_DEBOUNCE_MS,
	REFRESH_MAX_WAIT_MS,
} from "./live.ts";
import { parseEvent } from "./parse.ts";

export type Connection = "connecting" | "open" | "closed";

// Estado en vivo: no guarda actividad (eso vive en la base y se pide a la API), solo avisa de que hay algo
// nuevo. `tick` sube cuando conviene volver a pedir datos y `fresh` son las llamadas recién llegadas, para
// resaltarlas. EventSource reconecta solo y reenvía el último `id` visto: no se pierde nada al reconectar.
// Al cambiar el proyecto activo se reabre el flujo contra ?project del nuevo proyecto.
export function createLiveStore(activeId: () => string | null) {
	let connection = $state<Connection>("connecting");
	let tick = $state(0);
	let fresh = $state.raw<ReadonlySet<string>>(new Set());
	// Verdadero cuando el servidor dijo «listo»: antes, «0 llamadas» no significa nada
	let loaded = $state(false);

	const timers = new Set<ReturnType<typeof setTimeout>>();
	const refresh = createRefreshScheduler(
		() => {
			tick++;
		},
		REFRESH_DEBOUNCE_MS,
		REFRESH_MAX_WAIT_MS,
	);

	let source: EventSource | null = null;
	const open = (projectId: string | null): void => {
		source?.close();
		connection = "connecting";
		const s = new EventSource(withProject(EVENTS_PATH, projectId));
		s.onopen = () => {
			connection = "open";
		};
		s.onerror = () => {
			connection =
				s.readyState === EventSource.CLOSED ? "closed" : "connecting";
		};
		s.addEventListener(READY_EVENT, () => {
			loaded = true;
			tick++;
		});
		s.onmessage = (e: MessageEvent<string>) => {
			const event = parseEvent(e.data);
			if (event === null) return;
			const callId = freshCallId(event);
			if (callId !== null) {
				fresh = new Set([...fresh, callId]);
				const timer = setTimeout(() => {
					timers.delete(timer);
					fresh = new Set([...fresh].filter((id) => id !== callId));
				}, HIGHLIGHT_MS);
				timers.add(timer);
			}
			refresh.request();
		};
		source = s;
	};

	// Reabre el flujo cuando cambia el proyecto activo (y lo cierra al desmontar)
	$effect(() => {
		open(activeId());
		return () => source?.close();
	});

	return {
		get connection() {
			return connection;
		},
		get tick() {
			return tick;
		},
		get fresh() {
			return fresh;
		},
		get loaded() {
			return loaded;
		},
		close() {
			source?.close();
			refresh.cancel();
			for (const t of timers) clearTimeout(t);
		},
	};
}

export type LiveStore = ReturnType<typeof createLiveStore>;
