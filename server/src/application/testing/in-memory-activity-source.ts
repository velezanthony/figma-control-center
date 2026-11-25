import type {
	ActivitySource,
	StoredEvent,
} from "#application/ports/activity-source.ts";
import type { ActivityEvent } from "#domain/activity.ts";

export class InMemoryActivitySource implements ActivitySource {
	readonly stored: StoredEvent[] = [];
	following = false;
	#listener: ((events: readonly StoredEvent[]) => void) | null = null;

	latestId(): number {
		return this.stored.at(-1)?.id ?? 0;
	}

	readAfter(id: number, limit: number): readonly StoredEvent[] {
		return this.stored.filter((s) => s.id > id).slice(0, limit);
	}

	follow(onEvents: (events: readonly StoredEvent[]) => void): () => void {
		this.#listener = onEvents;
		this.following = true;
		return () => {
			this.#listener = null;
			this.following = false;
		};
	}

	// Un evento que ya estaba registrado antes de que nadie lo vigilara
	seed(...events: ActivityEvent[]): void {
		for (const event of events) {
			this.stored.push({ id: this.latestId() + 1, event });
		}
	}

	// El test simula que otro proceso registró estos eventos (y el panel se entera)
	emit(...events: ActivityEvent[]): void {
		const added = events.map((event, i) => ({
			id: this.latestId() + 1 + i,
			event,
		}));
		this.stored.push(...added);
		this.#listener?.(added);
	}

	// Un evento que ya está en el registro pero que el seguimiento aún no ha entregado
	registerSilently(...events: ActivityEvent[]): StoredEvent[] {
		const added = events.map((event, i) => ({
			id: this.latestId() + 1 + i,
			event,
		}));
		this.stored.push(...added);
		return added;
	}

	deliver(events: readonly StoredEvent[]): void {
		this.#listener?.(events);
	}
}
