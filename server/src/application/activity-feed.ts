import type { ActivitySource, StoredEvent } from "./ports/activity-source.ts";

export type FeedListener = (events: readonly StoredEvent[]) => void;

export type ActivityFeed = {
	start(): void;
	// El reenvío (lo registrado desde `afterId`) y el alta del oyente se toman en el mismo instante: no se
	// pierde ni se repite ningún evento. Sin `afterId` no hay reenvío: la web pide el estado a la API
	subscribe(
		listener: FeedListener,
		afterId: number | null,
	): {
		readonly latestId: number;
		readonly replay: readonly StoredEvent[];
		unsubscribe(): void;
	};
	stop(): void;
};

export function createActivityFeed(deps: {
	readonly source: ActivitySource;
	// Máximo de eventos que se reenvían a quien reconecta
	readonly replayLimit: number;
}): ActivityFeed {
	const listeners = new Set<FeedListener>();
	let stopFollowing: (() => void) | null = null;

	return {
		start() {
			stopFollowing = deps.source.follow((events) => {
				for (const listener of listeners) {
					try {
						listener(events);
					} catch {
						// un cliente roto no debe afectar a los demás: su conexión se limpia al cerrarse
					}
				}
			});
		},

		subscribe(listener, afterId) {
			const latestId = deps.source.latestId();
			// Un id por delante del registro es de otra base (se recreó): se trata como cliente nuevo
			const resume = afterId !== null && afterId <= latestId ? afterId : null;
			const replay =
				resume === null ? [] : deps.source.readAfter(resume, deps.replayLimit);
			// El seguimiento puede traer aún eventos que el reenvío ya incluyó: cada oyente recuerda hasta dónde ha recibido
			let sent = replay.at(-1)?.id ?? resume ?? latestId;
			const guarded: FeedListener = (events) => {
				const fresh = events.filter((s) => s.id > sent);
				if (fresh.length === 0) return;
				sent = fresh.at(-1)?.id ?? sent;
				listener(fresh);
			};
			listeners.add(guarded);
			return {
				latestId,
				replay,
				unsubscribe: () => listeners.delete(guarded),
			};
		},

		stop() {
			stopFollowing?.();
			stopFollowing = null;
		},
	};
}
