import type { ActivityArchive } from "#application/ports/activity-archive.ts";
import type {
	HistoryMaintenance,
	ImportOutcome,
	PruneResult,
} from "#application/ports/history-maintenance.ts";
import type { ActivityEvent } from "#domain/activity.ts";

export class InMemoryActivityArchive implements ActivityArchive {
	events: ActivityEvent[] = [];
	readAll(): Promise<readonly ActivityEvent[]> {
		return Promise.resolve(this.events);
	}
}

export class InMemoryHistoryMaintenance implements HistoryMaintenance {
	readonly pruned: Date[] = [];
	readonly imports: { key: string; events: readonly ActivityEvent[] }[] = [];
	pruneResult: PruneResult = {
		events: 0,
		calls: 0,
		sessions: 0,
		attempts: 0,
		scripts: 0,
	};
	readonly #keys = new Set<string>();

	prune(olderThan: Date): PruneResult {
		this.pruned.push(olderThan);
		return this.pruneResult;
	}

	readonly interruptedSessions: {
		sessionId: string;
		reason: string;
		at: Date;
	}[] = [];
	readonly sweeps: { ownSessionId: string; reason: string; at: Date }[] = [];
	interruptedCount = 0;

	interruptSessionJobs(sessionId: string, reason: string, at: Date): number {
		this.interruptedSessions.push({ sessionId, reason, at });
		return this.interruptedCount;
	}

	interruptDeadSessionJobs(options: {
		readonly ownSessionId: string;
		readonly reason: string;
		readonly at: Date;
	}): number {
		this.sweeps.push({
			ownSessionId: options.ownSessionId,
			reason: options.reason,
			at: options.at,
		});
		return this.interruptedCount;
	}

	importOnce(key: string, events: readonly ActivityEvent[]): ImportOutcome {
		if (this.#keys.has(key)) return { status: "already-imported" };
		this.#keys.add(key);
		this.imports.push({ key, events });
		return { status: "imported", events: events.length };
	}
}
