import { and, asc, desc, eq, gt } from "drizzle-orm";
import type {
	ActivitySource,
	StoredEvent,
} from "#application/ports/activity-source.ts";
import type { ActivityEvent } from "#domain/activity.ts";
import type { FigmaDb } from "./database.ts";
import { events } from "./schema.ts";

// Eventos que se leen de golpe en cada vuelta del seguimiento
const POLL_BATCH = 1000;

const toStored = (row: { id: number; payload: string }): StoredEvent => ({
	id: row.id,
	event: JSON.parse(row.payload) as ActivityEvent,
});

// Solo lee: el registro lo escribe SqliteActivityLog desde el proceso MCP. El cursor es el id del evento
export class SqliteActivitySource implements ActivitySource {
	readonly #db: FigmaDb;
	readonly #projectId: number;
	readonly #pollMs: number;

	constructor(options: {
		readonly db: FigmaDb;
		readonly projectId: number;
		readonly pollMs: number;
	}) {
		this.#db = options.db;
		this.#projectId = options.projectId;
		this.#pollMs = options.pollMs;
	}

	latestId(): number {
		return (
			this.#db
				.select({ id: events.id })
				.from(events)
				.where(eq(events.projectId, this.#projectId))
				.orderBy(desc(events.id))
				.limit(1)
				.get()?.id ?? 0
		);
	}

	readAfter(id: number, limit: number): readonly StoredEvent[] {
		return this.#db
			.select({ id: events.id, payload: events.payload })
			.from(events)
			.where(and(eq(events.projectId, this.#projectId), gt(events.id, id)))
			.orderBy(asc(events.id))
			.limit(limit)
			.all()
			.map(toStored);
	}

	follow(onEvents: (events: readonly StoredEvent[]) => void): () => void {
		let cursor = this.latestId();
		const timer = setInterval(() => {
			try {
				const fresh = this.readAfter(cursor, POLL_BATCH);
				if (fresh.length === 0) return;
				cursor = fresh.at(-1)?.id ?? cursor;
				onEvents(fresh);
			} catch {
				// la base puede estar ocupada un instante: se reintenta en la siguiente vuelta
			}
		}, this.#pollMs);
		return () => clearInterval(timer);
	}
}
